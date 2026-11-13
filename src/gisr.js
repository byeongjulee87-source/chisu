/* 하도버퍼링 → 침수심 → 구획 집계 (순수 JS, 좌표계는 미리 통일된 평면좌표 m)
 * sections : [{coords:[[x,y],...], wse:{20:EL, 30:EL, ...}}]   개수전 측점별 홍수위가 붙은 측선
 * contours : [{coords:[[x,y],...], z}]  수치지도 등고선,  points: [{x,y,z}] 표고점
 * zones    : [{rings:[[[x,y],...],...], district, cover}]  지구 × 토지피복 구획(서로 겹치지 않음)
 * 결과     : GIS 면적 행 [{T, district, depth, cover, area}]
 */
var GISR = (function () {
  'use strict';
  var CLASSES = ['0~0.5', '0.5~1.0', '1.0~2.0', '2.0~3.0', '3.0이상'];
  function cls(d) { return d < 0.5 ? 0 : d < 1 ? 1 : d < 2 ? 2 : d < 3 ? 3 : 4; }

  // ---- 구획 다각형을 격자에 칠하기(셀 중심 포함, 짝홀 규칙) ----
  function rasterZones(zones, cell) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    zones.forEach(function (z) { z.rings.forEach(function (r) { r.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }); }); });
    x0 = Math.floor(x0 / cell) * cell; y0 = Math.floor(y0 / cell) * cell;
    var nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1;
    var id = new Int32Array(nx * ny).fill(-1);
    zones.forEach(function (z, zi) {
      var by0 = Infinity, by1 = -Infinity;
      z.rings.forEach(function (r) { r.forEach(function (p) { if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; }); });
      var j0 = Math.max(0, Math.floor((by0 - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((by1 - y0) / cell));
      for (var j = j0; j <= j1; j++) {
        var yc = y0 + (j + 0.5) * cell, xs = [];
        z.rings.forEach(function (r) {
          for (var k = 0; k < r.length; k++) {
            var a = r[k], b = r[(k + 1) % r.length];
            if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
          }
        });
        xs.sort(function (p, q) { return p - q; });
        for (var m = 0; m + 1 < xs.length; m += 2) {
          var i0 = Math.max(0, Math.ceil((xs[m] - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[m + 1] - x0) / cell - 0.5));
          for (var i = i0; i <= i1; i++) id[j * nx + i] = zi;
        }
      }
    });
    return { x0: x0, y0: y0, nx: nx, ny: ny, cell: cell, id: id };
  }

  // ---- 수치지도 → 지반고: 4분면별 최근접 표고자료의 역거리 가중(등고선 계단현상 완화) ----
  function demSampler(contours, points, extent, opt) {
    var step = opt.densify || 5, R = opt.searchRadius || 300, bucket = opt.bucket || 25;
    var px = [], py = [], pz = [];
    var X0 = extent[0] - R, Y0 = extent[1] - R, X1 = extent[2] + R, Y1 = extent[3] + R;
    function add(x, y, z) { if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) { px.push(x); py.push(y); pz.push(z); } }
    contours.forEach(function (c) {
      var p = c.coords;
      for (var i = 0; i < p.length; i++) {
        add(p[i][0], p[i][1], c.z);
        if (i + 1 < p.length) {
          var dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1], L = Math.sqrt(dx * dx + dy * dy), n = Math.floor(L / step);
          for (var k = 1; k < n; k++) add(p[i][0] + dx * k / n, p[i][1] + dy * k / n, c.z);
        }
      }
    });
    (points || []).forEach(function (q) { add(q.x, q.y, q.z); });
    var gx = Math.ceil((X1 - X0) / bucket) + 1, gy = Math.ceil((Y1 - Y0) / bucket) + 1, grid = new Map();
    for (var i = 0; i < px.length; i++) {
      var key = Math.floor((px[i] - X0) / bucket) + Math.floor((py[i] - Y0) / bucket) * gx;
      var a = grid.get(key); if (!a) grid.set(key, a = []); a.push(i);
    }
    var maxRing = Math.ceil(R / bucket);
    return {
      count: px.length,
      at: function (x, y) {
        var bi = Math.floor((x - X0) / bucket), bj = Math.floor((y - Y0) / bucket);
        var best = [Infinity, Infinity, Infinity, Infinity], bz = [0, 0, 0, 0];
        for (var r = 0; r <= maxRing; r++) {
          for (var dj = -r; dj <= r; dj++) for (var di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            var a = grid.get((bi + di) + (bj + dj) * gx); if (!a) continue;
            for (var k = 0; k < a.length; k++) {
              var n = a[k], dx = px[n] - x, dy = py[n] - y, d = dx * dx + dy * dy, q = (dx >= 0 ? 0 : 1) + (dy >= 0 ? 0 : 2);
              if (d < best[q]) { best[q] = d; bz[q] = pz[n]; }
            }
          }
          // 4분면 모두 찾았고 다음 고리가 더 멀면 종료
          var far = (r * bucket) * (r * bucket);
          if (best.every(function (b) { return b < far; })) break;
        }
        var sw = 0, sz = 0;
        for (var q = 0; q < 4; q++) {
          if (!isFinite(best[q])) continue;
          if (best[q] < 1e-6) return bz[q];
          var w = 1 / best[q]; sw += w; sz += w * bz[q];
        }
        return sw ? sz / sw : NaN;
      }
    };
  }

  // ---- 하도버퍼링: 가장 가까운 두 측선 사이를 거리비로 선형보간 ----
  function segDist(x, y, s) {
    var best = Infinity, p = s.coords;
    for (var i = 0; i + 1 < p.length; i++) {
      var ax = p[i][0], ay = p[i][1], bx = p[i + 1][0], by = p[i + 1][1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      var t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  function nearestTwo(x, y, sections) {
    var i1 = -1, i2 = -1, d1 = Infinity, d2 = Infinity;
    for (var i = 0; i < sections.length; i++) {
      var d = segDist(x, y, sections[i]);
      if (d < d1) { i2 = i1; d2 = d1; i1 = i; d1 = d; } else if (d < d2) { i2 = i; d2 = d; }
    }
    return [i1, d1, i2, d2];
  }

  /* opt: {cell(m, 기본 1), Ts, maxDist(측선에서 이 거리 넘으면 제외, 기본 무제한), onProgress} */
  function run(sections, contours, points, zones, opt) {
    opt = opt || {};
    var cell = opt.cell || 1, Ts = opt.Ts, prog = opt.onProgress || function () {};
    var Z = rasterZones(zones, cell);
    var ext = [Z.x0, Z.y0, Z.x0 + Z.nx * cell, Z.y0 + Z.ny * cell];
    var dem = demSampler(contours, points, ext, opt);
    var acc = {}, area = cell * cell, stats = { cells: 0, wet: {}, demNaN: 0 };
    var pv = opt.previewT ? new Uint8Array(Z.nx * Z.ny) : null;   // 0=구획 밖, 1=마른 땅, 2~6=침수심 등급
    var DG = opt.keepDepth ? {} : null;
    Ts.forEach(function (T) { stats.wet[T] = 0; if (DG) DG[T] = new Float32Array(Z.nx * Z.ny); });
    for (var j = 0; j < Z.ny; j++) {
      if (j % 200 === 0) prog('침수심 계산 ' + Math.round(j / Z.ny * 100) + '%');
      for (var i = 0; i < Z.nx; i++) {
        var zi = Z.id[j * Z.nx + i]; if (zi < 0) continue;
        stats.cells++;
        var x = Z.x0 + (i + 0.5) * cell, y = Z.y0 + (j + 0.5) * cell;
        var g = dem.at(x, y); if (!isFinite(g)) { stats.demNaN++; continue; }
        var nt = nearestTwo(x, y, sections);
        if (opt.maxDist && nt[1] > opt.maxDist) continue;
        var w1 = nt[3] / (nt[1] + nt[3] || 1), z = zones[zi];
        if (pv) pv[j * Z.nx + i] = 1;
        Ts.forEach(function (T) {
          var h1 = sections[nt[0]].wse[T], h2 = nt[2] >= 0 ? sections[nt[2]].wse[T] : h1;
          if (h1 === undefined || h1 === null || isNaN(h1)) return;
          var h = (h2 === undefined || h2 === null || isNaN(h2)) ? h1 : w1 * h1 + (1 - w1) * h2;
          var d = h - g; if (d <= 0) return;
          if (DG) DG[T][j * Z.nx + i] = d;
          stats.wet[T]++;
          if (pv && T === opt.previewT) pv[j * Z.nx + i] = 2 + cls(d);
          var k = T + '|' + z.district + '|' + cls(d) + '|' + z.cover;
          acc[k] = (acc[k] || 0) + area;
        });
      }
    }
    var rows = Object.keys(acc).map(function (k) { var p = k.split('|'); return { T: +p[0], district: p[1], depth: CLASSES[+p[2]], cover: p[3], area: acc[k] }; });
    return { rows: rows, stats: stats, grid: { nx: Z.nx, ny: Z.ny, cell: cell, x0: Z.x0, y0: Z.y0 }, demPoints: dem.count, preview: pv,
      depth: DG, zid: DG ? Z.id : null };
  }

  // DXF(물량산출 파서 재사용 대신 경량 파서): 등고선(LWPOLYLINE/POLYLINE/LINE의 Z) · 표고점(INSERT/POINT) · 문자(TEXT)
  function parseDxf(text, opt) {
    opt = opt || {};
    var contourRe = opt.contourLayers || /^F00171/, spotRe = opt.spotLayers || /^F00272(17|14|11)?/;
    var L = text.split(/\r?\n/), out = { contours: [], points: [], lines: [], texts: [] }, inEnt = false;
    for (var i = 0; i + 1 < L.length; i += 2) {
      var c = L[i].trim(), v = L[i + 1].trim();
      if (c === '2' && v === 'ENTITIES') { inEnt = true; continue; }
      if (!inEnt || c !== '0') continue;
      if (v === 'ENDSEC') break;
      var type = v, j = i + 2, ly = '', xs = [], ys = [], zs = [], elev = null, txt = null, closed = false;
      if (type === 'POLYLINE') {   // 3D 폴리라인: VERTEX 들
        var lay0 = '', cl0 = false;
        while (j + 1 < L.length && L[j].trim() !== '0') { if (L[j].trim() === '8') lay0 = L[j + 1].trim(); else if (L[j].trim() === '70') cl0 = (+L[j + 1] & 1) === 1; j += 2; }
        var pts = [];
        while (j + 1 < L.length && !(L[j].trim() === '0' && L[j + 1].trim() === 'SEQEND')) {
          if (L[j].trim() === '0' && L[j + 1].trim() === 'VERTEX') {
            var vx = 0, vy = 0, vz = 0; j += 2;
            while (j + 1 < L.length && L[j].trim() !== '0') { var cc = L[j].trim(); if (cc === '10') vx = +L[j + 1]; else if (cc === '20') vy = +L[j + 1]; else if (cc === '30') vz = +L[j + 1]; j += 2; }
            pts.push([vx, vy, vz]);
          } else j += 2;
        }
        if (pts.length > 1) {
          if (contourRe.test(lay0)) out.contours.push({ layer: lay0, coords: pts.map(function (p) { return [p[0], p[1]]; }), z: pts[0][2] });
          else { var pc = pts.map(function (p) { return [p[0], p[1]]; }); if (cl0 && pc.length > 2) pc.push(pc[0]); out.lines.push({ layer: lay0, coords: pc, closed: cl0 }); }
        }
        i = j - 2; continue;
      }
      while (j + 1 < L.length && L[j].trim() !== '0') {
        var cd = L[j].trim(), val = L[j + 1];
        if (cd === '8') ly = val.trim();
        else if (cd === '10') xs.push(+val); else if (cd === '20') ys.push(+val); else if (cd === '30') zs.push(+val);
        else if (cd === '11') xs.push(+val); else if (cd === '21') ys.push(+val); else if (cd === '31') zs.push(+val);
        else if (cd === '38') elev = +val; else if (cd === '1') txt = val.trim(); else if (cd === '70') closed = (+val & 1) === 1;
        j += 2;
      }
      i = j - 2;
      var coords = xs.map(function (x, k) { return [x, ys[k]]; });
      if (type === 'LWPOLYLINE' || type === 'LINE') {
        var z = type === 'LWPOLYLINE' ? (elev !== null ? elev : (zs[0] || 0)) : (zs[0] || 0);
        if (closed && coords.length > 2) coords.push(coords[0]);
        if (contourRe.test(ly)) out.contours.push({ layer: ly, coords: coords, z: z });
        else out.lines.push({ layer: ly, coords: coords, closed: closed });
      } else if ((type === 'INSERT' || type === 'POINT') && spotRe.test(ly)) {
        out.points.push({ x: xs[0], y: ys[0], z: zs[0] || 0 });
      } else if ((type === 'TEXT' || type === 'MTEXT') && txt) {
        out.texts.push({ layer: ly, x: xs[0], y: ys[0], text: txt.replace(/\\[A-Za-z][^;]*;|[{}]/g, '') });
      }
    }
    return out;
  }

  // 측선 선과 측점 문자 연결(가장 가까운 선), 측점 문자열 정규화
  function stationKey(s) { var m = /(\d+)\s*\+\s*(\d+(?:\.\d+)?)/.exec(String(s || '')); return m ? (+m[1]) + '+' + (+m[2]) : null; }
  function joinStations(lines, texts) {
    return lines.map(function (ln) {
      var best = null, bd = Infinity;
      texts.forEach(function (t) { var k = stationKey(t.text); if (!k) return; var d = segDist(t.x, t.y, ln); if (d < bd) { bd = d; best = k; } });
      return { coords: ln.coords, station: best, labelDist: bd };
    });
  }
  return { run: run, parseDxf: parseDxf, joinStations: joinStations, stationKey: stationKey, demSampler: demSampler, rasterZones: rasterZones, CLASSES: CLASSES };
})();
if (typeof module !== 'undefined') module.exports = GISR;
