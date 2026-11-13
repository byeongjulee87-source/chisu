/* 파일 읽기: SHP(zip) 원좌표 유지 + 한글 dbf, DXF 텍스트 디코딩 */
var IO = (function () {
  'use strict';
  function decodeText(buf) {
    var u8 = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('euc-kr').decode(u8); }
  }
  function enc(cpg) {
    var c = String(cpg || '').trim().toLowerCase();
    if (!c || /949|euc|ks_c|korean|ansi/.test(c)) return 'euc-kr';
    if (/utf/.test(c)) return 'utf-8';
    return c;
  }
  /* zip 안의 SHP 레이어들 → [{name, fc(원좌표 GeoJSON), prj(WKT), crs}] */
  function readShpZip(buf) {
    return JSZip.loadAsync(buf).then(function (zip) {
      var shps = Object.keys(zip.files).filter(function (n) { return /\.shp$/i.test(n) && !/__MACOSX/.test(n); });
      return Promise.all(shps.map(function (n) {
        var base = n.replace(/\.shp$/i, ''), get = function (ext, type) { var f = zip.file(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.' + ext + '$', 'i'))[0]; return f ? f.async(type) : Promise.resolve(null); };
        return Promise.all([get('shp', 'arraybuffer'), get('dbf', 'arraybuffer'), get('prj', 'string'), get('cpg', 'string')]).then(function (a) {
          var geoms = shp.parseShp(a[0]);
          var props = a[1] ? (function () {
            var e = enc(a[3]), p;
            try { p = shp.parseDbf(a[1], e); } catch (x) { p = shp.parseDbf(a[1], 'euc-kr'); }
            return p;
          })() : geoms.map(function () { return {}; });
          var fc = shp.combine([geoms, props]);
          return { name: base.split('/').pop(), fc: fc, prj: a[2], crs: CRS.fromWkt(a[2]) };
        });
      }));
    });
  }
  function fields(fc) { var f = (fc.features || [])[0]; return f ? Object.keys(f.properties || {}) : []; }
  function values(fc, k, n) { return (fc.features || []).slice(0, n || 200).map(function (f) { return f.properties[k]; }); }
  function lineCoords(fc) {   // 선 → [[[x,y],...], ...]
    var out = [];
    (fc.features || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      if (g.type === 'LineString') out.push({ coords: g.coordinates, props: f.properties });
      else if (g.type === 'MultiLineString') g.coordinates.forEach(function (c) { out.push({ coords: c, props: f.properties }); });
    });
    return out;
  }
  function polyRings(fc) {   // 면 → [{rings, props}]
    var out = [];
    (fc.features || []).forEach(function (f) {
      var g = f.geometry; if (!g) return;
      if (g.type === 'Polygon') out.push({ rings: g.coordinates, props: f.properties, f: f });
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (c) { out.push({ rings: c, props: f.properties, f: { type: 'Feature', properties: f.properties, geometry: { type: 'Polygon', coordinates: c } } }); });
    });
    return out;
  }
  return { readShpZip: readShpZip, decodeText: decodeText, fields: fields, values: values, lineCoords: lineCoords, polyRings: polyRings };
})();
