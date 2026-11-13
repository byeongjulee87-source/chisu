"""상두천 부록 제5장 hwpx → 보고서 템플릿(5.1~5.3만, 그림 BMP→PNG)  사용: prep_template.py 원본.hwpx 출력.hwpx"""
import sys, re, zipfile, io, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
files = {n: zin.read(n) for n in zin.namelist()}
x = files['Contents/section0.xml'].decode('utf-8')

# 최상위 문단 범위 찾기
def top_paras(s):
    i0 = s.index('>', s.index('<hs:sec')) + 1
    out, depth, start, i = [], 0, None, i0
    for m in re.finditer(r'<hp:p\b|</hp:p>', s[i0:]):
        pos = i0 + m.start()
        if m.group(0) == '<hp:p':
            if depth == 0: start = pos
            depth += 1
        else:
            depth -= 1
            if depth == 0: out.append((start, pos + len('</hp:p>')))
    return out
paras = top_paras(x)
def text(seg): return ''.join(re.findall(r'<hp:t>([^<]*)</hp:t>', seg))
cut = None; seen533 = False
for a, b in paras:
    t = text(x[a:b]).strip()
    if t.startswith('5.3.3'): seen533 = True
    if seen533 and t.startswith('5.4'):
        cut = a; break
assert cut, '5.4 위치 못 찾음'
end = paras[-1][1]
x = x[:cut] + x[end:]
print('cut at', cut, 'removed paragraphs after 5.3')
# ---- 독립 '치수경제성 분석 보고서'로: 장 표지·목차·5.2 소요재원 삭제, 제목·머리말·절 번호 정리 ----
paras = top_paras(x)
idx = lambda pred: next(i for i, (a, b) in enumerate(paras) if pred(text(x[a:b]).strip()))
h = idx(lambda t: t.startswith('제5장'))
heads = [i for i, (a, b) in enumerate(paras) if text(x[a:b]).strip().startswith('5.2 소요재원')]
heads3 = [i for i, (a, b) in enumerate(paras) if text(x[a:b]).strip().startswith('5.3 투자우선순위')]
s52, s53 = heads[-1], heads3[-1]          # 목차가 아닌 본문 쪽(마지막) 제목
cuts = [(paras[1][0], paras[h][0]), (paras[s52][0], paras[s53][0])]   # 0번 문단(구역 설정)은 남김
for a, b in sorted(cuts, reverse=True):
    x = x[:a] + x[b:]
x = x.replace('<hp:t>제5장 시행계획 및 기대효과</hp:t>', '<hp:t>{{TITLE}}</hp:t>')
# 제목 문단의 '쪽 나눔'을 꺼서 첫 쪽이 비지 않게
i = x.index('{{TITLE}}'); ps = x.rfind('<hp:p ', 0, i)
x = x[:ps] + x[ps:i].replace('pageBreak="1"', 'pageBreak="0"', 1) + x[i:]
# 절 번호 5.1→1, 5.3→2
def renum(m):
    t = m.group(1)
    t = re.sub(r'^5\.1\.(\d)', r'1.\1', t); t = re.sub(r'^5\.1(\s)', r'1.\1', t)
    t = re.sub(r'^5\.3\.(\d)', r'2.\1', t); t = re.sub(r'^5\.3(\s)', r'2.\1', t)
    return '<hp:t>' + t + '</hp:t>'
x = re.sub(r'<hp:t>(5\.[13](?:\.\d)?(?:\s[^<]*)?)</hp:t>', lambda m: renum(m) if not re.match(r'^5\.[13]$', m.group(1)) else '<hp:t>' + m.group(1).replace('5.1', '1.').replace('5.3', '2.') + '</hp:t>', x)
TM = r'(<hp:t>(?:<hp:titleMark[^>]*/>)?)'
x = re.sub(TM + r'5\.1\.(\d)', r'\g<1>1.\2', x); x = re.sub(TM + r'5\.3\.(\d)', r'\g<1>2.\2', x)
x = re.sub(TM + r'5\.1(\s)', r'\g<1>1.\2', x); x = re.sub(TM + r'5\.3(\s)', r'\g<1>2.\2', x)
x = x.replace('「5.2 소요재원 산정」에서', '공사비 산정에서')
# 머리말: 과업명 → {{TITLE}}, '05 시행계획 및 기대효과' → '치수경제성 분석'
def hdr(m):
    s = m.group(0)
    s = re.sub(r'<hp:t>[^<]*하천기본계획[^<]*</hp:t>', '<hp:t>{{TITLE}}</hp:t>', s)
    s = s.replace('<hp:t>0</hp:t>', '<hp:t></hp:t>').replace('<hp:t>5</hp:t>', '<hp:t></hp:t>').replace('<hp:t>시행계획 및 기대효과</hp:t>', '<hp:t>치수경제성 분석</hp:t>')
    return s
x = re.sub(r'<hp:header[\s\S]*?</hp:header>', hdr, x)
files['Contents/section0.xml'] = x.encode('utf-8')

# 사용 안 하는 그림 제거 대상 파악 후 BMP → PNG
hpf = files['Contents/content.hpf'].decode('utf-8')
used = set(re.findall(r'binaryItemIDRef="([^"]+)"', x))
for m in re.finditer(r'<opf:item [^>]*/>', hpf):
    it = m.group(0)
    iid = re.search(r'id="([^"]+)"', it).group(1); href = re.search(r'href="([^"]+)"', it).group(1)
    if not href.startswith('BinData/'): continue
    if iid not in used:
        hpf = hpf.replace(it, ''); files.pop(href, None); print('drop', href); continue
    if href.lower().endswith('.bmp'):
        im = Image.open(io.BytesIO(files[href])).convert('RGB')
        if im.width > 2400: im = im.resize((2400, int(im.height * 2400 / im.width)))
        b = io.BytesIO(); im.save(b, 'PNG', optimize=True); ext, mt = '.png', 'image/png'
        if len(b.getvalue()) > 1_000_000:          # 사진류는 JPEG
            b = io.BytesIO(); im.save(b, 'JPEG', quality=85); ext, mt = '.jpg', 'image/jpg'
        nh = href[:-4] + ext
        files.pop(href); files[nh] = b.getvalue()
        hpf = hpf.replace(it, it.replace(href, nh).replace('image/bmp', mt))
        print('png', nh, len(b.getvalue()))
files['Contents/content.hpf'] = hpf.encode('utf-8')
order = ['mimetype'] + [n for n in zin.namelist() if n != 'mimetype' and n in files] + [n for n in files if n not in zin.namelist()]
with zipfile.ZipFile(dst, 'w') as z:
    for n in order:
        z.writestr(n, files[n], compress_type=zipfile.ZIP_STORED if n == 'mimetype' else zipfile.ZIP_DEFLATED)
print('template', os.path.getsize(dst))
