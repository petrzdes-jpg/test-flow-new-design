/*
 * Цифровой штаб строительства — универсальный движок проекта.
 *
 * PROJECT DATA (data/projects/*.js)  →  DSF.build(project)  →  модель M  →  UI
 *
 * Движок ничего не знает о конкретных объектах, видах работ или стадиях.
 * Датасет содержит только первичные факты (план/факт работ, договоры, риски…),
 * всё производное — готовность, прогноз, критический путь, бюджет, календарь,
 * лента событий, «требует внимания» — считается здесь и только здесь.
 * Файл не трогает DOM и запускается в Node для проверки данных.
 */
(function (root) {
  'use strict';

  const DSF = root.DSF = root.DSF || {};
  DSF.projects = DSF.projects || [];
  DSF.config = Object.assign({ today: '2026-10-05' }, DSF.config || {});
  /* дополнения к датасету (вымышленные ежедневные отчёты, замечания и т. п.) — отдельными файлами data/flow/<id>.js */
  DSF.augments = DSF.augments || {};
  function applyAugment(p, a) {
    if (!a || p.__aug) return; p.__aug = true;
    Object.keys(a).forEach(k => {
      if (k === 'taskPatch') { Object.entries(a.taskPatch).forEach(([id, patch]) => { const t = (p.tasks || []).find(x => x.id === id); if (t) Object.assign(t, patch); }); return; }
      if (Array.isArray(a[k])) p[k] = (p[k] || []).concat(a[k]);
      else if (a[k] && typeof a[k] === 'object' && p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) p[k] = Object.assign({}, p[k], a[k]);
      else p[k] = a[k];
    });
  }
  DSF.register = function (p) { applyAugment(p, DSF.augments[p.id]); DSF.projects.push(p); };
  DSF.augment = function (id, a) { DSF.augments[id] = a; const p = DSF.projects.find(x => x.id === id); if (p) applyAugment(p, a); };
  DSF.extensions = DSF.extensions || [];
  DSF.invalidate = function (pid) { DSF.projects.forEach(p => { if (!pid || p.id === pid) delete p.__model; }); };

  /* ---------- даты ---------- */
  const DAY = 864e5;
  const dn = s => (s == null || s === '') ? null : Math.round(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / DAY);
  const iso = d => new Date(d * DAY).toISOString().slice(0, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? (f(x) || 0) : (x || 0)), 0);
  const monthStart = d => { const x = new Date(d * DAY); return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) / DAY); };
  const monthEnd = d => { const x = new Date(d * DAY); return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1) / DAY) - 1; };
  const addMonths = (d, n) => { const x = new Date(d * DAY); return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1) / DAY); };
  DSF.util = { DAY, dn, iso, clamp, sum, monthStart, monthEnd, addMonths };

  /* ---------- справочники (общие для всех проектов) ---------- */
  DSF.RISK_STATUS = ['Реализуется', 'Открыт', 'Под контролем', 'Закрыт'];
  DSF.PROJECT_STATUS = {
    plan:   { t: 'Подготовка', c: 'neutral' },
    active: { t: 'Строительство', c: 'accent' },
    pause:  { t: 'Приостановлен', c: 'warn' },
    done:   { t: 'Завершён', c: 'good' }
  };
  /* правила расчёта общей готовности объекта (настраиваются для каждого объекта) */
  DSF.READINESS_MODES = {
    cost:   { t: 'По стоимости работ', d: 'Вес работы = её стоимость. Работы статей с отметкой «не участвует в готовности» исключаются.' },
    weight: { t: 'По весовым коэффициентам', d: 'Вес задаётся этапам и работам вручную. Работы без веса в готовности не участвуют.' },
    manual: { t: 'Вручную', d: 'Плановая и фактическая готовность вводятся на отчётную дату.' }
  };
  DSF.riskLevel = score => score >= 15 ? 'high' : score >= 8 ? 'mid' : 'low';
  /* типы событий календаря: пользовательские + системные (из графика) */
  DSF.EVENT_TYPES = {
    meeting:    { t: 'Встреча',                       c: 'accent',  user: true, letter: 'invite' },
    conference: { t: 'Совещание',                     c: 'accent',  user: true, letter: 'invite' },
    acceptance: { t: 'Приёмка работ',                 c: 'good',    user: true, letter: 'invite' },
    inspection: { t: 'Освидетельствование конструкции', c: 'good',  user: true, letter: 'letter' },
    rd:         { t: 'Выдача РД',                     c: 'accent',  user: true, letter: 'letter' },
    delivery:   { t: 'Поставка',                      c: 'warn',    user: true, letter: 'letter' },
    control:    { t: 'Контрольная дата',              c: 'crit',    user: true, letter: 'letter' },
    site:       { t: 'Событие по объекту',            c: 'neutral', user: true, letter: 'letter' },
    order:      { t: 'Протокольное поручение',        c: 'warn',    user: true, letter: 'letter' },
    other:      { t: 'Другое',                        c: 'neutral', user: true, letter: 'letter' },
    milestone:  { t: 'Веха графика',                  c: 'accent' },
    start:      { t: 'Начало работ',                  c: 'neutral' },
    finish:     { t: 'Завершение работ',              c: 'good' }
  };
  /* двухэтапный процесс КС-2: заявка подрядчика → приёмка → КС-2 по принятому → расчётный период */
  DSF.KS_STATUS = {
    draft:    { t: 'Черновик подрядчика', r: 0, c: 'neutral', stage: 1 },
    sent:     { t: 'Направлено на предварительную проверку', r: 1, c: 'accent', stage: 1 },
    review:   { t: 'Проверяется Техническим заказчиком', r: 2, c: 'accent', stage: 1 },
    remarks:  { t: 'Есть замечания — требуется корректировка', r: 2, c: 'warn', stage: 1 },
    pre:      { t: 'Предварительно согласовано', r: 3, c: 'good', stage: 1 },
    accept:   { t: 'Направлено на приёмку', r: 4, c: 'accent', stage: 1 },
    accepted: { t: 'Работы приняты', r: 5, c: 'good', stage: 1 },
    partial:  { t: 'Принято частично', r: 5, c: 'warn', stage: 1 },
    rejected: { t: 'Не принято — замечания', r: 5, c: 'crit', stage: 1 },
    formed:   { t: 'КС-2 сформирована по принятому объёму', r: 6, c: 'accent', stage: 2 },
    agreed:   { t: 'КС-2 согласована', r: 7, c: 'good', stage: 2 },
    period:   { t: 'Включено в расчётный период', r: 8, c: 'good', stage: 2 },
    paid:     { t: 'Оплачено', r: 9, c: 'good', stage: 2 }
  };
  DSF.KS_NEXT = {
    draft: ['sent'], sent: ['review'], review: ['pre', 'remarks'], remarks: ['sent'], pre: ['accept'],
    accept: ['accepted', 'partial', 'rejected'], accepted: ['formed'], partial: ['formed'], rejected: ['sent'],
    formed: ['agreed'], agreed: ['period'], period: [], paid: []
  };

  /* сроки считает единый механизм календарно-сетевого планирования (cpm.js) */
  const parseDep = s => DSF.cpm.parseDep(s);

  /* ---------- сборка модели проекта ---------- */
  DSF.build = function (P) {
    if (P.__model) return P.__model;
    const T = dn(P.today || DSF.config.today);
    const S = (DSF.store && DSF.store.get(P.id)) || {};
    const BUDGET = P.budget || { reserve: 0, items: [] };
    const DATES = P.dates || {};
    const RD = Object.assign({ mode: 'cost' }, P.readiness || {});
    const entered = P.finance === 'entered';   // финансы только из введённых данных, без модели актов
    (DSF.store && DSF.store.KINDS || ['events', 'eventOps', 'docs', 'docOps', 'orders', 'orderOps', 'ks', 'ksOps', 'letters', 'reports', 'reportOps', 'remarks', 'remarkOps', 'decisions', 'notes']).forEach(k => { if (!Array.isArray(S[k])) S[k] = []; });
    const items = (BUDGET.items || []).map(it => Object.assign({ inReadiness: true }, it));
    const itemBy = new Map(items.map(i => [i.code, i]));

    /* журнал ежедневного факта: в расчёт идут только строки отчётов, прошедшие всю цепочку подтверждения */
    const J = DSF.factJournal ? DSF.factJournal(P, S, T) : null;
    const PACE_WIN = 14;
    /* корректировки графика: применяются только после утверждения директором */
    const CH = DSF.changeState ? DSF.changeState(P, S) : { list: [], approved: new Map() };
    const LK = new Map(); (S.linkOps || []).forEach(op => { if (!LK.has(op.succ)) LK.set(op.succ, []); LK.get(op.succ).push(op); });
    const CAL = DSF.cpm.calendar(P.calendar);
    /* корректировки исходных данных (журнал): версии базового плана, правки работ, факт, новые работы.
       Каждая правка — отдельная запись с автором, датой и основанием; исходный датасет не меняется. */
    const BL = new Map(), BLV = [];
    (S.baselineOps || []).forEach(op => { BLV.push(op); Object.entries(op.tasks || {}).forEach(([id, v]) => BL.set(id, Object.assign({ v: op.version }, v))); });
    const TOPS = new Map(); (S.taskOps || []).forEach(op => { if (!TOPS.has(op.task)) TOPS.set(op.task, []); TOPS.get(op.task).push(op); });
    const addedTasks = (S.taskOps || []).filter(op => op.op === 'add' && op.data).map(op => Object.assign({ id: op.task, added: true }, op.data));
    const srcTasks = (P.tasks || []).concat(addedTasks).map(x0 => {
      let x = x0;
      const b = BL.get(x.id); if (b) x = Object.assign({}, x, { ps: b.ps || x.ps, pf: b.pf || x.pf, baselineV: b.v });
      (TOPS.get(x.id) || []).forEach(op => {
        if (op.op === 'add') return;
        const pt = op.patch || {};
        if (op.layer === 'baseline') x = Object.assign({}, x, pick(pt, ['ps', 'pf']));
        else if (op.layer === 'fact') {
          x = Object.assign({}, x, pick(pt, ['as', 'af', 'pct', 'qtyFact']));
          if (pt.pct != null && x.qty > 0 && !('qtyFact' in pt)) x = Object.assign({}, x, { qtyFact: +x.qty * pt.pct / 100 });
          if (pt.pct === 0) x = Object.assign({}, x, { as: pt.as || undefined, af: undefined, factReset: true });
          if (pt.pct != null && pt.pct < 100 && pt.af == null) x = Object.assign({}, x, { af: undefined });
        }
        else if (op.layer === 'forecast') x = Object.assign({}, x, { snetC: pt.ps || x.snetC, fnetC: pt.pf || x.fnetC });
        else x = Object.assign({}, x, pick(pt, ['name', 'stage', 'contract', 'directive', 'archived', 'qty', 'unit', 'cost', 'item', 'key', 'org', 'workType']));
        x.edited = (x.edited || 0) + 1;
      });
      return x;
    });
    function pick(o, ks) { const r = {}; ks.forEach(k => { if (k in o) r[k] = o[k] === '' ? undefined : o[k]; }); return r; }
    const tasks = srcTasks.filter(x => !x.archived).map((x, i) => {
      const ap = x.proposal ? null : CH.approved.get(x.id);
      if (ap) x = Object.assign({}, x, { corrected: ap.id, snetC: ap.ps, fnetC: ap.pf });
      const t = Object.assign({}, x);
      t.idx = i;
      t.ms = !!x.ms;
      t.s0 = dn(x.ps || x.pf); t.f0 = dn(x.pf || x.ps);
      t.as = dn(x.as); t.af = dn(x.af);
      t.directive = dn(x.directive);
      // объёмы: общий, плановый на отчётную дату, фактический; % считается из объёма, если он задан
      t.qty = +x.qty > 0 ? +x.qty : null;
      t.qtyFact = x.qtyFact != null && x.qtyFact !== '' ? +x.qtyFact : null;
      t.qtyPlan = x.qtyPlan != null && x.qtyPlan !== '' ? +x.qtyPlan : null;
      const toPct = v => t.qty ? v / t.qty * 100 : v;
      // факт на начало журнала (внесён при подключении объекта или администратором)
      t.basePct = x.ms ? 0 : Math.min(100, t.qty ? (t.qtyFact || 0) / t.qty * 100 : (+x.pct || 0));
      const hist = (!x.ms && J && J.byTask.get(x.id)) || [];
      t.hist = hist; t.pend = (J && J.pend.get(x.id)) || null;
      if (hist.length) {
        if (t.qty) t.qtyFact = (t.qtyFact || 0) + sum(hist, e => e.v);
        let cum = t.basePct;
        t.histCum = hist.map(e => { cum = Math.min(100, cum + toPct(e.v)); return [e.d, cum]; });
        t.histStart = hist[0].d;
        if (t.as == null) t.as = t.histStart;
      }
      const volPct = t.qty && t.qtyFact != null ? Math.min(100, Math.round(t.qtyFact / t.qty * 1000) / 10) : null;
      t.pct = x.ms ? (x.af ? 100 : 0) : (volPct != null ? volPct : Math.min(100, Math.round(((+x.pct || 0) + sum(hist, e => e.v)) * 10) / 10));
      if (!x.ms && t.af == null && t.pct >= 100 && t.histCum) { const h = t.histCum.find(e => e[1] >= 99.95); t.af = h ? h[0] : t.histCum[t.histCum.length - 1][0]; }
      t.planOverride = !x.ms && t.qty && t.qtyPlan != null ? clamp(t.qtyPlan / t.qty * 100, 0, 100) : null;
      t.done = t.pct >= 100;
      // темп за 14 дней по подтверждённым отчётам и прогноз окончания при текущем темпе
      if (!x.ms && !t.done && hist.length) {
        const win = hist.filter(e => e.d > T - PACE_WIN && e.d <= T);
        const prog = sum(win, e => toPct(e.v)), days = new Set(win.map(e => e.d)).size;
        const left = 100 - t.pct, rate = prog / PACE_WIN, need = t.f0 >= T ? left / (t.f0 - T + 1) : null;   // плановый срок прошёл — требуемый темп не определён
        t.pace = { rate, days, need, ratio: need > 0 ? rate / need : null, unitRate: t.qty ? rate * t.qty / 100 : null };
        if (days >= 6 && t.pct >= 10 && rate > 0) t.efPace = T + Math.ceil(left / rate);
      }
      t.dur = t.ms ? 0 : Math.max(1, CAL.span(t.s0, t.f0));
      // объект из внешнего источника (рабочий модуль реального объекта): прогноз и критичность — из источника
      t.fsE = dn(x.fcStart); t.fcE = dn(x.fcEnd);
      // ограничения рабочего прогноза: утверждённая корректировка или сценарий запроса («не раньше»)
      t.snet = x.snetC && x.as == null ? dn(x.snetC) : null;
      t.fnet = x.fnetC ? dn(x.fnetC) : null;
      t.cost = t.ms ? 0 : (x.cost || 0);
      t.deps = (x.deps || []).map(parseDep);
      (LK.get(x.id) || []).forEach(op => {
        const i = t.deps.findIndex(d => d.id === op.pred && d.type === (op.type || 'FS'));
        if (op.op === 'remove' || op.op === 'deactivate') { if (i >= 0) t.deps[i] = Object.assign({}, t.deps[i], { active: false, offBy: op.by, offDate: op.date }); }
        else if (op.op === 'add') { const d = { id: op.pred, type: op.type || 'FS', lag: +op.lag || 0, active: true, source: op.source || 'manual' }; if (i >= 0) t.deps[i] = d; else t.deps.push(d); }
      });
      t.stage = x.stage || 'Работы';
      const it = itemBy.get(x.item);
      t.weighted = !t.ms && (!it || it.inReadiness !== false) && x.inReady !== false;
      return t;
    });
    // поддержка старых связей на архивные работы: связь снимается
    const live = new Set(tasks.map(t => t.id));
    tasks.forEach(t => { t.deps = t.deps.filter(d => d.bad || live.has(d.id) || !(P.tasks || []).some(z => z.id === d.id && z.archived)); });
    const byId = new Map(tasks.map(t => [t.id, t]));
    const finalId = (tasks.find(t => t.final) || {}).id;
    const T0 = T;

    function x_crit(t) { return t.critSrc != null ? !!t.critSrc && !t.done : !t.done && t.float <= 0; }
    /* риски: оценка и влияние */
    const risks = (P.risks || []).map(r => {
      const o = Object.assign({}, r);
      o.score = r.p * r.i;
      o.level = DSF.riskLevel(o.score);
      o.active = r.status !== 'Закрыт';
      o.realized = r.status === 'Реализуется';
      o.eff = r.effect || {};
      return o;
    });
    const extraFor = skip => {
      const m = new Map();
      risks.forEach(r => { if (r.realized && r.eff.task && r.eff.days && r !== skip) m.set(r.eff.task, (m.get(r.eff.task) || 0) + r.eff.days); });
      return m;
    };
    const net = DSF.cpm.check(tasks, { finalId });
    const base = DSF.cpm.forward(tasks, byId, T, { cal: CAL, extra: extraFor(null), finalId });
    if (!isFinite(base.end)) base.end = null;
    const BW = tasks.length ? DSF.cpm.backward(tasks, byId, base.res, base.end, { cal: CAL }) : { lf: new Map(), free: new Map() };
    tasks.forEach(t => {
      const r = base.res.get(t.id);
      t.es = r.es; t.ef = r.ef;
      t.lf = BW.lf.get(t.id);
      t.ls = t.lf != null ? t.lf - (t.ef - t.es) : null;
      t.float = t.done ? null : t.lf - t.ef;
      t.freeFloat = t.done ? null : BW.free.get(t.id);
      t.crit = x_crit(t);
      t.extra = extraFor(null).get(t.id) || 0;
      t.planNow = planPct(t, T);
      t.dev = t.ms ? 0 : t.pct - t.planNow;
      t.slip = t.ef - t.f0;                       // + позже плана
      t.started = t.as != null || (t.ms && t.af != null);
      t.state = t.done ? 'done' : t.started ? 'active' : 'wait';
      t.flags = [];
      if (!t.done && t.f0 < T) t.flags.push('overdue');
      if (!t.started && !t.ms && t.s0 < T) t.flags.push('latestart');
      if (t.state === 'active' && t.dev < -7) t.flags.push('lag');
      t.st = taskStatus(t);
    });
    // вклад каждого реализующегося риска в сдвиг окончания проекта
    risks.forEach(r => {
      r.projectDays = 0;
      if (r.realized && r.eff.task && r.eff.days && byId.get(r.eff.task)) {
        const alt = DSF.cpm.forward(tasks, byId, T, { cal: CAL, extra: extraFor(r), finalId });
        r.projectDays = base.end - alt.end;
      }
      r.task = r.eff.task ? byId.get(r.eff.task) : null;
    });

    /* этапы (группы работ) */
    /* веса готовности: стоимость (как раньше) или коэффициенты объекта; без настройки — не считаются */
    const cfgStages = (P.stages || []).filter(s => !s.archived);
    const stageW = new Map(cfgStages.filter(s => +s.weight > 0).map(s => [s.name, +s.weight]));
    tasks.forEach(t => {
      if (t.ms || !t.weighted) { t.w = 0; return; }
      t.w = RD.mode === 'cost' ? t.cost : RD.mode === 'weight' ? (+t.weight > 0 ? +t.weight : 0) : 0;
    });
    if (RD.mode === 'weight' && stageW.size) {
      // вес этапа распределяется между его работами пропорционально их коэффициентам
      const sw = sum([...stageW.values()]);
      [...new Set(tasks.map(t => t.stage))].forEach(name => {
        const ts = tasks.filter(t => t.stage === name && t.w > 0), tw = sum(ts, t => t.w);
        tasks.filter(t => t.stage === name).forEach(t => { t.w = stageW.has(name) && tw ? stageW.get(name) / sw * t.w / tw * 100 : 0; });
      });
    }
    const stageNames = [...new Set(cfgStages.map(s => s.name).filter(n => tasks.some(t => t.stage === n)).concat(tasks.map(t => t.stage)))];
    const stages = stageNames.map(name => {
      const ts = tasks.filter(t => t.stage === name);
      const w = ts.filter(t => !t.ms);
      const cost = sum(w, t => t.cost);
      // для отображения этапа: веса готовности, иначе стоимость, иначе равные доли
      const wt = sum(w, t => t.w) > 0 ? (t => t.w) : sum(w, t => +t.wSrc || 0) > 0 ? (t => +t.wSrc || 0) : cost > 0 ? (t => t.cost) : (() => 1);
      const wsum0 = sum(w, wt);
      const s = {
        id: 'st' + stageNames.indexOf(name), name, tasks: ts,
        s0: Math.min(...ts.map(t => t.s0)), f0: Math.max(...ts.map(t => t.f0)),
        es: Math.min(...ts.map(t => t.es)), ef: Math.max(...ts.map(t => t.ef)),
        cost, weight: stageW.get(name) || null,
        pct: wsum0 ? sum(w, t => wt(t) * t.pct) / wsum0 : (ts.every(t => t.done) ? 100 : 0),
        planNow: wsum0 ? sum(w, t => wt(t) * t.planNow) / wsum0 : 0,
        crit: ts.some(t => t.crit),
        done: ts.every(t => t.done),
        started: ts.some(t => t.started)
      };
      s.as = s.started ? Math.min(...ts.filter(t => t.started).map(t => t.as != null ? t.as : t.af)) : null;
      s.af = s.done ? Math.max(...ts.map(t => t.af != null ? t.af : t.f0)) : null;
      s.slip = s.ef - s.f0;
      s.state = s.done ? 'done' : s.started ? 'active' : 'wait';
      s.dev = s.pct - s.planNow;
      return s;
    });

    /* готовность и сроки */
    const W = tasks.filter(t => t.w > 0);
    const wsum = sum(W, t => t.w);
    const readyAt = (x, fn) => wsum > 0 ? sum(W, t => t.w * fn(t, x)) / wsum : null;
    const nz = a => a.filter(v => v != null && isFinite(v));
    const start = dn(DATES.start) != null ? dn(DATES.start) : (tasks.length ? Math.min(...nz(tasks.map(t => t.s0))) : null);
    const planEnd = dn(DATES.planEnd) != null ? dn(DATES.planEnd) : (tasks.length ? Math.max(...nz(tasks.map(t => t.f0))) : null);
    const actualEnd = dn(DATES.actualEnd);
    const fin = finalId ? byId.get(finalId) : null;
    const forecastEnd = actualEnd != null ? actualEnd : (base.end != null ? base.end : planEnd);
    const has = v => v != null && isFinite(v);
    const ext = RD.mode === 'manual' || RD.mode === 'external';
    const root = {
      mode: RD.mode, configured: ext ? RD.fact != null && RD.fact !== '' : wsum > 0, source: RD.source || null,
      pc: ext ? (RD.fact != null && RD.fact !== '' ? +RD.fact : null) : readyAt(T, (t) => t.pct),
      planNow: ext ? (RD.plan != null && RD.plan !== '' ? +RD.plan : null) : readyAt(T, planPct),
      start, planEnd, forecastEnd, actualEnd,
      delay: has(forecastEnd) && has(planEnd) ? forecastEnd - planEnd : null,
      elapsed: has(start) && has(planEnd) ? clamp(T - start, 0, planEnd - start) : null, total: has(start) && has(planEnd) ? planEnd - start : null
    };
    root.dev = root.pc != null && root.planNow != null ? root.pc - root.planNow : null;
    root.timePct = root.total ? root.elapsed / root.total * 100 : null;
    root.left = has(forecastEnd) ? Math.max(0, forecastEnd - T) : null;

    /* кривые план/факт/прогноз (готовность, %) */
    const curve = [];
    const hasSpan = has(start) && has(planEnd);
    const c0 = hasSpan ? monthStart(Math.min(start, ...nz(tasks.map(t => t.s0)))) : null, c1 = hasSpan ? monthEnd(Math.max(planEnd, has(forecastEnd) ? forecastEnd : planEnd)) : null;
    if (RD.mode === 'external' && Array.isArray(RD.curve)) RD.curve.forEach(c => curve.push({ t: dn(c.t), plan: c.plan, fact: c.fact, fc: c.fc }));
    else if (hasSpan && RD.mode !== 'manual' && wsum > 0) for (let m = c0; m <= c1; m = addMonths(m, 1)) {
      const x = monthEnd(m);
      curve.push({ t: x, plan: readyAt(x, planPct), fact: x <= T ? readyAt(x, factPct) : null, fc: x >= T ? readyAt(x, forecastPct) : null });
    }
    const curveT = { t: T, plan: root.planNow, fact: root.pc, fc: root.pc };

    /* бюджет */
    function fracAt(c, x) {
      const it = itemBy.get(c.item);
      if (c.tasks.length === 0) {
        if (it && it.mode === 'linear' && has(start) && has(forecastEnd)) return clamp((x - start + 1) / (forecastEnd - start + 1), 0, 1);
        return 0;
      }
      const b = sum(c.tasks, t => t.cost);
      return b ? sum(c.tasks, t => t.cost * factPct(t, x)) / b / 100 : 0;
    }
    function planFracAt(c, x) {
      const it = itemBy.get(c.item);
      if (c.tasks.length === 0) return it && it.mode === 'linear' && hasSpan ? clamp((x - start + 1) / (planEnd - start + 1), 0, 1) : 0;
      const b = sum(c.tasks, t => t.cost);
      return b ? sum(c.tasks, t => t.cost * planPct(t, x)) / b / 100 : 0;
    }
    const ksCfg = new Map((P.ks2 || []).map(k => [k.contract, k]));
    const KR = st => (DSF.KS_STATUS[st] || DSF.KS_STATUS.draft).r;
    function ksLines(c, from, to) {
      const base = sum(c.tasks, t => t.cost);
      if (!base) return [];
      const k = c.amount / base;
      return c.tasks.map(t => { const p0 = factPct(t, from), p1 = factPct(t, to); return { task: t, p0, p1, amount: t.cost * k * (p1 - p0) / 100 }; }).filter(l => l.amount > 0.05);
    }
    const allKs = [];
    const contracts = (DSF.mergeContracts ? DSF.mergeContracts(P, S) : (P.contracts || [])).map(x => {
      const c = Object.assign({}, x);
      c.d = dn(x.date);
      // дополнительные соглашения меняют цену договора; история сохраняется
      c.base = +x.amount || 0;
      c.supp = (x.supp || []).map(a => Object.assign({}, a, { d: dn(a.date), amount: +a.amount || 0 }));
      c.amount = c.base + sum(c.supp, a => a.amount);
      c.tasks = tasks.filter(t => t.contract === c.id);
      c.frac = x.frac != null ? clamp(+x.frac, 0, 1) : fracAt(c, T);
      c.done = c.amount * c.frac;
      c.adv = x.adv || 0; c.ret = x.ret == null ? 0.05 : x.ret;
      // объективное выполнение по графику закрывается ежемесячно на 25-е число
      c.ks = [];
      let acted = 0, n = 0, prev = Math.max(c.d, has(start) ? start : c.d) - 1;
      // объекты с введёнными финансами: КС-2 только из внесённых данных, модель актов не строится
      if (entered) (x.acts || []).forEach(a => {
        n++;
        const ad = dn(a.date), st = DSF.KS_STATUS[a.status] ? a.status : 'agreed', amt = +a.amount || 0;
        const k = { id: 'ks-' + c.id + '-e' + n, no: a.no || ('КС-2 № ' + n), n, contract: c, period: monthStart(dn(a.period || a.date)), d: ad, obj: amt, claimed: +a.claimed || amt,
          accepted: KR(st) >= 5 ? (a.accepted != null && a.accepted !== '' ? +a.accepted : amt) : null, amount: KR(st) >= 6 ? amt : null, status: st, lines: [], origin: 'entered', entered: true,
          history: [{ d: ad, st, text: (DSF.KS_STATUS[st] || {}).t + (a.note ? ' — ' + a.note : ''), by: 'внесено в систему' }], note: a.note || '' };
        c.ks.push(k); acted += k.accepted != null ? k.accepted : 0; prev = Math.max(prev, ad);
      });
      for (let m = monthStart(Math.max(c.d, has(start) ? start : c.d)); !entered && m <= T; m = addMonths(m, 1)) {
        const ad = m + 24;
        if (ad > T) break;
        const v = c.amount * fracAt(c, ad) - acted;
        if (v > 0.05) {
          n++;
          const paid = ad + 30 <= T;
          const k = { id: 'ks-' + c.id + '-' + n, no: 'КС-2 № ' + n, n, contract: c, period: m, d: ad, obj: v, claimed: v, accepted: v, amount: v, status: paid ? 'paid' : 'period',
            lines: ksLines(c, prev, ad), origin: 'history', history: [
              { d: ad - 4, st: 'sent', text: 'Подрядчик направил КС-2 на проверку' },
              { d: ad - 2, st: 'accepted', text: 'Работы приняты Техническим заказчиком' },
              { d: ad, st: 'agreed', text: 'КС-2 согласована' },
              { d: ad, st: 'period', text: 'Включено в расчётный период ' + MONTHS_FULL[new Date(m * DAY).getUTCMonth()] }
            ].concat(paid ? [{ d: ad + 30, st: 'paid', text: 'Оплачено' }] : []) };
          c.ks.push(k); acted += v; prev = ad;
        }
      }
      c.lastAct = prev;
      // текущая заявка подрядчика по последнему периоду (из датасета)
      const cfg = ksCfg.get(c.id);
      if (cfg && c.ks.length && !entered) {
        const k = c.ks[c.ks.length - 1];
        k.origin = 'flow'; k.status = cfg.status;
        k.claimed = k.obj * (cfg.claimedK || 1);
        k.accepted = KR(cfg.status) >= 5 ? (cfg.status === 'rejected' ? 0 : k.obj * (cfg.acceptedK || 1)) : null;
        k.amount = KR(cfg.status) >= 6 ? k.accepted : null;
        k.history = (cfg.history || []).map(h => ({ d: dn(h.date), st: h.st, text: h.text || (DSF.KS_STATUS[h.st] || {}).t, by: h.by }));
        k.event = cfg.event || null;
        k.note = cfg.note || '';
      }
      c.ks.forEach(k => allKs.push(k));
      return c;
    });
    // заявки, созданные пользователем (подрядчиком) в демо
    S.ks.forEach(u => {
      const c = contracts.find(z => z.id === u.contract); if (!c) return;
      const k = { id: u.id, no: u.no || ('Заявка ' + u.id.split('-').pop()), n: c.ks.length + 1, contract: c, period: monthStart(dn(u.date)), d: dn(u.date), obj: u.obj, claimed: u.claimed, accepted: null, amount: null,
        status: 'draft', lines: ksLines(c, c.lastAct, T).map(l => Object.assign(l, { amount: l.amount * (u.obj / Math.max(0.0001, c.done - sum(c.ks, z => z.obj))) })), origin: 'user', user: true,
        history: [{ d: dn(u.date), st: 'draft', text: u.estimate ? 'Подрядчик сформировал КС-2 по позициям сметы' : 'Подрядчик сформировал черновик КС-2', by: u.by }], note: u.note || '',
        estimate: u.estimate || null, estLines: u.lines || null, periodTo: dn(u.periodTo), overrun: u.overrun || null };
      c.ks.push(k); allKs.push(k);
    });
    // операции по КС-2 (переходы статусов, результат приёмки)
    S.ksOps.forEach(op => {
      const k = allKs.find(z => z.id === op.ks); if (!k) return;
      k.status = op.to;
      if (op.event) k.event = op.event;
      if (op.to === 'accepted') k.accepted = k.obj;
      if (op.to === 'partial') k.accepted = Math.min(k.obj, Math.max(0, +op.accepted || 0));
      if (op.to === 'rejected') k.accepted = 0;
      if (op.to === 'sent' && k.accepted != null && KR(k.status) < 5) { k.accepted = null; k.amount = null; }
      if (op.to === 'formed') k.amount = k.accepted;
      if (op.claimed != null) k.claimed = +op.claimed;
      k.history.push({ d: dn(op.date), st: op.to, text: op.text || (DSF.KS_STATUS[op.to] || {}).t, by: op.by, note: op.note });
    });
    contracts.forEach(c => {
      c.claimed = sum(c.ks, k => k.claimed || 0);
      c.accepted = sum(c.ks, k => k.accepted || 0);
      c.ksFormed = sum(c.ks.filter(k => KR(k.status) >= 6), k => k.amount || 0);
      c.agreed = sum(c.ks.filter(k => KR(k.status) >= 7), k => k.amount || 0);
      const paidActs = sum(c.ks.filter(k => k.status === 'paid'), k => k.amount || 0);
      c.acted = sum(c.ks, k => KR(k.status) >= 5 ? (k.accepted || 0) : k.obj); // непринятая часть возвращается в «не предъявлено»
      c.unacted = Math.max(0, c.done - c.acted);
      c.pendingKs = c.ks.filter(k => KR(k.status) < 7 && k.status !== 'rejected');
      const advance = c.amount * c.adv;
      c.advance = advance;
      c.paidActs = paidActs;
      c.payments = (c.payments || []).map(p => Object.assign({}, p, { d: dn(p.date), amount: +p.amount || 0 })).sort((a, b) => a.d - b.d);
      if (entered || c.registered) {
        // оплачено = внесённые платежи; аванс и удержания не моделируются (и для договоров, зарегистрированных в системе)
        c.paid = sum(c.payments.filter(p => p.d == null || p.d <= T), p => p.amount);
        c.retained = 0;
      } else {
        c.paid = (c.amount ? advance * (1 - paidActs / c.amount) + paidActs * (1 - c.ret) : 0) + sum(c.payments.filter(p => p.user && (p.d == null || p.d <= T)), p => p.amount);
        c.retained = paidActs * c.ret;
      }
      c.left = c.amount - c.agreed;
      c.osv = c.amount > 0 ? c.accepted / c.amount * 100 : null;   // освоение = принято / актуальная стоимость договора
      c.acts = c.ks.filter(k => KR(k.status) >= 7).map(k => ({ no: k.n, date: k.d, amount: k.amount, paid: k.status === 'paid', ks: k }));
      c.state = c.frac >= 0.999 ? 'done' : c.frac > 0 ? 'active' : 'wait';
      c.planFrac = planFracAt(c, T);
    });
    const contractBy = new Map(contracts.map(c => [c.id, c]));
    items.forEach(it => {
      const cs = contracts.filter(c => c.item === it.code);
      const ts = tasks.filter(t => t.item === it.code && !t.ms);
      it.contracts = cs;
      it.tasks = ts;
      it.contracted = sum(cs, c => c.amount);
      it.done = sum(cs, c => c.done);
      it.acted = sum(cs, c => c.acted);
      it.claimed = sum(cs, c => c.claimed);
      it.accepted = sum(cs, c => c.accepted);
      it.agreed = sum(cs, c => c.agreed);
      it.paid = sum(cs, c => c.paid);
      it.taskBase = sum(ts, t => t.cost);
      const uncontracted = it.mode === 'linear' ? Math.max(0, it.budget - it.contracted) : sum(ts.filter(t => !t.contract), t => t.cost);
      it.uncontracted = uncontracted;
      it.riskCost = sum(risks.filter(r => r.realized && r.eff.item === it.code), r => r.eff.cost || 0);
      it.forecast = it.contracted + uncontracted + it.riskCost + (it.adj || 0);
      it.variance = it.forecast - it.budget;
      it.pct = ts.length ? sum(ts, t => t.cost * t.pct) / it.taskBase : (it.budget ? it.done / it.budget * 100 : 0);
    });
    const fin$ = {
      base: sum(items, i => i.budget),
      reserve: +BUDGET.reserve || 0,
      contracted: sum(items, i => i.contracted),
      done: sum(items, i => i.done),
      acted: sum(items, i => i.acted),
      claimed: sum(items, i => i.claimed),
      accepted: sum(items, i => i.accepted),
      agreed: sum(items, i => i.agreed),
      paid: sum(items, i => i.paid),
      eac: sum(items, i => i.forecast),
      riskOpenCost: sum(risks.filter(r => r.active && !r.realized), r => (r.eff.cost || 0))
    };
    fin$.approved = fin$.base + fin$.reserve;
    fin$.uncontracted = sum(items, i => i.uncontracted);
    fin$.left = fin$.approved - fin$.done;
    fin$.reserveUsed = fin$.eac - fin$.base;
    fin$.reserveLeft = fin$.approved - fin$.eac;
    fin$.reserveUsedPct = fin$.reserve ? fin$.reserveUsed / fin$.reserve * 100 : 0;
    fin$.finPct = fin$.approved ? fin$.done / fin$.approved * 100 : null;
    fin$.configured = fin$.approved > 0;
    fin$.entered = entered;
    fin$.eacDelta = fin$.eac - fin$.approved;
    fin$.state = !fin$.configured ? 'neutral' : fin$.eac > fin$.approved ? 'crit' : fin$.reserveUsedPct > 50 ? 'warn' : 'good';
    // освоение по месяцам: план, факт, прогноз (млн ₽, нарастающим итогом)
    const contractPlanAt = x => sum(contracts, c => c.amount * planFracAt(c, x)) +
      sum(tasks.filter(t => !t.contract && !t.ms), t => t.cost * planPct(t, x) / 100) +
      sum(items.filter(i => i.mode === 'linear'), i => hasSpan ? Math.max(0, i.budget - i.contracted) * clamp((x - start + 1) / (planEnd - start + 1), 0, 1) : 0);
    const contractFactAt = x => sum(contracts, c => c.amount * fracAt(c, x));
    const fcAt = x => {
      // прогноз: остаток договоров и незаконтрактованных работ по прогнозным окнам работ
      return sum(tasks.filter(t => !t.ms), t => {
        const c = t.contract && contractBy.get(t.contract);
        const k = c ? c.amount / Math.max(1, sum(c.tasks, z => z.cost)) : 1;
        return t.cost * k * forecastPct(t, x) / 100;
      }) + sum(contracts.filter(c => c.tasks.length === 0), c => has(start) && has(forecastEnd) ? c.amount * clamp((x - start + 1) / (forecastEnd - start + 1), 0, 1) : 0);
    };
    const money = [];
    for (let m = c0; hasSpan && m <= c1; m = addMonths(m, 1)) {
      const x = monthEnd(m);
      money.push({ t: x, plan: contractPlanAt(x), fact: x <= T ? contractFactAt(x) : null, fc: x >= T ? fcAt(x) : null });
    }
    fin$.planNow = contractPlanAt(T);

    /* ресурсы */
    const R = P.resources || {};
    const res = {
      weeks: (R.weeks || []).map(dn), plan: (R.plan || []).slice(), fact: (R.fact || []).slice(),
      itr: (R.itr || []).slice(),
      equipment: (R.equipment || []).map(e => Object.assign({ cat: 'Техника' }, e)),
      byContractor: (R.byContractor || []).slice(),
      kinds: (R.kinds || []).slice()
    };
    const lastOf = a => a.length ? a[a.length - 1] : null;
    res.has = res.weeks.length > 0;
    res.itrNow = lastOf(res.itr);
    res.now = lastOf(res.fact);
    res.planNowWf = lastOf(res.plan);
    res.prev = res.fact.length > 1 ? res.fact[res.fact.length - 2] : null;
    res.lastWeek = lastOf(res.weeks);
    res.equipTotal = sum(res.equipment.filter(e => e.cat !== 'Оборудование' && e.cat !== 'Прочее'), e => e.count);

    /* календарь: события графика (системные) + события проекта (датасет и пользователь) */
    const events = [];
    tasks.forEach(t => {
      if (t.ms) {
        events.push({ id: 'ms-' + t.id, sys: true, type: 'milestone', kind: t.kind || 'milestone', title: t.name, date: t.af != null ? t.af : t.ef, plan: t.f0, task: t, tasks: [t], done: t.af != null, key: !!t.key,
          desc: [t.directive != null ? 'Директивный срок: ' + fmtDate(t.directive) : '', t.comment || ''].filter(Boolean).join(' · '), directive: t.directive });
        return;
      }
      events.push({ id: 's-' + t.id, sys: true, type: 'start', title: 'Начало: ' + t.name, date: t.as != null ? t.as : t.es, plan: t.s0, task: t, tasks: [t], done: t.as != null });
      events.push({ id: 'f-' + t.id, sys: true, type: 'finish', title: 'Завершение: ' + t.name, date: t.af != null ? t.af : t.ef, plan: t.f0, task: t, tasks: [t], done: t.af != null });
    });
    // источник: датасет + записи пользователя, правки и удаления — операциями
    const evSrc = (P.events || []).map(e => Object.assign({}, e)).concat(S.events.map(e => Object.assign({ user: true }, e)));
    S.eventOps.forEach(op => {
      const e = evSrc.find(z => z.id === op.id);
      if (!e) return;
      if (op.op === 'delete') e.deleted = true;
      if (op.op === 'edit') Object.assign(e, op.patch, { edited: true });
    });
    evSrc.filter(e => !e.deleted).forEach(e => {
      const t0 = e.task ? byId.get(e.task) : null;
      let d = e.date ? dn(e.date) : null;
      if (d == null && t0) d = (e.rel === 'finish' ? (t0.af != null ? t0.af : t0.ef) : (t0.as != null ? t0.as : t0.es)) + (e.offset || 0);
      if (d == null) return;
      const ts = [...new Set([].concat(e.task ? [e.task] : [], e.tasks || []))].map(id => byId.get(id)).filter(Boolean);
      const base = {
        id: e.id, type: DSF.EVENT_TYPES[e.type] ? e.type : 'other', title: e.title, date: d, plan: null, time: e.time || '', dur: e.dur || 0,
        place: e.place || '', people: e.people || [], owner: e.owner || '', desc: e.desc || e.note || '',
        task: ts[0] || null, tasks: ts, docIds: e.docs || [], orderId: e.order || null, ksId: e.ks || null,
        user: !!e.user, edited: !!e.edited, src: e
      };
      if (e.repeat && e.repeat.every) {
        const until = dn(e.repeat.until) || T + 120;
        for (let x = d, i = 0; x <= until && i < 120; x += e.repeat.every, i++) events.push(Object.assign({}, base, { id: e.id + '@' + iso(x), series: e.id, date: x, done: x < T }));
      } else events.push(Object.assign(base, { done: d < T }));
    });

    /* фото */
    const photos = (P.photos || []).filter(p => !p.archived).map(p => Object.assign({}, p, { d: dn(p.date), taskId: p.task || null, task: byId.get(p.task) || null, stage: p.stage || (byId.get(p.task) || {}).stage || '' })).sort((a, b) => b.d - a.d);

    /* участники: организации объекта и их роли */
    const participants = DSF.participantsOf ? DSF.participantsOf(P, contracts) : [];

    /* расширения движка: документооборот, протоколы и поручения, письма */
    const ctx = { P, S, T, start, tasks, byId, stages, contracts, items, risks, events, photos, root, allKs, journal: J, control: DSF.controlOf ? DSF.controlOf(P) : {} };
    DSF.extensions.forEach(f => f(ctx));
    events.sort((a, b) => a.date - b.date || String(a.time).localeCompare(String(b.time)) || a.title.localeCompare(b.title));
    const evBy = new Map(events.map(e => [e.id, e]));

    /* лента календаря: что произошло ← сегодня → что предстоит */
    const recentFrom = T - 30, nextTo = T + 45;
    const feed = events.filter(e => e.date >= recentFrom && e.date < T).sort((a, b) => b.date - a.date || String(b.time).localeCompare(String(a.time)));
    const today = events.filter(e => e.date === T);
    const upcoming = events.filter(e => e.date > T && e.date <= nextTo);

    /* текущие и ближайшие работы */
    const current = tasks.filter(t => t.state === 'active' && !t.ms).sort((a, b) => (b.crit - a.crit) || (a.dev - b.dev));
    const next = tasks.filter(t => t.state === 'wait' && !t.ms && t.es <= T + 60).sort((a, b) => a.es - b.es);
    const msList = tasks.filter(t => t.ms);

    /* текущий этап: этап активной работы с наибольшим остатком стоимости */
    // текущий этап — тот, где сейчас сосредоточен основной объём выполняемых работ
    const vol = s => sum(s.tasks.filter(t => t.state === 'active'), t => t.cost * Math.min(t.pct, 100 - t.pct + 20));
    const act = stages.filter(s => s.state === 'active').sort((a, b) => vol(b) - vol(a));
    const phase = P.phase || (act[0] ? act[0].name : (root.actualEnd != null || P.status === 'done' ? 'Завершён' : root.pc != null && root.pc >= 99.5 ? 'Завершён' : 'Подготовка'));

    /* сводные статусы */
    const highRisks = risks.filter(r => r.active && r.level === 'high');
    const midRisks = risks.filter(r => r.active && r.level === 'mid');
    const status = {
      schedule: root.delay == null ? 'neutral' : root.delay <= 0 ? 'good' : root.delay <= 14 ? 'warn' : 'crit',
      budget: fin$.state,
      risks: highRisks.length >= 2 ? 'crit' : highRisks.length ? 'warn' : 'good'
    };
    const rank = { neutral: -1, good: 0, warn: 1, crit: 2 };
    status.overall = ['schedule', 'budget', 'risks'].map(k => status[k]).sort((a, b) => rank[b] - rank[a])[0];

    /* что требует внимания руководителя */
    const attention = [];
    (ctx.orders || []).filter(o => o.status !== 'done' && (o.status === 'overdue' || o.priority === 'critical'))
      .forEach(o => attention.push({ sev: o.status === 'overdue' ? 'crit' : 'warn', kind: 'order', order: o, text: o.text,
        meta: 'Поручение № ' + o.no + ' · ' + o.owner + ' · ' + (o.status === 'overdue' ? 'просрочено с ' + fmtDate(o.due) : 'срок ' + fmtDate(o.due)), due: o.due, go: 'orders.' + o.id }));
    tasks.filter(t => t.ms && t.directive != null && t.af == null && t.ef > t.directive).forEach(t => attention.push({ sev: 'crit', text: 'Веха «' + t.name + '»: прогноз ' + fmtDate(t.ef) + ' позже директивного срока ' + fmtDate(t.directive), meta: 'отставание ' + (t.ef - t.directive) + ' дн.', go: 'schedule', task: t, due: t.directive }));
    tasks.filter(t => t.crit && t.slip > 3 && !t.ms && t.state !== 'done').slice(0, 2).forEach(t => attention.push({ sev: t.slip > 14 ? 'crit' : 'warn', text: 'Критический путь: «' + t.name + '» — прогноз +' + t.slip + ' дн. к плану', meta: 'окончание ' + fmtDate(t.ef), go: 'schedule', task: t, due: Infinity }));
    if (fin$.configured && fin$.eac > fin$.approved) attention.push({ sev: 'crit', text: 'Прогноз стоимости превышает утверждённый бюджет на ' + fmtMoney(fin$.eacDelta), meta: 'резерв исчерпан', go: 'budget', due: Infinity });
    else if (fin$.configured && fin$.reserveUsedPct > 50) attention.push({ sev: 'warn', text: 'Использовано ' + Math.round(fin$.reserveUsedPct) + '% резерва бюджета', meta: 'остаток резерва ' + fmtMoney(fin$.reserveLeft), go: 'budget', due: Infinity });
    attention.sort((a, b) => ((a.kind === 'order' ? 0 : 1) - (b.kind === 'order' ? 0 : 1)) || (rank[b.sev] - rank[a.sev]) || ((a.due || 0) - (b.due || 0)));

    const M = {
      P, T, tasks, byId, stages, root, curve, curveT, contracts, contractBy, items, itemBy, fin: fin$, money,
      res, risks, highRisks, midRisks, events, evBy, photos, feed, today, upcoming, current, next, msList,
      phase, status, attention, finalTask: fin, ks: allKs, ksBy: new Map(allKs.map(k => [k.id, k])), store: S,
      participants, sections: DSF.sectionsOf ? DSF.sectionsOf(P) : null, readiness: RD, changes: CH.list, baselines: BLV, taskOps: S.taskOps || [], linkOps: S.linkOps || [],
      network: net, cal: CAL, critPath: tasks.filter(t => t.crit).map(t => t.id)
    };
    ['documents', 'docBy', 'orders', 'orderBy', 'protocols', 'protocolBy', 'letters', 'letterBy', 'reports', 'docCats', 'docSecNames', 'docSections',
      'journal', 'control', 'dayReports', 'remarks', 'remarkBy', 'guarantees', 'idStats'].forEach(k => { M[k] = ctx[k]; });
    // послесборочные расширения: сигналы руководителю, хронология
    (DSF.post || []).forEach(f => f(M, ctx));
    M.issues = DSF.validate(P, M);
    P.__model = M;
    return M;

    /* --- вспомогательные функции по работе --- */
    function planPct(t, x) {
      if (t.ms) return x >= t.f0 ? 100 : 0;
      if (t.planOverride != null && x === T0) return t.planOverride;
      return clamp((x - t.s0 + 1) / t.dur, 0, 1) * 100;
    }
    function factPct(t, x) {
      if (t.ms) return t.af != null && x >= t.af ? 100 : 0;
      if (t.as == null || x < t.as) return 0;
      const end = t.af != null ? t.af : T;
      if (x >= end) return t.pct;
      if (t.histCum) {
        // до начала журнала — равномерно до факта на начало журнала, далее — подтверждённые отчёты по датам
        if (x < t.histStart) return t.histStart > t.as ? t.basePct * (x - t.as + 1) / (t.histStart - t.as + 1) : t.basePct;
        let v = t.basePct; for (const e of t.histCum) { if (e[0] <= x) v = e[1]; else break; }
        return v;
      }
      return t.pct * (x - t.as + 1) / (end - t.as + 1);
    }
    function forecastPct(t, x) {
      if (x <= T) return factPct(t, x);
      if (t.done) return 100;
      if (t.ms) return x >= t.ef ? 100 : 0;
      const s = t.as != null ? T : t.es, p0 = t.as != null ? t.pct : 0;
      if (x < s) return p0;
      if (x >= t.ef) return 100;
      return p0 + (100 - p0) * (x - s + 1) / (t.ef - s + 1);
    }
    function taskStatus(t) {
      if (t.ms) return t.af != null ? { k: 'done', t: 'Достигнута', c: 'good' } : t.ef > t.f0 ? { k: 'late', t: 'Сдвиг +' + (t.ef - t.f0) + ' дн.', c: t.ef - t.f0 > 14 ? 'crit' : 'warn' } : { k: 'wait', t: 'По плану', c: 'neutral' };
      if (t.done) return t.af > t.f0 ? { k: 'done', t: 'Завершено, +' + (t.af - t.f0) + ' дн.', c: 'good' } : { k: 'done', t: 'Завершено', c: 'good' };
      if (t.flags.includes('overdue')) return { k: 'over', t: 'Просрочено', c: 'crit' };
      if (t.state === 'active') {
        if (t.slip > 14 || t.dev < -15) return { k: 'late', t: 'Отставание', c: 'crit' };
        if (t.slip > 3 || t.dev < -5) return { k: 'late', t: 'Отставание', c: 'warn' };
        return { k: 'active', t: 'В работе', c: 'accent' };
      }
      if (t.flags.includes('latestart')) return { k: 'over', t: 'Не начато в срок', c: 'crit' };
      if (t.slip > 3) return { k: 'wait', t: 'Сдвиг +' + t.slip + ' дн.', c: t.slip > 14 ? 'crit' : 'warn' };
      return { k: 'wait', t: 'Не начато', c: 'neutral' };
    }
  };

  /* ---------- проверка целостности датасета ---------- */
  DSF.validate = function (P, M) {
    const out = [];
    const T = M.T;
    const E = (m) => out.push({ level: 'error', msg: m });
    const Wn = (m) => out.push({ level: 'warn', msg: m });
    const need = ['id', 'name'];
    need.forEach(k => { if (P[k] == null) E('Нет обязательного поля «' + k + '»'); });
    const ids = new Set();
    M.tasks.forEach(t => {
      const n = '«' + t.name + '»';
      if (ids.has(t.id)) E('Повтор id работы ' + t.id); ids.add(t.id);
      if (t.s0 > t.f0) E(n + ': плановое начало позже окончания');
      if (t.ms) { if (t.af != null && t.af > T) E(n + ': веха достигнута в будущем'); return; }
      if (t.pct > 0 && t.as == null) E(n + ': есть % выполнения, но нет фактического начала');
      if (t.pct === 0 && t.as != null && t.as < T - 7) Wn(n + ': начата, но выполнение 0%');
      if (t.as != null && t.as > T) E(n + ': фактическое начало позже отчётной даты');
      if (t.af != null && t.af > T) E(n + ': фактическое окончание позже отчётной даты');
      if (t.af != null && t.pct < 100) E(n + ': есть фактическое окончание, но выполнение ' + t.pct + '%');
      if (t.pct >= 100 && t.af == null) E(n + ': выполнение 100%, но нет фактического окончания');
      if (t.af != null && t.as != null && t.af < t.as) E(n + ': окончание раньше начала');
      if (t.pct < 0 || t.pct > 100) E(n + ': % вне диапазона');
      if (t.item && !M.itemBy.has(t.item)) E(n + ': неизвестная статья бюджета ' + t.item);
      if (t.contract && !M.contractBy.has(t.contract)) E(n + ': неизвестный договор ' + t.contract);
      if (t.pct > 0 && !t.contract) (P.finance === 'entered' ? Wn : E)(n + ': работа выполняется без договора');
      if (t.qty && t.qtyFact != null && t.qtyFact > t.qty) Wn(n + ': фактический объём больше общего');
      t.deps.forEach(d => {
        if (d.bad) E(n + ': не распознана связь ' + d.id);
        else if (!M.byId.has(d.id)) E(n + ': связь с несуществующей работой ' + d.id);
        else {
          const p = M.byId.get(d.id);
          if (d.type === 'FS' && t.as != null && !p.started) Wn(n + ': начата раньше начала предшествующей «' + p.name + '»');
        }
      });
    });
    M.items.forEach(it => {
      if (it.mode === 'linear') return;
      if (it.tasks.length && it.taskBase > 0 && Math.abs(it.taskBase - it.budget) > Math.max(0.5, it.budget * 0.002)) (P.finance === 'entered' ? Wn : E)('Статья «' + it.name + '»: бюджет ' + it.budget + ' ≠ сумме стоимостей работ ' + it.taskBase.toFixed(1));
      if (!it.tasks.length && P.finance !== 'entered') Wn('Статья «' + it.name + '»: нет работ — она не попадёт в график');
    });
    M.contracts.forEach(c => {
      if (!M.itemBy.has(c.item)) E('Договор ' + c.no + ': неизвестная статья ' + c.item);
      if (c.d > T) E('Договор ' + c.no + ': дата подписания в будущем');
      const st = c.tasks.filter(t => t.as != null).map(t => t.as);
      if (st.length && Math.min(...st) < c.d) Wn('Договор ' + c.no + ': работы начаты до подписания');
      if (c.paid > c.amount + 0.01) E('Договор ' + c.no + ': оплачено больше суммы договора');
    });
    if (Math.abs(M.fin.eac - (M.fin.contracted + M.fin.uncontracted + M.items.reduce((s, i) => s + i.riskCost + (i.adj || 0), 0))) > 1) E('Бюджет не сходится: прогноз ≠ законтрактовано + незаконтрактовано + риски');
    M.risks.forEach(r => {
      if (r.eff.task && !M.byId.has(r.eff.task)) E('Риск «' + r.title + '»: неизвестная работа ' + r.eff.task);
      if (r.eff.item && !M.itemBy.has(r.eff.item)) E('Риск «' + r.title + '»: неизвестная статья ' + r.eff.item);
      if (r.realized && r.task && r.task.done) Wn('Риск «' + r.title + '» реализуется на завершённой работе');
      if (!(r.p >= 1 && r.p <= 5 && r.i >= 1 && r.i <= 5)) E('Риск «' + r.title + '»: вероятность и влияние — от 1 до 5');
    });
    (P.events || []).forEach(e => { if (e.task && !M.byId.has(e.task)) E('Событие «' + e.title + '»: неизвестная работа ' + e.task); });
    M.photos.forEach(p => {
      if (p.d > T) E('Фото «' + p.caption + '» датировано будущим');
      if (!p.task) { if (p.taskId) E('Фото «' + p.caption + '»: неизвестная работа ' + p.taskId); }
      else if (p.task.as == null || p.task.as > p.d) E('Фото «' + p.caption + '»: снято до начала работы «' + p.task.name + '»');
      else if (p.task.af != null && p.d > p.task.af + 21) Wn('Фото «' + p.caption + '» снято через 3+ недели после завершения работы');
    });
    const r = M.res;
    if (r.weeks.length !== r.plan.length || r.weeks.length !== r.fact.length) E('Ресурсы: длины рядов не совпадают');
    if (r.weeks.some(w => w > T)) E('Ресурсы: неделя в будущем');
    M.contracts.forEach(c => {
      c.ks.forEach(k => {
        if (k.accepted != null && k.accepted > k.obj + 0.01) E(c.no + ' ' + k.no + ': принято больше фактически выполненного объёма');
        if (k.amount != null && k.accepted != null && k.amount > k.accepted + 0.01) E(c.no + ' ' + k.no + ': сумма КС-2 больше принятого объёма');
        if (k.d > T) E(c.no + ' ' + k.no + ': дата в будущем');
      });
      if (c.agreed > c.accepted + 0.01) E('Договор ' + c.no + ': согласовано КС-2 больше, чем принято');
      if (c.agreed > c.amount + 0.01) E('Договор ' + c.no + ': КС-2 больше суммы договора');
      if (!M.fin.entered && c.acted > c.done + 0.5) E('Договор ' + c.no + ': предъявлено больше выполненного по графику');
    });
    (DSF.validators || []).forEach(v => v(P, M, E, Wn));
    if (!M.finalTask && M.tasks.length) Wn('Не задана финальная веха (ввод объекта) — прогноз считается по последней работе');
    if (!M.root.configured && M.tasks.some(t => !t.ms)) Wn('Правила расчёта готовности не настроены — общая готовность не рассчитывается');
    if (M.readiness.mode === 'weight') M.stages.forEach(st => { if (M.tasks.some(t => t.stage === st.name && !t.ms) && !st.tasks.some(t => t.w > 0)) Wn('Этап «' + st.name + '» не участвует в готовности: нет весов работ' + (st.weight ? '' : ' или этапа')); });
    M.tasks.filter(t => t.ms && t.directive != null && t.f0 != null && t.f0 > t.directive).forEach(t => Wn('Веха «' + t.name + '»: плановая дата позже директивного срока'));
    return out;
  };

  /* ---------- форматирование (общие) ---------- */
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function fmtDate(d) { if (d == null || !isFinite(d)) return '—'; const s = iso(d); return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4); }
  function fmtMoney(v, unit) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v), neg = v < 0 ? '−' : '';
    if (unit === 'млн' || (!unit && a < 1000)) return neg + fmtNum(a, a < 100 ? 1 : 0) + ' млн ₽';
    return neg + fmtNum(a / 1000, 2) + ' млрд ₽';
  }
  function fmtNum(v, dgt = 0) {
    if (v == null || !isFinite(v)) return '—';
    return v.toLocaleString('ru-RU', { minimumFractionDigits: dgt, maximumFractionDigits: dgt }).replace(/ /g, ' ');
  }
  DSF.fmt = { MONTHS, MONTHS_FULL, MONTHS_GEN, date: fmtDate, money: fmtMoney, num: fmtNum };
})(typeof window !== 'undefined' ? window : globalThis);
