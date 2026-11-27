// [분리 2026-11-26] 작업 상태의 복사·실행 취소 기록·저장 형식 바꾸기.
// 화면(renderer.js, <script>로 읽음)과 자동 테스트(test-project.js, require)가 같이 쓴다. DOM·Electron에 기대지 않는다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocModel = api;
})(typeof self !== 'undefined' ? self : this, () => {
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

  // 실행 취소/다시 실행: 바꾸기 "전" 상태를 통째로 기억한다(최대 max단계)
  class UndoHistory {
    constructor(max = 60) {
      this.max = max;
      this.undoStack = [];
      this.redoStack = [];
    }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    }
    get canUndo() {
      return this.undoStack.length > 0;
    }
    get canRedo() {
      return this.redoStack.length > 0;
    }
    // 바꾸기 직전에 부른다. meta: { active, block, label }
    record(editor, meta) {
      this.undoStack.push({ editor: deepClone(editor), ...meta });
      if (this.undoStack.length > this.max) this.undoStack.shift();
      this.redoStack = [];
    }
    // 지금 상태(current)를 다시 실행 쪽에 넣고, 되돌릴 상태를 돌려준다
    undo(current, meta) {
      if (!this.undoStack.length) return null;
      const snap = this.undoStack.pop();
      this.redoStack.push({ editor: deepClone(current), ...meta, label: snap.label });
      return snap;
    }
    redo(current, meta) {
      if (!this.redoStack.length) return null;
      const snap = this.redoStack.pop();
      this.undoStack.push({ editor: deepClone(current), ...meta, label: snap.label });
      return snap;
    }
  }

  // 저장용: 정의서에 있는 시트는 이름(defName)만 적고, 추가한 시트는 정의서 사본을 그대로 둔다. 화면용 미리보기 주소는 뺀다
  function serializeEditor(editor, templateDef) {
    const ed = deepClone(editor);
    ed.sheets = ed.sheets.map((s) => {
      const out = { ...s };
      const tplDef = templateDef.sheets.find((d) => d === s.sheetDef);
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

  // 불러온 뒤: defName을 정의서 시트로 다시 잇는다
  function attachSheetDefs(editor, templateDef) {
    for (const s of editor.sheets) {
      if (s.defName) {
        s.sheetDef = templateDef.sheets.find((d) => d.name === s.defName);
        delete s.defName;
      }
      if (!s.sheetDef) throw new Error(`정의서에 없는 시트: ${s.name}`);
    }
    editor.fontMap = editor.fontMap || {};
    return editor;
  }

  // --- 사진 위 표시 좌표 바꾸기 (2026-11-26) ---
  // 표시는 "지금 보이는 사진"(자르고 돌린 결과) 기준 0~1 좌표로 저장된다.
  // 자르기 영역(rect, 원본 픽셀)이나 돌린 각도(rot: 0·90·180·270, 시계 방향)가 바뀌면
  // 원본 좌표를 거쳐 새 사진 기준 좌표로 옮긴다. 글상자는 글자가 바로 서도록 크기(픽셀)를 유지하고 위치만 옮긴다.
  const norm = (r) => ((Number(r) || 0) % 360 + 360) % 360;
  function rotFwd(u, v, rot) {
    switch (norm(rot)) {
      case 90: return [1 - v, u];
      case 180: return [1 - u, 1 - v];
      case 270: return [v, 1 - u];
      default: return [u, v];
    }
  }
  function rotInv(x, y, rot) {
    switch (norm(rot)) {
      case 90: return [y, 1 - x];
      case 180: return [1 - x, 1 - y];
      case 270: return [1 - y, x];
      default: return [x, y];
    }
  }
  const visSize = (s) => (norm(s.rot) % 180 ? [s.rect.h, s.rect.w] : [s.rect.w, s.rect.h]);
  function toOrig(x, y, s) {
    const [u, v] = rotInv(x, y, s.rot);
    return [s.rect.x + u * s.rect.w, s.rect.y + v * s.rect.h];
  }
  function fromOrig(X, Y, s) {
    return rotFwd((X - s.rect.x) / s.rect.w, (Y - s.rect.y) / s.rect.h, s.rot);
  }
  const mapPt = (x, y, from, to) => {
    const [X, Y] = toOrig(x, y, from);
    return fromOrig(X, Y, to);
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  /**
   * @param items 표시 목록
   * @param from { rect:{x,y,w,h}(원본 픽셀), rot }  지금 사진
   * @param to   { rect, rot }                      바뀐 사진
   * @returns 옮긴 표시(새 사진 밖으로 완전히 나간 것은 뺌)
   */
  function transformAnnotations(items, from, to) {
    const out = [];
    const [fw, fh] = visSize(from);
    const [tw, th] = visSize(to);
    for (const a of items || []) {
      if (a.t === 'arrow') {
        const [x1, y1] = mapPt(a.x1, a.y1, from, to);
        const [x2, y2] = mapPt(a.x2, a.y2, from, to);
        const inside = (x, y) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
        if (!inside(x1, y1) && !inside(x2, y2)) continue;
        out.push({ ...a, x1: clamp01(x1), y1: clamp01(y1), x2: clamp01(x2), y2: clamp01(y2) });
      } else if (a.t === 'box') {
        const [ax, ay] = mapPt(a.x, a.y, from, to);
        const [bx, by] = mapPt(a.x + a.w2, a.y + a.h2, from, to);
        const x0 = clamp01(Math.min(ax, bx)), x1 = clamp01(Math.max(ax, bx));
        const y0 = clamp01(Math.min(ay, by)), y1 = clamp01(Math.max(ay, by));
        if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
        out.push({ ...a, x: x0, y: y0, w2: x1 - x0, h2: y1 - y0 });
      } else if (a.t === 'text') {
        const cx = a.x + a.w2 / 2;
        const cy = a.y + a.h2 / 2;
        const [nx, ny] = mapPt(cx, cy, from, to);
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        const w = (Math.abs(a.w2) * fw) / tw;
        const h = (Math.abs(a.h2) * fh) / th;
        out.push({ ...a, x: clamp01(nx - w / 2), y: clamp01(ny - h / 2), w2: Math.min(1, w), h2: Math.min(1, h) });
      } else out.push({ ...a });
    }
    return out;
  }

  // --- [2026-11-26] 사진 칸 높이: 블록 안에서 사진 영역이 차지하는 행(블록 첫 행 기준 0부터) ---
  function photoRowOffsets(blockDef) {
    const set = new Set();
    for (const pa of (blockDef && blockDef.photoAreas) || []) {
      const m = /\{\+(\d+)\}:[A-Z]+\{\+(\d+)\}/.exec(String(pa.area || ''));
      if (!m) continue;
      for (let r = Number(m[1]); r <= Number(m[2]); r++) set.add(r);
    }
    return set;
  }
  const PHOTO_SCALE_MIN = 0.6;
  const PHOTO_SCALE_MAX = 1.8;
  function clampPhotoScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.round(Math.min(PHOTO_SCALE_MAX, Math.max(PHOTO_SCALE_MIN, n)) * 100) / 100;
  }

  // --- [2026-11-27] 큰 사진 섞인 배치: 하늘채 원본에 자주 나오는 모양을 격자 칸 합치기로 ---
  // cells: [열, 행, 열 수, 행 수] (cols×rows 격자 기준, 0부터). 순서 = 사진 자리 차례(큰 사진 먼저)
  const LAYOUT_SPANS = {
    L12: { cols: 3, rows: 2, label: '왼큰+2', tip: '왼쪽 큰 사진 1장 + 오른쪽 작은 사진 2장', cells: [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1]] },
    L13: { cols: 3, rows: 3, label: '왼큰+3', tip: '왼쪽 큰 사진 1장 + 오른쪽 작은 사진 3장', cells: [[0, 0, 2, 3], [2, 0, 1, 1], [2, 1, 1, 1], [2, 2, 1, 1]] },
    T13: { cols: 3, rows: 3, label: '위큰+3', tip: '위쪽 큰 사진 1장 + 아래 작은 사진 3장', cells: [[0, 0, 3, 2], [0, 2, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1]] },
    T23: { cols: 6, rows: 3, label: '위큰2+3', tip: '위쪽 큰 사진 2장 + 아래 작은 사진 3장', cells: [[0, 0, 3, 2], [3, 0, 3, 2], [0, 2, 2, 1], [2, 2, 2, 1], [4, 2, 2, 1]] }
  };
  for (const s of Object.values(LAYOUT_SPANS)) s.count = s.cells.length;
  // 배치 키 → 정의(기본 6가지 · 큰 사진 섞기 · "열x행" 1~5)
  function layoutSpec(presets, key) {
    if (typeof key !== 'string') return undefined;
    if (presets[key]) return presets[key];
    if (LAYOUT_SPANS[key]) return LAYOUT_SPANS[key];
    const m = /^([1-5])x([1-5])$/.exec(key);
    if (!m) return undefined;
    const cols = Number(m[1]);
    const rows = Number(m[2]);
    return { cols, rows, count: cols * rows, label: `${cols}×${rows}` };
  }
  // 자리 하나의 격자 위치 { c, r, cs, rs }
  function slotCell(spec, i) {
    if (spec.cells) { const [c, r, cs, rs] = spec.cells[i] || spec.cells[0]; return { c, r, cs, rs }; }
    return { c: i % spec.cols, r: Math.floor(i / spec.cols), cs: 1, rs: 1 };
  }

  return { deepClone, UndoHistory, serializeEditor, attachSheetDefs, transformAnnotations, photoRowOffsets, clampPhotoScale, PHOTO_SCALE_MIN, PHOTO_SCALE_MAX, LAYOUT_SPANS, layoutSpec, slotCell };
});
