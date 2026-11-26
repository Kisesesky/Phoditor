// [renderer/01-core.js] 코어: 주소 계산, 앱 상태(state), 화면 요소(el), 알림
// renderer.js(3,900줄)를 2026-11-26 나눈 조각. index.html이 번호 순서대로 읽고, 모든 조각이 같은 전역 범위를 쓴다(빌드 단계 없음).
'use strict';

const LAYOUT_PRESETS = {
  '1x1': { cols: 1, rows: 1, count: 1, label: '1×1' },
  '2x1': { cols: 2, rows: 1, count: 2, label: '2×1' },
  '1x2': { cols: 1, rows: 2, count: 2, label: '1×2' },
  '2x2': { cols: 2, rows: 2, count: 4, label: '2×2' },
  '3x1': { cols: 3, rows: 1, count: 3, label: '3×1' },
  '1x3': { cols: 1, rows: 3, count: 3, label: '1×3' }
};
// [2026-11-26] 사용자 지정 배치: "열x행" 아무 조합(1~5 × 1~5)을 같은 방식으로 꺼낸다. 목록(Object.entries)은 기본 6가지만.
const LAYOUT_SPECS = new Proxy(LAYOUT_PRESETS, {
  get(t, k) {
    if (typeof k !== 'string') return t[k];
    if (t[k]) return t[k];
    const m = /^([1-5])x([1-5])$/.exec(k);
    if (!m) return undefined;
    const cols = Number(m[1]);
    const rows = Number(m[2]);
    return { cols, rows, count: cols * rows, label: `${cols}×${rows}` };
  }
});

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
  photoFolderStack: [], // [2026-11-26] 들어간 하위 폴더 경로(맨 앞이 연 폴더)
  photoSubfolders: [],
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
  photoSortName: document.getElementById('photoSortName'),
  photoSortTime: document.getElementById('photoSortTime'),
  inspector: document.getElementById('inspector'),
  sidebar: document.getElementById('sidebar'),
  sideResizer: document.getElementById('sideResizer'),
  inspResizer: document.getElementById('inspResizer'),
  sideCollapseBtn: document.getElementById('sideCollapseBtn'),
  sideExpandBtn: document.getElementById('sideExpandBtn'),
  localUpBtn: document.getElementById('localUpBtn'),
  inspCollapseBtn: document.getElementById('inspCollapseBtn'),
  inspExpandBtn: document.getElementById('inspExpandBtn'),
  photoColsSeg: document.getElementById('photoColsSeg'),
  myboxExpiryChip: document.getElementById('myboxExpiryChip'),
  myboxDaysSeg: document.getElementById('myboxDaysSeg'),
  myboxIssuedInput: document.getElementById('myboxIssuedInput'),
  myboxExpiryPreview: document.getElementById('myboxExpiryPreview'),
  pageRail: document.getElementById('pageRail'),
  pdfBtn: document.getElementById('pdfBtn'),
  overflowChip: document.getElementById('overflowChip')
};

let toastTimer = null;
// 업체 카드 색(브랜드 색과 비슷한 차분한 색)
const COMPANY_COLORS = { 롯데: '#8A6A50', 수자인: '#3F6E5A', 한신더휴: '#2E5E8C', 대우: '#2F5597', 힐스테이트: '#5A6B7B', 아크로: '#222222', 하늘채: '#4A7FB5', 블루밍: '#3C6FB0', 포스코: '#1F4E79', 기타: '#7A7F8A' };
const shownRepeatHints = new Set(); // 반복값 안내를 칸마다 한 번만
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

// [2026-11-26] 단축키 목록(설정 화면·? 도움말에 같이 쓴다)
const SHORTCUTS = [
  ['⌘ Z', '실행 취소'],
  ['⇧ ⌘ Z', '다시 실행 (⌘Y도 됨)'],
  ['⌘ S', '저장'],
  ['⇧ ⌘ S', '다른 이름으로 저장'],
  ['⌘ O', '작업 열기'],
  ['⌘ E', '엑셀로 내보내기'],
  ['⇧ ⌘ E', 'PDF로 내보내기'],
  ['⌘ ↵', '선택한 블록 아래에 블록 추가'],
  ['⌘ D', '블록 복제(글자·사진 포함)'],
  ['⌘ ⌫', '선택한 블록 삭제'],
  ['⌥ ↑', '블록 위로 옮기기'],
  ['⌥ ↓', '블록 아래로 옮기기'],
  ['↑', '앞 블록 선택'],
  ['↓', '다음 블록 선택'],
  ['⌘ [', '앞 시트'],
  ['⌘ ]', '다음 시트'],
  ['⌫', '선택한 사진 빼기'],
  ['↵', '선택한 칸 입력 시작'],
  ['⌘ \\', '속성 패널 접기/펼치기'],
  ['⇧ ⌘ \\', '사진 패널 접기/펼치기'],
  ['⌘ 1~4', '사진 보기 1~4열'],
  ['⌘ +', '확대 (⌘- 축소, ⌘0 맞춤)'],
  ['?', '단축키 보기']
];
