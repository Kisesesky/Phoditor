// [회귀 테스트 2026-11-26] 작업 파일(.pbook) 저장·열기 왕복 + 실행 취소/다시 실행
// 1) .pbook에 사진·자른 사진·표시·글꼴·시트 이름·추가 시트가 그대로 들어갔다 나오는지
// 2) 같은 사진(다른 폴더 사본 포함)은 한 번만 저장되는지, 없는 원본은 세는지, 예전 JSON .pbook도 열리는지
// 3) 다시 연 작업으로 내보낸 엑셀이 원래 작업으로 내보낸 것과 같은지
// 4) 실행 취소 60단계 한도, 되돌리기/다시 하기 왕복, 새 기록이 다시 하기를 지우는지
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const JSZip = require('jszip');
const { writeProjectZip, readProjectFile } = require('./project');
const { deepClone, UndoHistory, serializeEditor, attachSheetDefs, transformAnnotations } = require('./docmodel');
const { exportWorkbook } = require('./export');

const DEFS = path.join(__dirname, 'data', 'templateDefs');
const BLANKS = path.join(__dirname, 'data', 'blanks');
const loadDef = (id) => JSON.parse(fs.readFileSync(path.join(DEFS, `${id}.templateDef.json`), 'utf-8'));

function jpeg(w, h, seed) {
  // sips로 작은 JPEG 만들기(맥 전용). 내용이 seed마다 다르게
  const { execFileSync } = require('child_process');
  const tmp = path.join(os.tmpdir(), `tpe-proj-src-${process.pid}-${seed}.png`);
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill((x * seed + y) & 255, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(tmp, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  const out = tmp.replace(/\.png$/, '.jpg');
  if (process.platform === 'darwin') execFileSync('sips', ['-s', 'format', 'jpeg', tmp, '--out', out], { stdio: 'pipe' });
  else fs.copyFileSync(tmp, out);
  return fs.readFileSync(out);
}

function editorFor(def) {
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    if (sDef.role === 'block') sheets.push({ name: sDef.name, role: 'block', sheetDef: sDef, visualKey: sDef.name, repeatedValues: {}, blocks: [{ values: {}, extraCells: {}, photoAreas: {} }] });
    else sheets.push({ name: sDef.name, role: sDef.role, sheetDef: sDef, visualKey: sDef.name, cells: {} });
  }
  return { sheets, siteName: '', fontMap: {} };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-proj-'));
  let pass = 0;
  const ok = (m) => { pass++; console.log('  PASS:', m); };
  const def = loadDef('공용홀_롯데');

  // --- 사진 준비: A(폴더1), A 사본(폴더2, 같은 내용), B, 없는 파일 ---
  fs.mkdirSync(path.join(tmp, 'd1'));
  fs.mkdirSync(path.join(tmp, 'd2'));
  const A = path.join(tmp, 'd1', 'a.jpg');
  const A2 = path.join(tmp, 'd2', 'a_copy.jpg');
  const B = path.join(tmp, 'd1', 'b.jpg');
  const bufA = jpeg(320, 240, 3);
  fs.writeFileSync(A, bufA);
  fs.writeFileSync(A2, bufA);
  fs.writeFileSync(B, jpeg(200, 300, 7));
  const gone = path.join(tmp, 'd1', 'deleted.jpg');

  // --- 작업 상태 만들기 ---
  const ed = editorFor(def);
  ed.siteName = '왕복 테스트 현장';
  ed.fontMap = { 'Spoqa Han Sans Neo Regular': '나눔고딕' };
  const cover = ed.sheets.find((s) => s.role === 'cover');
  cover.cells.B5 = '표지 글자';
  cover.cellFonts = { B5: { name: 'Pretendard', size: 18, bold: true } };
  cover.label = '겉표지';
  const blk = ed.sheets.find((s) => s.role === 'block');
  blk.repeatedValues['L{+2}'] = '1층 로비';
  blk.headerValues = { E2: '2026. 11.' };
  blk.blocks = [0, 1, 2].map((i) => ({ values: { 'L{+4}': `품목 ${i + 1}` }, extraCells: {}, photoAreas: {} }));
  const cropB64 = jpeg(120, 90, 11).toString('base64');
  blk.blocks[0].photoAreas[0] = { layout: '2x2', slots: [
    { name: 'a.jpg', path: A, thumbUrl: 'file:///tmp/x.jpg', previewUrl: 'file:///tmp/y.jpg' },
    { name: 'a_copy.jpg', path: A2 },
    { name: '[편집] b.jpg', path: B, isCropped: true, croppedDataBase64: cropB64, croppedKey: 'k1', croppedWidth: 120, croppedHeight: 90, cropRect: { x: 1, y: 2, w: 120, h: 90 }, rotation: 90,
      annotations: [{ t: 'arrow', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, c: '#E11D48', w: 3 }, { t: 'text', x: 0.2, y: 0.6, w2: 0.3, h2: 0.1, text: '균열\n보수', c: '#2563EB', size: 11, bg: '#FFFFFF' }] },
    { name: 'deleted.jpg', path: gone }
  ] };
  blk.blocks[1].photoAreas[0] = { layout: '1x1', slots: [{ name: 'a.jpg', path: A }] };
  // 추가한 시트(정의서 사본)
  const added = { ...deepClone(blk), name: '5.추가시트', clonedFrom: blk.name, sheetDef: { ...deepClone(blk.sheetDef), name: '5.추가시트' } };
  ed.sheets.push(added);

  // --- 저장 ---
  const data = { format: 'photobook', version: 1, templateId: def.id, templateVersion: def.version, title: '왕복', savedAt: new Date().toISOString(), activeSheetIdx: 1, editor: serializeEditor(ed, def) };
  assert(!JSON.stringify(data.editor).includes('previewUrl'), '미리보기 주소는 저장하지 않음');
  assert(data.editor.sheets[0].defName === cover.name && !data.editor.sheets[0].sheetDef, '정의서 시트는 이름만');
  assert(data.editor.sheets[data.editor.sheets.length - 1].sheetDef, '추가 시트는 정의서 사본 보관');
  const file = path.join(tmp, '왕복.pbook');
  const stats = await writeProjectZip(file, data);
  assert.deepStrictEqual([stats.photos, stats.edits, stats.missing], [2, 1, 1], JSON.stringify(stats));
  ok(`저장: 사진 2장(같은 사진 3번·다른 폴더 사본은 1장으로), 편집본 1장, 없는 원본 1장 (${(stats.sizeBytes / 1024).toFixed(0)}KB)`);
  assert(data.editor.sheets.find((s) => s.role === 'block').blocks[0].photoAreas[0].slots[0].path === A, '저장해도 원래 작업 상태는 그대로');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter((n) => !n.endsWith('/'));
  assert.strictEqual(names.filter((n) => n.startsWith('photos/')).length, 2);
  assert.strictEqual(names.filter((n) => n.startsWith('edits/')).length, 1);
  assert(names.includes('project.json'));
  const pj = await zip.file('project.json').async('string');
  assert(!pj.includes(cropB64.slice(0, 200)) && !pj.includes('thumbUrl'), 'project.json에는 사진 데이터·썸네일 주소가 없음');
  ok('파일 구성: project.json + photos/2 + edits/1, JSON에 사진 데이터 없음');

  // --- 원본 폴더가 사라져도 열린다 ---
  fs.renameSync(path.join(tmp, 'd1'), path.join(tmp, 'd1_moved'));
  fs.renameSync(path.join(tmp, 'd2'), path.join(tmp, 'd2_moved'));
  const back = await readProjectFile(file, path.join(tmp, 'extract'));
  const ed2 = attachSheetDefs(back.editor, def);
  const blk2 = ed2.sheets.find((s) => s.name === blk.name);
  const slots = blk2.blocks[0].photoAreas[0].slots;
  assert(fs.existsSync(slots[0].path) && fs.readFileSync(slots[0].path).equals(bufA), '사진 A 풀림');
  assert.strictEqual(slots[0].path, slots[1].path, '같은 내용은 같은 파일로');
  assert.strictEqual(slots[0].originalPath, A);
  assert.strictEqual(slots[1].originalPath, A2);
  assert.strictEqual(slots[2].croppedDataBase64, cropB64, '편집본 그대로');
  assert.deepStrictEqual(slots[2].annotations, blk.blocks[0].photoAreas[0].slots[2].annotations, '사진 위 표시 그대로');
  assert.deepStrictEqual([slots[2].rotation, slots[2].cropRect], [90, { x: 1, y: 2, w: 120, h: 90 }]);
  assert.strictEqual(slots[3].path, gone, '없던 원본은 원래 경로를 기억');
  ok('원래 사진 폴더를 옮겨도 사진이 파일 안에서 풀려 나옴(원래 경로·자르기·돌리기·표시 유지)');

  const strip = (e) => JSON.parse(JSON.stringify(e, (k, v) => (['sheetDef', 'path', 'thumbUrl', 'previewUrl', 'originalPath'].includes(k) ? undefined : v)));
  assert.deepStrictEqual(strip(ed2), strip(ed), '사진 경로 말고는 작업 상태가 똑같음');
  assert.strictEqual(ed2.sheets[0].label, '겉표지');
  assert.strictEqual(ed2.sheets[ed2.sheets.length - 1].sheetDef.name, '5.추가시트');
  assert.strictEqual(ed2.sheets[0].sheetDef, def.sheets.find((d) => d.name === cover.name), '정의서 시트에 다시 연결');
  ok('글자·반복값·머리 행·칸 글꼴·문서 글꼴·시트 이름·추가 시트까지 왕복 후 같음');

  // --- 다시 연 작업으로 내보낸 엑셀 = 원래 작업으로 내보낸 엑셀 ---
  fs.renameSync(path.join(tmp, 'd1_moved'), path.join(tmp, 'd1'));
  fs.renameSync(path.join(tmp, 'd2_moved'), path.join(tmp, 'd2'));
  const o1 = path.join(tmp, 'o1.xlsx');
  const o2 = path.join(tmp, 'o2.xlsx');
  const r1 = await exportWorkbook({ templateDef: def, editorState: ed, blankXlsxPath: path.join(BLANKS, `${def.id}.xlsx`), outputPath: o1 });
  const r2 = await exportWorkbook({ templateDef: def, editorState: ed2, blankXlsxPath: path.join(BLANKS, `${def.id}.xlsx`), outputPath: o2 });
  assert.deepStrictEqual([r2.totalPhotoPlacements, r2.uniqueImagesEmbedded, r2.annotationCount, r2.renamedSheets], [r1.totalPhotoPlacements, r1.uniqueImagesEmbedded, r1.annotationCount, r1.renamedSheets]);
  const z1 = await JSZip.loadAsync(fs.readFileSync(o1));
  const z2 = await JSZip.loadAsync(fs.readFileSync(o2));
  for (const n of Object.keys(z1.files).filter((x) => /^xl\/(worksheets|drawings)\/[^/]+\.xml$/.test(x) || x === 'xl/workbook.xml' || x === 'xl/sharedStrings.xml')) {
    assert.strictEqual(await z2.file(n).async('string'), await z1.file(n).async('string'), `${n} 다름`);
  }
  ok(`다시 연 작업으로 내보낸 엑셀이 원래와 같음 (사진 ${r1.totalPhotoPlacements}곳·표시 ${r1.annotationCount}개·시트 이름 ${r1.renamedSheets}개)`);

  // --- 예전(JSON만) .pbook ---
  const old = path.join(tmp, 'old.pbook');
  fs.writeFileSync(old, JSON.stringify(data));
  const oldBack = await readProjectFile(old, path.join(tmp, 'extract'));
  assert.strictEqual(oldBack.editor.sheets.length, ed.sheets.length);
  ok('예전 JSON 형식 .pbook도 열림');

  // --- 실행 취소 ---
  const h = new UndoHistory(60);
  let cur = deepClone(ed);
  const states = [deepClone(cur)];
  const ops = [
    (e) => e.sheets[1].blocks.push({ values: {}, extraCells: {}, photoAreas: {} }),
    (e) => { e.sheets[1].blocks[0].values['L{+4}'] = '바꾼 품목'; },
    (e) => { e.sheets[1].blocks[1].photoAreas[0].slots[0] = null; },
    (e) => { const [b] = e.sheets[1].blocks.splice(0, 1); e.sheets[1].blocks.splice(1, 0, b); },
    (e) => { e.sheets[1].blocks.splice(2, 1); },
    (e) => { e.fontMap['맑은 고딕'] = '궁서'; },
    (e) => { e.sheets[0].label = '새 표지'; }
  ];
  for (const op of ops) {
    h.record(cur, { label: 'op' });
    op(cur);
    states.push(deepClone(cur));
  }
  for (let i = ops.length - 1; i >= 0; i--) {
    const snap = h.undo(cur, {});
    cur = snap.editor;
    assert.deepStrictEqual(strip(cur), strip(states[i]), `되돌리기 ${i}`);
  }
  assert.strictEqual(h.undo(cur, {}), null, '더 되돌릴 것 없음');
  for (let i = 1; i <= ops.length; i++) {
    const snap = h.redo(cur, {});
    cur = snap.editor;
    assert.deepStrictEqual(strip(cur), strip(states[i]), `다시 하기 ${i}`);
  }
  ok(`작업 ${ops.length}개(블록 추가·입력·사진 빼기·이동·삭제·글꼴·이름)를 모두 되돌리고 다시 해도 단계마다 같음`);

  h.undo(cur, {});
  h.record(cur, { label: 'new' });
  assert.strictEqual(h.canRedo, false, '새로 바꾸면 다시 하기는 사라짐');
  const snapA = h.undoStack[h.undoStack.length - 1].editor;
  assert.strictEqual(snapA.sheets[1].sheetDef, cur.sheets[1].sheetDef, '정의서는 같은 객체를 씀(메모리)');
  assert.notStrictEqual(snapA.sheets[1].blocks, cur.sheets[1].blocks, '블록은 따로 복사');
  ok('새로 바꾸면 다시 하기 목록이 비고, 기록은 정의서를 공유하고 나머지는 복사');

  const h2 = new UndoHistory(60);
  const e3 = { sheets: [], n: 0 };
  for (let i = 0; i < 75; i++) { h2.record(e3, { label: `#${i}` }); e3.n++; }
  let count = 0;
  let c3 = e3;
  for (;;) { const s = h2.undo(c3, {}); if (!s) break; c3 = s.editor; count++; }
  assert.strictEqual(count, 60);
  assert.strictEqual(c3.n, 15, '가장 오래된 15단계는 버림');
  ok('실행 취소는 60단계까지(75번 바꾸면 처음 15단계는 버림)');

  // --- 사진 위 표시: 돌리기·다시 자르기에 따라 옮겨지는지 ---
  {
    const full = { x: 0, y: 0, w: 400, h: 300 };
    const items = [
      { t: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.5, c: '#E11D48', w: 3 },
      { t: 'box', x: 0.6, y: 0.1, w2: 0.2, h2: 0.3, c: '#2563EB', w: 2 },
      { t: 'text', x: 0.1, y: 0.7, w2: 0.3, h2: 0.1, text: 'A', c: '#000', size: 10 }
    ];
    let cur2 = items;
    for (let k = 0; k < 4; k++) cur2 = transformAnnotations(cur2, { rect: full, rot: k * 90 }, { rect: full, rot: (k + 1) * 90 });
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    assert(cur2.every((a, i) => Object.keys(items[i]).every((k) => typeof items[i][k] !== 'number' || close(a[k], items[i][k]))), '네 번 돌리면 제자리');
    const r90 = transformAnnotations(items, { rect: full, rot: 0 }, { rect: full, rot: 90 });
    assert(close(r90[0].x1, 0.8) && close(r90[0].y1, 0.1), '90° 돌리면 (x,y) → (1-y, x)');
    assert(close(r90[2].w2, 0.4) && close(r90[2].h2, 0.075), '글상자는 바로 선 채 크기(픽셀) 유지');
    const crop = transformAnnotations(items, { rect: full, rot: 0 }, { rect: { x: 0, y: 0, w: 200, h: 300 }, rot: 0 });
    assert.strictEqual(crop.length, 2, '잘린 영역 밖으로 나간 네모는 빠짐');
    assert(close(crop[0].x1, 0.2) && close(crop[0].x2, 1), '자른 영역 기준으로 다시 계산');
    ok('사진 위 표시: 90°씩 네 번 돌리면 제자리, 다시 자르면 새 영역 기준으로 옮기고 밖으로 나간 것은 뺌');
  }

  console.log(`\n작업 파일·실행 취소 테스트 ${pass}/10 통과`);
}
run().catch((e) => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
