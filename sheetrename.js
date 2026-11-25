// [시트 이름 바꾸기 2026-11-25] 내보낸 파일 안에서 시트 이름을 바꾼다.
// 앱은 원래 시트 이름을 열쇠로 써서 파일을 만들고, 마지막에 여기서 사용자가 바꾼 이름으로 바꾼다.
// 바꾸는 곳: 시트 목록(workbook.xml), 인쇄 영역 등 정의된 이름, 다른 시트를 가리키는 수식·하이퍼링크, 문서 속성(app.xml).
const unescapeXml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

// 수식 안 시트 참조: 'a b'!A1 (작은따옴표 안의 ' 는 '' 로 씀) 또는 Sheet1!A1
const QUOTED_REF = /'((?:[^']|'')+)'!/g;
const QUOTED_REF_APOS = /&apos;((?:(?!&apos;).|&apos;&apos;)+)&apos;!/g;
const BARE_REF = /(^|[^\w.'\]!&;])([A-Za-z_\u0080-￿][\w.\u0080-￿]*)!/g;

function renameRefs(text, map) {
  const quote = (name) => `'${escapeText(name).replace(/'/g, "''")}'!`;
  return text
    .replace(QUOTED_REF, (m, inner) => {
      const name = unescapeXml(inner.replace(/''/g, "'"));
      return map.has(name) ? quote(map.get(name)) : m;
    })
    .replace(QUOTED_REF_APOS, (m, inner) => {
      const name = unescapeXml(inner.replace(/&apos;&apos;/g, "'"));
      return map.has(name) ? quote(map.get(name)) : m;
    })
    .replace(BARE_REF, (m, pre, name) => {
      const real = unescapeXml(name);
      return map.has(real) ? pre + quote(map.get(real)) : m;
    });
}

/**
 * @param {import('jszip')} zip
 * @param {Map<string,string>} map 원래 이름 → 새 이름
 * @returns {Promise<number>} 이름을 바꾼 시트 수
 */
async function renameSheetsInZip(zip, map) {
  if (!map || !map.size) return 0;
  let renamed = 0;
  const wbPath = 'xl/workbook.xml';
  let wb = await zip.file(wbPath).async('string');
  wb = wb.replace(/<sheet\b[^>]*?\/?>/g, (tag) =>
    tag.replace(/\bname="([^"]*)"/, (m, v) => {
      const name = unescapeXml(v);
      if (!map.has(name)) return m;
      renamed++;
      return `name="${escapeAttr(map.get(name))}"`;
    })
  );
  wb = wb.replace(/(<definedName\b[^>]*>)([\s\S]*?)(<\/definedName>)/g, (m, a, body, c) => a + renameRefs(body, map) + c);
  zip.file(wbPath, wb);

  for (const filename of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(filename)) continue;
    let xml = await zip.file(filename).async('string');
    const before = xml;
    xml = xml.replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (m, a, body, c) => a + renameRefs(body, map) + c);
    xml = xml.replace(/(<hyperlink\b[^>]*\blocation=")([^"]*)(")/g, (m, a, loc, c) => a + renameRefs(loc, map) + c);
    if (xml !== before) zip.file(filename, xml);
  }

  const appPath = 'docProps/app.xml';
  if (zip.file(appPath)) {
    let app = await zip.file(appPath).async('string');
    app = app.replace(/<vt:lpstr>([^<]*)<\/vt:lpstr>/g, (m, v) => {
      const name = unescapeXml(v);
      if (map.has(name)) return `<vt:lpstr>${escapeText(map.get(name))}</vt:lpstr>`;
      return `<vt:lpstr>${renameRefs(v, map)}</vt:lpstr>`;
    });
    zip.file(appPath, app);
  }
  return renamed;
}

module.exports = { renameSheetsInZip, renameRefs };
