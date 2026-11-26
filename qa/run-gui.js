// [GUI 회귀 테스트 2026-11-26] 실제 앱 창을 띄워 시나리오를 차례로 돌린다(맥 전용: 사진 변환에 sips 사용).
//   npm run test:gui            → 모든 시나리오
//   npm run test:gui -- 03      → 이름에 03이 들어간 시나리오만
// 결과·화면 사진: qa/out/<시나리오>/ (git에 올리지 않음)
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawn } = require('child_process');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const W = process.env.QA_W || '1440';
const H = process.env.QA_H || '900';
const filter = process.argv[2] || '';

if (process.platform !== 'darwin') {
  console.log('GUI 테스트는 맥에서만 돌려요(사진 변환·글꼴에 맥 기능을 씀). 건너뜀.');
  process.exit(0);
}

// --- 시험용 사진 만들기(가로·세로·작은 사진·HEIC·PNG) ---
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255) / w;
      raw[o + 1] = (y * 255) / h;
      raw[o + 2] = (seed * 40 + ((x >> 5) ^ (y >> 5)) * 30) & 255;
    }
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function makePhotos(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const src = (n, w, h, s) => { const p = path.join(dir, `.${n}.png`); fs.writeFileSync(p, png(w, h, s)); return p; };
  const sips = (args) => execFileSync('sips', args, { stdio: 'pipe' });
  sips(['-s', 'format', 'jpeg', src('l', 3000, 2000, 1), '--out', path.join(dir, 'landscape_3000.jpg')]);
  sips(['-s', 'format', 'jpeg', src('p', 900, 1200, 2), '--out', path.join(dir, 'portrait_1200.jpg')]);
  sips(['-s', 'format', 'heic', src('h', 1500, 1000, 3), '--out', path.join(dir, 'sample.heic')]);
  sips(['-s', 'format', 'jpeg', src('s', 300, 200, 4), '--out', path.join(dir, 'small_300.jpg')]);
  fs.copyFileSync(src('s2', 300, 200, 5), path.join(dir, 'small_300.png'));
  for (const f of fs.readdirSync(dir)) if (f.startsWith('.')) fs.unlinkSync(path.join(dir, f));
}

function runOne(name) {
  return new Promise((resolve) => {
    const out = path.join(OUT, path.basename(name, '.js'));
    fs.mkdirSync(out, { recursive: true });
    const script = path.join(out, '_scenario.js');
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'common.js'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, 'scenarios', name), 'utf-8'));
    const reportFile = path.join(out, 'report.json');
    if (fs.existsSync(reportFile)) fs.unlinkSync(reportFile);
    const electron = path.join(APP, 'node_modules', '.bin', 'electron');
    const child = spawn(electron, [path.join(__dirname, 'harness.js'), APP, script, out, photos, W, H], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    child.on('exit', () => {
      fs.writeFileSync(path.join(out, 'electron.log'), log);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(reportFile, 'utf-8')); } catch (_) {}
      resolve(r);
    });
  });
}

const photos = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phoditor-qa-')), 'photos');
(async () => {
  makePhotos(photos);
  const list = fs.readdirSync(path.join(__dirname, 'scenarios')).filter((f) => f.endsWith('.js') && f.includes(filter)).sort();
  let failed = 0;
  let total = 0;
  for (const name of list) {
    const t0 = Date.now();
    const r = await runOne(name);
    const checks = (r && r.result && r.result.checks) || [];
    const bad = checks.filter((c) => !c.ok);
    const errs = (r && r.consoleErrors) || [];
    const okRun = r && !r.fatal && checks.length && !bad.length && !errs.length;
    total += checks.length;
    failed += bad.length + (okRun ? 0 : 1) * (bad.length ? 0 : 1);
    console.log(`${okRun ? 'PASS' : 'FAIL'} ${name}: ${checks.length - bad.length}/${checks.length} · 콘솔 오류 ${errs.length} · ${((Date.now() - t0) / 1000).toFixed(0)}초${r && r.fatal ? ` · ${r.fatal}` : ''}`);
    for (const c of bad) console.log(`   NG ${c.name} ${c.detail}`);
    for (const e of errs.slice(0, 3)) console.log(`   ERR ${e.message}`);
  }
  console.log(`\nGUI 테스트: 시나리오 ${list.length}개, 확인 ${total}개, 실패 ${failed}`);
  process.exit(failed ? 1 : 0);
})();
