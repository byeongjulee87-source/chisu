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

  // 도로명주소 건물의 '건물명 설명'(buld_nm_dc) → 용도 (건축물대장 용도가 비어 있을 때)
  var DESC = [[/아파트/, '아파트'], [/연립|다세대|빌라/, '다세대주택/연립주택'], [/주택|가옥|폐가|페가|사택|관사/, '단독주택'],
    [/축사|우사|돈사|계사|양계|양돈|축산|버섯|온실|비닐하우스/, '동물및식물관련시설'], [/창고|저장|보관|곳간/, '창고시설'], [/공장|제조|정미소|방앗간/, '일반공장'],
    [/교회|성당|사찰|절$|암자|교당/, '종교시설'], [/병원|의원|보건/, '의료시설'], [/여관|모텔|호텔|민박|펜션|숙박/, '숙박시설'], [/학교|유치원|어린이집/, '교육연구시설'],
    [/경로당|노인|복지/, '노유자시설'], [/주유소|가스|충전소/, '위험물저장처리시설'], [/정비|세차|주차/, '자동차관련시설'], [/사무|업무|청사|주민센터|면사무소|우체국|파출소|지구대|소방/, '공공업무시설'],
    [/상가|가게|점$|마트|슈퍼|식당|음식|약국|미용|이용|세탁|회관|부동산|카페|다방/, '1종근린생활시설']];
  function descUse(s) { s = String(s || ''); for (var i = 0; i < DESC.length; i++) if (DESC[i][0].test(s)) return DESC[i][1]; return null; }
  function pip(x, y, r) { var c = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

  /* 한 레이어를 타일·페이지로 모두 받기 → [{p, rings(target)}] */
  function layer(o, data, cols, tiles) {
    var seen = {}, out = [];
    var one = function (t, page) {
      var c = [o.tf([t[0], t[1]]), o.tf([t[2], t[1]]), o.tf([t[2], t[3]]), o.tf([t[0], t[3]])];
      var lo = Math.min.apply(null, c.map(function (p) { return p[0]; })), hi = Math.max.apply(null, c.map(function (p) { return p[0]; }));
      var la = Math.min.apply(null, c.map(function (p) { return p[1]; })), ha = Math.max.apply(null, c.map(function (p) { return p[1]; }));
      var url = 'https://api.vworld.kr/req/data?service=data&version=2.0&request=GetFeature&format=json&errorFormat=json&data=' + data + '&size=1000&page=' + page +
        '&crs=EPSG:4326&geomFilter=BOX(' + [lo, la, hi, ha].map(function (v) { return v.toFixed(7); }).join(',') + ')' +
        (cols ? '&columns=' + cols : '') + '&key=' + encodeURIComponent(o.key) + (o.domain ? '&domain=' + encodeURIComponent(o.domain) : '');
      return jsonp(url).then(function (d) {
        var r = d && d.response; if (!r) throw new Error('브이월드 응답 형식 이상');
        if (r.status === 'NOT_FOUND') return;
        if (r.status !== 'OK') throw new Error('브이월드: ' + ((r.error && (r.error.text || r.error.code)) || r.status));
        ((r.result && r.result.featureCollection && r.result.featureCollection.features) || []).forEach(function (f) {
          var polys = ringsOf(f.geometry); if (!polys.length) return;
          var k = polys[0][0][0][0].toFixed(7) + ',' + polys[0][0][0][1].toFixed(7); if (seen[k]) return; seen[k] = 1;
          out.push({ p: f.properties || {}, rings: polys[0].map(function (rr) { return rr.map(o.back); }) });
        });
        var pg = r.page || {}; if (+pg.current < +pg.total && page < 40) return one(t, page + 1);
      });
    };
    var chain = Promise.resolve(), i = 0;
    tiles.forEach(function (t) { chain = chain.then(function () { o.prog && o.prog(data + ' ' + (++i) + '/' + tiles.length); return one(t, 1); }); });
    return chain.then(function () { return out; });
  }

  /* 건물: 건축물정보(건축물대장 속성) + 도로명주소 건물(용도 설명)으로 K-CDMS처럼 구성.
   * box=[x0,y0,x1,y1](target), tf: target→4326, back: 4326→target, area(rings) */
  function buildings(o) {
    var box = o.box, tile = 1200, tiles = [];
    for (var x = box[0]; x < box[2]; x += tile) for (var y = box[1]; y < box[3]; y += tile) tiles.push([x, y, Math.min(x + tile, box[2]), Math.min(y + tile, box[3])]);
    var B, S;
    return layer(o, 'LT_C_BLDGINFO', 'usability,strct_cd,archarea,useapr_day,bld_nm,ag_geom', tiles).then(function (b) { B = b; return layer(o, 'LT_C_SPBD', '', tiles).catch(function () { return []; }); })
      .then(function (s) {
        S = s.map(function (q) { var c = o.centroid(q.rings); return { p: q.p, rings: q.rings, c: c, bb: [Math.min.apply(null, q.rings[0].map(function (v) { return v[0]; })), Math.min.apply(null, q.rings[0].map(function (v) { return v[1]; })), Math.max.apply(null, q.rings[0].map(function (v) { return v[0]; })), Math.max.apply(null, q.rings[0].map(function (v) { return v[1]; }))] }; });
        var G = 50, idx = {}, key = function (x, y) { return Math.floor(x / G) + ',' + Math.floor(y / G); };
        S.forEach(function (s, i) { for (var gx = Math.floor(s.bb[0] / G); gx <= Math.floor(s.bb[2] / G); gx++) for (var gy = Math.floor(s.bb[1] / G); gy <= Math.floor(s.bb[3] / G); gy++) (idx[gx + ',' + gy] = idx[gx + ',' + gy] || []).push(i); });
        var st = { reg: 0, desc: 0, none: 0 }, feats = [];
        B.forEach(function (q) {
          var p = q.p, c = o.centroid(q.rings), use = useName(p.usability), src = 'reg';
          if (!use) {
            var m = (idx[key(c[0], c[1])] || []).map(function (i) { return S[i]; }).filter(function (s) { return pip(c[0], c[1], s.rings[0]); })[0];
            use = m ? descUse(m.p.buld_nm_dc) || descUse(m.p.buld_nm) || (m ? '단독주택' : null) : null;
            src = m ? 'desc' : 'none';
          }
          if (!use) { st.none++; return; }
          st[src]++;
          feats.push({ props: { BDTYP: use, BDSTR: p.strct_cd, BD_F_AREA: +p.archarea > 0 ? +p.archarea : 0, USE_YEAR: String(p.useapr_day || '').slice(0, 4), NAME: p.bld_nm }, rings: q.rings, xy: c });
        });
        feats.stats = st; feats.total = B.length; feats.spbd = S.length;
        return feats;
      });
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
