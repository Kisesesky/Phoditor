(() => {
  'use strict';

  const LAYOUT_SPECS = {
    '1x1': { cols: 1, rows: 1, count: 1, label: '1×1' },
    '1x2': { cols: 1, rows: 2, count: 2, label: '1×2' },
    '2x1': { cols: 2, rows: 1, count: 2, label: '2×1' },
    '1x3': { cols: 1, rows: 3, count: 3, label: '1×3' },
    '3x1': { cols: 3, rows: 1, count: 3, label: '3×1' },
    '2x2': { cols: 2, rows: 2, count: 4, label: '2×2' }
  };

  // --- Address Helpers ---
  function colToNum(colStr) {
    let n = 0;
    const s = colStr.toUpperCase();
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }

  function numToCol(num) {
    let s = '';
    let n = num;
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function parseAbsCell(addr) {
    const m = String(addr).trim().match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    return { col: colToNum(m[1]), colStr: m[1].toUpperCase(), row: parseInt(m[2], 10) };
  }

  function parseRelCell(relAddr, blockStartRow) {
    const m = String(relAddr).trim().match(/^([A-Za-z]+)\{\+(\d+)\}$/);
    if (!m) return parseAbsCell(relAddr);
    return {
      col: colToNum(m[1]),
      colStr: m[1].toUpperCase(),
      row: blockStartRow + parseInt(m[2], 10),
      offset: parseInt(m[2], 10)
    };
  }

  function parseRelRange(relRange, blockStartRow) {
    const parts = String(relRange).split(':');
    const a = parseRelCell(parts[0], blockStartRow);
    const b = parts[1] ? parseRelCell(parts[1], blockStartRow) : a;
    if (!a || !b) return null;
    return { c1: a.col, r1: a.row, c2: b.col, r2: b.row };
  }

  // --- Global App State ---
  const state = {
    catalog: null,
    selectedType: '공용홀',
    templateDef: null,
    hasBlankXlsx: false,
    sheetVisuals: {},
    editor: null, // { sheets: [...] }
    activeSheetIdx: 0,
    selectedBlockIdx: 0,
    selectedCell: null, // { sheetIdx, blockIdx, key, isNormalCell: true }
    selectedPhotoSlot: null, // { sheetIdx, blockIdx, paIdx, slotIdx }
    photoFolder: null,
    photos: [],
    photoSource: 'local', // 'local' | 'mybox'
    mybox: {
      folderStack: [{ id: null, name: '/ (루트)' }],
      folders: [],
      files: [],
      loading: false,
      error: null,
      loadSeq: 0
    },
    cropSession: null, // { listRef, photoIdx, photo, natW, natH, rect: {x,y,w,h}, drag: null }
    lastSizeEstimate: { totalMB: 0, exceeds500MB: false },
    pendingLayoutTarget: null // { sheetIdx, blockIdx, paIdx, draggedPhoto }
  };

  // --- DOM Elements ---
  const el = {
    catalogView: document.getElementById('catalogView'),
    editorView: document.getElementById('editorView'),
    typeTabs: document.getElementById('typeTabs'),
    companyGrid: document.getElementById('companyGrid'),
    backToCatalogBtn: document.getElementById('backToCatalogBtn'),
    editorTitle: document.getElementById('editorTitle'),
    templateStatusBadge: document.getElementById('templateStatusBadge'),
    blankStatusBadge: document.getElementById('blankStatusBadge'),
    addBlockEndBtn: document.getElementById('addBlockEndBtn'),
    addBlockBelowBtn: document.getElementById('addBlockBelowBtn'),
    deleteBlockBtn: document.getElementById('deleteBlockBtn'),
    editRepeatedBtn: document.getElementById('editRepeatedBtn'),
    siteNameInput: document.getElementById('siteNameInput'),
    sizeEstimateBadge: document.getElementById('sizeEstimateBadge'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    exportBtn: document.getElementById('exportBtn'),
    sourceTabLocal: document.getElementById('sourceTabLocal'),
    sourceTabMybox: document.getElementById('sourceTabMybox'),
    localControls: document.getElementById('localControls'),
    myboxControls: document.getElementById('myboxControls'),
    myboxCountBadge: document.getElementById('myboxCountBadge'),
    myboxUpBtn: document.getElementById('myboxUpBtn'),
    myboxRefreshBtn: document.getElementById('myboxRefreshBtn'),
    myboxSettingsBtn: document.getElementById('myboxSettingsBtn'),
    myboxPathText: document.getElementById('myboxPathText'),
    cropModal: document.getElementById('cropModal'),
    cropStage: document.getElementById('cropStage'),
    cropImage: document.getElementById('cropImage'),
    cropSelection: document.getElementById('cropSelection'),
    cropInfoText: document.getElementById('cropInfoText'),
    cropSelectAllBtn: document.getElementById('cropSelectAllBtn'),
    cancelCropBtn: document.getElementById('cancelCropBtn'),
    confirmCropBtn: document.getElementById('confirmCropBtn'),
    settingsModal: document.getElementById('settingsModal'),
    myboxTokenStatusText: document.getElementById('myboxTokenStatusText'),
    myboxTokenInput: document.getElementById('myboxTokenInput'),
    myboxTestResult: document.getElementById('myboxTestResult'),
    testMyboxBtn: document.getElementById('testMyboxBtn'),
    clearMyboxBtn: document.getElementById('clearMyboxBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    saveMyboxBtn: document.getElementById('saveMyboxBtn'),
    fontBanner: document.getElementById('fontBanner'),
    fontBannerText: document.getElementById('fontBannerText'),
    dismissFontBannerBtn: document.getElementById('dismissFontBannerBtn'),
    selectFolderBtn: document.getElementById('selectFolderBtn'),
    refreshFolderBtn: document.getElementById('refreshFolderBtn'),
    folderPathText: document.getElementById('folderPathText'),
    photoCountBadge: document.getElementById('photoCountBadge'),
    photoGrid: document.getElementById('photoGrid'),
    gridViewport: document.getElementById('gridViewport'),
    sheetTabsBar: document.getElementById('sheetTabsBar'),
    layoutModal: document.getElementById('layoutModal'),
    cancelLayoutBtn: document.getElementById('cancelLayoutBtn'),
    repeatedModal: document.getElementById('repeatedModal'),
    repeatedFormBody: document.getElementById('repeatedFormBody'),
    cancelRepeatedBtn: document.getElementById('cancelRepeatedBtn'),
    saveRepeatedBtn: document.getElementById('saveRepeatedBtn'),
    addSheetModal: document.getElementById('addSheetModal'),
    newSheetNameInput: document.getElementById('newSheetNameInput'),
    cancelAddSheetBtn: document.getElementById('cancelAddSheetBtn'),
    confirmAddSheetBtn: document.getElementById('confirmAddSheetBtn'),
    toast: document.getElementById('toast'),
    editorKicker: document.getElementById('editorKicker'),
    inspKicker: document.getElementById('inspKicker'),
    inspTitle: document.getElementById('inspTitle'),
    inspBody: document.getElementById('inspBody'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomLabel: document.getElementById('zoomLabel'),
    gridToggleBtn: document.getElementById('gridToggleBtn'),
    fontPanelBtn: document.getElementById('fontPanelBtn'),
    pageCountText: document.getElementById('pageCountText'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    saveBtn: document.getElementById('saveBtn'),
    autoFillBtn: document.getElementById('autoFillBtn'),
    pasteTableBtn: document.getElementById('pasteTableBtn'),
    photoFilterBtn: document.getElementById('photoFilterBtn'),
    photoSortSel: document.getElementById('photoSortSel')
  };

  let toastTimer = null;
  // 업체 카드 색(브랜드 색과 비슷한 차분한 색)
  const COMPANY_COLORS = { 롯데: '#8A6A50', 수자인: '#3F6E5A', 한신더휴: '#2E5E8C', 대우: '#2F5597', 힐스테이트: '#5A6B7B', 아크로: '#222222', 하늘채: '#4A7FB5', 블루밍: '#3C6FB0', 포스코: '#1F4E79', 기타: '#7A7F8A' };
  const COVER_FIELD_HINTS = { siteName: '현장명 입력', date: '일자 입력', unitType: '평형·타입 입력' };

  // [화면 QA 2026-11-25] 화면을 옮길 때 이전 안내가 남지 않게 바로 닫는다
  function hideToast() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    el.toast.classList.remove('show');
  }

  function showToast(msg, duration = 2600) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), duration);
  }

  // --- Screen 1: Catalog ---
  async function initCatalog() {
    state.catalog = await window.api.getCatalog();
    await loadPreviewFonts();
    state.selectedType = state.catalog.types[0];
    renderCatalog();
    renderStartExtras();
  }

  function renderCatalog() {
    const { types, companies, available } = state.catalog;
    el.typeTabs.innerHTML = '';
    for (const t of types) {
      const btn = document.createElement('button');
      btn.className = 'type-btn' + (state.selectedType === t ? ' selected' : '');
      const cnt = companies.filter((c) => available[`${t}__${c}`]).length;
      btn.innerHTML = `${t}<span class="cnt">${cnt}</span>`;
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
      history.undo = [];
      history.redo = [];
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

  // --- Grid Rendering ---
  function buildMergeLookup(merges, minRow, maxRow) {
    const topLeft = new Map();
    const covered = new Set();
    for (const ref of merges || []) {
      const parts = ref.split(':');
      const a = parseAbsCell(parts[0]);
      const b = parseAbsCell(parts[1] || parts[0]);
      if (!a || !b) continue;
      if (a.row < minRow || b.row > maxRow) continue;
      topLeft.set(`${a.row},${a.col}`, { rowSpan: b.row - a.row + 1, colSpan: b.col - a.col + 1 });
      for (let r = a.row; r <= b.row; r++) {
        for (let c = a.col; c <= b.col; c++) {
          if (r === a.row && c === a.col) continue;
          covered.add(`${r},${c}`);
        }
      }
    }
    return { topLeft, covered };
  }

  // [글꼴 2026-11-25] 칸마다 Excel 글꼴로 보여 준다. 앱 내장·Mac Excel 글꼴은 @font-face로 읽고, 나머지는 이 Mac에 설치된 글꼴을 찾는다.
  const previewFonts = { aliases: {}, ready: null };
  const normFontName = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
  function loadPreviewFonts() {
    if (previewFonts.ready) return previewFonts.ready;
    previewFonts.ready = (window.api.getPreviewFonts ? window.api.getPreviewFonts() : Promise.resolve(null))
      .then((res) => {
        if (!res) return;
        previewFonts.aliases = res.aliases || {};
        previewFonts.pickList = res.pickList || [];
        const old = document.getElementById('previewFontFaces');
        if (old) old.remove();
        const css = (res.faces || [])
          .map((f) => `@font-face{font-family:"${f.family.replace(/"/g, '')}";src:url("${f.url}");font-weight:${f.weight};font-display:swap;}`)
          .join('\n');
        const st = document.createElement('style');
        st.id = 'previewFontFaces';
        st.textContent = css;
        document.head.appendChild(st);
      })
      .catch(() => {});
    return previewFonts.ready;
  }
  // [글꼴 선택 2026-11-25] 문서 전체 글꼴 바꾸기(fontMap: 원래 이름 → 새 이름)와 칸별 글꼴(cellFonts)을 반영한다
  function mappedFontName(name) {
    const fm = (state.editor && state.editor.fontMap) || {};
    return (name && fm[name]) || name;
  }
  function cssFontFor(fontName) {
    const hit = previewFonts.aliases[normFontName(fontName)];
    const fam = hit ? hit.family : fontName;
    return { family: `"${String(fam || '').replace(/"/g, '')}", "Apple SD Gothic Neo", sans-serif`, weight: hit && hit.weight };
  }
  const ptToPx = (pt) => (pt * 96) / 72;

  // 칸 모양: 글꼴·크기·굵게·기울임·밑줄·색·채우기·정렬·줄바꿈 (테두리는 PageView가 그린다)
  function applyCellVisualStyle(td, cm, override) {
    if (!cm) return;
    const ov = override || {};
    const name = ov.name || mappedFontName(cm.fontName);
    if (name) {
      const f = cssFontFor(name);
      td.style.fontFamily = f.family;
      if (f.weight) td.style.fontWeight = String(f.weight);
    }
    const bold = ov.bold !== undefined ? ov.bold : cm.fontBold;
    if (bold) td.style.fontWeight = '700';
    else if (ov.bold === false) td.style.fontWeight = '400';
    if (cm.fontItalic) td.style.fontStyle = 'italic';
    if (cm.fontUnderline) td.style.textDecoration = 'underline';
    td.style.fontSize = `${ptToPx(ov.size || cm.fontSize || 11)}px`;
    if (cm.fill) td.style.backgroundColor = cm.fill;
    if (cm.fontColor) td.style.color = cm.fontColor;
    if (cm.alignH && cm.alignH !== 'general') {
      td.style.textAlign = cm.alignH === 'centerContinuous' || cm.alignH === 'distributed' ? 'center' : cm.alignH === 'fill' || cm.alignH === 'justify' ? 'left' : cm.alignH;
    }
    td.style.verticalAlign = cm.alignV === 'top' ? 'top' : cm.alignV === 'middle' || cm.alignV === 'center' || cm.alignV === 'distributed' || cm.alignV === 'justify' ? 'middle' : 'bottom';
    if (cm.wrap) td.classList.add('wrap');
    if (cm.indent) td.style.paddingLeft = `${2 + cm.indent * 9}px`;
  }

  function currentSiteName() {
    if (!state.editor) return '';
    if (state.editor.siteName) return state.editor.siteName;
    for (const s of state.editor.sheets) {
      if (s.role !== 'cover') continue;
      const list = (s.sheetDef && (s.sheetDef.coverFields || s.sheetDef.coverFieldCandidates)) || [];
      const f = list.find((cf) => cf.kind === 'siteName');
      if (f && s.cells && s.cells[f.cell]) return String(s.cells[f.cell]).replace(/\s*(공용홀|준공사진첩|사진첩)\s*$/, '').trim();
    }
    return '';
  }

  // --- 쪽 보기 상태 ---
  const view = { zoom: 'fit', showGrid: false, mdw: 8 };

  function sheetMdw() {
    const df = state.defaultFont || { name: 'Calibri', size: 11 };
    return window.PageView.measureMdw(cssFontFor(df.name).family, df.size);
  }

  // 인쇄 범위(열): 인쇄 영역이 없으면 값·테두리·채우기·병합·그림이 있는 범위
  function usedRange(vis) {
    let r2 = 1;
    let c2 = 1;
    for (const cm of Object.values(vis.cells)) {
      if (cm.value || cm.fill || cm.bT || cm.bB || cm.bL || cm.bR) { r2 = Math.max(r2, cm.r); c2 = Math.max(c2, cm.c); }
    }
    for (const ref of vis.merges) {
      const m = /([A-Z]+)(\d+):([A-Z]+)(\d+)/.exec(ref);
      if (m) { r2 = Math.max(r2, +m[4]); c2 = Math.max(c2, colToNum(m[3])); }
    }
    for (const d of vis.drawings || []) {
      const to = d.to || d.from;
      r2 = Math.max(r2, to.row + 1);
      c2 = Math.max(c2, to.col + 1);
    }
    return { r1: 1, c1: 1, r2, c2 };
  }

  function layoutOf(sheet) {
    const printDef = (sheet.sheetDef && sheet.sheetDef.print) || {};
    const rows = sheet.sheetDef.block.rows || 7;
    let blocksPerPage = null;
    if (state.templateDef.id === '준공사진첩_한신더휴') blocksPerPage = 2; // S12 (export.js pageLayoutOf와 같은 규칙)
    else if (printDef.pageBreakRule === 'everyNBlocks' && printDef.blocksPerPrintedPage > 0) blocksPerPage = printDef.blocksPerPrintedPage;
    const spacers = blocksPerPage && Array.isArray(printDef.pageTopSpacerHeights) ? printDef.pageTopSpacerHeights : [];
    return { blocksPerPage, spacers, rows };
  }

  // 시트를 인쇄 순서의 행 목록으로 펼친다
  function buildRowSpecs(sheet, vis) {
    const area = vis.page.printArea || usedRange(vis);
    const cols = [];
    for (let c = area.c1; c <= area.c2; c++) cols.push(c);
    const rows = [];
    if (sheet.role !== 'block') {
      for (let r = area.r1; r <= area.r2; r++) rows.push({ tpl: r, kind: 'flat', breakBefore: vis.page.rowBreaks.includes(r - 1) && r > area.r1 });
      return { rows, cols };
    }
    const blk = sheet.sheetDef.block;
    const startRow = blk.startRow || 1;
    for (let r = Math.min(area.r1, startRow); r < startRow; r++) rows.push({ tpl: r, kind: 'hdr' });
    const lay = layoutOf(sheet);
    sheet.blocks.forEach((_b, bIdx) => {
      const newPage = lay.blocksPerPage && bIdx > 0 && bIdx % lay.blocksPerPage === 0;
      if (newPage) lay.spacers.forEach((h, i) => rows.push({ tpl: -1, kind: 'spacer', heightPt: h, breakBefore: i === 0 }));
      for (let rOff = 0; rOff < lay.rows; rOff++) {
        rows.push({ tpl: startRow + rOff, kind: 'block', bIdx, rOff, breakBefore: !!(newPage && rOff === 0 && !lay.spacers.length) });
      }
    });
    return { rows, cols };
  }

  // 문서 전체 쪽 수·시트별 시작 쪽 번호 (Excel: useFirstPageNumber면 그 번호, 아니면 앞 시트에 이어서)
  function documentPagePlan() {
    const plan = [];
    let next = 1;
    for (const s of state.editor.sheets) {
      const vis = state.sheetVisuals[s.visualKey];
      if (!vis) { plan.push({ start: next, count: 0 }); continue; }
      const { rows, cols } = buildRowSpecs(s, vis);
      const colW = cols.map((c) => (vis.hiddenCols.includes(c) ? 0 : window.PageView.colPx(vis.colWidthsCh[c - 1] ?? vis.defaultColWidth, view.mdw)));
      const specs = rows.map((r) => ({ ...r, heightPx: r.kind !== 'block' && r.kind !== 'spacer' && vis.hiddenRows.includes(r.tpl) ? 0 : ptToPx(r.heightPt ?? (vis.rowHeightsPt[r.tpl - 1] ?? vis.defaultRowHeight)) }));
      const geo = window.PageView.pageGeometry(vis.page, colW.reduce((a, b) => a + b, 0), specs.reduce((a, r) => a + r.heightPx, 0));
      const titleIdx = [];
      if (vis.page.titleRows) specs.forEach((r, i) => { if (r.kind !== 'block' && r.tpl >= vis.page.titleRows[0] && r.tpl <= vis.page.titleRows[1]) titleIdx.push(i); });
      const count = window.PageView.paginate(specs, geo.availH / geo.s, titleIdx).length;
      const nb = vis.page.numbering || {};
      const start = nb.useFirst ? nb.first : next;
      plan.push({ start, count });
      next = start + count;
    }
    return plan;
  }

  function effectiveZoom(vis) {
    if (view.zoom !== 'fit') return view.zoom;
    // 좌우 여백(32px×2) + 블록 이름표 자리를 빼고 쪽 너비에 맞춘다
    const vp = el.gridViewport.clientWidth - 64 - 40;
    const [pw, ph] = vis.page.orientation === 'landscape' ? [11.69, 8.27] : [8.27, 11.69];
    return Math.max(0.3, Math.min(1.4, vp / (pw * 96)));
  }

  function updateZoomLabel(z) {
    if (!el.zoomLabel) return;
    el.zoomLabel.textContent = view.zoom === 'fit' ? `맞춤 ${Math.round(z * 100)}%` : `${Math.round(z * 100)}%`;
  }

  function renderActiveSheet() {
    const scrollTop = el.gridViewport.scrollTop;
    el.gridViewport.innerHTML = '';
    const sheet = state.editor.sheets[state.activeSheetIdx];
    if (!sheet) return;
    const vis = state.sheetVisuals[sheet.visualKey];
    if (!vis) return;
    const paper = document.createElement('div');
    paper.className = 'sheet-paper';
    el.gridViewport.appendChild(paper);

    const plan = documentPagePlan();
    const total = plan.reduce((a, p) => a + p.count, 0);
    const { rows, cols } = buildRowSpecs(sheet, vis);
    const zoom = effectiveZoom(vis);
    const ctx = sheet.role === 'block' ? blockSheetContext(sheet, vis) : flatSheetContext(sheet, vis);
    const res = window.PageView.renderSheet(paper, {
      model: vis,
      rows,
      cols,
      mdw: view.mdw,
      fontCss: (n) => cssFontFor(mappedFontName(n)),
      extraMerges: ctx.extraMerges,
      mergeFilter: ctx.mergeFilter,
      cell: ctx.cell,
      showGrid: view.showGrid,
      siteName: currentSiteName(),
      pageNoStart: plan[state.activeSheetIdx].start,
      pageTotal: total,
      drawingRows: ctx.drawingRows,
      zoom,
      sheetLabel: sheetLabel(sheet)
    });
    // 화면 단추·표시는 쪽 배율과 상관없이 같은 크기로
    paper.style.setProperty('--ui-zoom', String(1 / (res.geo.s * zoom)));
    if (ctx.after) ctx.after(res);
    el.gridViewport.scrollTop = scrollTop;
    updateZoomLabel(zoom);
    if (el.pageCountText) el.pageCountText.textContent = `이 시트 ${res.pageCount}쪽 · 전체 ${total}쪽`;
    renderInspector();
  }

  // [PDF 비교 수정 2026-11-25] 목차 차례 번호 수식(=B4+1 같은 "칸 ± 숫자")을 미리보기에서 계산한다.
  // simpleformula.js(내보내기)와 같은 규칙이다. 고치면 두 곳을 같이 고친다.
  function evaluateSimpleFormulas(getCell, formulaAddrs) {
    const RE = /^\s*=?\s*\$?([A-Z]{1,3})\$?(\d+)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/;
    const memo = {};
    const visiting = new Set();
    const valueOf = (addr) => {
      if (addr in memo) return memo[addr];
      const c = getCell(addr) || {};
      if (c.formula) {
        if (visiting.has(addr)) return null;
        visiting.add(addr);
        const m = RE.exec(c.formula);
        let out = null;
        if (m) {
          const base = valueOf(`${m[1]}${m[2]}`);
          if (base !== null) out = m[3] === '+' ? base + Number(m[4]) : base - Number(m[4]);
        }
        visiting.delete(addr);
        memo[addr] = out;
        return out;
      }
      const v = c.value;
      if (v === null || v === undefined || v === '') return 0;
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) ? n : null;
    };
    const res = {};
    for (const a of formulaAddrs) {
      const v = valueOf(a);
      if (v !== null) res[a] = v;
    }
    return res;
  }

  function flatSheetFormulaValues(sheet, vis) {
    if (!vis || !vis.cells) return {};
    const byAddr = {};
    const formulaAddrs = [];
    for (const cv of Object.values(vis.cells)) {
      if (!cv || !cv.addr) continue;
      byAddr[cv.addr] = cv;
      if (cv.formula && sheet.cells[cv.addr] === undefined) formulaAddrs.push(cv.addr);
    }
    if (!formulaAddrs.length) return {};
    const getCell = (addr) => {
      if (sheet.cells[addr] !== undefined) return { value: sheet.cells[addr] };
      const cv = byAddr[addr];
      return cv ? { formula: cv.formula, value: cv.value } : { value: '' };
    };
    return evaluateSimpleFormulas(getCell, formulaAddrs);
  }

  // --- 칸 선택·편집 공통 ---
  function selectCell(sel, td, initialValue, onCommit, suggestKey) {
    state.selectedPhotoSlot = null;
    state.selectedPhotoArea = null;
    state.selectedCell = sel;
    document.querySelectorAll('td.selected-cell').forEach((x) => x.classList.remove('selected-cell'));
    td.classList.add('selected-cell');
    renderInspector();
    if (onCommit) startInlineEdit(td, initialValue, onCommit, suggestKey);
  }
  const isSelectedCell = (key, bIdx) =>
    !!state.selectedCell && state.selectedCell.sheetIdx === state.activeSheetIdx && state.selectedCell.key === key && (bIdx === undefined || state.selectedCell.blockIdx === bIdx);

  function fontOverrideOf(sheet, key) {
    return (sheet.cellFonts && sheet.cellFonts[key]) || null;
  }

  // --- 표지·목차(평면 시트) ---
  function flatSheetContext(sheet, vis) {
    const formulaVals = flatSheetFormulaValues(sheet, vis);
    const coverFieldKind = new Map();
    if (sheet.role === 'cover' && sheet.sheetDef) {
      for (const cf of sheet.sheetDef.coverFields || sheet.sheetDef.coverFieldCandidates || []) coverFieldKind.set(cf.cell, cf.kind);
    }
    const site = currentSiteName();
    return {
      cell(td, spec, c, cm) {
        const addr = `${numToCol(c)}${spec.tpl}`;
        td.dataset.addr = addr;
        applyCellVisualStyle(td, cm, fontOverrideOf(sheet, addr));
        const raw = sheet.cells[addr] !== undefined ? sheet.cells[addr] : formulaVals[addr] !== undefined ? String(formulaVals[addr]) : cm ? cm.value || '' : '';
        const curVal = String(raw ?? '');
        td.textContent = curVal.replace(/\{\{현장명\}\}/g, site || '현장명');
        td.classList.add('editable-cell');
        if (coverFieldKind.has(addr)) {
          td.classList.add('field-cell');
          if (!curVal) {
            const hint = document.createElement('span');
            hint.className = 'cover-hint';
            hint.textContent = COVER_FIELD_HINTS[coverFieldKind.get(addr)] || '여기에 입력';
            td.appendChild(hint);
          }
          td.title = '표지 입력 칸 — 눌러서 입력';
        }
        if (isSelectedCell(addr)) td.classList.add('selected-cell');
        td.addEventListener('click', () => {
          selectCell({ sheetIdx: state.activeSheetIdx, blockIdx: -1, key: addr, isNormalCell: true, cm, label: coverFieldKind.has(addr) ? COVER_FIELD_HINTS[coverFieldKind.get(addr)] : null }, td, curVal, (newVal) => {
            if (newVal === curVal) return renderActiveSheet();
            recordUndo('칸 입력');
            sheet.cells[addr] = newVal;
            renderActiveSheet();
          }, coverFieldKind.has(addr) ? `cover-${coverFieldKind.get(addr)}` : null);
        });
        attachNormalCellDropGuard(td);
      }
    };
  }

  // --- 블록 시트 ---
  function blockSheetContext(sheet, vis) {
    const blkDef = sheet.sheetDef.block;
    const startRow = blkDef.startRow || 1;
    const numberingMap = computeNumberingMap();
    const sheetNumbers = numberingMap[sheet.name] || [];
    const keyMap = (list) => {
      const m = new Map();
      for (const x of list || []) {
        const p = parseRelCell(x.cell, 0);
        if (p) m.set(`${p.row},${p.col}`, x);
      }
      return m;
    };
    const labelMap = keyMap(blkDef.labels);
    const valueMap = keyMap(blkDef.values);
    const repMap = keyMap(blkDef.repeatedValues);
    const numRel = blkDef.numbering ? parseRelCell(blkDef.numbering.cell, 0) : null;
    const totRel = blkDef.numbering && blkDef.numbering.totalCell ? parseRelCell(blkDef.numbering.totalCell, 0) : null;
    const photoRects = (blkDef.photoAreas || []).map((pa, paIdx) => ({ paIdx, pa, rng: parseRelRange(pa.area, 0) })).filter((x) => x.rng);
    const hdrFields = new Map((blkDef.headerFields || []).map((h) => [String(h.cell).toUpperCase(), h]));
    const site = currentSiteName();
    const drawingRows = new Set();
    for (let r = 1; r < startRow; r++) drawingRows.add(r);

    return {
      drawingRows,
      extraMerges(spec) {
        if (spec.kind !== 'block') return [];
        return photoRects.filter((p) => p.rng.r1 === spec.rOff).map((p) => ({ c1: p.rng.c1, c2: p.rng.c2, rows: p.rng.r2 - p.rng.r1 + 1, extra: { paIdx: p.paIdx } }));
      },
      mergeFilter(spec, m) {
        if (spec.kind !== 'block') return true;
        const r1 = spec.rOff;
        const r2 = spec.rOff + m.rows - 1;
        return !photoRects.some((p) => r1 <= p.rng.r2 && r2 >= p.rng.r1 && m.c1 <= p.rng.c2 && m.c2 >= p.rng.c1);
      },
      cell(td, spec, c, cm, span) {
        if (spec.kind === 'spacer') return;
        if (spec.kind === 'hdr') {
          const addr = `${numToCol(c)}${spec.tpl}`;
          td.dataset.addr = addr;
          applyCellVisualStyle(td, cm, fontOverrideOf(sheet, addr));
          const hf = hdrFields.get(addr);
          const val = hf ? (sheet.headerValues && sheet.headerValues[addr]) || '' : (cm && cm.value) || '';
          td.textContent = String(val).replace(/\{\{현장명\}\}/g, site || '현장명');
          if (hf) {
            td.classList.add('editable-cell', 'field-cell');
            td.title = `머리 행: ${hf.label || addr} (모든 시트에 같이 들어감)`;
            if (!val) {
              const hint = document.createElement('span');
              hint.className = 'cover-hint';
              hint.textContent = hf.label || '입력';
              td.appendChild(hint);
            }
            if (isSelectedCell(addr)) td.classList.add('selected-cell');
            td.addEventListener('click', () => {
              selectCell({ sheetIdx: state.activeSheetIdx, blockIdx: -1, key: addr, isNormalCell: true, cm, label: hf.label, header: true }, td, val, (nv) => {
                if (nv === val) return renderActiveSheet();
                recordUndo('머리 행 입력');
                for (const s of state.editor.sheets) {
                  const hl = (s.role === 'block' && s.sheetDef.block && s.sheetDef.block.headerFields) || [];
                  if (hl.some((h) => String(h.cell).toUpperCase() === addr)) {
                    s.headerValues = s.headerValues || {};
                    s.headerValues[addr] = nv;
                  }
                }
                renderActiveSheet();
              }, normLabel(hf.label));
            });
          } else {
            td.addEventListener('click', () => {
              state.selectedCell = null;
              renderInspector();
            });
          }
          attachNormalCellDropGuard(td);
          return;
        }
        // 블록 행
        const bIdx = spec.bIdx;
        const rOff = spec.rOff;
        const blockData = sheet.blocks[bIdx];
        if (span && span.extra && span.extra.paIdx !== undefined) {
          td.classList.add('photo-area-cell');
          renderPhotoAreaCell(td, state.activeSheetIdx, bIdx, span.extra.paIdx, blockData);
          return;
        }
        const relKey = `${rOff},${c}`;
        const relAddrStr = `${numToCol(c)}{+${rOff}}`;
        td.dataset.rel = relAddrStr;
        td.dataset.b = String(bIdx);
        applyCellVisualStyle(td, cm, fontOverrideOf(sheet, relAddrStr));
        const isNumberCell = numRel && numRel.row === rOff && numRel.col === c;
        const isTotalCell = totRel && totRel.row === rOff && totRel.col === c;
        const lblDef = labelMap.get(relKey);
        const valDef = valueMap.get(relKey);
        const rvDef = repMap.get(relKey);
        const selectBlockOnly = () => {
          if (state.selectedBlockIdx !== bIdx) setSelectedBlock(bIdx);
        };
        if (isNumberCell || isTotalCell) {
          const n = sheetNumbers[bIdx];
          td.textContent = n ? String(isNumberCell ? n.number : n.total ?? '') : '';
          td.title = isNumberCell ? '자동 번호' : '전체 수(자동)';
          td.addEventListener('click', selectBlockOnly);
          attachNormalCellDropGuard(td);
          return;
        }
        if (lblDef) {
          td.textContent = lblDef.text;
          td.addEventListener('click', selectBlockOnly);
          attachNormalCellDropGuard(td);
          return;
        }
        let displayVal = '';
        let editVal = '';
        if (rvDef) {
          editVal = sheet.repeatedValues[rvDef.cell] || '';
          displayVal = rvDef.prefix && editVal && !editVal.startsWith(rvDef.prefix) ? `${rvDef.prefix}${editVal}` : editVal;
          td.title = `반복값: ${rvDef.uiLabel || rvDef.label || rvDef.cell} — ${rvDef.scope === 'document' ? '문서 전체' : '이 시트 모든 블록'}에 같이 들어감`;
        } else if (valDef) {
          editVal = blockData.values[valDef.cell] || '';
          displayVal = valDef.prefix && editVal && !editVal.startsWith(valDef.prefix) ? `${valDef.prefix}${editVal}` : editVal;
          if (valDef.label) td.title = `값: ${valDef.label}`;
        } else {
          editVal = blockData.extraCells[relAddrStr] || (cm && cm.value) || '';
          displayVal = editVal;
        }
        td.textContent = displayVal;
        td.classList.add('editable-cell');
        if (isSelectedCell(relAddrStr, bIdx)) td.classList.add('selected-cell');
        td.addEventListener('click', (e) => {
          e.stopPropagation();
          if (state.selectedBlockIdx !== bIdx) setSelectedBlock(bIdx, true);
          selectCell(
            { sheetIdx: state.activeSheetIdx, blockIdx: bIdx, key: relAddrStr, isNormalCell: true, cm, rel: true, label: (rvDef && (rvDef.uiLabel || rvDef.label)) || (valDef && valDef.label) || null, repeated: !!rvDef, rvScope: rvDef && rvDef.scope },
            td,
            editVal,
            (newVal) => {
              if (newVal === editVal) return renderActiveSheet();
              recordUndo(rvDef ? '반복값 입력' : '칸 입력');
              if (rvDef) applyRepeatedValue(sheet, rvDef, newVal);
              else if (valDef) blockData.values[valDef.cell] = newVal;
              else blockData.extraCells[relAddrStr] = newVal;
              renderActiveSheet();
            },
            rvDef ? normLabel(rvDef.uiLabel || rvDef.label) : valDef ? normLabel(valDef.label) : null
          );
        });
        attachNormalCellDropGuard(td);
      },
      after(res) {
        // 블록 테두리 표시(선택한 블록은 파란 테두리 + 이름표)
        for (const pg of res.pages) {
          const trs = [...pg.table.querySelectorAll('tr[data-b]')];
          const groups = new Map();
          for (const tr of trs) {
            const b = +tr.dataset.b;
            if (!groups.has(b)) groups.set(b, []);
            groups.get(b).push(tr);
            tr.addEventListener('mousedown', () => { if (state.selectedBlockIdx !== b) setSelectedBlock(b); });
          }
          for (const [b, list] of groups) {
            const top = list[0].offsetTop;
            const last = list[list.length - 1];
            const ov = document.createElement('div');
            ov.className = 'block-outline' + (b === state.selectedBlockIdx ? ' selected' : '');
            ov.dataset.b = String(b);
            ov.style.left = '-3px';
            ov.style.width = `${pg.table.offsetWidth + 6}px`;
            ov.style.top = `${top - 3}px`;
            ov.style.height = `${last.offsetTop + last.offsetHeight - top + 6}px`;
            const tag = document.createElement('span');
            tag.className = 'tag';
            const n = sheetNumbers[b];
            tag.textContent = `${blkDef.addUnit === 'page' ? '쪽' : '블록'} ${b + 1}${n ? ` · NO.${n.number}` : ''}`;
            ov.appendChild(tag);
            pg.content.appendChild(ov);
          }
        }
      }
    };
  }

  function setSelectedBlock(bIdx, silent) {
    state.selectedBlockIdx = bIdx;
    document.querySelectorAll('.block-outline').forEach((o) => o.classList.toggle('selected', +o.dataset.b === bIdx));
    if (!silent) {
      state.selectedCell = null;
      state.selectedPhotoSlot = null;
      state.selectedPhotoArea = null;
      document.querySelectorAll('td.selected-cell').forEach((x) => x.classList.remove('selected-cell'));
      renderInspector();
    }
    updateToolbarButtons();
  }

  function applyRepeatedValue(activeSheet, rvDef, newVal) {
    if (rvDef.scope === 'document') {
      for (const s of state.editor.sheets) {
        if (s.role === 'block' && s.repeatedValues && rvDef.cell in s.repeatedValues) {
          s.repeatedValues[rvDef.cell] = newVal;
        }
      }
    } else {
      activeSheet.repeatedValues[rvDef.cell] = newVal;
    }
  }

  function startInlineEdit(td, initialValue, onCommit, suggestKey = null) {
    if (td.querySelector('.cell-editor-input')) return;
    td.innerHTML = '';
    const input = document.createElement('textarea');
    input.className = 'cell-editor-input';
    input.value = initialValue;
    td.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        if (suggestKey) rememberValue(suggestKey, input.value);
        onCommit(input.value);
      } else renderActiveSheet();
    };
    // [자동완성 2026-11-25] 같은 칸에 예전에 적은 값 보여 주기
    if (suggestKey) attachSuggest(input, suggestKey, () => finish(true));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function attachNormalCellDropGuard(td) {
    td.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    td.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const photoIdx = e.dataTransfer.getData('text/photo-index');
      if (photoIdx !== '') {
        showToast('사진은 사진 영역에만 넣을 수 있어요');
      }
    });
  }

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
    if (photo.thumbUrl) {
      const img = document.createElement('img');
      img.src = photo.thumbUrl;
      img.alt = photo.name;
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else if (photo.downloading) {
      wrap.innerHTML = '<span style="font-size:10px;color:var(--ink-muted);">다운로드 중...</span>';
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
          for (const sl of (pa && pa.slots) || []) if (sl && sl.path && sl.path === photo.path) n++;
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
      goSettingsBtn.textContent = 'MYBOX 설정으로 이동';
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
    mb.files.forEach((photo, idx) => {
      el.photoGrid.appendChild(createPhotoCardElement(photo, idx, 'mybox', mb.files));
    });
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
        isAuthError: res.isAuthError
      };
      if (state.photoSource === 'mybox') renderPhotoPanel();
      return;
    }

    mb.folders = res.folders || [];
    mb.files = res.files || [];
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

  // --- Stage 2 B: MYBOX Settings Modal ---
  async function openSettingsModal() {
    el.myboxTokenInput.value = '';
    el.myboxTestResult.className = 'test-result-box';
    el.myboxTestResult.textContent = '';
    const st = await window.api.myboxGetStatus();
    el.myboxTokenStatusText.textContent = st.hasToken
      ? `저장된 토큰 있음 (${st.safeStorageAvailable ? 'safeStorage 암호화' : '메모리 임시'})`
      : '저장된 토큰 없음';
    el.settingsModal.classList.add('open');
  }

  async function handleSaveMyboxToken() {
    const val = el.myboxTokenInput.value.trim();
    if (!val) {
      showToast('PAT 토큰을 입력해 주세요.');
      return;
    }
    const res = await window.api.myboxSaveToken(val);
    if (!res.ok) {
      showToast(res.error || '토큰 저장에 실패했습니다.');
      return;
    }
    el.myboxTokenInput.value = '';
    el.myboxTokenStatusText.textContent = res.persisted
      ? '저장된 토큰 있음 (safeStorage 암호화)'
      : '저장된 토큰 있음 (메모리 임시)';
    showToast(res.warning || 'MYBOX PAT를 안전하게 저장했습니다.');
    if (state.photoSource === 'mybox') {
      state.mybox.folderStack = [{ id: null, name: '/ (루트)' }];
      loadMyboxCurrentFolder();
    }
  }

  async function handleTestMyboxConnection() {
    el.testMyboxBtn.disabled = true;
    el.testMyboxBtn.textContent = '테스트 중...';
    el.myboxTestResult.className = 'test-result-box';
    try {
      const candidate = el.myboxTokenInput.value.trim();
      const res = await window.api.myboxTestConnection(candidate || null);
      if (res.ok) {
        el.myboxTestResult.className = 'test-result-box ok';
        el.myboxTestResult.textContent = `연결 성공 (HTTP ${res.status}): ${res.message}`;
      } else {
        el.myboxTestResult.className = 'test-result-box err';
        const statusTxt = res.status ? `HTTP ${res.status}` : '네트워크 오류';
        el.myboxTestResult.textContent =
          `${res.message || 'MYBOX 연결이 안 돼요. 토큰을 다시 확인해줘'} (${statusTxt}${res.serverMessage ? ' · ' + res.serverMessage : ''})`;
      }
    } finally {
      el.testMyboxBtn.disabled = false;
      el.testMyboxBtn.textContent = '연결 테스트';
    }
  }

  async function handleClearMyboxToken() {
    if (!confirm('저장된 MYBOX 토큰을 삭제할까요?')) return;
    await window.api.myboxClearToken();
    el.myboxTokenStatusText.textContent = '저장된 토큰 없음';
    el.myboxTestResult.className = 'test-result-box';
    showToast('MYBOX 토큰을 삭제했습니다.');
  }

  // --- [UI 개편 2026-11-25] 오른쪽 속성 패널 ---
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'style') n.style.cssText = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    return n;
  };
  const sec = (title, ...kids) => h('div', { class: 'insp-sec' }, title ? h('h4', { text: title }) : null, ...kids);

  function pickListFor() {
    return (previewFonts.pickList || []).slice();
  }

  // 글꼴 고르기 select. value = Excel에 적을 이름, ''는 "원래 글꼴"
  function fontSelect(current, onChange, firstLabel = '원래 글꼴 그대로') {
    const sel = h('select');
    sel.appendChild(h('option', { value: '', text: firstLabel }));
    const groups = [['excel', 'Mac Excel 글꼴'], ['bundled', '앱에 넣은 무료 글꼴']];
    const list = pickListFor();
    for (const [kind, label] of groups) {
      const og = h('optgroup', { label });
      for (const p of list.filter((x) => x.kind === kind)) {
        og.appendChild(h('option', { value: p.excelName, text: `${p.label}${p.kind === 'bundled' && !p.installed ? '  (Mac 미설치)' : ''}` }));
      }
      sel.appendChild(og);
    }
    if (current && ![...sel.options].some((o) => o.value === current)) sel.appendChild(h('option', { value: current, text: current }));
    sel.value = current || '';
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function installNoteFor(excelName) {
    const p = pickListFor().find((x) => x.excelName === excelName);
    if (!p || p.kind !== 'bundled' || p.installed) return null;
    return h('div', { class: 'insp-note warn' },
      `${p.label}은(는) 앱 미리보기에만 있어요. 엑셀로 인쇄할 때도 이 글꼴로 나오려면 이 Mac에 설치해 주세요.`,
      h('div', { style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: () => installFontFamily(p) }, `${p.label} 설치`)));
  }

  async function installFontFamily(p) {
    if (!confirm(`${p.label} 글꼴을 이 Mac 사용자 글꼴 폴더(~/Library/Fonts)에 설치할까요?\n무료 글꼴(재배포 허용)입니다. 엑셀은 다시 열어야 새 글꼴을 인식해요.`)) return;
    const res = await window.api.installFont(p.family);
    if (!res.ok) {
      showToast(`설치하지 못했어요: ${res.error}`);
      return;
    }
    previewFonts.ready = null;
    await loadPreviewFonts();
    showToast(`${p.label} 글꼴을 설치했어요. 엑셀이 열려 있으면 다시 열어 주세요.`);
    renderInspector();
  }

  function cellFontEditor(sheet, key, cm) {
    const cur = fontOverrideOf(sheet, key) || {};
    const baseName = mappedFontName(cm && cm.fontName) || '';
    const apply = (patch) => {
      recordUndo('칸 글꼴 바꾸기');
      sheet.cellFonts = sheet.cellFonts || {};
      const next = { ...cur, ...patch };
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === null) delete next[k];
      if (Object.keys(next).length) sheet.cellFonts[key] = next;
      else delete sheet.cellFonts[key];
      renderActiveSheet();
    };
    const sizes = [7, 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
    const curSize = cur.size || (cm && cm.fontSize) || 11;
    const sizeSel = h('select', { style: 'width:84px' });
    for (const z of [...new Set([...sizes, curSize])].sort((a, b) => a - b)) sizeSel.appendChild(h('option', { value: String(z), text: `${z}pt` }));
    sizeSel.value = String(curSize);
    sizeSel.addEventListener('change', () => apply({ size: Number(sizeSel.value) === (cm && cm.fontSize) ? undefined : Number(sizeSel.value) }));
    const isBold = cur.bold !== undefined ? cur.bold : !!(cm && cm.fontBold);
    const boldBtn = h('button', { class: isBold ? 'on' : '', style: 'font-weight:700;width:36px', title: '굵게', onclick: () => apply({ bold: !isBold === !!(cm && cm.fontBold) ? undefined : !isBold }) }, 'B');
    if (isBold) boldBtn.style.background = 'var(--accent-soft)';
    const shown = cur.name || baseName;
    return [
      h('div', { class: 'font-preview', style: `font-family:${cssFontFor(shown).family};font-weight:${isBold ? 700 : 400}` }, shown ? `가나다 ABC 123 — ${shown}` : '가나다 ABC 123'),
      h('div', { class: 'insp-row' }, h('label', { text: '글꼴' }), h('div', { class: 'grow' }, fontSelect(cur.name || '', (v) => apply({ name: v || undefined }), `원래 글꼴 (${baseName || '기본'})`))),
      h('div', { class: 'insp-row' }, h('label', { text: '크기·굵게' }), h('div', { class: 'grow', style: 'display:flex;gap:6px' }, sizeSel, boldBtn,
        Object.keys(cur).length ? h('button', { onclick: () => { recordUndo('칸 글꼴 되돌리기'); delete sheet.cellFonts[key]; renderActiveSheet(); } }, '원래대로') : null)),
      installNoteFor(cur.name)
    ];
  }

  function layoutPicker(sheetIdx, bIdx, paIdx, curLayout) {
    const wrap = h('div', { class: 'layout-pick' });
    for (const [key, spec] of Object.entries(LAYOUT_SPECS)) {
      const ico = h('span', { class: 'lp-ico', style: `grid-template-columns:repeat(${spec.cols},1fr);grid-template-rows:repeat(${spec.rows},1fr)` });
      for (let i = 0; i < spec.count; i++) ico.appendChild(h('i'));
      wrap.appendChild(h('button', { class: curLayout === key ? 'on' : '', title: `${spec.count}장 ${spec.label}`, onclick: () => setAreaLayout(sheetIdx, bIdx, paIdx, key) }, ico, `${spec.count}장 ${spec.label}`));
    }
    return wrap;
  }

  function documentSections() {
    const def = state.templateDef;
    const plan = documentPagePlan();
    const total = plan.reduce((a, p) => a + p.count, 0);
    const out = [];
    // 현장명(머리말·바닥글)
    const site = h('input', { type: 'text', value: state.editor.siteName || '', placeholder: currentSiteName() || '현장명' });
    site.addEventListener('change', () => {
      recordUndo('현장명 바꾸기');
      state.editor.siteName = site.value.trim();
      renderActiveSheet();
    });
    out.push(sec('현장명', site, h('div', { class: 'insp-note', text: '머리말·바닥글·글상자의 {{현장명}} 자리에 들어가요. 비우면 표지에 적은 현장명을 씁니다.' })));
    // 문서 글꼴 바꾸기
    const used = [...new Set(state.usedFonts || [])].sort();
    const missing = new Set(state.missingFonts || []);
    const rows = used.map((name) => h('div', { class: 'font-map-row' },
      h('span', { class: 'from' + (missing.has(name) && !state.editor.fontMap[name] ? ' missing' : ''), title: missing.has(name) ? '이 Mac에 없는 글꼴' : name, text: `${missing.has(name) ? '⚠ ' : ''}${name}` }),
      h('span', { text: '→', style: 'color:var(--ink-muted)' }),
      fontSelect(state.editor.fontMap[name] || '', (v) => {
        recordUndo('문서 글꼴 바꾸기');
        if (v) state.editor.fontMap[name] = v;
        else delete state.editor.fontMap[name];
        renderActiveSheet();
        updateFontChip();
      }, '그대로')));
    const notes = Object.values(state.editor.fontMap).map(installNoteFor).filter(Boolean);
    out.push(sec('문서 글꼴 바꾸기', h('div', { class: 'insp-note', text: '이 양식에서 쓰는 글꼴을 다른 글꼴로 한꺼번에 바꿉니다. 내보낸 엑셀에도 그대로 들어가요.' }), ...rows, ...notes,
      missing.size ? h('div', { class: 'insp-note warn', text: `⚠ 표시 글꼴은 이 Mac에 없어서 비슷한 글꼴로 보여요. 다른 글꼴로 바꾸거나, 그 글꼴을 설치해 주세요.` }) : null));
    out.push(sec('양식 정보', h('dl', { class: 'insp-kv' },
      h('dt', { text: '종류' }), h('dd', { text: def.type }),
      h('dt', { text: '업체' }), h('dd', { text: def.company }),
      h('dt', { text: '시트' }), h('dd', { text: `${state.editor.sheets.length}개` }),
      h('dt', { text: '전체 쪽' }), h('dd', { text: `${total}쪽` }),
      h('dt', { text: '빈 양식' }), h('dd', { text: state.hasBlankXlsx ? '연결됨' : '없음(정의서로 그림)' }),
      h('dt', { text: '정의서' }), h('dd', { text: `${def.status} v${def.version}${def.verified ? '' : ' · 사람 확인 전'}` }))));
    return out;
  }

  function renderInspector() {
    if (!el.inspBody || !state.editor) return;
    const sheet = state.editor.sheets[state.activeSheetIdx];
    const body = [];
    let kicker = '문서';
    let title = `${state.templateDef.type} · ${state.templateDef.company}`;
    const slot = state.selectedPhotoSlot;
    const area = state.selectedPhotoArea;
    if (slot && sheet && slot.sheetIdx === state.activeSheetIdx) {
      const pa = sheet.blocks[slot.blockIdx] && sheet.blocks[slot.blockIdx].photoAreas[slot.paIdx];
      const photo = pa && pa.slots[slot.slotIdx];
      kicker = `블록 ${slot.blockIdx + 1} · 사진 자리 ${slot.slotIdx + 1}`;
      title = photo ? photo.name : '빈 사진 자리';
      if (photo) {
        const img = h('img', { style: 'width:100%;max-height:170px;object-fit:contain;background:var(--chrome);border-radius:8px;border:1px solid var(--line)' });
        img.src = slotPreviewSrc(photo, img);
        body.push(sec(null, img, h('div', { class: 'insp-actions' },
          h('button', { onclick: () => openSlotCropEditor(slot) }, photo.cropRect ? '다시 자르기' : '자르기'),
          h('button', { title: '오른쪽으로 90° 돌리기', onclick: () => rotateSlot(slot) }, '↻ 돌리기'),
          photo.isCropped ? h('button', { onclick: () => revertSlotCrop(slot) }, '원본으로') : null,
          h('button', { onclick: () => openLightbox([photo], 0) }, '크게 보기'),
          h('button', { class: 'danger', onclick: () => removePhotoFromSlot(slot.sheetIdx, slot.blockIdx, slot.paIdx, slot.slotIdx) }, '빼기')),
          h('div', { class: 'insp-note', text: photo.isCropped ? `${photo.cropRect ? '자름' : ''}${photo.cropRect && photo.rotation ? ' · ' : ''}${photo.rotation ? `${photo.rotation}° 돌림` : ''} ${photo.croppedWidth}×${photo.croppedHeight}px · 원본 파일은 그대로` : '왼쪽 사진을 누르면 이 자리 사진이 바뀌어요.' })));
      } else {
        body.push(sec(null, h('div', { class: 'insp-note', text: '왼쪽 사진 패널에서 사진을 누르거나 이 자리로 끌어 넣으세요.' })));
      }
      if (pa) body.push(sec('배치', layoutPicker(slot.sheetIdx, slot.blockIdx, slot.paIdx, pa.layout)));
    } else if (area && sheet && area.sheetIdx === state.activeSheetIdx) {
      kicker = `블록 ${area.blockIdx + 1}`;
      title = '사진 영역';
      body.push(sec('배치 고르기', layoutPicker(area.sheetIdx, area.blockIdx, area.paIdx, null),
        h('div', { class: 'insp-note', text: '사진을 바로 끌어 넣으면 1장 배치로 들어가요.' })));
    } else if (state.selectedCell && sheet && state.selectedCell.sheetIdx === state.activeSheetIdx) {
      const sc = state.selectedCell;
      kicker = sc.rel ? `블록 ${sc.blockIdx + 1} · 칸` : sc.header ? '머리 행 · 칸' : `${sheetLabel(sheet)} · 칸`;
      title = sc.label || sc.key.replace(/\{\+(\d+)\}/, (_m, n) => ` (블록 ${+n + 1}행)`);
      if (sc.repeated) body.push(sec(null, h('div', { class: 'insp-note warn', text: `반복값 칸이에요. 고치면 ${sc.rvScope === 'document' ? '문서 전체' : '이 시트의 모든 블록'}에 같이 바뀝니다.` })));
      if (sc.header) body.push(sec(null, h('div', { class: 'insp-note', text: '머리 행 칸은 모든 시트의 같은 칸에 같이 들어가요.' })));
      body.push(sec(sc.rel ? '글꼴 (모든 블록의 같은 칸)' : '글꼴', ...cellFontEditor(sheet, sc.key, sc.cm)));
    } else if (sheet) {
      if (sheet.role === 'block') {
        const b = state.selectedBlockIdx;
        const unit = sheet.sheetDef.block.addUnit === 'page' ? '쪽' : '블록';
        kicker = sheetLabel(sheet);
        title = `${unit} ${b + 1} / ${sheet.blocks.length}`;
        body.push(sec(`${unit} 편집`, h('div', { class: 'insp-actions' },
          h('button', { onclick: () => addBlock(true) }, `아래에 ${unit} 추가`),
          h('button', { onclick: () => addBlock(false) }, `맨 끝에 추가`)),
          h('div', { class: 'insp-actions' },
          h('button', { disabled: b <= 0, onclick: () => moveBlock(-1), title: '위로 옮기기' }, '↑ 위로'),
          h('button', { disabled: b >= sheet.blocks.length - 1, onclick: () => moveBlock(1), title: '아래로 옮기기' }, '↓ 아래로'),
          h('button', { onclick: duplicateBlock, title: '글자·사진까지 복제' }, '복제'),
          h('button', { class: 'danger', disabled: sheet.blocks.length <= 1, onclick: deleteSelectedBlock }, '삭제')),
          el.editRepeatedBtn.disabled ? null : h('button', { onclick: openRepeatedModal }, '머리 행·반복값 입력…')));
        body.push(sec('한꺼번에 채우기',
          h('button', { onclick: openAutoFill }, '사진 자동 채우기…'),
          h('button', { onclick: openPasteTable }, '표 붙여넣기 (위치·품목 등)…'),
          h('div', { class: 'insp-note', text: '사진 폴더의 사진을 빈 자리에 차례로 넣거나, 엑셀에서 복사한 목록으로 칸을 채워요. 잘못되면 ⌘Z로 되돌릴 수 있어요.' })));
      } else {
        kicker = sheet.role === 'cover' ? '표지' : '목차';
        title = sheetLabel(sheet);
        body.push(sec(null, h('div', { class: 'insp-note', text: '파란 칸을 눌러 바로 입력하세요. 시트 이름은 아래 탭을 두 번 눌러 바꿉니다.' })));
        if (sheet.role === 'toc') {
          const ok = tocGroups(state.sheetVisuals[sheet.visualKey]).length > 0;
          body.push(sec('목차', h('button', { disabled: !ok, onclick: tocAutoFill }, '목차 자동 채우기'),
            h('div', { class: 'insp-note', text: ok ? '블록 시트 이름(구분)·번호(차례)·품목을 목차 칸에 차례로 채워요. 지금 목차 칸 내용은 바뀌어요(⌘Z로 되돌리기).' : '이 목차는 칸 모양이 달라 자동으로 채울 수 없어요. 칸을 눌러 직접 입력해 주세요.' })));
        }
      }
      body.push(...documentSections());
    }
    el.inspKicker.textContent = kicker;
    el.inspTitle.textContent = title;
    el.inspBody.innerHTML = '';
    body.forEach((n) => el.inspBody.appendChild(n));
  }

  function updateFontChip() {
    const missing = (state.missingFonts || []).filter((f) => !(state.editor && state.editor.fontMap[f]));
    if (missing.length) {
      el.fontBannerText.textContent = `없는 글꼴 ${missing.length}개: ${missing.join(', ')}`;
      el.fontBanner.classList.add('visible');
    } else {
      el.fontBanner.classList.remove('visible');
    }
  }

  function showDocumentInspector() {
    state.selectedCell = null;
    state.selectedPhotoSlot = null;
    state.selectedPhotoArea = null;
    document.querySelectorAll('td.selected-cell, .photo-slot.selected-slot').forEach((x) => x.classList.remove('selected-cell', 'selected-slot'));
    renderInspector();
    const t = [...el.inspBody.querySelectorAll('h4')].find((x) => x.textContent.includes('글꼴'));
    if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // 사진 영역 배치 정하기(사진을 같이 넣을 수 있음)
  function setAreaLayout(sheetIdx, blockIdx, paIdx, layoutKey, photo) {
    state.pendingLayoutTarget = { sheetIdx, blockIdx, paIdx, draggedPhoto: photo || null };
    applyLayoutSelection(layoutKey);
  }

  // --- Repeated Values Modal ---
  function openRepeatedModal() {
    const sheet = state.editor.sheets[state.activeSheetIdx];
    if (!sheet || sheet.role !== 'block') return;
    const list = (sheet.sheetDef.block && sheet.sheetDef.block.repeatedValues) || [];
    const hdrList = (sheet.sheetDef.block && sheet.sheetDef.block.headerFields) || [];
    if (!list.length && !hdrList.length) {
      showToast('이 시트에는 정의된 반복값 항목이 없습니다.');
      return;
    }

    el.repeatedFormBody.innerHTML = '';
    // [인쇄 비교 수정 2026-11-25] 블록 위 머리 행(현장명·평형·일자) — 원본은 매 쪽 위에 인쇄되는 칸
    for (const hf of hdrList) {
      const row = document.createElement('div');
      row.className = 'form-row';
      const cur = (sheet.headerValues && sheet.headerValues[hf.cell]) || '';
      row.innerHTML = `
        <label>${hf.label || hf.cell} (문서 전체)</label>
        <input type="text" data-hdr-cell="${hf.cell}" value="${cur.replace(/"/g, '&quot;')}" placeholder="입력하면 모든 시트의 머리 행 같은 칸에 들어갑니다" />
      `;
      el.repeatedFormBody.appendChild(row);
    }
    for (const rv of list) {
      const row = document.createElement('div');
      row.className = 'form-row';
      const scopeTag = rv.scope === 'document' ? '문서 전체' : '현재 시트';
      row.innerHTML = `
        <label>${rv.uiLabel || rv.label || rv.cell} (${scopeTag})</label>
        <input type="text" data-rv-cell="${rv.cell}" value="${(sheet.repeatedValues[rv.cell] || '').replace(/"/g, '&quot;')}" placeholder="${rv.scope === 'document' ? '입력하면 문서 전체의 같은 칸에 들어갑니다' : '입력하면 이 시트의 같은 칸에 모두 들어갑니다'}" />
      `;
      el.repeatedFormBody.appendChild(row);
    }
    el.repeatedModal.classList.add('open');
  }

  function saveRepeatedModal() {
    const sheet = state.editor.sheets[state.activeSheetIdx];
    recordUndo('반복값 일괄 입력');
    const list = (sheet.sheetDef.block && sheet.sheetDef.block.repeatedValues) || [];
    const inputs = el.repeatedFormBody.querySelectorAll('input[data-rv-cell]');
    inputs.forEach((inp) => {
      const cellKey = inp.getAttribute('data-rv-cell');
      const rvDef = list.find((x) => x.cell === cellKey);
      if (rvDef) applyRepeatedValue(sheet, rvDef, inp.value);
    });
    el.repeatedFormBody.querySelectorAll('input[data-hdr-cell]').forEach((inp) => {
      const cellKey = inp.getAttribute('data-hdr-cell');
      for (const s of state.editor.sheets) {
        const hl = (s.role === 'block' && s.sheetDef && s.sheetDef.block && s.sheetDef.block.headerFields) || [];
        if (hl.some((h) => h.cell === cellKey)) {
          s.headerValues = s.headerValues || {};
          s.headerValues[cellKey] = inp.value;
        }
      }
    });
    el.repeatedModal.classList.remove('open');
    renderActiveSheet();
    showToast('반복값을 적용했습니다.');
  }

  // --- Size Estimate & Export ---
  function collectAllPlacedPhotoInfo() {
    const photoPaths = [];
    const croppedItems = [];
    if (!state.editor) return { photoPaths, croppedItems };
    for (const s of state.editor.sheets) {
      if (s.role !== 'block') continue;
      for (const b of s.blocks) {
        for (const pa of Object.values(b.photoAreas || {})) {
          for (const sl of pa.slots || []) {
            if (!sl) continue;
            if (sl.croppedDataBase64) {
              croppedItems.push({
                key: sl.croppedKey || sl.croppedDataBase64.slice(0, 32),
                sizeBytes: sl.sizeBytes || Math.round((sl.croppedDataBase64.length * 3) / 4)
              });
            } else if (sl.path) {
              photoPaths.push(sl.path);
            }
          }
        }
      }
    }
    return { photoPaths, croppedItems };
  }

  async function refreshSizeEstimate() {
    if (!state.templateDef) return;
    const { photoPaths, croppedItems } = collectAllPlacedPhotoInfo();
    const est = await window.api.estimateExportSize({
      templateId: state.templateDef.id,
      photoPaths,
      croppedItems
    });
    state.lastSizeEstimate = est;
    el.sizeEstimateBadge.textContent = `예상 용량: ${est.totalMB} MB (고유 사진 ${est.uniquePhotoCount}장)`;
    el.sizeEstimateBadge.classList.toggle('warn', !!est.exceeds500MB);
  }

  async function handleExport() {
    await refreshSizeEstimate();
    if (state.lastSizeEstimate.exceeds500MB) {
      const proceed = confirm(
        `예상 파일 용량이 ${state.lastSizeEstimate.totalMB}MB로 500MB를 넘습니다.\n내보내기에 시간이 걸리거나 엑셀에서 열기 무거울 수 있습니다. 계속 내보낼까요?`
      );
      if (!proceed) return;
    }

    el.exportBtn.disabled = true;
    el.exportBtn.textContent = '내보내는 중...';
    try {
      const res = await window.api.exportXlsx({
        templateId: state.templateDef.id,
        editorState: state.editor
      });
      if (res.canceled) return;
      if (res.ok) {
        const mb = (res.stats.sizeBytes / (1024 * 1024)).toFixed(2);
        showToast(
          `저장 완료 (${mb}MB · 사진 ${res.stats.totalPhotoPlacements}개 배치 / 고유 ${res.stats.uniqueImagesEmbedded}장 저장)`,
          4000
        );
      } else {
        const retry = confirm(`내보내기에 실패했습니다:\n${res.error}\n\n다시 저장을 시도할까요?`);
        if (retry) {
          el.exportBtn.disabled = false;
          el.exportBtn.innerHTML = EXPORT_BTN_HTML;
          return handleExport();
        }
      }
    } catch (err) {
      const retry = confirm(`내보내기 중 오류가 발생했습니다:\n${err.message || err}\n\n다시 저장을 시도할까요?`);
      if (retry) {
        el.exportBtn.disabled = false;
        el.exportBtn.innerHTML = EXPORT_BTN_HTML;
        return handleExport();
      }
    } finally {
      el.exportBtn.disabled = false;
      el.exportBtn.innerHTML = EXPORT_BTN_HTML;
    }
  }

  // =====================================================================
  // [기능 추가 2026-11-25] 실행 취소·작업 저장·자동 저장·사진 자동 채우기·블록 이동/복제·표 붙여넣기·자동완성·목차 채우기·사진 크게 보기/돌리기
  // =====================================================================

  // --- 실행 취소/다시 실행 ---
  const history = { undo: [], redo: [], max: 60 };
  const docState = { filePath: null, dirty: false, autosaveTimer: null };

  // sheetDef(정의서)는 바뀌지 않으므로 같은 객체를 그대로 쓰고, 나머지만 복사한다(문자열은 복사되지 않아 크롭본도 가볍다)
  function deepClone(v) {
    if (Array.isArray(v)) return v.map(deepClone);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = k === 'sheetDef' ? v[k] : deepClone(v[k]);
      return o;
    }
    return v;
  }

  function recordUndo(label) {
    if (!state.editor) return;
    history.undo.push({ editor: deepClone(state.editor), active: state.activeSheetIdx, block: state.selectedBlockIdx, label });
    if (history.undo.length > history.max) history.undo.shift();
    history.redo = [];
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
    if (!history.undo.length) return showToast('되돌릴 작업이 없어요.');
    const snap = history.undo.pop();
    history.redo.push({ editor: deepClone(state.editor), active: state.activeSheetIdx, block: state.selectedBlockIdx, label: snap.label });
    restoreSnapshot(snap);
    markDirty();
    showToast(`되돌렸어요: ${snap.label}`);
  }

  function redo() {
    if (!history.redo.length) return showToast('다시 할 작업이 없어요.');
    const snap = history.redo.pop();
    history.undo.push({ editor: deepClone(state.editor), active: state.activeSheetIdx, block: state.selectedBlockIdx, label: snap.label });
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
    const ed = deepClone(state.editor);
    ed.sheets = ed.sheets.map((s) => {
      const out = { ...s };
      const tplDef = state.templateDef.sheets.find((d) => d === s.sheetDef);
      if (tplDef) {
        out.defName = tplDef.name;
        delete out.sheetDef;
      }
      for (const b of out.blocks || []) {
        for (const pa of Object.values(b.photoAreas || {})) {
          for (const sl of (pa && pa.slots) || []) if (sl) delete sl.previewUrl;
        }
      }
      return out;
    });
    return ed;
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
    showToast(`저장했어요: ${res.filePath.split('/').pop()}`);
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
    const ed = data.editor;
    for (const s of ed.sheets) {
      if (s.defName) {
        s.sheetDef = state.templateDef.sheets.find((d) => d.name === s.defName);
        delete s.defName;
      }
      if (!s.sheetDef) throw new Error(`정의서에 없는 시트: ${s.name}`);
    }
    ed.fontMap = ed.fontMap || {};
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
      }
    }
    if (missing.length) setTimeout(() => showToast(`원본 사진 ${missing.length}장을 찾을 수 없어요. 옮겼거나 지웠는지 확인해 주세요.`, 5000), 600);
  }

  // --- 시작 화면: 최근 작업·자동 저장 복구 ---
  async function renderStartExtras() {
    let box = document.getElementById('recentSection');
    if (!box) {
      box = document.createElement('div');
      box.id = 'recentSection';
      const inner = document.querySelector('.start-inner');
      inner.insertBefore(box, inner.firstChild);
    }
    box.innerHTML = '';
    const [recent, auto] = await Promise.all([window.api.projectRecent(), window.api.autosaveRead()]);
    if (auto && auto.editor) {
      const when = new Date(auto.savedAt).toLocaleString('ko-KR');
      box.appendChild(h('div', { class: 'recover-banner' },
        h('div', {}, h('strong', { text: '저장하지 않은 작업이 남아 있어요' }), h('span', { text: ` ${auto.title || ''} · ${when}` })),
        h('div', { class: 'insp-actions' },
          h('button', { class: 'primary', onclick: async () => { await restoreProject(auto, auto.autosaveOf || null); docState.filePath = auto.autosaveOf || null; markDirty(); showToast('자동 저장본을 복구했어요. 저장해 주세요.'); } }, '복구'),
          h('button', { onclick: async () => { if (confirm('자동 저장본을 버릴까요? 되돌릴 수 없어요.')) { await window.api.autosaveClear(); renderStartExtras(); } } }, '버리기'))));
    }
    const head = h('div', { class: 'recent-head' }, h('h2', { text: '최근 작업' }), h('button', { onclick: () => openProject(null) }, '작업 열기…'));
    box.appendChild(head);
    const grid = h('div', { class: 'recent-grid' });
    if (!recent.length) grid.appendChild(h('div', { class: 'insp-note', text: '저장한 작업이 여기에 나와요. 편집 중에 ⌘S로 저장하세요.' }));
    for (const r of recent.slice(0, 6)) {
      grid.appendChild(h('button', { class: 'recent-card', title: r.path, onclick: () => openProject(r.path) },
        h('div', { class: 'recent-title', text: r.title || r.path.split('/').pop() }),
        h('div', { class: 'recent-meta', text: `${(r.templateId || '').replace('_', ' · ')} · ${r.savedAt ? new Date(r.savedAt).toLocaleString('ko-KR') : ''}` })));
    }
    box.appendChild(grid);
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

  // --- 사진 자동 채우기 ---
  function currentPhotoList() {
    return state.photoSource === 'mybox' ? state.mybox.files : state.photos;
  }
  function isPhotoUsed(p) {
    if (p.isCropped) {
      for (const sh of state.editor.sheets) for (const b of sh.blocks || []) for (const pa of Object.values(b.photoAreas || {})) for (const sl of (pa && pa.slots) || []) if (sl && sl.croppedKey === p.croppedKey) return true;
      return false;
    }
    return countPhotoUses(p) > 0 || (p.resourceId && [...state.editor.sheets].some((sh) => (sh.blocks || []).some((b) => Object.values(b.photoAreas || {}).some((pa) => ((pa && pa.slots) || []).some((sl) => sl && sl.resourceId === p.resourceId)))));
  }

  function openAutoFill() {
    const sheet = state.editor && state.editor.sheets[state.activeSheetIdx];
    if (!sheet || sheet.role !== 'block') return showToast('블록 시트(사진이 들어가는 시트)에서 써 주세요.');
    const list = currentPhotoList();
    if (!list.length) return showToast('먼저 왼쪽에서 사진 폴더를 열어 주세요.');
    const order = radioGroup('order', [['name', '파일 이름순'], ['time', '찍은 시간순'], ['panel', '패널 순서']], 'name');
    const which = radioGroup('which', [['unused', '안 넣은 사진만'], ['all', '모든 사진']], 'unused');
    const per = radioGroup('per', [['1', '자리마다 1장'], ['keep', '지금 배치대로']], '1');
    const start = radioGroup('start', [['selected', `선택한 블록(${state.selectedBlockIdx + 1})부터`], ['first', '처음부터']], 'selected');
    const add = h('input', { type: 'checkbox', checked: true, id: 'afAdd' });
    const unusedCount = list.filter((p) => !isPhotoUsed(p)).length;
    const back = openModal('사진 자동 채우기', [
      h('div', { class: 'insp-note', text: `왼쪽 사진(${list.length}장, 안 넣은 사진 ${unusedCount}장)을 이 시트의 빈 사진 자리에 차례대로 넣어요. 이미 사진이 있는 자리는 그대로 둬요.` }),
      h('div', { class: 'form-row' }, h('label', { text: '순서' }), order),
      h('div', { class: 'form-row' }, h('label', { text: '넣을 사진' }), which),
      h('div', { class: 'form-row' }, h('label', { text: '배치' }), per),
      h('div', { class: 'form-row' }, h('label', { text: '시작 위치' }), start),
      h('label', { class: 'check-row' }, add, ' 자리가 모자라면 블록을 자동으로 추가')
    ], [
      h('button', { onclick: () => back.remove() }, '취소'),
      h('button', { class: 'primary', id: 'autoFillRunBtn', onclick: async () => {
        back.remove();
        await runAutoFill({ order: segValue(order, 'name'), which: segValue(which, 'unused'), per: segValue(per, '1'), start: segValue(start, 'selected'), addBlocks: add.checked });
      } }, '채우기')
    ]);
  }

  async function runAutoFill(opt) {
    const sheetIdx = state.activeSheetIdx;
    const sheet = state.editor.sheets[sheetIdx];
    let queue = currentPhotoList().slice();
    if (opt.which === 'unused') queue = queue.filter((p) => !isPhotoUsed(p));
    if (opt.order === 'name') queue.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    if (opt.order === 'time') queue.sort((a, b) => (a.takenAt || Date.parse(a.modifiedAt || 0) || 0) - (b.takenAt || Date.parse(b.modifiedAt || 0) || 0));
    if (!queue.length) return showToast('넣을 사진이 없어요(모두 이미 넣었어요).');
    recordUndo('사진 자동 채우기');
    const paDefs = sheet.sheetDef.block.photoAreas || [];
    let b = opt.start === 'first' ? 0 : state.selectedBlockIdx;
    let placed = 0;
    let added = 0;
    while (queue.length) {
      if (b >= sheet.blocks.length) {
        if (!opt.addBlocks) break;
        sheet.blocks.push(createEmptyBlockData());
        added++;
      }
      const blk = sheet.blocks[b];
      for (let paIdx = 0; paIdx < paDefs.length && queue.length; paIdx++) {
        let pa = blk.photoAreas[paIdx];
        if (!pa || !pa.layout) pa = blk.photoAreas[paIdx] = { layout: '1x1', slots: [null] };
        const count = opt.per === '1' ? 1 : (LAYOUT_SPECS[pa.layout] || LAYOUT_SPECS['1x1']).count;
        for (let s = 0; s < count && queue.length; s++) {
          if (pa.slots[s]) continue;
          let photo = queue.shift();
          if (photo.source === 'mybox' && !photo.path && !photo.isCropped) {
            showToast(`MYBOX 사진 받는 중… (${placed + 1})`);
            photo = await ensureMyboxPhotoReady(photo);
            if (!photo) continue;
          }
          pa.slots[s] = { ...photo };
          placed++;
        }
      }
      b++;
      if (b > 2000) break;
    }
    state.selectedBlockIdx = Math.max(0, Math.min(sheet.blocks.length - 1, b - 1));
    state.selectedPhotoSlot = null;
    state.selectedCell = null;
    rerenderAll();
    showToast(`사진 ${placed}장을 넣었어요${added ? ` (블록 ${added}개 추가)` : ''}${queue.length ? ` · 남은 사진 ${queue.length}장` : ''}.`, 4000);
  }

  // --- 표 붙여넣기 ---
  const normLabel = (s) => String(s || '').replace(/[■\s·:：()（）]/g, '').toLowerCase();
  function blockFieldList(sheet) {
    const groups = new Map();
    for (const v of sheet.sheetDef.block.values || []) {
      if (!v.label) continue;
      const k = normLabel(v.label);
      if (!groups.has(k)) groups.set(k, { label: v.label.replace(/\s+/g, ' ').replace(/■\s*/, '').trim(), cells: [] });
      groups.get(k).cells.push(v.cell);
    }
    const fields = [...groups.entries()].map(([key, g]) => ({ key, ...g }));
    const itemsPerBlock = Math.max(1, ...fields.map((f) => f.cells.length));
    return { fields, itemsPerBlock };
  }
  function parseTsv(text) {
    return String(text || '').replace(/\r/g, '').split('\n').filter((l, i, a) => l.length || i < a.length - 1).map((l) => l.split('\t').map((c) => c.replace(/^"(.*)"$/s, '$1').trim())).filter((r) => r.some((c) => c));
  }

  function openPasteTable() {
    const sheet = state.editor && state.editor.sheets[state.activeSheetIdx];
    if (!sheet || sheet.role !== 'block') return showToast('블록 시트에서 써 주세요.');
    const { fields, itemsPerBlock } = blockFieldList(sheet);
    if (!fields.length) return showToast('이 양식에는 표로 채울 수 있는 칸이 없어요.');
    const ta = h('textarea', { rows: 7, placeholder: `엑셀에서 표를 복사해 여기에 붙여넣으세요.\n첫 줄이 제목(${fields.map((f) => f.label).join(', ')})이면 자동으로 맞춰요.`, style: 'width:100%;font-family:inherit' });
    const mapBox = h('div', { class: 'paste-map' });
    const info = h('div', { class: 'insp-note' });
    const start = radioGroup('pstart', [['selected', `선택한 블록(${state.selectedBlockIdx + 1})부터`], ['first', '처음부터']], 'selected');
    let parsed = { rows: [], header: false, mapping: [] };
    const refresh = () => {
      const rows = parseTsv(ta.value);
      const first = rows[0] || [];
      const matches = first.map((c) => fields.find((f) => f.key === normLabel(c)));
      const header = matches.filter(Boolean).length >= 1;
      const cols = Math.max(0, ...rows.map((r) => r.length));
      const mapping = [];
      for (let c = 0; c < cols; c++) mapping.push(header ? (matches[c] ? matches[c].key : '') : (fields[c] ? fields[c].key : ''));
      parsed = { rows: header ? rows.slice(1) : rows, header, mapping };
      mapBox.innerHTML = '';
      parsed.mapping.forEach((m, c) => {
        const sel = h('select', {});
        sel.appendChild(h('option', { value: '', text: '(넣지 않음)' }));
        for (const f of fields) sel.appendChild(h('option', { value: f.key, text: f.label }));
        sel.value = m;
        sel.addEventListener('change', () => { parsed.mapping[c] = sel.value; });
        mapBox.appendChild(h('div', { class: 'paste-col' }, h('span', { text: `${c + 1}열${header ? ` "${first[c] || ''}"` : ` 예: ${(rows[0] || [])[c] || ''}`}` }), sel));
      });
      const blocksNeeded = Math.ceil(parsed.rows.length / itemsPerBlock);
      info.textContent = parsed.rows.length ? `${parsed.rows.length}줄 → ${itemsPerBlock > 1 ? `쪽마다 ${itemsPerBlock}항목, ` : ''}블록 ${blocksNeeded}개에 들어가요. 모자라면 블록을 추가해요.${header ? ' (첫 줄은 제목으로 봤어요)' : ''}` : '';
    };
    ta.addEventListener('input', refresh);
    const back = openModal('표 붙여넣기', [ta, info, mapBox, h('div', { class: 'form-row', style: 'margin-top:10px' }, h('label', { text: '시작 위치' }), start)], [
      h('button', { onclick: () => back.remove() }, '취소'),
      h('button', { class: 'primary', id: 'pasteApplyBtn', onclick: () => {
        if (!parsed.rows.length) return showToast('붙여넣은 내용이 없어요.');
        recordUndo('표 붙여넣기');
        const startB = segValue(start, 'selected') === 'first' ? 0 : state.selectedBlockIdx;
        parsed.rows.forEach((row, i) => {
          const b = startB + Math.floor(i / itemsPerBlock);
          const item = i % itemsPerBlock;
          while (sheet.blocks.length <= b) sheet.blocks.push(createEmptyBlockData());
          row.forEach((val, c) => {
            const f = fields.find((x) => x.key === parsed.mapping[c]);
            if (!f || !f.cells[item]) return;
            sheet.blocks[b].values[f.cells[item]] = val;
            rememberValue(f.key, val);
          });
        });
        back.remove();
        rerenderAll();
        showToast(`${parsed.rows.length}줄을 블록에 채웠어요.`);
      } }, '채우기')
    ], 640);
    setTimeout(() => ta.focus(), 30);
    back.__refresh = refresh;
    back.__ta = ta;
  }

  // --- 입력값 기억·자동완성 ---
  const SUGGEST_KEY = 'pb-suggest-v1';
  function loadMemory() {
    try {
      return JSON.parse(localStorage.getItem(SUGGEST_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }
  function rememberValue(key, val) {
    const v = String(val || '').trim();
    if (!key || !v || v.length > 200) return;
    try {
      const mem = loadMemory();
      const list = (mem[key] || []).filter((x) => x !== v);
      list.unshift(v);
      mem[key] = list.slice(0, 60);
      localStorage.setItem(SUGGEST_KEY, JSON.stringify(mem));
    } catch (_) {}
  }
  function suggestionsFor(key, typed) {
    const seen = new Set();
    const out = [];
    const push = (v) => { const s = String(v || '').trim(); if (s && !seen.has(s)) { seen.add(s); out.push(s); } };
    // 지금 문서에서 같은 칸에 적은 값 + 예전에 적은 값
    for (const sh of state.editor.sheets) {
      if (sh.role !== 'block') continue;
      const cells = (sh.sheetDef.block.values || []).filter((v) => normLabel(v.label) === key).map((v) => v.cell);
      for (const b of sh.blocks) for (const c of cells) push(b.values[c]);
      for (const rv of sh.sheetDef.block.repeatedValues || []) if (normLabel(rv.uiLabel || rv.label) === key) push(sh.repeatedValues[rv.cell]);
    }
    for (const v of loadMemory()[key] || []) push(v);
    const t = String(typed || '').trim().toLowerCase();
    return out.filter((v) => !t || (v.toLowerCase().includes(t) && v.toLowerCase() !== t)).slice(0, 8);
  }
  function attachSuggest(input, key, onPick) {
    if (!key) return;
    let box = null;
    let idx = -1;
    let items = [];
    const close = () => { if (box) box.remove(); box = null; idx = -1; };
    const render = () => {
      items = suggestionsFor(key, input.value);
      if (!items.length) return close();
      if (!box) { box = h('div', { class: 'suggest-box' }); document.body.appendChild(box); }
      const r = input.getBoundingClientRect();
      box.style.left = `${r.left}px`;
      box.style.top = `${r.bottom + 2}px`;
      box.style.minWidth = `${Math.max(180, r.width)}px`;
      box.innerHTML = '';
      items.forEach((v, i) => {
        const it = h('div', { class: 'suggest-item' + (i === idx ? ' on' : ''), text: v });
        it.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = v; close(); onPick(); });
        box.appendChild(it);
      });
    };
    input.addEventListener('input', () => { idx = -1; render(); });
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(close, 80));
    input.addEventListener('keydown', (e) => {
      if (!box) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(-1, idx - 1); render(); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); e.stopImmediatePropagation(); input.value = items[idx]; close(); onPick(); }
      else if (e.key === 'Escape') { close(); }
    }, true);
    setTimeout(render, 0);
  }

  // --- 목차 자동 채우기 (머리글이 "구분·차례·품목"인 목차) ---
  function tocGroups(vis) {
    const cells = Object.values(vis.cells).filter((c) => c.value);
    const groups = [];
    for (const g of cells.filter((c) => normLabel(c.value) === '구분')) {
      const sameRow = cells.filter((c) => c.r === g.r && c.c > g.c).sort((a, b) => a.c - b.c);
      const num = sameRow.find((c) => normLabel(c.value) === '차례');
      const item = sameRow.find((c) => normLabel(c.value) === '품목');
      if (num && item && (!groups.length || item.c < 999)) groups.push({ row: g.r, cGroup: g.c, cNum: num.c, cItem: item.c });
    }
    // 같은 줄의 묶음끼리 품목 열이 다음 구분 열보다 앞이어야 한다
    return groups.sort((a, b) => a.cGroup - b.cGroup);
  }
  function tocAutoFill() {
    const sheet = state.editor.sheets[state.activeSheetIdx];
    const vis = state.sheetVisuals[sheet.visualKey];
    const groups = tocGroups(vis);
    if (!groups.length) return showToast('이 목차 모양(구분·차례·품목)은 자동으로 채울 수 없어요. 칸을 눌러 직접 입력해 주세요.');
    const area = vis.page.printArea || usedRange(vis);
    const lastRow = area.r2;
    const numbering = computeNumberingMap();
    const entries = [];
    for (const s of state.editor.sheets) {
      if (s.role !== 'block') continue;
      const { fields } = blockFieldList(s);
      const itemField = fields.find((f) => /품목|자재명|품명|명칭|내용/.test(f.label)) || fields[0];
      s.blocks.forEach((b, i) => {
        const n = numbering[s.name] && numbering[s.name][i];
        const cellsOfItem = itemField ? itemField.cells : [];
        const items = cellsOfItem.length ? cellsOfItem.map((c) => b.values[c] || '') : [''];
        items.forEach((txt, k) => entries.push({ group: i === 0 && k === 0 ? sheetLabel(s) : '', num: n ? (items.length > 1 ? `${n.number}-${k + 1}` : String(n.number)) : String(entries.length + 1), item: txt }));
      });
    }
    recordUndo('목차 자동 채우기');
    let gi = 0;
    let r = groups[0].row + 1;
    const capacity = groups.reduce((a, g) => a + (lastRow - g.row), 0);
    // 기존 칸 비우기
    for (const g of groups) for (let rr = g.row + 1; rr <= lastRow; rr++) for (const c of [g.cGroup, g.cNum, g.cItem]) sheet.cells[`${numToCol(c)}${rr}`] = '';
    for (const e of entries) {
      if (gi >= groups.length) break;
      const g = groups[gi];
      sheet.cells[`${numToCol(g.cGroup)}${r}`] = e.group;
      sheet.cells[`${numToCol(g.cNum)}${r}`] = e.num;
      sheet.cells[`${numToCol(g.cItem)}${r}`] = e.item;
      r++;
      if (r > lastRow) { gi++; if (gi < groups.length) r = groups[gi].row + 1; }
    }
    renderActiveSheet();
    showToast(entries.length > capacity ? `목차를 채웠어요. 칸이 모자라 ${entries.length - capacity}개는 빠졌어요.` : `목차 ${entries.length}줄을 채웠어요(블록 품목 기준).`, 4000);
  }

  // --- 사진 크게 보기 ---
  function openLightbox(list, idx) {
    let i = idx;
    const img = h('img', { class: 'lightbox-img' });
    const cap = h('div', { class: 'lightbox-cap' });
    const show = () => {
      const p = list[i];
      if (!p) return;
      cap.textContent = `${p.name}  (${i + 1} / ${list.length})`;
      img.src = p.isCropped ? p.thumbUrl : p.previewUrl || p.thumbUrl || '';
      if (!p.isCropped && !p.previewUrl && p.path) window.api.getSlotPreview(p.path).then((u) => { if (u) { p.previewUrl = u; if (list[i] === p) img.src = u; } });
    };
    const back = h('div', { class: 'modal-backdrop open dyn-modal lightbox' }, img, cap,
      h('button', { class: 'lb-nav lb-prev', onclick: (e) => { e.stopPropagation(); i = Math.max(0, i - 1); show(); } }, '‹'),
      h('button', { class: 'lb-nav lb-next', onclick: (e) => { e.stopPropagation(); i = Math.min(list.length - 1, i + 1); show(); } }, '›'),
      h('button', { class: 'lb-close', onclick: () => back.remove() }, '닫기'));
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    const onKey = (e) => {
      if (!back.isConnected) return document.removeEventListener('keydown', onKey, true);
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); back.remove(); }
      else if (e.key === 'ArrowLeft') { i = Math.max(0, i - 1); show(); }
      else if (e.key === 'ArrowRight') { i = Math.min(list.length - 1, i + 1); show(); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    show();
  }

  // --- 사진 돌리기(자리 단위, 원본에서 다시 만듦) ---
  function editedPhotoFrom(base, res, cropRect, rotation, prefix) {
    return {
      ...base,
      name: `[${prefix}] ${base.name}`,
      originalName: base.name,
      originalThumbUrl: base.thumbUrl,
      originalConversionBadge: base.conversionBadge || null,
      originalSizeBytes: base.sizeBytes,
      cropRect: cropRect || undefined,
      rotation: rotation || undefined,
      previewUrl: undefined,
      isCropped: true,
      croppedDataBase64: res.base64,
      croppedKey: `edit_${Date.now()}_${res.base64.slice(0, 16)}_${res.sizeBytes}`,
      croppedWidth: res.width,
      croppedHeight: res.height,
      sizeBytes: res.sizeBytes,
      thumbUrl: res.thumbDataUrl,
      conversionBadge: null
    };
  }

  async function rotateSlot(target) {
    const pa = state.editor.sheets[target.sheetIdx].blocks[target.blockIdx].photoAreas[target.paIdx];
    const photo = pa && pa.slots[target.slotIdx];
    if (!photo || !photo.path) return showToast('원본 파일이 있어야 돌릴 수 있어요.');
    const rot = ((photo.rotation || 0) + 90) % 360;
    const base = photo.isCropped ? uncroppedCopy(photo) : photo;
    showToast('돌리는 중…');
    let next;
    if (rot === 0 && !photo.cropRect) next = base;
    else {
      const res = await window.api.transformPhoto({ filePath: photo.path, rect: photo.cropRect || null, rotation: rot });
      if (!res || !res.ok) return showToast(`돌리지 못했어요: ${(res && res.error) || ''}`);
      next = editedPhotoFrom(base, res, photo.cropRect, rot, photo.cropRect ? '편집' : '회전');
    }
    recordUndo('사진 돌리기');
    pa.slots[target.slotIdx] = next;
    renderActiveSheet();
    refreshSizeEstimate();
    showToast(rot ? `오른쪽으로 ${rot}° 돌렸어요.` : '원래 방향으로 돌아왔어요.');
  }

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
  el.autoFillBtn.addEventListener('click', openAutoFill);
  el.pasteTableBtn.addEventListener('click', openPasteTable);
  el.saveBtn.addEventListener('click', () => saveProject(false));
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
})();
