/* K-FRM(Korean Flood Risk Model) 피해액 — 「정량적 홍수위험평가 K-FRM 기술보고서(2023)」·K-CDMS 원단위(2020) 기준
 * 하도버퍼링 침수심 격자 위에서 건물(개별 객체)·차량·인구(집계구)·농경지(필지) 피해를 지구·빈도별로 집계한다.
 * 금액은 2020년 원단위에 소비자물가지수를 곱해 가격기준년도로 환산, 결과는 백만원.
 */
var KFRM = (function () {
  'use strict';
  // ---------- 매개변수 (2020) ----------
  // 건물용도: [구조물 단가(천원/㎡), 내용연한(년), CSVR(%), 출입구높이(m)]  (표 3.5~3.7)
  var BU = {
    '단독주택': [null, null, 47.1, 0.30], '아파트': [1462, 50, 42.9, 0.30], '다세대주택/연립주택': [1096, 50, 30.9, 0.25],
    '1종근린생활시설': [944, 55, 19.9, 0.2], '2종근린생활시설': [974, 55, 30.6, 0.2], '종교시설': [1468, 55, 41.2, 0.2], '문화및집회시설': [1335, 55, 20.4, 0.2],
    '판매시설': [1446, 50, 89.9, 0.2], '운수시설': [1022, 55, 100, 0.2], '의료시설': [1362, 55, 186.2, 0.2], '장례시설': [1127, 50, 100, 0.2],
    '교육연구시설': [902, 55, 40.7, 0.2], '노유자시설': [1246, 55, 61.2, 0.2], '수련시설': [902, 55, 100, 0.2], '운동시설': [1401, 55, 35.5, 0.2],
    '공공업무시설': [1132, 55, 46.6, 0.2], '일반업무시설': [906, 55, 46.6, 0.2], '숙박시설': [1177, 50, 18.8, 0.2], '위락시설': [1177, 50, 29.2, 0.2],
    '일반공장': [686, 45, 146.5, 0], '공해공장': [1122, 45, 219.1, 0], '창고시설': [634, 45, 252.4, 0], '위험물저장처리시설': [771, 45, 41.4, 0.2],
    '자동차관련시설': [482, 45, 40.3, 0.2], '동물및식물관련시설': [370, 40, 128.4, 0.2], '분뇨쓰레기처리시설': [370, 45, 232.2, 0.2], '교정및군사시설': [992, 55, 66.7, 0.2],
    '발전시설': [1026, 55, 564, 0.2], '방송통신시설': [1026, 55, 11.1, 0.2], '묘지관련시설': [1127, 40, 100, 0.2], '관광휴게시설': [907, 50, 100, 0.2]
  };
  var DETACHED = { '조적조': [1228, 45], '철근콘크리트조': [1238, 40], '철골조': [1150, 50], '목조': [982, 43] };
  var RESID = ['단독주택', '아파트', '다세대주택/연립주택'];
  // 건물구조물 손상률(%) 0.3m 간격 11구간 (표 3.8)
  var SD = {
    '조적조': [9.5, 14.1, 19.2, 23.9, 31.5, 34.9, 39.4, 45.7, 50, 52.2, 52.2], '철근콘크리트조': [8.1, 11.9, 16.5, 22.4, 27.3, 31.1, 37, 40.6, 42.9, 45.3, 45.3],
    '철골조': [13.8, 19.9, 25.8, 30.8, 37.1, 39.7, 42.6, 48, 50.2, 53.9, 53.9], '목조': [8.2, 12.7, 16.4, 22.6, 29.5, 34.3, 40.3, 47, 53.3, 58.6, 58.6],
    '아파트': [4.5, 11.3, 17.4, 23, 28.1, 32.7, 39, 46.4, 51.1, 53.1, 53.8], '다세대주택/연립주택': [3.7, 10.5, 16.1, 20.9, 25.9, 30.9, 36.6, 43.1, 47.4, 49.6, 50.1],
    '1종근린생활시설': [0, 8, 13.1, 17.1, 23.3, 26, 29, 32.9, 36, 69, 42.3], '2종근린생활시설': [0, 8, 13.1, 17.1, 23.3, 26, 29, 32.9, 36, 69, 42.3],
    '종교시설': [3.8, 10.2, 12.3, 18.1, 22, 25.3, 32.2, 38.2, 44.8, 47, 50.9], '문화및집회시설': [0, 10, 11, 11, 12, 12, 13, 14, 14, 15, 17],
    '판매시설': [10.2, 20.4, 30.8, 35.6, 38.2, 44.5, 46.8, 50.8, 53.2, 55.5, 56.6], '운수시설': [0, 9, 11, 12, 16, 20, 24, 28, 30, 30, 30],
    '의료시설': [4.5, 8, 10, 13, 15, 18, 21, 22, 24, 25, 25], '장례시설': [2, 5, 6, 8, 10, 11, 14, 15, 16, 18, 18],
    '교육연구시설': [4, 8, 10, 14, 16, 18, 21, 23, 24, 24, 24], '노유자시설': [6.5, 12, 14, 23, 25, 29, 34, 36, 37, 38, 38],
    '수련시설': [4.5, 9, 13, 17, 20, 24, 28, 30, 31, 31, 31], '운동시설': [6.1, 12, 15.2, 21.4, 22.7, 25.4, 28.1, 30.8, 31.9, 35, 36],
    '공공업무시설': [3, 6, 7, 10, 10, 12, 15, 15, 17, 18, 18], '일반업무시설': [8.5, 12.1, 22.2, 26.4, 30.4, 34.9, 37.3, 40.6, 42.3, 45.7, 47.9],
    '숙박시설': [4.5, 7.8, 13.7, 19.5, 24.5, 30.3, 32, 34.5, 40.4, 42, 47], '위락시설': [1, 9, 11, 12, 14, 16, 18, 20, 22, 26, 29],
    '일반공장': [1, 9, 14, 17, 22, 26, 30, 32, 35, 37, 39], '공해공장': [1, 10, 12, 15, 19, 22, 26, 30, 35, 39, 42],
    '창고시설': [2.5, 6, 8.3, 10.7, 13.2, 16.4, 21.4, 24.4, 29, 31, 33.6], '위험물저장처리시설': [23.5, 29.8, 34.4, 47, 53.9, 59.9, 62.6, 64.5, 67.4, 69, 69.4],
    '자동차관련시설': [5.5, 9.9, 13.6, 19.2, 22.1, 23.9, 25.3, 27, 28.7, 30.9, 32.4], '동물및식물관련시설': [4.8, 13.7, 20.9, 27.2, 33.7, 40.2, 43.3, 46.2, 49.1, 53.4, 59],
    '분뇨쓰레기처리시설': [17, 34, 44, 52, 59, 64, 68, 72, 75, 76, 76], '교정및군사시설': [4, 8, 11, 16, 19, 23, 26, 28, 30, 31, 31],
    '발전시설': [17, 34, 44, 54, 60, 66, 69, 75, 77, 79, 79], '방송통신시설': [3.5, 9, 13, 16, 20, 23, 27, 29, 30, 31, 31],
    '묘지관련시설': [0, 6, 11, 15, 19, 25, 30, 35, 41, 46, 51], '관광휴게시설': [1, 9, 11, 12, 14, 16, 18, 20, 22, 26, 29]
  };
  // 건물내용물 손상률(%) (표 3.9)
  var RES_C = [10.2, 20.9, 41.8, 63.5, 76.1, 89.4, 98.6, 99.2, 99.4, 99.4, 99.4];
  var CD = {
    '단독주택': RES_C, '아파트': RES_C, '다세대주택/연립주택': RES_C,
    '1종근린생활시설': [3, 16, 27, 36, 49, 57, 63, 69, 72, 76, 80], '2종근린생활시설': [2, 26, 42, 56, 68, 78, 83, 85, 87, 88, 89],
    '종교시설': [10, 52, 72, 85, 92, 95, 98, 99, 100, 100, 100], '문화및집회시설': [10, 52, 72, 85, 92, 95, 98, 99, 100, 100, 100],
    '판매시설': [2, 26, 42, 56, 68, 78, 83, 85, 87, 88, 89], '운수시설': [0, 60, 75, 90, 90, 90, 90, 90, 90, 90, 90],
    '의료시설': [25, 52, 69, 81, 95, 98, 98, 99, 99, 99, 99], '장례시설': [25.5, 44, 65, 85, 94, 98, 98, 99, 99, 99, 99],
    '교육연구시설': [6.5, 25.8, 42.8, 57, 71.5, 87.4, 97.5, 100, 100, 100, 100], '노유자시설': [30.5, 54, 68, 83, 91, 98, 98, 99, 99, 99, 99],
    '수련시설': [22, 47, 67, 77, 88, 94, 97, 98, 98, 98, 98], '운동시설': [13, 45, 55, 64, 73, 77, 80, 82, 83, 85, 87],
    '공공업무시설': [24, 47, 64, 78, 90, 97, 98, 99, 99, 99, 99], '일반업무시설': [0, 2, 6, 10, 15, 19, 24, 28, 33, 38, 44],
    '숙박시설': [0, 11, 19, 25, 29, 34, 39, 44, 49, 56, 65], '위락시설': [13, 45, 55, 64, 73, 77, 80, 82, 83, 85, 87],
    '일반공장': [0, 9, 23, 35, 44, 52, 58, 62, 65, 68, 70], '공해공장': [0, 15, 24, 34, 41, 47, 52, 57, 60, 63, 64],
    '창고시설': [0, 9, 23, 35, 44, 52, 58, 62, 65, 68, 70], '위험물저장처리시설': [2, 20, 41, 51, 62, 67, 71, 73, 76, 78, 79],
    '자동차관련시설': [0, 11, 17, 20, 23, 25, 29, 35, 42, 51, 63], '동물및식물관련시설': [6, 20, 43, 58, 65, 66, 66, 67, 70, 75, 76],
    '분뇨쓰레기처리시설': [17, 34, 44, 52, 59, 64, 68, 72, 75, 76, 76], '교정및군사시설': [22.5, 40, 58, 70, 84, 91, 95, 98, 98, 98, 98],
    '발전시설': [17, 34, 44, 54, 60, 66, 69, 75, 77, 79, 79], '방송통신시설': [28, 48, 62, 72, 81, 87, 90, 92, 93, 93, 93],
    '묘지관련시설': [6, 20, 43, 58, 65, 66, 66, 67, 70, 75, 76], '관광휴게시설': [13, 45, 55, 64, 73, 77, 80, 82, 83, 85, 87]
  };
  // 도로명주소 전자지도 건물용도코드 → 31개 용도 (표 3.3)
  var USE_CODE = [
    [1001, 1004, '단독주택'], [2001, 2001, '아파트'], [2002, 2007, '다세대주택/연립주택'], [3001, 3999, '1종근린생활시설'], [4001, 4999, '2종근린생활시설'],
    [5101, 5199, '종교시설'], [5201, 5999, '문화및집회시설'], [6303, 6308, '운수시설'], [6100, 6999, '판매시설'], [7201, 7201, '장례시설'], [7101, 7999, '의료시설'],
    [8001, 8199, '교육연구시설'], [8999, 8999, '교육연구시설'], [8201, 8500, '노유자시설'], [8601, 8799, '수련시설'], [9001, 9999, '운동시설'],
    [10101, 10199, '공공업무시설'], [10201, 10299, '일반업무시설'], [11101, 11299, '숙박시설'], [12001, 12999, '위락시설'], [13100, 13100, '일반공장'],
    [13200, 13200, '공해공장'], [13001, 13999, '일반공장'], [14001, 14999, '창고시설'], [15001, 15999, '위험물저장처리시설'], [16001, 16999, '자동차관련시설'],
    [17001, 17999, '동물및식물관련시설'], [18001, 18999, '분뇨쓰레기처리시설'], [19004, 19004, '발전시설'], [19005, 19008, '방송통신시설'],
    [19001, 19999, '교정및군사시설'], [20001, 20999, '묘지관련시설'], [21001, 21999, '관광휴게시설']
  ];
  // 차량: 재구매비(천원, 2020) (표 3.13), 손상함수 그룹(플러그인 기준), 차종 잔존률(표 3.14), 차종비(표 3.12)
  var VEH = {
    PAS1: [11746, 0, 9.64], PAS2: [17889, 0, 39.95], PAS3: [36699, 0, 19.03], PAS4: [10460, 0, 0.37], PAS5: [29869, 1, 0.02], PAS6: [24367, 1, 16.63],
    PAS7: [30768, 1, 8.18], PAS8: [25793, 0, 3.41], PAS9: [37616, 0, 2.78], VAN1: [29869, 1, 80.46], VAN2: [68708, 2, 3.44], VAN3: [126636, 2, 16.10],
    TRU1: [25495, 1, 9.21], TRU2: [17303, 1, 49.44], TRU3: [47861, 2, 8.33], TRU4: [167299, 2, 4.24], TRU5: [20844, 1, 0.91], TRU6: [50710, 2, 0.41],
    TRU7: [73824, 2, 0.21], TRU8: [18664, 1, 10.65], TRU9: [53491, 2, 0.12], TRU10: [77435, 2, 0.01], TRU11: [21872, 1, 16.48]
  };
  var SALV = { PAS: 38.30, VAN: 31.82, TRU: 32.05 };
  var VD = [[0, 23.2, 71.2, 93.7, 99.6, 100, 100, 100, 100, 100, 100], [0, 8, 49.4, 79.3, 95.8, 99.6, 100, 100, 100, 100, 100], [0, 0.9, 3.9, 19.2, 46.9, 69.1, 87.7, 97.3, 100, 100, 100]];
  // 인적피해 (표 3.17, 3.20, 3.4.2)
  var LIFE = { vul: [0.00027887, 0.00087191], gen: [0.00011419, 0.00039543], unit: 492826e3, death: 0.58, evacRate: 0.013411, evacDays: 10, gniDaily: 103071 };
  // 농작물: [홍수기 평균 투입생산비, 기대순수익](원/10a, 2020) (표 3.26), 손상률(%) [침수심 4구간 × 침수기간 4구간] (표 3.27)
  var CROP = {
    '논벼': [599812, 279924, [0, 0, 0, 0, 15, 40, 86.3, 92.5, 15, 40, 86.3, 92.5, 25, 62.5, 97.5, 100]],
    '시설딸기': [15039305, 1617278, [22, 30, 42, 56, 31, 38, 51, 100, 35.5, 44, 57, 100, 40, 50, 63, 100]],
    '인삼': [2837445, 2222602, [72.5, 100, 100, 100, 97.4, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]],
    '수박': [588864, 235824, [87.2, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]],
    '가을무': [527469, 207400, [36.7, 63.3, 73.3, 77, 49.3, 78.4, 100, 100, 66.5, 99.1, 100, 100, 83.7, 100, 100, 100]],
    '가을배추': [520566, 252044, [60, 80, 100, 100, 63.2, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]],
    '참깨': [1042219, 0, [29.7, 48.2, 67.2, 86.2, 31.3, 64.3, 70.1, 100, 50, 59.9, 86.9, 100, 68.8, 55.5, 100, 100]],
    '옥수수': [1455127, 0, [11, 30, 50, 50, 27, 40, 75, 88, 32.5, 51.5, 85, 94, 38, 63, 95, 100]],
    '콩': [396717, 117962, [35.5, 77.5, 77.5, 77.5, 46.3, 83.2, 86.1, 84.4, 54, 88.8, 91.9, 89.1, 61.7, 94.5, 97.6, 93.7]],
    '고구마': [2439160, 724834, [10, 15, 55, 80, 13.4, 18.6, 93.2, 100, 18.1, 23.5, 93.2, 100, 22.8, 28.4, 93.2, 100]]
  };
  var FIELD_CROPS = ['수박', '가을무', '가을배추', '참깨', '옥수수', '콩', '고구마'];
  var CROP_FIELD = { pad: '논벼', gre: '시설딸기', gin: '인삼', ses: '참깨', wam: '수박', rad: '가을무', rap: '가을무', cab: '가을배추', cor: '옥수수', soy: '콩', swp: '고구마' };
  var FARM_UNIT = (1658 + 5136) / 2;    // 원/㎡ (매몰·유실 평균, 2020)
  var PUBLIC = 0.865;                   // 공공시설 피해 비율계수 (표 3.30)
  var DURATIONS = ['1~2일', '3~4일', '5~6일', '7일 이상'];

  // ---------- 해석 도우미 ----------
  function key(s) { return String(s || '').replace(/[\s·ㆍ.,/()\-및]/g, ''); }
  var USE_BY_KEY = {}; Object.keys(BU).forEach(function (u) { USE_BY_KEY[key(u)] = u; });
  USE_BY_KEY[key('연립주택')] = USE_BY_KEY[key('다세대주택')] = '다세대주택/연립주택';
  USE_BY_KEY[key('제1종근린생활시설')] = '1종근린생활시설'; USE_BY_KEY[key('제2종근린생활시설')] = '2종근린생활시설';
  function useOf(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = +String(v).replace(/\D/g, '');
    if (/^\d{4,5}$/.test(String(v).trim()) && n) { for (var i = 0; i < USE_CODE.length; i++) if (n >= USE_CODE[i][0] && n <= USE_CODE[i][1]) return USE_CODE[i][2]; return null; }
    var k = key(v); if (USE_BY_KEY[k]) return USE_BY_KEY[k];
    var hit = Object.keys(USE_BY_KEY).find(function (u) { return k.indexOf(u) >= 0 || u.indexOf(k) >= 0; });
    return hit ? USE_BY_KEY[hit] : null;
  }
  function strOf(v) {
    var s = String(v || '').trim(), n = +s;
    if (/^\d{2}$/.test(s)) return n >= 10 && n < 20 ? '조적조' : n >= 50 && n < 60 ? '목조' : (n >= 30 && n < 40) || n === 99 ? '철골조' : '철근콘크리트조';
    if (/목/.test(s)) return '목조';
    if (/철근|콘크리트|RC|SRC/i.test(s)) return '철근콘크리트조';
    if (/철골|강/.test(s)) return '철골조';
    if (/조적|벽돌|블록|석/.test(s)) return '조적조';
    return null;
  }
  function ringArea(r) { var s = 0; for (var i = 0; i < r.length; i++) { var a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
  function polyArea(rings) { return rings.reduce(function (s, r, i) { return s + (i ? -1 : 1) * ringArea(r); }, 0); }
  function centroid(rings) {
    var r = rings[0], a = 0, cx = 0, cy = 0;
    for (var i = 0; i < r.length; i++) { var p = r[i], q = r[(i + 1) % r.length], c = p[0] * q[1] - q[0] * p[1]; a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
    if (!a) return r[0];
    return [cx / (3 * a), cy / (3 * a)];
  }
  // 다각형이 덮는 격자 칸(셀 중심 포함)
  function polyCells(rings, G) {
    var out = [], by0 = Infinity, by1 = -Infinity, c = G.cell;
    rings.forEach(function (r) { r.forEach(function (p) { if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; }); });
    var j0 = Math.max(0, Math.floor((by0 - G.y0) / c)), j1 = Math.min(G.ny - 1, Math.ceil((by1 - G.y0) / c));
    for (var j = j0; j <= j1; j++) {
      var yc = G.y0 + (j + 0.5) * c, xs = [];
      rings.forEach(function (r) {
        for (var k = 0; k < r.length; k++) { var a = r[k], b = r[(k + 1) % r.length]; if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
      });
      xs.sort(function (p, q) { return p - q; });
      for (var m = 0; m + 1 < xs.length; m += 2) {
        var i0 = Math.max(0, Math.ceil((xs[m] - G.x0) / c - 0.5)), i1 = Math.min(G.nx - 1, Math.floor((xs[m + 1] - G.x0) / c - 0.5));
        for (var i = i0; i <= i1; i++) out.push(j * G.nx + i);
      }
    }
    return out;
  }
  function bin03(d) { return d < 0.3 ? 0 : Math.min(10, Math.floor(d / 0.3 + 1e-9)); }
  function bin4(d) { return d < 0.3 ? 0 : d < 0.6 ? 1 : d < 0.9 ? 2 : 3; }
  function cls5(d) { return d < 0.5 ? 0 : d < 1 ? 1 : d < 2 ? 2 : d < 3 ? 3 : 4; }
  function num(p, names) {
    var ks = Object.keys(p || {});
    for (var i = 0; i < names.length; i++) { var k = ks.find(function (x) { return x.toUpperCase() === names[i]; }); if (k !== undefined && p[k] !== null && p[k] !== '') return p[k]; }
    return undefined;
  }

  // ---------- 인벤토리 읽기 (속성 → 표준 객체) ----------
  /* 건물: K-CDMS(BDTYP·BDSTR·BD_F_AREA·USE_YEAR) 또는 도로명주소 전자지도 건물(BDTYP_CD) */
  function buildings(feats, defStr) {
    var out = [], skip = 0;
    feats.forEach(function (f) {
      var p = f.props, use = useOf(num(p, ['BDTYP', 'BDTYP_CD', 'MAIN_PURPS_CD', 'S_BDTYP']));
      if (!use) { skip++; return; }
      var area = +num(p, ['BD_F_AREA', 'ARCH_AREA', 'BLD_AREA']) || (f.rings ? polyArea(f.rings) : 0);
      if (!(area > 0)) { skip++; return; }
      var yr = String(num(p, ['USE_YEAR', 'RA_USE_YEAR', 'USEAPR_DAY', 'USE_APR_DAY']) || '').slice(0, 4);
      out.push({ x: f.xy[0], y: f.xy[1], use: use, str: strOf(num(p, ['BDSTR', 'S_BDSTR', 'STRCT_CD', 'STRCT'])) || defStr || '조적조', area: area, year: +yr || 0 });
    });
    return { list: out, skip: skip };
  }
  function vehicles(feats) {
    return feats.map(function (f) {
      var p = f.props, n = [0, 0, 0], v = [0, 0, 0], per = false;
      Object.keys(VEH).forEach(function (t) {
        var c = +num(p, [t + '_N', t]); if (!(c > 0)) return; per = true;
        var g = VEH[t][1]; n[g] += c; v[g] += c * VEH[t][0] * 1000 * SALV[t.slice(0, 3)] / 100;
      });
      if (!per) [0, 1, 2].forEach(function (g) { var c = +num(p, ['T' + (g + 1) + '_N']) || 0; n[g] = c; v[g] = c * groupAvg[g]; });
      return { rings: f.rings, area: polyArea(f.rings), n: n, v: v };
    });
  }
  var groupAvg = [0, 1, 2].map(function (g) {
    var s = 0, w = 0; Object.keys(VEH).forEach(function (t) { if (VEH[t][1] !== g) return; s += VEH[t][2] * VEH[t][0] * 1000 * SALV[t.slice(0, 3)] / 100; w += VEH[t][2]; });
    return w ? s / w : 0;
  });
  function population(feats) {
    return feats.map(function (f) {
      var p = f.props, vul = +num(p, ['VUL_POP']) || 0, gen = +num(p, ['GEN_POP']);
      if (!(gen >= 0)) gen = Math.max(0, (+num(p, ['TOT_POP']) || 0) - vul);
      return { rings: f.rings, area: polyArea(f.rings), vul: vul, gen: gen };
    });
  }
  function farmland(feats) {
    return feats.map(function (f) {
      var p = f.props, crops = {}, tot = 0;
      Object.keys(p).forEach(function (k) {
        var m = /^(?:UPL_)?([A-Z]{3})(?:_AREA|_A)?$/i.exec(k); if (!m) return;
        var c = CROP_FIELD[m[1].toLowerCase()]; if (!c) return;
        var a = +p[k]; if (a > 0) { crops[c] = (crops[c] || 0) + a; tot += a; }
      });
      return { rings: f.rings, area: polyArea(f.rings), crops: crops, cropArea: tot };
    });
  }

  // ---------- 계산 ----------
  /* G: {x0,y0,nx,ny,cell, zid:Int32Array, zones:[{district,cover}], depth:{T:Float32Array}}
   * inv: {buildings, vehicles, population, farmland} (위 함수 결과; 없으면 생략)
   * o: {Ts, priceYear, cpi:{년:지수}, gniDaily:{년:값}, gniYear, duration(0~3), clsOf(cover)→'주거'|'논'|'밭'|'산업'|..., emdOf(district)→읍면동 통계}
   */
  function compute(G, inv, o) {
    var cpiF = o.cpi && o.cpi[o.priceYear] && o.cpi[2020] ? o.cpi[o.priceYear] / o.cpi[2020] : 1;
    var gniF = o.gniDaily && o.gniDaily[o.gniYear] && o.gniDaily[2020] ? o.gniDaily[o.gniYear] / o.gniDaily[2020] : cpiF;
    var A = {}, Ts = o.Ts, ca = G.cell * G.cell, du = Math.max(0, Math.min(3, o.duration || 0));
    var acc = function (d, T) {
      var k = d + '|' + T;
      return A[k] || (A[k] = { wet: [0, 0, 0, 0, 0], cover: {}, bStrRes: 0, bStrNon: 0, bConRes: 0, bConNon: 0, nBldg: 0, nBldgRes: 0, veh: 0, nVeh: 0, cas: 0, par: 0, evacN: 0, crop: 0, farm: 0, vulPar: 0 });
    };
    var at = function (x, y) { var i = Math.floor((x - G.x0) / G.cell), j = Math.floor((y - G.y0) / G.cell); return i < 0 || j < 0 || i >= G.nx || j >= G.ny ? -1 : j * G.nx + i; };
    var note = { bldgIn: 0, bldgOut: 0, valueRes: 0, valueNon: 0 };
    // 침수면적(지구·피복·침수심)
    for (var c = 0; c < G.zid.length; c++) {
      var z = G.zid[c]; if (z < 0) continue;
      var zz = G.zones[z];
      Ts.forEach(function (T) { var d = G.depth[T][c]; if (!(d > 0)) return; var a = acc(zz.district, T); a.wet[cls5(d)] += ca; var cl = o.clsOf(zz.cover); a.cover[cl] = (a.cover[cl] || 0) + ca; });
    }
    // 1) 건물
    (inv.buildings || []).forEach(function (b) {
      var idx = at(b.x, b.y); if (idx < 0 || G.zid[idx] < 0) { note.bldgOut++; return; }
      note.bldgIn++;
      var dist = G.zones[G.zid[idx]].district, bu = BU[b.use], det = b.use === '단독주택';
      var cost = det ? DETACHED[b.str][0] : bu[0], life = det ? DETACHED[b.str][1] : bu[1];
      var yrs = b.year ? o.priceYear - b.year : 0; if (yrs <= 0) yrs = Math.round(life / 2); if (yrs > life) yrs = life;
      var dep = Math.min(80, 100 / life * yrs) / 100;
      var sv = b.area * cost * 1000 * (1 - dep) * cpiF, cv = sv * bu[2] / 100, res = RESID.indexOf(b.use) >= 0;
      if (res) note.valueRes += sv + cv; else note.valueNon += sv + cv;
      var sd = det ? SD[b.str] : SD[b.use], cd = CD[b.use];
      Ts.forEach(function (T) {
        var d = G.depth[T][idx], inner = d - bu[3]; if (!(d > 0) || !(inner > 0)) return;
        var k = bin03(inner), a = acc(dist, T), ds = sv * sd[k] / 100, dc = cv * cd[k] / 100;
        if (res) { a.bStrRes += ds; a.bConRes += dc; a.nBldgRes++; } else { a.bStrNon += ds; a.bConNon += dc; }
        a.nBldg++;
      });
    });
    // 면 인벤토리 공통: 다각형 칸마다 (칸면적/다각형면적) 비율로 배분
    function spread(list, fn) {
      (list || []).forEach(function (q) {
        if (!(q.area > 0)) return;
        var cells = polyCells(q.rings, G), fr = ca / q.area;
        cells.forEach(function (idx) {
          var z = G.zid[idx]; if (z < 0) return;
          var dist = G.zones[z].district;
          Ts.forEach(function (T) { var d = G.depth[T][idx]; if (d > 0) fn(q, fr, d, acc(dist, T), G.zones[z]); });
        });
      });
    }
    // 2) 차량
    spread(inv.vehicles, function (q, fr, d, a) {
      var k = bin03(d);
      for (var g = 0; g < 3; g++) { a.veh += q.v[g] * cpiF * fr * VD[g][k] / 100; a.nVeh += q.n[g] * fr; }
    });
    // 3) 인적피해: 집계구 인구 인벤토리 → 없으면 읍면동 인구를 주거지역(대지)에 배분
    var popFn = function (vul, gen, d, a) {
      var h = d < 1 ? 0 : 1;
      a.cas += vul * LIFE.vul[h] + gen * LIFE.gen[h]; a.par += vul + gen; a.vulPar += vul; a.evacN += (vul + gen) * LIFE.evacRate;
    };
    if (inv.population && inv.population.length) spread(inv.population, function (q, fr, d, a) { popFn(q.vul * fr, q.gen * fr, d, a); });
    else if (o.emdOf) {
      for (var c2 = 0; c2 < G.zid.length; c2++) {
        var z2 = G.zid[c2]; if (z2 < 0) continue;
        var zn = G.zones[z2]; if (o.clsOf(zn.cover) !== '주거') continue;
        var e = o.emdOf(zn.district); if (!e || !e.population || !(e.land && e.land.대지)) continue;
        var per = e.population * ca / e.land.대지, vr = e.vulnerable && e.population ? e.vulnerable / e.population : 0;
        Ts.forEach(function (T) { var d = G.depth[T][c2]; if (d > 0) popFn(per * vr, per * (1 - vr), d, acc(zn.district, T)); });
      }
    }
    // 4) 농업: 농경지 인벤토리(필지별 작물면적) → 없으면 토지피복 논=논벼, 밭=밭작물 7종 평균
    var cropLoss = function (name, area10a, d) { var c = CROP[name]; return area10a * (c[0] + c[1]) * cpiF * c[2][bin4(d) * 4 + du] / 100; };
    if (inv.farmland && inv.farmland.length) spread(inv.farmland, function (q, fr, d, a) {
      Object.keys(q.crops).forEach(function (n) { a.crop += cropLoss(n, q.crops[n] * fr / 1000, d); });
      if (d >= 1) a.farm += ca * Math.min(1, q.cropArea / q.area || 1) * FARM_UNIT * cpiF;
    });
    else for (var c3 = 0; c3 < G.zid.length; c3++) {
      var z3 = G.zid[c3]; if (z3 < 0) continue;
      var zc = G.zones[z3], cl = o.clsOf(zc.cover); if (cl !== '논' && cl !== '밭') continue;
      Ts.forEach(function (T) {
        var d = G.depth[T][c3]; if (!(d > 0)) return;
        var a = acc(zc.district, T);
        a.crop += cl === '논' ? cropLoss('논벼', ca / 1000, d) : FIELD_CROPS.reduce(function (s, n) { return s + cropLoss(n, ca / 1000, d); }, 0) / FIELD_CROPS.length;
        if (d >= 1) a.farm += ca * FARM_UNIT * cpiF;
      });
    }
    // 5) 지구·빈도별 정리 (백만원)
    var out = {};
    Object.keys(A).forEach(function (k) {
      var a = A[k], M = 1e6;
      var life = a.cas * LIFE.unit * cpiF / M, evac = a.evacN * LIFE.evacDays * LIFE.gniDaily * gniF / M;
      var bld = (a.bStrRes + a.bStrNon) / M, con = (a.bConRes + a.bConNon) / M, veh = a.veh / M, crop = a.crop / M, farm = a.farm / M;
      var resid = (a.bStrRes + a.bConRes) / M, nonres = (a.bStrNon + a.bConNon) / M, agri = crop + farm;
      var priv = resid + nonres + veh + agri, pub = (priv + life + evac) * PUBLIC;
      var ha = function (x) { return (x || 0) / 1e4; };
      out[k] = {
        areaHa: ha(a.wet.reduce(function (s, v) { return s + v; }, 0)), haByDepth: a.wet.map(ha),
        areaRes: ha(a.cover.주거), areaAgr: ha((a.cover.논 || 0) + (a.cover.밭 || 0)), areaInd: ha(a.cover.산업),
        building: bld, contents: con, vehicle: veh, crop: crop, farmland: farm, tangible: 0, stock: 0,
        residential: resid, nonresidential: nonres, industry: nonres + veh, agriculture: agri, general: priv,
        lifeOnly: life, evac: evac, life: life + evac, public: pub, total: priv + life + evac + pub,
        casualties: a.cas, deaths: a.cas * LIFE.death, injuries: a.cas * (1 - LIFE.death), evacuees: a.evacN, par: a.par,
        nBldg: a.nBldg, nBldgRes: a.nBldgRes, nVeh: a.nVeh
      };
    });
    return { byKey: out, note: note, cpiF: cpiF };
  }
  function zero() {
    return { areaHa: 0, haByDepth: [0, 0, 0, 0, 0], areaRes: 0, areaAgr: 0, areaInd: 0, building: 0, contents: 0, vehicle: 0, crop: 0, farmland: 0, tangible: 0, stock: 0,
      residential: 0, nonresidential: 0, industry: 0, agriculture: 0, general: 0, lifeOnly: 0, evac: 0, life: 0, public: 0, total: 0,
      casualties: 0, deaths: 0, injuries: 0, evacuees: 0, par: 0, nBldg: 0, nBldgRes: 0, nVeh: 0 };
  }
  return { compute: compute, zero: zero, buildings: buildings, vehicles: vehicles, population: population, farmland: farmland, centroid: centroid, polyArea: polyArea,
    useOf: useOf, strOf: strOf, DURATIONS: DURATIONS, PUBLIC: PUBLIC, LIFE: LIFE, BU: BU, CROP: CROP, FARM_UNIT: FARM_UNIT };
})();
if (typeof module !== 'undefined') module.exports = KFRM;
