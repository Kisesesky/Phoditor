// [시트 이름 바꾸기 2026-11-25] 탭에서 바꾼 시트 이름이 내보낸 파일에 제대로 들어가는지 (실제 빈 양식 사용)
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

function stateFor(def, labels) {
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    const base = sDef.role === 'block'
      ? { name: sDef.name, role: 'block', sheetDef: sDef, repeatedValues: {}, blocks: [{ values: {}, extraCells: {}, photoAreas: {} }, { values: {}, extraCells: {}, photoAreas: {} }] }
      : { name: sDef.name, role: sDef.role, sheetDef: sDef, cells: {} };
    if (labels[sDef.name]) base.label = labels[sDef.name];
    sheets.push(base);
  }
  return { sheets, siteName: '' };
}

const sheetNames = (wbXml) => [...wbXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]);

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-rename-'));
  let pass = 0;
  const ok = (msg) => { pass++; console.log('  PASS:', msg); };

  // 1. 준공 롯데: 표지·목차·블록 시트 이름 바꾸기 + 두 시트 이름 맞바꾸기
  {
    const id = '준공사진첩_롯데';
    const def = loadDef(id);
    const labels = { 표지: '겉표지', 목차: '차례', 공간별전경: '가구공사', 가구공사: '공간별전경', 수장공사: "O'Neil & 수장" };
    const out = path.join(tmp, `${id}.xlsx`);
    const res = await exportWorkbook({ templateDef: def, editorState: stateFor(def, labels), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const names = sheetNames(wbXml);
    assert.deepStrictEqual(names.slice(0, 4), ['겉표지', '차례', '가구공사', '공간별전경'], names.join('|'));
    assert(names.includes("O'Neil &amp; 수장"), names.join('|'));
    assert(!names.includes('표지') && !names.includes('목차'), names.join('|'));
    assert.strictEqual(res.renamedSheets, 5);
    ok(`시트 목록 이름 바뀜 (5개, 맞바꾸기 포함): ${names.slice(0, 4).join(', ')}`);

    // 인쇄 영역 이름이 새 시트 이름을 가리키고, 원래 순서(시트 번호)와 맞는다
    const dns = [...wbXml.matchAll(/<definedName\b[^>]*name="_xlnm.Print_Area"[^>]*localSheetId="(\d+)"[^>]*>([^<]*)<\/definedName>|<definedName\b[^>]*localSheetId="(\d+)"[^>]*name="_xlnm.Print_Area"[^>]*>([^<]*)<\/definedName>/g)]
      .map((m) => ({ idx: Number(m[1] || m[3]), ref: (m[2] || m[4]).replace(/&apos;/g, "'").replace(/&amp;/g, '&') }));
    assert(dns.length >= 4, `print areas ${dns.length}`);
    for (const d of dns) {
      const nm = names[d.idx].replace(/&amp;/g, '&').replace(/'/g, "''");
      assert(d.ref.startsWith(`'${nm}'!`) || d.ref.startsWith(`${nm}!`), `${d.idx} ${names[d.idx]} ← ${d.ref}`);
      assert(!/'(표지|목차)'!/.test(d.ref), d.ref);
    }
    ok(`인쇄 영역 ${dns.length}개가 모두 바뀐 이름의 자기 시트를 가리킴`);

    const app = await zip.file('docProps/app.xml').async('string');
    assert(app.includes('<vt:lpstr>겉표지</vt:lpstr>') && !app.includes('<vt:lpstr>표지</vt:lpstr>'));
    ok('문서 속성(app.xml) 시트 이름도 바뀜');

    // ExcelJS로 다시 열어 시트 이름·내용 확인 (목차 수식 유지)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    assert.deepStrictEqual(wb.worksheets.slice(0, 2).map((w) => w.name), ['겉표지', '차례']);
    const toc = wb.getWorksheet('차례');
    assert.strictEqual(toc.getCell('B5').formula, 'B4+1');
    ok('다시 열면 이름이 그대로이고 목차 수식(=B4+1)도 유지');
  }

  // 2. 공용홀 롯데: 이름을 안 바꾸면 파일은 예전과 같은 이름
  {
    const id = '공용홀_롯데';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}.xlsx`);
    const res = await exportWorkbook({ templateDef: def, editorState: stateFor(def, {}), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const names = sheetNames(await zip.file('xl/workbook.xml').async('string'));
    assert.deepStrictEqual(names, ['갑지', '1.외관', '2.공용홀1층', '3.공용홀2층', '4.공용홀3층']);
    assert.strictEqual(res.renamedSheets, 0);
    ok('이름을 안 바꾸면 원래 시트 이름 그대로');
  }

  console.log(`\n시트 이름 바꾸기 테스트 ${pass}/5 통과`);
}

run().catch((e) => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
