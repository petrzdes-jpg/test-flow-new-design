/*
 * Flow — финансовая цепочка: Контрагент → Договор → Смета → Виды работ → График → Выполнение →
 * КС-2 / КС-3 → Освоение → Аналитика.
 *
 *  · DSF.mergeContracts(P, S) — договоры объекта: из данных объекта и зарегистрированные в системе
 *    (журнал contracts), с изменениями (contractOps: правка реквизитов с основанием, доп. соглашения,
 *    оплаты и их корректировки). Исходные записи не удаляются — изменения хранятся как история;
 *  · DSF.estimatesOf(M) — сметы по договорам: версии, статусы, итоги (работы / материалы / без НДС / НДС);
 *  · DSF.estimateUsage(M, e) — объёмы позиций сметы, предъявленные и принятые в КС-2 (контроль объёмов);
 *  · DSF.ks3Of(M, c) — справки КС-3 по периодам из принятых КС-2 (за период, с начала года, с начала работ).
 * Освоение = принято / актуальная стоимость договора × 100 % (engine.js, c.osv). Оплаты учитываются отдельно.
 * Суммы договоров и КС — в млн ₽ (как во всей модели), позиции смет — в рублях.
 */
(function (root) {
  'use strict';
  const DSF = root.DSF = root.DSF || {};
  const dn = s => (DSF.util ? DSF.util.dn(s) : null);

  DSF.ESTIMATE_STATUS = {
    draft: { t: 'Черновик', c: 'neutral' }, review: { t: 'На проверке', c: 'accent' }, remarks: { t: 'Есть замечания', c: 'warn' },
    returned: { t: 'Возвращена на корректировку', c: 'warn' }, checked: { t: 'Проверена сметчиком', c: 'good' }, approved: { t: 'Утверждена', c: 'good' }
  };
  const EDIT_FIELDS = ['no', 'date', 'contractor', 'contractorId', 'inn', 'subject', 'item', 'workTypes', 'vat', 'start', 'end', 'adv', 'ret', 'payTerms', 'amount', 'status', 'note'];
  const FIELD_T = { no: 'номер', date: 'дата', contractor: 'контрагент', inn: 'ИНН', subject: 'предмет', item: 'статья бюджета', workTypes: 'виды работ', vat: 'НДС', start: 'начало работ', end: 'окончание работ', adv: 'аванс', ret: 'удержание', payTerms: 'условия оплаты', amount: 'цена', status: 'статус', note: 'примечание' };
  DSF.CONTRACT_FIELD_T = FIELD_T;

  DSF.mergeContracts = function (P, S) {
    const list = (P.contracts || []).map(c => Object.assign({}, c, { supp: (c.supp || []).slice(), payments: (c.payments || []).slice(), history: [] }))
      .concat(((S && S.contracts) || []).map(c => Object.assign({}, c, { registered: true, supp: [], payments: [], history: [{ date: c.regDate || c.date, by: c.by, text: 'Договор зарегистрирован в системе', reason: c.reason || '' }] })));
    const by = new Map(list.map(c => [c.id, c]));
    ((S && S.contractOps) || []).forEach(op => {
      const c = by.get(op.contract); if (!c) return;
      if (op.op === 'edit') {
        const before = {};
        Object.entries(op.patch || {}).forEach(([k, v]) => { if (EDIT_FIELDS.includes(k)) { before[k] = c[k]; c[k] = v; } });
        c.history.push({ date: op.date, by: op.by, text: 'Изменены реквизиты: ' + Object.keys(op.patch || {}).map(k => FIELD_T[k] || k).join(', '), reason: op.reason, before, after: op.patch });
      } else if (op.op === 'supp') {
        c.supp.push({ no: op.no, date: op.date, subject: op.subject, amount: +op.amount || 0, user: true });
        c.history.push({ date: op.date, by: op.by, text: 'Доп. соглашение ' + (op.no || '') + ': ' + ((+op.amount || 0) >= 0 ? '+' : '') + (+op.amount || 0) + ' млн ₽', reason: op.reason || op.subject });
      } else if (op.op === 'pay') {
        c.payments.push({ id: op.id, date: op.date, amount: +op.amount || 0, kind: op.kind || 'act', doc: op.doc || '', user: true });
        c.history.push({ date: op.date, by: op.by, text: 'Оплата ' + (+op.amount || 0) + ' млн ₽' + (op.doc ? ' (' + op.doc + ')' : ''), reason: op.reason || '' });
      } else if (op.op === 'payfix') {
        const p = c.payments.find(x => x.id === op.pay); if (!p) return;
        const was = p.amount; p.amount = +op.amount || 0; p.fixed = true;
        c.history.push({ date: op.date, by: op.by, text: 'Корректировка оплаты ' + (p.doc || '') + ': ' + was + ' → ' + p.amount + ' млн ₽', reason: op.reason });
      }
    });
    return list;
  };

  /* ---------- сметы ---------- */
  const r2 = v => Math.round(v * 100) / 100;
  function totals(sections, vatRate) {
    let work = 0, material = 0;
    sections.forEach(s => (s.items || []).forEach(i => { const v = (+i.qty || 0) * (+i.price || 0); if (i.kind === 'material') material += v; else work += v; }));
    const net = r2(work + material), vat = r2(net * (vatRate == null ? 0.2 : vatRate));
    return { work: r2(work), material: r2(material), net, vat, total: r2(net + vat), positions: sections.reduce((n, s) => n + (s.items || []).length, 0) };
  }
  DSF.estimateTotals = totals;
  DSF.estimatesOf = function (M) {
    const P = M.P, S = M.store || {};
    const src = (P.estimates || []).map(e => Object.assign({}, e)).concat((S.estimates || []).map(e => Object.assign({ user: true }, e)));
    const list = src.map(e => {
      const x = { id: e.id, contract: e.contract, no: e.no, title: e.title, demo: !!e.demo, user: !!e.user, vatRate: e.vatRate == null ? 0.2 : e.vatRate, note: e.note || '', author: e.author || e.by || '',
        status: e.status || 'draft', versions: [{ v: e.version || 1, date: e.date, by: e.author || e.by || '', sections: e.sections || [], note: 'Исходная версия' }], hist: [{ date: e.date, by: e.author || e.by || '', text: e.user ? 'Смета загружена' : 'Смета в системе', to: e.status || 'draft' }] };
      return x;
    });
    const by = new Map(list.map(e => [e.id, e]));
    (S.estimateOps || []).forEach(op => {
      const e = by.get(op.estimate); if (!e) return;
      if (op.op === 'version') { e.versions.push({ v: e.versions.length + 1, date: op.date, by: op.by, sections: op.sections || [], note: op.comment || '' }); e.status = op.to || 'draft'; e.hist.push({ date: op.date, by: op.by, text: 'Новая версия ' + e.versions.length + (op.comment ? ': ' + op.comment : ''), to: e.status }); return; }
      if (op.op === 'edit') { const cur = e.versions[e.versions.length - 1]; cur.sections = op.sections || cur.sections; cur.edited = (cur.edited || 0) + 1; e.hist.push({ date: op.date, by: op.by, text: 'Изменены позиции' + (op.comment ? ': ' + op.comment : ''), to: e.status }); return; }
      if (op.to) { e.status = op.to; e.hist.push({ date: op.date, by: op.by, text: (DSF.ESTIMATE_STATUS[op.to] || {}).t || op.to, to: op.to, comment: op.comment }); }
    });
    list.forEach(e => {
      const cur = e.versions[e.versions.length - 1];
      e.version = cur.v; e.sections = cur.sections; e.tot = totals(cur.sections, e.vatRate);
      e.contractObj = M.contractBy ? M.contractBy.get(e.contract) : null;
      e.items = cur.sections.flatMap(s => s.items || []);
      e.d = dn(cur.date);
    });
    return list;
  };
  /* объёмы позиций в КС-2: заявлено (кроме отклонённых) и принято */
  DSF.estimateUsage = function (M, e) {
    const use = new Map();
    (M.ks || []).filter(k => k.estimate === e.id && k.estLines).forEach(k => {
      const st = k.status, acc = DSF.KS_STATUS[st] ? DSF.KS_STATUS[st].r >= 5 && st !== 'rejected' : false;
      const ratio = acc && k.claimed > 0 && k.accepted != null ? k.accepted / k.claimed : acc ? 1 : 0;
      k.estLines.forEach(l => {
        const u = use.get(l.pos) || { claimed: 0, accepted: 0, ks: [] };
        if (st !== 'rejected') u.claimed += +l.qty || 0;
        u.accepted += (+l.qty || 0) * ratio;
        u.ks.push(k.no);
        use.set(l.pos, u);
      });
    });
    return use;
  };
  /* КС-3: стоимость выполненных работ по периодам (из принятых КС-2) */
  DSF.ks3Of = function (M, c) {
    const acc = (c.ks || []).filter(k => k.accepted != null && k.accepted > 0 && k.status !== 'rejected');
    const per = new Map();
    acc.forEach(k => { const key = k.period; if (!per.has(key)) per.set(key, []); per.get(key).push(k); });
    const keys = [...per.keys()].sort((a, b) => a - b);
    let cum = 0;
    return keys.map((p, i) => {
      const ks = per.get(p), amount = ks.reduce((n, k) => n + (k.accepted || 0), 0);
      const y = new Date(p * 864e5).getUTCFullYear();
      const ytd = keys.filter(q => q <= p && new Date(q * 864e5).getUTCFullYear() === y).reduce((n, q) => n + per.get(q).reduce((m, k) => m + (k.accepted || 0), 0), 0);
      cum += amount;
      return { n: i + 1, period: p, ks, amount, ytd, cum, vat: c.vat == null ? 0.2 : c.vat };
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
