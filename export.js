const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { restorePrintSettings, sheetPaths, relsPathOf, resolveTarget, drawingRelOf } = require('./printfix');
const { renameSheetsInZip } = require('./sheetrename');
const { evaluateSimpleFormulas } = require('./simpleformula');

// [PDF 비교 수정 2026-11-25] 목차 차례 번호 수식(=B4+1)은 남기고 계산값을 함께 저장한다.
// (A안 번호 매기기처럼 fullCalcOnLoad는 쓰지 않는다. 계산값이 있으면 Excel이 그대로 보여 준다.)
function fillSimpleFormulaResults(ws) {
  const formulaAddrs = [];
  const cellMap = {};
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.type === ExcelJS.ValueType.Formula) {
        formulaAddrs.push(cell.address);
        cellMap[cell.address] = { formula: cell.formula };
      }
    });
  });
  if (!formulaAddrs.length) return 0;
  const getCell = (addr) => {
    if (cellMap[addr]) return cellMap[addr];
    const v = ws.getCell(addr).value;
    return { value: v && typeof v === 'object' ? (v.result !== undefined ? v.result : v.richText ? v.richText.map((t) => t.text).join('') : v.text) : v };
  };
  const results = evaluateSimpleFormulas(getCell, formulaAddrs);
  // 공유 수식은 기준 칸을 바꾸면 나머지 번역이 깨지므로 먼저 모두 계산하고 나서 한꺼번에 바꾼다
  let n = 0;
  for (const addr of formulaAddrs) {
    if (results[addr] === undefined) {
      // 계산 못 한 칸도 공유 수식 대신 자기 수식으로 바꿔 둔다 (기준 칸이 바뀌어도 깨지지 않게)
      ws.getCell(addr).value = { formula: cellMap[addr].formula };
      continue;
    }
    ws.getCell(addr).value = { formula: cellMap[addr].formula, result: results[addr] };
    n++;
  }
  return n;
}

// --- Column / Cell Address Utilities ---

function colToNum(colStr) {
  let num = 0;
  const s = colStr.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    num = num * 26 + (s.charCodeAt(i) - 64);
  }
  return num;
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
  const start = parseRelCell(parts[0], blockStartRow);
  const end = parts[1] ? parseRelCell(parts[1], blockStartRow) : start;
  if (!start || !end) return null;
  return {
    c1: start.col,
    r1: start.row,
    c2: end.col,
    r2: end.row,
    ref: `${start.colStr}${start.row}:${end.colStr}${end.row}`
  };
}

// --- Excel Column Width / Row Height -> Pixel Conversion (S7) ---
// Standard Excel MDW calibration based on workbook default font (fixes ~10% underestimate of width*7+5)
function getWorkbookMdw(workbook) {
  // Default MDW for 11pt Calibri / Malgun Gothic / Pretendard in macOS/Windows Excel is 8px
  let mdw = 8;
  try {
    const firstSheet = workbook && workbook.worksheets && workbook.worksheets[0];
    if (firstSheet) {
      const cell = firstSheet.getCell('A1');
      const fontSize = cell && cell.font && cell.font.size ? cell.font.size : 11;
      if (fontSize <= 9) mdw = 7;
      else if (fontSize <= 11) mdw = 8;
      else mdw = Math.round(fontSize * 0.75);
    }
  } catch (_) {}
  return mdw;
}

function colWidthToPx(width, mdw = 8) {
  const w = typeof width === 'number' && width > 0 ? width : 8.43;
  // Excel OOXML specification formula: pixels = Truncate(((256 * width + Truncate(128/MDW)) / 256) * MDW)
  return Math.max(10, Math.floor(((256 * w + Math.floor(128 / mdw)) / 256) * mdw));
}

function rowHeightToPx(heightPt) {
  const pt = typeof heightPt === 'number' && heightPt > 0 ? heightPt : 18;
  return (pt * 96) / 72;
}

// --- Layout Grid Definitions (D3: col x row) ---
const LAYOUT_SPECS = {
  '1x1': { cols: 1, rows: 1, count: 1 },
  '1x2': { cols: 1, rows: 2, count: 2 },
  '2x1': { cols: 2, rows: 1, count: 2 },
  '1x3': { cols: 1, rows: 3, count: 3 },
  '3x1': { cols: 3, rows: 1, count: 3 },
  '2x2': { cols: 2, rows: 2, count: 4 }
};

function computeSlotPlacement(areaBoundsPx, layoutKey, slotIndex, imgW, imgH) {
  const spec = LAYOUT_SPECS[layoutKey] || LAYOUT_SPECS['1x1'];
  const colIdx = slotIndex % spec.cols;
  const rowIdx = Math.floor(slotIndex / spec.cols);

  const slotW = areaBoundsPx.width / spec.cols;
  const slotH = areaBoundsPx.height / spec.rows;
  const slotX = areaBoundsPx.x + colIdx * slotW;
  const slotY = areaBoundsPx.y + rowIdx * slotH;

  // Padding rule: min(8px, 5% of slot size)
  const pad = Math.min(8, slotW * 0.05, slotH * 0.05);
  const availW = Math.max(1, slotW - 2 * pad);
  const availH = Math.max(1, slotH - 2 * pad);

  // Contain: 자리 안에 비율을 지켜 꽉 채운다.
  // [사진 크기 수정 2026-11-25] 예전에는 작은 사진을 키우지 않아(scale ≤ 1) 크롭본·작은 사진이 자리에 비해 작게 찍혔다.
  // 사용자 요청으로 작은 사진도 자리에 맞춰 키운다(PLAN S17).
  const scale = Math.min(availW / imgW, availH / imgH);
  const drawW = Math.max(1, imgW * scale);
  const drawH = Math.max(1, imgH * scale);

  // Center inside slot
  const x = slotX + (slotW - drawW) / 2;
  const y = slotY + (slotH - drawH) / 2;

  return { x, y, width: drawW, height: drawH, pad, scale, slotW, slotH, slotX, slotY };
}

function pxToFractionalIndex(targetPx, sizesPx) {
  let acc = 0;
  for (let i = 0; i < sizesPx.length; i++) {
    const s = sizesPx[i] || 1;
    if (targetPx <= acc + s) {
      return i + Math.max(0, Math.min(0.9999, (targetPx - acc) / s));
    }
    acc += s;
  }
  const lastSize = sizesPx[sizesPx.length - 1] || 64;
  return sizesPx.length + (targetPx - acc) / lastSize;
}

// --- Pure JS Image Dimension & EXIF Orientation Parser ---

function parsePngDimensions(buf) {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), orientation: 1 };
}

function parseGifDimensions(buf) {
  if (buf.length < 10) return null;
  const hdr = buf.toString('ascii', 0, 6);
  if (hdr !== 'GIF87a' && hdr !== 'GIF89a') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), orientation: 1 };
}

function parseJpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  let width = null;
  let height = null;
  let orientation = 1;

  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2) break;

    // APP1 EXIF
    if (marker === 0xe1 && offset + 10 < buf.length) {
      const exifHdr = buf.toString('ascii', offset + 4, offset + 10);
      if (exifHdr === 'Exif\0\0') {
        const tiffStart = offset + 10;
        if (tiffStart + 8 < buf.length) {
          const endian = buf.toString('ascii', tiffStart, tiffStart + 2);
          const le = endian === 'II';
          const readU16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
          const readU32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
          const ifdOffset = readU32(tiffStart + 4);
          const ifdStart = tiffStart + ifdOffset;
          if (ifdStart + 2 < buf.length) {
            const entries = readU16(ifdStart);
            for (let i = 0; i < entries; i++) {
              const entryOff = ifdStart + 2 + i * 12;
              if (entryOff + 12 > buf.length) break;
              const tag = readU16(entryOff);
              if (tag === 0x0112) {
                orientation = readU16(entryOff + 8);
                break;
              }
            }
          }
        }
      }
    }

    // SOF markers (SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 < buf.length) {
        height = buf.readUInt16BE(offset + 5);
        width = buf.readUInt16BE(offset + 7);
      }
    }

    offset += 2 + segLen;
  }

  if (!width || !height) return null;
  return { width, height, orientation };
}

function getImageInfoFromBuffer(buf, ext) {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'png') return parsePngDimensions(buf);
  if (e === 'gif') return parseGifDimensions(buf);
  if (e === 'jpg' || e === 'jpeg') return parseJpegInfo(buf);
  return parsePngDimensions(buf) || parseJpegInfo(buf) || parseGifDimensions(buf);
}

// --- Image Loading, HEIC/WEBP/TIFF Conversion (sips 1st priority) & EXIF Rotation ---

function convertWithSips(inputPath, outPath, rotateDeg = 0) {
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95'];
  if (rotateDeg) {
    args.push('-r', String(rotateDeg));
  }
  args.push(inputPath, '--out', outPath);
  execFileSync('sips', args, { stdio: 'pipe' });
}

function orientationToDegrees(orientation) {
  switch (orientation) {
    case 3: return 180;
    case 6: return 90;
    case 8: return 270;
    default: return 0;
  }
}

function loadPhotoForEmbed(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const needsConvert = ['heic', 'heif', 'webp', 'tif', 'tiff'].includes(ext);

  if (needsConvert) {
    const tmpOut = path.join(os.tmpdir(), `tpe_conv_${crypto.randomBytes(6).toString('hex')}.jpg`);
    try {
      convertWithSips(filePath, tmpOut, 0);
      const buf = fs.readFileSync(tmpOut);
      const info = parseJpegInfo(buf) || { width: 800, height: 600, orientation: 1 };
      return {
        buffer: buf,
        extension: 'jpeg',
        width: info.width,
        height: info.height,
        converted: true,
        exifRotated: false,
        sha256: crypto.createHash('sha256').update(buf).digest('hex')
      };
    } finally {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  }

  // Read original bytes (NEVER modify original file)
  const origBuf = fs.readFileSync(filePath);
  const info = getImageInfoFromBuffer(origBuf, ext) || { width: 800, height: 600, orientation: 1 };

  // EXIF rotation handling (S8): Excel ignores EXIF orientation, so re-encode ONLY when orientation != 1
  if ((ext === 'jpg' || ext === 'jpeg') && info.orientation && info.orientation !== 1) {
    const deg = orientationToDegrees(info.orientation);
    if (deg && process.platform === 'darwin') {
      const tmpOut = path.join(os.tmpdir(), `tpe_rot_${crypto.randomBytes(6).toString('hex')}.jpg`);
      try {
        convertWithSips(filePath, tmpOut, deg);
        const rotBuf = fs.readFileSync(tmpOut);
        const rotInfo = parseJpegInfo(rotBuf) || {
          width: deg === 90 || deg === 270 ? info.height : info.width,
          height: deg === 90 || deg === 270 ? info.width : info.height
        };
        return {
          buffer: rotBuf,
          extension: 'jpeg',
          width: rotInfo.width,
          height: rotInfo.height,
          converted: false,
          exifRotated: true,
          sha256: crypto.createHash('sha256').update(rotBuf).digest('hex')
        };
      } catch (_) {
        // Fallback to original bytes if sips fails
      } finally {
        if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
      }
    }
  }

  const excelExt = ext === 'jpg' ? 'jpeg' : (ext === 'png' || ext === 'gif' ? ext : 'jpeg');
  return {
    buffer: origBuf,
    extension: excelExt,
    width: info.width,
    height: info.height,
    converted: false,
    exifRotated: false,
    sha256: crypto.createHash('sha256').update(origBuf).digest('hex')
  };
}


// Stage 2 A: In-memory cropped JPEG (quality >= 95) embedding helper (never touches original file)
function loadCroppedPhotoForEmbed(croppedDataBase64, fallbackExt = 'jpeg') {
  const cleanB64 = String(croppedDataBase64 || '').replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  const buf = Buffer.from(cleanB64, 'base64');
  const info = getImageInfoFromBuffer(buf, fallbackExt) || { width: 800, height: 600, orientation: 1 };
  const isPng = buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return {
    buffer: buf,
    extension: isPng ? 'png' : 'jpeg',
    width: info.width,
    height: info.height,
    converted: false,
    exifRotated: false,
    cropped: true,
    sha256: crypto.createHash('sha256').update(buf).digest('hex')
  };
}

// [검증 후속 수정 2026-11-24] Stage 2 A 크롭은 메인 프로세스에서 한다.
// 렌더러에는 줄인 미리보기만 보내고(PLAN Q7 대용량 구조: 렌더러에 원본을 올리지 않음),
// 실제 자르기는 원본 해상도 그대로 sips로 하고 JPEG 품질 96으로 인코딩한다. 원본 파일은 읽기만 한다.
const CROP_PREVIEW_MAX_PX = 1600;
const CROP_JPEG_QUALITY = 96;

function writeTempImage(loaded) {
  const ext = loaded.extension === 'png' ? 'png' : loaded.extension === 'gif' ? 'gif' : 'jpg';
  const tmp = path.join(os.tmpdir(), `tpe_crop_${crypto.randomBytes(6).toString('hex')}.${ext}`);
  fs.writeFileSync(tmp, loaded.buffer);
  return tmp;
}

function makeCropPreview(filePath, maxPx = CROP_PREVIEW_MAX_PX) {
  const loaded = loadPhotoForEmbed(filePath);
  const longSide = Math.max(loaded.width, loaded.height);
  let buf = loaded.buffer;
  let mime = loaded.extension === 'png' ? 'image/png' : loaded.extension === 'gif' ? 'image/gif' : 'image/jpeg';
  let previewW = loaded.width;
  let previewH = loaded.height;
  if (longSide > maxPx) {
    const src = writeTempImage(loaded);
    const out = path.join(os.tmpdir(), `tpe_prev_${crypto.randomBytes(6).toString('hex')}.jpg`);
    try {
      // sips -Z는 작은 사진도 키우므로 긴 변이 maxPx보다 클 때만 줄인다
      execFileSync('sips', ['-Z', String(maxPx), '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', src, '--out', out], { stdio: 'pipe' });
      buf = fs.readFileSync(out);
      const info = parseJpegInfo(buf);
      if (info) {
        previewW = info.width;
        previewH = info.height;
      }
      mime = 'image/jpeg';
    } finally {
      for (const f of [src, out]) if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
  return {
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    width: loaded.width,
    height: loaded.height,
    previewWidth: previewW,
    previewHeight: previewH,
    converted: loaded.converted,
    exifRotated: loaded.exifRotated
  };
}

function cropPhotoToJpeg(filePath, rect) {
  const loaded = loadPhotoForEmbed(filePath);
  const x = Math.max(0, Math.min(loaded.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(loaded.height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(loaded.width - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(loaded.height - y, Math.round(rect.h)));
  const src = writeTempImage(loaded);
  const out = path.join(os.tmpdir(), `tpe_cropout_${crypto.randomBytes(6).toString('hex')}.jpg`);
  try {
    // sips --cropOffset은 (세로 offsetY, 가로 offsetX) 순서다 (2026-11-24 실측 확인)
    execFileSync('sips', [
      '--cropToHeightWidth', String(h), String(w),
      '--cropOffset', String(y), String(x),
      '-s', 'format', 'jpeg', '-s', 'formatOptions', String(CROP_JPEG_QUALITY),
      src, '--out', out
    ], { stdio: 'pipe' });
    const buf = fs.readFileSync(out);
    const info = parseJpegInfo(buf) || { width: w, height: h };
    return { buffer: buf, width: info.width, height: info.height, rect: { x, y, w, h }, quality: CROP_JPEG_QUALITY };
  } finally {
    for (const f of [src, out]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

// --- Synthetic Blank Workbook Builder (when app/data/blanks/<id>.xlsx is not yet present) ---

function buildSyntheticWorkbook(templateDef) {
  const wb = new ExcelJS.Workbook();
  const isNavyCompany = ['롯데', '수자인'].includes(templateDef.company);

  for (const sheetDef of templateDef.sheets) {
    if (sheetDef.role === 'remove') continue;
    const ws = wb.addWorksheet(sheetDef.name);

    // Header placeholder for {{현장명}} verification
    ws.headerFooter.oddHeader = '&L{{현장명}}';

    if (sheetDef.role === 'cover') {
      const candidates = sheetDef.coverFields || sheetDef.coverFieldCandidates || [];
      ws.getColumn(1).width = 24;
      ws.getColumn(2).width = 24;
      ws.getColumn(3).width = 24;
      for (const cf of candidates) {
        const cell = ws.getCell(cf.cell);
        cell.value = '';
        cell.font = { name: 'Pretendard', size: 18, bold: true, color: { argb: 'FF37352F' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    } else if (sheetDef.role === 'toc') {
      ws.getColumn(1).width = 12;
      ws.getColumn(2).width = 32;
      ws.getColumn(3).width = 16;
      ws.getCell('A1').value = 'NO.';
      ws.getCell('B1').value = '구분 / 공종';
      ws.getCell('C1').value = '페이지';
      ['A1', 'B1', 'C1'].forEach((addr) => {
        const c = ws.getCell(addr);
        c.font = { name: 'Pretendard', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000F4B' } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    } else if (sheetDef.role === 'block' && sheetDef.block) {
      const blk = sheetDef.block;
      const startRow = blk.startRow || 1;
      const rows = blk.rows || 7;

      // Estimate columns needed
      let maxCol = 10;
      const checkAddr = (addr) => {
        const p = parseRelCell(addr, startRow);
        if (p && p.col > maxCol) maxCol = p.col;
      };
      (blk.labels || []).forEach((l) => checkAddr(l.cell));
      (blk.values || []).forEach((v) => checkAddr(v.cell));
      (blk.repeatedValues || []).forEach((rv) => checkAddr(rv.cell));
      if (blk.numbering && blk.numbering.cell) checkAddr(blk.numbering.cell);
      if (blk.numbering && blk.numbering.totalCell) checkAddr(blk.numbering.totalCell);
      (blk.photoAreas || []).forEach((pa) => {
        const r = parseRelRange(pa.area, startRow);
        if (r && r.c2 > maxCol) maxCol = r.c2;
      });

      // Set reasonable column widths (photo area columns wider to match approxWidthPx)
      for (let c = 1; c <= maxCol; c++) {
        ws.getColumn(c).width = 14;
      }
      for (const pa of blk.photoAreas || []) {
        const r = parseRelRange(pa.area, startRow);
        if (r && pa.approxWidthPx) {
          const colCount = r.c2 - r.c1 + 1;
          const perColPx = pa.approxWidthPx / colCount;
          const excelW = Math.max(8, Math.round((perColPx / 8) * 10) / 10);
          for (let c = r.c1; c <= r.c2; c++) {
            ws.getColumn(c).width = excelW;
          }
        }
      }

      // Row heights
      for (let i = 0; i < rows; i++) {
        const h = blk.rowHeights && blk.rowHeights[i] ? blk.rowHeights[i] : 24;
        ws.getRow(startRow + i).height = h;
      }

      // 1. Merge photoAreas FIRST (if merged !== false)
      for (const pa of blk.photoAreas || []) {
        if (pa.merged === false) continue;
        const r = parseRelRange(pa.area, startRow);
        if (r && (r.r1 !== r.r2 || r.c1 !== r.c2)) {
          try {
            ws.mergeCells(r.r1, r.c1, r.r2, r.c2);
          } catch (_) {}
        }
      }

      // 2. Apply borders and fills to block cells
      const thinBorder = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
      };
      for (let r = startRow; r < startRow + rows; r++) {
        for (let c = 1; c <= maxCol; c++) {
          const cell = ws.getCell(r, c);
          cell.border = thinBorder;
          cell.font = { name: 'Pretendard', size: 10, color: { argb: 'FF37352F' } };
          cell.alignment = { vertical: 'middle', wrapText: true };
        }
      }

      // 3. Apply labels
      for (const lbl of blk.labels || []) {
        const p = parseRelCell(lbl.cell, startRow);
        if (!p) continue;
        const cell = ws.getCell(p.row, p.col);
        cell.value = lbl.text;
        cell.font = {
          name: 'Pretendard',
          size: 10,
          bold: true,
          color: { argb: isNavyCompany ? 'FFFFFFFF' : 'FF37352F' }
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isNavyCompany ? 'FF000F4B' : 'FFF2F4F8' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }

      // Print setup
      if (sheetDef.print) {
        if (sheetDef.print.paperSize) {
          const ps = parseInt(sheetDef.print.paperSize, 10);
          if (ps > 0) ws.pageSetup.paperSize = ps;
        }
        if (sheetDef.print.scale) {
          const sc = parseInt(sheetDef.print.scale, 10);
          if (sc > 0) ws.pageSetup.scale = sc;
        }
        if (sheetDef.print.fitToPage) {
          ws.pageSetup.fitToPage = true;
        }
      }
    }
  }
  return wb;
}

// --- Block Replication Helpers (Verified Rule: Merges FIRST, Styles SECOND) ---

function captureBlockTemplate(ws, startRow, rows) {
  const rowHeights = [];
  const cells = [];
  const merges = [];

  for (let i = 0; i < rows; i++) {
    const r = startRow + i;
    const rowObj = ws.getRow(r);
    rowHeights.push(rowObj.height || 20);
    rowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells.push({
        relRow: i,
        col: colNumber,
        style: JSON.parse(JSON.stringify(cell.style || {})),
        value: cell.value
      });
    });
  }

  // Capture merges fully inside [startRow, startRow + rows - 1]
  const mergeModels = ws.model && ws.model.merges ? ws.model.merges : [];
  for (const ref of mergeModels) {
    const parts = ref.split(':');
    const a = parseAbsCell(parts[0]);
    const b = parseAbsCell(parts[1] || parts[0]);
    if (a && b && a.row >= startRow && b.row < startRow + rows) {
      merges.push({
        relR1: a.row - startRow,
        c1: a.col,
        relR2: b.row - startRow,
        c2: b.col
      });
    }
  }

  return { rowHeights, cells, merges };
}

function unmergeFromRow(ws, minRow) {
  const mergeModels = ws.model && ws.model.merges ? [...ws.model.merges] : [];
  for (const ref of mergeModels) {
    const parts = ref.split(':');
    const a = parseAbsCell(parts[0]);
    const b = parseAbsCell(parts[1] || parts[0]);
    if (a && b && b.row >= minRow) {
      try {
        ws.unMergeCells(ref);
      } catch (_) {}
    }
  }
}

function stampBlock(ws, blockStartRow, blockTpl, blockDef) {
  const rows = blockTpl.rowHeights.length;

  // 1. Set row heights
  for (let i = 0; i < rows; i++) {
    ws.getRow(blockStartRow + i).height = blockTpl.rowHeights[i];
  }

  // 2. Apply merges FIRST (ExcelJS mergeCells overwrites cell styles!)
  for (const m of blockTpl.merges) {
    try {
      ws.mergeCells(
        blockStartRow + m.relR1,
        m.c1,
        blockStartRow + m.relR2,
        m.c2
      );
    } catch (_) {}
  }

  // 3. Apply styles SECOND & clear values
  for (const c of blockTpl.cells) {
    const cell = ws.getCell(blockStartRow + c.relRow, c.col);
    cell.style = JSON.parse(JSON.stringify(c.style));
    cell.value = null;
  }

  // 4. Restore fixed labels
  for (const lbl of (blockDef && blockDef.labels) || []) {
    const p = parseRelCell(lbl.cell, blockStartRow);
    if (p) {
      ws.getCell(p.row, p.col).value = lbl.text;
    }
  }
}

function cloneSheetStructure(wb, sourceWs, newSheetName) {
  const newWs = wb.addWorksheet(newSheetName);
  newWs.properties = JSON.parse(JSON.stringify(sourceWs.properties || {}));
  newWs.pageSetup = JSON.parse(JSON.stringify(sourceWs.pageSetup || {}));
  newWs.headerFooter = JSON.parse(JSON.stringify(sourceWs.headerFooter || {}));

  // Copy column widths
  if (sourceWs.columns) {
    sourceWs.columns.forEach((col, idx) => {
      if (col && col.width) {
        newWs.getColumn(idx + 1).width = col.width;
      }
    });
  }

  // Copy rows up to sourceWs.rowCount
  const mergeModels = sourceWs.model && sourceWs.model.merges ? [...sourceWs.model.merges] : [];
  for (const ref of mergeModels) {
    try {
      newWs.mergeCells(ref);
    } catch (_) {}
  }

  sourceWs.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = newWs.getRow(rowNumber);
    if (row.height) newRow.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const target = newRow.getCell(colNumber);
      target.style = JSON.parse(JSON.stringify(cell.style || {}));
      target.value = cell.value;
    });
  });

  return newWs;
}

// --- Numbering Calculation (A안: Direct numeric values, NO formulas, NO fullCalcOnLoad) ---

function computeDocumentNumbering(templateDef, editorState) {
  // Returns map: sheetName -> [{ blockIdx, number, total }]
  const result = {};
  let docRunningNumber = 1;
  let totalDocBlocks = 0;

  for (const sState of editorState.sheets) {
    if (sState.role === 'block') {
      totalDocBlocks += (sState.blocks || []).length;
    }
  }

  for (const sState of editorState.sheets) {
    if (sState.role !== 'block') continue;
    const sheetDef = sState.sheetDef;
    const numbering = sheetDef && sheetDef.block ? sheetDef.block.numbering : null;
    if (!numbering) {
      result[sState.name] = [];
      continue;
    }

    const isDocScope = numbering.scope === 'document';
    let current = isDocScope ? docRunningNumber : 1;
    const list = [];

    for (let i = 0; i < (sState.blocks || []).length; i++) {
      list.push({
        blockIdx: i,
        number: current,
        total: numbering.totalCell ? totalDocBlocks : null
      });
      current++;
    }

    if (isDocScope) {
      docRunningNumber = current;
    }
    result[sState.name] = list;
  }

  return result;
}

// --- Print Area & Page Breaks Regeneration ---

// [인쇄 비교 수정 2026-11-25] 원본의 쪽 구성 재현
// - blocksPerPage: N블록마다 쪽 나누기 (everyNBlocks, S12)
// - breakOffset: 쪽 마지막 블록의 몇 번째 행(0부터) 뒤에서 나눌지. 없으면 블록 마지막 행.
//   원본 일부는 블록 마지막 얇은 행(간격용)을 다음 쪽 맨 위로 넘긴다(공용홀 아크로·힐스테이트, 분양 롯데).
// - pageTopSpacerHeights: 둘째 쪽부터 쪽 맨 위에 넣는 빈 행 높이들 (공용홀 롯데 5.5pt)
function pageLayoutOf(templateDef, sheetDef, rows) {
  const printDef = (sheetDef && sheetDef.print) || {};
  let blocksPerPage = null;
  if (templateDef.id === '준공사진첩_한신더휴') blocksPerPage = 2; // S12
  else if (printDef.pageBreakRule === 'everyNBlocks' && printDef.blocksPerPrintedPage > 0) blocksPerPage = printDef.blocksPerPrintedPage;
  const breakOffset = Number.isInteger(printDef.pageBreakRowOffset) && printDef.pageBreakRowOffset >= 0 && printDef.pageBreakRowOffset < rows
    ? printDef.pageBreakRowOffset
    : rows - 1;
  const spacers = blocksPerPage && Array.isArray(printDef.pageTopSpacerHeights) ? printDef.pageTopSpacerHeights : [];
  return { blocksPerPage, breakOffset, spacers };
}

function computeBlockStarts(layout, startRow, rows, blockCount) {
  const starts = [startRow];
  const spacerRows = [];
  for (let b = 1; b < blockCount; b++) {
    let next = starts[b - 1] + rows;
    if (layout.blocksPerPage && b % layout.blocksPerPage === 0) {
      layout.spacers.forEach((h, i) => spacerRows.push({ row: next + i, height: h }));
      next += layout.spacers.length;
    }
    starts.push(next);
  }
  return { starts, spacerRows, lastRow: starts[starts.length - 1] + rows - 1 };
}

function updatePrintArea(ws, printDef, startRow, rows, blockCount, lastRowOverride) {
  if (!printDef || !printDef.printArea) return;
  const m = String(printDef.printArea).match(/!\$([A-Za-z]+)\$(\d+):\$([A-Za-z]+)\$(\d+)/);
  if (!m) return;
  const col1 = m[1];
  const r1 = parseInt(m[2], 10);
  const col2 = m[3];
  const lastBlockEndRow = lastRowOverride || startRow + Math.max(1, blockCount) * rows - 1;
  ws.pageSetup.printArea = `${col1}${r1}:${col2}${lastBlockEndRow}`;
}

function regeneratePageBreaks(ws, layout, starts) {
  // [검증 후속 수정 2026-11-24] 규칙이 없는 시트(manual·none)는 페이지 나누기를 건드리지 않는다(PLAN Q3).
  // S12(한신더휴 준공)와 everyNBlocks 시트만 정의서 규칙대로 다시 만든다.
  const blocksPerPage = layout.blocksPerPage;
  if (!blocksPerPage) return;
  ws.rowBreaks = [];
  const blockCount = starts.length;
  if (blockCount <= blocksPerPage) return;
  for (let k = blocksPerPage - 1; k < blockCount - 1; k += blocksPerPage) {
    const breakRow = starts[k] + layout.breakOffset;
    // [Konan 수정 2026-11-24] Worksheet에는 addPageBreak이 없음(ExcelJS 4.4.0) — Row의 addPageBreak 사용 (ws.rowBreaks에 {id: breakRow, man: 1} 추가)
    ws.getRow(breakRow).addPageBreak();
  }
}

// --- XML Escape for {{현장명}} replacement ---
// [글꼴 선택 2026-11-25] 칸별 글꼴. 키: 표지·목차·머리 행은 'B5', 블록 칸은 'B{+3}'(모든 블록의 같은 칸)
function applyCellFontOverrides(ws, cellFonts, blockStarts) {
  if (!cellFonts) return;
  for (const [key, ov] of Object.entries(cellFonts)) {
    if (!ov) continue;
    const targets = [];
    const rel = /^([A-Z]+)\{\+(\d+)\}$/.exec(key);
    if (rel) {
      if (!blockStarts) continue;
      for (const st of blockStarts) targets.push(ws.getCell(st + Number(rel[2]), colToNum(rel[1])));
    } else if (/^[A-Z]+\d+$/.test(key)) {
      targets.push(ws.getCell(key));
    }
    for (const cell of targets) {
      const font = { ...(cell.font || {}) };
      if (ov.name) font.name = ov.name;
      if (ov.size) font.size = ov.size;
      if (ov.bold !== undefined) font.bold = !!ov.bold;
      // 스타일 객체를 칸끼리 같이 쓰므로 새 객체로 바꿔 끼운다
      const alignment = ov.shrink !== undefined ? { ...(cell.alignment || {}), shrinkToFit: !!ov.shrink, ...(ov.shrink ? { wrapText: false } : {}) } : cell.alignment;
      cell.style = { ...cell.style, font, ...(alignment ? { alignment } : {}) };
      if (cell.value && typeof cell.value === 'object' && Array.isArray(cell.value.richText)) {
        cell.value = { richText: cell.value.richText.map((r) => ({ ...r, font: { ...(r.font || {}), ...(ov.name ? { name: ov.name } : {}), ...(ov.size ? { size: ov.size } : {}), ...(ov.bold !== undefined ? { bold: !!ov.bold } : {}) } })) };
      }
    }
  }
}

function applyFontMap(wb, fontMap) {
  const keys = Object.keys(fontMap || {}).filter((k) => fontMap[k] && fontMap[k] !== k);
  if (!keys.length) return;
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const f = cell.style && cell.style.font;
        if (f && fontMap[f.name]) cell.style = { ...cell.style, font: { ...f, name: fontMap[f.name] } };
        const v = cell.value;
        if (v && typeof v === 'object' && Array.isArray(v.richText) && v.richText.some((r) => r.font && fontMap[r.font.name])) {
          cell.value = { richText: v.richText.map((r) => (r.font && fontMap[r.font.name] ? { ...r, font: { ...r.font, name: fontMap[r.font.name] } } : r)) };
        }
      });
    });
    const hf = ws.headerFooter || {};
    for (const k of ['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter']) {
      if (typeof hf[k] !== 'string') continue;
      hf[k] = hf[k].replace(/&"([^",]+),/g, (m, name) => (fontMap[name] ? `&"${fontMap[name]},` : m));
    }
  }
}

async function applyFontMapToDrawings(zip, fontMap) {
  const keys = Object.keys(fontMap || {}).filter((k) => fontMap[k] && fontMap[k] !== k);
  if (!keys.length) return;
  for (const filename of Object.keys(zip.files)) {
    if (!/^xl\/drawings\/[^/]+\.xml$/.test(filename)) continue;
    const xml = await zip.file(filename).async('string');
    const out = xml.replace(/typeface="([^"]+)"/g, (m, name) => {
      const real = name.replace(/&amp;/g, '&');
      return fontMap[real] ? `typeface="${escapeXml(fontMap[real])}"` : m;
    });
    if (out !== xml) zip.file(filename, out);
  }
}

// --- 사진 위 표시(화살표·네모·글상자) → DrawingML 도형 ---
const EMU = 9525;
const hex6 = (c, d) => String(c || d).replace('#', '').toUpperCase().slice(0, 6);
function annotationXml(a, box, id) {
  const X = (r) => Math.round((box.x + r * box.w) * EMU);
  const Y = (r) => Math.round((box.y + r * box.h) * EMU);
  const lineW = Math.round(Math.max(0.5, a.w || 3) * EMU);
  const color = hex6(a.c, 'E11D48');
  if (a.t === 'arrow') {
    const x1 = X(a.x1), y1 = Y(a.y1), x2 = X(a.x2), y2 = Y(a.y2);
    const flipH = x2 < x1 ? ' flipH="1"' : '';
    const flipV = y2 < y1 ? ' flipV="1"' : '';
    const ox = Math.min(x1, x2), oy = Math.min(y1, y2), cx = Math.max(1, Math.abs(x2 - x1)), cy = Math.max(1, Math.abs(y2 - y1));
    return `<xdr:absoluteAnchor><xdr:pos x="${ox}" y="${oy}"/><xdr:ext cx="${cx}" cy="${cy}"/><xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="표시 화살표 ${id}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr><a:xfrm${flipH}${flipV}><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="${lineW}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:absoluteAnchor>`;
  }
  const ox = X(Math.min(a.x, a.x + a.w2)), oy = Y(Math.min(a.y, a.y + a.h2));
  const cx = Math.max(1, Math.round(Math.abs(a.w2) * box.w * EMU)), cy = Math.max(1, Math.round(Math.abs(a.h2) * box.h * EMU));
  if (a.t === 'box') {
    return `<xdr:absoluteAnchor><xdr:pos x="${ox}" y="${oy}"/><xdr:ext cx="${cx}" cy="${cy}"/><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="표시 네모 ${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="${lineW}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`;
  }
  // 글상자
  const fill = a.bg ? `<a:solidFill><a:srgbClr val="${hex6(a.bg, 'FFFFFF')}"/></a:solidFill>` : '<a:noFill/>';
  const ln = a.border === false ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${Math.round(1.5 * EMU)}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>`;
  const sz = Math.round((a.size || 10) * 100);
  const font = escapeXml(a.font || '맑은 고딕');
  const paras = String(a.text || '').split('\n').map((line) => `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ko-KR" sz="${sz}" b="${a.bold === false ? 0 : 1}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${font}"/><a:ea typeface="${font}"/></a:rPr><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join('');
  return `<xdr:absoluteAnchor><xdr:pos x="${ox}" y="${oy}"/><xdr:ext cx="${cx}" cy="${cy}"/><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="표시 글상자 ${id}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${ln}</xdr:spPr><xdr:txBody><a:bodyPr wrap="square" lIns="36000" tIns="18000" rIns="36000" bIns="18000" anchor="ctr"/><a:lstStyle/>${paras}</xdr:txBody></xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`;
}

async function injectAnnotations(zip, jobs) {
  if (!jobs.length) return 0;
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);
  const sheets = sheetPaths({ 'xl/workbook.xml': await read('xl/workbook.xml'), 'xl/_rels/workbook.xml.rels': await read('xl/_rels/workbook.xml.rels') });
  const bySheet = new Map();
  for (const j of jobs) {
    if (!bySheet.has(j.sheetName)) bySheet.set(j.sheetName, []);
    bySheet.get(j.sheetName).push(j);
  }
  let count = 0;
  for (const [name, list] of bySheet) {
    const sPath = sheets[name];
    if (!sPath) continue;
    const rel = drawingRelOf(await read(relsPathOf(sPath)));
    if (!rel) continue;
    const dPath = resolveTarget(sPath, rel.target);
    let xml = await read(dPath);
    if (!xml) continue;
    let id = Math.max(0, ...[...xml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => +m[1])) + 1;
    let add = '';
    for (const j of list) {
      for (const a of j.items) {
        add += annotationXml(a, j, id++);
        count++;
      }
    }
    if (!/xmlns:a=/.test(xml.slice(0, 600))) xml = xml.replace(/<xdr:wsDr\b/, '<xdr:wsDr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"');
    xml = xml.replace(/<\/xdr:wsDr>\s*$/, `${add}</xdr:wsDr>`);
    zip.file(dPath, xml);
  }
  return count;
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// [인쇄 비교 수정 2026-11-25] 표지 칸 글자를 머리말용으로 정리: 첫 줄만, 앞의 "PROJECT:" 같은 라벨은 뺀다
function cleanCoverSiteName(v) {
  const first = String(v || '').split(/\r?\n/)[0];
  return first.replace(/^\s*PROJECT\s*[:：]\s*/i, '').trim();
}

function extractSiteName(editorState) {
  // 우선순위
  // 1) 화면 위쪽 "머리말 현장명" 입력값: 원본 머리말처럼 "현장명 공용홀" 등으로 직접 맞출 수 있다
  // 2) 표지의 kind: 'siteName' 칸 (첫 줄, "PROJECT:" 라벨 제외)
  // 3) siteName 칸이 없는 양식('기타')은 첫 표지 칸 값
  if (editorState.siteName && String(editorState.siteName).trim()) return String(editorState.siteName).trim();
  const coverSheets = editorState.sheets.filter((s) => s.role === 'cover');
  const fieldsOf = (sState) =>
    (sState.sheetDef && (sState.sheetDef.coverFields || sState.sheetDef.coverFieldCandidates)) || [];
  const valueOf = (sState, cf) => {
    const val = sState.cells && sState.cells[cf.cell];
    return val != null && String(val).trim() ? cleanCoverSiteName(val) : '';
  };
  let hasSiteNameField = false;
  for (const sState of coverSheets) {
    for (const cf of fieldsOf(sState)) {
      if (cf.kind !== 'siteName') continue;
      hasSiteNameField = true;
      const v = valueOf(sState, cf);
      if (v) return v;
    }
  }
  if (hasSiteNameField) return '';
  for (const sState of coverSheets) {
    const first = fieldsOf(sState)[0];
    if (first) {
      const v = valueOf(sState, first);
      if (v) return v;
    }
  }
  return '';
}

// --- Main Export Function ---

async function exportWorkbook({ templateDef, editorState, blankXlsxPath, outputPath }) {
  if (blankXlsxPath && path.resolve(blankXlsxPath) === path.resolve(outputPath)) {
    throw new Error('원본 빈 양식 파일을 덮어쓸 수 없습니다. 다른 경로로 저장해 주세요.');
  }

  const wb = new ExcelJS.Workbook();
  if (blankXlsxPath && fs.existsSync(blankXlsxPath)) {
    await wb.xlsx.readFile(blankXlsxPath);
  } else {
    const syn = buildSyntheticWorkbook(templateDef);
    const tmpBuf = await syn.xlsx.writeBuffer();
    await wb.xlsx.load(tmpBuf);
  }

  // Ensure fullCalcOnLoad is NOT enabled (S1: A안)
  if (wb.calcProperties) {
    wb.calcProperties.fullCalcOnLoad = false;
  }

  // 1. Remove `role === 'remove'` sheets (e.g. Lotte hidden Sheet1)
  for (const sDef of templateDef.sheets) {
    if (sDef.role === 'remove') {
      const ws = wb.getWorksheet(sDef.name);
      if (ws) wb.removeWorksheet(ws.id);
    }
  }

  // 2. Clean excessive definedNames (keep Print_Area / Print_Titles)
  if (wb.definedNames && wb.definedNames.model) {
    wb.definedNames.model = wb.definedNames.model.filter(
      (dn) => dn.name === '_xlnm.Print_Area' || dn.name === '_xlnm.Print_Titles'
    );
  }

  // 3. Sync added/deleted block sheets
  const stateSheetNames = new Set(editorState.sheets.map((s) => s.name));
  // Remove sheets deleted by user (never remove cover/toc)
  for (const ws of [...wb.worksheets]) {
    if (!stateSheetNames.has(ws.name)) {
      const def = templateDef.sheets.find((s) => s.name === ws.name);
      if (!def || def.role === 'block') {
        wb.removeWorksheet(ws.id);
      }
    }
  }

  // Clone template block sheet for newly added block sheets
  const firstBlockDef = templateDef.sheets.find((s) => s.role === 'block');
  const firstBlockWs = firstBlockDef ? wb.getWorksheet(firstBlockDef.name) : null;
  for (const sState of editorState.sheets) {
    if (!wb.getWorksheet(sState.name) && sState.role === 'block') {
      const sourceName = sState.clonedFrom || (firstBlockDef && firstBlockDef.name);
      const sourceWs = wb.getWorksheet(sourceName) || firstBlockWs;
      if (sourceWs) {
        cloneSheetStructure(wb, sourceWs, sState.name);
      } else {
        wb.addWorksheet(sState.name);
      }
    }
  }

  const mdw = getWorkbookMdw(wb);
  const numberingMap = computeDocumentNumbering(templateDef, editorState);
  const imageCache = new Map(); // sha256 -> { imageId, width, height, extension }
  let totalPhotoPlacements = 0;
  const annotationJobs = [];
  let uniqueImagesEmbedded = 0;
  let convertedCount = 0;
  let exifRotatedCount = 0;

  // 4. Populate each sheet
  for (const sState of editorState.sheets) {
    const ws = wb.getWorksheet(sState.name);
    if (!ws) continue;

    if (sState.role === 'cover' || sState.role === 'toc') {
      // Apply edited cells
      for (const [addr, val] of Object.entries(sState.cells || {})) {
        ws.getCell(addr).value = val;
      }
      fillSimpleFormulaResults(ws);
      applyCellFontOverrides(ws, sState.cellFonts, null);
      continue;
    }

    if (sState.role === 'block') {
      const blkDef = sState.sheetDef && sState.sheetDef.block;
      if (!blkDef) continue;

      const startRow = blkDef.startRow || 1;
      const rows = blkDef.rows || 7;
      const blocks = sState.blocks || [];
      const blockCount = Math.max(1, blocks.length);

      // Capture block 0 template BEFORE clearing/modifying
      const blockTpl = captureBlockTemplate(ws, startRow, rows);
      const layout = pageLayoutOf(templateDef, sState.sheetDef, rows);
      const { starts, spacerRows, lastRow } = computeBlockStarts(layout, startRow, rows, blockCount);

      // Unmerge everything from startRow downwards and clear old excess rows
      unmergeFromRow(ws, startRow);
      const oldMaxRow = Math.max(ws.rowCount, lastRow);
      for (let r = startRow; r <= oldMaxRow; r++) {
        const rowObj = ws.getRow(r);
        rowObj.eachCell({ includeEmpty: false }, (cell) => {
          cell.value = null;
        });
      }
      // Trim trailing rows if sheet had more rows than needed
      const targetLastRow = lastRow;
      if (ws.rowCount > targetLastRow) {
        ws.spliceRows(targetLastRow + 1, ws.rowCount - targetLastRow);
      }

      // Stamp each block (merges first, styles second)
      const sheetNumbers = numberingMap[sState.name] || [];
      for (let bIdx = 0; bIdx < blockCount; bIdx++) {
        const bStart = starts[bIdx];
        const bData = blocks[bIdx] || { values: {}, photos: {} };

        stampBlock(ws, bStart, blockTpl, blkDef);

        // Apply repeatedValues
        for (const rv of blkDef.repeatedValues || []) {
          const p = parseRelCell(rv.cell, bStart);
          if (!p) continue;
          const rawVal =
            bData.repeatedValues && bData.repeatedValues[rv.cell] !== undefined
              ? bData.repeatedValues[rv.cell]
              : (sState.repeatedValues && sState.repeatedValues[rv.cell]) || '';
          const finalVal = rv.prefix && rawVal && !String(rawVal).startsWith(rv.prefix)
            ? `${rv.prefix}${rawVal}`
            : rawVal;
          if (finalVal !== '') {
            ws.getCell(p.row, p.col).value = finalVal;
          }
        }

        // Apply values (including inline prefix like 하늘채 "AREA :  ")
        for (const vDef of blkDef.values || []) {
          const p = parseRelCell(vDef.cell, bStart);
          if (!p) continue;
          if (bData.values && bData.values[vDef.cell] !== undefined) {
            const rawVal = bData.values[vDef.cell];
            const finalVal = vDef.prefix && rawVal && !String(rawVal).startsWith(vDef.prefix)
              ? `${vDef.prefix}${rawVal}`
              : rawVal;
            ws.getCell(p.row, p.col).value = finalVal;
          }
        }

        // Apply any ad-hoc edited cells inside block (keyed by relAddr e.g. "C{+3}")
        for (const [relKey, val] of Object.entries(bData.extraCells || {})) {
          const p = parseRelCell(relKey, bStart);
          if (p) ws.getCell(p.row, p.col).value = val;
        }

        // Apply numbering & totalCell (A안: direct numeric value, NO formula)
        if (blkDef.numbering && sheetNumbers[bIdx]) {
          const numCell = parseRelCell(blkDef.numbering.cell, bStart);
          if (numCell) {
            ws.getCell(numCell.row, numCell.col).value = sheetNumbers[bIdx].number;
          }
          if (blkDef.numbering.totalCell && sheetNumbers[bIdx].total != null) {
            const totCell = parseRelCell(blkDef.numbering.totalCell, bStart);
            if (totCell) {
              ws.getCell(totCell.row, totCell.col).value = sheetNumbers[bIdx].total;
            }
          }
        }
      }

      // Compute pixel metrics for all columns & rows on this sheet (for oneCell photo anchoring)
      const colCount = Math.max(ws.columnCount || 20, 26);
      const colWidthsPx = [];
      for (let c = 1; c <= colCount; c++) {
        colWidthsPx.push(colWidthToPx(ws.getColumn(c).width, mdw));
      }
      const rowHeightsPx = [];
      for (let r = 1; r <= targetLastRow + 2; r++) {
        rowHeightsPx.push(rowHeightToPx(ws.getRow(r).height));
      }

      const cumColX = [0];
      for (let i = 0; i < colWidthsPx.length; i++) cumColX.push(cumColX[i] + colWidthsPx[i]);
      const cumRowY = [0];
      for (let i = 0; i < rowHeightsPx.length; i++) cumRowY.push(cumRowY[i] + rowHeightsPx[i]);

      // Place photos with oneCell anchor + contain + center + SHA-256 deduplication
      for (let bIdx = 0; bIdx < blockCount; bIdx++) {
        const bStart = starts[bIdx];
        const bData = blocks[bIdx] || {};
        const photoAreasState = bData.photoAreas || {};

        for (let paIdx = 0; paIdx < (blkDef.photoAreas || []).length; paIdx++) {
          const paDef = blkDef.photoAreas[paIdx];
          const paState = photoAreasState[paIdx];
          if (!paState || !paState.layout || !Array.isArray(paState.slots)) continue;

          const rng = parseRelRange(paDef.area, bStart);
          if (!rng) continue;

          const areaBoundsPx = {
            x: cumColX[rng.c1 - 1],
            y: cumRowY[rng.r1 - 1],
            width: cumColX[rng.c2] - cumColX[rng.c1 - 1],
            height: cumRowY[rng.r2] - cumRowY[rng.r1 - 1]
          };

          for (let sIdx = 0; sIdx < paState.slots.length; sIdx++) {
            const slot = paState.slots[sIdx];
            if (!slot) continue;

            let loaded = null;
            if (slot.croppedDataBase64) {
              loaded = loadCroppedPhotoForEmbed(slot.croppedDataBase64);
            } else if (slot.path && fs.existsSync(slot.path)) {
              loaded = loadPhotoForEmbed(slot.path);
            } else {
              continue;
            }
            if (loaded.converted) convertedCount++;
            if (loaded.exifRotated) exifRotatedCount++;

            let cached = imageCache.get(loaded.sha256);
            if (!cached) {
              const imageId = wb.addImage({
                buffer: loaded.buffer,
                extension: loaded.extension
              });
              cached = { imageId, width: loaded.width, height: loaded.height };
              imageCache.set(loaded.sha256, cached);
              uniqueImagesEmbedded++;
            }

            const placement = computeSlotPlacement(
              areaBoundsPx,
              paState.layout,
              sIdx,
              cached.width,
              cached.height
            );

            const tlCol = pxToFractionalIndex(placement.x, colWidthsPx);
            const tlRow = pxToFractionalIndex(placement.y, rowHeightsPx);

            ws.addImage(cached.imageId, {
              tl: { col: tlCol, row: tlRow },
              ext: { width: Math.round(placement.width), height: Math.round(placement.height) },
              editAs: 'oneCell'
            });
            totalPhotoPlacements++;
            // [사진 표시 2026-11-25] 사진 위 화살표·네모·글상자 → 나중에 엑셀 도형으로 넣는다
            if (Array.isArray(slot.annotations) && slot.annotations.length) {
              annotationJobs.push({ sheetName: sState.name, x: placement.x, y: placement.y, w: placement.width, h: placement.height, items: slot.annotations });
            }
          }
        }
      }

      // Update Print_Area & Page Breaks
      // [인쇄 비교 수정 2026-11-25] 블록 위 머리 행 값(현장명·평형·일자)
      for (const hf of blkDef.headerFields || []) {
        const v = sState.headerValues && sState.headerValues[hf.cell];
        if (v != null && String(v) !== '') ws.getCell(hf.cell).value = v;
      }
      // 쪽 맨 위 빈 행(원본 간격 행) 높이
      for (const sp of spacerRows) {
        ws.getRow(sp.row).height = sp.height;
      }
      applyCellFontOverrides(ws, sState.cellFonts, starts);
      updatePrintArea(ws, sState.sheetDef.print, startRow, rows, blockCount, lastRow);
      regeneratePageBreaks(ws, layout, starts);
    }
  }

  // [글꼴 선택 2026-11-25] 문서 전체 글꼴 바꾸기(칸·글자 조각·머리말/바닥글)
  const fontMap = (editorState && editorState.fontMap) || {};
  applyFontMap(wb, fontMap);

  // 5. Write to buffer and post-process with JSZip for {{현장명}} replacement & externalLink cleanup
  const rawBuffer = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(rawBuffer);

  // [인쇄 비교 수정 2026-11-25] ExcelJS가 바꾸거나 버린 인쇄 설정(기본 글꼴·쪽 번호·머리말 위치·표지/목차 쪽 나누기)을 빈 양식 값으로 되돌린다
  if (blankXlsxPath && fs.existsSync(blankXlsxPath)) {
    await restorePrintSettings(zip, fs.readFileSync(blankXlsxPath), (name) => {
      const st = editorState.sheets.find((s) => s.name === name);
      if (!st) return null;
      const def = templateDef.sheets.find((s) => s.name === name);
      const source = def ? name : st.clonedFrom || (firstBlockDef && firstBlockDef.name);
      const srcDef = templateDef.sheets.find((s) => s.name === source);
      const startRow = srcDef && srcDef.block ? srcDef.block.startRow || 1 : null;
      return { source, role: st.role, startRow };
    });
  }

  const siteName = extractSiteName(editorState);
  let replacedPlaceholders = 0;
  const escapedSiteName = escapeXml(siteName);

  for (const filename of Object.keys(zip.files)) {
    if (filename.startsWith('xl/externalLinks/')) {
      zip.remove(filename);
      continue;
    }
    if (
      (filename.startsWith('xl/worksheets/') || filename.startsWith('xl/drawings/')) &&
      filename.endsWith('.xml')
    ) {
      const xml = await zip.file(filename).async('string');
      if (xml.includes('{{현장명}}')) {
        const matches = xml.match(/\{\{현장명\}\}/g);
        replacedPlaceholders += matches ? matches.length : 0;
        zip.file(filename, xml.replace(/\{\{현장명\}\}/g, escapedSiteName));
      }
    }
  }

  // [글꼴 선택 2026-11-25] 글상자·도형 글꼴(빈 양식에서 되살린 도형 포함)
  await applyFontMapToDrawings(zip, fontMap);

  // [사진 표시 2026-11-25] 사진 위 표시를 엑셀 도형으로 넣는다(엑셀에서 고칠 수 있음)
  const annotationCount = await injectAnnotations(zip, annotationJobs);

  // [시트 이름 바꾸기 2026-11-25] 탭에서 바꾼 이름을 마지막에 파일 안 시트 이름으로 바꾼다
  const renameMap = new Map(
    editorState.sheets.filter((s) => s.label && s.label !== s.name).map((s) => [s.name, s.label])
  );
  const renamedSheets = await renameSheetsInZip(zip, renameMap);

  const finalBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputPath, finalBuffer);

  return {
    outputPath,
    sizeBytes: finalBuffer.length,
    totalPhotoPlacements,
    uniqueImagesEmbedded,
    convertedCount,
    exifRotatedCount,
    replacedPlaceholders,
    renamedSheets,
    annotationCount
  };
}

module.exports = {
  colToNum,
  numToCol,
  parseAbsCell,
  parseRelCell,
  parseRelRange,
  colWidthToPx,
  rowHeightToPx,
  LAYOUT_SPECS,
  computeSlotPlacement,
  getImageInfoFromBuffer,
  loadPhotoForEmbed,
  loadCroppedPhotoForEmbed,
  makeCropPreview,
  cropPhotoToJpeg,
  buildSyntheticWorkbook,
  computeDocumentNumbering,
  extractSiteName,
  exportWorkbook
};
