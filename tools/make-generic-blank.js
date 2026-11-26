// [2026-11-26] "공백 양식"(어느 회사 것도 아닌 기본 사진첩)을 만든다.
//   node tools/make-generic-blank.js
// 만드는 것: data/blanks/공백_기본.xlsx + data/templateDefs/공백_기본.templateDef.json
// 표지 1장(현장명·제목·타입·날짜) + 사진 시트 1장(블록 = 왼쪽 사진 칸 + 오른쪽 NO.·위치·공종·품목·내용·일자·비고).
// A4 세로, 한 쪽에 블록 2개. 회사 이름·로고·현장 내용은 넣지 않는다(빈 칸으로 둔다).
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const APP = path.resolve(__dirname, '..');
const ID = '공백_기본';
const XLSX = path.join(APP, 'data', 'blanks', `${ID}.xlsx`);
const DEF = path.join(APP, 'data', 'templateDefs', `${ID}.templateDef.json`);

const FONT = '맑은 고딕';
const thin = { style: 'thin', color: { argb: 'FF808080' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const COLS = [9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 8, 26]; // A~F 사진, G 항목, H 내용
const ROW_H = [27.5, 27.5, 27.5, 27.5, 195, 27.5, 27.5];
const LABELS = ['NO.', '위치', '공종', '품목', '내용', '일자', '비고'];

function pageSetup(ws, lastRow, extra = {}) {
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.55, bottom: 0.55, header: 0.25, footer: 0.25 },
    printArea: `A1:H${lastRow}`,
    ...extra
  };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Phoditor';

  // --- 표지 ---
  const cov = wb.addWorksheet('표지');
  COLS.forEach((w, i) => { cov.getColumn(i + 1).width = w; });
  for (let r = 1; r <= 40; r++) cov.getRow(r).height = 20;
  const line = (row, height, size, bold, value) => {
    cov.mergeCells(`A${row}:H${row}`);
    cov.getRow(row).height = height;
    const c = cov.getCell(`A${row}`);
    c.value = value || null;
    c.font = { name: FONT, size, bold };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  };
  line(8, 48, 26, true, null); // 현장명
  line(11, 60, 36, true, '사진첩'); // 제목(고쳐 쓸 수 있음)
  line(14, 34, 18, false, null); // 타입·공종
  line(30, 26, 14, false, null); // 날짜
  pageSetup(cov, 40, { fitToPage: true, fitToWidth: 1, fitToHeight: 1 });

  // --- 사진 시트 (블록 1개만 둔다. 앱이 블록을 늘린다) ---
  const ws = wb.addWorksheet('사진');
  COLS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ROW_H.forEach((h, i) => { ws.getRow(i + 1).height = h; });
  ws.mergeCells('A1:F7');
  ws.getCell('A1').border = box;
  for (let r = 1; r <= 7; r++) {
    const lab = ws.getCell(`G${r}`);
    lab.value = LABELS[r - 1];
    lab.font = { name: FONT, size: 10, bold: true };
    lab.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    lab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    lab.border = box;
    const val = ws.getCell(`H${r}`);
    val.font = { name: FONT, size: 10 };
    val.alignment = { horizontal: r === 1 ? 'center' : 'left', vertical: r === 5 ? 'top' : 'middle', wrapText: true, indent: r === 1 ? 0 : 1 };
    val.border = box;
  }
  ws.getCell('H1').value = 1;
  pageSetup(ws, 7, { fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
  ws.headerFooter = { oddFooter: '&C&"맑은 고딕"&9&P / &N' };

  fs.mkdirSync(path.dirname(XLSX), { recursive: true });
  await wb.xlsx.writeFile(XLSX);

  const def = {
    id: ID,
    version: 1,
    status: 'draft',
    verified: false,
    type: '공백',
    company: '공백 양식',
    generic: true,
    title: '공백 양식',
    description: '어느 회사 것도 아닌 기본 사진첩. 새 현장이 생기면 여기서 시작해 [내 양식으로 저장]으로 다시 쓸 수 있어요.',
    source: { generatedBy: 'tools/make-generic-blank.js' },
    blockSheetsShareLayout: true,
    exceptions: [],
    keepImages: [],
    decisionsPending: [],
    autoVerifyIssues: [],
    schemaVersion: 'v0.6-D13',
    headerSiteNamePlaceholder: false,
    sheets: [
      {
        name: '표지',
        state: 'visible',
        role: 'cover',
        coverFields: [
          { cell: 'A8', kind: 'siteName', current: '' },
          { cell: 'A14', kind: 'unitType', current: '' },
          { cell: 'A30', kind: 'date', current: '' }
        ],
        print: { printArea: "'표지'!$A$1:$H$40", fitToPage: true, paperSize: '9', pageBreakRule: 'none' }
      },
      {
        name: '사진',
        state: 'visible',
        role: 'block',
        block: {
          startRow: 1,
          rows: 7,
          itemsPerBlock: 1,
          itemRowOffset: null,
          rowHeights: ROW_H,
          repeatedValues: [],
          labels: LABELS.map((text, i) => ({ cell: `G{+${i}}`, text, item: 0 })),
          values: LABELS.slice(1).map((label, i) => ({ cell: `H{+${i + 1}}`, label, item: 0 })),
          numbering: { cell: 'H{+0}', kind: 'chain', firstValue: 1, scope: 'sheet' },
          photoAreas: [{ area: 'A{+0}:F{+6}', item: 0, maxPhotos: 4 }],
          addUnit: 'block',
          gapRows: 0,
          footer: { present: false, cells: [] }
        },
        print: { printArea: "'사진'!$A$1:$H$7", fitToPage: true, paperSize: '9', pageBreakRule: 'everyNBlocks', blocksPerPrintedPage: 2 }
      }
    ]
  };
  fs.writeFileSync(DEF, JSON.stringify(def, null, 2) + '\n');
  console.log(`공백 양식 → ${path.relative(APP, XLSX)}, ${path.relative(APP, DEF)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
