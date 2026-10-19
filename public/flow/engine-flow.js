/*
 * FLOW — Цифровой штаб строительства.
 * Расширение универсального движка: производственный и контрольный контур.
 *
 *  · ежедневный факт подрядчика и цепочка подтверждения (порядок ступеней задаёт администратор объекта);
 *    в график, готовность, прогноз и основание КС-2 идут только полностью подтверждённые строки;
 *  · исполнительная документация по работам и её связь с КС-2, гарантийные письма по ИД;
 *  · замечания строительного контроля;
 *  · причины отклонений и мероприятия по работам;
 *  · сигналы руководителю (что требует решения) и хронология проекта.
 *
 * Ничего не знает о конкретных объектах: всё строится из описания объекта и журнала действий.
 * Файл не трогает DOM и работает в Node для проверки данных.
 */
(function (root) {
  'use strict';
  const DSF = root.DSF;
  const { dn, iso, sum } = DSF.util;
  const F = DSF.fmt;

  /* ---------- справочники контура ---------- */
  Object.assign(DSF.EVENT_TYPES, {
    guarantee: { t: 'Срок гарантийного письма по ИД', c: 'warn' },
    remark:    { t: 'Срок устранения замечания', c: 'crit' }
  });
  DSF.REPORT_STATUS = {
    pending:   { t: 'На подтверждении', c: 'accent' },
    returned:  { t: 'Возвращён подрядчику', c: 'warn' },
    confirmed: { t: 'Подтверждён', c: 'good' }
  };
  DSF.REMARK_STATUS = {
    new:       { t: 'Выявлено', c: 'crit', who: 'tz' },
    assigned:  { t: 'Назначено', c: 'warn', who: 'gc' },
    work:      { t: 'В работе', c: 'accent', who: 'gc' },
    presented: { t: 'Предъявлено к проверке', c: 'accent', who: 'tz' },
    closed:    { t: 'Устранено и проверено', c: 'good', who: null }
  };
  DSF.REMARK_NEXT = { new: ['assigned'], assigned: ['work'], work: ['presented'], presented: ['closed', 'work'], closed: [] };
  DSF.REMARK_SEV = { critical: { t: 'Критическое', c: 'crit' }, major: { t: 'Значительное', c: 'warn' }, minor: { t: 'Малозначительное', c: 'neutral' } };
  DSF.DEV_REASONS = ['РД не передана или изменяется', 'Поставка материалов и оборудования', 'Ресурсы подрядчика', 'Замечания стройконтроля', 'Погодные условия', 'Решение заказчика', 'Смежные работы', 'Другое'];
  DSF.ID_STATE = {
    ok:      { t: 'ИД принята', c: 'good' },
    partial: { t: 'ИД принята частично', c: 'warn' },
    review:  { t: 'ИД на проверке', c: 'accent' },
    ret:     { t: 'ИД с замечаниями', c: 'warn' },
    none:    { t: 'ИД не передана', c: 'crit' },
    na:      { t: 'ИД не требуется', c: 'neutral' }
  };

  const pl = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
  DSF.plural = DSF.plural || pl;
  const chainOf = P => {
    const c = (DSF.controlOf ? DSF.controlOf(P) : {}).factChain;
    const ok = (Array.isArray(c) ? c : ['tz', 'director']).filter(s => DSF.FACT_STEPS[s]);
    return ok.length ? [...new Set(ok)] : ['tz'];
  };
  DSF.chainOf = chainOf;

  /* ====================================================================
   * ЖУРНАЛ ЕЖЕДНЕВНОГО ФАКТА
   * ==================================================================== */
  DSF.factJournal = function (P, S, T) {
    const chain = chainOf(P);
    const lineOf = l => Array.isArray(l) ? { task: l[0], v: +l[1] || 0, note: l[2] || '' } : { task: l.task, v: +l.v || 0, note: l.note || '' };
    const stepName = s => DSF.FACT_STEPS[s] || s;
    const norm = (r, user) => {
      const d = dn(r.date);
      const x = {
        id: r.id, d, org: r.org || '', by: r.by || r.org || '', user, lines: (r.lines || []).map(lineOf),
        crew: r.crew != null && r.crew !== '' ? +r.crew : null, itr: r.itr != null && r.itr !== '' ? +r.itr : null,
        note: r.note || '', photos: (r.photos || []).slice(), weather: r.weather || '',
        ok: new Set(Array.isArray(r.ok) ? r.ok : []), returned: !!r.ret, retNote: typeof r.ret === 'string' ? r.ret : '',
        sub: dn(r.sub || r.date), hist: [{ d: dn(r.sub || r.date), text: 'Подрядчик подал отчёт за ' + F.date(d), by: r.by || r.org || 'Подрядчик', st: 'sub' }]
      };
      // подтверждения из исходных данных (вымышленные): на следующий рабочий день после отчёта
      let k = 0;
      chain.forEach(s => { if (x.ok.has(s)) { k++; x.hist.push({ d: Math.min(T, d + k), text: 'Подтверждено: ' + stepName(s), by: stepName(s), st: s }); } });
      if (x.returned) x.hist.push({ d: Math.min(T, d + 1), text: 'Возвращено подрядчику' + (x.retNote ? ': ' + x.retNote : ''), by: stepName(chain[0]), st: 'ret' });
      return x;
    };
    const reps = (P.reports || []).map(r => norm(r, false)).concat((S.reports || []).map(r => norm(r, true)));
    const byId = new Map(reps.map(r => [r.id, r]));
    (S.reportOps || []).forEach(op => {
      const r = byId.get(op.rep); if (!r) return;
      const d = dn(op.date) || T;
      if (op.op === 'confirm') {
        r.ok.add(op.step);
        let adj = false;
        if (op.adj) r.lines.forEach(l => { if (op.adj[l.task] != null && +op.adj[l.task] !== l.v) { if (l.orig == null) l.orig = l.v; l.v = +op.adj[l.task]; adj = true; } });
        r.hist.push({ d, text: 'Подтверждено: ' + stepName(op.step) + (adj ? ', с корректировкой объёмов' : '') + (op.comment ? ' — ' + op.comment : ''), by: op.by || stepName(op.step), st: op.step });
      }
      if (op.op === 'return') { r.ok.clear(); r.returned = true; r.retNote = op.comment || ''; r.hist.push({ d, text: 'Возвращено подрядчику' + (op.comment ? ': ' + op.comment : ''), by: op.by || stepName(op.step), st: 'ret' }); }
      // корректировка уполномоченным: исправление объёмов, даты или отмена ошибочного отчёта (история сохраняется)
      if (op.op === 'correct') {
        if (op.lines) { r.lines.forEach(l => { if (l.orig == null) l.orig = l.v; }); r.lines = op.lines.map(lineOf); }
        if (op.newDate) { r.hist.push({ d, text: 'Дата отчёта исправлена: ' + F.date(r.d) + ' → ' + F.date(dn(op.newDate)), by: op.by, st: 'fix' }); r.d = dn(op.newDate); }
        r.hist.push({ d, text: 'Корректировка объёмов' + (op.comment ? ' — ' + op.comment : ''), by: op.by, st: 'fix' }); r.corrected = true;
      }
      if (op.op === 'cancel') { r.canceled = true; r.hist.push({ d, text: 'Отчёт отменён как ошибочный' + (op.comment ? ' — ' + op.comment : ''), by: op.by, st: 'cancel' }); }
      if (op.op === 'resubmit') {
        r.ok.clear(); r.returned = false; r.sub = d;
        if (op.lines) r.lines = op.lines.map(lineOf);
        if (op.crew != null) r.crew = +op.crew;
        if (op.note != null) r.note = op.note;
        r.hist.push({ d, text: 'Исправлено и направлено повторно', by: op.by || r.org, st: 'sub' });
      }
    });
    const byTask = new Map(), pend = new Map();
    reps.forEach(r => {
      r.chain = chain;
      r.next = r.returned ? null : chain.find(s => !r.ok.has(s)) || null;
      r.status = r.canceled ? 'canceled' : r.returned ? 'returned' : r.next ? 'pending' : 'confirmed';
      if (r.canceled) r.next = null;
      r.done = chain.filter(s => r.ok.has(s)).length;
      r.lastD = Math.max(...r.hist.map(h => h.d));
      r.wait = r.status === 'pending' ? T - r.lastD : 0;
      r.hist.sort((a, b) => a.d - b.d);
      if (r.status === 'confirmed') r.lines.forEach(l => { if (!l.v) return; (byTask.get(l.task) || byTask.set(l.task, []).get(l.task)).push({ d: r.d, v: l.v, rep: r.id }); });
      if (r.status === 'pending') r.lines.forEach(l => { if (!l.v) return; const p = pend.get(l.task) || { v: 0, n: 0, step: r.next }; p.v += l.v; p.n++; pend.set(l.task, p); });
    });
    byTask.forEach((list, k) => {
      list.sort((a, b) => a.d - b.d);
      const m = []; list.forEach(e => { const last = m[m.length - 1]; if (last && last.d === e.d) last.v += e.v; else m.push({ d: e.d, v: e.v }); });
      byTask.set(k, m);
    });
    reps.sort((a, b) => b.d - a.d || String(a.org).localeCompare(String(b.org)));
    return { chain, reports: reps, byId, byTask, pend };
  };

  /* ====================================================================
   * РАСШИРЕНИЕ СБОРКИ: ИД, гарантийные письма, замечания, отчёты, причины
   * ==================================================================== */
  DSF.extensions.push(function flow(ctx) {
    const { P, S, T, tasks, byId, events, allKs } = ctx;
    const C = ctx.control || DSF.CONTROL_DEFAULTS;
    const docs = ctx.documents || [];
    const contractorOf = t => { const c = t && t.contract && ctx.contracts.find(z => z.id === t.contract); return c ? c.contractor : (t && t.org) || (P.gc || ''); };

    /* --- исполнительная документация по работам --- */
    tasks.forEach(t => {
      // исполнительная документация: акты, схемы, протоколы (предписания и отчёты в разделе «ОТЧ» — не ИД)
      t.idDocs = docs.filter(d => d.cat === 'id' && d.section !== 'ОТЧ' && d.taskIds.includes(t.id));
      // ИД обязательна для строительно-монтажных работ (не для проектирования и услуг)
      t.idReq = !t.ms && t.weighted && C.idRequired !== false && t.idReq !== false;
      const acc = t.idDocs.filter(d => d.state === 'ok' || d.state === 'prod');
      t.idAcc = acc.length; t.idTotal = t.idDocs.length;
      t.idState = !t.idReq ? 'na' : !t.idDocs.length ? 'none' : acc.length === t.idDocs.length ? 'ok'
        : t.idDocs.some(d => d.state === 'ret') ? 'ret' : t.idDocs.some(d => d.state === 'rev' || d.state === 'up') ? (acc.length ? 'partial' : 'review') : acc.length ? 'partial' : 'none';
      t.contractor = contractorOf(t);
    });
    const idWorks = tasks.filter(t => t.idReq && (t.pct > 0 || t.idDocs.length));
    const idDocsAll = docs.filter(d => d.cat === 'id' && d.section !== 'ОТЧ');
    ctx.idStats = {
      works: idWorks.length, worksOk: idWorks.filter(t => t.idState === 'ok').length, worksMissing: idWorks.filter(t => t.idState !== 'ok' && t.pct > 0).length,
      required: idDocsAll.length, prepared: idDocsAll.filter(d => d.versions.length).length, review: idDocsAll.filter(d => d.state === 'rev' || d.state === 'up').length,
      ret: idDocsAll.filter(d => d.state === 'ret').length, ok: idDocsAll.filter(d => d.state === 'ok' || d.state === 'prod').length,
      overdue: idDocsAll.filter(d => d.due != null && d.due < T && !(d.state === 'ok' || d.state === 'prod')).length
    };

    /* --- причины отклонений и мероприятия (записи пользователя) --- */
    tasks.forEach(t => { t.notes = (S.notes || []).filter(n => n.task === t.id).map(n => Object.assign({}, n, { d: dn(n.date), dueD: dn(n.due) })).sort((a, b) => b.d - a.d); });

    /* --- замечания строительного контроля --- */
    const rraw = (P.remarks || []).map(r => Object.assign({}, r)).concat((S.remarks || []).map(r => Object.assign({ user: true }, r)));
    const remarks = rraw.map(r => {
      const x = {
        id: r.id, no: r.no || r.id, title: r.title || '', desc: r.desc || '', loc: r.loc || '', task: byId.get(r.task) || null, taskId: r.task || null,
        sev: DSF.REMARK_SEV[r.sev] ? r.sev : 'major', org: r.org || contractorOf(byId.get(r.task)), owner: r.owner || '', by: r.by || P.supervisor || 'Строительный контроль',
        d: dn(r.date), due: dn(r.due), status: DSF.REMARK_STATUS[r.status] ? r.status : 'new', closedD: dn(r.closed), photos: (r.photos || []).slice(), after: (r.after || []).slice(),
        doc: r.doc || null, norm: r.norm || '', user: !!r.user, comment: r.comment || '',
        contractId: r.contract || null, noContractReason: r.noContractReason || '', workType: r.workType || null
      };
      if (!x.contractId && x.task && x.task.contract && !r.noContractReason) x.contractId = x.task.contract;
      x.contract = x.contractId ? (P.contracts || []).find(c => c.id === x.contractId) || null : null;
      if (!x.workType && x.task) x.workType = x.task.workType || x.task.item || null;
      const wts = (P.workTypes && P.workTypes.length ? P.workTypes : (P.budget && P.budget.items || []).map(i => ({ id: i.code, name: i.name })));
      x.workTypeName = x.workType ? ((wts.find(w => w.id === x.workType) || {}).name || x.workType) : '';
      x.hist = [{ d: x.d, text: 'Замечание выдано' + (x.by ? ': ' + x.by : ''), st: 'new' }];
      if (['assigned', 'work', 'presented', 'closed'].includes(x.status) && !x.user) x.hist.push({ d: Math.min(T, x.d + 1), text: 'Назначено: ' + x.org + (x.owner ? ', ' + x.owner : ''), st: 'assigned' });
      if (['work', 'presented', 'closed'].includes(x.status) && !x.user) x.hist.push({ d: Math.min(T, x.d + 2), text: 'Принято в работу подрядчиком', st: 'work' });
      if (['presented', 'closed'].includes(x.status) && !x.user) x.hist.push({ d: Math.min(T, x.closedD != null ? x.closedD - 1 : x.d + 4), text: 'Подрядчик предъявил устранение', st: 'presented' });
      if (x.status === 'closed' && !x.user) x.hist.push({ d: x.closedD != null ? x.closedD : Math.min(T, x.d + 5), text: 'Устранение проверено, замечание закрыто', st: 'closed' });
      return x;
    });
    const remarkBy = new Map(remarks.map(r => [r.id, r]));
    (S.remarkOps || []).forEach(op => {
      const r = remarkBy.get(op.rem); if (!r) return;
      const d = dn(op.date) || T;
      if (op.op === 'status') {
        r.status = op.to;
        if (op.org) r.org = op.org;
        if (op.owner) r.owner = op.owner;
        if (op.due) r.due = dn(op.due);
        if (op.after && op.after.length) r.after = r.after.concat(op.after);
        if (op.to === 'closed') r.closedD = d;
        const T2 = { assigned: 'Назначено: ' + r.org + (r.owner ? ', ' + r.owner : '') + (op.due ? ', срок ' + F.date(dn(op.due)) : ''), work: op.back ? 'Возвращено на доработку' : 'Принято в работу подрядчиком', presented: 'Подрядчик предъявил устранение', closed: 'Устранение проверено, замечание закрыто' };
        r.hist.push({ d, text: (T2[op.to] || DSF.REMARK_STATUS[op.to].t) + (op.comment ? ' — ' + op.comment : ''), by: op.by, st: op.to });
      }
      if (op.op === 'comment') r.hist.push({ d, text: 'Комментарий: ' + op.comment, by: op.by, st: 'comment' });
    });
    remarks.forEach(r => {
      r.open = r.status !== 'closed';
      r.overdue = r.open && r.due != null && r.due < T;
      r.age = r.open ? T - r.d : null;
      r.fixDays = !r.open && r.closedD != null ? r.closedD - r.d : null;
      r.hist.sort((a, b) => a.d - b.d);
      if (r.open && r.due != null && (r.sev === 'critical' || r.overdue)) events.push({ id: 'rm-' + r.id, sys: true, type: 'remark', title: 'Устранить замечание № ' + r.no + ': ' + r.title, date: r.due, plan: r.due, time: '', place: r.loc, people: [r.org], owner: r.org, desc: r.desc, task: r.task, tasks: r.task ? [r.task] : [], docIds: r.doc ? [r.doc] : [], done: false, remarkId: r.id });
    });
    tasks.forEach(t => { t.remarks = remarks.filter(r => r.task === t); t.remarksOpen = t.remarks.filter(r => r.open); });
    remarks.sort((a, b) => (b.open - a.open) || (b.overdue - a.overdue) || ((a.sev === 'critical' ? 0 : 1) - (b.sev === 'critical' ? 0 : 1)) || (b.d - a.d));
    ctx.remarks = remarks; ctx.remarkBy = remarkBy;

    /* --- гарантийные письма по ИД --- */
    const guarantees = (ctx.letters || []).filter(l => l.kind === 'guarantee');
    guarantees.forEach(l => {
      l.due = dn(l.dueDate);
      l.gTasks = l.taskIds.map(id => byId.get(id)).filter(Boolean);
      l.fulfilled = !!l.gTasks.length && l.gTasks.every(t => t.idState === 'ok' || t.idState === 'na');
      l.gStatus = l.fulfilled ? 'done' : l.due != null && l.due < T ? 'overdue' : 'active';
      l.ksObj = l.ks ? allKs.find(k => k.id === l.ks) || null : null;
      if (l.ksObj) l.ksObj.guarantee = l;
      if (l.due != null) events.push({ id: 'gl-' + l.id, sys: true, type: 'guarantee', title: 'Гарантийное письмо ' + l.no + ': передать ИД' + (l.ksObj ? ' по ' + l.ksObj.contract.no + ' · ' + l.ksObj.no : ''), date: l.due, plan: l.due, time: '', place: '', people: [l.from], owner: l.from, desc: l.subject, task: l.gTasks[0] || null, tasks: l.gTasks, docIds: [], done: l.fulfilled, gStatus: l.gStatus, letterId: l.id });
    });
    ctx.guarantees = guarantees;

    /* --- КС-2: ИД и замечания по работам заявки --- */
    allKs.forEach(k => {
      const ts = [...new Set((k.lines || []).map(l => l.task))];
      k.works = ts;
      k.idMissing = C.idRequired !== false ? ts.filter(t => t.idReq && t.idState !== 'ok') : [];
      k.remarksOpen = remarks.filter(r => r.open && r.task && ts.includes(r.task));
    });

    /* --- ежедневные отчёты: ссылки на работы --- */
    const J = ctx.journal;
    ctx.dayReports = J ? J.reports : [];
    ctx.dayReports.forEach(r => r.lines.forEach(l => { l.t = byId.get(l.task) || null; }));
  });

  /* ====================================================================
   * ПРИЧИНЫ ОТКЛОНЕНИЯ РАБОТЫ — из связей, без ручного ввода
   * ==================================================================== */
  DSF.causesOf = function (M, t) {
    const out = [];
    if (!t || t.ms) return out;
    const rds = (M.documents || []).filter(d => d.cat === 'rd' && d.taskIds.includes(t.id));
    rds.forEach(d => {
      if (!d.prod && d.state !== 'ann') out.push({ k: 'rd', sev: 'crit', text: 'РД ' + d.code + ' не передана в производство (' + DSF.docStatusLabel(d, d.state).toLowerCase() + ')', go: 'docs.' + d.id });
      else if (d.cur && d.prod && d.cur !== d.prod && ['up', 'rev', 'ret'].includes(d.cur.status)) out.push({ k: 'rd', sev: 'warn', text: 'Новая редакция РД ' + d.code + ' (ред. ' + d.cur.rev + ') — ' + DSF.docStatusLabel(d, d.cur.status).toLowerCase() + ' с ' + F.date(d.cur.d), go: 'docs.' + d.id });
    });
    if (t.pace && t.pace.ratio != null && t.pace.ratio < 0.95 && t.pace.days >= 3) out.push({ k: 'pace', sev: t.pace.ratio < 0.8 ? 'crit' : 'warn', text: 'Темп ' + Math.round(t.pace.ratio * 100) + '% от требуемого за 14 дней' + (t.efPace ? ' — при текущем темпе окончание ' + F.date(t.efPace) : ''), go: 'production' });
    const ro = (t.remarksOpen || []);
    if (ro.length) out.push({ k: 'remarks', sev: ro.some(r => r.sev === 'critical' || r.overdue) ? 'crit' : 'warn', text: ro.length + ' ' + pl(ro.length, 'открытое замечание', 'открытых замечания', 'открытых замечаний') + ' стройконтроля' + (ro.some(r => r.overdue) ? ', есть просроченные' : ''), go: 'quality' });
    (M.risks || []).filter(r => r.active && r.eff.task === t.id).forEach(r => out.push({ k: 'risk', sev: r.realized ? 'crit' : 'warn', text: (r.realized ? 'Реализуется риск: ' : 'Риск: ') + r.title + (r.eff.days ? ' (+' + r.eff.days + ' дн.)' : ''), go: 'risks' }));
    (M.orders || []).filter(o => o.status !== 'done' && o.taskIds.includes(t.id)).forEach(o => out.push({ k: 'order', sev: o.status === 'overdue' ? 'crit' : 'neutral', text: 'Поручение № ' + o.no + ': ' + o.text + (o.status === 'overdue' ? ' — просрочено' : ''), go: 'orders.' + o.id }));
    if (t.pend && t.pend.v) out.push({ k: 'pend', sev: 'neutral', text: 'Ещё не подтверждено: ' + F.num(t.pend.v, 1) + ' ' + (t.qty ? (t.unit || '') : 'п.п.') + ' в ' + t.pend.n + ' ' + pl(t.pend.n, 'отчёте', 'отчётах', 'отчётах'), go: 'production' });
    (t.notes || []).slice(0, 1).forEach(n => out.push({ k: 'note', sev: 'neutral', text: 'Причина по данным участника: ' + n.reason + (n.text ? ' — ' + n.text : ''), go: null }));
    return out;
  };

  /* ====================================================================
   * ПОСЛЕ СБОРКИ: сигналы руководителю и хронология
   * ==================================================================== */
  DSF.post = DSF.post || [];
  DSF.post.push(function signals(M) {
    const C = M.control || DSF.CONTROL_DEFAULTS, T = M.T, out = [];
    const add = (key, sev, area, title, cause, owner, go, extra) => out.push(Object.assign({ key, sev, area, title, cause: cause || '', owner: owner || '', go: go || null }, extra || {}));
    const dd = n => n + ' ' + (Math.abs(n) % 10 === 1 && Math.abs(n) % 100 !== 11 ? 'день' : [2, 3, 4].includes(Math.abs(n) % 10) && ![12, 13, 14].includes(Math.abs(n) % 100) ? 'дня' : 'дней');
    const causeText = t => DSF.causesOf(M, t).filter(c => c.k !== 'pend' && c.k !== 'note').slice(0, 2).map(c => c.text).join('; ');
    // Срок: работы критического пути со сдвигом и вехи позже директивного срока
    M.tasks.filter(t => !t.ms && !t.done && t.crit && t.slip >= C.slipDays).sort((a, b) => b.slip - a.slip).slice(0, 3)
      .forEach(t => add('slip:' + t.id, t.slip > 14 ? 'crit' : 'warn', 'Срок', '«' + t.name + '»: прогноз +' + dd(t.slip) + ' к плану, критический путь', causeText(t) || 'прогноз окончания ' + F.date(t.ef), t.contractor, 'schedule', { task: t, days: t.slip }));
    M.tasks.filter(t => t.ms && t.directive != null && t.af == null && t.ef > t.directive)
      .forEach(t => add('ms:' + t.id, 'crit', 'Срок', 'Веха «' + t.name + '»: прогноз ' + F.date(t.ef) + ' позже директивного срока ' + F.date(t.directive), 'отставание ' + dd(t.ef - t.directive), '', 'schedule', { task: t, days: t.ef - t.directive }));
    // Производство: темп ниже требуемого
    M.tasks.filter(t => t.pace && t.pace.ratio != null && t.pace.days >= 6 && t.pace.ratio < (C.paceMin || 80) / 100 && !(t.crit && t.slip >= C.slipDays))
      .sort((a, b) => a.pace.ratio - b.pace.ratio).slice(0, 3)
      .forEach(t => add('pace:' + t.id, t.pace.ratio < 0.6 ? 'crit' : 'warn', 'Производство', '«' + t.name + '»: темп ' + Math.round(t.pace.ratio * 100) + '% от требуемого', t.efPace ? 'при текущем темпе окончание ' + F.date(t.efPace) + ' вместо ' + F.date(t.f0) : 'за 14 дней', t.contractor, 'production', { task: t }));
    // Производство: отчёты ждут подтверждения
    const waits = (M.dayReports || []).filter(r => r.status === 'pending' && r.wait >= (C.confirmDays || 2));
    const byStep = {}; waits.forEach(r => { (byStep[r.next] = byStep[r.next] || []).push(r); });
    Object.entries(byStep).forEach(([s, list]) => add('confirm:' + s + ':' + Math.min(...list.map(r => r.d)), 'warn', 'Производство', list.length + ' ' + pl(list.length, 'отчёт ждёт', 'отчёта ждут', 'отчётов ждут') + ' подтверждения: ' + DSF.FACT_STEPS[s], 'самый ранний — за ' + F.date(Math.min(...list.map(r => r.d))) + '; неподтверждённый факт не идёт в график и КС-2', DSF.FACT_STEPS[s], 'production'));
    // Деньги: КС-2 ждёт действия
    (M.ks || []).filter(k => { const r = (DSF.KS_STATUS[k.status] || {}).r; return r != null && r >= 1 && r < 7 && k.status !== 'rejected'; }).forEach(k => {
      const last = Math.max(...k.history.map(h => h.d).filter(isFinite)); const wait = T - last;
      if (wait >= (C.ksDays || 5)) add('ks:' + k.id, 'warn', 'Деньги', k.contract.no + ' · ' + k.no + ': «' + (DSF.KS_STATUS[k.status] || {}).t + '» уже ' + dd(wait), 'заявлено ' + F.money(k.claimed), k.contract.contractor, 'budget.' + k.id);
    });
    // Документы: КС-2 без принятой ИД и гарантийные письма
    (M.ks || []).filter(k => { const r = (DSF.KS_STATUS[k.status] || {}).r; return r >= 1 && r < 8 && k.status !== 'rejected' && (k.idMissing || []).length; }).forEach(k => {
      const g = k.guarantee;
      add('ksid:' + k.id, g && g.gStatus === 'overdue' ? 'crit' : g ? 'neutral' : 'warn', 'Документы', k.contract.no + ' · ' + k.no + ': не принята ИД по ' + k.idMissing.length + ' ' + pl(k.idMissing.length, 'работе', 'работам', 'работам'), g ? 'гарантийное письмо ' + g.no + ' — срок ' + F.date(g.due) + (g.gStatus === 'overdue' ? ', просрочено' : '') : 'гарантийного письма нет', k.contract.contractor, 'budget.' + k.id);
    });
    (M.guarantees || []).filter(g => g.gStatus === 'overdue' && !(g.ksObj && (g.ksObj.idMissing || []).length && (DSF.KS_STATUS[g.ksObj.status] || {}).r < 8))
      .forEach(g => add('gl:' + g.id, 'crit', 'Документы', 'Просрочено гарантийное письмо ' + g.no + ' по ИД', 'срок ' + F.date(g.due), g.from, 'docs.' + g.id));
    // Документы: РД к началу работ
    M.tasks.filter(t => !t.ms && t.state === 'wait' && t.es <= T + (C.rdDays || 14)).forEach(t => {
      const rds = (M.documents || []).filter(d => d.cat === 'rd' && d.taskIds.includes(t.id));
      if (rds.length && !rds.some(d => d.prod)) add('rd:' + t.id, t.es <= T + 3 ? 'crit' : 'warn', 'Документы', 'РД для «' + t.name + '» не передана в производство', 'начало работ по прогнозу ' + F.date(t.es), P_designer(M), 'docs.' + rds[0].id, { task: t });
    });
    // Качество
    const rem = M.remarks || [];
    const crit = rem.filter(r => r.open && r.sev === 'critical'), over = rem.filter(r => r.overdue);
    if (crit.length) add('rmc:' + crit.map(r => r.id).join(','), 'crit', 'Качество', crit.length + ' ' + pl(crit.length, 'критическое замечание не устранено', 'критических замечания не устранены', 'критических замечаний не устранены'), crit.slice(0, 2).map(r => '№ ' + r.no + ' ' + r.title).join('; '), [...new Set(crit.map(r => r.org))].join(', '), 'quality');
    if (over.length) add('rmo:' + over.map(r => r.id).join(','), 'warn', 'Качество', over.length + ' ' + pl(over.length, 'замечание просрочено', 'замечания просрочены', 'замечаний просрочены'), 'подрядчики: ' + [...new Set(over.map(r => r.org))].join(', '), '', 'quality');
    // Деньги: бюджет
    const f = M.fin;
    if (f.configured && f.eac > f.approved) add('eac', 'crit', 'Деньги', 'Прогноз стоимости выше бюджета на ' + F.money(f.eacDelta), 'резерв исчерпан', '', 'budget');
    else if (f.configured && f.reserveUsedPct > 50) add('reserve', 'warn', 'Деньги', 'Использовано ' + Math.round(f.reserveUsedPct) + '% резерва бюджета', 'остаток резерва ' + F.money(f.reserveLeft), '', 'budget');
    // Поручения
    (M.orders || []).filter(o => o.status === 'overdue').forEach(o => add('ord:' + o.id, o.priority === 'critical' ? 'crit' : 'warn', 'Поручения', 'Просрочено поручение № ' + o.no + ': ' + o.text, 'срок ' + F.date(o.due), o.owner, 'orders.' + o.id));
    // Риски: реализующиеся высокие
    (M.risks || []).filter(r => r.realized && r.level === 'high').forEach(r => add('risk:' + r.id, 'crit', 'Риски', 'Реализуется риск: ' + r.title, (r.eff.days ? '+' + dd(r.eff.days) + ' к работе' : '') + (r.eff.cost ? (r.eff.days ? ', ' : '') + '+' + F.money(r.eff.cost) : ''), r.owner, 'risks'));

    // решения по сигналам (журнал действий)
    const dec = new Map(); ((M.store && M.store.decisions) || []).forEach(x => dec.set(x.key, Object.assign({}, x, { d: dn(x.date) })));
    out.forEach(s => { s.decision = dec.get(s.key) || null; });
    const rank = { crit: 0, warn: 1, neutral: 2 };
    out.sort((a, b) => (rank[a.sev] - rank[b.sev]));
    M.signals = out;
    M.signalsOpen = out.filter(s => !s.decision);
    M.decisionLog = [...dec.values()].sort((a, b) => b.d - a.d);
  });
  const P_designer = M => M.P.designer || '';

  DSF.post.push(function timeline(M) {
    const T = M.T, from = T - 120, out = [];
    const add = (d, kind, text, meta, go, sev) => { if (d != null && isFinite(d) && d >= from && d <= T) out.push({ d, kind, text, meta: meta || '', go: go || null, sev: sev || 'neutral' }); };
    // ежедневный факт — сводно по дням: подано, подтверждено по ступеням; возвраты — отдельно
    const agg = new Map();
    (M.dayReports || []).forEach(r => r.hist.forEach(h => {
      if (h.st === 'ret') { add(h.d, 'fact', 'Отчёт за ' + F.date(r.d) + ' возвращён подрядчику', r.org + (r.retNote ? ' · ' + r.retNote : ''), 'production.' + r.id, 'warn'); return; }
      const k = h.d + '|' + h.st; const a = agg.get(k) || { d: h.d, st: h.st, orgs: new Set(), n: 0 }; a.n++; a.orgs.add(r.org); agg.set(k, a);
    }));
    agg.forEach(a => add(a.d, 'fact', a.st === 'sub' ? 'Подано ежедневных отчётов: ' + a.n : 'Подтверждено отчётов (' + (DSF.FACT_STEPS[a.st] || a.st) + '): ' + a.n, [...a.orgs].slice(0, 3).join(', ') + (a.orgs.size > 3 ? ' и ещё ' + (a.orgs.size - 3) : ''), 'production', a.st === 'sub' ? 'neutral' : 'good'));
    (M.ks || []).forEach(k => (k.origin === 'history' ? k.history.filter(h => h.st === 'period') : k.history).forEach(h => add(h.d, 'ks', k.contract.no + ' · ' + k.no + ': ' + (h.text || (DSF.KS_STATUS[h.st] || {}).t || ''), [h.by, h.note].filter(Boolean).join(' · '), 'budget.' + k.id, ['rejected', 'remarks', 'partial'].includes(h.st) ? 'warn' : ['agreed', 'paid', 'accepted'].includes(h.st) ? 'good' : 'neutral')));
    (M.documents || []).filter(d => !d.auto).forEach(d => d.versions.forEach(v => (v.history || []).forEach(h => add(h.d, 'doc', d.code + ' ред. ' + v.rev + ': ' + h.text, d.title, 'docs.' + d.id, h.st === 'ret' ? 'warn' : h.st === 'prod' || h.st === 'ok' ? 'good' : 'neutral'))));
    (M.remarks || []).forEach(r => r.hist.forEach(h => add(h.d, 'remark', 'Замечание № ' + r.no + ': ' + h.text, r.title + (r.org ? ' · ' + r.org : ''), 'quality.' + r.id, h.st === 'new' ? (r.sev === 'critical' ? 'crit' : 'warn') : h.st === 'closed' ? 'good' : 'neutral')));
    (M.orders || []).forEach(o => o.history.forEach(h => add(h.d, 'order', 'Поручение № ' + o.no + ': ' + h.text, o.text, 'orders.' + o.id, /Выполнено/.test(h.text) ? 'good' : 'neutral')));
    (M.guarantees || []).forEach(g => { add(g.d, 'guarantee', 'Гарантийное письмо ' + g.no + ' по ИД, срок ' + F.date(g.due), g.from, 'docs.' + g.id, 'warn'); if (g.gStatus === 'overdue') add(g.due, 'guarantee', 'Просрочено гарантийное письмо ' + g.no, g.from, 'docs.' + g.id, 'crit'); });
    (M.decisionLog || []).forEach(x => add(x.d, 'decision', 'Решение руководителя: ' + ({ ack: 'принято к сведению', risk: 'создан риск', order: 'поставлено поручение' }[x.act] || x.act) + ' — ' + x.title, x.comment || x.by || '', null, 'neutral'));
    (M.P.decisions || []).forEach(x => add(dn(x.date), 'decision', 'Решение: ' + x.title, x.by, 'risks', 'neutral'));
    M.tasks.forEach(t => {
      if (t.ms) { if (t.af != null) add(t.af, 'ms', 'Достигнута веха «' + t.name + '»', t.directive != null ? 'директивный срок ' + F.date(t.directive) : '', 'schedule', 'good'); return; }
      if (t.as != null) add(t.as, 'work', 'Начата работа «' + t.name + '»', t.stage, 'schedule', 'neutral');
      if (t.af != null) add(t.af, 'work', 'Завершена работа «' + t.name + '»', t.stage, 'schedule', 'good');
    });
    (M.risks || []).forEach(r => add(dn(r.since), 'risk', (r.kind === 'issue' ? 'Проблемный вопрос: ' : 'Новый риск: ') + r.title, r.owner, 'risks', r.realized ? 'crit' : 'warn'));
    const ph = {}; (M.photos || []).forEach(p => { if (p.d >= from) (ph[p.d] = ph[p.d] || []).push(p); });
    Object.entries(ph).forEach(([d, list]) => add(+d, 'photo', 'Фотофиксация: ' + list.map(p => p.caption).slice(0, 2).join('; ') + (list.length > 2 ? ' и ещё ' + (list.length - 2) : ''), list.length + ' фото', 'photos', 'neutral'));
    out.sort((a, b) => b.d - a.d);
    M.timeline = out;
  });

  /* ---------- проверки целостности контура ---------- */
  DSF.validators = DSF.validators || [];
  DSF.validators.push(function (P, M, E, W) {
    const T = M.T;
    (M.dayReports || []).forEach(r => {
      if (r.d > T) E('Отчёт за ' + F.date(r.d) + ' (' + r.org + ') датирован будущим');
      r.lines.forEach(l => { if (!M.byId.get(l.task)) E('Отчёт за ' + F.date(r.d) + ': неизвестная работа ' + l.task); else if (l.v < 0) E('Отчёт за ' + F.date(r.d) + ': отрицательный объём по «' + M.byId.get(l.task).name + '»'); });
    });
    M.tasks.forEach(t => { if (t.qty && t.qtyFact != null && t.qtyFact > t.qty * 1.0005) W('«' + t.name + '»: подтверждённый объём больше общего'); });
    (M.remarks || []).forEach(r => { if (r.d > T) E('Замечание № ' + r.no + ' датировано будущим'); if (r.taskId && !r.task) E('Замечание № ' + r.no + ': неизвестная работа ' + r.taskId); });
    (M.guarantees || []).forEach(g => { if (g.due == null) W('Гарантийное письмо ' + g.no + ': не указан срок'); });
  });
})(typeof window !== 'undefined' ? window : globalThis);
