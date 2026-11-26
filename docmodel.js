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

  return { deepClone, UndoHistory, serializeEditor, attachSheetDefs };
});
