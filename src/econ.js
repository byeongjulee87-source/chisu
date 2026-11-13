/* 치수경제성 분석 엔진 — 다차원 홍수피해산정법(치수사업 경제성분석 방법 연구, 2004)
 * 입력: 지구·읍면동 기초자료, 빈도별 침수 GIS 집계(지구×침수심×토지피복), 공사비, 기준표, 설정
 * 출력: 지구×빈도별 자산가치·침수편입율·피해액·연평균피해경감기대액·B/C·NPV·IRR
 */
var ECON = (function () {
  'use strict';
  var DEPTHS = ['0~0.5', '0.5~1.0', '1.0~2.0', '2.0~3.0', '3.0이상'];
  var HOUSE = ['단독주택', '아파트', '연립주택', '다세대주택', '영업용'];

  function depthIndex(s) {
    s = String(s).replace(/\s/g, '');
    for (var i = 0; i < DEPTHS.length; i++) if (s === DEPTHS[i]) return i;
    var m = /^([\d.]+)/.exec(s); if (!m) return -1;
    var v = +m[1];
    return v < 0.5 ? 0 : v < 1 ? 1 : v < 2 ? 2 : v < 3 ? 3 : 4;
  }
  function roundup(x, d) { var f = Math.pow(10, d || 0); return Math.ceil(x * f - 1e-9) / f; }
  function round(x, d) { var f = Math.pow(10, d || 0); return Math.round(x * f + (x >= 0 ? 1e-9 : -1e-9)) / f; }
  function sum(a) { return a.reduce(function (s, v) { return s + v; }, 0); }

  // ---------- 1. 읍면동 자산가치 (백만원) ----------
  function assets(emd, tb, st) {
    var kind = emd.name.slice(-1);  // 읍/면/동
    var cpi = tb.cpi, cpiIdx = cpi[st.priceYear] / cpi[1997] * 100;
    var out = { building: {}, avgArea: {} };
    HOUSE.forEach(function (t) {
      var ratio = (tb.houseRatio[t] || {})[kind] || [];
      var rs = sum(ratio), aa = rs ? sum(ratio.map(function (r, i) { return r * tb.areaClasses[i]; })) / rs : 0;
      out.avgArea[t] = aa;
      out.building[t] = roundup(tb.unitCost[t] * aa * (emd.houses[t] || 0) * (tb.deflatorPct / 100) / 1e6, 0);
    });
    out.buildingTotal = sum(HOUSE.map(function (t) { return out.building[t]; }));
    out.contents = roundup(tb.goods[st.cityTypeGoods] * emd.households * (cpiIdx / 100) / 1e6, 0);
    var paddy = 0, field = 0;
    Object.keys(emd.crops).forEach(function (c) {
      var cc = tb.cropCost[c]; if (!cc) return;
      var v = roundup(emd.crops[c] * 10 * cc.cost * (cc.adj / 100) / 1e6, 0);
      if (c === '논벼') paddy += v; else field += v;
    });
    out.paddy = paddy; out.field = field;
    var pw = tb.perWorker[st.industrySido] || {}, tang = 0, stock = 0;
    Object.keys(emd.workers).forEach(function (k) {
      var w = emd.workers[k] || 0, p = pw[k]; if (!p || !w) return;
      tang += roundup(p[0] * w * (cpiIdx / 100) / 1e3, 0);
      stock += roundup(p[1] * w * (cpiIdx / 100) / 1e3, 0);
    });
    out.tangible = tang; out.stock = stock;
    var L = emd.land;
    out.denom = {
      주거: L['대지'] || 0,
      논: L['답'] || 0,
      밭: (L['전'] || 0) + (L['과수원'] || 0),
      산업: ['공장용지', '학교용지', '주차장', '주유소용지', '창고용지', '도로', '철도용지'].reduce(function (s, k) { return s + (L[k] || 0); }, 0)
    };
    return out;
  }

  // ---------- 2. GIS 집계: 지구·빈도·침수심·분류 ----------
  function aggregate(gis) {
    var A = {};
    gis.forEach(function (g) {
      var k = g.district + '|' + g.T, di = depthIndex(g.depth); if (di < 0) return;
      var o = A[k] = A[k] || { total: [0, 0, 0, 0, 0], 주거: [0, 0, 0, 0, 0], 논: [0, 0, 0, 0, 0], 밭: [0, 0, 0, 0, 0], 산업: [0, 0, 0, 0, 0] };
      o.total[di] += g.area;
      if (o[g.cls]) o[g.cls][di] += g.area;
    });
    return A;
  }

  // ---------- 3. 지구·빈도별 피해액 (백만원) ----------
  function damage(d, T, ag, as, tb, st) {
    var o = ag[d.name + '|' + T] || { total: [0, 0, 0, 0, 0], 주거: [0, 0, 0, 0, 0], 논: [0, 0, 0, 0, 0], 밭: [0, 0, 0, 0, 0], 산업: [0, 0, 0, 0, 0] };
    var haByDepth = o.total.map(function (a) { return round(a / 1e4, 2); });
    var areaHa = sum(haByDepth);
    var p = function (cls) { var den = as.denom[cls]; return o[cls].map(function (a) { return den ? round(a, 2) / den : 0; }); };
    var pr = p('주거'), pi = p('산업');
    var r1 = tb.bldgRate.단독;
    var rApt = r1.map(function (v) { return v / tb.bldgRate.floorsApt + 3 / (tb.bldgRate.floorsApt + 1); });
    var rRow = r1.map(function (v) { return v / tb.bldgRate.floorsRow + 3 / (tb.bldgRate.floorsRow + 1); });
    var b = as.building, bld = 0, cont = 0, tang = 0, stock = 0;
    for (var k = 0; k < 5; k++) {
      bld += b['단독주택'] * pr[k] * r1[k] / 100 + b['아파트'] * pr[k] * rApt[k] / 100 +
             (b['연립주택'] + b['다세대주택'] + b['영업용']) * pr[k] * rRow[k] / 100;
      cont += as.contents * pr[k] * tb.contentRate[k] / 100 * (st.contentsTriple ? 3 : 1);
      tang += as.tangible * pi[k] * tb.tangibleRate[k] / 100;
      stock += as.stock * pi[k] * tb.stockRate[k] / 100;
    }
    var aP = o['논'].map(function (v) { return round(v, 2); }), aF = o['밭'].map(function (v) { return round(v, 2); });
    var pLow = function (a, den) { return den ? (a[0] + a[1]) / den : 0; }, pHigh = function (a, den) { return den ? (a[2] + a[3] + a[4]) / den : 0; };
    var fl = tb.farmland, farm = 0;
    [aP, aF].forEach(function (a) { var hi = a[2] + a[3] + a[4]; farm += (hi * fl.buryIdx * fl.buryUnit + hi * fl.lossIdx * fl.lossUnit) / 2 / 1e6; });
    var crop = as.paddy * pLow(aP, as.denom.논) * tb.cropRate.논[0] + as.paddy * pHigh(aP, as.denom.논) * tb.cropRate.논[1] +
               as.field * pLow(aF, as.denom.밭) * tb.cropRate.밭[0] + as.field * pHigh(aF, as.denom.밭) * tb.cropRate.밭[1];
    // 인명·이재민
    var cpi = tb.cpi, lifeIdx = cpi[st.lifeCpiYear] / cpi[tb.lifeUnit.baseYear];
    var ct = st.cityTypeLife;
    var death = areaHa * (tb.lifePerHa.사망[ct] || 0), injury = areaHa * (tb.lifePerHa.부상[ct] || 0), evac = areaHa * (tb.evacPerHa[ct] || 0);
    var life = tb.lifeUnit.사망 * death * lifeIdx + tb.lifeUnit.부상 * injury * lifeIdx;
    var evacLoss = evac * (tb.gniDaily[st.gniYear] || 0) * tb.evacDays / 100;
    var res = bld + cont, agr = farm + crop, ind = tang + stock, general = res + agr + ind;
    var pub = general * tb.publicRatio;
    var haOf = function (arr) { return round(sum(arr) / 1e4, 2); };
    return {
      areaHa: areaHa, haByDepth: haByDepth, pRes: pr,
      areaRes: haOf(o['주거']), areaAgr: haOf(o['논'].concat(o['밭'])), areaInd: haOf(o['산업']), building: bld, contents: cont, farmland: farm, crop: crop, tangible: tang, stock: stock,
      residential: res, agriculture: agr, industry: ind, general: general, life: life + evacLoss, lifeOnly: life, evac: evacLoss,
      deaths: death, injuries: injury, evacuees: evac, public: pub, total: general + life + evacLoss + pub
    };
  }

  // ---------- 4. 연평균 피해경감기대액 ----------
  var CATS = ['building', 'contents', 'vehicle', 'farmland', 'crop', 'tangible', 'stock', 'public', 'life'];
  function annual(dmgByT, Ts, st) {
    var out = {}, cum = {}; CATS.forEach(function (c) { cum[c] = 0; });
    var prevP = null, prevD = null;
    Ts.forEach(function (T, i) {
      var p = 1 / T, dP = i === 0 ? p : prevP - p, D = dmgByT[T];
      var row = {};
      CATS.forEach(function (c) {
        var avg = i === 0 ? (D[c] || 0) / 2 : ((prevD[c] || 0) + (D[c] || 0)) / 2;
        cum[c] += dP * avg;
        row[c] = cum[c];
      });
      if (!st.lifeAnnualize) row.life = D.life;     // v9 방식: 인명피해는 해당 빈도 1회 피해액을 그대로 합산
      row.total = sum(CATS.map(function (c) { return row[c]; }));
      out[T] = row; prevP = p; prevD = D;
    });
    return out;
  }

  // ---------- 5. 경제성(B/C, NPV, IRR) ----------
  function irr(cf) {
    var npv = function (r) { var s = 0; for (var t = 0; t < cf.length; t++) s += cf[t] / Math.pow(1 + r, t + 1); return s; };
    if (sum(cf) <= 0) return 0;
    var lo = -0.99, hi = 10, flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return 0;
    for (var i = 0; i < 200; i++) { var m = (lo + hi) / 2, fm = npv(m); if (flo * fm <= 0) { hi = m; fhi = fm; } else { lo = m; flo = fm; } }
    return (lo + hi) / 2;
  }
  function cashflow(cost, benefitAnnual, st) {
    var items = ['축제공', '호안공', '구조물공', '보상비', '제경비'];
    if (st.includeSubsidiary) items.push('부대공');
    var total = sum(items.map(function (k) { return cost[k] || 0; }));
    var resid = 0; Object.keys(st.residual).forEach(function (k) { resid += (cost[k] || 0) * st.residual[k]; });
    var om = (total - resid) * st.omRate / 100, n = st.buildYears, N = n + st.period;
    var g = st.growth / 100, rows = [], B = 0, C = 0, cf = [];
    for (var t = 1; t <= N; t++) {
      var inv = t <= n ? total / n : 0;
      var omT = t > n ? om : 0;
      var res = t === N ? -resid : 0;
      var ben = t > n ? benefitAnnual * st.benefitRatio : 0;
      var df;
      if (st.discountMode === 'v9') df = Math.pow((1 + g) / (1 + (t <= n + st.r1Years ? st.r1 : st.r2) / 100), t);
      else {
        var y1 = Math.min(t, n + st.r1Years), y2 = t - y1;
        df = Math.pow(1 + g, t) / (Math.pow(1 + st.r1 / 100, y1) * Math.pow(1 + st.r2 / 100, y2));
      }
      var cost_t = inv + omT + res;
      B += ben * df; C += cost_t * df; cf.push(ben - cost_t);
      rows.push({ t: t, invest: inv, om: omT, residual: res, cost: cost_t, df: df, costPV: cost_t * df, benefit: ben, benefitPV: ben * df });
    }
    var costSum = sum(rows.map(function (r) { return r.cost; })), benSum = sum(rows.map(function (r) { return r.benefit; }));
    return { total: total, residual: resid, om: om, rows: rows, cost: costSum, costPV: C, benefit: benSum, benefitPV: B,
             BC: C ? B / C : 0, NPV: B - C, IRR: irr(cf) };
  }

  // ---------- 전체 ----------
  function run(P) {
    var st = P.settings, tb = P.tables, Ts = st.Ts.slice().sort(function (a, b) { return a - b; });
    var ag = aggregate(P.gis);
    var asMap = {}; Object.keys(P.emds).forEach(function (k) { asMap[k] = assets(P.emds[k], tb, st); });
    var res = [];
    P.districts.forEach(function (d) {
      var as = asMap[d.emd], dm = {};
      if (st.method === 'kfrm') {
        if (!P.kfrm) { res.push({ district: d, error: 'K-FRM 결과 없음(하도버퍼링 침수심 격자 필요)' }); return; }
        Ts.forEach(function (T) { dm[T] = P.kfrm[d.name + '|' + T] || KFRM.zero(); });
      } else {
        if (!as) { res.push({ district: d, error: '읍면동 기초자료 없음: ' + d.emd }); return; }
        Ts.forEach(function (T) { dm[T] = damage(d, T, ag, as, tb, st); });
      }
      var an = annual(dm, Ts, st);
      var ec = {};
      Ts.forEach(function (T) {
        var c = (P.costs[d.name] || {})[T];
        ec[T] = c ? cashflow(c, an[T].total, st) : null;
      });
      res.push({ district: d, assets: as, damage: dm, annual: an, econ: ec });
    });
    return { Ts: Ts, results: res, assets: asMap };
  }
  return { run: run, assets: assets, damage: damage, annual: annual, cashflow: cashflow, irr: irr, DEPTHS: DEPTHS, depthIndex: depthIndex };
})();
if (typeof module !== 'undefined') module.exports = ECON;
