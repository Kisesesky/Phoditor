const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  LAYOUT_SPECS,
  computeSlotPlacement,
  getImageInfoFromBuffer,
  exportWorkbook
} = require('./export');

const DEFS_DIR = path.join(__dirname, 'data', 'templateDefs');
const BLANKS_DIR = path.join(__dirname, 'data', 'blanks');

function loadDef(id) {
  return JSON.parse(fs.readFileSync(path.join(DEFS_DIR, `${id}.templateDef.json`), 'utf-8'));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Pure-Node minimal valid PNG generator (RGB solid color, exact width x height)
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function createSolidPng(width, height, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Build scanlines (filter byte 0 + RGB pixels)
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const base = y * rowSize;
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 2 + x * 3] = g;
      raw[base + 3 + x * 3] = b;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 1 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildEditorStateFromDef(def) {
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    if (sDef.role === 'cover' || sDef.role === 'toc') {
      sheets.push({ name: sDef.name, role: sDef.role, sheetDef: sDef, cells: {} });
    } else if (sDef.role === 'block') {
      const repeatedValues = {};
      for (const rv of (sDef.block && sDef.block.repeatedValues) || []) {
        repeatedValues[rv.cell] = '';
      }
      sheets.push({
        name: sDef.name,
        role: 'block',
        sheetDef: sDef,
        repeatedValues,
        blocks: [{ values: {}, extraCells: {}, photoAreas: {} }]
      });
    }
  }
  return { sheets };
}

async function runTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-test-'));
  console.log('=== 템플릿 사진 엑셀 에디터 1단계 내보내기 테스트 ===');
  console.log('임시 작업 폴더:', tmpDir);

  // 1. Create test images (portrait, landscape, large 3000px, small 300px)
  const imgSpecs = {
    portrait: { file: path.join(tmpDir, 'portrait_600x900.png'), w: 600, h: 900, rgb: [47, 111, 237] },
    landscape: { file: path.join(tmpDir, 'landscape_900x600.png'), w: 900, h: 600, rgb: [46, 160, 67] },
    large: { file: path.join(tmpDir, 'large_3000x2000.png'), w: 3000, h: 2000, rgb: [217, 56, 58] },
    small: { file: path.join(tmpDir, 'small_300x200.png'), w: 300, h: 200, rgb: [230, 162, 60] }
  };

  const origHashes = {};
  for (const [key, spec] of Object.entries(imgSpecs)) {
    const buf = createSolidPng(spec.w, spec.h, ...spec.rgb);
    fs.writeFileSync(spec.file, buf);
    origHashes[key] = sha256(buf);
  }

  // 2. Test Layout Math (1~4장 contain, 작은 사진도 자리에 맞춤, center, padding)
  console.log('\n[1/5] 레이아웃 1~4장 맞춤·중앙 정렬·여유 계산 검증...');
  const area = { x: 0, y: 0, width: 420, height: 320 };
  for (const layoutKey of Object.keys(LAYOUT_SPECS)) {
    const spec = LAYOUT_SPECS[layoutKey];
    for (let s = 0; s < spec.count; s++) {
      // Large 3000x2000 should downscale and stay centered within pad
      const pLarge = computeSlotPlacement(area, layoutKey, s, 3000, 2000);
      assert(pLarge.scale < 1, `${layoutKey} large must downscale`);
      assert(pLarge.width <= pLarge.slotW - 2 * pLarge.pad + 0.01);
      assert(pLarge.height <= pLarge.slotH - 2 * pLarge.pad + 0.01);
      const cx = pLarge.x + pLarge.width / 2;
      const slotCx = pLarge.slotX + pLarge.slotW / 2;
      assert(Math.abs(cx - slotCx) < 0.01, `${layoutKey} must be horizontally centered`);

      // [2026-11-25 S17] Small 50x40 now fills the slot (contain, ratio kept, one side touches the padding)
      const pSmall = computeSlotPlacement(area, layoutKey, s, 50, 40);
      assert(pSmall.scale > 1, `${layoutKey} small image must be enlarged to fit`);
      const fitW = Math.abs(pSmall.width - (pSmall.slotW - 2 * pSmall.pad)) < 0.01;
      const fitH = Math.abs(pSmall.height - (pSmall.slotH - 2 * pSmall.pad)) < 0.01;
      assert(fitW || fitH, `${layoutKey} small image must touch the padding on one side`);
      assert(Math.abs(pSmall.width / pSmall.height - 50 / 40) < 0.001, `${layoutKey} ratio kept`);
    }
  }
  console.log('  PASS: 1x1, 1x2, 2x1, 1x3, 3x1, 2x2 중앙 정렬·여유·작은 사진 맞춤 확인');

  // 3. Sample 1: 준공사진첩_롯데 (10행, multi-sheet, document chain numbering)
  console.log('\n[2/5] 샘플 1: 준공사진첩_롯데 (10행 · 다중 시트 · 블록 추가/중간 삽입 · 중복 제거 · {{현장명}})...');
  const lotteDef = loadDef('준공사진첩_롯데');
  const lotteState = buildEditorStateFromDef(lotteDef);
  // Set cover siteName
  const coverSheet = lotteState.sheets.find((s) => s.role === 'cover');
  coverSheet.cells['A9'] = '테스트 롯데캐슬 현장';

  // Edit first block sheet (공간별전경): append 2 blocks + middle insert 1 block = 4 blocks
  const s1 = lotteState.sheets.find((s) => s.name === '공간별전경');
  s1.repeatedValues['H{+0}'] = '테스트 롯데캐슬 현장';
  s1.blocks = [
    {
      values: { 'I{+5}': '거실', 'I{+6}': '전경1' },
      extraCells: {},
      photoAreas: {
        0: { layout: '1x1', slots: [{ path: imgSpecs.portrait.file }] }
      }
    },
    {
      values: { 'I{+5}': '주방', 'I{+6}': '중간삽입 블록' },
      extraCells: {},
      photoAreas: {
        0: { layout: '1x2', slots: [{ path: imgSpecs.landscape.file }, { path: imgSpecs.large.file }] }
      }
    },
    {
      values: { 'I{+5}': '욕실', 'I{+6}': '중복 사진 테스트' },
      extraCells: {},
      photoAreas: {
        // Place same portrait photo again -> must deduplicate in xl/media!
        0: { layout: '2x2', slots: [{ path: imgSpecs.small.file }, { path: imgSpecs.portrait.file }, null, null] }
      }
    }
  ];

  // Check second block sheet (가구공사) numbering should start at 4 (after 3 blocks in s1)
  const s2 = lotteState.sheets.find((s) => s.name === '가구공사');
  s2.blocks = [
    { values: { 'I{+5}': '현관', 'I{+6}': '신발장' }, extraCells: {}, photoAreas: {} },
    { values: { 'I{+5}': '주방', 'I{+6}': '상부장' }, extraCells: {}, photoAreas: {} }
  ];

  const lotteOut = path.join(tmpDir, 'out_준공사진첩_롯데.xlsx');
  const lotteBlank = path.join(BLANKS_DIR, '준공사진첩_롯데.xlsx');
  const lotteRes = await exportWorkbook({
    templateDef: lotteDef,
    editorState: lotteState,
    blankXlsxPath: fs.existsSync(lotteBlank) ? lotteBlank : null,
    outputPath: lotteOut
  });

  // Verify deduplication: 5 placements (portrait x2, landscape, large, small) -> 4 unique images
  assert.strictEqual(lotteRes.totalPhotoPlacements, 5, 'Expected 5 photo placements');
  assert.strictEqual(lotteRes.uniqueImagesEmbedded, 4, 'Expected 4 unique deduplicated images');

  // Unzip and verify exact image bytes & resolution match + {{현장명}} replacement
  const lotteZip = await JSZip.loadAsync(fs.readFileSync(lotteOut));
  const mediaFiles = Object.keys(lotteZip.files).filter((f) => f.startsWith('xl/media/') && !f.endsWith('/'));
  assert.strictEqual(mediaFiles.length, 4, `Expected 4 files in xl/media, got ${mediaFiles.length}`);

  const embeddedHashes = new Set();
  for (const mf of mediaFiles) {
    const buf = await lotteZip.file(mf).async('nodebuffer');
    embeddedHashes.add(sha256(buf));
    const info = getImageInfoFromBuffer(buf, 'png');
    assert(info && info.width > 0 && info.height > 0, `Valid image dimensions for ${mf}`);
  }
  for (const [k, h] of Object.entries(origHashes)) {
    assert(embeddedHashes.has(h), `Embedded xl/media must match original SHA-256 for ${k}`);
  }

  // Verify {{현장명}} replaced
  // [Konan 수정 2026-11-24] ExcelJS는 문자열 셀 값을 xl/sharedStrings.xml에 저장하므로,
  // 현장명 검사는 worksheet XML + sharedStrings.xml 둘 다 봐야 함 (worksheet XML에는 인덱스만 있음)
  let foundSiteNameInXml = false;
  for (const fn of Object.keys(lotteZip.files)) {
    if ((fn.startsWith('xl/worksheets/') || fn === 'xl/sharedStrings.xml') && fn.endsWith('.xml')) {
      const xml = await lotteZip.file(fn).async('string');
      assert(!xml.includes('{{현장명}}'), `Placeholder {{현장명}} must not remain in ${fn}`);
      if (xml.includes('테스트 롯데캐슬 현장')) foundSiteNameInXml = true;
    }
  }
  assert(foundSiteNameInXml, 'Site name should appear in exported workbook XML');

  // Reload with ExcelJS to verify numbering (A안 direct values, no formulas) & merges
  const checkWb = new ExcelJS.Workbook();
  await checkWb.xlsx.readFile(lotteOut);
  const wsS1 = checkWb.getWorksheet('공간별전경');
  assert.strictEqual(wsS1.getCell('I10').value, 1);
  assert.strictEqual(wsS1.getCell('I20').value, 2);
  assert.strictEqual(wsS1.getCell('I30').value, 3);
  assert.strictEqual(typeof wsS1.getCell('I20').value, 'number', 'Numbering must be direct value (A안)');

  const wsS2 = checkWb.getWorksheet('가구공사');
  assert.strictEqual(wsS2.getCell('I10').value, 4, 'Cross-sheet numbering must continue at 4');
  assert.strictEqual(wsS2.getCell('I20').value, 5, 'Cross-sheet numbering must continue at 5');
  assert(wsS1.model.merges.length >= 3, 'Photo area merges must be replicated for all 3 blocks');
  console.log('  PASS: 바이트/해상도 동일, 중복 제거(5배치→4저장), 시트 간 번호(1~3 → 4~5), 병합 유지, {{현장명}} 치환 확인');

  // 4. Sample 2: 공용홀_한신더휴 (8행)
  console.log('\n[3/5] 샘플 2: 공용홀_한신더휴 (8행 · 블록 추가 · 레이아웃 1x3/3x1)...');
  const hanshinDef = loadDef('공용홀_한신더휴');
  const hanshinState = buildEditorStateFromDef(hanshinDef);
  const hsBlock = hanshinState.sheets.find((s) => s.name === '공용홀');
  hsBlock.blocks = [
    {
      values: { 'C{+1}': '공용홀 1F', 'C{+2}': '로비 전경' },
      extraCells: {},
      photoAreas: { 0: { layout: '1x3', slots: [{ path: imgSpecs.portrait.file }, { path: imgSpecs.landscape.file }, { path: imgSpecs.small.file }] } }
    },
    {
      values: { 'C{+1}': '공용홀 2F', 'C{+2}': '단지모형' },
      extraCells: {},
      photoAreas: { 0: { layout: '3x1', slots: [{ path: imgSpecs.large.file }, null, null] } }
    }
  ];
  const hsOut = path.join(tmpDir, 'out_공용홀_한신더휴.xlsx');
  await exportWorkbook({
    templateDef: hanshinDef,
    editorState: hanshinState,
    blankXlsxPath: fs.existsSync(path.join(BLANKS_DIR, '공용홀_한신더휴.xlsx'))
      ? path.join(BLANKS_DIR, '공용홀_한신더휴.xlsx')
      : null,
    outputPath: hsOut
  });
  const hsWb = new ExcelJS.Workbook();
  await hsWb.xlsx.readFile(hsOut);
  const wsHs = hsWb.getWorksheet('공용홀');
  assert.strictEqual(wsHs.getCell('C1').value, 1);
  assert.strictEqual(wsHs.getCell('C9').value, 2);
  console.log('  PASS: 공용홀_한신더휴 8행 블록 추가 및 번호(1, 2) 확인');

  // 5. Hillstate 22-row (addUnit: page, totalCell) + Hanshin Junggong S12 (2 blocks/page)
  console.log('\n[4/5] 힐스테이트 준공 totalCell(A안) 및 한신더휴 준공 인쇄(S12 2블록/쪽) 검증...');
  const hillDef = loadDef('준공사진첩_힐스테이트');
  const hillState = buildEditorStateFromDef(hillDef);
  const hillBlock = hillState.sheets.find((s) => s.name === '84㎡A사진첩');
  hillBlock.blocks = [
    { values: { 'B{+2}': '거실' }, extraCells: {}, photoAreas: {} },
    { values: { 'B{+2}': '주방' }, extraCells: {}, photoAreas: {} },
    { values: { 'B{+2}': '안방' }, extraCells: {}, photoAreas: {} }
  ];
  // [검증 후속 수정 2026-11-24] 합성 통합문서뿐 아니라 실제 빈 양식(data/blanks)으로도 같은 검사를 한다.
  const sheetXmlByName = async (zip, sheetName) => {
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const relXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tag = [...wbXml.matchAll(/<sheet [^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`name="${esc(sheetName)}"`));
    assert(tag, `sheet ${sheetName} must exist`);
    const rid = /r:id="([^"]+)"/.exec(tag)[1];
    const rel = [...relXml.matchAll(/<Relationship [^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
    const target = /Target="([^"]+)"/.exec(rel)[1].replace(/^\/?(xl\/)?/, '');
    return zip.file(`xl/${target}`).async('string');
  };
  const hillBlankPath = path.join(BLANKS_DIR, '준공사진첩_힐스테이트.xlsx');
  const hsJunBlankPath = path.join(BLANKS_DIR, '준공사진첩_한신더휴.xlsx');
  const variants = [{ label: '합성', hill: null, hsJun: null }];
  if (fs.existsSync(hillBlankPath) && fs.existsSync(hsJunBlankPath)) {
    variants.push({ label: '실제 빈 양식', hill: hillBlankPath, hsJun: hsJunBlankPath });
  }
  for (const v of variants) {
    const hillOut = path.join(tmpDir, `out_준공사진첩_힐스테이트_${v.label}.xlsx`);
    await exportWorkbook({
      templateDef: hillDef,
      editorState: hillState,
      blankXlsxPath: v.hill,
      outputPath: hillOut
    });
    const hillWb = new ExcelJS.Workbook();
    await hillWb.xlsx.readFile(hillOut);
    const wsHill = hillWb.getWorksheet('84㎡A사진첩');
    assert.strictEqual(wsHill.getCell('L3').value, 1, `[${v.label}] Hillstate number block 1`);
    assert.strictEqual(wsHill.getCell('N3').value, 3, `[${v.label}] Hillstate totalCell must equal total block count 3`);
    assert.strictEqual(wsHill.getCell('L25').value, 2);
    assert.strictEqual(wsHill.getCell('N25').value, 3);
    assert.strictEqual(wsHill.getCell('L47').value, 3);
    assert.strictEqual(wsHill.getCell('N47').value, 3);

    // S12: 준공사진첩_한신더휴 5 blocks -> rowBreaks at block 2 (row 16) and block 4 (row 32)
    const hsJunDef = loadDef('준공사진첩_한신더휴');
    const hsJunState = buildEditorStateFromDef(hsJunDef);
    const hsJunSheet = hsJunState.sheets.find((s) => s.name === '84㎡A');
    hsJunSheet.blocks = Array.from({ length: 5 }, () => ({ values: {}, extraCells: {}, photoAreas: {} }));
    const hsJunOut = path.join(tmpDir, `out_준공사진첩_한신더휴_${v.label}.xlsx`);
    await exportWorkbook({
      templateDef: hsJunDef,
      editorState: hsJunState,
      blankXlsxPath: v.hsJun,
      outputPath: hsJunOut
    });
    const hsJunZip = await JSZip.loadAsync(fs.readFileSync(hsJunOut));
    const blockXml = await sheetXmlByName(hsJunZip, '84㎡A');
    const brks = [...blockXml.matchAll(/<brk [^>]*id="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepStrictEqual(brks, [16, 32], `[${v.label}] S12: 한신더휴 준공 rowBreaks must be [16, 32], got ${JSON.stringify(brks)}`);
    console.log(`  PASS [${v.label}]: 힐스테이트 totalCell(3), 한신더휴 준공 S12 페이지 나누기 ${JSON.stringify(brks)}`);
  }

  // 현장명은 kind: 'siteName' 칸에서만 가져온다 — 현장명이 비어 있으면 날짜 칸 값을 쓰지 않는다
  const { extractSiteName } = require('./export');
  const snState = buildEditorStateFromDef(hillDef);
  const hillCover = snState.sheets.find((s) => s.role === 'cover');
  hillCover.cells['E30'] = '2026.11.24';
  assert.strictEqual(extractSiteName(snState), '', 'siteName empty must not fall back to the date field');
  hillCover.cells['A4'] = '힐스테이트 테스트 현장';
  assert.strictEqual(extractSiteName(snState), '힐스테이트 테스트 현장');
  // 표지에 siteName 칸이 없는 '기타' 양식은 화면에서 입력한 현장명을 쓴다
  const etcDef = loadDef('준공사진첩_기타');
  const etcState = buildEditorStateFromDef(etcDef);
  const etcCover = etcState.sheets.find((s) => s.role === 'cover');
  etcCover.cells['A7'] = '84㎡A TYPE';
  etcState.siteName = '기타 테스트 현장';
  assert.strictEqual(extractSiteName(etcState), '기타 테스트 현장', 'Typed site name must be used when cover has no siteName field');
  const etcOut = path.join(tmpDir, 'out_준공사진첩_기타.xlsx');
  const etcBlank = path.join(BLANKS_DIR, '준공사진첩_기타.xlsx');
  await exportWorkbook({ templateDef: etcDef, editorState: etcState, blankXlsxPath: fs.existsSync(etcBlank) ? etcBlank : null, outputPath: etcOut });
  const etcZip = await JSZip.loadAsync(fs.readFileSync(etcOut));
  let etcFound = false;
  for (const fn of Object.keys(etcZip.files)) {
    if (fn.startsWith('xl/worksheets/') && fn.endsWith('.xml')) {
      const xml = await etcZip.file(fn).async('string');
      assert(!xml.includes('{{현장명}}'), `Placeholder must not remain in ${fn}`);
      if (xml.includes('기타 테스트 현장')) etcFound = true;
    }
  }
  assert(etcFound, 'Typed site name must appear in header of 준공사진첩_기타');
  console.log('  PASS: 현장명은 siteName 칸에서만 가져옴(날짜 칸으로 대체하지 않음), siteName 칸이 없는 기타 양식은 입력한 현장명을 머리말에 넣음');

  // 6. Original photo immutability check
  console.log('\n[5/5] 원본 사진 파일 불변(SHA-256) 및 메모리 사용량 확인...');
  for (const [key, spec] of Object.entries(imgSpecs)) {
    const afterHash = sha256(fs.readFileSync(spec.file));
    assert.strictEqual(afterHash, origHashes[key], `Original photo ${key} must never be modified`);
  }
  const mem = process.memoryUsage();
  console.log(`  PASS: 원본 사진 4개 SHA-256 불변 확인 (RSS ${(mem.rss / 1024 / 1024).toFixed(1)} MB)`);
  console.log('\n모든 자동 테스트 통과!');
}

runTests().catch((err) => {
  console.error('테스트 실패:', err);
  process.exit(1);
});
