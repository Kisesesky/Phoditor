// [renderer/02-catalog-editor.js] 시작 화면(양식 고르기), 양식 열기, 번호 계산, 시트 탭, 블록 추가·삭제
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// --- Screen 1: Catalog ---
async function initCatalog() {
  state.catalog = await window.api.getCatalog();
  await loadPreviewFonts();
  state.selectedType = state.catalog.types[0];
  renderCatalog();
  renderStartExtras();
  // [PLAN 주제 4] 앱을 열면 저장 안 한 작업(자동 저장본)을 묻지 않고 이어서 연다
  try {
    const auto = await window.api.autosaveRead();
    if (auto && auto.editor) {
      await restoreProject(auto, null);
      docState.filePath = auto.autosaveOf || null;
      markDirty();
      updateDocTitle();
      showToast('저장하지 않은 지난 작업을 이어서 열었어요. 다 하면 저장해 주세요.', 4500);
    }
  } catch (_) {}
}

function renderCatalog() {
  const { types, companies, available } = state.catalog;
  el.typeTabs.innerHTML = '';
  for (const t of types) {
    const btn = document.createElement('button');
    btn.className = 'type-btn' + (state.selectedType === t ? ' selected' : '');
    const cnt = companies.filter((c) => available[`${t}__${c}`]).length;
    btn.innerHTML = `${t}<span class="cnt">${cnt}</span>`;
    if (!cnt) {
      btn.classList.add('empty-type');
      btn.title = '아직 이 종류의 양식이 없어요(새 원본이 오면 추가)';
    }
    btn.addEventListener('click', () => {
      state.selectedType = t;
      renderCatalog();
    });
    el.typeTabs.appendChild(btn);
  }

  el.companyGrid.innerHTML = '';
  for (const comp of companies) {
    const key = `${state.selectedType}__${comp}`;
    const item = available[key];
    const card = document.createElement('button');
    card.className = 'company-card' + (item ? '' : ' empty');
    const color = COMPANY_COLORS[comp] || '#64748B';
    const art = `<div class="card-art"><div class="mono" style="background:${color}">${comp.slice(0, 1)}</div></div>`;
    if (item) {
      const unitLabel = item.addUnit === 'page' ? '쪽마다 2항목' : '블록마다 1항목';
      card.innerHTML = `${art}
        <div class="card-body">
          <div class="company-name">${comp}</div>
          <div class="company-meta">시트 ${item.sheetCount}개 · ${unitLabel}</div>
          <div class="open-hint">이 양식으로 시작 →</div>
        </div>
      `;
      card.addEventListener('click', () => openTemplate(item.id));
    } else {
      card.setAttribute('aria-disabled', 'true');
      card.innerHTML = `${art}
        <div class="card-body">
          <div class="company-name">${comp}</div>
          <div class="company-meta">양식 준비 중</div>
        </div>
      `;
      card.addEventListener('click', () => {
        showToast('아직 이 조합의 양식이 없어요');
      });
    }
    // [2026-11-26] 표지 미리보기(tools/make-cover-thumbs.js로 만든 data/thumbs/<id>.png)가 있으면 글자 타일 대신 보여 준다
    if (item) {
      const artEl = card.querySelector('.card-art');
      const img = document.createElement('img');
      img.className = 'cover-thumb';
      img.alt = `${comp} 표지`;
      img.addEventListener('load', () => { artEl.innerHTML = ''; artEl.appendChild(img); });
      img.src = `data/thumbs/${encodeURIComponent(item.id)}.png`;
    }
    el.companyGrid.appendChild(card);
  }
}

// --- Open Template & Initialize Editor State ---
function createEmptyBlockData() {
  return {
    values: {},
    extraCells: {},
    photoAreas: {} // paIdx -> { layout: '1x1', slots: [null | photoObj] }
  };
}

async function openTemplate(templateId, restore = null) {
  try {
    const res = await window.api.openTemplate(templateId);
    state.templateDef = res.templateDef;
    state.hasBlankXlsx = res.hasBlankXlsx;
    state.sheetVisuals = res.sheetVisuals;
    state.defaultFont = res.defaultFont || { name: 'Calibri', size: 11 };
    state.usedFonts = res.usedFonts || [];
    state.missingFonts = res.missingFonts || [];

    const sheets = [];
    for (const sDef of state.templateDef.sheets) {
      if (sDef.role === 'remove') continue;
      if (sDef.role === 'cover' || sDef.role === 'toc') {
        const initialCells = {};
        const vis = state.sheetVisuals[sDef.name];
        if (vis && vis.cells) {
          for (const c of Object.values(vis.cells)) {
            if (c.value) initialCells[c.addr] = c.value;
          }
        }
        sheets.push({
          name: sDef.name,
          role: sDef.role,
          sheetDef: sDef,
          visualKey: sDef.name,
          cells: initialCells
        });
      } else if (sDef.role === 'block') {
        const repVals = {};
        for (const rv of (sDef.block && sDef.block.repeatedValues) || []) {
          repVals[rv.cell] = '';
        }
        sheets.push({
          name: sDef.name,
          role: 'block',
          sheetDef: sDef,
          visualKey: sDef.name,
          clonedFrom: null,
          repeatedValues: repVals,
          blocks: [createEmptyBlockData()]
        });
      }
    }

    state.editor = { sheets, siteName: '', fontMap: {} };
    // [검증 후속 수정 2026-11-24] 표지에 현장명(siteName) 칸이 없는 양식('기타' 분양·준공)은
    // 머리말·바닥글의 {{현장명}}을 채울 값을 위쪽 입력란에서 받는다.
    const hasSiteNameField = state.templateDef.sheets.some(
      (sd) => sd.role === 'cover' && (sd.coverFields || sd.coverFieldCandidates || []).some((cf) => cf.kind === 'siteName')
    );
    el.siteNameInput.value = '';
    // [인쇄 비교 수정 2026-11-25] 머리말·바닥글에 현장명 자리가 있는 양식이면 항상 보여 준다.
    // 비우면 표지 현장명을 쓰고, 원본처럼 "현장명 공용홀" 등으로 직접 맞추고 싶을 때 입력한다.
    const hasHeaderPlaceholder = state.templateDef.headerSiteNamePlaceholder !== false;
    el.siteNameInput.style.display = 'none'; // [UI 개편] 현장명은 오른쪽 속성 패널에서 입력
    void hasHeaderPlaceholder;
    el.siteNameInput.placeholder = hasSiteNameField ? '머리말 현장명 (비우면 표지 현장명)' : '현장명 (머리말·바닥글)';
    el.siteNameInput.title = hasSiteNameField
      ? '머리말·바닥글에 들어갈 글자입니다. 비워 두면 표지의 현장명을 씁니다.'
      : '이 양식은 표지에 현장명 칸이 없어서, 머리말·바닥글의 현장명을 여기서 입력합니다.';
    // [화면 QA 2026-11-25] 엑셀과 같은 순서로 첫 시트(보통 표지)부터 연다
    state.activeSheetIdx = 0;
    state.selectedBlockIdx = 0;
    state.selectedCell = null;
    state.selectedPhotoSlot = null;
    // [작업 저장 2026-11-25] 저장한 작업 열기 / 새로 시작할 때 기록 초기화
    undoHistory.clear();
    docState.filePath = null;
    docState.dirty = false;
    window.api.setDirty(false);
    if (restore) await applyRestoredEditor(restore);

    el.editorTitle.textContent = `${state.templateDef.company} 양식`;
    el.editorKicker.textContent = state.templateDef.type;
    state.selectedPhotoArea = null;
    view.zoom = 'fit';
    // 열 너비 기준 글꼴(MDW)을 실제 글꼴로 재려면 글꼴이 먼저 읽혀 있어야 한다
    await loadPreviewFonts();
    try {
      await document.fonts.load(`${ptToPx(state.defaultFont.size)}px ${cssFontFor(state.defaultFont.name).family}`, '0123456789');
    } catch (_) {}
    view.mdw = sheetMdw();
    el.templateStatusBadge.textContent = `${state.templateDef.status} (v${state.templateDef.version})`;
    el.blankStatusBadge.textContent = state.hasBlankXlsx
      ? '빈 양식 연결됨'
      : '정의서 기반 미리보기 (blanks 미배치)';

    updateFontChip();
    updateDocTitle();

    hideToast();
    el.catalogView.classList.remove('active');
    el.editorView.classList.add('active');

    renderSheetTabs();
    renderActiveSheet();
    updateToolbarButtons();
    refreshSizeEstimate();
  } catch (err) {
    alert(`템플릿을 여는 중 오류가 발생했습니다:\n${err.message || err}`);
  }
}

// --- Numbering Calculation (A안: Direct numeric values) ---
function computeNumberingMap() {
  const map = {};
  if (!state.editor) return map;
  let docRunning = 1;
  let totalDocBlocks = 0;
  for (const s of state.editor.sheets) {
    if (s.role === 'block') totalDocBlocks += s.blocks.length;
  }
  for (const s of state.editor.sheets) {
    if (s.role !== 'block') continue;
    const numbering = s.sheetDef && s.sheetDef.block ? s.sheetDef.block.numbering : null;
    if (!numbering) {
      map[s.name] = [];
      continue;
    }
    const isDoc = numbering.scope === 'document';
    let cur = isDoc ? docRunning : 1;
    const arr = [];
    for (let i = 0; i < s.blocks.length; i++) {
      arr.push({ number: cur, total: numbering.totalCell ? totalDocBlocks : null });
      cur++;
    }
    if (isDoc) docRunning = cur;
    map[s.name] = arr;
  }
  return map;
}

// --- Sheet Tabs Rendering & Add/Delete (S11) ---
function renderSheetTabs() {
  el.sheetTabsBar.innerHTML = '';
  const sheets = state.editor.sheets;

  sheets.forEach((s, idx) => {
    const tab = document.createElement('div');
    tab.className = 'sheet-tab' + (idx === state.activeSheetIdx ? ' active' : '');
    const dot = document.createElement('i');
    dot.className = 'role-dot';
    tab.appendChild(dot);
    const labelSpan = document.createElement('span');
    labelSpan.textContent = sheetLabel(s);
    tab.title = '더블클릭해서 이름 바꾸기';
    tab.appendChild(labelSpan);

    // Only block sheets can be deleted (cover/toc protected)
    if (s.role === 'block') {
      const delBtn = document.createElement('button');
      delBtn.className = 'sheet-tab-del';
      delBtn.textContent = '×';
      delBtn.title = '시트 삭제';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteBlockSheet(idx);
      });
      tab.appendChild(delBtn);
    }

    tab.addEventListener('click', (e) => {
      // 첫 클릭이 탭을 다시 그리므로 dblclick 대신 클릭 횟수로 더블클릭을 잡는다
      if (e.detail === 2) {
        startTabRename(idx);
        return;
      }
      if (tab.querySelector('input')) return;
      state.activeSheetIdx = idx;
      state.selectedBlockIdx = 0;
      state.selectedCell = null;
      state.selectedPhotoSlot = null;
      renderSheetTabs();
      renderActiveSheet();
      updateToolbarButtons();
    });

    el.sheetTabsBar.appendChild(tab);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'sheet-add-btn';
  addBtn.textContent = '+';
  addBtn.title = '새 블록 시트 추가';
  addBtn.addEventListener('click', openAddSheetModal);
  el.sheetTabsBar.appendChild(addBtn);
}

// [시트 이름 바꾸기 2026-11-25] 탭 이름은 현장마다 다르다(공용홀1층·가구공사 …).
// 앱 안에서는 원래 이름(s.name)을 열쇠로 계속 쓰고, 바꾼 이름(s.label)은 내보낼 때 파일 안 시트 이름으로 바꾼다.
function sheetLabel(s) {
  return s.label || s.name;
}

// Excel 시트 이름 규칙: 31자 이하, \ / ? * [ ] : 불가, 앞뒤 ' 불가, 대소문자 무시 중복 불가
function sheetNameProblem(name, exceptIdx) {
  if (!name) return '시트 이름을 입력해 주세요.';
  if (name.length > 31) return '시트 이름은 31자까지 쓸 수 있어요.';
  if (/[\\/?*\[\]:]/.test(name)) return '시트 이름에 \\ / ? * [ ] : 는 쓸 수 없어요.';
  if (/^'|'$/.test(name)) return "시트 이름은 ' 로 시작하거나 끝날 수 없어요.";
  if (name.toLowerCase() === 'history') return "'History'는 Excel이 쓰는 이름이라 쓸 수 없어요.";
  const low = name.toLowerCase();
  const dup = state.editor.sheets.some((s, i) => i !== exceptIdx && sheetLabel(s).toLowerCase() === low);
  if (dup) return '이미 같은 이름의 시트가 있어요.';
  return null;
}

function startTabRename(idx) {
  const tab = el.sheetTabsBar.querySelectorAll('.sheet-tab')[idx];
  const sheet = state.editor.sheets[idx];
  if (!tab || !sheet || tab.querySelector('input')) return;
  const span = tab.querySelector('span');
  const input = document.createElement('input');
  input.className = 'sheet-tab-rename';
  input.value = sheetLabel(sheet);
  input.maxLength = 31;
  input.size = Math.max(4, input.value.length + 2);
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (commit && next !== sheetLabel(sheet)) {
      const problem = sheetNameProblem(next, idx);
      if (problem) {
        showToast(problem);
      } else {
        recordUndo('시트 이름 바꾸기');
        if (next === sheet.name) delete sheet.label;
        else sheet.label = next;
        showToast(`시트 이름을 '${next}'(으)로 바꿨어요. 내보낸 파일에도 이 이름으로 들어가요.`);
      }
    }
    renderSheetTabs();
  };
  input.addEventListener('input', () => { input.size = Math.max(4, input.value.length + 2); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

function openAddSheetModal() {
  el.newSheetNameInput.value = '';
  el.addSheetModal.classList.add('open');
  setTimeout(() => el.newSheetNameInput.focus(), 30);
}

function confirmAddSheet() {
  const name = el.newSheetNameInput.value.trim();
  const problem = sheetNameProblem(name, -1);
  if (problem) {
    showToast(problem);
    return;
  }
  // 이름을 바꾼 시트의 원래 이름(안쪽 열쇠)과 겹치면 안쪽 열쇠만 다르게 두고, 보이는 이름은 입력한 그대로 쓴다
  let key = name;
  for (let n = 2; state.editor.sheets.some((s) => s.name.toLowerCase() === key.toLowerCase()); n++) key = `${name}__${n}`;

  const active = state.editor.sheets[state.activeSheetIdx];
  const sourceBlockSheet =
    active && active.role === 'block'
      ? active
      : state.editor.sheets.find((s) => s.role === 'block');

  if (!sourceBlockSheet) {
    showToast('복사할 블록 시트가 없습니다.');
    return;
  }

  const repVals = {};
  for (const rv of (sourceBlockSheet.sheetDef.block && sourceBlockSheet.sheetDef.block.repeatedValues) || []) {
    repVals[rv.cell] = rv.scope === 'document' ? (sourceBlockSheet.repeatedValues[rv.cell] || '') : '';
  }

  const newSheet = {
    name: key,
    ...(key !== name ? { label: name } : {}),
    role: 'block',
    sheetDef: JSON.parse(JSON.stringify(sourceBlockSheet.sheetDef)),
    visualKey: sourceBlockSheet.visualKey,
    clonedFrom: sourceBlockSheet.name,
    headerValues: { ...(sourceBlockSheet.headerValues || {}) },
    repeatedValues: repVals,
    blocks: [createEmptyBlockData()]
  };
  newSheet.sheetDef.name = key;

  recordUndo('시트 추가');
  state.editor.sheets.push(newSheet);
  state.activeSheetIdx = state.editor.sheets.length - 1;
  state.selectedBlockIdx = 0;
  state.selectedCell = null;
  state.selectedPhotoSlot = null;

  el.addSheetModal.classList.remove('open');
  renderSheetTabs();
  renderActiveSheet();
  updateToolbarButtons();
  refreshSizeEstimate();
  showToast(`'${name}' 블록 시트를 추가했습니다.`);
}

function deleteBlockSheet(sheetIdx) {
  const sheet = state.editor.sheets[sheetIdx];
  if (!sheet || sheet.role !== 'block') {
    showToast('표지·목차 시트는 삭제할 수 없습니다.');
    return;
  }
  const blockSheetCount = state.editor.sheets.filter((s) => s.role === 'block').length;
  if (blockSheetCount <= 1) {
    showToast('블록 시트는 최소 1개 이상 남아 있어야 합니다.');
    return;
  }
  if (!confirm(`'${sheetLabel(sheet)}' 시트를 삭제할까요? 이 시트의 내용과 사진 배치가 모두 지워집니다.`)) {
    return;
  }
  recordUndo('시트 삭제');
  state.editor.sheets.splice(sheetIdx, 1);
  if (state.activeSheetIdx >= state.editor.sheets.length) {
    state.activeSheetIdx = state.editor.sheets.length - 1;
  }
  state.selectedBlockIdx = 0;
  state.selectedCell = null;
  state.selectedPhotoSlot = null;

  renderSheetTabs();
  renderActiveSheet();
  updateToolbarButtons();
  refreshSizeEstimate();
  showToast(`'${sheetLabel(sheet)}' 시트를 삭제했습니다.`);
}

function updateToolbarButtons() {
  const sheet = state.editor && state.editor.sheets[state.activeSheetIdx];
  const isBlock = !!(sheet && sheet.role === 'block');
  el.addBlockEndBtn.disabled = !isBlock;
  el.addBlockBelowBtn.disabled = !isBlock;
  el.deleteBlockBtn.disabled = !isBlock || (sheet && sheet.blocks.length <= 1);
  const blk = isBlock && sheet.sheetDef && sheet.sheetDef.block;
  const hasRepeated = !!blk && ((blk.repeatedValues || []).length > 0 || (blk.headerFields || []).length > 0);
  el.editRepeatedBtn.disabled = !hasRepeated;
  el.autoFillBtn.disabled = !isBlock;
  el.pasteTableBtn.disabled = !isBlock;
  el.fillMenuBtn.disabled = !isBlock;
}

// --- Block Add / Insert / Delete ---
function addBlock(insertAfterSelected) {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  if (!sheet || sheet.role !== 'block') return;
  const newBlock = createEmptyBlockData();
  recordUndo('블록 추가');
  if (insertAfterSelected) {
    const insertIdx = Math.min(sheet.blocks.length, state.selectedBlockIdx + 1);
    sheet.blocks.splice(insertIdx, 0, newBlock);
    state.selectedBlockIdx = insertIdx;
  } else {
    sheet.blocks.push(newBlock);
    state.selectedBlockIdx = sheet.blocks.length - 1;
  }
  state.selectedCell = null;
  state.selectedPhotoSlot = null;
  renderActiveSheet();
  updateToolbarButtons();
  refreshSizeEstimate();
  const unitText = sheet.sheetDef.block.addUnit === 'page' ? '한 쪽(항목 2개)' : '블록 1개';
  showToast(`${unitText}을 추가했습니다.`);
}

function deleteSelectedBlock() {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  if (!sheet || sheet.role !== 'block') return;
  if (sheet.blocks.length <= 1) {
    showToast('블록은 최소 1개 이상 남아 있어야 합니다.');
    return;
  }
  const unitText = sheet.sheetDef.block.addUnit === 'page' ? '선택한 쪽(항목 2개)' : '선택한 블록';
  if (!confirm(`${unitText}(#${state.selectedBlockIdx + 1})을 삭제할까요? (실행 취소 불가)`)) {
    return;
  }
  recordUndo('블록 삭제');
  sheet.blocks.splice(state.selectedBlockIdx, 1);
  if (state.selectedBlockIdx >= sheet.blocks.length) {
    state.selectedBlockIdx = sheet.blocks.length - 1;
  }
  state.selectedCell = null;
  state.selectedPhotoSlot = null;
  renderActiveSheet();
  updateToolbarButtons();
  refreshSizeEstimate();
  showToast('블록을 삭제했습니다.');
}
