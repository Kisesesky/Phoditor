// [renderer/12-ribbon.js] 리본(PowerPoint처럼): 홈 · 사진 · 서식 · 보기 (2026-11-26)
// 원칙: 모든 일은 리본에 있다. 속성 패널은 고른 것의 설정, 오른쪽 클릭은 바로 가기. 그 밖에는 같은 단추를 두지 않는다.
'use strict';

const $id = (id) => document.getElementById(id);
const ribbonUi = { tab: 'home' };

function setRibbonTab(tab) {
  ribbonUi.tab = tab;
  for (const b of $id('ribbonTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of $id('ribbon').querySelectorAll('.rb-panel')) p.classList.toggle('on', p.dataset.tab === tab);
  if ($id('ribbon').classList.contains('collapsed')) setRibbonCollapsed(false);
  updateRibbon();
}
function setRibbonCollapsed(on) {
  $id('ribbon').classList.toggle('collapsed', on);
  document.body.classList.toggle('rb-collapsed', on);
  try { localStorage.setItem('phoditor.ribbonCollapsed', on ? '1' : ''); } catch (_) {}
}

// 지금 고른 사진 자리(같은 시트일 때만)
function ribbonSlot() {
  const s = state.selectedPhotoSlot;
  if (!s || !state.editor || s.sheetIdx !== state.activeSheetIdx) return null;
  return { target: s, photo: slotPhotoAt(s) };
}
function ribbonArea() {
  const s = state.selectedPhotoSlot || state.selectedPhotoArea;
  if (!s || !state.editor || s.sheetIdx !== state.activeSheetIdx) return null;
  return s;
}
function ribbonCell() {
  const c = state.selectedCell;
  if (!c || !state.editor || c.sheetIdx !== state.activeSheetIdx) return null;
  return c;
}

function setPhotoScale(sheet, v) {
  const DM = window.DocModel;
  const next = DM.clampPhotoScale(v);
  if (next === DM.clampPhotoScale(sheet.photoScale)) return;
  recordUndo('사진 칸 높이');
  if (next === 1) delete sheet.photoScale;
  else sheet.photoScale = next;
  renderActiveSheet();
}

// 칸 서식 바꾸기(속성 패널의 칸 글꼴과 같은 저장 방식)
function applyCellFormat(patch) {
  const c = ribbonCell();
  if (!c) return;
  const sheet = state.editor.sheets[c.sheetIdx];
  const cur = fontOverrideOf(sheet, c.key) || {};
  recordUndo('칸 서식 바꾸기');
  sheet.cellFonts = sheet.cellFonts || {};
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === null) delete next[k];
  if (Object.keys(next).length) sheet.cellFonts[c.key] = next;
  else delete sheet.cellFonts[c.key];
  renderActiveSheet();
}

const FMT_SIZES = [7, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
function updateRibbon() {
  if (!state.editor) return;
  const sheet = state.editor.sheets[state.activeSheetIdx];
  const isBlock = !!(sheet && sheet.role === 'block');
  // 홈
  $id('dupBlockBtn').disabled = !isBlock;
  $id('moveUpBtn').disabled = !isBlock || state.selectedBlockIdx <= 0;
  $id('moveDownBtn').disabled = !isBlock || state.selectedBlockIdx >= sheet.blocks.length - 1;
  // 사진
  const sl = ribbonSlot();
  const area = ribbonArea();
  const photo = sl && sl.photo;
  $id('rbLayoutBtn').disabled = !area;
  for (const id of ['rbCropBtn', 'rbRotateBtn', 'rbAnnoBtn', 'rbZoomBtn', 'rbRemoveBtn']) $id(id).disabled = !photo;
  $id('rbRevertBtn').disabled = !(photo && photo.isCropped);
  const hasAreas = isBlock && (sheet.sheetDef.block.photoAreas || []).length > 0;
  const DM = window.DocModel;
  const sc = hasAreas ? DM.clampPhotoScale(sheet.photoScale) : 1;
  $id('rbScaleVal').textContent = `${Math.round(sc * 100)}%`;
  $id('rbScaleDownBtn').disabled = !hasAreas || sc <= DM.PHOTO_SCALE_MIN;
  $id('rbScaleUpBtn').disabled = !hasAreas || sc >= DM.PHOTO_SCALE_MAX;
  $id('rbScaleFitBtn').disabled = !hasAreas;
  $id('rbPhotoHint').hidden = !!area || !isBlock;
  $id('ribbonTabs').querySelector('[data-tab="photo"]').classList.toggle('ctx-on', !!area);
  // 서식
  const c = ribbonCell();
  $id('ribbonTabs').querySelector('[data-tab="format"]').classList.toggle('ctx-on', !!c);
  $id('rbFormatHint').hidden = !!c;
  const fmtIds = ['fmtBoldBtn', 'fmtWrapBtn', 'fmtShrinkBtn', 'fmtResetBtn'];
  if (!c) {
    for (const id of fmtIds) { $id(id).disabled = true; $id(id).classList.remove('on'); }
    $id('fmtFontSel').disabled = true;
    $id('fmtSizeSel').disabled = true;
  } else {
    const csheet = state.editor.sheets[c.sheetIdx];
    const cur = fontOverrideOf(csheet, c.key) || {};
    const cm = c.cm;
    const baseName = mappedFontName(cm && cm.fontName) || '';
    const old = $id('fmtFontSel');
    const sel = fontSelect(cur.name || '', (v) => applyCellFormat({ name: v || undefined }), `원래 글꼴 (${baseName || '기본'})`);
    sel.id = 'fmtFontSel';
    sel.dataset.tip = '칸 글꼴';
    old.replaceWith(sel);
    const size = $id('fmtSizeSel');
    const curSize = cur.size || (cm && cm.fontSize) || 11;
    size.innerHTML = '';
    for (const z of [...new Set([...FMT_SIZES, curSize])].sort((a, b) => a - b)) size.appendChild(h('option', { value: String(z), text: `${z}pt` }));
    size.value = String(curSize);
    size.disabled = false;
    const bold = cur.bold !== undefined ? cur.bold : !!(cm && cm.fontBold);
    $id('fmtBoldBtn').classList.toggle('on', bold);
    $id('fmtWrapBtn').classList.toggle('on', cur.wrap !== false && !cur.shrink);
    $id('fmtShrinkBtn').classList.toggle('on', !!cur.shrink);
    for (const id of fmtIds) $id(id).disabled = false;
    $id('fmtWrapBtn').disabled = !!cur.shrink;
    $id('fmtResetBtn').disabled = !Object.keys(cur).length;
  }
  // 보기
  $id('rbSideBtn').classList.toggle('on', !el.sidebar.classList.contains('collapsed'));
  $id('rbInspBtn').classList.toggle('on', !el.inspector.classList.contains('collapsed'));
  $id('gridToggleBtn').classList.toggle('on', !!view.showGrid);
}

// --- 연결 ---
$id('ribbonTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  if (e.detail === 2) return setRibbonCollapsed(!$id('ribbon').classList.contains('collapsed'));
  setRibbonTab(b.dataset.tab);
});
$id('ribbonCollapseBtn').addEventListener('click', () => setRibbonCollapsed(true));
try { if (localStorage.getItem('phoditor.ribbonCollapsed')) setRibbonCollapsed(true); } catch (_) {}

const withBlockSel = (fn) => () => { if (state.editor) fn(); };
$id('dupBlockBtn').addEventListener('click', withBlockSel(duplicateBlock));
$id('moveUpBtn').addEventListener('click', withBlockSel(() => moveBlock(-1)));
$id('moveDownBtn').addEventListener('click', withBlockSel(() => moveBlock(1)));

$id('rbLayoutBtn').addEventListener('click', () => { const a = ribbonArea(); if (a) openLayoutModal(a.sheetIdx, a.blockIdx, a.paIdx, null); });
$id('rbCropBtn').addEventListener('click', () => { const s = ribbonSlot(); if (s && s.photo) openSlotCropEditor(s.target); });
$id('rbRotateBtn').addEventListener('click', () => { const s = ribbonSlot(); if (s && s.photo) rotateSlot(s.target); });
$id('rbRevertBtn').addEventListener('click', () => { const s = ribbonSlot(); if (s && s.photo) revertSlotCrop(s.target); });
$id('rbAnnoBtn').addEventListener('click', () => { const s = ribbonSlot(); if (s && s.photo) openAnnotationEditor(s.target); });
$id('rbZoomBtn').addEventListener('click', () => { const s = ribbonSlot(); if (s && s.photo) openLightbox([s.photo], 0); });
$id('rbRemoveBtn').addEventListener('click', () => { const s = ribbonSlot(); if (s && s.photo) { const t = s.target; removePhotoFromSlot(t.sheetIdx, t.blockIdx, t.paIdx, t.slotIdx); } });
const curSheet = () => state.editor && state.editor.sheets[state.activeSheetIdx];
$id('rbScaleDownBtn').addEventListener('click', () => { const s = curSheet(); if (s) setPhotoScale(s, window.DocModel.clampPhotoScale(s.photoScale) - 0.05); });
$id('rbScaleUpBtn').addEventListener('click', () => { const s = curSheet(); if (s) setPhotoScale(s, window.DocModel.clampPhotoScale(s.photoScale) + 0.05); });
$id('rbScaleFitBtn').addEventListener('click', () => { const s = curSheet(); if (s) fitPhotoScaleToPage(s); });

$id('fmtSizeSel').addEventListener('change', () => {
  const c = ribbonCell();
  if (!c) return;
  const v = Number($id('fmtSizeSel').value);
  applyCellFormat({ size: v === (c.cm && c.cm.fontSize) ? undefined : v });
});
$id('fmtBoldBtn').addEventListener('click', () => {
  const c = ribbonCell();
  if (!c) return;
  const cur = fontOverrideOf(state.editor.sheets[c.sheetIdx], c.key) || {};
  const base = !!(c.cm && c.cm.fontBold);
  const bold = cur.bold !== undefined ? cur.bold : base;
  applyCellFormat({ bold: !bold === base ? undefined : !bold });
});
$id('fmtWrapBtn').addEventListener('click', () => {
  const c = ribbonCell();
  if (!c) return;
  const cur = fontOverrideOf(state.editor.sheets[c.sheetIdx], c.key) || {};
  applyCellFormat({ wrap: cur.wrap === false ? undefined : false });
});
$id('fmtShrinkBtn').addEventListener('click', () => {
  const c = ribbonCell();
  if (!c) return;
  const cur = fontOverrideOf(state.editor.sheets[c.sheetIdx], c.key) || {};
  applyCellFormat({ shrink: cur.shrink ? undefined : true });
});
$id('fmtResetBtn').addEventListener('click', () => {
  const c = ribbonCell();
  if (!c) return;
  const sheet = state.editor.sheets[c.sheetIdx];
  if (!sheet.cellFonts || !sheet.cellFonts[c.key]) return;
  recordUndo('칸 서식 되돌리기');
  delete sheet.cellFonts[c.key];
  renderActiveSheet();
});

$id('rbZoomOutBtn').addEventListener('click', () => el.zoomOutBtn.click());
$id('rbZoomInBtn').addEventListener('click', () => el.zoomInBtn.click());
$id('rbZoomFitBtn').addEventListener('click', () => el.zoomLabel.click());
$id('rbSideBtn').addEventListener('click', () => { setSidebarCollapsed(!el.sidebar.classList.contains('collapsed')); updateRibbon(); });
$id('rbInspBtn').addEventListener('click', () => { setInspectorCollapsed(!el.inspector.classList.contains('collapsed')); updateRibbon(); });
$id('rbKeysBtn').addEventListener('click', openShortcutHelp);
$id('saveMyTplTopBtn').addEventListener('click', openSaveMyTemplate);
