// [2026-11-26] 시작 화면 양식 카드에 쓸 미리보기를 만든다.
//   data/thumbs/<양식 id>.png        표지(첫 시트) — 예전 이름 그대로
//   data/thumbs/<양식 id>/<n>.png    시트마다 첫 쪽(카드에서 ‹ › 로 넘겨 봄). 블록 시트는 블록 2개를 넣어 그린다
//   data/thumbs/index.json           { 양식 id: [{ sheet, file }] }
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
const manifest = {};
// 화면에만 있는 표시(입력 안내·파란 바탕·블록 테두리·사진 넣기 칸)는 미리보기에서 숨긴다(다시 그려도 유지되게 스타일로)
const hide = document.createElement('style');
hide.textContent = '.cover-hint{visibility:hidden!important} td.field-cell,td.editable-cell{background-image:none!important;box-shadow:none!important} .block-outline,.photo-area-empty>*{visibility:hidden!important} .photo-area-empty{border-color:transparent!important;background:none!important} td.repeated::before{content:none!important} .page-rail{display:none!important}';
document.head.appendChild(hide);
await waitFor(() => $$('#companyGrid .company-card').length > 0);
const ids = Object.values(state.catalog.available).map((x) => x.id);
const OUT = ${JSON.stringify(OUT)};
const snap = async (file) => {
  await waitFor(() => $('.pv-page'));
  await sleep(700);
  const r = $('.pv-page').getBoundingClientRect();
  console.log('__QA_RECT__:' + JSON.stringify({ file: OUT + '/' + file, x: r.left, y: r.top, w: r.width, h: Math.min(r.height, innerHeight - r.top), width: 360 }));
  await sleep(450);
};
for (const id of ids) {
  await openTemplate(id);
  await waitFor(() => $('.pv-page'));
  const list = [];
  const n = state.editor.sheets.length;
  for (let i = 0; i < n; i++) {
    state.activeSheetIdx = i;
    state.selectedBlockIdx = 0;
    const sh = state.editor.sheets[i];
    if (sh.role === 'block' && sh.blocks.length < 2) sh.blocks.push(createEmptyBlockData());
    renderSheetTabs();
    renderActiveSheet();
    await snap(id + '/' + i + '.png');
    if (i === 0) await snap(id + '.png');
    list.push({ sheet: sh.name, file: id + '/' + i + '.png' });
  }
  manifest[id] = list;
  made.push(id);
}
return { checks: [{ name: 'made', ok: made.length === ids.length, detail: made.length + '' }], confirms: [], manifest };
`;
const scen = path.join(work, 'thumbs.js');
fs.writeFileSync(scen, scenario);
fs.mkdirSync(OUT, { recursive: true });
const electron = path.join(APP, 'node_modules', '.bin', 'electron');
// 첫 쪽이 통째로 보이게 창을 세로로 길게
const r = spawnSync(electron, [path.join(APP, 'qa', 'harness.js'), APP, scen, path.join(work, 'out'), work, '1300', '1500'], { cwd: APP, encoding: 'utf-8' });
const rep = JSON.parse(fs.readFileSync(path.join(work, 'out', 'report.json'), 'utf-8'));
if (!rep.fatal && rep.result && rep.result.manifest) fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(rep.result.manifest, null, 1) + '\n');
console.log(rep.fatal || `양식 미리보기 ${rep.result.checks[0].detail}개(시트별 포함) → ${OUT}`);
process.exit(rep.fatal ? 1 : 0);
