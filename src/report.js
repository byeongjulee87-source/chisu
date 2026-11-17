/* 부록 제5장(5.1 경제성분석 · 5.2 소요재원 · 5.3 투자우선순위) hwpx 생성
 * 템플릿 section0.xml 문자열을 직접 편집(서식 유지): 결과표 행을 지구·빈도 수만큼 다시 만들고 문장 속 수치를 바꿈
 */
var REPORT = (function () {
  'use strict';
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function txt(seg) { var o = '', re = /<hp:t>([^<]*)<\/hp:t>/g, m; while ((m = re.exec(seg))) o += m[1]; return o; }

  // 균형 맞는 요소 범위 찾기 (tag: 'hp:tbl' 등)
  function ranges(s, tag, from, to) {
    var out = [], open = new RegExp('<' + tag + '[\\s>]|</' + tag + '>', 'g'), depth = 0, st = 0, m;
    open.lastIndex = from || 0;
    while ((m = open.exec(s)) && (to === undefined || m.index < to)) {
      if (m[0][1] !== '/') { if (depth === 0) st = m.index; depth++; }
      else { depth--; if (depth === 0) out.push([st, m.index + m[0].length]); }
    }
    return out;
  }
  function topParas(s) { var i0 = s.indexOf('>', s.indexOf('<hs:sec')) + 1; return ranges(s, 'hp:p', i0); }

  // ---- 셀 편집 ----
  function setCellText(tc, value) {
    var v = esc(value === null || value === undefined ? '' : value), first = true;
    var TT = /<hp:t>(?:[^<]|<(?!\/hp:t>)[^>]*>)*<\/hp:t>|<hp:t\/>/g;   // 글자 안에 <hp:fwSpace/> 등 태그가 든 경우도
    var has = new RegExp(TT.source).test(tc);
    if (has) return tc.replace(TT, function () { var r = first ? '<hp:t>' + v + '</hp:t>' : '<hp:t></hp:t>'; first = false; return r; });
    return tc.replace(/<hp:run charPrIDRef="(\d+)"\s*\/>/, '<hp:run charPrIDRef="$1"><hp:t>' + v + '</hp:t></hp:run>');
  }
  function cellsOf(tr) { return ranges(tr, 'hp:tc').map(function (r) { return tr.slice(r[0], r[1]); }); }
  function col(tc) { return +(/colAddr="(\d+)"/.exec(tc) || [0, 0])[1]; }
  function setAddr(tc, row, rowSpan) {
    tc = tc.replace(/rowAddr="\d+"/, 'rowAddr="' + row + '"');
    if (rowSpan) tc = tc.replace(/rowSpan="\d+"/, 'rowSpan="' + rowSpan + '"');
    return tc;
  }
  function trWrap(tr, cells) { var a = tr.indexOf('>') + 1; return tr.slice(0, a) + cells.join('') + '</hp:tr>'; }

  /* 표 다시 만들기
   * tbl: 표 XML, header: 머리행 수, groups: [[row values...], ...] (row values는 첫 데이터행 셀 순서 기준 배열)
   */
  function rebuild(tbl, header, groups, nameCol) {
    var trs = ranges(tbl, 'hp:tr').map(function (r) { return tbl.slice(r[0], r[1]); });
    var R1 = trs[header], R2 = trs[header + 1] || trs[header];
    // 템플릿에서 '두 번째 지구의 첫 행'(지구명 칸이 다시 채워진 행)을 찾아 지구 시작행 서식으로 사용
    var RG = R1;
    if (nameCol !== undefined) for (var k = header + 1; k < trs.length; k++) {
      var cc = cellsOf(trs[k]).filter(function (c) { return col(c) === nameCol; })[0];
      if (cc && txt(cc).trim()) { RG = trs[k]; break; }
    }
    var c1 = cellsOf(R1), c2 = cellsOf(R2), cg = cellsOf(RG);
    var cols2 = c2.map(col), colsG = cg.map(col);
    var merged = c1.map(function (c) { return cols2.indexOf(col(c)) < 0; });     // 첫 행에만 있는 열(병합)
    var mergedCols = c1.filter(function (c, i) { return merged[i]; }).map(col).sort(function (a, b) { return a - b; });
    var total = groups.reduce(function (s, g) { return s + g.length; }, 0);
    var out = trs.slice(0, header).map(function (tr) { return tr.replace(/(<hp:tc [^>]*?)header="0"/g, '$1header="1"'); }), rowNo = header;
    groups.forEach(function (g, gi) {
      g.forEach(function (vals, ri) {
        var cells = [], base = (gi === 0 && ri === 0) ? c1 : ri === 0 ? cg : c2, baseCols = base === c1 ? c1.map(col) : base === cg ? colsG : cols2;
        c1.forEach(function (c, i) {
          var cc = col(c);
          if (merged[i]) {
            if (ri > 0) return;                                           // 그룹 첫 행에만
            var isRiver = cc === mergedCols[0] && mergedCols.length > 1;   // 첫 병합열 = 하천명(표 전체)
            if (isRiver && (gi > 0)) return;
            var span = isRiver ? total : g.length;
            cells.push(setAddr(setCellText(c, vals[i]), rowNo, span));
          } else {
            var tpl = base[baseCols.indexOf(cc)] || c;
            cells.push(setAddr(setCellText(tpl, vals[i]), rowNo));
          }
        });
        out.push(trWrap(ri === 0 ? (gi === 0 ? R1 : RG) : R2, cells));
        rowNo++;
      });
    });
    var a = tbl.indexOf(trs[0]), lastTr = ranges(tbl, 'hp:tr').pop();
    var head = tbl.slice(0, a).replace(/rowCnt="\d+"/, 'rowCnt="' + rowNo + '"');
    // 글자처럼 취급된 표는 쪽을 넘기지 못해 아래가 잘림 → 행이 많으면 일반 개체로 바꿔 쪽마다 나뉘게(머리행 반복)
    if (rowNo > 20) head = head.replace(/(<hp:pos [^>]*?)treatAsChar="1"/, '$1treatAsChar="0"').replace(/pageBreak="(NONE|TABLE)"/, 'pageBreak="CELL"');
    return head + out.join('') + tbl.slice(lastTr[1]);
  }

  // 천 단위 쉼표 + 소수 자리 (값이 0이면 '-')
  function f(v, d) {
    d = d || 0;
    if (v === null || v === undefined || v === '' || !isFinite(v)) return '-';
    if (Math.abs(v) < Math.pow(10, -d) / 2) return '-';
    var s = Math.abs(v).toFixed(d).split('.');
    var a = s[0], o = '';
    while (a.length > 3) { o = ',' + a.slice(-3) + o; a = a.slice(0, -3); }
    s[0] = a + o;
    return (v < 0 ? '-' : '') + s.join('.');
  }
  // 그룹 첫 행에만 하천명·지구명 표시(표 전체 첫 행에만 하천명)
  function label(groups) {
    groups.forEach(function (g, gi) { g.forEach(function (row, ri) { if (ri > 0) { row[0] = ''; row[1] = ''; } else if (gi > 0) row[0] = ''; }); });
    return groups;
  }

  // ---- K-FRM: 다차원법 방법론 절을 K-FRM 방법론 문단으로 교체 ----
  function paraLike(tpl, text) {
    var first = true, out = tpl.replace(/<hp:t>(?:<hp:titleMark[^>]*\/>)?[^<]*<\/hp:t>|<hp:t\/>/g, function () { var r = first ? '<hp:t>' + esc(text) + '</hp:t>' : ''; first = false; return r; });
    return out.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
  }
  function kfrmSection(xml, P, st) {
    var paras = topParas(xml), T = function (p) { return txt(xml.slice(p[0], p[1])).trim(); };
    var find = function (re) { return paras.filter(function (p) { return re.test(T(p)); })[0]; };
    var pBody = find(/^치수사업에서 경제성 분석은/), pGa = find(/^가\.\s*다차원 홍수피해 산정방법의 기본구성/), pH1 = find(/^2\)\s*일반 자산피해액 산정의 기본단위/), pEnd = find(/^5\)\s*유량규모별 피해액/);
    var p5 = find(/^금회 과업 대상 하천의 치수 경제성 분석은/);
    if (!pBody || !pGa || !pH1 || !pEnd) return xml;
    var body = xml.slice(pBody[0], pBody[1]), hGa = xml.slice(pGa[0], pGa[1]), h1 = xml.slice(pH1[0], pH1[1]);
    var inv = P.kfrmInv || {}, cpiF = st.cpiF ? (+st.cpiF).toFixed(4) : '';
    var B = function (t) { return paraLike(body, t); }, G = function (t) { return paraLike(hGa, t); }, H = function (t) { return paraLike(h1, t); };
    var dur = (typeof KFRM !== 'undefined' ? KFRM.DURATIONS : ['1~2일', '3~4일', '5~6일', '7일 이상'])[st.duration || 0];
    var parts = [
      G('가. K-FRM 홍수피해 산정방법'),
      B('금회 치수경제성 분석의 홍수피해액은 「하천기본계획 수립지침(2025)」 붙임 8에 따라 「예비타당성조사 수행을 위한 세부지침 수자원부문 연구(KDI)」에 제시된 K-FRM(Korean Flood Risk Model)으로 산정하였다. K-FRM은 홍수(침수) 위험구역 내 건물, 차량, 농경지 등 자산과 인구의 현황 및 침수심에 따른 피해특성(손상함수)을 고려하여 피해물량과 피해액을 산정하는 방법으로, 읍·면·동 통계자료를 토지피복에 배분하던 다차원법과 달리 개별 건물(객체), 집계구, 필지 단위의 인벤토리를 직접 사용한다.'),
      B('피해액은 ① 해저드 분석(빈도별 침수범위·침수심), ② 노출자산 인벤토리 구축, ③ 손상함수에 의한 취약성 평가, ④ 자산가치(최대피해액)와 손상률에 의한 피해액 추정의 4단계로 산정하였다. 침수심은 개수 전 측점별 빈도별 홍수위를 측선 간 거리에 따라 선형보간한 수면과 수치지형도(등고선·표고점)로 만든 지반고의 차(하도버퍼링)로 ' + (st.cell || 1) + 'm 격자마다 산정하였다.'),
      B('피해대상은 사유자산(건물구조물·건물내용물, 차량, 농작물·농경지), 인적피해(인명·이재민), 공공시설로 구분하였으며, 원단위는 K-CDMS 2020년 기준값에 소비자물가지수를 적용하여 ' + st.priceYear + '년 가치로 환산하였다' + (cpiF ? '(환산계수 ' + cpiF + ').' : '.')),
      G('나. 피해유형별 산정방법'),
      H('1) 건물피해'),
      B('건물피해액은 건물구조물 피해액(건물구조물 자산가치 × 손상률)과 건물내용물 피해액(건물구조물 자산가치 × CSVR × 손상률)의 합으로 산정하였다. 건물구조물 자산가치는 건축면적 × 건물신축단가(한국부동산원 건물신축단가표 기준, 단독주택 조적조 1,228천원/㎡, 아파트 1,462천원/㎡ 등) × (1 − 감가상각률)이며, 감가상각은 유형고정자산 내용연수표의 내용연한에 의한 정액법을 적용하되 최소 잔존률 20%를 두었다. 건물내용물(재고자산 포함) 가치는 건물용도별 CSVR(단독주택 47.1%, 아파트 42.9%, 다세대·연립주택 30.9%, 비주거건물 11.1~564.0%)을 적용하였다.'),
      B('손상률은 건물 1층 내부 바닥을 기준으로 한 침수심(건물외부 침수심 − 출입구 높이: 단독주택·아파트 0.30m, 다세대·연립주택 0.25m, 비주거 0.20m)에 대하여 0.3m 간격, 최대 3.0m까지의 건물유형(용도 31종, 단독주택은 구조 4종)별 손상함수를 적용하였다.' + (inv.b ? ' 금회 분석에는 건물 인벤토리 ' + f(inv.b) + '동을 사용하였으며, 구조 정보가 없는 단독주택은 ' + (st.defStr || '조적조') + '로 보았다.' : ' 건물 인벤토리를 확보하지 못한 경우 건물피해는 산정되지 않으므로 인벤토리 확보 후 재산정이 필요하다.')),
      H('2) 차량피해'),
      B('차량피해액은 차량대수 × 대표차량 재구매비 × 평균잔존률(승용 38.30%, 승합 31.82%, 화물 32.05%) × 손상률로 산정하였다. 집계구 단위 차량 인벤토리를 침수면적 비율(침수편입률)로 배분하고, 차고에 따른 3개 유형의 손상함수(손상 시작 0.3m, 전손 침수심 1.2m·1.5m·2.4m)를 적용하였다.' + (inv.v ? '' : ' 금회 분석에서는 차량 인벤토리를 확보하지 못하여 차량피해를 제외하였다.')),
      H('3) 인적피해'),
      B('인명피해액은 노출위험인구(PAR) × 인명피해 발생확률 × 사상자 피해원단위로 산정하였다. 발생확률은 취약계층(5세 미만·65세 이상) 0.00027887(침수심 1m 미만)·0.00087191(1m 이상), 일반계층 0.00011419·0.00039543명/명이며, 사상자 피해원단위는 사망자 58%·부상자 42%를 가중평균한 492,826천원/인(2020)이다. 이재민피해액은 PAR × 이재민 발생확률(0.013411) × 대피기간(10일) × 일평균 국민소득으로 산정하였다.' +
        (inv.p ? ' PAR은 집계구 인구 인벤토리에 침수편입률을 곱하여 산정하였다.' : ' 집계구 인구 인벤토리 대신 읍·면·동 인구를 주거지역(대지) 면적 비율로 배분하여 PAR을 산정하였다.')),
      H('4) 농업피해'),
      B('농작물피해액은 경작면적 × (홍수기 평균 투입생산비 + 기대순수익) × 손상률로 산정하였으며, 논벼·시설딸기·인삼과 밭작물 7종(수박, 가을무, 가을배추, 참깨, 옥수수, 콩, 고구마)의 침수심(0.3m 간격 4구간)·침수기간 손상함수를 적용하였다. 침수기간은 ' + dur + '로 보았다. 농경지피해는 침수심 1m 이상에서 매몰·유실 피해원단위 평균(3,397원/㎡, 2020)을 적용하였다.' +
        (inv.f ? '' : ' 농경지 인벤토리 대신 토지피복도의 논은 논벼, 밭은 밭작물 7종 평균으로 보았다.')),
      H('5) 공공시설피해'),
      B('공공시설 피해액은 (사유자산 피해액 + 인적피해액) × 공공시설 피해 비율계수로 산정하였으며, 비율계수는 2006~2020년 재해연보의 피해사례를 사후분석한 0.865(도로 0.143, 하천 0.202, 소하천 0.193, 수도 0.027, 철도 0.008, 수리 0.087, 소규모 0.116, 기타 0.089)를 적용하였다.'),
      H('6) 직접피해액 산정'),
      B('직접피해액은 건물피해액, 차량피해액, 농업피해액, 인적피해액, 공공시설 피해액의 합으로 산정하였다.')
    ];
    var endText = xml.slice(pEnd[0], pEnd[1]).replace(/(<hp:t>(?:<hp:titleMark[^>]*\/>)?)5\)/, '$17)');
    xml = xml.slice(0, pBody[0]) + parts.join('') + endText + xml.slice(pEnd[1]);
    if (p5) {
      var seg = xml.slice(p5[0], p5[1]);
      xml = xml.slice(0, p5[0]) + paraLike(seg, '금회 과업 대상 하천의 치수경제성 분석은 「하천기본계획 수립지침(2025)」에 따라 K-FRM(Korean Flood Risk Model)으로 빈도별 홍수피해액을 산정하고, 할인율·분석기간·유지관리비 등 경제성 평가 기준을 적용하여 편익·비용을 비교하였다. K-FRM은 개별 건물과 집계구·필지 단위의 자산·인구 인벤토리에 국내 피해자료로 개발된 손상함수를 적용하여 피해물량과 피해액을 함께 제시하는 방법으로, 기존 다차원법의 읍·면·동 단위 자산 배분과 일본 손상함수 사용의 한계를 개선한 방법이다.') + xml.slice(p5[1]);
    }
    return xml;
  }
  // 표 머리글 칸 글자 바꾸기 {행,열: 글자}
  function relabel(tbl, map) {
    return tbl.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, function (tc) {
      var r = (/rowAddr="(\d+)"/.exec(tc) || [])[1], c = (/colAddr="(\d+)"/.exec(tc) || [])[1], k = r + ',' + c;
      return map[k] !== undefined ? setCellText(tc, map[k]) : tc;
    });
  }

  /* P: 프로젝트(입력), O: ECON.run 결과, A: AHP 결과, st: 설정 */
  // ---- 부록 5장 K-FRM 양식(위험노출건물·차량·인적·농업·총피해·연평균·경제성·AHP·개략사업비) ----
  function buildK(xml, P, O, A, st) {
    var res = O.results.filter(function (r) { return !r.error; }), Ts = O.Ts, K = 1000;   // 백만원 → 천원
    var grade = st.riverGrade || '';
    // 하천명 칸: 하천의 첫 지구 첫 행 = 하천명, 둘째 행 = 등급
    var lab = function (groups, rivers) {
      var seen = {};
      groups.forEach(function (g, gi) {
        var rv = rivers[gi], first = !seen[rv]; seen[rv] = 1;
        g.forEach(function (row, ri) { row[0] = first && ri === 0 ? rv : first && ri === 1 ? grade : ''; if (ri > 0) row[1] = ''; });
      });
      return groups;
    };
    var rivers = res.map(function (r) { return r.district.river || ''; });
    var perT = function (fn) { return lab(res.map(function (r) { return Ts.map(function (T) { return [null, r.district.name, T].concat(fn(r.damage[T] || {}, r, T)); }); }), rivers); };
    var tbls = ranges(xml, 'hp:tbl').map(function (r) { return { a: r[0], b: r[1], t: txt(xml.slice(r[0], r[1])).replace(/\s/g, '') }; });
    var find = function (re, not) { return tbls.filter(function (t) { return /하천명/.test(t.t) && re.test(t.t) && !(not && not.test(t.t)); }); };   // 결과표는 모두 '하천명' 머리칸
    var jobs = [], removeT = [];
    var add = function (list, header, groups) { if (!list.length) return; jobs.push({ t: list[0], header: header, groups: groups }); removeT = removeT.concat(list.slice(1)); };
    // 대상지구
    add(find(/측점\(No\.\)/), 1, lab(P.districts.map(function (d) { return [[null, d.name, String(d.bank || '').replace('안', ''), d.section || '', f((d.lenLevee || 0) + (d.lenReinf || 0) + (d.lenRevet || 0)), '']]; }), P.districts.map(function (d) { return d.river || ''; })));
    add(find(/위험노출건물/), 1, perT(function (d) { return [f(d.bExp), f(d.nBldg), f(d.building * K), f(d.contents * K), f((d.building + d.contents) * K)]; }));
    add(find(/위험노출차량/), 1, perT(function (d) { return [f(d.nVeh, 1), f(d.vehDmgN, 1), f(d.vehVal * K), f(d.vehicle * K)]; }));
    add(find(/이재민수/), 2, perT(function (d) { return [f(d.casGen, 4), f(d.casVul, 4), f(d.lifeOnly * K), f(d.evacuees, 1), f(d.evac * K), f((d.lifeOnly + d.evac) * K)]; }));
    add(find(/매몰비용/), 2, perT(function (d) { return [f(d.cropArea), f(d.cropCost * K), f(d.cropNet * K), f(d.farmArea), f(d.farmland * K), f((d.crop + d.farmland) * K)]; }));
    add(find(/사유재산피해액/), 2, perT(function (d) { return [f((d.building + d.contents) * K), f(d.vehicle * K), f((d.lifeOnly + d.evac) * K), f(d.agriculture * K), f(d.public * K), f(d.total * K)]; }));
    // 연평균 피해경감기대액 (econ.annual과 같은 구간 적분)
    add(find(/구간확률/, /유량규모/), 1, lab(res.map(function (r) {
      var prevP = null, prevD = 0, cum = 0;
      return Ts.map(function (T, i) {
        var pT = 1 / T, D = ((r.damage[T] || {}).total || 0) * K, dP = i === 0 ? pT : prevP - pT, avg = i === 0 ? D / 2 : (prevD + D) / 2, an = dP * avg; cum += an; prevP = pT; prevD = D;
        return [null, r.district.name, T, pT.toFixed(4), f(D), f(avg), dP.toFixed(4), f(an), f(cum)];
      });
    }), rivers));
    add(find(/현재가치편익/), 1, lab(res.map(function (r) { return Ts.map(function (T) { var e = r.econ[T] || {}; return [null, r.district.name, T, f(e.benefitPV), f(e.costPV), e.BC !== undefined ? e.BC.toFixed(3) : '-', f(e.NPV), e.IRR ? (e.IRR * 100).toFixed(2) : '-']; }); }), rivers));
    var rk = {}; (A.rows || []).forEach(function (a) { rk[a.name] = a; });
    add(find(/홍수피해잠재능/, /설명/), 2, lab(res.map(function (r) { var a = rk[r.district.name] || {}; return [[null, r.district.name, a.BC !== undefined ? a.BC.toFixed(3) : '-', a.sPFD !== undefined ? a.sPFD.toFixed(2) : '-', a.sRisk !== undefined ? a.sRisk.toFixed(2) : '-', a.sEco !== undefined ? a.sEco.toFixed(2) : '-', a.sLag !== undefined ? a.sLag.toFixed(2) : '-', a.score !== undefined ? a.score.toFixed(2) : '-', a.rank || '-']]; }), rivers));
    add(find(/용지보상비/), 2, lab(res.map(function (r) {
      var T = r.district.designT, c = (P.costs[r.district.name] || {})[T] || {}, e = r.econ[T] || {};
      var lev = (c.축제공 || 0) + (c.호안공 || 0), str = c.구조물공 || 0, sub = (c.부대공 || 0) + (c.제경비 || 0), comp = c.보상비 || 0;
      return [[null, r.district.name, f(lev), f(str), f(e.om, 1), f(sub), f(comp), f(lev + str + sub + comp)]];
    }), rivers));
    var edits = jobs.map(function (j) { return { a: j.t.a, b: j.t.b, s: rebuild(xml.slice(j.t.a, j.t.b), j.header, j.groups) }; });
    topParas(xml).forEach(function (p) { if (removeT.some(function (r) { return r.a >= p[0] && r.b <= p[1]; })) edits.push({ a: p[0], b: p[1], s: '' }); });
    edits.sort(function (x, y) { return y.a - x.a; });
    var lastA = Infinity;
    edits.forEach(function (e) { if (e.b <= lastA) { xml = xml.slice(0, e.a) + e.s + xml.slice(e.b); lastA = e.a; } });
    // 문장: 할인율·분석기간·유지관리비율, 과업명
    var proj = st.projName || ((P.districts[0] || {}).river ? (P.districts[0].river + ' 치수경제성 분석') : '치수경제성 분석');
    xml = xml.split('{{PROJECT}}').join(esc(proj));
    xml = xml.replace(/<hp:t>([^<]*)<\/hp:t>/g, function (m, t) {
      t = t.replace(/30년 동안은\s*[\d.]+%,\s*이후 기간은\s*[\d.]+%/, st.r1Years + '년 동안은 ' + st.r1 + '%, 이후 기간은 ' + st.r2 + '%')
           .replace(/분석기간을\s*\d+년으로/, '분석기간을 ' + st.period + '년으로').replace(/사업비의 약\s*[\d.]+%/, '사업비의 약 ' + st.omRate + '%');
      return '<hp:t>' + t + '</hp:t>';
    });
    return xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
  }
  function build(xml, P, O, A, st) {
    if (/위험노출건물/.test(xml.replace(/<[^>]+>/g, '').replace(/\s/g, ''))) return buildK(xml, P, O, A, st);
    var river = (P.districts[0] || {}).river || '';
    if (st.method === 'kfrm') xml = kfrmSection(xml, P, st);
    var res = O.results.filter(function (r) { return !r.error; }), Ts = O.Ts;
    // 1) 표 찾기
    var tbls = ranges(xml, 'hp:tbl').map(function (r) { return { a: r[0], b: r[1], t: txt(xml.slice(r[0], r[1])).replace(/\s/g, '') }; });
    function find(test) { return tbls.filter(function (t) { return test(t.t); }); }
    var sig = {
      dist: function (t) { return /측점/.test(t) && /위치/.test(t) && /연장/.test(t) && !/유량/.test(t); },
      dmg: function (t) { return /피해\(보호\)면적/.test(t); },
      econ: function (t) { return /편익의현재가치/.test(t); },
      cost: function (t) { return /총사업비/.test(t) && /축제공/.test(t) && /유량/.test(t); },
      ahp: function (t) { return /통합지표/.test(t); }
    };
    var jobs = [];
    // 대상지구 현황
    var tD = find(sig.dist)[0];
    if (tD) jobs.push({ t: tD, header: 1, nameCol: 1, groups: label(P.districts.map(function (d) {
      return [[d.river, d.name, String(d.bank || '').replace('안', ''), d.section || '', (d.lenLevee || 0) + (d.lenReinf || 0) + (d.lenRevet || 0), [d.sigungu, d.emd].filter(Boolean).join(' ') + ' 일원', d.lenLevee ? '축제' : (d.lenReinf ? '보축' : '')]];
    })) });
    // 피해액
    var tG = find(sig.dmg);
    if (tG[0]) jobs.push({ t: tG[0], header: 2, nameCol: 1, groups: label(res.map(function (r) {
      return Ts.map(function (T) {
        var d = r.damage[T];
        return [river, r.district.name, T, f(d.areaHa, 2), f(d.areaRes, 2), f(d.areaAgr, 2), f(d.areaInd, 2), f(d.total, 1), f(d.residential, 1), f(d.agriculture, 1), f(d.industry, 1), f(d.general, 1), f(d.life, 1), f(d.public, 1)];
      });
    })) });
    // 경제성
    var tE = find(sig.econ);
    if (tE[0]) jobs.push({ t: tE[0], header: 1, nameCol: 1, groups: label(res.map(function (r) {
      return Ts.map(function (T) {
        var e = r.econ[T] || {};
        return [river, r.district.name, T, f(e.benefitPV), f(e.costPV), e.BC !== undefined ? e.BC.toFixed(3) : '-', f(e.NPV), e.IRR ? (e.IRR * 100).toFixed(2) : '-', T === r.district.designT ? '채택' : ''];
      });
    })) });
    // 소요재원
    var tC = find(sig.cost);
    if (tC[0]) jobs.push({ t: tC[0], header: 2, nameCol: 1, groups: label(res.map(function (r) {
      return Ts.map(function (T) {
        var c = (P.costs[r.district.name] || {})[T] || {}, sub = (c.축제공 || 0) + (c.호안공 || 0) + (c.구조물공 || 0) + (c.부대공 || 0) + (c.제경비 || 0);
        return [river, r.district.name, T, f(sub + (c.보상비 || 0)), f(c.축제공), f(c.호안공), f(c.구조물공), f(c.부대공), f(c.제경비), f(sub), f(c.보상비)];
      });
    })) });
    // AHP
    var tA = find(sig.ahp)[0];
    if (tA) jobs.push({ t: tA, header: 3, nameCol: 1, groups: A.rows.map(function (a, i) {
      return [[river.charAt(i) || '', a.name, a.BC.toFixed(2), a.sBC.toFixed(2), st.pfdGrade, a.sPFD.toFixed(2), a.risk.toFixed(2), a.sRisk.toFixed(2), st.ecoGrade, a.sEco.toFixed(2), st.lagRank, a.sLag.toFixed(2), a.score.toFixed(2), a.rank]];
    }) });
    // 2) 뒤에서부터 교체(앞 위치 유지) + 이어지는 '(계속)' 표 삭제
    var removeT = [].concat(tG.slice(1), tE.slice(1), find(sig.cost).slice(1));
    var edits = jobs.map(function (j) {
      var s = rebuild(xml.slice(j.t.a, j.t.b), j.header, j.groups, j.nameCol);
      if (st.method === 'kfrm' && j.t === tG[0]) s = relabel(s, { '0,8': '사유자산(백만원)', '1,8': '주거건물', '1,9': '농업', '1,10': '비주거·차량', '0,12': '인적피해(백만원)' });
      return { a: j.t.a, b: j.t.b, s: s };
    });
    // 삭제할 표가 든 최상위 문단 + '(계속)' 캡션 문단 + '편집 상 여백'
    var paras = topParas(xml);
    paras.forEach(function (p) {
      var seg = xml.slice(p[0], p[1]), t = txt(seg).trim();
      var hasRemoved = removeT.some(function (r) { return r.a >= p[0] && r.b <= p[1]; });
      if (hasRemoved || /\(계속\)\s*$/.test(t) || /^-\s*편집\s*상\s*여백\s*-$/.test(t)) edits.push({ a: p[0], b: p[1], s: '' });
    });
    edits.sort(function (x, y) { return y.a - x.a; });
    var lastA = Infinity;
    edits.forEach(function (e) { if (e.b <= lastA) { xml = xml.slice(0, e.a) + e.s + xml.slice(e.b); lastA = e.a; } });

    // 3) 문장 속 수치·명칭
    var nLevee = P.districts.filter(function (d) { return d.lenLevee > 0; }).length, nReinf = P.districts.length - nLevee;
    var design = res.map(function (r) { var e = r.econ[r.district.designT]; return e ? e.BC : null; }).filter(function (v) { return v !== null; });
    var nOK = design.filter(function (v) { return v >= 1; }).length, nNG = design.length - nOK;
    // 결론 문장(양식에서 형광펜 칠한 부분): 분석한 하천·지구·B/C로 새로 씀
    var okN = [], ngN = [];
    res.forEach(function (r) { var e = r.econ[r.district.designT]; if (!e) return; (e.BC >= 1 ? okN : ngN).push(r.district.name); });
    var nm = function (a) { return a.length && a.length <= 10 ? '(' + a.join(', ') + ')' : ''; }, rv = river || '본 하천', all = okN.length + ngN.length;
    var concl = !all ? rv + '의 분석지구에 대하여 치수경제성을 검토하였다.'
      : !ngN.length ? rv + '의 분석지구 ' + all + '개소에 대하여 치수경제성을 검토한 결과 모든 지구' + nm(okN) + '의 B/C가 1보다 크게 산정되어 사업성이 있는 것으로 검토되었다.'
      : !okN.length ? rv + '의 분석지구 ' + all + '개소에 대하여 치수경제성을 검토한 결과 모든 지구' + nm(ngN) + '의 B/C가 1보다 작게 산정되어 사업성이 부족한 것으로 검토되었다.'
      : rv + '의 분석지구 ' + all + '개소에 대하여 치수경제성을 검토한 결과 B/C가 1보다 크게 산정된 지구 ' + okN.length + '개소' + nm(okN) + ', B/C가 1보다 작게 산정된 ' + ngN.length + '개 지구' + nm(ngN) + '는 사업성이 부족한 것으로 검토되었다.';
    xml = xml.replace(/<hp:markpenBegin[^>]*\/>([^<]*분석지구에 대하여[^<]*)<hp:markpenEnd\/>/, function () { return esc(concl); });
    xml = xml.replace(/<hp:t>((?:[^<]|<hp:markpen(?:Begin|End)[^>]*\/>)*)<\/hp:t>/g, function (m, s) {
      s = s.replace(/축제지구\s*\d+개지구/, '축제지구 ' + nLevee + '개지구').replace(/보축지구\s*\d+개지구로\s*총\s*\d+개/, '보축지구 ' + nReinf + '개지구로 총 ' + P.districts.length + '개')
           .replace(/B\/C가 1보다 크게 산정된 지구\s*\d+개소/, 'B/C가 1보다 크게 산정된 지구 ' + nOK + '개소').replace(/B\/C가 1보다 작게 산정된\s*\d+개 지구/, 'B/C가 1보다 작게 산정된 ' + nNG + '개 지구')
           .replace(/초기\(30년\)\s*[\d.]+%,\s*이후\(20년\)\s*[\d.]+%/, '초기(' + st.r1Years + '년) ' + st.r1 + '%, 이후(' + (st.period - st.r1Years) + '년) ' + st.r2 + '%');
      if (river) s = s.split('상두천').join(river);
      return '<hp:t>' + s + '</hp:t>';
    });
    xml = xml.split('{{TITLE}}').join(esc((river ? river + ' ' : '') + '치수경제성 분석'));
    xml = xml.replace(/<hp:t>3302<\/hp:t>/, '<hp:t>' + esc(st.pfdCode || '-') + '</hp:t>');   // 양식의 PFD 단위구역(입력 없으면 '-')
    xml = xml.replace(/<hp:t>정읍시<\/hp:t>/, '<hp:t>' + esc(st.pfdArea || '-') + '</hp:t>');
    xml = xml.replace(/<hp:t>[^<]*\(계속\)\s*<\/hp:t>/g, '<hp:t></hp:t>');
    // 4) 줄 배치 캐시 삭제(한글이 다시 계산)
    xml = xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    return xml;
  }

  // AHP 통합지표 (치수사업 경제성분석 방법 연구, 2004): 경제성 0.5, 위험성·지속가능성 각 0.25(세부 0.125)
  function ahp(O, st) {
    var res = O.results.filter(function (r) { return !r.error; });
    var rows = res.map(function (r) { var e = r.econ[r.district.designT]; return { name: r.district.name, BC: e ? e.BC : 0, T: r.district.designT }; });
    var n = rows.length;
    var sorted = rows.map(function (r) { return r.BC; }).sort(function (a, b) { return a - b; });
    var eco = { 3: 1, 2: 0.75, 1: 0.5, '별도': 0.25 };
    rows.forEach(function (r) {
      r.sBC = (sorted.indexOf(r.BC) + 1) / n;
      r.sPFD = +st.pfdValue || 0;
      r.risk = 1 - Math.pow(1 - 1 / r.T, st.riskYears || 50); r.sRisk = r.risk;
      r.sEco = eco[st.ecoGrade] !== undefined ? eco[st.ecoGrade] : 1;
      r.sLag = (+st.lagRank || 0) / (+st.lagTotal || 168);
      r.score = 0.5 * r.sBC + 0.125 * (r.sPFD + r.sRisk + r.sEco + r.sLag);
    });
    var by = rows.slice().sort(function (a, b) { return b.score - a.score; });
    by.forEach(function (r, i) { r.rank = i + 1; });
    return { rows: rows };
  }

  /* tplB64: 템플릿 hwpx(base64) → Blob */
  // ---- 그림(위치도): 원래 양식의 그림 틀(1칸 표 + 자동번호 캡션 <그림 5.1-N>)을 그대로 써서 '1.2 치수사업의 편익산정' 앞에 넣음 ----
  var FRAME = "<hp:p id=\"2147483648\" paraPrIDRef=\"41\" styleIDRef=\"0\" pageBreak=\"0\" columnBreak=\"0\" merged=\"0\"><hp:run charPrIDRef=\"42\"><hp:tbl id=\"1185330942\" zOrder=\"1\" numberingType=\"PICTURE\" textWrap=\"TOP_AND_BOTTOM\" textFlow=\"BOTH_SIDES\" lock=\"0\" dropcapstyle=\"None\" pageBreak=\"NONE\" repeatHeader=\"1\" rowCnt=\"1\" colCnt=\"1\" cellSpacing=\"0\" borderFillIDRef=\"3\" noAdjust=\"0\"><hp:sz width=\"47911\" widthRelTo=\"ABSOLUTE\" height=\"64065\" heightRelTo=\"ABSOLUTE\" protect=\"0\"/><hp:pos treatAsChar=\"1\" affectLSpacing=\"0\" flowWithText=\"1\" allowOverlap=\"0\" holdAnchorAndSO=\"0\" vertRelTo=\"PARA\" horzRelTo=\"PARA\" vertAlign=\"TOP\" horzAlign=\"LEFT\" vertOffset=\"0\" horzOffset=\"0\"/><hp:outMargin left=\"140\" right=\"140\" top=\"140\" bottom=\"140\"/><hp:caption side=\"BOTTOM\" fullSz=\"0\" width=\"8504\" gap=\"850\" lastWidth=\"47911\"><hp:subList id=\"\" textDirection=\"HORIZONTAL\" lineWrap=\"BREAK\" vertAlign=\"TOP\" linkListIDRef=\"0\" linkListNextIDRef=\"0\" textWidth=\"0\" textHeight=\"0\" hasTextRef=\"0\" hasNumRef=\"0\"><hp:p id=\"2147483648\" paraPrIDRef=\"53\" styleIDRef=\"11\" pageBreak=\"0\" columnBreak=\"0\" merged=\"0\"><hp:run charPrIDRef=\"23\"><hp:t><hp:markpenBegin color=\"#FFFF00\"/>&lt;그림 5.1-</hp:t><hp:ctrl><hp:autoNum num=\"1\" numType=\"PICTURE\"><hp:autoNumFormat type=\"DIGIT\" userChar=\"\" prefixChar=\"\" suffixChar=\"\" supscript=\"0\"/></hp:autoNum></hp:ctrl><hp:t>&gt; 치수경제성 분석 지구<hp:markpenEnd/></hp:t></hp:run><hp:linesegarray><hp:lineseg textpos=\"0\" vertpos=\"0\" vertsize=\"1100\" textheight=\"1100\" baseline=\"935\" spacing=\"1100\" horzpos=\"0\" horzsize=\"47908\" flags=\"393216\"/></hp:linesegarray></hp:p></hp:subList></hp:caption><hp:inMargin left=\"0\" right=\"0\" top=\"0\" bottom=\"0\"/><hp:tr><hp:tc name=\"\" header=\"0\" hasMargin=\"0\" protect=\"0\" editable=\"0\" dirty=\"0\" borderFillIDRef=\"30\"><hp:subList id=\"\" textDirection=\"HORIZONTAL\" lineWrap=\"BREAK\" vertAlign=\"CENTER\" linkListIDRef=\"0\" linkListNextIDRef=\"0\" textWidth=\"0\" textHeight=\"0\" hasTextRef=\"0\" hasNumRef=\"0\"><hp:p id=\"2147483648\" paraPrIDRef=\"41\" styleIDRef=\"0\" pageBreak=\"0\" columnBreak=\"0\" merged=\"0\"><hp:run charPrIDRef=\"24\"><hp:pic id=\"1177836989\" zOrder=\"118\" numberingType=\"NONE\" textWrap=\"TOP_AND_BOTTOM\" textFlow=\"BOTH_SIDES\" lock=\"0\" dropcapstyle=\"None\" href=\"\" groupLevel=\"0\" instid=\"104095166\" reverse=\"0\"><hp:offset x=\"0\" y=\"0\"/><hp:orgSz width=\"210480\" height=\"279960\"/><hp:curSz width=\"48095\" height=\"64065\"/><hp:flip horizontal=\"0\" vertical=\"0\"/><hp:rotationInfo angle=\"0\" centerX=\"24047\" centerY=\"32032\" rotateimage=\"1\"/><hp:renderingInfo><hc:transMatrix e1=\"1\" e2=\"0\" e3=\"0\" e4=\"0\" e5=\"1\" e6=\"0\"/><hc:scaMatrix e1=\"0.228502\" e2=\"0\" e3=\"0\" e4=\"0\" e5=\"0.228836\" e6=\"0\"/><hc:rotMatrix e1=\"1\" e2=\"0\" e3=\"0\" e4=\"0\" e5=\"1\" e6=\"0\"/></hp:renderingInfo><hp:imgRect><hc:pt0 x=\"0\" y=\"0\"/><hc:pt1 x=\"210480\" y=\"0\"/><hc:pt2 x=\"210480\" y=\"279960\"/><hc:pt3 x=\"0\" y=\"279960\"/></hp:imgRect><hp:imgClip left=\"0\" right=\"210480\" top=\"0\" bottom=\"279960\"/><hp:inMargin left=\"0\" right=\"0\" top=\"0\" bottom=\"0\"/><hc:img binaryItemIDRef=\"image1\" bright=\"0\" contrast=\"0\" effect=\"REAL_PIC\" alpha=\"0\"/><hp:effects/><hp:sz width=\"48095\" widthRelTo=\"ABSOLUTE\" height=\"64065\" heightRelTo=\"ABSOLUTE\" protect=\"0\"/><hp:pos treatAsChar=\"1\" affectLSpacing=\"0\" flowWithText=\"1\" allowOverlap=\"0\" holdAnchorAndSO=\"0\" vertRelTo=\"PARA\" horzRelTo=\"PARA\" vertAlign=\"TOP\" horzAlign=\"LEFT\" vertOffset=\"0\" horzOffset=\"0\"/><hp:outMargin left=\"0\" right=\"0\" top=\"0\" bottom=\"0\"/><hp:shapeComment>그림입니다.\n원본 그림의 이름: CLP0000baf80001.bmp\n원본 그림의 크기: 가로 2806pixel, 세로 3733pixel</hp:shapeComment></hp:pic><hp:t/></hp:run><hp:linesegarray><hp:lineseg textpos=\"0\" vertpos=\"0\" vertsize=\"64065\" textheight=\"64065\" baseline=\"54455\" spacing=\"500\" horzpos=\"0\" horzsize=\"47908\" flags=\"393216\"/></hp:linesegarray></hp:p></hp:subList><hp:cellAddr colAddr=\"0\" rowAddr=\"0\"/><hp:cellSpan colSpan=\"1\" rowSpan=\"1\"/><hp:cellSz width=\"47911\" height=\"62904\"/><hp:cellMargin left=\"510\" right=\"510\" top=\"141\" bottom=\"141\"/></hp:tc></hp:tr></hp:tbl><hp:t/></hp:run><hp:linesegarray><hp:lineseg textpos=\"0\" vertpos=\"0\" vertsize=\"66295\" textheight=\"66295\" baseline=\"56351\" spacing=\"500\" horzpos=\"0\" horzsize=\"48188\" flags=\"393216\"/></hp:linesegarray></hp:p>";
  function figXml(f, k) {
    var ow = f.w * 75, oh = f.h * 75, H = 64065, W = Math.round(H * f.w / f.h), x = FRAME;
    var r = function (a, b) { x = x.split(a).join(b); };
    r('<hp:markpenBegin color="#FFFF00"/>', ''); r('<hp:markpenEnd/>', '');
    r('&gt; 치수경제성 분석 지구', '&gt; ' + esc(f.caption));
    r('binaryItemIDRef="image1"', 'binaryItemIDRef="' + f.id + '"');
    r('<hp:orgSz width="210480" height="279960"/>', '<hp:orgSz width="' + ow + '" height="' + oh + '"/>');
    r('<hp:curSz width="48095" height="64065"/>', '<hp:curSz width="' + W + '" height="' + H + '"/>');
    r('centerX="24047" centerY="32032"', 'centerX="' + Math.round(W / 2) + '" centerY="' + Math.round(H / 2) + '"');
    r('e1="0.228502" e2="0" e3="0" e4="0" e5="0.228836"', 'e1="' + (W / ow).toFixed(6) + '" e2="0" e3="0" e4="0" e5="' + (H / oh).toFixed(6) + '"');
    r('<hc:pt1 x="210480" y="0"/><hc:pt2 x="210480" y="279960"/><hc:pt3 x="0" y="279960"/>', '<hc:pt1 x="' + ow + '" y="0"/><hc:pt2 x="' + ow + '" y="' + oh + '"/><hc:pt3 x="0" y="' + oh + '"/>');
    r('<hp:imgClip left="0" right="210480" top="0" bottom="279960"/>', '<hp:imgClip left="0" right="' + ow + '" top="0" bottom="' + oh + '"/>');
    r('<hp:sz width="48095" widthRelTo="ABSOLUTE" height="64065"', '<hp:sz width="' + W + '" widthRelTo="ABSOLUTE" height="' + H + '"');
    r('id="1177836989"', 'id="' + (1177836989 + k) + '"'); r('instid="104095166"', 'instid="' + (104095166 + k) + '"'); r('id="1185330942"', 'id="' + (1185330942 + k) + '"');
    x = x.replace(/<hp:shapeComment>[\s\S]*?<\/hp:shapeComment>/, '<hp:shapeComment>그림입니다.\n원본 그림의 이름: ' + esc(f.file) + '\n원본 그림의 크기: 가로 ' + f.w + 'pixel, 세로 ' + f.h + 'pixel</hp:shapeComment>');
    if (k > 0) x = x.replace('pageBreak="0"', 'pageBreak="1"');
    return x.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
  }
  // 양식 안의 그림 틀(1칸 표 + <hp:pic> + 그림 캡션)을 찾아 새 그림으로 바꿔 씀
  function frameIn(xml) {
    var ps = topParas(xml);
    for (var i = 0; i < ps.length; i++) { var seg = xml.slice(ps[i][0], ps[i][1]); if (/numberingType="PICTURE"/.test(seg) && /rowCnt="1" colCnt="1"/.test(seg) && (seg.match(/<hp:pic /g) || []).length === 1) return seg; }
    return null;
  }
  function figGeneric(fr, f, k) {
    var tw = +(/<hp:tbl [\s\S]*?<hp:sz width="(\d+)"/.exec(fr) || [0, 45000])[1], W = tw - 400, H = Math.round(W * f.h / f.w);
    if (H > 62000) { H = 62000; W = Math.round(H * f.w / f.h); }
    var ow = f.w * 75, oh = f.h * 75, x = fr;
    x = x.replace(/(<hp:pic [\s\S]*?<\/hp:pic>)/, function (pic) {
      return pic.replace(/<hp:offset [^>]*\/>/, '<hp:offset x="0" y="0"/>')
        .replace(/<hp:orgSz [^>]*\/>/, '<hp:orgSz width="' + ow + '" height="' + oh + '"/>')
        .replace(/<hp:curSz [^>]*\/>/, '<hp:curSz width="' + W + '" height="' + H + '"/>')
        .replace(/centerX="\d+" centerY="\d+"/, 'centerX="' + Math.round(W / 2) + '" centerY="' + Math.round(H / 2) + '"')
        .replace(/<hc:transMatrix [^>]*\/>/, '<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>')
        .replace(/<hc:scaMatrix [^>]*\/>/, '<hc:scaMatrix e1="' + (W / ow).toFixed(6) + '" e2="0" e3="0" e4="0" e5="' + (H / oh).toFixed(6) + '" e6="0"/>')
        .replace(/<hp:imgRect>[\s\S]*?<\/hp:imgRect>/, '<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="' + ow + '" y="0"/><hc:pt2 x="' + ow + '" y="' + oh + '"/><hc:pt3 x="0" y="' + oh + '"/></hp:imgRect>')
        .replace(/<hp:imgClip [^>]*\/>/, '<hp:imgClip left="0" right="' + ow + '" top="0" bottom="' + oh + '"/>')
        .replace(/binaryItemIDRef="[^"]+"/, 'binaryItemIDRef="' + f.id + '"')
        .replace(/(<hp:sz width=")\d+(" widthRelTo="ABSOLUTE" height=")\d+/, '$1' + W + '$2' + H)
        .replace(/<hp:shapeComment>[\s\S]*?<\/hp:shapeComment>/, '<hp:shapeComment>그림입니다.\n원본 그림의 이름: ' + esc(f.file) + '\n원본 그림의 크기: 가로 ' + f.w + 'pixel, 세로 ' + f.h + 'pixel</hp:shapeComment>')
        .replace(/ id="\d+"/, ' id="' + (1300000000 + k) + '"').replace(/instid="\d+"/, 'instid="' + (200000000 + k) + '"');
    });
    x = x.replace(/(<hp:tbl [^>]*?)id="\d+"/, '$1id="' + (1310000000 + k) + '"')
         .replace(/(<hp:tbl [\s\S]*?<hp:sz width="\d+" widthRelTo="ABSOLUTE" height=")\d+/, '$1' + (H + 600))
         .replace(/(<hp:cellSz width="\d+" height=")\d+/, '$1' + (H + 300));
    // 캡션: '<그림 ..-N>' 뒤 글자만 바꿈
    x = x.replace(/(<hp:caption[\s\S]*?<\/hp:ctrl><hp:t>)&gt;[^<]*(<\/hp:t>)/, '$1&gt; ' + esc(f.caption) + '$2');
    x = x.replace(/pageBreak="\d"/, 'pageBreak="' + (k > 0 ? 1 : 0) + '"');
    return x.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '').replace(/<hp:markpen(Begin|End)[^>]*\/>/g, '');
  }
  function addFigures(zip, xml, figs) {
    if (!figs || !figs.length) return Promise.resolve(xml);
    var at = xml.indexOf('1.2 치수사업의 편익산정'), fr = null;
    if (at < 0) { at = xml.indexOf('편익(피해액) 산정</hp:t>'); fr = frameIn(xml); }   // 부록 5장 양식: 5.1.3(자동 번호) 앞
    if (at < 0) return Promise.resolve(xml);
    at = xml.lastIndexOf('<hp:p ', at);
    xml = xml.slice(0, at) + figs.map(function (f, k) { return fr ? figGeneric(fr, f, k) : figXml(f, k); }).join('') + xml.slice(at);
    figs.forEach(function (f) { zip.file('BinData/' + f.file, f.data); });
    return zip.file('Contents/content.hpf').async('string').then(function (h) {
      zip.file('Contents/content.hpf', h.replace('</opf:manifest>', figs.map(function (f) { return '<opf:item id="' + f.id + '" href="BinData/' + f.file + '" media-type="image/jpg" isEmbeded="1"/>'; }).join('') + '</opf:manifest>'));
      return xml;
    });
  }
  function make(tplB64, P, O, st, figs) {
    var A = ahp(O, st);
    return JSZip.loadAsync(tplB64, { base64: true }).then(function (zip) {
      return zip.file('Contents/section0.xml').async('string').then(function (x) {
        return addFigures(zip, build(x, P, O, A, st), figs);
      }).then(function (x) {
        zip.file('Contents/section0.xml', x);
        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
      });
    }).then(function (blob) { return { blob: blob, ahp: A }; });
  }
  return { make: make, build: build, ahp: ahp, rebuild: rebuild };
})();
