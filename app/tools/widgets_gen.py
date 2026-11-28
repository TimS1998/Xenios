# Erzeugt die Widget-Layouts (Bild + deckungsgleiche Klickflächen) und WidgetSpecs.kt aus EINER Beschreibung.
# Aufruf aus dem Repo:  python3 app/tools/widgets_gen.py
# (optional: python3 app/tools/widgets_gen.py <res/layout-Ordner> <Pfad zu WidgetSpecs.kt>)
# Der Renderer (WidgetDraw.kt) zeichnet nach WidgetSpecs, die Layouts legen die Klickflächen genau darüber.
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.join(HERE, '..', 'app', 'src', 'main')
RES = sys.argv[1] if len(sys.argv) > 2 else os.path.join(MAIN, 'res', 'layout')
KT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(MAIN, 'java', 'app', 'xeniabridge', 'WidgetSpecs.kt')
PAD = 12  # dp, Innenabstand (Renderer und Layout gleich)
SEG = [('btn_on', 1), ('btn_eco', 1), ('btn_off', 1)]
TGT = lambda n: [(None, 40), (f't{n}_minus', 22), (None, 34), (f't{n}_plus', 22)]
# Zeile: (Name, Gewicht, Spalten oder None, Spaltenabstand dp). Die Kopfzeile und der Abstand darunter haben eine feste
# Höhe in dp (Gewicht = dp): Der Titel steht bei jeder Widgetgröße gleich weit vom oberen Rand. Die übrigen Zeilen
# teilen sich den Rest nach Gewicht.
FIXED_ROWS = 2  # die ersten beiden Zeilen jeder Beschreibung
SPECS = {
  'power':      [('head', 16, None, 0), (None, 4, None, 0), ('body', 40, None, 0)],
  # 4×1: Kopfzeile mit Symbol, Titel und Zustand rechts, darunter Ein/Eco/Aus über die ganze Breite
  'mode':       [('head', 16, None, 0), (None, 6, None, 0), ('seg', 36, SEG, 6)],
  'switch':     [('head', 16, None, 0), (None, 6, None, 0), ('seg', 36, SEG, 6), (None, 8, None, 0), ('tg_steam', 26, None, 0), ('tg_nosteam', 26, None, 0)],
  'large':      [('head', 16, None, 0), (None, 4, None, 0), ('status', 46, None, 0), (None, 4, None, 0), ('badges', 18, None, 0), (None, 8, None, 0),
                 ('seg', 36, SEG, 6), (None, 8, None, 0), ('tg_steam', 26, None, 0), ('tg_nosteam', 26, None, 0)],
  'large_live': [('head', 16, None, 0), (None, 4, None, 0), ('info', 60, None, 0), (None, 6, None, 0), ('chart', 60, None, 0), (None, 8, None, 0), ('stop', 36, None, 0)],
  'gauges':     [('head', 16, None, 0), (None, 4, None, 0), ('body', 100, None, 0)],
  'targets':    [('head', 16, None, 0), (None, 6, None, 0), ('t1', 30, TGT(1), 0), ('t2', 30, TGT(2), 0), ('t3', 30, TGT(3), 0)],
  'care':       [('head', 16, None, 0), (None, 4, None, 0), ('body', 40, None, 0)],
  'history':    [('head', 16, None, 0), (None, 4, None, 0), ('body', 100, None, 0)],
  'lastshot':   [('head', 16, None, 0), (None, 2, None, 0), ('kpi', 34, None, 0), (None, 4, None, 0), ('body', 80, None, 0)],
  'shots':      [('head', 16, None, 0), (None, 4, None, 0), ('body', 100, None, 0)],
  'shotslarge': [('head', 16, None, 0), (None, 4, None, 0), ('top', 90, None, 0), (None, 8, None, 0), ('bottom', 90, None, 0)],
}
# Klickbare Flächen (bekommen eine ID im Layout)
CLICK = {'btn_on', 'btn_eco', 'btn_off', 'tg_steam', 'tg_nosteam', 'stop', 'head',
         't1_minus', 't1_plus', 't2_minus', 't2_plus', 't3_minus', 't3_plus'}
LAYOUTS = {  # Layout-Datei → Overlays (Spezifikationen)
  'widget_power': [], 'widget_powerns': [], 'widget_mode': ['mode'], 'widget_switch': ['switch'], 'widget_large': ['large', 'large_live'], 'widget_gauges': [],
  'widget_targets': ['targets'], 'widget_care': [], 'widget_history': [], 'widget_lastshot': [], 'widget_shots': [], 'widget_shotslarge': [],
}

def zone(name, w, horiz, margin_start=0, idprefix='', fixed=False):
    idattr = f'\n        android:id="@+id/{idprefix}{name}"' if name in CLICK else ''
    if fixed:
        return f'    <FrameLayout{idattr}\n        android:layout_width="match_parent"\n        android:layout_height="{w}dp" />'
    size = 'android:layout_width="0dp"\n        android:layout_height="match_parent"' if horiz else 'android:layout_width="match_parent"\n        android:layout_height="0dp"'
    ms = f'\n        android:layout_marginStart="{margin_start}dp"' if margin_start else ''
    return f'    <FrameLayout{idattr}\n        {size}\n        android:layout_weight="{w}"{ms} />'

def overlay(spec, oid, visible=True, prefix=''):
    rows = []
    for i_row, (name, w, cols, gap) in enumerate(SPECS[spec]):
        if cols:
            inner = '\n'.join(zone(c, cw, True, gap if i else 0, prefix) for i, (c, cw) in enumerate(cols))
            inner = '\n'.join('    ' + l for l in inner.split('\n'))
            rows.append(f'    <LinearLayout\n        android:layout_width="match_parent"\n        android:layout_height="0dp"\n        android:layout_weight="{w}"\n        android:orientation="horizontal">\n{inner}\n    </LinearLayout>')
        else:
            rows.append(zone(name or 'x', w, False, 0, prefix, fixed=i_row < FIXED_ROWS))
    body = '\n'.join('    ' + l for l in '\n'.join(rows).split('\n'))
    vis = '' if visible else '\n        android:visibility="gone"'
    return f'    <LinearLayout\n        android:id="@+id/{oid}"\n        android:layout_width="match_parent"\n        android:layout_height="match_parent"\n        android:orientation="vertical"\n        android:padding="{PAD}dp"{vis}>\n{body}\n    </LinearLayout>'

for lay, overs in LAYOUTS.items():
    parts = [f'    <ImageView\n        android:id="@+id/img"\n        android:layout_width="match_parent"\n        android:layout_height="match_parent"\n        android:contentDescription="@null"\n        android:scaleType="fitCenter" />']
    for i, o in enumerate(overs):
        parts.append(overlay(o, f'ov_{o}', i == 0, 'live_' if o == 'large_live' else ''))
    xml = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Erzeugt (widgets_gen): Bild des Widgets und deckungsgleiche Klickflächen -->\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:id="@+id/root"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent">\n' + '\n'.join(parts) + '\n</FrameLayout>\n'
    open(os.path.join(RES, f'{lay}.xml'), 'w', encoding='utf-8').write(xml)

# Kotlin: dieselben Maße für den Renderer
kt = ['package app.xeniabridge', '', '// Erzeugt (widgets_gen) – gleiche Zeilen/Spalten wie die Klickflächen in den Widget-Layouts', 'object WidgetSpecs {', f'    const val PAD = {PAD}f', '    /** fixed: Höhe = weight in dp (Kopfzeile und Abstand darunter), sonst Anteil am Rest */', '    class Row(val name: String?, val weight: Float, val cols: List<Pair<String?, Float>>?, val gap: Float, val fixed: Boolean = false)', '    val ROWS: Map<String, List<Row>> = mapOf(']
for spec, rows in SPECS.items():
    rr = []
    for i_row, (name, w, cols, gap) in enumerate(rows):
        cs = 'null' if not cols else 'listOf(' + ', '.join(f'{repr(c) if c else "null"} to {cw}f'.replace("'", '"') for c, cw in cols) + ')'
        rr.append(f'Row({chr(34) + name + chr(34) if name else "null"}, {w}f, {cs}, {gap}f' + (', true)' if i_row < FIXED_ROWS else ')'))
    kt.append(f'        "{spec}" to listOf(' + ', '.join(rr) + '),')
kt += ['    )', '}', '']
open(KT, 'w', encoding='utf-8').write('\n'.join(kt))
print('ok', len(LAYOUTS), 'Layouts')
