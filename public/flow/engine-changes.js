/*
 * Flow — корректировка графика.
 *
 * Подрядчик не меняет утверждённый график. Он направляет запрос:
 *   текущие даты → предлагаемые даты, причина, комментарий.
 * Маршрут: Подрядчик → Технический заказчик → Директор по строительству.
 * Пока директор не утвердил запрос, график не меняется (движок применяет только
 * утверждённые запросы — см. DSF.build). Смежные работы автоматически не сдвигаются:
 * их сдвиг — следствие связей в расчёте прогноза, и он показывается заранее как
 * теоретический сценарий (DSF.changeImpact).
 *
 * Записи хранятся в журнале объекта: changes (запросы) и changeOps (решения).
 * Права на каждую операцию проверяет сервер (api/app/demo.py → validate_append).
 */
(function (root) {
  'use strict';
  const DSF = root.DSF = root.DSF || {};
  const dn = s => (s == null || s === '') ? null : Math.round(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / 864e5);

  DSF.CHANGE_REASONS = ['Изменение проектных решений / РД', 'Поставка материалов и оборудования', 'Погодные условия', 'Недоступность фронта работ (смежники)',
    'Изменение объёмов работ', 'Ресурсы подрядчика', 'Согласования и разрешения', 'Другое'];
  DSF.CHANGE_STATUS = {
    tz:        { t: 'На рассмотрении техзаказчика', c: 'accent', step: 'tz' },
    director:  { t: 'На утверждении директора', c: 'warn', step: 'director' },
    approved:  { t: 'Утверждено — внесено в рабочий прогноз', c: 'good' },
    rejected:  { t: 'Отклонено', c: 'crit' },
    returned:  { t: 'Возвращено на доработку', c: 'warn' },
    withdrawn: { t: 'Отозвано подрядчиком', c: 'neutral' }
  };
  DSF.CHANGE_OPS = {
    'tz-approve': 'Техзаказчик согласовал и направил директору', 'tz-reject': 'Техзаказчик отклонил', 'tz-return': 'Техзаказчик вернул на доработку',
    'dir-approve': 'Директор утвердил изменение графика', 'dir-reject': 'Директор отклонил', 'dir-return': 'Директор вернул на доработку',
    resubmit: 'Подрядчик направил повторно', withdraw: 'Подрядчик отозвал запрос'
  };

  /* состояние запросов объекта: статус, история, решение техзаказчика */
  DSF.changeState = function (P, S) {
    const list = ((S && S.changes) || []).map(c => Object.assign({}, c, { status: 'tz', hist: [{ d: dn(c.date), op: 'create', text: 'Подрядчик направил запрос', by: c.by || c.org, comment: c.comment }], tzDecision: null, dirDecision: null }));
    const by = new Map(list.map(c => [c.id, c]));
    ((S && S.changeOps) || []).forEach(op => {
      const c = by.get(op.change); if (!c) return;
      const o = op.op;
      if (o === 'tz-approve') { c.status = 'director'; c.tzDecision = { t: 'Согласовано', c: 'good', comment: op.comment, d: dn(op.date), by: op.by }; }
      else if (o === 'tz-reject') { c.status = 'rejected'; c.tzDecision = { t: 'Отклонено', c: 'crit', comment: op.comment, d: dn(op.date), by: op.by }; }
      else if (o === 'tz-return') { c.status = 'returned'; c.tzDecision = { t: 'Возвращено', c: 'warn', comment: op.comment, d: dn(op.date), by: op.by }; }
      else if (o === 'dir-approve') { c.status = 'approved'; c.dirDecision = { t: 'Утверждено', c: 'good', comment: op.comment, d: dn(op.date), by: op.by }; }
      else if (o === 'dir-reject') { c.status = 'rejected'; c.dirDecision = { t: 'Отклонено', c: 'crit', comment: op.comment, d: dn(op.date), by: op.by }; }
      else if (o === 'dir-return') { c.status = 'returned'; c.dirDecision = { t: 'Возвращено', c: 'warn', comment: op.comment, d: dn(op.date), by: op.by }; }
      else if (o === 'resubmit') { c.status = 'tz'; c.tzDecision = null; c.dirDecision = null; if (op.ps) c.ps = op.ps; if (op.pf) c.pf = op.pf; if (op.reason) c.reason = op.reason; if (op.comment) c.comment = op.comment; }
      else if (o === 'withdraw') c.status = 'withdrawn';
      c.hist.push({ d: dn(op.date), op: o, text: DSF.CHANGE_OPS[o] || o, by: op.by, comment: op.comment });
    });
    // утверждённые запросы применяются по порядку: последний утверждённый по работе — действующий
    const approved = new Map();
    list.filter(c => c.status === 'approved').forEach(c => approved.set(c.task, c));
    return { list, by, approved };
  };

  /* Анализ влияния: сценарий «как если бы запрос утвердили». Утверждённый график не меняется —
     строится отдельная модель тем же механизмом CPM (cpm.js) и сравнивается с текущей.
     Предложенные даты становятся ограничениями рабочего прогноза («начало не ранее», «окончание не ранее»);
     базовый план работы остаётся прежним, поэтому сдвиг виден относительно плана. */
  DSF.changeImpact = function (P, ch) {
    const M0 = DSF.build(P);
    const target = M0.byId.get(ch.task);
    const errors = [], warnings = [];
    if (!target) return { state: 'error', errors: ['Работа не найдена в графике объекта.'], warnings, rows: [] };
    const ps = dn(ch.ps), pf = dn(ch.pf);
    if (target.done) errors.push('Работа фактически завершена ' + DSF.fmt.date(target.af) + ' — переносить её сроки нельзя.');
    if (ps == null || pf == null) errors.push('Не указаны предлагаемые даты.');
    else if (pf < ps) errors.push('Предлагаемое окончание раньше начала.');
    if (target.as != null && ps != null && ps !== target.as && ps !== target.s0) warnings.push('Работа уже начата ' + DSF.fmt.date(target.as) + ' — учитывается только новое окончание.');
    if (target.as == null && ps != null && ps < M0.T) warnings.push('Предлагаемое начало раньше отчётной даты.');
    if (!target.done && pf != null && pf <= target.ef) warnings.push('Предлагаемое окончание (' + DSF.fmt.date(pf) + ') не позже текущего прогноза работы (' + DSF.fmt.date(target.ef) + ') — прогноз от запроса не меняется.');
    const tasks = (P.tasks || []).map(t => t.id === ch.task ? Object.assign({}, t, { snetC: t.as ? null : ch.ps, fnetC: ch.pf, proposal: true }) : t);
    const P2 = Object.assign({}, P, { tasks });
    delete P2.__model;
    let M1;
    try { M1 = DSF.build(P2); } catch (e) { return { state: 'error', errors: errors.concat('Ошибка расчёта сценария: ' + e.message), warnings, rows: [] }; }
    const target1 = M1.byId.get(ch.task);
    const N = M0.network;
    // достоверность вывода о вводе объекта
    const isOpenEnd = N.openEnds.some(t => t.id === ch.task), isOpenStart = N.openStarts.some(t => t.id === ch.task);
    let confidence = 'ok';
    if (N.state === 'error') { confidence = 'error'; errors.push('В графике есть циклические связи: ' + N.cycles.map(c => c.map(t => t.name).join(' → ')).join('; ')); }
    else if (N.state === 'none') { confidence = 'insufficient'; warnings.push('В графике объекта нет логических связей между работами.'); }
    else if (isOpenEnd) { confidence = 'insufficient'; warnings.push('У работы нет последующих работ в графике — её влияние на другие работы и ввод не может быть определено.'); }
    else if (N.state === 'partial') { confidence = 'partial'; warnings.push('Для части работ отсутствуют логические зависимости (' + N.openEnds.length + ' без последователей, ' + N.openStarts.length + ' без предшественников). Расчёт влияния на сроки объекта может быть неполным.'); }
    if (target.critSrc != null) { confidence = 'insufficient'; warnings.push('Прогноз объекта рассчитан в исходной системе — сетевой модели связей во Flow нет.'); }
    // затронутые работы
    const succ = N.succ || new Map();
    const down = new Set(); const q = [ch.task];
    while (q.length) { const x = q.shift(); (succ.get(x) || []).forEach(y => { if (!down.has(y)) { down.add(y); q.push(y); } }); }
    const orgOf = t => { const c = t.contract && M0.contractBy.get(t.contract); return c ? c.contractor : (t.org || ''); };
    const rows = [];
    M0.tasks.forEach(t => {
      if (t.id === ch.task) return;
      const t1 = M1.byId.get(t.id); if (!t1) return;
      const ds = t1.es - t.es, df = t1.ef - t.ef;
      if (!ds && !df) return;
      rows.push({ task: t, es0: t.es, ef0: t.ef, es1: t1.es, ef1: t1.ef, ds, df, kind: t.ms ? 'milestone' : down.has(t.id) ? 'next' : 'adjacent',
        crit0: t.crit, crit1: t1.crit, float0: t.float, float1: t1.float, contractor: orgOf(t), directive: t.directive,
        overDirective: t.directive != null && t1.ef > t.directive && !(t.ef > t.directive) });
    });
    rows.sort((a, b) => (b.df - a.df) || (a.ef0 - b.ef0));
    // этапы
    const stages = M0.stages.map(s => { const s1 = M1.stages.find(z => z.name === s.name); return s1 ? { name: s.name, ef0: s.ef, ef1: s1.ef, d: s1.ef - s.ef, pf: s.f0 } : null; }).filter(x => x && x.d);
    // подрядчики
    const ownOrg = orgOf(target);
    const byOrg = new Map();
    rows.filter(r => !r.task.ms).forEach(r => { const o = r.contractor || 'исполнитель не назначен'; if (!byOrg.has(o)) byOrg.set(o, []); byOrg.get(o).push(r); });
    const orgs = [...byOrg.keys()].filter(o => o !== ownOrg && o !== 'исполнитель не назначен');
    // критический путь
    const c0 = new Set(M0.critPath), c1 = new Set(M1.critPath);
    const newCrit = [...c1].filter(id => !c0.has(id) && id !== ch.task).map(id => M1.byId.get(id)).filter(Boolean);
    const leftCrit = [...c0].filter(id => !c1.has(id) && id !== ch.task).map(id => M0.byId.get(id)).filter(Boolean);
    const end0 = M0.root.forecastEnd, end1 = M1.root.forecastEnd;
    const endShift = end0 != null && end1 != null ? end1 - end0 : null;
    const directive = M0.root.planEnd;
    // конфликт с утверждёнными вехами (директивные сроки)
    const msConflicts = M1.tasks.filter(t => t.ms && t.directive != null && t.af == null && t.ef > t.directive && !(M0.byId.get(t.id).ef > t.directive));
    if (msConflicts.length) warnings.push('Новый срок нарушает директивные сроки вех: ' + msConflicts.map(t => t.name).join(', ') + '.');
    const state = errors.length ? 'error' : confidence;
    const endText = state === 'error' ? 'Ошибка расчёта — вывод о вводе объекта не делается.'
      : confidence === 'insufficient' ? 'Недостаточно данных для достоверной оценки влияния на ввод объекта. Требуется проверка логических связей графика.'
      : endShift > 0 ? 'Прогноз ввода объекта сдвигается на ' + endShift + ' дн.'
      : endShift < 0 ? 'Прогноз ввода объекта становится раньше на ' + (-endShift) + ' дн.'
      : 'Прогноз ввода не меняется: сдвиг поглощается резервом времени' + (confidence === 'partial' ? ' (с оговоркой: сеть связей неполная)' : '') + '.';
    return {
      state, confidence, errors, warnings, endText,
      target, target1,
      cur: { ps: target.s0, pf: target.f0, es: target.es, ef: target.ef },
      prop: { ps, pf, es: target1 ? target1.es : null, ef: target1 ? target1.ef : null },
      shiftStart: ps != null ? ps - target.s0 : 0, shiftEnd: pf != null ? pf - target.f0 : 0, shiftForecast: target1 ? target1.ef - target.ef : 0,
      float0: target.float, float1: target1 ? target1.float : null, free0: target.freeFloat, free1: target1 ? target1.freeFloat : null,
      rows, next: rows.filter(r => r.kind === 'next'), adjacent: rows.filter(r => r.kind === 'adjacent'), milestones: rows.filter(r => r.kind === 'milestone'),
      stages, byOrg, orgs, critical: !!(target.crit || (target1 && target1.crit)), crit0: !!target.crit, crit1: !!(target1 && target1.crit),
      critChanged: newCrit.length > 0 || leftCrit.length > 0, newCrit, leftCrit,
      end0, end1, endShift, planEnd: directive, delay0: M0.root.delay, delay1: M1.root.delay,
      overDirective: rows.filter(r => r.overDirective), msConflicts, network: N, M0, M1
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
