# -*- coding: utf-8 -*-
"""치수경제성 에이전트 — 홍수범람도(QGIS)

이 폴더(침수심_*.tif, 지구_*.tif, *.geojson, meta.json)를 그대로 두고 QGIS에서 실행합니다.
  QGIS > 플러그인 > 파이썬 콘솔 > [편집기 표시] > [스크립트 열기]로 이 파일 열기 > [스크립트 실행]
결과
  - 홍수범람도.qgz          : 스타일 입힌 레이어 + 빈도별 인쇄 조판(Layout) — 그대로 열어 고쳐 쓰기
  - 출력/홍수범람도_{T}년.png·pdf : A4 세로 300dpi
"""
import os, json, math

from qgis.core import (QgsProject, QgsRasterLayer, QgsVectorLayer, QgsCoordinateReferenceSystem, QgsColorRampShader,
                       QgsRasterShader, QgsSingleBandPseudoColorRenderer, QgsFillSymbol, QgsLineSymbol, QgsMarkerSymbol,
                       QgsPalLayerSettings, QgsTextFormat, QgsTextBufferSettings, QgsVectorLayerSimpleLabeling,
                       QgsPrintLayout, QgsLayoutItemMap, QgsLayoutItemLabel, QgsLayoutItemLegend, QgsLayoutItemScaleBar,
                       QgsLayoutItemPicture, QgsLayoutItemHtml, QgsLayoutFrame, QgsLayoutPoint, QgsLayoutSize, QgsUnitTypes,
                       QgsLayoutExporter, QgsRectangle, QgsCoordinateTransform, QgsApplication, QgsField, QgsLayerTreeLayer,
                       QgsLegendStyle, QgsLayoutMeasurement, QgsVectorFileWriter, QgsProperty, QgsSymbolLayer, QgsFillSymbolLayer)
from qgis.PyQt.QtGui import QColor, QFont
from qgis.PyQt.QtCore import QRectF, QVariant, QSizeF

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:   # 콘솔에 붙여넣어 실행한 경우
    from qgis.PyQt.QtWidgets import QFileDialog
    HERE = QFileDialog.getExistingDirectory(None, '홍수범람도 폴더(meta.json 있는 곳)를 고르세요')

import processing
try:
    from processing.core.Processing import Processing
    Processing.initialize()
except Exception:
    pass

META = json.load(open(os.path.join(HERE, 'meta.json'), encoding='utf-8'))
OUT = os.path.join(HERE, '출력'); os.makedirs(OUT, exist_ok=True)
CRS = QgsCoordinateReferenceSystem(META['crs'])
FONT = '맑은 고딕'
CLASSES = [(0.5, '#cfe8ff', '0.0 ~ 0.5 m'), (1.0, '#8fc6ff', '0.5 ~ 1.0 m'), (2.0, '#4d97f0', '1.0 ~ 2.0 m'), (5.0, '#1c5bc8', '2.0 ~ 5.0 m'), (9999, '#0a2a7a', '5.0 m 이상')]

P = QgsProject.instance(); P.clear(); P.setCrs(CRS); P.setTitle(META.get('river', '') + ' 홍수범람도')
root = P.layerTreeRoot()

def fmt(size=9, bold=False, color='#1b2430', buf=True):
    f = QgsTextFormat(); fn = QFont(FONT); fn.setBold(bold); f.setFont(fn); f.setSize(size); f.setColor(QColor(color))
    if buf:
        b = QgsTextBufferSettings(); b.setEnabled(True); b.setSize(1.0); b.setColor(QColor('white')); f.setBuffer(b)
    return f

# ---- 배경: 위성(브이월드 키가 있으면 브이월드, 없으면 Esri) ----
if META.get('vkey'):
    base = QgsRasterLayer('type=xyz&url=https://api.vworld.kr/req/wmts/1.0.0/%s/Satellite/{z}/{y}/{x}.jpeg&zmax=19&zmin=6' % META['vkey'], '위성영상(브이월드)', 'wms')
else:
    base = None
if not base or not base.isValid():
    base = QgsRasterLayer('type=xyz&url=https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}&zmax=19&zmin=0', '위성영상(Esri)', 'wms')
base.renderer().setOpacity(1.0)
P.addMapLayer(base, False)

def placement(name):   # QGIS 3/4 공통
    try:
        from qgis.core import Qgis
        return getattr(Qgis.LabelPlacement, name)
    except Exception:
        return getattr(QgsPalLayerSettings, name)

def sl(cls, props):   # 임시 심볼이 먼저 지워지지 않게 붙잡아 둔 채 심볼층 복제
    t = cls.createSimple(props); c = t.symbolLayer(0).clone(); return c

# ---- 벡터: 하천·측점·유역계 ----
def vec(name, title):
    p = os.path.join(HERE, name)
    if not os.path.exists(p): return None
    l = QgsVectorLayer(p, title, 'ogr')
    return l if l.isValid() and l.featureCount() else None

river = vec('하천.geojson', '과업하천')
if river:
    s = QgsLineSymbol.createSimple({'color': '255,255,255,230', 'width': '1.6', 'capstyle': 'round', 'joinstyle': 'round'})
    s2 = sl(QgsLineSymbol, {'color': '#1e5eff', 'width': '1.0', 'capstyle': 'round', 'joinstyle': 'round'})
    s.appendSymbolLayer(s2); river.renderer().setSymbol(s)
basin = vec('유역계.geojson', '유역경계')
if basin:
    bs = QgsFillSymbol.createSimple({'color': '0,0,0,0', 'outline_color': '255,255,255,170', 'outline_width': '1.1'})
    l2 = sl(QgsFillSymbol, {'color': '0,0,0,0', 'outline_color': '#111111', 'outline_width': '0.55', 'outline_style': 'dash dot'})
    bs.appendSymbolLayer(l2); basin.renderer().setSymbol(bs)
stations = vec('측점.geojson', '측점')
if stations:
    stations.renderer().setSymbol(QgsMarkerSymbol.createSimple({'name': 'circle', 'color': 'white', 'outline_color': '#1e5eff', 'outline_width': '0.4', 'size': '1.6'}))
    pl = QgsPalLayerSettings(); pl.fieldName = "'NO.' || \"key\""; pl.isExpression = True; pl.setFormat(fmt(7, True, '#ffffff', False))
    tf = pl.format(); b = QgsTextBufferSettings(); b.setEnabled(True); b.setSize(0.9); b.setColor(QColor(0, 0, 0, 200)); tf.setBuffer(b); pl.setFormat(tf)
    pl.placement = placement('OverPoint')
    pl.xOffset = 2.0; pl.yOffset = -2.0
    pl.dataDefinedProperties().setProperty(QgsPalLayerSettings.Show, QgsProperty.fromExpression('"show" = 1'))
    stations.setLabeling(QgsVectorLayerSimpleLabeling(pl)); stations.setLabelsEnabled(True)

# ---- 빈도별 침수심(래스터) + 지구 범위(지구 래스터 → 다각형 → 매끈하게) ----
def depth_layer(T):
    r = QgsRasterLayer(os.path.join(HERE, '침수심_%d년.tif' % T), '침수심(%d년 빈도)' % T)
    sh = QgsColorRampShader(); sh.setColorRampType(QgsColorRampShader.Discrete)
    sh.setColorRampItemList([QgsColorRampShader.ColorRampItem(v, QColor(c), lab) for v, c, lab in CLASSES])
    rs = QgsRasterShader(); rs.setRasterShaderFunction(sh)
    rd = QgsSingleBandPseudoColorRenderer(r.dataProvider(), 1, rs); rd.setOpacity(0.82); r.setRenderer(rd)
    try: r.resampleFilter().setZoomedInResampler(None)
    except Exception: pass
    return r

NAMES = {str(d['id']): d['name'] for d in META['districts']}
def zone_layer(T):
    src = os.path.join(HERE, '지구_%d년.tif' % T)
    poly = processing.run('gdal:polygonize', {'INPUT': src, 'BAND': 1, 'FIELD': 'DN', 'EIGHT_CONNECTEDNESS': False, 'OUTPUT': 'TEMPORARY_OUTPUT'})['OUTPUT']
    poly = processing.run('native:extractbyexpression', {'INPUT': poly, 'EXPRESSION': '"DN" > 0', 'OUTPUT': 'TEMPORARY_OUTPUT'})['OUTPUT']   # 0 = 지구 밖
    dis = processing.run('native:dissolve', {'INPUT': poly, 'FIELD': ['DN'], 'OUTPUT': 'TEMPORARY_OUTPUT'})['OUTPUT']
    # 작은 구멍·조각 정리 후 모서리 다듬기
    dis = processing.run('native:deleteholes', {'INPUT': dis, 'MIN_AREA': 400, 'OUTPUT': 'TEMPORARY_OUTPUT'})['OUTPUT']
    sm = processing.run('native:smoothgeometry', {'INPUT': dis, 'ITERATIONS': 3, 'OFFSET': 0.25, 'MAX_ANGLE': 180, 'OUTPUT': 'TEMPORARY_OUTPUT'})['OUTPUT']
    gp = os.path.join(OUT, '지구범위_%d년.gpkg' % T)
    out = processing.run('native:fieldcalculator', {'INPUT': sm, 'FIELD_NAME': 'name', 'FIELD_TYPE': 2, 'FIELD_LENGTH': 60,
                         'FORMULA': 'map_get(map(%s), to_string("DN"))' % ', '.join("'%s','%s'" % (k, v.replace("'", "''")) for k, v in NAMES.items()),
                         'OUTPUT': gp})['OUTPUT']
    l = QgsVectorLayer(out, '분석지구(%d년 침수범위)' % T, 'ogr')
    l.setCrs(CRS)
    sym = QgsFillSymbol.createSimple({'color': '0,0,0,0', 'outline_color': '255,255,255,200', 'outline_width': '0.9', 'joinstyle': 'round'})
    sym.appendSymbolLayer(sl(QgsFillSymbol, {'color': '0,0,0,0', 'outline_color': '#ff2d55', 'outline_width': '0.5', 'joinstyle': 'round'}))
    l.renderer().setSymbol(sym)
    pl = QgsPalLayerSettings(); pl.fieldName = 'name'; pl.setFormat(fmt(9, True, '#c4004a'))
    tf = pl.format(); bg = tf.background(); bg.setEnabled(True); bg.setFillColor(QColor('white')); bg.setStrokeColor(QColor('#e0115f')); bg.setStrokeWidth(0.35)
    from qgis.core import QgsTextBackgroundSettings
    bg.setSizeType(QgsTextBackgroundSettings.SizeBuffer); bg.setSize(QSizeF(1.4, 0.9))
    tf.setBackground(bg); tf.buffer().setEnabled(False); pl.setFormat(tf)
    pl.placement = placement('AroundPoint')
    pl.dist = 3.0
    l.setLabeling(QgsVectorLayerSimpleLabeling(pl)); l.setLabelsEnabled(True)
    return l

Ts = META['Ts']; design = META.get('designT', Ts[-1])
groups = {}
for T in Ts:
    g = root.insertGroup(0, '%d년 빈도' % T); groups[T] = g
    z = zone_layer(T); d = depth_layer(T)
    P.addMapLayer(z, False); P.addMapLayer(d, False)
    g.addLayer(z); g.addLayer(d)
    g.setItemVisibilityChecked(T == design)
for l in [stations, river, basin]:
    if l: P.addMapLayer(l, False); root.addLayer(l)
P.addMapLayer(base, False); root.addLayer(base)

# ---- 조판(A4 세로) ----
ext = None
for l in [river] + [P.mapLayersByName('분석지구(%d년 침수범위)' % T)[0] for T in Ts]:
    if not l: continue
    e = l.extent()
    if l.crs() != CRS: e = QgsCoordinateTransform(l.crs(), CRS, P).transformBoundingBox(e)
    ext = QgsRectangle(e) if ext is None else (ext.combineExtentWith(e) or ext)
W, H = 186.0, 196.0
cx, cy = ext.center().x(), ext.center().y(); w = max(ext.width(), 600) * 1.25; h = max(ext.height(), 600) * 1.25
if w / h > W / H: h = w * H / W
else: w = h * W / H
MAPEXT = QgsRectangle(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

def label(lay, text, x, y, w, h, size, bold=False, color='#1b2430', align=None):
    it = QgsLayoutItemLabel(lay); it.setText(text)
    f = QgsTextFormat(); fn = QFont(FONT); fn.setBold(bold); f.setFont(fn); f.setSize(size); f.setColor(QColor(color)); it.setTextFormat(f)
    it.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters)); it.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    lay.addLayoutItem(it); return it

def area_table(lay, T, x, y, w, h):
    # QGIS 기본 표(수동 표): 지구 × 침수심 구간 면적(ha)
    from qgis.core import QgsLayoutItemManualTable, QgsTableCell, QgsLayoutTableColumn
    rows = META['areas'].get(str(T), {})
    def cell(v, head=False, bold=False, color='#1b2430', bg=None):
        c = QgsTableCell(v); f = QgsTextFormat(); fn = QFont(FONT); fn.setBold(head or bold); f.setFont(fn); f.setSize(8.5)
        f.setColor(QColor('white' if head else color)); c.setTextFormat(f)
        if head: c.setBackgroundColor(QColor('#1f3a5f'))
        elif bg: c.setBackgroundColor(QColor(bg))
        try: c.setHorizontalAlignment(0x84)   # 가운데
        except Exception: pass
        return c
    data = [[cell('지구명', True)] + [cell(c[2], True) for c in CLASSES] + [cell('계 (ha)', True)]]
    for i, d in enumerate(META['districts']):
        a = rows.get(d['name'], [0, 0, 0, 0, 0]); bg = '#f3f5f8' if i % 2 else None
        data.append([cell(d['name'], bold=True, bg=bg)] + [cell('%.2f' % v if v > 0.004 else '-', bg=bg) for v in a] + [cell('%.2f' % sum(a), bold=True, color='#0a2a7a', bg=bg)])
    tot = [sum(rows.get(d['name'], [0] * 5)[k] for d in META['districts']) for k in range(5)]
    data.append([cell('계', bold=True, bg='#e4e8ee')] + [cell('%.2f' % v, bold=True, bg='#e4e8ee') for v in tot] + [cell('%.2f' % sum(tot), bold=True, color='#0a2a7a', bg='#e4e8ee')])
    t = QgsLayoutItemManualTable.create(lay); t.setTableContents(data)
    t.setIncludeTableHeader(False) if hasattr(t, 'setIncludeTableHeader') else None
    widths = [30] + [21] * 5 + [24]   # 159 mm + 셀 여백 7×2.8 ≈ 179 mm (쪽 안)
    try: t.setColumnWidths(widths)
    except Exception:
        cols = []
        for wd in widths:
            c = QgsLayoutTableColumn(); c.setWidth(wd); cols.append(c)
        t.setColumns(cols); t.setTableContents(data)
    t.setGridStrokeWidth(0.15); t.setGridColor(QColor('#c9d0d8')); t.setCellMargin(1.4)
    fr = QgsLayoutFrame(lay, t); fr.attemptSetSceneRect(QRectF(x, y, w, h)); t.addFrame(fr)
    lay.addMultiFrame(t)
    return t

def area_html(T):
    rows = META['areas'].get(str(T), {})
    th = ''.join('<th>%s</th>' % c[2] for c in CLASSES)
    tr = ''
    for d in META['districts']:
        a = rows.get(d['name'], [0, 0, 0, 0, 0])
        tr += '<tr><td class="n">%s</td>%s<td class="t">%.2f</td></tr>' % (d['name'], ''.join('<td>%s</td>' % ('%.2f' % v if v > 0.004 else '-') for v in a), sum(a))
    tot = [sum(rows.get(d['name'], [0] * 5)[i] for d in META['districts']) for i in range(5)]
    tr += '<tr class="s"><td class="n">계</td>%s<td class="t">%.2f</td></tr>' % (''.join('<td>%.2f</td>' % v for v in tot), sum(tot))
    css = ('body{margin:0;font-family:"%s";font-size:9pt;color:#1b2430}table{width:100%%;border-collapse:collapse}'
           'th{background:#1f3a5f;color:#fff;font-weight:bold;padding:3px}td{text-align:center;padding:2px;border-bottom:1px solid #dde2e8}'
           'td.n{font-weight:bold}td.t{font-weight:bold;color:#0a2a7a}tr.s td{border-top:2px solid #1f3a5f;font-weight:bold}') % FONT
    return '<html><head><style>%s</style></head><body><table><tr><th>지구명</th>%s<th>계 (ha)</th></tr>%s</table></body></html>' % (css, th, tr)

mgr = P.layoutManager()
for T in Ts:
    lay = QgsPrintLayout(P); lay.initializeDefaults(); lay.setName('홍수범람도 %d년' % T)
    pg = lay.pageCollection().page(0); pg.setPageSize('A4', pg.Portrait)
    label(lay, '%s 홍수범람도' % META.get('river', ''), 12, 9, 150, 12, 22, True)
    label(lay, '%s  ·  %d년 빈도 (개수 전 홍수위, 하도버퍼링)' % (META.get('adm', ''), T), 12, 21, 186, 7, 10.5, False, '#5b6573')
    m = QgsLayoutItemMap(lay); m.attemptMove(QgsLayoutPoint(12, 30, QgsUnitTypes.LayoutMillimeters)); m.attemptResize(QgsLayoutSize(W, H, QgsUnitTypes.LayoutMillimeters))
    lays = [l for l in [stations, river, basin] if l] + [P.mapLayersByName('분석지구(%d년 침수범위)' % T)[0], P.mapLayersByName('침수심(%d년 빈도)' % T)[0], base]
    m.setLayers(lays); m.setKeepLayerSet(True); m.setCrs(CRS); m.setExtent(MAPEXT); m.setFrameEnabled(True)
    m.setFrameStrokeWidth(QgsLayoutMeasurement(0.4, QgsUnitTypes.LayoutMillimeters))
    lay.addLayoutItem(m)
    # 범례
    lg = QgsLayoutItemLegend(lay); lg.setLinkedMap(m); lg.setAutoUpdateModel(False) if hasattr(lg, 'setAutoUpdateModel') else None; lg.setTitle('범  례')
    model = lg.model().rootGroup(); model.removeAllChildren()
    for l in [P.mapLayersByName('침수심(%d년 빈도)' % T)[0], P.mapLayersByName('분석지구(%d년 침수범위)' % T)[0], river, basin]:
        if not l: continue
        node = model.addLayer(l)
        if isinstance(l, QgsRasterLayer):
            try:   # 래스터 범례 첫 줄('Band 1 (Gray)') 숨기기
                from qgis.core import QgsMapLayerLegendUtils
                n = len(lg.model().layerLegendNodes(node)); QgsMapLayerLegendUtils.setLegendNodeOrder(node, list(range(1, n))); lg.model().refreshLayerLegend(node)
            except Exception: pass
    for st in (QgsLegendStyle.Title, QgsLegendStyle.Group, QgsLegendStyle.Subgroup, QgsLegendStyle.SymbolLabel):
        sty = lg.rstyle(st); tfm = QgsTextFormat(sty.textFormat()); fn = QFont(FONT); fn.setBold(st == QgsLegendStyle.Title)
        tfm.setFont(fn); tfm.setSize(10 if st == QgsLegendStyle.Title else 8); sty.setTextFormat(tfm)
    lg.setBackgroundEnabled(True); lg.setBackgroundColor(QColor(255, 255, 255, 235)); lg.setFrameEnabled(True)
    lay.addLayoutItem(lg); lg.attemptMove(QgsLayoutPoint(146, 30 + H - 72, QgsUnitTypes.LayoutMillimeters)); lg.adjustBoxSize()
    # 축척
    sb = QgsLayoutItemScaleBar(lay); sb.setStyle('Single Box'); sb.setLinkedMap(m); sb.applyDefaultSize(); sb.setUnits(QgsUnitTypes.DistanceMeters)
    sb.setNumberOfSegments(2); sb.setNumberOfSegmentsLeft(0); sb.setUnitLabel('m'); sb.setBackgroundEnabled(True); sb.setBackgroundColor(QColor(255, 255, 255, 230))
    stf = sb.textFormat(); stf.setFont(QFont(FONT)); stf.setSize(8); sb.setTextFormat(stf)
    lay.addLayoutItem(sb); sb.attemptMove(QgsLayoutPoint(16, 30 + H - 14, QgsUnitTypes.LayoutMillimeters))
    # 방위표
    na = QgsLayoutItemPicture(lay); svg = ''
    for sp in QgsApplication.svgPaths():
        c = os.path.join(sp, 'arrows', 'NorthArrow_11.svg')
        if os.path.exists(c): svg = c; break
    na.setPicturePath(svg)
    if hasattr(na, 'setLinkedMap'): na.setLinkedMap(m)
    lay.addLayoutItem(na); na.attemptMove(QgsLayoutPoint(12 + W - 20, 34, QgsUnitTypes.LayoutMillimeters)); na.attemptResize(QgsLayoutSize(16, 16, QgsUnitTypes.LayoutMillimeters))
    # 침수면적 표
    label(lay, '지구별 침수심 구간 면적 (ha) — %d년 빈도' % T, 12, 30 + H + 4, 186, 6, 10, True)
    area_table(lay, T, 12, 30 + H + 11, 186, 287 - (30 + H + 11))
    label(lay, '배경: ' + base.name() + '   ·   침수심: 개수 전 홍수위 − 지반고(수치지도), 격자 %s m' % META.get('cell', 1), 12, 289, 186, 5, 7, False, '#7a8491')
    mgr.addLayout(lay)
    ex = QgsLayoutExporter(lay)
    ps = QgsLayoutExporter.ImageExportSettings(); ps.dpi = 300
    ex.exportToImage(os.path.join(OUT, '홍수범람도_%d년.png' % T), ps)
    ex.exportToPdf(os.path.join(OUT, '홍수범람도_%d년.pdf' % T), QgsLayoutExporter.PdfExportSettings())
P.write(os.path.join(HERE, '홍수범람도.qgz'))
print('홍수범람도 완료 →', OUT)
