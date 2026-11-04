"""Extrait le moteur SEN_ETAFI _DGID.xlsx en JSON compact (formules + constantes)
pour l'évaluateur JavaScript. Usage : python extract_engine.py SEN_ETAFI.xlsx modele.xlsx out.json"""
import sys, re, json, datetime, warnings
import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string
warnings.filterwarnings('ignore')

src, modele, out = sys.argv[1:4]
wb = openpyxl.load_workbook(src)
mw = openpyxl.load_workbook(modele)

REF = re.compile(r"""("(?:[^"]|"")*")|('(?:[^']|'')+'!|[A-Za-z_][\w\.]*!)|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w\(])|(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![\w\(])""")

def normalize(f, r0, c0):
    """Forme relative (style R1C1) pour regrouper les formules recopiées."""
    def rep(m):
        if m.group(1) or m.group(2): return m.group(0)
        if m.group(4):
            ca, col, ra, row = m.group(3), column_index_from_string(m.group(4)), m.group(5), int(m.group(6))
            cs = f"C{col}" if ca else f"C[{col-c0}]"
            rs = f"R{row}" if ra else f"R[{row-r0}]"
            return rs + cs
        ca1, c1, ca2, c2 = m.group(7), column_index_from_string(m.group(8)), m.group(9), column_index_from_string(m.group(10))
        return (f"C{c1}" if ca1 else f"C[{c1-c0}]") + ":" + (f"C{c2}" if ca2 else f"C[{c2-c0}]")
    return REF.sub(rep, f)

def serial(d):
    if isinstance(d, datetime.datetime):
        delta = d - datetime.datetime(1899, 12, 30)
        return delta.days + delta.seconds / 86400
    if isinstance(d, datetime.date):
        return (d - datetime.date(1899, 12, 30)).days
    if isinstance(d, datetime.time):
        return (d.hour * 3600 + d.minute * 60 + d.second) / 86400
    return d

templates, tindex = [], {}
sheets = {}
for ws in wb.worksheets:
    consts, runs = {}, {}
    maxr = 0
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if v is None: continue
            maxr = max(maxr, c.row)
            is_arr = hasattr(v, 'text')
            text = v.text if is_arr else v
            if (is_arr or c.data_type == 'f') and isinstance(text, str) and text.startswith('='):
                key = ('A' if is_arr else 'N') + normalize(text, c.row, c.column)
                if key not in tindex:
                    tindex[key] = len(templates)
                    templates.append([text, c.row, c.column, 1 if is_arr else 0])
                runs.setdefault(c.column, []).append((c.row, tindex[key]))
            else:
                v = serial(v)
                if isinstance(v, bool): v = {'b': v}
                consts[c.coordinate] = v
    # run-length par colonne : [col, rowStart, rowEnd, tpl]
    f = []
    for col, lst in runs.items():
        lst.sort()
        s, e, t = lst[0][0], lst[0][0], lst[0][1]
        for r, tp in lst[1:]:
            if tp == t and r == e + 1: e = r
            else:
                f.append([col, s, e, t]); s, e, t = r, r, tp
        f.append([col, s, e, t])
    sheets[ws.title] = {'maxRow': max(maxr, ws.max_row), 'c': consts, 'f': f}

# cellules cibles du modèle : toutes les cellules du moteur porteuses de formule sur les onglets du modèle
targets = {}
for ms in mw.worksheets:
    if ms.title not in sheets: continue
    es = wb[ms.title]
    lst = []
    for row in es.iter_rows():
        for c in row:
            v = c.value
            t = v.text if hasattr(v, 'text') else v
            if (hasattr(v, 'text') or c.data_type == 'f') and isinstance(t, str) and t.startswith('='):
                lst.append(c.coordinate)
    # formules propres au modèle (en-têtes) : remplacées par leur valeur
    for row in ms.iter_rows():
        for c in row:
            v = c.value
            t = v.text if hasattr(v, 'text') else v
            if (hasattr(v, 'text') or c.data_type == 'f') and isinstance(t, str) and t.startswith('=') and c.coordinate not in lst:
                lst.append(c.coordinate)
    targets[ms.title] = lst

codes = []
if 'Codes activités' in wb.sheetnames:
    for row in wb['Codes activités'].iter_rows(values_only=True):
        for v in row:
            if isinstance(v, str):
                m = re.match(r'^(\d{3})\s?(\d{3})\s+(.*)$', v.strip())
                if m: codes.append([m.group(1) + m.group(2), m.group(3)])
codes.sort()
json.dump({'activityCodes': codes, 'templates': templates, 'sheets': sheets, 'targets': targets,
           'sheetOrder': [w.title for w in wb.worksheets]},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('templates', len(templates), 'targets', sum(len(v) for v in targets.values()))
