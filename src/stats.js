/* 통계연보(KOSIS 내려받기 엑셀·CSV 등) → 읍면동 통계
 * 표 모양이 제각각이므로: 읍면동 이름이 있는 행을 찾고, 그 위 머리행 글자(병합 칸 채움)로 열의 뜻을 판별한다.
 * 같은 항목이 여러 시점이면 가장 최근 연도 열을 쓴다.
 */
var STATS = (function () {
  'use strict';
  var LAND = ['대지', '답', '전', '과수원', '공장용지', '학교용지', '주차장', '주유소용지', '창고용지', '도로', '철도용지'];
  var HOUSE = { '단독주택': '단독주택', '아파트': '아파트', '연립주택': '연립주택', '다세대주택': '다세대주택' };
  var CROP = { '논벼': '논벼', '벼': '논벼', '미곡': '논벼', '겉보리': '겉보리', '쌀보리': '쌀보리', '마늘': '마늘', '양파': '양파', '고추': '고추', '참깨': '참깨', '콩': '콩' };
  // 산업대분류(현행 KSIC 포함) → 도구의 종사자 A~O(농림 B어업 C광업 D제조 E전기가스수도 F건설 G도소매 H숙박음식 I운수창고통신 J금융보험 K부동산사업서비스 L공공행정 M교육 N보건복지 O기타서비스)
  var IND = [[/농업|임업|농림/, 'A'], [/어업/, 'B'], [/광업/, 'C'], [/제조/, 'D'], [/전기|가스|수도|하수|폐기물|증기/, 'E'], [/건설/, 'F'], [/도매|소매/, 'G'],
    [/숙박|음식/, 'H'], [/운수|운송|창고|통신|정보/, 'I'], [/금융|보험/, 'J'], [/부동산|임대|전문|과학|기술서비스|사업시설|사업지원|사업서비스/, 'K'],
    [/공공행정|국방|사회보장행정/, 'L'], [/교육/, 'M'], [/보건|사회복지/, 'N'], [/예술|스포츠|여가|협회|단체|수리|개인서비스|기타|가구|국제|외국기관/, 'O']];

  function clean(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }
  function bare(v) { return clean(v).replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s/g, ''); }
  function numOf(v) { if (typeof v === 'number') return v; var s = clean(v).replace(/,/g, ''); if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN; return +s; }

  // 시트 → 2차원 배열(병합 칸은 왼쪽 위 값으로 채움)
  function grid(ws) {
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    (ws['!merges'] || []).forEach(function (m) {
      var v = (rows[m.s.r] || [])[m.s.c];
      for (var r = m.s.r; r <= m.e.r; r++) { rows[r] = rows[r] || []; for (var c = m.s.c; c <= m.e.c; c++) if (rows[r][c] === '' || rows[r][c] === undefined) rows[r][c] = v; }
    });
    return rows;
  }
  function yearOf(s) { var m = String(s).match(/(19|20)\d{2}/g); return m ? Math.max.apply(null, m.map(Number)) : 0; }
  function gender(tokens) { return tokens.some(function (t) { return /^(남|여|남자|여자)$/.test(t); }); }

  /* 한 시트: names(읍면동 이름들) → {이름: {필드…}}, cand: 필드별 후보 열 */
  function parseSheet(rows, names, sgg) {
    var want = {}; names.forEach(function (n) { want[bare(n)] = n; });
    // 데이터 행: 앞쪽 4칸 중 하나가 읍면동 이름
    var hit = [];
    rows.forEach(function (r, i) {
      for (var c = 0; c < Math.min(4, r.length); c++) { var b = bare(r[c]); if (want[b]) { hit.push({ i: i, name: want[b], nameCol: c, row: r }); break; } }
    });
    if (!hit.length) return {};
    // 머리행: 첫 데이터 행 위의 행 중 숫자가 거의 없는 행들(시군 합계 같은 데이터 행은 건너뜀)
    var first = Math.min.apply(null, hit.map(function (h) { return h.i; })), head = [];
    for (var i = 0; i < first; i++) {
      var r = rows[i] || [], nums = r.filter(function (v, c) { return c > 0 && isFinite(numOf(v)) && !/^\s*(19|20)\d{2}(\.\d{1,2})?\s*$/.test(String(v)); }).length;
      if (nums <= 1) head.push(r);
    }
    head = head.slice(-6);
    // 시점이 행으로 있는 표: 머리행에 '시점'/연도 열이 있으면 행의 연도 사용
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var cols = [];
    for (var c = 0; c < width; c++) {
      var toks = [], seen = {};
      head.forEach(function (r) { var t = clean(r[c]); if (t && !seen[t]) { seen[t] = 1; toks.push(t); } });
      cols.push({ c: c, toks: toks, bt: toks.map(bare), H: toks.join(' '), year: yearOf(toks.join(' ')) });
    }
    var rowYear = function (r) { var y = 0; r.forEach(function (v, c) { if (c < 4) { var t = yearOf(v); if (t && /^\s*(19|20)\d{2}/.test(String(v))) y = Math.max(y, t); } }); return y; };
    // 행에 붙은 분류 글자(산업분류·성별·시점 등이 행으로 있는 '긴' 표): 이름 오른쪽의 글자 칸
    var rowToks = function (h) { var t = []; for (var c = h.nameCol + 1; c < Math.min(h.nameCol + 4, h.row.length); c++) { var v = h.row[c]; if (typeof v === 'string' && v.trim() && !isFinite(numOf(v))) t.push(clean(v)); } return t; };
    // 이름별 행 묶음 — 시군구 이름이 함께 있는 행이 있으면 그 행만
    var byName = {};
    hit.forEach(function (h) { (byName[h.name] = byName[h.name] || []).push(h); });
    Object.keys(byName).forEach(function (n) {
      var hs = byName[n], ins = sgg ? hs.filter(function (h) { return h.row.slice(0, 4).some(function (v) { return clean(v).indexOf(sgg) >= 0; }); }) : [];
      if (ins.length) byName[n] = ins;
    });
    var out = {};
    Object.keys(byName).forEach(function (n) {
      var e = { land: {}, houses: {}, crops: {}, workers: {}, src: {} }, best = {}, ages = {};
      var put = function (key, sub, val, score, yr, label) {
        if (!isFinite(val)) return;
        var k = key + (sub ? '.' + sub : ''), b = best[k];
        if (b && (b.score > score || (b.score === score && b.yr > yr))) return;
        best[k] = { score: score, yr: yr };
        if (sub) e[key][sub] = val; else e[key] = val;
        e.src[k] = label;
      };
      byName[n].forEach(function (h) { var r = h.row, rt = rowToks(h), ry = rowYear(r);
      cols.forEach(function (col) {
        if (col.c <= h.nameCol || (!col.toks.length && !rt.length)) return;
        if (col.bt.some(function (t) { return /시점|연도|년도|행정구역|읍면동|시군구|산업분류|성별|구분/.test(t); }) && col.c < h.nameCol + 4) return;
        var v = numOf(r[col.c]); if (!isFinite(v)) return;
        var H = col.H + (rt.length ? ' ' + rt.join(' ') : ''), bt = col.bt.concat(rt.map(bare)), yr = Math.max(col.year, ry), lab = H;
        if (gender(bt)) return;
        var has = function (re) { return re.test(H); }, tok = function (w) { return bt.indexOf(w) >= 0; };
        var ag = ages[yr] = ages[yr] || {};
        // 세대·인구
        if (has(/세대/) && !has(/세대당|인구|원|주택|가구원/)) put('households', null, v, 1, yr, lab);
        if (has(/인구/) && !has(/세대당|밀도|증감|비율|구성비|%|율/)) put('population', null, v, (tok('계') || tok('소계') || tok('합계') || tok('총인구') ? 2 : 1) + (has(/등록인구|총인구/) ? 1 : 0) - (has(/외국인|한국인/) ? 3 : 0), yr, lab);
        // 연령: 0~4세, 65세 이상(5세 계급 합)
        var m = H.match(/(\d+)\s*[-~]\s*(\d+)\s*세/), m2 = H.match(/(\d+)\s*세\s*이상/);
        if (m && +m[1] === 0 && +m[2] === 4) ag.u5 = v;
        else if (m2 && +m2[1] === 65) ag.o65 = v;
        else if (m && +m[1] >= 65) { ag.bins = ag.bins || {}; ag.bins[m[1]] = v; }
        else if (m2 && +m2[1] > 65) { ag.bins = ag.bins || {}; ag.bins[m2[1]] = v; }
        // 행정구역 면적
        if (has(/면적/) && !LAND.some(tok) && !has(/주택|경지|재배|작물|필지|지목|건물|연면적/)) {
          var ha = has(/㎢|km/i) ? v * 100 : has(/천\s*㎡/) ? v / 10 : has(/㎡|m2/i) ? v / 1e4 : v;
          put('areaHa', null, ha, has(/행정/) ? 2 : 1, yr, lab);
        }
        // 지목(㎡): 같은 지목의 필지 열은 제외
        LAND.forEach(function (k) {
          if (!tok(k) || has(/필지|개수|건수/)) return;
          var f = has(/천\s*㎡/) ? 1000 : has(/㎢|km/i) ? 1e6 : has(/ha\b|헥타/i) ? 1e4 : 1;
          put('land', k, v * f, has(/면적/) ? 2 : 1, yr, lab);
        });
        // 주택유형(호)
        Object.keys(HOUSE).forEach(function (k) { if (tok(k) && !has(/면적|비율|%/)) put('houses', HOUSE[k], v, 1, yr, lab); });
        if (has(/비거주용|영업용/) && !has(/면적|비율|%/)) put('houses', '영업용', v, 1, yr, lab);
        // 농작물 재배면적(ha)
        Object.keys(CROP).forEach(function (k) {
          if (!tok(k) || has(/생산량|수량|톤|kg|단수|농가/)) return;
          var f = has(/㎡/) ? 1e-4 : has(/\ba\b|아르/) ? 0.01 : 1;
          put('crops', CROP[k], v * f, has(/면적/) ? 2 : 1, yr, lab);
        });
        // 산업별 종사자(명)
        if (has(/종사자/) && !tok('합계') && !has(/전산업|전체|총계|^계$/)) {
          var ind = IND.find(function (x) { return x[0].test(H.replace(/종사자\S*|사업체\S*/g, '')); });
          if (ind) { e.workers['_' + ind[1] + '|' + col.c + '|' + h.i] = { k: ind[1], v: v, yr: yr }; }
        }
      });
      });
      // 종사자: 같은 코드로 묶이는 여러 업종 합(최근 연도만)
      var wy = 0; Object.keys(e.workers).forEach(function (k) { if (k[0] === '_') wy = Math.max(wy, e.workers[k].yr); });
      var w = {}; Object.keys(e.workers).forEach(function (k) { if (k[0] !== '_') return; var o = e.workers[k]; if (o.yr === wy) w[o.k] = (w[o.k] || 0) + o.v; });
      e.workers = w; if (Object.keys(w).length) e.src.workers = '산업별 종사자' + (wy ? ' ' + wy : '');
      // 취약인구 = 0~4세 + 65세 이상 (가장 최근 연도)
      var ay = Object.keys(ages).map(Number).filter(function (y) { return ages[y].u5 !== undefined && (ages[y].o65 !== undefined || ages[y].bins); }).sort().pop();
      if (ay !== undefined) {
        var a = ages[ay], o65 = a.o65 !== undefined ? a.o65 : Object.keys(a.bins).reduce(function (s, k) { return s + a.bins[k]; }, 0);
        e.vulnerable = a.u5 + o65; e.src.vulnerable = '연령별 인구(0~4세 + 65세 이상)' + (ay ? ' ' + ay : '');
      }
      out[n] = e;
    });
    return out;
  }

  /* wb들 → {읍면동: 통계} (먼저 찾은 값이 우선이 아니라 항목별로 합침) */
  function parse(wbs, names, sgg) {
    var res = {};
    wbs.forEach(function (wb) {
      wb.SheetNames.forEach(function (sn) {
        var got = parseSheet(grid(wb.Sheets[sn]), names, sgg);
        Object.keys(got).forEach(function (n) {
          var e = res[n] = res[n] || { land: {}, houses: {}, crops: {}, workers: {}, src: {} }, g = got[n];
          ['households', 'population', 'vulnerable', 'areaHa'].forEach(function (k) { if (g[k] !== undefined) { e[k] = g[k]; e.src[k] = g.src[k] || sn; } });
          ['land', 'houses', 'crops', 'workers'].forEach(function (k) { Object.keys(g[k]).forEach(function (s) { e[k][s] = g[k][s]; }); if (Object.keys(g[k]).length) e.src[k] = sn; });
        });
      });
    });
    return res;
  }
  /* 읍면동 객체(p.emds[n])에 비어 있거나 0인 항목만 채움 → 채운 항목 이름 목록 */
  function fill(emd, st) {
    var done = [];
    ['households', 'population', 'vulnerable', 'areaHa'].forEach(function (k) { if (st[k] !== undefined && !(emd[k] > 0)) { emd[k] = st[k]; done.push({ households: '세대수', population: '인구', vulnerable: '취약인구', areaHa: '면적' }[k]); } });
    [['land', '지목'], ['houses', '주택'], ['crops', '농작물'], ['workers', '종사자']].forEach(function (x) {
      var n = 0; Object.keys(st[x[0]]).forEach(function (s) { emd[x[0]] = emd[x[0]] || {}; if (!(emd[x[0]][s] > 0)) { emd[x[0]][s] = st[x[0]][s]; n++; } });
      if (n) done.push(x[1] + ' ' + n);
    });
    return done;
  }
  return { parse: parse, parseSheet: parseSheet, fill: fill, grid: grid };
})();
if (typeof module !== 'undefined') module.exports = STATS;
