/* Flow · «Обновление данных» (раздел администрирования).
   Два способа — ручная форма и стандартный Excel-файл — дают один и тот же набор входящих данных,
   который проходит одну проверку «Было → Стало» и применяется в единую модель проекта:
   работы — в слой правок графика (S.admin) и журнал факта (S.records), договоры — в S.budget,
   вехи, риски, события, бюджет, заявленная готовность и итоги периода — в S.upd.
   После применения build() пересчитывает проект, и все разделы читают один рассчитанный граф M.
   Конкретные виды работ, вехи и риски здесь не перечисляются: это данные проекта. */
(function(){
'use strict';
const X = window.DSFUpdateXlsx;
if (!X) return;

/* ================= СОСТОЯНИЕ ================= */
const UP = { preview: null, draft: null, f: { q: '', stage: 'all', scope: 'period', limit: 40 }, open: new Set(['passport', 'readiness', 'works']), photoFiles: [], busy: false };
const DRAFT_KEY = 'updDraft';
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function blankDraft(){
  const to = todayIso(), from = iso(dn(to) - 6);
  return { passport: { periodType: 'Неделя', from, to, asOf: to, responsible: LS.get('author', '') || '', comment: '' }, readiness: {}, budget: {}, summary: {},
    edits: { works: {}, milestones: {}, contracts: {}, risks: {}, events: {} }, added: { works: [], milestones: [], contracts: [], risks: [], events: [] }, photos: [], seq: 1 };
}
function loadDraft(){ const d = LS.get(DRAFT_KEY, null); if (!d || !d.edits) return blankDraft(); const b = blankDraft(); ['edits', 'added'].forEach(k => { d[k] = Object.assign(b[k], d[k] || {}); }); d.photos = []; return Object.assign(b, d); }
function saveDraft(){ const d = { ...UP.draft, photos: [] }; LS.set(DRAFT_KEY, d); }
UP.draft = loadDraft();

const COLS = ent => X.SHEET[ent].rows || X.SHEET[ent].cols;
const COL = (ent, k) => COLS(ent).find(c => c.k === k) || { k, h: k };
const ENT_T = { works: 'Работы', milestones: 'Вехи', contracts: 'Договоры', risks: 'Риски', events: 'События', photos: 'Фото', budget: 'Бюджет', readiness: 'Готовность проекта', summary: 'Итог периода', passport: 'Паспорт обновления' };
const ENT_ONE = { works: 'Работа', milestones: 'Веха', contracts: 'Договор', risks: 'Риск', events: 'Событие', photos: 'Фото', budget: 'Бюджет', readiness: 'Готовность', summary: 'Итог периода' };
const KIND = { new: ['Новая сущность', 'accent'], changed: ['Изменено', 'warn'], status: ['Изменён статус', 'good'], unmatched: ['Не удалось однозначно сопоставить', 'crit'], error: ['Ошибка в данных', 'crit'], same: ['Без изменений', 'neutral'] };
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const normName = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').trim();

/* ================= ТЕКУЩЕЕ СОСТОЯНИЕ ПРОЕКТА (в полях файла) ================= */
function nodeStatus(n){
  if (n.adm && n.adm.status === 'paused' && n.pc < 99.95) return 'Приостановлена';
  if (n.pc >= 99.95) return 'Завершена';
  if (n.pc > 0.001 || (n.adm && n.adm.status === 'active')) return 'В работе';
  return 'Не начата';
}
const codeOfU = u => { const a = S.admin.added.find(x => x.u === u); return a ? 'ДОБ-' + (u - ADMIN_UID0) : M.nodes.has(u) ? M.nodes.get(u).code : 'ГП-' + u; };
function worksSnap(){
  const list = [];
  M.order.forEach(u => {
    const n = M.nodes.get(u); if (!n || n.sm || !editableNode(n)) return;
    const par = M.nodes.get(n.parent);
    list.push({ id: n.code, u: n.u, name: n.name, cat: par ? par.name : '', catId: par ? par.code : '', parentU: n.parent, uom: n.uom || null, qTotal: n.qP ?? null, qPlan: n.qPl ?? null, qCum: n.qF ?? null,
      pc: r1(n.pc), s: n.s0 != null ? iso(n.s0) : null, f: n.f0 != null ? iso(n.f0) : null, fc: n.pc >= 99.95 ? (n.afE != null ? iso(n.afE) : null) : (n.fcDecl || null),
      status: nodeStatus(n), dev: r1(n.devPP), comment: n.cmt || null, planNow: n.planNow });
  });
  // скрытые и архивные работы остаются в данных проекта и в файле (их можно вернуть статусом)
  Object.entries(S.admin.edits).forEach(([k, e]) => {
    if (!e.hidden || e.deleted) return;
    const u = +k; if (M.nodes.has(u)) return;
    const r = srcRow(u), a = S.admin.added.find(x => x.u === u);
    if (!r && !a) return; if (r ? r[10] : a.group) return;
    const par = e.parent ?? (a ? a.parent : r[2]), pn = M.nodes.get(par);
    list.push({ id: codeOfU(u), u, name: admName(u), cat: pn ? pn.name : '', catId: pn ? pn.code : '', parentU: par, uom: e.uom ?? null, qTotal: e.qP ?? null, qPlan: e.qPl ?? null, qCum: e.qF ?? null,
      pc: null, s: e.s ?? (a ? a.s : r[4]), f: e.f ?? (a ? a.f : r[5]), fc: e.fcF || null, status: e.archived ? 'В архиве' : 'Скрыта', dev: null, comment: e.comment || null, gone: true });
  });
  return list;
}
function msDefs(){ return [...MILESTONES.map(m => ({ ...m, id: m.id || msKey(m), base: true })), ...S.upd.milestones.added]; }
function milestonesSnap(){
  const E = S.upd.milestones.edits;
  return msDefs().filter(d => !(E[d.id] || {}).archived).map(d => {
    const m = { ...d, ...(E[d.id] || {}) }, c = M.ms.find(x => x.id === d.id);
    const refN = m.ref != null && M.nodes.has(+m.ref) ? M.nodes.get(+m.ref) : null;
    return { id: d.id, name: m.name, cat: m.cat || null, plan: m.plan || (c ? iso(c.plan) : null), fact: m.fact || (c && c.done && c.actual != null ? iso(c.actual) : null),
      status: m.status === 'done' ? 'Выполнена' : m.status === 'cancel' ? 'Отменена' : 'По расчёту', key: m.key ? 'Да' : 'Нет', ref: refN ? refN.code : m.ref != null ? String(m.ref) : null,
      daysTo: c ? c.daysTo : null, overdue: c && c.overdue ? c.overdue : null, comment: m.comment || null, base: !!d.base };
  });
}
function contractsSnap(){
  return M.contracts.map(c => ({ id: c.id, counterparty: c.counterparty, subject: c.subject || null, number: c.number && c.number !== '—' ? c.number : null, cat: c.category || null,
    amount: c.price || null, date: c.signDate || c.start || null, end: c.end || null, paid: c.paid ?? null, spent: c.closed ?? null, rest: c.price ? c.rest : null,
    status: c.manualStatus || (c.status.t === 'Завершён' ? 'Завершён' : 'Действует'), comment: c.comment || null, user: !!c.user }));
}
const pickCols = (ent, r) => Object.fromEntries(COLS(ent).map(c => [c.k, r[c.k] ?? null]));
function risksSnap(){ return S.upd.risks.filter(r => !r.archived).map(r => ({ ...pickCols('risks', r), id: r.id })); }
function eventsSnap(){ return S.upd.events.filter(r => !r.archived).map(r => ({ ...pickCols('events', r), id: r.id })); }
function budgetSnap(){ const B = M.budget; return { total: B.total, approved: B.approved, contracted: B.contracted, paid: B.paid, spent: B.spent, forecast: B.forecast, dev: B.deviation, comment: B.comment || null }; }
function readinessSnap(){ const D = M.declared || {}; return { calcPlan: r1(M.root.planNow), calcFact: r1(M.root.pc), plan: D.plan ?? null, fact: D.fact ?? null, dev: r1(M.root.pc - M.root.planNow), status: D.status || null, comment: D.comment || null }; }
function snapshot(){ return { works: worksSnap(), milestones: milestonesSnap(), contracts: contractsSnap(), risks: risksSnap(), events: eventsSnap(), budget: budgetSnap(), readiness: readinessSnap() }; }

/* ================= ПРОВЕРКА «БЫЛО → СТАЛО» ================= */
const eq = (a, b, k) => {
  if (a == null || a === '') return b == null || b === '';
  if (b == null || b === '') return false;
  if (typeof a === 'number' || typeof b === 'number'){ const x = Number(a), y = Number(b); return Math.abs(x - y) < (k === 'pc' ? 0.05 : 1e-6); }
  return String(a).trim() === String(b).trim();
};
function disp(ent, k, v){
  if (v == null || v === '') return '—';
  const c = COL(ent, k), t = c.type;
  if (t === 'date') return fd(dn(v));
  if (t === 'money') return fmoney(Number(v), '₽');
  if (t === 'pct') return fp(Number(v), 1) + ' %';
  if (t === 'num') return fp(Number(v), Number.isInteger(Number(v)) ? 0 : 2);
  return String(v);
}
const stageList = () => M.order.map(u => M.nodes.get(u)).filter(n => n && (n.sm || n.u === CFG.gpRoot) && n.u !== -1 && (srcRow(n.u) || n.added));
function resolveStage(catId, cat){
  if (catId){ const s = stageList().find(n => n.code === String(catId).trim()); if (s) return { u: s.u }; }
  if (cat){
    const hits = stageList().filter(n => normName(n.name) === normName(cat) || normName(shortName(n.name)) === normName(cat));
    if (hits.length === 1) return { u: hits[0].u };
    return { none: !hits.length, many: hits.length > 1, hits };
  }
  return { none: true, hits: [] };
}
/* Узел графика по ID DSFlow (работа или этап) — для связей вех и фото */
function nodeByCode(code){ if (code == null) return null; const k = String(code).trim().toUpperCase(); for (const n of M.nodes.values()) if (String(n.code).toUpperCase() === k) return n; return null; }
function workIdToSnap(W, id){ const k = String(id).trim().toUpperCase(); return W.find(w => w.id.toUpperCase() === k || String(w.u) === k); }
function stageOpts(extraNew){ return [{ v: 'skip', t: 'Пропустить' }, ...(extraNew ? [{ v: 'newstage', t: 'Создать этап «' + extraNew + '»' }] : []), ...stageList().map(n => ({ v: 'stage:' + n.u, t: '→ этап ' + n.code + ' · ' + shortName(n.name).slice(0, 80) }))]; }

function diff(inc){
  const snap = snapshot(), items = [], errors = [...(inc.errors || [])], warnings = [...(inc.warnings || [])];
  const P = inc.passport || {};
  // 1. проект
  if (inc.source !== 'form'){
    if (!P.project && !P.projectName) errors.push({ where: 'Паспорт обновления', text: 'не удалось определить проект: не указан код проекта.' });
    else if (P.project && String(P.project).trim().toLowerCase() !== CFG.id) errors.push({ where: 'Паспорт обновления', text: 'файл относится к проекту «' + P.project + '», а открыт ' + PROJECT.name + ' (код ' + CFG.id + '). Откройте нужный проект.' });
    else if (!P.project && normName(P.projectName) !== normName(PROJECT.name)) errors.push({ where: 'Паспорт обновления', text: 'проект «' + P.projectName + '» не совпадает с открытым: ' + PROJECT.name + '.' });
    else if (P.project && P.projectName && normName(P.projectName) !== normName(PROJECT.name)) warnings.push({ where: 'Паспорт обновления', text: 'название проекта в файле «' + P.projectName + '» отличается от названия в Flow; проект определён по коду ' + CFG.id + '.' });
  }
  // 2. период
  if (!P.from || !P.to) errors.push({ where: 'Паспорт обновления', text: 'не указан отчётный период («Период с» и «Период по»).' });
  else if (P.to < P.from) errors.push({ where: 'Паспорт обновления', text: 'окончание периода раньше начала.' });
  if (!P.periodType) warnings.push({ where: 'Паспорт обновления', text: 'не указан тип периода — принят «Произвольный».' });
  const period = { type: X.PERIOD_CODE[P.periodType] || 'custom', from: P.from || null, to: P.to || null };
  const asOf = P.asOf || P.to || null;
  const ctx = { period, asOf, responsible: P.responsible || '', comment: P.comment || '' };

  // 3. работы
  const W = snap.works, byName = new Map();
  W.forEach(w => { const k = normName(w.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(w); });
  (inc.works || []).forEach(r => {
    const it = { ent: 'works', row: r._row, inc: r, fields: [], notes: [] };
    if (r._errors){ it.kind = 'error'; it.name = r.name || r.id || 'строка ' + r._row; it.notes = r._errors; items.push(it); return; }
    let cur = null;
    if (r.id){
      cur = workIdToSnap(W, r.id);
      if (!cur){ it.kind = 'unmatched'; it.name = r.name || r.id; it.notes.push('ID «' + r.id + '» не найден в проекте.'); it.resolve = { options: [{ v: 'skip', t: 'Пропустить' }, { v: 'new', t: 'Создать как новую работу' }], value: 'skip' }; items.push(it); return; }
    } else if (r.name){
      const hits = byName.get(normName(r.name)) || [];
      if (hits.length === 1){ cur = hits[0]; it.notes.push('Сопоставлено по точному совпадению названия с ' + cur.id + '.'); }
      else if (hits.length > 1){ it.kind = 'unmatched'; it.name = r.name; it.notes.push('В проекте ' + hits.length + ' работы с таким названием — выберите нужную.'); it.resolve = { options: [{ v: 'skip', t: 'Пропустить' }, ...hits.map(h => ({ v: 'id:' + h.id, t: h.id + ' · ' + (h.cat ? shortName(h.cat).slice(0, 60) : '') })), { v: 'new', t: 'Создать новую работу' }], value: 'skip' }; items.push(it); return; }
    } else { it.kind = 'error'; it.name = 'строка ' + r._row; it.notes.push('не указано наименование работы.'); items.push(it); return; }
    workItem(it, r, cur, ctx);
    items.push(it);
  });

  // 4. вехи, договоры, риски, события
  registry('milestones', snap.milestones, inc.milestones, items, ctx);
  registry('contracts', snap.contracts, inc.contracts, items, ctx);
  registry('risks', snap.risks, inc.risks, items, ctx);
  registry('events', snap.events, inc.events, items, ctx);

  // 5. бюджет, готовность, итог периода
  const kv = (ent, cur, incV, keys) => {
    if (!incV) return;
    const fields = keys.filter(k => incV[k] !== undefined && !eq(cur ? cur[k] : null, incV[k], k)).map(k => ({ k, label: COL(ent, k).h, old: cur ? cur[k] ?? null : null, new: incV[k] }));
    if (!fields.length) return;
    items.push({ ent, kind: cur && Object.values(cur).some(v => v != null) ? 'changed' : 'new', name: ENT_T[ent], fields, inc: incV, notes: [], include: true });
  };
  kv('budget', snap.budget, inc.budget, ['total', 'approved', 'contracted', 'paid', 'spent', 'forecast', 'comment']);
  kv('readiness', snap.readiness, inc.readiness, ['plan', 'fact', 'status', 'comment']);
  if (inc.summary && Object.values(inc.summary).some(v => v)) items.push({ ent: 'summary', kind: 'new', name: 'Итог периода', fields: Object.entries(inc.summary).filter(([, v]) => v).map(([k, v]) => ({ k, label: COL('summary', k).h, old: null, new: v })), inc: inc.summary, notes: [], include: true });

  // 6. фото: файлы прикладываются к загрузке, сопоставление — по точному имени файла
  (inc.photos || []).forEach(r => {
    const it = { ent: 'photos', row: r._row, inc: r, name: r.file || 'строка ' + r._row, fields: [], notes: [] };
    if (r._errors){ it.kind = 'error'; it.notes = r._errors; items.push(it); return; }
    if (!r.date || !r.file){ it.kind = 'error'; it.notes.push('укажите дату и имя файла.'); items.push(it); return; }
    const f = r._blob || UP.photoFiles.find(x => x.name === r.file);
    it.fields = ['date', 'stage', 'zone', 'work', 'desc'].filter(k => r[k]).map(k => ({ k, label: COL('photos', k).h, old: null, new: r[k] }));
    if (r.work && !nodeByCode(r.work)) it.notes.push('работа ' + r.work + ' не найдена — фото будет без привязки к работе.');
    if (!f){ it.kind = 'unmatched'; it.notes.push('файл «' + r.file + '» не приложен — приложите фото ниже.'); it.include = false; }
    else { it.kind = 'new'; it.blob = f; it.include = true; }
    items.push(it);
  });

  items.forEach(it => { if (it.include == null) it.include = it.kind !== 'unmatched' && it.kind !== 'error' && it.kind !== 'same'; });
  return { ctx, items, errors, warnings, passport: P, source: inc.source, file: inc.file || null };
}

function workItem(it, r, cur, ctx){
  it.cur = cur; it.id = cur ? cur.id : null; it.name = r.name || (cur && cur.name);
  const F = (k, o, n) => it.fields.push({ k, label: COL('works', k).h, old: o, new: n });
  const ops = it.ops = {};
  const errs = [];
  // этап (категория)
  let parent = cur ? cur.parentU : null;
  const wantStage = (r.catId !== undefined && r.catId !== null && (!cur || String(r.catId) !== String(cur.catId))) || (r.cat !== undefined && r.cat !== null && (!cur || normName(r.cat) !== normName(cur.cat) && normName(r.cat) !== normName(shortName(cur.cat))));
  if (!cur || wantStage){
    const res = resolveStage(r.catId && (!cur || String(r.catId) !== String(cur.catId)) ? r.catId : null, r.cat);
    if (res.u != null) parent = res.u;
    else if (!cur && r.cat == null && r.catId == null){ errs.push('для новой работы укажите «Категория / этап».'); }
    else {
      it.stageFix = true;
      it.notes.push(res.many ? 'Этап «' + r.cat + '» встречается в проекте несколько раз — выберите нужный.' : 'Этап «' + (r.cat || r.catId) + '» не найден в проекте — выберите существующий или создайте новый.');
      it.resolve = { options: stageOpts(r.cat || null), value: 'skip' };
    }
    if (parent != null && (!cur || parent !== cur.parentU)){ ops.parent = parent; F('cat', cur ? cur.cat : null, M.nodes.get(parent).name); }
  }
  // простые поля
  [['name', 'name'], ['uom', 'uom'], ['qTotal', 'qTotal'], ['qPlan', 'qPlan'], ['s', 's'], ['f', 'f'], ['comment', 'comment']].forEach(([k]) => {
    if (r[k] === undefined) return;
    if (cur && eq(cur[k], r[k], k)) return;
    ops[k] = r[k]; F(k, cur ? cur[k] : null, r[k]);
  });
  if (!cur){ if (!r.s || !r.f) errs.push('для новой работы укажите «Дата начала» и «Плановая дата окончания».'); }
  const s_ = ops.s !== undefined ? ops.s : cur && cur.s, f_ = ops.f !== undefined ? ops.f : cur && cur.f;
  if (s_ && f_ && f_ < s_) errs.push('плановая дата окончания раньше даты начала.');
  // объём и процент выполнения: процент считается из объёмов, если они известны
  const qTotal = ops.qTotal !== undefined ? ops.qTotal : cur ? cur.qTotal : null;
  let qCum = cur ? cur.qCum : null;
  // накопленный факт, оставленный в файле без изменений, не спорит с фактом за период
  const cumChanged = r.qCum !== undefined && !(cur && eq(cur.qCum, r.qCum));
  if (r.qPeriod != null && r.qPeriod !== 0){
    const viaPeriod = (qCum || 0) + r.qPeriod;
    if (cumChanged && r.qCum != null && Math.abs(r.qCum - viaPeriod) > 1e-6) it.notes.push('Факт за период (' + fp(r.qPeriod, 2) + ') не сходится с приростом накопленного факта — принят накопленный факт ' + fp(r.qCum, 2) + '.');
    qCum = cumChanged ? r.qCum : viaPeriod;
    ops.qPeriod = r.qPeriod; F('qPeriod', null, r.qPeriod);
  } else if (r.qCum !== undefined) qCum = r.qCum;
  if (cur ? !eq(cur.qCum, qCum) : qCum != null){ ops.qCum = qCum; F('qCum', cur ? cur.qCum : null, qCum); }
  let pc = null, pcSrc = null;
  if (qTotal > 0 && qCum != null && (ops.qCum !== undefined || ops.qTotal !== undefined)){ pc = Math.min(100, Math.max(0, qCum / qTotal * 100)); pcSrc = 'volume'; if (r.pc != null && !(cur && eq(cur.pc, r.pc, 'pc')) && Math.abs(r.pc - pc) > 0.5) it.notes.push('% выполнения рассчитан по объёмам (' + fp(pc, 1) + ' %), указанное значение ' + fp(r.pc, 1) + ' % не применено.'); }
  else if (r.pc != null && !(cur && eq(cur.pc, r.pc, 'pc'))) { pc = r.pc; pcSrc = 'input'; }
  // статус
  let status = r.status;
  if (status === 'Завершена'){ pc = 100; pcSrc = pcSrc || 'status'; }
  if (pc != null && pc >= 99.95 && !status && (!cur || cur.status !== 'Завершена')) status = 'Завершена';
  if (status === 'Не начата' && (pc != null ? pc > 0 : cur && cur.pc > 0)) errs.push('статус «Не начата», но выполнено ' + fp(pc != null ? pc : cur.pc, 1) + ' %. Чтобы обнулить выполнение, укажите 0 %.');
  if (pc != null && (!cur || cur.gone || !eq(cur.pc, pc, 'pc'))){ ops.pc = pc; F('pc', cur ? cur.pc : null, r1(pc)); }
  const fcDate = r.fc;
  if (fcDate !== undefined && !(cur && eq(cur.fc, fcDate))){ ops.fc = fcDate; F('fc', cur ? cur.fc : null, fcDate); }
  if (status && (!cur || status !== cur.status)){ ops.status = status; F('status', cur ? cur.status : null, status); }
  if (errs.length){ it.kind = 'error'; it.notes = errs.concat(it.notes); return; }
  if (it.resolve){ it.kind = 'unmatched'; return; }
  it.kind = !cur ? 'new' : !it.fields.length ? 'same' : ops.status ? 'status' : 'changed';
}

/* Реестры: вехи, договоры, риски, события — сопоставление по ID, без ID — по точному названию. */
const REG_NAME = { milestones: 'name', contracts: 'counterparty', risks: 'name', events: 'name' };
const REG_FIELDS = {
  milestones: ['name', 'cat', 'plan', 'fact', 'status', 'key', 'ref', 'comment'],
  contracts: ['counterparty', 'subject', 'number', 'cat', 'amount', 'date', 'end', 'paid', 'spent', 'status', 'comment'],
  risks: ['name', 'cat', 'desc', 'prob', 'impact', 'status', 'owner', 'action', 'due', 'comment'],
  events: ['date', 'cat', 'name', 'desc', 'impact', 'status']
};
const STATUS_F = { milestones: 'status', contracts: 'status', risks: 'status', events: 'status' };
const BASE_LOCKED = ['counterparty', 'subject', 'number', 'amount', 'end'];   // договоры из данных объекта: реквизиты не меняются
function registry(ent, cur, rows, items, ctx){
  if (!rows || !rows.length) return;
  const nk = REG_NAME[ent];
  rows.forEach(r => {
    const it = { ent, row: r._row, inc: r, fields: [], notes: [], name: r[nk] || r.id || 'строка ' + r._row };
    if (r._errors){ it.kind = 'error'; it.notes = r._errors; items.push(it); return; }
    let c = null;
    if (r.id){
      c = cur.find(x => String(x.id).toUpperCase() === String(r.id).toUpperCase());
      if (!c){ it.kind = 'unmatched'; it.notes.push('ID «' + r.id + '» не найден в проекте.'); it.resolve = { options: [{ v: 'skip', t: 'Пропустить' }, { v: 'new', t: 'Добавить как новую запись' }], value: 'skip' }; items.push(it); return; }
    } else if (r[nk]){
      const hits = cur.filter(x => normName(x[nk]) === normName(r[nk]) && (ent !== 'events' || !r.date || x.date === r.date));
      if (hits.length === 1){ c = hits[0]; it.notes.push('Сопоставлено по точному совпадению названия с ' + c.id + '.'); }
      else if (hits.length > 1){ it.kind = 'unmatched'; it.notes.push('Найдено несколько записей с таким названием — выберите нужную.'); it.resolve = { options: [{ v: 'skip', t: 'Пропустить' }, ...hits.map(h => ({ v: 'id:' + h.id, t: h.id + ' · ' + String(h[nk]).slice(0, 60) })), { v: 'new', t: 'Добавить как новую запись' }], value: 'skip' }; items.push(it); return; }
    }
    regFields(it, ent, r, c);
    items.push(it);
  });
}
function regFields(it, ent, r, c){
  it.cur = c; it.id = c ? c.id : null;
  const errs = [];
  REG_FIELDS[ent].forEach(k => {
    if (r[k] === undefined) return;
    if (c && eq(c[k], r[k], k)) return;
    if (ent === 'contracts' && c && !c.user && BASE_LOCKED.includes(k)){ it.notes.push('«' + COL(ent, k).h + '» — из исходных данных объекта, в обновлении не меняется.'); return; }
    it.fields.push({ k, label: COL(ent, k).h, old: c ? c[k] ?? null : null, new: r[k] });
  });
  if (ent === 'milestones' && r.ref && !(c && eq(c.ref, r.ref)) && !nodeByCode(r.ref)) errs.push('работа ' + r.ref + ' не найдена в проекте.');
  if (!c){
    const need = { milestones: r.name && (r.plan || r.ref), contracts: r.counterparty && r.amount != null, risks: r.name, events: r.name && r.date }[ent];
    if (!need) errs.push({ milestones: 'для новой вехи укажите название и плановую дату (или связанную работу).', contracts: 'для нового договора укажите контрагента и сумму.', risks: 'для нового риска укажите название.', events: 'для нового события укажите дату и название.' }[ent]);
  }
  if (errs.length){ it.kind = 'error'; it.notes = errs.concat(it.notes); return; }
  it.kind = !c ? 'new' : !it.fields.length ? 'same' : it.fields.some(f => f.k === STATUS_F[ent]) ? 'status' : 'changed';
}
let _wsCache = null;
const worksSnapCache = () => _wsCache || (_wsCache = worksSnap());
/* Решение пользователя по строке «Не удалось однозначно сопоставить» */
function resolveItem(it, v){
  it.resolve.value = v; it.notes = it.notes.filter(n => !n.startsWith('Выбрано:'));
  if (v === 'skip'){ it.include = false; it.kind = 'unmatched'; return; }
  if (it.ent === 'works'){
    const W = worksSnapCache();
    if (it.stageFix){
      const r = { ...it.inc };
      if (v === 'newstage'){ it.newStage = r.cat; it.ops.parent = 'new'; }
      else { const u = +v.slice(6); it.ops.parent = u; it.newStage = null; }
      it.fields = it.fields.filter(f => f.k !== 'cat'); it.fields.unshift({ k: 'cat', label: COL('works', 'cat').h, old: it.cur ? it.cur.cat : null, new: v === 'newstage' ? r.cat + ' (новый этап)' : M.nodes.get(+v.slice(6)).name });
      it.resolve.locked = true;
      it.kind = !it.cur ? 'new' : it.ops.status ? 'status' : 'changed'; it.include = true; return;
    }
    const cur = v.startsWith('id:') ? workIdToSnap(W, v.slice(3)) : null;
    const nit = { ent: 'works', row: it.row, inc: it.inc, fields: [], notes: [], resolve: null };
    workItem(nit, v === 'new' ? { ...it.inc, id: undefined } : it.inc, cur, null);
    Object.assign(it, { cur: nit.cur, id: nit.id, fields: nit.fields, ops: nit.ops, kind: nit.kind, stageFix: nit.stageFix, notes: nit.notes });
    if (nit.resolve){ it.resolve = { ...nit.resolve, value: 'skip' }; it.kind = 'unmatched'; it.include = false; return; }
    it.resolve = { ...it.resolve, value: v, locked: true };
    it.include = it.kind !== 'error' && it.kind !== 'same';
    return;
  }
  const snapL = { milestones: milestonesSnap, contracts: contractsSnap, risks: risksSnap, events: eventsSnap }[it.ent]();
  const c = v.startsWith('id:') ? snapL.find(x => x.id === v.slice(3)) : null;
  const nit = { ent: it.ent, row: it.row, inc: it.inc, fields: [], notes: [] };
  regFields(nit, it.ent, it.inc, c);
  Object.assign(it, { cur: nit.cur, id: nit.id, fields: nit.fields, kind: nit.kind, notes: nit.notes });
  it.resolve = { ...it.resolve, value: v, locked: true };
  it.include = it.kind !== 'error' && it.kind !== 'same';
}

/* ================= ПРИМЕНЕНИЕ ================= */
const nextId = (prefix, list) => { const n = list.reduce((a, x) => { const m = String(x.id || '').match(/(\d+)$/); return m && String(x.id).startsWith(prefix) ? Math.max(a, +m[1]) : a; }, 0) + 1; return prefix + String(n).padStart(3, '0'); };
async function apply(pv){
  const ctx = pv.ctx, when = Date.now(), asOf = ctx.asOf || iso(M.T);
  const author = ctx.responsible || 'Обновление данных';
  const note = 'Обновление данных · ' + periodLabel(ctx.period);
  const changes = [];
  const sel = pv.items.filter(it => it.include && it.kind !== 'error' && it.kind !== 'same' && it.kind !== 'unmatched');
  const rec = (it, f) => changes.push({ ent: it.ent, id: it.id || it.newId || null, name: it.name, field: f.label, old: disp(it.ent, f.k, f.old), new: disp(it.ent, f.k, f.new), kind: it.kind });
  const newRecs = [], finTouched = new Set();
  let photosSaved = 0;
  // фото сохраняются первыми (асинхронно, в хранилище фото этого браузера)
  for (const it of sel.filter(x => x.ent === 'photos')){
    if (!PhotoDB.db) await PhotoDB.open();
    if (!PhotoDB.db){ toast('Хранилище фото недоступно в этом браузере — фото не сохранены.'); break; }
    const r = it.inc, w = r.work ? nodeByCode(r.work) : null;
    const recP = { id: (crypto.randomUUID ? crypto.randomUUID() : when.toString(36) + Math.random().toString(36).slice(2)), date: r.date, zone: r.zone || '', stage: r.stage || '', caption: r.desc || r.file.replace(/\.[^.]+$/, ''), work: w ? w.u : '', blob: it.blob, added: new Date().toISOString(), update: true };
    try { await PhotoDB.put(recP); S.photos.push(PhotoDB.view(recP)); photosSaved++; it.newId = 'фото'; it.fields.forEach(f => rec(it, f)); } catch(e){ toast('Не удалось сохранить фото «' + esc(r.file) + '».'); }
  }
  const A = S.admin;
  ADM_UNDO.push(JSON.stringify(A));
  // новые этапы (по решению пользователя)
  const stageMade = {};
  sel.filter(it => it.ent === 'works' && it.ops && it.ops.parent === 'new').forEach(it => {
    const nm = it.newStage;
    if (!stageMade[nm]){
      const u = Math.max(ADMIN_UID0, ...A.added.map(x => x.u)) + 1;
      A.added.push({ u, parent: CFG.gpRoot, name: nm, s: it.inc.s || asOf, f: it.inc.f || asOf, du: 1, group: true, at: when });
      stageMade[nm] = u;
      changes.push({ ent: 'works', id: 'ДОБ-' + (u - ADMIN_UID0), name: nm, field: 'Этап', old: '—', new: 'создан', kind: 'new' });
    }
    it.ops.parent = stageMade[nm];
  });
  // работы
  sel.filter(it => it.ent === 'works').forEach(it => {
    const o = it.ops || {}, cur = it.cur;
    let u = cur ? cur.u : null;
    if (!cur){
      u = Math.max(ADMIN_UID0, ...A.added.map(x => x.u)) + 1;
      A.added.push({ u, parent: o.parent, name: o.name || it.inc.name, s: o.s, f: o.f, du: workDays(o.s, o.f), at: when });
      it.newId = 'ДОБ-' + (u - ADMIN_UID0);
    }
    const e = A.edits[u] = { ...(A.edits[u] || {}) };
    if (cur){
      if (o.name !== undefined) e.name = o.name;
      if (o.parent !== undefined && o.parent !== cur.parentU){ e.fromParent = cur.parentU; e.parent = o.parent; }
      if (o.s !== undefined) e.s = o.s;
      if (o.f !== undefined) e.f = o.f;
      if (o.s !== undefined || o.f !== undefined){ const s_ = o.s ?? cur.s, f_ = o.f ?? cur.f; if (s_ && f_) e.du = workDays(s_, f_); }
    }
    if (o.uom !== undefined) e.uom = o.uom;
    if (o.qTotal !== undefined) e.qP = o.qTotal;
    if (o.qPlan !== undefined) e.qPl = o.qPlan;
    if (o.qCum !== undefined) e.qF = o.qCum;
    if (o.comment !== undefined) e.comment = o.comment;
    const st = o.status;
    const done = st === 'Завершена' || (o.pc != null && o.pc >= 99.95);
    if (o.fc !== undefined){ if (done || (cur && cur.status === 'Завершена')) e.af = o.fc; else e.fcF = o.fc; }
    if (done && !e.af) e.af = o.fc || asOf;
    if (st === 'Скрыта' || st === 'В архиве'){ e.hidden = true; e.hiddenAt = when; if (st === 'В архиве') e.archived = true; else delete e.archived; }
    else if (st && cur && cur.gone){ delete e.hidden; delete e.archived; delete e.hiddenAt; }
    if (st === 'В работе') e.status = 'active'; else if (st === 'Приостановлена') e.status = 'paused'; else if (st === 'Не начата' || st === 'Завершена') delete e.status;
    Object.keys(e).forEach(k => e[k] === undefined && delete e[k]);
    if (!Object.keys(e).length) delete A.edits[u];
    // факт выполнения — новая запись журнала на дату актуальности (история не перезаписывается)
    if (o.pc != null){
      const was = cur && !cur.gone ? cur.pc || 0 : 0;
      const d = done ? (e.af || asOf) : asOf;
      const r = { id: 'u' + when.toString(36) + Math.random().toString(36).slice(2, 6), uid: u, date: d, set: Math.round(o.pc * 100) / 100, delta: Math.round((o.pc - was) * 100) / 100, author, note, at: when, source: 'update', period: ctx.period };
      S.records.push(r); newRecs.push(r);
    }
    it.fields.forEach(f => rec(it, f));
    if (!cur && !it.fields.length) changes.push({ ent: 'works', id: it.newId, name: it.name, field: 'Работа', old: '—', new: 'добавлена', kind: 'new' });
  });
  // вехи
  const MU = S.upd.milestones, W = worksSnapCache();
  sel.filter(it => it.ent === 'milestones').forEach(it => {
    const v = {}; it.fields.forEach(f => { v[f.k] = f.new; });
    const conv = {};
    if ('name' in v) conv.name = v.name; if ('cat' in v) conv.cat = v.cat; if ('plan' in v) conv.plan = v.plan; if ('fact' in v) conv.fact = v.fact; if ('comment' in v) conv.comment = v.comment;
    if ('status' in v) conv.status = v.status === 'Выполнена' ? 'done' : v.status === 'Отменена' ? 'cancel' : undefined;
    if ('key' in v) conv.key = v.key === 'Да';
    if ('ref' in v){ const w = v.ref ? nodeByCode(v.ref) : null; conv.ref = w ? w.u : null; }
    if (it.cur){ const e = MU.edits[it.cur.id] = { ...(MU.edits[it.cur.id] || {}), ...conv }; Object.keys(e).forEach(k => e[k] === undefined && delete e[k]); }
    else { it.newId = nextId('В-', MU.added); MU.added.push({ id: it.newId, ...conv, ev: 'finish', at: when }); }
    it.fields.forEach(f => rec(it, f));
  });
  // договоры
  sel.filter(it => it.ent === 'contracts').forEach(it => {
    const v = {}; it.fields.forEach(f => { v[f.k] = f.new; });
    if (!it.cur){
      it.newId = budId('c');
      S.budget.contracts.push({ id: it.newId, counterparty: v.counterparty, short: v.counterparty, number: v.number || '', subject: v.subject || '', category: v.cat || '', price: v.amount, date: v.date || null, start: v.date || asOf, end: v.end || null, paid: v.paid ?? null, spent: v.spent ?? null, status: v.status && v.status !== 'Действует' ? v.status : null, comment: v.comment || '', wbs: null, at: when });
    } else if (it.cur.user){
      const c = S.budget.contracts.find(x => x.id === it.cur.id);
      const map = { counterparty: 'counterparty', subject: 'subject', number: 'number', cat: 'category', amount: 'price', date: 'date', end: 'end', paid: 'paid', spent: 'spent', comment: 'comment' };
      Object.entries(v).forEach(([k, x]) => { if (k === 'status') c.status = x && x !== 'Действует' ? x : null; else if (map[k]) c[map[k]] = x; });
    } else {
      const mt = S.budget.meta[it.cur.id] = { ...(S.budget.meta[it.cur.id] || {}) };
      if ('cat' in v) mt.category = v.cat; if ('comment' in v) mt.comment = v.comment; if ('date' in v) mt.date = v.date; if ('status' in v) mt.status = v.status && v.status !== 'Действует' ? v.status : null;
      if ('paid' in v || 'spent' in v){ const fo = S.fin[it.cur.id] = { ...(S.fin[it.cur.id] || {}) }; if ('paid' in v) fo.paid = v.paid; if ('spent' in v) fo.closed = v.spent; finTouched.add(it.cur.id); }
    }
    it.fields.forEach(f => rec(it, f));
  });
  // риски и события
  ['risks', 'events'].forEach(ent => {
    const list = S.upd[ent], pre = ent === 'risks' ? 'Р-' : 'С-';
    sel.filter(it => it.ent === ent).forEach(it => {
      const v = {}; it.fields.forEach(f => { v[f.k] = f.new; });
      if (it.cur){ const x = list.find(y => y.id === it.cur.id); Object.assign(x, v, { updatedAt: when }); }
      else { it.newId = nextId(pre, list); list.push({ id: it.newId, ...v, at: when, period: ctx.period }); }
      it.fields.forEach(f => rec(it, f));
    });
  });
  // бюджет, заявленная готовность, итог периода
  sel.filter(it => it.ent === 'budget').forEach(it => {
    it.fields.forEach(f => { if (f.k === 'total') S.settings.budgetTotal = f.new; else S.upd.budget[f.k] = f.new; rec(it, f); });
  });
  sel.filter(it => it.ent === 'readiness').forEach(it => {
    const prev = M.declared || {}, v = { plan: prev.plan ?? null, fact: prev.fact ?? null, status: prev.status || null, comment: prev.comment || null };
    it.fields.forEach(f => { v[f.k] = f.new; rec(it, f); });
    S.upd.readiness.push({ ...v, calcPlan: r1(M.root.planNow), calcFact: r1(M.root.pc), period: ctx.period, asOf, responsible: ctx.responsible, at: when });
  });
  sel.filter(it => it.ent === 'summary').forEach(it => {
    const v = {}; it.fields.forEach(f => { v[f.k] = f.new; rec(it, f); });
    S.upd.summaries.push({ ...v, period: ctx.period, asOf, responsible: ctx.responsible, at: when });
  });
  // исходный файл — в хранилище файлов браузера (для истории)
  let fileRef = null;
  if (pv.file){ fileRef = { name: pv.file.name, size: pv.file.size, key: null }; try { fileRef.key = await FileStore.put(pv.file); } catch(e){} }
  const counts = {}; sel.forEach(it => { counts[it.kind] = (counts[it.kind] || 0) + 1; });
  S.upd.history.unshift({ id: 'h' + when.toString(36), at: when, period: ctx.period, asOf, user: ctx.responsible || 'Администратор', responsible: ctx.responsible || '', source: pv.source === 'form' ? 'Ручной ввод' : 'Excel-файл',
    file: fileRef, comment: ctx.comment || '', counts, total: sel.length, photos: photosSaved, changes });
  if (S.upd.history.length > 200) S.upd.history.length = 200;
  adminLog('Обновление данных за ' + periodLabel(ctx.period) + ': ' + sel.length + ' изменений');
  // сохранение: один слой правок, журнал факта, договоры, реестры
  adminPersist(); budgetPersist();
  if (Store.db){ newRecs.forEach(r => put('records', r.id, r)); finTouched.forEach(id => put('fin', id, S.fin[id])); put('upd', 'data', S.upd); put('settings', 'project', { budgetTotal: S.settings.budgetTotal ?? null }); }
  else save();
  LS.set('author', ctx.responsible || LS.get('author', ''));
  _wsCache = null;
  build();
  return { applied: sel.length, changes: changes.length };
}

/* Хранилище исходных файлов обновлений (IndexedDB этого браузера) */
const FileStore = {
  db: null,
  open(){ if (this.db) return Promise.resolve(this.db); return new Promise((ok, no) => { try { const r = indexedDB.open('dsflow-update-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => { this.db = r.result; ok(r.result); }; r.onerror = () => no(r.error); } catch(e){ no(e); } }); },
  async put(file){ const db = await this.open(); const id = CFG.id + '-' + Date.now().toString(36); await new Promise((ok, no) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put({ id, project: CFG.id, name: file.name, type: file.type, size: file.size, blob: file, at: Date.now() }); t.oncomplete = ok; t.onerror = () => no(t.error); }); return id; },
  async get(id){ const db = await this.open(); return new Promise((ok, no) => { const r = db.transaction('files').objectStore('files').get(id); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
};

/* ================= EXCEL ================= */
let excelLib = null;
async function excel(){ if (window.ExcelJS) return window.ExcelJS; if (!excelLib) excelLib = loadScript('../assets/vendor/exceljs.min.js'); await excelLib; return window.ExcelJS; }
function download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); }
async function exportFilled(){
  try {
    toast('Готовлю файл с данными проекта…');
    const EX = await excel(), s = snapshot(), P = UP.draft.passport;
    const data = {
      passport: { project: CFG.id, projectName: PROJECT.name, periodType: P.periodType || 'Неделя', from: P.from, to: P.to, asOf: P.asOf, responsible: P.responsible || '' },
      readiness: s.readiness, budget: s.budget,
      works: s.works,
      milestones: s.milestones, contracts: s.contracts, risks: s.risks, events: s.events, photos: [], summary: {}
    };
    const wb = X.buildWorkbook(EX, data, { spareRows: 200, projectLine: 'Проект: ' + PROJECT.name + ' (код ' + CFG.id + '). Данные на ' + fd(M.T) + '. Выгружено из Flow ' + new Date().toLocaleString('ru-RU') + '.' });
    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Flow_' + CFG.id + '_обновление_' + iso(M.T) + '.xlsx');
  } catch(e){ console.error(e); toast('Не удалось сформировать файл: ' + esc(e.message || e)); }
}
async function readFile(file){
  UP.busy = true; render();
  try {
    const EX = await excel(), wb = new EX.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const inc = X.parseWorkbook(wb);
    inc.source = 'excel'; inc.file = file;
    _wsCache = null;
    UP.preview = diff(inc);
    UP.busy = false;
    go('#/admin/update/preview'); render();
  } catch(e){ console.error(e); UP.busy = false; render(); toast('Не удалось прочитать файл. Нужен файл Excel (.xlsx) по стандартному шаблону Flow.'); }
}

/* ================= РУЧНАЯ ФОРМА → входящие данные ================= */
function typed(ent, raw){
  const out = {}, errs = [];
  Object.entries(raw).forEach(([k, v]) => {
    if (k.startsWith('_') || k === 'parentU') return;
    const c = COL(ent, k); if (c.calc && k !== 'id') return;
    const res = X.normValue(c, v, 'form');
    if (res.err) errs.push(c.h + ': ' + res.err); else out[k] = res.v;
  });
  if (errs.length) out._errors = errs;
  return out;
}
function formIncoming(){
  const D = UP.draft, inc = { source: 'form', passport: {}, readiness: {}, budget: {}, summary: {}, works: [], milestones: [], contracts: [], risks: [], events: [], photos: [], errors: [], warnings: [] };
  const pt = typed('passport', D.passport); if (pt._errors) inc.errors.push(...pt._errors.map(t => ({ where: 'Общая информация', text: t })));
  inc.passport = { ...pt, project: CFG.id, projectName: PROJECT.name };
  ['readiness', 'budget', 'summary'].forEach(k => { const t = typed(k, D[k]); if (t._errors) inc.errors.push(...t._errors.map(x => ({ where: ENT_T[k], text: x }))); delete t._errors; Object.keys(t).forEach(x => { if (t[x] === null && !(x in D[k])) delete t[x]; }); inc[k] = t; });
  const W = worksSnap(); _wsCache = W;
  Object.entries(D.edits.works).forEach(([id, raw]) => {
    const r = { ...typed('works', raw), id };
    if (raw.parentU != null){ const p = M.nodes.get(+raw.parentU); if (p){ r.catId = p.code; r.cat = p.name; } }
    inc.works.push(r);
  });
  D.added.works.forEach((raw, i) => { const r = typed('works', raw); if (raw.parentU != null){ const p = M.nodes.get(+raw.parentU); if (p){ r.catId = p.code; r.cat = p.name; } } r._row = 'новая ' + (i + 1); inc.works.push(r); });
  ['milestones', 'contracts', 'risks', 'events'].forEach(ent => {
    Object.entries(D.edits[ent]).forEach(([id, raw]) => inc[ent].push({ ...typed(ent, raw), id }));
    D.added[ent].forEach((raw, i) => inc[ent].push({ ...typed(ent, raw), _row: 'новая ' + (i + 1) }));
  });
  D.photos.forEach((p, i) => inc.photos.push({ _row: i + 1, date: p.date, stage: p.stage || undefined, zone: p.zone || undefined, work: p.work || undefined, desc: p.desc || undefined, file: p.file.name, _blob: p.file }));
  return inc;
}

/* ================= ЭКРАНЫ ================= */
function head(tab){
  return `<div class="head"><div class="ttl"><div class="eyebrow">Режим администрирования · ${esc(PROJECT.name)}</div><h1 style="margin-top:6px">Обновление данных</h1>
    <div class="meta"><span>Периодическое обновление проекта: вручную или стандартным Excel-файлом. Изменения применяются только после проверки «Было → Стало».</span></div></div>
    <div class="head-acts"><button class="btn" type="button" data-go="#/admin">${ico('gear', 16)}Администрирование</button></div></div>
  <div class="seg upd-tabs" role="tablist">${[['upload', 'Загрузить файл', 'Файл'], ['manual', 'Заполнить вручную', 'Вручную'], ['history', 'История обновлений', 'История']].map(([k, t, ts]) => `<button role="tab" type="button" data-go="#/admin/update/${k}" aria-selected="${tab === k || (tab === 'preview' && k === (UP.preview && UP.preview.source === 'form' ? 'manual' : 'upload'))}"><span class="upd-tl">${t}</span><span class="upd-ts">${ts}</span></button>`).join('')}</div>`;
}
const crumbs = t => [{ t: PROJECT.name, go: '#/' }, { t: 'Администрирование', go: '#/admin', mid: true }, { t: 'Обновление данных', go: t ? '#/admin/update' : null }, ...(t ? [{ t }] : [])];
function view(sub){
  if (!UI.admin) return { crumbs: crumbs(), nav: '#/admin', html: `<section class="panel"><div class="pad"><div class="empty-block"><b>Раздел администрирования</b><span>Обновление данных проекта доступно в режиме администрирования.</span><button class="btn primary" type="button" data-act="admin">${ico('gear', 16)}Войти в режим администрирования</button></div></div></section>` };
  if (sub === 'preview' && !UP.preview) sub = 'upload';
  const v = sub === 'manual' ? viewManual() : sub === 'history' ? viewHistory() : sub === 'preview' ? viewPreview() : viewUpload();
  return { crumbs: crumbs(v.t), nav: '#/admin', html: head(sub) + v.html, after: v.after };
}

function viewUpload(){
  const html = `
  <div class="upd-steps">
    <section class="panel"><header><h2>1. Шаблон</h2></header><div class="pad upd-step">
      <p class="muted">Стандартный Excel-файл Flow: паспорт обновления, готовность, работы, вехи, бюджет, договоры, риски, события, фото и итог периода. Лист «Работы» не содержит фиксированного набора строк — каждая строка это работа проекта.</p>
      <div class="upd-btns"><button class="btn primary" type="button" data-act="upd-export">${ico('down')}Шаблон с данными проекта</button><a class="btn" href="../assets/templates/dsflow-update-template.xlsx" download="Flow_шаблон_обновления.xlsx">${ico('doc')}Пустой шаблон</a></div>
      <p class="faint" style="font-size:12.5px">Шаблон с данными уже содержит код проекта, все работы, вехи, договоры и риски с их ID — ответственному остаётся изменить значения и дописать новые строки.</p>
    </div></section>
    <section class="panel"><header><h2>2. Загрузка</h2></header><div class="pad upd-step">
      <label class="upd-drop" for="upd-file" data-drop="1">${UP.busy ? '<b>Читаю файл…</b>' : `${ico('up', 22)}<b>Выберите заполненный файл</b><span>или перетащите его сюда · .xlsx</span>`}</label>
      <input id="upd-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      <p class="faint" style="font-size:12.5px">Flow определит проект и период, сопоставит строки с данными проекта и покажет изменения. Ничего не применяется без подтверждения.</p>
    </div></section>
  </div>
  <section class="panel"><header><h2>Как проходит обновление</h2></header><div class="pad"><ol class="upd-flow">
    <li><b>Ответственный заполняет Excel</b><span>Сайт ему не нужен: файл самодостаточный, с инструкцией и выпадающими списками.</span></li>
    <li><b>Файл загружается здесь</b><span>Проект и период определяются по паспорту обновления.</span></li>
    <li><b>Проверка «Было → Стало»</b><span>Новые сущности, изменённые значения, изменённые статусы и строки, которые не удалось однозначно сопоставить.</span></li>
    <li><b>Подтверждение</b><span>Обзор, готовность, график, календарь, бюджет и договоры, фотохроника и остальные разделы обновляются сразу.</span></li>
    <li><b>История</b><span>Каждое обновление сохраняется с исходным файлом, старыми и новыми значениями.</span></li></ol></div></section>`;
  return { html, after: bindUpload };
}
function bindUpload(){
  const inp = document.getElementById('upd-file'), drop = document.querySelector('[data-drop]');
  if (inp) inp.addEventListener('change', () => { if (inp.files[0]) readFile(inp.files[0]); });
  if (drop){
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('on'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  }
}

/* ---------- экран проверки ---------- */
function viewPreview(){
  const pv = UP.preview, P = pv.passport, ctx = pv.ctx;
  const cnt = k => pv.items.filter(it => it.kind === k).length;
  const blocking = pv.errors.length > 0;
  const sel = pv.items.filter(it => it.include && !['error', 'same', 'unmatched'].includes(it.kind));
  const ents = ['works', 'milestones', 'contracts', 'risks', 'events', 'budget', 'readiness', 'summary', 'photos'];
  const val = (it, f, which) => disp(it.ent, f.k, f[which]);
  const block = ent => {
    const list = pv.items.filter(it => it.ent === ent && it.kind !== 'same');
    const same = pv.items.filter(it => it.ent === ent && it.kind === 'same').length;
    if (!list.length && !same) return '';
    const rows = list.map(it => {
      const i = pv.items.indexOf(it), k = KIND[it.kind] || KIND.changed;
      const can = !['error', 'same', 'unmatched'].includes(it.kind);
      const fr = it.fields.length ? it.fields : [{ k: '', label: '—', old: null, new: null }];
      return fr.map((f, j) => `<tr class="${it.include && can ? '' : 'upd-off'}">
        ${j === 0 ? `<td rowspan="${fr.length}" class="l upd-c"><input type="checkbox" data-act="upd-inc" data-i="${i}" ${it.include && can ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="Применить"></td>
        <td rowspan="${fr.length}" class="l wrap upd-ent"><b>${esc(it.name || '—')}</b><div class="faint" style="font-size:11.5px">${esc([it.id || it.newId, it.row ? 'строка ' + it.row : ''].filter(Boolean).join(' · '))}</div>
          <div style="margin-top:6px">${chip(k[0], k[1])}</div>
          ${it.notes.length ? `<ul class="upd-notes">${it.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${it.resolve && (it.kind === 'unmatched' || it.resolve.locked) ? `<select class="adm-select upd-res" data-act="upd-res" data-i="${i}" aria-label="Решение">${it.resolve.options.map(o => `<option value="${esc(o.v)}" ${o.v === it.resolve.value ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>` : ''}</td>` : ''}
        <td class="l">${esc(f.label)}</td><td class="l wrap upd-old">${f.k ? esc(val(it, f, 'old')) : ''}</td><td class="upd-arr">${f.k ? '→' : ''}</td><td class="l wrap upd-new">${f.k ? esc(val(it, f, 'new')) : ''}</td></tr>`).join('');
    }).join('');
    return `<section class="panel"><header><h2>${ENT_T[ent]}</h2><span class="sub">${list.length ? list.length + ' ' + plural(list.length, 'запись', 'записи', 'записей') + ' с изменениями' : ''}${same ? (list.length ? ' · ' : '') + same + ' без изменений' : ''}</span></header>
      ${list.length ? `<div class="tbl-wrap"><table class="t upd-t" style="min-width:880px"><thead><tr><th class="l"></th><th class="l">Сущность</th><th class="l">Поле</th><th class="l">Было</th><th></th><th class="l">Стало</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="pad"><p class="faint" style="font-size:13px">Все значения совпадают с данными проекта.</p></div>'}
      ${ent === 'photos' && pv.items.some(it => it.ent === 'photos' && it.kind === 'unmatched') ? `<div class="pad" style="padding-top:12px"><label class="btn sm" for="upd-ph">${ico('up')}Приложить файлы фото</label><input id="upd-ph" type="file" accept="image/*" multiple hidden></div>` : ''}
    </section>`;
  };
  const html = `
  <section class="panel"><header><h2>Проверка изменений · Было → Стало</h2><span class="sub">${pv.source === 'form' ? 'ручной ввод' : 'файл ' + esc(pv.file ? pv.file.name : '')}</span></header>
    <div class="pad" style="display:flex; flex-direction:column; gap:14px">
      <dl class="kv upd-kv"><dt>Проект</dt><dd>${esc(PROJECT.name)} · код ${esc(CFG.id)}${P.project ? '' : pv.source === 'form' ? '' : ' (по названию)'}</dd>
        <dt>Отчётный период</dt><dd>${ctx.period.from ? esc(periodLabel(ctx.period)) : '—'}</dd><dt>Дата актуальности</dt><dd>${ctx.asOf ? fd(dn(ctx.asOf)) : '—'}</dd>
        <dt>Ответственный</dt><dd>${esc(ctx.responsible || '—')}</dd>${ctx.comment ? `<dt>Комментарий</dt><dd>${esc(ctx.comment)}</dd>` : ''}</dl>
      ${pv.errors.length ? `<div class="note crit"><b>Обновление нельзя применить:</b><ul>${pv.errors.map(e => `<li>${esc(e.where)}: ${esc(e.text)}</li>`).join('')}</ul></div>` : ''}
      ${pv.warnings.length ? `<div class="note warn"><ul style="margin:0">${pv.warnings.map(e => `<li>${esc(e.where)}: ${esc(e.text)}</li>`).join('')}</ul></div>` : ''}
      <div class="tiles">
        <div class="tile"><div class="eyebrow">Новые сущности</div><div class="v">${cnt('new')}</div></div>
        <div class="tile warn"><div class="eyebrow">Изменено</div><div class="v">${cnt('changed')}</div></div>
        <div class="tile good"><div class="eyebrow">Изменён статус</div><div class="v">${cnt('status')}</div></div>
        <div class="tile ${cnt('unmatched') ? 'crit' : ''}"><div class="eyebrow">Не удалось однозначно сопоставить</div><div class="v">${cnt('unmatched')}</div><div class="s">применяются только после вашего решения</div></div>
        <div class="tile ${cnt('error') ? 'crit' : ''}"><div class="eyebrow">Ошибки в строках</div><div class="v">${cnt('error')}</div><div class="s">не применяются</div></div>
        <div class="tile"><div class="eyebrow">Без изменений</div><div class="v">${cnt('same')}</div></div>
      </div>
    </div></section>
  ${ents.map(block).join('')}
  <div class="upd-bar"><span class="faint">${blocking ? 'Исправьте ошибки паспорта и загрузите файл снова.' : sel.length ? 'К применению: ' + sel.length + ' ' + plural(sel.length, 'сущность', 'сущности', 'сущностей') : 'Нечего применять'}</span><span style="flex:1"></span>
    <button class="btn" type="button" data-act="upd-cancel">Отмена</button><button class="btn primary" type="button" data-act="upd-apply" ${blocking || !sel.length ? 'disabled' : ''}>Применить обновление</button></div>`;
  return { t: 'Проверка', html, after: () => { const ph = document.getElementById('upd-ph'); if (ph) ph.addEventListener('change', () => { UP.photoFiles.push(...ph.files); pv.items.filter(it => it.ent === 'photos' && it.kind === 'unmatched').forEach(it => { const f = UP.photoFiles.find(x => x.name === it.inc.file); if (f){ it.blob = f; it.kind = 'new'; it.include = true; it.notes = it.notes.filter(n => !n.startsWith('файл')); } }); render(); }); } };
}

/* ---------- ручная форма ---------- */
function inputFor(ent, id, c, value, opts = {}){
  const t = c.type || 'text', a = `data-ue="${ent}" data-uid="${esc(id)}" data-uf="${c.k}"`, v = value == null ? '' : value;
  const lab = opts.label ? '' : ` aria-label="${esc(c.h)}"`;
  if (t === 'date') return `<input type="date" ${a}${lab} value="${esc(String(v).slice(0, 10))}">`;
  if (t === 'long') return `<textarea ${a}${lab} rows="${opts.rows || 2}">${esc(v)}</textarea>`;
  if (t === 'list' && !c.soft) return `<select ${a}${lab}><option value="">—</option>${X.LISTS[c.list].map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  if (t === 'list') return `<input type="text" list="upd-dl-${c.list}" ${a}${lab} value="${esc(v)}">`;
  if (t === 'num' || t === 'money' || t === 'pct') return `<input type="text" inputmode="decimal" ${a}${lab} value="${esc(typeof v === 'number' ? String(r1n(v)).replace('.', ',') : v)}">`;
  return `<input type="text" ${a}${lab} value="${esc(v)}">`;
}
const r1n = v => Math.round(v * 1000) / 1000;
const dv = (ent, id, k, cur) => { const D = UP.draft, e = (D.edits[ent] || {})[id]; return e && k in e ? e[k] : cur; };
function kvBlock(ent, keys, cur){
  const D = UP.draft[ent];
  return `<div class="upd-kvf">${keys.map(k => { const c = COL(ent, k); const v = k in D ? D[k] : cur ? cur[k] : null; return `<div class="fld ${c.type === 'long' ? 'upd-wide' : ''}"><label>${esc(c.h.replace(/, ₽$/, ', ₽'))}</label>${inputFor(ent, '_', c, v, { label: true, rows: 3 })}${c.hint && !c.calc ? `<span class="hint">${esc(c.hint)}</span>` : ''}</div>`; }).join('')}</div>`;
}
function sec(key, title, sub, body, count){
  const op = UP.open.has(key);
  return `<section class="panel upd-sec"><header class="link" data-act="upd-tog" data-k="${key}" aria-expanded="${op}"><span class="sec-chev" style="display:inline-block; transform:rotate(${op ? 90 : 0}deg)">${ico('chev', 12)}</span><h2>${title}</h2>${count ? `<span class="chip accent">${count}</span>` : ''}<span class="sub">${sub}</span></header>${op ? body : ''}</section>`;
}
const draftCount = ent => Object.keys(UP.draft.edits[ent] || {}).length + (UP.draft.added[ent] || []).length;
function worksTable(){
  const f = UP.f, D = UP.draft, P = D.passport;
  const W = worksSnap(); _wsCache = W;
  const from = dn(P.from || iso(M.T)), to = dn(P.to || iso(M.T));
  const q = f.q.trim().toLowerCase();
  const inStage = f.stage === 'all' ? null : new Set(M.nodes.get(+f.stage) ? M.nodes.get(+f.stage).leafs : []);
  let list = W.filter(w => {
    if (q && !(w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q) || (w.cat || '').toLowerCase().includes(q))) return false;
    if (inStage && !inStage.has(w.u)) return false;
    if (D.edits.works[w.id]) return true;
    if (f.scope === 'period'){ const s = dn(w.s), e = dn(w.f); return !w.gone && ((s != null && e != null && s <= to && e >= from) || (w.pc > 0 && w.pc < 100)); }
    if (f.scope === 'late') return !w.gone && w.status !== 'Завершена' && ((dn(w.f) < M.T) || (w.dev != null && w.dev < -0.5));
    if (f.scope === 'hidden') return w.gone;
    return true;
  });
  const total = list.length; list = list.slice(0, f.limit);
  const cols = ['name', 'uom', 'qTotal', 'qPeriod', 'qCum', 'pc', 's', 'f', 'fc', 'status', 'comment'].map(k => COL('works', k));
  const row = (id, cur, isNew) => {
    const val = k => isNew ? D.added.works.find(x => x._tmp === id)[k] : dv('works', id, k, k === 'qPeriod' ? null : cur[k]);
    const ent = isNew ? 'works+' : 'works';
    const par = isNew ? D.added.works.find(x => x._tmp === id).parentU : dv('works', id, 'parentU', cur.parentU);
    const edited = !isNew && D.edits.works[id];
    return `<tr class="${edited ? 'upd-edited' : ''} ${isNew ? 'upd-newrow' : ''}"><td class="l faint" style="font-size:11.5px">${isNew ? 'новая' : esc(id)}</td>
      <td class="l">${inputFor(ent, id, cols[0], val('name'))}<div class="faint" style="font-size:11px; margin-top:3px">${isNew ? '' : 'план на сегодня ' + fpct(cur.planNow ?? 0, 1) + ' · откл. ' + (cur.dev == null ? '—' : fp(cur.dev, 1) + ' п.п.')}</div></td>
      <td class="l"><select data-ue="${ent}" data-uid="${esc(id)}" data-uf="parentU" aria-label="Категория / этап"><option value="">—</option>${stageOptions(par != null ? +par : null)}</select></td>
      ${cols.slice(1).map(c => `<td>${inputFor(ent, id, c, val(c.k))}</td>`).join('')}
      ${isNew ? `<td><button class="icon-btn sm" type="button" data-act="upd-rm" data-ent="works" data-id="${esc(id)}" aria-label="Убрать строку">${ico('x', 14)}</button></td>` : '<td></td>'}</tr>`;
  };
  const stages = stageRows();
  return `<div class="gt-tools">
      <label class="search">${ico('search')}<input type="search" id="upd-q" placeholder="Поиск работы, ID или этапа" value="${esc(f.q)}" aria-label="Поиск работы"></label>
      <select id="upd-stage" class="adm-select" aria-label="Этап"><option value="all">Все этапы</option>${stages.map(n => `<option value="${n.u}" ${String(n.u) === String(f.stage) ? 'selected' : ''}>${esc(shortName(n.name).slice(0, 60))}</option>`).join('')}</select>
      <select id="upd-scope" class="adm-select" aria-label="Какие работы"><option value="period" ${f.scope === 'period' ? 'selected' : ''}>Актуальные в периоде</option><option value="late" ${f.scope === 'late' ? 'selected' : ''}>С отставанием</option><option value="all" ${f.scope === 'all' ? 'selected' : ''}>Все работы</option><option value="hidden" ${f.scope === 'hidden' ? 'selected' : ''}>Скрытые и архивные</option></select>
      <span class="faint" style="font-size:12px">Показано ${list.length} из ${total}</span><span style="flex:1"></span>
      <button class="btn sm primary" type="button" data-act="upd-add" data-ent="works">${ico('plus')}Добавить работу</button></div>
    <div class="tbl-wrap"><table class="t upd-ft" style="min-width:1880px"><thead><tr><th class="l">ID</th><th class="l" style="min-width:260px">Наименование</th><th class="l" style="min-width:200px">Категория / этап</th>${cols.slice(1).map(c => `<th class="l">${esc(c.h)}</th>`).join('')}<th></th></tr></thead>
    <tbody>${D.added.works.map(x => row(x._tmp, null, true)).join('')}${list.map(w => row(w.id, w, false)).join('') || (D.added.works.length ? '' : '<tr><td colspan="14" class="l"><div class="empty">Работ по фильтру нет. Выберите «Все работы» или добавьте новую.</div></td></tr>')}</tbody></table></div>
    ${total > list.length ? `<div class="pad" style="padding-top:10px"><button class="btn sm" type="button" data-act="upd-more">Показать ещё ${Math.min(40, total - list.length)}</button></div>` : ''}
    <p class="faint upd-help">Изменяйте значения прямо в таблице. Если указаны общий объём и накопленный факт, % выполнения Flow рассчитает сам. «Факт за период» прибавляется к накопленному. Завершить работу — статус «Завершена»; убрать — «Скрыта» или «В архиве».</p>`;
}
function regTable(ent, cur, keys){
  const D = UP.draft, cols = keys.map(k => COL(ent, k));
  const row = (id, c, isNew) => { const e = isNew ? 'ent+' : ''; const val = k => isNew ? D.added[ent].find(x => x._tmp === id)[k] : dv(ent, id, k, c[k]);
    return `<tr class="${!isNew && D.edits[ent][id] ? 'upd-edited' : ''} ${isNew ? 'upd-newrow' : ''}"><td class="l faint" style="font-size:11.5px">${isNew ? 'новая' : esc(id)}</td>${cols.map(cc => `<td class="${cc.type === 'long' || cc.k === 'name' || cc.k === 'desc' || cc.k === 'action' ? 'l' : ''}">${inputFor(isNew ? ent + '+' : ent, id, cc, val(cc.k))}</td>`).join('')}
    <td>${isNew ? `<button class="icon-btn sm" type="button" data-act="upd-rm" data-ent="${ent}" data-id="${esc(id)}" aria-label="Убрать строку">${ico('x', 14)}</button>` : ''}</td></tr>`; };
  return `<div class="gt-tools"><span class="faint" style="font-size:12px">${cur.length} в проекте</span><span style="flex:1"></span><button class="btn sm primary" type="button" data-act="upd-add" data-ent="${ent}">${ico('plus')}Добавить</button></div>
    <div class="tbl-wrap"><table class="t upd-ft" style="min-width:${Math.max(900, keys.length * 150)}px"><thead><tr><th class="l">ID</th>${cols.map(c => `<th class="l">${esc(c.h)}</th>`).join('')}<th></th></tr></thead>
    <tbody>${D.added[ent].map(x => row(x._tmp, null, true)).join('')}${cur.map(c => row(c.id, c, false)).join('') || (D.added[ent].length ? '' : `<tr><td colspan="${keys.length + 2}" class="l faint">Записей пока нет.</td></tr>`)}</tbody></table></div>`;
}
function viewManual(){
  const D = UP.draft, R = readinessSnap(), B = budgetSnap();
  const photoRows = D.photos.map((p, i) => `<tr><td class="l">${esc(p.file.name)}</td><td>${fd(dn(p.date))}</td><td class="l">${esc(p.stage || '—')}</td><td class="l">${esc(p.zone || '—')}</td><td class="l">${esc(p.work || '—')}</td><td class="l wrap">${esc(p.desc || '')}</td><td><button class="icon-btn sm" type="button" data-act="upd-ph-rm" data-i="${i}" aria-label="Убрать">${ico('x', 14)}</button></td></tr>`).join('');
  const stagesDl = `<datalist id="upd-dl-stage">${stageRows().map(n => `<option value="${esc(shortName(n.name))}">`).join('')}</datalist>`;
  const html = `
  ${Object.entries(X.LISTS).filter(([k]) => k === 'units').map(([k, arr]) => `<datalist id="upd-dl-${k}">${arr.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`).join('')}${stagesDl}
  <p class="note">Форма обновляет проект целиком: общая информация, готовность, работы, вехи, бюджет, договоры, риски, события, фото и итог периода. Меняйте только то, что изменилось за период — остальное останется как есть. Черновик сохраняется в этом браузере до применения.</p>
  ${sec('passport', '1. Общая информация', 'проект, отчётный период, дата актуальности, ответственный', `<div class="pad">${`<div class="upd-kvf"><div class="fld"><label>Проект</label><input type="text" value="${esc(PROJECT.name)} · ${esc(CFG.id)}" disabled></div></div>`}${kvBlock('passport', ['periodType', 'from', 'to', 'asOf', 'responsible', 'comment'], null)}</div>`)}
  ${sec('readiness', '2. Общая готовность проекта', `по расчёту Flow: факт ${fpct(R.calcFact, 1)} · план ${fpct(R.calcPlan, 1)} · отклонение ${fp(R.dev, 1)} п.п.`, `<div class="pad"><p class="faint" style="font-size:12.5px; margin-bottom:10px">Flow рассчитывает готовность сам по работам. Здесь можно зафиксировать оценку ответственного — она сохранится за период и будет видна рядом с расчётом.</p>${kvBlock('readiness', ['plan', 'fact', 'status', 'comment'], { plan: R.plan, fact: R.fact, status: R.status, comment: R.comment })}</div>`)}
  ${sec('works', '3. Работы', 'динамический перечень: добавить, изменить, завершить, скрыть, архивировать, восстановить', worksTable(), draftCount('works'))}
  ${sec('milestones', '4. Ключевые вехи', 'название, категория, плановая и фактическая даты, статус', regTable('milestones', milestonesSnap(), ['name', 'cat', 'plan', 'fact', 'status', 'key', 'ref', 'comment']), draftCount('milestones'))}
  ${sec('budget', '5. Бюджет', 'пустое поле «законтрактовано / оплачено / освоено» — расчёт по договорам', `<div class="pad">${kvBlock('budget', ['total', 'approved', 'contracted', 'paid', 'spent', 'forecast', 'comment'], B)}</div>`)}
  ${sec('contracts', '6. Договоры', 'реестр договоров проекта', regTable('contracts', contractsSnap(), ['counterparty', 'subject', 'number', 'cat', 'amount', 'date', 'end', 'paid', 'spent', 'status', 'comment']), draftCount('contracts'))}
  ${sec('risks', '7. Риски', 'реестр рисков проекта', regTable('risks', risksSnap(), ['name', 'cat', 'desc', 'prob', 'impact', 'status', 'owner', 'action', 'due', 'comment']), draftCount('risks'))}
  ${sec('events', '8. События', 'ключевые события периода', regTable('events', eventsSnap(), ['date', 'cat', 'name', 'desc', 'impact', 'status']), draftCount('events'))}
  ${sec('photos', '9. Фото', 'дата, этап, зона, связанная работа (если применимо), описание', `<div class="pad"><div class="upd-kvf">
      <div class="fld"><label for="uph-f">Файлы</label><input id="uph-f" type="file" accept="image/*" multiple></div>
      <div class="fld"><label for="uph-d">Дата</label><input id="uph-d" type="date" value="${esc(D.passport.asOf || iso(M.T))}"></div>
      <div class="fld"><label for="uph-s">Этап</label><input id="uph-s" type="text" list="upd-dl-stage"></div>
      <div class="fld"><label for="uph-z">Зона</label><input id="uph-z" type="text" placeholder="Например: оси 1–6"></div>
      <div class="fld"><label for="uph-w">ID связанной работы</label><input id="uph-w" type="text" placeholder="необязательно, например ГП-67"></div>
      <div class="fld"><label for="uph-c">Описание</label><input id="uph-c" type="text"></div></div>
      <div style="margin-top:10px"><button class="btn sm" type="button" data-act="upd-ph-add">${ico('plus')}Добавить к обновлению</button></div>
      ${D.photos.length ? `<div class="tbl-wrap" style="margin-top:12px"><table class="t" style="min-width:760px"><thead><tr><th class="l">Файл</th><th>Дата</th><th class="l">Этап</th><th class="l">Зона</th><th class="l">Работа</th><th class="l">Описание</th><th></th></tr></thead><tbody>${photoRows}</tbody></table></div>` : ''}</div>`, D.photos.length)}
  ${sec('summary', '10. Итог периода', 'что произошло, отклонения, причины, меры, прогноз, вопросы руководителю', `<div class="pad">${kvBlock('summary', X.SHEET.summary.rows.map(r => r.k), null)}</div>`)}
  <div class="upd-bar"><button class="btn" type="button" data-act="upd-reset">Очистить<span class="upd-tl">&nbsp;форму</span></button><span style="flex:1"></span><button class="btn primary" type="button" data-act="upd-check">Проверить изменения ${ico('right')}</button></div>`;
  return { t: 'Заполнить вручную', html, after: bindManual };
}
function bindManual(){
  const q = document.getElementById('upd-q'), st = document.getElementById('upd-stage'), sc = document.getElementById('upd-scope');
  if (q) q.addEventListener('input', () => { UP.f.q = q.value; UP.f.limit = 40; const pos = q.selectionStart, y = window.scrollY; render(); window.scrollTo(0, y); const n = document.getElementById('upd-q'); if (n){ n.focus(); n.setSelectionRange(pos, pos); } });
  if (st) st.addEventListener('change', () => { UP.f.stage = st.value; UP.f.limit = 40; keep(); });
  if (sc) sc.addEventListener('change', () => { UP.f.scope = sc.value; UP.f.limit = 40; keep(); });
}
const keep = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
document.addEventListener('input', onField, true);
document.addEventListener('change', onField, true);
function onField(e){
  const el = e.target.closest && e.target.closest('[data-ue]'); if (!el) return;
  const ent = el.dataset.ue, id = el.dataset.uid, k = el.dataset.uf, D = UP.draft;
  if (ent.endsWith('+')){ const E = ent.slice(0, -1); const x = D.added[E].find(y => y._tmp === id); if (x) x[k] = el.value; }
  else if (id === '_') D[ent][k] = el.value;
  else { const m = D.edits[ent][id] = D.edits[ent][id] || {}; m[k] = el.value; el.closest('tr') && el.closest('tr').classList.add('upd-edited'); }
  saveDraft();
}

/* ---------- история ---------- */
function viewHistory(){
  const H = S.upd.history;
  const done = M.leaves.map(u => M.nodes.get(u)).filter(n => n.u !== -1 && n.pc >= 99.95 && editableNode(n)).sort((a, b) => (b.afE || 0) - (a.afE || 0));
  const arch = Object.entries(S.admin.edits).filter(([, e]) => e.archived && !e.deleted).map(([u]) => +u);
  const html = `
  <section class="panel"><header><h2>История обновлений</h2><span class="sub">${H.length} ${plural(H.length, 'обновление', 'обновления', 'обновлений')} · прошлые данные не перезаписываются: каждое значение хранится со старым и новым вариантом</span></header>
    ${H.length ? `<div class="pad upd-hist">${H.map(h => `<details class="imp"><summary><span class="num faint">${new Date(h.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        <b>${esc(periodLabel(h.period))}</b> · ${esc(h.source)}${h.file ? ' · ' + esc(h.file.name) : ''} · ${esc(h.user)} · изменений: ${h.changes.length}</summary>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin:10px 0">${Object.entries(h.counts || {}).map(([k, v]) => chip((KIND[k] || KIND.changed)[0] + ': ' + v, (KIND[k] || KIND.changed)[1])).join('')}${h.photos ? chip('Фото: ' + h.photos, 'neutral') : ''}
          ${h.file && h.file.key ? `<button class="btn sm" type="button" data-act="upd-file" data-key="${esc(h.file.key)}" data-name="${esc(h.file.name)}">${ico('down')}Исходный файл</button>` : ''}</div>
        <dl class="kv" style="font-size:13px; margin-bottom:10px"><dt>Дата актуальности</dt><dd>${h.asOf ? fd(dn(h.asOf)) : '—'}</dd><dt>Пользователь</dt><dd>${esc(h.user)}</dd><dt>Источник</dt><dd>${esc(h.source)}${h.file ? ' · ' + esc(h.file.name) + ' (' + Math.round((h.file.size || 0) / 1024) + ' КБ)' : ''}</dd>${h.comment ? `<dt>Комментарий</dt><dd>${esc(h.comment)}</dd>` : ''}</dl>
        <div class="tbl-wrap"><table class="t" style="min-width:820px"><thead><tr><th class="l">Сущность</th><th class="l">ID</th><th class="l">Поле</th><th class="l">Было</th><th class="l">Стало</th></tr></thead><tbody>
        ${h.changes.slice(0, 400).map(c => `<tr><td class="l wrap"><b>${esc(c.name || '—')}</b><div class="faint" style="font-size:11.5px">${esc(ENT_ONE[c.ent] || c.ent)}</div></td><td class="l faint">${esc(c.id || '—')}</td><td class="l">${esc(c.field)}</td><td class="l wrap upd-old">${esc(c.old)}</td><td class="l wrap upd-new">${esc(c.new)}</td></tr>`).join('')}
        </tbody></table></div>${h.changes.length > 400 ? `<p class="faint" style="font-size:12px; margin-top:6px">Показаны первые 400 из ${h.changes.length}.</p>` : ''}</details>`).join('')}</div>`
      : '<div class="pad"><div class="empty-block"><b>Обновлений пока не было</b><span>Загрузите Excel-файл или заполните форму — каждое применённое обновление появится здесь.</span></div></div>'}
  </section>
  <div class="grid2e">
    <section class="panel"><header><h2>Завершённые работы</h2><span class="sub">остаются в истории проекта, графике и расчёте готовности</span></header>
      ${done.length ? `<div class="tbl-wrap" style="max-height:420px; overflow:auto"><table class="t"><thead><tr><th class="l">Работа</th><th class="l">Этап</th><th>Окончание</th></tr></thead><tbody>${done.slice(0, 300).map(n => `<tr class="link" data-go="#/work/${n.u}"><td class="l wrap">${esc(n.name)}<div class="faint" style="font-size:11px">${esc(n.code)}</div></td><td class="l faint wrap">${esc(shortName(M.stageOf(n)?.name || ''))}</td><td>${n.afE ? fds(n.afE) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pad faint">Завершённых работ пока нет.</div>'}</section>
    <section class="panel"><header><h2>Архив работ</h2><span class="sub">не показываются в графике; вернуть — статусом в обновлении или в администрировании</span></header>
      ${arch.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th></th></tr></thead><tbody>${arch.map(u => `<tr><td class="l wrap">${esc(admName(u))}<div class="faint" style="font-size:11px">${esc(codeOfU(u))}</div></td><td><button class="btn sm" type="button" data-act="adm-restore" data-u="${u}">Восстановить</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="pad faint">В архиве работ нет.</div>'}</section>
  </div>`;
  return { t: 'История', html };
}

/* ================= ДЕЙСТВИЯ ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act^="upd-"]'); if (!t) return;
  const a = t.dataset.act, D = UP.draft;
  if (!UI.admin && a !== 'upd-file'){ toast('Обновление данных доступно в режиме администрирования.'); return; }
  if (a === 'upd-export') exportFilled();
  else if (a === 'upd-tog'){ const k = t.dataset.k; UP.open.has(k) ? UP.open.delete(k) : UP.open.add(k); keep(); }
  else if (a === 'upd-more'){ UP.f.limit += 40; keep(); }
  else if (a === 'upd-add'){ const ent = t.dataset.ent; D.added[ent].unshift({ _tmp: 'n' + (D.seq++) }); UP.open.add(ent); saveDraft(); keep(); }
  else if (a === 'upd-rm'){ const ent = t.dataset.ent; D.added[ent] = D.added[ent].filter(x => x._tmp !== t.dataset.id); saveDraft(); keep(); }
  else if (a === 'upd-ph-add'){
    const files = [...(document.getElementById('uph-f').files || [])]; if (!files.length) return toast('Выберите файлы фото.');
    const g = id => document.getElementById(id).value.trim();
    if (!g('uph-d')) return toast('Укажите дату фото.');
    files.forEach(f => D.photos.push({ file: f, date: g('uph-d'), stage: g('uph-s'), zone: g('uph-z'), work: g('uph-w'), desc: g('uph-c') }));
    keep();
  }
  else if (a === 'upd-ph-rm'){ D.photos.splice(+t.dataset.i, 1); keep(); }
  else if (a === 'upd-reset') openConfirm('Очистить форму?', 'Все внесённые в форму значения будут сброшены. Данные проекта не изменятся.', () => { UP.draft = blankDraft(); saveDraft(); keep(); }, 'Очистить');
  else if (a === 'upd-check'){ const inc = formIncoming(); UP.preview = diff(inc); go('#/admin/update/preview'); }
  else if (a === 'upd-inc'){ const it = UP.preview.items[+t.dataset.i]; it.include = t.checked; keep(); }
  else if (a === 'upd-cancel'){ const src = UP.preview && UP.preview.source; UP.preview = null; go(src === 'form' ? '#/admin/update/manual' : '#/admin/update/upload'); }
  else if (a === 'upd-apply'){
    const pv = UP.preview, n = pv.items.filter(it => it.include && !['error', 'same', 'unmatched'].includes(it.kind)).length;
    openConfirm('Применить обновление?', `Будет применено изменений: ${n} за период ${periodLabel(pv.ctx.period)}. Все разделы проекта пересчитаются, обновление сохранится в истории.`, async () => {
      const before = { pc: M.root.pc, ff: M.root.ff };
      try {
        const res = await apply(pv);
        if (pv.source === 'form'){ UP.draft = blankDraft(); saveDraft(); }
        UP.preview = null; UP.photoFiles = [];
        go('#/admin/update/history'); render();
        toast(`<b>Обновление применено.</b> Изменений: ${res.changes}. Готовность проекта ${fpct(before.pc, 1)} → <b>${fpct(M.root.pc, 1)}</b>${M.root.ff !== before.ff ? `, прогноз окончания ${fds(before.ff)} → <b>${fds(M.root.ff)}</b>` : ''}.`, [['Обзор', '#/'], ['График', '#/impl/gantt']]);
      } catch(err){ console.error(err); toast('Не удалось применить обновление: ' + esc(err.message || err)); }
    }, 'Применить');
  }
  else if (a === 'upd-file'){ FileStore.get(t.dataset.key).then(r => { if (r && r.blob) download(r.blob, t.dataset.name || r.name); else toast('Исходный файл не найден в этом браузере.'); }, () => toast('Исходный файл недоступен в этом браузере.')); }
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-act="upd-res"]'); if (!t || !UP.preview) return;
  resolveItem(UP.preview.items[+t.dataset.i], t.value); keep();
});

window.DSFUpdate = { view, snapshot, diff, apply: pv => apply(pv), formIncoming, get preview(){ return UP.preview; }, set preview(v){ UP.preview = v; }, readFile, exportFilled, state: UP };
if (/^#\/admin\/update/.test(location.hash)) render();
})();
