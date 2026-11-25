// [쪽 보기 2026-11-25] 미리보기를 "인쇄되는 쪽"처럼 그리기 위한 시트 모델.
// - 칸: 글꼴·크기·굵게·기울임·밑줄·색·채우기·정렬·줄바꿈·테두리(선 모양·색)
// - 열 너비(문자 단위 그대로: 화면에서 실제 글꼴로 MDW를 재서 픽셀로 바꾼다)·행 높이(pt)·숨긴 행/열
// - 인쇄 설정: 용지·방향·여백·배율/맞춤·인쇄 영역·반복 행·가운데 맞춤·머리말/바닥글
// - 그림·도형: 빈 양식 drawing XML에서 위치(앵커)·그림 데이터·도형 채우기/선/글자
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { sheetPaths, relsPathOf, resolveTarget, drawingRelOf } = require('./printfix');

const unescapeXml = (s) =>
  String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// 테마 색(ExcelJS는 theme 번호만 준다) — Office 기본 테마
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
function applyTint(hex, tint) {
  if (!tint) return hex;
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((v) => Math.round(tint < 0 ? v * (1 + tint) : v + (255 - v) * tint));
  return out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}
function colorToCss(c) {
  if (!c) return null;
  if (c.argb) {
    const hex = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
    if (c.argb.length === 8 && c.argb.slice(0, 2) === '00' && hex === '000000') return '#000000';
    return `#${hex}`;
  }
  if (typeof c.theme === 'number' && THEME[c.theme]) return `#${applyTint(THEME[c.theme], c.tint || 0)}`;
  if (typeof c.indexed === 'number') {
    if (c.indexed === 64 || c.indexed === 65) return null; // 시스템 전경·배경색(자동)
    const pal = currentPalette || DEFAULT_PALETTE;
    return pal[c.indexed] ? `#${pal[c.indexed]}` : null;
  }
  return null;
}

// Excel 기본 색 번호표(indexed 0~63). 파일에 <indexedColors>가 있으면 그 표를 쓴다.
const DEFAULT_PALETTE = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'
];
let currentPalette = null;
async function usePaletteOf(blankBuf) {
  currentPalette = null;
  try {
    const zip = await JSZip.loadAsync(blankBuf);
    const st = await zip.file('xl/styles.xml').async('string');
    const m = /<indexedColors>([\s\S]*?)<\/indexedColors>/.exec(st);
    if (m) {
      const list = [...m[1].matchAll(/rgb="([0-9A-Fa-f]{8})"/g)].map((x) => x[1].slice(2).toUpperCase());
      if (list.length) currentPalette = list;
    }
  } catch (_) {}
}

const BORDER_CSS = {
  thin: ['1px', 'solid'], hair: ['1px', 'solid'], dotted: ['1px', 'dotted'], dashed: ['1px', 'dashed'],
  dashDot: ['1px', 'dashed'], dashDotDot: ['1px', 'dashed'], medium: ['2px', 'solid'], mediumDashed: ['2px', 'dashed'],
  mediumDashDot: ['2px', 'dashed'], mediumDashDotDot: ['2px', 'dashed'], slantDashDot: ['2px', 'dashed'],
  thick: ['3px', 'solid'], double: ['3px', 'double']
};
function borderToCss(b) {
  if (!b || !b.style) return null;
  const [w, st] = BORDER_CSS[b.style] || ['1px', 'solid'];
  return `${w} ${st} ${colorToCss(b.color) || '#000'}`;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((rt) => rt.text).join('');
    if (v.result !== undefined && v.result !== null) return String(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.formula || v.sharedFormula) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

function extractCells(ws) {
  const cells = {};
  const usedFonts = new Set();
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const st = cell.style || {};
      const font = st.font || {};
      const al = st.alignment || {};
      const bd = st.border || {};
      const covered = cell.isMerged && cell.master && cell.master.address !== cell.address;
      if (font.name && !covered) usedFonts.add(font.name);
      const fill = st.fill && st.fill.type === 'pattern' && st.fill.pattern && st.fill.pattern !== 'none' ? colorToCss(st.fill.fgColor) : null;
      const entry = {
        addr: cell.address, r, c, covered: covered || undefined,
        bT: borderToCss(bd.top), bR: borderToCss(bd.right), bB: borderToCss(bd.bottom), bL: borderToCss(bd.left)
      };
      if (!covered) {
        Object.assign(entry, {
          value: cellText(cell.value),
          formula: cell.type === ExcelJS.ValueType.Formula ? cell.formula : null,
          fill,
          fontName: font.name || null,
          fontSize: font.size || 11,
          fontBold: !!font.bold,
          fontItalic: !!font.italic,
          fontUnderline: !!font.underline,
          fontColor: colorToCss(font.color),
          alignH: al.horizontal || null,
          alignV: al.vertical || 'bottom',
          wrap: !!al.wrapText,
          shrink: !!al.shrinkToFit,
          indent: al.indent || 0,
          numFmt: st.numFmt || null
        });
      }
      for (const k of Object.keys(entry)) if (entry[k] === null || entry[k] === undefined || entry[k] === false) delete entry[k];
      if (entry.fontBold === undefined) entry.fontBold = false;
      cells[`${r},${c}`] = entry;
    });
  });
  return { cells, usedFonts };
}

function parseRange(ref) {
  const m = /\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?/.exec(String(ref || '').split('!').pop());
  if (!m) return null;
  const cn = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: cn(m[1]), r1: +m[2], c2: cn(m[3] || m[1]), r2: +(m[4] || m[2]) };
}

function extractPageSetup(ws) {
  const p = ws.pageSetup || {};
  const m = p.margins || {};
  const titles = p.printTitlesRow ? /(\d+):\$?(\d+)/.exec(String(p.printTitlesRow).replace(/\$/g, '')) : null;
  const hf = ws.headerFooter || {};
  return {
    paperSize: p.paperSize || 9,
    orientation: p.orientation || 'portrait',
    scale: p.scale || 100,
    fitToPage: !!p.fitToPage,
    fitToWidth: p.fitToWidth === undefined ? 1 : p.fitToWidth,
    fitToHeight: p.fitToHeight === undefined ? 1 : p.fitToHeight,
    margins: {
      left: m.left ?? 0.7, right: m.right ?? 0.7, top: m.top ?? 0.75, bottom: m.bottom ?? 0.75,
      header: m.header ?? 0.3, footer: m.footer ?? 0.3
    },
    printArea: p.printArea ? parseRange(String(p.printArea).split(',')[0]) : null,
    titleRows: titles ? [+titles[1], +titles[2]] : null,
    hCenter: !!p.horizontalCentered,
    vCenter: !!p.verticalCentered,
    header: hf.oddHeader || null,
    footer: hf.oddFooter || null,
    rowBreaks: (ws.rowBreaks || []).map((b) => b.id).filter((n) => n > 0),
    showGridLines: !(ws.views && ws.views[0] && ws.views[0].showGridLines === false)
  };
}

// --- 그림·도형 (빈 양식 drawing XML) ---
const EMU_PER_PX = 9525;
function anchorPos(xml, tag) {
  const m = new RegExp(`<xdr:${tag}>([\\s\\S]*?)</xdr:${tag}>`).exec(xml);
  if (!m) return null;
  const g = (t) => +((new RegExp(`<xdr:${t}>(-?\\d+)</xdr:${t}>`).exec(m[1]) || [])[1] || 0);
  return { col: g('col'), colOff: g('colOff') / EMU_PER_PX, row: g('row'), rowOff: g('rowOff') / EMU_PER_PX };
}
function srgb(x) {
  if (!x) return null;
  const m = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(x);
  if (m) return `#${m[1]}`;
  const s = /<a:schemeClr val="(\w+)"/.exec(x);
  if (s) return { dk1: '#000000', lt1: '#FFFFFF', tx1: '#000000', bg1: '#FFFFFF', dk2: '#44546A', lt2: '#E7E6E6', accent1: '#4472C4' }[s[1]] || null;
  return null;
}
function shapeText(sp) {
  const body = /<xdr:txBody>([\s\S]*?)<\/xdr:txBody>/.exec(sp);
  if (!body) return null;
  const paras = [];
  for (const pm of body[1].matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\/>/g)) {
    const p = pm[1] || '';
    const algn = (/<a:pPr[^>]*\balgn="(\w+)"/.exec(p) || [])[1] || 'l';
    const runs = [];
    for (const rm of p.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      const rPr = (/<a:rPr\b([^>]*)\/?>([\s\S]*?)(?:<\/a:rPr>|$)/.exec(rm[1]) || ['', '', '']);
      const attrs = rPr[1] || '';
      const t = (/<a:t>([\s\S]*?)<\/a:t>/.exec(rm[1]) || [])[1] || '';
      runs.push({
        text: unescapeXml(t),
        size: /\bsz="(\d+)"/.test(attrs) ? +/\bsz="(\d+)"/.exec(attrs)[1] / 100 : null,
        bold: /\bb="1"/.test(attrs),
        color: srgb(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(rm[1] || '')?.[1]),
        font: (/<a:ea typeface="([^"]+)"/.exec(rm[1]) || /<a:latin typeface="([^"]+)"/.exec(rm[1]) || [])[1] || null
      });
    }
    paras.push({ algn, runs });
  }
  const anchor = (/<a:bodyPr\b[^>]*\banchor="(\w+)"/.exec(body[1]) || [])[1] || 't';
  return { paras, anchor };
}

async function extractDrawings(blankBuf) {
  const zip = await JSZip.loadAsync(blankBuf);
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);
  const files = { 'xl/workbook.xml': await read('xl/workbook.xml'), 'xl/_rels/workbook.xml.rels': await read('xl/_rels/workbook.xml.rels') };
  const sheets = sheetPaths(files);
  const out = {};
  for (const [name, sPath] of Object.entries(sheets)) {
    const rel = drawingRelOf(await read(relsPathOf(sPath)));
    if (!rel) continue;
    const dPath = resolveTarget(sPath, rel.target);
    const dXml = await read(dPath);
    if (!dXml) continue;
    const dRels = (await read(relsPathOf(dPath))) || '';
    const relTarget = {};
    for (const m of dRels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0]);
      const tg = /\bTarget="([^"]+)"/.exec(m[0]);
      if (id && tg) relTarget[id[1]] = resolveTarget(dPath, tg[1]);
    }
    const items = [];
    for (const am of dXml.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/xdr:\1>/g)) {
      const body = am[2];
      const from = anchorPos(body, 'from');
      const to = anchorPos(body, 'to');
      const extM = /<xdr:ext cx="(\d+)" cy="(\d+)"/.exec(body);
      const ext = extM ? { w: +extM[1] / EMU_PER_PX, h: +extM[2] / EMU_PER_PX } : null;
      if (!from) continue;
      if (/<xdr:cNvPr\b[^>]*\bhidden="(1|true)"/.test(body)) continue; // 숨긴 그림·도형
      const xf = /<a:xfrm\b[^>]*>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/.exec(body);
      const isLine = /<xdr:cxnSp\b/.test(body) || /prst="(line|straightConnector\d*)"/.test(body);
      if (xf && !isLine && (+xf[1] === 0 || +xf[2] === 0)) continue; // 폭·높이 0 도형은 인쇄되지 않음
      if (/<xdr:pic\b/.test(body)) {
        const emb = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(body);
        const media = emb && relTarget[emb[1]];
        if (!media || !zip.file(media)) continue;
        const ext2 = media.split('.').pop().toLowerCase();
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', emf: null, wmf: null }[ext2];
        if (!mime) continue;
        const b64 = await zip.file(media).async('base64');
        items.push({ kind: 'pic', from, to, ext, src: `data:${mime};base64,${b64}` });
      } else if (/<xdr:sp\b|<xdr:cxnSp\b/.test(body)) {
        const spPr = (/<xdr:spPr>([\s\S]*?)<\/xdr:spPr>/.exec(body) || [])[1] || '';
        const geom = (/<a:prstGeom prst="(\w+)"/.exec(spPr) || [])[1] || 'rect';
        const noFill = /<a:noFill\/>/.test(spPr.split('<a:ln')[0]);
        const fill = noFill ? null : srgb((/<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(spPr.split('<a:ln')[0]) || [])[1]);
        const lnM = /<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>|<a:ln\b([^>]*)\/>/.exec(spPr);
        let line = null;
        if (lnM && !/<a:noFill\/>/.test(lnM[2] || '')) {
          const w = /\bw="(\d+)"/.exec(lnM[1] || lnM[3] || '');
          line = { color: srgb(lnM[2]) || '#000000', width: w ? Math.max(1, +w[1] / EMU_PER_PX) : 1 };
        }
        // 스타일 참조만 있는 선(cxnSp)
        if (!lnM && /<xdr:cxnSp\b/.test(body)) line = { color: '#000000', width: 1 };
        const flipV = /<a:xfrm\b[^>]*flipV="1"/.test(spPr);
        const flipH = /<a:xfrm\b[^>]*flipH="1"/.test(spPr);
        items.push({ kind: /<xdr:cxnSp\b/.test(body) || geom === 'line' || geom.startsWith('straightConnector') ? 'line' : 'shape', geom, from, to, ext, fill, line, flipV, flipH, text: shapeText(body) });
      }
    }
    if (items.length) out[name] = items;
  }
  return out;
}

function extractSheetModel(ws) {
  const rowCount = Math.max(ws.rowCount || 1, 1);
  const colCount = Math.max(ws.columnCount || 1, 1);
  const props = ws.properties || {};
  const defaultColWidth = props.defaultColWidth || 8.43;
  const defaultRowHeight = props.defaultRowHeight || 15;
  const colWidthsCh = [];
  const hiddenCols = [];
  for (let c = 1; c <= colCount; c++) {
    const col = ws.getColumn(c);
    colWidthsCh.push(typeof col.width === 'number' && col.width > 0 ? col.width : defaultColWidth);
    if (col.hidden) hiddenCols.push(c);
  }
  const rowHeightsPt = [];
  const hiddenRows = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    rowHeightsPt.push(typeof row.height === 'number' && row.height > 0 ? row.height : defaultRowHeight);
    if (row.hidden) hiddenRows.push(r);
  }
  const { cells, usedFonts } = extractCells(ws);
  return {
    rowCount, colCount, colWidthsCh, rowHeightsPt, hiddenRows, hiddenCols, defaultColWidth, defaultRowHeight,
    merges: ws.model && ws.model.merges ? [...ws.model.merges] : [],
    cells,
    usedFonts: [...usedFonts],
    page: extractPageSetup(ws)
  };
}

// 기본 글꼴(열 너비 단위 기준): styles.xml 첫 글꼴
async function defaultFontOf(blankBuf) {
  try {
    const zip = await JSZip.loadAsync(blankBuf);
    const st = await zip.file('xl/styles.xml').async('string');
    const f = /<fonts\b[^>]*>\s*<font>([\s\S]*?)<\/font>/.exec(st);
    const name = f && /<name val="([^"]+)"/.exec(f[1]);
    const sz = f && /<sz val="([\d.]+)"/.exec(f[1]);
    return { name: name ? unescapeXml(name[1]) : 'Calibri', size: sz ? +sz[1] : 11 };
  } catch (_) {
    return { name: 'Calibri', size: 11 };
  }
}

// 쪽 번호 시작(useFirstPageNumber·firstPageNumber)은 ExcelJS가 주지 않아 XML에서 읽는다
async function extractPageNumbering(blankBuf) {
  const zip = await JSZip.loadAsync(blankBuf);
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);
  const sheets = sheetPaths({ 'xl/workbook.xml': await read('xl/workbook.xml'), 'xl/_rels/workbook.xml.rels': await read('xl/_rels/workbook.xml.rels') });
  const out = {};
  for (const [name, p] of Object.entries(sheets)) {
    const x = await read(p);
    const ps = x && /<pageSetup\b[^>]*>/.exec(x);
    if (!ps) {
      const rb0 = x && /<rowBreaks\b[^>]*>([\s\S]*?)<\/rowBreaks>/.exec(x);
      out[name] = { useFirst: false, first: 1, rowBreaks: rb0 ? [...rb0[1].matchAll(/<brk\b[^>]*\bid="(\d+)"/g)].map((m) => +m[1]) : [] };
      continue;
    }
    const use = /\buseFirstPageNumber="(1|true)"/.test(ps[0]);
    const first = /\bfirstPageNumber="(-?\d+)"/.exec(ps[0]);
    // 수동 쪽 나누기(<rowBreaks><brk id="N"/>: N행 뒤에서 나눔) — ExcelJS가 읽지 않는다
    const rb = /<rowBreaks\b[^>]*>([\s\S]*?)<\/rowBreaks>/.exec(x);
    const rowBreaks = rb ? [...rb[1].matchAll(/<brk\b[^>]*\bid="(\d+)"/g)].map((m) => +m[1]) : [];
    out[name] = { useFirst: use, first: first ? +first[1] : 1, rowBreaks };
  }
  return out;
}

module.exports = { extractSheetModel, extractDrawings, extractPageNumbering, defaultFontOf, usePaletteOf, parseRange, colorToCss };
