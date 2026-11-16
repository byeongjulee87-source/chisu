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
      ll: function (p) { return t(p); }
    };
  }
  function bboxOf(pts) { var b = [Infinity, Infinity, -Infinity, -Infinity]; pts.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }); return b; }
  function fit(b, rect, pad, minSpan) {
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, w = Math.max(b[2] - b[0], minSpan) * (1 + pad), h = Math.max(b[3] - b[1], minSpan) * (1 + pad), a = rect[2] / rect[3];
    if (w / h > a) h = w / a; else w = h * a;
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }

  function render(M0, info, opt) {
    opt = opt || {};
    var M = prep(M0), focus = opt.focus || null, key = opt.key || '';
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    var rows = focus ? info.rows.filter(function (r) { return r.name === focus; }) : info.rows;
    var rowH = rows.length > 14 ? 58 : 72, tblH = 90 + rowH * (rows.length + 1) + 30, mg = 70;
    var rect = [mg, mg, W - 2 * mg, H - 2 * mg - tblH - 20];
    // 범위: 지구(+하천) — 유역계는 너무 크지 않을 때만
    var dp = []; M.dist.forEach(function (q) { if (!focus || q.d === focus) q.rings.forEach(function (r) { dp = dp.concat(r); }); });
    if (!focus) dp = dp.concat(M.river);
    if (!dp.length) dp = M.river.slice();
    var b = bboxOf(dp);
    if (!focus && M.basin.length) { var bb = bboxOf([].concat.apply([], M.basin)); if ((bb[2] - bb[0]) * (bb[3] - bb[1]) < 5 * (b[2] - b[0]) * (b[3] - b[1])) b = [Math.min(b[0], bb[0]), Math.min(b[1], bb[1]), Math.max(b[2], bb[2]), Math.max(b[3], bb[3])]; }
    var mb = fit(b, rect, focus ? 0.9 : 0.35, focus ? 500 : 800);
    var sx = rect[2] / (mb[2] - mb[0]), P = function (p) { return [rect[0] + (p[0] - mb[0]) * sx, rect[1] + (mb[3] - p[1]) * sx]; };
    // 메르카토르 축척 → 실제 거리(위도 보정)
    var lat = M.ll ? null : null, cy = (mb[1] + mb[3]) / 2, k = Math.cos(2 * Math.atan(Math.exp(cy / RE)) - Math.PI / 2);
    return basemap(ctx, rect, mb, key, true).then(function (srcName) {
      ctx.save(); ctx.beginPath(); ctx.rect(rect[0], rect[1], rect[2], rect[3]); ctx.clip();
      // 유역경계
      M.basin.forEach(function (r) {
        var pts = r.map(P);
        ctx.setLineDash([]); ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; path(ctx, pts, true); ctx.stroke();
        ctx.setLineDash([46, 16, 10, 16]); ctx.lineWidth = 8; ctx.strokeStyle = '#111'; path(ctx, pts, true); ctx.stroke(); ctx.setLineDash([]);
      });
      // 분석지구
      M.dist.forEach(function (q) {
        var on = !focus || q.d === focus;
        q.rings.forEach(function (r) {
          var pts = r.map(P);
          ctx.fillStyle = on ? 'rgba(90,230,90,0.48)' : 'rgba(90,230,90,0.18)'; path(ctx, pts, true); ctx.fill();
          ctx.lineWidth = on && focus ? 8 : 4; ctx.strokeStyle = on && focus ? '#ff2a2a' : '#1f8f2a'; path(ctx, pts, true); ctx.stroke();
        });
      });
      // 과업하천
      if (M.river.length > 1) {
        var rp = M.river.map(P);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; path(ctx, rp); ctx.stroke();
        ctx.lineWidth = 14; ctx.strokeStyle = '#2140e8'; path(ctx, rp); ctx.stroke();
      }
      // 측점
      var stp = M.stations.map(function (s) { return { p: P(s.p), key: s.key }; }).filter(function (s) { return s.p[0] > rect[0] && s.p[0] < rect[0] + rect[2] && s.p[1] > rect[1] && s.p[1] < rect[1] + rect[3]; });
      var every = Math.max(1, Math.ceil(stp.length / (focus ? 6 : 10)));
      stp.forEach(function (s, i) { if (i % every) return; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.p[0], s.p[1], 9, 0, 7); ctx.fill(); halo(ctx, 'NO.' + s.key, s.p[0] + 18, s.p[1] - 22, 30, '#ffffff', false, 'left'); });
      // 지구 이름표
      var boxes = [], cen = function (rings) { var p = bboxOf([].concat.apply([], rings)); return [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2]; };
      var riverC = M.river.length ? cen([M.river]) : null;
      M.dist.reduce(function (acc, q) { var a = acc.filter(function (x) { return x.d === q.d; })[0]; if (a) a.rings = a.rings.concat(q.rings); else acc.push({ d: q.d, rings: q.rings.slice() }); return acc; }, []).forEach(function (q) {
        if (focus && q.d !== focus) return;
        var row = info.rows.filter(function (r) { return r.name === q.d; })[0] || {};
        var c = P(cen(q.rings)), rc = riverC ? P(riverC) : [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
        var dx = c[0] - rc[0], dy = c[1] - rc[1], L = Math.hypot(dx, dy) || 1;
        var off = focus ? 320 : 230, bx = c[0] + dx / L * off, by = c[1] + dy / L * off;
        var l1 = q.d, l2 = row.section ? 'NO.' + String(row.section).replace(/^NO\.?\s*/i, '') : '';
        ctx.font = 'bold 40px ' + FONT; var w = Math.max(ctx.measureText(l1).width, (ctx.font = '34px ' + FONT, ctx.measureText(l2).width)) + 44, h = l2 ? 112 : 66;
        bx = Math.min(Math.max(bx - w / 2, rect[0] + 20), rect[0] + rect[2] - w - 20); by = Math.min(Math.max(by - h / 2, rect[1] + 20), rect[1] + rect[3] - h - 20);
        for (var it = 0; it < 30 && boxes.some(function (o) { return bx < o[0] + o[2] + 10 && o[0] < bx + w + 10 && by < o[1] + o[3] + 10 && o[1] < by + h + 10; }); it++) by += h * 0.6 * (it % 2 ? -it : it);
        boxes.push([bx, by, w, h]);
        ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(bx + w / 2, by + h / 2); ctx.stroke();
        ctx.fillStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(c[0], c[1], 10, 0, 7); ctx.fill();
        rr(ctx, bx, by, w, h, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#ff2a2a'; ctx.stroke();
        ctx.fillStyle = '#c40000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 40px ' + FONT; ctx.fillText(l1, bx + w / 2, by + (l2 ? 34 : h / 2));
        if (l2) { ctx.font = '34px ' + FONT; ctx.fillStyle = '#222'; ctx.fillText(l2, bx + w / 2, by + 80); }
      });
      // 과업연장·하천연장 치수선 (종합도)
      if (!focus && M.river.length > 1) {
        var rp2 = M.river.map(P), yb = bboxOf(rp2), xr = Math.min(yb[2] + 170, rect[0] + rect[2] - 330);
        // 아래쪽 범례(오른쪽 끝 폭 ~600)·축척(그 왼쪽 ~600)과 겹치면 하천 왼쪽에
        var RB = rect[0] + rect[2], BT = rect[1] + rect[3], clash = function (x) { return (x > RB - 640 && yb[3] > BT - 380) || (x > RB - 1240 && x <= RB - 640 && yb[3] > BT - 230); };
        if (clash(xr)) xr = Math.max(yb[0] - 170, rect[0] + 200);
        var dim = function (x, y0, y1, color, label) {
          ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
          [[y0, 1], [y1, -1]].forEach(function (a) { ctx.beginPath(); ctx.moveTo(x, a[0]); ctx.lineTo(x - 18, a[0] + 34 * a[1]); ctx.lineTo(x + 18, a[0] + 34 * a[1]); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x - 50, a[0]); ctx.lineTo(x + 50, a[0]); ctx.stroke(); });
          var lines = label.split('\n'); ctx.font = 'bold 42px ' + FONT; var w = Math.max.apply(null, lines.map(function (s) { return ctx.measureText(s).width; })) + 50, h = 64 * lines.length + 20, by = (y0 + y1) / 2 - h / 2;
          rr(ctx, x - w / 2, by, w, h, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 6; ctx.stroke();
          ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; lines.forEach(function (s, i) { ctx.fillText(s, x, by + 42 + i * 64); });
        };
        if (info.taskLen) dim(xr, yb[1], yb[3], '#1d2bd8', '과업연장\nL=' + info.taskLen + 'km');
        if (info.riverLen) dim(Math.min(xr + 300, rect[0] + rect[2] - 150), Math.max(rect[1] + 60, yb[1] - 120), Math.min(rect[1] + rect[3] - 60, yb[3] + 120), '#e01010', '하천연장\nL=' + info.riverLen + 'km');
      }
      ctx.restore();
      // 제목(행정구역)
      var SIDO = {'서울':'서울특별시','부산':'부산광역시','대구':'대구광역시','인천':'인천광역시','광주':'광주광역시','대전':'대전광역시','울산':'울산광역시','세종':'세종특별자치시','경기':'경기도','강원':'강원특별자치도','충북':'충청북도','충남':'충청남도','전북':'전북특별자치도','전남':'전라남도','경북':'경상북도','경남':'경상남도','제주':'제주특별자치도'};
      var tl = (info.title || []).filter(Boolean).map(function (s, i) { return i === 0 && SIDO[s] ? SIDO[s] : s; }); if (focus) tl = tl.concat([focus]);
      var ty0 = rect[1] + 40;
      tl.forEach(function (s, i) {
        var size = i === tl.length - 1 && tl.length > 1 ? 58 : 78; ctx.font = 'bold ' + size + 'px ' + FONT;
        var sp = s.split('').join(' '), w = ctx.measureText(sp).width + 60, h = size + 40, x = rect[0] + rect[2] / 2 - w / 2, y = ty0; ty0 += h + 18;
        rr(ctx, x, y, w, h, 14); ctx.fillStyle = i === tl.length - 1 && tl.length > 1 ? '#18a058' : '#f08a1c'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sp, x + w / 2, y + h / 2 + 2);
      });
      // 방위표
      var nx = rect[0] + rect[2] - 140, ny = rect[1] + 150;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(nx, ny, 95, 0, 7); ctx.fill();
      ctx.fillStyle = '#c40000'; ctx.beginPath(); ctx.moveTo(nx, ny - 80); ctx.lineTo(nx + 30, ny + 10); ctx.lineTo(nx, ny - 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.moveTo(nx, ny - 80); ctx.lineTo(nx - 30, ny + 10); ctx.lineTo(nx, ny - 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#222'; ctx.font = 'bold 44px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny + 50);
      // 축척 + 범례 (오른쪽 아래)
      var mpp = 1 / sx * k, target = 0.28 * rect[2] * mpp, nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].filter(function (v) { return v <= target; }).pop() || 50;
      var sw = nice / mpp, lgW = 560, lgX = rect[0] + rect[2] - lgW - 30, scW = Math.max(sw + 120, 520), scX = lgX - scW - 24;   // 축척은 범례 왼쪽에 나란히
      var items = [['line', '#2140e8', '과업하천']];
      if (M.basin.length) items.push(['dash', '#111', '유역경계']);
      items.push(['fill', 'rgba(90,230,90,0.6)', '분석지구']);
      var lgH = 90 + items.length * 70, lgY = rect[1] + rect[3] - lgH - 30, scY = rect[1] + rect[3] - 160 - 30;
      rr(ctx, scX, scY, scW, 160, 10); ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#333'; ctx.stroke();
      ctx.fillStyle = '#222'; ctx.font = 'bold 38px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('축  척', scX + scW / 2, scY + 38);
      var s0 = scX + (scW - sw) / 2;
      [0, 1].forEach(function (i) { ctx.fillStyle = i ? '#fff' : '#222'; ctx.fillRect(s0 + i * sw / 2, scY + 80, sw / 2, 22); }); ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.strokeRect(s0, scY + 80, sw, 22);
      ctx.font = '30px ' + FONT; ctx.fillStyle = '#222';
      [[0, '0m'], [0.5, (nice / 2 >= 1000 ? (nice / 2000) + 'km' : (nice / 2) + 'm')], [1, nice >= 1000 ? (nice / 1000) + 'km' : nice + 'm']].forEach(function (a) { ctx.fillText(a[1], s0 + sw * a[0], scY + 130); });
      rr(ctx, lgX, lgY, lgW, lgH, 10); ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fill(); ctx.strokeStyle = '#333'; ctx.stroke();
      ctx.fillStyle = '#222'; ctx.font = 'bold 38px ' + FONT; ctx.fillText('범  례', lgX + lgW / 2, lgY + 42);
      items.forEach(function (it, i) {
        var y = lgY + 110 + i * 70, x = lgX + 50;
        ctx.save();
        if (it[0] === 'fill') { ctx.fillStyle = it[1]; ctx.fillRect(x, y - 20, 150, 40); ctx.strokeStyle = '#1f8f2a'; ctx.lineWidth = 3; ctx.strokeRect(x, y - 20, 150, 40); }
        else { ctx.strokeStyle = it[1]; ctx.lineWidth = it[0] === 'line' ? 14 : 8; if (it[0] === 'dash') ctx.setLineDash([30, 10, 6, 10]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 150, y); ctx.stroke(); }
        ctx.restore();
        ctx.fillStyle = '#222'; ctx.font = '36px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(it[2], x + 190, y);
      });
      ctx.lineWidth = 6; ctx.strokeStyle = '#222'; ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);
      ctx.fillStyle = '#555'; ctx.font = '24px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('배경: ' + srcName, rect[0] + 12, rect[1] + rect[3] - 8);
      // KEY MAP
      return keymap(ctx, [rect[0] + 30, rect[1] + 30, 520, 560], M, b, key);
    }).then(function () {
      // 표
      var ty = rect[1] + rect[3] + 40, Ts = rows.map(function (r) { return r.T; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      ctx.fillStyle = '#111'; ctx.font = 'bold 40px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('계획빈도 : ' + (Ts.length === 1 ? Ts[0] + '년빈도' : Ts.map(function (t) { return t + '년'; }).join('·') + '빈도'), rect[0], ty + 20);
      var cols = [['지구명', 0.24], ['계획연장\n(m)', 0.14], ['공사비\n(백만원)', 0.16], ['B/C', 0.14], ['통합\n지표', 0.14], ['투자우선\n순위', 0.18]];
      var tw = rect[2], x0 = rect[0], y0 = ty + 60, hh = 90;
      ctx.fillStyle = '#e9eef5'; ctx.fillRect(x0, y0, tw, hh);
      var cx = x0; ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
      cols.forEach(function (c) {
        var w = c[1] * tw; ctx.strokeRect(cx, y0, w, hh); ctx.fillStyle = '#111'; ctx.font = 'bold 32px ' + FONT; ctx.textAlign = 'center';
        var ls = c[0].split('\n'); ls.forEach(function (s, i) { ctx.fillText(s, cx + w / 2, y0 + hh / 2 + (i - (ls.length - 1) / 2) * 36); }); cx += w;
      });
      rows.forEach(function (r, ri) {
        var y = y0 + hh + ri * rowH, vals = [r.name, f(r.len), f(r.cost), r.bc === null || r.bc === undefined ? '-' : f(r.bc, r.bc < 10 ? 3 : 2), r.score === undefined || r.score === null ? '-' : (+r.score).toFixed(2), r.rank || '-'];
        cx = x0; ctx.font = (rowH < 70 ? 30 : 34) + 'px ' + FONT;
        cols.forEach(function (c, i) { var w = c[1] * tw; ctx.strokeRect(cx, y, w, rowH); ctx.fillStyle = i === 3 && r.bc >= 1 ? '#0a6b2a' : '#111'; ctx.fillText(String(vals[i]), cx + w / 2, y + rowH / 2); cx += w; });
      });
      ctx.lineWidth = 4; ctx.strokeRect(x0, y0, tw, hh + rows.length * rowH);
      return cv;
    });
  }
  function keymap(ctx, r, M, b, key) {
    var c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], span = 260000, mb = [c[0] - span / 2 * r[2] / r[3], c[1] - span / 2, c[0] + span / 2 * r[2] / r[3], c[1] + span / 2];
    var inner = [r[0] + 10, r[1] + 70, r[2] - 20, r[3] - 80], mb2 = fit([mb[0], mb[1], mb[2], mb[3]], inner, 0, 0);
    rr(ctx, r[0], r[1], r[2], r[3], 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#222'; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = 'bold 40px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('KEY MAP', r[0] + r[2] / 2, r[1] + 38);
    return basemap(ctx, inner, mb2, key, true).then(function () {
      var s = inner[2] / (mb2[2] - mb2[0]), px = inner[0] + (c[0] - mb2[0]) * s, py = inner[1] + (mb2[3] - c[1]) * s;
      ctx.save(); ctx.setLineDash([14, 8]); ctx.lineWidth = 6; ctx.strokeStyle = '#ff2020'; ctx.beginPath(); ctx.arc(px, py, 46, 0, 7); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#ff2020'; ctx.beginPath(); ctx.arc(px, py, 10, 0, 7); ctx.fill();
      halo(ctx, '과업위치', px, py + 82, 36, '#ffe14d', true);
      ctx.lineWidth = 3; ctx.strokeStyle = '#222'; ctx.strokeRect(inner[0], inner[1], inner[2], inner[3]);
    });
  }
  return { render: render };
})();
