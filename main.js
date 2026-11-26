const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const {
  colWidthToPx,
  rowHeightToPx,
  buildSyntheticWorkbook,
  loadPhotoForEmbed,
  makeCropPreview,
  cropPhotoToJpeg,
  exportWorkbook
} = require('./export');
const { MyboxClient, MYBOX_AUTH_ERROR_MSG } = require('./mybox');
const { writeProjectZip, readProjectFile } = require('./project');
const { getPreviewFonts, isPreviewFont, installBundled, resetCache: resetFontCache } = require('./fontcatalog');
const { extractSheetModel, extractDrawings, extractPageNumbering, defaultFontOf, usePaletteOf } = require('./sheetmodel');

const TEMPLATE_DEFS_DIR = path.join(__dirname, 'data', 'templateDefs');
const BLANKS_DIR = path.join(__dirname, 'data', 'blanks');
const THUMB_CACHE_DIR = path.join(os.tmpdir(), 'template-photo-excel-editor-thumbs');

const CATALOG_TYPES = ['공용홀', '준공사진첩', '분양승인첩', '기타'];
const CATALOG_COMPANIES = [
  '롯데', '수자인', '한신더휴', '대우', '힐스테이트',
  '아크로', '하늘채', '블루밍', '포스코', '기타'
];

const SUPPORTED_PHOTO_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff'
]);
const CONVERT_EXTS = new Set(['.heic', '.heif', '.webp', '.tif', '.tiff']);

let mainWindow = null;
const templateDefCache = new Map();

function loadAllTemplateDefs() {
  templateDefCache.clear();
  if (!fs.existsSync(TEMPLATE_DEFS_DIR)) return [];
  const files = fs.readdirSync(TEMPLATE_DEFS_DIR).filter((f) => f.endsWith('.templateDef.json')).sort();
  const defs = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(TEMPLATE_DEFS_DIR, file), 'utf-8');
      const def = JSON.parse(raw);
      templateDefCache.set(def.id, def);
      defs.push(def);
    } catch (err) {
      console.error('Failed to parse templateDef:', file, err);
    }
  }
  return defs;
}

function argbToCss(colorObj) {
  if (!colorObj) return null;
  if (colorObj.argb && typeof colorObj.argb === 'string') {
    const hex = colorObj.argb.length === 8 ? colorObj.argb.slice(2) : colorObj.argb;
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) return `#${hex}`;
  }
  return null;
}

function getInstalledMacFonts() {
  const fontSet = new Set([
    'arial', 'helvetica', 'helvetica neue', 'apple sd gothic neo',
    'applegothic', 'malgun gothic', '맑은 고딕', 'calibri', 'times new roman',
    'sans-serif', 'system-ui'
  ]);
  const dirs = [
    '/System/Library/Fonts',
    '/System/Library/Fonts/Supplemental',
    '/Library/Fonts',
    path.join(os.homedir(), 'Library', 'Fonts')
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const e of entries) {
        const base = path.basename(e, path.extname(e)).toLowerCase();
        fontSet.add(base);
        // Also strip style suffixes like -Regular, -Bold
        const family = base.split(/[-_]/)[0].trim();
        if (family) fontSet.add(family);
      }
    } catch (_) {}
  }
  return fontSet;
}

function findMissingFonts(usedFonts) {
  if (process.platform !== 'darwin') return [];
  const installed = getInstalledMacFonts();
  const missing = [];
  for (const fontName of usedFonts) {
    if (!fontName) continue;
    // [글꼴 2026-11-25] 앱에 넣은 글꼴·Mac Excel이 가진 글꼴은 미리보기에서 그대로 보이므로 없는 글꼴이 아니다
    if (isPreviewFont(fontName)) continue;
    const norm = fontName.toLowerCase().trim();
    const compact = norm.replace(/\s+/g, '');
    let found = false;
    for (const inst of installed) {
      if (inst.includes(norm) || inst.includes(compact) || norm.includes(inst)) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(fontName);
  }
  return missing;
}

function extractSheetVisualModel(ws) {
  const rowCount = Math.max(ws.rowCount || 1, 1);
  const colCount = Math.max(ws.columnCount || 1, 1);

  const colWidths = [];
  for (let c = 1; c <= colCount; c++) {
    colWidths.push(colWidthToPx(ws.getColumn(c).width, 8));
  }
  const rowHeights = [];
  for (let r = 1; r <= rowCount; r++) {
    rowHeights.push(Math.round(rowHeightToPx(ws.getRow(r).height)));
  }

  const merges = ws.model && ws.model.merges ? [...ws.model.merges] : [];
  const cells = {};
  const usedFonts = new Set();

  ws.eachRow({ includeEmpty: true }, (row, r) => {
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) {
        return;
      }
      const style = cell.style || {};
      const font = style.font || {};
      if (font.name) usedFonts.add(font.name);
      const fill = style.fill && style.fill.type === 'pattern' ? argbToCss(style.fill.fgColor) : null;
      const fontColor = argbToCss(font.color);
      const align = style.alignment || {};
      const border = style.border || {};

      let textVal = '';
      if (cell.value !== null && cell.value !== undefined) {
        if (typeof cell.value === 'object' && cell.value.richText) {
          textVal = cell.value.richText.map((rt) => rt.text).join('');
        } else if (typeof cell.value === 'object' && cell.value.result !== undefined) {
          textVal = String(cell.value.result);
        } else if (typeof cell.value === 'object' && cell.value.text !== undefined) {
          textVal = String(cell.value.text);
        } else if (typeof cell.value === 'object' && (cell.value.formula || cell.value.sharedFormula)) {
          // [PDF 비교 수정 2026-11-25] 계산값 없는 수식 칸("[object Object]"로 보이지 않게). 값은 화면에서 계산한다.
          textVal = '';
        } else {
          textVal = String(cell.value);
        }
      }

      cells[`${r},${c}`] = {
        addr: cell.address,
        r,
        c,
        value: textVal,
        formula: cell.type === ExcelJS.ValueType.Formula ? cell.formula : null,
        fill,
        fontName: font.name || null,
        fontSize: font.size || 10,
        fontBold: !!font.bold,
        fontColor,
        alignH: align.horizontal || 'left',
        alignV: align.vertical || 'middle',
        borderTop: !!(border.top && border.top.style),
        borderRight: !!(border.right && border.right.style),
        borderBottom: !!(border.bottom && border.bottom.style),
        borderLeft: !!(border.left && border.left.style)
      };
    });
  });

  return { rowCount, colCount, colWidths, rowHeights, merges, cells, usedFonts: [...usedFonts] };
}

function thumbPathFor(filePath, maxSide = 240) {
  const stat = fs.statSync(filePath);
  const key = crypto
    .createHash('md5')
    .update(`${filePath}:${stat.mtimeMs}:${stat.size}${maxSide === 240 ? '' : `:${maxSide}`}`)
    .digest('hex');
  return path.join(THUMB_CACHE_DIR, `${key}.jpg`);
}

function fallbackThumbUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? `file://${encodeURI(filePath)}` : null;
}

// [2026-11-26] 썸네일을 뒤에서 만든다(한꺼번에 4장). 사진 수백 장 폴더를 열 때 앱이 멈추지 않게
const thumbQueue = { running: 0, waiting: [], max: 4 };
function ensureThumbnailAsync(filePath, maxSide = 240) {
  return new Promise((resolve) => {
    const job = () => {
      thumbQueue.running++;
      let thumbPath;
      try {
        if (!fs.existsSync(THUMB_CACHE_DIR)) fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
        thumbPath = thumbPathFor(filePath, maxSide);
      } catch (_) {
        thumbQueue.running--;
        next();
        return resolve(null);
      }
      const finish = (url) => {
        thumbQueue.running--;
        next();
        resolve(url);
      };
      if (fs.existsSync(thumbPath)) return finish(`file://${encodeURI(thumbPath)}`);
      if (process.platform !== 'darwin') return finish(fallbackThumbUrl(filePath));
      require('child_process').execFile(
        'sips',
        ['-Z', String(maxSide), '-s', 'format', 'jpeg', '-s', 'formatOptions', maxSide > 240 ? '88' : '80', filePath, '--out', thumbPath],
        (err) => finish(!err && fs.existsSync(thumbPath) ? `file://${encodeURI(thumbPath)}` : fallbackThumbUrl(filePath))
      );
    };
    const next = () => {
      while (thumbQueue.running < thumbQueue.max && thumbQueue.waiting.length) thumbQueue.waiting.shift()();
    };
    thumbQueue.waiting.push(job);
    next();
  });
}

// 이미 만들어 둔 썸네일만 바로 돌려준다(없으면 null)
function cachedThumbnail(filePath, maxSide = 240) {
  try {
    const p = thumbPathFor(filePath, maxSide);
    return fs.existsSync(p) ? `file://${encodeURI(p)}` : null;
  } catch (_) {
    return null;
  }
}

function ensureThumbnail(filePath, maxSide = 240) {
  if (!fs.existsSync(THUMB_CACHE_DIR)) {
    fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true });
  }
  const thumbPath = thumbPathFor(filePath, maxSide);

  if (fs.existsSync(thumbPath)) {
    return `file://${encodeURI(thumbPath)}`;
  }

  if (process.platform === 'darwin') {
    try {
      execFileSync(
        'sips',
        ['-Z', String(maxSide), '-s', 'format', 'jpeg', '-s', 'formatOptions', maxSide > 240 ? '88' : '80', filePath, '--out', thumbPath],
        { stdio: 'pipe' }
      );
      if (fs.existsSync(thumbPath)) {
        return `file://${encodeURI(thumbPath)}`;
      }
    } catch (_) {}
  }

  // Fallback for non-macOS or sips failure
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
    return `file://${encodeURI(filePath)}`;
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: '사진첩 에디터',
    // [UI 개편 2026-11-25] 맥 앱처럼 제목 막대를 도구 막대와 합친다(신호등 단추는 왼쪽 위 그대로)
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#F6F6F7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  attachCloseGuard(mainWindow);
}

app.whenReady().then(() => {
  loadAllTemplateDefs();
  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// =========================================================================
// [작업 저장 2026-11-25] 작업 파일(.pbook) 저장·열기, 최근 작업, 자동 저장, 닫을 때 확인, 앱 메뉴
// =========================================================================
const PROJECT_EXT = 'pbook';
const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');
const autosaveFile = () => path.join(app.getPath('userData'), 'autosave', 'current.json');
let docDirty = false;
let forceClose = false;

function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf-8'));
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}
function pushRecent(entry) {
  const list = readRecent().filter((x) => x.path !== entry.path);
  list.unshift(entry);
  fs.mkdirSync(path.dirname(recentFile()), { recursive: true });
  fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 12), null, 1));
}
// [작업 파일] .pbook 읽기·쓰기는 project.js (자동 테스트 test-project.js와 같이 씀)
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

ipcMain.handle('project-save', async (_event, { filePath, data, suggestedName, saveAs } = {}) => {
  try {
    let target = !saveAs && filePath && fs.existsSync(path.dirname(filePath)) ? filePath : null;
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '작업 저장',
        defaultPath: path.join(app.getPath('documents'), `${(suggestedName || '사진첩 작업').replace(/[\\/:*?"<>|]/g, '_')}.${PROJECT_EXT}`),
        filters: [{ name: '사진첩 작업 파일', extensions: [PROJECT_EXT] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      target = res.filePath.endsWith(`.${PROJECT_EXT}`) ? res.filePath : `${res.filePath}.${PROJECT_EXT}`;
    }
    const stats = await writeProjectZip(target, data);
    pushRecent({ path: target, title: data.title || path.basename(target), templateId: data.templateId, savedAt: data.savedAt });
    return { ok: true, filePath: target, ...stats };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('project-open', async (_event, filePath) => {
  try {
    let target = filePath;
    if (!target) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: '작업 열기',
        properties: ['openFile'],
        filters: [{ name: '사진첩 작업 파일', extensions: [PROJECT_EXT] }]
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      target = res.filePaths[0];
    }
    const data = await readProjectFile(target, path.join(app.getPath('userData'), 'projects'));
    if (!data || data.format !== 'photobook') return { ok: false, error: '사진첩 작업 파일이 아니에요.' };
    pushRecent({ path: target, title: data.title || path.basename(target), templateId: data.templateId, savedAt: data.savedAt });
    return { ok: true, filePath: target, data };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('project-recent', () => readRecent().filter((x) => x && x.path && fs.existsSync(x.path)));

// --- [2026-11-26] 내 양식: 자주 쓰는 구성(양식 + 표지·반복값·블록 수·배치, 사진 없음)을 저장해 두고 다시 시작 ---
function myTemplatesDir() {
  return path.join(app.getPath('userData'), 'mytemplates');
}
function myTemplatePath(id) {
  if (!/^[a-z0-9-]{6,40}$/.test(String(id || ''))) throw new Error('잘못된 양식 이름');
  return path.join(myTemplatesDir(), `${id}.json`);
}
function stripPhotos(editor) {
  for (const s of (editor && editor.sheets) || []) {
    for (const b of s.blocks || []) {
      for (const pa of Object.values(b.photoAreas || {})) if (pa && Array.isArray(pa.slots)) pa.slots = pa.slots.map(() => null);
    }
  }
  return editor;
}
ipcMain.handle('mytemplates-list', () => {
  const dir = myTemplatesDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      const base = templateDefCache.get(d.templateId);
      const blocks = (d.editor.sheets || []).reduce((a, s) => a + ((s.blocks && s.blocks.length) || 0), 0);
      out.push({ id: d.id, name: d.name, templateId: d.templateId, baseLabel: base ? (base.generic ? base.title : `${base.type} · ${base.company}`) : '(없어진 양식)', missingBase: !base, createdAt: d.createdAt, sheetCount: (d.editor.sheets || []).length, blockCount: blocks });
    } catch (_) {}
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
});
ipcMain.handle('mytemplates-save', (_event, { name, data }) => {
  const title = String(name || '').trim().slice(0, 60);
  if (!title) return { ok: false, error: '이름을 넣어 주세요.' };
  if (!data || !data.editor || !templateDefCache.get(data.templateId)) return { ok: false, error: '양식 정보가 없어요.' };
  fs.mkdirSync(myTemplatesDir(), { recursive: true });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const doc = { format: 'phoditor-mytemplate', version: 1, id, name: title, createdAt: new Date().toISOString(), templateId: data.templateId, templateVersion: data.templateVersion, editor: stripPhotos(data.editor) };
  fs.writeFileSync(myTemplatePath(id), JSON.stringify(doc));
  return { ok: true, id };
});
ipcMain.handle('mytemplates-read', (_event, id) => {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(myTemplatePath(id), 'utf-8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('mytemplates-delete', (_event, id) => {
  try {
    fs.unlinkSync(myTemplatePath(id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('mytemplates-rename', (_event, { id, name }) => {
  try {
    const p = myTemplatePath(id);
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    d.name = String(name || '').trim().slice(0, 60) || d.name;
    fs.writeFileSync(p, JSON.stringify(d));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('autosave-write', (_event, data) => {
  try {
    writeJsonAtomic(autosaveFile(), data);
    return true;
  } catch (_) {
    return false;
  }
});
ipcMain.handle('autosave-read', () => {
  try {
    return JSON.parse(fs.readFileSync(autosaveFile(), 'utf-8'));
  } catch (_) {
    return null;
  }
});
ipcMain.handle('autosave-clear', () => {
  try {
    if (fs.existsSync(autosaveFile())) fs.unlinkSync(autosaveFile());
  } catch (_) {}
  return true;
});

ipcMain.handle('set-dirty', (_event, dirty) => {
  docDirty = !!dirty;
  if (mainWindow && process.platform === 'darwin') mainWindow.setDocumentEdited(docDirty);
  return true;
});
ipcMain.handle('close-now', () => {
  forceClose = true;
  docDirty = false;
  if (mainWindow) mainWindow.close();
  return true;
});

// 썸네일 다시 만들기(저장한 작업을 열 때: 임시 폴더의 썸네일이 지워졌을 수 있음)
ipcMain.handle('make-thumbs', async (_event, paths) => {
  const out = {};
  await Promise.all((paths || []).map(async (p) => {
    try {
      if (p && fs.existsSync(p)) out[p] = await ensureThumbnailAsync(p);
    } catch (_) {}
  }));
  return out;
});
ipcMain.handle('files-exist', (_event, paths) => (paths || []).map((p) => !!p && fs.existsSync(p)));

function attachCloseGuard(win) {
  win.on('close', async (e) => {
    if (forceClose || !docDirty) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      message: '저장하지 않은 작업이 있어요.',
      detail: '저장하지 않으면 마지막 저장 이후 바꾼 내용이 사라집니다. (자동 저장본은 다음에 열 때 복구할 수 있어요)'
    });
    if (response === 0) win.webContents.send('menu', 'save-then-close');
    else if (response === 1) {
      forceClose = true;
      win.close();
    }
  });
}

function buildAppMenu() {
  const send = (cmd) => () => mainWindow && mainWindow.webContents.send('menu', cmd);
  const template = [
    { role: 'appMenu' },
    {
      label: '파일',
      submenu: [
        { label: '새 사진첩…', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: '작업 열기…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: '다른 이름으로 저장…', accelerator: 'Shift+CmdOrCtrl+S', click: send('save-as') },
        { type: 'separator' },
        { label: '엑셀로 내보내기…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { label: 'PDF로 내보내기…', accelerator: 'Shift+CmdOrCtrl+E', click: send('export-pdf') }
      ]
    },
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: '다시 실행', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' }
      ]
    },
    {
      label: '보기',
      submenu: [
        { label: '확대', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: '축소', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: '쪽 너비에 맞추기', accelerator: 'CmdOrCtrl+0', click: send('zoom-fit') },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '개발자 도구' }
      ]
    },
    { role: 'windowMenu', label: '윈도우' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// [사진 패널 2026-11-25] 찍은 시간: EXIF 날짜 문자열(YYYY:MM:DD HH:MM:SS)을 앞부분에서 찾는다(JPEG·HEIC 공통). 없으면 파일 수정 시각
function photoTakenAt(fullPath, stat) {
  try {
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const s = buf.toString('latin1', 0, n);
    const m = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m && +m[1] > 1990) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  } catch (_) {}
  return stat ? stat.mtimeMs : 0;
}

// [사진 돌리기 2026-11-25] 원본에서 (자르기 →) 90° 단위 돌리기. 원본 파일은 건드리지 않는다
ipcMain.handle('transform-photo', async (_event, { filePath, rect, rotation } = {}) => {
  const tmpFiles = [];
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '원본 사진 파일을 찾을 수 없습니다.' };
    let buffer;
    if (rect) buffer = cropPhotoToJpeg(filePath, rect).buffer;
    else {
      const loaded = loadPhotoForEmbed(filePath);
      buffer = loaded.buffer;
    }
    const deg = ((Number(rotation) || 0) % 360 + 360) % 360;
    const src = path.join(os.tmpdir(), `tpe_tf_${crypto.randomBytes(6).toString('hex')}.img`);
    const out = src.replace(/\.img$/, '.jpg');
    tmpFiles.push(src, out);
    fs.writeFileSync(src, buffer);
    const args = deg ? ['-r', String(deg)] : [];
    execFileSync('sips', [...args, '-s', 'format', 'jpeg', '-s', 'formatOptions', '96', src, '--out', out], { stdio: 'pipe' });
    const result = fs.readFileSync(out);
    const dims = /pixelWidth: (\d+)[\s\S]*pixelHeight: (\d+)/.exec(execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out], { encoding: 'utf-8' }));
    let thumbDataUrl = `data:image/jpeg;base64,${result.toString('base64')}`;
    const w = dims ? +dims[1] : 0;
    const h = dims ? +dims[2] : 0;
    if (Math.max(w, h) > 1200) {
      const t = out.replace(/\.jpg$/, '_t.jpg');
      tmpFiles.push(t);
      execFileSync('sips', ['-Z', '1200', out, '--out', t], { stdio: 'pipe' });
      thumbDataUrl = `data:image/jpeg;base64,${fs.readFileSync(t).toString('base64')}`;
    }
    return { ok: true, base64: result.toString('base64'), width: w, height: h, sizeBytes: result.length, thumbDataUrl };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    for (const f of tmpFiles) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

// --- IPC Handlers ---

// [글꼴 2026-11-25] 미리보기 글꼴(앱 내장 + Mac Excel이 가진 글꼴) 목록
ipcMain.handle('get-preview-fonts', () => {
  try {
    return getPreviewFonts(path.join(app.getPath('userData'), 'font-cache'));
  } catch (err) {
    return { faces: [], aliases: {}, available: { bundled: [], excel: [] }, error: String(err && err.message || err) };
  }
});

// [글꼴 선택 2026-11-25] 앱에 넣은 글꼴을 이 Mac 사용자 글꼴 폴더에 설치(사용자가 단추를 눌렀을 때만)
ipcMain.handle('install-font', async (_event, family) => {
  try {
    const copied = installBundled(family);
    resetFontCache();
    return { ok: true, copied };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('get-catalog', () => {
  const defs = loadAllTemplateDefs();
  const map = {};
  // [2026-11-26] 시트별 미리보기 목록(tools/make-cover-thumbs.js가 만든 data/thumbs/index.json)
  let previews = {};
  try { previews = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'thumbs', 'index.json'), 'utf-8')) || {}; } catch (_) {}
  for (const d of defs) {
    const firstBlock = d.sheets.find((s) => s.role === 'block');
    map[`${d.type}__${d.company}`] = {
      id: d.id,
      generic: !!d.generic,
      title: d.title || null,
      description: d.description || null,
      sheetNames: d.sheets.filter((s) => s.role !== 'remove').map((s) => s.name),
      previews: Array.isArray(previews[d.id]) ? previews[d.id] : null,
      type: d.type,
      company: d.company,
      status: d.status,
      verified: d.verified,
      blockRows: firstBlock && firstBlock.block ? firstBlock.block.rows : null,
      addUnit: firstBlock && firstBlock.block ? firstBlock.block.addUnit : 'block',
      sheetCount: d.sheets.filter((s) => s.role !== 'remove').length,
      hasBlankXlsx: fs.existsSync(path.join(BLANKS_DIR, `${d.id}.xlsx`))
    };
  }
  // [2026-11-26] 회사에 묶이지 않은 양식(공백 양식)은 따로
  const generic = defs.filter((d) => d.generic).map((d) => map[`${d.type}__${d.company}`]).filter(Boolean);
  return {
    types: CATALOG_TYPES,
    companies: CATALOG_COMPANIES,
    available: map,
    generic
  };
});

ipcMain.handle('open-template', async (_event, templateId) => {
  const def = templateDefCache.get(templateId);
  if (!def) throw new Error(`템플릿 정의서를 찾을 수 없습니다: ${templateId}`);

  const blankPath = path.join(BLANKS_DIR, `${def.id}.xlsx`);
  const hasBlank = fs.existsSync(blankPath);

  const wb = new ExcelJS.Workbook();
  if (hasBlank) {
    await wb.xlsx.readFile(blankPath);
  } else {
    const syn = buildSyntheticWorkbook(def);
    const buf = await syn.xlsx.writeBuffer();
    await wb.xlsx.load(buf);
  }

  const sheetVisuals = {};
  const allFonts = new Set();
  // [쪽 보기 2026-11-25] 인쇄 쪽처럼 그리기 위해 인쇄 설정·테두리·그림/도형까지 담는다
  const blankBuf = hasBlank ? fs.readFileSync(blankPath) : null;
  let drawings = {};
  if (blankBuf) {
    try {
      drawings = await extractDrawings(blankBuf);
    } catch (_) {
      drawings = {};
    }
  }
  const defaultFont = blankBuf ? await defaultFontOf(blankBuf) : { name: 'Calibri', size: 11 };
  if (blankBuf) await usePaletteOf(blankBuf);
  let pageNumbering = {};
  if (blankBuf) {
    try {
      pageNumbering = await extractPageNumbering(blankBuf);
    } catch (_) {
      pageNumbering = {};
    }
  }

  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    const ws = wb.getWorksheet(sDef.name);
    if (!ws) continue;
    const vis = extractSheetModel(ws);
    vis.drawings = drawings[sDef.name] || [];
    vis.page.numbering = pageNumbering[sDef.name] || { useFirst: false, first: 1 };
    if (!vis.page.rowBreaks.length && pageNumbering[sDef.name]) vis.page.rowBreaks = pageNumbering[sDef.name].rowBreaks || [];
    vis.usedFonts.forEach((f) => allFonts.add(f));
    sheetVisuals[sDef.name] = vis;
  }

  const missingFonts = findMissingFonts([...allFonts]);

  return {
    templateDef: def,
    hasBlankXlsx: hasBlank,
    sheetVisuals,
    defaultFont,
    usedFonts: [...allFonts],
    missingFonts
  };
});

ipcMain.handle('select-photo-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '사진 폴더 선택',
    properties: ['openDirectory']
  });
  if (res.canceled || !res.filePaths.length) {
    return { canceled: true };
  }
  const folderPath = res.filePaths[0];
  return scanPhotoFolder(folderPath);
});

ipcMain.handle('refresh-photo-folder', async (_event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { canceled: true, error: '폴더를 찾을 수 없습니다.' };
  }
  return scanPhotoFolder(folderPath);
});

function scanPhotoFolder(folderPath) {
  const pendingThumbs = [];
  const result = scanPhotoFolderInner(folderPath, pendingThumbs);
  // 없는 썸네일은 뒤에서 만들고, 하나씩 화면에 알린다
  const sender = mainWindow && mainWindow.webContents;
  let done = 0;
  for (const p of pendingThumbs) {
    ensureThumbnailAsync(p).then((url) => {
      done++;
      if (sender && !sender.isDestroyed()) sender.send('thumb-ready', { path: p, thumbUrl: url, done, total: pendingThumbs.length });
    });
  }
  result.pendingThumbs = pendingThumbs.length;
  return result;
}

function scanPhotoFolderInner(folderPath, pendingThumbs) {
  const entries = fs.readdirSync(folderPath).sort((a, b) => a.localeCompare(b, 'ko'));
  const photos = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED_PHOTO_EXTS.has(ext)) continue;
    const fullPath = path.join(folderPath, name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
    } catch (_) {
      continue;
    }
    const needsConversion = CONVERT_EXTS.has(ext);
    const extUpper = ext.replace('.', '').toUpperCase();
    const thumbUrl = cachedThumbnail(fullPath);
    if (!thumbUrl) pendingThumbs.push(fullPath);
    photos.push({
      name,
      path: fullPath,
      sizeBytes: stat.size,
      ext: extUpper,
      needsConversion,
      conversionBadge: needsConversion ? `${extUpper}→JPG` : null,
      thumbUrl,
      takenAt: photoTakenAt(fullPath, stat)
    });
  }
  return { canceled: false, folderPath, photos };
}

ipcMain.handle('estimate-export-size', async (_event, { templateId, photoPaths, croppedItems }) => {
  const blankPath = path.join(BLANKS_DIR, `${templateId}.xlsx`);
  let totalBytes = fs.existsSync(blankPath) ? fs.statSync(blankPath).size : 60 * 1024;
  const uniquePaths = new Set(photoPaths || []);
  for (const p of uniquePaths) {
    try {
      if (p && fs.existsSync(p)) {
        totalBytes += fs.statSync(p).size;
      }
    } catch (_) {}
  }
  const uniqueCropped = new Map();
  for (const item of croppedItems || []) {
    if (item && item.key && typeof item.sizeBytes === 'number') {
      uniqueCropped.set(item.key, item.sizeBytes);
    }
  }
  for (const sz of uniqueCropped.values()) {
    totalBytes += sz;
  }
  const totalMB = totalBytes / (1024 * 1024);
  return {
    totalBytes,
    totalMB: Math.round(totalMB * 10) / 10,
    uniquePhotoCount: uniquePaths.size + uniqueCropped.size,
    exceeds500MB: totalMB > 500
  };
});

// [PDF 내보내기 2026-11-25] 엑셀 파일을 만든 뒤 Mac Excel로 PDF 인쇄한다(엑셀 인쇄와 똑같은 결과).
// Mac Excel은 샌드박스 앱이라 자기 컨테이너 폴더 밖의 파일은 "파일 액세스 부여" 창을 띄운다 → 컨테이너 안 임시 폴더를 쓴다.
const EXCEL_APP = '/Applications/Microsoft Excel.app';
const EXCEL_CONTAINER = path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Excel', 'Data');
function runOsa(lines, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [];
    for (const l of lines) args.push('-e', l);
    require('child_process').execFile('osascript', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message || err).trim()));
      else resolve(String(stdout).trim());
    });
  });
}
ipcMain.handle('export-pdf', async (_event, { templateId, editorState, suggestedName }) => {
  const def = templateDefCache.get(templateId);
  if (!def) return { ok: false, error: '템플릿 정의서를 찾을 수 없습니다.' };
  if (!fs.existsSync(EXCEL_APP)) return { ok: false, error: 'PDF는 Mac용 Microsoft Excel로 만들어요. 이 Mac에 Excel이 없어요.' };
  const saveRes = await dialog.showSaveDialog(mainWindow, {
    title: 'PDF로 내보내기',
    defaultPath: path.join(os.homedir(), 'Desktop', `${(suggestedName || `${def.type}_${def.company}`).replace(/[\\/:*?"<>|]/g, '_')}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['showOverwriteConfirmation']
  });
  if (saveRes.canceled || !saveRes.filePath) return { ok: false, canceled: true };
  const target = saveRes.filePath.toLowerCase().endsWith('.pdf') ? saveRes.filePath : `${saveRes.filePath}.pdf`;
  const work = path.join(EXCEL_CONTAINER, 'Phoditor-pdf', crypto.randomBytes(6).toString('hex'));
  const xlsx = path.join(work, 'photobook.xlsx');
  const pdf = path.join(work, 'photobook.pdf');
  try {
    try {
      fs.mkdirSync(work, { recursive: true });
    } catch (err) {
      return { ok: false, error: `Excel 작업 폴더를 쓸 수 없어요(시스템 설정 > 개인정보 보호 및 보안 > 앱 관리 권한 확인): ${err.message}` };
    }
    const blankPath = path.join(BLANKS_DIR, `${def.id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState, blankXlsxPath: fs.existsSync(blankPath) ? blankPath : null, outputPath: xlsx });
    const hfs = await runOsa([`POSIX file "${pdf}" as string`], 20000);
    await runOsa([
      'with timeout of 300 seconds',
      'tell application "Microsoft Excel"',
      'set display alerts to false',
      `open (POSIX file "${xlsx}")`,
      `save workbook as active workbook filename "${hfs}" file format PDF file format`,
      'close active workbook saving no',
      'end tell',
      'end timeout'
    ], 320000);
    if (!fs.existsSync(pdf)) return { ok: false, error: 'Excel이 PDF를 만들지 못했어요.' };
    fs.copyFileSync(pdf, target);
    const pages = (fs.readFileSync(target).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    return { ok: true, filePath: target, pages, sizeBytes: fs.statSync(target).size };
  } catch (err) {
    const msg = String(err.message || err);
    if (/-1743|not authorized|권한/.test(msg)) {
      return { ok: false, error: 'Excel을 제어할 권한이 없어요. 시스템 설정 > 개인정보 보호 및 보안 > 자동화에서 이 앱이 Microsoft Excel을 제어하도록 허용해 주세요.' };
    }
    return { ok: false, error: msg };
  } finally {
    for (const f of [xlsx, pdf]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
    try { fs.rmdirSync(work); } catch (_) {}
  }
});

ipcMain.handle('export-xlsx', async (_event, { templateId, editorState, suggestedName }) => {
  const def = templateDefCache.get(templateId);
  if (!def) return { ok: false, error: '템플릿 정의서를 찾을 수 없습니다.' };

  const now = new Date();
  const yyyymmdd =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  // [2026-11-26] 파일 이름에 현장명을 넣는다(예: 부천 상동 롯데캐슬_공용홀_롯데_20261126.xlsx)
  const base = String(suggestedName || `${def.type}_${def.company}`).replace(/[\\/:*?"<>|]/g, '_').trim();
  const defaultFileName = `${base}_${yyyymmdd}.xlsx`;

  const saveRes = await dialog.showSaveDialog(mainWindow, {
    title: '.xlsx 다른 이름으로 저장',
    defaultPath: path.join(os.homedir(), 'Desktop', defaultFileName),
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    properties: ['showOverwriteConfirmation']
  });

  if (saveRes.canceled || !saveRes.filePath) {
    return { ok: false, canceled: true };
  }

  let outputPath = saveRes.filePath;
  if (!outputPath.toLowerCase().endsWith('.xlsx')) {
    outputPath += '.xlsx';
  }

  const blankPath = path.join(BLANKS_DIR, `${def.id}.xlsx`);
  if (path.resolve(outputPath) === path.resolve(blankPath)) {
    return { ok: false, error: '원본 빈 양식 파일을 덮어쓸 수 없습니다. 다른 파일명을 선택해 주세요.' };
  }

  try {
    const stats = await exportWorkbook({
      templateDef: def,
      editorState,
      blankXlsxPath: fs.existsSync(blankPath) ? blankPath : null,
      outputPath
    });
    return { ok: true, filePath: outputPath, stats };
  } catch (err) {
    console.error('Export failed:', err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});


// =========================================================================
// Stage 2 A — Pre-placement Crop (HEIC converted + EXIF rotated preview)
// =========================================================================

// [사진 크기 수정 2026-11-25] 사진 자리 미리보기용 긴 변 1200px 그림 (썸네일 240px은 자리에 비해 너무 작다)
ipcMain.handle('get-slot-preview', async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return await ensureThumbnailAsync(filePath, 1200);
  } catch (_) {
    return null;
  }
});

ipcMain.handle('prepare-photo-for-crop', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('원본 사진 파일을 찾을 수 없습니다.');
  }
  // [검증 후속 수정 2026-11-24] 렌더러에는 긴 변 1600px 이하 미리보기만 보낸다(PLAN Q7 대용량 구조).
  // width/height는 원본(변환·EXIF 회전 반영) 크기라, 렌더러가 고른 영역을 원본 좌표로 바꿀 수 있다.
  return makeCropPreview(filePath);
});

ipcMain.handle('crop-photo', async (_event, { filePath, rect } = {}) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: '원본 사진 파일을 찾을 수 없습니다.' };
    }
    const cropped = cropPhotoToJpeg(filePath, rect || {});
    const base64 = cropped.buffer.toString('base64');
    // 패널 썸네일·사진 자리 미리보기용 그림 (크롭본 자체는 원본 해상도 그대로 유지). 자리에 크게 보이므로 1200px
    let thumbDataUrl = `data:image/jpeg;base64,${base64}`;
    if (Math.max(cropped.width, cropped.height) > 1200) {
      const tmpIn = path.join(os.tmpdir(), `tpe_ct_${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`);
      const tmpOut = tmpIn.replace(/\.jpg$/, '_t.jpg');
      try {
        fs.writeFileSync(tmpIn, cropped.buffer);
        execFileSync('sips', ['-Z', '1200', tmpIn, '--out', tmpOut], { stdio: 'pipe' });
        thumbDataUrl = `data:image/jpeg;base64,${fs.readFileSync(tmpOut).toString('base64')}`;
      } catch (_) {
        // 썸네일 실패 시 크롭본 그대로 표시
      } finally {
        for (const f of [tmpIn, tmpOut]) if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    }
    return { ok: true, base64, width: cropped.width, height: cropped.height, sizeBytes: cropped.buffer.length, thumbDataUrl };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// =========================================================================
// Stage 2 B — MYBOX Open API + safeStorage PAT + Persistent Local Cache
// =========================================================================

let myboxClient = null;
let inMemoryFallbackToken = '';

function getMyboxTokenPath() {
  return path.join(app.getPath('userData'), 'mybox-token.enc');
}

// [2026-11-26] 토큰 유효 기간: 발급일·일수만 따로 적는다(토큰 값은 넣지 않음)
function getMyboxMetaPath() {
  return path.join(app.getPath('userData'), 'mybox-token-meta.json');
}
function readMyboxMeta() {
  try {
    const m = JSON.parse(fs.readFileSync(getMyboxMetaPath(), 'utf-8'));
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(m.issuedAt) || !(m.days > 0)) return null;
    return { issuedAt: m.issuedAt, days: Number(m.days) };
  } catch (_) {
    return null;
  }
}
function myboxExpiryInfo(meta) {
  if (!meta) return null;
  const [y, mo, d] = meta.issuedAt.split('-').map(Number);
  const exp = new Date(y, mo - 1, d + meta.days);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((exp - today) / 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return { ...meta, expiresAt: `${exp.getFullYear()}-${pad(exp.getMonth() + 1)}-${pad(exp.getDate())}`, daysLeft, expired: daysLeft <= 0 };
}
function writeMyboxMeta(meta) {
  if (!meta) {
    try { fs.unlinkSync(getMyboxMetaPath()); } catch (_) {}
    return;
  }
  fs.writeFileSync(getMyboxMetaPath(), JSON.stringify({ issuedAt: meta.issuedAt, days: meta.days }));
}

function getMyboxCacheDir() {
  return path.join(app.getPath('userData'), 'mybox-cache');
}

function loadStoredMyboxToken() {
  try {
    const tokenPath = getMyboxTokenPath();
    if (!fs.existsSync(tokenPath)) return inMemoryFallbackToken || '';
    if (!safeStorage.isEncryptionAvailable()) return inMemoryFallbackToken || '';
    const encBuf = fs.readFileSync(tokenPath);
    return safeStorage.decryptString(encBuf);
  } catch (_) {
    return '';
  }
}

function getMyboxClient() {
  if (!myboxClient) {
    myboxClient = new MyboxClient({
      token: loadStoredMyboxToken(),
      cacheDir: getMyboxCacheDir()
    });
  }
  return myboxClient;
}

ipcMain.handle('mybox-get-status', () => {
  const client = getMyboxClient();
  return {
    hasToken: client.hasToken(),
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    expiry: client.hasToken() ? myboxExpiryInfo(readMyboxMeta()) : null
  };
});

// 기간만 고치기(토큰은 그대로)
ipcMain.handle('mybox-save-period', (_event, period) => {
  const meta = period && /^\d{4}-\d{2}-\d{2}$/.test(period.issuedAt) && Number(period.days) > 0 ? { issuedAt: period.issuedAt, days: Number(period.days) } : null;
  writeMyboxMeta(meta);
  return { ok: true, expiry: myboxExpiryInfo(meta) };
});

ipcMain.handle('mybox-save-token', (_event, rawToken, period) => {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, error: '토큰을 입력해 주세요.' };
  }
  const meta = period && /^\d{4}-\d{2}-\d{2}$/.test(period.issuedAt) && Number(period.days) > 0 ? { issuedAt: period.issuedAt, days: Number(period.days) } : null;
  writeMyboxMeta(meta);
  const client = getMyboxClient();
  client.setToken(token);

  // NEVER store PAT in plaintext and NEVER log PAT
  if (safeStorage.isEncryptionAvailable()) {
    const encBuf = safeStorage.encryptString(token);
    const tokenPath = getMyboxTokenPath();
    fs.writeFileSync(tokenPath, encBuf, { mode: 0o600 });
    inMemoryFallbackToken = '';
    return { ok: true, persisted: true };
  } else {
    inMemoryFallbackToken = token;
    return {
      ok: true,
      persisted: false,
      warning: '이 환경에서 safeStorage 암호화를 사용할 수 없어 메모리에만 임시 보관합니다 (평문 저장 안 함).'
    };
  }
});

ipcMain.handle('mybox-clear-token', () => {
  inMemoryFallbackToken = '';
  writeMyboxMeta(null);
  const client = getMyboxClient();
  client.setToken('');
  const tokenPath = getMyboxTokenPath();
  if (fs.existsSync(tokenPath)) {
    try {
      fs.unlinkSync(tokenPath);
    } catch (_) {}
  }
  return { ok: true };
});

ipcMain.handle('mybox-test-connection', async (_event, candidateToken) => {
  const tokenToTest =
    candidateToken && String(candidateToken).trim()
      ? String(candidateToken).trim()
      : loadStoredMyboxToken();

  if (!tokenToTest) {
    return {
      ok: false,
      status: 401,
      message: MYBOX_AUTH_ERROR_MSG,
      serverMessage: '저장된 PAT 토큰이 없습니다.',
      isAuthError: true
    };
  }

  const tempClient = new MyboxClient({
    token: tokenToTest,
    cacheDir: getMyboxCacheDir()
  });

  try {
    const res = await tempClient.testConnection();
    return {
      ok: true,
      status: res.status,
      message: res.message,
      sampleCount: res.sampleCount
    };
  } catch (err) {
    return {
      ok: false,
      status: err && err.status ? err.status : 0,
      message: err && err.message ? err.message : MYBOX_AUTH_ERROR_MSG,
      serverMessage: err && err.serverMessage ? err.serverMessage : '',
      isAuthError: Boolean(err && err.isAuthError)
    };
  }
});

ipcMain.handle('mybox-list-folder', async (_event, folderId) => {
  const client = getMyboxClient();
  if (!client.hasToken()) {
    return {
      ok: false,
      status: 401,
      message: MYBOX_AUTH_ERROR_MSG,
      serverMessage: 'PAT 토큰이 설정되지 않았습니다.',
      isAuthError: true
    };
  }

  const expiry = myboxExpiryInfo(readMyboxMeta());
  try {
    const { folders, files } = await client.listAllResources(folderId || null);
    const enrichedFiles = files.map((f) => {
      const extLower = path.extname(f.name || '').toLowerCase();
      const needsConversion = CONVERT_EXTS.has(extLower);
      const extUpper = extLower.replace('.', '').toUpperCase();
      let thumbUrl = null;
      if (f.cached && f.localPath && fs.existsSync(f.localPath)) {
        thumbUrl = ensureThumbnail(f.localPath);
      }
      return {
        ...f,
        source: 'mybox',
        path: f.localPath || null,
        sizeBytes: f.size || 0,
        ext: extUpper,
        needsConversion,
        conversionBadge: needsConversion ? `${extUpper}→JPG` : null,
        thumbUrl
      };
    });
    return { ok: true, folders, files: enrichedFiles, expiry };
  } catch (err) {
    const expiredAuth = err && err.isAuthError && expiry && expiry.expired;
    return {
      ok: false,
      expired: Boolean(expiredAuth),
      status: err && err.status ? err.status : 0,
      message: expiredAuth ? `토큰 기간이 끝났어요(${expiry.expiresAt}). MYBOX에서 새 토큰을 받아 넣어 주세요.` : err && err.message ? err.message : MYBOX_AUTH_ERROR_MSG,
      serverMessage: err && err.serverMessage ? err.serverMessage : '',
      isAuthError: Boolean(err && err.isAuthError)
    };
  }
});

ipcMain.handle('mybox-download-photo', async (_event, { resourceId, name, modifiedKey }) => {
  const client = getMyboxClient();
  try {
    const dl = await client.downloadFileToCache({ resourceId, name, modifiedKey });
    const thumbUrl = ensureThumbnail(dl.localPath);
    const extLower = path.extname(name || '').toLowerCase();
    const needsConversion = CONVERT_EXTS.has(extLower);
    const extUpper = extLower.replace('.', '').toUpperCase();
    return {
      ok: true,
      localPath: dl.localPath,
      thumbUrl,
      fromCache: dl.fromCache,
      sizeBytes: dl.sizeBytes,
      ext: extUpper,
      needsConversion,
      conversionBadge: needsConversion ? `${extUpper}→JPG` : null
    };
  } catch (err) {
    return {
      ok: false,
      status: err && err.status ? err.status : 0,
      message: err && err.message ? err.message : MYBOX_AUTH_ERROR_MSG,
      serverMessage: err && err.serverMessage ? err.serverMessage : '',
      isAuthError: Boolean(err && err.isAuthError)
    };
  }
});
