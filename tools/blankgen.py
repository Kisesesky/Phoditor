#!/usr/bin/env python3
"""(c)안: 원본 xlsx → 빈 양식 xlsx. zip 안의 XML만 문자열 수준으로 고친다(서식·네임스페이스 원본 유지).
원본은 읽기만 한다. 출력: app/data/blanks/<id>.xlsx + app/data/blanks/blankgen_report.json (앱이 바로 읽는 곳)

하는 일 (PLAN v0.6 D1·D16 + 빈 양식 정의)
- 블록 시트: 블록 1개(최빈 길이)만 남기고 나머지 행 삭제, 값·반복값 셀 비움, 번호 셀은 숫자로 고정, 블록 위 머리 행의 현장 값 비움
- 표지: coverFields와 현장명이 들어간 셀 비움 / 목차: 머리 라벨만 남기고 값 비움 / remove 역할 시트 삭제
- 그림: keepImages만 남기고 모두 삭제(블록 시트는 전부 삭제), 안 쓰는 media 삭제
- 외부 링크·calcChain·메모·과다한 정의된 이름·absPath 삭제, 공유 문자열 재구성(남의 현장 글자가 파일에 남지 않게)
"""
import html, json, os, re, sys, unicodedata, zipfile, posixpath
from collections import Counter, OrderedDict

ROOT = "/Users/hoya/사진관한다_작업건"
TD = os.path.join(ROOT, "template-specs/templateDefs")
INV = json.load(open(os.path.join(ROOT, "template-specs/inventory.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "app/data/blanks")
os.makedirs(OUT, exist_ok=True)
NFC = lambda x: unicodedata.normalize("NFC", x)
GENERIC = {"사진첩", "준공사진첩", "분양승인사진첩", "분양승인", "준공", "공용홀", "견본주택", "샘플", "외관", "사진", "편집본", "수정", "단위세대"}


def cn(s):
    n = 0
    for ch in s:
        n = n * 26 + ord(ch) - 64
    return n


def cl(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def sa(a):
    m = re.match(r"\$?([A-Z]+)\$?(\d+)", a)
    return cn(m.group(1)), int(m.group(2))


def rels_of(z, path):
    d = posixpath.dirname(path)
    rp = posixpath.join(d, "_rels", posixpath.basename(path) + ".rels")
    out = {}
    if rp in z:
        for m in re.finditer(r"<Relationship ([^>]*?)/>", z[rp]):
            a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
            tgt = a["Target"]
            full = tgt if a.get("TargetMode") == "External" else (tgt[1:] if tgt.startswith("/") else posixpath.normpath(posixpath.join(d, tgt)))
            out[a["Id"]] = {"target": full, "type": a["Type"].rsplit("/", 1)[-1], "raw": m.group(0)}
    return rp, out


def text_of_si(si):
    return html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))


def build(tdef):
    inv = next(e for e in INV if e["relPath"] == tdef["source"]["file"])
    src = os.path.join(ROOT, inv["fsPath"])
    zin = zipfile.ZipFile(src)
    # 큰 media는 읽지 않는다: XML/rels만 메모리에 올리고, 남길 media만 나중에 복사
    z = OrderedDict()
    for info in zin.infolist():
        if info.filename.startswith("xl/media/"):
            continue
        z[info.filename] = zin.read(info.filename).decode("utf-8") if info.filename.endswith((".xml", ".rels")) else zin.read(info.filename)
    site_words = {w for w in re.findall(r"[가-힣A-Za-z]{2,}", NFC(os.path.basename(tdef["source"]["file"]))) if w not in GENERIC}
    rep = {"id": tdef["id"], "source": tdef["source"]["file"], "sheets": [], "removed": [], "warnings": []}

    # ---- 공유 문자열 ----
    sst_xml = z.get("xl/sharedStrings.xml", "")
    sis = re.findall(r"<si>.*?</si>|<si/>", sst_xml, re.S)
    sst_text = [text_of_si(x) for x in sis]

    def cell_text(cxml):
        t = re.search(r'\bt="(\w+)"', cxml.split(">", 1)[0])
        v = re.search(r"<v>(.*?)</v>", cxml, re.S)
        if t and t.group(1) == "s" and v:
            return sst_text[int(v.group(1))]
        if t and t.group(1) == "inlineStr":
            return "".join(re.findall(r"<t[^>]*>(.*?)</t>", cxml, re.S))
        return v.group(1) if v else ""

    def blank_cell(cxml):
        head = cxml.split(">", 1)[0] if not cxml.endswith("/>") or ">" in cxml[:-2] else cxml[:-2]
        head = re.sub(r'\s+t="\w+"', "", head.rstrip("/"))
        return head + "/>"

    def set_number(cxml, num):
        head = cxml.split(">", 1)[0].rstrip("/")
        head = re.sub(r'\s+t="\w+"', "", head)
        return f"{head}><v>{num}</v></c>"

    # ---- 워크북 ----
    wb = z["xl/workbook.xml"]
    wb_rels_path, wb_rels = rels_of(z, "xl/workbook.xml")
    sheet_tags = re.findall(r"<sheet [^>]*/>", wb)
    sheet_info = []
    for i, tg in enumerate(sheet_tags):
        a = dict(re.findall(r'([\w:]+)="([^"]*)"', tg))
        sheet_info.append({"idx": i, "tag": tg, "name": a["name"].replace("&amp;", "&"), "rid": a["r:id"], "path": wb_rels[a["r:id"]]["target"]})
    defs = {s["name"]: s for s in tdef["sheets"]}
    removed_sheets = [s for s in sheet_info if defs.get(s["name"], {}).get("role") == "remove"]
    keep_sheets = [s for s in sheet_info if s not in removed_sheets]
    old2new = {s["idx"]: i for i, s in enumerate(keep_sheets)}

    keep_imgs = {(k["sheet"], k["anchor"]) for k in (tdef.get("keepImages") or [])}
    print_area_end = {}
    for m in re.finditer(r'<definedName name="_xlnm.Print_Area" localSheetId="(\d+)">(.*?)</definedName>', wb):
        ends = re.findall(r"\$(\d+)(?:,|$)", m.group(2))
        if ends:
            print_area_end[sheet_info[int(m.group(1))]["name"]] = max(int(e) for e in ends)
    block_counter = 0  # 문서 전체 번호용
    shape_texts = []
    new_print_area = {}

    for s in keep_sheets:
        d = defs.get(s["name"], {})
        role = d.get("role")
        path = s["path"]
        xml = z[path]
        info = {"sheet": s["name"], "role": role}
        rowmap = None  # 원래 행 → 새 행 (None이면 그대로)
        ht_override = {}  # 원래 행 → 새 행 높이(pt)
        hdr_first = None  # 블록 시트의 첫 블록 시작 행 (그 위는 머리 행)
        label_fill = {}  # 원래 주소 → 채울 라벨 글자
        clear_cells = set()
        number_cells = {}
        if role == "block":
            b = d["block"]
            P = b["rows"]
            # 블록 시작 행 복원 (앵커)
            rows_xml = re.findall(r"<row [^>]*?(?:/>|>.*?</row>)", xml, re.S)
            cells_txt = {}
            for rx in rows_xml:
                for cx in re.findall(r"<c [^>]*?(?:/>|>.*?</c>)", rx, re.S):
                    addr = re.search(r'\br="([A-Z]+\d+)"', cx).group(1)
                    tx = cell_text(cx)
                    if tx:
                        cells_txt[addr] = tx
            if d.get("manualOverride"):
                last_r = max(sa(a)[1] for a in cells_txt) if cells_txt else b["startRow"]
                starts = list(range(b["startRow"], last_r + 1, P))  # (b) range(3) 하드코딩 제거
            else:
                al = b["anchorLabel"]
                col = cn(al["column"])
                nl = lambda x: x.replace("\r\n", "\n").replace("\r", "\n").strip()  # (a) 줄바꿈 정규화
                starts = sorted(sa(a)[1] - al["offsetFromBlockStart"] for a, v in cells_txt.items() if sa(a)[0] == col and nl(v) == nl(al["text"]))
            if not starts:
                last_r = max(sa(a)[1] for a in cells_txt) if cells_txt else b["startRow"]
                starts = list(range(b["startRow"], last_r + 1, P))
                info_warn = f"{s['name']}: 앵커 라벨을 못 찾아 시작 행부터 {P}행 간격으로 나눔"
                rep["warnings"].append(info_warn)
            lens = [y - x for x, y in zip(starts, starts[1:])]
            main_len = Counter(lens).most_common(1)[0][0] if lens else P
            # 최빈 길이 블록 중 첫 번째 (D1)
            chosen = next((st for st, ln in zip(starts, lens) if ln == main_len), starts[0])
            first = starts[0]
            hdr_first = first
            info.update(blockStart=first, chosenBlock=chosen, keptRows=main_len, removedBlocks=len(starts) - 1)
            # [PDF 비교 수정 2026-11-25] 고른 블록의 행 높이가 원본 블록 대부분과 1pt 넘게 다르면
            # 원본에서 가장 흔한 행 높이 조합으로 맞춘다 (예: 포스코 대형 드레스룸 423pt ↔ 대부분 381.5pt)
            row_ht = {}
            for rx in rows_xml:
                head_ = rx.split(">", 1)[0]
                mr = re.search(r'\br="(\d+)"', head_)
                mh = re.search(r'\bht="([\d.]+)"', head_)
                if mr:
                    row_ht[int(mr.group(1))] = float(mh.group(1)) if mh else None
            same_len = [st for st, ln in zip(starts, lens + [main_len]) if ln == main_len]
            sigs = [tuple(row_ht.get(st + i) for i in range(main_len)) for st in same_len]
            mode_sig = Counter(sigs).most_common(1)[0][0] if sigs else None
            chosen_sig = tuple(row_ht.get(chosen + i) for i in range(main_len))
            tot = lambda sg: sum(x if x is not None else 15.0 for x in sg)
            if mode_sig and None not in mode_sig and abs(tot(chosen_sig) - tot(mode_sig)) > 1:
                ht_override = {chosen + i: mode_sig[i] for i in range(main_len)}
                info["rowHeightsFromMode"] = {"chosen": list(chosen_sig), "mode": list(mode_sig), "modeCount": sigs.count(mode_sig), "blocks": len(sigs)}
            else:
                ht_override = {}

            def rowmap(r, first=first, chosen=chosen, main_len=main_len):
                if r < first:
                    return r
                if chosen <= r < chosen + main_len:
                    return r - chosen + first
                return None
            # 비울 셀: 값·반복값 (상대 좌표 → 원래 주소)
            for coll in ("values", "repeatedValues"):
                for x in b.get(coll, []):
                    m = re.match(r"([A-Z]+)\{\+(\d+)\}", x["cell"])
                    if m:
                        clear_cells.add(f"{m.group(1)}{chosen + int(m.group(2))}")
            # 허용 목록: 블록 안에서는 라벨 칸만 글자를 남긴다 (자유 입력 사양 줄 등이 값 목록에서 빠져도 비워지도록)
            label_rel = set()
            for l in b.get("labels", []):
                m = re.match(r"([A-Z]+)\{\+(\d+)\}", l["cell"])
                if m:
                    label_rel.add((m.group(1), int(m.group(2))))
            whitelist_cleared = []
            for a, v in cells_txt.items():
                c_, r_ = sa(a)
                if chosen <= r_ < chosen + main_len and (cl(c_), r_ - chosen) not in label_rel:
                    clear_cells.add(a)
                    whitelist_cleared.append(a)
            info["whitelistCleared"] = len(whitelist_cleared)
            for l in b.get("labels", []):
                m = re.match(r"([A-Z]+)\{\+(\d+)\}", l["cell"])
                if not m:
                    continue
                a_ = f"{m.group(1)}{chosen + int(m.group(2))}"
                if not cells_txt.get(a_, "").strip():
                    label_fill[a_] = l["text"]
            info["labelsFilled"] = {k: v for k, v in label_fill.items()}
            num = b.get("numbering")
            if num:
                m = re.match(r"([A-Z]+)\{\+(\d+)\}", num["cell"])
                block_counter += 1
                number_cells[f"{m.group(1)}{chosen + int(m.group(2))}"] = block_counter if num.get("scope") == "document" else 1
                if num.get("totalCell"):
                    mt = re.match(r"([A-Z]+)\{\+(\d+)\}", num["totalCell"])
                    total = sum(1 for x in tdef["sheets"] if x.get("role") == "block") if num.get("scope") == "document" else 1
                    number_cells[f"{mt.group(1)}{chosen + int(mt.group(2))}"] = total
            # 블록 위 머리 행의 현장 값(현장명·일자·타입)
            hdr = []
            for a, v in cells_txt.items():
                c, r = sa(a)
                if r < first:
                    words = set(re.findall(r"[가-힣A-Za-z]{2,}", v))
                    if len(words & site_words) >= 2 or re.search(r"20\d\d\s*[.\-년]", v) or re.fullmatch(r"\d{5}(\.\d+)?", v.strip()) or re.search(r"\d{2,3}\s*㎡|\b\d{2,3}[A-F]\d?\b", v):
                        clear_cells.add(a)
                        hdr.append({"cell": a, "current": v[:30]})
            info["headerValuesCleared"] = hdr
        elif role == "cover":
            for x in d.get("coverFields", []):
                clear_cells.add(x["cell"])
        # 셀 처리
        toc_header_row = None
        if role == "toc":
            rows_xml = re.findall(r"<row [^>]*?(?:/>|>.*?</row>)", xml, re.S)
            for rx in rows_xml:
                r = int(re.search(r'\br="(\d+)"', rx).group(1))
                tx = [cell_text(cx) for cx in re.findall(r"<c [^>]*?(?:/>|>.*?</c>)", rx, re.S)]
                if sum(1 for t in tx if re.search(r"구\s*분|차\s*례|품\s*목|NO|위\s*치|번호|PAGE|페이지", t)) >= 2:
                    toc_header_row = r
                    break
            info["tocHeaderRow"] = toc_header_row

        def fix_row(m):
            rx = m.group(0)
            r = int(re.search(r'\br="(\d+)"', rx).group(1))
            nr = rowmap(r) if rowmap else r
            if nr is None:
                return ""
            def fix_cell(mc):
                cx = mc.group(0)
                addr = re.search(r'\br="([A-Z]+)(\d+)"', cx)
                a = f"{addr.group(1)}{addr.group(2)}"
                tx = cell_text(cx)
                if a in label_fill:
                    head = cx.split(">", 1)[0].rstrip("/")
                    head = re.sub(r'\s+t="\w+"', "", head)
                    cx = f'{head} t="inlineStr"><is><t xml:space="preserve">{html.escape(label_fill[a], quote=False)}</t></is></c>'
                elif a in number_cells:
                    cx = set_number(cx, number_cells[a])
                elif role == "toc" and "<f" in cx and a not in clear_cells:
                    # [PDF 비교 수정 2026-11-25] 목차 차례 번호 수식(=B4+1 등)은 양식 구조라 남긴다.
                    # 계산값(<v>)만 지우고, 앱이 표시·내보내기 때 다시 계산한다.
                    head = re.sub(r'\s+t="\w+"', "", cx.split(">", 1)[0])
                    fx = re.search(r"<f[^>]*/>|<f[^>]*>.*?</f>", cx, re.S).group(0)
                    cx = f"{head}>{fx}</c>"
                elif a in clear_cells or (role == "toc" and toc_header_row and r > toc_header_row and tx) \
                        or (role in ("cover", "toc") and tx and len(set(re.findall(r"[가-힣A-Za-z]{2,}", tx)) & site_words) >= 2):
                    cx = blank_cell(cx)
                elif "<f" in cx and role == "block":
                    # 블록 안 다른 수식은 참조가 깨질 수 있으니 계산값만 남기고 수식 제거
                    cx = re.sub(r"<f[^>]*/>|<f[^>]*>.*?</f>", "", cx, flags=re.S)
                return cx.replace(f'r="{a}"', f'r="{addr.group(1)}{nr}"', 1)
            rx = re.sub(r"<c [^>]*?(?:/>|>.*?</c>)", fix_cell, rx, flags=re.S)
            if r in ht_override:
                head_ = rx.split(">", 1)[0]
                nh = re.sub(r'\s+(?:ht|customHeight)="[^"]*"', "", head_.rstrip("/"))
                nh += f' ht="{ht_override[r]:g}" customHeight="1"' + ("/" if head_.endswith("/") else "")
                rx = nh + rx[len(head_):]
            return re.sub(r'(<row [^>]*?\br=")\d+(")', rf"\g<1>{nr}\2", rx, count=1)

        xml = re.sub(r"<row [^>]*?(?:/>|>.*?</row>)", fix_row, xml, flags=re.S)
        # 서식만 남은 빈 행 자르기: 인쇄 영역 끝·글자·병합의 마지막 행 뒤는 지운다
        if role != "block":
            text_rows = []
            for rx_ in re.findall(r"<row [^>]*?(?:/>|>.*?</row>)", xml, re.S):
                if "<v>" in rx_ or "<is>" in rx_:
                    text_rows.append(int(re.search(r'\br="(\d+)"', rx_).group(1)))
            merge_rows = [sa(x.split(":")[-1])[1] for x in re.findall(r'<mergeCell ref="([^"]+)"/>', xml)]
            pa = print_area_end.get(s["name"])
            limit = max(text_rows + merge_rows + ([pa] if pa else []) + [1])
            def trim(m):
                r = int(re.search(r'\br="(\d+)"', m.group(0)).group(1))
                return m.group(0) if r <= limit else ""
            xml = re.sub(r"<row [^>]*?(?:/>|>.*?</row>)", trim, xml, flags=re.S)
            info["trimmedAfterRow"] = limit

        def map_ref(ref):
            p = ref.split(":")
            c1, r1 = sa(p[0]); c2, r2 = sa(p[-1])
            if rowmap:
                n1, n2 = rowmap(r1), rowmap(r2)
                if n1 is None or n2 is None:
                    return None
                r1, r2 = n1, n2
            return f"{cl(c1)}{r1}" + (f":{cl(c2)}{r2}" if len(p) > 1 else "")
        # 병합
        def fix_merges(m):
            refs = [map_ref(x) for x in re.findall(r'<mergeCell ref="([^"]+)"/>', m.group(0))]
            refs = [x for x in refs if x]
            return f'<mergeCells count="{len(refs)}">' + "".join(f'<mergeCell ref="{x}"/>' for x in refs) + "</mergeCells>" if refs else ""
        xml = re.sub(r"<mergeCells[^>]*>.*?</mergeCells>", fix_merges, xml, flags=re.S)
        # 조건부 서식·유효성 검사 범위
        def fix_sqref(m):
            refs = [map_ref(x) for x in m.group(2).split()]
            refs = [x for x in refs if x]
            return None if not refs else m.group(1) + " ".join(refs) + m.group(3)
        def fix_block(tag):
            nonlocal xml
            def f(m):
                inner = re.sub(r'(sqref=")([^"]+)(")', lambda mm: fix_sqref(mm) or 'sqref="__DROP__"', m.group(0))
                return "" if "__DROP__" in inner else inner
            xml = re.sub(rf"<{tag} [^>]*?sqref=\"[^\"]+\"[^>]*>.*?</{tag}>", f, xml, flags=re.S)
        fix_block("conditionalFormatting")
        # ExcelJS가 지원하지 않는 조건부 서식(duplicateValues 등)은 왕복 저장 때 빈 태그로 남아 Excel 복구 오류를 낸다 → 미리 뺀다
        EXCELJS_CF = {"expression", "cellIs", "top10", "aboveAverage", "colorScale", "iconSet", "dataBar", "containsText", "timePeriod"}
        def drop_cf(m):
            kinds = set(re.findall(r'<cfRule [^>]*type="(\w+)"', m.group(0)))
            if kinds and kinds <= EXCELJS_CF:
                return m.group(0)
            info.setdefault("cfRemoved", []).append(sorted(kinds))
            return ""
        xml = re.sub(r"<conditionalFormatting\b.*?</conditionalFormatting>", drop_cf, xml, flags=re.S)
        if rowmap:
            xml = re.sub(r"<dataValidations[^>]*>.*?</dataValidations>", "", xml, flags=re.S)
            xml = re.sub(r"<hyperlinks>.*?</hyperlinks>", "", xml, flags=re.S)
            xml = re.sub(r"<rowBreaks[^>]*>.*?</rowBreaks>|<rowBreaks[^>]*/>", "", xml, flags=re.S)
        # 차원
        rows_left = [int(x) for x in re.findall(r'<row [^>]*?\br="(\d+)"', xml)]
        last_row = max(rows_left) if rows_left else 1
        xml = re.sub(r'<dimension ref="([A-Z]+\d+):([A-Z]+)\d+"/>', rf'<dimension ref="\1:\g<2>{last_row}"/>', xml)
        # 머리글·바닥글의 현장명 → {{현장명}} 자리표시자 (원문은 리포트에 기록)
        hf_found = []
        def fix_hf(m):
            tag, body = m.group(1), m.group(2)
            raw = html.unescape(body)
            # [인쇄 비교 수정 2026-11-25] 글꼴 이름(&"롯데캐슬,보통")·서식 코드 안의 글자는 현장명으로 보지 않는다
            text_only = lambda t: re.sub(r'&"[^"]*"|&K[0-9A-Fa-f]{6}|&\d+|&[A-Za-z&]', "", t)
            if not any(w in text_only(raw) for w in site_words):
                return m.group(0)
            parts = re.split(r"(&[LCR])", raw)
            out = []
            for p_ in parts:
                if re.fullmatch(r"&[LCR]", p_) or not any(w in text_only(p_) for w in site_words):
                    out.append(p_)
                    continue
                codes = re.match(r'^((?:&"[^"]*"|&K[0-9A-Fa-f]{6}|&\d+|&[BIUSEXYP]|\s)*)', p_).group(1)
                lead = re.match(r"^\s*[■□●▶-]*\s*", p_[len(codes):]).group(0)
                tail = re.search(r"\s*$", p_).group(0)  # [2026-11-25] 끝 공백은 원본 그대로 (오른쪽 정렬 위치 유지)
                out.append(codes + lead + "{{현장명}}" + tail)
            new_raw = "".join(out)
            hf_found.append({"part": tag, "original": raw, "blank": new_raw})
            return f"<{tag}{m.group(3)}>" + html.escape(new_raw, quote=False) + f"</{tag}>"
        xml = re.sub(r"<(oddHeader|oddFooter|evenHeader|evenFooter|firstHeader|firstFooter)()([^>]*)>(.*?)</\1>",
                     lambda m: fix_hf(type("M", (), {"group": lambda self_, i: {0: m.group(0), 1: m.group(1), 2: m.group(4), 3: m.group(3)}[i]})()), xml, flags=re.S)
        info["headerFooterSiteText"] = hf_found
        # 메모(legacyDrawing) 제거
        xml = re.sub(r'<legacyDrawing [^>]*/>', "", xml)
        # 드로잉
        sp_rels_path, sp_rels = rels_of(z, path)
        dm = re.search(r'<drawing r:id="([^"]+)"/>', xml)
        imgs_kept = imgs_removed = shapes_kept = 0
        if dm:
            dpath = sp_rels[dm.group(1)]["target"]
            dxml = z[dpath]
            def fix_anchor(m):
                nonlocal imgs_kept, imgs_removed, shapes_kept
                ax = m.group(0)
                fr = re.search(r"<xdr:from><xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row>", ax, re.S)
                to = re.search(r"<xdr:to><xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row>", ax, re.S)
                is_pic = "<xdr:pic>" in ax or "<xdr:pic " in ax
                if role == "block" and "<xdr:cxnSp" in ax and not is_pic:
                    return ""  # 사진을 가리키던 화살표·연결선 (현장 작업 흔적)
                ax = re.sub(r"<a:(?:stCxn|endCxn) [^>]*/>", "", ax)  # 지운 도형을 가리키는 연결 정보 제거
                if fr:
                    r0 = int(fr.group(2)) + 1
                    anchor = f"{cl(int(fr.group(1)) + 1)}{r0}" + (f":{cl(int(to.group(1)) + 1)}{int(to.group(2)) + 1}" if to else "")
                else:
                    r0, anchor = None, None
                # [PDF 비교 수정 2026-11-25] 블록 시트라도 블록 위(머리 행)의 그림은 로고라 남긴다 (예: 힐스테이트 준공 1행 로고)
                header_pic = role == "block" and r0 is not None and hdr_first is not None and r0 < hdr_first
                if is_pic and not header_pic and (role == "block" or (s["name"], anchor) not in keep_imgs):
                    imgs_removed += 1
                    return ""
                if rowmap and r0 is not None:
                    n0 = rowmap(r0)
                    if n0 is None:
                        if is_pic:
                            imgs_removed += 1
                        return ""
                    delta = n0 - r0
                    ax = re.sub(r"(<xdr:(?:from|to)>.*?<xdr:row>)(\d+)(</xdr:row>)", lambda mm: f"{mm.group(1)}{int(mm.group(2)) + delta}{mm.group(3)}", ax, flags=re.S)
                if is_pic:
                    imgs_kept += 1
                    ax = re.sub(r'\sdescr="[^"]*"', "", ax)
                else:
                    shapes_kept += 1
                    def fix_t(mt):
                        t_ = html.unescape(mt.group(2))
                        if any(w in t_ for w in site_words):
                            shape_texts.append({"sheet": s["name"], "original": t_})
                            # [PDF 비교 수정 2026-11-25] 앞뒤 공백은 원본대로 둔다 ("성남메트로블 - 84㎡A"의 하이픈 앞 공백)
                            lead = re.match(r"\s*", t_).group(0)
                            trail = re.search(r"\s*$", t_).group(0) if t_.strip() else ""
                            return mt.group(1) + html.escape(lead, quote=False) + "{{현장명}}" + html.escape(trail, quote=False) + mt.group(3)
                        return mt.group(0)
                    ax = re.sub(r"(<a:t>)(.*?)(</a:t>)", fix_t, ax, flags=re.S)
                return ax
            dxml = re.sub(r"<mc:AlternateContent[^>]*>\s*<mc:Choice[^>]*>\s*(<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)\b.*?</xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>)\s*</mc:Choice>.*?</mc:AlternateContent>", r"\1", dxml, flags=re.S)
            dxml = re.sub(r"<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b.*?</xdr:\1>", fix_anchor, dxml, flags=re.S)
            z[dpath] = dxml
            # 드로잉 rels: 안 쓰는 이미지 rel 제거
            drp, drels = rels_of(z, dpath)
            used = set(re.findall(r'r:(?:embed|link)="([^"]+)"', dxml))
            if drp in z:
                used_all = set(re.findall(r'r:(?:embed|link|id)="([^"]+)"', dxml))
                for rid, r in drels.items():
                    if rid not in used_all:
                        z[drp] = z[drp].replace(r["raw"], "")
            if imgs_kept == 0 and shapes_kept == 0:
                xml = xml.replace(dm.group(0), "")
                z[sp_rels_path] = z[sp_rels_path].replace(sp_rels[dm.group(1)]["raw"], "")
                rep["removed"].append(dpath)
                for p_ in (dpath, posixpath.join(posixpath.dirname(dpath), "_rels", posixpath.basename(dpath) + ".rels")):
                    z.pop(p_, None)
        # 메모 rels 제거 (머리글·바닥글 그림 legacyDrawingHF가 쓰는 VML은 남긴다)
        if sp_rels_path in z:
            hf_rids = set(re.findall(r'<legacyDrawingHF r:id="([^"]+)"', xml))
            for rid, r in rels_of(z, path)[1].items():
                if r["type"] == "comments" or (r["type"] == "vmlDrawing" and rid not in hf_rids):
                    z[sp_rels_path] = z[sp_rels_path].replace(r["raw"], "")
                    z.pop(r["target"], None)
                    rep["removed"].append(r["target"])
        z[path] = xml
        if role == "block":
            new_print_area[s["name"]] = last_row
        info.update(imagesKept=imgs_kept, imagesRemoved=imgs_removed, shapesKept=shapes_kept, lastRow=last_row,
                    cleared=len(clear_cells), numberCells=number_cells)
        rep["sheets"].append(info)

    # ---- 시트 삭제 ----
    for s in removed_sheets:
        wb = wb.replace(s["tag"], "")
        z.pop(s["path"], None)
        rp_, r_ = rels_of(z, s["path"])
        for rr in r_.values():
            if rr["type"] == "drawing":
                z.pop(rr["target"], None)
        z.pop(rp_, None)
        z["xl/_rels/workbook.xml.rels"] = z["xl/_rels/workbook.xml.rels"].replace(wb_rels[s["rid"]]["raw"], "")
        rep["removed"].append(s["path"])
    # ---- 정의된 이름: 인쇄 영역·제목만 남기고 localSheetId 다시 매김 ----
    def fix_dn(m):
        dn = m.group(0)
        nm = re.search(r'name="([^"]+)"', dn).group(1)
        lid = re.search(r'localSheetId="(\d+)"', dn)
        if nm not in ("_xlnm.Print_Area", "_xlnm.Print_Titles") or not lid:
            return ""
        if re.search(r"\[\d+\]|#REF!", dn):
            rep["warnings"].append(f"외부 참조·#REF! 정의된 이름 삭제: {html.unescape(re.sub(r'<[^>]+>', '', dn))}")
            return ""
        li = int(lid.group(1))
        if li not in old2new:
            return ""
        dn = dn.replace(lid.group(0), f'localSheetId="{old2new[li]}"')
        sname = sheet_info[li]["name"]
        if nm == "_xlnm.Print_Area" and sname in new_print_area:
            dn = re.sub(r"(\$[A-Z]+\$)(\d+)(</definedName>)", lambda mm: f"{mm.group(1)}{new_print_area[sname]}{mm.group(3)}", dn)
        return dn
    wb = re.sub(r"<definedName [^>]*>.*?</definedName>", fix_dn, wb, flags=re.S)
    wb = re.sub(r"<definedNames>\s*</definedNames>", "", wb)
    # ---- 외부 링크·absPath·calcChain ----
    wb = re.sub(r"<externalReferences>.*?</externalReferences>", "", wb, flags=re.S)
    wb = re.sub(r"<mc:AlternateContent[^>]*>\s*<mc:Choice Requires=\"x15\">\s*<x15ac:absPath[^>]*/>\s*</mc:Choice>\s*</mc:AlternateContent>", "", wb, flags=re.S)
    wb = re.sub(r'<calcPr ([^>]*?)/>', lambda m: "<calcPr " + re.sub(r'\s*fullCalcOnLoad="\w+"', "", m.group(1)) + ' fullCalcOnLoad="1"/>', wb)
    z["xl/workbook.xml"] = wb
    wr = z["xl/_rels/workbook.xml.rels"]
    for rid, r in wb_rels.items():
        if r["type"] in ("externalLink", "calcChain"):
            wr = wr.replace(r["raw"], "")
    z["xl/_rels/workbook.xml.rels"] = wr
    for k in list(z):
        if k.startswith("xl/externalLinks/") or k == "xl/calcChain.xml":
            z.pop(k)
            rep["removed"].append(k)
    # ---- 공유 문자열 재구성 ----
    used_idx = []
    def collect(m):
        used_idx.append(int(m.group(1)))
        return m.group(0)
    for k, v in z.items():
        if k.startswith("xl/worksheets/sheet") and isinstance(v, str):
            for cx in re.findall(r'<c [^>]*?\bt="s"[^>]*>.*?</c>', v, re.S):
                vv = re.search(r"<v>(\d+)</v>", cx)
                if vv:
                    used_idx.append(int(vv.group(1)))
    order = sorted(set(used_idx))
    remap = {o: i for i, o in enumerate(order)}
    for k, v in list(z.items()):
        if k.startswith("xl/worksheets/sheet") and isinstance(v, str):
            def rm(mc):
                cx = mc.group(0)
                return re.sub(r"<v>(\d+)</v>", lambda vv: f"<v>{remap[int(vv.group(1))]}</v>", cx, count=1)
            z[k] = re.sub(r'<c [^>]*?\bt="s"[^>]*>.*?</c>', rm, v, flags=re.S)
    if sst_xml:
        head = re.match(r".*?<sst[^>]*>", sst_xml, re.S).group(0)
        head = re.sub(r'\s(count|uniqueCount)="\d+"', "", head)
        head = head.replace("<sst ", f'<sst count="{len(order)}" uniqueCount="{len(order)}" ', 1)
        z["xl/sharedStrings.xml"] = head + "".join(sis[i] for i in order) + "</sst>"
    rep["sharedStrings"] = {"before": len(sis), "after": len(order)}
    # ---- media: 남은 rels가 가리키는 것만 ----
    need_media = set()
    for k, v in z.items():
        if k.endswith(".rels") and isinstance(v, str):
            for m in re.finditer(r'Target="([^"]*media/[^"]+)"', v):
                need_media.add(posixpath.normpath(posixpath.join(posixpath.dirname(posixpath.dirname(k)), m.group(1))))
    # ---- Content_Types 정리 ----
    ct = z["[Content_Types].xml"]
    def keep_override(m):
        pn = m.group(1).lstrip("/")
        return m.group(0) if (pn in z or pn in need_media) else ""
    z["[Content_Types].xml"] = re.sub(r'<Override PartName="([^"]+)"[^>]*/>', keep_override, ct)
    # docProps: 제목·작성자 등 비움
    if "docProps/core.xml" in z:
        z["docProps/core.xml"] = re.sub(r"<(dc:title|dc:creator|cp:lastModifiedBy|dc:subject|cp:keywords|dc:description)>.*?</\1>", r"<\1></\1>", z["docProps/core.xml"], flags=re.S)
    if "docProps/app.xml" in z:
        z["docProps/app.xml"] = re.sub(r"<TitlesOfParts>.*?</TitlesOfParts>|<HeadingPairs>.*?</HeadingPairs>", "", z["docProps/app.xml"], flags=re.S)
    # ---- 쓰기 ----
    dst = os.path.join(OUT, f"{tdef['id']}.xlsx")
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
        for k, v in z.items():
            zo.writestr(k, v.encode("utf-8") if isinstance(v, str) else v)
        for mp in sorted(need_media):
            zo.writestr(mp, zin.read(mp))
    rep["media"] = sorted(need_media)
    rep["shapeSiteText"] = shape_texts
    rep["bytes"] = {"source": os.path.getsize(src), "blank": os.path.getsize(dst)}
    # ---- 남은 현장 글자 검사 ----
    resid = []
    with zipfile.ZipFile(dst) as zc:
        for n in zc.namelist():
            if n.endswith(".xml"):
                tx = zc.read(n).decode("utf-8")
                for w in site_words:
                    if len(w) >= 2 and w in tx:
                        resid.append((n, w))
    rep["residueNote"] = "xl/styles.xml에 남은 글자는 글꼴 이름·셀 스타일 이름이라 화면에 보이지 않음"
    rep["siteWordResidue"] = sorted(set(resid))
    # 무결성: 모든 r:id가 rels에 있고, rels 대상 파일이 zip에 있는지
    broken = []
    with zipfile.ZipFile(dst) as zc:
        names = set(zc.namelist())
        for n in names:
            if n.endswith(".xml") and not n.startswith("[") and "/_rels/" not in n:
                tx = zc.read(n).decode("utf-8", "ignore")
                rids = set(re.findall(r'\br:(?:id|embed|link|pict)="([^"]+)"', tx))
                rp = posixpath.join(posixpath.dirname(n), "_rels", posixpath.basename(n) + ".rels")
                rl = zc.read(rp).decode() if rp in names else ""
                for rid in rids:
                    m = re.search(r'<Relationship [^>]*Id="%s"[^>]*/>' % re.escape(rid), rl)
                    if not m:
                        broken.append(f"{n}: {rid} 연결 없음")
                        continue
                    if 'TargetMode="External"' in m.group(0):
                        continue
                    tgt = re.search(r'Target="([^"]+)"', m.group(0)).group(1)
                    full = tgt.lstrip("/") if tgt.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(n), tgt))
                    if full not in names:
                        broken.append(f"{n}: {rid} → {full} 파일 없음")
    rep["integrity"] = broken
    if broken:
        print("  ⚠️ 무결성:", broken[:3])
    rep["siteWords"] = sorted(site_words)
    return rep


def main():
    reps = []
    only = sys.argv[1:] or None
    for f in sorted(os.listdir(TD)):
        if not f.endswith(".templateDef.json"):
            continue
        t = json.load(open(os.path.join(TD, f), encoding="utf-8"))
        if only and t["id"] not in only:
            continue
        try:
            r = build(t)
            print(f"{t['id']}: {r['bytes']['source'] // 1_000_000}MB → {r['bytes']['blank'] // 1000}KB, sst {r['sharedStrings']['before']}→{r['sharedStrings']['after']}, residue {len(r['siteWordResidue'])}")
        except Exception as e:
            import traceback; traceback.print_exc()
            r = {"id": t["id"], "error": repr(e)}
            print(f"{t['id']}: FAIL {e!r}")
        reps.append(r)
    json.dump(reps, open(os.path.join(OUT, "blankgen_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


main()
