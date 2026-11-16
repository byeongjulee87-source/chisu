/* K-FRM 인벤토리 자동 불러오기 (공공 API, 사용자 본인 인증키)
 *  - 건물: 브이월드 2D데이터 API 「건축물정보」(LT_C_BLDGINFO) — 건축물대장 주용도·구조·건축면적·사용승인일 + 건물 도형 (JSONP)
 *  - 집계구 인구: 통계청 SGIS 오픈API — 영역내 집계구 경계(userarea, cd=4) + 인구통계(searchpopulation)
 * 분석 좌표계(target) 범위 bbox만 조회한다.
 */
var AUTOINV = (function () {
  'use strict';
  var SGIS = 'https://sgisapi.mods.go.kr/OpenAPI3/';
  // 건축물대장 주용도코드(건축법 시행령 별표1 순서) → K-FRM 31개 용도
  var USE = { '01': '단독주택', '03': '1종근린생활시설', '04': '2종근린생활시설', '05': '문화및집회시설', '06': '종교시설', '07': '판매시설', '08': '운수시설',
    '09': '의료시설', '10': '교육연구시설', '11': '노유자시설', '12': '수련시설', '13': '운동시설', '15': '숙박시설', '16': '위락시설', '17': '일반공장', '18': '창고시설',
    '19': '위험물저장처리시설', '20': '자동차관련시설', '21': '동물및식물관련시설', '22': '분뇨쓰레기처리시설', '23': '교정및군사시설', '24': '방송통신시설', '25': '발전시설',
    '26': '묘지관련시설', '27': '관광휴게시설', '28': '장례시설', '29': '관광휴게시설' };
  function useName(code) {
    var c = String(code || '').replace(/\D/g, ''); if (!c) return null;
    if (c.length === 4) c = '0' + c;
    var g = c.slice(0, 2);
    if (g === '02') return c === '02001' ? '아파트' : '다세대주택/연립주택';
    if (g === '14') return c.slice(0, 3) === '141' ? '공공업무시설' : '일반업무시설';
    return USE[g] || null;
  }
  var seq = 0;
  function jsonp(url, ms) {
    return new Promise(function (ok, no) {
      var cb = '__chisu_cb' + (++seq) + '_' + Date.now(), s = document.createElement('script'), done = false;
      var end = function () { done = true; try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); };
      window[cb] = function (d) { if (done) return; end(); ok(d); };
      s.onerror = function () { if (done) return; end(); no(new Error('응답 없음(네트워크·차단)')); };
      setTimeout(function () { if (done) return; end(); no(new Error('응답 시간 초과')); }, ms || 30000);
      s.src = url + '&callback=' + cb; document.head.appendChild(s);
    });
  }
  function getJSON(url) { return fetch(url).then(function (r) { return r.json(); }); }
  function ringsOf(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }

  /* 건물: box=[x0,y0,x1,y1](target), tf: target→4326, back: 4326→target */
  function buildings(o) {
    var box = o.box, tile = 1200, tiles = [];
    for (var x = box[0]; x < box[2]; x += tile) for (var y = box[1]; y < box[3]; y += tile) tiles.push([x, y, Math.min(x + tile, box[2]), Math.min(y + tile, box[3])]);
    var seen = {}, feats = [], n = 0;
    var one = function (t, page) {
      var c = [o.tf([t[0], t[1]]), o.tf([t[2], t[1]]), o.tf([t[2], t[3]]), o.tf([t[0], t[3]])];
      var lo = Math.min.apply(null, c.map(function (p) { return p[0]; })), hi = Math.max.apply(null, c.map(function (p) { return p[0]; }));
      var la = Math.min.apply(null, c.map(function (p) { return p[1]; })), ha = Math.max.apply(null, c.map(function (p) { return p[1]; }));
      var url = 'https://api.vworld.kr/req/data?service=data&version=2.0&request=GetFeature&format=json&errorFormat=json&data=LT_C_BLDGINFO&size=1000&page=' + page +
        '&crs=EPSG:4326&geomFilter=BOX(' + [lo, la, hi, ha].map(function (v) { return v.toFixed(7); }).join(',') + ')' +
        '&columns=usability,strct_cd,archarea,useapr_day,bld_nm,ag_geom&key=' + encodeURIComponent(o.key) + (o.domain ? '&domain=' + encodeURIComponent(o.domain) : '');
      return jsonp(url).then(function (d) {
        var r = d && d.response; if (!r) throw new Error('브이월드 응답 형식 이상');
        if (r.status === 'NOT_FOUND') return;
        if (r.status !== 'OK') throw new Error('브이월드: ' + ((r.error && (r.error.text || r.error.code)) || r.status));
        var fs = (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
        fs.forEach(function (f) {
          var p = f.properties || {}, polys = ringsOf(f.geometry); if (!polys.length) return;
          var k = polys[0][0][0][0].toFixed(6) + ',' + polys[0][0][0][1].toFixed(6) + ',' + (p.archarea || ''); if (seen[k]) return; seen[k] = 1;
          var rings = polys[0].map(function (r) { return r.map(o.back); });
          feats.push({ props: { BDTYP: useName(p.usability), BDSTR: p.strct_cd, BD_F_AREA: +p.archarea || 0, USE_YEAR: String(p.useapr_day || '').slice(0, 4), NAME: p.bld_nm }, rings: rings, xy: o.centroid(rings) });
        });
        n += fs.length;
        var pg = r.page || {}; if (+pg.current < +pg.total && page < 40) return one(t, page + 1);
      });
    };
    var chain = Promise.resolve(), i = 0;
    tiles.forEach(function (t) { chain = chain.then(function () { o.prog && o.prog('건물 조회 ' + (++i) + '/' + tiles.length + ' 구역'); return one(t, 1); }); });
    return chain.then(function () { return feats; });
  }

  /* 집계구 인구: box(target), toU: target→5179, fromU: 5179→target, years: 시도 순서 */
  function population(o) {
    var token;
    return getJSON(SGIS + 'auth/authentication.json?consumer_key=' + encodeURIComponent(o.ckey) + '&consumer_secret=' + encodeURIComponent(o.csec)).then(function (a) {
      if (!a || +a.errCd !== 0 || !a.result) throw new Error('SGIS 인증 실패: ' + (a && a.errMsg));
      token = a.result.accessToken;
      var c = [o.toU([o.box[0], o.box[1]]), o.toU([o.box[2], o.box[1]]), o.toU([o.box[2], o.box[3]]), o.toU([o.box[0], o.box[3]])];
      var xs = c.map(function (p) { return p[0]; }), ys = c.map(function (p) { return p[1]; });
      return getJSON(SGIS + 'boundary/userarea.geojson?accessToken=' + token + '&cd=4&minx=' + Math.floor(Math.min.apply(null, xs)) + '&miny=' + Math.floor(Math.min.apply(null, ys)) +
        '&maxx=' + Math.ceil(Math.max.apply(null, xs)) + '&maxy=' + Math.ceil(Math.max.apply(null, ys)));
    }).then(function (b) {
      if (!b || +b.errCd !== 0) throw new Error('SGIS 집계구 경계: ' + (b && b.errMsg));
      var areas = (b.features || []).map(function (f) { return { code: String((f.properties || {}).adm_cd || ''), polys: ringsOf(f.geometry) }; }).filter(function (a) { return a.code && a.polys.length; });
      var emds = {}; areas.forEach(function (a) { emds[a.code.slice(0, 8)] = 1; });
      var pop = {}, years = o.years || [2024, 2023, 2022, 2021, 2020];
      var byEmd = function (cd) {
        var tryY = function (k) {
          if (k >= years.length) return;
          return getJSON(SGIS + 'stats/searchpopulation.json?accessToken=' + token + '&year=' + years[k] + '&adm_cd=' + cd + '&low_search=1').then(function (s) {
            var rs = (s && +s.errCd === 0 && s.result) || [];
            var hit = rs.filter(function (r) { return String(r.adm_cd).length > 8; });
            if (!hit.length) return tryY(k + 1);
            hit.forEach(function (r) { pop[String(r.adm_cd)] = +r.population || 0; });
            o.year = o.year || years[k];
          });
        };
        return tryY(0);
      };
      return Object.keys(emds).reduce(function (p, cd) { return p.then(function () { return byEmd(cd); }); }, Promise.resolve()).then(function () {
        var out = [], miss = 0;
        areas.forEach(function (a) {
          var v = pop[a.code]; if (v === undefined) { miss++; return; }
          // 여러 조각이면 조각 면적 비율로 인구를 나눔
          var parts = a.polys.map(function (pg) { var rings = pg.map(function (r) { return r.map(o.fromU); }); return { rings: rings, area: o.area(rings) }; });
          var tot = parts.reduce(function (s, q) { return s + q.area; }, 0) || 1;
          parts.forEach(function (q) { var w = v * q.area / tot; out.push({ props: { TOT_REG_CD: a.code, TOT_POP: w, VUL_POP: w * o.vul, GEN_POP: w * (1 - o.vul) }, rings: q.rings }); });
        });
        return { feats: out, areas: areas.length, missing: miss, year: o.year };
      });
    });
  }
  return { buildings: buildings, population: population, useName: useName, jsonp: jsonp };
})();
if (typeof module !== 'undefined') module.exports = AUTOINV;
