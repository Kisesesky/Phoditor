const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');
const JSZip = require('jszip');
const { execFileSync } = require('child_process');
const { getImageInfoFromBuffer, exportWorkbook, cropPhotoToJpeg, makeCropPreview } = require('./export');

const DEFS_DIR = path.join(__dirname, 'data', 'templateDefs');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function createSolidPng(width, height, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const base = y * rowSize;
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 2 + x * 3] = g;
      raw[base + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// 왼쪽 절반 빨강, 오른쪽 절반 파랑인 PNG (크롭 위치 확인용)
function createSplitPng(width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const base = y * rowSize;
    for (let x = 0; x < width; x++) {
      const red = x < width / 2;
      raw[base + 1 + x * 3] = red ? 220 : 0;
      raw[base + 2 + x * 3] = 0;
      raw[base + 3 + x * 3] = red ? 0 : 220;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// JPEG을 sips로 BMP로 바꿔 (x, y) 픽셀 RGB를 읽는다 (BMP는 아래에서 위로 저장됨)
function pixelOfJpeg(jpegBuf, x, y, tmpDir) {
  const j = path.join(tmpDir, `px_${crypto.randomBytes(4).toString('hex')}.jpg`);
  const b = j.replace(/\.jpg$/, '.bmp');
  fs.writeFileSync(j, jpegBuf);
  execFileSync('sips', ['-s', 'format', 'bmp', j, '--out', b], { stdio: 'pipe' });
  const bmp = fs.readFileSync(b);
  const off = bmp.readUInt32LE(10);
  const w = bmp.readInt32LE(18);
  const h = bmp.readInt32LE(22);
  const bpp = bmp.readUInt16LE(28) / 8;
  const stride = Math.ceil((w * bpp) / 4) * 4;
  const row = h > 0 ? h - 1 - y : y;
  const i = off + row * stride + x * bpp;
  return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
}

async function runCropTests() {
  console.log('=== 2단계 A: 넣기 전 크롭 내보내기·중복 제거·원본 불변 자동 테스트 ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-crop-test-'));

  // Original photo on disk: 1200x800
  const origFile = path.join(tmpDir, 'original_1200x800.png');
  const origBuf = createSolidPng(1200, 800, 30, 90, 200);
  fs.writeFileSync(origFile, origBuf);
  const origHashBefore = sha256(origBuf);

  // [검증 후속 수정 2026-11-24] 미리 만든 그림 대신, 앱과 같은 경로(메인 프로세스 sips 크롭)로 실제로 자른다.
  const splitFile = path.join(tmpDir, 'split_1200x800.png');
  fs.writeFileSync(splitFile, createSplitPng(1200, 800));
  const splitHashBefore = sha256(fs.readFileSync(splitFile));
  // x 400~850 → 왼쪽 200px는 빨강, 오른쪽 250px는 파랑이어야 한다
  const cropped = cropPhotoToJpeg(splitFile, { x: 400, y: 100, w: 450, h: 250 });
  assert.strictEqual(cropped.buffer[0], 0xff, 'Cropped output must be JPEG (SOI)');
  assert.strictEqual(cropped.buffer[1], 0xd8, 'Cropped output must be JPEG (SOI)');
  assert(cropped.quality >= 95, 'Crop JPEG quality must be >= 95');
  assert.strictEqual(cropped.width, 450);
  assert.strictEqual(cropped.height, 250);
  const left = pixelOfJpeg(cropped.buffer, 20, 125, tmpDir);
  const right = pixelOfJpeg(cropped.buffer, 430, 125, tmpDir);
  assert(left.r > 150 && left.b < 80, `Crop left side must be red (offset x), got ${JSON.stringify(left)}`);
  assert(right.b > 150 && right.r < 80, `Crop right side must be blue (offset x), got ${JSON.stringify(right)}`);
  assert.strictEqual(sha256(fs.readFileSync(splitFile)), splitHashBefore, 'Original must be unchanged by crop');

  // 미리보기는 긴 변 1600px 이하로만 렌더러에 보낸다(원본 크기는 따로 알려 준다)
  const bigFile = path.join(tmpDir, 'big_3000x2000.png');
  fs.writeFileSync(bigFile, createSolidPng(3000, 2000, 120, 120, 120));
  const prev = makeCropPreview(bigFile);
  assert.strictEqual(prev.width, 3000, 'Preview must report original width');
  assert.strictEqual(prev.previewWidth, 1600, 'Preview image must be downscaled to 1600px');
  const smallPrev = makeCropPreview(origFile);
  assert.strictEqual(smallPrev.previewWidth, 1200, 'Small photos must not be upscaled in preview');

  const cropBuf = cropped.buffer;
  const cropBase64 = cropBuf.toString('base64');
  const cropHash = sha256(cropBuf);

  const def = JSON.parse(fs.readFileSync(path.join(DEFS_DIR, '공용홀_한신더휴.templateDef.json'), 'utf-8'));
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'cover') {
      sheets.push({ name: sDef.name, role: 'cover', sheetDef: sDef, cells: { A9: '크롭 테스트 현장' } });
    } else if (sDef.role === 'block') {
      sheets.push({
        name: sDef.name,
        role: 'block',
        sheetDef: sDef,
        repeatedValues: {},
        blocks: [
          {
            values: { 'C{+1}': '공용홀 1F', 'C{+2}': '크롭 테스트' },
            extraCells: {},
            photoAreas: {
              // Place the SAME cropped version twice to verify SHA-256 deduplication!
              0: {
                layout: '1x2',
                slots: [
                  { path: origFile, isCropped: true, croppedDataBase64: cropBase64 },
                  { path: origFile, isCropped: true, croppedDataBase64: cropBase64 }
                ]
              }
            }
          }
        ]
      });
    }
  }

  const outPath = path.join(tmpDir, 'out_crop_test.xlsx');
  const res = await exportWorkbook({
    templateDef: def,
    editorState: { sheets },
    blankXlsxPath: null,
    outputPath: outPath
  });

  // 1. Deduplication check: 2 placements -> 1 unique embedded image
  assert.strictEqual(res.totalPhotoPlacements, 2, 'Expected 2 photo placements');
  assert.strictEqual(res.uniqueImagesEmbedded, 1, 'Same cropped photo placed twice must deduplicate to 1');

  // 2. Unzip & verify embedded image is cropped (450x250), NOT original (1200x800)
  const zip = await JSZip.loadAsync(fs.readFileSync(outPath));
  const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('xl/media/') && !f.endsWith('/'));
  assert.strictEqual(mediaFiles.length, 1, `Expected 1 image in xl/media, got ${mediaFiles.length}`);
  const embeddedBuf = await zip.file(mediaFiles[0]).async('nodebuffer');
  const embeddedInfo = getImageInfoFromBuffer(embeddedBuf);
  assert.strictEqual(embeddedInfo.width, 450, 'Embedded width must match cropped width 450');
  assert.strictEqual(embeddedInfo.height, 250, 'Embedded height must match cropped height 250');
  assert.strictEqual(sha256(embeddedBuf), cropHash, 'Embedded bytes must match cropped buffer');

  // 3. Original file immutability check
  const origHashAfter = sha256(fs.readFileSync(origFile));
  assert.strictEqual(origHashAfter, origHashBefore, 'Original photo file on disk must never be modified');

  console.log('  PASS: sips 크롭(450×250, 위치 확인, JPEG 품질 96), 미리보기 1600px 축소(작은 사진은 그대로), 동일 크롭본 중복 제거(2배치→1저장), 원본 SHA-256 불변');
  console.log('\n크롭 자동 테스트 통과!');
}

runCropTests().catch((err) => {
  console.error('크롭 자동 테스트 실패:', err);
  process.exit(1);
});
