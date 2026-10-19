/*
 * Flow — единый механизм календарно-сетевого планирования (CPM).
 *
 * Им пользуются все разделы: график и Гант, прогноз ввода, анализ влияния корректировок,
 * сигналы штаба, показатели портфеля. Другого расчёта сроков в системе нет.
 *
 * Модель связи (DSF.cpm.link):
 *   { id, pred, succ, type: 'FS'|'SS'|'FF'|'SF', lag (может быть отрицательным), calendar, active, source }
 *   source: 'import' — из исходного графика (датасет / MS Project),
 *           'manual' — установлена вручную, 'change' — из утверждённой корректировки графика.
 *
 * Календарь объекта (P.calendar):
 *   { type: '7d' }                       — непрерывный (все дни рабочие; так построены демо-датасеты);
 *   { type: '5d', holidays: ['YYYY-MM-DD', …], workdays: ['YYYY-MM-DD', …] } — пятидневка с праздниками
 *     и рабочими субботами-переносами. Длительности и лаги в таком календаре — в рабочих днях.
 *
 * Прямой проход: ES/EF с учётом всех типов связей, лагов, факта (начатые — от факт. начала,
 * завершённые — по факту), ограничений «не раньше» (плановое начало, отчётная дата, утверждённые
 * корректировки). Обратный проход: LS/LF. Полный резерв = LF − EF, свободный — по ближайшим
 * последователям. Критический путь — незавершённые работы с полным резервом ≤ 0.
 */
(function (root) {
  'use strict';
  const DSF = root.DSF = root.DSF || {};
  const DAY = 864e5;
  const dn = s => (s == null || s === '') ? null : Math.round(Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / DAY);
  const TYPES = { FS: 'Окончание → начало', SS: 'Начало → начало', FF: 'Окончание → окончание', SF: 'Начало → окончание' };

  /* ---------- календари ---------- */
  function calendar(def) {
    const c = def || {};
    if (c.type !== '5d') {
      return { type: '7d', name: 'Непрерывный (7 дней)', work: () => true,
        add: (d, n) => d + n, span: (a, b) => b - a + 1, next: d => d, prev: d => d };
    }
    const hol = new Set((c.holidays || []).map(dn)), extra = new Set((c.workdays || []).map(dn));
    const work = d => extra.has(d) || (!hol.has(d) && ((new Date(d * DAY).getUTCDay() + 6) % 7) < 5);
    const next = d => { let x = d; for (let i = 0; i < 400 && !work(x); i++) x++; return x; };
    const prev = d => { let x = d; for (let i = 0; i < 400 && !work(x); i++) x--; return x; };
    // n рабочих дней вперёд (n<0 — назад) от рабочего дня d
    const add = (d, n) => { let x = d, k = Math.abs(n), s = n < 0 ? -1 : 1; while (k > 0) { x += s; if (work(x)) k--; } return x; };
    const span = (a, b) => { if (b < a) return 0; let n = 0; for (let x = a; x <= b; x++) if (work(x)) n++; return n; };
    return { type: '5d', name: 'Пятидневка с праздниками', work, add, span, next, prev };
  }
  /* производственный календарь РФ (выходные праздничные дни и переносы) — для календаря «5d» по умолчанию */
  const RU = {
    holidays: ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08', '2025-05-01', '2025-05-02', '2025-05-08', '2025-05-09', '2025-06-12', '2025-06-13', '2025-11-03', '2025-11-04', '2025-12-31',
      '2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-02-23', '2026-03-09', '2026-05-01', '2026-05-11', '2026-06-12', '2026-11-04', '2026-12-31',
      '2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-02-22', '2027-02-23', '2027-03-08', '2027-05-03', '2027-05-10', '2027-06-14', '2027-11-04', '2027-11-05', '2027-12-31'],
    workdays: ['2025-11-01']
  };

  /* ---------- связи ---------- */
  function parseDep(s) {
    if (s && typeof s === 'object') return { id: String(s.pred || s.id), type: TYPES[s.type] ? s.type : 'FS', lag: +s.lag || 0, active: s.active !== false, source: s.source || 'import', calendar: s.calendar || null };
    const m = /^([\w.-]+)(?::(FS|SS|FF|SF)([+-]\d+)?)?$/.exec(String(s).trim());
    if (!m) return { id: String(s), type: 'FS', lag: 0, bad: true, active: true, source: 'import' };
    return { id: m[1], type: m[2] || 'FS', lag: +(m[3] || 0), active: true, source: 'import' };
  }
  const depStr = d => d.id + (d.type !== 'FS' || d.lag ? ':' + d.type + (d.lag ? (d.lag > 0 ? '+' : '') + d.lag : '') : '');

  /* ---------- проверка сети ---------- */
  function check(tasks, opt) {
    const o = opt || {};
    const byId = new Map(tasks.map(t => [t.id, t]));
    const out = { cycles: [], duplicates: [], unknown: [], openStarts: [], openEnds: [], invalid: [], self: [], links: 0, linkedTasks: 0, workTasks: 0 };
    const succ = new Map(tasks.map(t => [t.id, []]));
    tasks.forEach(t => {
      const seen = new Set();
      (t.deps || []).forEach(d => {
        if (d.active === false) return;
        if (d.bad || !byId.has(d.id)) { out.unknown.push({ task: t, ref: d.id }); return; }
        if (d.id === t.id) { out.self.push(t); return; }
        const key = d.id + '|' + d.type;
        if (seen.has(key)) out.duplicates.push({ task: t, dep: d }); else seen.add(key);
        succ.get(d.id).push(t.id); out.links++;
      });
      if (t.s0 != null && t.f0 != null && t.f0 < t.s0) out.invalid.push({ task: t, text: 'окончание раньше начала' });
      if (t.as != null && t.af != null && t.af < t.as) out.invalid.push({ task: t, text: 'фактическое окончание раньше фактического начала' });
    });
    // циклы — поиск в глубину
    const st = new Map(), stack = [];
    const dfs = id => {
      st.set(id, 1); stack.push(id);
      for (const nx of succ.get(id) || []) {
        if (st.get(nx) === 1) { const i = stack.indexOf(nx); out.cycles.push(stack.slice(i).concat(nx).map(x => byId.get(x))); }
        else if (!st.get(nx)) dfs(nx);
      }
      stack.pop(); st.set(id, 2);
    };
    tasks.forEach(t => { if (!st.get(t.id)) dfs(t.id); });
    const work = tasks.filter(t => !t.ms);
    out.workTasks = work.length;
    const finalId = o.finalId;
    const hasPred = t => (t.deps || []).some(d => d.active !== false && byId.has(d.id));
    const hasSucc = t => (succ.get(t.id) || []).length > 0;
    tasks.forEach(t => {
      const p = hasPred(t), s = hasSucc(t);
      if (p || s) out.linkedTasks++;
      if (!t.ms && !p) out.openStarts.push(t);
      if (t.id !== finalId && !s && !t.ms) out.openEnds.push(t);   // веха без последователей — контрольная точка, не разрыв сети
    });
    // начальные вехи (разрешение, поставка) без предшественников — нормальная точка входа сети
    const firstStart = Math.min(...work.map(t => t.s0).filter(v => v != null));
    out.openStarts = out.openStarts.filter(t => !(t.s0 === firstStart));
    const linkedWork = work.filter(t => hasPred(t) || hasSucc(t)).length;
    out.coverage = work.length ? linkedWork / work.length : 0;
    out.state = out.cycles.length || out.self.length ? 'error'
      : out.links === 0 ? 'none'
      : out.openEnds.filter(t => !t.done).length || out.openStarts.filter(t => !t.done && !t.started).length || out.unknown.length ? 'partial' : 'ok';
    out.succ = succ;
    return out;
  }

  /* ---------- прямой проход ---------- */
  function forward(tasks, byId, T, opt) {
    const o = opt || {}, cal = o.cal || calendar(), extra = o.extra || new Map();
    const res = new Map(), visiting = new Set(), cyc = [];
    const bound = (d, r, t) => {
      const pd = byId.get(d.id);
      // FS: начало последователя — следующий рабочий день после окончания (у вехи — в день окончания)
      if (d.type === 'FS') return { s: t.ms ? cal.add(r.ef, d.lag) : cal.add(cal.next(r.ef + 1), d.lag) };
      if (d.type === 'SS') return { s: cal.add(r.es, d.lag) };
      if (d.type === 'FF') return { f: cal.add(r.ef, d.lag) };
      if (d.type === 'SF') return { f: cal.add(r.es, d.lag) };
      return {};
    };
    function fwd(t) {
      if (res.has(t.id)) return res.get(t.id);
      if (visiting.has(t.id)) { cyc.push(t.id); return null; }
      visiting.add(t.id);
      const deps = (t.deps || []).filter(d => d.active !== false && byId.get(d.id) && d.id !== t.id).map(d => ({ d, r: fwd(byId.get(d.id)) })).filter(x => x.r);
      const ex = extra.get(t.id) || 0;
      let es, ef, sb = -Infinity, fb = -Infinity;
      deps.forEach(({ d, r }) => { const b = bound(d, r, t); if (b.s != null) sb = Math.max(sb, b.s); if (b.f != null) fb = Math.max(fb, b.f); });
      const dur = Math.max(t.ms ? 0 : 1, t.dur || 0);
      if (t.ms) {
        if (t.af != null) es = ef = t.af;
        else {
          let x = deps.length ? Math.max(sb, fb) : t.f0;
          if (!isFinite(x)) x = t.f0;
          if (t.snet != null) x = Math.max(x, t.snet);
          es = ef = Math.max(x, T) + ex;
        }
      } else if (t.done) { es = t.as; ef = t.af; }
      else if (t.as != null) {
        // начатая работа: начало — фактическое, окончание — по остатку объёма от отчётной даты
        es = t.as;
        const rem = Math.max(1, Math.ceil(dur * (1 - (t.pct || 0) / 100)));
        ef = Math.max(cal.add(cal.next(T), rem - 1), T) + ex;
        if (t.efPace != null) ef = Math.max(ef, t.efPace);
        if (isFinite(fb)) ef = Math.max(ef, fb);
        if (t.fnet != null) ef = Math.max(ef, t.fnet);
      } else {
        // не начата: не раньше плана (ограничение «начало не ранее»), отчётной даты и связей
        es = cal.next(Math.max(t.s0 != null ? t.s0 : T, T, t.snet != null ? t.snet : -Infinity, sb));
        ef = cal.add(es, dur - 1) + ex;
        if (isFinite(fb) && fb > ef) { ef = fb; es = Math.max(es, cal.add(ef, -(dur - 1))); }
        if (t.fnet != null && t.fnet > ef) { ef = t.fnet; }
      }
      if (t.fcE != null && !t.done && !(t.ms && t.af != null)) { if (t.fsE != null) es = t.fsE; ef = Math.max(t.fcE, es); }
      const r = { es, ef };
      visiting.delete(t.id);
      res.set(t.id, r);
      return r;
    }
    tasks.forEach(fwd);
    // недостижимые из-за цикла работы получают собственные сроки
    tasks.forEach(t => { if (!res.has(t.id)) res.set(t.id, { es: t.s0, ef: t.f0 }); });
    const finalId = o.finalId;
    const end = finalId && res.get(finalId) ? res.get(finalId).ef : (res.size ? Math.max(...[...res.values()].map(r => r.ef).filter(isFinite)) : null);
    return { res, end, cycles: cyc };
  }

  /* ---------- обратный проход, резервы ---------- */
  function backward(tasks, byId, res, end, opt) {
    const o = opt || {}, cal = o.cal || calendar();
    const succ = new Map(tasks.map(t => [t.id, []]));
    tasks.forEach(t => (t.deps || []).forEach(d => { if (d.active !== false && succ.has(d.id) && d.id !== t.id) succ.get(d.id).push({ t, d }); }));
    const lf = new Map(), visiting = new Set();
    function late(t) {
      if (lf.has(t.id)) return lf.get(t.id);
      if (visiting.has(t.id)) return end;
      visiting.add(t.id);
      const r = res.get(t.id), span = r.ef - r.es;
      let v = Infinity;
      const ss = succ.get(t.id);
      if (!ss.length) v = end;
      ss.forEach(({ t: s, d }) => {
        const sl = late(s), sr = res.get(s.id), sls = sl - (sr.ef - sr.es);
        // ограничения по началу не действуют, если последователь уже начат фактически
        if ((d.type === 'FS' || d.type === 'SS') && (s.as != null || (s.ms && s.af != null))) return;
        if (d.type === 'FS') v = Math.min(v, s.ms ? cal.add(sls, -d.lag) : cal.prev(cal.add(sls, -d.lag) - 1));
        else if (d.type === 'SS') v = Math.min(v, cal.add(sls, -d.lag) + span);
        else if (d.type === 'FF') v = Math.min(v, cal.add(sl, -d.lag));
        else if (d.type === 'SF') v = Math.min(v, cal.add(sl, -d.lag) + span);
      });
      if (!isFinite(v)) v = end;
      visiting.delete(t.id);
      lf.set(t.id, v);
      return v;
    }
    tasks.forEach(late);
    // свободный резерв: насколько можно задержать работу, не сдвинув ни одного последователя
    const free = new Map();
    tasks.forEach(t => {
      const r = res.get(t.id), ss = succ.get(t.id);
      let f = ss.length ? Infinity : end - r.ef;
      ss.forEach(({ t: s, d }) => {
        const sr = res.get(s.id);
        if (d.type === 'FS') f = Math.min(f, sr.es - (s.ms ? r.ef + d.lag : r.ef + 1 + d.lag));
        else if (d.type === 'SS') f = Math.min(f, sr.es - (r.es + d.lag));
        else if (d.type === 'FF') f = Math.min(f, sr.ef - (r.ef + d.lag));
        else if (d.type === 'SF') f = Math.min(f, sr.ef - (r.es + d.lag));
      });
      free.set(t.id, Math.max(0, isFinite(f) ? f : 0));
    });
    return { lf, free };
  }

  DSF.cpm = { calendar, RU, TYPES, parseDep, depStr, check, forward, backward };
})(typeof window !== 'undefined' ? window : globalThis);
