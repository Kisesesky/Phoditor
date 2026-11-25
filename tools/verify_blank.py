import json,zipfile,re,html,os,posixpath
TD='/Users/hoya/사진관한다_작업건/template-specs/templateDefs'
BL=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','blanks')
reps={r['id']:r for r in json.load(open(os.path.join(BL,'blankgen_report.json')))}
def sheets(z):
    wb=z.read('xl/workbook.xml').decode(); rl=z.read('xl/_rels/workbook.xml.rels').decode(); out={}
    sst=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        sst=[html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>',si,re.S))) for si in re.findall(r'<si>.*?</si>|<si/>',z.read('xl/sharedStrings.xml').decode(),re.S)]
    for tg in re.findall(r'<sheet [^>]*/>',wb):
        a=dict(re.findall(r'([\w:]+)="([^"]*)"',tg))
        t=re.search(r'Target="([^"]+)"',re.search(r'<Relationship[^>]*Id="%s"[^>]*/>'%a['r:id'],rl).group(0)).group(1).lstrip('/')
        p=t if t.startswith('xl/') else 'xl/'+t; x=z.read(p).decode(); cells={}
        for cx in re.findall(r'<c [^>]*?(?:/>|>.*?</c>)',x,re.S):
            ad=re.search(r'\br="([A-Z]+\d+)"',cx).group(1); ty=re.search(r'\bt="(\w+)"',cx.split('>',1)[0]); v=re.search(r'<v>(.*?)</v>',cx)
            val=None
            if ty and ty.group(1)=='s' and v: val=sst[int(v.group(1))]
            elif ty and ty.group(1)=='inlineStr': val=html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>',cx,re.S)))
            elif v: val=v.group(1)
            if val not in (None,''): cells[ad]=val
        pics=0
        rp=posixpath.join(posixpath.dirname(p),'_rels',posixpath.basename(p)+'.rels')
        if rp in z.namelist():
            for m in re.finditer(r'Target="([^"]*drawings/drawing\d+\.xml)"',z.read(rp).decode()):
                dp=posixpath.normpath(posixpath.join(posixpath.dirname(p),m.group(1)))
                pics+=len(re.findall(r'<xdr:pic>',z.read(dp).decode()))
        out[html.unescape(a['name'])]=(cells,pics)
    return out
tot={'valuesLeft':0,'nonLabelText':0,'imgMismatch':0,'broken':0}
rows=[]
for f in sorted(os.listdir(TD)):
    if not f.endswith('.templateDef.json'): continue
    t=json.load(open(f'{TD}/{f}')); tid=t['id']; r=reps[tid]
    z=zipfile.ZipFile(os.path.join(BL,f'{tid}.xlsx')); S=sheets(z)
    vleft=[];nonlab=[];pics=0
    for s in t['sheets']:
        if s['name'] not in S: continue
        cells,p=S[s['name']]; pics+=p
        if s.get('role')!='block': continue
        b=s['block']; info=[x for x in r['sheets'] if x['sheet']==s['name']][0]; st=info['blockStart']; P=info['keptRows']
        lab={}
        for l in b['labels']:
            m=re.match(r'([A-Z]+)\{\+(\d+)\}',l['cell']); lab[f"{m.group(1)}{st+int(m.group(2))}"]=l['text']
        shift=info['blockStart']-info.get('chosenBlock',info['blockStart'])
        nums={re.sub(r'(\d+)$',lambda m:str(int(m.group(1))+shift),a) for a in info.get('numberCells',{})}
        for coll in ('values','repeatedValues'):
            for v in b.get(coll,[]):
                m=re.match(r'([A-Z]+)\{\+(\d+)\}',v['cell'])
                if not m: continue
                a=f"{m.group(1)}{st+int(m.group(2))}"
                if a in cells and a not in nums and a not in lab: vleft.append(f"{s['name']}!{a}")
        for a,v in cells.items():
            rr=int(re.sub('[A-Z]','',a))
            if st<=rr<st+P and a not in lab and a not in nums: nonlab.append(f"{s['name']}!{a}={v[:12]}")
    keep=len(t.get('keepImages') or [])
    tot['valuesLeft']+=len(vleft); tot['nonLabelText']+=len(nonlab); tot['imgMismatch']+=(pics!=keep); tot['broken']+=len(r.get('integrity',[]))
    rows.append((tid,len(vleft),len(nonlab),pics,keep,len(r.get('integrity',[])),r['bytes']['blank']))
    if vleft or nonlab or pics!=keep: print('!!',tid,vleft[:3],nonlab[:3],pics,keep)
for x in rows: print(f"{x[0]}: 값 잔여 {x[1]} / 라벨 외 글자 {x[2]} / 그림 {x[3]} = keepImages {x[4]} / 끊긴 연결 {x[5]} / {x[6]//1000}KB")
print('합계',tot)
