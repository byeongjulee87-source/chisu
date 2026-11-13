/* 침수면적 GIS 중첩: 지구계 × 빈도별 침수심도 × 토지피복도(환경부 중분류)
 * 결과 행: {T, district, depth, cls, cover, area(㎡)}  — 지구·빈도별 미분류(기타) 면적 포함
 * shpjs가 .prj를 읽어 WGS84로 바꾸므로 면적은 turf.area(측지 면적, ㎡)로 계산
 */
var GIS = (function () {
  'use strict';
  var L2 = { 110: '주거지역', 120: '공업지역', 130: '상업지역', 140: '문화·체육·휴양지역', 150: '교통지역', 160: '공공시설지역',
             210: '논', 220: '밭', 230: '시설재배지', 240: '과수원', 250: '기타재배지',
             310: '활엽수림', 320: '침엽수림', 330: '혼효림', 410: '자연초지', 420: '인공초지', 510: '내륙습지', 520: '연안습지',
             610: '자연나지', 620: '인공나지', 710: '내륙수', 720: '해양수' };
  var CLS = { '주거지역': '주거', '논': '논', '밭': '밭', '시설재배지': '밭', '과수원': '밭', '기타재배지': '밭', '공업지역': '산업', '상업지역': '산업' };

  function polys(fc) {
    var out = [];
    (fc.features || []).forEach(function (f) {
      if (!f.geometry) return;
      var t = f.geometry.type;
      if (t === 'Polygon' || t === 'MultiPolygon') out.push({ f: f, bb: turf.bbox(f) });
    });
    return out;
  }
  function hit(a, b) { return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]); }
  function inter(a, b) { try { return turf.intersect(a, b); } catch (e) { try { return turf.intersect(turf.buffer(a, 0), turf.buffer(b, 0)); } catch (e2) { return null; } } }
  function coverName(p, field) {
    var v = p[field];
    if (v === undefined || v === null) return '미분류';
    var n = +v;
    if (isFinite(n) && L2[n]) return L2[n];
    return String(v).trim();
  }
  function fields(fc) { var f = (fc.features || [])[0]; return f ? Object.keys(f.properties || {}) : []; }
  function guess(fc, re) { return fields(fc).find(function (k) { return re.test(k); }) || fields(fc)[0]; }

  /* opt: {districts:FC, districtField, cover:FC, coverField, floods:[{T, fc, depthField}], onProgress(msg)} */
  function overlay(opt) {
    var D = polys(opt.districts), C = polys(opt.cover);
    var acc = {}, prog = opt.onProgress || function () {};
    function add(T, d, depth, cover, a) {
      var k = T + '|' + d + '|' + depth + '|' + cover;
      acc[k] = (acc[k] || 0) + a;
    }
    opt.floods.forEach(function (fl, fi) {
      var F = polys(fl.fc);
      F.forEach(function (fp, i) {
        if (i % 50 === 0) prog(fl.T + '년 침수구역 ' + (i + 1) + '/' + F.length);
        var depth = String(fp.f.properties[fl.depthField]);
        D.forEach(function (dp) {
          if (!hit(fp.bb, dp.bb)) return;
          var I1 = inter(fp.f, dp.f); if (!I1) return;
          var a1 = turf.area(I1); if (a1 <= 0) return;
          var bb1 = turf.bbox(I1), covered = 0, name = String(dp.f.properties[opt.districtField]).trim();
          C.forEach(function (cp) {
            if (!hit(bb1, cp.bb)) return;
            var I2 = inter(I1, cp.f); if (!I2) return;
            var a2 = turf.area(I2); if (a2 <= 0) return;
            covered += a2;
            add(fl.T, name, depth, coverName(cp.f.properties, opt.coverField), a2);
          });
          if (a1 - covered > 0.5) add(fl.T, name, depth, '미분류', a1 - covered);
        });
      });
    });
    return Object.keys(acc).map(function (k) {
      var p = k.split('|');
      return { T: +p[0], district: p[1], depth: p[2], cover: p[3], cls: CLS[p[3]] || '기타', area: Math.round(acc[k] * 100) / 100 };
    });
  }
  return { overlay: overlay, fields: fields, guess: guess, L2: L2, CLS: CLS };
})();
