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
  renderCatalog();
}
el.backToCatalogBtn.addEventListener('click', goToStart);
// [2026-11-26] 시작 화면: 왼쪽 메뉴·아래 목록 탭·양식 줄 넘기기·설정
for (const b of document.querySelectorAll('.start-nav .nav-btn[data-page]')) b.addEventListener('click', () => showStartPage(b.dataset.page));
document.getElementById('navOpenBtn').addEventListener('click', () => openProject(null));
document.getElementById('workTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  startUi.workTab = b.dataset.tab;
  renderWorkList();
});
el.companyGrid.addEventListener('scroll', updateStripButtons, { passive: true });
window.addEventListener('resize', updateStripButtons);
document.getElementById('stripPrev').addEventListener('click', () => el.companyGrid.scrollBy({ left: -el.companyGrid.clientWidth * 0.8, behavior: 'smooth' }));
document.getElementById('stripNext').addEventListener('click', () => el.companyGrid.scrollBy({ left: el.companyGrid.clientWidth * 0.8, behavior: 'smooth' }));
document.getElementById('setMyboxTokenBtn').addEventListener('click', openSettingsModal);
document.getElementById('setMyboxTestBtn').addEventListener('click', async () => {
  const box = document.getElementById('setMyboxResult');
  box.className = 'test-result-box';
  box.textContent = '확인 중…';
  box.classList.add('show');
  const res = await window.api.myboxTestConnection(null);
  box.className = `test-result-box ${res.ok ? 'ok' : 'err'}`;
  box.textContent = res.ok ? `연결 성공: ${res.message}` : `${res.message || '연결이 안 돼요'}${res.status ? ` (HTTP ${res.status})` : ''}`;
});
document.getElementById('setMyboxClearBtn').addEventListener('click', async () => { await handleClearMyboxToken(); renderSettingsPage(); });
el.closeSettingsBtn.addEventListener('click', () => { if (document.getElementById('settingsPage').classList.contains('active')) renderSettingsPage(); });
el.undoBtn.addEventListener('click', undo);
el.redoBtn.addEventListener('click', redo);
el.autoFillBtn.addEventListener('click', openAutoFill);
el.pasteTableBtn.addEventListener('click', openPasteTable);
// 쪽 이동 막대: 보이는 쪽 표시
el.gridViewport.addEventListener('scroll', () => updateRailActive(), { passive: true });
el.saveBtn.addEventListener('click', () => saveProject(false));
el.pdfBtn.addEventListener('click', () => openExportDialog('pdf'));
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
function pickPhotoSort(key) {
  if (photoView.key === key) photoView.dir = photoView.dir === 'desc' ? 'asc' : 'desc';
  else { photoView.key = key; photoView.dir = 'asc'; }
  savePhotoView();
  applyPhotoSort();
  syncPhotoViewControls();
  renderPhotoPanel();
}
el.photoSortName.addEventListener('click', () => pickPhotoSort('name'));
el.photoSortTime.addEventListener('click', () => pickPhotoSort('time'));
el.photoColsSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cols]');
  if (!b) return;
  photoView.cols = Number(b.dataset.cols);
  savePhotoView();
  syncPhotoViewControls();
});
syncPhotoViewControls();
// [2026-11-26] 속성 패널 접기/펼치기(기억해 둠). 접으면 캔버스가 넓어져 쪽을 다시 맞춘다
function setInspectorCollapsed(on) {
  el.inspector.classList.toggle('collapsed', on);
  try { localStorage.setItem('phoditor.inspCollapsed', on ? '1' : ''); } catch (_) {}
  if (state.editor && el.editorView.classList.contains('active')) renderActiveSheet();
}
el.inspCollapseBtn.addEventListener('click', () => setInspectorCollapsed(true));
el.inspExpandBtn.addEventListener('click', () => setInspectorCollapsed(false));
try { if (localStorage.getItem('phoditor.inspCollapsed')) el.inspector.classList.add('collapsed'); } catch (_) {}
// [2026-11-26] 사진 패널 접기·너비 조절, 속성 패널 너비 조절(기억해 둠)
const PANE = { side: { min: 200, max: 560, def: 268, varName: '--sidebar-w', key: 'phoditor.sideW' }, insp: { min: 240, max: 520, def: 292, varName: '--inspector-w', key: 'phoditor.inspW' } };
function setPaneWidth(which, w, save = true) {
  const p = PANE[which];
  const v = Math.round(Math.max(p.min, Math.min(p.max, w)));
  document.documentElement.style.setProperty(p.varName, `${v}px`);
  if (save) { try { localStorage.setItem(p.key, String(v)); } catch (_) {} }
  return v;
}
function setSidebarCollapsed(on) {
  el.sidebar.classList.toggle('collapsed', on);
  try { localStorage.setItem('phoditor.sideCollapsed', on ? '1' : ''); } catch (_) {}
  if (state.editor && el.editorView.classList.contains('active')) renderActiveSheet();
}
for (const which of ['side', 'insp']) {
  try { const v = Number(localStorage.getItem(PANE[which].key)); if (v) setPaneWidth(which, v, false); } catch (_) {}
  const handle = which === 'side' ? el.sideResizer : el.inspResizer;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pane = which === 'side' ? el.sidebar : el.inspector;
    if (pane.classList.contains('collapsed')) return;
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.classList.add('resizing-panes');
    const move = (ev) => setPaneWidth(which, which === 'side' ? startW + (ev.clientX - startX) : startW - (ev.clientX - startX), false);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing-panes');
      setPaneWidth(which, pane.getBoundingClientRect().width);
      if (state.editor && el.editorView.classList.contains('active')) renderActiveSheet();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  handle.addEventListener('dblclick', () => {
    setPaneWidth(which, PANE[which].def);
    if (state.editor && el.editorView.classList.contains('active')) renderActiveSheet();
  });
}
el.sideCollapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
el.sideExpandBtn.addEventListener('click', () => setSidebarCollapsed(false));
try { if (localStorage.getItem('phoditor.sideCollapsed')) el.sidebar.classList.add('collapsed'); } catch (_) {}
// MYBOX 토큰 기간
el.myboxDaysSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-days]');
  if (b) setDaysSeg(Number(b.dataset.days));
});
el.myboxIssuedInput.addEventListener('input', updateExpiryPreview);
el.myboxExpiryChip.addEventListener('click', openSettingsModal);
refreshMyboxStatus();
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
    setFolderPathText(el.folderPathText, done < total ? `미리보기 만드는 중 ${done}/${total}` : state.photoFolder);
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
  else if (cmd === 'export' && inEditor) openExportDialog('xlsx');
  else if (cmd === 'export-pdf' && inEditor) openExportDialog('pdf');
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
el.exportBtn.addEventListener('click', () => openExportDialog('xlsx'));

el.dismissFontBannerBtn.addEventListener('click', () => {
  el.fontBanner.classList.remove('visible');
});

el.selectFolderBtn.addEventListener('click', async () => {
  const res = await window.api.selectPhotoFolder();
  if (!res.canceled) {
    state.photoFolder = res.folderPath;
    state.photoFolderStack = [res.folderPath];
    state.photos = res.photos || [];
    state.photoSubfolders = res.subfolders || [];
    applyPhotoSort();
    renderPhotoPanel();
  }
});
el.refreshFolderBtn.addEventListener('click', async () => {
  if (!state.photoFolder) return;
  await loadLocalFolder(state.photoFolder, false);
  showToast('사진 폴더를 새로고침했어요.');
});
el.localUpBtn.addEventListener('click', async () => {
  if (state.photoFolderStack.length < 2) return;
  state.photoFolderStack.pop();
  await loadLocalFolder(state.photoFolderStack[state.photoFolderStack.length - 1], false);
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

// [2026-11-26] 편집 화면 단축키 (글 입력 중에는 쓰지 않음)
function switchSheetBy(d) {
  const n = state.editor.sheets.length;
  const j = state.activeSheetIdx + d;
  if (j < 0 || j >= n) return;
  state.activeSheetIdx = j;
  state.selectedBlockIdx = 0;
  state.selectedCell = null;
  state.selectedPhotoSlot = null;
  state.selectedPhotoArea = null;
  renderSheetTabs();
  renderActiveSheet();
  updateToolbarButtons();
}
function openShortcutHelp() {
  if (document.querySelector('.dyn-modal.sc-help')) return;
  const list = h('div', { class: 'shortcut-list' }, ...SHORTCUTS.map(([k, d]) => h('div', { class: 'sc-row' }, h('span', { text: d }), h('span', { class: 'sc-keys' }, ...k.split(' ').map((x) => h('kbd', { text: x }))))));
  const back = openModal('단축키', [list], [h('button', { class: 'primary', onclick: () => back.remove() }, '닫기')], 620);
  back.classList.add('sc-help');
}
document.addEventListener('keydown', (e) => {
  if (!el.editorView.classList.contains('active') || !state.editor) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (document.querySelector('.modal-backdrop.open')) {
    if (e.key === 'Escape') { const m = document.querySelector('.dyn-modal'); if (m) m.remove(); }
    return;
  }
  const cmd = e.metaKey || e.ctrlKey;
  const sheet = state.editor.sheets[state.activeSheetIdx];
  const isBlock = sheet && sheet.role === 'block';
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  if ((e.key === 'Delete' || e.key === 'Backspace') && !cmd && state.selectedPhotoSlot) {
    done();
    const { sheetIdx, blockIdx, paIdx, slotIdx } = state.selectedPhotoSlot;
    return removePhotoFromSlot(sheetIdx, blockIdx, paIdx, slotIdx);
  }
  if (cmd && (e.key === 'y' || e.key === 'Y')) { done(); return redo(); }
  if (cmd && e.key === 'Enter' && isBlock) { done(); return addBlock(true); }
  if (cmd && (e.key === 'd' || e.key === 'D') && isBlock) { done(); return duplicateBlock(); }
  if (cmd && e.key === 'Backspace' && isBlock) { done(); return deleteSelectedBlock(); }
  if (cmd && e.key === '[') { done(); return switchSheetBy(-1); }
  if (cmd && e.key === ']') { done(); return switchSheetBy(1); }
  if (cmd && e.shiftKey && (e.key === '\\' || e.key === '|')) { done(); return setSidebarCollapsed(!el.sidebar.classList.contains('collapsed')); }
  if (cmd && e.key === '\\') { done(); return setInspectorCollapsed(!el.inspector.classList.contains('collapsed')); }
  if (cmd && /^[1-4]$/.test(e.key)) { done(); photoView.cols = Number(e.key); savePhotoView(); return syncPhotoViewControls(); }
  if (e.altKey && !cmd && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && isBlock) { done(); return moveBlock(e.key === 'ArrowUp' ? -1 : 1); }
  if (!cmd && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && isBlock && !state.selectedCell) {
    done();
    const j = Math.max(0, Math.min(sheet.blocks.length - 1, state.selectedBlockIdx + (e.key === 'ArrowUp' ? -1 : 1)));
    setSelectedBlock(j);
    const o = document.querySelector(`.block-outline[data-b="${j}"]`);
    if (o) o.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  if (e.key === 'Enter' && !cmd && state.selectedCell) {
    const td = document.querySelector('td.selected-cell');
    if (td) { done(); td.click(); }
    return;
  }
  if (e.key === '?' || (e.shiftKey && e.key === '/')) { done(); return openShortcutHelp(); }
  if (e.key === 'Escape' && (state.selectedCell || state.selectedPhotoSlot || state.selectedPhotoArea)) { done(); return showDocumentInspector(); }
});

// [2026-11-26] 빠른 말풍선: data-tip 이 있는 단추에 마우스를 올리면 짧은 설명(기본 title보다 빨리)
(() => {
  const tip = document.createElement('div');
  tip.id = 'tipBubble';
  document.body.appendChild(tip);
  let timer = null;
  let cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('show'); cur = null; };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === cur) return;
    hide();
    if (!t || !t.dataset.tip) return;
    cur = t;
    timer = setTimeout(() => {
      if (!cur || !document.body.contains(cur)) return;
      tip.textContent = cur.dataset.tip;
      const r = cur.getBoundingClientRect();
      tip.style.left = '0px'; tip.style.top = '0px';
      tip.classList.add('show');
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2;
      x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
      let y = r.bottom + 6;
      if (y + th > window.innerHeight - 4) y = r.top - th - 6;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }, 280);
  });
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('blur', hide);
})();

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
el.saveMyboxBtn.addEventListener('click', () => setTimeout(() => { if (document.getElementById('settingsPage').classList.contains('active')) renderSettingsPage(); }, 400));
el.testMyboxBtn.addEventListener('click', handleTestMyboxConnection);
el.clearMyboxBtn.addEventListener('click', handleClearMyboxToken);

// Boot
initCatalog();
