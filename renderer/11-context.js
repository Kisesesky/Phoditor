// [renderer/11-context.js] 오른쪽 클릭 메뉴(2026-11-26)
// 사진 자리·빈 사진 영역·블록·사진 패널 사진. 메뉴의 일은 위쪽 도구 막대·속성 패널과 같은 함수를 부른다(같은 일을 하는 다른 길).
'use strict';

let ctxMenuEl = null;
function closeContextMenu() {
  if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
}
// items: [{ label, keys?, onClick, danger?, disabled? } | 'sep']
function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { if (menu.lastChild && !menu.lastChild.classList.contains('ctx-sep')) menu.appendChild(h('div', { class: 'ctx-sep' })); continue; }
    const b = h('button', { class: `ctx-item${it.danger ? ' danger' : ''}`, role: 'menuitem', disabled: it.disabled ? true : null },
      h('span', { class: 'ctx-label', text: it.label }),
      it.keys ? h('span', { class: 'ctx-keys', text: it.keys }) : null);
    b.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); it.onClick(); });
    menu.appendChild(b);
  }
  if (menu.lastChild && menu.lastChild.classList.contains('ctx-sep')) menu.lastChild.remove();
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  ctxMenuEl = menu;
  const first = menu.querySelector('.ctx-item:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener('mousedown', (e) => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeContextMenu(); }, true);
document.addEventListener('keydown', (e) => {
  if (!ctxMenuEl) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeContextMenu(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    const items = [...ctxMenuEl.querySelectorAll('.ctx-item:not([disabled])')];
    const i = items.indexOf(document.activeElement);
    const j = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[j].focus();
  }
}, true);
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
el.gridViewport.addEventListener('scroll', closeContextMenu, { passive: true });

const parseKey = (k) => k.split('-').map(Number);

function blockMenuItems(sheetIdx, bIdx) {
  const sheet = state.editor.sheets[sheetIdx];
  const unit = sheet.sheetDef.block.addUnit === 'page' ? '쪽' : '블록';
  const sel = () => { if (state.selectedBlockIdx !== bIdx) setSelectedBlock(bIdx, true); state.selectedBlockIdx = bIdx; };
  return [
    { label: `아래에 ${unit} 추가`, keys: '⌘↵', onClick: () => { sel(); addBlock(true); } },
    { label: `${unit} 복제`, keys: '⌘D', onClick: () => { sel(); duplicateBlock(); } },
    { label: '위로 옮기기', keys: '⌥↑', disabled: bIdx <= 0, onClick: () => { sel(); moveBlock(-1); } },
    { label: '아래로 옮기기', keys: '⌥↓', disabled: bIdx >= sheet.blocks.length - 1, onClick: () => { sel(); moveBlock(1); } },
    'sep',
    { label: `${unit} 삭제`, keys: '⌘⌫', danger: true, disabled: sheet.blocks.length <= 1, onClick: () => { sel(); deleteSelectedBlock(); } }
  ];
}

el.gridViewport.addEventListener('contextmenu', (e) => {
  if (!state.editor) return;
  const sheetIdx = state.activeSheetIdx;
  const sheet = state.editor.sheets[sheetIdx];
  const slotEl = e.target.closest('.photo-slot[data-slot-key]');
  const areaEl = e.target.closest('.photo-area-box[data-area-key]');
  const tr = e.target.closest('tr[data-b]');
  if (!slotEl && !areaEl && !tr) return;
  e.preventDefault();
  if (slotEl) {
    const [s, b, p, i] = parseKey(slotEl.dataset.slotKey);
    const target = { sheetIdx: s, blockIdx: b, paIdx: p, slotIdx: i };
    const photo = slotPhotoAt(target);
    // 누른 자리를 고른 상태로(속성 패널도 그 사진으로)
    state.selectedPhotoSlot = target;
    state.selectedPhotoArea = null;
    state.selectedCell = null;
    state.selectedBlockIdx = b;
    document.querySelectorAll('.photo-slot.selected-slot').forEach((x) => x.classList.remove('selected-slot'));
    slotEl.classList.add('selected-slot');
    renderInspector();
    const items = photo ? [
      { label: photo.cropRect ? '다시 자르기' : '자르기', onClick: () => openSlotCropEditor(target) },
      { label: '오른쪽으로 90° 돌리기', onClick: () => rotateSlot(target) },
      photo.isCropped ? { label: '원본으로 되돌리기', onClick: () => revertSlotCrop(target) } : null,
      { label: '크게 보기', onClick: () => openLightbox([photo], 0) },
      { label: photo.annotations && photo.annotations.length ? `사진 위 표시 고치기 (${photo.annotations.length})` : '사진 위 표시…', onClick: () => openAnnotationEditor(target) },
      'sep',
      { label: '배치 바꾸기…', onClick: () => openLayoutModal(s, b, p, null) },
      'sep',
      ...blockMenuItems(s, b),
      'sep',
      { label: '사진 빼기', keys: '⌫', danger: true, onClick: () => removePhotoFromSlot(s, b, p, i) }
    ] : [
      { label: '왼쪽 사진을 누르면 이 자리에 들어가요', disabled: true, onClick: () => {} },
      { label: '배치 바꾸기…', onClick: () => openLayoutModal(s, b, p, null) },
      { label: '사진 자동 채우기…', onClick: openAutoFill },
      'sep',
      ...blockMenuItems(s, b)
    ];
    return showContextMenu(e.clientX, e.clientY, items);
  }
  if (areaEl) {
    const [s, b, p] = parseKey(areaEl.dataset.areaKey);
    return showContextMenu(e.clientX, e.clientY, [
      { label: '배치 고르기…', onClick: () => openLayoutModal(s, b, p, null) },
      { label: '사진 자동 채우기…', onClick: openAutoFill },
      'sep',
      ...blockMenuItems(s, b)
    ]);
  }
  if (sheet && sheet.role === 'block') {
    const b = Number(tr.dataset.b);
    setSelectedBlock(b);
    return showContextMenu(e.clientX, e.clientY, blockMenuItems(sheetIdx, b));
  }
});

// 사진 패널의 사진
function openPhotoCardMenu(e, photo, idx, listRef) {
  e.preventDefault();
  const card = e.currentTarget;
  const slot = state.selectedPhotoSlot;
  const items = [
    { label: slot ? `선택한 자리(블록 ${slot.blockIdx + 1})에 넣기` : '자리를 먼저 고르면 바로 넣을 수 있어요', disabled: !slot, onClick: () => placePhotoInSlot(slot.sheetIdx, slot.blockIdx, slot.paIdx, slot.slotIdx, photo) },
    { label: '크게 보기', onClick: () => openLightbox(listRef, idx) },
    !photo.isCropped ? { label: '잘라서 쓰기…', onClick: () => openCropEditor(listRef, idx) } : { label: '자른 사진 지우고 원본으로', onClick: () => { const b = card && card.__actionBtn; if (b) b.click(); } },
    photo.path && !photo.isCropped ? { label: 'Finder에서 보기', onClick: () => window.api.revealFile(photo.path) } : null
  ];
  showContextMenu(e.clientX, e.clientY, items);
}
