// GUI QA 하니스: electron harness.js <appDir> <scenario.js> <outDir> <photosDir> [width height]
// 앱 main.js를 그대로 띄우고, 파일 대화상자만 가로채(폴더 = photosDir, 저장 = outDir) 시나리오를 렌더러에서 돌린다.
const path = require('path');
const fs = require('fs');
const [appDir, scenarioPath, outDir, photosDir, W, H] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { app, dialog, BrowserWindow } = require('electron');
app.setPath('userData', path.join(outDir, 'userData'));
process.chdir(appDir);

const saveCalls = [];
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [photosDir] });
dialog.showSaveDialog = async (_win, opts) => {
  const o = opts && opts.defaultPath ? opts : _win || {};
  saveCalls.push(o.defaultPath);
  return { canceled: false, filePath: path.join(outDir, path.basename(o.defaultPath || 'out.xlsx')) };
};
const msgBoxes = [];
dialog.showMessageBox = async (_w, o) => { msgBoxes.push((o && o.message) || (_w && _w.message) || ''); return { response: Number(process.env.QA_MSGBOX || 0) }; };

const consoleErrors = [];
let shotN = 0;
app.on('browser-window-created', (_e, win) => {
  if (W && H) win.setContentSize(Number(W), Number(H));
  const wc = win.webContents;
  wc.on('console-message', async (_ev, level, message, line, sourceId) => {
    if (typeof message === 'string' && message.startsWith('__QA_SHOT__:')) {
      const name = message.slice('__QA_SHOT__:'.length);
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
      shotN++;
      return;
    }
    if (level >= 2) consoleErrors.push({ level, message, line, source: path.basename(sourceId || '') });
  });
  wc.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 800));
    const code = fs.readFileSync(scenarioPath, 'utf-8');
    let result = null;
    let fatal = null;
    try {
      result = await wc.executeJavaScript(`(async () => { ${code} })()`, true);
    } catch (err) {
      fatal = String(err && err.stack || err);
    }
    if (process.env.QA_CLOSE) { win.close(); }
    await new Promise((r) => setTimeout(r, Number(process.env.QA_AFTER_MS || 600)));
    const windowAlive = !win.isDestroyed();
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ result, fatal, consoleErrors, saveCalls, msgBoxes, windowAlive, shots: shotN }, null, 1));
    app.exit(0);
  });
});
setTimeout(() => {
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ result: null, fatal: 'timeout', consoleErrors, saveCalls }, null, 1));
  app.exit(1);
}, 600000);

require(path.join(appDir, 'main.js'));
