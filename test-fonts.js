// [글꼴 선택 2026-11-25] 문서 글꼴 바꾸기·칸별 글꼴이 내보낸 파일에 들어가는지 (실제 빈 양식)
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
function stateFor(def, blocks = 2) {
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    if (sDef.role === 'block') sheets.push({ name: sDef.name, role: 'block', sheetDef: sDef, repeatedValues: {}, blocks: Array.from({ length: blocks }, () => ({ values: {}, extraCells: {}, photoAreas: {} })) });
    else sheets.push({ name: sDef.name, role: sDef.role, sheetDef: sDef, cells: {} });
  }
  return { sheets, siteName: '', fontMap: {} };
}
const firstFont = (styles) => /<fonts\b[^>]*>\s*<font>([\s\S]*?)<\/font>/.exec(styles)[1];

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-fonts-'));
  let pass = 0;
  const ok = (m) => { pass++; console.log('  PASS:', m); };

  // 1. 준공 아크로: 맑은 고딕 → 나눔고딕(문서 전체), HY울릉도L → 나눔스퀘어OTF(머리말 포함)
  {
    const id = '준공사진첩_아크로';
    const def = loadDef(id);
    const st = stateFor(def);
    st.fontMap = { '맑은 고딕': '나눔고딕', HY울릉도L: '나눔스퀘어OTF' };
    // 표지 B5 칸만 Pretendard 20pt 굵게, 첫 블록 시트 블록 칸 B{+0}은 궁서
    const cover = st.sheets.find((s) => s.role === 'cover');
    cover.cellFonts = { B5: { name: 'Pretendard', size: 20, bold: true } };
    const blk = st.sheets.find((s) => s.role === 'block');
    blk.cellFonts = { 'A{+0}': { name: '궁서' } };
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: st, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const blankZip = await JSZip.loadAsync(fs.readFileSync(path.join(BLANKS, `${id}.xlsx`)));
    const styles = await zip.file('xl/styles.xml').async('string');
    assert.strictEqual(firstFont(styles), firstFont(await blankZip.file('xl/styles.xml').async('string')), '기본 글꼴(열 너비 기준)은 빈 양식 그대로');
    ok('기본 글꼴은 빈 양식 그대로(열 너비가 바뀌지 않음)');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    let malgun = 0;
    let nanum = 0;
    wb.eachSheet((ws) => ws.eachRow({ includeEmpty: true }, (r) => r.eachCell({ includeEmpty: true }, (c) => {
      const n = c.font && c.font.name;
      if (n === '맑은 고딕') malgun++;
      if (n === '나눔고딕') nanum++;
    })));
    assert.strictEqual(malgun, 0, `맑은 고딕이 ${malgun}칸 남음`);
    assert(nanum > 0);
    ok(`문서 전체 맑은 고딕 → 나눔고딕 (${nanum}칸, 남은 칸 0)`);
    const c5 = wb.getWorksheet(cover.name).getCell('B5');
    assert.deepStrictEqual([c5.font.name, c5.font.size, c5.font.bold], ['Pretendard', 20, true]);
    ok('표지 B5 칸만 Pretendard 20pt 굵게');
    const bws = wb.getWorksheet(blk.name);
    const start = blk.sheetDef.block.startRow;
    const rows = blk.sheetDef.block.rows;
    assert.strictEqual(bws.getCell(start, 1).font.name, '궁서');
    assert.strictEqual(bws.getCell(start + rows, 1).font.name, '궁서', '두 번째 블록의 같은 칸도');
    ok('블록 칸 글꼴은 모든 블록의 같은 칸에 들어감');
    const hfs = [];
    wb.eachSheet((ws) => hfs.push(JSON.stringify(ws.headerFooter || {})));
    assert(!hfs.join('').includes('HY울릉도L') && hfs.join('').includes('나눔스퀘어OTF'), hfs.join(' ').slice(0, 300));
    ok('머리말·바닥글 글꼴도 바뀜(HY울릉도L → 나눔스퀘어OTF)');
  }

  // 2. 글꼴을 안 바꾸면 그대로
  {
    const id = '공용홀_롯데';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const names = new Set();
    wb.eachSheet((ws) => ws.eachRow({ includeEmpty: true }, (r) => r.eachCell({ includeEmpty: true }, (c) => c.font && c.font.name && names.add(c.font.name))));
    assert(names.has('Spoqa Han Sans Neo Regular'), [...names].join(','));
    ok(`바꾸지 않으면 원래 글꼴 그대로 (${[...names].slice(0, 4).join(', ')} …)`);
  }
  console.log(`\n글꼴 내보내기 테스트 ${pass}/6 통과`);
}
run().catch((e) => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
