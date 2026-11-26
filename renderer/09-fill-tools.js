// [renderer/09-fill-tools.js] 사진 자동 채우기, 표 붙여넣기, 자동완성, 목차 채우기, 크게 보기, 사진 돌리기
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

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

// [2026-11-26] 폴더 이름 → 위치: "16. 현관" → "현관" (앞 번호·기호 떼기)
function cleanFolderName(name) {
  const t = String(name || '').replace(/^\s*[\(\[]?\d+(?:[.\-_]\d+)*[\)\]]?\s*[.\-_)]?\s*/, '').trim();
  return t || String(name || '').trim();
}
// 폴더 이름을 넣을 칸 후보(블록 값 칸 중 라벨이 있는 것). 위치·LOCATION·부위·구분·명칭 순으로 고른다
function locationCellOptions(blkDef) {
  const opts = [];
  for (const v of (blkDef && blkDef.values) || []) {
    const lab = String(v.label || '').replace(/[■\s]/g, '');
    if (!lab || v.labelKind === 'strayChar') continue;
    if (opts.some((o) => o.cell === v.cell)) continue;
    opts.push({ cell: v.cell, label: lab });
  }
  const prio = ['위치', 'LOCATION', '부위', '구분', '명칭', '공종'];
  let best = -1;
  for (const p of prio) { best = opts.findIndex((o) => o.label.toUpperCase().includes(p)); if (best >= 0) break; }
  return { opts, best };
}
function blockIsEmpty(blk) {
  if (!blk) return true;
  if (Object.values(blk.values || {}).some((v) => String(v || '').trim())) return false;
  return !Object.values(blk.photoAreas || {}).some((pa) => ((pa && pa.slots) || []).some(Boolean));
}

function openAutoFill() {
  const sheet = state.editor && state.editor.sheets[state.activeSheetIdx];
  if (!sheet || sheet.role !== 'block') return showToast('블록 시트(사진이 들어가는 시트)에서 써 주세요.');
  const subs = state.photoSource === 'local' ? (state.photoSubfolders || []).filter((f) => f.count > 0) : [];
  const list = currentPhotoList();
  if (!list.length && !subs.length) return showToast('먼저 왼쪽에서 사진 폴더를 열어 주세요.');
  const blkDef = sheet.sheetDef.block;
  const loc = locationCellOptions(blkDef);
  const locSel = h('select', {});
  locSel.appendChild(h('option', { value: '', text: '넣지 않음' }));
  loc.opts.forEach((o, i) => locSel.appendChild(h('option', { value: o.cell, text: o.label, selected: i === loc.best ? true : null })));
  if (loc.best < 0) locSel.value = '';
  let layoutKey = '1x1';
  const layoutLabel = h('span', { class: 'lg-label', text: '블록마다 1×1 (1장)' });
  const layoutBox = h('div', {});
  const drawLayout = () => {
    layoutBox.innerHTML = '';
    layoutBox.appendChild(layoutPicker(0, 0, 0, layoutKey, (k) => { layoutKey = k; const sp = LAYOUT_SPECS[k]; layoutLabel.textContent = `블록마다 ${sp.label} (${sp.count}장)`; drawLayout(); }));
  };
  drawLayout();

  // --- 폴더별 채우기(하위 폴더가 있을 때) ---
  const folderChecks = subs.map((f) => {
    const cb = h('input', { type: 'checkbox', checked: true, tabindex: '-1' });
    const row = h('label', { class: 'af-folder', role: 'checkbox' }, cb, h('span', { text: f.name }), h('span', { class: 'arrow', text: '→' }), h('span', { class: 'loc', text: cleanFolderName(f.name) }), h('span', { class: 'cnt', text: `${f.count}장` }));
    keyActivate(row);
    const syncAria = () => row.setAttribute('aria-checked', cb.checked ? 'true' : 'false');
    cb.addEventListener('change', syncAria); syncAria();
    return { f, cb, row };
  });
  const folderPane = h('div', { class: 'af-pane' },
    h('div', { class: 'insp-note', text: '고른 폴더마다 블록을 만들어 사진을 넣고, 폴더 이름(앞 번호는 뺌)을 위치 칸에 적어요. 사진이 블록 하나에 다 안 들어가면 같은 위치로 다음 블록에 이어서 넣어요.' }),
    h('div', { class: 'af-tools' },
      h('button', { onclick: () => folderChecks.forEach((x) => { x.cb.checked = true; }) }, '모두 고르기'),
      h('button', { onclick: () => folderChecks.forEach((x) => { x.cb.checked = false; }) }, '모두 빼기')),
    h('div', { class: 'af-folders' }, ...folderChecks.map((x) => x.row)));

  // --- 지금 보이는 사진 채우기(예전 방식) ---
  const which = radioGroup('which', [['unused', '안 넣은 사진만'], ['all', '모든 사진']], 'unused');
  const per = radioGroup('per', [['layout', '아래 배치대로'], ['keep', '지금 배치대로']], 'layout');
  const start = radioGroup('start', [['selected', `선택한 블록(${state.selectedBlockIdx + 1})부터`], ['first', '처음부터']], 'selected');
  const curName = state.photoFolder ? cleanFolderName(state.photoFolder.split('/').pop()) : '';
  const putName = h('input', { type: 'checkbox', checked: !!(subs.length === 0 && state.photoFolderStack.length > 1) });
  const unusedCount = list.filter((p) => !isPhotoUsed(p)).length;
  const photoPane = h('div', { class: 'af-pane' },
    h('div', { class: 'insp-note', text: `왼쪽 사진(${list.length}장, 안 넣은 사진 ${unusedCount}장)을 빈 사진 자리에 차례대로 넣어요. 이미 사진이 있는 자리는 그대로 둬요. 순서는 사진 패널 정렬을 따라요.` }),
    h('div', { class: 'form-row' }, h('label', { text: '넣을 사진' }), which),
    h('div', { class: 'form-row' }, h('label', { text: '배치' }), per),
    h('div', { class: 'form-row' }, h('label', { text: '시작 위치' }), start),
    curName ? h('label', { class: 'check-row' }, putName, ` 위치 칸에 폴더 이름 "${curName}" 넣기`) : null);

  const mode = radioGroup('mode', [['folders', `폴더별로 (${subs.length}개)`], ['photos', '지금 보이는 사진']], subs.length ? 'folders' : 'photos');
  const sync = () => {
    const m = segValue(mode, subs.length ? 'folders' : 'photos');
    folderPane.style.display = m === 'folders' ? '' : 'none';
    photoPane.style.display = m === 'photos' ? '' : 'none';
  };
  mode.addEventListener('click', () => setTimeout(sync, 0));
  if (!subs.length) mode.querySelector('[data-v="folders"]').disabled = true;
  sync();
  const back = openModal('사진 자동 채우기', [
    subs.length ? h('div', { class: 'form-row' }, h('label', { text: '채우는 방식' }), mode) : null,
    folderPane,
    photoPane,
    h('div', { class: 'form-row' }, h('label', { text: '사진 배치' }), layoutLabel, layoutBox),
    h('div', { class: 'form-row' }, h('label', { text: '폴더 이름 넣을 칸' }), locSel)
  ], [
    h('button', { onclick: () => back.remove() }, '취소'),
    h('button', { class: 'primary', id: 'autoFillRunBtn', onclick: async () => {
      const m = segValue(mode, subs.length ? 'folders' : 'photos');
      if (m === 'folders') {
        const chosen = folderChecks.filter((x) => x.cb.checked).map((x) => x.f);
        if (!chosen.length) return showToast('넣을 폴더를 골라 주세요.');
        back.remove();
        await runFolderFill({ folders: chosen, layout: layoutKey, locCell: locSel.value || null });
      } else {
        back.remove();
        await runAutoFill({ order: 'panel', which: segValue(which, 'unused'), per: segValue(per, 'layout'), layout: layoutKey, start: segValue(start, 'selected'), addBlocks: true, locCell: putName.checked ? locSel.value || null : null, locValue: curName });
      }
    } }, '채우기')
  ], 600);
  back.classList.add('af-modal');
}

// 폴더별 채우기: 폴더 하나 = 위치 하나. 빈 블록부터 쓰고 모자라면 블록을 추가한다
async function runFolderFill(opt) {
  const sheetIdx = state.activeSheetIdx;
  const sheet = state.editor.sheets[sheetIdx];
  const paDefs = sheet.sheetDef.block.photoAreas || [];
  const spec = LAYOUT_SPECS[opt.layout] || LAYOUT_SPECS['1x1'];
  showToast('폴더 사진을 읽는 중…');
  const folders = await window.api.scanSubfolders(opt.folders.map((f) => f.path));
  const total = folders.reduce((a, f) => a + f.photos.length, 0);
  if (!total) return showToast('고른 폴더에 사진이 없어요.');
  recordUndo('폴더별 사진 채우기');
  let b = 0;
  let placed = 0;
  let added = 0;
  const nextEmpty = () => {
    while (b < sheet.blocks.length && !blockIsEmpty(sheet.blocks[b])) b++;
    if (b >= sheet.blocks.length) { sheet.blocks.push(createEmptyBlockData()); added++; }
    return sheet.blocks[b];
  };
  let firstBlock = null;
  for (const f of folders) {
    const queue = sortPhotoList(f.photos.slice());
    const locName = cleanFolderName(f.name);
    while (queue.length) {
      const blk = nextEmpty();
      if (firstBlock === null) firstBlock = b;
      if (opt.locCell) blk.values = { ...(blk.values || {}), [opt.locCell]: locName };
      for (let paIdx = 0; paIdx < paDefs.length && queue.length; paIdx++) {
        const slots = new Array(spec.count).fill(null);
        for (let s = 0; s < spec.count && queue.length; s++) { slots[s] = { ...queue.shift() }; placed++; }
        blk.photoAreas[paIdx] = { layout: opt.layout, slots };
      }
      b++;
      if (b > 3000) break;
    }
  }
  state.selectedBlockIdx = Math.max(0, firstBlock || 0);
  state.selectedPhotoSlot = null;
  state.selectedCell = null;
  rerenderAll();
  showToast(`폴더 ${folders.length}개 · 사진 ${placed}장을 넣었어요${added ? ` (블록 ${added}개 추가)` : ''}${opt.locCell ? ' · 위치 칸에 폴더 이름' : ''}.`, 4500);
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
      const wantLayout = opt.per === 'layout' ? (opt.layout || '1x1') : (pa && pa.layout) || '1x1';
      if (!pa || !pa.layout || (opt.per === 'layout' && pa.layout !== wantLayout && !(pa.slots || []).some(Boolean))) {
        pa = blk.photoAreas[paIdx] = { layout: wantLayout, slots: new Array(LAYOUT_SPECS[wantLayout].count).fill(null) };
      }
      const count = opt.per === '1' ? 1 : (LAYOUT_SPECS[pa.layout] || LAYOUT_SPECS['1x1']).count;
      if (opt.locCell && opt.locValue && !String((blk.values || {})[opt.locCell] || '').trim()) blk.values = { ...(blk.values || {}), [opt.locCell]: opt.locValue };
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
    if (!box) { box = h('div', { class: 'suggest-box', role: 'listbox' }); document.body.appendChild(box); }
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 2}px`;
    box.style.minWidth = `${Math.max(180, r.width)}px`;
    box.innerHTML = '';
    items.forEach((v, i) => {
      const it = h('div', { class: 'suggest-item' + (i === idx ? ' on' : ''), role: 'option', 'aria-selected': i === idx ? 'true' : 'false', text: v });
      it.addEventListener('mousedown', (e) => e.preventDefault()); // 입력칸 초점 유지
      it.addEventListener('click', () => { input.value = v; close(); onPick(); input.focus(); });
      it.addEventListener('blur', (e) => { if (!box || !box.contains(e.relatedTarget)) setTimeout(() => { if (document.activeElement !== input && !(box && box.contains(document.activeElement))) close(); }, 80); });
      keyActivate(it);
      box.appendChild(it);
    });
  };
  input.addEventListener('input', () => { idx = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', (e) => { if (box && box.contains(e.relatedTarget)) return; setTimeout(close, 80); });
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
// 목차 칸을 블록 시트 내용으로 채운다. 바뀐 칸이 있으면 true
function fillTocSheet(sheet) {
  const vis = state.sheetVisuals[sheet.visualKey];
  const groups = tocGroups(vis);
  if (!groups.length) return null;
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
  const capacity = groups.reduce((a, g) => a + (lastRow - g.row), 0);
  const next = {};
  for (const g of groups) for (let rr = g.row + 1; rr <= lastRow; rr++) for (const c of [g.cGroup, g.cNum, g.cItem]) next[`${numToCol(c)}${rr}`] = '';
  let gi = 0;
  let r = groups[0].row + 1;
  for (const e of entries) {
    if (gi >= groups.length) break;
    const g = groups[gi];
    next[`${numToCol(g.cGroup)}${r}`] = e.group;
    next[`${numToCol(g.cNum)}${r}`] = e.num;
    next[`${numToCol(g.cItem)}${r}`] = e.item;
    r++;
    if (r > lastRow) { gi++; if (gi < groups.length) r = groups[gi].row + 1; }
  }
  let changed = false;
  // 비어 있어야 할 칸도 꼭 ''로 적는다(원래 칸의 =B4+1 같은 수식이 남아 빈 줄에 번호가 계속 찍히지 않게)
  for (const [k, v] of Object.entries(next)) if (sheet.cells[k] !== v) { sheet.cells[k] = v; changed = true; }
  return { entries: entries.length, capacity, changed, keys: new Set(Object.keys(next)) };
}

function tocAutoFill() {
  const sheet = state.editor.sheets[state.activeSheetIdx];
  if (!tocGroups(state.sheetVisuals[sheet.visualKey]).length) return showToast('이 목차 모양(구분·차례·품목)은 자동으로 채울 수 없어요. 칸을 눌러 직접 입력해 주세요.');
  recordUndo('목차 자동 채우기');
  const res = fillTocSheet(sheet);
  // [2026-11-26] 한 번 채우면 블록이 바뀔 때마다 목차도 자동으로 다시 맞춘다
  state.editor.tocAuto = { ...(state.editor.tocAuto || {}), [sheet.name]: true };
  renderActiveSheet();
  showToast(res.entries > res.capacity ? `목차를 채웠어요. 칸이 모자라 ${res.entries - res.capacity}개는 빠졌어요.` : `목차 ${res.entries}줄을 채웠어요. 이제 블록을 고치면 목차도 저절로 맞춰져요.`, 4500);
}

// 그리기 전마다: 자동 맞춤이 켜진 목차를 지금 블록 내용으로 다시 맞춘다(실행 취소 기록은 그 앞 작업에 포함)
function syncAutoToc() {
  const auto = state.editor && state.editor.tocAuto;
  if (!auto) return;
  for (const s of state.editor.sheets) if (s.role === 'toc' && auto[s.name]) fillTocSheet(s);
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

const norm90 = (r) => ((((Number(r) || 0) % 360) + 360) % 360) % 180 !== 0;

async function rotateSlot(target) {
  const pa = state.editor.sheets[target.sheetIdx].blocks[target.blockIdx].photoAreas[target.paIdx];
  const photo = pa && pa.slots[target.slotIdx];
  if (!photo || !photo.path) return showToast('원본 파일이 있어야 돌릴 수 있어요.');
  const rot = ((photo.rotation || 0) + 90) % 360;
  const base = photo.isCropped ? uncroppedCopy(photo) : photo;
  showToast('돌리는 중…');
  let next;
  let origW;
  let origH;
  if (rot === 0 && !photo.cropRect) {
    next = base;
    // 돌리기 전 사진(270°)의 크기에서 원본 크기를 거꾸로 구한다
    origW = norm90(photo.rotation) ? photo.croppedHeight : photo.croppedWidth;
    origH = norm90(photo.rotation) ? photo.croppedWidth : photo.croppedHeight;
  } else {
    const res = await window.api.transformPhoto({ filePath: photo.path, rect: photo.cropRect || null, rotation: rot });
    if (!res || !res.ok) return showToast(`돌리지 못했어요: ${(res && res.error) || ''}`);
    next = editedPhotoFrom(base, res, photo.cropRect, rot, photo.cropRect ? '편집' : '회전');
    origW = norm90(rot) ? res.height : res.width;
    origH = norm90(rot) ? res.width : res.height;
  }
  // [2026-11-26] 사진 위 표시도 같이 돌린다(전에는 사진만 돌고 표시는 그대로라 어긋남)
  if (photo.annotations && photo.annotations.length) {
    const full = { x: 0, y: 0, w: origW || 1, h: origH || 1 };
    const rect = photo.cropRect || full;
    next = { ...next, annotations: transformAnnotations(photo.annotations, { rect, rot: photo.rotation || 0 }, { rect, rot }) };
  }
  recordUndo('사진 돌리기');
  pa.slots[target.slotIdx] = next;
  renderActiveSheet();
  refreshSizeEstimate();
  showToast(rot ? `오른쪽으로 ${rot}° 돌렸어요.` : '원래 방향으로 돌아왔어요.');
}
