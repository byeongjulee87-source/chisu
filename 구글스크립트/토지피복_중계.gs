/**
 * 치수경제성 — 환경부 토지피복도 중계 (구글 스크립트 웹앱)
 *
 * 환경부 환경공간정보서비스(api.mcee.go.kr) WFS는 다른 사이트에서 브라우저로 직접 읽는 것(CORS)을 막아 두어서,
 * 이 스크립트가 대신 받아 JSONP로 돌려줍니다. 환경부 WFS 주소만 중계합니다(다른 주소는 거절).
 *
 * 설정 (처음 한 번, 2분)
 *  1. https://script.google.com → [새 프로젝트] → 이름 "치수경제성 토지피복 중계"
 *  2. Code.gs 내용을 지우고 이 파일 내용을 붙여넣기 → 저장
 *  3. 오른쪽 위 [배포] → [새 배포] → 톱니(유형 선택) → 웹 앱
 *       - 다음 사용자 인증 정보로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자
 *     [배포] → 권한 승인(외부 서비스 연결) → "웹 앱 URL"(…/exec) 복사
 *  4. 치수경제성 사이트 [자동 불러오기 설정] → "토지피복 중계 URL"에 붙여넣기
 *     (사이트에 공용으로 넣으려면 그 URL을 알려주세요)
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var cb = String(p.callback || '');
  var body;
  if (!/^https:\/\/api\.mcee\.go\.kr\/geoserver\/wfs\?/.test(String(p.u || ''))) {
    body = JSON.stringify({ error: '환경부 WFS 주소만 중계합니다' });
  } else {
    try {
      var r = UrlFetchApp.fetch(p.u, { muteHttpExceptions: true, followRedirects: true });
      var t = r.getContentText('UTF-8');
      body = /^\s*\{/.test(t) ? t : JSON.stringify({ error: '환경부 응답 오류(' + r.getResponseCode() + '): ' + t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) });
    } catch (x) {
      body = JSON.stringify({ error: '환경부 서버 연결 실패: ' + x.message });
    }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + body + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}
