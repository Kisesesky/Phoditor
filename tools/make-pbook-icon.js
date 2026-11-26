// [2026-11-26] 작업 파일(.pbook) 아이콘 그림을 만든다 → assets/pbook-icon.png (1024px)
//   node_modules/.bin/electron tools/make-pbook-icon.js
// 저장할 때 main.js가 이 그림을 파일 아이콘으로 붙인다(맥 Finder에서 사진첩 작업 파일로 보이게).
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B82F6"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#0F172A" flood-opacity=".28"/></filter>
  </defs>
  <g filter="url(#s)">
    <path d="M14 4h25l13 13v39a4 4 0 01-4 4H14a4 4 0 01-4-4V8a4 4 0 014-4z" fill="#fff"/>
    <path d="M39 4v9a4 4 0 004 4h9z" fill="#DBEAFE"/>
  </g>
  <rect x="15" y="23" width="32" height="24" rx="3" fill="url(#g)"/>
  <circle cx="23" cy="30.5" r="3" fill="#fff"/>
  <path d="M15 44l11-10 7 6 4-3 10 8v2a3 3 0 01-3 3H18a3 3 0 01-3-3z" fill="#BFDBFE"/>
  <text x="31" y="56" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="6.4" font-weight="800" fill="#1D4ED8" letter-spacing=".4">PBOOK</text>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const out = path.join(__dirname, '..', 'assets', 'pbook-icon.png');
  fs.writeFileSync(out, img.toPNG());
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'pbook-icon.svg'), SVG);
  console.log('작업 파일 아이콘 →', out, img.getSize());
  app.quit();
});
