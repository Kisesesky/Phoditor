// [작업 파일 2026-11-25, 분리 2026-11-26] PLAN 주제 4: 작업 파일 하나에 JSON + 사진을 묶는다(.pbook = zip)
//   project.json            — 작업 내용(사진은 photos/… 이름으로 가리킴, 원래 경로는 originalPath)
//   photos/<내용 해시>.<확장자> — 넣은 원본 사진. 같은 사진은 다른 폴더에서 넣어도 한 번만 저장(내용 기준)
//   edits/<내용 해시>.jpg     — 자르거나 돌린 사진
// main.js(저장·열기)와 test-project.js(자동 테스트)가 같이 쓴다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);

function forEachSlot(editor, fn) {
  for (const s of (editor && editor.sheets) || []) {
    for (const b of s.blocks || []) {
      for (const pa of Object.values(b.photoAreas || {})) {
        if (!pa || !Array.isArray(pa.slots)) continue;
        pa.slots.forEach((sl, i) => {
          if (sl) fn(sl, pa, i);
        });
      }
    }
  }
}

/**
 * 작업 내용을 .pbook(zip)으로 쓴다. 원래 data는 바꾸지 않는다.
 * @returns {{photos:number, edits:number, missing:number, sizeBytes:number}}
 */
async function writeProjectZip(target, data) {
  const zip = new JSZip();
  const doc = JSON.parse(JSON.stringify(data));
  const byPath = new Map(); // 경로 → zip 안 이름(없으면 null)
  const byHash = new Set();
  let photos = 0;
  let edits = 0;
  let missing = 0;
  forEachSlot(doc.editor, (sl) => {
    if (sl.path) {
      if (!byPath.has(sl.path)) {
        if (fs.existsSync(sl.path)) {
          const buf = fs.readFileSync(sl.path);
          const ext = path.extname(sl.path).toLowerCase() || '.jpg';
          const name = `photos/${sha1(buf)}${ext}`;
          if (!byHash.has(name)) {
            zip.file(name, buf, { compression: 'STORE' });
            byHash.add(name);
            photos++;
          }
          byPath.set(sl.path, name);
        } else {
          byPath.set(sl.path, null);
          missing++;
        }
      }
      const inZip = byPath.get(sl.path);
      sl.originalPath = sl.originalPath || sl.path;
      if (inZip) sl.packed = inZip;
      delete sl.path;
      delete sl.thumbUrl;
      delete sl.previewUrl;
    }
    if (sl.croppedDataBase64) {
      const buf = Buffer.from(sl.croppedDataBase64, 'base64');
      const name = `edits/${sha1(buf)}.jpg`;
      if (!zip.file(name)) {
        zip.file(name, buf, { compression: 'STORE' });
        edits++;
      }
      sl.croppedFile = name;
      delete sl.croppedDataBase64;
      delete sl.thumbUrl;
    }
  });
  zip.file('project.json', JSON.stringify(doc), { compression: 'DEFLATE' });
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
  return { photos, edits, missing, sizeBytes: buf.length };
}

/**
 * .pbook을 읽는다. 사진은 extractRoot 아래(파일마다 다른 폴더)에 풀고 그 경로로 연결한다.
 * 예전(JSON만) 작업 파일도 읽는다.
 */
async function readProjectFile(target, extractRoot) {
  const buf = fs.readFileSync(target);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return JSON.parse(buf.toString('utf-8'));
  const zip = await JSZip.loadAsync(buf);
  const doc = JSON.parse(await zip.file('project.json').async('string'));
  const dir = path.join(extractRoot, crypto.createHash('sha1').update(target).digest('hex').slice(0, 12));
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const extracted = new Map();
  const slots = [];
  forEachSlot(doc.editor, (sl) => slots.push(sl));
  for (const sl of slots) {
    if (sl.packed && zip.file(sl.packed)) {
      if (!extracted.has(sl.packed)) {
        const out = path.join(dir, sl.packed);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        // 이름이 내용 해시라 같은 이름이면 같은 내용 — 이미 풀려 있으면 그대로 쓴다
        if (!fs.existsSync(out)) fs.writeFileSync(out, await zip.file(sl.packed).async('nodebuffer'));
        extracted.set(sl.packed, out);
      }
      sl.path = extracted.get(sl.packed);
    } else if (sl.originalPath) {
      sl.path = sl.originalPath;
    }
    delete sl.packed;
    if (sl.croppedFile && zip.file(sl.croppedFile)) {
      const b64 = await zip.file(sl.croppedFile).async('base64');
      sl.croppedDataBase64 = b64;
      sl.thumbUrl = `data:image/jpeg;base64,${b64}`;
      delete sl.croppedFile;
    }
  }
  return doc;
}

module.exports = { forEachSlot, writeProjectZip, readProjectFile };
