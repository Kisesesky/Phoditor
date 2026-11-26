// [renderer/10-extras.js] PDF 내보내기, 넘치는 글자 경고, 사진 위 표시, 지난 현장 복제
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

// =====================================================================
// [3순위 2026-11-25] PDF 내보내기 · 넘치는 글자 경고/칸에 맞게 줄이기 · 반복값 표시 · 사진 위 표시 · 지난 현장 복제
// =====================================================================

// --- PDF 내보내기 (Mac Excel로 인쇄) ---
async function handleExportPdf() {
  if (!state.editor) return;
  el.pdfBtn.disabled = true;
  showToast('PDF 만드는 중… Excel이 잠시 열렸다 닫혀요(처음이면 "Excel 제어 허용"을 눌러 주세요).', 60000);
  try {
    const res = await window.api.exportPdf({
      templateId: state.templateDef.id,
      editorState: state.editor,
      suggestedName: `${currentSiteName() || state.templateDef.company}_${state.templateDef.type}`
    });
    if (res.canceled) return hideToast();
    if (res.ok) showToast(`PDF 저장 완료: ${res.filePath.split('/').pop()} (${res.pages || '?'}쪽, ${(res.sizeBytes / 1048576).toFixed(1)}MB)`, 5000);
    else showToast(`PDF를 만들지 못했어요: ${res.error}`, 8000);
  } finally {
    el.pdfBtn.disabled = false;
  }
}

// --- 넘치는 글자 찾기 (화면에 그린 뒤 실제로 재서) ---
function markOverflows(res) {
  const found = [];
  for (const pg of res.pages) {
    for (const td of pg.table.querySelectorAll('td.editable-cell')) {
      const txt = td.textContent.trim();
      if (!txt || !td.dataset.user) continue;
      if (td.dataset.shrink) continue;
      // [2026-11-26] 직접 입력한 글이 칸보다 길면 칸 안에서 줄을 바꾼다(엑셀에도 "텍스트 줄 바꿈"으로 저장)
      if (!td.classList.contains('wrap') && !td.dataset.nowrap && td.scrollWidth > td.clientWidth + 2) {
        td.classList.add('wrap', 'auto-wrap');
      }
      const wrap = td.classList.contains('wrap');
      let over = false;
      if (wrap) {
        // 표 행은 글이 길면 저절로 커지지만 엑셀 행 높이는 그대로다 → 행 높이만큼만 보여 주고 넘치면 경고
        let allowed = 0;
        let tr = td.parentElement;
        for (let k = 0; k < (td.rowSpan || 1) && tr; k++, tr = tr.nextElementSibling) allowed += parseFloat(tr.style.height) || 0;
        if (allowed > 0 && !td.querySelector('.cell-editor-input')) {
          const clip = document.createElement('div');
          clip.className = 'wrap-clip';
          clip.style.maxHeight = `${Math.max(1, allowed - 1)}px`;
          while (td.firstChild) clip.appendChild(td.firstChild);
          td.appendChild(clip);
          over = clip.scrollHeight > clip.clientHeight + 2;
        } else over = td.scrollHeight > td.clientHeight + 2;
      }
      else if (td.scrollWidth > td.clientWidth + 2) {
        const next = td.nextElementSibling;
        const align = td.style.textAlign || 'left';
        // 엑셀은 왼쪽 맞춤 글자가 옆 칸이 비어 있으면 넘어가서 보여 준다
        over = align !== 'left' || !next || !!next.textContent.trim() || td.colSpan > 1;
      }
      if (over) {
        td.classList.add('overflow');
        td.title = '칸보다 글자가 길어 인쇄할 때 잘리거나 넘칠 수 있어요. 칸을 눌러 [칸에 맞게 줄이기]를 쓰세요.';
        found.push(td);
      }
    }
  }
  // 칸에 맞게 줄이기: 화면에서도 글자 크기를 줄여 맞춘다(엑셀 "셀에 맞춤"과 같은 효과)
  for (const pg of res.pages) {
    for (const td of pg.table.querySelectorAll('td[data-shrink]')) {
      const orig = parseFloat(td.style.fontSize) || 14.667;
      let size = orig;
      let guard = 0;
      while (td.scrollWidth > td.clientWidth + 1 && size > 5 && guard++ < 40) {
        size -= 0.5;
        td.style.fontSize = `${size}px`;
      }
      // [2026-11-26] 너무 많이 줄면(원래의 60% 미만) 인쇄해도 읽기 어렵다 → 경고에 넣는다
      if (td.textContent.trim() && size / orig < 0.6) {
        td.classList.add('overflow', 'too-small');
        td.title = `글자를 칸에 맞추느라 원래 크기의 ${Math.round((size / orig) * 100)}%로 줄었어요. 인쇄하면 읽기 어려울 수 있으니 글을 줄여 주세요.`;
        found.push(td);
      }
    }
  }
  state.overflowCells = found;
  if (el.overflowChip) {
    el.overflowChip.classList.toggle('visible', found.length > 0);
    const small = found.filter((td) => td.classList.contains('too-small')).length;
    el.overflowChip.querySelector('span').textContent = small ? `글자 확인 ${found.length}칸 (너무 작게 줄어든 ${small}칸)` : `넘치는 글자 ${found.length}칸`;
  }
}

// --- 사진 위 표시(화살표·네모·글상자) ---
const ANNO_COLORS = ['#E11D48', '#F97316', '#FACC15', '#16A34A', '#2563EB', '#111827', '#FFFFFF'];
function svgEl(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
// 표시를 그린다. W·H는 사진이 보이는 크기(px), pxPerPt는 글자 크기 환산
function drawAnnotations(container, items, W, H, pxPerPt, opts = {}) {
  container.innerHTML = '';
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'anno-svg' });
  const defs = svgEl('defs', {});
  svg.appendChild(defs);
  items.forEach((a, i) => {
    const sel = opts.selected === i;
    const sw = Math.max(1, (a.w || 3) * (opts.strokeScale || 1));
    if (a.t === 'arrow') {
      const mid = `ah_${opts.uid || 'p'}_${i}`;
      const m = svgEl('marker', { id: mid, viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' });
      m.appendChild(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: a.c }));
      defs.appendChild(m);
      const ln = svgEl('line', { x1: a.x1 * W, y1: a.y1 * H, x2: a.x2 * W, y2: a.y2 * H, stroke: a.c, 'stroke-width': sw, 'marker-end': `url(#${mid})`, 'stroke-linecap': 'round' });
      if (sel) ln.setAttribute('class', 'anno-sel');
      ln.dataset.i = String(i);
      svg.appendChild(ln);
    } else if (a.t === 'box') {
      const r = svgEl('rect', { x: Math.min(a.x, a.x + a.w2) * W, y: Math.min(a.y, a.y + a.h2) * H, width: Math.abs(a.w2) * W, height: Math.abs(a.h2) * H, fill: 'none', stroke: a.c, 'stroke-width': sw });
      if (sel) r.setAttribute('class', 'anno-sel');
      r.dataset.i = String(i);
      svg.appendChild(r);
    }
  });
  container.appendChild(svg);
  items.forEach((a, i) => {
    if (a.t !== 'text') return;
    const d = document.createElement('div');
    d.className = 'anno-text' + (opts.selected === i ? ' anno-sel' : '');
    d.dataset.i = String(i);
    d.style.left = `${Math.min(a.x, a.x + a.w2) * W}px`;
    d.style.top = `${Math.min(a.y, a.y + a.h2) * H}px`;
    d.style.width = `${Math.abs(a.w2) * W}px`;
    d.style.height = `${Math.abs(a.h2) * H}px`;
    d.style.color = a.c;
    d.style.fontSize = `${(a.size || 10) * pxPerPt}px`;
    d.style.fontWeight = a.bold === false ? '400' : '700';
    d.style.background = a.bg || 'transparent';
    d.style.border = a.border === false ? 'none' : `${Math.max(1, 1.5 * (opts.strokeScale || 1))}px solid ${a.c}`;
    d.textContent = a.text || '';
    container.appendChild(d);
  });
}

// 사진 자리 안에 표시 겹쳐 그리기(사진이 보이는 사각형에 맞춤)
function overlaySlotAnnotations(slotEl, img, photo) {
  if (!photo.annotations || !photo.annotations.length) return;
  const layer = document.createElement('div');
  layer.className = 'anno-layer';
  slotEl.appendChild(layer);
  const place = () => {
    const W = slotEl.clientWidth - 8;
    const H = slotEl.clientHeight - 8;
    const nw = img.naturalWidth || photo.croppedWidth || 4;
    const nh = img.naturalHeight || photo.croppedHeight || 3;
    const k = Math.min(W / nw, H / nh);
    const w = nw * k;
    const h = nh * k;
    layer.style.left = `${4 + (W - w) / 2}px`;
    layer.style.top = `${4 + (H - h) / 2}px`;
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
    drawAnnotations(layer, photo.annotations, w, h, ptToPx(1), { uid: `s${Math.random().toString(36).slice(2, 7)}` });
  };
  if (img.complete && img.naturalWidth) requestAnimationFrame(place);
  else img.addEventListener('load', place, { once: true });
}

function openAnnotationEditor(target) {
  const pa = state.editor.sheets[target.sheetIdx].blocks[target.blockIdx].photoAreas[target.paIdx];
  const photo = pa && pa.slots[target.slotIdx];
  if (!photo) return;
  const slotDom = document.querySelectorAll('.pv-page .photo-slot');
  // 인쇄될 사진 폭(px) — 글자 크기를 인쇄와 같은 비율로 보이게
  let printW = 360;
  for (const s of slotDom) if (s.classList.contains('selected-slot')) printW = Math.max(60, s.clientWidth - 8);
  let items = deepClone(photo.annotations || []);
  let tool = 'arrow';
  let color = '#E11D48';
  let width = 3;
  let size = 11;
  let selected = -1;
  const stage = h('div', { class: 'anno-stage' });
  const img = h('img', { class: 'anno-img', draggable: 'false' });
  const layer = h('div', { class: 'anno-edit-layer' });
  stage.append(img, layer);
  let W = 1;
  let H = 1;
  const redraw = () => drawAnnotations(layer, items, W, H, ptToPx(1) * (W / printW), { selected, strokeScale: W / printW, uid: 'ed' });
  const fit = () => {
    const maxW = Math.min(window.innerWidth * 0.78, 1100);
    const maxH = window.innerHeight * 0.62;
    const nw = img.naturalWidth || 4;
    const nh = img.naturalHeight || 3;
    const k = Math.min(maxW / nw, maxH / nh);
    W = Math.round(nw * k);
    H = Math.round(nh * k);
    img.style.width = `${W}px`;
    img.style.height = `${H}px`;
    layer.style.width = `${W}px`;
    layer.style.height = `${H}px`;
    redraw();
  };
  img.addEventListener('load', fit);
  img.src = photo.isCropped ? photo.thumbUrl : photo.previewUrl || photo.thumbUrl;
  if (!photo.isCropped && !photo.previewUrl && photo.path) window.api.getSlotPreview(photo.path).then((u) => { if (u) img.src = u; });

  const toolBtns = [['select', '선택·이동'], ['arrow', '화살표'], ['box', '네모'], ['text', '글상자']].map(([k, label]) => {
    const b = h('button', { class: k === tool ? 'on' : '', onclick: () => { tool = k; toolBtns.forEach((x) => x.classList.toggle('on', x === b)); } }, label);
    return b;
  });
  const colorBtns = ANNO_COLORS.map((c) => {
    const b = h('button', { class: 'swatch' + (c === color ? ' on' : ''), style: `background:${c}`, title: c, onclick: () => {
      color = c;
      colorBtns.forEach((x) => x.classList.toggle('on', x === b));
      if (selected >= 0) { items[selected].c = c; redraw(); }
    } });
    return b;
  });
  const widthSel = h('select', {}, ...[2, 3, 5, 8].map((v) => h('option', { value: String(v), text: `선 ${v}` })));
  widthSel.value = String(width);
  widthSel.addEventListener('change', () => { width = +widthSel.value; if (selected >= 0 && items[selected].t !== 'text') { items[selected].w = width; redraw(); } });
  const sizeSel = h('select', {}, ...[8, 9, 10, 11, 12, 14, 18, 24].map((v) => h('option', { value: String(v), text: `글자 ${v}pt` })));
  sizeSel.value = String(size);
  sizeSel.addEventListener('change', () => { size = +sizeSel.value; if (selected >= 0 && items[selected].t === 'text') { items[selected].size = size; redraw(); } });
  const delBtn = h('button', { class: 'danger', onclick: () => { if (selected >= 0) { items.splice(selected, 1); selected = -1; redraw(); } } }, '선택 지우기');

  // 그리기·이동
  let drag = null;
  const rel = (e) => {
    const r = layer.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const hitIndex = (e) => {
    const t = e.target.closest('[data-i]');
    return t ? +t.dataset.i : -1;
  };
  const editText = (i) => {
    const a = items[i];
    const box = layer.querySelector(`.anno-text[data-i="${i}"]`);
    if (!box) return;
    const ta = h('textarea', { class: 'anno-text-edit' });
    ta.value = a.text || '';
    ta.style.cssText = box.style.cssText;
    layer.appendChild(ta);
    ta.focus();
    ta.select();
    const done = () => { a.text = ta.value; ta.remove(); if (!a.text.trim()) { items.splice(i, 1); selected = -1; } redraw(); };
    ta.addEventListener('blur', done, { once: true });
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); ta.blur(); } ev.stopPropagation(); });
  };
  layer.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    const p = rel(e);
    const hit = hitIndex(e);
    if (tool === 'select' || hit >= 0) {
      selected = hit;
      redraw();
      if (hit >= 0) drag = { mode: 'move', start: p, orig: deepClone(items[hit]) };
      return;
    }
    if (tool === 'arrow') { items.push({ t: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: color, w: width }); }
    else if (tool === 'box') { items.push({ t: 'box', x: p.x, y: p.y, w2: 0, h2: 0, c: color, w: width }); }
    else if (tool === 'text') {
      items.push({ t: 'text', x: Math.min(p.x, 0.7), y: Math.min(p.y, 0.88), w2: 0.3, h2: 0.12, text: '', c: color, size, bg: '#FFFFFF' });
      selected = items.length - 1;
      redraw();
      editText(selected);
      return;
    }
    selected = items.length - 1;
    drag = { mode: 'draw', start: p };
  });
  const onMove = (e) => {
    if (!drag) return;
    const p = rel(e);
    const a = items[selected];
    if (!a) return;
    if (drag.mode === 'draw') {
      if (a.t === 'arrow') { a.x2 = p.x; a.y2 = p.y; } else { a.w2 = p.x - a.x; a.h2 = p.y - a.y; }
    } else {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const o = drag.orig;
      if (a.t === 'arrow') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; } else { a.x = o.x + dx; a.y = o.y + dy; }
    }
    redraw();
  };
  const onUp = () => {
    if (drag && drag.mode === 'draw') {
      const a = items[selected];
      const tiny = a.t === 'arrow' ? Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 0.02 : Math.abs(a.w2) < 0.02 || Math.abs(a.h2) < 0.02;
      if (tiny) { items.splice(selected, 1); selected = -1; redraw(); }
    }
    drag = null;
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  layer.addEventListener('dblclick', (e) => { const i = hitIndex(e); if (i >= 0 && items[i].t === 'text') editText(i); });
  const onKey = (e) => {
    if (!back.isConnected) return;
    if (e.target.tagName === 'TEXTAREA') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { e.preventDefault(); items.splice(selected, 1); selected = -1; redraw(); }
  };
  document.addEventListener('keydown', onKey);
  const cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.removeEventListener('keydown', onKey); };
  const back = openModal('사진 위 표시', [
    h('div', { class: 'anno-toolbar' }, h('div', { class: 'seg-sm anno-tools' }, ...toolBtns), h('div', { class: 'swatches' }, ...colorBtns), widthSel, sizeSel, delBtn,
      h('button', { onclick: () => { if (items.length && confirm('표시를 모두 지울까요?')) { items = []; selected = -1; redraw(); } } }, '모두 지우기')),
    stage,
    h('div', { class: 'insp-note', text: '사진 위를 끌어서 화살표·네모를 그리고, 글상자는 누른 자리에 글을 써요. 이동은 끌기, 글 고치기는 두 번 누르기, 지우기는 Delete. 내보낸 엑셀에는 고칠 수 있는 도형으로 들어가요.' })
  ], [
    h('button', { onclick: () => { cleanup(); back.remove(); } }, '취소'),
    h('button', { class: 'primary', id: 'annoDoneBtn', onclick: () => {
      cleanup();
      back.remove();
      recordUndo('사진 위 표시');
      const cur = state.editor.sheets[target.sheetIdx].blocks[target.blockIdx].photoAreas[target.paIdx];
      if (cur && cur.slots[target.slotIdx]) cur.slots[target.slotIdx] = { ...cur.slots[target.slotIdx], annotations: items.filter((a) => a.t !== 'text' || (a.text || '').trim()) };
      renderActiveSheet();
      showToast(items.length ? `표시 ${items.length}개를 넣었어요.` : '표시를 모두 지웠어요.');
    } }, '완료')
  ], Math.min(1180, Math.round(window.innerWidth * 0.88)));
  back.classList.add('anno-modal');
  back.__items = () => items;
  back.__setTool = (t) => { tool = t; toolBtns.forEach((x, i) => x.classList.toggle('on', ['select', 'arrow', 'box', 'text'][i] === t)); };
}

// --- 지난 현장 복제: 저장한 작업을 바탕으로 새 현장 시작 ---
async function duplicateProject(filePath) {
  if (!(await confirmLeave())) return;
  const res = await window.api.projectOpen(filePath);
  if (!res || !res.ok) return showToast(`열지 못했어요: ${(res && res.error) || ''}`);
  const data = res.data;
  const nameIn = h('input', { type: 'text', placeholder: '새 현장명 (예: 부천 상동 롯데캐슬)' });
  const keepText = h('input', { type: 'checkbox', checked: true });
  const keepBlocks = h('input', { type: 'checkbox', checked: true });
  const back = openModal('지난 현장 복제', [
    h('div', { class: 'insp-note', text: `"${data.title || filePath.split('/').pop()}"을(를) 바탕으로 새 작업을 만들어요. 사진은 비우고, 원래 작업 파일은 바뀌지 않아요.` }),
    h('div', { class: 'form-row' }, h('label', { text: '새 현장명' }), nameIn),
    h('label', { class: 'check-row' }, keepText, ' 위치·품목 등 글자 남기기'),
    h('label', { class: 'check-row' }, keepBlocks, ' 블록 개수·사진 배치(1~4장) 남기기')
  ], [
    h('button', { onclick: () => back.remove() }, '취소'),
    h('button', { class: 'primary', id: 'dupGoBtn', onclick: async () => {
      back.remove();
      const ed = data.editor;
      for (const s of ed.sheets) {
        if (s.role === 'block') {
          if (!keepBlocks.checked) s.blocks = [s.blocks[0] || { values: {}, extraCells: {}, photoAreas: {} }];
          for (const b of s.blocks) {
            for (const pa of Object.values(b.photoAreas || {})) if (pa && Array.isArray(pa.slots)) pa.slots = pa.slots.map(() => null);
            if (!keepBlocks.checked) b.photoAreas = {};
            if (!keepText.checked) { b.values = {}; b.extraCells = {}; }
          }
          s.headerValues = {};
        }
      }
      ed.siteName = nameIn.value.trim();
      data.photoFolder = null;
      await openTemplate(data.templateId, data);
      // 표지 현장명 칸·머리 행 현장명 칸에도 새 현장명
      if (ed.siteName) {
        for (const s of state.editor.sheets) {
          if (s.role === 'cover') {
            const f = (s.sheetDef.coverFields || s.sheetDef.coverFieldCandidates || []).find((cf) => cf.kind === 'siteName');
            if (f) s.cells[f.cell] = ed.siteName;
          }
          if (s.role === 'block') {
            for (const hf of s.sheetDef.block.headerFields || []) {
              if (/현장/.test(hf.label || '')) {
                s.headerValues = s.headerValues || {};
                s.headerValues[String(hf.cell).toUpperCase()] = ed.siteName;
              }
            }
          }
        }
      }
      state.activeSheetIdx = 0;
      docState.filePath = null;
      markDirty();
      rerenderAll();
      showToast('지난 현장을 복제했어요. 사진을 넣고 새 이름으로 저장하세요(⌘S).', 4500);
    } }, '복제해서 시작')
  ], 480);
  setTimeout(() => nameIn.focus(), 30);
}
