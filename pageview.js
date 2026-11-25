// [쪽 보기 2026-11-25] 시트를 "인쇄되는 쪽"으로 그린다(렌더러 전용, window.PageView).
// 용지·여백·배율(맞춤)·인쇄 영역·반복 행·가운데 맞춤·쪽 나누기·머리말/바닥글·그림/도형을 Excel 인쇄 규칙에 가깝게 따른다.
// 칸 내용·편집 동작은 호출하는 쪽(renderer.js)의 cell() 콜백이 채운다.
(function () {
  const PAPER_IN = { 1: [8.5, 11], 5: [8.5, 14], 8: [11.69, 16.54], 9: [8.27, 11.69], 10: [8.27, 11.69], 11: [5.83, 8.27], 13: [7.17, 10.12] };
  const PX_PER_IN = 96;
  const ptToPx = (pt) => (pt * 96) / 72;

  // 열 너비(문자 단위) → 픽셀. Excel 규칙: Truncate(((256*w + Truncate(128/MDW)) / 256) * MDW)
  function colPx(widthCh, mdw) {
    return Math.max(0, Math.floor(((256 * widthCh + Math.floor(128 / mdw)) / 256) * mdw));
  }

  // 기본 글꼴의 숫자 최대 폭(MDW)을 실제 글꼴로 잰다
  const mdwCache = new Map();
  function measureMdw(fontFamilyCss, sizePt) {
    const key = `${fontFamilyCss}|${sizePt}`;
    if (mdwCache.has(key)) return mdwCache.get(key);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${ptToPx(sizePt)}px ${fontFamilyCss}`;
    let w = 0;
    for (const d of '0123456789') w = Math.max(w, ctx.measureText(d).width);
    // Excel은 힌팅된 정수 폭을 쓴다(Calibri 11 = 7, 돋움 11 = 8): 내림
    const mdw = Math.max(5, Math.floor(w + 0.05));
    mdwCache.set(key, mdw);
    return mdw;
  }

  function pageGeometry(page, contentW, contentH) {
    const [pw, ph] = PAPER_IN[page.paperSize] || PAPER_IN[9];
    const land = page.orientation === 'landscape';
    const paperW = (land ? ph : pw) * PX_PER_IN;
    const paperH = (land ? pw : ph) * PX_PER_IN;
    const m = page.margins;
    const availW = paperW - (m.left + m.right) * PX_PER_IN;
    const availH = paperH - (m.top + m.bottom) * PX_PER_IN;
    let s;
    if (page.fitToPage) {
      s = 1;
      if (page.fitToWidth > 0 && contentW > 0) s = Math.min(s, (availW * page.fitToWidth) / contentW);
      if (page.fitToHeight > 0 && contentH > 0) s = Math.min(s, (availH * page.fitToHeight) / contentH);
      s = Math.max(0.1, s);
    } else {
      s = Math.max(0.1, Math.min(4, (page.scale || 100) / 100));
    }
    return { paperW, paperH, availW, availH, s, m };
  }

  /**
   * 쪽 나누기 (DOM 없이 계산). rows: [{heightPx, breakBefore?, title?}]
   * @returns {number[][]} 쪽마다 rows 인덱스
   */
  function paginate(rows, capacityPx, titleIdx) {
    const titleH = titleIdx.reduce((a, i) => a + rows[i].heightPx, 0);
    const titleSet = new Set(titleIdx);
    const pages = [];
    let cur = [];
    let h = 0;
    rows.forEach((row, i) => {
      if (row.heightPx <= 0) return;
      const overflow = h + row.heightPx > capacityPx + 0.5;
      if (cur.length && (row.breakBefore || overflow) && !(titleSet.has(i) && pages.length === 0)) {
        pages.push(cur);
        cur = titleIdx.length && !titleSet.has(i) ? [...titleIdx] : [];
        h = cur.length ? titleH : 0;
      }
      cur.push(i);
      h += row.heightPx;
    });
    if (cur.length) pages.push(cur);
    return pages.length ? pages : [[]];
  }

  // 머리말/바닥글 코드(&L &C &R &P &N &"글꼴,모양" &12 &K색 &B &I &U &G)
  function parseHeaderFooter(code, pageNo, pageTotal, siteName) {
    if (!code) return null;
    const secs = { L: [], C: [], R: [] };
    let cur = 'C';
    let style = { size: 11, bold: false, italic: false, font: null, color: null };
    let buf = '';
    const flush = () => {
      if (buf) secs[cur].push({ text: buf, ...style });
      buf = '';
    };
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch !== '&') { buf += ch; continue; }
      const nx = code[i + 1];
      if (nx === '&') { buf += '&'; i++; continue; }
      if (nx === 'L' || nx === 'C' || nx === 'R') { flush(); cur = nx; style = { ...style }; i++; continue; }
      if (nx === 'P') { buf += String(pageNo); i++; continue; }
      if (nx === 'N') { buf += String(pageTotal); i++; continue; }
      if (nx === 'D' || nx === 'T' || nx === 'F' || nx === 'A' || nx === 'Z' || nx === 'G') { i++; continue; }
      if (nx === 'B') { flush(); style = { ...style, bold: !style.bold }; i++; continue; }
      if (nx === 'I') { flush(); style = { ...style, italic: !style.italic }; i++; continue; }
      if (nx === 'U' || nx === 'E' || nx === 'S' || nx === 'X' || nx === 'Y') { i++; continue; }
      if (nx === '"') {
        const end = code.indexOf('"', i + 2);
        if (end > 0) {
          flush();
          const [font, st] = code.slice(i + 2, end).split(',');
          style = { ...style, font: font && font !== '-' && font !== '+' ? font : style.font, bold: /굵게|Bold/i.test(st || '') ? true : /보통|Regular/i.test(st || '') ? false : style.bold };
          i = end;
          continue;
        }
      }
      if (nx === 'K') { flush(); style = { ...style, color: /^[0-9A-Fa-f]{6}/.test(code.slice(i + 2, i + 8)) ? `#${code.slice(i + 2, i + 8)}` : style.color }; i += 7; continue; }
      const num = /^\d+/.exec(code.slice(i + 1));
      if (num) { flush(); style = { ...style, size: +num[0] }; i += num[0].length; continue; }
    }
    flush();
    for (const k of Object.keys(secs)) secs[k] = secs[k].map((r) => ({ ...r, text: r.text.replace(/\{\{현장명\}\}/g, siteName || '현장명') }));
    return secs;
  }

  function renderHeaderFooter(pageEl, code, isHeader, geo, ctx) {
    const secs = parseHeaderFooter(code, ctx.pageNo, ctx.pageTotal, ctx.siteName);
    if (!secs) return;
    const band = document.createElement('div');
    band.className = 'pv-hf ' + (isHeader ? 'pv-header' : 'pv-footer');
    band.style.left = `${geo.m.left * PX_PER_IN}px`;
    band.style.right = `${geo.m.right * PX_PER_IN}px`;
    if (isHeader) band.style.top = `${(geo.m.header || 0) * PX_PER_IN}px`;
    else band.style.bottom = `${(geo.m.footer || 0) * PX_PER_IN}px`;
    for (const k of ['L', 'C', 'R']) {
      const sec = document.createElement('div');
      sec.className = `pv-hf-${k}`;
      for (const r of secs[k]) {
        const sp = document.createElement('span');
        sp.textContent = r.text;
        sp.style.fontSize = `${ptToPx(r.size) * geo.s}px`;
        if (r.bold) sp.style.fontWeight = '700';
        if (r.italic) sp.style.fontStyle = 'italic';
        if (r.color) sp.style.color = r.color;
        if (r.font) sp.style.fontFamily = ctx.fontCss(r.font).family;
        sec.appendChild(sp);
      }
      band.appendChild(sec);
    }
    pageEl.appendChild(band);
  }

  function edgeBorders(model, r1, c1, r2, c2) {
    const at = (r, c) => model.cells[`${r},${c}`] || {};
    const pick = (list, key) => { for (const x of list) if (x[key]) return x[key]; return null; };
    const tops = [], bottoms = [], lefts = [], rights = [];
    for (let c = c1; c <= c2; c++) { tops.push(at(r1, c)); bottoms.push(at(r2, c)); }
    for (let r = r1; r <= r2; r++) { lefts.push(at(r, c1)); rights.push(at(r, c2)); }
    return { t: pick(tops, 'bT'), b: pick(bottoms, 'bB'), l: pick(lefts, 'bL'), r: pick(rights, 'bR') };
  }

  /**
   * 한 시트를 쪽들로 그린다.
   * opts: { model, rows:[{tpl, kind, bIdx?, rOff?, heightPt?, breakBefore?}], cols:[c..], mdw, fontCss(name)->{family,weight},
   *         extraMerges(spec)->[{c1,c2,rows}], cell(td, spec, c, cellModel, span), showGrid, siteName, pageNoStart, pageTotal,
   *         drawingRows:Set(tpl rows where drawings may show), zoom }
   * 반환: { pages:[{el, rowIdx}], geo }
   */
  function renderSheet(container, opts) {
    const { model } = opts;
    const page = model.page;
    const colW = opts.cols.map((c) => (model.hiddenCols.includes(c) ? 0 : colPx(model.colWidthsCh[c - 1] ?? model.defaultColWidth, opts.mdw)));
    const contentW = colW.reduce((a, b) => a + b, 0);
    const rowSpecs = opts.rows.map((spec) => {
      const pt = spec.heightPt ?? (model.rowHeightsPt[spec.tpl - 1] ?? model.defaultRowHeight);
      const hidden = spec.kind !== 'spacer' && model.hiddenRows.includes(spec.tpl) && spec.kind !== 'block';
      return { ...spec, heightPx: hidden ? 0 : ptToPx(pt) };
    });
    const contentH = rowSpecs.reduce((a, r) => a + r.heightPx, 0);
    const geo = pageGeometry(page, contentW, contentH);
    const titleIdx = [];
    if (page.titleRows) rowSpecs.forEach((r, i) => { if (r.kind !== 'block' && r.tpl >= page.titleRows[0] && r.tpl <= page.titleRows[1]) titleIdx.push(i); });
    const pageRows = paginate(rowSpecs, geo.availH / geo.s, titleIdx);

    // 열 왼쪽 위치(그림 위치 계산용)
    const colLeftAll = [0];
    for (let c = 1; c <= Math.max(model.colCount, ...opts.cols) + 50; c++) {
      const w = model.hiddenCols.includes(c) ? 0 : colPx(model.colWidthsCh[c - 1] ?? model.defaultColWidth, opts.mdw);
      colLeftAll.push(colLeftAll[c - 1] + w);
    }
    const originX = colLeftAll[opts.cols[0] - 1];

    const result = [];
    pageRows.forEach((idxs, pIdx) => {
      const pageEl = document.createElement('div');
      pageEl.className = 'pv-page';
      pageEl.style.width = `${geo.paperW}px`;
      pageEl.style.height = `${geo.paperH}px`;
      pageEl.dataset.page = String(pIdx);

      const area = document.createElement('div');
      area.className = 'pv-area';
      area.style.left = `${geo.m.left * PX_PER_IN}px`;
      area.style.top = `${geo.m.top * PX_PER_IN}px`;
      area.style.width = `${geo.availW}px`;
      area.style.height = `${geo.availH}px`;

      const content = document.createElement('div');
      content.className = 'pv-content';
      content.style.zoom = String(geo.s);
      const pageH = idxs.reduce((a, i) => a + rowSpecs[i].heightPx, 0);
      const offX = page.hCenter ? Math.max(0, (geo.availW / geo.s - contentW) / 2) : 0;
      const offY = page.vCenter ? Math.max(0, (geo.availH / geo.s - pageH) / 2) : 0;
      content.style.left = `${offX}px`;
      content.style.top = `${offY}px`;
      content.style.width = `${contentW}px`;

      const table = document.createElement('table');
      table.className = 'pv-grid' + (opts.showGrid ? ' show-grid' : '');
      table.style.width = `${contentW}px`;
      const cg = document.createElement('colgroup');
      colW.forEach((w) => { const col = document.createElement('col'); col.style.width = `${w}px`; cg.appendChild(col); });
      table.appendChild(cg);
      const tbody = document.createElement('tbody');

      // 병합(쪽 안에서만 이어짐): 같은 tpl 흐름이 이어지는 동안만 rowSpan
      const covered = new Set();
      const tplRowTop = new Map();
      let y = 0;
      idxs.forEach((i, k) => {
        const spec = rowSpecs[i];
        const tr = document.createElement('tr');
        tr.style.height = `${spec.heightPx}px`;
        if (spec.kind === 'block') { tr.dataset.b = String(spec.bIdx); tr.classList.add('pv-block-row'); }
        if (spec.kind === 'spacer') tr.classList.add('pv-spacer');
        if (spec.kind !== 'block' && spec.kind !== 'spacer' && !tplRowTop.has(spec.tpl)) tplRowTop.set(spec.tpl, y);
        y += spec.heightPx;
        const merges = [];
        if (spec.kind !== 'spacer') {
          for (const ref of model.merges) {
            const m = /([A-Z]+)(\d+):([A-Z]+)(\d+)/.exec(ref);
            if (!m) continue;
            const cn = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
            const r1 = +m[2], r2 = +m[4];
            if (r1 !== spec.tpl) continue;
            merges.push({ c1: cn(m[1]), c2: cn(m[3]), rows: r2 - r1 + 1, r1, r2 });
          }
          if (opts.mergeFilter) {
            const kept = merges.filter((mm) => opts.mergeFilter(spec, mm));
            merges.length = 0;
            merges.push(...kept);
          }
          for (const em of (opts.extraMerges && opts.extraMerges(spec)) || []) merges.unshift(em);
        }
        // 이어지는 행 수(같은 블록·같은 흐름)로 rowSpan을 자른다
        const runLen = (n) => {
          let len = 1;
          for (let j = 1; j < n && k + j < idxs.length; j++) {
            const nx = rowSpecs[idxs[k + j]];
            if (nx.kind !== spec.kind || nx.bIdx !== spec.bIdx || nx.tpl !== spec.tpl + j) break;
            len++;
          }
          return len;
        };
        opts.cols.forEach((c, ci) => {
          const key = `${k},${c}`;
          if (covered.has(key)) return;
          const mg = merges.find((mm) => mm.c1 === c);
          const inside = merges.find((mm) => c > mm.c1 && c <= mm.c2);
          if (inside) return; // 같은 행의 병합에 덮임
          const td = document.createElement('td');
          let span = null;
          if (mg) {
            const rows = runLen(mg.rows);
            const lastCi = opts.cols.indexOf(Math.min(mg.c2, opts.cols[opts.cols.length - 1]));
            const colSpan = Math.max(1, lastCi - ci + 1);
            if (rows > 1) td.rowSpan = rows;
            if (colSpan > 1) td.colSpan = colSpan;
            for (let j = 0; j < rows; j++) for (let cc = mg.c1; cc <= mg.c2; cc++) if (j || cc !== c) covered.add(`${k + j},${cc}`);
            span = { r1: spec.tpl, r2: spec.tpl + rows - 1, c1: c, c2: mg.c2, extra: mg.extra };
          }
          const cm = spec.kind === 'spacer' ? null : model.cells[`${spec.tpl},${c}`];
          if (cm) {
            const eb = span ? edgeBorders(model, span.r1, span.c1, span.r2, span.c2) : { t: cm.bT, b: cm.bB, l: cm.bL, r: cm.bR };
            if (eb.t) td.style.borderTop = eb.t;
            if (eb.b) td.style.borderBottom = eb.b;
            if (eb.l) td.style.borderLeft = eb.l;
            if (eb.r) td.style.borderRight = eb.r;
          }
          opts.cell(td, spec, c, cm, span);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      content.appendChild(table);

      // 그림·도형: 이 쪽에 그 행이 있을 때만(블록 시트는 블록 위 머리 행만)
      for (const d of model.drawings || []) {
        const tplFrom = d.from.row + 1;
        if (opts.drawingRows && !opts.drawingRows.has(tplFrom)) continue;
        if (!tplRowTop.has(tplFrom)) continue;
        const rowTopIn = (tpl) => {
          if (tplRowTop.has(tpl)) return tplRowTop.get(tpl);
          // 쪽에 없는 행: 위 행부터 높이를 더해 추정
          let yy = tplRowTop.get(tplFrom);
          for (let r = tplFrom; r < tpl; r++) yy += model.hiddenRows.includes(r) ? 0 : ptToPx(model.rowHeightsPt[r - 1] ?? model.defaultRowHeight);
          return yy;
        };
        const x1 = colLeftAll[d.from.col] - originX + d.from.colOff;
        const y1 = rowTopIn(tplFrom) + d.from.rowOff;
        let w, h;
        if (d.to) {
          w = colLeftAll[d.to.col] - originX + d.to.colOff - x1;
          h = rowTopIn(d.to.row + 1) + d.to.rowOff - y1;
        } else if (d.ext) { w = d.ext.w; h = d.ext.h; }
        if (!(w > 0 || h > 0)) continue;
        const el = drawingElement(d, Math.max(w, 1), Math.max(h, 1), opts);
        el.style.left = `${x1}px`;
        el.style.top = `${y1}px`;
        content.appendChild(el);
      }

      area.appendChild(content);
      pageEl.appendChild(area);
      const pageNo = (opts.pageNoStart || 1) + pIdx;
      const hfCtx = { pageNo, pageTotal: opts.pageTotal || pageRows.length, siteName: opts.siteName, fontCss: opts.fontCss };
      renderHeaderFooter(pageEl, page.header, true, geo, hfCtx);
      renderHeaderFooter(pageEl, page.footer, false, geo, hfCtx);

      const holder = document.createElement('div');
      holder.className = 'pv-page-holder';
      holder.style.zoom = String(opts.zoom || 1);
      holder.appendChild(pageEl);
      const label = document.createElement('div');
      label.className = 'pv-page-label';
      label.textContent = `${opts.sheetLabel ? opts.sheetLabel + ' · ' : ''}${pIdx + 1} / ${pageRows.length}쪽`;
      holder.appendChild(label);
      container.appendChild(holder);
      result.push({ el: pageEl, content, table, rowIdx: idxs });
    });
    return { pages: result, geo, pageCount: pageRows.length };
  }

  function drawingElement(d, w, h, opts) {
    if (d.kind === 'pic') {
      const img = document.createElement('img');
      img.className = 'pv-drawing pv-pic';
      img.src = d.src;
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.draggable = false;
      return img;
    }
    if (d.kind === 'line') {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'pv-drawing');
      svg.setAttribute('width', w);
      svg.setAttribute('height', Math.max(h, 1));
      svg.style.overflow = 'visible';
      const ln = document.createElementNS(svgNS, 'line');
      const [ya, yb] = d.flipV ? [h, 0] : [0, h];
      const [xa, xb] = d.flipH ? [w, 0] : [0, w];
      ln.setAttribute('x1', xa); ln.setAttribute('y1', ya); ln.setAttribute('x2', xb); ln.setAttribute('y2', yb);
      ln.setAttribute('stroke', (d.line && d.line.color) || '#000');
      ln.setAttribute('stroke-width', (d.line && d.line.width) || 1);
      svg.appendChild(ln);
      return svg;
    }
    const box = document.createElement('div');
    box.className = 'pv-drawing pv-shape';
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    if (d.fill) box.style.background = d.fill;
    if (d.line) box.style.border = `${d.line.width}px solid ${d.line.color}`;
    if (d.geom === 'ellipse') box.style.borderRadius = '50%';
    if (d.geom === 'roundRect') box.style.borderRadius = '8px';
    if (d.text && d.text.paras.some((p) => p.runs.some((r) => r.text.trim()))) {
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.justifyContent = d.text.anchor === 'ctr' ? 'center' : d.text.anchor === 'b' ? 'flex-end' : 'flex-start';
      for (const p of d.text.paras) {
        const pe = document.createElement('div');
        pe.style.textAlign = p.algn === 'ctr' ? 'center' : p.algn === 'r' ? 'right' : 'left';
        pe.style.whiteSpace = 'pre-wrap';
        for (const r of p.runs) {
          const sp = document.createElement('span');
          sp.textContent = r.text.replace(/\{\{현장명\}\}/g, opts.siteName || '현장명');
          if (r.size) sp.style.fontSize = `${ptToPx(r.size)}px`;
          if (r.bold) sp.style.fontWeight = '700';
          if (r.color) sp.style.color = r.color;
          if (r.font) sp.style.fontFamily = opts.fontCss(r.font).family;
          pe.appendChild(sp);
        }
        box.appendChild(pe);
      }
    }
    return box;
  }

  window.PageView = { renderSheet, paginate, pageGeometry, colPx, measureMdw, ptToPx, parseHeaderFooter };
})();
