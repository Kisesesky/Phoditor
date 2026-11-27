// [2026-11-26] 긴 글 줄바꿈 · 사진 칸 높이 · 공백 양식 내보내기
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const ExcelJS = require('exceljs');
const { exportWorkbook, computeSlotPlacement } = require('./export');
const { photoRowOffsets, clampPhotoScale, LAYOUT_SPANS } = require('./docmodel');

const DEFS = path.join(__dirname, 'data', 'templateDefs');
const BLANKS = path.join(__dirname, 'data', 'blanks');
const loadDef = (id) => JSON.parse(fs.readFileSync(path.join(DEFS, `${id}.templateDef.json`), 'utf-8'));
function stateFor(def, blocks = 2) {
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    if (sDef.role === 'block') sheets.push({ name: sDef.name, role: 'block', sheetDef: sDef, repeatedValues: {}, blocks: Array.from({ length: blocks }, () => ({ values: {}, extraCells: {}, photoAreas: {} })) });
    else sheets.push({ name: sDef.name, role: sDef.role, sheetDef: sDef, cells: {} });
  }
  return { sheets, siteName: '', fontMap: {} };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phoditor-layout-'));
  let pass = 0;
  const ok = (m) => { pass++; console.log('  PASS:', m); };
  const LONG = '거실 창호 하부 실리콘 마감 상태 확인 및 보수 완료, 우측 몰딩 이음부 재시공';

  // 1. 공백 양식: 파일·정의서가 있고 표지 3칸 + 블록 7행
  const gid = '공백_기본';
  const gdef = loadDef(gid);
  assert(fs.existsSync(path.join(BLANKS, `${gid}.xlsx`)));
  assert.strictEqual(gdef.generic, true);
  assert.strictEqual(gdef.verified, false, '만든 양식은 사람 확인 전');
  assert.deepStrictEqual(gdef.sheets.map((s) => s.role), ['cover', 'block']);
  ok('공백 양식 빈 파일·정의서(표지+블록, 회사 표시 없음, 확인 전 상태)');

  // 2. 긴 글은 줄바꿈으로, 짧은 글·원래 글자는 그대로 / 끄면 줄바꿈 없음
  {
    const st = stateFor(gdef, 3);
    const cover = st.sheets[0];
    cover.cells = { A8: '부천 상동 현장', A14: LONG };
    const blk = st.sheets[1];
    blk.blocks[0].values = { 'H{+1}': '거실', 'H{+4}': LONG };
    blk.blocks[1].values = { 'H{+2}': LONG };
    blk.cellFonts = { 'H{+2}': { wrap: false } };
    blk.photoScale = 1.2;
    const out = path.join(tmp, 'generic.xlsx');
    await exportWorkbook({ templateDef: gdef, editorState: st, blankXlsxPath: path.join(BLANKS, `${gid}.xlsx`), outputPath: out });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const cws = wb.getWorksheet('표지');
    assert.strictEqual(cws.getCell('A14').value, LONG);
    assert.strictEqual(cws.getCell('A14').alignment.wrapText, true);
    const ws = wb.getWorksheet('사진');
    assert.strictEqual(ws.getCell('H5').value, LONG);
    assert.strictEqual(ws.getCell('H5').alignment.wrapText, true, '블록 1 내용칸 줄바꿈');
    assert.strictEqual(ws.getCell('H10').value, LONG);
    assert.ok(!ws.getCell('H10').alignment || !ws.getCell('H10').alignment.wrapText, '줄바꿈 끈 칸(블록 2 공종)은 줄바꿈 없음');
    assert.ok(!ws.getCell('H3').alignment.wrapText, '칸 설정은 모든 블록의 같은 칸에 같이 적용(블록 1 공종)');
    assert.strictEqual(ws.getCell('H4').alignment.wrapText, true, '끄지 않은 품목칸은 양식대로 줄바꿈');
    assert.strictEqual(ws.getCell('G1').value, 'NO.');
    ok('긴 글 줄바꿈: 표지·블록 칸은 줄바꿈, [줄바꿈 끔] 칸은 그대로');

    // 3. 사진 칸 높이 120%: 사진 영역 행(이 양식은 블록 7행 전부)만 1.2배, 모든 블록
    const rows = gdef.sheets[1].block.rowHeights;
    for (let b = 0; b < 3; b++) {
      for (let i = 0; i < 7; i++) {
        const got = ws.getRow(1 + b * 7 + i).height;
        assert(Math.abs(got - rows[i] * 1.2) < 0.05, `블록 ${b + 1} ${i}행 높이 ${got} ≠ ${rows[i] * 1.2}`);
      }
    }
    ok('사진 칸 높이 120% → 모든 블록의 사진 행이 1.2배');
  }

  // 4. 사진 영역이 일부 행만인 양식(롯데 공용홀 D{+2}:G{+21}): 사진 행만 바뀌고 나머지 행은 그대로
  {
    const id = '공용홀_롯데';
    const def = loadDef(id);
    const st = stateFor(def, 2);
    const blk = st.sheets.find((s) => s.role === 'block');
    blk.photoScale = 0.8;
    const out = path.join(tmp, `${id}.xlsx`);
    const outBase = path.join(tmp, `${id}_base.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: st, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const st0 = stateFor(def, 2);
    await exportWorkbook({ templateDef: def, editorState: st0, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: outBase });
    const [a, b] = [new ExcelJS.Workbook(), new ExcelJS.Workbook()];
    await a.xlsx.readFile(out);
    await b.xlsx.readFile(outBase);
    const bd = blk.sheetDef.block;
    const photoRows = photoRowOffsets(bd);
    assert.deepStrictEqual([...photoRows].sort((x, y) => x - y)[0], 2);
    let scaled = 0;
    let same = 0;
    for (let r = 0; r < bd.rows; r++) {
      const h1 = a.getWorksheet(blk.name).getRow(bd.startRow + r).height || 15;
      const h0 = b.getWorksheet(blk.name).getRow(bd.startRow + r).height || 15;
      if (photoRows.has(r)) { assert(Math.abs(h1 - h0 * 0.8) < 0.05, `${r}행 ${h1} vs ${h0}`); scaled++; } else { assert.strictEqual(h1, h0); same++; }
    }
    ok(`롯데 공용홀 80%: 사진 행 ${scaled}개만 0.8배, 나머지 ${same}개 그대로`);
  }

  // 5. 비율 범위
  assert.strictEqual(clampPhotoScale(5), 1.8);
  assert.strictEqual(clampPhotoScale(0.1), 0.6);
  assert.strictEqual(clampPhotoScale(undefined), 1);
  assert.strictEqual(clampPhotoScale(1.234), 1.23);
  ok('사진 칸 높이 범위 60~180%');

  // 6. [2026-11-27] 큰 사진 섞인 배치: 자리 크기·위치(내보내기 계산)
  {
    const area = { x: 0, y: 0, width: 900, height: 600 };
    const slot = (k, i) => computeSlotPlacement(area, k, i, 1, 1);
    assert.strictEqual(LAYOUT_SPANS.L12.count, 3);
    assert.strictEqual(slot('L12', 0).slotW, 600); assert.strictEqual(slot('L12', 0).slotH, 600); // 왼쪽 2/3 × 전체 높이
    assert.strictEqual(slot('L12', 1).slotX, 600); assert.strictEqual(slot('L12', 2).slotY, 300); // 오른쪽 위·아래
    assert.strictEqual(slot('L13', 3).slotH, 200); assert.strictEqual(slot('L13', 3).slotY, 400);
    assert.strictEqual(slot('T13', 0).slotW, 900); assert.strictEqual(slot('T13', 0).slotH, 400); // 위쪽 전체 폭 × 2/3 높이
    assert.strictEqual(slot('T13', 2).slotX, 300); assert.strictEqual(slot('T13', 2).slotY, 400);
    assert.strictEqual(LAYOUT_SPANS.T23.count, 5);
    assert.strictEqual(slot('T23', 1).slotX, 450); assert.strictEqual(slot('T23', 1).slotW, 450);
    assert.strictEqual(slot('T23', 4).slotX, 600); assert.strictEqual(slot('T23', 4).slotW, 300);
    // 어떤 배치든 자리들이 겹치지 않고 영역을 꼭 채움(넓이 합 = 영역)
    for (const [k, sp] of Object.entries(LAYOUT_SPANS)) {
      let sum = 0;
      for (let i = 0; i < sp.count; i++) { const q = slot(k, i); sum += q.slotW * q.slotH; }
      assert.ok(Math.abs(sum - 900 * 600) < 1, `${k} 넓이 합 ${sum}`);
    }
    // 기존 격자 배치는 그대로
    assert.strictEqual(slot('2x2', 3).slotX, 450); assert.strictEqual(slot('2x2', 3).slotY, 300);
    ok('큰 사진 섞인 배치 4가지: 자리 위치·크기, 빈틈·겹침 없음, 기존 격자 그대로');
  }

  console.log(`배치·줄바꿈 테스트 ${pass}/${pass} 통과`);
}

run().catch((e) => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
