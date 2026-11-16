"""src → ① ../치수경제성.html (로컬 단일 파일, 보고서 양식 내장)  ② ../구글스크립트/ (Apps Script 웹앱 파일)"""
import os, sys, json, base64, shutil
d = os.path.dirname(os.path.abspath(sys.argv[0] if sys.argv[0] else __file__))
root = os.path.dirname(d)
rd = lambda n: open(os.path.join(d, n), encoding='utf-8').read()
sample = json.loads(rd('sample.json'))
libs = ''.join('<script>\n' + rd(n) + '\n</script>\n' for n in ('crs.js', 'io.js', 'kfrm.js', 'autoinv.js', 'stats.js', 'qe.js', 'econ.js', 'gis.js', 'gisr.js', 'report.js'))
data = lambda sm: '<script>\nwindow.SAMPLE_DATA = ' + json.dumps(sm, ensure_ascii=False) + ';\n</script>\n'
code = libs
libs = code + data(sample)
app = rd('app.html')
assert '<!--LIBS-->' in app
tpl = open(os.path.join(d, 'template.hwpx'), 'rb').read()
tpljs = '<script>window.TPL_B64 = "' + base64.b64encode(tpl).decode() + '";</script>'
# 공개용(깃허브): 과업 자료(지구·읍면동·공사비·GIS·기존 엑셀 결과)는 빼고 계산 기준표(tables)만 넣음
# 공개용 예시: 과업 이름을 가상 이름으로 바꾸고(상두천→예시천, 정읍시→가상시, 산외면→가상면) 기존 엑셀 결과(v9)는 뺌
_t = json.dumps({k: v for k, v in sample.items() if k not in ('tables', 'v9', 'project')}, ensure_ascii=False)
for _a, _b in (('상두천', '예시천'), ('정읍시', '가상시'), ('산외면', '가상면')): _t = _t.replace(_a, _b)
pub = json.loads(_t); pub['tables'] = sample['tables']; pub['project'] = {'name': '예시천 치수경제성(예시)', 'river': '예시천'}
libs = code + data(pub)   # 모든 배포본(로컬·claude.ai·구글스크립트·깃허브)에 가상 이름 예시를 씀 — 원본 sample.json은 src에만 둠
public_page = app.replace('<!--LIBS-->', libs + tpljs)
if 'public' in sys.argv:   # 깃허브 저장소에서: python src/build.py public  →  ../index.html 만 만듦
    open(os.path.join(root, 'index.html'), 'w', encoding='utf-8', newline='\n').write(public_page)
    print('index.html', len(public_page)); sys.exit()
os.makedirs(os.path.join(root, '배포'), exist_ok=True)
open(os.path.join(root, '배포', 'index.html'), 'w', encoding='utf-8', newline='\n').write(public_page)

# ① 로컬
local = app.replace('<!--LIBS-->', libs + '<script>window.TPL_B64 = "' + base64.b64encode(tpl).decode() + '";</script>')
open(os.path.join(root, '치수경제성.html'), 'w', encoding='utf-8', newline='\n').write(local)

# ② 구글 스크립트
g = os.path.join(root, '구글스크립트'); os.makedirs(g, exist_ok=True)
open(os.path.join(g, 'index.html'), 'w', encoding='utf-8', newline='\n').write(app.replace('<!--LIBS-->', "<?!= include('lib'); ?>"))
open(os.path.join(g, 'lib.html'), 'w', encoding='utf-8', newline='\n').write(libs)
open(os.path.join(g, 'Code.gs'), 'w', encoding='utf-8', newline='\n').write('''/** 치수경제성 에이전트 — Google Apps Script 웹앱
 * 계산은 모두 브라우저에서 하고, 서버는 화면 제공과 보고서 양식(hwpx) 전달만 합니다.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('치수경제성 에이전트')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
/** 스크립트 속성 TEMPLATE_ID(구글 드라이브의 보고서 양식 hwpx 파일 ID)를 base64로 돌려줌 */
function getTemplate() {
  var id = PropertiesService.getScriptProperties().getProperty('TEMPLATE_ID');
  if (!id) throw new Error('스크립트 속성 TEMPLATE_ID가 설정되지 않았습니다.');
  return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes());
}
''')
shutil.copy(os.path.join(d, 'template.hwpx'), os.path.join(g, '치수경제성_보고서양식.hwpx'))
open(os.path.join(g, '설정방법.txt'), 'w', encoding='utf-8', newline='\r\n').write('''치수경제성 에이전트 — 구글 스크립트 웹앱 설정 (처음 한 번)

1. 구글 드라이브에 "치수경제성_보고서양식.hwpx"를 올립니다.
   파일 주소 https://drive.google.com/file/d/【여기가 파일 ID】/view 에서 ID를 복사합니다.

2. https://script.google.com 에서 [새 프로젝트]를 만들고 이름을 "치수경제성 에이전트"로 바꿉니다.

3. 파일 3개를 만듭니다(왼쪽 + 버튼).
   - Code.gs     : 이 폴더 Code.gs 내용을 붙여넣기 (기존 내용 지우고)
   - index (HTML): 이 폴더 index.html 내용을 붙여넣기
   - lib   (HTML): 이 폴더 lib.html 내용을 붙여넣기
   ※ HTML 파일 이름은 확장자 없이 index, lib 로 만듭니다.

4. 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성 → 속성 추가
   속성: TEMPLATE_ID   값: 1번에서 복사한 파일 ID

5. 오른쪽 위 [배포] → [새 배포] → 유형: 웹 앱
   - 다음 사용자 인증 정보로 실행: 나
   - 액세스 권한이 있는 사용자: 모든 사용자   ← 누구나 링크만으로 사용
   [배포] → 권한 승인(드라이브 읽기) → 웹 앱 URL을 복사해 공유합니다.

6. 고칠 때는 파일 내용을 바꾼 뒤 [배포] → [배포 관리] → 연필 → 버전: 새 버전 → [배포].
   (URL은 그대로 유지됩니다.)

사용법
- 화면에 아래 파일을 한꺼번에 끌어놓고 [분석하고 보고서 만들기].
  · 입력 엑셀(.xlsx): 지구(1.1 하천개수계획 현황 그대로) · 읍면동 · 공사비 · 홍수위(측점×빈도, 개수 전)
  · 측선: SHP(zip) 또는 DXF(측점 문자 포함) — SHP에 빈도별 홍수위 필드가 있으면 엑셀 홍수위 시트 생략
  · 수치지도 DXF: 등고선(F00171xx)·표고점(F00272xx) → 하도버퍼링으로 침수심 자동 계산
  · 지구계 SHP(zip) + 환경부 토지피복도 SHP(zip), 또는 둘을 합친 구획 SHP
  · (이미 구한 침수면적이 있으면 엑셀 GIS면적 시트로 대신할 수 있음)
- 결과 표 위의 버튼으로 "치수경제성 보고서(hwpx)"와 "결과 엑셀"을 내려받습니다.
- 회사 양식이 다르면 hwpx 양식 파일을 같이 끌어놓으면 그 양식으로 만듭니다.
- 입력양식은 화면의 [입력양식 내려받기]로 받습니다(상두천 예시가 채워져 있음).
''')
print('local', os.path.getsize(os.path.join(root, '치수경제성.html')), 'gas lib', os.path.getsize(os.path.join(g, 'lib.html')))

# ③ claude.ai 사이트(Artifact): 문서 뼈대는 게시할 때 붙으므로 빼고, 양식 내장
art = local
for s in ('<!doctype html>\n', '<html lang="ko">\n', '<head>\n', '<base target="_top">\n', '<meta charset="utf-8">\n',
          '<meta name="viewport" content="width=device-width, initial-scale=1">\n', '</head>\n', '<body>\n', '</body>\n', '</html>\n'):
    assert s in art, s
    art = art.replace(s, '', 1)
art = '<meta name="claude:viewport-fit-sides" content="cover">\n' + art
os.makedirs(os.path.join(root, '사이트'), exist_ok=True)
open(os.path.join(root, '사이트', '치수경제성.html'), 'w', encoding='utf-8', newline='\n').write(art)
print('site', len(art))
