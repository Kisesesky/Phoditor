// [renderer/99-wiring.js] 단추·메뉴·키보드 연결과 앱 시작
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// --- Event Wiring ---
const EXPORT_BTN_HTML = el.exportBtn.innerHTML;
el.zoomInBtn.addEventListener('click', () => {
  const vis = state.editor && state.sheetVisuals[state.editor.sheets[state.activeSheetIdx].visualKey];
  const z = vis ? effectiveZoom(vis) : 1;
  view.zoom = Math.min(2.5, Math.round((z + 0.1) * 10) / 10);
  renderActiveSheet();
});
el.zoomOutBtn.addEventListener('click', () => {
  const vis = state.editor && state.sheetVisuals[state.editor.sheets[state.activeSheetIdx].visualKey];
  const z = vis ? effectiveZoom(vis) : 1;
  view.zoom = Math.max(0.3, Math.round((z - 0.1) * 10) / 10);
  renderActiveSheet();
});
el.zoomLabel.addEventListener('click', () => {
  view.zoom = 'fit';
  renderActiveSheet();
});
el.gridToggleBtn.addEventListener('click', () => {
  view.showGrid = !view.showGrid;
  el.gridToggleBtn.classList.toggle('on', view.showGrid);
  renderActiveSheet();
});
el.fontPanelBtn.addEventListener('click', showDocumentInspector);
el.fontBanner.addEventListener('click', showDocumentInspector);
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!state.editor || view.zoom !== 'fit' || !el.editorView.classList.contains('active')) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderActiveSheet, 120);
});
el.gridViewport.addEventListener('mousedown', (e) => {
  if (document.querySelector('.cell-editor-input')) {
    const td = e.target.closest && e.target.closest('td.editable-cell');
    if (td && !td.querySelector('.cell-editor-input')) state.nextEditId = cellIdOf(td);
  }
}, true);
el.gridViewport.addEventListener('mousedown', (e) => {
  if (e.target === el.gridViewport || e.target.classList.contains('sheet-paper') || e.target.classList.contains('pv-page-holder')) showDocumentInspector();
});
async function goToStart() {
  if (!(await confirmLeave())) return;
  hideToast();
  el.editorView.classList.remove('active');
  el.catalogView.classList.add('active');
  renderStartExtras();
}
el.backToCatalogBtn.addEventListener('click', goToStart);
el.undoBtn.addEventListener('click', undo);
el.redoBtn.addEventListener('click', redo);
el.autoFillBtn.addEventListener('click', () => { el.fillMenu.hidden = true; openAutoFill(); });
el.pasteTableBtn.addEventListener('click', () => { el.fillMenu.hidden = true; openPasteTable(); });
// [채우기] 메뉴 열고 닫기
el.fillMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.fillMenu.hidden = !el.fillMenu.hidden;
});
document.addEventListener('mousedown', (e) => {
  if (!el.fillMenu.hidden && !e.target.closest('.tb-menu-wrap')) el.fillMenu.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') el.fillMenu.hidden = true; });
// 쪽 이동 막대: 보이는 쪽 표시
el.gridViewport.addEventListener('scroll', () => updateRailActive(), { passive: true });
el.saveBtn.addEventListener('click', () => saveProject(false));
el.pdfBtn.addEventListener('click', handleExportPdf);
el.overflowChip.addEventListener('click', () => {
  const list = state.overflowCells || [];
  if (!list.length) return;
  const td = list[(state.overflowCursor = ((state.overflowCursor || -1) + 1) % list.length)];
  td.scrollIntoView({ block: 'center', behavior: 'smooth' });
  td.classList.add('flash');
  setTimeout(() => td.classList.remove('flash'), 1200);
});
el.photoFilterBtn.addEventListener('click', () => {
  state.photoFilterUnused = !state.photoFilterUnused;
  el.photoFilterBtn.classList.toggle('on', state.photoFilterUnused);
  renderPhotoPanel();
});
el.photoSortSel.addEventListener('change', () => {
  const v = el.photoSortSel.value;
  if (v === 'name') state.photos.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  else if (v === 'time') state.photos.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0));
  renderPhotoPanel();
});
// [2026-11-26] 뒤에서 만든 썸네일이 오면 그 사진 카드만 바꾼다
window.api.onThumbReady(({ path: p, thumbUrl, done, total }) => {
  for (const ph of state.photos) if (ph.path === p && !ph.isCropped) ph.thumbUrl = thumbUrl;
  const wrap = [...el.photoGrid.querySelectorAll('.photo-thumb-wrap')].find((w) => w.dataset.path === p);
  if (wrap && thumbUrl) {
    wrap.innerHTML = '';
    const img = document.createElement('img');
    img.src = thumbUrl;
    wrap.appendChild(img);
  }
  if (el.folderPathText && state.photoFolder) {
    el.folderPathText.textContent = done < total ? `미리보기 만드는 중 ${done}/${total}` : state.photoFolder;
  }
});

// 앱 메뉴(⌘N·⌘O·⌘S·⌘Z …)
window.api.onMenu(async (cmd) => {
  const inField = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if ((cmd === 'undo' || cmd === 'redo') && inField) {
    document.execCommand(cmd);
    return;
  }
  const inEditor = !!state.editor && el.editorView.classList.contains('active');
  if (cmd === 'undo' && inEditor) undo();
  else if (cmd === 'redo' && inEditor) redo();
  else if (cmd === 'save' && inEditor) saveProject(false);
  else if (cmd === 'save-as' && inEditor) saveProject(true);
  else if (cmd === 'open') openProject(null);
  else if (cmd === 'new') { if (inEditor) goToStart(); }
  else if (cmd === 'export' && inEditor) handleExport();
  else if (cmd === 'export-pdf' && inEditor) handleExportPdf();
  else if (cmd === 'zoom-in' && inEditor) el.zoomInBtn.click();
  else if (cmd === 'zoom-out' && inEditor) el.zoomOutBtn.click();
  else if (cmd === 'zoom-fit' && inEditor) el.zoomLabel.click();
  else if (cmd === 'save-then-close') {
    if (await saveProject(false)) window.api.closeNow();
  }
});

el.addBlockEndBtn.addEventListener('click', () => addBlock(false));
el.addBlockBelowBtn.addEventListener('click', () => addBlock(true));
el.deleteBlockBtn.addEventListener('click', deleteSelectedBlock);
el.editRepeatedBtn.addEventListener('click', openRepeatedModal);
el.siteNameInput.addEventListener('input', () => {
  if (state.editor) state.editor.siteName = el.siteNameInput.value;
});
el.exportBtn.addEventListener('click', handleExport);

el.dismissFontBannerBtn.addEventListener('click', () => {
  el.fontBanner.classList.remove('visible');
});

el.selectFolderBtn.addEventListener('click', async () => {
  const res = await window.api.selectPhotoFolder();
  if (!res.canceled) {
    state.photoFolder = res.folderPath;
    state.photos = res.photos || [];
    renderPhotoPanel();
  }
});

el.refreshFolderBtn.addEventListener('click', async () => {
  if (!state.photoFolder) return;
  const res = await window.api.refreshPhotoFolder(state.photoFolder);
  if (!res.canceled) {
    state.photos = res.photos || [];
    renderPhotoPanel();
    showToast('사진 폴더를 새로고침했습니다.');
  }
});

document.querySelectorAll('.layout-opt-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyLayoutSelection(btn.getAttribute('data-layout'));
  });
});

el.cancelLayoutBtn.addEventListener('click', () => {
  state.pendingLayoutTarget = null;
  el.layoutModal.classList.remove('open');
});

el.cancelRepeatedBtn.addEventListener('click', () => el.repeatedModal.classList.remove('open'));
el.saveRepeatedBtn.addEventListener('click', saveRepeatedModal);

el.cancelAddSheetBtn.addEventListener('click', () => el.addSheetModal.classList.remove('open'));
el.confirmAddSheetBtn.addEventListener('click', confirmAddSheet);
el.newSheetNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmAddSheet();
  if (e.key === 'Escape') el.addSheetModal.classList.remove('open');
});

// Keyboard Delete for selected photo slot
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedPhotoSlot) {
    e.preventDefault();
    const { sheetIdx, blockIdx, paIdx, slotIdx } = state.selectedPhotoSlot;
    removePhotoFromSlot(sheetIdx, blockIdx, paIdx, slotIdx);
  }
});

// Stage 2 Event Wiring
el.openSettingsBtn.addEventListener('click', openSettingsModal);
el.myboxSettingsBtn.addEventListener('click', openSettingsModal);
el.sourceTabLocal.addEventListener('click', () => switchPhotoSource('local'));
el.sourceTabMybox.addEventListener('click', () => switchPhotoSource('mybox'));
el.myboxUpBtn.addEventListener('click', () => {
  if (state.mybox.folderStack.length > 1) {
    state.mybox.folderStack.pop();
    loadMyboxCurrentFolder();
  }
});
el.myboxRefreshBtn.addEventListener('click', loadMyboxCurrentFolder);

el.cropStage.addEventListener('mousedown', startCropDrag);
window.addEventListener('mousemove', moveCropDrag);
window.addEventListener('mouseup', endCropDrag);
el.cropSelectAllBtn.addEventListener('click', () => {
  if (!state.cropSession) return;
  state.cropSession.rect = {
    x: 0,
    y: 0,
    w: el.cropImage.clientWidth || 100,
    h: el.cropImage.clientHeight || 100
  };
  renderCropSelection();
});
el.cancelCropBtn.addEventListener('click', cancelCrop);
el.confirmCropBtn.addEventListener('click', confirmCrop);

el.closeSettingsBtn.addEventListener('click', () => el.settingsModal.classList.remove('open'));
el.saveMyboxBtn.addEventListener('click', handleSaveMyboxToken);
el.testMyboxBtn.addEventListener('click', handleTestMyboxConnection);
el.clearMyboxBtn.addEventListener('click', handleClearMyboxToken);

// Boot
initCatalog();
