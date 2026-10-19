/*
 * Flow — реальный контур: подключение реальных объектов к единому интерфейсу.
 *
 *   рабочий модуль объекта (ogni/work.html, ramenki/work.html — ГПР, факт, суточные сводки,
 *   «Обновление данных», бюджет и КС, фото; данные и расчёты не менялись)
 *        ↓  ?headless=1 — модуль только считает модель объекта, ничего не рисует
 *   bridge.js — переводит расчётную модель объекта в модель Project Flow
 *        ↓
 *   engine.js / ui*.js — тот же рабочий стол и те же разделы, что в демо-архитектуре
 *
 * Правило: структура и алгоритм — как в демо, данные — только реальные.
 * Ничего не придумывается: нет значения в источнике — «—» / «Нет данных».
 * Демо-данные сюда не попадают: реальный контур не обращается к /api/demo и демо-датасетам.
 */
(function (root) {
  'use strict';
  const DSF = root.DSF;
  const DAY = 864e5;
  const iso = d => d == null || !isFinite(d) ? null : new Date(d * DAY).toISOString().slice(0, 10);
  const r1 = v => Math.round(v * 10) / 10;

  /* Реестр реальных объектов: где лежит рабочий модуль и обложка. Состав и названия при доступном API
     берутся из /api/projects (только status = active), иначе — этот список. */
  const REAL = [
    { id: 'ogni', name: 'БЦ «Огни»', module: 'ogni/work.html', cover: 'assets/projects/ogni-cover.png' },
    { id: 'ramenki', name: 'БЦ «Раменки»', module: 'ramenki/work.html', cover: 'assets/projects/ramenki-render.png' }
  ];

  async function projectList() {
    if (!DSF.API_BASE || !DSF.session || !DSF.session.token) return REAL;
    try {
      const rows = await DSF.api.get('/api/projects', { timeout: 6000 });
      const act = (Array.isArray(rows) ? rows : []).filter(r => !r.status || String(r.status).toLowerCase() === 'active');
      const out = act.map(r => { const loc = REAL.find(x => x.id === r.slug); return loc ? Object.assign({}, loc, { name: r.name || loc.name }) : null; }).filter(Boolean);
      return out.length ? out : REAL;
    } catch (e) { return REAL; }
  }

  function loadModule(def) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.src = def.module + '?headless=1';
      f.title = 'Источник данных: ' + def.name;
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:absolute; width:1px; height:1px; left:-9999px; top:0; border:0; visibility:hidden';
      const t0 = Date.now();
      const poll = () => {
        let w = null;
        try { w = f.contentWindow; } catch (e) { w = null; }
        const E = w && w.DSFEngine;
        if (E && E.ready) { E.ready.then(() => resolve({ def, L: E.legacy(), win: w })).catch(reject); return; }
        if (w && /login\.html/.test(String(w.location && w.location.href))) { reject(new Error('Сессия входа закончилась — войдите снова.')); return; }
        if (Date.now() - t0 > 30000) { reject(new Error('Рабочий модуль объекта «' + def.name + '» не ответил.')); return; }
        setTimeout(poll, 120);
      };
      f.addEventListener('load', poll);
      document.body.appendChild(f);
    });
  }

  /* ---------- модель рабочего модуля → Project Flow ---------- */
  function convert(def, L) {
    const { M, PROJECT, CFG } = L;
    const N = M.nodes, sn = s => L.shortName(String(s || ''));
    const T = M.T;
    // этапы → работы (дочерние строки этапа; длинные ветви ГПР сворачиваются в работу верхнего уровня)
    const groupOf = new Map();   // uid листа → id работы Flow
    const tasks = [];
    const leafSet = n => n.sm ? n.leafs : [n.u];
    const driverLeaves = new Set((M.drivers || []).map(n => n.u));
    const contractOfNode = u => {
      for (let x = N.get(u), i = 0; x && i < 80; x = N.get(x.parent), i++) {
        const c = M.contracts.find(k => (k.wbs || []).includes(x.u));
        if (c) return c.id;
      }
      return null;
    };
    L.stages.forEach(su => {
      const st = N.get(su); if (!st) return;
      const parts = st.sm && st.kids.length ? st.kids : [su];
      parts.forEach(k => {
        const n = N.get(k); if (!n || n.s0 == null || n.f0 == null) return;
        const id = 'g' + k;
        const pc = n.afE != null || n.pc >= 99.95 ? 100 : Math.min(99.9, r1(n.pc || 0));
        const done = pc >= 100;
        tasks.push({
          id, stage: sn(st.name), name: sn(n.name), ps: iso(n.s0), pf: iso(n.f0),
          as: n.asE != null ? iso(Math.min(n.asE, T)) : undefined, af: done ? iso(n.afE != null ? Math.min(n.afE, T) : Math.min(n.f0, T)) : undefined,
          pct: pc, fcStart: done ? undefined : iso(n.fs), fcEnd: done ? undefined : iso(n.ff),
          critSrc: leafSet(n).some(l => driverLeaves.has(l)), wSrc: n.W || 1, cost: 0,
          contract: contractOfNode(k) || undefined, srcUid: k, srcCode: n.code,
          qty: n.qP > 0 ? n.qP : undefined, qtyFact: n.qP > 0 && n.qF != null ? n.qF : undefined, unit: n.uom || undefined,
          comment: n.cmt || undefined
        });
        leafSet(n).forEach(l => groupOf.set(l, id));
        groupOf.set(k, id);
      });
    });
    const taskOfUid = u => { for (let x = N.get(u), i = 0; x && i < 80; x = N.get(x.parent), i++) { if (groupOf.has(x.u)) return groupOf.get(x.u); } return null; };
    // вехи объекта
    (M.ms || []).forEach((m, i) => {
      const host = m.node ? taskOfUid(m.node.u) : null;
      const hostT = tasks.find(t => t.id === host);
      tasks.push({ id: 'ms' + (i + 1), ms: true, name: m.name, stage: hostT ? hostT.stage : 'Вехи', pf: iso(m.plan), af: m.done && m.actual != null ? iso(Math.min(m.actual, T)) : undefined,
        fcEnd: m.done ? undefined : iso(m.fc), key: !!m.key, kind: 'milestone' });
    });
    // договоры: суммы в млн ₽, закрытие актами КС-2 по месяцам — как в источнике
    const contracts = M.contracts.map(c => {
      const acts = [];
      const list = (c.months && c.months.list) || [];
      const pre = c.months && c.months.pre;
      const firstYm = list.length ? list[0][0] : null;
      if (pre && pre.fact) acts.push({ no: 'Закрытие ' + (pre.label || 'до ' + firstYm), date: firstYm ? iso(Math.round(Date.parse(firstYm + '-01T00:00:00Z') / DAY) - 1) : (c.start || null), period: firstYm ? iso(Math.round(Date.parse(firstYm + '-01T00:00:00Z') / DAY) - 1) : null, amount: pre.fact, status: 'agreed', note: 'из реестра закрытия по месяцам' });
      list.forEach(([ym, , fact]) => { if (fact) acts.push({ no: 'Закрытие ' + ym.slice(5) + '.' + ym.slice(0, 4), date: ym + '-25', period: ym + '-01', amount: fact, status: 'agreed', note: 'закрытие актами КС-2 за месяц' }); });
      return {
        id: c.id, no: c.number && c.number !== '[№ договора]' ? c.number : (c.short || c.id), date: c.signDate || c.start || null, contractor: c.counterparty || '—', subject: c.subject || '',
        item: 'it-' + c.id, amount: (c.price || 0) / 1e6, adv: 0, ret: 0, frac: c.wbs && c.wbs.length ? (c.phys || 0) / 100 : null,
        acts, payments: c.paid != null ? [{ date: iso(T), amount: c.paid / 1e6, kind: 'по данным объекта' }] : []
      };
    });
    // готовность — расчёт рабочего модуля объекта (как в исходной системе), кривая — по месяцам
    const R = M.root, curve = [];
    const s0 = Math.min(...[...N.values()].filter(n => n.s0 != null).map(n => n.s0));
    const end = Math.max(R.ff, N.get(-1) ? N.get(-1).f0 : R.ff);
    for (let d = new Date(s0 * DAY), i = 0; i < 160; i++) {
      const x = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY) - 1;
      curve.push({ t: iso(x), plan: M.curve(-1, 'plan', x), fact: x <= T ? M.curve(-1, 'fact', x) : null, fc: x >= T ? M.curve(-1, 'fc', x) : null });
      if (x >= end) break;
      d = new Date((x + 1) * DAY);
    }
    curve.push({ t: iso(T), plan: R.planNow, fact: R.pc, fc: R.pc });
    curve.sort((a, b) => a.t < b.t ? -1 : 1);
    const LVL = { 'Низкая': 2, 'Низкое': 2, 'Средняя': 3, 'Среднее': 3, 'Высокая': 5, 'Высокое': 5 };
    const ST = { 'Закрыт': 'Закрыт', 'Реализуется': 'Реализуется', 'Под контролем': 'Под контролем' };
    const risks = (L.register || []).map((r, i) => ({ id: r.id || 'r' + (i + 1), title: r.name || r.title || 'Риск', cat: r.cat || '—', p: LVL[r.prob] || 1, i: LVL[r.impact] || 1,
      status: ST[r.status] || 'Открыт', owner: r.owner || '—', control: r.due || undefined, measures: r.measures ? [].concat(r.measures) : [], effect: {}, desc: r.desc || '' }));
    const events = (L.events || []).filter(e => e.date).map((e, i) => ({ id: 'ev' + (e.id || i + 1), type: 'site', title: e.title || e.name || 'Событие', date: e.date, desc: e.desc || e.comment || '' }));
    const photos = (L.photos || []).filter(p => p.src && p.date).map(p => ({ file: p.src, date: p.date, task: p.work != null ? taskOfUid(+p.work) || undefined : undefined, caption: p.caption || p.zone || 'Фото', zone: p.zone }));
    const wf = M.wf || { weeks: [], fact: [], plan: [] };
    const name = PROJECT.name || def.name;
    return {
      id: def.id, code: (name.match(/«([^»]+)»/) || [, name])[1].slice(0, 2).toUpperCase(), name, short: (name.match(/«([^»]+)»/) || [, name])[1],
      type: CFG.objectType || (/^БЦ\b/.test(name) ? 'Бизнес-центр' : ''), city: '', address: '', cover: def.cover, params: { extra: [] },
      status: 'active', source: 'legacy', module: def.module, today: iso(T), phase: L.stage || undefined,
      dates: { start: PROJECT.start, planEnd: PROJECT.planEnd },
      customer: '', gc: PROJECT.gcName || '', manager: '',
      readiness: { mode: 'external', fact: R.pc, plan: R.planNow, curve, source: L.autoModel ? 'по длительности работ ГПР — модель весов объекта не согласована' : 'по модели весов объекта' },
      finance: 'entered', budget: { reserve: 0, items: contracts.map(c => ({ code: c.item, name: c.subject ? c.subject.split(':')[0] : c.no, budget: 0 })) },
      contracts, tasks, risks, events, photos,
      resources: { weeks: wf.weeks || [], plan: (wf.plan || []).map(v => v == null ? null : v), fact: (wf.fact || []).map(v => v == null ? null : v) },
      documents: [], letters: [], protocols: [], orders: [], decisions: [], reports: [], remarks: [], ks2: [],
      legacy: {
        fileDate: PROJECT.fileDate, ganttSource: CFG.ganttSource || '', planEndLabel: CFG.planEndLabel || '', budgetNote: CFG.budgetNote || '',
        budgetTotal: M.budget ? M.budget.total : null, budget: M.budget, contracts: M.contracts.map(c => ({ id: c.id, short: c.short, counterparty: c.counterparty, number: c.number, subject: c.subject,
          price: c.price, closed: c.closed, closedPct: c.closedPct, planToDate: c.planUnknown ? null : c.planToDate, planPct: c.planUnknown ? null : c.planPct, paid: c.paid, advance: c.advance,
          closedAgainstAdvance: c.closedAgainstAdvance, retention: c.retention, presented: c.presented, phys: c.wbs && c.wbs.length ? c.phys : null, rest: c.rest, status: c.status,
          months: c.months, monthsNote: c.monthsNote || '', start: c.start, end: c.end })),
        checks: (L.checks || []).map(c => ({ ok: c.ok, t: c.t, d: c.d })), nav: CFG.navData || []
      }
    };
  }

  DSF.loadReal = async function () {
    const list = await projectList();
    const res = await Promise.allSettled(list.map(loadModule));
    const failed = [];
    res.forEach((r, i) => {
      if (r.status !== 'fulfilled') { failed.push(list[i].name + ': ' + (r.reason && r.reason.message || 'ошибка')); return; }
      try { DSF.register(convert(r.value.def, r.value.L)); }
      catch (e) { console.error(e); failed.push(list[i].name + ': не удалось прочитать модель объекта'); }
    });
    if (!DSF.projects.length) throw new Error(failed.join('; ') || 'Нет доступных объектов.');
    DSF.realFailed = failed;
    DSF.config.today = DSF.projects.map(p => p.today).filter(Boolean).sort().pop() || DSF.config.today;
    DSF.manifest = DSF.projects.map(p => p.id);
  };

  /* ---------- элементы интерфейса реального контура ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  DSF.realWorkLink = P => P.source === 'legacy' ? `<a class="nav-i" href="${esc(P.module)}" title="Рабочий модуль ввода данных объекта"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg><span class="nl">Ввод данных объекта</span></a>` : '';
  DSF.realNote = M => {
    const P = M.P; if (P.source !== 'legacy') return '';
    const L = P.legacy || {};
    return `<div class="role-note" style="margin-bottom:2px"><span><b>Реальный объект.</b> Показатели — только из данных объекта: ${esc(L.ganttSource || 'ГПР')}, срез ${esc((P.today || '').split('-').reverse().join('.'))}. Готовность — ${esc(P.readiness.source)}. Нет значения в источнике — «—».
      Ввод факта, суточных сводок, бюджета и обновление данных — <a href="${esc(P.module)}" style="color:var(--accent-2); font-weight:600">рабочий модуль объекта</a>.</span></div>`;
  };
})(typeof window !== 'undefined' ? window : globalThis);
