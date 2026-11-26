// [인쇄 비교 수정 2026-11-25] 원본 인쇄 양식 재현 테스트 (실제 빈 양식 사용)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const JSZip = require('jszip');
const { exportWorkbook } = require('./export');

const DEFS = path.join(__dirname, 'data', 'templateDefs');
const BLANKS = path.join(__dirname, 'data', 'blanks');
const loadDef = (id) => JSON.parse(fs.readFileSync(path.join(DEFS, `${id}.templateDef.json`), 'utf-8'));

function stateFor(def, blocksPerSheet = 1, coverCells = {}) {
  const sheets = [];
  for (const sDef of def.sheets) {
    if (sDef.role === 'remove') continue;
    if (sDef.role === 'block') {
      sheets.push({ name: sDef.name, role: 'block', sheetDef: sDef, repeatedValues: {}, blocks: Array.from({ length: blocksPerSheet }, () => ({ values: {}, extraCells: {}, photoAreas: {} })) });
    } else {
      sheets.push({ name: sDef.name, role: sDef.role, sheetDef: sDef, cells: coverCells[sDef.name] || {} });
    }
  }
  return { sheets, siteName: '' };
}

async function sheetXml(zipOrBuf, name) {
  const zip = zipOrBuf instanceof JSZip ? zipOrBuf : await JSZip.loadAsync(zipOrBuf);
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const esc = name.replace(/&/g, '&amp;');
  const rid = new RegExp(`<sheet\\b[^>]*name="${esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*r:id="([^"]+)"`).exec(wb)[1];
  const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels);
  const t = (target[1] || target[2]).replace(/^\/?xl\//, '').replace(/^\//, '');
  return zip.file(`xl/${t}`).async('string');
}

const firstFontName = (styles) => /<fonts\b[^>]*>[\s\S]*?<font\b[\s\S]*?<name val="([^"]+)"/.exec(styles)[1];

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpe-print-'));
  let pass = 0;
  const ok = (msg) => { pass++; console.log('  PASS:', msg); };

  // 1. 기본 글꼴·쪽 번호·머리말 위치·목차 쪽 나누기 = 빈 양식과 같음 (준공사진첩_롯데)
  {
    const id = '준공사진첩_롯데';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def, 3), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const o = await JSZip.loadAsync(fs.readFileSync(out));
    const b = await JSZip.loadAsync(fs.readFileSync(path.join(BLANKS, `${id}.xlsx`)));
    const ofont = firstFontName(await o.file('xl/styles.xml').async('string'));
    const bfont = firstFontName(await b.file('xl/styles.xml').async('string'));
    assert.strictEqual(ofont, bfont, `기본 글꼴 ${ofont} ≠ ${bfont}`);
    ok(`기본 글꼴이 빈 양식과 같음 (${ofont})`);
    for (const nm of ['표지', '목차', '공간별전경']) {
      const ox = await sheetXml(o, nm);
      const bx = await sheetXml(b, nm);
      const ps = (x) => (/<pageSetup\b[^>]*>/.exec(x) || [''])[0].replace(/\sr:id="[^"]*"/, '').replace(/\s*\/?>$/, '');
      assert.strictEqual(ps(ox), ps(bx), `${nm} pageSetup`);
      const hf = (x) => (/<headerFooter\b[^>]*>/.exec(x) || [''])[0].replace(/\s*\/?>$/, '');
      if (hf(bx)) assert.strictEqual(hf(ox), hf(bx), `${nm} headerFooter 속성`);
    }
    ok('쪽 설정(쪽 번호 시작 포함)·머리말 속성이 빈 양식과 같음');
    const toc = await sheetXml(o, '목차');
    assert.ok(/<rowBreaks\b[\s\S]*?<brk id="72"/.test(toc), '목차 쪽 나누기 72행');
    ok('목차 쪽 나누기(72행) 유지');
  }

  // 2. 공용홀_롯데 1.외관: 2블록마다 나누기 + 둘째 쪽부터 맨 위 5.5pt 빈 행
  {
    const id = '공용홀_롯데';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def, 5), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const x = await sheetXml(fs.readFileSync(out), '1.외관');
    const brks = [...x.matchAll(/<brk id="(\d+)"/g)].map((m) => +m[1]);
    assert.deepStrictEqual(brks, [52, 101], `나누기 ${brks}`);
    assert.ok(/<row r="53"[^>]*ht="5.5"/.test(x), '53행 5.5pt');
    assert.ok(/<row r="102"[^>]*ht="5.5"/.test(x), '102행 5.5pt');
    const wb = await (await JSZip.loadAsync(fs.readFileSync(out))).file('xl/workbook.xml').async('string');
    assert.ok(/1\.외관(?:&apos;|')?!\$[A-Z]+\$?\d+:\$[A-Z]+\$?126</.test(wb), '인쇄 영역 126행까지');
    ok('공용홀_롯데 2블록마다 나누기(52·101행), 쪽 맨 위 5.5pt 행(53·102행), 인쇄 영역 126행');
    const ft = /<oddFooter>([\s\S]*?)<\/oddFooter>/.exec(x)[1];
    assert.ok(ft.includes('자재는 품질의 향상') && ft.includes('&amp;P/&amp;N'), `바닥글 ${ft}`);
    ok('공용홀_롯데 바닥글 안내문과 "쪽/전체 쪽"이 원본 그대로');
  }

  // 3. 공용홀_아크로: 블록마다, 블록 9번째 행 뒤에서 나누기
  {
    const id = '공용홀_아크로';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def, 3), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const x = await sheetXml(fs.readFileSync(out), '2F Hall');
    const brks = [...x.matchAll(/<brk id="(\d+)"/g)].map((m) => +m[1]);
    assert.deepStrictEqual(brks, [10, 20], `나누기 ${brks}`);
    ok('공용홀_아크로 블록마다 10·20행에서 나누기(원본과 같은 위치)');
  }

  // 4. 머리말 현장명: 표지 "PROJECT:  X" → 머리말 "X", 화면 입력값이 있으면 그 값
  {
    const id = '공용홀_한신더휴';
    const def = loadDef(id);
    const cover = def.sheets.find((s) => s.role === 'cover');
    const sf = (cover.coverFields || []).find((c) => c.kind === 'siteName');
    const st = stateFor(def, 1, { [cover.name]: { [sf.cell]: 'PROJECT:  테스트 현장\n둘째 줄' } });
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: st, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    let x = await sheetXml(fs.readFileSync(out), '공용홀');
    assert.ok(/<oddHeader>[^<]*테스트 현장<\/oddHeader>/.test(x) && !x.includes('PROJECT') && !x.includes('둘째 줄'), '머리말 현장명 정리');
    st.siteName = '테스트 현장 공용홀';
    await exportWorkbook({ templateDef: def, editorState: st, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    x = await sheetXml(fs.readFileSync(out), '공용홀');
    assert.ok(/<oddHeader>[^<]*테스트 현장 공용홀<\/oddHeader>/.test(x), '머리말 입력값 우선');
    ok('머리말 현장명: "PROJECT:"·둘째 줄 제외, 화면 입력값이 있으면 그 값');
  }

  // [PDF 비교 수정 2026-11-25]
  const drawingsOf = async (buf, name) => {
    const zip = await JSZip.loadAsync(buf);
    const wb = await zip.file('xl/workbook.xml').async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const esc = name.replace(/&/g, '&amp;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rid = new RegExp(`<sheet\\b[^>]*name="${esc}"[^>]*r:id="([^"]+)"`).exec(wb)[1];
    const tg = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels)[0];
    const sp = 'xl/' + /Target="([^"]+)"/.exec(tg)[1].replace(/^\/?xl\//, '');
    const srels = sp.replace(/([^/]+)$/, '_rels/$1.rels');
    if (!zip.file(srels)) return '';
    const r = await zip.file(srels).async('string');
    const d = /Type="[^"]*\/drawing"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*\/drawing"/.exec(r);
    if (!d) return '';
    const dp = 'xl/drawings/' + (d[1] || d[2]).split('/').pop();
    const sheet = await zip.file(sp).async('string');
    assert.ok(/<drawing r:id="/.test(sheet), `${name} 시트에 drawing 연결`);
    return zip.file(dp).async('string');
  };
  // 5. 도형: 힐스테이트 쪽 머리 글상자(현장명 포함), 아크로 표지 네모
  {
    let id = '준공사진첩_힐스테이트';
    let def = loadDef(id);
    const st = stateFor(def, 3);
    st.siteName = '테스트 힐스테이트';
    let out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: st, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const blockSheet = def.sheets.find((s) => s.role === 'block').name;
    const d = await drawingsOf(fs.readFileSync(out), blockSheet);
    assert.ok(/<xdr:sp\b/.test(d) && d.includes('테스트 힐스테이트') && !d.includes('{{현장명}}'), '힐스테이트 머리 글상자');
    assert.strictEqual((d.match(/<xdr:pic>/g) || []).length, 2, '힐스테이트 머리 행 로고 2개');
    ok('힐스테이트 쪽 머리 글상자(현장명 포함)와 머리 행 로고 2개가 살아 있음');

    id = '준공사진첩_아크로';
    def = loadDef(id);
    out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def, 1), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const cover = def.sheets.find((s) => s.role === 'cover').name;
    const cd = await drawingsOf(fs.readFileSync(out), cover);
    const nSp = (cd.match(/<xdr:sp\b/g) || []).length;
    const nPic = (cd.match(/<xdr:pic\b/g) || []).length;
    assert.ok(nSp === 3 && nPic >= 1, `아크로 표지 도형 ${nSp}, 사진 ${nPic}`);
    const ids = [...cd.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    assert.strictEqual(new Set(ids).size, ids.length, '도형 번호 겹침');
    ok(`아크로 표지 도형 3개 + 로고 사진 유지, 도형 번호 겹침 없음`);
  }

  // 6. 목차 차례 번호 수식: 첫 번호만 넣으면 나머지가 이어짐(계산값 함께 저장)
  {
    const id = '준공사진첩_롯데';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}_toc.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def, 1, { 목차: { B4: '1', E4: '70', H4: '139' } }), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const x = await sheetXml(fs.readFileSync(out), '목차');
    assert.ok(/<c r="B5"[^>]*><f>B4\+1<\/f><v>2<\/v>/.test(x), 'B5');
    assert.ok(/<c r="E36"[^>]*><f>E35\+1<\/f><v>102<\/v>/.test(x), 'E36');
    assert.ok(/<c r="H36"[^>]*><f>H35\+1<\/f><v>171<\/v>/.test(x), 'H36');
    ok('목차 차례 번호 수식 유지 + 계산값 저장 (B5=2, E36=102, H36=171)');
  }

  // 7. 포스코 대형 드레스룸 블록 높이 = 원본 대부분(381.5pt)
  {
    const id = '준공사진첩_포스코';
    const def = loadDef(id);
    const out = path.join(tmp, `${id}.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: stateFor(def, 2), blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const x = await sheetXml(fs.readFileSync(out), '대형 드레스룸');
    const hts = [1, 2, 3, 4, 5, 6, 7].map((r) => Number((new RegExp(`<row r="${r}"[^>]*\\sht="([\\d.]+)"`).exec(x) || [0, 0])[1]));
    const sum = hts.reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, 381.5, `블록 높이 ${hts}`);
    ok('포스코 대형 드레스룸 블록 높이 381.5pt (원본 블록 20개 중 가장 흔한 높이)');
  }

  // [2026-11-26] 목차의 공유 수식 기준 칸(B5 = B4+1, 아래 B36까지 복사)을 직접 고쳐도 내보내기가 멈추지 않고,
  // 아래 칸은 자기 수식으로 계속 이어진다
  {
    const id = '준공사진첩_롯데';
    const def = loadDef(id);
    const st = stateFor(def, 1, { 목차: { B5: '7', E5: '' } });
    const out = path.join(tmp, `${id}_shared.xlsx`);
    await exportWorkbook({ templateDef: def, editorState: st, blankXlsxPath: path.join(BLANKS, `${id}.xlsx`), outputPath: out });
    const x = await sheetXml(fs.readFileSync(out), '목차');
    assert(/<c r="B5"[^>]*><v>7<\/v>|<c r="B5"[^>]*t="[^"]*"[^>]*>.*?7/.test(x) || /<c r="B5"[^>]*>(?:<is>)?.*?7/.test(x), 'B5에 고친 값');
    assert(/<c r="B6"[^>]*><f>B5\+1<\/f><v>8<\/v>/.test(x), `B6은 자기 수식 B5+1, 계산값 8: ${(/<c r="B6"[^>]*>.*?<\/c>/.exec(x) || [''])[0]}`);
    assert(!/t="shared"/.test(x), '공유 수식이 남지 않음');
    ok('목차 공유 수식 기준 칸(B5)을 고쳐도 내보내기 성공, B6은 B5+1 = 8로 이어짐');
  }

  console.log(`\n인쇄 재현 테스트 ${pass}/${pass} 통과`);
}

run().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });
