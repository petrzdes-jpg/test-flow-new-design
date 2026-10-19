#!/usr/bin/env python3
"""Преобразует public/assets/data/ogni-schedule.json (выгрузка переданного MPP «Огней»)
в формат строк ГПР общего движка DSFlow: public/assets/data/ogni-gpr.js.

Строка: [uid, id, parentUid, name, start, finish, actualStart, actualFinish,
         %complete, durationWorkDays, isSummary, isCritical, predecessors[[uid,type,lagWd]]]
uid = ID строки MPP + 1 (нулевой uid занят не будет), родитель — по WBS, как в исходном файле.
Запуск: python3 tools/build-ogni-gpr.py
"""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
src = json.loads((root / 'public/assets/data/ogni-schedule.json').read_text(encoding='utf-8'))
tasks = src['tasks']
latest, rows = {}, []
for t in tasks:
    wbs = t['wbs']
    parent_wbs = wbs.rsplit('.', 1)[0] if '.' in wbs else '0'
    parent = None if t['id'] == 0 else latest.get(parent_wbs, 0)
    latest[wbs] = t['id']
    m = re.match(r'([\d.]+)d', t.get('duration') or '')
    du = float(m.group(1)) if m else 0.0
    du = int(du) if du == int(du) else du
    preds = []
    for p in re.split(r'[;,]', t.get('predecessors') or ''):
        p = p.strip()
        mm = re.match(r'^(\d+)(FS|SS|FF|SF)?$', p)
        if mm: preds.append([int(mm.group(1)) + 1, mm.group(2) or 'FS', 0])
    rows.append([t['id'] + 1, t['id'], -1 if parent is None else parent + 1, t['name'], t['start'], t['finish'],
                 t.get('actualStartInSource'), t.get('actualFinishInSource'), t.get('percentInSource') or 0,
                 du, 1 if t['summary'] else 0, 1 if t.get('criticalInSource') else 0, preds])
out = ('/* БЦ «Огни»: ГПР из переданного Microsoft Project (' + src['source'] + ', сохранён ' + src['sourceLastSaved'] + ').\n'
       '   Сгенерировано tools/build-ogni-gpr.py из ogni-schedule.json — не редактировать вручную.\n'
       '   Формат строки — как MPP_ROWS «Раменок»: [uid, id, parentUid, name, start, finish, actualStart, actualFinish,\n'
       '   %complete, durationWorkDays, isSummary, isCritical, predecessors[[uid,type,lagWd]]]. uid = ID + 1. */\n'
       'const MPP_ROWS = ' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + ';\n')
(root / 'public/assets/data/ogni-gpr.js').write_text(out, encoding='utf-8')
print(len(rows), 'rows')
