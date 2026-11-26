// [2026-11-26] 시작 화면 업체 카드에 쓸 "표지 미리보기"를 만든다: data/thumbs/<양식 id>.png (폭 240px)
// 앱을 실제로 띄워 쪽 보기로 그린 첫 쪽을 잘라 저장한다. 양식(빈 양식·정의서)이 바뀌면 다시 돌린다.
//   node tools/make-cover-thumbs.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'data', 'thumbs');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phoditor-thumbs-'));
const scenario = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } return null; };
window.confirm = () => false;
const made = [];
// 화면에만 있는 표시(입력 안내·파란 바탕·블록 테두리·사진 넣기 칸)는 미리보기에서 숨긴다(다시 그려도 유지되게 스타일로)
const hide = document.createElement('style');
hide.textContent = '.cover-hint{visibility:hidden!important} td.field-cell,td.editable-cell{background-image:none!important;box-shadow:none!important} .block-outline,.photo-area-empty>*{visibility:hidden!important} .photo-area-empty{border-color:transparent!important;background:none!important}';
document.head.appendChild(hide);
await waitFor(() => $$('#companyGrid .company-card').length > 0);
const ids = Object.values(state.catalog.available).map((x) => x.id);
for (const id of ids) {
  if ($('#editorView').classList.contains('active')) { $('#backToCatalogBtn').click(); await sleep(400); }
  await openTemplate(id);
  await waitFor(() => $('.pv-page'));
  await sleep(700);
  const r = $('.pv-page').getBoundingClientRect();
  console.log('__QA_RECT__:' + JSON.stringify({ file: ${JSON.stringify(OUT)} + '/' + id + '.png', x: r.left, y: r.top, w: r.width, h: Math.min(r.height, innerHeight - r.top), width: 240 }));
  await sleep(500);
  made.push(id);
}
return { checks: [{ name: 'made', ok: made.length === ids.length, detail: made.length + '' }], confirms: [] };
`;
const scen = path.join(work, 'thumbs.js');
fs.writeFileSync(scen, scenario);
fs.mkdirSync(OUT, { recursive: true });
const electron = path.join(APP, 'node_modules', '.bin', 'electron');
// 첫 쪽이 통째로 보이게 창을 세로로 길게
const r = spawnSync(electron, [path.join(APP, 'qa', 'harness.js'), APP, scen, path.join(work, 'out'), work, '1300', '1500'], { cwd: APP, encoding: 'utf-8' });
const rep = JSON.parse(fs.readFileSync(path.join(work, 'out', 'report.json'), 'utf-8'));
console.log(rep.fatal || `표지 미리보기 ${rep.result.checks[0].detail}개 → ${OUT}`);
process.exit(rep.fatal ? 1 : 0);
