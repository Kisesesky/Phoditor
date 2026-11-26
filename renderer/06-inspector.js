// [renderer/06-inspector.js] 오른쪽 속성 패널(문서·블록·칸·사진 자리), 글꼴 고르기
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

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
    installNoteFor(cur.name),
    h('label', { class: 'check-row' }, (() => {
      const cb = h('input', { type: 'checkbox', checked: !!cur.shrink });
      cb.addEventListener('change', () => apply({ shrink: cb.checked || undefined }));
      return cb;
    })(), ' 칸에 맞게 글자 줄이기 (엑셀 "셀에 맞춤")'),
    h('label', { class: 'check-row', title: '직접 입력한 글이 칸보다 길면 칸 안에서 다음 줄로 넘깁니다' }, (() => {
      const cb = h('input', { type: 'checkbox', checked: cur.wrap !== false && !cur.shrink, disabled: !!cur.shrink });
      cb.addEventListener('change', () => apply({ wrap: cb.checked ? undefined : false }));
      return cb;
    })(), ' 긴 글은 칸 안에서 줄바꿈'),
    document.querySelector('td.selected-cell.too-small') ? h('div', { class: 'insp-note warn', text: document.querySelector('td.selected-cell.too-small').title })
      : document.querySelector('td.selected-cell.overflow') ? h('div', { class: 'insp-note warn', text: '이 칸은 글자가 칸보다 길어 인쇄할 때 잘리거나 넘칠 수 있어요. 위 [칸에 맞게 글자 줄이기]를 켜거나 글을 줄여 주세요.' }) : null
  ];
}

// [2026-11-26] 사진 칸 높이(이 시트의 모든 블록): 사진 영역 행 높이를 60~180%로
function photoScaleSection(sheet) {
  if (!sheet || sheet.role !== 'block' || !(sheet.sheetDef.block.photoAreas || []).length) return null;
  const DM = window.DocModel;
  const cur = DM.clampPhotoScale(sheet.photoScale);
  const before = state.lastPageCount && state.lastPageCount.sheet === sheet.name ? state.lastPageCount : null;
  const setScale = (v) => {
    const next = DM.clampPhotoScale(v);
    if (next === DM.clampPhotoScale(sheet.photoScale)) return;
    recordUndo('사진 칸 높이');
    if (next === 1) delete sheet.photoScale;
    else sheet.photoScale = next;
    renderActiveSheet();
  };
  const range = h('input', { type: 'range', min: String(DM.PHOTO_SCALE_MIN * 100), max: String(DM.PHOTO_SCALE_MAX * 100), step: '5', value: String(Math.round(cur * 100)), class: 'grow' });
  const label = h('span', { class: 'scale-val', text: `${Math.round(cur * 100)}%` });
  range.addEventListener('input', () => { label.textContent = `${range.value}%`; });
  range.addEventListener('change', () => setScale(Number(range.value) / 100));
  const split = state.splitBlocks || [];
  return sec('사진 칸 높이 (이 시트 전체)',
    h('div', { class: 'insp-row' },
      h('button', { class: 'icon-btn', title: '5% 줄이기', disabled: cur <= DM.PHOTO_SCALE_MIN, onclick: () => setScale(cur - 0.05) }, '−'),
      range,
      h('button', { class: 'icon-btn', title: '5% 늘리기', disabled: cur >= DM.PHOTO_SCALE_MAX, onclick: () => setScale(cur + 0.05) }, '+'),
      label),
    h('div', { class: 'insp-actions' },
      h('button', { disabled: cur === 1, onclick: () => setScale(1) }, '원래 높이로'),
      h('button', { title: '쪽 수가 늘지 않는 가장 큰 높이로', onclick: () => fitPhotoScaleToPage(sheet) }, '쪽에 꽉 차게')),
    split.length && cur !== 1
      ? h('div', { class: 'insp-note warn', text: `블록 ${split.map((b) => b + 1).join(', ')}이(가) 두 쪽에 걸쳐 잘려요. 높이를 줄이거나 [쪽에 꽉 차게]를 눌러 주세요.` })
      : h('div', { class: 'insp-note', text: `사진이 들어가는 행만 높이를 바꿔요. 엑셀에도 같은 높이로 들어가요.${before ? ` 지금 이 시트 ${before.count}쪽.` : ''}` }));
}

// 쪽 수가 원래(100%)보다 늘지 않고, 블록이 쪽에 걸쳐 잘리지 않는 가장 큰 비율을 찾는다
function fitPhotoScaleToPage(sheet) {
  const DM = window.DocModel;
  const vis = state.sheetVisuals[sheet.visualKey];
  const saved = sheet.photoScale;
  const measure = (s) => {
    sheet.photoScale = s;
    const { rows, cols } = buildRowSpecs(sheet, vis);
    const colW = cols.map((c) => (vis.hiddenCols.includes(c) ? 0 : window.PageView.colPx(vis.colWidthsCh[c - 1] ?? vis.defaultColWidth, view.mdw)));
    const specs = rows.map((r) => ({ ...r, heightPx: r.kind !== 'block' && r.kind !== 'spacer' && vis.hiddenRows.includes(r.tpl) ? 0 : ptToPx(r.heightPt ?? (vis.rowHeightsPt[r.tpl - 1] ?? vis.defaultRowHeight)) }));
    const geo = window.PageView.pageGeometry(vis.page, colW.reduce((a, b) => a + b, 0), specs.reduce((a, r) => a + r.heightPx, 0));
    const titleIdx = [];
    if (vis.page.titleRows) specs.forEach((r, i) => { if (r.kind !== 'block' && r.tpl >= vis.page.titleRows[0] && r.tpl <= vis.page.titleRows[1]) titleIdx.push(i); });
    const pages = window.PageView.paginate(specs, geo.availH / geo.s, titleIdx);
    const where = new Map();
    let split = false;
    pages.forEach((pg, pi) => pg.forEach((i) => {
      const r = specs[i];
      if (r.kind !== 'block') return;
      if (where.has(r.bIdx) && where.get(r.bIdx) !== pi) split = true;
      where.set(r.bIdx, pi);
    }));
    return { count: pages.length, split };
  };
  const base = measure(1);
  let best = DM.PHOTO_SCALE_MIN;
  for (let s = DM.PHOTO_SCALE_MAX; s >= DM.PHOTO_SCALE_MIN - 1e-9; s = Math.round((s - 0.05) * 100) / 100) {
    const m = measure(s);
    if (m.count <= base.count && (!m.split || base.split)) { best = s; break; }
  }
  sheet.photoScale = saved;
  if (DM.clampPhotoScale(best) === DM.clampPhotoScale(saved)) return showToast(`지금 높이(${Math.round(best * 100)}%)가 이미 쪽에 꽉 찬 높이예요.`);
  recordUndo('사진 칸 높이(쪽에 꽉 차게)');
  if (best === 1) delete sheet.photoScale;
  else sheet.photoScale = best;
  renderActiveSheet();
  showToast(`사진 칸 높이를 ${Math.round(best * 100)}%로 맞췄어요 (쪽 수 그대로).`);
}

function layoutPicker(sheetIdx, bIdx, paIdx, curLayout, onPick) {
  const pick = onPick || ((key) => setAreaLayout(sheetIdx, bIdx, paIdx, key));
  const outer = h('div', { class: 'layout-pick-wrap' });
  const wrap = h('div', { class: 'layout-pick' });
  for (const [key, spec] of Object.entries(LAYOUT_PRESETS)) {
    const ico = h('span', { class: 'lp-ico', style: `grid-template-columns:repeat(${spec.cols},1fr);grid-template-rows:repeat(${spec.rows},1fr)` });
    for (let i = 0; i < spec.count; i++) ico.appendChild(h('i'));
    wrap.appendChild(h('button', { class: curLayout === key ? 'on' : '', 'data-layout': key, 'data-tip': `가로 ${spec.cols} × 세로 ${spec.rows}`, onclick: () => pick(key) }, ico, spec.label));
  }
  outer.appendChild(wrap);
  // 사용자 지정: 5×5 칸 위에 마우스를 올려 크기를 고르고 누른다(표 넣기처럼)
  const cur = LAYOUT_SPECS[curLayout];
  const custom = !!cur && !LAYOUT_PRESETS[curLayout];
  const label = h('span', { class: 'lg-label', text: custom ? `지금 ${cur.label}` : '사용자 지정 (최대 5×5)' });
  const grid = h('div', { class: 'layout-grid' });
  const cells = [];
  const paint = (c, r) => cells.forEach((x) => x.classList.toggle('hot', +x.dataset.c <= c && +x.dataset.r <= r));
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) {
    const cell = h('i', { 'data-c': String(c), 'data-r': String(r) });
    cell.addEventListener('mouseenter', () => { paint(c, r); label.textContent = `${c}×${r} (${c * r}장)`; });
    cell.addEventListener('click', () => pick(`${c}x${r}`));
    cells.push(cell);
    grid.appendChild(cell);
  }
  grid.addEventListener('mouseleave', () => { if (custom) { paint(cur.cols, cur.rows); label.textContent = `지금 ${cur.label}`; } else { paint(0, 0); label.textContent = '사용자 지정 (최대 5×5)'; } });
  if (custom) paint(cur.cols, cur.rows);
  outer.appendChild(h('div', { class: 'layout-custom' }, label, grid));
  return outer;
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
  out.push(sec('내 양식', h('button', { id: 'saveMyTplBtn', onclick: openSaveMyTemplate }, '내 양식으로 저장…'),
    h('div', { class: 'insp-note', text: '자주 쓰는 구성(블록 수·배치·표지·반복값)을 저장해 두면 시작 화면에서 바로 다시 시작해요.' })));
  out.push(sec('양식 정보', h('dl', { class: 'insp-kv' },
    h('dt', { text: '종류' }), h('dd', { text: def.type }),
    h('dt', { text: '업체' }), h('dd', { text: def.company }),
    h('dt', { text: '시트' }), h('dd', { text: `${state.editor.sheets.length}개` }),
    h('dt', { text: '전체 쪽' }), h('dd', { text: `${total}쪽` }),
    h('dt', { text: '빈 양식' }), h('dd', { text: state.hasBlankXlsx ? '연결됨' : '없음(정의서로 그림)' }),
    h('dt', { text: '정의서' }), h('dd', { text: def.verified ? `v${def.version} · 승인됨${def.verifiedAt ? ` (${def.verifiedAt})` : ''}` : `v${def.version} · 사람 확인 전` }))));
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
        h('button', { onclick: () => openAnnotationEditor(slot) }, photo.annotations && photo.annotations.length ? `표시 고치기 (${photo.annotations.length})` : '사진 위 표시…'),
        h('button', { class: 'danger', onclick: () => removePhotoFromSlot(slot.sheetIdx, slot.blockIdx, slot.paIdx, slot.slotIdx) }, '빼기')),
        h('div', { class: 'insp-note', text: photo.isCropped ? `${photo.cropRect ? '자름' : ''}${photo.cropRect && photo.rotation ? ' · ' : ''}${photo.rotation ? `${photo.rotation}° 돌림` : ''} ${photo.croppedWidth}×${photo.croppedHeight}px · 원본 파일은 그대로` : '왼쪽 사진을 누르면 이 자리 사진이 바뀌어요.' })));
    } else {
      body.push(sec(null, h('div', { class: 'insp-note', text: '왼쪽 사진 패널에서 사진을 누르거나 이 자리로 끌어 넣으세요.' })));
    }
    if (pa) body.push(sec('배치', layoutPicker(slot.sheetIdx, slot.blockIdx, slot.paIdx, pa.layout)));
    body.push(photoScaleSection(sheet));
  } else if (area && sheet && area.sheetIdx === state.activeSheetIdx) {
    kicker = `블록 ${area.blockIdx + 1}`;
    title = '사진 영역';
    body.push(sec('배치 고르기', layoutPicker(area.sheetIdx, area.blockIdx, area.paIdx, null),
      h('div', { class: 'insp-note', text: '사진을 바로 끌어 넣으면 1장 배치로 들어가요.' })));
    body.push(photoScaleSection(sheet));
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
      body.push(photoScaleSection(sheet));
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
        const autoOn = !!(state.editor.tocAuto && state.editor.tocAuto[sheet.name]);
        const autoCb = h('input', { type: 'checkbox', checked: autoOn, disabled: !ok });
        autoCb.addEventListener('change', () => {
          if (autoCb.checked) return tocAutoFill();
          state.editor.tocAuto = { ...(state.editor.tocAuto || {}), [sheet.name]: false };
          markDirty();
          showToast('목차 자동 맞춤을 껐어요.');
        });
        body.push(sec('목차', h('button', { disabled: !ok, onclick: tocAutoFill }, '목차 자동 채우기'),
          h('label', { class: 'check-row' }, autoCb, ' 블록이 바뀌면 목차도 자동으로 맞추기'),
          h('div', { class: 'insp-note', text: ok ? '블록 시트 이름(구분)·번호(차례)·품목을 목차 칸에 차례로 채워요. 지금 목차 칸 내용은 바뀌어요(⌘Z로 되돌리기).' : '이 목차는 칸 모양이 달라 자동으로 채울 수 없어요. 칸을 눌러 직접 입력해 주세요.' })));
      }
    }
    body.push(...documentSections());
  }
  el.inspKicker.textContent = kicker;
  el.inspTitle.textContent = title;
  el.inspBody.innerHTML = '';
  body.forEach((n) => { if (n) el.inspBody.appendChild(n); });
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
