// [renderer/04-photos.js] 사진 자리·배치, 사진 패널(내 컴퓨터·MYBOX 목록), 자르기 편집기
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// --- Photo Area & Slot Rendering ---
function renderPhotoAreaCell(td, sheetIdx, blockIdx, paIdx, blockData) {
  const box = document.createElement('div');
  box.className = 'photo-area-box';

  const paState = blockData.photoAreas[paIdx];

  if (!paState || !paState.layout) {
    const emptyBtn = document.createElement('div');
    emptyBtn.className = 'photo-area-empty';
    emptyBtn.innerHTML = '<strong>사진 넣기</strong><span>왼쪽 사진을 끌어 놓거나<br/>눌러서 배치(1~4장)를 고르세요</span>';
    const sa = state.selectedPhotoArea;
    if (sa && sa.sheetIdx === sheetIdx && sa.blockIdx === blockIdx && sa.paIdx === paIdx) emptyBtn.classList.add('selected');

    emptyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedBlockIdx = blockIdx;
      state.selectedCell = null;
      state.selectedPhotoSlot = null;
      state.selectedPhotoArea = { sheetIdx, blockIdx, paIdx };
      document.querySelectorAll('.photo-area-empty.selected').forEach((x) => x.classList.remove('selected'));
      emptyBtn.classList.add('selected');
      setSelectedBlock(blockIdx, true);
      renderInspector();
    });

    emptyBtn.addEventListener('dragover', (e) => {
      e.preventDefault();
      emptyBtn.classList.add('drag-over');
    });
    emptyBtn.addEventListener('dragleave', () => emptyBtn.classList.remove('drag-over'));
    emptyBtn.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      emptyBtn.classList.remove('drag-over');
      const photo = getDraggedPhoto(e);
      if (!photo) return;
      state.selectedBlockIdx = blockIdx;
      // [UI 개편 2026-11-25] 끌어 넣으면 바로 1장 배치로 넣는다(배치는 오른쪽 패널에서 바꿈)
      setAreaLayout(sheetIdx, blockIdx, paIdx, '1x1', photo);
    });

    box.appendChild(emptyBtn);
    td.appendChild(box);
    return;
  }

  const spec = LAYOUT_SPECS[paState.layout] || LAYOUT_SPECS['1x1'];

  // Floating layout change toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'photo-area-toolbar';
  const changeBtn = document.createElement('button');
  changeBtn.textContent = `배치 ${spec.count}장`;
  changeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.selectedPhotoSlot = { sheetIdx, blockIdx, paIdx, slotIdx: 0 };
    state.selectedPhotoArea = null;
    state.selectedCell = null;
    renderActiveSheet();
  });
  toolbar.appendChild(changeBtn);
  box.appendChild(toolbar);

  // Slots grid
  const grid = document.createElement('div');
  grid.className = 'photo-slots-grid';
  grid.style.gridTemplateColumns = `repeat(${spec.cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${spec.rows}, 1fr)`;

  for (let sIdx = 0; sIdx < spec.count; sIdx++) {
    const slotEl = document.createElement('div');
    slotEl.className = 'photo-slot';
    const isSelected =
      state.selectedPhotoSlot &&
      state.selectedPhotoSlot.sheetIdx === sheetIdx &&
      state.selectedPhotoSlot.blockIdx === blockIdx &&
      state.selectedPhotoSlot.paIdx === paIdx &&
      state.selectedPhotoSlot.slotIdx === sIdx;
    if (isSelected) slotEl.classList.add('selected-slot');

    const photo = paState.slots[sIdx];
    if (photo) {
      const img = document.createElement('img');
      img.src = slotPreviewSrc(photo, img);
      img.alt = photo.name;
      slotEl.appendChild(img);
      overlaySlotAnnotations(slotEl, img, photo);

      if (photo.isCropped) {
        const tag = document.createElement('span');
        tag.className = 'slot-conv-tag';
        tag.style.background = 'rgba(16, 138, 68, 0.9)';
        tag.textContent = '크롭';
        slotEl.appendChild(tag);
      } else if (photo.conversionBadge) {
        const tag = document.createElement('span');
        tag.className = 'slot-conv-tag';
        tag.textContent = photo.conversionBadge;
        slotEl.appendChild(tag);
      }

      const remBtn = document.createElement('button');
      remBtn.className = 'slot-remove-btn';
      remBtn.textContent = '×';
      remBtn.title = '사진 삭제';
      remBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removePhotoFromSlot(sheetIdx, blockIdx, paIdx, sIdx);
      });
      slotEl.appendChild(remBtn);

      // [사진 자리 크롭 2026-11-25] 넣은 뒤에도 자리에서 바로 다시 자른다(원본에서 다시 자르므로 화질 손실 없음)
      const slotActs = document.createElement('div');
      slotActs.className = 'slot-actions';
      const target = { sheetIdx, blockIdx, paIdx, slotIdx: sIdx };
      const cropBtn = document.createElement('button');
      cropBtn.className = 'slot-crop-btn';
      cropBtn.textContent = photo.isCropped ? '다시 크롭' : '크롭';
      cropBtn.title = '이 자리의 사진만 자릅니다. 원본 파일은 그대로입니다.';
      cropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSlotCropEditor(target);
      });
      slotActs.appendChild(cropBtn);
      const annoBtn = document.createElement('button');
      annoBtn.className = 'slot-anno-btn';
      annoBtn.textContent = photo.annotations && photo.annotations.length ? `표시 ${photo.annotations.length}` : '표시';
      annoBtn.title = '사진 위에 화살표·네모·글상자 넣기';
      annoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedPhotoSlot = target;
        openAnnotationEditor(target);
      });
      slotActs.appendChild(annoBtn);
      if (photo.isCropped) {
        const origBtn = document.createElement('button');
        origBtn.className = 'slot-uncrop-btn';
        origBtn.textContent = '원본';
        origBtn.title = '이 자리를 자르기 전 사진으로 되돌립니다.';
        origBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          revertSlotCrop(target);
        });
        slotActs.appendChild(origBtn);
      }
      slotEl.appendChild(slotActs);
    } else {
      const ph = document.createElement('div');
      ph.className = 'slot-placeholder';
      ph.textContent = `슬롯 ${sIdx + 1}`;
      slotEl.appendChild(ph);
    }

    slotEl.addEventListener('click', (e) => {
      e.stopPropagation();
      // 첫 클릭이 다시 그려 칸 요소가 바뀌므로 dblclick 대신 클릭 횟수(e.detail)로 더블클릭을 잡는다
      if (e.detail === 2 && photo) {
        openSlotCropEditor({ sheetIdx, blockIdx, paIdx, slotIdx: sIdx });
        return;
      }
      state.selectedBlockIdx = blockIdx;
      state.selectedCell = null;
      state.selectedPhotoArea = null;
      state.selectedPhotoSlot = { sheetIdx, blockIdx, paIdx, slotIdx: sIdx };
      renderActiveSheet();
    });

    slotEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      slotEl.classList.add('drag-over');
    });
    slotEl.addEventListener('dragleave', () => slotEl.classList.remove('drag-over'));
    slotEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      slotEl.classList.remove('drag-over');
      const dragged = getDraggedPhoto(e);
      if (!dragged) return;
      placePhotoInSlot(sheetIdx, blockIdx, paIdx, sIdx, dragged);
    });

    grid.appendChild(slotEl);
  }

  box.appendChild(grid);
  td.appendChild(box);
}

function getDraggedPhoto(dragEvent) {
  const idxStr = dragEvent.dataTransfer.getData('text/photo-index');
  if (idxStr === '') return null;
  const idx = parseInt(idxStr, 10);
  const src = dragEvent.dataTransfer.getData('text/photo-source') || state.photoSource;
  const list = src === 'mybox' ? state.mybox.files : state.photos;
  return list[idx] || null;
}

// --- Layout Picker Logic ---
function openLayoutModal(sheetIdx, blockIdx, paIdx, draggedPhoto) {
  state.pendingLayoutTarget = { sheetIdx, blockIdx, paIdx, draggedPhoto };
  el.layoutModal.classList.add('open');
}

function applyLayoutSelection(layoutKey) {
  const target = state.pendingLayoutTarget;
  if (!target) return;
  const { sheetIdx, blockIdx, paIdx, draggedPhoto } = target;
  const sheet = state.editor.sheets[sheetIdx];
  const blockData = sheet.blocks[blockIdx];
  const existing = blockData.photoAreas[paIdx];
  const spec = LAYOUT_SPECS[layoutKey];
  if (!spec) return;

  const oldSlots = existing && Array.isArray(existing.slots) ? existing.slots : [];
  const willRecord = true;
  const overflowPhotos = oldSlots.slice(spec.count).filter(Boolean);
  if (overflowPhotos.length > 0) {
    if (!confirm(`레이아웃을 ${spec.label}로 바꾸면 넘치는 사진 ${overflowPhotos.length}장이 지워집니다. 계속할까요?`)) {
      return;
    }
  }

  if (willRecord) recordUndo(target.draggedPhoto ? '사진 넣기' : '사진 배치 바꾸기');
  const newSlots = new Array(spec.count).fill(null);
  for (let i = 0; i < Math.min(oldSlots.length, spec.count); i++) {
    newSlots[i] = oldSlots[i];
  }

  if (draggedPhoto) {
    if (draggedPhoto.source === 'mybox' && !draggedPhoto.path && !draggedPhoto.isCropped) {
      blockData.photoAreas[paIdx] = { layout: layoutKey, slots: newSlots };
      state.selectedPhotoSlot = { sheetIdx, blockIdx, paIdx, slotIdx: 0 };
      state.selectedCell = null;
      state.pendingLayoutTarget = null;
      el.layoutModal.classList.remove('open');
      renderActiveSheet();
      ensureMyboxPhotoReady(draggedPhoto).then((ready) => {
        if (ready) placePhotoInSlot(sheetIdx, blockIdx, paIdx, 0, ready);
      });
      return;
    }
    newSlots[0] = { ...draggedPhoto };
  }

  blockData.photoAreas[paIdx] = { layout: layoutKey, slots: newSlots };
  state.selectedPhotoSlot = { sheetIdx, blockIdx, paIdx, slotIdx: 0 };
  state.selectedPhotoArea = null;
  state.selectedCell = null;
  state.pendingLayoutTarget = null;
  el.layoutModal.classList.remove('open');

  renderActiveSheet();
  refreshSizeEstimate();
  renderPhotoPanel();
}

async function placePhotoInSlot(sheetIdx, blockIdx, paIdx, slotIdx, photo) {
  const sheet = state.editor.sheets[sheetIdx];
  const paState = sheet.blocks[blockIdx].photoAreas[paIdx];
  if (!paState) return;
  let finalPhoto = photo;
  if (photo && photo.source === 'mybox' && !photo.path && !photo.isCropped) {
    finalPhoto = await ensureMyboxPhotoReady(photo);
    if (!finalPhoto) return;
  }
  recordUndo('사진 넣기');
  paState.slots[slotIdx] = { ...finalPhoto };
  state.selectedPhotoSlot = { sheetIdx, blockIdx, paIdx, slotIdx };
  state.selectedCell = null;
  renderActiveSheet();
  refreshSizeEstimate();
  renderPhotoPanel();
}

// [사진 크기 수정 2026-11-25] 사진 자리에는 240px 썸네일 대신 긴 변 1200px 미리보기를 자리 크기에 맞춰 보여 준다.
function slotPreviewSrc(photo, img) {
  if (photo.isCropped) return photo.thumbUrl;
  if (photo.previewUrl) return photo.previewUrl;
  if (photo.path && window.api.getSlotPreview) {
    window.api.getSlotPreview(photo.path).then((url) => {
      if (!url) return;
      photo.previewUrl = url;
      if (img.isConnected) img.src = url;
      // 같은 사진을 넣은 다른 자리·패널 항목도 다음 그리기에서 바로 쓰도록 남긴다
      for (const list of [state.photos, state.mybox.files]) {
        for (const p of list || []) if (p.path === photo.path && !p.isCropped) p.previewUrl = url;
      }
    }).catch(() => {});
  }
  return photo.thumbUrl || `file://${encodeURI(photo.path)}`;
}

function slotPhotoAt(t) {
  const pa = state.editor.sheets[t.sheetIdx].blocks[t.blockIdx].photoAreas[t.paIdx];
  return pa && pa.slots ? pa.slots[t.slotIdx] : null;
}

function uncroppedCopy(photo) {
  const restored = { ...photo };
  delete restored.croppedDataBase64;
  delete restored.croppedKey;
  delete restored.croppedWidth;
  delete restored.croppedHeight;
  delete restored.cropRect;
  delete restored.rotation;
  restored.isCropped = false;
  restored.name = photo.originalName || photo.name;
  restored.thumbUrl = photo.originalThumbUrl || photo.thumbUrl;
  restored.conversionBadge = photo.originalConversionBadge || null;
  if (photo.originalSizeBytes !== undefined) restored.sizeBytes = photo.originalSizeBytes;
  return restored;
}

function openSlotCropEditor(target) {
  const photo = slotPhotoAt(target);
  if (!photo) return;
  if (!photo.path) {
    showToast('이 사진의 원본 파일을 찾을 수 없어 자를 수 없어요.');
    return;
  }
  openCropEditor(null, -1, { slot: target, photo });
}

function revertSlotCrop(target) {
  const pa = state.editor.sheets[target.sheetIdx].blocks[target.blockIdx].photoAreas[target.paIdx];
  const photo = pa && pa.slots[target.slotIdx];
  if (!photo || !photo.isCropped) return;
  recordUndo('자르기 되돌리기');
  pa.slots[target.slotIdx] = uncroppedCopy(photo);
  renderActiveSheet();
  refreshSizeEstimate();
  showToast('이 자리를 자르기 전 사진으로 되돌렸어요.');
}

function removePhotoFromSlot(sheetIdx, blockIdx, paIdx, slotIdx) {
  const sheet = state.editor.sheets[sheetIdx];
  const paState = sheet.blocks[blockIdx].photoAreas[paIdx];
  if (!paState || !paState.slots[slotIdx]) return;
  if (!confirm('이 슬롯의 사진을 삭제할까요?')) return;
  recordUndo('사진 빼기');
  paState.slots[slotIdx] = null;
  renderActiveSheet();
  refreshSizeEstimate();
  renderPhotoPanel();
}

// --- Photo Panel (Stage 1 Local Folder + Stage 2 A Crop + Stage 2 B MYBOX) ---
function switchPhotoSource(source) {
  state.photoSource = source;
  el.sourceTabLocal.classList.toggle('active', source === 'local');
  el.sourceTabMybox.classList.toggle('active', source === 'mybox');
  el.localControls.style.display = source === 'local' ? '' : 'none';
  el.myboxControls.style.display = source === 'mybox' ? '' : 'none';
  renderPhotoPanel();
  if (source === 'mybox' && !state.mybox.loading && !state.mybox.folders.length && !state.mybox.files.length) {
    loadMyboxCurrentFolder();
  }
}

function createPhotoCardElement(photo, idx, sourceKey, listRef) {
  const item = document.createElement('div');
  item.className = 'photo-item';
  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'photo-zoom-btn';
  zoomBtn.title = '크게 보기';
  zoomBtn.textContent = '⤢';
  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openLightbox(listRef, idx);
  });
  item.appendChild(zoomBtn);
  // [UI 개편 2026-11-25] 이미 넣은 사진은 몇 곳에 넣었는지 표시
  const used = countPhotoUses(photo);
  if (used) {
    const ub = document.createElement('span');
    ub.className = 'used-badge';
    ub.textContent = `넣음 ${used}`;
    item.appendChild(ub);
  }
  item.draggable = true;

  const wrap = document.createElement('div');
  wrap.className = 'photo-thumb-wrap';
  if (photo.path && !photo.isCropped) wrap.dataset.path = photo.path;
  if (photo.thumbUrl) {
    const img = document.createElement('img');
    img.src = photo.thumbUrl;
    img.alt = photo.name;
    img.loading = 'lazy';
    wrap.appendChild(img);
  } else if (photo.downloading) {
    wrap.innerHTML = '<span style="font-size:10px;color:var(--ink-muted);">다운로드 중...</span>';
  } else if (photo.source !== 'mybox' && photo.path) {
    wrap.innerHTML = '<span class="thumb-wait">미리보기 만드는 중…</span>';
  } else {
    wrap.textContent = photo.ext || 'IMG';
  }
  item.appendChild(wrap);

  if (photo.isCropped) {
    const cb = document.createElement('span');
    cb.className = 'crop-badge';
    cb.textContent = '크롭';
    item.appendChild(cb);
  }

  if (photo.conversionBadge && !photo.isCropped) {
    const b = document.createElement('span');
    b.className = 'conv-badge';
    b.textContent = photo.conversionBadge;
    item.appendChild(b);
  }

  if (sourceKey === 'mybox' && photo.cached && !photo.isCropped) {
    const cacheB = document.createElement('span');
    cacheB.className = 'cache-badge';
    cacheB.textContent = '캐시';
    item.appendChild(cacheB);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'photo-name';
  nameEl.textContent = photo.name;
  nameEl.title = photo.name;
  item.appendChild(nameEl);

  // Stage 2 A: [크롭] button on original photos, [원본으로 되돌리기] on cropped copies
  const actionsRow = document.createElement('div');
  actionsRow.className = 'photo-card-actions';
  if (photo.isCropped) {
    const revertBtn = document.createElement('button');
    revertBtn.textContent = '원본으로 되돌리기';
    revertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // [검증 후속 수정 2026-11-24] 이 크롭본을 이미 넣은 슬롯도 원본 사진으로 되돌린다
      const placed = [];
      for (const sh of (state.editor && state.editor.sheets) || []) {
        for (const blk of sh.blocks || []) {
          for (const pa of Object.values(blk.photoAreas || {})) {
            (pa && pa.slots ? pa.slots : []).forEach((sl, si) => {
              if (sl && sl.isCropped && sl.croppedKey === photo.croppedKey) placed.push([pa, si]);
            });
          }
        }
      }
      if (placed.length && !confirm(`이 크롭본을 넣은 사진 자리 ${placed.length}곳도 원본 사진으로 바뀝니다. 계속할까요?`)) {
        return;
      }
      for (const [pa, si] of placed) {
        pa.slots[si] = uncroppedCopy(pa.slots[si]);
      }
      listRef.splice(idx, 1);
      renderPhotoPanel();
      if (placed.length) {
        renderActiveSheet();
        refreshSizeEstimate();
      }
      showToast(placed.length ? `크롭본을 없애고 사진 자리 ${placed.length}곳을 원본으로 되돌렸어요.` : '크롭본을 없애고 원본 사진으로 되돌렸어요.');
    });
    actionsRow.appendChild(revertBtn);
  } else {
    const cropBtn = document.createElement('button');
    cropBtn.textContent = '크롭';
    cropBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCropEditor(listRef, idx);
    });
    actionsRow.appendChild(cropBtn);
  }
  item.appendChild(actionsRow);

  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/photo-index', String(idx));
    e.dataTransfer.setData('text/photo-source', sourceKey);
    e.dataTransfer.effectAllowed = 'copy';
  });

  // Double-click to open crop editor (non-cropped photos)
  item.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (!photo.isCropped) {
      openCropEditor(listRef, idx);
    }
  });

  // Click photo in panel -> Stage 1 Q4 & normal cell guard
  item.addEventListener('click', () => {
    if (state.selectedPhotoSlot) {
      const { sheetIdx, blockIdx, paIdx, slotIdx } = state.selectedPhotoSlot;
      placePhotoInSlot(sheetIdx, blockIdx, paIdx, slotIdx, photo);
    } else if (state.selectedCell && state.selectedCell.isNormalCell) {
      showToast('사진은 사진 영역에만 넣을 수 있어요');
    } else {
      showToast('사진 넣을 자리를 먼저 선택해 주세요');
    }
  });

  return item;
}

function countPhotoUses(photo) {
  if (!state.editor || !photo || photo.isCropped) return 0;
  let n = 0;
  for (const sh of state.editor.sheets) {
    for (const blk of sh.blocks || []) {
      for (const pa of Object.values(blk.photoAreas || {})) {
        // 자르거나 돌린 사진도 원본을 쓴 것으로 센다
        for (const sl of (pa && pa.slots) || []) if (sl && photo.path && (sl.path === photo.path || sl.originalPath === photo.path)) n++;
      }
    }
  }
  return n;
}

function renderPhotoPanel() {
  if (state.photoSource === 'mybox') {
    renderMyboxPanel();
    return;
  }

  el.photoCountBadge.textContent = `${state.photos.length}장`;
  el.folderPathText.textContent = state.photoFolder || '선택된 폴더 없음';
  el.refreshFolderBtn.disabled = !state.photoFolder;

  el.photoGrid.innerHTML = '';
  if (!state.photos.length) {
    el.photoGrid.innerHTML = `<div class="photo-empty">${
      state.photoFolder
        ? '이 폴더에 지원하는 사진 파일이 없습니다.'
        : '[폴더 열기]로 사진 폴더를 고르세요.<br/>JPG · PNG · HEIC · WEBP · TIFF'
    }</div>`;
    return;
  }

  let shown = 0;
  state.photos.forEach((photo, idx) => {
    if (state.photoFilterUnused && state.editor && isPhotoUsed(photo)) return;
    el.photoGrid.appendChild(createPhotoCardElement(photo, idx, 'local', state.photos));
    shown++;
  });
  if (!shown) el.photoGrid.innerHTML = '<div class="photo-empty">모든 사진을 이미 넣었어요. [안 넣은 것만]을 끄면 전체가 보여요.</div>';
  if (el.photoCountBadge) el.photoCountBadge.textContent = state.photoFilterUnused ? `${shown} / ${state.photos.length}장` : `${state.photos.length}장`;
}

// [2026-11-26] 사진 순서: 이름순·시간순 × 오름·내림 (내 컴퓨터·MYBOX 같이), 보기 열 수 1~4
const photoView = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('phoditor.photoView') || '{}') || {}; } catch (_) {}
  return { key: saved.key === 'time' ? 'time' : 'name', dir: saved.dir === 'desc' ? 'desc' : 'asc', cols: [1, 2, 3, 4].includes(saved.cols) ? saved.cols : 2 };
})();
function savePhotoView() {
  try { localStorage.setItem('phoditor.photoView', JSON.stringify(photoView)); } catch (_) {}
}
function photoTimeOf(p) {
  if (p.takenAt) return p.takenAt;
  const t = Date.parse(p.modifiedKey || '');
  return Number.isFinite(t) ? t : 0;
}
function sortPhotoList(list) {
  const sign = photoView.dir === 'desc' ? -1 : 1;
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko', { numeric: true });
  list.sort((a, b) => sign * (photoView.key === 'time' ? (photoTimeOf(a) - photoTimeOf(b)) || byName(a, b) : byName(a, b)));
  return list;
}
function applyPhotoSort() {
  sortPhotoList(state.photos);
  sortPhotoList(state.mybox.files);
  const sign = photoView.dir === 'desc' ? -1 : 1;
  state.mybox.folders.sort((a, b) => sign * String(a.name).localeCompare(String(b.name), 'ko', { numeric: true }));
}
function syncPhotoViewControls() {
  el.photoSortSel.value = photoView.key;
  el.photoSortDirBtn.textContent = photoView.dir === 'desc' ? '↓ 내림' : '↑ 오름';
  el.photoSortDirBtn.title = photoView.dir === 'desc'
    ? `내림차순 (${photoView.key === 'time' ? '최근 것 먼저' : 'ㅎ→ㄱ, 9→1'}) · 누르면 오름차순`
    : `오름차순 (${photoView.key === 'time' ? '오래된 것 먼저' : 'ㄱ→ㅎ, 1→9'}) · 누르면 내림차순`;
  el.photoGrid.style.setProperty('--photo-cols', String(photoView.cols));
  el.photoGrid.dataset.cols = String(photoView.cols);
  for (const b of el.photoColsSeg.querySelectorAll('button')) b.classList.toggle('active', Number(b.dataset.cols) === photoView.cols);
}

function renderMyboxPanel() {
  const mb = state.mybox;
  el.myboxCountBadge.textContent = `${mb.files.length}장`;
  const pathNames = mb.folderStack.map((f) => f.name);
  el.myboxPathText.textContent = pathNames.length > 1 ? '/' + pathNames.slice(1).join('/') : '/ (루트)';
  el.myboxUpBtn.disabled = mb.folderStack.length <= 1 || mb.loading;

  el.photoGrid.innerHTML = '';

  if (mb.loading) {
    el.photoGrid.innerHTML = '<div class="photo-empty">MYBOX 목록을 불러오는 중...</div>';
    return;
  }

  if (mb.error) {
    const errBox = document.createElement('div');
    errBox.className = 'mybox-error-box';
    const detail = mb.error.status || mb.error.serverMessage
      ? `<div style="font-size:11px;opacity:0.85;">상태: ${mb.error.status || '네트워크 오류'} ${mb.error.serverMessage ? '(' + mb.error.serverMessage + ')' : ''}</div>`
      : '';
    errBox.innerHTML = `
      <strong>${mb.error.message || 'MYBOX 연결이 안 돼요. 토큰을 다시 확인해줘'}</strong>
      ${detail}
    `;
    const goSettingsBtn = document.createElement('button');
    goSettingsBtn.className = 'primary';
    goSettingsBtn.textContent = mb.error.expired ? '새 토큰 넣기' : 'MYBOX 설정으로 이동';
    goSettingsBtn.addEventListener('click', openSettingsModal);
    errBox.appendChild(goSettingsBtn);
    el.photoGrid.appendChild(errBox);
    return;
  }

  if (!mb.folders.length && !mb.files.length) {
    el.photoGrid.innerHTML = '<div class="photo-empty">이 폴더에 하위 폴더나 지원하는 이미지 파일이 없습니다.</div>';
    return;
  }

  // Folders always first
  for (const folder of mb.folders) {
    const fBtn = document.createElement('button');
    fBtn.className = 'mybox-folder-item';
    fBtn.textContent = `📁 ${folder.name}`;
    fBtn.addEventListener('click', () => {
      mb.folderStack.push({ id: folder.resourceId, name: folder.name });
      loadMyboxCurrentFolder();
    });
    el.photoGrid.appendChild(fBtn);
  }

  // Image files in the exact same thumbnail grid
  let shown = 0;
  mb.files.forEach((photo, idx) => {
    if (state.photoFilterUnused && state.editor && isPhotoUsed(photo)) return;
    el.photoGrid.appendChild(createPhotoCardElement(photo, idx, 'mybox', mb.files));
    shown++;
  });
  if (state.photoFilterUnused) el.myboxCountBadge.textContent = `${shown} / ${mb.files.length}장`;
}

async function loadMyboxCurrentFolder() {
  const mb = state.mybox;
  const seq = ++mb.loadSeq;
  const cur = mb.folderStack[mb.folderStack.length - 1];
  mb.loading = true;
  mb.error = null;
  if (state.photoSource === 'mybox') renderPhotoPanel();

  const res = await window.api.myboxListFolder(cur ? cur.id : null);
  if (seq !== mb.loadSeq) return; // stale navigation

  mb.loading = false;
  if (!res.ok) {
    mb.folders = [];
    mb.files = [];
    mb.error = {
      message: res.message || 'MYBOX 연결이 안 돼요. 토큰을 다시 확인해줘',
      status: res.status,
      serverMessage: res.serverMessage,
      isAuthError: res.isAuthError,
      expired: res.expired
    };
    refreshMyboxStatus();
    if (state.photoSource === 'mybox') renderPhotoPanel();
    return;
  }

  mb.folders = res.folders || [];
  mb.files = res.files || [];
  applyPhotoSort();
  refreshMyboxStatus();
  if (state.photoSource === 'mybox') renderPhotoPanel();

  // Background download + local thumbnail generation (sips) for uncached photos (concurrency 3)
  prefetchMyboxThumbnails(seq);
}

// [검증 후속 수정 2026-11-24] 썸네일용 자동 다운로드는 폴더당 앞쪽 MYBOX_PREFETCH_LIMIT장까지만 한다.
// 나머지는 클릭·드래그·크롭할 때 받는다. 일일 다운로드 한도(429)나 인증 실패가 나면 자동 다운로드를 멈춘다.
const MYBOX_PREFETCH_LIMIT = 60;

async function prefetchMyboxThumbnails(seq) {
  const pending = state.mybox.files.filter((f) => !f.cached && !f.isCropped && !f.downloading);
  const queue = pending.slice(0, MYBOX_PREFETCH_LIMIT);
  if (pending.length > queue.length) {
    showToast(`사진이 많아 앞쪽 ${queue.length}장만 미리 받아요. 나머지는 고를 때 받습니다.`);
  }
  const workers = 3;
  let cursor = 0;
  let stopped = false;

  async function worker() {
    while (!stopped && cursor < queue.length) {
      if (seq !== state.mybox.loadSeq) return;
      const target = queue[cursor++];
      if (!target || target.cached) continue;
      await ensureMyboxPhotoReady(target, { silent: true, expectedSeq: seq });
      const err = target.lastError;
      if (err && (err.status === 429 || err.isAuthError)) {
        if (!stopped) {
          stopped = true;
          showToast(err.message || 'MYBOX 자동 다운로드를 멈췄어요.');
          if (err.isAuthError) {
            state.mybox.error = err;
            renderPhotoPanel();
          }
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, () => worker()));
}

async function ensureMyboxPhotoReady(photo, { silent = false, expectedSeq = null } = {}) {
  if (!photo) return null;
  if (photo.path && photo.cached) return photo;
  if (photo._downloadPromise) return photo._downloadPromise;

  photo.downloading = true;
  if (state.photoSource === 'mybox') renderPhotoPanel();

  photo._downloadPromise = (async () => {
    try {
      const res = await window.api.myboxDownloadPhoto({
        resourceId: photo.resourceId,
        name: photo.name,
        modifiedKey: photo.modifiedKey
      });
      photo.downloading = false;
      photo.lastError = res.ok ? null : res;
      if (!res.ok) {
        if (!silent) {
          showToast(res.message || 'MYBOX 사진 다운로드에 실패했어요.');
          if (res.isAuthError) {
            state.mybox.error = res;
            renderPhotoPanel();
          }
        }
        return null;
      }
      photo.path = res.localPath;
      photo.thumbUrl = res.thumbUrl;
      photo.sizeBytes = res.sizeBytes;
      photo.cached = true;
      photo.conversionBadge = res.conversionBadge;
      if (expectedSeq === null || expectedSeq === state.mybox.loadSeq) {
        if (state.photoSource === 'mybox') renderPhotoPanel();
      }
      return photo;
    } finally {
      photo.downloading = false;
      photo._downloadPromise = null;
    }
  })();

  return photo._downloadPromise;
}

// --- Stage 2 A: Pre-placement Crop Editor (Free Aspect Ratio, Clamped, JPEG 95+) ---
async function openCropEditor(listRef, photoIdx, slotTarget = null) {
  let photo = slotTarget ? slotTarget.photo : listRef[photoIdx];
  if (!photo || (!slotTarget && photo.isCropped)) return;

  if (photo.source === 'mybox' && !photo.path) {
    showToast('MYBOX 사진을 다운로드 중입니다...');
    photo = await ensureMyboxPhotoReady(photo);
    if (!photo) return;
  }

  try {
    const prepared = await window.api.preparePhotoForCrop(photo.path);
    state.cropSession = {
      listRef,
      photoIdx,
      photo,
      slot: slotTarget ? slotTarget.slot : null,
      natW: prepared.width,
      natH: prepared.height,
      rect: null, // display pixel coordinates relative to cropImage
      drag: null
    };
    el.cropSelection.style.display = 'none';
    el.cropImage.onload = () => {
      const dispW = el.cropImage.clientWidth;
      const dispH = el.cropImage.clientHeight;
      const prev = photo.isCropped && photo.cropRect;
      if (prev && prepared.width) {
        // 다시 자를 때는 지난번 고른 영역에서 시작한다(원본 좌표 → 화면 좌표)
        const k = dispW / prepared.width;
        state.cropSession.rect = { x: prev.x * k, y: prev.y * k, w: prev.w * k, h: prev.h * k };
      } else {
        // Default initial selection: 80% centered box
        const padX = Math.round(dispW * 0.1);
        const padY = Math.round(dispH * 0.1);
        state.cropSession.rect = {
          x: padX,
          y: padY,
          w: Math.max(20, dispW - padX * 2),
          h: Math.max(20, dispH - padY * 2)
        };
      }
      renderCropSelection();
    };
    el.cropImage.src = prepared.dataUrl;
    el.cropModal.classList.add('open');
  } catch (err) {
    showToast(`크롭 편집기를 열 수 없습니다: ${err.message || err}`);
  }
}

function clampCropRect(rect, maxW, maxH) {
  const minSize = 16;
  let w = Math.max(minSize, Math.min(rect.w, maxW));
  let h = Math.max(minSize, Math.min(rect.h, maxH));
  let x = Math.max(0, Math.min(rect.x, maxW - w));
  let y = Math.max(0, Math.min(rect.y, maxH - h));
  return { x, y, w, h };
}

function renderCropSelection() {
  const sess = state.cropSession;
  if (!sess || !sess.rect) return;
  const dispW = el.cropImage.clientWidth || 1;
  const dispH = el.cropImage.clientHeight || 1;
  sess.rect = clampCropRect(sess.rect, dispW, dispH);

  el.cropSelection.style.display = 'block';
  el.cropSelection.style.left = `${sess.rect.x}px`;
  el.cropSelection.style.top = `${sess.rect.y}px`;
  el.cropSelection.style.width = `${sess.rect.w}px`;
  el.cropSelection.style.height = `${sess.rect.h}px`;

  const natW = Math.max(1, Math.round((sess.rect.w / dispW) * sess.natW));
  const natH = Math.max(1, Math.round((sess.rect.h / dispH) * sess.natH));
  el.cropInfoText.textContent = `원본 ${sess.natW}×${sess.natH} → 크롭 ${natW}×${natH} px (자유 비율 · JPEG 품질 95+)`;
}

function startCropDrag(e) {
  const sess = state.cropSession;
  if (!sess) return;
  e.preventDefault();
  const stageRect = el.cropImage.getBoundingClientRect();
  const px = Math.max(0, Math.min(e.clientX - stageRect.left, stageRect.width));
  const py = Math.max(0, Math.min(e.clientY - stageRect.top, stageRect.height));

  const handle = e.target && e.target.getAttribute ? e.target.getAttribute('data-handle') : null;
  if (handle) {
    sess.drag = { mode: handle, startX: px, startY: py, origRect: { ...sess.rect } };
  } else if (e.target === el.cropSelection) {
    sess.drag = { mode: 'move', startX: px, startY: py, origRect: { ...sess.rect } };
  } else {
    // Draw new free-ratio box anywhere inside the image
    sess.drag = { mode: 'new', startX: px, startY: py, origRect: { x: px, y: py, w: 16, h: 16 } };
    sess.rect = { x: px, y: py, w: 16, h: 16 };
    renderCropSelection();
  }
}

function moveCropDrag(e) {
  const sess = state.cropSession;
  if (!sess || !sess.drag) return;
  const stageRect = el.cropImage.getBoundingClientRect();
  const maxW = stageRect.width;
  const maxH = stageRect.height;
  const px = Math.max(0, Math.min(e.clientX - stageRect.left, maxW));
  const py = Math.max(0, Math.min(e.clientY - stageRect.top, maxH));
  const d = sess.drag;
  const dx = px - d.startX;
  const dy = py - d.startY;
  const o = d.origRect;

  if (d.mode === 'new') {
    const x1 = Math.min(d.startX, px);
    const y1 = Math.min(d.startY, py);
    const x2 = Math.max(d.startX, px);
    const y2 = Math.max(d.startY, py);
    sess.rect = { x: x1, y: y1, w: Math.max(16, x2 - x1), h: Math.max(16, y2 - y1) };
  } else if (d.mode === 'move') {
    sess.rect = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
  } else if (d.mode === 'se') {
    sess.rect = { x: o.x, y: o.y, w: Math.max(16, o.w + dx), h: Math.max(16, o.h + dy) };
  } else if (d.mode === 'sw') {
    const right = o.x + o.w;
    const newX = Math.max(0, Math.min(o.x + dx, right - 16));
    sess.rect = { x: newX, y: o.y, w: right - newX, h: Math.max(16, o.h + dy) };
  } else if (d.mode === 'ne') {
    const bottom = o.y + o.h;
    const newY = Math.max(0, Math.min(o.y + dy, bottom - 16));
    sess.rect = { x: o.x, y: newY, w: Math.max(16, o.w + dx), h: bottom - newY };
  } else if (d.mode === 'nw') {
    const right = o.x + o.w;
    const bottom = o.y + o.h;
    const newX = Math.max(0, Math.min(o.x + dx, right - 16));
    const newY = Math.max(0, Math.min(o.y + dy, bottom - 16));
    sess.rect = { x: newX, y: newY, w: right - newX, h: bottom - newY };
  }
  renderCropSelection();
}

function endCropDrag() {
  if (state.cropSession) state.cropSession.drag = null;
}

// [검증 후속 수정 2026-11-24] 자르기는 메인 프로세스에서 원본 해상도로 한다(sips, JPEG 품질 96).
// 렌더러는 줄인 미리보기에서 영역만 고르고, 원본 좌표로 바꿔 보낸다.
async function confirmCrop() {
  const sess = state.cropSession;
  if (!sess || !sess.rect || sess.busy) return;
  const dispW = el.cropImage.clientWidth || 1;
  const dispH = el.cropImage.clientHeight || 1;

  const sx = Math.max(0, Math.round((sess.rect.x / dispW) * sess.natW));
  const sy = Math.max(0, Math.round((sess.rect.y / dispH) * sess.natH));
  const sw = Math.max(1, Math.min(sess.natW - sx, Math.round((sess.rect.w / dispW) * sess.natW)));
  const sh = Math.max(1, Math.min(sess.natH - sy, Math.round((sess.rect.h / dispH) * sess.natH)));

  sess.busy = true;
  let res;
  try {
    const keepRot = sess.slot ? sess.photo.rotation || 0 : 0;
    res = keepRot
      ? await window.api.transformPhoto({ filePath: sess.photo.path, rect: { x: sx, y: sy, w: sw, h: sh }, rotation: keepRot })
      : await window.api.cropPhoto({ filePath: sess.photo.path, rect: { x: sx, y: sy, w: sw, h: sh } });
  } catch (err) {
    sess.busy = false;
    showToast(`크롭본을 만들지 못했어요: ${err.message || err}`);
    return;
  }
  if (!res || !res.ok) {
    sess.busy = false;
    showToast(`크롭본을 만들지 못했어요: ${(res && res.error) || '알 수 없는 오류'}`);
    return;
  }

  const b64 = res.base64;
  const byteLen = res.sizeBytes;
  const base = sess.photo.isCropped ? uncroppedCopy(sess.photo) : sess.photo;
  const croppedPhoto = {
    ...base,
    name: `[크롭] ${base.name}`,
    originalName: base.name,
    originalThumbUrl: base.thumbUrl,
    originalConversionBadge: base.conversionBadge || null,
    originalSizeBytes: base.sizeBytes,
    cropRect: { x: sx, y: sy, w: sw, h: sh },
    rotation: (sess.slot && sess.photo.rotation) || undefined,
    // [2026-11-26] 다시 자르면 사진 위 표시를 새 영역 기준으로 옮긴다(영역 밖으로 나간 표시는 뺌)
    annotations: sess.slot && sess.photo.annotations && sess.photo.annotations.length
      ? transformAnnotations(
          sess.photo.annotations,
          { rect: sess.photo.cropRect || { x: 0, y: 0, w: sess.natW, h: sess.natH }, rot: sess.photo.rotation || 0 },
          { rect: { x: sx, y: sy, w: sw, h: sh }, rot: sess.photo.rotation || 0 }
        )
      : undefined,
    previewUrl: undefined,
    isCropped: true,
    croppedDataBase64: b64,
    croppedKey: `crop_${Date.now()}_${b64.slice(0, 16)}_${byteLen}`,
    croppedWidth: res.width,
    croppedHeight: res.height,
    sizeBytes: byteLen,
    thumbUrl: res.thumbDataUrl,
    conversionBadge: null
  };

  if (sess.slot) {
    // 사진 자리에서 연 크롭: 그 자리만 바꾼다. 사진 패널과 다른 자리는 그대로.
    const t = sess.slot;
    const pa = state.editor.sheets[t.sheetIdx].blocks[t.blockIdx].photoAreas[t.paIdx];
    recordUndo('사진 자르기');
    if (pa && pa.slots) pa.slots[t.slotIdx] = croppedPhoto;
    state.cropSession = null;
    el.cropModal.classList.remove('open');
    renderActiveSheet();
    refreshSizeEstimate();
    showToast(`이 자리 사진을 ${res.width}×${res.height}로 잘랐어요. [원본]으로 되돌릴 수 있어요.`);
    return;
  }

  // Insert cropped copy right after original (original remains untouched)
  sess.listRef.splice(sess.photoIdx + 1, 0, croppedPhoto);

  state.cropSession = null;
  el.cropModal.classList.remove('open');
  renderPhotoPanel();
  showToast(`크롭본(${res.width}×${res.height})을 사진 패널에 추가했어요.`);
}

function cancelCrop() {
  state.cropSession = null;
  el.cropModal.classList.remove('open');
}
