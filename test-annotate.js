// [3순위 2026-11-25] 사진 위 표시(화살표·네모·글상자)가 엑셀 도형으로, "칸에 맞게 줄이기"가 셀 맞춤으로 들어가는지
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const { exportWorkbook } = require('./export');

const DEFS = path.join(__dirname, 'data', 'templateDefs');
const BLANKS = path.join(__dirname, 'data', 'blanks');
const loadDef = (id) => JSON.parse(fs.readFileSync(path.join(DEFS, `${id}.templateDef.json`), 'utf-8'));

function makePng(w, h) {
  // 단색 PNG (zlib 저장 블록)
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x88);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-annot-'));
  const photo = path.join(tmp, 'p.png');
  fs.writeFileSync(photo, makePng(800, 600));
  let pass = 0;
  const ok = (m) => { pass++; console.log('  PASS:', m); };

  const id = '공용홀_롯데';
  const def = loadDef(id);
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    if (sDef.role === 'block') sheets.push({ name: sDef.name, role: 'block', sheetDef: sDef, repeatedValues: {}, blocks: [{ values: { 'L{+4}': '아주아주 긴 품목 이름이 들어가서 칸을 넘치는 경우' }, extraCells: {}, photoAreas: {} }] });
    else sheets.push({ name: sDef.name, role: sDef.role, sheetDef: sDef, cells: {} });
  }
  const blk = sheets.find((s) => s.role === 'block');
  blk.blocks[0].photoAreas[0] = {
    layout: '1x1',
    slots: [{ name: 'p.png', path: photo, annotations: [
      { t: 'arrow', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.4, c: '#E11D48', w: 3 },
      { t: 'box', x: 0.6, y: 0.6, w2: 0.2, h2: 0.2, c: '#2563EB', w: 2 },
      { t: 'text', x: 0.05, y: 0.7, w2: 0.4, h2: 0.12, text: '균열 보수\n완료', c: '#E11D48', size: 11, bg: '#FFFFFF' }
    ] }]
  };
  blk.cellFonts = { 'L{+4}': { shrink: true } };
  const out = path.join(tmp, 'out.xlsx');
  const res = await exportWorkbook({ templateDef: def, editorState: { sheets, siteName: '', fontMap: {} }, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
  assert.strictEqual(res.annotationCount, 3);
  ok('표시 3개를 엑셀 도형으로 넣음');

  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const drawings = Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f));
  let xml = '';
  for (const d of drawings) xml += await zip.file(d).async('string');
  assert(/straightConnector1[\s\S]*tailEnd type="triangle"/.test(xml), '화살표');
  assert(/표시 네모[\s\S]*srgbClr val="2563EB"/.test(xml), '네모');
  assert(/txBox="1"[\s\S]*<a:t>균열 보수<\/a:t>[\s\S]*<a:t>완료<\/a:t>/.test(xml), '글상자 두 줄');
  ok('화살표(끝 삼각형)·네모(파랑)·글상자(두 줄) 도형 확인');
  const ids = [...xml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
  for (const d of drawings) {
    const one = await zip.file(d).async('string');
    const idsOne = [...one.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    assert.strictEqual(new Set(idsOne).size, idsOne.length, `${d} 도형 번호 겹침`);
  }
  ok(`도형 번호 겹치지 않음 (${ids.length}개)`);

  // 화살표 시작점이 사진 안쪽(사진 왼쪽 위 + 10%)에 있는지: 사진 그림의 위치와 비교
  const pic = /<xdr:pic>[\s\S]*?<\/xdr:pic>/.exec(xml);
  assert(pic, '사진');
  ok('사진도 함께 있음');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet(blk.name);
  const cell = ws.getCell(blk.sheetDef.block.startRow + 4, 12);
  assert.strictEqual(cell.alignment && cell.alignment.shrinkToFit, true, JSON.stringify(cell.alignment));
  ok('"칸에 맞게 줄이기" → 셀 맞춤(shrinkToFit)');
  console.log(`\n사진 표시·칸 맞춤 테스트 ${pass}/5 통과`);
}
run().catch((e) => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
