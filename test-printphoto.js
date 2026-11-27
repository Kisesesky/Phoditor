// [2026-11-27] 인쇄용 사진(내보낼 때 자리 크기 × 300dpi로 줄이기) 자동 테스트
// 확인: 줄어듦 · 자리 안 위치/크기는 원본 모드와 같음 · 작은 사진은 그대로 · HEIC/EXIF 회전 · 같은 사진 중복 제거 · 원본 파일 불변
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');
const JSZip = require('jszip');
const { execFileSync } = require('child_process');
const { exportWorkbook, getImageInfoFromBuffer, printPxForSlot, PRINT_DPI } = require('./export');

if (process.platform !== 'darwin') {
  console.log('인쇄용 사진 테스트: 맥 전용(sips) — 이 컴퓨터에서는 건너뜀');
  process.exit(0);
}

const DEFS_DIR = path.join(__dirname, 'data', 'templateDefs');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    const n = ((x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)) & 63; // 잡음(실제 사진처럼 잘 안 줄게)
    raw[o] = ((x * 255) / w + n) & 255; raw[o + 1] = ((y * 255) / h + n) & 255; raw[o + 2] = (seed * 50 + ((x >> 4) ^ (y >> 4)) * 20 + n) & 255;
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// JPEG 맨 앞(SOI 뒤)에 EXIF 방향 태그(Orientation=6, 90° 돌려 보기) 넣기
function withOrientation6(jpeg) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, body, jpeg.subarray(2)]);
}

(async () => {
  console.log('=== 인쇄용 사진(자리 × 300dpi) 자동 테스트 ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-printphoto-'));
  const mk = (name, w, h, seed, fmt) => {
    const src = path.join(tmp, `.${name}.png`);
    fs.writeFileSync(src, png(w, h, seed));
    const out = path.join(tmp, name);
    if (fmt === 'png') fs.copyFileSync(src, out);
    else execFileSync('sips', ['-s', 'format', fmt, '-s', 'formatOptions', '92', src, '--out', out], { stdio: 'pipe' });
    return out;
  };
  const big = mk('big.jpg', 4000, 3000, 1, 'jpeg');
  const small = mk('small.jpg', 300, 200, 2, 'jpeg');
  const heic = mk('phone.heic', 3000, 2000, 3, 'heic');
  const bigPng = mk('scan.png', 2400, 1600, 4, 'png');
  const rotSrc = mk('.rot_base.jpg', 3000, 2000, 5, 'jpeg');
  const rot = path.join(tmp, 'rot6.jpg');
  fs.writeFileSync(rot, withOrientation6(fs.readFileSync(rotSrc)));
  const files = [big, small, heic, bigPng, rot];
  const before = Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(f))]));

  const def = JSON.parse(fs.readFileSync(path.join(DEFS_DIR, '공용홀_한신더휴.templateDef.json'), 'utf-8'));
  const build = () => def.sheets.map((sDef) => sDef.role === 'block'
    ? { name: sDef.name, role: 'block', sheetDef: sDef, repeatedValues: {}, blocks: [
      { values: {}, extraCells: {}, photoAreas: { 0: { layout: '2x2', slots: [{ path: big }, { path: small }, { path: heic }, { path: bigPng }] } } },
      { values: {}, extraCells: {}, photoAreas: { 0: { layout: '1x2', slots: [{ path: rot }, { path: big }] } } }
    ] }
    : { name: sDef.name, role: sDef.role, sheetDef: sDef, cells: {} });

  const run = async (mode) => {
    const out = path.join(tmp, `out_${mode}.xlsx`);
    const stats = await exportWorkbook({ templateDef: def, editorState: { sheets: build() }, blankXlsxPath: null, outputPath: out, photoMode: mode });
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const media = Object.keys(zip.files).filter((f) => f.startsWith('xl/media/') && !f.endsWith('/'));
    const imgs = [];
    for (const m of media) imgs.push(getImageInfoFromBuffer(await zip.file(m).async('nodebuffer')));
    const drawings = [];
    for (const d of Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f))) drawings.push(await zip.file(d).async('string'));
    const anchors = drawings.join('').match(/<xdr:from>[\s\S]*?<xdr:ext [^>]*\/>/g) || [];
    return { stats, size: fs.statSync(out).size, imgs, anchors };
  };

  const orig = await run('original');
  const print = await run('print');

  // 1. 배치 수·중복 제거는 같다 (big은 두 블록에 두 번 → 고유 1장)
  assert.strictEqual(print.stats.totalPhotoPlacements, 6);
  assert.strictEqual(orig.stats.totalPhotoPlacements, 6);
  assert.strictEqual(print.stats.uniqueImagesEmbedded, orig.stats.uniqueImagesEmbedded, '고유 사진 수가 같아야 함');
  console.log(`  PASS: 배치 6개, 고유 ${print.stats.uniqueImagesEmbedded}장(같은 사진은 큰 자리 기준 1장)`);

  // 2. 자리 안 위치·크기(엑셀 앵커)가 원본 모드와 똑같다
  assert.strictEqual(print.anchors.length, orig.anchors.length);
  // 줄인 사진은 픽셀이 정수라 가로세로 비율이 아주 조금 달라질 수 있다 → 1px(9525 EMU) 안이면 같다고 본다
  const nums = (a) => (a.match(/\d+/g) || []).map(Number);
  let worst = 0;
  print.anchors.forEach((a, i) => {
    const p = nums(a); const q = nums(orig.anchors[i]);
    assert.strictEqual(p.length, q.length);
    p.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - q[k])); });
  });
  assert.ok(print.anchors.length >= 6 && worst <= 9525, `위치·크기 차이 ${worst} EMU (1px = 9525)`);
  console.log(`  PASS: 사진 위치·크기(앵커 ${print.anchors.length}개) 원본 모드와 같음(최대 차이 ${(worst / 9525).toFixed(2)}px)`);

  // 3. 큰 사진은 줄고, 작은 사진은 그대로
  const maxLong = Math.max(...print.imgs.map((i) => Math.max(i.width, i.height)));
  const origLong = Math.max(...orig.imgs.map((i) => Math.max(i.width, i.height)));
  assert.ok(origLong >= 4000 && maxLong < 2000, `큰 사진이 줄어야 함 (원본 ${origLong} → ${maxLong})`);
  assert.ok(print.imgs.some((i) => i.width === 300 && i.height === 200), '작은 사진(300×200)은 키우지 않고 그대로');
  assert.ok(print.stats.downscaledCount >= 3, `줄인 사진 수 ${print.stats.downscaledCount}`);
  assert.ok(print.size < orig.size / 3, `파일이 크게 줄어야 함 (${(orig.size / 1048576).toFixed(1)}MB → ${(print.size / 1048576).toFixed(1)}MB)`);
  console.log(`  PASS: 큰 사진 긴 변 ${origLong} → ${maxLong}px, 작은 사진 그대로, 파일 ${(orig.size / 1048576).toFixed(1)}MB → ${(print.size / 1048576).toFixed(1)}MB`);

  // 4. 줄인 크기는 자리 × 300dpi 이상(인쇄 화질 보장)
  const area = { x: 0, y: 0, width: 400, height: 300 };
  const need = printPxForSlot(area, '1x1', 0);
  assert.strictEqual(need, Math.ceil(((400 - 16) / 96) * PRINT_DPI));
  console.log(`  PASS: 필요 크기 = 자리 긴 변(여백 뺌) / 96 × ${PRINT_DPI}dpi (400px 자리 → ${need}px)`);

  // 5. HEIC 변환 · EXIF 회전 횟수는 원본 모드와 같다
  assert.strictEqual(print.stats.convertedCount, orig.stats.convertedCount);
  assert.strictEqual(print.stats.exifRotatedCount, orig.stats.exifRotatedCount);
  assert.ok(print.stats.exifRotatedCount >= 1, 'EXIF 방향 6 사진이 돌려져야 함');
  const rotated = print.imgs.find((i) => i.height > i.width && i.height > 1000);
  assert.ok(rotated, '3000×2000 방향6 사진은 세로(2000×3000 비율)로 들어가야 함');
  console.log(`  PASS: HEIC 변환 ${print.stats.convertedCount}회 · EXIF 회전 ${print.stats.exifRotatedCount}회(세로로 들어감)`);

  // 6. 원본 파일 불변
  for (const f of files) assert.strictEqual(sha256(fs.readFileSync(f)), before[f], `원본이 바뀜: ${path.basename(f)}`);
  console.log('  PASS: 원본 사진 5개 SHA-256 불변');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('인쇄용 사진 테스트 6/6 통과');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
