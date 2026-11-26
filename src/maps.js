/* 위성 위치도 — 종합 위치도 1장 + 지구별 위치도 (A4 세로, 300dpi PNG)
 *  배경: 브이월드 위성(+하이브리드 지명) → 실패하면 Esri World Imagery
 *  M = {crs, dist:[{d, rings}], river:[[x,y]...], stations:[{p:[x,y], key}], basin:[ring...]}  (좌표 = 분석 좌표계)
 *  info = {title:[시도, 시군구, 읍면동], rows:[{name, len, cost, bc, score, rank, T, section}], taskLen, riverLen}
 */
var LOCMAP = (function () {
  var RE = 6378137, W = 2480, H = 3508, FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
  function merc(ll) { return [RE * ll[0] * Math.PI / 180, RE * Math.log(Math.tan(Math.PI / 4 + ll[1] * Math.PI / 360))]; }
  function img(url) { return new Promise(function (ok) { var im = new Image(); im.crossOrigin = 'anonymous'; var t = setTimeout(function () { ok(null); }, 20000); im.onload = function () { clearTimeout(t); ok(im); }; im.onerror = function () { clearTimeout(t); ok(null); }; im.src = url; }); }
  function url(src, z, x, y, key) {
    if (src === 'vsat') return 'https://api.vworld.kr/req/wmts/1.0.0/' + key + '/Satellite/' + z + '/' + y + '/' + x + '.jpeg';
    if (src === 'vhyb') return 'https://api.vworld.kr/req/wmts/1.0.0/' + key + '/Hybrid/' + z + '/' + y + '/' + x + '.png';
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
  }
  // 메르카토르 범위 mb=[x0,y0,x1,y1]를 rect=[px,py,w,h]에 그림
  function tiles(ctx, rect, mb, src, key, zmax) {
    var res = (mb[2] - mb[0]) / rect[2], z = Math.max(1, Math.min(zmax, Math.ceil(Math.log2(2 * Math.PI * RE / (256 * res)))));
    var n = 256 * Math.pow(2, z), C = 2 * Math.PI * RE;
    var wx = function (x) { return (x + Math.PI * RE) / C * n; }, wy = function (y) { return (Math.PI * RE - y) / C * n; };
    var X0 = wx(mb[0]), X1 = wx(mb[2]), Y0 = wy(mb[3]), Y1 = wy(mb[1]), sx = rect[2] / (X1 - X0), sy = rect[3] / (Y1 - Y0);
    var jobs = [], miss = 0, all = 0;
    for (var tx = Math.floor(X0 / 256); tx <= Math.floor(X1 / 256); tx++) for (var ty = Math.floor(Y0 / 256); ty <= Math.floor(Y1 / 256); ty++) (function (tx, ty) {
      all++;
      jobs.push(img(url(src, z, tx, ty, key)).then(function (im) {
        if (!im) { miss++; return; }
        ctx.drawImage(im, rect[0] + (tx * 256 - X0) * sx, rect[1] + (ty * 256 - Y0) * sy, 256 * sx + 0.6, 256 * sy + 0.6);
      }));
    })(tx, ty);
    return Promise.all(jobs).then(function () { return all ? miss / all : 1; });
  }
  function basemap(ctx, rect, mb, key, hybrid) {
    ctx.save(); ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip();
    ctx.fillStyle = '#3a4a3a'; ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
    var p = key ? tiles(ctx, rect, mb, 'vsat', key, 19) : Promise.resolve(1);
    return p.then(function (miss) {
      if (miss > 0.3) return tiles(ctx, rect, mb, 'esri', key, 19).then(function () { return 'Esri World Imagery'; });
      return (hybrid ? tiles(ctx, rect, mb, 'vhyb', key, 19) : Promise.resolve()).then(function () { return '브이월드 위성영상'; });
    }).then(function (s) { ctx.restore(); return s; });
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function halo(ctx, t, x, y, size, color, bold, align) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = size / 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); ctx.fillStyle = color; ctx.fillText(t, x, y);
  }
  function path(ctx, pts, close) { ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); if (close) ctx.closePath(); }
  function f(v, d) { return v === null || v === undefined || !isFinite(v) ? '-' : (+v).toLocaleString('ko-KR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }

  // 분석 좌표 → 메르카토르
  function prep(M) {
    var t = CRS.transformer(M.crs, 'EPSG:4326'), m = function (p) { return merc(t(p)); };
    return {
      dist: M.dist.map(function (q) { return { d: q.d, rings: q.rings.map(function (r) { return r.map(m); }) }; }),
      river: (M.river || []).map(m),
      stations: (M.stations || []).map(function (s) { return { p: m(s.p), key: s.key }; }),
      basin: (M.basin || []).map(function (r) { return r.map(m); }),
      ll: function (p) { return t(p); }, tm: m, smooth: true
    };
  }
  function smoothLine(a, win, pass) {
    if (a.length < 5) return a;
    for (var k = 0; k < pass; k++) {
      a = a.map(function (p, i) { if (i === 0 || i === a.length - 1) return p; var s = [0, 0], n = 0; for (var j = Math.max(0, i - win); j <= Math.min(a.length - 1, i + win); j++) { s[0] += a[j][0]; s[1] += a[j][1]; n++; } return [s[0] / n, s[1] / n]; });
    }
    return a;
  }
  function bboxOf(pts) { var b = [Infinity, Infinity, -Infinity, -Infinity]; pts.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }); return b; }
  function fit(b, rect, pad, minSpan) {
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, w = Math.max(b[2] - b[0], minSpan) * (1 + pad), h = Math.max(b[3] - b[1], minSpan) * (1 + pad), a = rect[2] / rect[3];
    if (w / h > a) h = w / a; else w = h * a;
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }
  // 지구별로 조각을 하나로 합침(자동 구획·피복 조각의 안쪽 경계선 제거) → [{d, polys:[[ring...],...]}]
  function merge(dist) {
    var by = {}, order = [];
    dist.forEach(function (q) { if (!by[q.d]) { by[q.d] = []; order.push(q.d); } by[q.d].push(q.rings); });
    return order.map(function (d) {
      var polys = by[d];
      if (typeof turf !== 'undefined' && turf.union && polys.length > 1) {
        try {
          var u = null;
          polys.forEach(function (r) { var f = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: r } }; u = u ? turf.union(u, f) || u : f; });
          var g = u.geometry; polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        } catch (e) { }
      }
      return { d: d, polys: polys };
    });
  }
  function polyPath(ctx, polys, P) {
    ctx.beginPath();
    polys.forEach(function (rings) { rings.forEach(function (r) { r.forEach(function (p, i) { var q = P(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }); });
  }
  // 하도버퍼링 침수심 격자 → 지구별 침수 범위(지형을 따라 그려짐)
  function floodStats(G, T, tm) {
    var D = G.depth[T], dn = G.zones.map(function (z) { return z.district; }), st = {}, s = Math.max(1, Math.ceil(Math.max(G.nx, G.ny) / 2600));
    for (var j = 0; j < G.ny; j += s) for (var i = 0; i < G.nx; i += s) {
      var k = j * G.nx + i; if (!(D[k] > 0)) continue; var z = G.zid[k]; if (z < 0) continue;
      var d = dn[z], a = st[d] || (st[d] = { n: 0, sx: 0, sy: 0, b: [Infinity, Infinity, -Infinity, -Infinity] });
      var x = G.x0 + (i + 0.5) * G.cell, y = G.y0 + (j + 0.5) * G.cell;
      a.n++; a.sx += x; a.sy += y; if (x < a.b[0]) a.b[0] = x; if (y < a.b[1]) a.b[1] = y; if (x > a.b[2]) a.b[2] = x; if (y > a.b[3]) a.b[3] = y;
    }
    Object.keys(st).forEach(function (d) { var a = st[d]; a.c = tm([a.sx / a.n, a.sy / a.n]); a.mb = [tm([a.b[0], a.b[1]]), tm([a.b[2], a.b[3]])]; });
    return { st: st, dn: dn, s: s };
  }
  // pick(d) → 0(그리지 않음)/1(강조)/2(흐리게)
  function maskCanvas(G, T, FG, pick, which) {
    var s = FG.s, W2 = Math.ceil(G.nx / s), H2 = Math.ceil(G.ny / s), c = document.createElement('canvas'); c.width = W2; c.height = H2;
    var x = c.getContext('2d'), im = x.createImageData(W2, H2), D = G.depth[T], any = false;
    for (var j = 0; j < G.ny; j += s) for (var i = 0; i < G.nx; i += s) {
      var k = j * G.nx + i; if (!(D[k] > 0) || G.zid[k] < 0) continue;
      if (pick(FG.dn[G.zid[k]]) !== which) continue;
      var o = ((j / s | 0) * W2 + (i / s | 0)) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = 255; any = true;
    }
    x.putImageData(im, 0, 0); return any ? c : null;
  }
  // 격자 마스크를 화면에 펴고(아핀) 흐림+문턱으로 가장자리를 매끈하게 → 채움 + 테두리
  function drawFlood(ctx, rect, G, mc, P, tm, fill, line, lw) {
    var c0 = P(tm([G.x0, G.y0])), c1 = P(tm([G.x0 + G.nx * G.cell, G.y0])), c2 = P(tm([G.x0, G.y0 + G.ny * G.cell]));
    var Wd = rect[2], Hd = rect[3], S = document.createElement('canvas'); S.width = Wd; S.height = Hd;
    var sx = S.getContext('2d'); sx.imageSmoothingEnabled = true; sx.filter = 'blur(2.5px)';
    sx.setTransform((c1[0] - c0[0]) / mc.width, (c1[1] - c0[1]) / mc.width, (c2[0] - c0[0]) / mc.height, (c2[1] - c0[1]) / mc.height, c0[0] - rect[0], c0[1] - rect[1]);
    sx.drawImage(mc, 0, 0); sx.setTransform(1, 0, 0, 1, 0, 0); sx.filter = 'none';
    var id = sx.getImageData(0, 0, Wd, Hd), a = id.data;
    for (var q = 3; q < a.length; q += 4) { var v = a[q]; a[q] = v < 90 ? 0 : v > 165 ? 255 : Math.round((v - 90) / 75 * 255); }
    sx.putImageData(id, 0, 0);
    var O = document.createElement('canvas'); O.width = Wd; O.height = Hd; var ox = O.getContext('2d');
    for (var t = 0; t < 16; t++) { var an = t * Math.PI / 8; ox.drawImage(S, Math.cos(an) * lw, Math.sin(an) * lw); }
    ox.globalCompositeOperation = 'source-in'; ox.fillStyle = line; ox.fillRect(0, 0, Wd, Hd);
    ox.globalCompositeOperation = 'destination-out'; ox.drawImage(S, 0, 0);
    sx.globalCompositeOperation = 'source-in'; sx.fillStyle = fill; sx.fillRect(0, 0, Wd, Hd);
    ctx.drawImage(S, rect[0], rect[1]); ctx.drawImage(O, rect[0], rect[1]);
  }
  var DEPTH = [[0.5, [255, 224, 178], '0.0 ~ 0.5 m'], [1.0, [255, 183, 77], '0.5 ~ 1.0 m'], [2.0, [255, 152, 0], '1.0 ~ 2.0 m'], [5.0, [239, 108, 0], '2.0 ~ 5.0 m'], [1e9, [191, 54, 12], '5.0 m 이상']];
  // 계획빈도 침수심(홍수위 − 지반고) → 단계별 색 격자 (pick(d) === 1 인 지구만)
  function depthCanvas(G, T, FG, pick) {
    var s = FG.s, W2 = Math.ceil(G.nx / s), H2 = Math.ceil(G.ny / s), c = document.createElement('canvas'); c.width = W2; c.height = H2;
    var x = c.getContext('2d'), im = x.createImageData(W2, H2), D = G.depth[T], any = false;
    for (var j = 0; j < G.ny; j += s) for (var i = 0; i < G.nx; i += s) {
      var k = j * G.nx + i, d = D[k]; if (!(d > 0) || G.zid[k] < 0 || pick(FG.dn[G.zid[k]]) !== 1) continue;
      var q = 0; while (d >= DEPTH[q][0]) q++;
      var col = DEPTH[q][1], o = ((j / s | 0) * W2 + (i / s | 0)) * 4; im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255; any = true;
    }
    x.putImageData(im, 0, 0); return any ? c : null;
  }
  function drawGrid(ctx, rect, G, mc, P, tm, alpha) {
    var c0 = P(tm([G.x0, G.y0])), c1 = P(tm([G.x0 + G.nx * G.cell, G.y0])), c2 = P(tm([G.x0, G.y0 + G.ny * G.cell]));
    ctx.save(); ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
    ctx.setTransform((c1[0] - c0[0]) / mc.width, (c1[1] - c0[1]) / mc.width, (c2[0] - c0[0]) / mc.height, (c2[1] - c0[1]) / mc.height, c0[0], c0[1]);
    ctx.drawImage(mc, 0, 0); ctx.restore();
  }
  var C = { river: '#1e5eff', zone: 'rgba(255,140,0,0.46)', zoneLine: '#ff8c00', focus: '#ff3b30', dim: '#1e3a8a', ink: '#1b2430', navy: '#1f3a5f' };

  function render(M0, info, opt) {
    opt = opt || {};
    var M = prep(M0), focus = opt.focus || null, key = opt.key || '';
    if (M.river.length >= 5) { M.river = smoothLine(M.river, 2, 3); M.stations.forEach(function (st, i) { if (M.river[i]) st.p = M.river[i]; }); }
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    var rows = focus ? info.rows.filter(function (r) { return r.name === focus; }) : info.rows;
    var noTbl = opt.noTable || (!focus && rows.length > 10);
    var mg = 90, headH = 230, rowH = rows.length > 14 ? 56 : 68, tblH = noTbl ? 0 : 70 + 84 + rowH * rows.length + 40;
    var rect = [mg, mg + headH, W - 2 * mg, H - 2 * mg - headH - (noTbl ? 50 : tblH + 40)];
    var ONLY = opt.only || null, inc = function (d) { return !ONLY || ONLY.indexOf(d) >= 0; };
    var Z = merge(M.dist).filter(function (q) { return inc(q.d); }), G = opt.grid, FG = G && G.depth && G.depth[opt.T] ? floodStats(G, opt.T, M.tm) : null;
    if (FG && !Object.keys(FG.st).length) FG = null;
    // 범위
    var dp = [];
    if (FG) Object.keys(FG.st).forEach(function (d) { if (inc(d) && (!focus || d === focus)) dp = dp.concat(FG.st[d].mb); });
    if (!dp.length) Z.forEach(function (q) { if (!focus || q.d === focus) q.polys.forEach(function (rs) { dp = dp.concat(rs[0]); }); });
    if (!focus && !(ONLY && dp.length)) dp = dp.concat(M.river);   // 일부 지구만 그릴 땐 그 지구들에 맞춰 확대
    if (!dp.length) dp = M.river.slice();
    var b = bboxOf(dp);
    if (!focus && M.basin.length) { var bb = bboxOf([].concat.apply([], M.basin)); if ((bb[2] - bb[0]) * (bb[3] - bb[1]) < 4 * (b[2] - b[0]) * (b[3] - b[1])) b = [Math.min(b[0], bb[0]), Math.min(b[1], bb[1]), Math.max(b[2], bb[2]), Math.max(b[3], bb[3])]; }
    var mb = fit(b, rect, focus ? 0.9 : 0.3, focus ? 500 : 800);
    var sx = rect[2] / (mb[2] - mb[0]), P = function (p) { return [rect[0] + (p[0] - mb[0]) * sx, rect[1] + (mb[3] - p[1]) * sx]; };
    var cy = (mb[1] + mb[3]) / 2, k = Math.cos(2 * Math.atan(Math.exp(cy / RE)) - Math.PI / 2);
    // ---- 머리글 ----
    var SIDO = { '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시', '광주': '광주광역시', '대전': '대전광역시', '울산': '울산광역시', '세종': '세종특별자치시', '경기': '경기도', '강원': '강원특별자치도', '충북': '충청북도', '충남': '충청남도', '전북': '전북특별자치도', '전남': '전라남도', '경북': '경상북도', '경남': '경상남도', '제주': '제주특별자치도' };
    var adm = (info.title || []).filter(Boolean).map(function (s, i) { return i === 0 && SIDO[s] ? SIDO[s] : s; }).join(' ');
    ctx.fillStyle = C.navy; ctx.fillRect(mg, mg, W - 2 * mg, 14);
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 84px ' + FONT; ctx.fillText(focus ? focus + ' 위치도' : (info.river ? info.river + ' ' : '') + '치수경제성 종합위치도', mg, mg + 130);
    ctx.font = '44px ' + FONT; ctx.fillStyle = '#5b6573'; ctx.fillText(adm + (focus && info.river ? '  ·  ' + info.river : ''), mg, mg + 200);
    return basemap(ctx, rect, mb, key, !focus).then(function (srcName) {
      ctx.save(); ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);   // 영상 살짝 어둡게 → 주제도가 또렷
      // 유역경계
      M.basin.forEach(function (r) {
        var pts = r.map(P);
        ctx.setLineDash([]); ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; path(ctx, pts, true); ctx.stroke();
        ctx.setLineDash([40, 14, 8, 14]); ctx.lineWidth = 5; ctx.strokeStyle = '#111'; path(ctx, pts, true); ctx.stroke(); ctx.setLineDash([]);
      });
      if (opt.overlay) drawOverlay(ctx, opt.overlay, P, M.tm, rect);   // 기존 위치도(삽도) 선
      // 분석지구: 침수심 격자가 있으면 계획빈도 침수 범위(지형을 따라), 없으면 구획 다각형
      if (FG) {
        var m1 = maskCanvas(G, opt.T, FG, function (d) { return !inc(d) ? 0 : !focus || d === focus ? 1 : 2; }, 1), m2 = focus ? maskCanvas(G, opt.T, FG, function (d) { return !inc(d) ? 0 : d === focus ? 1 : 2; }, 2) : null;
        if (m2) drawFlood(ctx, rect, G, m2, P, M.tm, 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.75)', 3);
        var dc = depthCanvas(G, opt.T, FG, function (d) { return !inc(d) ? 0 : !focus || d === focus ? 1 : 2; });
        if (dc) drawGrid(ctx, rect, G, dc, P, M.tm, 0.82);                 // 침수심 단계(주황)
        if (m1) drawFlood(ctx, rect, G, m1, P, M.tm, 'rgba(0,0,0,0)', focus ? C.focus : '#e65c00', focus ? 6 : 4);   // 지구 경계
      } else Z.forEach(function (q) {
        var on = !focus || q.d === focus;
        polyPath(ctx, q.polys, P); ctx.fillStyle = on ? C.zone : 'rgba(255,255,255,0.12)'; ctx.fill('evenodd');
        ctx.lineJoin = 'round'; ctx.lineWidth = on && focus ? 7 : 4; ctx.strokeStyle = on ? (focus ? C.focus : C.zoneLine) : 'rgba(255,255,255,0.6)'; ctx.stroke();
      });
      // 과업하천
      if (M.river.length > 1) {
        var rp = M.river.map(P); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; path(ctx, rp); ctx.stroke();
        ctx.lineWidth = 10; ctx.strokeStyle = C.river; path(ctx, rp); ctx.stroke();
      }
      // 측점: 500 m 단위(없으면 고르게) — 하천 방향으로 눕혀 쓰고 눈금 표시 (삽도 형식)
      var RV = M.river.map(P), ang = function (i) { var a = RV[Math.max(0, i - 1)], b = RV[Math.min(RV.length - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
      var inR = function (p) { return p[0] > rect[0] + 60 && p[0] < rect[0] + rect[2] - 60 && p[1] > rect[1] + 60 && p[1] < rect[1] + rect[3] - 60; };
      var sts = M.stations.map(function (s, i) { var m = /(\d+)\s*\+\s*(\d+)/.exec(s.key), km = m && m[2].length >= 3; return { i: i, p: RV[i], key: s.key, m: m ? (km ? +m[1] * 1000 + +m[2] : null) : null }; }).filter(function (s) { return s.p && inR(s.p); });
      var pick = sts.filter(function (s) { return s.m !== null && s.m % 500 === 0; });
      if (pick.length < 3) { pick = []; var want = focus ? 4 : 6; for (var i = 0; i < want && sts.length; i++) { var s0 = sts[Math.round(i * (sts.length - 1) / Math.max(1, want - 1))]; if (pick.indexOf(s0) < 0) pick.push(s0); } }
      var seenK = {}, kept = [];   // 같은 측점(양안 측선 등)·너무 가까운 것은 하나만
      pick = pick.filter(function (q) { if (seenK[q.key]) return false; if (kept.some(function (o) { return Math.hypot(o.p[0] - q.p[0], o.p[1] - q.p[1]) < 140; })) return false; seenK[q.key] = 1; kept.push(q); return true; });
      // 하천명 원문자 자리: 지도에 보이는 하천 구간(가장 긴 연속 구간)에 고르게(남·창·천 → 창은 남과 천 한가운데), 하천선 위
      var rname = String(info.river || '').replace(/\s/g, ''), NAMES = [];
      if (rname && RV.length > 1) {
        var runs = [], cur = [];
        RV.forEach(function (p) { if (p[0] > rect[0] + 70 && p[0] < rect[0] + rect[2] - 70 && p[1] > rect[1] + 70 && p[1] < rect[1] + rect[3] - 70) cur.push(p); else { if (cur.length) runs.push(cur); cur = []; } });
        if (cur.length) runs.push(cur);
        var VR = runs.sort(function (a, b) { return b.length - a.length; })[0] || RV;
        // 읽는 순서: 남북으로 흐르면 위→아래, 동서로 흐르면 왼→오른
        if (VR.length > 1) { var ddx = VR[VR.length - 1][0] - VR[0][0], ddy = VR[VR.length - 1][1] - VR[0][1]; if (Math.abs(ddy) >= Math.abs(ddx) ? ddy < 0 : ddx < 0) VR = VR.slice().reverse(); }
        if (VR.length > 1) {
          var cum = [0]; for (var q = 1; q < VR.length; q++) cum.push(cum[q - 1] + Math.hypot(VR[q][0] - VR[q - 1][0], VR[q][1] - VR[q - 1][1]));
          var LL = cum[cum.length - 1], chs = rname.split('');
          chs.forEach(function (c, j) {
            var d = LL * (j + 1) / (chs.length + 1), qq = 1; while (qq < cum.length - 1 && cum[qq] < d) qq++;
            var ff = (d - cum[qq - 1]) / ((cum[qq] - cum[qq - 1]) || 1), pt = [VR[qq - 1][0] + ff * (VR[qq][0] - VR[qq - 1][0]), VR[qq - 1][1] + ff * (VR[qq][1] - VR[qq - 1][1])];
            if (inR(pt)) NAMES.push({ c: c, p: pt });
          });
        }
      }
      // 측점: 원문자와 겹치는 것은 빼고 그림(하천명이 우선)
      pick.forEach(function (s) {
        var a = ang(s.i), nx0 = -Math.sin(a), ny0 = Math.cos(a), lc = [s.p[0] + nx0 * 44, s.p[1] + ny0 * 44];
        var near = NAMES.some(function (n) { return [s.p, lc, [lc[0] + Math.cos(a) * 70, lc[1] + Math.sin(a) * 70], [lc[0] - Math.cos(a) * 70, lc[1] - Math.sin(a) * 70]].some(function (o) { return Math.hypot(o[0] - n.p[0], o[1] - n.p[1]) < 100; }); });
        if (near) return;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(s.p[0] - nx0 * 22, s.p[1] - ny0 * 22); ctx.lineTo(s.p[0] + nx0 * 22, s.p[1] + ny0 * 22); ctx.stroke();
        ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
        var t = 'NO.' + s.key, ta = a; if (ta > Math.PI / 2) ta -= Math.PI; if (ta < -Math.PI / 2) ta += Math.PI;
        ctx.save(); ctx.translate(lc[0], lc[1]); ctx.rotate(ta);
        halo(ctx, t, 0, 0, 28, '#ffffff', true); ctx.restore();
      });
      // 하천명 원문자 그리기
      NAMES.forEach(function (n) {
        var x = n.p[0], y = n.p[1];
        var g = ctx.createRadialGradient(x - 12, y - 14, 4, x, y, 42); g.addColorStop(0, '#7f9bff'); g.addColorStop(1, '#1530b8');
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.beginPath(); ctx.arc(x, y, 40, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.restore();
        ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 40, 0, 7); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 44px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n.c, x, y + 2);
      });
      // 지구 이름표
      var boxes = [[rect[0] + 20, rect[1] + 20, 460, 500], [rect[0] + rect[2] - 330, rect[1], 330, 380], [rect[0] + rect[2] - 690, rect[1] + rect[3] - (FG ? 800 : 520), 690, FG ? 800 : 520]], cen = function (polys) { var p = bboxOf([].concat.apply([], polys.map(function (rs) { return rs[0]; }))); return [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2]; };
      var rc = M.river.length ? P(cen([[M.river]])) : [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
      var many = !focus && Z.length > 10, LS = many ? (Z.length > 20 ? 0.7 : 0.8) : 1;
      Z.forEach(function (q) {
        if (focus && q.d !== focus) return;
        var row = info.rows.filter(function (r) { return r.name === q.d; })[0] || {};
        var c = P(FG && FG.st[q.d] ? FG.st[q.d].c : cen(q.polys)), dx = c[0] - rc[0], dy = c[1] - rc[1], L = Math.hypot(dx, dy) || 1, off = focus ? 300 : 210;
        var l1 = q.d, l2 = row.section ? 'No.' + String(row.section).replace(/^NO\.?\s*/i, '') : '';
        var sc = LS, F1 = Math.round(36 * sc), F2 = Math.round(30 * sc);
        ctx.font = 'bold ' + F1 + 'px ' + FONT; var w1 = ctx.measureText(l1).width; ctx.font = F2 + 'px ' + FONT; var w2 = ctx.measureText(l2).width;
        var w = Math.max(w1, w2) + 40 * sc, h = l2 ? Math.round(96 * sc) : Math.round(60 * sc), hb = Math.round(52 * sc);
        // 하천에서 가장 가까운 점·방향 → 지구 쪽으로 수직 띄움
        var nx = dx / L, ny = dy / L, tx = -ny, ty = nx, base = c;
        if (RV.length > 1) {
          var bi = 0, bd = Infinity; RV.forEach(function (p, i) { var d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; bi = i; } });
          var a = RV[Math.max(0, bi - 2)], b2 = RV[Math.min(RV.length - 1, bi + 2)], tl = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1;
          tx = (b2[0] - a[0]) / tl; ty = (b2[1] - a[1]) / tl; nx = -ty; ny = tx;
          if ((c[0] - RV[bi][0]) * nx + (c[1] - RV[bi][1]) * ny < 0) { nx = -nx; ny = -ny; }
          base = [RV[bi][0] + nx * Math.max(bd, 40), RV[bi][1] + ny * Math.max(bd, 40)];
        }
        off = focus ? 260 : (many ? 120 : 190);
        var place = function (k) { var sx2 = base[0] + nx * (off + w / 2 * Math.abs(nx) + h / 2 * Math.abs(ny)) + tx * k, sy2 = base[1] + ny * (off + w / 2 * Math.abs(nx) + h / 2 * Math.abs(ny)) + ty * k;
          return [Math.min(Math.max(sx2 - w / 2, rect[0] + 20), rect[0] + rect[2] - w - 20), Math.min(Math.max(sy2 - h / 2, rect[1] + 20), rect[1] + rect[3] - h - 20)]; };
        var hit = function (q2) { return boxes.some(function (o) { return q2[0] < o[0] + o[2] + 10 && o[0] < q2[0] + w + 10 && q2[1] < o[1] + o[3] + 10 && o[1] < q2[1] + h + 10; }); };
        var pos = place(0);
        for (var it = 1; it < 40 && hit(pos); it++) pos = place((it % 2 ? 1 : -1) * Math.ceil(it / 2) * (Math.abs(tx) * (w + 12) + Math.abs(ty) * (h + 12)) * 0.9);
        var bx = pos[0], by = pos[1];
        boxes.push([bx, by, w, h]);
        var ex = Math.min(Math.max(c[0], bx), bx + w), ey = Math.min(Math.max(c[1], by), by + h);
        ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.arc(c[0], c[1], 7, 0, 7); ctx.fill();
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3; rr(ctx, bx, by, w, h, 8); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        if (l2) { ctx.save(); rr(ctx, bx, by, w, h, 8); ctx.clip(); ctx.fillStyle = '#ffd9e6'; ctx.fillRect(bx, by + hb, w, h - hb); ctx.restore(); }
        rr(ctx, bx, by, w, h, 8); ctx.lineWidth = 4; ctx.strokeStyle = focus ? C.focus : '#e0115f'; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = C.ink; ctx.font = 'bold ' + F1 + 'px ' + FONT; ctx.fillText(l1, bx + w / 2, by + (l2 ? hb / 2 + 2 : h / 2));
        if (l2) { ctx.font = 'bold ' + F2 + 'px ' + FONT; ctx.fillStyle = '#c4004a'; ctx.fillText(l2, bx + w / 2, by + hb + (h - hb) / 2); }
      });
      // 과업연장·하천연장 치수선
      if (!focus && M.river.length > 1) {
        var yb = bboxOf(M.river.map(P)), RB = rect[0] + rect[2], BT = rect[1] + rect[3];
        var xr = Math.min(yb[2] + 150, RB - 260);
        if (xr > RB - 760 && yb[3] > BT - (FG ? 820 : 330)) xr = Math.max(yb[0] - 150, rect[0] + 180);
        var dim = function (x, y0, y1, color, t1, t2) {
          ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
          [[y0, 1], [y1, -1]].forEach(function (a) { ctx.beginPath(); ctx.moveTo(x, a[0]); ctx.lineTo(x - 13, a[0] + 26 * a[1]); ctx.lineTo(x + 13, a[0] + 26 * a[1]); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x - 34, a[0]); ctx.lineTo(x + 34, a[0]); ctx.stroke(); });
          ctx.font = 'bold 36px ' + FONT; var w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 44, h = 108, by = (y0 + y1) / 2 - h / 2;
          rr(ctx, x - w / 2, by, w, h, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
          ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t1, x, by + 32); ctx.font = '34px ' + FONT; ctx.fillText(t2, x, by + 76);
        };
        var inView = yb[1] >= rect[1] + 30 && yb[3] <= rect[1] + rect[3] - 30;
        if (info.taskLen && inView) dim(xr, yb[1], yb[3], C.dim, '과업연장', 'L = ' + info.taskLen + ' km');
        else if (info.taskLen) {   // 하천이 지도 밖으로 이어지면 치수선 대신 글상자
          ctx.font = 'bold 36px ' + FONT; var t1 = '과업연장', t2 = 'L = ' + info.taskLen + ' km', bw = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 60, bx0 = rect[0] + rect[2] - bw - 40, by0 = rect[1] + 420;
          rr(ctx, bx0, by0, bw, 108, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.dim; ctx.stroke();
          ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t1, bx0 + bw / 2, by0 + 32); ctx.font = '34px ' + FONT; ctx.fillText(t2, bx0 + bw / 2, by0 + 76);
        }
        if (info.riverLen) dim(Math.min(xr + 260, RB - 140), Math.max(rect[1] + 60, yb[1] - 110), Math.min(BT - 60, yb[3] + 110), '#c81e1e', '하천연장', 'L = ' + info.riverLen + ' km');
      }
      ctx.restore();
      // 방위표 (영등지구 삽도와 같은 나침반)
      var K = 0.44, NL = 270 * K, nx = rect[0] + rect[2] - (NL + 20 * K) - 40, ny = rect[1] + NL + 120 * K + 95;
      var star = function (rot, Lr, w, c1, c2) {
        for (var q = 0; q < 4; q++) {
          var th = rot + q * Math.PI / 2, tp = [nx + Lr * Math.sin(th), ny - Lr * Math.cos(th)];
          var l = [nx + w * Math.sin(th - Math.PI / 2), ny - w * Math.cos(th - Math.PI / 2)], r = [nx + w * Math.sin(th + Math.PI / 2), ny - w * Math.cos(th + Math.PI / 2)];
          [[[nx, ny], l, tp, c1], [[nx, ny], tp, r, c2]].forEach(function (t) { ctx.beginPath(); ctx.moveTo(t[0][0], t[0][1]); ctx.lineTo(t[1][0], t[1][1]); ctx.lineTo(t[2][0], t[2][1]); ctx.closePath(); ctx.fillStyle = t[3]; ctx.fill(); });
        }
      };
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(nx, ny, 165 * K, 0, 7); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 26 * K; ctx.beginPath(); ctx.arc(nx, ny, 140 * K, 0, 7); ctx.stroke();
      star(Math.PI / 4, 200 * K, 40 * K, 'rgb(30,30,30)', 'rgb(235,235,235)');
      star(0, NL + 20 * K, 74 * K, '#fff', '#fff'); star(0, NL, 56 * K, 'rgb(25,25,25)', 'rgb(200,200,200)');
      ctx.font = 'bold ' + Math.round(150 * K) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = 28 * K; ctx.strokeStyle = '#fff'; ctx.strokeText('N', nx, ny - NL - 120 * K); ctx.fillStyle = 'rgb(225,20,30)'; ctx.fillText('N', nx, ny - NL - 120 * K);
      // 범례 + 축척 (한 패널, 오른쪽 아래)
      var mpp = 1 / sx * k, target = 420 * mpp, nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].filter(function (v) { return v <= target; }).pop() || 50, sw = nice / mpp;
      var items = [['line', C.river, '과업하천']]; if (M.basin.length) items.push(['dash', '#111', '유역경계']);
      if (FG) { items.push(['edge', '#e65c00', focus ? '해당 지구 경계' : '분석지구 경계']); DEPTH.forEach(function (q) { items.push(['sw', 'rgb(' + q[1].join(',') + ')', '침수심 ' + q[2]]); }); }
      else items.push(['fill', C.zone, focus ? '해당 지구' : '분석지구']); if (focus) items.push(['fill2', 'rgba(255,255,255,0.3)', '기타 지구']);
      var pw = 640, rh2 = 60, ph = 70 + 52 + items.length * rh2 + 130, px = rect[0] + rect[2] - pw - 28, py = rect[1] + rect[3] - ph - 28;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14; rr(ctx, px, py, pw, ph, 12); ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill(); ctx.restore();
      ctx.fillStyle = C.ink; ctx.font = 'bold 36px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('범    례', px + pw / 2, py + 40);
      var tx = px + 24, tw2 = pw - 48, c1w = 250, ty2 = py + 70;
      ctx.fillStyle = '#e4e8ee'; ctx.fillRect(tx, ty2, tw2, 52);
      ctx.fillStyle = C.ink; ctx.font = 'bold 30px ' + FONT; ctx.fillText('기    호', tx + c1w / 2, ty2 + 26); ctx.fillText('내    용', tx + c1w + (tw2 - c1w) / 2, ty2 + 26);
      ctx.strokeStyle = '#8b95a1'; ctx.lineWidth = 2; ctx.strokeRect(tx, ty2, tw2, 52 + items.length * rh2); ctx.beginPath(); ctx.moveTo(tx + c1w, ty2); ctx.lineTo(tx + c1w, ty2 + 52 + items.length * rh2); ctx.stroke();
      items.forEach(function (it, i) {
        var y = ty2 + 52 + i * rh2 + rh2 / 2, x = tx + 50;
        ctx.strokeStyle = '#c9d0d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty2 + 52 + i * rh2); ctx.lineTo(tx + tw2, ty2 + 52 + i * rh2); ctx.stroke();
        ctx.save();
        if (it[0] === 'sw') { ctx.fillStyle = it[1]; ctx.globalAlpha = 0.9; ctx.fillRect(x, y - 16, 150, 32); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(x, y - 16, 150, 32); }
        else if (it[0] === 'edge') { ctx.strokeStyle = focus ? C.focus : it[1]; ctx.lineWidth = 6; ctx.strokeRect(x + 3, y - 13, 144, 26); }
        else if (it[0] === 'fill' || it[0] === 'fill2') { ctx.fillStyle = it[0] === 'fill' ? 'rgba(255,140,0,0.8)' : '#cfd5dc'; ctx.fillRect(x, y - 16, 150, 32); ctx.strokeStyle = it[0] === 'fill' ? (focus ? C.focus : '#e65c00') : '#9aa3ad'; ctx.lineWidth = 3; ctx.strokeRect(x, y - 16, 150, 32); }
        else { ctx.strokeStyle = it[1]; ctx.lineWidth = it[0] === 'line' ? 12 : 6; if (it[0] === 'dash') ctx.setLineDash([30, 10, 6, 10]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 150, y); ctx.stroke(); }
        ctx.restore();
        ctx.fillStyle = C.ink; ctx.font = '32px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it[2].length <= 5 ? it[2].split('').join(' ') : it[2], tx + c1w + (tw2 - c1w) / 2, y);
      });
      var sy0 = py + ph - 86, s0 = px + 36;
      ctx.strokeStyle = '#d6dbe1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px + 24, sy0 - 26); ctx.lineTo(px + pw - 24, sy0 - 26); ctx.stroke();
      [0, 1].forEach(function (i) { ctx.fillStyle = i ? '#fff' : C.ink; ctx.fillRect(s0 + i * sw / 2, sy0, sw / 2, 16); }); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(s0, sy0, sw, 16);
      ctx.font = '26px ' + FONT; ctx.fillStyle = C.ink; ctx.textAlign = 'center';
      var lab = function (m) { return m >= 1000 ? (m / 1000) + 'km' : m + 'm'; };
      [[0, '0'], [0.5, lab(nice / 2)], [1, lab(nice)]].forEach(function (a) { ctx.fillText(a[1], s0 + sw * a[0], sy0 + 44); });
      ctx.textAlign = 'right'; ctx.fillStyle = '#5b6573'; ctx.fillText('축척', px + pw - 32, sy0 + 8);
      // 테두리 · 출처
      ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);
      ctx.fillStyle = '#7a8491'; ctx.font = '24px ' + FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('배경: ' + srcName, rect[0] + rect[2], rect[1] + rect[3] + 10);
      return keymap(ctx, [rect[0] + 28, rect[1] + 28, 440, 480], M, b, key);
    }).then(function () {
      if (noTbl) return cv;
      // ---- 표 ----
      var ty = rect[1] + rect[3] + 70, Ts = rows.map(function (r) { return r.T; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      ctx.fillStyle = C.ink; ctx.font = 'bold 36px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('계획빈도  ' + (Ts.length === 1 ? Ts[0] + '년' : Ts.map(function (t) { return t + '년'; }).join('·')), rect[0], ty + 10);
      var cols = [['지구명', 0.22], ['계획연장 (m)', 0.15], ['공사비 (백만원)', 0.17], ['B/C', 0.14], ['통합지표', 0.14], ['투자우선순위', 0.18]];
      var tw = rect[2], x0 = rect[0], y0 = ty + 44, hh = 84, cx = x0;
      ctx.fillStyle = C.navy; ctx.fillRect(x0, y0, tw, hh);
      cols.forEach(function (c) { var w = c[1] * tw; ctx.fillStyle = '#fff'; ctx.font = 'bold 30px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(c[0], cx + w / 2, y0 + hh / 2); cx += w; });
      rows.forEach(function (r, ri) {
        var y = y0 + hh + ri * rowH, vals = [r.name, f(r.len), f(r.cost), r.bc === null || r.bc === undefined ? '-' : f(r.bc, r.bc < 10 ? 3 : 2), r.score === undefined || r.score === null ? '-' : (+r.score).toFixed(2), r.rank || '-'];
        ctx.fillStyle = ri % 2 ? '#f3f5f8' : '#fff'; ctx.fillRect(x0, y, tw, rowH);
        cx = x0; ctx.font = (rowH < 60 ? 28 : 31) + 'px ' + FONT;
        cols.forEach(function (c, i) { var w = c[1] * tw; ctx.fillStyle = i === 3 && r.bc >= 1 ? '#0a7a32' : C.ink; ctx.font = (i === 0 || (i === 3 && r.bc >= 1) ? 'bold ' : '') + (rowH < 60 ? 28 : 31) + 'px ' + FONT; ctx.fillText(String(vals[i]), cx + w / 2, y + rowH / 2); cx += w; });
        ctx.strokeStyle = '#dde2e8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y + rowH); ctx.lineTo(x0 + tw, y + rowH); ctx.stroke();
      });
      ctx.strokeStyle = C.navy; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y0 + hh + rows.length * rowH); ctx.lineTo(x0 + tw, y0 + hh + rows.length * rowH); ctx.stroke();
      return cv;
    });
  }
  // 지구가 많을 때 종합위치도와 따로 내는 '지구 현황표' (A4 세로 한 장)
  function renderTable(info) {
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    var rows = info.rows, mg = 90, Ts = rows.map(function (r) { return r.T; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    ctx.fillStyle = C.navy; ctx.fillRect(mg, mg, W - 2 * mg, 14);
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = 'bold 84px ' + FONT;
    ctx.fillText((info.river ? info.river + ' ' : '') + '치수경제성 분석 지구 현황', mg, mg + 130);
    ctx.font = '44px ' + FONT; ctx.fillStyle = '#5b6573'; ctx.fillText('계획빈도 ' + (Ts.length === 1 ? Ts[0] + '년' : Ts.map(function (t) { return t + '년'; }).join('·')) + '  ·  지구 ' + rows.length + '개', mg, mg + 200);
    var cols = [['지구명', 0.24], ['구간 (No.)', 0.2], ['계획연장 (m)', 0.12], ['공사비 (백만원)', 0.13], ['B/C', 0.1], ['통합지표', 0.1], ['우선순위', 0.11]];
    var x0 = mg, tw = W - 2 * mg, y0 = mg + 260, hh = 84, rowH = Math.min(72, Math.floor((H - y0 - hh - mg - 20) / Math.max(1, rows.length)));
    var fs = Math.max(22, Math.min(32, rowH - 26)), cx = x0;
    ctx.fillStyle = C.navy; ctx.fillRect(x0, y0, tw, hh); ctx.textBaseline = 'middle';
    cols.forEach(function (c) { var w = c[1] * tw; ctx.fillStyle = '#fff'; ctx.font = 'bold 30px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(c[0], cx + w / 2, y0 + hh / 2); cx += w; });
    rows.forEach(function (r, ri) {
      var y = y0 + hh + ri * rowH, vals = [r.name, r.section || '-', f(r.len), f(r.cost), r.bc === null || r.bc === undefined ? '-' : f(r.bc, 3), r.score === undefined || r.score === null ? '-' : (+r.score).toFixed(2), r.rank || '-'];
      ctx.fillStyle = ri % 2 ? '#f3f5f8' : '#fff'; ctx.fillRect(x0, y, tw, rowH);
      cx = x0;
      cols.forEach(function (c, i) { var w = c[1] * tw; ctx.fillStyle = i === 4 && r.bc >= 1 ? '#0a7a32' : C.ink; ctx.font = (i === 0 || (i === 4 && r.bc >= 1) ? 'bold ' : '') + fs + 'px ' + FONT; ctx.fillText(String(vals[i]), cx + w / 2, y + rowH / 2); cx += w; });
      ctx.strokeStyle = '#dde2e8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y + rowH); ctx.lineTo(x0 + tw, y + rowH); ctx.stroke();
    });
    ctx.strokeStyle = C.navy; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y0 + hh + rows.length * rowH); ctx.lineTo(x0 + tw, y0 + hh + rows.length * rowH); ctx.stroke();
    var ok = rows.filter(function (r) { return r.bc >= 1; }).length;
    ctx.fillStyle = '#5b6573'; ctx.font = '30px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('B/C ≥ 1 : ' + ok + '개 지구 (초록 굵은 글씨)', x0, y0 + hh + rows.length * rowH + 24);
    return Promise.resolve(cv);
  }
  function keymap(ctx, r, M, b, key) {
    var c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], span = 300000;
    var inner = [r[0], r[1] + 52, r[2], r[3] - 52], mb2 = fit([c[0] - span / 2, c[1] - span / 2, c[0] + span / 2, c[1] + span / 2], inner, 0, 0);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 14; rr(ctx, r[0], r[1], r[2], r[3], 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    ctx.fillStyle = C.navy; rr(ctx, r[0], r[1], r[2], 52, 12); ctx.fill(); ctx.fillRect(r[0], r[1] + 30, r[2], 22);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('KEY MAP', r[0] + r[2] / 2, r[1] + 27);
    return basemap(ctx, inner, mb2, key, false).then(function () {
      var s = inner[2] / (mb2[2] - mb2[0]), px = inner[0] + (c[0] - mb2[0]) * s, py = inner[1] + (mb2[3] - c[1]) * s;
      ctx.lineWidth = 5; ctx.strokeStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(px, py, 30, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.arc(px, py, 8, 0, 7); ctx.fill();
      ctx.font = 'bold 28px ' + FONT; var t = '과업위치', w = ctx.measureText(t).width + 24;
      rr(ctx, px - w / 2, py + 40, w, 42, 8); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
      ctx.fillStyle = '#c81e1e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, px, py + 62);
    });
  }
  // ---- 기존 위치도(삽도) DXF: 주제 선(유역경계·하천·지구 등)만 색 그대로 뽑아 위성 위치도에 얹음 ----
  var SKIP = /\||^[A-H]\d{7}$|TEXT|TXT|text|범례|표|박스|BOX|도곽|NOTE|제목|방위|명칭|KEY|PLAN|타점|측점|단면|횡단|번호|치수|DIM|문자|글자|사진|^0$|^Defpoints$/i;
  var KEEP = /유역|경계|하천|강|천|중심선|세천|소하천|지구|분석|태양|MW|행정|읍면동|계획|보축|축제|방어벽|홍수|범람|빈도|YR|유로|구역|basin|river/i;
  function aci(c) {
    var T = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff' };
    c = Math.abs(c | 0); if (T[c]) return T[c]; if (c < 10 || c > 249) return '#ffffff';
    var h = ((c - 10) / 10 | 0) * 15, k = (c - 10) % 10, v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][k], s = k % 2 ? 0.5 : 1;
    var f = function (n) { var kk = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)))); };
    return 'rgb(' + f(5) + ',' + f(3) + ',' + f(1) + ')';
  }
  function parseOverlay(text) {
    var L = text.split(/\r?\n/), lay = {}, out = [], i, sec = '';
    for (i = 0; i + 1 < L.length; i += 2) {
      var c = L[i].trim(), v = L[i + 1].trim();
      if (c === '2' && (v === 'TABLES' || v === 'ENTITIES' || v === 'BLOCKS')) sec = v;
      if (sec === 'TABLES' && c === '0' && v === 'LAYER') { var nm = '', col = 7, lt = ''; for (var j = i + 2; j + 1 < L.length && L[j].trim() !== '0'; j += 2) { var g = L[j].trim(); if (g === '2') nm = L[j + 1].trim(); else if (g === '62') col = +L[j + 1]; else if (g === '6') lt = L[j + 1].trim(); } lay[nm] = { col: col, lt: lt }; }
      if (sec !== 'ENTITIES' || c !== '0' || !/^(LWPOLYLINE|LINE|POLYLINE)$/.test(v)) continue;
      var type = v, ly = '', col2 = 256, lt2 = '', xs = [], ys = [], closed = false, j2 = i + 2;
      if (type === 'POLYLINE') {
        for (; j2 + 1 < L.length && L[j2].trim() !== '0'; j2 += 2) { var g2 = L[j2].trim(); if (g2 === '8') ly = L[j2 + 1].trim(); else if (g2 === '62') col2 = +L[j2 + 1]; else if (g2 === '70') closed = (+L[j2 + 1] & 1) === 1; }
        while (j2 + 1 < L.length && !(L[j2].trim() === '0' && L[j2 + 1].trim() === 'SEQEND')) { if (L[j2].trim() === '10') xs.push(+L[j2 + 1]); else if (L[j2].trim() === '20') ys.push(+L[j2 + 1]); j2 += 2; }
      } else {
        for (; j2 + 1 < L.length && L[j2].trim() !== '0'; j2 += 2) {
          var g3 = L[j2].trim(), val = L[j2 + 1];
          if (g3 === '8') ly = val.trim(); else if (g3 === '62') col2 = +val; else if (g3 === '6') lt2 = val.trim(); else if (g3 === '70') closed = (+val & 1) === 1;
          else if (g3 === '10' || g3 === '11') xs.push(+val); else if (g3 === '20' || g3 === '21') ys.push(+val);
        }
      }
      i = j2 - 2;
      if (SKIP.test(ly) || !KEEP.test(ly) || /^-[^\d-]/.test(ly) || xs.length < 2) continue;   // 주제 레이어만(현황측량 '-논' 등 제외)
      var pts = xs.map(function (x, q) { return [x, ys[q]]; }); if (closed) pts.push(pts[0]);
      out.push({ layer: ly, coords: pts, col: col2, lt: lt2 });
    }
    out.forEach(function (o) { var Ly = lay[o.layer] || { col: 7, lt: '' }; if (o.col === 256 || o.col === 0) o.col = Ly.col; if (!o.lt || /BYLAYER/i.test(o.lt)) o.lt = Ly.lt; o.color = aci(o.col); o.dash = /DASH|CENTER|PHANTOM|DOT|HIDDEN|일점|파선/i.test(o.lt); });
    var byL = {}; out.forEach(function (o) { byL[o.layer] = (byL[o.layer] || 0) + 1; });
    return { lines: out, layers: byL };
  }
  function drawOverlay(ctx, ov, P, tm, rect) {
    ov.lines.forEach(function (o) {
      var pts = o.coords.map(function (p) { return P(tm(p)); }), b = bboxOf(pts);
      if (b[2] < rect[0] || b[0] > rect[0] + rect[2] || b[3] < rect[1] || b[1] > rect[1] + rect[3]) return;
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; path(ctx, pts); ctx.stroke();
      ctx.lineWidth = 5; ctx.strokeStyle = o.color; if (o.dash) ctx.setLineDash([34, 12, 8, 12]); path(ctx, pts); ctx.stroke();
      ctx.restore();
    });
  }
  return { render: render, renderTable: renderTable, parseOverlay: parseOverlay };
})();
