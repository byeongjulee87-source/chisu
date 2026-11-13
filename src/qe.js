/* @물량산출 엔진 사본(횡단면도 → 측점별 수량). 원본: @물량산출/src/engine.js */
/* 하천 횡단면도 물량산출 엔진 (순수 JS, DOM 없음)
 * 입력: DXF 텍스트, 설정(cfg)  →  출력: 측점·좌우안별 수량
 * 산출 근거: 하천공사 설계실무요령(2024) 제1편 2.3.5, 제2편 1.2 수량산출요령
 */
var QE = (function () {
  'use strict';

  var DEFAULT_CFG = {
    cx: 800.0,                 // 횡단 중심(원점) x
    stationUnit: 50,           // No.1 = 50 m
    lyGround: ['원지형'],
    lyPlan: ['계획지형'],
    lyStep: ['층따기'],
    lyFilter: ['필터매트', '_필터매트'],
    lyExcav: ['!!터파기'],
    lyEarth: ['00 토공산출'],
    lyRiprap: ['밑다짐'],
    lyFound: ['03GREEN'],
    lyPave: ['콘크리트포장'],
    boxPrefix: '@ 토적표-',
    flatSlope: 0.1,            // 이보다 완만한 계획선은 둑마루·소단(면고르기 제외)
    stripSlope: 0.25,          // 표토제거: 원지반 1:4 보다 완만
    footArea: 0.29,            // 기초콘크리트 단면적(도면에 폐합선이 없을 때)
    n: 4000
  };

  // ---------------- DXF ----------------
  // 엔티티는 줄 범위(s~e)만 기억하고 그룹코드는 필요할 때 읽는다(대용량 DXF 대비)
  var LN = null;
  function parse(text) {
    var L = text.split(/\r?\n/);
    LN = L;
    var ents = [], blocks = {}, sect = null, blk = null, cur = null;
    function close(i) {
      if (!cur) return;
      cur.e = i;
      cur.layer = get(cur, '8', '').trim();
      (sect === 'BLOCKS' && blk !== null ? (blocks[blk] = blocks[blk] || []) : ents).push(cur);
      cur = null;
    }
    for (var i = 0; i + 1 < L.length; i += 2) {
      if (L[i].trim() !== '0') continue;
      close(i);
      var t = L[i + 1].trim();
      if (t === 'SECTION') { sect = (L[i + 3] || '').trim(); i += 2; continue; }
      if (t === 'ENDSEC') { sect = null; continue; }
      if (sect === 'BLOCKS' && t === 'BLOCK') {
        var j = i + 2, nm = null;
        while (j + 1 < L.length && L[j].trim() !== '0') { if (L[j].trim() === '2') nm = L[j + 1].trim(); j += 2; }
        blk = nm; i = j - 2; continue;
      }
      if (sect === 'BLOCKS' && t === 'ENDBLK') { blk = null; continue; }
      if (sect === 'ENTITIES' || (sect === 'BLOCKS' && blk !== null)) cur = { type: t, s: i + 2, e: i + 2 };
    }
    close(L.length - 1);
    return { lines: L, ents: ents, blocks: blocks };
  }
  function get(e, code, d) {
    var L = LN, end = e.e === e.s ? L.length : e.e;
    for (var i = e.s; i + 1 < end; i += 2) { var c = L[i].trim(); if (c === '0') break; if (c === code) return L[i + 1]; }
    return d;
  }
  function getLine(e, code) {   // 값이 있는 줄 번호
    for (var i = e.s; i + 1 < e.e; i += 2) if (LN[i].trim() === code) return i + 1;
    return -1;
  }
  function getAll(e, code) { var o = []; for (var i = e.s; i + 1 < e.e; i += 2) if (LN[i].trim() === code) o.push(LN[i + 1]); return o; }
  function pts(e) {
    if (e.type === 'LWPOLYLINE') {
      var xs = getAll(e, '10'), ys = getAll(e, '20'), p = [];
      for (var i = 0; i < xs.length; i++) p.push([+xs[i], +ys[i]]);
      if ((+get(e, '70', '0')) & 1 && p.length > 2) p.push(p[0].slice());
      return p;
    }
    if (e.type === 'LINE') return [[+get(e, '10'), +get(e, '20')], [+get(e, '11'), +get(e, '21')]];
    return [];
  }
  function inLayers(e, arr) { return arr.indexOf(e.layer) >= 0; }

  // ---------------- geometry ----------------
  // y(x): 폴리라인(또는 선분 목록)의 비수직 선분으로 보간. 수직 단차가 있어도 그리는 순서를 따른다.
  function fnOf(poly, isSegs) {
    var S = [];
    var src = isSegs ? poly : segs([poly]);
    src.forEach(function (s) {
      var a = s[0], b = s[1];
      if (Math.abs(b[0] - a[0]) < 1e-9) return;
      if (a[0] > b[0]) { var t = a; a = b; b = t; }
      S.push([a[0], a[1], b[0], b[1]]);
    });
    S.sort(function (u, v) { return u[0] - v[0]; });
    var x0 = S.length ? S[0][0] : 0, x1 = S.length ? S[S.length - 1][2] : 0;
    var y0 = S.length ? S[0][1] : 0, y1 = S.length ? S[S.length - 1][3] : 0;
    S.forEach(function (s) { if (s[2] >= x1) { x1 = s[2]; y1 = s[3]; } });
    return function (x) {
      if (x <= x0) return y0;
      if (x >= x1) return y1;
      var best = null;
      for (var i = 0; i < S.length && S[i][0] <= x; i++) {
        var s = S[i];
        if (x <= s[2]) { var y = s[1] + (s[3] - s[1]) * (x - s[0]) / (s[2] - s[0]); if (best === null || y > best) best = y; }
      }
      if (best !== null) return best;
      // 틈(겹침 없는 구간): 직전 선분 끝값
      var last = y0; for (var j = 0; j < S.length && S[j][0] <= x; j++) if (S[j][2] <= x) last = S[j][3];
      return last;
    };
  }
  function xr(p) { var lo = Infinity, hi = -Infinity; p.forEach(function (q) { lo = Math.min(lo, q[0]); hi = Math.max(hi, q[0]); }); return [lo, hi]; }
  function yr(p) { var lo = Infinity, hi = -Infinity; p.forEach(function (q) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }); return [lo, hi]; }
  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  function plen(p) { var s = 0; for (var i = 0; i + 1 < p.length; i++) s += dist(p[i], p[i + 1]); return s; }
  function area(p) { var s = 0; for (var i = 0; i + 1 < p.length; i++) s += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]; return Math.abs(s) / 2; }
  // 좌/우안 반평면으로 폴리라인 자르기
  function clipSide(p, cx, side) {
    var inside = function (q) { return side === 'R' ? q[0] >= cx - 1e-9 : q[0] <= cx + 1e-9; };
    var out = [], cur = [];
    for (var i = 0; i < p.length; i++) {
      var a = p[i], ia = inside(a);
      if (i > 0) {
        var b = p[i - 1], ib = inside(b);
        if (ia !== ib && a[0] !== b[0]) {
          var t = (cx - b[0]) / (a[0] - b[0]), m = [cx, b[1] + t * (a[1] - b[1])];
          if (ib) { cur.push(m); if (cur.length > 1) out.push(cur); cur = []; }
          else cur = [m];
        }
      }
      if (ia) cur.push(a);
    }
    if (cur.length > 1) out.push(cur);
    return out.filter(function (q) { return plen(q) > 1e-6; });
  }
  function segs(lines) { var s = []; lines.forEach(function (p) { for (var i = 0; i + 1 < p.length; i++) s.push([p[i], p[i + 1]]); }); return s; }
  function integ(top, bot, x0, x1, n) {   // ∫(top-bot)+ , ∫(bot-top)+
    if (x1 - x0 < 1e-6) return [0, 0];
    var dx = (x1 - x0) / n, f = 0, c = 0;
    for (var i = 0; i < n; i++) { var x = x0 + (i + 0.5) * dx, d = top(x) - bot(x); if (d > 0) f += d; else c -= d; }
    return [f * dx, c * dx];
  }
  // 폴리곤의 수직선 x 에서의 내부 구간들
  function vint(poly, x) {
    var ys = [];
    for (var i = 0; i + 1 < poly.length; i++) {
      var a = poly[i], b = poly[i + 1];
      if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) ys.push(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
    }
    ys.sort(function (p, q) { return p - q; });
    var o = []; for (var j = 0; j + 1 < ys.length; j += 2) o.push([ys[j], ys[j + 1]]);
    return o;
  }

  // T(x) > B(x) 인 구간의 폐합 다각형들 (확인 레이어용). xs: 꺾이는 점 x 목록
  function regions(T, B, xs, x0, x1) {
    var X = xs.filter(function (x) { return x > x0 && x < x1; }).concat([x0, x1]).sort(function (a, b) { return a - b; });
    var P = [x0];
    for (var i = 1; i < X.length; i++) {
      if (X[i] - P[P.length - 1] < 1e-6) continue;
      var a = P[P.length - 1], b = X[i], da = T(a) - B(a), db = T(b) - B(b);
      if (da * db < 0) P.push(a + (b - a) * da / (da - db));
      P.push(b);
    }
    var out = [], top = [], bot = [];
    function flush() { if (top.length > 1) out.push(top.concat(bot.reverse(), [top[0]])); top = []; bot = []; }
    for (var j = 0; j < P.length; j++) {
      var x = P[j], d = T(x) - B(x);
      var inside = j + 1 < P.length ? T((x + P[j + 1]) / 2) - B((x + P[j + 1]) / 2) > 1e-4 : false;
      var wasIn = top.length > 0;
      if (inside || wasIn) { top.push([x, T(x)]); bot.push([x, B(x)]); }
      if (!inside && wasIn) flush();
    }
    flush();
    return out.filter(function (p) { return area(p) > 1e-3; });
  }
  function vx(lines) { var o = []; lines.forEach(function (p) { p.forEach(function (q) { o.push(q[0]); }); }); return o; }

  // ---------------- 산출 ----------------
  function compute(dxf, cfgIn) {
    var cfg = {}; for (var k in DEFAULT_CFG) cfg[k] = DEFAULT_CFG[k]; for (k in (cfgIn || {})) cfg[k] = cfgIn[k];
    var E = dxf.ents, cx = cfg.cx;
    function lines(ly) { var o = []; E.forEach(function (e) { if (inLayers(e, ly)) { var p = pts(e); if (p.length >= 2) o.push(p); } }); return o; }
    var grounds = lines(cfg.lyGround).filter(function (p) { return p.length > 3; });
    var plans = lines(cfg.lyPlan), steps = lines(cfg.lyStep), filters = lines(cfg.lyFilter);
    var excav = lines(cfg.lyExcav), earth = lines(cfg.lyEarth), riprap = lines(cfg.lyRiprap), found = lines(cfg.lyFound);
    // 포장 블록 외곽(블록 정의의 첫 폐합 폴리라인)
    var pav = [];
    E.forEach(function (e) {
      if (e.type !== 'INSERT' || !inLayers(e, cfg.lyPave)) return;
      var nm = get(e, '2', '').trim(), b = dxf.blocks[nm]; if (!b) return;
      var outline = null;
      b.forEach(function (be) { if (!outline && be.type === 'LWPOLYLINE' && ((+get(be, '70', '0')) & 1)) outline = pts(be); });
      if (!outline) return;
      var sx = +get(e, '41', '1'), sy = +get(e, '42', '1'), x0 = +get(e, '10'), y0 = +get(e, '20');
      pav.push(outline.map(function (q) { return [x0 + sx * q[0], y0 + sy * q[1]]; }));
    });
    // 수량표(기존) 위치 → 측점
    var pre = cfg.boxPrefix, boxes = [];
    E.forEach(function (e) {
      if (e.type === 'TEXT' && e.layer.indexOf(pre) === 0) {
        var x = +get(e, '10'), y = +get(e, '20'), parts = e.layer.split('-');
        var ln = getLine(e, '1');
        boxes.push({ side: x < cx ? 'L' : 'R', item: parts[parts.length - 1], x: x, y: y, text: ln >= 0 ? dxf.lines[ln].trim() : '', lineNo: ln });
      }
    });
    var stBoxes = boxes.filter(function (b) { return b.item === '측점'; });
    // 값 텍스트를 측점박스에 연결
    boxes.forEach(function (b) {
      if (b.item === '측점') return;
      var best = null;
      stBoxes.forEach(function (s) { var d = s.y - b.y; if (s.side === b.side && d > 0 && d < 5 && (!best || d < best.y - b.y)) best = s; });
      b.owner = best;
    });
    var out = [];
    stBoxes.sort(function (a, b) { return a.y - b.y || (a.side < b.side ? -1 : 1); });
    stBoxes.forEach(function (sb) {
      var side = sb.side, ybox = sb.y;
      var gr = null, gap = Infinity;
      grounds.forEach(function (p) { var d = yr(p)[0] - ybox; if (d > 0 && d < 12 && xr(p)[0] < cx - 30 && d < gap) { gap = d; gr = p; } });
      var r = { station: sb.text, side: side, y: ybox, ok: !!gr, q: {}, old: {}, cells: [], geo: {} };
      function add(item, p, closed) { if (p && p.length > 1) (r.geo[item] = r.geo[item] || []).push({ p: p, c: !!closed }); }
      boxes.forEach(function (b) { if (b.owner === sb) { r.old[b.item] = b.text; r.cells.push(b); } });
      out.push(r);
      if (!gr) return;
      var G = fnOf(gr), y0 = ybox, y1 = yr(gr)[1] + 3;
      function band(p) { var a = yr(p); return a[0] > y0 && a[1] < y1; }
      function cl(ls) { var o = []; ls.forEach(function (p) { if (band(p)) clipSide(p, cx, side).forEach(function (q) { o.push(q); }); }); return o; }
      var pl = cl(plans), q = r.q;
      // 성토·절토 (평균단면법용 단면적)
      var fill = 0, cut = 0;
      var gvx = gr.map(function (q) { return q[0]; });
      pl.forEach(function (p) {
        var x = xr(p), P = fnOf(p), a = integ(P, G, x[0], x[1], cfg.n); fill += a[0]; cut += a[1];
        var xs = gvx.concat(p.map(function (q) { return q[0]; }));
        regions(P, G, xs, x[0], x[1]).forEach(function (g) { add('성토', g, 1); });
        regions(G, P, xs, x[0], x[1]).forEach(function (g) { add('절토', g, 1); });
      });
      // 포장 단면(지반 위, 해당 측)은 흙쌓기에서 제외
      var pavIn = 0;
      pav.forEach(function (P) {
        var Y = yr(P); if (Y[0] < y0 || Y[1] > y1) return;
        var X = xr(P), a0 = side === 'R' ? Math.max(X[0], cx) : X[0], a1 = side === 'R' ? X[1] : Math.min(X[1], cx);
        if (a1 <= a0) return;
        add('성토(포장제외)', P, 1);
        var n = 800, dx = (a1 - a0) / n;
        for (var i = 0; i < n; i++) {
          var x = a0 + (i + 0.5) * dx, g = G(x);
          vint(P, x).forEach(function (iv) { var lo = Math.max(iv[0], g); if (iv[1] > lo) pavIn += (iv[1] - lo) * dx; });
        }
      });
      q['성토'] = Math.max(fill - pavIn, 0); q['절토'] = cut;
      // 필터매트·식생호안블럭
      var fl = cl(filters), hz = [], blk = 0;
      q['필터매트'] = fl.reduce(function (s, p) { return s + plen(p); }, 0);
      fl.forEach(function (p) { add('필터매트', p); });
      segs(fl).forEach(function (s) {
        var dx = Math.abs(s[1][0] - s[0][0]), dy = Math.abs(s[1][1] - s[0][1]);
        if (dx > 0.5 && dy / dx > 0.2) { hz.push([Math.min(s[0][0], s[1][0]), Math.max(s[0][0], s[1][0])]); blk += dist(s[0], s[1]); add('식생호안블럭', [s[0], s[1]]); }
      });
      q['식생호안블럭'] = blk;
      // 면고르기(비탈길이, 둑마루·소단 제외) / 거적덮기(호안 피복구간 제외)
      var sf = 0, sc = 0, gj = 0;
      segs(pl).forEach(function (s) {
        var a = s[0], b = s[1], dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
        if (dx < 1e-6 || dy / dx < cfg.flatSlope) return;
        var mx = (a[0] + b[0]) / 2, L = dist(a, b);
        if ((a[1] + b[1]) / 2 >= G(mx)) { sf += L; add('성토면고르기', [a, b]); } else { sc += L; add('절토면고르기', [a, b]); }
        var lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]), cov = 0;
        hz.forEach(function (h) { cov += Math.max(0, Math.min(hi, h[1]) - Math.max(lo, h[0])); });
        gj += L * Math.max(0, 1 - cov / (hi - lo));
        // 거적덮기 구간(호안 피복 x구간을 뺀 나머지) 표시
        var free = [[lo, hi]];
        hz.forEach(function (h) {
          var nf = []; free.forEach(function (f) {
            if (h[1] <= f[0] || h[0] >= f[1]) { nf.push(f); return; }
            if (h[0] > f[0]) nf.push([f[0], h[0]]); if (h[1] < f[1]) nf.push([h[1], f[1]]);
          }); free = nf;
        });
        var yAt = function (x) { return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); };
        free.forEach(function (f) { if (f[1] - f[0] > 1e-3) add('거적덮기', [[f[0], yAt(f[0])], [f[1], yAt(f[1])]]); });
      });
      q['성토면고르기'] = sf; q['절토면고르기'] = sc; q['거적덮기'] = gj;
      // 층따기: 원지반과 층따기선 사이
      var st = cl(steps); q['층따기'] = 0;
      if (st.length) {
        // 디딤면(비수직 선분)마다 원지반과의 사이만 적분 — 계단 무리 사이 빈 구간은 제외
        segs(st).forEach(function (s) {
          var a = s[0], b = s[1]; if (Math.abs(b[0] - a[0]) < 1e-6) return;
          var lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
          var f = function (x) { return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); };
          q['층따기'] += integ(G, f, lo, hi, Math.max(50, Math.ceil((hi - lo) * 100)))[0];
          regions(G, f, gvx, lo, hi).forEach(function (g) { add('층따기', g, 1); });
        });
      }
      // 표토제거: 제방 저면(성토부, 원지반 1:4 미만) + 토사유용(절토부) 수평폭
      var wf = 0, wc = 0;
      pl.forEach(function (p) {
        var X = xr(p), n = 2000, dx = (X[1] - X[0]) / n, P = fnOf(p); if (dx <= 0) return;
        var run = null;  // [종류, 시작x]
        function endRun(xe) {
          if (!run) return;
          var pts2 = [[run[1], G(run[1])]];
          gvx.forEach(function (gx) { if (gx > run[1] && gx < xe) pts2.push([gx, G(gx)]); });
          pts2.push([xe, G(xe)]);
          add(run[0] === 'f' ? '표토제거(제방저면)' : '표토제거(유용구간)', pts2);
          run = null;
        }
        for (var i = 0; i < n; i++) {
          var x = X[0] + (i + 0.5) * dx, d = P(x) - G(x), sl = Math.abs(G(x + 0.05) - G(x - 0.05)) / 0.1;
          var kind = (d > 0.01 && sl <= cfg.stripSlope) ? 'f' : (d < -0.01 ? 'c' : null);
          if (kind === 'f') wf += dx; else if (kind === 'c') wc += dx;
          if (!run || run[0] !== kind) { endRun(X[0] + i * dx); if (kind) run = [kind, X[0] + i * dx]; }
        }
        endRun(X[1]);
      });
      q['표토제거(제방저면)'] = wf; q['표토제거(유용구간)'] = wc;
      // 터파기: min(원지반, 계획선) ~ 터파기선·토공산출선 하한
      var ex = segs(cl(excav)); q['터파기'] = 0;
      if (ex.length) {
        var bs = ex.concat(segs(cl(earth)));
        var xa = Infinity, xb = -Infinity; ex.forEach(function (s) { xa = Math.min(xa, s[0][0], s[1][0]); xb = Math.max(xb, s[0][0], s[1][0]); });
        var plf = pl.map(function (p) { return { r: xr(p), f: fnOf(p) }; });
        var BOT = function (x) {
          var bot = Infinity;
          bs.forEach(function (s) {
            var a = s[0], b = s[1]; if (a[0] === b[0]) return;
            if ((x - a[0]) * (x - b[0]) <= 0) bot = Math.min(bot, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
          });
          return bot;
        };
        var TOP = function (x) { var top = G(x); plf.forEach(function (o) { if (x >= o.r[0] && x <= o.r[1]) top = Math.min(top, o.f(x)); }); return top; };
        var n = cfg.n, dx = (xb - xa) / n, tot = 0;
        for (var i = 0; i < n; i++) {
          var x = xa + (i + 0.5) * dx, bot = BOT(x);
          if (bot === Infinity) continue;
          var top = TOP(x);
          if (top > bot) tot += (top - bot) * dx;
        }
        q['터파기'] = tot;
        var bx = gvx.concat(vx(pl), vx(bs.map(function (s) { return [s[0], s[1]]; })));
        regions(TOP, function (x) { var b = BOT(x); return b === Infinity ? TOP(x) : b; }, bx, xa, xb).forEach(function (g) { add('터파기', g, 1); });
      }
      // 사석부설: 밑다짐 폐합 단면 / 되메우기 = 터파기 - 사석 - 기초
      var rr = cl(riprap); q['사석부설'] = 0;
      rr.forEach(function (p) { if (p.length >= 3) { q['사석부설'] += area(p.concat([p[0]])); add('사석부설', p, 1); } });
      var fd = 0; cl(found).forEach(function (p) { if (p.length >= 4 && dist(p[0], p[p.length - 1]) < 1e-6) fd += area(p); });
      if (!fd && q['사석부설'] > 0) fd = cfg.footArea;
      q['되메우기'] = q['터파기'] > 0 ? Math.max(q['터파기'] - q['사석부설'] - fd, 0) : 0;
    });
    return out;
  }

  // 측점 문자열 → 누가거리
  function stDist(s, unit) {
    var m = /No\.?\s*(\d+)\s*\+\s*([\d.]+)/i.exec(s || ''); if (!m) return null;
    return (+m[1]) * unit + (+m[2]);
  }
  function r2(v) { return Math.round(v * 100 + 1e-9) / 100; }

  // 도면 수량표 텍스트를 새 값으로 교체한 DXF 텍스트 반환
  // itemMap: 도면 항목명 → 산출 키
  // 확인 레이어 이름·색 (AutoCAD 색번호)
  var GEO_LAYERS = {
    '성토': 3, '성토(포장제외)': 8, '절토': 1, '층따기': 6, '터파기': 30, '사석부설': 40,
    '표토제거(제방저면)': 32, '표토제거(유용구간)': 34, '성토면고르기': 4, '절토면고르기': 5,
    '거적덮기': 92, '식생호안블럭': 2, '필터매트': 140
  };
  function writeDxf(dxf, rows, itemMap, opt) {
    opt = opt || {};
    var prefix = opt.layerPrefix || '물량-';
    var L = dxf.lines.slice();
    rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        if (c.lineNo < 0) return;
        var key = itemMap[c.item], v;
        if (key === undefined) v = '-';                 // 산출 대상 아님 → 지움
        else v = r.out && r.out[key] > 0.004 ? r.out[key].toFixed(2) : '-';
        L[c.lineNo] = v;
      });
    });
    if (opt.geo === false) return L.join('\r\n');

    // ---- 확인 레이어: 수량별로 산출 근거 도형을 새 레이어에 그림 ----
    var t = function (i) { return (L[i] || '').trim(); };
    var seedLine = -1, layTab = -1, layEnd = -1, entEnd = -1, layer0 = null, msOwner = null, sect = null, inLayerTab = false;
    for (var i = 0; i + 1 < L.length; i += 2) {
      var c = t(i), v = t(i + 1);
      if (c === '9' && v === '$HANDSEED') seedLine = i + 3;
      if (c === '0' && v === 'SECTION') { sect = t(i + 3); continue; }
      if (c === '0' && v === 'TABLE' && t(i + 2) === '2' && t(i + 3) === 'LAYER') { inLayerTab = true; layTab = i; continue; }
      if (inLayerTab && c === '0' && v === 'ENDTAB') { layEnd = i; inLayerTab = false; continue; }
      if (inLayerTab && c === '0' && v === 'LAYER' && !layer0) {
        var j = i + 2, rec = [];
        while (t(j) !== '0') { rec.push([t(j), L[j + 1].trim()]); j += 2; }
        if (rec.some(function (p) { return p[0] === '2' && p[1] === '0'; })) layer0 = rec;
      }
      if (sect === 'ENTITIES' && c === '0' && v === 'ENDSEC') { entEnd = i; sect = null; }
      if (sect === 'ENTITIES' && !msOwner && c === '330') msOwner = v;
    }
    if (seedLine < 0 || layEnd < 0 || entEnd < 0) return L.join('\r\n');
    var seed = parseInt(t(seedLine), 16);
    function h() { return (seed++).toString(16).toUpperCase(); }
    var layHandle = null;
    for (var k = layTab + 2; k < layTab + 12; k += 2) if (t(k) === '5') { layHandle = t(k + 1); break; }
    var used = {};
    rows.forEach(function (r) { for (var g in (r.geo || {})) used[g] = 1; });
    var existing = {};
    E_layers(dxf).forEach(function (n) { existing[n] = 1; });
    var layRecs = [];
    Object.keys(GEO_LAYERS).forEach(function (g) {
      if (!used[g] || existing[prefix + g]) return;
      var rec = ['0', 'LAYER', '5', h(), '330', layHandle, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord',
        '2', prefix + g, '70', '0', '62', String(GEO_LAYERS[g]), '6', 'Continuous'];
      if (layer0) layer0.forEach(function (p) { if (p[0] === '370' || p[0] === '390' || p[0] === '347' || p[0] === '348') rec.push(p[0], p[1]); });
      layRecs = layRecs.concat(rec);
    });
    var ents = [];
    rows.forEach(function (r) {
      for (var g in (r.geo || {})) {
        if (!GEO_LAYERS[g]) continue;
        r.geo[g].forEach(function (o) {
          var p = o.p.slice();
          if (o.c && p.length > 2 && dist(p[0], p[p.length - 1]) < 1e-9) p.pop();
          ents.push('0', 'LWPOLYLINE', '5', h());
          if (msOwner) ents.push('330', msOwner);
          ents.push('100', 'AcDbEntity', '8', prefix + g, '100', 'AcDbPolyline', '90', String(p.length), '70', o.c ? '1' : '0', '43', '0.0');
          p.forEach(function (q) { ents.push('10', q[0].toFixed(4), '20', q[1].toFixed(4)); });
        });
      }
    });
    // 뒤에서부터 삽입(앞 줄 번호 유지)
    L.splice.apply(L, [entEnd, 0].concat(ents));
    L.splice.apply(L, [layEnd, 0].concat(layRecs));
    L[seedLine] = seed.toString(16).toUpperCase();
    return L.join('\r\n');
  }
  function E_layers(dxf) {
    var o = [], L = dxf.lines, inT = false;
    for (var i = 0; i + 1 < L.length; i += 2) {
      var c = L[i].trim(), v = L[i + 1].trim();
      if (c === '0' && v === 'TABLE' && (L[i + 3] || '').trim() === 'LAYER') inT = true;
      else if (inT && c === '0' && v === 'ENDTAB') break;
      else if (inT && c === '2') o.push(v);
    }
    return o;
  }

  return { parse: parse, compute: compute, stDist: stDist, r2: r2, writeDxf: writeDxf, DEFAULT_CFG: DEFAULT_CFG };
})();
if (typeof module !== 'undefined') module.exports = QE;
