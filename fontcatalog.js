// [글꼴 2026-11-25] 미리보기에서 쓸 글꼴 목록.
// 1) 앱에 넣은 무료 글꼴 10종(app/fonts, 재배포 가능 라이선스: fonts/LICENSES.md)
// 2) Mac용 Excel이 앱 안에 갖고 있는 글꼴(맑은 고딕·굴림·돋움·바탕·궁서·Calibri 등).
//    마이크로소프트 유료 글꼴이라 우리 앱에 넣지 않고, 사용자 Mac에 설치된 Excel의 파일을 그 자리에서 읽기만 한다.
// Excel 파일 속 글꼴 이름(aliases)과 미리보기 글꼴 파일을 잇는다. 굵기 이름이 붙은 이름("나눔고딕 ExtraBold")도 따로 잇는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const APP_FONTS = path.join(__dirname, 'fonts');
const EXCEL_FONTS = '/Applications/Microsoft Excel.app/Contents/Resources/DFonts';

// family: 미리보기 CSS 이름 / aliases: Excel 파일에 적히는 이름들 / faces: [파일, 굵기] (ttc는 [파일, 굵기, 몇 번째 글꼴])
const BUNDLED = [
  { family: '나눔고딕', aliases: ['나눔고딕', 'NanumGothic', 'Nanum Gothic'], faces: [['NanumGothic-Regular.ttf', 400], ['NanumGothic-Bold.ttf', 700], ['NanumGothic-ExtraBold.ttf', 800]] },
  { family: '나눔고딕 ExtraBold', aliases: ['나눔고딕 ExtraBold', 'NanumGothicExtraBold', 'NanumGothic ExtraBold'], faces: [['NanumGothic-ExtraBold.ttf', 400], ['NanumGothic-ExtraBold.ttf', 700]] },
  { family: '나눔명조', aliases: ['나눔명조', 'NanumMyeongjo', 'Nanum Myeongjo'], faces: [['NanumMyeongjo-Regular.ttf', 400], ['NanumMyeongjo-Bold.ttf', 700], ['NanumMyeongjo-ExtraBold.ttf', 800]] },
  { family: '나눔명조 ExtraBold', aliases: ['나눔명조 ExtraBold', 'NanumMyeongjoExtraBold'], faces: [['NanumMyeongjo-ExtraBold.ttf', 400], ['NanumMyeongjo-ExtraBold.ttf', 700]] },
  { family: '나눔바른고딕', aliases: ['나눔바른고딕', 'NanumBarunGothic', 'Nanum Barun Gothic', '나눔바른고딕OTF', 'NanumBarunGothicOTF'], faces: [['NanumBarunGothic.otf', 400], ['NanumBarunGothicBold.otf', 700]] },
  { family: '나눔스퀘어', aliases: ['나눔스퀘어', 'NanumSquare', '나눔스퀘어OTF', 'NanumSquareOTF', '나눔스퀘어 Regular', 'NanumSquareR'], faces: [['NanumSquareR.otf', 400], ['NanumSquareB.otf', 700], ['NanumSquareEB.otf', 800]] },
  { family: '나눔스퀘어 Bold', aliases: ['나눔스퀘어 Bold', 'NanumSquare Bold', 'NanumSquareB', '나눔스퀘어OTF Bold'], faces: [['NanumSquareB.otf', 400], ['NanumSquareEB.otf', 700]] },
  { family: '나눔스퀘어 ExtraBold', aliases: ['나눔스퀘어 ExtraBold', 'NanumSquare ExtraBold', 'NanumSquareEB', '나눔스퀘어OTF ExtraBold'], faces: [['NanumSquareEB.otf', 400], ['NanumSquareEB.otf', 700]] },
  { family: '나눔스퀘어라운드', aliases: ['나눔스퀘어라운드', 'NanumSquareRound', '나눔스퀘어라운드OTF', 'NanumSquareRoundOTF', '나눔스퀘어라운드 Regular', 'NanumSquareRoundR'], faces: [['NanumSquareRoundOTFR.otf', 400], ['NanumSquareRoundOTFB.otf', 700]] },
  { family: '나눔스퀘어라운드 Bold', aliases: ['나눔스퀘어라운드 Bold', 'NanumSquareRound Bold', 'NanumSquareRoundB'], faces: [['NanumSquareRoundOTFB.otf', 400], ['NanumSquareRoundOTFB.otf', 700]] },
  { family: '마루 부리', aliases: ['마루 부리', '마루부리', 'MaruBuri', 'Maru Buri', 'MaruBuriOTF', '마루 부리OTF'], faces: [['MaruBuri-Regular.otf', 400], ['MaruBuri-Bold.otf', 700]] },
  { family: 'Noto Sans KR', aliases: ['Noto Sans KR', 'Noto Sans CJK KR', '본고딕', 'Source Han Sans KR', 'Noto Sans CJK KR Regular'], faces: [['NotoSansKR-Variable.ttf', '100 900']] },
  { family: 'Noto Sans CJK KR Medium', aliases: ['Noto Sans CJK KR Medium', 'Noto Sans KR Medium'], faces: [['NotoSansKR-Variable.ttf', '100 900']], weight: 500 },
  { family: 'Noto Sans CJK KR Bold', aliases: ['Noto Sans CJK KR Bold', 'Noto Sans KR Bold'], faces: [['NotoSansKR-Variable.ttf', '100 900']], weight: 700 },
  { family: 'Noto Sans CJK KR Black', aliases: ['Noto Sans CJK KR Black', 'Noto Sans KR Black'], faces: [['NotoSansKR-Variable.ttf', '100 900']], weight: 900 },
  { family: 'Spoqa Han Sans Neo', aliases: ['Spoqa Han Sans Neo', 'Spoqa Han Sans Neo Regular'], faces: [['SpoqaHanSansNeo-Regular.woff2', 400], ['SpoqaHanSansNeo-Medium.woff2', 500], ['SpoqaHanSansNeo-Bold.woff2', 700]] },
  { family: 'Spoqa Han Sans Neo Medium', aliases: ['Spoqa Han Sans Neo Medium'], faces: [['SpoqaHanSansNeo-Medium.woff2', 400], ['SpoqaHanSansNeo-Bold.woff2', 700]] },
  { family: 'Spoqa Han Sans Neo Bold', aliases: ['Spoqa Han Sans Neo Bold'], faces: [['SpoqaHanSansNeo-Bold.woff2', 400], ['SpoqaHanSansNeo-Bold.woff2', 700]] },
  { family: 'Pretendard', aliases: ['Pretendard', 'Pretendard Regular', 'Pretendard Variable'], faces: [['Pretendard-Regular.woff2', 400], ['Pretendard-Medium.woff2', 500], ['Pretendard-SemiBold.woff2', 600], ['Pretendard-Bold.woff2', 700]] },
  { family: 'Pretendard Medium', aliases: ['Pretendard Medium'], faces: [['Pretendard-Medium.woff2', 400], ['Pretendard-Bold.woff2', 700]] },
  { family: 'Pretendard SemiBold', aliases: ['Pretendard SemiBold'], faces: [['Pretendard-SemiBold.woff2', 400], ['Pretendard-Bold.woff2', 700]] },
  { family: 'Pretendard Bold', aliases: ['Pretendard Bold'], faces: [['Pretendard-Bold.woff2', 400], ['Pretendard-Bold.woff2', 700]] },
  { family: 'IBM Plex Sans KR', aliases: ['IBM Plex Sans KR', 'IBMPlexSansKR'], faces: [['IBMPlexSansKR-Regular.ttf', 400], ['IBMPlexSansKR-Bold.ttf', 700]] }
];

const FROM_EXCEL = [
  { family: '맑은 고딕', aliases: ['맑은 고딕', 'Malgun Gothic', '맑은고딕'], faces: [['malgun.ttf', 400], ['malgunbd.ttf', 700]] },
  { family: '굴림', aliases: ['굴림', 'Gulim'], faces: [['gulim.ttc', 400, 0]] },
  { family: '굴림체', aliases: ['굴림체', 'GulimChe'], faces: [['gulim.ttc', 400, 1]] },
  { family: '돋움', aliases: ['돋움', 'Dotum', '돋음'], faces: [['gulim.ttc', 400, 2]] },
  { family: '돋움체', aliases: ['돋움체', 'DotumChe'], faces: [['gulim.ttc', 400, 3]] },
  { family: '바탕', aliases: ['바탕', 'Batang'], faces: [['batang.ttc', 400, 0]] },
  { family: '바탕체', aliases: ['바탕체', 'BatangChe'], faces: [['batang.ttc', 400, 1]] },
  { family: '궁서', aliases: ['궁서', 'Gungsuh'], faces: [['batang.ttc', 400, 2]] },
  { family: '궁서체', aliases: ['궁서체', 'GungsuhChe'], faces: [['batang.ttc', 400, 3]] },
  { family: 'Calibri', aliases: ['Calibri'], faces: [['Calibri.ttf', 400], ['Calibrib.ttf', 700]] },
  { family: 'Calibri Light', aliases: ['Calibri Light'], faces: [['calibril.ttf', 400]] },
  { family: 'Cambria', aliases: ['Cambria'], faces: [['Cambria.ttc', 400, 0], ['Cambriab.ttf', 700]] }
];

// [글꼴 선택 2026-11-25] 글꼴 고르기 목록. excelName은 내보낸 파일에 적는 이름(그 글꼴 파일을 Mac에 설치했을 때의 글꼴 가족 이름)
const PICK = [
  { label: '맑은 고딕', excelName: '맑은 고딕', kind: 'excel' },
  { label: '굴림', excelName: '굴림', kind: 'excel' },
  { label: '돋움', excelName: '돋움', kind: 'excel' },
  { label: '바탕', excelName: '바탕', kind: 'excel' },
  { label: '궁서', excelName: '궁서', kind: 'excel' },
  { label: '굴림체', excelName: '굴림체', kind: 'excel' },
  { label: '돋움체', excelName: '돋움체', kind: 'excel' },
  { label: '바탕체', excelName: '바탕체', kind: 'excel' },
  { label: 'Calibri', excelName: 'Calibri', kind: 'excel' },
  { label: 'Cambria', excelName: 'Cambria', kind: 'excel' },
  { label: '나눔고딕', excelName: '나눔고딕', kind: 'bundled', family: '나눔고딕' },
  { label: '나눔명조', excelName: '나눔명조', kind: 'bundled', family: '나눔명조' },
  { label: '나눔바른고딕', excelName: '나눔바른고딕OTF', kind: 'bundled', family: '나눔바른고딕' },
  { label: '나눔스퀘어', excelName: '나눔스퀘어OTF', kind: 'bundled', family: '나눔스퀘어' },
  { label: '나눔스퀘어라운드', excelName: '나눔스퀘어라운드OTF', kind: 'bundled', family: '나눔스퀘어라운드' },
  { label: '마루 부리', excelName: '마루 부리OTF', kind: 'bundled', family: '마루 부리' },
  { label: 'Noto Sans KR', excelName: 'Noto Sans KR', kind: 'bundled', family: 'Noto Sans KR' },
  { label: 'Spoqa Han Sans Neo', excelName: 'Spoqa Han Sans Neo', kind: 'bundled', family: 'Spoqa Han Sans Neo' },
  { label: 'Pretendard', excelName: 'Pretendard', kind: 'bundled', family: 'Pretendard' },
  { label: 'IBM Plex Sans KR', excelName: 'IBM Plex Sans KR', kind: 'bundled', family: 'IBM Plex Sans KR' }
];

const normName = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, '');

// 앱에 넣은 글꼴을 사용자 글꼴 폴더(~/Library/Fonts)에 복사한다 — Excel이 인쇄할 때도 그 글꼴을 쓰게 한다
const USER_FONTS = path.join(os.homedir(), 'Library', 'Fonts');
function bundledFilesOf(family) {
  const ent = BUNDLED.find((b) => b.family === family);
  return ent ? [...new Set(ent.faces.map((f) => f[0]))] : [];
}
function isBundledInstalled(family) {
  const files = bundledFilesOf(family);
  return files.length > 0 && files.every((f) => fs.existsSync(path.join(USER_FONTS, f)) || fs.existsSync(path.join('/Library/Fonts', f)));
}
function installBundled(family) {
  const files = bundledFilesOf(family);
  if (!files.length) throw new Error(`앱에 없는 글꼴: ${family}`);
  fs.mkdirSync(USER_FONTS, { recursive: true });
  let copied = 0;
  for (const f of files) {
    const dst = path.join(USER_FONTS, f);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(path.join(APP_FONTS, f), dst);
      copied++;
    }
  }
  return copied;
}

// --- TTC(글꼴 모음) 안의 글꼴 하나를 따로 떼어 TTF로 만든다(브라우저는 .ttc를 @font-face로 못 읽는다) ---
// 원래 cmap(유니코드 3/1 형식 4 또는 3/10 형식 12)에서 글자 → 글리프 표를 읽는다
function readUnicodeMap(cmap) {
  const map = new Map();
  const n = cmap.readUInt16BE(2);
  const recs = [];
  for (let k = 0; k < n; k++) {
    const q = 4 + 8 * k;
    recs.push({ pid: cmap.readUInt16BE(q), eid: cmap.readUInt16BE(q + 2), off: cmap.readUInt32BE(q + 4) });
  }
  const pick = recs.find((r) => r.pid === 3 && r.eid === 10) || recs.find((r) => r.pid === 3 && r.eid === 1) || recs.find((r) => r.pid === 0);
  if (!pick) return map;
  const s = pick.off;
  const fmt = cmap.readUInt16BE(s);
  if (fmt === 12) {
    const groups = cmap.readUInt32BE(s + 12);
    for (let g = 0; g < groups; g++) {
      const q = s + 16 + 12 * g;
      const st = cmap.readUInt32BE(q), en = cmap.readUInt32BE(q + 4), gid = cmap.readUInt32BE(q + 8);
      for (let c = st; c <= en; c++) map.set(c, gid + (c - st));
    }
  } else if (fmt === 4) {
    const segX2 = cmap.readUInt16BE(s + 6);
    const ends = s + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
    for (let k = 0; k < segX2 / 2; k++) {
      const en = cmap.readUInt16BE(ends + 2 * k), st = cmap.readUInt16BE(starts + 2 * k);
      const d = cmap.readInt16BE(deltas + 2 * k), ro = cmap.readUInt16BE(ros + 2 * k);
      for (let c = st; c <= en && c !== 0xffff; c++) {
        let g;
        if (ro === 0) g = (c + d) & 0xffff;
        else {
          const ga = ros + 2 * k + ro + 2 * (c - st);
          if (ga + 2 > cmap.length) continue;
          g = cmap.readUInt16BE(ga);
          if (g) g = (g + d) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  }
  return map;
}

// 깨끗한 cmap(3/10 형식 12 하나)을 새로 만든다
function buildCmap12(map, numGlyphs) {
  const codes = [...map.keys()].filter((c) => map.get(c) < numGlyphs).sort((a, b) => a - b);
  const groups = [];
  for (const c of codes) {
    const g = map.get(c);
    const last = groups[groups.length - 1];
    if (last && c === last.en + 1 && g === last.gid + (c - last.st)) last.en = c;
    else groups.push({ st: c, en: c, gid: g });
  }
  const sub = Buffer.alloc(16 + 12 * groups.length);
  sub.writeUInt16BE(12, 0);
  sub.writeUInt32BE(sub.length, 4);
  sub.writeUInt32BE(groups.length, 12);
  groups.forEach((g, i) => {
    sub.writeUInt32BE(g.st, 16 + 12 * i);
    sub.writeUInt32BE(g.en, 20 + 12 * i);
    sub.writeUInt32BE(g.gid, 24 + 12 * i);
  });
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 2); // 서브테이블 1개
  head.writeUInt16BE(3, 4);
  head.writeUInt16BE(10, 6);
  head.writeUInt32BE(12, 8);
  return Buffer.concat([head, sub]);
}

// [2026-11-25] 크롬 글꼴 검사기(OTS)는 Excel의 굴림체·돋움·바탕체 등에서 cmap을 거부했다.
// 그래서 떼어 낸 글꼴은 cmap을 같은 글자 표로 새로 만들어 넣는다(글자 모양·글리프는 그대로).
function extractFromCollection(buf, index) {
  if (buf.toString('latin1', 0, 4) !== 'ttcf') return buf;
  const numFonts = buf.readUInt32BE(8);
  if (index >= numFonts) throw new Error(`ttc index ${index} >= ${numFonts}`);
  const off = buf.readUInt32BE(12 + 4 * index);
  const numTables = buf.readUInt16BE(off + 4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const p = off + 12 + 16 * i;
    tables.push({ tag: buf.slice(p, p + 4), checksum: buf.readUInt32BE(p + 4), offset: buf.readUInt32BE(p + 8), length: buf.readUInt32BE(p + 12) });
  }
  const maxp = tables.find((t) => t.tag.toString('latin1') === 'maxp');
  const numGlyphs = maxp ? buf.readUInt16BE(maxp.offset + 4) : 65535;
  for (const t of tables) {
    t.data = buf.slice(t.offset, t.offset + t.length);
    if (t.tag.toString('latin1') === 'cmap') {
      t.data = buildCmap12(readUnicodeMap(t.data), numGlyphs);
      t.length = t.data.length;
      t.checksum = 0;
    }
  }
  const headerLen = 12 + 16 * numTables;
  let cursor = headerLen;
  const placed = tables.map((t) => {
    const at = cursor;
    cursor += (t.length + 3) & ~3;
    return { ...t, newOffset: at };
  });
  const out = Buffer.alloc(cursor);
  buf.copy(out, 0, off, off + 12); // sfnt 버전·표 수·검색 정보
  placed.forEach((t, i) => {
    const p = 12 + 16 * i;
    t.tag.copy(out, p);
    out.writeUInt32BE(t.checksum, p + 4);
    out.writeUInt32BE(t.newOffset, p + 8);
    out.writeUInt32BE(t.length, p + 12);
    t.data.copy(out, t.newOffset);
  });
  return out;
}

function cachedCollectionFace(file, index, cacheDir) {
  const st = fs.statSync(file);
  const key = crypto.createHash('md5').update(`v2:${file}:${st.mtimeMs}:${st.size}:${index}`).digest('hex').slice(0, 12);
  const out = path.join(cacheDir, `${path.basename(file, path.extname(file))}-${index}-${key}.ttf`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(out, extractFromCollection(fs.readFileSync(file), index));
  }
  return out;
}

const fileUrl = (p) => `file://${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;

let cached = null;
/**
 * 미리보기에 쓸 글꼴 목록. 없는 파일(Excel 미설치 등)은 빼고 돌려준다.
 * @param {string} cacheDir ttc에서 떼어 낸 글꼴을 둘 곳
 * @returns {{faces: {family:string, url:string, weight:(number|string)}[], aliases: Object<string,{family:string, weight?:number}>, available: {bundled:string[], excel:string[]}}}
 */
function getPreviewFonts(cacheDir = path.join(os.tmpdir(), 'template-photo-excel-editor-fonts')) {
  if (cached) return cached;
  const faces = [];
  const aliases = {};
  const available = { bundled: [], excel: [] };
  for (const [list, dir, kind] of [[BUNDLED, APP_FONTS, 'bundled'], [FROM_EXCEL, EXCEL_FONTS, 'excel']]) {
    for (const ent of list) {
      const got = [];
      for (const [file, weight, ttcIndex] of ent.faces) {
        const full = path.join(dir, file);
        if (!fs.existsSync(full)) continue;
        try {
          const real = ttcIndex === undefined ? full : cachedCollectionFace(full, ttcIndex, cacheDir);
          got.push({ family: ent.family, url: fileUrl(real), weight });
        } catch (_) {
          // 읽지 못한 글꼴은 건너뛴다(미리보기는 대체 글꼴)
        }
      }
      if (!got.length) continue;
      faces.push(...got);
      for (const a of ent.aliases) aliases[normName(a)] = { family: ent.family, ...(ent.weight ? { weight: ent.weight } : {}) };
      available[kind].push(ent.family);
    }
  }
  const excelOk = new Set(available.excel);
  const pickList = PICK.filter((p) => (p.kind === 'excel' ? excelOk.has(p.label) : available.bundled.includes(p.family))).map((p) => ({
    ...p,
    installed: p.kind === 'excel' ? true : isBundledInstalled(p.family)
  }));
  cached = { faces, aliases, available, pickList };
  return cached;
}

function isPreviewFont(name) {
  const { aliases } = getPreviewFonts();
  return !!aliases[normName(name)];
}

function resetCache() {
  cached = null;
}

module.exports = { getPreviewFonts, isPreviewFont, normName, extractFromCollection, installBundled, isBundledInstalled, resetCache, BUNDLED, FROM_EXCEL, PICK };
