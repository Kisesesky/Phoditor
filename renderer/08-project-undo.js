// [renderer/08-project-undo.js] 실행 취소, 작업 저장·열기·자동 저장, 최근 작업, 블록 이동·복제, 모달 공통
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// =====================================================================
// [기능 추가 2026-11-25] 실행 취소·작업 저장·자동 저장·사진 자동 채우기·블록 이동/복제·표 붙여넣기·자동완성·목차 채우기·사진 크게 보기/돌리기
// =====================================================================

// --- 실행 취소/다시 실행 (docmodel.js) ---
const { deepClone, UndoHistory, serializeEditor: serializeEditorModel, attachSheetDefs, transformAnnotations } = window.DocModel;
const undoHistory = new UndoHistory(60);
const docState = { filePath: null, dirty: false, autosaveTimer: null };

function recordUndo(label) {
  if (!state.editor) return;
  undoHistory.record(state.editor, { active: state.activeSheetIdx, block: state.selectedBlockIdx, label });
  markDirty();
}

function restoreSnapshot(snap) {
  state.editor = snap.editor;
  state.activeSheetIdx = Math.min(snap.active, state.editor.sheets.length - 1);
  const sh = state.editor.sheets[state.activeSheetIdx];
  state.selectedBlockIdx = sh && sh.blocks ? Math.min(snap.block, sh.blocks.length - 1) : 0;
  state.selectedCell = null;
  state.selectedPhotoSlot = null;
  state.selectedPhotoArea = null;
  rerenderAll();
}

function undo() {
  const snap = undoHistory.undo(state.editor, { active: state.activeSheetIdx, block: state.selectedBlockIdx });
  if (!snap) return showToast('되돌릴 작업이 없어요.');
  restoreSnapshot(snap);
  markDirty();
  showToast(`되돌렸어요: ${snap.label}`);
}

function redo() {
  const snap = undoHistory.redo(state.editor, { active: state.activeSheetIdx, block: state.selectedBlockIdx });
  if (!snap) return showToast('다시 할 작업이 없어요.');
  restoreSnapshot(snap);
  markDirty();
  showToast(`다시 했어요: ${snap.label}`);
}

function rerenderAll() {
  renderSheetTabs();
  renderActiveSheet();
  updateToolbarButtons();
  refreshSizeEstimate();
  renderPhotoPanel();
  updateFontChip();
  updateDocTitle();
}

// --- 작업 저장·열기·자동 저장 ---
function projectTitle() {
  const site = currentSiteName();
  return site ? `${site} ${state.templateDef.type}` : `${state.templateDef.type} · ${state.templateDef.company}`;
}

function updateDocTitle() {
  if (!state.templateDef || !el.editorKicker) return;
  const name = docState.filePath ? docState.filePath.split('/').pop().replace(/\.pbook$/, '') : '저장 안 됨';
  el.editorKicker.textContent = `${state.templateDef.type} · ${name}${docState.dirty ? ' — 수정됨' : ''}`;
}

function markDirty() {
  docState.dirty = true;
  window.api.setDirty(true);
  updateDocTitle();
  clearTimeout(docState.autosaveTimer);
  docState.autosaveTimer = setTimeout(() => {
    if (state.editor && docState.dirty) window.api.autosaveWrite({ ...projectData(), autosaveOf: docState.filePath });
  }, 2500);
}

function markClean() {
  docState.dirty = false;
  clearTimeout(docState.autosaveTimer);
  window.api.setDirty(false);
  window.api.autosaveClear();
  updateDocTitle();
}

function serializeEditor() {
  return serializeEditorModel(state.editor, state.templateDef);
}

function projectData() {
  return {
    format: 'photobook',
    version: 1,
    templateId: state.templateDef.id,
    templateVersion: state.templateDef.version,
    title: projectTitle(),
    savedAt: new Date().toISOString(),
    activeSheetIdx: state.activeSheetIdx,
    photoFolder: state.photoFolder || null,
    editor: serializeEditor()
  };
}

async function saveProject(saveAs = false) {
  if (!state.editor) return false;
  const res = await window.api.projectSave({
    filePath: docState.filePath,
    saveAs,
    suggestedName: `${currentSiteName() || '현장'}_${state.templateDef.type}_${state.templateDef.company}`,
    data: projectData()
  });
  if (!res || !res.ok) {
    if (res && res.error) showToast(`저장하지 못했어요: ${res.error}`);
    return false;
  }
  docState.filePath = res.filePath;
  markClean();
  const mb = res.sizeBytes ? ` · ${(res.sizeBytes / 1048576).toFixed(1)}MB` : '';
  showToast(`저장했어요: ${res.filePath.split('/').pop()} (사진 ${res.photos || 0}장 포함${mb})${res.missing ? ` · 원본이 없는 사진 ${res.missing}장은 빠짐` : ''}`, 4000);
  return true;
}

async function restoreProject(data, filePath) {
  if (!data || data.format !== 'photobook') return showToast('사진첩 작업 파일이 아니에요.');
  if (!state.catalog) return;
  await openTemplate(data.templateId, data);
  docState.filePath = filePath || null;
  if (filePath) markClean();
  else markDirty();
}

async function openProject(filePath) {
  if (!(await confirmLeave())) return;
  const res = await window.api.projectOpen(filePath || null);
  if (!res || !res.ok) {
    if (res && res.error) showToast(`열지 못했어요: ${res.error}`);
    return;
  }
  await restoreProject(res.data, res.filePath);
  showToast(`작업을 열었어요: ${res.filePath.split('/').pop()}`);
}

// 저장 안 한 변경이 있으면 물어본다. true면 계속 진행
async function confirmLeave() {
  if (!state.editor || !docState.dirty) return true;
  if (confirm('저장하지 않은 작업이 있어요. 지금 저장할까요?\n(취소를 누르면 저장하지 않고 넘어가요. 자동 저장본은 시작 화면에서 복구할 수 있어요)')) {
    return saveProject(false);
  }
  return true;
}

// 저장한 작업을 연 뒤: 정의서 연결, 썸네일 다시 만들기, 없는 사진 알리기
async function applyRestoredEditor(data) {
  const ed = attachSheetDefs(data.editor, state.templateDef);
  state.editor = ed;
  state.activeSheetIdx = Math.min(data.activeSheetIdx || 0, ed.sheets.length - 1);
  const paths = new Set();
  for (const s of ed.sheets) for (const b of s.blocks || []) for (const pa of Object.values(b.photoAreas || {})) for (const sl of (pa && pa.slots) || []) if (sl && sl.path) paths.add(sl.path);
  const list = [...paths];
  const exist = list.length ? await window.api.filesExist(list) : [];
  const missing = list.filter((_p, i) => !exist[i]);
  const thumbs = list.length ? await window.api.makeThumbs(list.filter((_p, i) => exist[i])) : {};
  for (const s of ed.sheets) for (const b of s.blocks || []) for (const pa of Object.values(b.photoAreas || {})) for (const sl of (pa && pa.slots) || []) {
    if (sl && sl.path && !sl.isCropped && thumbs[sl.path]) sl.thumbUrl = thumbs[sl.path];
  }
  if (data.photoFolder) {
    const r = await window.api.refreshPhotoFolder(data.photoFolder);
    if (r && !r.canceled) {
      state.photoFolder = data.photoFolder;
      state.photos = r.photos || [];
      state.photoSubfolders = r.subfolders || [];
      state.photoFolderStack = [data.photoFolder];
      applyPhotoSort();
    }
  }
  if (missing.length) setTimeout(() => showToast(`원본 사진 ${missing.length}장을 찾을 수 없어요. 옮겼거나 지웠는지 확인해 주세요.`, 5000), 600);
  // [PLAN v0.6 D7] 작업을 만든 정의서 버전과 지금 버전이 다르면 알린다
  if (data.templateVersion && data.templateVersion !== state.templateDef.version) {
    setTimeout(() => showToast(`이 작업은 양식 정의서 v${data.templateVersion}로 만들었어요(지금 v${state.templateDef.version}). 칸 위치가 바뀌었을 수 있으니 확인해 주세요.`, 6000), 1200);
  }
}

// --- 시작 화면: 최근 작업·자동 저장 복구 ---
async function renderStartExtras() {
  // 저장 안 한 작업(자동 저장본) 안내 + 아래 목록(최근 작업 / 내 양식)
  const box = document.getElementById('recoverSlot');
  if (box) {
    box.innerHTML = '';
    const auto = await window.api.autosaveRead();
    if (auto && auto.editor) {
      const when = new Date(auto.savedAt).toLocaleString('ko-KR');
      box.appendChild(h('div', { class: 'recover-banner' },
        h('div', {}, h('strong', { text: '저장하지 않은 작업이 남아 있어요' }), h('span', { text: ` ${auto.title || ''} · ${when}` })),
        h('div', { class: 'insp-actions' },
          h('button', { class: 'primary', onclick: async () => { await restoreProject(auto, auto.autosaveOf || null); docState.filePath = auto.autosaveOf || null; markDirty(); showToast('자동 저장본을 복구했어요. 저장해 주세요.'); } }, '복구'),
          h('button', { onclick: async () => { if (confirm('자동 저장본을 버릴까요? 되돌릴 수 없어요.')) { await window.api.autosaveClear(); renderStartExtras(); } } }, '버리기'))));
    }
  }
  await renderWorkList();
}

// --- 블록 이동·복제 ---
function moveBlock(delta) {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  if (!sheet || sheet.role !== 'block') return;
  const i = state.selectedBlockIdx;
  const j = i + delta;
  if (j < 0 || j >= sheet.blocks.length) return;
  recordUndo(`블록 ${delta < 0 ? '위로' : '아래로'} 이동`);
  const [b] = sheet.blocks.splice(i, 1);
  sheet.blocks.splice(j, 0, b);
  state.selectedBlockIdx = j;
  state.selectedCell = null;
  state.selectedPhotoSlot = null;
  renderActiveSheet();
  updateToolbarButtons();
}

function duplicateBlock() {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  if (!sheet || sheet.role !== 'block') return;
  recordUndo('블록 복제');
  const copy = deepClone(sheet.blocks[state.selectedBlockIdx]);
  sheet.blocks.splice(state.selectedBlockIdx + 1, 0, copy);
  state.selectedBlockIdx += 1;
  state.selectedCell = null;
  state.selectedPhotoSlot = null;
  renderActiveSheet();
  updateToolbarButtons();
  refreshSizeEstimate();
  renderPhotoPanel();
  showToast('블록을 복제했어요(글자·사진 포함).');
}

// --- 모달 공통 ---
function openModal(title, bodyNodes, footerNodes, width = 560) {
  const back = h('div', { class: 'modal-backdrop open dyn-modal' });
  const box = h('div', { class: 'modal-box', style: `width:${width}px` }, h('h3', { text: title }), ...bodyNodes, h('div', { class: 'modal-footer' }, ...footerNodes));
  back.appendChild(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}
const radioGroup = (name, options, value) => h('div', { class: 'seg-sm' }, ...options.map(([v, label]) => {
  const b = h('button', { class: v === value ? 'on' : '', 'data-v': v, type: 'button' }, label);
  b.addEventListener('click', () => { b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); b.parentElement.dataset.value = v; });
  return b;
}));
const segValue = (seg, def) => seg.dataset.value || (seg.querySelector('button.on') && seg.querySelector('button.on').dataset.v) || def;
