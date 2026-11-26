// [renderer/03-pages.js] 쪽 보기 그리기: 글꼴, 칸 모양, 쪽 나누기, 표지·목차·블록 시트 칸, 칸 입력
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

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
  if (override && override.shrink) td.dataset.shrink = '1';
  if (override && override.wrap === false) td.dataset.nowrap = '1';
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
  if (cm.wrap && !ov.shrink && ov.wrap !== false) td.classList.add('wrap');
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
  // [2026-11-26] 사진 칸 높이: 사진 영역 행만 비율대로
  const scale = window.DocModel.clampPhotoScale(sheet.photoScale);
  const photoRows = scale !== 1 ? window.DocModel.photoRowOffsets(blk) : null;
  sheet.blocks.forEach((_b, bIdx) => {
    const newPage = lay.blocksPerPage && bIdx > 0 && bIdx % lay.blocksPerPage === 0;
    if (newPage) lay.spacers.forEach((h, i) => rows.push({ tpl: -1, kind: 'spacer', heightPt: h, breakBefore: i === 0 }));
    for (let rOff = 0; rOff < lay.rows; rOff++) {
      const spec = { tpl: startRow + rOff, kind: 'block', bIdx, rOff, breakBefore: !!(newPage && rOff === 0 && !lay.spacers.length) };
      if (photoRows && photoRows.has(rOff)) spec.heightPt = Math.round((vis.rowHeightsPt[spec.tpl - 1] ?? vis.defaultRowHeight) * scale * 100) / 100;
      rows.push(spec);
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

// [2026-11-26] 쪽 이동 막대: 쪽 번호(블록 시트는 블록 범위), 누르면 그 쪽으로
function renderPageRail(res, sheet) {
  if (!el.pageRail) return;
  el.pageRail.innerHTML = '';
  res.pages.forEach((pg, i) => {
    let sub = '';
    if (sheet.role === 'block') {
      const bs = [...new Set([...pg.table.querySelectorAll('tr[data-b]')].map((t) => +t.dataset.b + 1))];
      if (bs.length) sub = bs.length > 1 ? `${bs[0]}–${bs[bs.length - 1]}` : `#${bs[0]}`;
    }
    const b = h('button', { class: 'rail-item', title: `${i + 1}쪽${sub ? ` · 블록 ${sub}` : ''}`, onclick: () => pg.el.parentElement.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, String(i + 1), sub ? h('small', { text: sub }) : null);
    b.__page = pg.el;
    el.pageRail.appendChild(b);
  });
  updateRailActive();
}
function updateRailActive() {
  if (!el.pageRail || !el.pageRail.children.length) return;
  const vp = el.gridViewport.getBoundingClientRect();
  const mid = vp.top + vp.height / 3;
  let best = null;
  for (const b of el.pageRail.children) {
    const r = b.__page.getBoundingClientRect();
    if (r.top <= mid) best = b;
  }
  best = best || el.pageRail.children[0];
  for (const b of el.pageRail.children) b.classList.toggle('on', b === best);
  if (best && !best.__shown) {
    const rr = best.getBoundingClientRect();
    const pr = el.pageRail.getBoundingClientRect();
    if (rr.top < pr.top || rr.bottom > pr.bottom) best.scrollIntoView({ block: 'nearest' });
  }
}

function updateZoomLabel(z) {
  if (!el.zoomLabel) return;
  el.zoomLabel.textContent = view.zoom === 'fit' ? `맞춤 ${Math.round(z * 100)}%` : `${Math.round(z * 100)}%`;
}

function renderActiveSheet() {
  syncAutoToc();
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
  markOverflows(res);
  renderPageRail(res, sheet);
  state.lastPageCount = { sheet: sheet.name, count: res.pages.length };
  state.splitBlocks = [];
  if (sheet.role === 'block') {
    const seen = new Map();
    res.pages.forEach((pg, pi) => {
      for (const b of new Set([...pg.table.querySelectorAll('tr[data-b]')].map((t) => +t.dataset.b))) {
        if (seen.has(b) && !state.splitBlocks.includes(b)) state.splitBlocks.push(b);
        seen.set(b, pi);
      }
    });
  }
  el.gridViewport.scrollTop = scrollTop;
  updateZoomLabel(zoom);
  if (state.nextEditId) setTimeout(openPendingEdit, 0);
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
      if (curVal && (!cm || curVal !== (cm.value || ''))) td.dataset.user = '1';
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
          // 자동 맞춤 중인 목차 칸을 직접 고치면 자동 맞춤을 끈다(고친 글이 덮어써지지 않게)
          if (sheet.role === 'toc' && state.editor.tocAuto && state.editor.tocAuto[sheet.name]) {
            const probe = fillTocSheet(deepClone(sheet));
            if (probe && probe.keys.has(addr)) {
              state.editor.tocAuto = { ...state.editor.tocAuto, [sheet.name]: false };
              showToast('목차 칸을 직접 고쳐서 자동 맞춤을 껐어요. 속성 패널에서 다시 켤 수 있어요.', 4000);
            }
          }
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
          if (val) td.dataset.user = '1';
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
      if (displayVal && displayVal !== ((cm && cm.value) || '')) td.dataset.user = '1';
      // [3순위] 반복값 칸은 화면에서 구분되게(고치면 여러 블록이 같이 바뀜)
      if (rvDef) td.classList.add('repeated');
      if (isSelectedCell(relAddrStr, bIdx)) td.classList.add('selected-cell');
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.selectedBlockIdx !== bIdx) setSelectedBlock(bIdx, true);
        if (rvDef && !shownRepeatHints.has(`${sheet.name}|${rvDef.cell}`)) shownRepeatHints.add(`${sheet.name}|${rvDef.cell}`) && showToast(`반복값 칸이에요: 고치면 ${rvDef.scope === 'document' ? '문서 전체' : '이 시트의 모든 블록'}의 "${(rvDef.uiLabel || rvDef.label || '').replace(/■\s*/, '')}"이(가) 같이 바뀌어요.`, 3500);
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

// [2026-11-26] 칸 이동: 칸마다 id(표지·목차·머리 행 = 주소, 블록 칸 = 상대 주소 + 블록 번호)
function cellIdOf(td) {
  if (!td || !td.dataset) return null;
  if (td.dataset.addr) return `a:${td.dataset.addr}`;
  if (td.dataset.rel) return `r:${td.dataset.rel}:${td.dataset.b}`;
  return null;
}
function findCellById(id) {
  if (!id) return null;
  const [kind, a, b] = id.split(':');
  if (kind === 'a') return el.gridViewport.querySelector(`td.editable-cell[data-addr="${a}"]`);
  return [...el.gridViewport.querySelectorAll('td.editable-cell[data-rel]')].find((t) => t.dataset.rel === a && t.dataset.b === b) || null;
}
function neighborCellId(td, dir) {
  const list = [...el.gridViewport.querySelectorAll('td.editable-cell')].filter((t) => cellIdOf(t));
  const i = list.indexOf(td);
  const next = i >= 0 ? list[i + dir] : null;
  return next ? cellIdOf(next) : null;
}
// 다시 그린 뒤(또는 그대로 둔 뒤) 열어야 할 칸이 있으면 연다
function openPendingEdit() {
  const id = state.nextEditId;
  if (!id) return;
  state.nextEditId = null;
  const td = findCellById(id);
  if (!td) return;
  td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  td.click();
}

function startInlineEdit(td, initialValue, onCommit, suggestKey = null) {
  if (td.querySelector('.cell-editor-input')) return;
  state.nextEditId = null;
  const saved = [...td.childNodes];
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
    if (commit && input.value !== initialValue) {
      if (suggestKey) rememberValue(suggestKey, input.value);
      onCommit(input.value); // 다시 그린 뒤 openPendingEdit()
      return;
    }
    // 바뀐 게 없으면 다시 그리지 않고 칸만 원래대로(다른 칸을 누른 클릭이 사라지지 않게)
    if (input.isConnected) td.replaceChildren(...saved);
    openPendingEdit();
  };
  // [자동완성 2026-11-25] 같은 칸에 예전에 적은 값 보여 주기
  if (suggestKey) attachSuggest(input, suggestKey, () => finish(true));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      // Enter = 저장하고 다음 칸, ⌘Enter = 저장하고 그대로, ⇧Enter = 칸 안 줄바꿈
      e.preventDefault();
      if (!(e.metaKey || e.ctrlKey)) state.nextEditId = neighborCellId(td, 1);
      finish(true);
    } else if (e.key === 'Tab' && !e.isComposing) {
      e.preventDefault();
      state.nextEditId = neighborCellId(td, e.shiftKey ? -1 : 1);
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.nextEditId = null;
      finish(false);
    }
  });
  input.addEventListener('blur', (e) => {
    // 다른 칸 편집으로 넘어가며 잃은 초점이면, 다시 그린 뒤 그 칸을 연다
    const rt = e.relatedTarget;
    if (rt && rt.classList && rt.classList.contains('cell-editor-input') && !state.nextEditId) state.nextEditId = cellIdOf(rt.parentElement);
    finish(true);
  });
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
