/* 한국 좌표계 인식·변환 (proj4js 필요)
 * .prj(WKT)의 매개변수로 EPSG를 찾아 datum 이동(towgs84)이 들어간 정의를 씀.  DXF는 좌표계가 없어 다른 층과 겹치는 후보를 고름.
 */
var CRS = (function () {
  'use strict';
  var BESSEL = '+ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
  var DEFS = {
    'EPSG:5186': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:5185': '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:5187': '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:5188': '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:5181': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:5179': '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
    'EPSG:5174': '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 ' + BESSEL,
    'EPSG:5173': '+proj=tmerc +lat_0=38 +lon_0=125.0028902777778 +k=1 +x_0=200000 +y_0=500000 ' + BESSEL,
    'EPSG:5176': '+proj=tmerc +lat_0=38 +lon_0=129.0028902777778 +k=1 +x_0=200000 +y_0=500000 ' + BESSEL,
    'EPSG:5177': '+proj=tmerc +lat_0=38 +lon_0=131.0028902777778 +k=1 +x_0=200000 +y_0=500000 ' + BESSEL,
    'EPSG:2097': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 ' + BESSEL,
    'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs'
  };
  var LABEL = { 'EPSG:5186': '중부원점(GRS80) 5186', 'EPSG:5185': '서부원점(GRS80) 5185', 'EPSG:5187': '동부원점(GRS80) 5187', 'EPSG:5188': '동해원점(GRS80) 5188',
    'EPSG:5181': '중부원점 50만(GRS80) 5181', 'EPSG:5179': 'UTM-K 5179', 'EPSG:5174': '보정 중부원점(Bessel) 5174', 'EPSG:5173': '보정 서부원점(Bessel) 5173',
    'EPSG:5176': '보정 동부원점(Bessel) 5176', 'EPSG:5177': '보정 동해원점(Bessel) 5177', 'EPSG:2097': '중부원점(Bessel) 2097', 'EPSG:4326': '경위도 WGS84' };
  if (typeof proj4 !== 'undefined') Object.keys(DEFS).forEach(function (k) { proj4.defs(k, DEFS[k]); });

  function param(wkt, name) { var m = new RegExp('PARAMETER\\["' + name + '",\\s*([-\\d.eE]+)', 'i').exec(wkt); return m ? +m[1] : null; }
  function fromWkt(wkt) {
    if (!wkt) return null;
    var m = /AUTHORITY\["EPSG","(\d+)"\]\s*\]\s*$/.exec(wkt.trim()); if (m && DEFS['EPSG:' + m[1]]) return 'EPSG:' + m[1];
    if (/GEOGCS/i.test(wkt) && !/PROJCS/i.test(wkt)) return 'EPSG:4326';
    var lon = param(wkt, 'central_meridian'), x0 = param(wkt, 'false_easting'), y0 = param(wkt, 'false_northing'), k = param(wkt, 'scale_factor');
    var bessel = /bessel/i.test(wkt);
    var best = null;
    Object.keys(DEFS).forEach(function (c) {
      var d = DEFS[c], g = function (p) { var mm = new RegExp('\\+' + p + '=([-\\d.]+)').exec(d); return mm ? +mm[1] : null; };
      if (/longlat/.test(d)) return;
      if (Math.abs(g('lon_0') - lon) < 1e-4 && Math.abs(g('x_0') - x0) < 1 && Math.abs(g('y_0') - y0) < 1 && Math.abs((g('k') || 1) - (k || 1)) < 1e-6 && (/bessel/.test(d) === bessel)) best = c;
    });
    return best;
  }
  function transformer(from, to) {
    if (!from || !to || from === to) return function (p) { return p; };
    var f = proj4(DEFS[from] || from, DEFS[to] || to);
    return function (p) { return f.forward([p[0], p[1]]); };
  }
  function bboxOf(list) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    list.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; });
    return b;
  }
  function overlap(a, b) { var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? w * h : 0; }
  // 좌표계 없는 자료(DXF)의 후보 중 기준 bbox(대상 좌표계)와 가장 많이 겹치는 것
  function guess(samplePts, refBox, target) {
    var best = null, bestA = 0;
    Object.keys(DEFS).forEach(function (c) {
      if (c === 'EPSG:4326') return;
      try {
        var t = transformer(c, target), bb = bboxOf(samplePts.map(t));
        var a = overlap(bb, refBox); if (a > bestA) { bestA = a; best = c; }
      } catch (e) {}
    });
    return best;
  }
  return { DEFS: DEFS, LABEL: LABEL, fromWkt: fromWkt, transformer: transformer, guess: guess, bboxOf: bboxOf };
})();
