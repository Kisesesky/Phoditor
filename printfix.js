// [인쇄 비교 수정 2026-11-25] ExcelJS가 저장하면서 바꾸거나 버리는 인쇄 설정을 빈 양식 값으로 되돌린다.
// - 기본 글꼴(styles.xml 첫 글꼴): ExcelJS가 Calibri 11로 덮어씀 → 열 너비 계산 기준이 바뀌어 인쇄 폭이 달라짐
// - pageSetup 속성: firstPageNumber/useFirstPageNumber 등이 바뀜 → 쪽 번호가 시트마다 1부터 다시 시작
// - headerFooter 속성: alignWithMargins 등을 버림 → 머리말·바닥글 가로 위치가 바뀜
// - 표지·목차의 rowBreaks/colBreaks: ExcelJS가 읽지 않아 사라짐
// - 도형(글상자·선·네모): ExcelJS가 저장하지 않음 → restoreShapes
const JSZip = require('jszip');

function sheetPaths(files) {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]);
    const tg = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && tg) {
      let t = tg[1];
      t = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
      relMap[id[1]] = t.replace(/\/\.\//g, '/');
    }
  }
  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0]);
    const rid = /\br:id="([^"]+)"/.exec(m[0]);
    if (name && rid && relMap[rid[1]]) out[unescapeXml(name[1])] = relMap[rid[1]];
  }
  return out;
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function firstFont(stylesXml) {
  const fonts = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml);
  if (!fonts) return null;
  const f = /<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/.exec(fonts[1]);
  return f ? { text: f[0], index: fonts.index + fonts[0].indexOf(fonts[1]) + f.index } : null;
}

function selfTag(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`);
  return re.exec(xml);
}

function openTag(xml, tag) {
  return new RegExp(`<${tag}\\b[^>]*?/?>`).exec(xml);
}

function attrsOf(tagText) {
  const out = [];
  for (const m of tagText.matchAll(/\s([\w:]+)="([^"]*)"/g)) out.push([m[1], m[2]]);
  return out;
}

function withAttrs(tagText, tag, attrs) {
  const selfClosing = /\/>$/.test(tagText);
  const a = attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${tag}${a}${selfClosing ? '/>' : '>'}`;
}

// CT_Worksheet 순서에서 rowBreaks 앞에 올 수 있는 요소들
const BEFORE_BREAKS = ['headerFooter', 'pageSetup', 'pageMargins', 'printOptions'];

function insertBreaks(xml, breaksXml) {
  for (const tag of BEFORE_BREAKS) {
    const m = selfTag(xml, tag);
    if (m) return xml.slice(0, m.index + m[0].length) + breaksXml + xml.slice(m.index + m[0].length);
  }
  return xml.replace('</sheetData>', `</sheetData>${breaksXml}`);
}

// ---- [PDF 비교 수정 2026-11-25] 도형(글상자·선·네모) 되살리기 ----
// ExcelJS는 사진만 저장하고 도형은 버린다. 빈 양식의 도형 중
//  - 표지·목차: 전부
//  - 블록 시트: 블록 위쪽(머리 행)에 있는 것만 (블록 안 도형은 사진마다 붙인 화살표·설명이라 넣지 않는다)
// 을 출력 파일에 다시 넣는다. 다른 파일을 참조하는(r:embed 등) 도형은 넣지 않는다.
const ANCHOR_RE = /<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g;
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';
// CT_Worksheet에서 drawing 뒤에 와야 하는 요소들
const AFTER_DRAWING = ['legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];

function relsPathOf(partPath) {
  const i = partPath.lastIndexOf('/');
  return `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
}

function resolveTarget(fromPart, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromPart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function drawingRelOf(relsXml) {
  if (!relsXml) return null;
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const type = /\bType="([^"]+)"/.exec(m[0]);
    if (type && type[1] === REL_DRAWING) {
      return { id: /\bId="([^"]+)"/.exec(m[0])[1], target: /\bTarget="([^"]+)"/.exec(m[0])[1] };
    }
  }
  return null;
}

function shapeAnchorsToKeep(drawingXml, info) {
  const out = [];
  for (const m of drawingXml.matchAll(ANCHOR_RE)) {
    const a = m[0];
    if (/<xdr:pic[\s>]/.test(a)) continue; // 사진(그룹 안 사진 포함)은 앱이 따로 넣는다
    if (/\br:(?:embed|link|id)="/.test(a)) continue; // 다른 파일을 참조하는 도형은 옮기지 않는다
    if (info.role === 'block') {
      const row = /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/.exec(a);
      if (!row || !info.startRow || Number(row[1]) + 1 >= info.startRow) continue;
    }
    out.push(a);
  }
  return out;
}

function mergeNamespaces(targetRootTag, sourceRootTag) {
  let tag = targetRootTag;
  for (const m of sourceRootTag.matchAll(/\s(xmlns:[\w.-]+)="([^"]*)"/g)) {
    if (!new RegExp(`\\s${m[1]}="`).test(tag)) tag = tag.replace(/\s*(\/?)>$/, ` ${m[1]}="${m[2]}"$1>`);
  }
  return tag;
}

async function restoreShapes(zip, blank, oPath, bPath, info, state) {
  const bRels = blank.file(relsPathOf(bPath)) ? await blank.file(relsPathOf(bPath)).async('string') : null;
  const bRel = drawingRelOf(bRels);
  if (!bRel) return 0;
  const bDrawPath = resolveTarget(bPath, bRel.target);
  if (!blank.file(bDrawPath)) return 0;
  const bDraw = await blank.file(bDrawPath).async('string');
  const anchors = shapeAnchorsToKeep(bDraw, info);
  if (!anchors.length) return 0;
  const bRoot = /<xdr:wsDr\b[^>]*>/.exec(bDraw)[0];

  const oRelsPath = relsPathOf(oPath);
  let oRels = zip.file(oRelsPath) ? await zip.file(oRelsPath).async('string') : null;
  const oRel = drawingRelOf(oRels);

  // 도형 번호(cNvPr id)는 한 그림판 안에서 겹치면 안 된다
  const renumber = (xml, start) => {
    let id = start;
    return anchors.map((a) => a.replace(/(<xdr:cNvPr\b[^>]*\bid=")(\d+)(")/g, (_m, p1, _p2, p3) => `${p1}${++id}${p3}`));
  };

  if (oRel) {
    const oDrawPath = resolveTarget(oPath, oRel.target);
    let oDraw = await zip.file(oDrawPath).async('string');
    const maxId = Math.max(0, ...[...oDraw.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])));
    const oRoot = /<xdr:wsDr\b[^>]*>/.exec(oDraw)[0];
    oDraw = oDraw.replace(oRoot, mergeNamespaces(oRoot, bRoot));
    oDraw = oDraw.replace(/<\/xdr:wsDr>\s*$/, `${renumber(oDraw, maxId).join('')}</xdr:wsDr>`);
    zip.file(oDrawPath, oDraw);
    return anchors.length;
  }

  // 출력 시트에 그림판이 없으면 새로 만든다
  let n = 1;
  while (zip.file(`xl/drawings/drawing${n}.xml`) || state.newDrawings.has(n)) n++;
  state.newDrawings.add(n);
  const drawPath = `xl/drawings/drawing${n}.xml`;
  zip.file(drawPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${bRoot}${renumber('', 1).join('')}</xdr:wsDr>`);

  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes(`PartName="/${drawPath}"`)) {
    ct = ct.replace('</Types>', `<Override PartName="/${drawPath}" ContentType="${CT_DRAWING}"/></Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  if (!oRels) oRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const used = new Set([...oRels.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
  let k = 1;
  while (used.has(`rIdShape${k}`)) k++;
  const rid = `rIdShape${k}`;
  oRels = oRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_DRAWING}" Target="../drawings/drawing${n}.xml"/></Relationships>`);
  zip.file(oRelsPath, oRels);

  let xml = await zip.file(oPath).async('string');
  const root = /<worksheet\b[^>]*>/.exec(xml)[0];
  if (!/\sxmlns:r="/.test(root)) {
    xml = xml.replace(root, root.replace(/>$/, ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'));
  }
  const tagXml = `<drawing r:id="${rid}"/>`;
  let at = -1;
  for (const t of AFTER_DRAWING) {
    const m = new RegExp(`<${t}\\b`).exec(xml);
    if (m && (at < 0 || m.index < at)) at = m.index;
  }
  if (at < 0) at = xml.lastIndexOf('</worksheet>');
  xml = xml.slice(0, at) + tagXml + xml.slice(at);
  zip.file(oPath, xml);
  return anchors.length;
}

/**
 * @param {JSZip} zip 내보낸 파일(수정됨)
 * @param {Buffer} blankBuf 빈 양식 원본 버퍼
 * @param {(name:string)=>{source:string, role:string, startRow?:number}|null} sheetInfo 출력 시트 이름 → 빈 양식 시트 이름·역할·블록 시작 행
 */
async function restorePrintSettings(zip, blankBuf, sheetInfo) {
  const blank = await JSZip.loadAsync(blankBuf);
  const read = async (z, p) => (z.file(p) ? z.file(p).async('string') : null);
  const bFiles = { 'xl/workbook.xml': await read(blank, 'xl/workbook.xml'), 'xl/_rels/workbook.xml.rels': await read(blank, 'xl/_rels/workbook.xml.rels') };
  const oFiles = { 'xl/workbook.xml': await read(zip, 'xl/workbook.xml'), 'xl/_rels/workbook.xml.rels': await read(zip, 'xl/_rels/workbook.xml.rels') };
  const bSheets = sheetPaths(bFiles);
  const oSheets = sheetPaths(oFiles);
  const report = { font: false, sheets: 0, shapes: 0 };
  const shapeState = { newDrawings: new Set() };

  // 1. 기본 글꼴
  const bStyles = await read(blank, 'xl/styles.xml');
  const oStyles = await read(zip, 'xl/styles.xml');
  if (bStyles && oStyles) {
    const bf = firstFont(bStyles);
    const of = firstFont(oStyles);
    if (bf && of && bf.text !== of.text) {
      zip.file('xl/styles.xml', oStyles.slice(0, of.index) + bf.text + oStyles.slice(of.index + of.text.length));
      report.font = true;
    }
  }

  // 2~4. 시트별 인쇄 설정
  for (const [name, oPath] of Object.entries(oSheets)) {
    const info = sheetInfo(name);
    if (!info || !bSheets[info.source]) continue;
    const bXml = await read(blank, bSheets[info.source]);
    let xml = await read(zip, oPath);
    if (!bXml || !xml) continue;

    // pageSetup: 빈 양식 속성 그대로 (프린터 설정 r:id는 출력 쪽 것을 유지)
    const bPs = openTag(bXml, 'pageSetup');
    const oPs = openTag(xml, 'pageSetup');
    if (bPs) {
      const keepRid = oPs ? attrsOf(oPs[0]).filter(([k]) => k === 'r:id') : [];
      const attrs = attrsOf(bPs[0]).filter(([k]) => k !== 'r:id').concat(keepRid);
      if (oPs) {
        xml = xml.slice(0, oPs.index) + withAttrs(oPs[0], 'pageSetup', attrs) + xml.slice(oPs.index + oPs[0].length);
      }
    }
    // headerFooter 속성(글자는 출력 쪽 것을 유지)
    const bHf = openTag(bXml, 'headerFooter');
    const oHf = openTag(xml, 'headerFooter');
    if (bHf && oHf) {
      xml = xml.slice(0, oHf.index) + withAttrs(oHf[0], 'headerFooter', attrsOf(bHf[0])) + xml.slice(oHf.index + oHf[0].length);
    } else if (bHf && !oHf) {
      // 글자 없는 머리말은 ExcelJS가 요소째 버린다 → 빈 양식 요소를 그대로 넣는다 (pageSetup 바로 뒤)
      const whole = selfTag(bXml, 'headerFooter');
      const anchor = selfTag(xml, 'pageSetup') || selfTag(xml, 'pageMargins') || selfTag(xml, 'printOptions');
      if (whole && anchor) xml = xml.slice(0, anchor.index + anchor[0].length) + whole[0] + xml.slice(anchor.index + anchor[0].length);
    }
    // 표지·목차 쪽 나누기 (블록 시트는 앱이 다시 계산한다)
    if (info.role !== 'block') {
      for (const tag of ['colBreaks', 'rowBreaks']) {
        const b = selfTag(bXml, tag);
        if (b && !selfTag(xml, tag)) {
          if (tag === 'colBreaks' && selfTag(xml, 'rowBreaks')) {
            const r = selfTag(xml, 'rowBreaks');
            xml = xml.slice(0, r.index + r[0].length) + b[0] + xml.slice(r.index + r[0].length);
          } else {
            xml = insertBreaks(xml, b[0]);
          }
        }
      }
    } else {
      const b = selfTag(bXml, 'colBreaks');
      if (b && !selfTag(xml, 'colBreaks')) {
        const r = selfTag(xml, 'rowBreaks');
        xml = r ? xml.slice(0, r.index + r[0].length) + b[0] + xml.slice(r.index + r[0].length) : insertBreaks(xml, b[0]);
      }
    }
    zip.file(oPath, xml);
    report.sheets++;
    report.shapes += await restoreShapes(zip, blank, oPath, bSheets[info.source], info, shapeState);
  }
  return report;
}

module.exports = { restorePrintSettings, sheetPaths, relsPathOf, resolveTarget, drawingRelOf };
