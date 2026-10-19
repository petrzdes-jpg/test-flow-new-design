/* DSFlow project engine: one calculation model and one interface for every object.
   Project data (PROJECT, MPP_ROWS, MILESTONES, ...) is declared by the project page before this script. */
/* ================= КОНФИГУРАЦИЯ ОБЪЕКТА =================
   Данные объекта задаёт страница проекта. Здесь — только параметры отображения
   и точки расширения; алгоритмы расчёта и интерфейс одинаковы для всех объектов. */
const CFG = Object.assign({
  id: 'project',
  storagePrefix: 'rmk.',          // префикс ключей браузерного хранилища объекта
  gpRoot: -1,                     // сводная строка ГПР, чьи дочерние строки — этапы (задаёт объект)
  stageRoots: null,               // этапы верхнего уровня; по умолчанию — дочерние строки gpRoot
  stagePrefix: [],                // дополнительные этапы перед этапами ГПР (котлован «Раменок»)
  rangeStart: null,               // начало шкалы Ганта; по умолчанию — месяц старта проекта
  icon: 'assets/icons/icon-192.png',
  planEndLabel: 'Окончание',      // название итогового события (РВЭ, РВ …)
  stageLabel: null,               // подпись текущей стадии, если её нельзя вывести из ГПР
  ganttSource: 'ГПР',
  workforceGo: null,
  mainContract: null,
  budgetNote: '',
  photoWorkDefault: null,
  photoDb: null,                  // имя IndexedDB для загруженных фото
  navData: [],                    // собственный набор раздела «Данные и отчёты»
  baseRecords: [],                // факт из первичных источников объекта (не редактируется)
  hooks: {}
}, typeof PROJECT === 'object' && PROJECT.engine ? PROJECT.engine : {});
const HOOKS = CFG.hooks || {};
/* Короткое название этапа: служебный префикс строк ГПР задаёт объект (CFG.namePrefix), код его не знает. */
const shortName = nm => CFG.namePrefix ? String(nm).replace(new RegExp('^(' + CFG.namePrefix + ')\\s+'), '') : String(nm);
const plural = (n, one, few, many) => { n = Math.abs(n); return n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many; };

/* ================= УТИЛИТЫ ================= */
const DAY = 864e5;
const dn = iso => iso ? Math.round(Date.UTC(+iso.slice(0,4), +iso.slice(5,7)-1, +iso.slice(8,10)) / DAY) : null;
const iso = d => { const x = new Date(d*DAY); return x.toISOString().slice(0,10); };
const fd = d => { if (d == null) return '—'; const s = iso(d); return s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4); };
const fds = d => { if (d == null) return '—'; const s = iso(d); return s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(2,4); };
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v*10)/10;
const fp = (v, dig=0) => v == null || isNaN(v) ? '—' : (dig ? v.toFixed(dig).replace('.', ',') : String(Math.round(v))) ;
const fpct = (v, dig=0) => fp(v, dig) + ' %';
const fmoney = (v, unit='млрд') => {
  if (v == null) return '—';
  if (unit === 'млрд') return (v/1e9).toFixed(2).replace('.', ',') + ' млрд ₽';
  if (unit === 'млн') return (v/1e6).toLocaleString('ru-RU', {maximumFractionDigits:1, minimumFractionDigits:1}) + ' млн ₽';
  return v.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' ₽';
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
const signDays = v => v > 0 ? '+' + v + ' дн.' : v < 0 ? '−' + (-v) + ' дн.' : '0 дн.';
const monthEnd = ym => { const y = +ym.slice(0,4), m = +ym.slice(5,7); return Math.round(Date.UTC(m === 12 ? y+1 : y, m === 12 ? 0 : m, 1)/DAY) - 1; };
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_F = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

/* ================= ХРАНИЛИЩЕ =================
   Store.db — общая база артефакта (видят все участники); без неё — браузер тестировщика. */
const Store = { db: null, assets: null, sample: null, limits: null, ready: false };
const LS = {
  get(k, def){ try { const v = localStorage.getItem(CFG.storagePrefix+k); return v == null ? def : JSON.parse(v); } catch(e){ return def; } },
  set(k, v){ try { localStorage.setItem(CFG.storagePrefix+k, JSON.stringify(v)); } catch(e){} }
};
/* Слой администрирования: правки поверх исходного ГПР. Исходные строки не меняются;
   build() накладывает правки, и все экраны читают один рассчитанный граф M. */
function normBudget(b){ b = b && typeof b === 'object' ? b : {}; return { v: 1, contracts: Array.isArray(b.contracts) ? b.contracts : [], docs: Array.isArray(b.docs) ? b.docs : [], meta: b.meta && typeof b.meta === 'object' ? b.meta : {} }; }
/* Реестры проекта, которые пополняются через «Обновление данных»: вехи, риски, события,
   показатели бюджета, заявленная готовность, итоги периодов и история обновлений.
   Конкретные виды работ, вехи и риски — только данные: код их не перечисляет. */
function normUpd(u){
  u = u && typeof u === 'object' ? u : {};
  const A = k => Array.isArray(u[k]) ? u[k] : [], m = u.milestones && typeof u.milestones === 'object' ? u.milestones : {};
  return { v: 1, milestones: { edits: m.edits && typeof m.edits === 'object' ? m.edits : {}, added: Array.isArray(m.added) ? m.added : [] },
    risks: A('risks'), events: A('events'), budget: u.budget && typeof u.budget === 'object' ? u.budget : {},
    readiness: A('readiness'), summaries: A('summaries'), history: A('history') };
}
function normAdmin(a){ a = a && typeof a === 'object' ? a : {}; return { v: 1, edits: a.edits && typeof a.edits === 'object' ? a.edits : {}, added: Array.isArray(a.added) ? a.added : [], log: Array.isArray(a.log) ? a.log : [] }; }
const S = {
  records: LS.get('records', []),     // WORK_PROGRESS: {id, uid, date, delta, author, note, at}
  baseline: LS.get('baseline', null), // SCHEDULE_VERSION baseline: {at, map:{uid:[s,f]}}
  photos: [],                         // загруженные фото (только в памяти страницы)
  ganttScale: LS.get('ganttScale', 'month'),
  ganttCols: LS.get('ganttCols', false),
  collapsed: LS.get('collapsed', null),
  fin: LS.get('fin', {}),            // поправки финансов из файлов: {contractId: {поле: значение, months:{ym:{plan,fact}}}}
  metrics: LS.get('metrics', {}),    // {workforce:{weeks:{date:{fact,plan}}}, prescriptions:{weeks:{date:{issued,fixed,open}}}}
  airisks: LS.get('airisks', []),    // риски, найденные ИИ в документах
  imports: LS.get('imports', []),    // журнал загрузок
  settings: LS.get('settings', {}),
  budget: normBudget(LS.get('budget', null)),  // договоры, сметы, акты КС-2 и справки КС-3, внесённые в интерфейсе
  admin: normAdmin(LS.get('admin', null)),  // правки графика из режима администрирования (единый слой поверх ГПР)
  upd: normUpd(LS.get('upd', null))         // вехи, риски, события, бюджет, итоги периодов и история обновлений
};
const Theme = {
  get(){ try { const v = localStorage.getItem('dsflow.theme'); if (v === 'dark' || v === 'light') return v; } catch(e){} return LS.get('theme', null); },
  set(v){ try { localStorage.setItem('dsflow.theme', v); } catch(e){} }
};
const save = () => { LS.set('baseline', S.baseline); if (!Store.db){ LS.set('admin', S.admin); LS.set('budget', S.budget); LS.set('upd', S.upd); LS.set('records', S.records); LS.set('fin', S.fin); LS.set('metrics', S.metrics); LS.set('airisks', S.airisks); LS.set('imports', S.imports); LS.set('settings', S.settings); } };

/* ================= РАСЧЁТНЫЙ ДВИЖОК =================
   Хранятся только план (ГПР) и факт (записи). Всё остальное считается здесь на дату среза. */
let M = null;
function build(){
  const nodes = new Map();
  const FILE = dn(PROJECT.fileDate);
  let T = dn(PROJECT.statusDate);
  const BASE = (CFG.baseRecords || []).map(r => ({ ...r, base: true }));
  const ADM = Object.entries(S.admin.edits).filter(([, e]) => e.pcSet != null && e.pcDate).map(([u, e]) => ({ id: 'adm-' + u, uid: +u, date: e.pcDate, set: e.pcSet, at: e.pcAt || 0, admin: true, author: 'Администрирование', note: e.pcNote || 'Установлен процент выполнения' }));
  [...BASE, ...S.records, ...ADM].forEach(r => { T = Math.max(T, dn(r.date)); });

  const AE = S.admin.edits, rows = adminRows(), rowIdx = new Map(rows.map((r, i) => [r[0], i]));
  for (const r of rows){
    const [u, mid, parent, name, s, f, as, af, pc, du, sm, cr, pr] = r;
    nodes.set(u, { u, mid, parent, name, s0: dn(s), f0: dn(f), as0: dn(as), af0: dn(af), pc0: pc, du: du, sm: !!sm, cr: !!cr,
      preds: pr.map(p => ({ u: p[0], type: p[1], lag: p[2] })), succs: [], kids: [], code: r[13] ? 'ДОБ-' + (u - ADMIN_UID0) : 'ГП-' + u, added: !!r[13] });
  }
  for (const e of EXTRA_NODES){
    nodes.set(e.u, { u: e.u, mid: null, parent: e.parent, name: e.name, s0: dn(e.s), f0: dn(e.f), as0: dn(e.as), af0: dn(e.af),
      pc0: e.pc ?? 0, du: e.du ?? 0, sm: !!e.summary, cr: false, preds: [], succs: [], kids: [], code: e.code || (e.u === -1 ? 'PRJ' : 'ДОП' + e.u) });
  }
  // работы модели, которых нет в ГПР: отдельные строки Ганта в группе «Вне ГПР» (единый ID с моделью)
  const modelNode = {};
  let mSeq = 0;
  (PROGRESS_MODEL ? PROGRESS_MODEL.sections : []).forEach(sec => sec.works.forEach(w => [w, ...(w.subworks || [])].forEach(x => {
    if (!x.model) return;
    if (!nodes.has(-10)) nodes.set(-10, { u: -10, mid: null, parent: -1, name: 'Работы вне ГПР (модель БЦ)', s0: null, f0: null, as0: null, af0: null, pc0: 0, du: 0, sm: true, cr: false, preds: [], succs: [], kids: [], code: 'МОД' });
    const u = -100 - (mSeq++), s0 = dn(x.model.s), f0 = dn(x.model.f);
    nodes.set(u, { u, mid: null, parent: -10, name: x.name, s0, f0, as0: null, af0: null, pc0: 0, du: Math.max(1, Math.round((f0 - s0) * 5 / 7)), sm: false, cr: false, preds: [], succs: [], kids: [], code: x.id });
    modelNode[x.id] = u;
  })));
  // скрытые и удалённые работы (вместе с вложенными) в расчёт и отображение не попадают
  const gone = new Set(Object.keys(AE).filter(k => AE[k].hidden || AE[k].deleted).map(Number));
  if (gone.size){
    const isGone = n => { for (let x = n, i = 0; x && i < 60; x = nodes.get(x.parent), i++) if (gone.has(x.u)) return true; return false; };
    [...nodes.values()].filter(isGone).forEach(n => nodes.delete(n.u));
  }
  for (const n of nodes.values()){
    if (n.parent != null && nodes.has(n.parent)) nodes.get(n.parent).kids.push(n.u);
    n.preds = n.preds.filter(p => nodes.has(p.u));
    for (const p of n.preds) nodes.get(p.u).succs.push({ u: n.u, type: p.type, lag: p.lag });
  }
  // порядок внутри этапа: правка администратора или порядок исходного файла
  const okey = u => AE[u] && AE[u].order != null ? AE[u].order : (rowIdx.has(u) ? rowIdx.get(u) : -1e6 + u);
  for (const n of nodes.values()) if (n.kids.length > 1) n.kids.sort((a, b) => okey(a) - okey(b));
  // сводная строка без видимых работ ведёт себя как работа; сроки сводных строк над правками — по вложенным работам
  for (const n of nodes.values()) if (n.sm && !n.kids.length && n.u !== -1){ n.sm = false; }
  const parentOf = new Map(rows.map(r => [r[0], r[2]]));
  const dirty = new Set();
  const markUp = p => { for (let i = 0; p != null && nodes.has(p) && i < 60; p = nodes.get(p).parent, i++) dirty.add(p); };
  Object.keys(AE).forEach(k => { const e = AE[k]; if (e.s !== undefined || e.f !== undefined || e.du != null || e.parent != null || e.hidden || e.deleted){ markUp(parentOf.get(+k)); if (e.fromParent != null) markUp(e.fromParent); } });
  S.admin.added.forEach(x => markUp(parentOf.get(x.u)));
  const root = nodes.get(-1);
  // уровни и порядок обхода
  const order = [];
  (function walk(u, lvl){ const n = nodes.get(u); n.lvl = lvl; order.push(u); n.kids.forEach(k => walk(k, lvl+1)); })(-1, 0);
  for (let i = order.length - 1; i >= 0; i--){
    const n = nodes.get(order[i]);
    if (!n.sm || !dirty.has(n.u) || n.u === -1) continue;
    const ks = n.kids.map(k => nodes.get(k)).filter(k => k.s0 != null && k.f0 != null);
    if (ks.length){ n.s0 = Math.min(...ks.map(k => k.s0)); n.f0 = Math.max(...ks.map(k => k.f0)); }
  }
  // объём, единица, количество: правка администратора или данные объекта
  for (const n of nodes.values()){
    const e = AE[n.u] || {}, v = (CFG.volumes || {})[n.u] || {};
    n.uom = e.uom !== undefined ? e.uom : v.unit ?? null;
    n.qP = e.qP !== undefined ? e.qP : v.plan ?? null;
    n.qF = e.qF !== undefined ? e.qF : v.fact ?? null;
    n.cnt = e.cnt !== undefined ? e.cnt : v.count ?? null;
    n.adm = AE[n.u] || null;
    // сведения ответственного из «Обновления данных»: плановый объём на дату, прогноз окончания, комментарий
    n.qPl = e.qPl !== undefined ? e.qPl : null;
    n.fcDecl = e.fcF || null;
    n.cmt = e.comment || '';
  }

  // ---- 1. факт листьев: ГПР + записи ----
  const recs = [...BASE, ...S.records, ...ADM].sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at || 0) - (b.at || 0));
  for (const u of order){
    const n = nodes.get(u);
    if (n.sm) continue;
    n.pc = n.pc0; n.hist = []; n.recs = [];
    if (n.pc0 >= 100){
      n.hist.push([n.as0 ?? n.s0, 0], [n.af0 ?? n.f0, 100]);
    } else if (n.pc0 > 0){
      const st = Math.min(n.as0 ?? n.s0, FILE - 7);
      n.hist.push([st, 0], [Math.min(FILE, T), n.pc0]);
    }
    n.asE = n.pc0 > 0 ? (n.as0 ?? n.s0) : null;
    n.afE = n.pc0 >= 100 ? (n.af0 ?? n.f0) : null;
  }
  for (const r of recs){
    const n = nodes.get(r.uid); if (!n || n.sm) continue;
    const d = dn(r.date);
    if (!n.hist.length) n.hist.push([Math.min(d - 1, Math.max(n.s0, d - 7)), 0]);
    n.pc = r.set != null ? clamp(r.set, 0, 100) : clamp(n.pc + r.delta, 0, 100);
    n.hist.push([d, n.pc]);
    n.recs.push(r);
    if (n.asE == null && n.pc > 0) n.asE = d;
    if (n.pc >= 100 && n.afE == null) n.afE = d;
    if (n.pc < 100) n.afE = null;
  }

  // ---- 2. прогноз: оставшийся объём с плановой интенсивностью + связи ----
  const leaves = order.filter(u => !nodes.get(u).sm);
  const sumRange = () => {
    for (let i = order.length - 1; i >= 0; i--){
      const n = nodes.get(order[i]); if (!n.sm) continue;
      let fs = Infinity, ff = -Infinity, s0 = Infinity, f0 = -Infinity;
      n.kids.forEach(k => { const c = nodes.get(k); fs = Math.min(fs, c.fs); ff = Math.max(ff, c.ff); s0 = Math.min(s0, c.s0); f0 = Math.max(f0, c.f0); });
      n.fs = fs; n.ff = ff; if (n.s0 == null) n.s0 = s0; if (n.f0 == null) n.f0 = f0;
    }
  };
  for (const u of leaves){ const n = nodes.get(u); n.fs = n.s0; n.ff = n.f0; }
  sumRange();
  const wd = lag => Math.round(lag * 7 / 5);
  for (let it = 0; it < 40; it++){
    let changed = false;
    for (const u of leaves){
      const n = nodes.get(u), cd = n.f0 - n.s0;
      let fs, ff;
      if (n.pc >= 100){ fs = n.asE ?? n.s0; ff = n.afE ?? n.f0; }
      else if (n.pc > 0){ fs = n.asE ?? n.s0; ff = Math.max(n.f0, T + Math.round((1 - n.pc/100) * cd)); }
      else {
        fs = Math.max(n.s0, T);
        for (const p of n.preds){
          const pn = nodes.get(p.u);
          if (p.type === 'FS') fs = Math.max(fs, pn.ff + 1 + wd(p.lag));
          else if (p.type === 'SS') fs = Math.max(fs, pn.fs + wd(p.lag));
        }
        ff = fs + cd;
        for (const p of n.preds){ if (p.type === 'FF') ff = Math.max(ff, nodes.get(p.u).ff + wd(p.lag)); }
      }
      if (fs !== n.fs || ff !== n.ff){ n.fs = fs; n.ff = ff; changed = true; }
    }
    sumRange();
    if (!changed) break;
  }
  // темповой сценарий (для экрана работы)
  for (const u of leaves){
    const n = nodes.get(u);
    const el = n.asE != null ? T - n.asE : 0;
    n.pace = n.pc > 0 && n.pc < 100 && el >= 7 ? n.pc / el : null;               // % в сутки
    n.ffPace = n.pace ? T + Math.round((100 - n.pc) / n.pace) : null;
  }

  // ---- 3. свёртка готовности (вес = длительность, верх — стоимость договоров) ----
  const leafSet = u => { const n = nodes.get(u); if (!n.leafs){ n.leafs = n.sm ? n.kids.flatMap(leafSet) : [u]; } return n.leafs; };
  for (const u of order){ leafSet(u); }
  const planLeaf = (n, t, useBase) => {
    let s = n.s0, f = n.f0;
    if (useBase && S.baseline && S.baseline.map[n.u]){ [s, f] = S.baseline.map[n.u]; }
    if (t < s) return 0; if (t >= f) return 100; return 100 * (t - s + 1) / (f - s + 1);
  };
  const factLeaf = (n, t) => {
    const h = n.hist; if (!h.length || t < h[0][0]) return 0;
    for (let i = h.length - 1; i >= 0; i--){
      if (t >= h[i][0]){ if (i === h.length - 1) return h[i][1]; const [a, va] = h[i], [b, vb] = h[i+1]; return b === a ? vb : va + (vb - va) * (t - a) / (b - a); }
    }
    return 0;
  };
  const fcLeaf = (n, t) => {
    if (t <= T) return factLeaf(n, t);
    if (n.pc >= 100) return 100;
    if (n.pc > 0) return n.ff <= T ? 100 : n.pc + (100 - n.pc) * clamp((t - T) / (n.ff - T), 0, 1);
    if (t < n.fs) return 0; return clamp(100 * (t - n.fs + 1) / (n.ff - n.fs + 1), 0, 100);
  };
  const W = u => { const n = nodes.get(u); return n.leafs.reduce((a, l) => a + (nodes.get(l).du || 0.5), 0); };
  for (const u of order){ const n = nodes.get(u); n.W = W(u); }
  // ---- 3а. модель весов БЦ: разделы → работы → подработы, абсолютные веса ----
  const PM = PROGRESS_MODEL || autoModel(nodes, stageUids(nodes)), units = [], sections = [], ownerOf = new Map(), modelWarn = [];
  const leafDu = l => (nodes.get(l).du || 0.5);
  const groupOf = (uids) => { const set = new Set(); uids.forEach(x => { if (nodes.has(x)) leafSet(x).forEach(l => set.add(l)); }); const ls = [...set]; return { leafs: ls, W: ls.reduce((a, l) => a + leafDu(l), 0) }; };
  const inScope = x => !(x.scope === 'fitout' && PM.shellAndCore);
  PM.sections.forEach(sec => {
    const S_ = { id: sec.id, name: sec.name, weight: sec.weight, works: [], rawSum: sec.works.reduce((a, w) => a + w.weight, 0) };
    const scopeSum = sec.works.filter(inScope).reduce((a, w) => a + w.weight, 0);
    sec.works.forEach(w => {
      const W_ = { id: w.id, name: w.name, weight: w.weight, unit: w.unit, plannedQty: w.plannedQty ?? null, note: w.note || '', excluded: !inScope(w), wWithin: inScope(w) && scopeSum ? w.weight / scopeSum * 100 : 0, units: [], subs: !!w.subworks, rawSubSum: w.subworks ? w.subworks.reduce((a, x) => a + x.weight, 0) : 100 };
      const parts = w.subworks ? w.subworks.map(x => ({ ...x, unit: x.unit || w.unit })) : [w];
      const subSum = parts.reduce((a, x) => a + x.weight, 0);
      parts.forEach(x => {
        const sw = w.subworks ? x.weight / subSum : 1;
        const abs = W_.excluded ? 0 : sec.weight / 100 * (W_.wWithin / 100) * sw;
        let groups, kind;
        if (x.mix){ groups = x.mix.map(([uid, share]) => ({ ...groupOf([uid]), w: share })); kind = 'mix'; }
        else if (x.model){ groups = [{ ...groupOf([modelNode[x.id]]), w: 1 }]; kind = 'model'; }
        else if (x.own){ groups = [{ ...groupOf(x.own), w: 1 }]; kind = 'own'; }
        else if (x.proxy){ groups = [{ ...groupOf(x.proxy), w: 1 }]; kind = 'proxy'; }
        else { groups = []; kind = 'none'; }
        const U = { id: x.id, name: x.name, section: sec, work: W_, subWeight: w.subworks ? x.weight : null, unitName: x.unit, plannedQty: x.plannedQty ?? null,
          abs, absExpert: abs, cost: x.cost ?? null, kind, groups, note: x.note || '', own: x.own ? x.own.slice() : (x.model ? [modelNode[x.id]] : []), refs: x.mix ? x.mix.map(m => m[0]) : x.proxy || x.own || (x.model ? [modelNode[x.id]] : []) };
        U.own.forEach(o => { if (!nodes.has(o)) return; leafSet(o).forEach(l => { if (!ownerOf.has(l)) ownerOf.set(l, []); ownerOf.get(l).push(U); }); });
        units.push(U); W_.units.push(U);
      });
      S_.works.push(W_);
    });
    sections.push(S_);
  });
  // бюджетная / гибридная модель весов (при наличии стоимости работ)
  if (PM.weightModel !== 'expert'){
    const tot = units.filter(u => u.abs > 0 && u.cost > 0).reduce((a, u) => a + u.cost, 0);
    if (!tot) modelWarn.push('Режим «' + PM.weightModel + '»: у работ нет стоимости — применены экспертные веса.');
    else units.forEach(u => { const b = u.abs > 0 && u.cost > 0 ? u.cost / tot : 0; u.abs = PM.weightModel === 'budget' ? b : (u.absExpert + b) / 2; });
  }
  const absTotal = units.reduce((a, u) => a + u.abs, 0);
  const gVal = (g, fn) => g.W ? g.leafs.reduce((a, l) => a + leafDu(l) * fn(nodes.get(l)), 0) / g.W : 0;
  const unitVal = (U, fn) => U.groups.reduce((a, g) => a + g.w * gVal(g, fn), 0) / (U.groups.reduce((a, g) => a + g.w, 0) || 1);
  const modelAgg = fn => units.reduce((a, U) => a + U.abs * unitVal(U, fn), 0) / (absTotal || 1);
  const agg = (u, fn) => {
    const n = nodes.get(u);
    if (u === -1) return modelAgg(fn);
    if (!n.sm) return fn(n);
    let a = 0; n.leafs.forEach(l => { const ln = nodes.get(l); a += (ln.du || 0.5) * fn(ln); });
    return n.W ? a / n.W : 0;
  };
  const curve = (u, kind, t) => agg(u, kind === 'plan' ? (n => planLeaf(n, t)) : kind === 'base' ? (n => planLeaf(n, t, true)) : kind === 'fact' ? (n => factLeaf(n, t)) : (n => fcLeaf(n, t)));

  for (const u of order){
    const n = nodes.get(u);
    if (n.sm){
      n.pc = agg(u, x => x.pc);
      const withAs = n.leafs.map(l => nodes.get(l)).filter(x => x.asE != null);
      n.asE = withAs.length ? Math.min(...withAs.map(x => x.asE)) : null;
      n.afE = n.pc >= 99.95 ? Math.max(...n.leafs.map(l => nodes.get(l).afE ?? 0)) : null;
    }
    n.planNow = curve(u, 'plan', T);
    n.devPP = n.pc - n.planNow;
    n.devDays = n.ff - n.f0;
    if (S.baseline && S.baseline.map[u]){ n.bs = S.baseline.map[u][0]; n.bf = S.baseline.map[u][1]; }
  }
  // ---- 3б. значения модели для экранов и проверка ----
  units.forEach(U => {
    U.pc = clamp(unitVal(U, x => x.pc), 0, 100);
    U.planNow = unitVal(U, x => planLeaf(x, T));
    U.contrib = U.abs * U.pc;                 // вклад в готовность объекта, п.п. (abs — доля 0..1)
    U.actualQty = U.plannedQty != null ? U.plannedQty * U.pc / 100 : null;
    U.ff = Math.max(...U.groups.flatMap(g => g.leafs.map(l => nodes.get(l).ff)), -Infinity);
    U.f0 = Math.max(...U.groups.flatMap(g => g.leafs.map(l => nodes.get(l).f0)), -Infinity);
  });
  const roll = list => { const a = list.reduce((x, U) => x + U.abs, 0); return { abs: a, pc: a ? list.reduce((x, U) => x + U.abs * U.pc, 0) / a : 0, planNow: a ? list.reduce((x, U) => x + U.abs * U.planNow, 0) / a : 0, contrib: list.reduce((x, U) => x + U.contrib, 0) }; };
  sections.forEach(S_ => { S_.works.forEach(W_ => Object.assign(W_, roll(W_.units))); Object.assign(S_, roll(S_.works.flatMap(w => w.units))); });
  const checks = [];
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const secSum = PM.sections.reduce((a, s_) => a + s_.weight, 0);
  checks.push({ ok: near(secSum, 100), t: 'Сумма весов разделов = 100 %', d: fp(secSum, 1) + ' %' });
  const badSec = sections.filter(s_ => !near(s_.rawSum, 100)).map(s_ => s_.name + ': ' + s_.rawSum);
  const badSub = sections.flatMap(s_ => s_.works).filter(w => w.subs && !near(w.rawSubSum, 100)).map(w => w.name + ': ' + w.rawSubSum);
  checks.push({ ok: !badSec.length && !badSub.length, t: 'Внутри каждого раздела и работы сумма весов = 100 %', d: badSec.concat(badSub).join('; ') || sections.length + ' разделов, ' + sections.reduce((a, s_) => a + s_.works.length, 0) + ' работ' + (PM.shellAndCore ? '; Shell & Core: вес отделки арендных площадей перераспределён внутри раздела' : '') });
  const neg = PM.sections.flatMap(s_ => [s_.weight, ...s_.works.flatMap(w => [w.weight, ...(w.subworks || []).map(x => x.weight)])]).filter(v => v < 0);
  checks.push({ ok: !neg.length, t: 'Нет отрицательных весов', d: neg.length ? neg.join(', ') : 'все веса ≥ 0' });
  const outR = units.filter(U => U.pc < 0 || U.pc > 100);
  checks.push({ ok: !outR.length, t: 'Выполнение каждой работы в пределах 0–100 %', d: outR.map(U => U.name).join(', ') || units.length + ' позиций модели' });
  checks.push({ ok: root.pc <= 100.0001 && near(absTotal, 1), t: 'Готовность объекта ≤ 100 %, сумма абсолютных весов = 100 %', d: fp(root.pc, 2) + ' % · Σ абс. весов ' + fp(absTotal * 100, 2) + ' %' });
  const dbl = [...ownerOf.entries()].filter(([, us]) => us.length > 1);
  checks.push({ ok: !dbl.length, t: 'Нет двойного учёта: каждая задача ГПР принадлежит одной работе', d: dbl.length ? dbl.map(([l, us]) => nodes.get(l).name + ' → ' + us.map(x => x.id).join(', ')).join('; ') : ownerOf.size + ' задач ГПР с владельцем' });
  const noSrc = units.filter(U => U.abs > 0 && (!U.groups.length || U.groups.some(g => !g.leafs.length)));
  checks.push({ ok: !noSrc.length, t: 'Нет работ с весом без источника выполнения', d: noSrc.map(U => U.name).join(', ') || 'у каждой работы есть задача ГПР, допущение или строка «вне ГПР»' });
  const ids = units.map(U => U.id), dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
  checks.push({ ok: !dupIds.length, t: 'Нет работ вне разделов и повторяющихся ID', d: dupIds.join(', ') || 'все ID уникальны' });
  const nonPhys = new Set(PM.nonPhysical);
  const orphan = leaves.filter(l => l > 0 && !nonPhys.has(l) && !ownerOf.has(l)).map(l => nodes.get(l));
  checks.push({ ok: !orphan.length, t: 'Все физические задачи Ганта связаны с моделью', d: orphan.length ? 'без владельца: ' + orphan.map(x => x.name + ' (' + x.u + ')').join('; ') : (leaves.filter(l => l > 0).length - nonPhys.size) + ' задач с весом · ' + nonPhys.size + ' согласований и авансов без физического объёма' });
  const lostRecs = S.records.filter(r => !nodes.has(r.uid));
  const kept = MPP_ROWS.filter(r => r[8] > 0 && nodes.get(r[0]) && !nodes.get(r[0]).sm && nodes.get(r[0]).pc0 === r[8]).length;
  checks.push({ ok: !lostRecs.length, t: 'Исторические фактические данные сохранены', d: kept + ' задач с фактом из ГПР, ' + (BASE.length ? 'записей из суточных сводок: ' + BASE.length + ', ' : '') + 'записей сводок: ' + S.records.length + (lostRecs.length ? ', без привязки: ' + lostRecs.length : '') });
  modelWarn.forEach(w => checks.push({ ok: false, t: w, d: '' }));
  leaves.forEach(l => { const us = ownerOf.get(l); if (us) nodes.get(l).unit = us[0]; });

  // отставание по объёму в днях (когда план достигал текущего факта)
  const lagDays = u => {
    const n = nodes.get(u); if (n.pc >= 99.95 || n.devPP >= -0.05) return 0;
    let lo = n.s0, hi = T;
    for (let i = 0; i < 30 && lo < hi; i++){ const mid = Math.floor((lo + hi) / 2); if (curve(u, 'plan', mid) < n.pc) lo = mid + 1; else hi = mid; }
    return T - lo;
  };

  // ---- 4. статусы ----
  for (const u of order){
    const n = nodes.get(u);
    let st;
    if (n.pc >= 99.95) st = { k: 'done', t: 'Выполнено', c: 'good' };
    else if (n.f0 < T) st = { k: 'over', t: 'Просрочено ' + (T - n.f0) + ' дн.', c: 'crit' };
    else if (n.pc <= 0.01 && n.s0 < T) st = { k: 'late', t: 'Не начато · +' + (T - n.s0) + ' дн.', c: 'warn' };
    else if (n.devDays > 0) st = { k: 'late', t: 'Прогноз +' + n.devDays + ' дн.', c: 'warn' };
    else if (n.pc > 0 || n.s0 <= T) st = { k: 'active', t: 'В работе', c: 'accent' };
    else st = { k: 'future', t: 'Не начато', c: 'neutral' };
    if (n.adm && n.adm.status === 'active' && st.k === 'future') st = { k: 'active', t: 'В работе', c: 'accent' };
    if (n.adm && n.adm.status === 'paused' && st.k !== 'done') st = { k: 'paused', t: 'Приостановлена', c: 'warn' };
    n.st = st;
  }

  // ---- 5. вехи ----
  // Вехи: из данных объекта (ссылка на работу) и добавленные в «Обновлении данных» (собственные даты).
  const MU = S.upd.milestones;
  const msList = [...MILESTONES.map(m => ({ ...m, id: m.id || msKey(m) })), ...MU.added.map(a => ({ ...a, added: true }))]
    .map(m => ({ ...m, ...(MU.edits[m.id] || {}), edited: !!MU.edits[m.id] }))
    .filter(m => !m.hidden && !m.archived && m.status !== 'cancel');
  const ms = msList.map(m => {
    const n = m.ref != null && nodes.has(+m.ref) ? nodes.get(+m.ref) : null;
    if (m.ref != null && !n && !m.plan) return null;          // связанная работа скрыта и своей даты нет
    const plan = m.plan ? dn(m.plan) : n ? (m.ev === 'start' ? n.s0 : n.f0) : null;
    if (plan == null) return null;
    const factD = m.fact ? dn(m.fact) : null;
    const nodeDone = n ? (m.ev === 'start' ? n.asE != null : n.pc >= 99.95) : false;
    const done = factD != null || m.status === 'done' || (m.status !== 'open' && nodeDone);
    const actual = factD ?? (n ? (m.ev === 'start' ? n.asE : n.afE) : null);
    const fc = n ? Math.max(plan, m.ev === 'start' ? n.fs : n.ff) : plan;
    let k, t, c, sub = '';
    if (done){ k = 'done'; t = 'Выполнено'; c = 'good'; if (actual && actual > plan) sub = 'с опозданием ' + (actual - plan) + ' дн.'; }
    else if (plan < T){ k = 'over'; t = 'Просрочка ' + (T - plan) + ' дн.'; c = 'crit'; sub = n ? 'прогноз ' + fds(fc) : ''; }
    else if (fc > plan){ k = 'risk'; t = 'Осталось ' + (plan - T) + ' дн.'; c = 'warn'; sub = 'прогноз +' + (fc - plan) + ' дн.'; }
    else { k = 'plan'; t = 'Осталось ' + (plan - T) + ' дн.'; c = 'neutral'; }
    const daysTo = !done && plan >= T ? plan - T : null;
    const overdue = !done && plan < T ? T - plan : done && actual && actual > plan ? actual - plan : 0;
    return { ...m, node: n, plan, fc, done, actual, k, t, c, sub, daysTo, overdue };
  }).filter(Boolean).sort((a, b) => a.plan - b.plan);

  // ---- 6. ведущая цепочка к окончанию проекта ----
  const gpRoot = nodes.get(CFG.gpRoot);
  const drivers = [];
  let cur = leaves.map(u => nodes.get(u)).filter(n => n.u > 0).reduce((a, b) => b.ff > a.ff ? b : a);
  const seen = new Set();
  while (cur && !seen.has(cur.u) && drivers.length < 10){
    seen.add(cur.u); drivers.push(cur);
    if (cur.pc > 0) break;
    let best = null;
    for (const p of cur.preds){
      const pn = nodes.get(p.u);
      const cand = p.type === 'FS' ? pn.ff + 1 + wd(p.lag) : p.type === 'SS' ? pn.fs + wd(p.lag) : -Infinity;
      if (cand === cur.fs && cur.fs > Math.max(cur.s0, T)) best = pn.sm ? pn.leafs.map(l => nodes.get(l)).reduce((a, b) => b.ff > a.ff ? b : a) : pn;
    }
    cur = best;
  }

  // ---- 7. договоры ----
  const FIN_FIELDS = ['closed','planToDate','paid','advance','closedAgainstAdvance','retention','presented','recommendedRetention'];
  // договоры из данных объекта + договоры, добавленные в интерфейсе
  const userContracts = S.budget.contracts.map(x => ({ id: x.id, short: x.short || x.counterparty, counterparty: x.counterparty, number: x.number || '—', subject: x.subject || '',
    price: Number(x.price) || 0, start: x.start || x.date || null, end: x.end || null, handover: null, closed: 0, planToDate: 0, paid: null, advance: x.advance ?? null,
    category: x.category || '', comment: x.comment || '', signDate: x.date || null, manualStatus: x.status || null, paidManual: x.paid ?? null, spentManual: x.spent ?? null,
    closedAgainstAdvance: null, retention: null, presented: null, recommendedRetention: null, wbs: x.wbs != null && nodes.has(+x.wbs) ? [+x.wbs] : [],
    months: { pre: { label: 'до первого акта', plan: null, fact: 0 }, list: [] }, monthsNote: 'Закрытие по месяцам — по внесённым актам КС-2.', user: true, planUnknown: true }));
  const contracts = [...CONTRACTS, ...userContracts].map(c0 => {
    const o = S.fin[c0.id] || {};
    const map = new Map(c0.months.list.map(m => [m[0], [m[0], m[1], m[2]]]));
    Object.entries(o.months || {}).forEach(([ym, v]) => { const cur = map.get(ym) || [ym, null, null]; map.set(ym, [ym, v.plan != null ? v.plan : cur[1], v.fact != null ? v.fact : cur[2]]); });
    const docs = S.budget.docs.filter(d => d.contractId === c0.id);
    const ks2 = docs.filter(d => d.type === 'ks2'), ks3 = docs.filter(d => d.type === 'ks3'), est = docs.filter(d => d.type === 'estimate');
    ks2.forEach(d => { const ym = String(d.date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(ym)) return; const cur = map.get(ym) || [ym, null, null]; cur[2] = (cur[2] || 0) + (Number(d.amount) || 0) / 1e6; map.set(ym, cur); });
    const list = [...map.values()].sort((a, b) => a[0] < b[0] ? -1 : 1);
    const c = { ...c0, months: { pre: c0.months.pre, list }, src: {} };
    if (o.months && Object.keys(o.months).length){
      c.closed = (c0.months.pre.fact + list.reduce((a, m) => a + (m[2] || 0), 0)) * 1e6;
      if (c0.months.pre.plan != null) c.planToDate = (c0.months.pre.plan + list.filter(m => monthEnd(m[0]) <= T).reduce((a, m) => a + (m[1] || 0), 0)) * 1e6;
    }
    FIN_FIELDS.forEach(k => { if (o[k] != null){ c[k] = o[k]; c.src[k] = 'file'; } });
    const sum = arr => arr.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    if (ks2.length && !(o.months && Object.keys(o.months).length)) c.closed = (c.closed || 0) + sum(ks2);
    const paid3 = ks3.reduce((a, d) => a + (Number(d.paid) || 0), 0);
    if (paid3) c.paid = (c.paid || 0) + paid3;
    if (c0.user){ if (c0.spentManual != null){ c.closed = Number(c0.spentManual); c.src.closed = 'manual'; } if (c0.paidManual != null){ c.paid = Number(c0.paidManual) + paid3; c.src.paid = 'manual'; } }
    else { const mt = S.budget.meta[c0.id] || {}; c.category = mt.category || c0.category || ''; c.comment = mt.comment || ''; c.signDate = mt.date || c0.date || null; c.manualStatus = mt.status || null; }
    c.docs = { estimates: est, ks2, ks3 };
    c.estimateTotal = est.length ? sum(est) : null; c.ks2Total = sum(ks2); c.ks3Total = sum(ks3); c.ks3Paid = paid3;
    return c;
  }).map(c => {
    const phys = c.wbs.length === 1 && nodes.has(c.wbs[0]) ? nodes.get(c.wbs[0]).pc : 0;
    const closedPct = c.price > 0 ? c.closed / c.price * 100 : 0, planPct = c.price > 0 ? c.planToDate / c.price * 100 : 0;
    const gap = phys - closedPct;
    let status;
    if (c.price > 0 && c.closed >= c.price - 1) status = { t: 'Завершён', c: 'good' };
    else if (dn(c.start) > T) status = { t: 'Не начат', c: 'neutral' };
    else if (planPct - closedPct > 0.5 || Math.abs(gap) >= 5) status = { t: 'Есть отклонение', c: 'warn' };
    else status = { t: 'В работе', c: 'accent' };
    const MS_ = { 'Завершён': 'good', 'Приостановлен': 'warn', 'Расторгнут': 'crit' };
    if (c.manualStatus && MS_[c.manualStatus]) status = { t: c.manualStatus, c: MS_[c.manualStatus], manual: true };
    return { ...c, phys, closedPct, planPct, gap, status, rest: c.price - c.closed };
  });
  const fin = {
    contracted: contracts.reduce((a, c) => a + c.price, 0),
    closed: contracts.reduce((a, c) => a + c.closed, 0),
    plan: contracts.reduce((a, c) => a + c.planToDate, 0)
  };
  fin.closedPct = fin.contracted ? fin.closed / fin.contracted * 100 : null; fin.planPct = fin.contracted ? fin.plan / fin.contracted * 100 : null;
  fin.planKnown = contracts.some(c => !c.planUnknown);
  if (!fin.planKnown){ fin.plan = null; fin.planPct = null; }
  // Показатели бюджета: введённое значение или расчёт по реестру договоров; нет данных — «—»
  const UB = S.upd.budget, num = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const paidKnown = contracts.filter(c => c.paid != null);
  const budget = {
    total: num(S.settings.budgetTotal ?? PROJECT.budgetTotal), approved: num(UB.approved),
    contracted: num(UB.contracted) ?? (contracts.length ? fin.contracted : null),
    paid: num(UB.paid) ?? (paidKnown.length ? paidKnown.reduce((a, c) => a + Number(c.paid), 0) : null),
    spent: num(UB.spent) ?? (contracts.length ? fin.closed : null),
    forecast: num(UB.forecast), comment: UB.comment || '', src: {}
  };
  ['contracted', 'paid', 'spent'].forEach(k => { budget.src[k] = num(UB[k]) != null ? 'manual' : budget[k] != null ? 'calc' : null; });
  const bBase = budget.approved ?? budget.total;
  budget.deviation = budget.forecast != null && bBase != null ? budget.forecast - bBase : null;

  // ---- 8. риски и отклонения (всё из расчёта) ----
  const risks = [];
  const stageOf = n => { let x = n; while (x && x.lvl > 2) x = nodes.get(x.parent); return x; };
  const groups = new Map();
  for (const u of leaves){
    const n = nodes.get(u); if (n.u < 0) continue;
    let kind = null, days = 0;
    if (n.pc < 100 && n.f0 < T){ kind = 'over'; days = T - n.f0; }
    else if (n.pc === 0 && n.s0 < T){ kind = 'nostart'; days = T - n.s0; }
    if (!kind) continue;
    const stg = stageOf(n), key = kind + '|' + (stg ? stg.u : '') + '|' + n.name;
    if (!groups.has(key)) groups.set(key, { kind, stage: stg, name: n.name, items: [], days: 0 });
    const g = groups.get(key); g.items.push(n); g.days = Math.max(g.days, days);
  }
  for (const g of groups.values()){
    const cnt = g.items.length;
    const label = g.name + (cnt > 1 ? ' (' + cnt + ' работы)' : '');
    risks.push({
      sev: g.kind === 'over' && g.days > 30 ? 'crit' : 'warn', score: (g.kind === 'over' ? 2000 : 1000) + g.days,
      title: label, where: g.stage ? g.stage.name : '',
      text: g.kind === 'over' ? 'просрочка ' + g.days + ' дн.' : 'не начато, +' + g.days + ' дн. к старту',
      go: cnt > 1 && g.items[0].parent != null ? '#/node/' + stageOf(g.items[0]).u : '#/work/' + g.items[0].u, type: 'График'
    });
  }
  const pDelay = root.ff - dn(PROJECT.planEnd);
  if (pDelay > 0) risks.push({ sev: 'crit', score: 5000 + pDelay, title: 'Прогноз окончания', where: 'Проект', text: 'позже плана на ' + pDelay + ' дн. (' + fd(root.ff) + ')', go: '#/timeline', type: 'Срок' });
  contracts.forEach(c => {
    if (!c.planUnknown && c.planPct - c.closedPct > 0.5) risks.push({ sev: 'warn', score: 1500, title: c.short + ': закрытие ниже плана', where: c.counterparty, text: '−' + fmoney(c.planToDate - c.closed, 'млн') + ' к плану', go: '#/contract/' + c.id, type: 'Бюджет' });
    if (c.wbs.length && Math.abs(c.gap) >= 5) risks.push({ sev: 'warn', score: 1400, title: c.short + ': физ. ≠ фин.', where: c.counterparty, text: 'физически ' + fpct(c.phys, 1) + ', актами ' + fpct(c.closedPct, 1), go: '#/contract/' + c.id, type: 'Бюджет' });
  });
  const mergeWeeks = (weeks, base, over, keys) => {
    const m = new Map(weeks.map((w, i) => [w, Object.fromEntries(keys.map(k => [k, base[k][i]]))]));
    Object.entries(over || {}).forEach(([d, v]) => { const cur = m.get(d) || Object.fromEntries(keys.map(k => [k, null])); keys.forEach(k => { if (v[k] != null) cur[k] = v[k]; }); m.set(d, cur); });
    const ws = [...m.keys()].sort().slice(-12);
    const out = { weeks: ws }; keys.forEach(k => { out[k] = ws.map(w => m.get(w)[k]); }); return out;
  };
  const wf = mergeWeeks(WEEKS, WORKFORCE, S.metrics.workforce && S.metrics.workforce.weeks, ['fact', 'plan']);
  const presc = mergeWeeks(WEEKS, PRESCRIPTIONS, S.metrics.prescriptions && S.metrics.prescriptions.weeks, ['issued', 'fixed', 'open']);
  S.airisks.forEach(r => risks.push({ sev: 'warn', score: 800, title: r.text, where: r.file || 'Документ', text: 'из загруженного файла ' + (r.date ? fd(dn(r.date)) : ''), go: '#/journal', type: 'Документы' }));
  const po = presc.open.filter(v => v != null), poN = po[po.length-1];
  if (po.length) risks.push({ sev: poN > 90 ? 'warn' : 'neutral', score: 900, title: 'Предписания не устранены', where: PROJECT.gcName, text: poN + ' шт., за неделю ' + sgn(poN - po[po.length-2]), go: '#/risks', type: 'Качество' });
  // Реестр рисков проекта (вносится ответственным): открытые риски входят в общий список отклонений
  const LVL = { 'Низкая': 1, 'Низкое': 1, 'Средняя': 2, 'Среднее': 2, 'Высокая': 3, 'Высокое': 3 };
  const register = S.upd.risks.filter(r => !r.archived).map(r => ({ ...r, score: (LVL[r.prob] || 0) * (LVL[r.impact] || 0), open: r.status !== 'Закрыт' }))
    .sort((a, b) => (b.open - a.open) || (b.score - a.score) || String(a.name).localeCompare(String(b.name), 'ru'));
  register.filter(r => r.open).forEach(r => risks.push({ sev: r.score >= 6 ? 'crit' : r.score >= 3 ? 'warn' : 'neutral', score: 3000 + r.score * 100, title: r.name, where: r.owner ? 'Ответственный: ' + r.owner : (r.cat || 'Реестр рисков'),
    text: [r.prob && 'вероятность ' + String(r.prob).toLowerCase(), r.impact && 'влияние ' + String(r.impact).toLowerCase(), r.due && 'срок ' + fd(dn(r.due))].filter(Boolean).join(', ') || (r.status || 'открыт'), go: CFG.risksGo || '#/risks', type: 'Реестр рисков' }));
  risks.sort((a, b) => b.score - a.score);
  const events = S.upd.events.filter(e => !e.archived).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const lastOf = arr => arr.slice().sort((a, b) => String(b.asOf || '').localeCompare(String(a.asOf || '')) || (b.at || 0) - (a.at || 0))[0] || null;
  const summary = lastOf(S.upd.summaries), declared = lastOf(S.upd.readiness);

  M = { nodes, order, leaves, T, FILE, root, gpRoot, base: BASE, ms, drivers, contracts, fin, budget, register, events, summary, declared, risks, wf, presc, model: { sections, units, checks, absTotal, cfg: PM, modelNode }, curve, planLeaf, factLeaf, fcLeaf, lagDays, stageOf };
  publishSummary();
  return M;
}

/* Строки ГПР с правками администратора: название, сроки, длительность, факт. даты, этап.
   Добавленные работы — такие же строки (признак r[13]). */
const ADMIN_UID0 = 9000000;
/* Устойчивый ID вехи из данных объекта: связанная строка ГПР и событие (начало / окончание). */
const msKey = m => 'G' + m.ref + (m.ev === 'start' ? 's' : 'f');
function adminRows(){
  const E = S.admin.edits;
  const add = S.admin.added.map(a => [a.u, null, a.parent, a.name, a.s, a.f, null, null, 0, a.du ?? workDays(a.s, a.f), a.group ? 1 : 0, 0, [], true]);
  return [...MPP_ROWS, ...add].map(r => {
    const e = E[r[0]]; if (!e) return r;
    const x = r.slice();
    if (e.name != null) x[3] = e.name;
    if (e.parent != null) x[2] = e.parent;
    if (e.s !== undefined) x[4] = e.s;
    if (e.f !== undefined) x[5] = e.f;
    if (e.as !== undefined) x[6] = e.as;
    if (e.af !== undefined) x[7] = e.af;
    if (e.du != null) x[9] = e.du;
    return x;
  });
}
function workDays(s, f){ if (!s || !f) return 0; let n = 0; for (let t = dn(s); t <= dn(f); t++){ const w = new Date(t * DAY).getUTCDay(); if (w !== 0 && w !== 6) n++; } return n; }
function addWorkDays(s, du){ let t = dn(s), left = Math.max(1, Math.round(du)); for (;;){ const w = new Date(t * DAY).getUTCDay(); if (w !== 0 && w !== 6 && --left <= 0) return iso(t); t++; } }
/* Этапы верхнего уровня: дочерние строки сводной строки ГПР (или список объекта). */
function stageUids(nodes){
  if (Array.isArray(CFG.stageRoots)) return CFG.stageRoots.filter(u => nodes.has(u));
  const g = nodes.get(CFG.gpRoot);
  return [...(CFG.stagePrefix || []).filter(u => nodes.has(u)), ...(g ? g.kids.filter(u => nodes.has(u)) : [])];
}
/* Модель весов по длительности ГПР — когда отдельная модель объекта не согласована.
   Раздел = этап верхнего уровня, работа = его дочерняя строка, вес = доля рабочих дней задач. */
function autoModel(nodes, stages){
  const leafDays = u => { const n = nodes.get(u); return n.kids.length ? n.kids.reduce((a, k) => a + leafDays(k), 0) : (n.du || 0.5); };
  const total = stages.reduce((a, u) => a + leafDays(u), 0) || 1;
  const sections = stages.map((u, i) => {
    const n = nodes.get(u), parts = n.kids.length ? n.kids : [u];
    const sum = parts.reduce((a, k) => a + leafDays(k), 0) || 1;
    return { id: 'S' + String(i + 1).padStart(2, '0'), name: n.name, weight: leafDays(u) / total * 100,
      works: parts.map((k, j) => ({ id: 'S' + String(i + 1).padStart(2, '0') + '-' + String(j + 1).padStart(2, '0'), name: nodes.get(k).name, weight: leafDays(k) / sum * 100, unit: null, own: [k] })) };
  });
  return { id: 'duration-auto', objectType: CFG.objectType || 'Объект', weightModel: 'duration', shellAndCore: false, nonPhysical: [], sections, auto: true };
}
/* Короткая сводка для карточки объекта на экране выбора проектов. */
function publishSummary(){
  try {
    const R = M && M.root; if (!R) return;
    localStorage.setItem('dsflow.summary.' + CFG.id, JSON.stringify({ readiness: Math.round(R.pc * 10) / 10, plan: Math.round(R.planNow * 10) / 10, stage: currentStage(),
      delay: R.ff - dn(PROJECT.planEnd), statusDate: iso(M.T), at: Date.now() }));
  } catch(e){}
}

// Недельные точки кривой узла для графиков
function series(u, from, to, step){
  const out = [];
  for (let t = from; t <= to; t += step) out.push(t);
  if (out[out.length - 1] !== to) out.push(to);
  return out;
}
function ancestors(u){ const a = []; let n = M.nodes.get(u); while (n && n.parent != null){ n = M.nodes.get(n.parent); if (n) a.unshift(n); } return a; }
/* ================= ГРАФИКИ (SVG, одна шкала X для линий, отметок и подсказки) ================= */
const CHARTS = {};
let chartSeq = 0;

function ring(size, sw, parts, center){
  // parts: [{v:0..100, color, r (optional radius offset)}]
  const c = size / 2;
  let out = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`;
  parts.forEach(p => {
    const r = p.r ?? (c - sw / 2 - 1), L = 2 * Math.PI * r, w = p.w ?? sw;
    out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${w}"/>`;
    if (p.v > 0) out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(L * clamp(p.v,0,100) / 100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>`;
    if (p.tick != null){
      const a = (-90 + 3.6 * p.tick) * Math.PI / 180, r1_ = r - w/2 - 3, r2 = r + w/2 + 3;
      out += `<line x1="${(c + r1_ * Math.cos(a)).toFixed(1)}" y1="${(c + r1_ * Math.sin(a)).toFixed(1)}" x2="${(c + r2 * Math.cos(a)).toFixed(1)}" y2="${(c + r2 * Math.sin(a)).toFixed(1)}" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/>`;
    }
  });
  if (center) out += center;
  return out + '</svg>';
}

function monthTicks(x0, x1, maxN){
  const a = new Date(x0 * DAY), b = new Date(x1 * DAY);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1;
  const step = Math.max(1, Math.ceil(months / maxN));
  const out = [];
  let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1;
  for (let i = 0; i <= months; i++){
    const t = Math.round(Date.UTC(y, m, 1) / DAY);
    if (t > x0 && t <= x1 && ((y * 12 + m) % step === 0)) out.push({ t, label: MONTHS[m % 12] + ' ' + String(m === 12 ? y + 1 : y).slice(2) });
    m++; if (m > 12){ m = 1; y++; }
  }
  return out;
}

/* opts: {w,h,x0,x1,y0,y1,yTicks,yFmt,series:[{name,color,pts,dash,width,dots,area}],marks:[{t,label,color,dash}],band:{t,a,b,label}} */
function lineChart(o){
  const id = 'c' + (++chartSeq);
  const w = o.w || 760, h = o.h || 320, P = { l: 46, r: 16, t: 26, b: 30 };
  const X = t => P.l + (t - o.x0) / (o.x1 - o.x0) * (w - P.l - P.r);
  const Y = v => P.t + (1 - (v - o.y0) / (o.y1 - o.y0)) * (h - P.t - P.b);
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label || 'График')}"><defs><clipPath id="${id}-clip"><rect x="${P.l}" y="0" width="${w - P.l - P.r}" height="${h - P.b + 1}"/></clipPath></defs>`;
  (o.yTicks || []).forEach(v => {
    s += `<line class="gl" x1="${P.l}" x2="${w - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`;
    s += `<text class="ax" x="${P.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${o.yFmt ? o.yFmt(v) : v}</text>`;
  });
  monthTicks(o.x0, o.x1, o.maxTicks || Math.max(3, Math.floor(w / 95))).forEach(k => {
    s += `<line class="gl" x1="${X(k.t).toFixed(1)}" x2="${X(k.t).toFixed(1)}" y1="${h - P.b}" y2="${h - P.b + 5}"/>`;
    s += `<text class="ax" x="${X(k.t).toFixed(1)}" y="${h - P.b + 18}" text-anchor="middle">${k.label}</text>`;
  });
  s += `<line x1="${P.l}" x2="${w - P.r}" y1="${h - P.b}" y2="${h - P.b}" stroke="var(--line-strong)"/>`;
  (o.marks || []).forEach((m, i) => {
    if (m.t < o.x0 || m.t > o.x1) return;
    const x = X(m.t).toFixed(1);
    s += `<line x1="${x}" x2="${x}" y1="${P.t - 6}" y2="${h - P.b}" stroke="${m.color}" stroke-width="${m.w || 1.5}" ${m.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
    const anchor = m.anchor || (X(m.t) > w - 120 ? 'end' : X(m.t) < P.l + 60 ? 'start' : 'middle');
    s += `<text x="${x}" y="${P.t - 10 - (m.row || 0) * 13}" text-anchor="${anchor}" font-size="11" font-weight="650" fill="${m.color}" font-family="var(--font-ui)">${esc(m.label)}</text>`;
  });
  s += `<g clip-path="url(#${id}-clip)">`;
  if (o.band){
    const x = X(o.band.t), ya = Y(o.band.a), yb = Y(o.band.b);
    s += `<line x1="${x}" x2="${x}" y1="${ya}" y2="${yb}" stroke="var(--crit)" stroke-width="3"/>`;
    s += `<text x="${x + 8}" y="${((ya + yb) / 2 + 4).toFixed(1)}" font-size="11.5" font-weight="700" fill="var(--crit)" font-family="var(--font-ui)">${esc(o.band.label)}</text>`;
  }
  o.series.forEach(se => {
    if (!se.pts || se.pts.length < 1) return;
    const d = se.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    if (se.area && se.pts.length > 1){
      s += `<path d="${d} L${X(se.pts[se.pts.length-1][0]).toFixed(1)} ${Y(o.y0)} L${X(se.pts[0][0]).toFixed(1)} ${Y(o.y0)} Z" fill="${se.color}" opacity=".10"/>`;
    }
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2.25}" stroke-linejoin="round" stroke-linecap="round" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/>`;
    if (se.dots) se.pts.forEach(p => { s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3.5" fill="var(--surface)" stroke="${se.color}" stroke-width="2"/>`; });
    if (se.end){ const p = se.pts[se.pts.length-1]; s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="5" fill="${se.color}" stroke="var(--surface)" stroke-width="2"/>`; }
  });
  s += '</g>';
  s += `<line class="hl" x1="0" x2="0" y1="${P.t}" y2="${h - P.b}" stroke="var(--ink-3)" stroke-width="1" opacity="0"/>`;
  s += `<line class="pin" x1="0" x2="0" y1="${P.t}" y2="${h - P.b}" stroke="var(--ink)" stroke-width="1.5" opacity="0"/>`;
  s += `<rect x="${P.l}" y="${P.t}" width="${w - P.l - P.r}" height="${h - P.t - P.b}" fill="transparent" class="hit"/>`;
  s += '</svg>';
  CHARTS[id] = { o, w, h, P, X };
  const legend = (o.legend !== false) ? `<div class="legend" style="margin-top:8px">${o.series.filter(x => x.name).map(x => `<span><i style="background:${x.color};height:${x.dash ? 3 : 4}px;${x.dash ? 'background:repeating-linear-gradient(90deg,' + x.color + ' 0 5px,transparent 5px 9px)' : ''}"></i>${esc(x.name)}</span>`).join('')}${(o.marks||[]).filter(m=>m.legend).map(m=>`<span><i style="width:2px;height:12px;background:${m.color}"></i>${esc(m.legend)}</span>`).join('')}</div>` : '';
  return `<div class="chart" data-cid="${id}">${s}<div class="tip" hidden></div></div>${legend}`;
}
function valAt(pts, t){
  if (!pts || !pts.length || t < pts[0][0] || t > pts[pts.length-1][0]) return null;
  for (let i = 1; i < pts.length; i++){
    if (t <= pts[i][0]){ const [a, va] = pts[i-1], [b, vb] = pts[i]; return b === a ? vb : va + (vb - va) * (t - a) / (b - a); }
  }
  return pts[pts.length-1][1];
}
function chartPointer(el, ev, pin){
  const c = CHARTS[el.dataset.cid]; if (!c) return;
  const svg = el.querySelector('svg'), rect = svg.getBoundingClientRect();
  const scale = c.w / rect.width, x = (ev.clientX - rect.left) * scale;
  if (x < c.P.l || x > c.w - c.P.r){ return; }
  const t = Math.round(c.o.x0 + (x - c.P.l) / (c.w - c.P.l - c.P.r) * (c.o.x1 - c.o.x0));
  const X = c.X(t);
  const line = svg.querySelector(pin ? '.pin' : '.hl');
  line.setAttribute('x1', X); line.setAttribute('x2', X); line.setAttribute('opacity', pin ? .9 : .6);
  const rows = c.o.series.filter(s => s.name && !s.noTip).map(s => { const v = valAt(s.pts, t); return v == null ? '' : `<div class="tr"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}<b>${c.o.tipFmt ? c.o.tipFmt(v) : fpct(v, 1)}</b></div>`; }).join('');
  const tip = el.querySelector('.tip');
  tip.innerHTML = `<div class="tt">${fd(t)}${pin ? ' · выбранный день' : ''}</div>${rows || '<div class="tr">нет данных на дату</div>'}`;
  tip.hidden = false;
  const px = (X / c.w) * rect.width;
  tip.style.left = Math.min(Math.max(px + 12, 0), rect.width - 190) + 'px';
  tip.style.top = '8px';
  if (pin) el.dataset.pinned = '1';
}
document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('.chart[data-cid]');
  document.querySelectorAll('.chart[data-cid]').forEach(c => { if (c !== el && !c.dataset.pinned){ const t = c.querySelector('.tip'); if (t) t.hidden = true; const l = c.querySelector('.hl'); if (l) l.setAttribute('opacity', 0); } });
  if (el && e.pointerType === 'mouse' && !el.dataset.pinned) chartPointer(el, e, false);
});
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('.chart[data-cid]');
  if (el) chartPointer(el, e, true);
});

function barsChart(o){
  // o: {w,h,cats:[label], groups:[{name,color,vals}], line:{name,color,vals}, yMax, yFmt}
  const w = o.w || 520, h = o.h || 220, P = { l: 40, r: 10, t: 16, b: 34 };
  const n = o.cats.length, bw = (w - P.l - P.r) / n;
  const Y = v => P.t + (1 - v / o.yMax) * (h - P.t - P.b);
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label || '')}">`;
  (o.yTicks || []).forEach(v => { s += `<line class="gl" x1="${P.l}" x2="${w - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${o.yFmt ? o.yFmt(v) : v}</text>`; });
  o.cats.forEach((c, i) => {
    const gx = P.l + i * bw, gw = bw * 0.72 / o.groups.length;
    o.groups.forEach((g, j) => {
      const v = g.vals[i]; if (v == null) return;
      const x = gx + bw * 0.14 + j * gw, y = Y(v);
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(gw - 2).toFixed(1)}" height="${(h - P.b - y).toFixed(1)}" rx="3" fill="${g.color}"><title>${esc(c)} · ${esc(g.name)}: ${o.yFmt ? o.yFmt(v) : v}</title></rect>`;
      if (o.valueLabels) s += `<text x="${(x + gw/2 - 1).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--ink-2)" font-family="var(--font-ui)">${o.yFmt ? o.yFmt(v) : v}</text>`;
    });
    s += `<text class="ax" x="${(gx + bw / 2).toFixed(1)}" y="${h - P.b + 16}" text-anchor="middle">${esc(c)}</text>`;
  });
  s += `<line x1="${P.l}" x2="${w - P.r}" y1="${h - P.b}" y2="${h - P.b}" stroke="var(--line-strong)"/>`;
  (o.lines || []).forEach(L => {
    const pts = L.vals.map((v, i) => v == null ? null : [P.l + i * bw + bw / 2, Y(v)]).filter(Boolean);
    s += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${L.color}" stroke-width="2" ${L.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
    pts.forEach(p => { s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="var(--surface)" stroke="${L.color}" stroke-width="2"/>`; });
    if (L.labels) L.vals.forEach((v, i) => { if (v != null) s += `<text x="${(P.l + i * bw + bw / 2).toFixed(1)}" y="${(Y(v) - 8).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="650" fill="${L.color}" font-family="var(--font-ui)">${v}</text>`; });
  });
  s += '</svg>';
  const leg = [...o.groups.map(g => `<span><i style="background:${g.color}"></i>${esc(g.name)}</span>`), ...(o.lines || []).map(L => `<span><i style="background:${L.color};height:3px"></i>${esc(L.name)}</span>`)].join('');
  return `<div class="chart">${s}</div><div class="legend" style="margin-top:6px">${leg}</div>`;
}
/* ================= ОБЩИЕ ЭЛЕМЕНТЫ ИНТЕРФЕЙСА ================= */
const I = {
  grid:'<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  gantt:'<path d="M4 6h8M8 12h9M12 18h8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coins:'<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  cam:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  alert:'<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01"/>',
  arrow:'<path d="M7 17L17 7M9 7h8v8"/>',
  chev:'<path d="M9 6l6 6-6 6"/>',
  chevd:'<path d="M6 9l6 6 6-6"/>',
  back:'<path d="M15 6l-6 6 6 6"/>',
  expand:'<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  left:'<path d="M15 6l-6 6 6 6"/>', right:'<path d="M9 6l6 6-6 6"/>',
  zin:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>', zout:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  chart:'<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  pen:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  down:'<path d="M12 5v14M6 13l6 6 6-6"/>',
  eyeoff:'<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19c1.8 0 3.4-.5 4.7-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  trend:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15l4-5 3 3 5-7"/>',
  events:'<path d="M3 12h18"/><circle cx="7.5" cy="12" r="2.3"/><circle cx="16.5" cy="12" r="2.3"/><path d="M7.5 9.7V5.4M16.5 14.3v4.3"/>',
  building:'<path d="M6 21V5.5L12 3v18"/><path d="M12 21V8l6 2.5V21"/><path d="M4 21h16"/><path d="M8.5 8v.01M8.5 11v.01M8.5 14v.01M8.5 17v.01M15 13v.01M15 16v.01"/>'
};
const ico = (k, sz) => `<svg viewBox="0 0 24 24" ${sz ? `width="${sz}" height="${sz}"` : ''} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
const chip = (t, c) => `<span class="chip ${c}">${esc(t)}</span>`;
const stVar = c => ({ good:'var(--good)', warn:'var(--warn)', crit:'var(--crit)', accent:'var(--accent)', neutral:'var(--ink-3)' }[c] || 'var(--ink-3)');
function barCols(n){
  const k = n.st.k;
  if (k === 'done') return ['var(--good)', 'var(--good)'];
  if (k === 'over' || k === 'late' || k === 'paused') return ['var(--warn-track)', 'var(--warn)'];
  if (k === 'active') return ['color-mix(in srgb, var(--accent) 24%, var(--surface))', 'var(--accent)'];
  return ['var(--track)', 'transparent'];
}
const pctTxt = v => v >= 99.95 ? '100 %' : (v < 1 && v > 0) || (v > 99 && v < 99.95) ? fpct(v, 1) : fpct(v);
const UI = { ovTab: 'gantt', implTab: 'structure', sel: null, photoDate: null, cmpA: null, cmpB: null, filter: 'all', q: '', budgetSort: null };

function stageRows(){
  // верхний уровень: этапы объекта (у «Раменок» — котлован и этапы генподряда)
  return stageUids(M.nodes).map(u => M.nodes.get(u));
}
function rangeStart(){ return dn(CFG.rangeStart || (PROJECT.start.slice(0, 7) + '-01')); }
function range(){ const A0 = rangeStart(); const A1 = Math.max(M.root.ff, dn(PROJECT.planEnd)) + 31; return [A0, A1]; }

/* ================= ОБЗОР ================= */
function viewOverview(){
  const R = M.root, T = M.T, start = dn(PROJECT.start), pEnd = dn(PROJECT.planEnd);
  const total = pEnd - start, passed = clamp(T - start, 0, total), timePct = passed / total * 100;
  const delay = R.ff - pEnd;
  const fin = M.fin;
  const wf = M.wf.fact.filter(v => v != null).slice(-1)[0], wfp = M.wf.plan.filter(v => v != null).slice(-1)[0], wfd = M.wf.weeks[M.wf.weeks.length - 1];
  const att = M.risks.filter(r => r.sev !== 'neutral').slice(0, 3);

  const html = `<div class="dsf-dashboard">
  <section class="stamp">
    <div class="stamp-main">
      <div class="brand-mark"><img src="${esc(CFG.icon)}" alt="Знак ${esc(PROJECT.name)}" width="56" height="56"></div>
      <div style="min-width:0">
        <div class="eyebrow">${esc(currentStage())}${PROJECT.gcName ? ' · Генподрядчик ' + esc(PROJECT.gcName) : CFG.stampNote ? ' · ' + esc(CFG.stampNote) : ''}</div>
        <h1>Ход работ <span class="ac">${esc(PROJECT.name)}</span></h1>
      </div>
    </div>
    <dl>
      <div><dt>Отчётная дата</dt><dd>${fd(T)}</dd></div>
      ${wf != null ? `<button type="button" data-go="${esc(CFG.workforceGo || (CFG.mainContract ? '#/contract/' + CFG.mainContract : '#/'))}" title="Динамика рабочей силы"><dt>Рабочая сила, чел.</dt><dd>${wf} <small>${wfp != null ? 'план ' + wfp + ' · ' : ''}${fds(dn(wfd)).slice(0,5)}</small></dd></button>` : `<div><dt>Рабочая сила, чел.</dt><dd>—</dd></div>`}
    </dl>
  </section>

  <section class="kpis" aria-label="Ключевые показатели">
    <button class="kpi" type="button" data-go="#/impl/structure">
      <div class="kpi-top"><span class="t">Готовность проекта</span><span class="go">${ico('arrow')}</span></div>
      <div class="kpi-mid">
        <div>
          <div class="big">${fp(R.pc)}<small>%</small></div>
          <div style="margin-top:10px; font-size:13px; color:var(--ink-2)">план на ${fds(T)} — <b style="color:var(--ink)">${fpct(R.planNow)}</b></div>
          ${M.declared && M.declared.fact != null ? `<div style="margin-top:4px; font-size:12px; color:var(--ink-3)">по отчёту ответственного на ${fds(dn(M.declared.asOf))} — ${fpct(M.declared.fact, 1)}</div>` : ''}
        </div>
        ${ring(108, 10, [{ v: R.pc, color: 'var(--good)', tick: R.planNow, r: 44 }, { v: fin.closedPct || 0, color: 'var(--accent-2)', r: 30, w: 7 }])}
      </div>
      <div class="kpi-foot">
        ${chip((R.devPP >= 0 ? '+' : '−') + fp(Math.abs(R.devPP), 1) + ' п.п. к плану', R.devPP >= -0.5 ? 'good' : R.devPP > -5 ? 'warn' : 'crit')}
        <span><span class="dot" style="background:var(--accent-2)"></span> актами ${fin.closedPct == null ? '—' : fpct(fin.closedPct)}</span>
      </div>
    </button>

    <button class="kpi" type="button" data-go="#/timeline">
      <div class="kpi-top"><span class="t">Срок реализации</span><span class="go">${ico('arrow')}</span></div>
      <div class="kpi-mid">
        <div>
          <div class="big">${fp(timePct)}<small>%</small></div>
          <div style="margin-top:10px; font-size:13px; color:var(--ink-2)">времени пройдено · <b style="color:var(--ink)">осталось ${pEnd - T} дн.</b></div>
        </div>
        ${ring(108, 11, [{ v: timePct, color: 'var(--accent)', r: 42 }], `<text x="54" y="51" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)" font-family="var(--font-ui)">${passed}</text><text x="54" y="65" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-3)" font-family="var(--font-ui)">из ${total} дн.</text>`)}
      </div>
      <div class="kpi-foot"><div class="trio">
        <div><div class="l">Старт</div><div class="v">${fd(start)}</div></div>
        <div><div class="l">${esc(CFG.planEndLabel)}, план</div><div class="v">${fd(pEnd)}</div></div>
        <div><div class="l" style="color:${delay > 0 ? 'var(--warn-ink)' : 'var(--good)'}">Прогноз</div><div class="v" style="color:${delay > 0 ? 'var(--warn-ink)' : 'var(--good)'}">${delay > 0 ? fd(R.ff) + ' · +' + delay : 'в срок'}</div></div>
      </div></div>
    </button>

    <button class="kpi" type="button" data-go="#/budget">
      <div class="kpi-top"><span class="t">Бюджет</span><span class="go">${ico('arrow')}</span></div>
      <div style="flex:1">
        <div class="big" style="font-size:42px">${fin.contracted ? (fin.contracted / 1e9).toFixed(2).replace('.', ',') : '—'}<small style="font-size:22px; margin-left:8px">${fin.contracted ? 'млрд ₽' : ''}</small></div>
        <div style="margin-top:8px; font-size:13px; color:var(--ink-2); display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center">${M.contracts.length ? `законтрактовано · ${M.contracts.length} ${plural(M.contracts.length, 'договор', 'договора', 'договоров')} ${fin.planKnown ? chip((fin.plan - fin.closed > 0 ? '−' : '+') + fp(Math.abs(fin.plan - fin.closed) / 1e6) + ' млн к плану', fin.plan - fin.closed > 0 ? 'warn' : 'good') : ''}` : 'законтрактовано · данные по договорам не переданы'}</div>
      </div>
      <div class="kpi-foot" style="flex-direction:column; align-items:stretch; gap:9px">
        <div class="barrow"><span>Закрыто актами</span><span class="bar"><i style="width:${fin.closedPct || 0}%; --c:var(--good)"></i>${fin.planPct != null ? `<b style="left:${fin.planPct}%"></b>` : ''}</span><span class="num" style="text-align:right; font-weight:650; color:var(--ink)">${fin.contracted ? (fin.closed/1e9).toFixed(2).replace('.', ',') + ' · ' + fpct(fin.closedPct) : '—'}</span></div>
        <div class="barrow"><span>План закрытия</span><span class="faint" style="font-size:12px">— метка на шкале</span><span class="num" style="text-align:right">${fin.contracted && fin.planKnown ? (fin.plan/1e9).toFixed(2).replace('.', ',') + ' · ' + fpct(fin.planPct) : '—'}</span></div>
      </div>
    </button>
  </section>


  <div class="row2">
    <section class="panel">
      <header>
        <h2>График реализации</h2>
        <div class="seg" role="tablist" style="margin-left:auto">
          ${[['gantt','Диаграмма Ганта'],['ms','Ключевые вехи'],['cal','Календарь']].map(([k, t]) => `<button role="tab" type="button" data-ovtab="${k}" aria-selected="${UI.ovTab === k}">${t}</button>`).join('')}
        </div>
        <button class="icon-btn" type="button" data-go="${UI.ovTab === 'ms' ? '#/impl/milestones' : UI.ovTab === 'cal' ? '#/timeline' : '#/impl/gantt'}" aria-label="Открыть полностью" title="Открыть полностью">${ico('expand')}</button>
      </header>
      <div class="pad" id="ov-sched">${UI.ovTab === 'gantt' ? ovGantt() : UI.ovTab === 'ms' ? msOrdinal(M.ms.filter(m => m.key)) : calendarBlock()}</div>
    </section>
    ${photoCard()}
  </div>
  ${summaryPanel()}</div>`;
  return { crumbs: [{ t: PROJECT.name }], html, nav: '#/' };
}

/* Итог периода из «Обновления данных»: показывается руководителю на обзоре, если внесён. */
const SUMMARY_F = [['happened', 'Что произошло за период'], ['done', 'Что выполнено'], ['deviations', 'Основные отклонения'], ['causes', 'Причины'], ['measures', 'Принятые меры'], ['forecast', 'Прогноз'], ['changes', 'Основные изменения проекта'], ['questions', 'Вопросы, требующие внимания руководителя']];
const periodLabel = p => { if (!p) return ''; const t = { day: 'день', week: 'неделя', month: 'месяц', custom: 'период' }[p.type] || 'период'; return (p.from && p.to ? (p.from === p.to ? fd(dn(p.from)) : fds(dn(p.from)) + ' — ' + fds(dn(p.to))) : '') + (p.type ? ' · ' + t : ''); };
function summaryPanel(){
  const x = M.summary; if (!x) return '';
  const items = SUMMARY_F.filter(([k]) => x[k]);
  if (!items.length) return '';
  const q = items.find(([k]) => k === 'questions'), rest = items.filter(([k]) => k !== 'questions');
  return `<section class="panel"><header><h2>Итог периода</h2><span class="sub">${esc(periodLabel(x.period))}${x.responsible ? ' · ' + esc(x.responsible) : ''}</span></header>
    <div class="pad" style="display:flex; flex-direction:column; gap:12px">
      ${q ? `<div class="note warn"><b>${esc(q[1])}.</b> ${esc(x.questions)}</div>` : ''}
      <div class="grid2e" style="gap:12px 24px">${rest.map(([k, t]) => `<div><div class="eyebrow" style="margin-bottom:4px">${esc(t)}</div><div style="font-size:13.5px; white-space:pre-line">${esc(x[k])}</div></div>`).join('')}</div>
    </div></section>`;
}
/* Реестр рисков и ключевые события — одни и те же блоки на страницах любого объекта. */
const PROB_C = v => ({ 'Высокая': 'crit', 'Высокое': 'crit', 'Средняя': 'warn', 'Среднее': 'warn', 'Низкая': 'neutral', 'Низкое': 'neutral' }[v] || 'neutral');
function registerPanel(){
  const R = M.register; if (!R.length) return '';
  return `<section class="panel"><header><h2>Реестр рисков</h2><span class="sub">${R.filter(r => r.open).length} открытых · ${R.length} всего · ведётся в «Обновлении данных»</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:1080px"><thead><tr><th class="l">Риск</th><th class="l">Категория</th><th class="l">Вероятность</th><th class="l">Влияние</th><th class="l">Статус</th><th class="l">Ответственный</th><th class="l">Мероприятие</th><th>Срок</th></tr></thead><tbody>
    ${R.map(r => `<tr style="${r.open ? '' : 'color:var(--ink-3)'}"><td class="l wrap" style="font-weight:600; max-width:280px">${esc(r.name)}${r.desc ? `<div class="faint" style="font-size:11.5px; font-weight:400">${esc(r.desc)}</div>` : ''}${r.comment ? `<div class="faint" style="font-size:11.5px; font-weight:400">${esc(r.comment)}</div>` : ''}</td><td class="l faint">${esc(r.cat || '—')}</td>
      <td class="l">${r.prob ? chip(r.prob, PROB_C(r.prob)) : '—'}</td><td class="l">${r.impact ? chip(r.impact, PROB_C(r.impact)) : '—'}</td><td class="l">${chip(r.status || 'Открыт', r.open ? 'accent' : 'good')}</td>
      <td class="l">${esc(r.owner || '—')}</td><td class="l wrap" style="max-width:260px">${esc(r.action || '—')}</td><td style="color:${r.open && r.due && dn(r.due) < M.T ? 'var(--crit)' : 'inherit'}">${r.due ? fds(dn(r.due)) : '—'}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}
function eventsPanel(limit){
  const E = M.events; if (!E.length) return '';
  const list = limit ? E.slice(0, limit) : E;
  return `<section class="panel"><header><h2>Ключевые события</h2><span class="sub">${E.length} ${plural(E.length, 'событие', 'события', 'событий')} · вносятся в «Обновлении данных»</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:860px"><thead><tr><th>Дата</th><th class="l">Категория</th><th class="l">Событие</th><th class="l">Влияние</th><th class="l">Статус</th></tr></thead><tbody>
    ${list.map(e => `<tr><td>${e.date ? fd(dn(e.date)) : '—'}</td><td class="l faint">${esc(e.cat || '—')}</td><td class="l wrap" style="max-width:420px"><b>${esc(e.name || '—')}</b>${e.desc ? `<div class="faint" style="font-size:12px">${esc(e.desc)}</div>` : ''}</td><td class="l">${e.impact ? chip(e.impact, PROB_C(e.impact)) : '—'}</td><td class="l">${esc(e.status || '—')}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}
function currentStage(){
  if (CFG.stageLabel) return CFG.stageLabel;
  // Текущий этап — из данных: этап верхнего уровня, где идёт работа (есть незавершённый факт),
  // при нескольких — с самой свежей записью факта. Названия этапов в коде не перечисляются.
  const lastFact = n => Math.max(-Infinity, ...n.leafs.map(l => { const h = M.nodes.get(l).hist; return h && h.length ? h[h.length - 1][0] : -Infinity; }));
  const act = stageRows().filter(n => n.pc > 0.05 && n.pc < 99.95 && n.leafs.some(l => { const x = M.nodes.get(l); return x.pc > 0 && x.pc < 100; }));
  act.sort((a, b) => lastFact(b) - lastFact(a) || b.pc - a.pc);
  return act.length ? shortName(act[0].name) : 'Строительство';
}

function ovGantt(){
  const [A0, A1] = range(), P = t => ((t - A0) / (A1 - A0) * 100).toFixed(2);
  const T = M.T;
  const years = [];
  for (let y = new Date(A0 * DAY).getUTCFullYear(); y <= new Date(A1 * DAY).getUTCFullYear(); y++){ [1, 7].forEach(m => { const t = dn(`${y}-${String(m).padStart(2,'0')}-01`); if (t > A0 && t < A1) years.push({ t, l: m === 1 ? String(y) : 'II п/г', b: m === 1 }); }); }
  const allStages = stageRows(), OV_MAX = 14;
  const rows = allStages.slice(0, OV_MAX).map(n => {
    const [tr, fi] = barCols(n);
    const ext = n.ff > n.f0 ? `<span class="gext" style="left:${P(n.f0)}%; width:${(P(n.ff) - P(n.f0)).toFixed(2)}%"></span>` : '';
    return `<button class="mg-row" type="button" data-go="${n.sm ? '#/node/' + n.u : '#/work/' + n.u}" title="${esc(n.name)} · ${esc(n.st.t)}">
      <span class="nm"><span style="${n.st.k === 'future' ? 'color:var(--ink-2)' : 'font-weight:600'}">${esc(shortName(n.name))}</span><span style="color:${stVar(n.st.c)}">${pctTxt(n.pc)}</span></span>
      <span class="tl"><span class="gbar" style="left:${P(n.s0)}%; width:${(P(n.f0 + 1) - P(n.s0)).toFixed(2)}%; background:${tr}"><i style="width:${n.pc}%; background:${fi}"></i></span>${ext}</span>
    </button>`;
  }).join('');
  return `<div class="mg" data-go="#/impl/gantt">
    <div style="position:relative">
      <div class="mg-axis"><div class="mg-lab"><span>Этап</span><span>Готов.</span></div><div class="mg-time">${years.map(y => `<span style="left:${P(y.t)}%; ${y.b ? 'font-weight:650; color:var(--ink)' : ''}">${y.l}</span>`).join('')}</div></div>
      ${rows}
      <div class="mg-over" style="left:var(--lab, 236px)">
        ${years.map(y => `<span class="vline" style="left:${P(y.t)}%"></span>`).join('')}
        <span class="today-line" style="left:${P(T)}%; top:24px; bottom:-4px"></span>
        <span class="today-pill" style="left:${P(T)}%; top:3px">Сегодня · ${fds(T).slice(0,5)}</span>
      </div>
    </div>
    <div class="legend" style="margin-top:12px">
      <span><i style="background:var(--good)"></i>Выполнено</span><span><i style="background:var(--accent)"></i>В работе</span>
      <span><i style="background:var(--warn)"></i>Отставание</span><span><i style="border:1.5px dashed var(--warn); background:none"></i>Сдвиг по прогнозу</span>
      <span><i style="background:var(--track)"></i>Не начато</span>
      <span style="margin-left:auto" class="faint">${allStages.length > OV_MAX ? `Показаны ${OV_MAX} из ${allStages.length} этапов · остальные — в полном Ганте` : 'Нажмите этап — откроются его работы'}</span>
    </div>
  </div>
  <style>@media (max-width:767px){ .mg-over{left:128px !important} }</style>`;
}

const msGo = m => m.node ? (m.node.sm ? '#/node/' : '#/work/') + m.node.u : '#/impl/milestones';
function msOrdinal(list){
  const entries = list.map(m => ({
    name:m.name, date:fd(m.plan), iso:iso(m.plan), state:m.k,
    status:m.t, sub:m.sub,
    target:msGo(m)
  }));
  return DSFlowProject.milestones({list:entries,today:iso(M.T),action:'data-go'}) +
    '<p class="faint" style="font-size:12px;margin-top:14px">Статус вехи считается по графику и прогнозу на дату среза или по фактической дате, внесённой в обновлении данных. Нажмите веху — откроется связанная работа.</p>';
}

function calendarBlock(full){
  const T = M.T, start = dn(PROJECT.start), pEnd = dn(PROJECT.planEnd), ff = M.root.ff;
  const end = Math.max(pEnd, ff), total = pEnd - start, passed = T - start, delay = ff - pEnd;
  const P = t => ((t - start) / (end - start) * 100).toFixed(2);
  const msCol = m => m.k === 'done' ? 'var(--good)' : m.k === 'over' ? 'var(--crit)' : m.k === 'risk' ? 'var(--warn)' : 'var(--ink-2)';
  const cal = DSFlowProject.calendarYears({start:PROJECT.start,end:iso(end),today:iso(T),
    events:M.ms.map(m=>({iso:iso(m.plan),name:m.name,state:m.k})),
    action:'data-go',target:()=>'#/impl/milestones'});
  return `
  <div class="stat4">
    <div class="stat"><div class="eyebrow">Прошло</div><div class="v">${passed} <small>дн.</small></div></div>
    <div class="stat"><div class="eyebrow">Осталось</div><div class="v">${pEnd - T} <small>дн.</small></div></div>
    <div class="stat"><div class="eyebrow">Использовано</div><div class="v">${fp(passed / total * 100)} <small>% времени</small></div></div>
    <div class="stat ${delay > 0 ? 'warn' : 'good'}"><div class="eyebrow">Прогноз · ${esc(CFG.planEndLabel)}</div><div class="v">${delay > 0 ? '+' + delay + ' <small>дн.</small>' : 'в срок'}</div></div>
  </div>
  <div class="path" style="margin-top:18px">
    <span class="base" style="right:${(100 - P(pEnd)).toFixed(2)}%"></span>
    <span class="done" style="width:${P(T)}%"></span>
    ${delay > 0 ? `<span style="position:absolute; top:32px; height:8px; left:${P(pEnd)}%; width:${(P(ff) - P(pEnd)).toFixed(2)}%; border:1.5px dashed var(--warn); border-left:0; border-radius:0 99px 99px 0"></span>` : ''}
    ${M.ms.map(m => `<span class="tick" style="left:${P(m.plan)}%; background:${msCol(m)}" title="${esc(m.name)} · ${fd(m.plan)}"></span>`).join('')}
    <span class="knob" style="left:${P(T)}%"></span>
    <span class="lab" style="left:${P(T)}%; top:0; transform:translateX(-50%); color:var(--accent-2); font-weight:650">Сегодня · ${fd(T)}</span>
    <span class="lab" style="left:0; top:50px"><b style="color:var(--ink)">Старт</b> ${fd(start)}</span>
    <span class="lab" style="left:${P(pEnd)}%; top:50px; transform:translateX(${delay > 0 ? '-100%' : '-100%'})"><b style="color:var(--ink)">${esc(CFG.planEndLabel)}, план</b> ${fd(pEnd)}</span>
    ${delay > 0 ? `<span class="lab" style="right:0; top:0; color:var(--warn-ink); font-weight:650">Прогноз ${fd(ff)}</span>` : ''}
  </div>
  <div class="cal" style="margin-top:14px">
    <div class="cal-r" style="font-size:10.5px; color:var(--ink-3); font-weight:650; text-align:center"><span></span>${MONTHS.map(m => `<span>${m}</span>`).join('')}</div>
    ${cal}
  </div>
  <div class="legend" style="margin-top:12px">
    <span><i style="background:var(--past)"></i>Пройдено</span><span><i style="background:var(--accent)"></i>Текущий месяц</span><span><i style="background:var(--surface-2)"></i>Впереди</span>
    ${delay > 0 ? '<span><i style="border:1.5px dashed var(--warn); background:none"></i>Сдвиг по прогнозу</span>' : ''}
    <span><i style="width:8px;height:8px;border-radius:50%;background:var(--good)"></i>Веха выполнена</span><span><i style="width:8px;height:8px;border-radius:50%;background:var(--crit)"></i>Просрочена</span><span><i style="width:8px;height:8px;border-radius:50%;background:var(--warn)"></i>Под угрозой</span>
  </div>`;
}

function photoCard(){
  const all = allPhotos();
  const last = all[0];
  const dates = photoDates().slice(1, 5);
  return `<section class="panel" style="display:flex; flex-direction:column">
    <header><h2>Объект сейчас</h2><span class="sub" style="margin-left:auto">${last ? all.filter(p => p.date === last.date).length + ' фото в отчёте' : ''}</span></header>
    <div class="pad" style="display:flex; flex-direction:column; gap:12px; flex:1">
      ${last ? `<button class="photo-hero" type="button" data-go="#/photos/${last.date}" aria-label="Открыть фото за ${fd(dn(last.date))}">
        <img src="${last.src}" alt="${esc(last.caption)}">
        <span class="pill-dark" style="position:absolute; left:12px; top:12px">${esc(last.zone)}</span>
        <span class="ov"><span class="pill-dark num">${fd(dn(last.date))}</span><span class="pill-light" data-go="#/photos">Все фото ${ico('right', 15)}</span></span>
      </button>` : '<div class="empty">Фото ещё не загружены</div>'}
      <div class="thumbs">${dates.map(d => { const p = all.find(x => x.date === d); return `<button class="thumb" type="button" data-go="#/photos/${d}"><img src="${p.src}" alt=""><span class="num">${fds(dn(d))}</span></button>`; }).join('')}</div>
      ${last && last.demo ? '<p class="faint" style="font-size:12px">Демо-кадры до загрузки фото из отчётов. Загрузка — в разделе «Фото».</p>' : ''}
    </div>
  </section>`;
}
/* ================= РЕАЛИЗАЦИЯ: структура, вехи, этап, работа ================= */
function implTabs(active){
  return `<div class="seg" role="tablist">${[['structure','Структура'],['gantt','Диаграмма Ганта'],['milestones','Ключевые вехи']].map(([k, t]) => `<button role="tab" type="button" data-go="#/impl/${k}" aria-selected="${active === k}">${t}</button>`).join('')}</div>`;
}
function implHead(active, sub){
  return DSFlowProject.implementationHead({active,subtitle:sub});
}
function nodeTiles(n){
  const lag = M.lagDays(n.u);
  const leafs = n.leafs.map(l => M.nodes.get(l)).filter(x => x.u > 0 || n.u === -1 || (CFG.stagePrefix || []).includes(n.u));
  const cntOver = leafs.filter(x => x.st.k === 'over').length, cntAct = leafs.filter(x => x.pc > 0 && x.pc < 100).length;
  return `<div class="tiles">
    <div class="tile"><div class="eyebrow">Готовность</div><div class="v">${fpct(n.pc, 1)}</div><div class="s">факт на ${fds(M.T)}</div></div>
    <div class="tile"><div class="eyebrow">План на сегодня</div><div class="v">${fpct(n.planNow, 1)}</div><div class="s">по ГПР${S.baseline ? '' : ''}</div></div>
    <div class="tile ${n.devPP < -5 ? 'crit' : n.devPP < -0.5 ? 'warn' : 'good'}"><div class="eyebrow">Отклонение</div><div class="v">${n.devPP >= 0 ? '+' : '−'}${fp(Math.abs(n.devPP), 1)} <small>п.п.</small></div><div class="s">${lag > 0 ? 'отставание по объёму ' + lag + ' дн.' : 'в графике'}</div></div>
    <div class="tile ${n.devDays > 0 ? 'warn' : ''}"><div class="eyebrow">Окончание</div><div class="v" style="font-size:18px">${fd(n.f0)}</div><div class="s">прогноз ${fd(n.ff)} ${n.devDays > 0 ? '· <b style="color:var(--warn-ink)">+' + n.devDays + ' дн.</b>' : ''}</div></div>
    <div class="tile"><div class="eyebrow">Работ</div><div class="v">${leafs.length}</div><div class="s">в работе ${cntAct} · просрочено <b style="color:${cntOver ? 'var(--crit)' : 'inherit'}">${cntOver}</b></div></div>
  </div>`;
}
function sCurve(n, opts = {}){
  const T = M.T, from = Math.min(n.s0, n.asE ?? n.s0), to = Math.max(n.f0, n.ff) + 7;
  const step = Math.max(3, Math.round((to - from) / 90));
  const ts = series(n.u, from, to, step);
  const plan = ts.map(t => [t, M.curve(n.u, 'plan', t)]);
  const fact = ts.filter(t => t <= T).map(t => [t, M.curve(n.u, 'fact', t)]); if (T >= from) fact.push([T, n.pc]);
  const fc = [...(T >= from ? [[T, n.pc]] : []), ...ts.filter(t => t > T).map(t => [t, M.curve(n.u, 'fc', t)])];
  const ser = [
    { name: 'План (ГПР)', color: 'var(--ink-2)', pts: plan, width: 2 },
    { name: 'Факт', color: 'var(--accent)', pts: fact, width: 3, end: true, area: true },
    { name: 'Прогноз', color: 'var(--warn)', pts: fc, dash: '6 5', width: 2.25 }
  ];
  if (S.baseline) ser.unshift({ name: 'Базовый план', color: 'var(--ink-3)', pts: ts.map(t => [t, M.curve(n.u, 'base', t)]), dash: '2 4', width: 1.5 });
  const marks = [{ t: T, label: 'Сегодня', color: 'var(--accent)', w: 2 }, { t: n.f0, label: 'План ' + fds(n.f0), color: 'var(--ink-2)', dash: true, row: n.ff - n.f0 < 60 && n.ff > n.f0 ? 1 : 0 }];
  if (n.ff > n.f0) marks.push({ t: n.ff, label: 'Прогноз ' + fds(n.ff), color: 'var(--warn)', dash: true });
  return lineChart({ w: opts.w || 900, h: opts.h || 320, x0: from, x1: to, y0: 0, y1: 100, yTicks: [0, 25, 50, 75, 100], yFmt: v => v + ' %',
    series: ser, marks, band: n.devPP < -1 && n.pc < 100 ? { t: T, a: n.pc, b: n.planNow, label: '−' + fp(-n.devPP, 1) + ' п.п.' } : null, label: 'Накопительная готовность ' + n.name });
}

function viewStructure(){
  const R = M.root, MD = M.model;
  const srcCell = U => {
    if (U.kind === 'own' || U.kind === 'mix'){ const n = U.groups.reduce((a, g) => a + g.leafs.length, 0); return `<span class="chip accent" title="Задачи ГПР: ${esc(U.refs.map(r => M.nodes.get(r)?.name || r).join(', '))}">ГПР · ${n} зад.</span>`; }
    if (U.kind === 'model') return `<span class="chip neutral" title="Строка в Ганте, группа «Работы вне ГПР»">вне ГПР</span>`;
    if (U.kind === 'proxy') return `<span class="chip warn" title="${esc(U.note)}">допущение</span>`;
    return '—';
  };
  const go = U => { const r = U.own[0] ?? U.refs[0]; const n = M.nodes.get(r); return n ? (n.sm ? '#/node/' : '#/work/') + n.u : ''; };
  const bar = (pc, plan, c) => `<div class="minib"><span class="bar"><i style="width:${pc}%; --c:${c}"></i>${pc < 99.95 && plan > 0.5 ? `<b style="left:${plan}%"></b>` : ''}</span><b>${pctTxt(pc)}</b></div>`;
  const col = (pc, plan) => pc >= 99.95 ? 'var(--good)' : pc < plan - 5 ? 'var(--warn)' : 'var(--accent)';
  const rows = [];
  MD.sections.forEach(S_ => {
    const op = UI.secOpen.has(S_.id);
    rows.push(`<tr class="sec-row link" data-act="sec-tog" data-sec="${S_.id}" aria-expanded="${op}"><td class="l"><span class="sec-chev" style="display:inline-block; transform:rotate(${op ? 90 : 0}deg); transition:transform .15s">${ico('chev', 12)}</span> <b>${esc(S_.id)} · ${esc(S_.name)}</b> <span class="faint" style="font-size:12px">· ${S_.works.length} раб.</span></td><td></td><td><b>${fp(S_.weight, 1)} %</b></td><td><b>${fp(S_.abs * 100, 2)} %</b></td><td>${fpct(S_.planNow)}</td><td>${bar(S_.pc, S_.planNow, col(S_.pc, S_.planNow))}</td><td><b>${fp(S_.contrib, 2)}</b></td><td></td></tr>`);
    if (op) S_.works.forEach(W_ => {
      const single = !W_.subs ? W_.units[0] : null;
      rows.push(`<tr class="${single ? 'link' : ''} ${W_.excluded ? 'excl' : ''}" ${single && go(single) ? `data-go="${go(single)}"` : ''}><td class="l wrap" style="padding-left:24px">${esc(W_.name)}${W_.excluded ? ' <span class="chip neutral">не в объёме · Shell & Core</span>' : ''}${W_.note && !W_.subs ? `<div class="faint" style="font-size:11.5px">${esc(W_.note)}</div>` : ''}</td>
        <td class="faint">${esc(W_.unit || '—')}${W_.plannedQty != null ? ' · ' + fp(W_.plannedQty) : ''}</td><td>${W_.excluded ? '<s>' + fp(W_.weight, 1) + ' %</s>' : fp(W_.wWithin, 1) + ' %'}</td><td>${fp(W_.abs * 100, 3)} %</td><td>${W_.excluded ? '—' : fpct(W_.planNow)}</td>
        <td>${W_.excluded ? '—' : bar(W_.pc, W_.planNow, col(W_.pc, W_.planNow))}</td><td>${W_.excluded ? '—' : fp(W_.contrib, 3)}</td><td class="l">${single ? srcCell(single) : '<span class="faint" style="font-size:12px">' + W_.units.length + ' подработ</span>'}</td></tr>`);
      if (W_.subs) W_.units.forEach(U => rows.push(`<tr class="link sub2" ${go(U) ? `data-go="${go(U)}"` : ''}><td class="l wrap" style="padding-left:44px">${esc(U.name)}${U.note ? `<div class="faint" style="font-size:11.5px">${esc(U.note)}</div>` : ''}</td><td class="faint">${esc(U.unitName || '—')}</td><td class="faint">${fp(U.subWeight, 1)} % раб.</td><td>${fp(U.abs * 100, 3)} %</td><td>${fpct(U.planNow)}</td><td>${bar(U.pc, U.planNow, col(U.pc, U.planNow))}</td><td>${fp(U.contrib, 3)}</td><td class="l">${srcCell(U)}</td></tr>`));
    });
  });
  const okAll = MD.checks.every(c => c.ok);
  const html = `
  ${implHead('structure', `Физическая готовность ${fpct(R.pc, 1)} при плане ${fpct(R.planNow, 1)} · прогноз окончания ${fd(R.ff)}`)}
  ${nodeTiles(R)}
  <section class="panel"><header><h2>Накопительная готовность объекта</h2><span class="sub">план · факт · прогноз, % физической готовности по модели весов ${MD.cfg.auto ? '(по длительности ГПР)' : 'объекта'}</span></header>
    <div class="pad">${sCurve(R)}</div></section>
  <section class="panel"><header><h2>Структура готовности объекта</h2><button class="btn sm" type="button" data-act="sec-all" data-v="${UI.secOpen.size === MD.sections.length ? 0 : 1}">${UI.secOpen.size === MD.sections.length ? 'Свернуть разделы' : 'Развернуть все разделы'}</button><span class="sub">готовность объекта = Σ (абсолютный вес работы × выполнение работы)</span>${chip('Модель: ' + MD.cfg.objectType + ' · веса ' + ({ expert: 'экспертные', budget: 'по бюджету', hybrid: 'гибридные', duration: 'по длительности ГПР' }[MD.cfg.weightModel]), 'neutral')}</header>
    <div class="tbl-wrap"><table class="t struct-t" style="min-width:1080px">
      <thead><tr><th>Раздел / работа</th><th class="l">Ед.</th><th>Вес в разделе</th><th>Абс. вес</th><th>План сег.</th><th class="l" style="min-width:170px">Выполнение · метка = план</th><th>Вклад, п.п.</th><th class="l">Источник факта</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
      <tfoot><tr><td class="l">Объект</td><td></td><td>${fp(MD.cfg.sections.reduce((a, s_) => a + s_.weight, 0), 1)} %</td><td>${fp(MD.absTotal * 100, 2)} %</td><td>${fpct(R.planNow, 1)}</td><td class="l"><b>${fpct(R.pc, 2)}</b></td><td>${fp(MD.units.reduce((a, U) => a + U.contrib, 0), 2)}</td><td></td></tr></tfoot></table></div>
    <div class="pad" style="padding-top:14px"><p class="note">${MD.cfg.auto ? 'Согласованной модели весов для объекта пока нет, поэтому применены веса по длительности: раздел — этап верхнего уровня ГПР, работа — его строка, вес — доля рабочих дней её задач. Факт — процент выполнения из ГПР на ' + fd(M.FILE) + (M.base.length ? ' и подтверждённые объёмы из суточных сводок площадки' : '') + '. ' : ''}Абсолютный вес = вес раздела × вес работы в разделе (× вес подработы). Вклад работы в объект = абсолютный вес × выполнение. Выполнение работы берётся из задач ГПР, которыми она владеет (факт задач взвешен по длительности); каждая задача ГПР принадлежит только одной работе. «Допущение» — отдельной строки в ГПР нет, прогресс берётся с указанной задачи. «Вне ГПР» — строка в Ганте, куда вносится факт.${MD.cfg.auto ? '' : ' Конфигурация весов — объект PROGRESS_MODEL.'}</p></div>
  </section>
  <section class="panel"><header><h2>Проверка модели</h2>${chip(okAll ? 'Все проверки пройдены' : 'Есть замечания', okAll ? 'good' : 'crit')}</header>
    <div class="pad"><div class="checks">${MD.checks.map(c => `<div class="chk"><span class="dot" style="background:${c.ok ? 'var(--good)' : 'var(--crit)'}"></span><div><b>${esc(c.t)}</b><div class="faint" style="font-size:12.5px">${esc(c.d)}</div></div></div>`).join('')}</div></div>
  </section>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Реализация' }, { t: 'Структура' }], html, nav: '#/impl/structure' };
}

function viewMilestones(){
  const rows = M.ms.map(m => `<tr class="${m.node ? 'link' : ''}" ${m.node ? `data-go="${msGo(m)}"` : ''}>
    <td class="l wrap" style="font-weight:600">${esc(m.name)}${m.key ? ' <span class="faint" style="font-size:11px">· ключевая</span>' : ''}${m.comment ? `<div class="faint" style="font-size:11.5px; font-weight:400">${esc(m.comment)}</div>` : ''}</td>
    <td class="l faint">${esc(m.cat || '—')}</td>
    <td>${fd(m.plan)}</td><td style="color:${m.fc > m.plan && !m.done ? 'var(--warn-ink)' : 'inherit'}">${m.done ? '—' : fd(m.fc)}</td>
    <td>${m.actual && m.done ? fd(m.actual) : '—'}</td>
    <td>${m.daysTo != null ? m.daysTo + ' дн.' : '—'}</td><td style="color:${m.overdue && !m.done ? 'var(--crit)' : 'inherit'}">${m.overdue ? m.overdue + ' дн.' : '—'}</td>
    <td>${chip(m.t, m.c)}</td><td class="l faint wrap">${m.node ? esc(m.node.name) : 'собственная дата'}</td></tr>`).join('');
  const html = `${implHead('milestones', 'Контрольные события проекта. Статус рассчитывается по связанной работе графика или по датам вехи.')}
  <section class="panel"><header><h2>Путь по вехам</h2></header><div class="pad">${msOrdinal(M.ms.filter(m => m.key))}</div></section>
  <section class="panel"><header><h2>Все вехи</h2><span class="sub">${M.ms.length} событий</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:980px"><thead><tr><th>Веха</th><th class="l">Категория</th><th>План</th><th>Прогноз</th><th>Факт</th><th>До наступления</th><th>Просрочка</th><th class="l">Статус</th><th class="l">Связанная работа</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Реализация', go: '#/impl/structure' }, { t: 'Ключевые вехи' }], html, nav: '#/impl/structure' };
}

function crumbsFor(n, tail){
  const c = [{ t: PROJECT.name, go: '#/' }, { t: 'График', go: '#/impl/gantt' }];
  ancestors(n.u).filter(a => a.u !== -1).forEach(a => c.push({ t: shortName(a.name), go: '#/node/' + a.u, mid: true }));
  c.push({ t: shortName(n.name), go: tail ? (n.sm ? '#/node/' : '#/work/') + n.u : null });
  if (tail) c.push({ t: tail });
  // промежуточные уровни сворачиваются на телефоне
  c.forEach((x, i) => { if (i > 0 && i < c.length - 2) x.mid = true; });
  return c;
}

function viewNode(u){
  const n = M.nodes.get(u);
  if (!n) return viewMissing();
  if (!n.sm) return viewWork(u);
  const kids = n.kids.map(k => M.nodes.get(k));
  const from = Math.min(...kids.map(k => k.s0)), to = Math.max(...kids.map(k => Math.max(k.f0, k.ff))) + 1;
  const P = t => ((t - from) / (to - from) * 100).toFixed(2);
  const rows = kids.map(k => { const [tr, fi] = barCols(k); return `<tr class="link" data-go="${k.sm ? '#/node/' : '#/work/'}${k.u}">
    <td class="l wrap" style="font-weight:${k.sm ? 650 : 500}">${esc(k.name)}${k.sm ? ` <span class="faint" style="font-size:11.5px">· ${k.leafs.length} раб.</span>` : ''}</td>
    <td><div class="minib"><span class="bar"><i style="width:${k.pc}%; --c:${stVar(k.st.c === 'neutral' ? 'accent' : k.st.c)}"></i></span><b>${pctTxt(k.pc)}</b></div></td>
    <td>${fds(k.s0)}</td><td>${fds(k.f0)}</td><td style="color:${k.devDays > 0 ? 'var(--warn-ink)' : 'inherit'}">${fds(k.ff)}</td>
    <td style="min-width:220px; position:relative"><span style="position:relative; display:block; height:14px">
      <span class="gbar" style="top:1px; left:${P(k.s0)}%; width:${Math.max(0.6, P(k.f0 + 1) - P(k.s0)).toFixed(2)}%; background:${tr}"><i style="width:${k.pc}%; background:${fi}"></i></span>
      ${k.ff > k.f0 ? `<span class="gext" style="top:1px; left:${P(k.f0 + 1)}%; width:${(P(k.ff) - P(k.f0 + 1)).toFixed(2)}%"></span>` : ''}
      ${M.T >= from && M.T <= to ? `<span style="position:absolute; top:-6px; bottom:-6px; width:2px; background:var(--accent); left:${P(M.T)}%"></span>` : ''}
    </span></td>
    <td class="l">${chip(k.st.t, k.st.c)}</td></tr>`; }).join('');
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 3 · Этап · ${esc(n.code)}</div><h1 style="margin-top:6px">${esc(n.name)}</h1>
    <div class="meta">${chip(n.st.t, n.st.c)}<span>План ${fd(n.s0)} — ${fd(n.f0)}</span>${n.asE ? `<span>Факт. начало ${fd(n.asE)}</span>` : ''}${n.cr ? chip('Критический путь', 'crit') : ''}</div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap"><button class="btn" type="button" data-act="gantt-focus" data-u="${n.u}">${ico('gantt')}Показать на Ганте</button></div></div>
  ${nodeTiles(n)}
  ${HOOKS.nodeExtra ? HOOKS.nodeExtra(n) : ''}
  <section class="panel"><header><h2>Динамика этапа</h2><span class="sub">сумма работ этапа, взвешенная по длительности</span></header><div class="pad">${sCurve(n)}</div></section>
  <section class="panel"><header><h2>Состав</h2><span class="sub">${kids.length} позиций · нажмите строку, чтобы углубиться</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:980px"><thead><tr><th>Работа</th><th class="l">Готовность</th><th>Начало</th><th>Оконч.</th><th>Прогноз</th><th class="l">${fds(from)} — ${fds(to)}</th><th class="l">Статус</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  ${relBlock(n)}`;
  return { crumbs: crumbsFor(n), html, nav: '#/impl/structure' };
}

function relBlock(n){
  if (!n.preds.length && !n.succs.length) return '';
  const typ = { FS: 'окончание → начало', SS: 'начало → начало', FF: 'окончание → окончание', SF: 'начало → окончание' };
  const li = (x, dir) => { const o = M.nodes.get(x.u); return `<tr class="link" data-go="${o.sm ? '#/node/' : '#/work/'}${o.u}"><td class="l wrap"><span class="faint" style="font-size:11.5px">${dir}</span><br>${esc(o.name)} <span class="faint" style="font-size:11.5px">· ${esc(o.code)}</span></td><td class="l faint">${typ[x.type] || x.type}${x.lag ? ', ' + (x.lag > 0 ? '+' : '') + x.lag + ' раб. дн.' : ''}</td><td>${pctTxt(o.pc)}</td><td style="color:${o.devDays > 0 ? 'var(--warn-ink)' : 'inherit'}">${fds(o.ff)}</td><td class="l">${chip(o.st.t, o.st.c)}</td></tr>`; };
  return `<section class="panel"><header><h2>Связи</h2><span class="sub">сдвиг предшественника переносит прогноз последователей</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:680px"><thead><tr><th>Работа</th><th class="l">Тип связи</th><th>Готов.</th><th>Прогноз оконч.</th><th class="l">Статус</th></tr></thead>
    <tbody>${n.preds.map(p => li(p, 'Предшественник')).join('')}${n.succs.map(s => li(s, 'Последователь')).join('')}</tbody></table></div></section>`;
}

function viewWork(u){
  const n = M.nodes.get(u);
  if (!n) return viewMissing();
  if (n.sm) return viewNode(u);
  const T = M.T, cd = n.f0 - n.s0 + 1;
  const planPace = 100 / cd * 7;                                  // %/нед по плану
  const avgPace = n.asE != null && n.pc > 0 ? n.pc / Math.max(1, (Math.min(T, n.afE ?? T) - n.asE)) * 7 : null;
  const daysLeftPlan = n.f0 - T;
  const reqPace = n.pc < 100 ? (daysLeftPlan > 0 ? (100 - n.pc) / daysLeftPlan * 7 : null) : 0;
  const lag = M.lagDays(u);
  const from = Math.min(n.s0, n.hist.length ? n.hist[0][0] : n.s0) - 7, to = Math.max(n.f0, n.ff, n.ffPace && n.ffPace - n.f0 < 400 ? n.ffPace : 0, T) + 10;
  const plan = [[from, 0], [n.s0, 0], [n.f0 + 1, 100], [to, 100]];
  const fact = n.hist.length ? [...n.hist.filter(h => h[0] <= T)] : [];
  if (fact.length && fact[fact.length - 1][0] < T && n.pc < 100) fact.push([T, n.pc]);
  const ser = [{ name: 'План (ГПР)', color: 'var(--ink-2)', pts: plan, width: 2 }];
  if (S.baseline && n.bs != null) ser.unshift({ name: 'Базовый план', color: 'var(--ink-3)', pts: [[from, 0], [n.bs, 0], [n.bf + 1, 100], [to, 100]], dash: '2 4', width: 1.5 });
  if (fact.length) ser.push({ name: 'Факт', color: 'var(--accent)', pts: fact, width: 3, dots: true, area: true });
  if (n.pc < 100) ser.push({ name: 'Прогноз', color: 'var(--warn)', pts: [[T, n.pc], [n.ff, 100]], dash: '6 5' });
  if (n.ffPace && n.ffPace !== n.ff && n.ffPace - n.f0 < 400) ser.push({ name: 'Сценарий по фактическому темпу', color: 'var(--ink-3)', pts: [[T, n.pc], [n.ffPace, 100]], dash: '2 5', width: 1.5 });
  const marks = [{ t: T, label: 'Сегодня', color: 'var(--accent)', w: 2 }, { t: n.f0, label: 'План ' + fds(n.f0), color: 'var(--ink-2)', dash: true, row: Math.abs(n.ff - n.f0) < 50 && n.ff !== n.f0 ? 1 : 0 }];
  if (n.ff !== n.f0 && n.pc < 100) marks.push({ t: n.ff, label: 'Прогноз ' + fds(n.ff), color: 'var(--warn)', dash: true });
  const chart = lineChart({ w: 900, h: 330, x0: from, x1: to, y0: 0, y1: 100, yTicks: [0, 25, 50, 75, 100], yFmt: v => v + ' %', series: ser, marks,
    band: n.devPP < -1 && n.pc < 100 ? { t: T, a: n.pc, b: n.planNow, label: '−' + fp(-n.devPP, 1) + ' п.п.' } : null, label: 'Динамика ' + n.name });
  const contract = M.contracts.find(c => c.wbs.some(w => w === n.u || ancestors(n.u).some(a => a.u === w)));
  const photos = allPhotos().filter(p => p.work === n.u || ancestors(n.u).some(a => a.u === p.work) || M.nodes.get(p.work)?.leafs?.includes(n.u));
  const risks = M.risks.filter(r => r.go === '#/work/' + n.u);
  const recRows = [];
  if (n.pc0 > 0) recRows.push(`<tr><td>${fd(n.pc0 >= 100 ? (n.af0 ?? n.f0) : Math.min(M.FILE, T))}</td><td class="l">ГПР MS Project (импорт)</td><td>—</td><td><b>${pctTxt(n.pc0)}</b></td><td class="l faint">файл от ${fd(M.FILE)}</td><td class="l faint">${n.as0 ? 'факт. начало ' + fd(n.as0) : ''}${n.af0 ? ', факт. окончание ' + fd(n.af0) : ''}</td><td></td></tr>`);
  let acc = n.pc0;
  n.recs.forEach(r => { acc = r.set != null ? clamp(r.set, 0, 100) : clamp(acc + r.delta, 0, 100); recRows.push(`<tr><td>${fd(dn(r.date))}</td><td class="l">${r.admin ? 'Администрирование' : r.base ? esc(r.source || 'Суточная сводка площадки') : r.source === 'update' ? 'Обновление данных' + (r.period ? ' · ' + esc(periodLabel(r.period)) : '') : 'Сводка (ввод в приложении)'}</td><td style="color:${r.set != null ? 'inherit' : r.delta >= 0 ? 'var(--good)' : 'var(--crit)'}">${r.set != null ? '= ' + fp(r.set, 1) + ' %' : (r.delta >= 0 ? '+' : '−') + fp(Math.abs(r.delta), 1) + ' %'}</td><td><b>${pctTxt(acc)}</b></td><td class="l">${esc(r.author || '—')}</td><td class="l wrap">${esc(r.note || '')}</td><td>${r.base || r.admin || r.source === 'update' ? '' : `<button class="btn sm" type="button" data-act="del-rec" data-id="${r.id}">Удалить</button>`}</td></tr>`); });
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 4 · Работа · ${esc(n.code)} · ID в ГПР ${n.mid ?? '—'}</div><h1 style="margin-top:6px">${esc(n.name)}</h1>
    <div class="meta">${chip(n.st.t, n.st.c)}<span>${esc(ancestors(u).filter(a => a.u !== -1).map(a => a.name).join(' › '))}</span>${n.cr ? chip('Критический путь', 'crit') : ''}</div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap"><button class="btn" type="button" data-act="gantt-focus" data-u="${n.u}">${ico('gantt')}На Ганте</button>${UI.admin && editableNode(n) ? `<button class="btn" type="button" data-act="adm-edit" data-u="${n.u}">${ico('pen')}Редактировать</button>` : ''}<button class="btn primary" type="button" data-act="entry" data-u="${n.u}">${ico('plus')}Внести факт</button></div></div>
  <div class="tiles">
    ${n.unit ? `<div class="tile"><div class="eyebrow">Вес в готовности объекта</div><div class="v">${fp(n.unit.abs * 100 * (n.du || 0.5) / (n.unit.groups.find(g => g.leafs.includes(n.u))?.W || 1) * (n.unit.groups.find(g => g.leafs.includes(n.u))?.w || 1), 3)} <small>%</small></div><div class="s">${esc(n.unit.id)} · ${esc(n.unit.name)} (${fp(n.unit.abs * 100, 2)} %)</div></div>` : ''}
    <div class="tile"><div class="eyebrow">Плановый объём</div><div class="v">${n.qP != null ? fp(n.qP, Number.isInteger(n.qP) ? 0 : 1) + ' <small>' + esc(n.uom || '') + '</small>' : '—'}</div><div class="s">${n.du} раб. дн. · ${fd(n.s0)} — ${fd(n.f0)}${n.cnt != null ? ' · кол-во ' + fp(n.cnt) : ''}</div></div>
    <div class="tile"><div class="eyebrow">Выполнено</div><div class="v">${fpct(n.pc, 1)}</div><div class="s">${n.qF != null ? fp(n.qF, Number.isInteger(n.qF) ? 0 : 1) + ' ' + esc(n.uom || '') + ' · ' : ''}${n.asE ? 'начато ' + fd(n.asE) : 'не начато'}${n.afE ? ', окончено ' + fd(n.afE) : ''}</div></div>
    <div class="tile"><div class="eyebrow">План на сегодня</div><div class="v">${fpct(n.planNow, 1)}</div><div class="s">${fd(T)}</div></div>
    <div class="tile ${n.devPP < -5 ? 'crit' : n.devPP < -0.5 ? 'warn' : 'good'}"><div class="eyebrow">Отклонение</div><div class="v">${n.devPP >= 0 ? '+' : '−'}${fp(Math.abs(n.devPP), 1)} <small>п.п.</small></div><div class="s">${lag > 0 ? 'отставание ' + lag + ' дн.' : n.pc >= 100 ? 'выполнено' : 'в графике'}</div></div>
    <div class="tile"><div class="eyebrow">Средний темп</div><div class="v">${avgPace == null ? '—' : fp(avgPace, 1)} <small>%/нед</small></div><div class="s">план ${fp(planPace, 1)} %/нед</div></div>
    <div class="tile ${reqPace != null && reqPace > planPace * 1.5 ? 'warn' : ''}"><div class="eyebrow">Нужный темп</div><div class="v">${n.pc >= 100 ? '—' : reqPace == null ? 'срок прошёл' : fp(reqPace, 1)} ${reqPace != null && n.pc < 100 ? '<small>%/нед</small>' : ''}</div><div class="s">чтобы закончить к ${fds(n.f0)}</div></div>
    <div class="tile ${n.devDays > 0 ? 'warn' : ''}"><div class="eyebrow">Прогноз окончания</div><div class="v" style="font-size:18px">${fd(n.ff)}</div><div class="s">${n.devDays > 0 ? '+' + n.devDays + ' дн. к плану' : 'в срок'}${n.fcDecl && n.pc < 100 ? ' · ответственный: ' + fds(dn(n.fcDecl)) : ''}</div></div>
    ${n.qPl != null ? `<div class="tile"><div class="eyebrow">Плановый объём на дату</div><div class="v">${fp(n.qPl, Number.isInteger(n.qPl) ? 0 : 1)} <small>${esc(n.uom || '')}</small></div><div class="s">по данным обновления</div></div>` : ''}
  </div>
  ${n.cmt ? `<p class="note">${esc(n.cmt)}</p>` : ''}
  ${HOOKS.workExtra ? HOOKS.workExtra(n) : ''}
  <section class="panel"><header><h2>Динамика выполнения</h2><span class="sub">ось X — время, ось Y — накопительный объём, %. Наведите для значений, нажмите, чтобы выбрать день.</span></header>
    <div class="pad">${chart}
    <p class="faint" style="font-size:12px; margin-top:10px">В ГПР объёмы заданы процентом выполнения. Для работ с натуральными единицами (шт., м³, м²) шкала Y покажет объём, остальные показатели считаются так же.</p></div></section>
  <div class="grid2e">
    ${relBlock(n) || '<section class="panel"><header><h2>Связи</h2></header><div class="pad faint">Связей в ГПР нет</div></section>'}
    <section class="panel"><header><h2>Договор, фото, риски</h2></header><div class="pad" style="display:flex; flex-direction:column; gap:12px">
      ${contract ? `<button class="att" type="button" data-go="#/contract/${contract.id}" style="flex:none"><span class="dot" style="background:var(--accent)"></span><span class="tx"><b>${esc(contract.short)}</b> · ${esc(contract.counterparty)}</span>${ico('chev')}</button>` : ''}
      ${photos.length ? `<div class="thumbs">${photos.slice(0, 4).map(p => `<button class="thumb" type="button" data-act="viewer" data-pid="${p.id}"><img src="${p.src}" alt=""><span>${fds(dn(p.date))}</span></button>`).join('')}</div>` : '<p class="faint" style="font-size:13px">Фото с привязкой к этой работе пока нет.</p>'}
      ${risks.length ? risks.map(r => `<div class="note warn">${esc(r.title)} — ${esc(r.text)}</div>`).join('') : '<p class="faint" style="font-size:13px">Открытых рисков по работе нет.</p>'}
    </div></section>
  </div>
  <section class="panel" id="primary"><header><h2>Первичные данные</h2><span class="sub">единственный источник факта: импорт ГПР${M.base.length ? ', суточные сводки площадки' : ''} и записи сводок</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:820px"><thead><tr><th>Дата</th><th class="l">Источник</th><th>Прирост</th><th>Итого</th><th class="l">Автор</th><th class="l">Комментарий</th><th></th></tr></thead>
    <tbody>${recRows.join('') || '<tr><td colspan="7" class="l faint">Записей нет. Работа ещё не начата.</td></tr>'}</tbody></table></div>
    <div class="pad" style="padding-top:14px">${n.pc < 100 ? `<form class="row-f" data-form="quick" data-u="${n.u}" style="grid-template-columns: 150px 120px 1fr auto; align-items:end">
      <div class="fld"><label for="q-date">Дата</label><input id="q-date" type="date" value="${iso(Math.max(T, M.FILE))}" min="${PROJECT.fileDate}"></div>
      <div class="fld"><label for="q-delta">Прирост, %</label><input id="q-delta" type="number" step="0.5" min="-100" max="100" value="2" inputmode="decimal"></div>
      <div class="fld"><label for="q-note">Комментарий</label><input id="q-note" type="text" placeholder="Например: захватка 6, в/о В/5-6"></div>
      <button class="btn primary" type="submit" style="height:44px">Сохранить</button></form>` : '<p class="faint">Работа выполнена. Для исправления внесите отрицательный прирост через «Внести факт».</p>'}</div>
  </section>
  <style>@media (max-width:767px){ form[data-form="quick"]{grid-template-columns:1fr 1fr !important} form[data-form="quick"] .fld:nth-child(3), form[data-form="quick"] button{grid-column:1/-1} }</style>`;
  return { crumbs: crumbsFor(n, 'Динамика'), html, nav: '#/impl/structure' };
}
function viewMissing(){ return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Не найдено' }], html: '<div class="panel"><div class="empty">Такой страницы нет. Вернитесь на обзор.</div></div>' }; }
/* ================= ПОЛНЫЙ ГАНТ ================= */
const SCALES = { year: 0.3, quarter: 1.1, month: 3.2, week: 12, day: 34 };
const SCALE_T = { year: 'Год', quarter: 'Квартал', month: 'Месяц', week: 'Неделя', day: 'День' };
const G = { px: SCALES[S.ganttScale] || 3.2, exp: new Set(LS.get('gexp', [-1, CFG.gpRoot])), focus: null, pendingScroll: 'today' };
const RH = 32;
const FILTERS = [['all','Все'],['active','В работе'],['over','Просрочено'],['late','Отставание'],['crit','Критический путь'],['future','Будущие']];

function gRange(){ return [rangeStart(), Math.max(M.root.ff, dn(PROJECT.planEnd)) + 45]; }
function gCols(){
  const mob = window.innerWidth < 768;
  const c = [{ k: 'name', t: 'Работа', w: mob ? 168 : 300 }, { k: 'pc', t: '%', w: 50 }];
  if (mob) return c;
  c.push({ k: 's', t: 'Начало', w: 76 }, { k: 'f', t: 'Оконч.', w: 76 });
  if (S.ganttCols) c.push({ k: 'du', t: 'Длит.', w: 58 }, { k: 'as', t: 'Факт нач.', w: 76 }, { k: 'af', t: 'Факт ок.', w: 76 }, { k: 'ff', t: 'Прогноз', w: 76 }, { k: 'pr', t: 'Предш.', w: 80 });
  c.push({ k: 'dv', t: 'Δ, дн.', w: 56 });
  return c;
}
function matchFilter(n){
  const f = UI.filter;
  if (f === 'active') return n.pc > 0 && n.pc < 100;
  if (f === 'over') return n.st.k === 'over';
  if (f === 'late') return n.st.k === 'late';
  if (f === 'crit') return n.cr;
  if (f === 'future') return n.pc === 0 && n.s0 > M.T;
  return true;
}
function gRows(){
  const q = UI.q.trim().toLowerCase();
  const filtered = UI.filter !== 'all' || q;
  let keep = null;
  if (filtered){
    keep = new Set();
    for (const u of M.order){
      const n = M.nodes.get(u);
      const okQ = !q || n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q) || String(n.mid) === q;
      const okF = n.sm ? UI.filter === 'all' || (UI.filter === 'crit' && n.cr) : matchFilter(n);
      if (okQ && okF){ keep.add(u); ancestors(u).forEach(a => keep.add(a.u)); if (q && n.sm) M.nodes.get(u).leafs.forEach(l => { if (UI.filter === 'all' || matchFilter(M.nodes.get(l))){ keep.add(l); ancestors(l).forEach(a => keep.add(a.u)); } }); }
    }
  }
  const out = [];
  (function walk(u){
    const n = M.nodes.get(u);
    if (keep && !keep.has(u)) return;
    out.push(n);
    if (n.sm && (filtered || G.exp.has(u))) n.kids.forEach(walk);
  })(-1);
  return out;
}
function tierMarks(A0, A1){
  const px = G.px, t1 = [], t2 = [];
  const d0 = new Date(A0 * DAY);
  let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
  const monthStarts = [];
  for (let i = 0; i < 60; i++){ const t = Math.round(Date.UTC(y, m + i, 1) / DAY); if (t > A1) break; monthStarts.push({ t, y: new Date(t*DAY).getUTCFullYear(), m: new Date(t*DAY).getUTCMonth() }); }
  const yearsL = []; for (let yy = y; yy <= new Date(A1*DAY).getUTCFullYear(); yy++){ yearsL.push({ t: Math.max(A0, dn(yy + '-01-01')), label: String(yy) }); }
  if (px < 0.8){
    yearsL.forEach(x => t1.push(x));
    monthStarts.filter(x => x.m % 3 === 0).forEach(x => t2.push({ t: x.t, label: ['I','II','III','IV'][x.m/3] + ' кв.' }));
  } else if (px < 2.5){
    yearsL.forEach(x => t1.push(x));
    monthStarts.forEach(x => t2.push({ t: x.t, label: MONTHS[x.m].slice(0, px < 1.6 ? 1 : 3) }));
  } else if (px < 8){
    monthStarts.filter(x => x.m % 3 === 0 || x.t === monthStarts[0].t).forEach(x => t1.push({ t: x.t, label: ['I','II','III','IV'][Math.floor(x.m/3)] + ' кв. ' + x.y }));
    monthStarts.forEach(x => t2.push({ t: x.t, label: MONTHS[x.m] }));
  } else {
    monthStarts.forEach(x => t1.push({ t: Math.max(A0, x.t), label: MONTHS_F[x.m] + ' ' + x.y }));
    if (px < 25){
      for (let t = A0 + ((7 - ((A0 + 3) % 7)) % 7); t <= A1; t += 7) t2.push({ t, label: fds(t).slice(0, 5) }); // понедельники
    } else {
      for (let t = A0; t <= A1; t++) t2.push({ t, label: String(new Date(t*DAY).getUTCDate()), wk: ((t + 3) % 7) >= 5 });
    }
  }
  return { t1, t2 };
}

function viewGantt(){
  const html = `${implHead('gantt', esc(CFG.ganttSource) + ' · ' + (M.order.length - 1) + ' позиций. Нажмите строку — карточка работы, стрелку — переход к динамике.')}
  <section class="panel" style="overflow:hidden">
    <header style="padding-bottom:12px"><h2>Календарный график</h2>
      <div class="seg sm" role="tablist" aria-label="Масштаб" style="margin-left:auto">${Object.keys(SCALES).map(k => `<button type="button" role="tab" data-gscale="${k}" aria-selected="${Math.abs(G.px - SCALES[k]) < 0.01}">${SCALE_T[k]}</button>`).join('')}</div>
      <button class="icon-btn" type="button" data-act="gzoom" data-f="0.8" aria-label="Уменьшить">${ico('zout')}</button>
      <button class="icon-btn" type="button" data-act="gzoom" data-f="1.25" aria-label="Увеличить">${ico('zin')}</button>
      <button class="btn sm" type="button" data-act="gtoday">${ico('target')}Сегодня</button>
    </header>
    <div class="gt-tools">
      <label class="search">${ico('search')}<input type="search" id="gt-q" placeholder="Поиск работы или ID" value="${esc(UI.q)}" aria-label="Поиск работы"></label>
      <div class="seg sm" role="tablist" aria-label="Фильтр">${FILTERS.map(([k, t]) => `<button type="button" role="tab" data-gfilter="${k}" aria-selected="${UI.filter === k}">${t}</button>`).join('')}</div>
      <button class="btn sm" type="button" data-act="gexpand">Развернуть всё</button>
      <button class="btn sm" type="button" data-act="gcollapse">Свернуть</button>
      <button class="btn sm hide-m" type="button" data-act="gcols">${S.ganttCols ? 'Меньше колонок' : 'Все колонки'}</button>
      <button class="btn sm" type="button" data-act="gbase">${S.baseline ? 'Сбросить базовый план' : 'Зафиксировать базовый план'}</button>
      ${UI.admin ? `<button class="btn sm primary" type="button" data-act="adm-add">${ico('plus')}Добавить работу</button><span class="adm-hint faint">Нажмите строку — карточка редактирования · тяните полосу — перенос, края — начало и окончание</span>` : ''}
    </div>
    <div class="gt-scroll" id="gt-scroll"><div id="gt-host"></div></div>
    <div class="pad" style="padding-top:12px"><div class="legend">
      <span><i style="background:var(--good)"></i>Выполнено</span><span><i style="background:var(--accent)"></i>В работе</span><span><i style="background:var(--warn)"></i>Отставание / просрочка</span>
      <span><i style="border:1.5px dashed var(--warn); background:none"></i>Сдвиг по прогнозу</span><span><i style="background:var(--track)"></i>Не начато</span>
      <span><i style="background:none; box-shadow:0 0 0 1.5px var(--crit)"></i>Критический путь</span>
      ${S.baseline ? `<span><i style="height:4px; background:var(--ink-3)"></i>Базовый план от ${fd(dn(S.baseline.at))}</span>` : '<span class="faint">Базового плана в файле нет — зафиксируйте текущий ГПР кнопкой выше</span>'}
      <span><i style="width:2px; height:12px; background:var(--accent)"></i>Сегодня</span>
      <span class="faint hide-m">Масштаб: Ctrl + колесо · на телефоне — двумя пальцами</span>
    </div></div>
  </section>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Реализация', go: '#/impl/structure' }, { t: 'Диаграмма Ганта' }], html, nav: '#/impl/structure', after: () => { drawGantt(); bindGantt(); } };
}

function drawGantt(keepAnchor){
  const host = document.getElementById('gt-host'); if (!host) return;
  const sc = document.getElementById('gt-scroll');
  const [A0, A1] = gRange(), px = G.px, tw = Math.ceil((A1 - A0) * px);
  const cols = gCols(), LW = cols.reduce((a, c) => a + c.w, 0);
  let anchorDay = null;
  if (keepAnchor && sc) anchorDay = A0 + (sc.scrollLeft + (sc.clientWidth - LW) / 2) / keepAnchor.oldPx;
  const X = t => ((t - A0) * px);
  const rows = gRows();
  const idx = new Map(rows.map((n, i) => [n.u, i]));
  const { t1, t2 } = tierMarks(A0, A1);
  const sel = UI.sel != null ? M.nodes.get(UI.sel) : null;
  const rel = new Set(); if (sel){ sel.preds.forEach(p => rel.add(p.u)); sel.succs.forEach(p => rel.add(p.u)); }

  const cell = (n, c) => {
    switch (c.k){
      case 'name': {
        const ind = Math.max(0, n.lvl - 1) * 14;
        return `<div class="gt-cell gt-name" style="width:${c.w}px; padding-left:${4 + ind}px">
          ${n.sm ? `<button class="tw" type="button" data-tog="${n.u}" aria-expanded="${UI.filter !== 'all' || UI.q ? true : G.exp.has(n.u)}" aria-label="Свернуть или развернуть">${ico('chevd')}</button>` : '<span style="width:22px; flex:none"></span>'}
          <span class="nt" style="${n.sm ? 'font-weight:650' : ''}; color:${n.st.k === 'future' ? 'var(--ink-2)' : 'var(--ink)'}" title="${esc(n.name)}">${esc(n.name)}</span>
          <button class="open" type="button" data-go="${n.sm ? '#/node/' : '#/work/'}${n.u}" aria-label="Открыть ${esc(n.name)}">${ico('arrow')}</button></div>`;
      }
      case 'pc': return `<div class="gt-cell" style="width:${c.w}px; font-weight:650; color:${stVar(n.st.c === 'neutral' ? 'neutral' : n.st.c)}">${n.pc >= 99.95 ? '100' : (n.pc > 0 && n.pc < 1) || (n.pc > 99) ? fp(n.pc, 1) : fp(n.pc)}</div>`;
      case 's': return `<div class="gt-cell" style="width:${c.w}px">${fds(n.s0)}</div>`;
      case 'f': return `<div class="gt-cell" style="width:${c.w}px">${fds(n.f0)}</div>`;
      case 'du': return `<div class="gt-cell" style="width:${c.w}px">${n.sm ? '' : n.du + ' д'}</div>`;
      case 'as': return `<div class="gt-cell" style="width:${c.w}px">${n.asE ? fds(n.asE) : ''}</div>`;
      case 'af': return `<div class="gt-cell" style="width:${c.w}px">${n.afE ? fds(n.afE) : ''}</div>`;
      case 'ff': return `<div class="gt-cell" style="width:${c.w}px; color:${n.devDays > 0 ? 'var(--warn-ink)' : 'inherit'}">${fds(n.ff)}</div>`;
      case 'pr': return `<div class="gt-cell" style="width:${c.w}px; color:var(--ink-3)" title="${n.preds.map(p => M.nodes.get(p.u).mid + p.type).join(', ')}">${n.preds.map(p => (M.nodes.get(p.u).mid ?? '') + (p.type !== 'FS' ? p.type : '')).join(', ')}</div>`;
      case 'dv': return `<div class="gt-cell" style="width:${c.w}px; color:${n.devDays > 0 ? 'var(--warn-ink)' : 'var(--ink-3)'}; font-weight:${n.devDays > 0 ? 650 : 400}">${n.pc >= 99.95 ? '' : n.devDays > 0 ? '+' + n.devDays : '0'}</div>`;
    }
  };
  const bar = n => {
    let s = '';
    if (n.bs != null){ s += `<span class="gb gb-base" style="left:${X(n.bs)}px; width:${Math.max(2, X(n.bf + 1) - X(n.bs))}px"></span>`; }
    const w = Math.max(3, X(n.f0 + 1) - X(n.s0));
    if (n.sm){
      s += `<span class="gb gb-sum" style="left:${X(n.s0)}px; width:${w}px"><i style="width:${n.pc}%"></i></span>`;
    } else if (n.du === 0 && n.f0 === n.s0){
      s += `<span class="gb gb-ms" ${UI.admin ? `data-drag="${n.u}"` : ''} style="left:${X(n.s0)}px; width:${UI.admin ? 12 : ''}px; background:${stVar(n.st.c === 'neutral' ? 'neutral' : n.st.c)}"></span>`;
    } else {
      const [tr, fi] = barCols(n);
      s += `<span class="gb gb-plan ${n.cr ? 'gb-crit' : ''} ${UI.admin && editableNode(n) ? 'gb-edit' : ''}" ${UI.admin && editableNode(n) ? `data-drag="${n.u}"` : ''} style="left:${X(n.s0)}px; width:${w}px; background:${tr}"><i style="width:${n.pc}%; background:${fi}"></i></span>`;
    }
    if (n.ff > n.f0 && n.pc < 99.95) s += `<span class="gb gb-fc" style="left:${X(n.f0 + 1)}px; width:${X(n.ff + 1) - X(n.f0 + 1)}px; ${n.sm ? 'top:12px; height:7px' : ''}"></span>`;
    if (px >= 1) s += `<span class="gb-lbl" style="left:${X(Math.max(n.f0, n.pc < 99.95 ? n.ff : n.f0) + 1) + 6}px">${n.pc >= 99.95 ? '100%' : fp(n.pc) + '%'}</span>`;
    return s;
  };

  // сетка и выходные
  let grid = '';
  t2.forEach(k => { grid += k.wk ? `<span class="gt-wkend" style="left:${X(k.t)}px; width:${px}px"></span>` : `<span class="gt-grid" style="left:${X(k.t)}px"></span>`; });
  const H = rows.length * RH;
  // связи выбранной работы
  let links = '';
  if (sel && idx.has(sel.u)){
    const iy = u => idx.get(u) * RH + RH / 2;
    const paths = [];
    const draw = (from, to, type) => {
      if (!idx.has(from.u) || !idx.has(to.u)) return;
      const x1 = type === 'SS' || type === 'SF' ? X(from.s0) : X(from.f0 + 1), y1 = iy(from.u);
      const x2 = type === 'FF' || type === 'SF' ? X(to.f0 + 1) : X(to.s0), y2 = iy(to.u);
      const mx = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
      paths.push(`<path d="M${x1} ${y1} H${mx} V${y2} H${x2 - 1}" fill="none" stroke="var(--accent-2)" stroke-width="1.6" marker-end="url(#ah)"/>`);
    };
    sel.preds.forEach(p => draw(M.nodes.get(p.u), sel, p.type));
    sel.succs.forEach(p => draw(sel, M.nodes.get(p.u), p.type));
    links = `<svg class="gt-links" width="${tw}" height="${H}" style="left:${LW}px"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--accent-2)"/></marker></defs>${paths.join('')}</svg>`;
  }
  const T = M.T;
  host.innerHTML = `<div class="gt-inner" style="width:${LW + tw}px">
    <div class="gt-head">
      <div class="gt-lh" style="width:${LW}px">${cols.map(c => `<div class="gt-cell" style="width:${c.w}px; ${c.k === 'name' ? 'text-align:left; padding-left:30px' : ''}">${c.t}</div>`).join('')}</div>
      <div class="gt-th" style="width:${tw}px">
        <div class="t1">${t1.map(k => `<span style="left:${X(k.t)}px">${k.label}</span>`).join('')}</div>
        <div class="t2">${t2.map(k => `<span style="left:${X(k.t)}px; ${k.wk ? 'color:var(--ink-3)' : ''}">${px >= 1.1 || !k.label.includes('кв') ? k.label : k.label}</span>`).join('')}</div>
        <span class="today-pill" style="left:${X(T)}px; top:auto; bottom:2px; position:absolute; font-size:10.5px; padding:1px 7px">${fds(T).slice(0,5)}</span>
      </div>
    </div>
    <div style="position:relative">
      <div style="position:absolute; left:${LW}px; top:0; width:${tw}px; height:${H}px; pointer-events:none">${grid}</div>
      ${rows.map(n => `<div class="gt-row ${sel && sel.u === n.u ? 'sel' : ''} ${rel.has(n.u) ? 'rel' : ''}" data-row="${n.u}">
        <div class="gt-l" style="width:${LW}px">${cols.map(c => cell(n, c)).join('')}</div>
        <div class="gt-r" style="width:${tw}px">${bar(n)}</div></div>`).join('')}
      ${links}
      <span class="today-line" style="left:${LW + X(T)}px; top:0; height:${H}px; z-index:1"></span>
    </div>
    ${rows.length ? '' : '<div class="empty">Ничего не найдено. Измените поиск или фильтр.</div>'}
  </div>`;
  if (sc && G.keepScroll){ sc.scrollLeft = G.keepScroll.l; sc.scrollTop = G.keepScroll.t; G.keepScroll = null; G.pendingScroll = null; }
  else if (sc){
    if (anchorDay != null) sc.scrollLeft = (anchorDay - A0) * px - (sc.clientWidth - LW) / 2;
    else if (G.pendingScroll === 'today'){ sc.scrollLeft = Math.max(0, X(T) - (sc.clientWidth - LW) * 0.35); G.pendingScroll = null; }
    else if (G.pendingScroll === 'focus' && G.focus != null && idx.has(G.focus)){
      const n = M.nodes.get(G.focus); sc.scrollTop = Math.max(0, idx.get(G.focus) * RH - sc.clientHeight / 3); sc.scrollLeft = Math.max(0, X(n.s0) - 80); G.pendingScroll = null;
    }
  }
  quickCard();
}
function setScale(px, anchor = true){
  const old = G.px; G.px = clamp(px, 0.15, 60);
  const k = Object.keys(SCALES).find(k => Math.abs(SCALES[k] - G.px) < 0.01); if (k){ S.ganttScale = k; LS.set('ganttScale', k); }
  document.querySelectorAll('[data-gscale]').forEach(b => b.setAttribute('aria-selected', String(Math.abs(SCALES[b.dataset.gscale] - G.px) < 0.01)));
  drawGantt(anchor ? { oldPx: old } : null);
}
function bindGantt(){
  const sc = document.getElementById('gt-scroll'); if (!sc) return;
  const q = document.getElementById('gt-q');
  if (q) q.addEventListener('input', () => { UI.q = q.value; drawGantt(); });
  sc.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey){ e.preventDefault(); setScale(G.px * (e.deltaY < 0 ? 1.15 : 0.87)); } }, { passive: false });
  let pinch = null, raf = 0;
  sc.addEventListener('touchstart', e => { if (e.touches.length === 2){ const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), px: G.px }; } }, { passive: true });
  sc.addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2){
      e.preventDefault();
      const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const target = pinch.px * d / pinch.d;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setScale(target); });
    }
  }, { passive: false });
  sc.addEventListener('touchend', () => { pinch = null; });
  sc.addEventListener('click', e => {
    const tog = e.target.closest('[data-tog]');
    if (tog){ e.stopPropagation(); const u = +tog.dataset.tog; G.exp.has(u) ? G.exp.delete(u) : G.exp.add(u); LS.set('gexp', [...G.exp]); drawGantt(); return; }
    if (e.target.closest('[data-go]')) return;
    const row = e.target.closest('[data-row]');
    if (row){ const u = +row.dataset.row; if (UI.admin){ if (G.dragged && Date.now() - G.dragged < 400) return; UI.sel = u; openAdminEditor(u); return; } UI.sel = UI.sel === u ? null : u; drawGantt(); }
  });
  bindGanttAdmin(sc);
}
function quickCard(){
  const layer = document.getElementById('qc-layer') || (() => { const d = document.createElement('div'); d.id = 'qc-layer'; document.body.appendChild(d); return d; })();
  if (UI.sel == null || UI.admin || !document.getElementById('gt-host')){ layer.innerHTML = ''; return; }
  const n = M.nodes.get(UI.sel);
  const stage = M.stageOf(n);
  layer.innerHTML = `<div class="qc" role="dialog" aria-label="Карточка работы">
    <div style="display:flex; gap:10px; align-items:flex-start"><div style="flex:1; min-width:0"><div class="eyebrow">${esc(n.code)} · ID ${n.mid ?? '—'}</div><h3 style="margin-top:4px">${esc(n.name)}</h3></div>
    <button class="icon-btn" type="button" data-act="qc-close" aria-label="Закрыть">${ico('x')}</button></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap">${chip(n.st.t, n.st.c)}${n.cr ? chip('Критический путь', 'crit') : ''}</div>
    <dl class="kv">
      <dt>Готовность</dt><dd><b>${fpct(n.pc, 1)}</b> · план ${fpct(n.planNow, 1)}</dd>
      <dt>План</dt><dd>${fd(n.s0)} — ${fd(n.f0)}</dd>
      <dt>Факт</dt><dd>${n.asE ? fd(n.asE) : '—'} — ${n.afE ? fd(n.afE) : '…'}</dd>
      <dt>Прогноз окончания</dt><dd style="color:${n.devDays > 0 ? 'var(--warn-ink)' : 'inherit'}">${fd(n.ff)}${n.devDays > 0 ? ' · +' + n.devDays + ' дн.' : ''}</dd>
      <dt>Связи</dt><dd>${n.preds.length} предш. · ${n.succs.length} посл.</dd>
      ${n.unit ? `<dt>Работа модели весов</dt><dd>${esc(n.unit.id)} · абс. вес ${fp(n.unit.abs * 100, 2)} %</dd>` : ''}
    </dl>
    <div style="display:flex; gap:8px; flex-wrap:wrap">
      <button class="btn primary" type="button" data-go="${n.sm ? '#/node/' : '#/work/'}${n.u}">${n.sm ? 'Открыть этап' : 'Динамика выполнения'} ${ico('right')}</button>
      ${stage && stage.u !== n.u ? `<button class="btn" type="button" data-go="#/node/${stage.u}">Этап</button>` : ''}
      ${!n.sm && n.pc < 100 ? `<button class="btn" type="button" data-act="entry" data-u="${n.u}">Внести факт</button>` : ''}
    </div></div>`;
}
/* ================= СРОК ================= */
function viewTimeline(){
  const R = M.root, pEnd = dn(PROJECT.planEnd), delay = R.ff - pEnd;
  const chain = [...M.drivers].reverse();
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 2 · Календарь проекта</div><h1 style="margin-top:6px">Календарь проекта</h1>
    <div class="meta"><span>Старт ${fd(dn(PROJECT.start))}</span><span>${esc(CFG.planEndLabel)} по плану ${fd(pEnd)}</span>${chip(delay > 0 ? 'Прогноз ' + fd(R.ff) + ' · +' + delay + ' дн.' : 'Прогноз: в срок', delay > 0 ? 'warn' : 'good')}</div></div>
    <div class="head-acts"><button class="btn" type="button" data-go="#/impl/gantt">${ico('gantt')}Полный Гант</button></div></div>
  <section class="panel"><header><h2>Пройденный и оставшийся путь</h2><span class="sub">месяцы, вехи и отметка «Сегодня»</span></header><div class="pad">${calendarBlock(true)}</div></section>
  <div class="grid2e">
    <section class="panel"><header><h2>Что определяет срок</h2><span class="sub">цепочка работ, от которой зависит прогноз окончания</span></header>
      <div class="pad">
        ${delay > 0 ? `<p class="note warn" style="margin-bottom:12px">Прогноз окончания ${fd(R.ff)}: на ${delay} дн. позже плана. Прогноз считается так: незавершённая работа доделывается с плановой интенсивностью от даты среза, а не начатые работы сдвигаются за своими предшественниками.</p>` : '<p class="note" style="margin-bottom:12px">Прогноз окончания совпадает с планом.</p>'}
        <div style="display:flex; flex-direction:column">${chain.map((n, i) => `<button class="msv-i" type="button" data-go="${n.sm ? '#/node/' : '#/work/'}${n.u}" style="min-height:52px">
          <span class="rail"><i style="background:${i === chain.length - 1 ? 'transparent' : 'var(--line-strong)'}"></i><b style="background:var(--surface); border-color:${stVar(n.st.c)}"></b></span>
          <span style="display:flex; flex-direction:column; padding-bottom:10px; min-width:0"><span style="font-size:13px; font-weight:600">${esc(n.name)}</span><span class="faint" style="font-size:11.5px">${esc(M.stageOf(n)?.name || '')} · план ${fds(n.f0)} → прогноз ${fds(n.ff)}</span></span>
          ${chip(n.devDays > 0 ? '+' + n.devDays + ' дн.' : 'в срок', n.devDays > 0 ? 'warn' : 'good')}</button>`).join('')}</div>
      </div></section>
    <section class="panel"><header><h2>Сроки по договорам</h2></header>
      <div class="tbl-wrap"><table class="t"><thead><tr><th>Договор</th><th>Начало</th><th>Оконч.</th><th class="l" style="min-width:150px">Прошло времени</th></tr></thead><tbody>
      ${M.contracts.length ? '' : '<tr><td colspan="4" class="l faint">Договоры объекта пока не переданы.</td></tr>'}${M.contracts.map(c => { const a = dn(c.start), b = dn(c.end), p = clamp((M.T - a) / (b - a) * 100, 0, 100); return `<tr class="link" data-go="#/contract/${c.id}"><td class="l"><b>${esc(c.short)}</b><br><span class="faint" style="font-size:12px">${esc(c.counterparty)}</span></td><td>${fds(a)}</td><td>${fds(b)}</td><td><div class="minib"><span class="bar"><i style="width:${p}%; --c:var(--accent)"></i></span><b>${fpct(p)}</b></div><div class="faint" style="font-size:11.5px; text-align:right">${Math.min(M.T, b) - a} из ${b - a} дн.</div></td></tr>`; }).join('')}
      </tbody></table></div></section>
  </div>
  <section class="panel"><header><h2>Вехи</h2></header><div class="pad">${msOrdinal(M.ms.filter(m => m.key))}</div></section>
  ${eventsPanel()}`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Календарь проекта' }], html, nav: '#/timeline' };
}

/* ================= БЮДЖЕТ ================= */
function viewBudget(){
  const f = M.fin, bt = S.settings.budgetTotal ?? PROJECT.budgetTotal;
  const nc = M.contracts.length;
  const adv = M.contracts.reduce((a, c) => a + (c.advance || 0), 0), ret = M.contracts.reduce((a, c) => a + (c.retention || 0), 0);
  const docsCnt = c => { const d = c.docs || {}; return [d.estimates?.length ? d.estimates.length + ' смет' : '', d.ks2?.length ? d.ks2.length + ' КС-2' : '', d.ks3?.length ? d.ks3.length + ' КС-3' : ''].filter(Boolean).join(' · '); };
  const rows = M.contracts.map(c => `<tr class="link" data-go="#/contract/${esc(c.id)}">
    <td class="l"><b>${esc(c.counterparty)}</b>${c.category || docsCnt(c) ? `<div class="faint" style="font-size:11.5px">${esc([c.category, docsCnt(c)].filter(Boolean).join(' · '))}</div>` : ''}${c.comment ? `<div class="faint" style="font-size:11.5px">${esc(c.comment)}</div>` : ''}</td><td class="l faint">${esc(c.number)}</td><td class="l wrap" style="max-width:280px">${esc(c.subject || '—')}</td>
    <td>${c.price ? fmoney(c.price, 'млн') : '—'}</td><td>${fds(dn(c.start))}</td><td>${fds(dn(c.end))}</td>
    <td class="faint">${c.paid == null ? 'нет данных' : fmoney(c.paid, 'млн')}</td><td>${fmoney(c.closed, 'млн')}</td>
    <td><div class="minib" style="min-width:120px"><span class="bar"><i style="width:${c.closedPct}%; --c:var(--good)"></i>${!c.planUnknown && c.planPct < 100 ? `<b style="left:${c.planPct}%"></b>` : ''}</span><b>${fpct(c.closedPct)}</b></div></td>
    <td>${c.price ? fmoney(c.rest, 'млн') : '—'}</td><td class="l">${chip(c.status.t, c.status.c)}</td></tr>`).join('');
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 2 · Бюджет</div><h1 style="margin-top:6px">Бюджет и договоры</h1>
    <div class="meta"><span>Закрытие актами КС-2 на ${fd(M.T)}</span></div></div>
    ${UI.admin ? `<div class="head-acts"><button class="btn" type="button" data-act="budget-total">${ico('card')}${bt ? 'Изменить бюджет' : 'Задать бюджет'}</button><button class="btn primary" type="button" data-act="bud-contract">${ico('plus')}Договор</button></div>` : ''}</div>
  <div class="tiles">
    <div class="tile"><div class="eyebrow">Стоимость проекта</div><div class="v">${bt ? fmoney(bt) : '—'}</div><div class="s">${bt ? (nc ? 'законтрактовано ' + fpct(f.contracted / bt * 100) : 'задана вручную') : UI.admin ? 'не задана — введите для расчёта %' : 'не задана'}</div></div>
    <div class="tile"><div class="eyebrow">Законтрактовано</div><div class="v">${nc ? fmoney(f.contracted) : '—'}</div><div class="s">${nc ? nc + ' ' + plural(nc, 'договор', 'договора', 'договоров') : 'договоры не добавлены'}</div></div>
    <div class="tile ${nc && f.planKnown ? (f.plan > f.closed ? 'warn' : 'good') : ''}"><div class="eyebrow">Закрыто актами</div><div class="v">${nc ? fmoney(f.closed) : '—'}</div><div class="s">${nc ? fpct(f.closedPct, 1) + ' · план ' + (f.planKnown ? fpct(f.planPct, 1) : '—') : 'нет данных'}</div></div>
    <div class="tile"><div class="eyebrow">Остаток</div><div class="v">${nc ? fmoney(f.contracted - f.closed) : '—'}</div><div class="s">к закрытию по договорам</div></div>
    <div class="tile"><div class="eyebrow">Авансы выданы</div><div class="v">${M.contracts.some(c => c.advance != null) ? fmoney(adv) : '—'}</div><div class="s">гарантийное удержание ${M.contracts.some(c => c.retention != null) ? fmoney(ret, 'млн') : '—'}</div></div>
  </div>
  ${budgetPanel()}
  <section class="panel"><header><h2>Реестр договоров</h2><span class="sub">нажмите договор — сметы, акты КС-2, справки КС-3, план, факт и прогноз по месяцам</span></header>
    ${nc ? `<div class="tbl-wrap"><table class="t" style="min-width:1180px"><thead><tr><th>Контрагент</th><th class="l">№</th><th class="l">Предмет</th><th>Стоимость</th><th>Начало</th><th>Оконч.</th><th>Оплачено</th><th>Закрыто актами</th><th class="l">% исполн. · метка = план</th><th>Остаток</th><th class="l">Статус</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td class="l">Итого</td><td></td><td></td><td>${fmoney(f.contracted, 'млн')}</td><td></td><td></td><td></td><td>${fmoney(f.closed, 'млн')}</td><td class="l">${fpct(f.closedPct, 1)}</td><td>${fmoney(f.contracted - f.closed, 'млн')}</td><td></td></tr></tfoot></table></div>`
    : `<div class="pad"><div class="empty-block"><b>Договоров пока нет</b><span>${UI.admin ? 'Добавьте договор — к нему можно прикрепить сметы, акты выполненных работ КС-2 и справки КС-3.' : 'Договоры, сметы и акты вносит администратор проекта.'}</span>${UI.admin ? `<button class="btn primary" type="button" data-act="bud-contract">${ico('plus')}Добавить договор</button>` : ''}</div></div>`}
    ${CFG.budgetNote && !S.budget.contracts.length ? `<div class="pad" style="padding-top:${nc ? 14 : 0}px"><p class="note">${esc(CFG.budgetNote)}</p></div>` : ''}</section>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Бюджет' }], html, nav: '#/budget' };
}

function budgetPanel(){
  const B = M.budget, m = v => v == null ? '—' : fmoney(v);
  const has = ['total', 'approved', 'contracted', 'paid', 'spent', 'forecast'].some(k => B[k] != null) || B.comment;
  if (!has) return '';
  const src = k => B.src[k] === 'manual' ? 'по данным обновления' : B.src[k] === 'calc' ? 'расчёт по договорам' : 'нет данных';
  const cells = [['Общий бюджет', m(B.total), B.total != null ? 'стоимость проекта' : 'нет данных'], ['Утверждённый бюджет', m(B.approved), B.approved != null ? 'по данным обновления' : 'нет данных'],
    ['Законтрактовано', m(B.contracted), src('contracted')], ['Оплачено', m(B.paid), src('paid')], ['Освоено', m(B.spent), B.src.spent === 'calc' ? 'закрыто актами КС-2' : src('spent')],
    ['Прогноз', m(B.forecast), B.forecast != null ? 'по данным обновления' : 'нет данных'],
    ['Отклонение', B.deviation == null ? '—' : (B.deviation > 0 ? '+' : B.deviation < 0 ? '−' : '') + fmoney(Math.abs(B.deviation)), B.deviation == null ? 'нужны прогноз и бюджет' : 'прогноз к ' + (B.approved != null ? 'утверждённому' : 'общему') + ' бюджету']];
  return `<section class="panel"><header><h2>Показатели бюджета</h2><span class="sub">введённые значения и расчёт по реестру договоров</span></header>
    <div class="pad"><div class="tiles">${cells.map(([t, v, s_], i) => `<div class="tile ${i === 6 && B.deviation != null ? (B.deviation > 0 ? 'warn' : 'good') : ''}"><div class="eyebrow">${t}</div><div class="v" style="font-size:19px">${v}</div><div class="s">${esc(s_)}</div></div>`).join('')}</div>
    ${B.comment ? `<p class="note" style="margin-top:12px">${esc(B.comment)}</p>` : ''}</div></section>`;
}
/* ---------- Договоры, сметы, акты КС-2, справки КС-3 ----------
   Хранятся в S.budget (браузер или общая база проекта); build() добавляет их в расчёт закрытия. */
function budgetPersist(){ if (Store.db) put('budget', 'data', S.budget); else LS.set('budget', S.budget); }
function budgetCommit(mut, text){ mut(S.budget); budgetPersist(); const y = window.scrollY; build(); render(); window.scrollTo(0, y); toast('<b>' + esc(text) + '</b>'); }
const budId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const moneyVal = v => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; };
function openContractForm(id){
  const cur = id ? S.budget.contracts.find(x => x.id === id) : null;
  const v = cur || { counterparty: '', short: '', number: '', subject: '', price: '', start: iso(M.T), end: iso(M.T + 180), wbs: '' };
  const stages = stageRows();
  modal(cur ? 'Договор' : 'Новый договор', `<div class="adm-form">
    <div class="fld"><label for="c-cp">Контрагент</label><input id="c-cp" type="text" value="${esc(v.counterparty)}" placeholder="ООО «…»"></div>
    <div class="row-f"><div class="fld"><label for="c-num">Номер договора</label><input id="c-num" type="text" value="${esc(v.number)}"></div>
      <div class="fld"><label for="c-short">Краткое название</label><input id="c-short" type="text" value="${esc(v.short)}" placeholder="Например: Фасады"></div></div>
    <div class="fld"><label for="c-subj">Предмет договора</label><input id="c-subj" type="text" value="${esc(v.subject)}"></div>
    <div class="row-f adm-3"><div class="fld"><label for="c-price">Стоимость, ₽</label><input id="c-price" type="text" inputmode="decimal" value="${v.price ?? ''}" placeholder="0,00"></div>
      <div class="fld"><label for="c-s">Начало</label><input id="c-s" type="date" value="${esc(v.start || '')}"></div>
      <div class="fld"><label for="c-f">Окончание</label><input id="c-f" type="date" value="${esc(v.end || '')}"></div></div>
    <div class="fld"><label for="c-wbs">Работы по графику (для сравнения физики и финансов)</label><select id="c-wbs"><option value="">— не связан —</option>${stages.map(n => `<option value="${n.u}" ${String(v.wbs) === String(n.u) ? 'selected' : ''}>${esc(n.name.slice(0, 90))}</option>`).join('')}</select></div>
    <div class="adm-actions">${cur ? `<button class="btn sm danger" type="button" data-act="bud-contract-del" data-id="${esc(cur.id)}">Удалить договор</button>` : ''}<span style="flex:1"></span><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="c-ok">Сохранить</button></div></div>`);
  const $ = x => document.getElementById(x);
  $('c-ok').onclick = () => {
    const d = { counterparty: $('c-cp').value.trim(), number: $('c-num').value.trim(), short: $('c-short').value.trim(), subject: $('c-subj').value.trim(), price: moneyVal($('c-price').value), start: $('c-s').value, end: $('c-f').value, wbs: $('c-wbs').value ? +$('c-wbs').value : null };
    if (!d.counterparty) return toast('Укажите контрагента.');
    if (d.price == null || d.price < 0) return toast('Укажите стоимость договора.');
    if (!d.start || !d.end || d.end < d.start) return toast('Проверьте даты начала и окончания.');
    closeLayer();
    budgetCommit(B => { if (cur) Object.assign(B.contracts.find(x => x.id === cur.id), d); else B.contracts.push({ id: budId('c'), ...d, at: Date.now() }); }, cur ? 'Договор сохранён' : 'Договор добавлен');
  };
}
const DOC_T = { estimate: ['Смета', 'Новая смета'], ks2: ['Акт КС-2', 'Новый акт КС-2'], ks3: ['Справка КС-3', 'Новая справка КС-3'] };
function openDocForm(type, contractId, docId){
  const c = M.contracts.find(x => x.id === contractId); if (!c) return;
  const cur = docId ? S.budget.docs.find(d => d.id === docId) : null;
  const today = iso(M.T), ym = today.slice(0, 7);
  const v = cur || { number: '', name: '', date: today, from: ym + '-01', to: today, amount: '', paid: '', paidDate: '', estimateId: '', note: '' };
  const est = (c.docs?.estimates || []);
  const period = type !== 'estimate' ? `<div class="row-f"><div class="fld"><label for="d-from">Период с</label><input id="d-from" type="date" value="${esc(v.from || '')}"></div><div class="fld"><label for="d-to">по</label><input id="d-to" type="date" value="${esc(v.to || '')}"></div></div>` : '';
  modal((cur ? DOC_T[type][0] : DOC_T[type][1]) + ' · ' + c.short, `<div class="adm-form">
    ${type === 'estimate' ? `<div class="fld"><label for="d-name">Название сметы</label><input id="d-name" type="text" value="${esc(v.name)}" placeholder="Например: Локальная смета № 02-01 «Фасады»"></div>` : ''}
    <div class="row-f"><div class="fld"><label for="d-num">Номер</label><input id="d-num" type="text" value="${esc(v.number)}"></div><div class="fld"><label for="d-date">Дата</label><input id="d-date" type="date" value="${esc(v.date || '')}"></div></div>
    ${period}
    <div class="row-f"><div class="fld"><label for="d-amt">${type === 'estimate' ? 'Сметная стоимость' : type === 'ks2' ? 'Стоимость выполненных работ' : 'Стоимость по справке'}, ₽</label><input id="d-amt" type="text" inputmode="decimal" value="${v.amount ?? ''}" placeholder="0,00"></div>
      ${type === 'ks2' ? `<div class="fld"><label for="d-est">По смете</label><select id="d-est"><option value="">—</option>${est.map(e => `<option value="${esc(e.id)}" ${v.estimateId === e.id ? 'selected' : ''}>${esc(e.name || e.number || 'смета')}</option>`).join('')}</select></div>` : ''}
      ${type === 'ks3' ? `<div class="fld"><label for="d-paid">Оплачено, ₽</label><input id="d-paid" type="text" inputmode="decimal" value="${v.paid ?? ''}" placeholder="—"></div>` : ''}</div>
    ${type === 'ks3' ? `<div class="fld"><label for="d-pdate">Дата оплаты</label><input id="d-pdate" type="date" value="${esc(v.paidDate || '')}"></div>` : ''}
    <div class="fld"><label for="d-note">Комментарий</label><input id="d-note" type="text" value="${esc(v.note || '')}"></div>
    <div class="adm-actions">${cur ? `<button class="btn sm danger" type="button" data-act="bud-doc-del" data-id="${esc(cur.id)}">Удалить</button>` : ''}<span style="flex:1"></span><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="d-ok">Сохранить</button></div></div>`);
  const $ = x => document.getElementById(x);
  $('d-ok').onclick = () => {
    const d = { type, contractId, number: $('d-num').value.trim(), date: $('d-date').value, amount: moneyVal($('d-amt').value), note: $('d-note').value.trim() };
    if (type === 'estimate') d.name = $('d-name').value.trim();
    if (type !== 'estimate'){ d.from = $('d-from').value || null; d.to = $('d-to').value || null; if (d.from && d.to && d.to < d.from) return toast('Период указан неверно.'); }
    if (type === 'ks2') d.estimateId = $('d-est').value || null;
    if (type === 'ks3'){ d.paid = moneyVal($('d-paid').value); d.paidDate = $('d-pdate').value || null; }
    if (!d.date) return toast('Укажите дату.');
    if (d.amount == null || d.amount < 0) return toast('Укажите сумму.');
    if (type === 'estimate' && !d.name && !d.number) return toast('Укажите название или номер сметы.');
    closeLayer();
    budgetCommit(B => { if (cur) Object.assign(B.docs.find(x => x.id === cur.id), d); else B.docs.push({ id: budId('d'), ...d, at: Date.now() }); }, DOC_T[type][0] + (cur ? ' сохранён(а)' : ' добавлен(а)'));
  };
}
function docsSection(c){
  const D = c.docs || { estimates: [], ks2: [], ks3: [] };
  const money = v => v == null ? '—' : fmoney(v, '₽');
  const per = d => d.from || d.to ? `${d.from ? fds(dn(d.from)) : '…'} — ${d.to ? fds(dn(d.to)) : '…'}` : '—';
  const estName = id => (D.estimates.find(e => e.id === id) || {}).name || '';
  const block = (type, title, list, cols, row, total) => `<section class="panel"><header><h2>${title}</h2><span class="sub">${list.length ? list.length + ' · ' + money(total) : 'нет документов'}</span>${UI.admin ? `<button class="btn sm" type="button" data-act="bud-doc-add" data-type="${type}" data-c="${esc(c.id)}" style="margin-left:auto">${ico('plus')}Добавить</button>` : ''}</header>
    ${list.length ? `<div class="tbl-wrap"><table class="t" style="min-width:640px"><thead><tr>${cols}</tr></thead><tbody>${list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(d => UI.admin ? `<tr class="link" data-act="bud-doc-edit" data-id="${esc(d.id)}" data-type="${type}" data-c="${esc(c.id)}">${row(d)}</tr>` : `<tr>${row(d)}</tr>`).join('')}</tbody></table></div>` : `<div class="pad"><p class="faint" style="font-size:13px">Документы не добавлены.</p></div>`}</section>`;
  return `
  ${block('estimate', 'Сметы', D.estimates, '<th class="l">Смета</th><th class="l">№</th><th>Дата</th><th>Сметная стоимость</th>', d => `<td class="l wrap">${esc(d.name || '—')}${d.note ? `<div class="faint" style="font-size:11.5px">${esc(d.note)}</div>` : ''}</td><td class="l">${esc(d.number || '—')}</td><td>${fds(dn(d.date))}</td><td>${money(d.amount)}</td>`, c.estimateTotal || 0)}
  <div class="grid2e">
  ${block('ks2', 'Акты выполненных работ КС-2', D.ks2, '<th class="l">№</th><th>Дата</th><th>Период</th><th>Сумма</th>', d => `<td class="l">${esc(d.number || '—')}${d.estimateId ? `<div class="faint" style="font-size:11.5px">${esc(estName(d.estimateId))}</div>` : ''}</td><td>${fds(dn(d.date))}</td><td>${per(d)}</td><td>${money(d.amount)}</td>`, c.ks2Total)}
  ${block('ks3', 'Справки о стоимости КС-3', D.ks3, '<th class="l">№</th><th>Дата</th><th>Период</th><th>Сумма</th><th>Оплачено</th>', d => `<td class="l">${esc(d.number || '—')}</td><td>${fds(dn(d.date))}</td><td>${per(d)}</td><td>${money(d.amount)}</td><td>${d.paid == null ? '—' : money(d.paid)}${d.paidDate ? `<div class="faint" style="font-size:11.5px">${fds(dn(d.paidDate))}</div>` : ''}</td>`, c.ks3Total)}
  </div>`;
}

function contractSeries(c){
  const c0 = dn(c.start), mo = c.months;
  const firstYm = mo.list.length ? mo.list[0][0] : null;
  const preEnd = firstYm ? dn(firstYm + '-01') - 1 : c0;
  const fact = [[c0, 0], [preEnd, mo.pre.fact]], plan = mo.pre.plan != null ? [[c0, 0], [preEnd, mo.pre.plan]] : null;
  let cf = mo.pre.fact, cp = mo.pre.plan ?? 0;
  const table = [{ label: mo.pre.label, plan: mo.pre.plan, fact: mo.pre.fact, kind: 'fact' }];
  mo.list.forEach(([ym, p, f]) => { cf += f; fact.push([monthEnd(ym), cf]); if (plan){ cp += p; plan.push([monthEnd(ym), cp]); } table.push({ label: ym.slice(5) + '.' + ym.slice(0, 4), plan: p, fact: f, kind: 'fact' }); });
  const price = c.price / 1e6, tl = fact[fact.length - 1][0];
  let fc = null, planF = null;
  const wbs = c.wbs[0];
  if (price > 0 && cf < price - 0.5 && wbs != null && M.nodes.has(wbs)){
    const F = t => M.curve(wbs, 'fc', t) / 100, P = t => M.curve(wbs, 'plan', t) / 100;
    const F0 = F(tl), P0 = P(tl), node = M.nodes.get(wbs);
    fc = [[tl, cf]]; if (plan) planF = [[tl, cp]];
    let d = new Date(tl * DAY + DAY), lastF = cf, lastP = cp;
    const endT = Math.max(node.ff, node.f0) + 31;
    while (true){
      const ym = d.toISOString().slice(0, 7), t = monthEnd(ym);
      const vF = F0 < 1 ? cf + (price - cf) * clamp((F(t) - F0) / (1 - F0), 0, 1) : price;
      const vP = P0 < 1 ? cp + (price - cp) * clamp((P(t) - P0) / (1 - P0), 0, 1) : price;
      fc.push([t, vF]); if (planF) planF.push([t, vP]);
      table.push({ label: ym.slice(5) + '.' + ym.slice(0, 4), plan: planF ? vP - lastP : null, fc: vF - lastF, kind: 'calc' });
      lastF = vF; lastP = vP;
      if (t >= endT || (vF >= price - 0.01 && (!planF || vP >= price - 0.01))) break;
      d = new Date((t + 1) * DAY);
    }
  }
  return { fact, plan, fc, planF, table, price };
}

function viewContract(id){
  const c = M.contracts.find(x => x.id === id); if (!c) return viewMissing();
  const s = contractSeries(c);
  const x0 = dn(c.start), x1 = Math.max(s.fc ? s.fc[s.fc.length - 1][0] : 0, s.fact[s.fact.length - 1][0]) + 10;
  const ymax = Math.max(1, Math.ceil(Math.max(s.price, ...s.fact.map(p => p[1])) / 500) * 500);
  const ser = [];
  if (s.plan) ser.push({ name: 'План закрытия', color: 'var(--ink-2)', pts: s.plan, width: 2 });
  if (s.planF) ser.push({ name: 'План после ' + fds(s.plan[s.plan.length-1][0]).slice(3) + ' (по ГПР)', color: 'var(--ink-3)', pts: s.planF, dash: '2 4', width: 1.8 });
  ser.push({ name: 'Факт (акты КС-2)', color: 'var(--accent)', pts: s.fact, width: 3, dots: true, area: true });
  if (s.fc) ser.push({ name: 'Прогноз (по прогнозу ГПР)', color: 'var(--warn)', pts: s.fc, dash: '6 5' });
  const cum = lineChart({ w: 900, h: 320, x0, x1, y0: 0, y1: ymax, yTicks: [0, ymax / 4, ymax / 2, ymax * 3 / 4, ymax], yFmt: v => (v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',') + ' млрд',
    tipFmt: v => (v / 1000).toFixed(3).replace('.', ',') + ' млрд ₽', series: ser, marks: [{ t: M.T, label: 'Сегодня', color: 'var(--accent)', w: 2 }, { t: dn(c.end), label: 'Оконч. ' + fds(dn(c.end)), color: 'var(--ink-2)', dash: true }], label: 'Накопительное закрытие ' + c.short });
  const ml = c.months.list;
  const bars = !ml.length ? '<p class="faint" style="font-size:13px">Закрытий по месяцам пока нет — добавьте акт КС-2.</p>' : barsChart({ w: 560, h: 230, cats: ml.map(m => m[0].slice(5) + '.' + m[0].slice(2, 4)), groups: [...(ml.some(m => m[1] != null) ? [{ name: 'План', color: 'var(--track)', vals: ml.map(m => m[1]) }] : []), { name: 'Факт', color: 'var(--accent)', vals: ml.map(m => m[2]) }],
    yMax: Math.ceil(Math.max(...ml.map(m => Math.max(m[1] || 0, m[2]))) / 50) * 50, yTicks: [0, 100, 200, 300].filter(v => v <= Math.ceil(Math.max(...ml.map(m => Math.max(m[1] || 0, m[2]))) / 50) * 50), yFmt: v => String(Math.round(v * 10) / 10).replace('.', ','), valueLabels: true, label: 'Закрытие по месяцам, млн ₽' });
  const physGap = c.gap;
  const tRows = s.table.map(r => `<tr${r.kind === 'calc' ? ' style="color:var(--ink-2)"' : ''}><td class="l">${esc(r.label)}${r.kind === 'calc' ? ' <span class="faint" style="font-size:11px">расчёт</span>' : ''}</td>
    <td>${r.plan == null ? '—' : fp(r.plan, 2)}</td><td>${r.fact == null ? '—' : fp(r.fact, 2)}</td><td>${r.fc == null ? '—' : fp(r.fc, 2)}</td>
    <td style="color:${r.fact != null && r.plan != null && r.fact < r.plan ? 'var(--warn-ink)' : 'inherit'}">${r.fact != null && r.plan != null ? (r.fact - r.plan >= 0 ? '+' : '−') + fp(Math.abs(r.fact - r.plan), 2) : '—'}</td></tr>`).join('');
  const isGP = c.id === CFG.mainContract;
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 3 · Договор ${esc(c.number)}</div><h1 style="margin-top:6px">${esc(c.short)} · ${esc(c.counterparty)}</h1>
    <div class="meta">${chip(c.status.t, c.status.c)}<span>${fd(dn(c.start))} — ${fd(dn(c.end))}</span>${c.handover ? `<span>сдача ${fd(dn(c.handover))}</span>` : ''}</div>
    <p class="muted" style="margin-top:8px; max-width:70ch; font-size:13px">${esc(c.subject)}</p></div>
    ${UI.admin ? `<div class="head-acts">${c.user ? `<button class="btn" type="button" data-act="bud-contract-edit" data-id="${esc(c.id)}">${ico('pen')}Изменить</button>` : ''}<button class="btn primary" type="button" data-act="bud-doc-add" data-type="ks2" data-c="${esc(c.id)}">${ico('plus')}Акт КС-2</button></div>` : ''}</div>
  <div class="tiles">
    <div class="tile"><div class="eyebrow">Стоимость</div><div class="v" style="font-size:19px">${fmoney(c.price, '₽')}</div><div class="s">${c.estimateTotal != null ? 'по сметам ' + fmoney(c.estimateTotal, 'млн') : 'сметы не добавлены'}</div></div>
    <div class="tile ${c.planPct - c.closedPct > 0.5 ? 'warn' : 'good'}"><div class="eyebrow">Закрыто актами</div><div class="v" style="font-size:19px">${fmoney(c.closed, '₽')}</div><div class="s">${fpct(c.closedPct, 1)} · ${c.planUnknown ? 'план закрытия не задан' : 'план ' + fmoney(c.planToDate, 'млн') + ' (' + fpct(c.planPct, 1) + ')'}</div></div>
    <div class="tile"><div class="eyebrow">Оплачено</div><div class="v">${c.paid == null ? '—' : fmoney(c.paid)}</div><div class="s">${c.paid == null ? 'нет данных' : c.ks3Paid ? 'по справкам КС-3 ' + fmoney(c.ks3Paid, 'млн') : ''}</div></div>
    <div class="tile"><div class="eyebrow">Остаток</div><div class="v" style="font-size:19px">${fmoney(c.rest, '₽')}</div></div>
    <div class="tile"><div class="eyebrow">% исполнения</div><div class="v">${fpct(c.closedPct, 1)}</div></div>
  </div>
  ${docsSection(c)}
  <section class="panel"><header><h2>Физическое выполнение и финансовое закрытие</h2>${Math.abs(physGap) >= 5 ? chip('Расхождение ' + fp(Math.abs(physGap), 1) + ' п.п.', 'warn') : chip('Совпадают', 'good')}</header>
    <div class="pad" style="display:flex; flex-direction:column; gap:12px">
      <div class="barrow" style="grid-template-columns:190px 1fr 70px"><span class="muted">Физическая готовность работ</span><span class="bar"><i style="width:${c.phys}%; --c:var(--good)"></i></span><b class="num" style="text-align:right">${fpct(c.phys, 1)}</b></div>
      <div class="barrow" style="grid-template-columns:190px 1fr 70px"><span class="muted">Финансовое закрытие (КС-2)</span><span class="bar"><i style="width:${c.closedPct}%; --c:var(--accent-2)"></i></span><b class="num" style="text-align:right">${fpct(c.closedPct, 1)}</b></div>
      <p class="faint" style="font-size:12.5px">${physGap >= 5 ? 'Выполнено больше, чем закрыто актами: работы не предъявлены или акты задерживаются.' : physGap <= -5 ? 'Закрыто больше, чем выполнено физически: проверьте авансовые и опережающие закрытия.' : 'Физическое и финансовое выполнение идут вместе.'} Порог подсветки — 5 п.п. Физическая готовность берётся из ГПР (${c.wbs.map(w => esc(M.nodes.get(w).name)).join(', ')}).</p>
      <div>${c.wbs.filter(w => M.nodes.has(w)).map(w => { const n = M.nodes.get(w); return `<button class="btn sm" type="button" data-go="${n.sm ? '#/node/' : '#/work/'}${n.u}">Работы договора: ${esc(n.name)} ${ico('right')}</button>`; }).join('')}</div>
    </div></section>
  <section class="panel"><header><h2>Финансовая динамика</h2><span class="sub">накопительно, млрд ₽</span></header><div class="pad">${cum}
    <p class="faint" style="font-size:12px; margin-top:8px">${esc(c.monthsNote)} После последнего месяца план и прогноз распределяют остаток по плановой и прогнозной кривой ГПР, так закрытие связано с физикой.</p></div></section>
  <div class="grid2e">
    <section class="panel"><header><h2>Закрытие по месяцам</h2><span class="sub">млн ₽</span></header><div class="pad">${bars}</div></section>
    <section class="panel"><header><h2>План · факт · прогноз</h2><span class="sub">млн ₽</span></header>
      <div class="tbl-wrap" style="max-height:340px; overflow:auto"><table class="t"><thead><tr><th>Месяц</th><th>План</th><th>Факт</th><th>Прогноз</th><th>Откл.</th></tr></thead><tbody>${tRows}</tbody></table></div></section>
  </div>
  ${isGP ? `<div class="grid2e">
    <section class="panel"><header><h2>Авансы и удержания</h2></header><div class="pad"><dl class="kv" style="font-size:13.5px; gap:8px 14px">
      <dt>Аванс выдан</dt><dd>${fmoney(c.advance, '₽')}</dd><dt>Закрыто в счёт аванса</dt><dd>${fmoney(c.closedAgainstAdvance, '₽')}</dd>
      <dt>Остаток аванса</dt><dd><b>${fmoney(c.advance - c.closedAgainstAdvance, '₽')}</b></dd><dt>Гарантийное удержание</dt><dd>${fmoney(c.retention, '₽')}</dd>
      <dt>Предъявлено к закрытию${c.presentedNote ? ' (' + esc(c.presentedNote) + ')' : ''}</dt><dd>${fmoney(c.presented, '₽')}</dd><dt>Рекомендовано к удержанию</dt><dd>${fmoney(c.recommendedRetention, '₽')}</dd></dl></div></section>
    <section class="panel"><header><h2>Рабочая сила</h2><span class="sub">чел., по неделям</span></header><div class="pad">${barsChart({ w: 560, h: 220, cats: M.wf.weeks.map(w => w.slice(8) + '.' + w.slice(5, 7)), groups: [], lines: [{ name: 'Факт', color: 'var(--accent)', vals: M.wf.fact, labels: true }, { name: 'План', color: 'var(--ink-3)', vals: M.wf.plan, dash: true }], yMax: 200, yTicks: [0, 50, 100, 150, 200], label: 'Рабочая сила' })}</div></section>
  </div>` : ''}`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Бюджет', go: '#/budget' }, { t: c.short, mid: true }, { t: 'Финансовая динамика' }], html, nav: '#/budget' };
}

/* ================= ФОТО =================
   Загруженные фото хранятся в IndexedDB этого браузера (CFG.photoDb); в среде Claude — в общей базе. */
const PhotoDB = {
  db: null,
  open(){
    if (!CFG.photoDb || !window.indexedDB) return Promise.resolve(null);
    return new Promise(ok => { try { const r = indexedDB.open(CFG.photoDb, 1); r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' }); r.onsuccess = () => { PhotoDB.db = r.result; ok(r.result); }; r.onerror = () => ok(null); } catch(e){ ok(null); } });
  },
  req(op){ return new Promise((ok, no) => { op.onsuccess = () => ok(op.result); op.onerror = () => no(op.error); }); },
  all(){ return PhotoDB.db ? PhotoDB.req(PhotoDB.db.transaction('photos').objectStore('photos').getAll()) : Promise.resolve([]); },
  put(rec){ return PhotoDB.req(PhotoDB.db.transaction('photos', 'readwrite').objectStore('photos').put(rec)); },
  view(r){ const w = r.work === '' || r.work == null ? null : +r.work; return { id: 'u-' + r.id, date: r.date, work: Number.isFinite(w) ? w : null, zone: r.zone || '', stage: r.stage || '', caption: r.caption || '', src: URL.createObjectURL(r.blob), local: true }; }
};
async function loadLocalPhotos(){
  if (Store.db || !(await PhotoDB.open())) return;
  try { const recs = await PhotoDB.all(); if (recs.length){ S.photos = [...S.photos.filter(p => !p.local), ...recs.map(PhotoDB.view)]; render(); } } catch(e){}
}
const PHOTO_CACHE = {};
function demoPhoto(date, i){
  const key = date + '|' + i; if (PHOTO_CACHE[key]) return PHOTO_CACHE[key];
  const shot = PHOTO_SHOTS[i], t = dn(date);
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#7FA3C6'); sky.addColorStop(1, '#C9D6E2'); g.fillStyle = sky; g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#5E5A52'; g.fillRect(0, 360, 640, 120);
  g.fillStyle = '#8E969E'; for (let k = 0; k < 7; k++){ g.fillRect(k * 100 - 20, 250 + (k % 3) * 18, 60, 110 - (k % 3) * 18); }
  const DP = CFG.demoPhoto || {}, fl = M.nodes.get(DP.floors);
  const floors = (fl ? fl.kids : []).map(k => M.nodes.get(k)).filter(n => /этаж/.test(n.name)).map(n => M.curve(n.u, 'fact', t) / 100);
  const fullF = floors.filter(v => v >= 0.99).length, part = floors.find(v => v < 0.99 && v > 0.05) || 0;
  const podz = 3, H = 20, bx = shot.view === 'east' ? 230 : 150, bw = shot.view === 'east' ? 230 : 330, base = 360;
  if (shot.kind === 'frame' || shot.kind === 'facade'){
    g.fillStyle = '#6F6A61'; g.fillRect(bx - 10, base - podz, bw + 20, podz + 2);
    const fac = shot.kind === 'facade' && M.nodes.has(DP.facade) ? M.curve(DP.facade, 'fact', t) / 100 : 0;
    for (let f = 0; f < fullF; f++){
      const y = base - (f + 1) * H;
      g.fillStyle = '#B9B4AA'; g.fillRect(bx, y, bw, 4);
      g.fillStyle = '#9C978D'; for (let c = 0; c <= 8; c++) g.fillRect(bx + c * (bw - 8) / 8, y, 8, H);
      if (f / Math.max(1, fullF) < fac * 1.6){ g.fillStyle = 'rgba(70,110,150,.85)'; for (let c = 0; c < 8; c++) g.fillRect(bx + 10 + c * (bw - 8) / 8, y + 6, (bw - 8) / 8 - 12, H - 7); }
    }
    if (part){ const y = base - (fullF + 1) * H; g.fillStyle = '#E0A133'; g.fillRect(bx, y + 8, bw * part, H - 8); g.fillStyle = '#9C978D'; for (let c = 0; c <= Math.floor(8 * part); c++) g.fillRect(bx + c * (bw - 8) / 8, y + 4, 8, H - 4); }
    const top = base - (fullF + 2) * H - 40;
    g.strokeStyle = '#E3B23C'; g.lineWidth = 5; g.beginPath(); g.moveTo(bx + bw + 40, base); g.lineTo(bx + bw + 40, top); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(bx + bw - 120, top + 6); g.lineTo(bx + bw + 110, top + 6); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = '#333'; g.beginPath(); g.moveTo(bx + bw - 60, top + 6); g.lineTo(bx + bw - 60, top + 70); g.stroke();
  } else {
    const len = 40 + 520 * (M.nodes.has(DP.yard) ? M.curve(DP.yard, 'fact', t) / 100 : 0);
    g.fillStyle = '#4A443C'; g.fillRect(40, 400, len, 26);
    g.fillStyle = '#C9C2B4'; g.fillRect(40, 404, 560, 3);
    g.fillStyle = '#2F6F9E'; for (let k = 0; k < 6; k++){ g.beginPath(); g.arc(470 + (k % 3) * 34, 350 - Math.floor(k / 3) * 30, 15, 0, 7); g.fill(); }
    g.fillStyle = '#9C978D'; g.fillRect(90, 190, 280, 170);
  }
  g.fillStyle = 'rgba(10,15,26,.72)'; g.fillRect(0, 440, 640, 40);
  g.fillStyle = '#fff'; g.font = '600 15px Inter, sans-serif'; g.fillText('ДЕМО-КАДР · ' + fd(t) + ' · ' + shot.zone, 16, 466);
  return (PHOTO_CACHE[key] = cv.toDataURL('image/jpeg', 0.82));
}
function allPhotos(){
  const demo = [];
  PHOTO_DATES.forEach(d => PHOTO_SHOTS.forEach((s, i) => demo.push({ id: 'd-' + d + '-' + i, date: d, work: s.work, zone: s.zone, caption: s.caption, get src(){ return demoPhoto(d, i); }, demo: true })));
  // реальные фото заменяют демо-кадры на свою дату
  const realDates = new Set([...PHOTOS_REAL, ...S.photos].map(p => p.date));
  return [...PHOTOS_REAL, ...S.photos, ...demo.filter(p => !realDates.has(p.date))].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
}
function photoDates(){ return [...new Set(allPhotos().map(p => p.date))].sort().reverse(); }

function viewPhotos(date){
  const dates = photoDates();
  const cur = date && dates.includes(date) ? date : dates[0];
  UI.photoDate = cur;
  const upAct = Store.sample ? 'ai-open' : 'upload';
  const ps = allPhotos().filter(p => p.date === cur);
  const i = dates.indexOf(cur);
  const works = [...new Set(ps.map(p => p.work))];
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 2 · Визуальный контроль</div><h1 style="margin-top:6px">Фотохроника</h1>
    <div class="meta"><span>${dates.length} отчётов · ${allPhotos().length} фото</span>${allPhotos().some(p => p.demo) ? chip('Более ранние даты — демо-кадры', 'warn') : ''}</div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap">${dates.length > 1 ? '<button class="btn" type="button" data-go="#/photos/compare">Сравнить даты</button>' : ''}<button class="btn primary" type="button" data-act="${upAct}">${ico('up')}Загрузить фото</button></div></div>
  ${DSFlowProject.photoChronicle({
    dates:dates.map(d=>{const dayPhotos=allPhotos().filter(p=>p.date===d);return {date:d,src:dayPhotos[0].src,count:dayPhotos.length};}),
    activeDate:cur,photos:ps,dateAttr:d=>`data-go="#/photos/${d}"`,
    viewerAttr:p=>`data-act="viewer" data-pid="${p.id}"`,
    formatDate:d=>fd(dn(d)),workLabel:p=>M.nodes.get(p.work)?.name || ''
  })}`;
  return { crumbs: cur ? [{ t: PROJECT.name, go: '#/' }, { t: 'Фото', go: '#/photos' }, { t: fd(dn(cur)) }] : [{ t: PROJECT.name, go: '#/' }, { t: 'Фото' }], html, nav: '#/photos' };
}
function viewCompare(){
  const dates = photoDates();
  UI.cmpA = UI.cmpA && dates.includes(UI.cmpA) ? UI.cmpA : dates[dates.length - 1];
  UI.cmpB = UI.cmpB && dates.includes(UI.cmpB) ? UI.cmpB : dates[0];
  const zones = [...new Set(allPhotos().map(p => p.zone))];
  UI.cmpZ = UI.cmpZ && zones.includes(UI.cmpZ) ? UI.cmpZ : zones.find(z => allPhotos().some(p => p.zone === z && p.date === UI.cmpA) && allPhotos().some(p => p.zone === z && p.date === UI.cmpB)) || zones[0];
  const pa = allPhotos().find(p => p.date === UI.cmpA && p.zone === UI.cmpZ), pb = allPhotos().find(p => p.date === UI.cmpB && p.zone === UI.cmpZ);
  const opt = (arr, v, f) => arr.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(f ? f(x) : x)}</option>`).join('');
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Фото · сравнение</div><h1 style="margin-top:6px">Сравнить даты</h1><div class="meta">Потяните разделитель, чтобы увидеть изменения на одной точке съёмки</div></div></div>
  <section class="panel"><div class="pad" style="padding-top:20px; display:flex; flex-direction:column; gap:14px">
    <div class="row-f" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="fld"><label for="cmp-a">Было</label><select id="cmp-a" data-cmp="A">${opt(dates, UI.cmpA, d => fd(dn(d)))}</select></div>
      <div class="fld"><label for="cmp-b">Стало</label><select id="cmp-b" data-cmp="B">${opt(dates, UI.cmpB, d => fd(dn(d)))}</select></div>
      <div class="fld"><label for="cmp-z">Точка съёмки</label><select id="cmp-z" data-cmp="Z">${opt(zones, UI.cmpZ)}</select></div>
    </div>
    ${pa && pb ? `<div class="cmp" id="cmp"><img src="${pb.src}" alt="Стало"><div class="clip" style="width:50%"><img src="${pa.src}" alt="Было" style="width:200%"></div>
      <span class="handle" style="left:50%"></span><span class="lb" style="left:10px">${fd(dn(UI.cmpA))}</span><span class="lb" style="right:10px">${fd(dn(UI.cmpB))}</span></div>`
      : '<div class="empty">Для этой точки съёмки нет фото на обе даты.</div>'}
    ${pa && pb ? `<div class="grid2e"><figure style="margin:0"><img src="${pa.src}" alt="" style="width:100%; border-radius:12px"><figcaption class="faint" style="font-size:12px; margin-top:4px">${fd(dn(UI.cmpA))} · ${esc(pa.caption)}</figcaption></figure><figure style="margin:0"><img src="${pb.src}" alt="" style="width:100%; border-radius:12px"><figcaption class="faint" style="font-size:12px; margin-top:4px">${fd(dn(UI.cmpB))} · ${esc(pb.caption)}</figcaption></figure></div>` : ''}
  </div></section>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Фото', go: '#/photos' }, { t: 'Сравнение' }], html, nav: '#/photos', after: bindCompare };
}
function bindCompare(){
  const el = document.getElementById('cmp'); if (!el) return;
  const set = x => { const r = el.getBoundingClientRect(); const p = clamp((x - r.left) / r.width, 0.02, 0.98); el.querySelector('.clip').style.width = p * 100 + '%'; el.querySelector('.clip img').style.width = (100 / p) + '%'; el.querySelector('.handle').style.left = p * 100 + '%'; };
  let drag = false;
  el.addEventListener('pointerdown', e => { drag = true; el.setPointerCapture(e.pointerId); set(e.clientX); });
  el.addEventListener('pointermove', e => { if (drag) set(e.clientX); });
  el.addEventListener('pointerup', () => { drag = false; });
}

/* ================= РИСКИ ================= */
function viewRisks(){
  const P = M.presc, n = P.open.length, hasP = n > 1 && P.open[n - 1] != null;
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 2 · Отклонения</div><h1 style="margin-top:6px">Риски и отклонения</h1><div class="meta">Реестр рисков проекта и отклонения, рассчитанные из графика, прогноза и финансов на ${fd(M.T)}</div></div></div>
  ${registerPanel()}
  <section class="panel"><header><h2>Отклонения по расчёту</h2></header><div class="tbl-wrap"><table class="t" style="min-width:760px"><thead><tr><th class="l">Уровень</th><th>Что</th><th class="l">Где</th><th class="l">Отклонение</th><th class="l">Раздел</th><th></th></tr></thead><tbody>
    ${M.risks.filter(r => r.type !== 'Реестр рисков').map(r => `<tr class="link" data-go="${r.go}"><td class="l">${chip(r.sev === 'crit' ? 'Критично' : r.sev === 'warn' ? 'Внимание' : 'Инфо', r.sev === 'neutral' ? 'neutral' : r.sev)}</td><td class="l" style="font-weight:600; white-space:normal">${esc(r.title)}</td><td class="l faint wrap">${esc(r.where)}</td><td class="l">${esc(r.text)}</td><td class="l faint">${esc(r.type)}</td><td>${ico('chev', 14)}</td></tr>`).join('') || '<tr><td colspan="6" class="l faint">Отклонений нет.</td></tr>'}
  </tbody></table></div></section>
  ${hasP ? `<section class="panel"><header><h2>Предписания</h2><span class="sub">${esc(PROJECT.gcName || '')}, нарастающим итогом</span></header>
    <div class="pad"><div class="tiles" style="margin-bottom:14px">
      <div class="tile"><div class="eyebrow">Выдано</div><div class="v">${P.issued[n-1]}</div><div class="s">за неделю +${P.issued[n-1] - P.issued[n-2]}</div></div>
      <div class="tile good"><div class="eyebrow">Устранено</div><div class="v">${P.fixed[n-1]}</div><div class="s">за неделю +${P.fixed[n-1] - P.fixed[n-2]}</div></div>
      <div class="tile warn"><div class="eyebrow">Не устранено</div><div class="v">${P.open[n-1]}</div><div class="s">за неделю ${sgn(P.open[n-1] - P.open[n-2])}</div></div></div>
    ${barsChart({ w: 900, h: 240, cats: P.weeks.map(w => w.slice(8) + '.' + w.slice(5, 7)), groups: [], lines: [{ name: 'Выдано всего', color: 'var(--accent)', vals: P.issued, labels: true }, { name: 'Устранено', color: 'var(--good)', vals: P.fixed, labels: true }, { name: 'Не устранено', color: 'var(--crit)', vals: P.open, labels: true }], yMax: 450, yTicks: [0, 100, 200, 300, 400], label: 'Предписания' })}</div></section>` : ''}`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Риски' }], html, nav: '#/risks' };
}

/* ================= ЖУРНАЛ ФАКТА ================= */
function viewJournal(){
  const recs = [...S.records].sort((a, b) => a.date < b.date ? 1 : -1);
  const imported = M.leaves.map(u => M.nodes.get(u)).filter(n => n.pc0 > 0 && n.u > 0).length;
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Уровень 5 · Первичные данные</div><h1 style="margin-top:6px">Журнал факта</h1>
    <div class="meta"><span>Импорт ГПР от ${fd(M.FILE)}: ${imported} работ с фактом</span><span>Записей сводок: ${recs.length}</span></div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap"><button class="btn" type="button" data-act="copy-csv">Скопировать CSV</button>${recs.length ? '<button class="btn" type="button" data-act="clear-recs">Удалить все записи</button>' : ''}<button class="btn primary" type="button" data-act="entry">${ico('plus')}Внести факт</button></div></div>
  <section class="panel"><header><h2>Загрузки файлов</h2><span class="sub">что прочитал ИИ и что изменилось</span><button class="btn sm primary" type="button" data-act="ai-open" style="margin-left:auto">${ico('up')}Загрузить файлы</button></header>
    <div class="pad" style="display:flex; flex-direction:column; gap:10px">${S.imports.length ? S.imports.slice(0, 30).map(im => `<details class="imp"><summary><span class="num faint">${new Date(im.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> <b>${esc((im.files || []).map(f => f.name).join(', ') || 'файлы')}</b> · изменений: ${im.count || 0}</summary>
      ${im.summary ? `<p class="muted" style="font-size:13px; margin:8px 0">${esc(im.summary)}</p>` : ''}
      <ul style="font-size:12.5px; margin:6px 0; padding-left:18px">${(im.applied || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      <div style="display:flex; gap:8px; flex-wrap:wrap">${(im.files || []).filter(f => f.asset).map(f => `<a class="btn sm" href="/_blob/${f.asset}" target="_blank" rel="noopener">${esc(f.name)}</a>`).join('')}</div></details>`).join('') : '<p class="faint" style="font-size:13px">Файлы ещё не загружались. Нажмите кнопку «Загрузить отчёт» внизу экрана: ИИ прочитает сводку, КС-2, реестр или фото и предложит изменения.</p>'}</div></section>
  <p class="note">Каждая запись — прирост факта по одной работе на дату. После сохранения пересчитываются готовность работы, этапа и проекта, прогноз, вехи и Гант. ${Store.db ? 'Записи хранятся в общей базе проекта и видны всем участникам.' : 'Записи хранятся в этом браузере.'}</p>
  <section class="panel"><div class="tbl-wrap"><table class="t" style="min-width:900px"><thead><tr><th>Дата</th><th class="l">Работа</th><th class="l">Этап</th><th>Прирост</th><th class="l">Автор</th><th class="l">Комментарий</th><th></th></tr></thead><tbody>
    ${recs.length ? recs.map(r => { const n = M.nodes.get(r.uid); return `<tr><td>${fd(dn(r.date))}</td><td class="l"><button class="btn sm" type="button" data-go="#/work/${r.uid}" style="height:auto; padding:6px 10px; white-space:normal; text-align:left">${esc(n?.name || r.uid)}</button></td><td class="l faint">${esc(M.stageOf(n)?.name || '')}</td><td style="color:${r.delta >= 0 ? 'var(--good)' : 'var(--crit)'}; font-weight:650">${r.set != null ? '= ' + fp(r.set, 1) + ' %' : (r.delta >= 0 ? '+' : '−') + fp(Math.abs(r.delta), 1) + ' %'}</td><td class="l">${r.source === 'ai' ? chip('ИИ', 'accent') + ' ' : r.source === 'update' ? chip('Обновление', 'neutral') + ' ' : ''}${esc(r.author || '—')}</td><td class="l wrap">${esc(r.note || '')}</td><td>${r.source === 'update' ? '' : `<button class="btn sm" type="button" data-act="del-rec" data-id="${r.id}">Удалить</button>`}</td></tr>`; }).join('')
    : '<tr><td colspan="7" class="l"><div class="empty">Записей пока нет. Нажмите «Внести факт», выберите работу и укажите прирост, например +2 %.</div></td></tr>'}
  </tbody></table></div></section>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Журнал факта' }], html, nav: '#/journal' };
}

/* ================= ОТЧЁТ: сводка проекта (верхнеуровневый управленческий отчёт) ================= */
function reportData(){
  const R = M.root, T = M.T, start = dn(PROJECT.start), pEnd = dn(PROJECT.planEnd);
  const total = pEnd - start, passed = T - start, delay = R.ff - pEnd, f = M.fin;
  const stages = stageRows();
  const lagSt = stages.filter(n => n.pc < 99.95 && (n.devDays > 0 || n.st.k === 'over' || n.st.k === 'late')).sort((a, b) => b.devDays - a.devDays);
  const concl = [];
  concl.push(`Готовность объекта ${fpct(R.pc, 1)} при плане на ${fd(T)} ${fpct(R.planNow, 1)} — ${R.devPP < -0.5 ? 'отставание ' + fp(-R.devPP, 1) + ' п.п.' : 'в графике'}.`);
  concl.push(`Пройдено ${fp(passed / total * 100)} % срока (${passed} из ${total} дн.). ${delay > 0 ? `Прогноз ввода ${fd(R.ff)} — на ${delay} дн. позже плана ${fd(pEnd)}.` : `Прогноз ввода совпадает с планом ${fd(pEnd)}.`}`);
  if (delay > 0 && M.drivers.length){ const d = [...M.drivers].reverse().slice(0, 3).map(n => n.name).join(' → '); concl.push(`Срок определяет цепочка: ${d}.`); }
  concl.push(`Закрыто актами ${fmoney(f.closed)} (${fpct(f.closedPct, 1)} законтрактованного) при плане ${fmoney(f.plan)} — ${f.plan > f.closed ? 'ниже плана на ' + fmoney(f.plan - f.closed, 'млн') : 'выше плана на ' + fmoney(f.closed - f.plan, 'млн')}.`);
  M.contracts.filter(c => Math.abs(c.gap) >= 5).forEach(c => concl.push(`${c.short}: физическая готовность ${fpct(c.phys, 1)}, финансовое закрытие ${fpct(c.closedPct, 1)} — расхождение ${fp(Math.abs(c.gap), 1)} п.п.`));
  if (lagSt.length) concl.push(`Отстают этапы: ${lagSt.slice(0, 4).map(n => `${shortName(n.name)} (${n.st.t.toLowerCase()})`).join('; ')}.`);
  const wf = M.wf.fact.filter(v => v != null).slice(-1)[0], wfp = M.wf.plan.filter(v => v != null).slice(-1)[0];
  const po = M.presc.open.filter(v => v != null).slice(-1)[0];
  if (wf != null) concl.push(`Численность ${wf} чел.${wfp != null ? ' при плане ' + wfp : ''}.${po != null ? ' Не устранено предписаний: ' + po + '.' : ''}`);
  return { R, T, start, pEnd, total, passed, delay, f, stages, concl, wf, wfp };
}
function reportText(){
  const d = reportData();
  return [`Сводка проекта ${PROJECT.name} на ${fd(d.T)}`, '', ...d.concl.map(x => '• ' + x), '', 'Этапы:',
    ...d.stages.map(n => `— ${shortName(n.name)}: ${pctTxt(n.pc)}, окончание ${fd(n.f0)}${n.devDays > 0 ? ', прогноз ' + fd(n.ff) + ' (+' + n.devDays + ' дн.)' : ''}`),
    '', 'Вехи:', ...M.ms.filter(m => m.key).map(m => `— ${m.name} (${fd(m.plan)}): ${m.t}${m.sub ? ', ' + m.sub : ''}`),
    '', 'Риски:', ...M.risks.slice(0, 6).map(r => `— ${r.title}: ${r.text}`)].join('\n');
}
function viewReport(){
  const T = M.T, start = dn(PROJECT.start), pEnd = dn(PROJECT.planEnd), total = pEnd - start, passed = clamp(T - start, 0, total);
  const gp = M.gpRoot, gpc = M.contracts.find(c => c.id === CFG.mainContract);
  const bt = S.settings.budgetTotal ?? PROJECT.budgetTotal;
  const leafCnt = M.order.filter(u => u > 0).length, stageCnt = gp.kids.length;
  const left = pEnd - T;
  const rDate = photoDates()[0], rphotos = allPhotos().filter(p => p.date === rDate && !p.demo);
  const kpi = (l, v, s) => `<div class="rp-kpi"><div class="rp-l">${l}</div><div class="rp-v">${v}</div><div class="rp-s">${s}</div></div>`;
  const row = (go, t, s, right) => `<button class="rp-row" type="button" data-go="${go}"><span class="rp-rt"><span class="rp-t">${t}</span><span class="rp-sub">${s}</span></span><span class="rp-right">${right}</span></button>`;
  const html = `<div class="rp">
    <div><h1 class="rp-h1">Сводка проекта</h1><p class="rp-lede">Страница использует те же данные, что карточки и график.</p></div>
    <div class="rp-kpis">
      ${kpi('Физическая готовность', fp(M.root.pc) + '%', 'модель весов объекта, снизу вверх')}
      ${kpi('Время', fp(passed / total * 100) + '%', passed + ' дн. из ' + total)}
      ${kpi('График работ', fp(gp.pc) + '%', esc(CFG.ganttSource || 'ГПР'))}
      ${kpi('Проектный бюджет', bt ? fmoney(bt) : '— ₽', bt ? 'законтрактовано ' + fpct(M.fin.contracted / bt * 100) : 'не предоставлен')}
    </div>
    <section class="rp-panel">
      <header class="rp-ph"><h2>Ключевые факты</h2><button class="rp-btn no-print" type="button" data-act="print">Печать / PDF</button></header>
      <div class="rp-list">
        ${row('#/timeline', 'Окончание проекта по плану', fd(pEnd), `<span class="rp-st"><span class="dot" style="background:${left < 0 ? 'var(--crit)' : 'var(--ink-3)'}"></span>${left >= 0 ? 'Осталось ' + left + ' дн.' : 'Просрочено ' + (-left) + ' дн.'}</span>`)}
        ${row('#/impl/gantt', 'График генподряда', leafCnt + ' задач · ' + stageCnt + ' крупных этапов', fp(gp.pc) + '%')}
        ${gpc ? row('#/contract/' + gpc.id, 'Договор ГП', 'Стоимость ' + Math.round(gpc.price).toLocaleString('ru-RU') + ' ₽', 'Закрыто ' + fp(gpc.closedPct, 1) + '%') : ''}
      </div>
    </section>
    ${rphotos.length ? `<section class="rp-panel">
      <header class="rp-ph"><h2>Фото с площадки · ${fd(dn(rphotos[0].date))}</h2><button class="rp-btn no-print" type="button" data-go="#/photos/${rphotos[0].date}">Все фото</button></header>
      <div class="rp-photos">${rphotos.map(p => `<button class="rp-ph-i" type="button" data-act="viewer" data-pid="${p.id}"><img src="${p.src}" alt="${esc(p.caption)}" loading="lazy"><span class="rp-cap"><b>${esc(p.caption)}</b><span>${esc(p.zone)}</span></span></button>`).join('')}</div>
    </section>` : ''}
  </div>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Отчёт' }], html, nav: '#/report' };
}
/* ================= ОБЩЕЕ ХРАНИЛИЩЕ: запись и подписка ================= */
const COLLS = ['records', 'fin', 'metrics', 'photos', 'imports', 'airisks', 'settings', 'admin', 'budget', 'upd'];
async function put(coll, id, data){
  if (Store.db){
    try { await Store.db.doc(coll + '/' + id).set(JSON.parse(JSON.stringify(data))); return true; }
    catch(e){ toast('Не удалось сохранить в общую базу: ' + esc(e.message || e.code) + '. Изменение видно только вам до перезагрузки.'); return false; }
  }
  save(); return true;
}
async function del(coll, id){
  if (Store.db){ try { await Store.db.doc(coll + '/' + id).delete(); } catch(e){} } else save();
}
let rebuildTimer = 0;
function scheduleRebuild(){ clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { build(); render(); }, 120); }
function subscribeAll(){
  const db = Store.db;
  db.collection('records').onSnapshot(q => { S.records = q.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRebuild(); }, () => {});
  db.collection('fin').onSnapshot(q => { const o = {}; q.docs.forEach(d => { o[d.id] = d.data(); }); S.fin = o; scheduleRebuild(); }, () => {});
  db.collection('metrics').onSnapshot(q => { const o = {}; q.docs.forEach(d => { o[d.id] = d.data(); }); S.metrics = o; scheduleRebuild(); }, () => {});
  db.collection('photos').onSnapshot(q => { S.photos = q.docs.map(d => { const x = d.data(); return { id: 'p-' + d.id, ...x, src: x.asset ? '/_blob/' + x.asset : x.src }; }); scheduleRebuild(); }, () => {});
  db.collection('imports').onSnapshot(q => { S.imports = q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at); scheduleRebuild(); }, () => {});
  db.collection('airisks').onSnapshot(q => { S.airisks = q.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRebuild(); }, () => {});
  db.collection('budget').onSnapshot(q => { const d = q.docs.find(x => x.id === 'data'); S.budget = normBudget(d ? d.data() : null); scheduleRebuild(); }, () => {});
  db.collection('admin').onSnapshot(q => { const d = q.docs.find(x => x.id === 'overlay'); S.admin = normAdmin(d ? d.data() : null); scheduleRebuild(); }, () => {});
  db.collection('upd').onSnapshot(q => { const d = q.docs.find(x => x.id === 'data'); S.upd = normUpd(d ? d.data() : null); scheduleRebuild(); }, () => {});
  db.collection('settings').onSnapshot(q => { const o = {}; q.docs.forEach(d => Object.assign(o, d.data())); S.settings = o; scheduleRebuild(); }, () => {});
}
async function initCaps(){
  const C = window.claude;
  if (!C || typeof C.use !== 'function'){ renderFab(); return; }
  const get = n => C.use(n).catch(() => null);
  const [db, assets, sample] = await Promise.all([get('db'), get('assets'), get('sample')]);
  Store.db = db; Store.assets = assets; Store.sample = sample;
  if (sample){ try { Store.limits = await sample.limits(); } catch(e){ Store.limits = null; } }
  if (db){ S.records = []; S.fin = {}; S.metrics = {}; S.airisks = []; S.imports = []; S.photos = []; subscribeAll(); }
  Store.ready = true;
  renderFab();
}

/* ================= КНОПКА ЗАГРУЗКИ ================= */
function renderFab(){ /* плавающая кнопка убрана: загрузка — через «Внести данные ИИ» */ const f = document.getElementById('ai-fab'); if (f) f.remove(); }

/* ================= ЧТЕНИЕ ФАЙЛОВ ================= */
const LIBS = {
  pdf: '../assets/vendor/pdf.min.js',
  pdfWorker: '../assets/vendor/pdf.worker.min.js',
  xlsx: '../assets/vendor/xlsx.full.min.js',
  mammoth: '../assets/vendor/mammoth.browser.min.js'
};
const loaded = {};
function loadScript(src){
  if (!loaded[src]) loaded[src] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Не загрузилась библиотека чтения файла')); document.head.appendChild(s); });
  return loaded[src];
}
const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
function decodeText(buf){
  let t = new TextDecoder('utf-8').decode(buf);
  if ((t.match(/\uFFFD/g) || []).length > 5){ try { t = new TextDecoder('windows-1251').decode(buf); } catch(e){} }
  return t;
}
async function extractFile(file){
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const out = { file, name: file.name, size: file.size, ext, kind: 'text', text: '', images: [], note: '' };
  try {
    if (IMG_EXT.includes(ext) || /^image\//.test(file.type)){ out.kind = 'image'; out.images = [file]; out.note = 'фото'; return out; }
    if (ext === 'mpp'){ out.kind = 'skip'; out.note = 'Файл .mpp браузер не читает. В MS Project: Файл → Сохранить как → XML, и загрузите .xml.'; return out; }
    const buf = await file.arrayBuffer();
    if (ext === 'pdf'){
      await loadScript(LIBS.pdf);
      const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
      const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      const parts = [];
      for (let i = 1; i <= Math.min(doc.numPages, 60); i++){
        const pg = await doc.getPage(i); const tc = await pg.getTextContent();
        let line = '', lastY = null; const lines = [];
        tc.items.forEach(it => { const y = Math.round(it.transform[5]); if (lastY != null && Math.abs(y - lastY) > 2){ lines.push(line); line = ''; } line += (line && !line.endsWith(' ') ? ' ' : '') + it.str; lastY = y; });
        lines.push(line);
        parts.push('--- стр. ' + i + ' ---\n' + lines.filter(l => l.trim()).join('\n'));
      }
      out.text = parts.join('\n');
      if (out.text.replace(/--- стр\. \d+ ---/g, '').trim().length < 40 * Math.min(doc.numPages, 60)){
        // скан без текстового слоя: отправляем первые страницы как изображения
        out.kind = 'scan'; out.note = 'скан без текста — страницы переданы ИИ как изображения';
        for (let i = 1; i <= Math.min(doc.numPages, 3); i++){
          const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1.6 });
          const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          out.images.push(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85)));
        }
      } else out.note = doc.numPages + ' стр.';
      return out;
    }
    if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)){
      await loadScript(LIBS.xlsx);
      const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
      out.text = wb.SheetNames.map(n => '### Лист: ' + n + '\n' + window.XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ';', blankrows: false, dateNF: 'dd.mm.yyyy' }).split('\n').filter(l => l.replace(/;/g, '').trim()).join('\n')).join('\n\n');
      out.note = wb.SheetNames.length + ' лист(а)';
      return out;
    }
    if (ext === 'docx'){
      await loadScript(LIBS.mammoth);
      out.text = (await window.mammoth.extractRawText({ arrayBuffer: buf })).value; out.note = 'Word'; return out;
    }
    const text = decodeText(buf);
    if (ext === 'xml' && /schemas\.microsoft\.com\/project/.test(text)){ out.kind = 'mspdi'; out.text = text; out.note = 'MS Project XML — читается без ИИ'; return out; }
    if (['csv', 'txt', 'md', 'json', 'xml', 'html', 'htm', 'tsv'].includes(ext) || /^text\//.test(file.type)){ out.text = text; out.note = 'текст'; return out; }
    out.kind = 'skip'; out.note = 'Формат не поддерживается. Подойдут PDF, Excel, Word, CSV, TXT, XML MS Project, фото.';
  } catch(e){ out.kind = 'skip'; out.note = 'Не удалось прочитать: ' + (e.message || e); }
  return out;
}

/* MS Project XML (MSPDI): факт по UID без ИИ */
function parseMspdi(text, name){
  const x = new DOMParser().parseFromString(text, 'application/xml');
  const sd = (x.querySelector('Project > StatusDate') || x.querySelector('StatusDate'))?.textContent?.slice(0, 10);
  const date = sd && sd > PROJECT.fileDate ? sd : iso(Math.max(M.T, M.FILE));
  const props = [];
  x.querySelectorAll('Tasks > Task').forEach(t => {
    const uid = +t.querySelector('UID')?.textContent, pc = +(t.querySelector('PercentComplete')?.textContent ?? NaN);
    const n = M.nodes.get(uid); if (!n || n.sm || isNaN(pc)) return;
    if (Math.abs(pc - n.pc) >= 0.5) props.push({ cat: 'work', uid, mode: 'total', value: pc, date, quote: 'MS Project: ' + (t.querySelector('Name')?.textContent || '') + ' — ' + pc + ' %', file: name, confidence: 1 });
  });
  return props;
}

/* ================= ЗАПРОС К ИИ ================= */
function catalogText(){
  const lines = [];
  const stages = [...stageRows(), ...(M.nodes.has(-10) ? [M.nodes.get(-10)] : [])];
  stages.forEach(st => {
    const leafs = (st.sm ? st.leafs : [st.u]).map(l => M.nodes.get(l)).filter(n => n.pc < 100);
    if (!leafs.length) return;
    lines.push('## ' + st.name);
    leafs.forEach(n => {
      const path = ancestors(n.u).filter(a => a.lvl > st.lvl).map(a => a.name.slice(0, 40)).join(' › ');
      lines.push(n.u + ' | ' + (path ? path + ' › ' : '') + n.name.slice(0, 60) + ' | ' + fp(n.pc) + '%');
    });
  });
  return lines.join('\n');
}
function buildPrompt(files, hint, reportDate){
  const head = `Ты инженер ПТО и аналитик стройконтроля. Разбери загруженные документы по объекту ${PROJECT.name} и извлеки из них ТОЛЬКО факты, которые обновляют отчёт.
Дата среза отчёта: ${fd(M.T)}. Дата документов по умолчанию: ${fd(dn(reportDate))}.${hint ? '\nПояснение пользователя: ' + hint : ''}

Правила:
- Выполнение работ указывай как процент от полного объёма работы. Если в документе объём в натуральных единицах (шт., м³, м², этажи, захватки) — пересчитай в % от общего объёма этой работы, если общий объём ясен из документа; иначе не включай.
- Сопоставляй работу только с uid из каталога ниже (каталог — незавершённые работы, «uid | путь › название | текущий %»). Если не уверен в сопоставлении — положи в "unmatched".
- mode "total" — итоговый % на дату; "delta" — прирост за период. Предпочитай total.
- Деньги — в рублях (finance) или в миллионах рублей (months). Договоры: ${CONTRACTS.length ? CONTRACTS.map(c => '"' + c.id + '" — ' + c.short.toLowerCase() + ' ' + c.counterparty).join(', ') : 'в данных объекта не заданы — finance и months оставь пустыми'}.
- Поля finance.field: closed (закрыто актами КС-2 всего), planToDate (план закрытия на дату), paid (оплачено), advance (аванс выдан), closedAgainstAdvance (закрыто в счёт аванса), retention (гарантийное удержание), presented (предъявлено к закрытию), recommendedRetention (рекомендовано к удержанию).
- workforce — численность рабочих на дату (факт и план), prescriptions — предписания нарастающим итогом (выдано, устранено, не устранено).
- photos — для каждого приложенного фото площадки: к какой работе (uid, можно укрупнённый этап) и зоне относится, короткая подпись.
- risks — новые проблемы и отклонения из документов, одной фразой.
- quote — короткая дословная цитата из документа, на которой основано значение. Ничего не выдумывай: нет данных — нет записи.
- confidence — от 0 до 1.

Ответь ТОЛЬКО JSON такого вида:
{"summary":"2–4 предложения по-русски: что за документы и что в них главное","reportDate":"YYYY-MM-DD или null",
"works":[{"uid":16935,"mode":"total","value":85,"date":"YYYY-MM-DD","quote":"…","file":"имя файла","confidence":0.9}],
"unmatched":[{"text":"…","file":"…"}],
"finance":[{"contract":"gp","field":"closed","value":1100000000,"quote":"…","file":"…","confidence":0.9}],
"months":[{"contract":"gp","ym":"2026-09","plan":120.5,"fact":110.2,"quote":"…","file":"…","confidence":0.9}],
"workforce":[{"date":"YYYY-MM-DD","fact":165,"plan":160,"quote":"…","file":"…"}],
"prescriptions":[{"date":"YYYY-MM-DD","issued":400,"fixed":300,"open":100,"quote":"…","file":"…"}],
"photos":[{"file":"…","work":<ID строки ГПР>,"zone":"…","caption":"…"}],
"risks":[{"text":"…","file":"…"}]}

КАТАЛОГ РАБОТ:
${catalogText()}

ДОКУМЕНТЫ:
`;
  const enc = new TextEncoder();
  const budget = ((Store.limits && Store.limits.maxPromptBytes) || 65536) - enc.encode(head).length - 1500;
  const texts = files.filter(f => f.kind === 'text' && f.text.trim());
  const maxImg = Store.limits && Store.limits.images ? Store.limits.images.maxCount : 0;
  const imgs = maxImg ? files.filter(f => f.images.length) : [];
  let docs = texts.map(f => ({ f, t: f.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') }));
  let total = docs.reduce((a, d) => a + enc.encode(d.t).length, 0), trimmed = false;
  if (total > budget){
    trimmed = true;
    const ratio = budget / total;
    docs = docs.map(d => { const b = enc.encode(d.t).length, keep = Math.floor(d.t.length * ratio * 0.97); d.cut = b > budget / docs.length; return { ...d, t: d.t.slice(0, keep) }; });
  }
  let body = docs.map(d => `=== Файл: ${d.f.name} ===\n${d.t}${d.t.length < d.f.text.length ? '\n[…текст обрезан по лимиту…]' : ''}`).join('\n\n');
  if (imgs.length) body += '\n\n=== Изображения (приложены к запросу по порядку) ===\n' + imgs.flatMap(f => f.images.map((_, i) => `- ${f.name}${f.images.length > 1 ? ' стр. ' + (i + 1) : ''}${f.kind === 'scan' ? ' (скан документа — прочитай текст)' : ' (фото площадки)'}`)).join('\n');
  return { prompt: head + body, trimmed };
}

/* ================= ПАНЕЛЬ ЗАГРУЗКИ ================= */
const AI = { files: [], props: [], summary: '', ctl: null, stage: 'pick', trimmed: false, err: '' };
function openAi(){
  AI.files = []; AI.props = []; AI.summary = ''; AI.stage = 'pick'; AI.err = '';
  const canAi = !!Store.sample;
  document.getElementById('layer').innerHTML = DSFlowProject.aiModal({closeAction:'data-act="ai-close"'});
  document.querySelector('.modal-bg').addEventListener('click', e => { if (e.target.dataset.bg && AI.stage !== 'thinking') closeLayer(); });
  drawAi();
}
function drawAi(){
  const b = document.getElementById('ai-body'); if (!b) return;
  const canAi = !!Store.sample, shared = !!Store.db;
  if (AI.stage === 'pick' || AI.stage === 'reading'){
    b.innerHTML = `
      <p class="muted" style="font-size:13px">Загрузите суточные сводки, КС-2 и КС-3, реестры платежей, отчёты по численности, предписания, фото с площадки или выгрузку ГПР. ${canAi ? 'ИИ прочитает файлы, сопоставит данные с работами и договорами и покажет изменения. Вы подтверждаете, что применить.' : '<b>Анализ ИИ доступен, когда страница открыта в Claude.</b> Выгрузка ГПР в XML обрабатывается и без него.'}</p>
      <label class="drop" id="ai-drop" for="ai-files" style="cursor:pointer; display:block">
        ${ico('up', 22)}<div style="margin-top:6px"><b>Выберите файлы</b> или перетащите сюда</div>
        <div class="faint" style="font-size:12px; margin-top:4px">PDF · Excel · Word · CSV · TXT · XML MS Project · JPG/PNG</div>
        <input id="ai-files" type="file" multiple accept=".pdf,.xlsx,.xls,.xlsm,.ods,.docx,.csv,.tsv,.txt,.md,.json,.xml,.mpp,image/*" style="position:absolute; width:1px; height:1px; opacity:0">
      </label>
      ${AI.files.length ? `<div class="flist">${AI.files.map((f, i) => `<div class="fitem"><span class="dot" style="background:${f.kind === 'skip' ? 'var(--crit)' : f.pending ? 'var(--ink-3)' : 'var(--good)'}"></span><span class="fn">${esc(f.name)}</span><span class="faint">${f.pending ? 'читаю…' : esc(f.note)}${f.text ? ' · ' + f.text.length.toLocaleString('ru-RU') + ' симв.' : ''}</span><button class="icon-btn" type="button" data-act="ai-rm" data-i="${i}" aria-label="Убрать файл" style="width:30px; height:30px">${ico('x', 14)}</button></div>`).join('')}</div>` : ''}
      <div class="row-f">
        <div class="fld"><label for="ai-date">Дата документов</label><input id="ai-date" type="date" value="${iso(Math.max(M.T, M.FILE))}"></div>
        <div class="fld"><label for="ai-hint">Пояснение для ИИ (необязательно)</label><input id="ai-hint" type="text" placeholder="Например: сводка за неделю, КС-2 за сентябрь"></div>
      </div>
      ${AI.err ? `<div class="note warn">${esc(AI.err)}</div>` : ''}
      <div style="display:flex; gap:8px; justify-content:space-between; align-items:center; flex-wrap:wrap">
        <span class="faint" style="font-size:12px">${shared ? 'Изменения попадут в общую базу проекта — их увидят все участники.' : 'Общая база недоступна в этом окне: изменения сохранятся только в вашем браузере.'}</span>
        <button class="btn primary" type="button" data-act="ai-run" ${AI.files.some(f => f.kind !== 'skip' && !f.pending) ? '' : 'disabled'}>${canAi ? 'Проанализировать' : 'Прочитать'}</button>
      </div>`;
    const inp = document.getElementById('ai-files'), drop = document.getElementById('ai-drop');
    inp.addEventListener('change', () => addAiFiles([...inp.files]));
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; }));
    drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = ''; addAiFiles([...e.dataTransfer.files]); });
  } else if (AI.stage === 'thinking'){
    b.innerHTML = `<div style="display:flex; flex-direction:column; gap:14px; align-items:flex-start">
      <div style="display:flex; gap:12px; align-items:center"><span class="spin" aria-hidden="true"></span><div><b>ИИ анализирует ${AI.files.filter(f => f.kind !== 'skip').length} файл(ов)</b><div class="faint" style="font-size:12.5px" id="ai-prog">Думаю… обычно 20–90 секунд</div></div></div>
      ${AI.trimmed ? '<div class="note warn">Тексты не поместились целиком: ИИ получил начало каждого файла. Для больших документов загружайте их по одному.</div>' : ''}
      <button class="btn" type="button" data-act="ai-stop">Остановить</button></div>`;
  } else if (AI.stage === 'review'){
    const groups = [['work', 'Выполнение работ'], ['fin', 'Финансы по договорам'], ['month', 'Закрытие по месяцам'], ['wf', 'Рабочая сила'], ['presc', 'Предписания'], ['photo', 'Фото'], ['risk', 'Риски из документов']];
    const rows = g => AI.props.map((p, i) => ({ p, i })).filter(x => x.p.cat === g);
    b.innerHTML = `
      ${AI.summary ? `<div class="note">${esc(AI.summary)}</div>` : ''}
      ${AI.props.length ? `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap"><b>${AI.props.length} изменений найдено</b><button class="btn sm" type="button" data-act="ai-all" data-v="1">Выбрать все</button><button class="btn sm" type="button" data-act="ai-all" data-v="0">Снять все</button></div>` : '<div class="note warn">В файлах не найдено данных, которые обновляют отчёт.</div>'}
      ${groups.map(([g, t]) => { const rs = rows(g); if (!rs.length) return ''; return `<div><div class="eyebrow" style="margin:6px 0 8px">${t}</div><div class="plist">${rs.map(({ p, i }) => propRow(p, i)).join('')}</div></div>`; }).join('')}
      ${AI.unmatched && AI.unmatched.length ? `<details><summary class="faint" style="cursor:pointer; font-size:13px">Не сопоставлено с работами: ${AI.unmatched.length}</summary><ul style="font-size:12.5px; color:var(--ink-2)">${AI.unmatched.map(u => `<li>${esc(u.text)} <span class="faint">· ${esc(u.file || '')}</span></li>`).join('')}</ul></details>` : ''}
      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap"><button class="btn" type="button" data-act="ai-back">Назад к файлам</button><button class="btn primary" type="button" data-act="ai-apply" ${AI.props.length ? '' : 'disabled'}>Применить выбранное</button></div>`;
  }
}
function propRow(p, i){
  let target = '', before = '', after = '';
  if (p.cat === 'work'){ const n = M.nodes.get(p.uid); target = `<a href="#/work/${p.uid}" data-go="#/work/${p.uid}">${esc(n.name)}</a><span class="faint"> · ${esc(M.stageOf(n)?.name || '')}</span>`; before = fpct(n.pc, 1); after = fpct(p.total, 1); }
  else if (p.cat === 'fin'){ const c = M.contracts.find(x => x.id === p.contract); target = esc(c.short) + ' · ' + esc(FIN_LABEL[p.field] || p.field); before = fmoney(c[p.field], '₽'); after = fmoney(p.value, '₽'); }
  else if (p.cat === 'month'){ const c = M.contracts.find(x => x.id === p.contract); const m = c.months.list.find(x => x[0] === p.ym); target = esc(c.short) + ' · закрытие ' + p.ym.slice(5) + '.' + p.ym.slice(0, 4); before = m ? `план ${fp(m[1], 2)} / факт ${fp(m[2], 2)}` : 'нет'; after = `план ${p.plan == null ? '—' : fp(p.plan, 2)} / факт ${p.fact == null ? '—' : fp(p.fact, 2)} млн`; }
  else if (p.cat === 'wf'){ target = 'Численность на ' + fd(dn(p.date)); after = `факт ${p.fact ?? '—'} / план ${p.plan ?? '—'}`; }
  else if (p.cat === 'presc'){ target = 'Предписания на ' + fd(dn(p.date)); after = `выдано ${p.issued ?? '—'} · устранено ${p.fixed ?? '—'} · открыто ${p.open ?? '—'}`; }
  else if (p.cat === 'photo'){ target = `<img src="${p.preview}" alt="" style="width:56px; height:42px; object-fit:cover; border-radius:6px; vertical-align:middle; margin-right:8px">` + esc(p.caption || p.file); after = esc((M.nodes.get(p.work)?.name || 'без привязки') + ' · ' + (p.zone || '')); }
  else if (p.cat === 'risk'){ target = esc(p.text); }
  const conf = p.confidence == null ? '' : `<span class="chip ${p.confidence >= 0.8 ? 'good' : p.confidence >= 0.6 ? 'neutral' : 'warn'}" title="Уверенность ИИ">${Math.round(p.confidence * 100)} %</span>`;
  return `<label class="prow"><input type="checkbox" data-pi="${i}" ${p.on ? 'checked' : ''}>
    <span class="pt"><span>${target}</span>${p.quote ? `<span class="pq">«${esc(p.quote)}»</span>` : ''}<span class="faint" style="font-size:11.5px">${esc(p.file || '')}${p.date && p.cat === 'work' ? ' · на ' + fd(dn(p.date)) : ''}</span></span>
    <span class="pv">${before ? `<span class="faint">${before}</span> → ` : ''}<b>${after}</b></span>${conf}</label>`;
}
const FIN_LABEL = { closed: 'закрыто актами', planToDate: 'план закрытия на дату', paid: 'оплачено', advance: 'аванс', closedAgainstAdvance: 'закрыто в счёт аванса', retention: 'гарантийное удержание', presented: 'предъявлено к закрытию', recommendedRetention: 'рекомендовано к удержанию' };

async function addAiFiles(list){
  AI.err = '';
  const items = list.map(f => ({ name: f.name, pending: true, kind: 'text', text: '', images: [], note: '' }));
  AI.files.push(...items); drawAi();
  await Promise.all(list.map(async (f, k) => { const r = await extractFile(f); Object.assign(items[k], r, { pending: false }); drawAi(); }));
}

async function runAi(){
  const files = AI.files.filter(f => f.kind !== 'skip' && !f.pending);
  const reportDate = document.getElementById('ai-date')?.value || iso(M.T), hint = document.getElementById('ai-hint')?.value || '';
  AI.reportDate = reportDate; AI.hint = hint;
  const props = [];
  files.filter(f => f.kind === 'mspdi').forEach(f => props.push(...parseMspdi(f.text, f.name)));
  const forAi = files.filter(f => f.kind !== 'mspdi');
  if (!forAi.length || !Store.sample){
    if (forAi.length && !Store.sample){ AI.err = 'Анализ ИИ недоступен в этом окне: обработаны выгрузка ГПР (XML) и фото без распознавания.'; props.push(...normalizeAi({}, reportDate, forAi.filter(f => f.kind === 'image'))); }
    finishReview(props, forAi.some(f => f.kind !== 'image') ? '' : 'Выгрузка MS Project прочитана без ИИ: сопоставление по UID работ.', []); return;
  }
  const { prompt, trimmed } = buildPrompt(forAi, hint, reportDate);
  AI.trimmed = trimmed; AI.stage = 'thinking'; drawAi();
  const maxImg = Store.limits && Store.limits.images ? Store.limits.images.maxCount : 0;
  const imgs = forAi.flatMap(f => f.images).slice(0, maxImg);
  AI.ctl = new AbortController();
  try {
    const res = await Store.sample.json(prompt, { modelTier: 'default', signal: AI.ctl.signal, ...(imgs.length ? { images: imgs } : {}),
      onText: ({ text }) => { const el = document.getElementById('ai-prog'); if (el) el.textContent = 'Формирую ответ… ' + text.length.toLocaleString('ru-RU') + ' симв.'; } });
    const photoFiles = forAi.filter(f => f.kind === 'image');
    finishReview([...props, ...normalizeAi(res, reportDate, photoFiles)], res.summary || '', res.unmatched || []);
  } catch(e){
    AI.stage = 'pick';
    const map = { cancelled: 'Анализ остановлен.', not_granted: 'Доступ страницы к Claude не разрешён. Разрешите его в окне запроса, чтобы ИИ мог читать файлы.', rate_limited: 'Слишком много запросов или исчерпан лимит. Попробуйте позже.', prompt_too_large: 'Файлы слишком большие для одного запроса. Загрузите их по одному.', invalid_json: 'ИИ ответил в неожиданном формате. Нажмите «Проанализировать» ещё раз.', refused: 'ИИ отказался обрабатывать эти файлы. Проверьте содержимое.', images_unavailable: 'В этом окне нельзя отправить изображения. Уберите фото и сканы.', image_rejected: 'Одно из изображений не подходит (тип или размер).' };
    AI.err = map[e && e.code] || 'Анализ не удался: ' + ((e && e.message) || e) + '. Попробуйте ещё раз.';
    if (props.length) finishReview(props, 'ИИ не ответил; показаны данные из выгрузки ГПР.', []); else drawAi();
  }
}
function normalizeAi(r, reportDate, photoFiles){
  const out = [], num = v => (v == null || v === '' || isNaN(+v)) ? null : +v, dt = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : (r.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(r.reportDate) ? r.reportDate : reportDate);
  (r.works || []).forEach(w => { const n = M.nodes.get(+w.uid), v = num(w.value); if (!n || n.sm || v == null) return;
    const total = clamp(w.mode === 'delta' ? n.pc + v : v, 0, 100); if (Math.abs(total - n.pc) < 0.05) return;
    out.push({ cat: 'work', uid: n.u, total, date: dt(w.date), quote: w.quote, file: w.file, confidence: num(w.confidence) }); });
  if (UI.admin) (r.finance || []).forEach(f => { const c = M.contracts.find(x => x.id === f.contract), v = num(f.value); if (!c || v == null || !FIN_LABEL[f.field]) return; if (c[f.field] != null && Math.abs(c[f.field] - v) < 1) return; out.push({ cat: 'fin', contract: c.id, field: f.field, value: v, quote: f.quote, file: f.file, confidence: num(f.confidence) }); });
  if (UI.admin) (r.months || []).forEach(m => { const c = M.contracts.find(x => x.id === m.contract); if (!c || !/^\d{4}-\d{2}$/.test(m.ym || '')) return; out.push({ cat: 'month', contract: c.id, ym: m.ym, plan: num(m.plan), fact: num(m.fact), quote: m.quote, file: m.file, confidence: num(m.confidence) }); });
  (r.workforce || []).forEach(w => { if (num(w.fact) == null && num(w.plan) == null) return; out.push({ cat: 'wf', date: dt(w.date), fact: num(w.fact), plan: num(w.plan), quote: w.quote, file: w.file }); });
  (r.prescriptions || []).forEach(w => { out.push({ cat: 'presc', date: dt(w.date), issued: num(w.issued), fixed: num(w.fixed), open: num(w.open), quote: w.quote, file: w.file }); });
  photoFiles.forEach(f => { const m = (r.photos || []).find(p => p.file === f.name) || {}; const n = M.nodes.get(+m.work);
    out.push({ cat: 'photo', file: f.name, blob: f.file, preview: URL.createObjectURL(f.file), work: n ? n.u : CFG.photoWorkDefault, zone: m.zone || '', caption: m.caption || f.name, date: reportDate }); });
  (r.risks || []).forEach(x => { if (x && x.text) out.push({ cat: 'risk', text: String(x.text), file: x.file, date: reportDate }); });
  return out;
}
function finishReview(props, summary, unmatched){
  props.forEach(p => { p.on = p.confidence == null || p.confidence >= 0.6; if (p.cat === 'work' && p.total == null) { const n = M.nodes.get(p.uid); p.total = p.mode === 'delta' ? n.pc + p.value : p.value; } });
  AI.props = props; AI.summary = summary; AI.unmatched = unmatched; AI.stage = 'review'; drawAi();
}

async function applyAi(){
  const sel = AI.props.filter(p => p.on);
  if (!sel.length) return toast('Отметьте хотя бы одно изменение.');
  const btn = document.querySelector('[data-act="ai-apply"]'); if (btn){ btn.disabled = true; btn.textContent = 'Применяю…'; }
  const before = { pc: M.root.pc, ff: M.root.ff, closed: M.fin.closed };
  const impId = 'i' + Date.now().toString(36);
  const applied = [];
  const writes = [];
  for (const p of sel){
    if (p.cat === 'work'){
      const n = M.nodes.get(p.uid), delta = Math.round((p.total - n.pc) * 100) / 100; if (!delta) continue;
      const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid: p.uid, date: p.date < PROJECT.fileDate ? PROJECT.fileDate : p.date, delta, author: 'ИИ · ' + (p.file || 'файл'), note: p.quote || '', at: Date.now(), source: 'ai', importId: impId };
      S.records.push(rec); writes.push(['records', rec.id, rec]); applied.push(`${n.name}: ${fpct(n.pc, 1)} → ${fpct(p.total, 1)}`);
    } else if (p.cat === 'fin'){
      const o = S.fin[p.contract] = S.fin[p.contract] || {}; o[p.field] = p.value; o.updatedAt = Date.now(); o.importId = impId;
      applied.push(`${M.contracts.find(c => c.id === p.contract).short}: ${FIN_LABEL[p.field]} = ${fmoney(p.value, '₽')}`);
    } else if (p.cat === 'month'){
      const o = S.fin[p.contract] = S.fin[p.contract] || {}; o.months = o.months || {}; o.months[p.ym] = { plan: p.plan, fact: p.fact }; o.updatedAt = Date.now();
      applied.push(`${M.contracts.find(c => c.id === p.contract).short}: закрытие ${p.ym} — факт ${p.fact ?? '—'} млн`);
    } else if (p.cat === 'wf'){
      const o = S.metrics.workforce = S.metrics.workforce || { weeks: {} }; o.weeks[p.date] = { fact: p.fact, plan: p.plan }; applied.push(`Численность ${fd(dn(p.date))}: ${p.fact ?? '—'}`);
    } else if (p.cat === 'presc'){
      const o = S.metrics.prescriptions = S.metrics.prescriptions || { weeks: {} }; o.weeks[p.date] = { issued: p.issued, fixed: p.fixed, open: p.open }; applied.push(`Предписания ${fd(dn(p.date))}: открыто ${p.open ?? '—'}`);
    } else if (p.cat === 'risk'){
      const r = { id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: p.text, file: p.file, date: p.date, importId: impId };
      S.airisks.push(r); writes.push(['airisks', r.id, r]); applied.push('Риск: ' + p.text);
    } else if (p.cat === 'photo'){
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      let doc = { date: p.date, work: p.work, zone: p.zone, caption: p.caption, importId: impId };
      if (Store.assets){ try { const up = await Store.assets.upload(p.blob); doc.asset = up.id; } catch(e){ toast('Фото «' + esc(p.file) + '» не загрузилось: ' + esc(e.code || '')); continue; } }
      else doc.src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(p.blob); });
      S.photos.push({ id: 'p-' + id, ...doc, src: doc.asset ? '/_blob/' + doc.asset : doc.src });
      if (doc.asset) writes.push(['photos', id, doc]);
      applied.push('Фото: ' + p.caption);
    }
  }
  if (sel.some(p => p.cat === 'fin' || p.cat === 'month')) Object.keys(S.fin).forEach(k => writes.push(['fin', k, S.fin[k]]));
  if (sel.some(p => p.cat === 'wf' || p.cat === 'presc')) Object.keys(S.metrics).forEach(k => writes.push(['metrics', k, S.metrics[k]]));
  // исходные файлы — в хранилище артефакта (форматы, которые оно принимает)
  const OK_TYPES = { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const fileRecs = [];
  for (const f of AI.files.filter(f => f.kind !== 'skip' && f.file)){
    const rec = { name: f.name, size: f.size, note: f.note };
    if (Store.assets && OK_TYPES[f.ext] && f.kind !== 'image'){ try { const up = await Store.assets.upload(f.file, { type: OK_TYPES[f.ext] }); rec.asset = up.id; } catch(e){} }
    fileRecs.push(rec);
  }
  const imp = { id: impId, at: Date.now(), date: AI.reportDate, hint: AI.hint || '', summary: AI.summary || '', files: fileRecs, applied, count: applied.length };
  S.imports.unshift(imp); writes.push(['imports', impId, imp]);
  build();
  if (Store.db){ for (const [c, id, d] of writes){ await put(c, id, d); } } else save();
  closeLayer(); render();
  const li = [`Изменений применено: ${applied.length}`, `Готовность проекта: ${fpct(before.pc, 2)} → <b>${fpct(M.root.pc, 2)}</b>`];
  if (M.root.ff !== before.ff) li.push(`Прогноз ввода: ${fds(before.ff)} → <b>${fds(M.root.ff)}</b>`);
  if (Math.abs(M.fin.closed - before.closed) > 1) li.push(`Закрыто актами: ${fmoney(before.closed)} → <b>${fmoney(M.fin.closed)}</b>`);
  toast(`<b>Данные из файлов применены.</b><ul>${li.map(x => '<li>' + x + '</li>').join('')}</ul>`, [['Журнал', '#/journal']]);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act^="ai-"]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'ai-open') openAi();
  else if (a === 'ai-close'){ if (AI.ctl) AI.ctl.abort(); closeLayer(); }
  else if (a === 'ai-rm'){ AI.files.splice(+t.dataset.i, 1); drawAi(); }
  else if (a === 'ai-run') runAi();
  else if (a === 'ai-stop'){ if (AI.ctl) AI.ctl.abort(); }
  else if (a === 'ai-back'){ AI.stage = 'pick'; drawAi(); }
  else if (a === 'ai-all'){ AI.props.forEach(p => { p.on = t.dataset.v === '1'; }); drawAi(); }
  else if (a === 'ai-apply') applyAi();
});
document.addEventListener('change', e => { const c = e.target.closest('[data-pi]'); if (c){ AI.props[+c.dataset.pi].on = c.checked; } });
/* ================= НАВИГАЦИЯ ================= */
/* Навигация: одна структура для боковой панели и мобильного меню.
   «Данные и отчёты» — группа (не страница), по умолчанию свёрнута; раскрывается сама, если открыт «Журнал» или «Риски». */
const NAV_MAIN = [['#/', 'Обзор', 'grid'], ['#/impl/structure', 'Реализация', 'gantt'], ['#/timeline', 'Календарь проекта', 'cal'], ['#/budget', 'Бюджет', 'card'], ['#/photos', 'Фото', 'image']];
const NAV_DATA = CFG.navData || [];
const NAV_REPORT = ['#/report', 'Отчёт', 'chart'];
const BOT = [['#/', 'Обзор', 'grid'], ['#/impl/structure', 'Реализация', 'gantt'], ['#/timeline', 'Календарь', 'cal'], ['#/budget', 'Бюджет', 'card']];
UI.dataOpen = false;
UI.secOpen = new Set();
function navHTML(cur, crit, gid){
  const it = ([h, t, ic], cnt) => `<button class="nav-i" type="button" data-go="${h}" ${cur === h ? 'aria-current="page"' : ''} title="${t}">${ico(ic)}<span class="nl">${t}</span>${cnt ? `<span class="cnt" aria-label="критичных: ${cnt}">${cnt}</span>` : ''}</button>`;
  if (NAV_DATA.some(x => x[0] === cur)) UI.dataOpen = true;
  return DSFlowProject.sidebar({ main:NAV_MAIN, grouped:NAV_DATA, item:x=>it(x, x[0] === '#/risks' ? crit : 0), groupOpen:UI.dataOpen, groupId:gid });
}
function openDataHub(){
  if (HOOKS.dataHub) return HOOKS.dataHub();
  modal('Внести данные ИИ', DSFlowProject.dataHub({manualAction:'data-act="entry"',aiAction:'data-act="ai-open"'}));
}
function openMobileNav(){
  const crit = M.risks.filter(r => r.sev === 'crit').length;
  document.getElementById('layer').innerHTML = `<div class="msheet-bg" data-bg="1"><nav class="msheet" aria-label="Меню">
    <span class="grab" aria-hidden="true"></span>${navHTML(UI._nav, crit, 'mg1')}
    <div style="display:flex; gap:8px; margin-top:10px"><button class="btn primary" type="button" data-act="data-hub" style="flex:1; justify-content:center">${ico('plus')}Внести данные ИИ</button><button class="btn" type="button" data-act="theme">Тема</button><button class="icon-btn sb-admin-m" type="button" data-act="admin" title="Администрирование" aria-label="Администрирование">${ico('gear', 16)}</button></div>
  </nav></div>`;
  document.querySelector('.msheet-bg').addEventListener('click', e => { if (e.target.dataset.bg) closeLayer(); });
}
let memHash = '#/', depth = 0;
const curHash = () => { try { return location.hash || memHash; } catch(e){ return memHash; } };
function go(h){
  if (h === curHash()) { render(); return; }
  depth++;
  memHash = h;
  try { location.hash = h; } catch(e){ render(); }
  if (curHash() !== h) render();
}
window.addEventListener('hashchange', () => { memHash = location.hash; if (document.getElementById('layer').children.length) closeLayer(); render(); });

function route(h){
  const p = h.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (HOOKS.route){ const hv = HOOKS.route(p); if (hv) return hv; }
  if (!p.length) return viewOverview();
  if (p[0] === 'impl'){ const k = p[1] || 'structure'; return k === 'gantt' ? viewGantt() : k === 'milestones' ? viewMilestones() : viewStructure(); }
  if (p[0] === 'node') return viewNode(+p[1]);
  if (p[0] === 'work') return viewWork(+p[1]);
  if (p[0] === 'timeline') return viewTimeline();
  if (p[0] === 'budget') return viewBudget();
  if (p[0] === 'contract') return viewContract(p[1]);
  if (p[0] === 'photos') return p[1] === 'compare' ? viewCompare() : viewPhotos(p[1]);
  if (p[0] === 'risks') return viewRisks();
  if (p[0] === 'journal') return viewJournal();
  if (p[0] === 'report') return viewReport();
  if (p[0] === 'admin' && p[1] === 'update') return window.DSFUpdate ? window.DSFUpdate.view(p[2] || 'upload') : { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Обновление данных' }], html: '<div class="panel"><div class="empty">Загрузка…</div></div>', nav: '#/admin' };
  if (p[0] === 'admin') return viewAdmin();
  return viewMissing();
}
let lastHash = null;
/* Режим источника данных (?headless=1): страница только считает модель объекта для Flow (bridge.js) и ничего не рисует. */
const HEADLESS = /[?&]headless=1\b/.test(location.search);
function render(){
  if (HEADLESS) return;
  const h = curHash();
  const v = route(h);
  const crit = M.risks.filter(r => r.sev === 'crit').length;
  UI._nav = v.nav;
  document.getElementById('sbnav').innerHTML = navHTML(v.nav, crit, 'sb-g1');
  const inMenu = ['#/photos', ...NAV_DATA.map(x => x[0])].includes(v.nav);
  document.getElementById('botnav').innerHTML = BOT.map(([hh, t, ic]) => `<button type="button" data-go="${hh}" ${v.nav === hh ? 'aria-current="page"' : ''}>${ico(ic)}${t}</button>`).join('')
    + `<button type="button" data-act="mnav" ${inMenu ? 'aria-current="page"' : ''} aria-label="Все разделы">${ico('menu')}Ещё</button>`;
  const cr = v.crumbs || [];
  const parent = [...cr].reverse().find((c, i) => i > 0 && c.go);
  document.getElementById('topbar').innerHTML = `
    ${cr.length > 1 ? `<button class="back" type="button" data-act="back" aria-label="Назад">${ico('back', 18)}</button>` : ''}
    <nav class="crumbs" aria-label="Путь">${cr.map((c, i) => {
      const last = i === cr.length - 1;
      const sep = i ? `<span class="sep ${c.mid ? 'mid' : ''}">${ico('chev', 12)}</span>` : '';
      const ell = c.mid && !cr[i - 1].mid ? `<span class="ell sep">${ico('chev', 12)}</span><span class="ell faint">…</span>` : '';
      return ell + sep.replace('class="sep ', 'class="sep ') + (last || !c.go ? `<span class="cur ${c.mid ? 'mid' : ''}">${esc(c.t)}</span>` : `<button type="button" class="${c.mid ? 'mid' : ''}" data-go="${c.go}">${esc(c.t)}</button>`);
    }).join('')}</nav>
    <div class="tb-r">
      ${UI.admin ? `<span class="adm-pill">${ico('gear', 14)}Режим администрирования<button type="button" data-go="#/admin">Правки</button><button type="button" data-act="admin-exit">Выйти</button></span>` : ''}
      <span class="chip neutral hide-m num">${ico('cal', 14)} Срез на ${fd(M.T)}</span>
    </div>`;
  document.getElementById('topbar').classList.toggle('tb-root', cr.length <= 1);
  UI._parent = parent ? parent.go : '#/';
  document.body.classList.toggle('dsf-admin', !!UI.admin);
  const view = document.getElementById('view');
  view.innerHTML = v.html;
  if (h !== lastHash){ window.scrollTo(0, 0); if (!h.startsWith('#/impl/gantt')) UI.sel = null; }
  lastHash = h;
  quickCard();
  // вехи: если не помещаются, лента прокручивается и открывается на «Сегодня»
  document.querySelectorAll('.ms-scroll').forEach(sc => { const tp = sc.querySelector('.today-pill'); if (tp && sc.scrollWidth > sc.clientWidth){ const r = tp.getBoundingClientRect(), b = sc.getBoundingClientRect(); sc.scrollLeft += (r.left + r.width / 2) - (b.left + b.width / 2); } });
  if (v.after) v.after();
  if (HOOKS.afterRender) HOOKS.afterRender(v);
}

/* ================= СОБЫТИЯ ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-act],[data-ovtab],[data-gscale],[data-gfilter]');
  if (!t) return;
  if (t.dataset.ovtab){ UI.ovTab = t.dataset.ovtab; render(); return; }
  if (t.dataset.gscale){ setScale(SCALES[t.dataset.gscale]); return; }
  if (t.dataset.gfilter){ UI.filter = t.dataset.gfilter; document.querySelectorAll('[data-gfilter]').forEach(b => b.setAttribute('aria-selected', String(b === t))); drawGantt(); return; }
  if (t.dataset.go){ e.preventDefault(); e.stopPropagation(); closeLayer(); go(t.dataset.go); return; }
  const a = t.dataset.act;
  if (a === 'back'){ if (depth > 0){ depth--; try { history.back(); } catch(err){ go(UI._parent); } } else go(UI._parent); }
  else if (a === 'nav-group'){
    const g = t.closest('.sb-group'); UI.dataOpen = !g.classList.contains('open');
    document.querySelectorAll('.sb-group').forEach(x => { x.classList.toggle('open', UI.dataOpen); x.querySelector('.sb-gh').setAttribute('aria-expanded', String(UI.dataOpen)); const gi = x.querySelector('.sb-gi'); if (UI.dataOpen) gi.removeAttribute('inert'); else gi.setAttribute('inert', ''); });
  }
  else if (a === 'mnav') openMobileNav();
  else if (a === 'data-hub') openDataHub();
  else if (a === 'sec-tog'){ const id = t.dataset.sec; UI.secOpen.has(id) ? UI.secOpen.delete(id) : UI.secOpen.add(id); const y = window.scrollY; render(); window.scrollTo(0, y); }
  else if (a === 'sec-all'){ UI.secOpen = t.dataset.v === '1' ? new Set(M.model.sections.map(x => x.id)) : new Set(); const y = window.scrollY; render(); window.scrollTo(0, y); }
  else if (a === 'print'){ if (window.claude && typeof window.claude.use === 'function') toast('Печать в PDF доступна в скачанном HTML-файле: откройте его в браузере и нажмите «Печать / PDF».'); else { try { window.print(); } catch(err){} } }
  else if (a === 'copy-report'){ const txt = reportText(); try { navigator.clipboard.writeText(txt).then(() => toast('Текст отчёта скопирован.'), () => showText(txt)); } catch(err){ showText(txt); } }
  else if (a === 'entry'){ closeLayer(); openEntry(t.dataset.u ? +t.dataset.u : null); }
  else if (a === 'theme'){ const r = document.documentElement; const cur = r.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark'); Theme.set(r.getAttribute('data-theme')); render(); }
  else if (a === 'gzoom') setScale(G.px * +t.dataset.f);
  else if (a === 'gtoday'){ G.pendingScroll = 'today'; drawGantt(); }
  else if (a === 'gexpand'){ M.order.forEach(u => { if (M.nodes.get(u).sm) G.exp.add(u); }); LS.set('gexp', [...G.exp]); drawGantt(); }
  else if (a === 'gcollapse'){ G.exp = new Set([-1, CFG.gpRoot]); LS.set('gexp', [...G.exp]); drawGantt(); }
  else if (a === 'gcols'){ S.ganttCols = !S.ganttCols; LS.set('ganttCols', S.ganttCols); render(); }
  else if (a === 'gbase'){
    if (S.baseline) S.baseline = null;
    else { const map = {}; M.nodes.forEach(n => { map[n.u] = [n.s0, n.f0]; }); S.baseline = { at: iso(M.T), map }; }
    save(); build(); render(); toast(S.baseline ? 'Базовый план зафиксирован на ' + fd(M.T) + '. Теперь отклонения видны относительно него.' : 'Базовый план сброшен.');
  }
  else if (a === 'gantt-focus'){ const u = +t.dataset.u; ancestors(u).forEach(x => G.exp.add(x.u)); if (M.nodes.get(u).sm) G.exp.add(u); UI.sel = u; G.focus = u; G.pendingScroll = 'focus'; UI.filter = 'all'; UI.q = ''; go('#/impl/gantt'); }
  else if (a === 'qc-close'){ UI.sel = null; drawGantt(); }
  else if (a === 'del-rec'){ const before = snap(S.records.find(r => r.id === t.dataset.id)?.uid); const rid = t.dataset.id; S.records = S.records.filter(r => r.id !== rid); build(); render(); del('records', rid); toastChanges(before, 'Запись удалена'); }
  else if (a === 'clear-recs'){ openConfirm('Удалить все записи факта?', 'Останется только импорт из ГПР. Действие нельзя отменить.', () => { const ids = S.records.map(r => r.id); S.records = []; build(); render(); ids.forEach(id => del('records', id)); toast('Все записи удалены.'); }); }
  else if (a === 'copy-csv'){
    const csv = ['Дата;Работа;ID;Прирост %;Автор;Комментарий', ...S.records.map(r => [r.date, M.nodes.get(r.uid)?.name, r.uid, String(r.delta).replace('.', ','), r.author, r.note].map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(';'))].join('\n');
    const done = () => toast('CSV скопирован в буфер обмена.');
    try { navigator.clipboard.writeText(csv).then(done, () => showText(csv)); } catch(err){ showText(csv); }
  }
  else if (a === 'viewer') openViewer(t.dataset.pid);
  else if (a === 'upload') openUpload();
  else if ((a === 'budget-total' || a.startsWith('bud-')) && !UI.admin) toast('Изменение бюджета и договоров доступно в режиме администрирования.');
  else if (a === 'budget-total') openBudget();
  else if (a === 'bud-contract') openContractForm(null);
  else if (a === 'bud-contract-edit') openContractForm(t.dataset.id);
  else if (a === 'bud-contract-del'){ const id = t.dataset.id, c = S.budget.contracts.find(x => x.id === id); closeLayer(); openConfirm('Удалить договор?', `Договор «${c ? c.short || c.counterparty : ''}» и все его сметы, акты КС-2 и справки КС-3 будут удалены.`, () => { budgetCommit(B => { B.contracts = B.contracts.filter(x => x.id !== id); B.docs = B.docs.filter(d => d.contractId !== id); }, 'Договор удалён'); go('#/budget'); }); }
  else if (a === 'bud-doc-add') openDocForm(t.dataset.type, t.dataset.c, null);
  else if (a === 'bud-doc-edit') openDocForm(t.dataset.type, t.dataset.c, t.dataset.id);
  else if (a === 'bud-doc-del'){ const id = t.dataset.id; closeLayer(); openConfirm('Удалить документ?', 'Документ будет удалён, закрытие по договору пересчитается.', () => budgetCommit(B => { B.docs = B.docs.filter(d => d.id !== id); }, 'Документ удалён')); }
  else if (a === 'close') closeLayer();
  else if (a === 'admin') adminEnter();
  else if (a === 'admin-exit') adminExit();
  else if (a === 'adm-edit'){ closeLayer(); openAdminEditor(+t.dataset.u); }
  else if (a === 'adm-add'){ closeLayer(); openAdminEditor(null, t.dataset.u ? +t.dataset.u : (UI.sel != null && M.nodes.get(UI.sel)?.sm ? UI.sel : UI.sel != null ? M.nodes.get(UI.sel)?.parent : undefined)); }
  else if (a === 'adm-hide'){ closeLayer(); adminHide(+t.dataset.u, false); }
  else if (a === 'adm-del'){ closeLayer(); adminHide(+t.dataset.u, true); }
  else if (a === 'adm-restore') adminRestore(+t.dataset.u);
  else if (a === 'adm-up') adminMove(+t.dataset.u, -1);
  else if (a === 'adm-down') adminMove(+t.dataset.u, 1);
  else if (a === 'adm-undo'){ const el = document.getElementById('toast'); if (el) el.hidden = true; adminUndo(); }
  else if (a === 'adm-sel'){ const u = +t.dataset.u; t.checked ? UI.admSel.add(u) : UI.admSel.delete(u); const y = window.scrollY; render(); window.scrollTo(0, y); }
  else if (a === 'adm-more'){ UI.admLimit += 200; const y = window.scrollY; render(); window.scrollTo(0, y); }
  else if (a === 'adm-mass-shift') adminMassShift();
  else if (a === 'adm-mass-hide') adminMassHide();
  else if (a === 'adm-export') adminExport();
  else if (a === 'adm-import') adminImport();
  else if (a === 'adm-reset') openConfirm('Сбросить все правки?', 'График вернётся к исходному ГПР: правки, добавленные, скрытые и удалённые работы будут сброшены. Действие можно отменить кнопкой «Отменить последнее» до перезагрузки страницы.', () => adminCommit(A => { A.edits = {}; A.added = []; }, 'Сброшены все правки графика'), 'Сбросить');
  else if (a === 'adm-reset-one'){ const u = +t.dataset.u; closeLayer(); openConfirm('Вернуть исходные значения?', 'Все правки этой работы будут отменены.', () => adminCommit(A => { const e = A.edits[u] || {}; const keep = {}; ['hidden', 'deleted', 'hiddenAt', 'deletedAt'].forEach(k => { if (e[k] != null) keep[k] = e[k]; }); if (Object.keys(keep).length) A.edits[u] = keep; else delete A.edits[u]; }, 'Исходные значения восстановлены: «' + admName(u) + '»', u), 'Вернуть'); }
  else if (a === 'toast-x'){ const el = document.getElementById('toast'); if (el) el.hidden = true; }
});
document.addEventListener('change', e => {
  const s = e.target.closest('[data-cmp]');
  if (s){ UI['cmp' + s.dataset.cmp] = s.value; render(); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form="quick"]'); if (!f) return;
  e.preventDefault();
  const date = f.querySelector('#q-date').value, delta = parseFloat(String(f.querySelector('#q-delta').value).replace(',', '.')), note = f.querySelector('#q-note').value;
  addRecord(+f.dataset.u, date, delta, 'Тестировщик', note);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLayer();
  const v = document.querySelector('.viewer');
  if (v && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) v.querySelector(e.key === 'ArrowRight' ? '[data-vnext]' : '[data-vprev]')?.click();
});

/* ================= ВВОД ФАКТА И ПЕРЕСЧЁТ ================= */
function snap(u){
  if (u == null || !M.nodes.get(u)) return null;
  const n = M.nodes.get(u), st = M.stageOf(n);
  return { u, pc: n.pc, ff: n.ff, st: st ? { u: st.u, name: st.name, pc: st.pc, ff: st.ff } : null, root: { pc: M.root.pc, ff: M.root.ff }, ms: M.ms.map(m => m.k), fin: M.contracts.map(c => c.gap) };
}
function addRecord(uid, date, delta, author, note){
  const n = M.nodes.get(uid);
  if (!n || n.sm) return toast('Выберите конкретную работу, а не этап.');
  if (!date || date < PROJECT.fileDate) return toast('Дата должна быть не раньше ' + fd(dn(PROJECT.fileDate)) + ': более ранний факт уже учтён в ГПР.');
  if (isNaN(delta) || delta === 0) return toast('Укажите прирост в процентах, например 2.');
  if (n.pc + delta > 100.001 || n.pc + delta < -0.001) return toast('Итог должен быть от 0 до 100 %. Сейчас ' + fpct(n.pc, 1) + '.');
  const before = snap(uid);
  const rec = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid, date, delta, author, note, at: Date.now(), source: 'manual' };
  S.records.push(rec); build(); closeLayer(); render(); put('records', rec.id, rec);
  toastChanges(before, 'Сохранено');
}
function toastChanges(b, title){
  if (!b){ toast(title); return; }
  const n = M.nodes.get(b.u), st = b.st ? M.nodes.get(b.st.u) : null;
  const li = [];
  li.push(`${esc(n.name)}: ${fpct(b.pc, 1)} → <b>${fpct(n.pc, 1)}</b>${n.ff !== b.ff ? `, прогноз ${fds(b.ff)} → <b>${fds(n.ff)}</b>` : ''}`);
  if (st && st.u !== n.u) li.push(`Этап «${esc(st.name)}»: ${fpct(b.st.pc, 1)} → <b>${fpct(st.pc, 1)}</b>`);
  li.push(`Проект: ${fpct(b.root.pc, 2)} → <b>${fpct(M.root.pc, 2)}</b>${M.root.ff !== b.root.ff ? `, прогноз ввода ${fds(b.root.ff)} → <b>${fds(M.root.ff)}</b>` : ''}`);
  const msCh = M.ms.filter((m, i) => m.k !== b.ms[i]);
  if (msCh.length) li.push('Вехи: ' + msCh.map(m => `${esc(m.name)} — ${esc(m.t)}`).join('; '));
  toast(`<b>${title}.</b> Пересчитано:<ul>${li.map(x => '<li>' + x + '</li>').join('')}</ul>`, [['Динамика работы', '#/work/' + n.u], ['Гант', 'gantt:' + n.u]]);
}
let toastTimer = 0;
function toast(html, actions){
  let el = document.getElementById('toast');
  if (!el){ el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = html + (actions ? `<div class="ta">${actions.map(([t, h]) => h.startsWith('gantt:') ? `<button type="button" data-act="gantt-focus" data-u="${h.slice(6)}">${t}</button>` : h === 'adm-undo:' ? `<button type="button" data-act="adm-undo">${t}</button>` : `<button type="button" data-go="${h}">${t}</button>`).join('')}<button type="button" data-act="toast-x">Закрыть</button></div>` : '');
  el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, actions ? 12000 : 4500);
}

function closeLayer(){ document.getElementById('layer').innerHTML = ''; document.body.style.overflow = ''; BgLock.set(false); }
function modal(title, body){
  document.getElementById('layer').innerHTML = `<div class="modal-bg" data-bg="1"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Закрыть">${ico('x')}</button></header><div class="body">${body}</div></div></div>`;
  document.querySelector('.modal-bg').addEventListener('click', e => { if (e.target.dataset.bg) closeLayer(); });
}
function openConfirm(title, text, ok, okLabel = 'Удалить'){
  modal(title, `<p class="muted">${esc(text)}</p><div style="display:flex; gap:8px; justify-content:flex-end"><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="cf-ok">${esc(okLabel)}</button></div>`);
  document.getElementById('cf-ok').onclick = () => { closeLayer(); ok(); };
}
function showText(txt){ modal('Скопируйте текст', `<div class="fld"><textarea id="copy-area" style="height:220px">${esc(txt)}</textarea></div>`); const a = document.getElementById('copy-area'); a.focus(); a.select(); }

function openEntry(uid){
  const list = M.leaves.map(u => M.nodes.get(u)).filter(n => (n.u > 0 || n.u <= -100) && n.pc < 100).sort((a, b) => (b.pc > 0 && b.s0 <= M.T) - (a.pc > 0 && a.s0 <= M.T) || a.s0 - b.s0);
  let sel = uid && M.nodes.get(uid) && !M.nodes.get(uid).sm ? uid : null;
  modal('Внести факт', `
    <div class="fld"><label for="e-q">Работа</label><input id="e-q" type="search" placeholder="Начните вводить название или ID" autocomplete="off">
      <div class="picklist" id="e-list" role="listbox"></div></div>
    <div class="row-f">
      <div class="fld"><label for="e-date">Дата сводки</label><input id="e-date" type="date" value="${iso(Math.max(M.T, M.FILE))}" min="${PROJECT.fileDate}"></div>
      <div class="fld"><label for="e-mode">Ввод</label><select id="e-mode"><option value="d">Прирост за период, %</option><option value="t">Итого на дату, %</option></select></div>
    </div>
    <div class="row-f">
      <div class="fld"><label for="e-v">Значение, %</label><input id="e-v" type="number" step="0.5" value="2" inputmode="decimal"></div>
      <div class="fld"><label for="e-a">Автор</label><input id="e-a" type="text" value="${esc(LS.get('author', 'Тестировщик'))}"></div>
    </div>
    <div class="fld"><label for="e-n">Комментарий</label><input id="e-n" type="text" placeholder="Захватка, оси, причина отклонения"></div>
    <div class="note" id="e-prev">Выберите работу</div>
    <div style="display:flex; gap:8px; justify-content:flex-end"><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="e-save">Сохранить и пересчитать</button></div>`);
  const q = document.getElementById('e-q'), L = document.getElementById('e-list');
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const items = list.filter(n => !s || n.name.toLowerCase().includes(s) || String(n.mid) === s || (M.stageOf(n)?.name || '').toLowerCase().includes(s)).slice(0, 60);
    L.innerHTML = items.map(n => `<button type="button" role="option" data-pick="${n.u}" aria-selected="${n.u === sel}"><span>${esc(n.name)}<br><small>${esc(M.stageOf(n)?.name || '')} · ID ${n.mid}</small></span><small>${fpct(n.pc)}</small></button>`).join('') || '<div class="empty">Не найдено</div>';
  };
  const prev = () => {
    const n = sel ? M.nodes.get(sel) : null, v = parseFloat(String(document.getElementById('e-v').value).replace(',', '.'));
    const box = document.getElementById('e-prev');
    if (!n){ box.textContent = 'Выберите работу'; return; }
    const tot = document.getElementById('e-mode').value === 't' ? v : n.pc + v;
    box.innerHTML = `<b>${esc(n.name)}</b>: сейчас ${fpct(n.pc, 1)} → станет <b>${isNaN(tot) ? '—' : fpct(tot, 1)}</b>. План на сегодня ${fpct(n.planNow, 1)}.`;
  };
  if (sel){ q.value = M.nodes.get(sel).name; }
  draw(); prev();
  q.addEventListener('input', () => { draw(); });
  L.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (!b) return; sel = +b.dataset.pick; draw(); prev(); });
  ['e-v', 'e-mode'].forEach(id => document.getElementById(id).addEventListener('input', prev));
  document.getElementById('e-save').onclick = () => {
    if (!sel) return toast('Выберите работу из списка.');
    const n = M.nodes.get(sel), v = parseFloat(String(document.getElementById('e-v').value).replace(',', '.'));
    const delta = document.getElementById('e-mode').value === 't' ? v - n.pc : v;
    LS.set('author', document.getElementById('e-a').value);
    addRecord(sel, document.getElementById('e-date').value, Math.round(delta * 100) / 100, document.getElementById('e-a').value, document.getElementById('e-n').value);
  };
  setTimeout(() => q.focus(), 30);
}

function openBudget(){
  const cur = S.settings.budgetTotal ?? PROJECT.budgetTotal;
  modal('Бюджет проекта', `<div class="fld"><label for="b-v">Стоимость проекта, млрд ₽</label><input id="b-v" type="number" step="0.01" min="0" value="${cur ? (cur / 1e9).toFixed(2) : ''}" placeholder="Например 12,4"><span class="hint">Нужна для расчёта «законтрактовано, %». Хранится в этом браузере.</span></div>
    <div style="display:flex; gap:8px; justify-content:flex-end"><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="b-ok">Сохранить</button></div>`);
  document.getElementById('b-ok').onclick = () => { const v = parseFloat(String(document.getElementById('b-v').value).replace(',', '.')); S.settings.budgetTotal = v > 0 ? v * 1e9 : null; put('settings', 'project', { budgetTotal: S.settings.budgetTotal }); closeLayer(); render(); };
}

function openUpload(){
  const works = M.order.map(u => M.nodes.get(u)).filter(n => n.lvl <= 3 && n.u !== -1);
  modal('Загрузить фото', `
    <div class="fld"><label for="u-f">Файлы</label><input id="u-f" type="file" accept="image/*" multiple style="padding-top:10px"><span class="hint">${PhotoDB.db ? 'Фото сохраняются в этом браузере.' : 'Фото хранятся до перезагрузки страницы.'}</span></div>
    <div class="row-f"><div class="fld"><label for="u-d">Дата отчёта</label><input id="u-d" type="date" value="${iso(M.T)}"></div>
      <div class="fld"><label for="u-w">Вид работ</label><select id="u-w">${works.map(n => `<option value="${n.u}" ${n.u === CFG.photoWorkDefault ? 'selected' : ''}>${'  '.repeat(Math.max(0, n.lvl - 2))}${esc(n.name)}</option>`).join('')}</select></div></div>
    <div class="row-f"><div class="fld"><label for="u-z">Зона объекта</label><input id="u-z" type="text" value="${esc(CFG.photoZoneDefault || '')}" placeholder="Например: участок 3"></div>
      <div class="fld"><label for="u-c">Подпись</label><input id="u-c" type="text" placeholder="Что на фото"></div></div>
    <div style="display:flex; gap:8px; justify-content:flex-end"><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="u-ok">Добавить</button></div>`);
  document.getElementById('u-ok').onclick = () => {
    const files = [...document.getElementById('u-f').files];
    if (!files.length) return toast('Выберите хотя бы один файл.');
    const date = document.getElementById('u-d').value, work = +document.getElementById('u-w').value, zone = document.getElementById('u-z').value, cap = document.getElementById('u-c').value;
    if (PhotoDB.db){
      (async () => {
        try {
          for (const f of files){ const rec = { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)), date, zone, caption: cap || f.name.replace(/\.[^.]+$/, ''), work: Number.isFinite(work) ? work : '', blob: f, added: new Date().toISOString() }; await PhotoDB.put(rec); S.photos.push(PhotoDB.view(rec)); }
          closeLayer(); go('#/photos/' + date); render(); toast('Добавлено фото: ' + files.length);
        } catch(e){ toast('Не удалось сохранить фото в браузере. Проверьте свободное место и попробуйте ещё раз.'); }
      })();
      return;
    }
    let left = files.length;
    files.forEach((f, i) => { const r = new FileReader(); r.onload = () => { S.photos.push({ id: 'u-' + Date.now() + '-' + i, date, work, zone, caption: cap || f.name, src: r.result }); if (!--left){ closeLayer(); go('#/photos/' + date); render(); toast('Добавлено фото: ' + files.length); } }; r.readAsDataURL(f); });
  };
}

function openViewer(pid){
  const all = allPhotos(), p = all.find(x => x.id === pid); if (!p) return;
  const day = all.filter(x => x.date === p.date), i = day.indexOf(p);
  const n = M.nodes.get(p.work);
  document.getElementById('layer').innerHTML = `<div class="viewer" role="dialog" aria-modal="true" aria-label="Просмотр фото">
    <div class="vt"><b>${fd(dn(p.date))}</b><span style="color:#A4B1C5">${i + 1} из ${day.length}</span><button class="icon-btn" type="button" data-act="close" aria-label="Закрыть" style="margin-left:auto; background:rgba(255,255,255,.12); color:#fff">${ico('x')}</button></div>
    <div class="vi"><img src="${p.src}" alt="${esc(p.caption)}">
      ${day.length > 1 ? `<button class="nav" type="button" data-vprev data-act="viewer" data-pid="${day[(i - 1 + day.length) % day.length].id}" style="left:8px" aria-label="Предыдущее">${ico('left')}</button>
      <button class="nav" type="button" data-vnext data-act="viewer" data-pid="${day[(i + 1) % day.length].id}" style="right:8px" aria-label="Следующее">${ico('right')}</button>` : ''}</div>
    <div class="vc"><span><b>${esc(p.caption)}</b></span><span>Зона: ${esc(p.zone)}</span>${p.stage ? `<span>Этап: ${esc(p.stage)}</span>` : ''}${n ? `<button type="button" data-go="${n.sm ? '#/node/' : '#/work/'}${n.u}" style="border:0; background:none; color:#7FB6FF; font:inherit; cursor:pointer; padding:0">Работа: ${esc(n.name)} →</button>` : ''}${p.demo ? '<span style="color:#E9AE3A">демо-кадр</span>' : ''}</div>
  </div>`;
}

/* Общая PWA DSFlow подключена через ../assets/dsflow.js. */

/* ================= АДМИНИСТРИРОВАНИЕ ПРОЕКТА =================
   Правки графика хранятся одним слоем S.admin поверх исходного ГПР объекта
   (в общей базе проекта или в браузере). После каждой правки build() пересчитывает
   весь проект: Гант, структура, готовность, обзор, календарь и вехи читают один граф M. */
const UNITS = ['шт.', 'м', 'п.м.', 'м²', 'м³', 'т', 'кг', '%', 'дн.', 'компл.'];
UI.admin = !!LS.get('adminMode', false);
UI.admSel = new Set(); UI.admQ = ''; UI.admStage = 'all'; UI.admLimit = 200;
const ADM_UNDO = [];
function adminPersist(){ if (Store.db) put('admin', 'overlay', S.admin); else LS.set('admin', S.admin); }
function adminLog(text, u){ S.admin.log.unshift({ at: Date.now(), text, u: u ?? null }); if (S.admin.log.length > 300) S.admin.log.length = 300; }
function adminCommit(mut, text, u, opts = {}){
  ADM_UNDO.push(JSON.stringify(S.admin)); if (ADM_UNDO.length > 30) ADM_UNDO.shift();
  mut(S.admin);
  adminLog(text, u);
  adminPersist();
  const sc = document.getElementById('gt-scroll');
  if (sc) G.keepScroll = { l: sc.scrollLeft, t: sc.scrollTop };
  const y = window.scrollY;
  build(); render();
  if (!sc) window.scrollTo(0, y);
  if (!opts.silent) toast(`<b>${esc(text)}</b><br>Проект пересчитан: готовность ${fpct(M.root.pc, 1)}, прогноз окончания ${fd(M.root.ff)}.`, [['Отменить', 'adm-undo:']]);
}
function adminUndo(){
  if (!ADM_UNDO.length) return toast('Отменять нечего.');
  S.admin = normAdmin(JSON.parse(ADM_UNDO.pop()));
  adminLog('Отмена последней правки'); adminPersist(); build(); render(); toast('Последняя правка отменена.');
}
const admEdit = u => S.admin.edits[u] || (S.admin.edits[u] = {});
function srcRow(u){ return MPP_ROWS.find(r => r[0] === u) || null; }
function admName(u){ const e = S.admin.edits[u] || {}, a = S.admin.added.find(x => x.u === u), r = srcRow(u); return e.name ?? (a ? a.name : r ? r[3] : String(u)); }
function editableNode(n){ return n && n.u !== -1 && (srcRow(n.u) || n.added); }
function stageOptions(sel, exclude){
  // разделы и этапы: сводные строки (и корень ГПР), кроме самой работы и её вложенных
  const bad = new Set(); if (exclude != null && M.nodes.has(exclude)) { bad.add(exclude); (M.nodes.get(exclude).leafs || []).forEach(l => bad.add(l)); (function w(u){ const n = M.nodes.get(u); if (!n) return; n.kids.forEach(k => { bad.add(k); w(k); }); })(exclude); }
  return M.order.map(u => M.nodes.get(u)).filter(n => (n.sm || n.u === CFG.gpRoot) && n.u !== -1 && !bad.has(n.u) && (srcRow(n.u) || n.added))
    .map(n => `<option value="${n.u}" ${n.u === sel ? 'selected' : ''}>${'  '.repeat(Math.max(0, n.lvl - 1))}${esc(n.name.slice(0, 90))}</option>`).join('');
}
function unitField(val){
  const custom = val && !UNITS.includes(val);
  return `<div class="fld"><label for="a-uom">Единица измерения</label><select id="a-uom"><option value="">—</option>${UNITS.map(x => `<option ${x === val ? 'selected' : ''}>${x}</option>`).join('')}<option value="__own" ${custom ? 'selected' : ''}>Своя…</option></select>
    <input id="a-uom-own" type="text" placeholder="Например: захв." value="${custom ? esc(val) : ''}" ${custom ? '' : 'hidden'} style="margin-top:6px"></div>`;
}
const numOrNull = v => { const x = parseFloat(String(v ?? '').replace(',', '.').trim()); return Number.isFinite(x) ? x : null; };
function openAdminEditor(u, parentDefault){
  const isNew = u == null;
  const n = isNew ? null : M.nodes.get(u);
  if (!isNew && !editableNode(n)) return toast('Эта строка рассчитывается автоматически и не редактируется.');
  const today = iso(Math.max(M.T, M.FILE));
  const v = isNew ? { name: '', parent: parentDefault ?? CFG.gpRoot, s: today, f: iso(Math.max(M.T, M.FILE) + 13), as: '', af: '', du: 10, uom: '', qP: null, qF: null, cnt: null, pc: 0, status: 'auto' }
    : { name: n.name, parent: n.parent, s: n.s0 != null ? iso(n.s0) : '', f: n.f0 != null ? iso(n.f0) : '', as: n.as0 != null ? iso(n.as0) : '', af: n.af0 != null ? iso(n.af0) : '', du: n.du, uom: n.uom || '', qP: n.qP, qF: n.qF, cnt: n.cnt, pc: Math.round(n.pc * 10) / 10, status: (n.adm && n.adm.status) || 'auto' };
  const sm = n && n.sm;
  modal(isNew ? 'Добавить работу' : 'Редактировать работу', `
    <div class="adm-form">
      ${!isNew ? `<div class="faint" style="font-size:12px">${esc(n.code)} · ID в ГПР ${n.mid ?? '—'}${n.adm ? ' · есть правки' : ''}${sm ? ' · сводная строка: сроки и % считаются по вложенным работам' : ''}</div>` : ''}
      <div class="fld"><label for="a-name">Название работы</label><input id="a-name" type="text" value="${esc(v.name)}" required></div>
      <div class="fld"><label for="a-par">Раздел / этап</label><select id="a-par">${stageOptions(v.parent, isNew ? null : u)}</select></div>
      ${sm ? '' : `<div class="row-f adm-3">
        <div class="fld"><label for="a-s">Дата начала</label><input id="a-s" type="date" value="${v.s}"></div>
        <div class="fld"><label for="a-f">Дата окончания</label><input id="a-f" type="date" value="${v.f}"></div>
        <div class="fld"><label for="a-du">Плановый срок, раб. дн.</label><input id="a-du" type="number" min="0" step="1" value="${v.du ?? ''}"></div></div>
      <div class="row-f">
        <div class="fld"><label for="a-as">Факт. начало</label><input id="a-as" type="date" value="${v.as}"></div>
        <div class="fld"><label for="a-af">Факт. окончание</label><input id="a-af" type="date" value="${v.af}"></div></div>
      <div class="row-f adm-3">
        ${unitField(v.uom)}
        <div class="fld"><label for="a-qp">Плановый объём</label><input id="a-qp" type="number" min="0" step="any" value="${v.qP ?? ''}" placeholder="—"></div>
        <div class="fld"><label for="a-qf">Фактический объём</label><input id="a-qf" type="number" min="0" step="any" value="${v.qF ?? ''}" placeholder="—"></div></div>
      <div class="row-f adm-3">
        <div class="fld"><label for="a-cnt">Количество</label><input id="a-cnt" type="number" min="0" step="any" value="${v.cnt ?? ''}" placeholder="—"></div>
        <div class="fld"><label for="a-pc">% выполнения</label><input id="a-pc" type="number" min="0" max="100" step="0.1" value="${v.pc}"><span class="hint" id="a-pc-h"></span></div>
        <div class="fld"><label for="a-st">Статус</label><select id="a-st">${[['auto', 'По данным'], ['future', 'Не начата'], ['active', 'В работе'], ['done', 'Выполнена']].map(([k, t]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>`}
      <div class="adm-actions">
        ${isNew ? '' : `<button class="btn sm" type="button" data-act="adm-hide" data-u="${u}">Скрыть</button><button class="btn sm danger" type="button" data-act="adm-del" data-u="${u}">Удалить</button>${n.adm ? `<button class="btn sm" type="button" data-act="adm-reset-one" data-u="${u}">Вернуть исходные значения</button>` : ''}`}
        <span style="flex:1"></span>
        <button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="a-save">${isNew ? 'Добавить' : 'Сохранить'}</button>
      </div>
    </div>`);
  const $ = id => document.getElementById(id);
  const uom = $('a-uom');
  if (uom) uom.addEventListener('change', () => { $('a-uom-own').hidden = uom.value !== '__own'; });
  const sync = () => { const qp = numOrNull($('a-qp')?.value), qf = numOrNull($('a-qf')?.value), h = $('a-pc-h'); if (!h) return; if (qp > 0 && qf != null){ $('a-pc').value = Math.round(qf / qp * 1000) / 10; h.textContent = 'рассчитан по объёмам'; } else h.textContent = ''; };
  ['a-qp', 'a-qf'].forEach(id => $(id) && $(id).addEventListener('input', sync)); sync();
  if ($('a-du')){
    $('a-du').addEventListener('input', () => { const du = numOrNull($('a-du').value); if ($('a-s').value && du > 0) $('a-f').value = addWorkDays($('a-s').value, du); });
    ['a-s', 'a-f'].forEach(id => $(id).addEventListener('change', () => { if ($('a-s').value && $('a-f').value) $('a-du').value = workDays($('a-s').value, $('a-f').value); }));
  }
  if ($('a-st')) $('a-st').addEventListener('change', () => { const st = $('a-st').value; if (st === 'done') $('a-pc').value = 100; if (st === 'future') $('a-pc').value = 0; });
  $('a-save').onclick = () => {
    const name = $('a-name').value.trim(); if (!name) return toast('Укажите название работы.');
    const parent = +$('a-par').value;
    const patch = {}; const ch = [];
    if (isNew || name !== n.name){ patch.name = name; ch.push('название'); }
    if (!sm){
      const s0 = $('a-s').value || null, f0 = $('a-f').value || null;
      if (!s0 || !f0) return toast('Укажите даты начала и окончания.');
      if (f0 < s0) return toast('Дата окончания раньше даты начала.');
      const as_ = $('a-as').value || null, af_ = $('a-af').value || null;
      if (af_ && as_ && af_ < as_) return toast('Факт. окончание раньше факт. начала.');
      const du = numOrNull($('a-du').value) ?? workDays(s0, f0);
      if (isNew || s0 !== v.s) { patch.s = s0; ch.push('начало'); }
      if (isNew || f0 !== v.f) { patch.f = f0; ch.push('окончание'); }
      if (isNew || du !== v.du) { patch.du = du; ch.push('плановый срок'); }
      if ((as_ || '') !== v.as) { patch.as = as_; ch.push('факт. начало'); }
      if ((af_ || '') !== v.af) { patch.af = af_; ch.push('факт. окончание'); }
      const uo = uom.value === '__own' ? $('a-uom-own').value.trim() || null : uom.value || null;
      if ((uo || '') !== (v.uom || '')) { patch.uom = uo; ch.push('единица'); }
      [['qP', 'a-qp', 'плановый объём'], ['qF', 'a-qf', 'фактический объём'], ['cnt', 'a-cnt', 'количество']].forEach(([k, id, t]) => { const x = numOrNull($(id).value); if (x !== (v[k] ?? null)) { patch[k] = x; ch.push(t); } });
      const st = $('a-st').value; if (st !== v.status) { patch.status = st === 'auto' ? undefined : st; ch.push('статус'); }
      let pc = numOrNull($('a-pc').value); if (pc != null) pc = clamp(pc, 0, 100);
      if (pc != null && Math.abs(pc - v.pc) >= 0.05) { patch.pcSet = pc; patch.pcDate = iso(Math.max(M.T, M.FILE)); patch.pcAt = Date.now(); patch.pcNote = 'Администрирование: ' + fp(pc, 1) + ' %'; ch.push('% выполнения'); }
    }
    const moved = !isNew && parent !== n.parent;
    const apply = () => adminCommit(A => {
      if (isNew){
        const uNew = Math.max(ADMIN_UID0, ...A.added.map(x => x.u)) + 1;
        A.added.push({ u: uNew, parent, name, s: patch.s, f: patch.f, du: patch.du, at: Date.now() });
        const e = { ...patch }; delete e.name; delete e.s; delete e.f; delete e.du; if (Object.keys(e).length) A.edits[uNew] = e;
        G.exp.add(parent); ancestors(parent).forEach(a => G.exp.add(a.u));
      } else {
        const e = A.edits[u] = { ...(A.edits[u] || {}), ...patch };
        Object.keys(e).forEach(k => e[k] === undefined && delete e[k]);
        if (moved){ e.fromParent = n.parent; e.parent = parent; }
      }
    }, isNew ? 'Добавлена работа «' + name + '»' : moved ? 'Работа «' + name + '» перенесена в этап «' + M.nodes.get(parent).name + '»' : 'Изменено: ' + (ch.join(', ') || 'без изменений') + ' — «' + name + '»', u);
    if (!isNew && !moved && !ch.length){ closeLayer(); return; }
    closeLayer();
    if (isNew) openConfirm('Добавить работу?', `«${name}» появится в этапе «${M.nodes.get(parent).name}», в Ганте и в расчёте готовности.`, apply, 'Добавить');
    else if (moved) openConfirm('Изменить структуру?', `Работа «${name}» будет перенесена в этап «${M.nodes.get(parent).name}».`, apply, 'Перенести');
    else apply();
  };
  setTimeout(() => $('a-name').focus(), 30);
}
function adminHide(u, del){
  const nm = admName(u);
  openConfirm(del ? 'Удалить работу?' : 'Скрыть работу?', del ? `«${nm}» будет удалена из графика и расчёта. Удаление мягкое: работу можно восстановить в разделе «Скрытые / удалённые работы».` : `«${nm}» останется в данных, но не будет участвовать в отображении и расчёте. Её можно восстановить.`,
    () => adminCommit(A => { const e = A.edits[u] = { ...(A.edits[u] || {}) }; if (del){ e.deleted = true; e.deletedAt = Date.now(); } else { e.hidden = true; e.hiddenAt = Date.now(); } UI.sel = null; }, (del ? 'Удалена' : 'Скрыта') + ' работа «' + nm + '»', u), del ? 'Удалить' : 'Скрыть');
}
function adminRestore(u){
  const nm = admName(u);
  openConfirm('Восстановить работу?', `«${nm}» вернётся в график и в расчёт готовности.`, () => adminCommit(A => { const e = A.edits[u]; if (e){ delete e.hidden; delete e.deleted; delete e.archived; delete e.hiddenAt; delete e.deletedAt; if (!Object.keys(e).length) delete A.edits[u]; } }, 'Восстановлена работа «' + nm + '»', u), 'Восстановить');
}
function adminMove(u, dir){
  const n = M.nodes.get(u); if (!n) return;
  const sib = M.nodes.get(n.parent).kids, i = sib.indexOf(u), j = i + dir;
  if (j < 0 || j >= sib.length) return toast('Работа уже ' + (dir < 0 ? 'первая' : 'последняя') + ' в этапе.');
  const other = M.nodes.get(sib[j]);
  openConfirm('Изменить порядок?', `«${n.name}» будет ${dir < 0 ? 'выше' : 'ниже'} работы «${other.name}».`, () => adminCommit(A => {
    const list = sib.slice(); [list[i], list[j]] = [list[j], list[i]];
    list.forEach((k, idx) => { (A.edits[k] = A.edits[k] || {}).order = idx; });
  }, 'Изменён порядок: «' + n.name + '»', u, { silent: true }), 'Переместить');
}
function hiddenList(){
  return Object.entries(S.admin.edits).filter(([, e]) => e.hidden || e.deleted).map(([u, e]) => {
    u = +u; const r = srcRow(u), a = S.admin.added.find(x => x.u === u);
    const par = e.parent ?? (a ? a.parent : r ? r[2] : null);
    return { u, name: admName(u), kind: e.deleted ? 'Удалена' : e.archived ? 'В архиве' : 'Скрыта', at: e.deletedAt || e.hiddenAt, stage: M.nodes.get(par)?.name || '', s: e.s ?? (a ? a.s : r ? r[4] : null), f: e.f ?? (a ? a.f : r ? r[5] : null) };
  }).sort((a, b) => (b.at || 0) - (a.at || 0));
}
function viewAdmin(){
  // по прямой ссылке режим администрирования не включается сам: нужен явный вход
  if (!UI.admin) return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Администрирование' }], nav: '#/admin', html: `<section class="panel"><div class="pad"><div class="empty-block"><b>Режим администрирования</b><span>Изменение графика, бюджета, договоров и обновление данных проекта доступны в режиме администрирования.</span><button class="btn primary" type="button" data-act="admin">${ico('gear', 16)}Войти в режим администрирования</button></div></div></section>` };
  const A = S.admin, q = UI.admQ.trim().toLowerCase();
  const stages = stageRows();
  const inStage = UI.admStage === 'all' ? null : new Set([+UI.admStage, ...(M.nodes.get(+UI.admStage)?.leafs || []), ...M.order.filter(u => ancestors(u).some(a => a.u === +UI.admStage))]);
  const list = M.order.map(u => M.nodes.get(u)).filter(n => editableNode(n) && (!inStage || inStage.has(n.u)) && (!q || n.name.toLowerCase().includes(q) || String(n.mid) === q || n.code.toLowerCase().includes(q)));
  const shown = list.slice(0, UI.admLimit);
  const hid = hiddenList();
  const nEd = Object.values(A.edits).filter(e => Object.keys(e).some(k => !['hidden', 'deleted', 'hiddenAt', 'deletedAt', 'order', 'fromParent'].includes(k))).length;
  const qty = (v, un) => v == null ? '—' : fp(v, Number.isInteger(v) ? 0 : 1) + (un ? ' ' + esc(un) : '');
  const rows = shown.map(n => `<tr class="${n.adm ? 'adm-edited' : ''}">
    <td class="l"><input type="checkbox" data-act="adm-sel" data-u="${n.u}" ${UI.admSel.has(n.u) ? 'checked' : ''} aria-label="Выбрать"></td>
    <td class="l wrap" style="padding-left:${10 + Math.max(0, n.lvl - 1) * 14}px"><button class="adm-link" type="button" data-act="adm-edit" data-u="${n.u}" style="font-weight:${n.sm ? 650 : 500}">${esc(n.name)}</button><div class="faint" style="font-size:11.5px">${esc(n.code)}${n.mid != null ? ' · ID ' + n.mid : ''}${n.added ? ' · добавлена' : ''}${n.adm ? ' · изменена' : ''}</div></td>
    <td>${fds(n.s0)}</td><td>${fds(n.f0)}</td><td>${n.sm ? '' : (n.du ?? '—')}</td>
    <td class="l">${n.sm ? '' : esc(n.uom || '—')}</td><td>${n.sm ? '' : qty(n.qP)}</td><td>${n.sm ? '' : qty(n.qF)}</td><td>${n.sm ? '' : qty(n.cnt)}</td>
    <td><b>${pctTxt(n.pc)}</b></td><td class="l">${chip(n.st.t, n.st.c)}</td>
    <td class="l adm-row-act"><div class="adm-acts"><button class="icon-btn sm" type="button" data-act="adm-edit" data-u="${n.u}" title="Редактировать" aria-label="Редактировать">${ico('pen')}</button><button class="icon-btn sm" type="button" data-act="adm-up" data-u="${n.u}" title="Выше" aria-label="Выше">${ico('up')}</button><button class="icon-btn sm" type="button" data-act="adm-down" data-u="${n.u}" title="Ниже" aria-label="Ниже">${ico('down')}</button>${n.sm ? `<button class="icon-btn sm" type="button" data-act="adm-add" data-u="${n.u}" title="Добавить работу в этот этап" aria-label="Добавить работу в этап">${ico('plus')}</button>` : ''}<button class="icon-btn sm" type="button" data-act="adm-hide" data-u="${n.u}" title="Скрыть" aria-label="Скрыть">${ico('eyeoff')}</button><button class="icon-btn sm" type="button" data-act="adm-del" data-u="${n.u}" title="Удалить" aria-label="Удалить">${ico('trash')}</button></div></td></tr>`).join('');
  const html = `
  <div class="head"><div class="ttl"><div class="eyebrow">Режим администрирования</div><h1 style="margin-top:6px">Администрирование проекта</h1>
    <div class="meta"><span>Правки графика ${esc(PROJECT.name)} поверх исходного ГПР от ${fd(M.FILE)}</span><span>${Store.db ? 'хранятся в общей базе проекта' : 'хранятся в этом браузере'}</span></div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap"><button class="btn primary" type="button" data-go="#/admin/update">${ico('up')}Обновление данных</button><button class="btn" type="button" data-go="#/budget">${ico('card')}Бюджет и договоры</button><button class="btn" type="button" data-act="adm-undo" ${ADM_UNDO.length ? '' : 'disabled'}>Отменить последнее</button><button class="btn" type="button" data-act="adm-add">${ico('plus')}Добавить работу</button></div></div>
  <div class="tiles">
    <div class="tile"><div class="eyebrow">Работ в графике</div><div class="v">${M.leaves.filter(u => u > 0).length}</div><div class="s">${M.order.length - 1} строк структуры</div></div>
    <div class="tile"><div class="eyebrow">Изменено</div><div class="v">${nEd}</div><div class="s">работ с правками</div></div>
    <div class="tile"><div class="eyebrow">Добавлено</div><div class="v">${A.added.filter(a => !(A.edits[a.u] || {}).deleted).length}</div><div class="s">новых работ</div></div>
    <div class="tile ${hid.length ? 'warn' : ''}"><div class="eyebrow">Скрыто / удалено</div><div class="v">${hid.filter(h => h.kind !== 'Удалена').length} / ${hid.filter(h => h.kind === 'Удалена').length}</div><div class="s">можно восстановить</div></div>
    <div class="tile"><div class="eyebrow">Готовность проекта</div><div class="v">${fpct(M.root.pc, 1)}</div><div class="s">пересчитывается после каждой правки</div></div>
  </div>
  <section class="panel"><header><h2>Работы графика</h2><span class="sub">нажмите название — откроется карточка редактирования; в Ганте в этом режиме полосы можно перетаскивать</span></header>
    <div class="gt-tools">
      <label class="search">${ico('search')}<input type="search" id="adm-q" placeholder="Поиск по названию, ID или коду" value="${esc(UI.admQ)}" aria-label="Поиск работы"></label>
      <select id="adm-stage" class="adm-select" aria-label="Этап"><option value="all">Все этапы</option>${stages.map(n => `<option value="${n.u}" ${String(n.u) === String(UI.admStage) ? 'selected' : ''}>${esc(n.name.slice(0, 70))}</option>`).join('')}</select>
      <span class="faint" style="font-size:12px">Показано ${shown.length} из ${list.length}</span>
      <span style="flex:1"></span>
      <button class="btn sm" type="button" data-act="adm-mass-shift" ${UI.admSel.size ? '' : 'disabled'}>Сдвинуть сроки выбранных</button>
      <button class="btn sm" type="button" data-act="adm-mass-hide" ${UI.admSel.size ? '' : 'disabled'}>Скрыть выбранные (${UI.admSel.size})</button>
    </div>
    <div class="tbl-wrap"><table class="t adm-t" style="min-width:1180px"><thead><tr><th class="l"></th><th class="l">Работа</th><th>Начало</th><th>Оконч.</th><th>Срок, р.д.</th><th class="l">Ед.</th><th>План. объём</th><th>Факт. объём</th><th>Кол-во</th><th>%</th><th class="l">Статус</th><th class="l">Действия</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="12" class="l"><div class="empty">Ничего не найдено.</div></td></tr>'}</tbody></table></div>
    ${list.length > shown.length ? `<div class="pad" style="padding-top:12px"><button class="btn sm" type="button" data-act="adm-more">Показать ещё ${Math.min(200, list.length - shown.length)}</button></div>` : ''}
  </section>
  <section class="panel"><header><h2>Скрытые, архивные и удалённые работы</h2><span class="sub">остаются в данных; восстановление возвращает работу в график и расчёт</span></header>
    <div class="tbl-wrap"><table class="t" style="min-width:760px"><thead><tr><th class="l">Работа</th><th class="l">Этап</th><th>Начало</th><th>Оконч.</th><th class="l">Состояние</th><th class="l">Когда</th><th></th></tr></thead><tbody>
    ${hid.length ? hid.map(h => `<tr><td class="l wrap">${esc(h.name)}</td><td class="l faint wrap">${esc(h.stage)}</td><td>${h.s ? fds(dn(h.s)) : '—'}</td><td>${h.f ? fds(dn(h.f)) : '—'}</td><td class="l">${chip(h.kind, h.kind === 'Удалена' ? 'crit' : 'neutral')}</td><td class="l faint">${h.at ? new Date(h.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td><td><button class="btn sm" type="button" data-act="adm-restore" data-u="${h.u}">Восстановить</button></td></tr>`).join('') : '<tr><td colspan="7" class="l faint">Скрытых и удалённых работ нет.</td></tr>'}
    </tbody></table></div></section>
  <div class="grid2e">
    <section class="panel"><header><h2>Журнал изменений</h2><span class="sub">${A.log.length} записей</span></header>
      <div class="pad adm-log">${A.log.length ? A.log.slice(0, 40).map(l => `<div><span class="num faint">${new Date(l.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> ${l.u != null && M.nodes.has(l.u) ? `<button class="adm-link" type="button" data-go="${M.nodes.get(l.u).sm ? '#/node/' : '#/work/'}${l.u}">${esc(l.text)}</button>` : esc(l.text)}</div>`).join('') : '<p class="faint" style="font-size:13px">Правок пока не было.</p>'}</div></section>
    <section class="panel"><header><h2>Резервная копия правок</h2></header>
      <div class="pad" style="display:flex; flex-direction:column; gap:10px">
        <p class="faint" style="font-size:13px">Правки хранятся отдельно от исходного ГПР. Файл правок можно сохранить и загрузить на другом устройстве или после очистки браузера.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap"><button class="btn sm" type="button" data-act="adm-export">Сохранить файл правок</button><button class="btn sm" type="button" data-act="adm-import">Загрузить файл правок</button><button class="btn sm danger" type="button" data-act="adm-reset" ${Object.keys(A.edits).length || A.added.length ? '' : 'disabled'}>Сбросить все правки</button></div>
      </div></section>
  </div>`;
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Администрирование' }], html, nav: '#/admin', after: () => {
    const qi = document.getElementById('adm-q'); if (qi) qi.addEventListener('input', () => { UI.admQ = qi.value; UI.admLimit = 200; const pos = qi.selectionStart; render(); const n2 = document.getElementById('adm-q'); if (n2){ n2.focus(); n2.setSelectionRange(pos, pos); } });
    const st = document.getElementById('adm-stage'); if (st) st.addEventListener('change', () => { UI.admStage = st.value; UI.admLimit = 200; render(); });
  } };
}
function adminEnter(){
  if (UI.admin) return go('#/admin');
  openConfirm('Режим администрирования', 'В этом режиме можно менять состав и сроки работ графика. Правки сразу пересчитывают готовность, прогноз и все экраны проекта. Войти?', () => { UI.admin = true; LS.set('adminMode', true); go('#/admin'); render(); }, 'Войти');
}
function adminExit(){ UI.admin = false; LS.set('adminMode', false); UI.sel = null; if (curHash() === '#/admin') go('#/'); else render(); }
function adminMassShift(){
  const ids = [...UI.admSel].filter(u => M.nodes.has(u) && !M.nodes.get(u).sm);
  if (!ids.length) return toast('Выберите работы (не этапы).');
  modal('Сдвинуть сроки', `<div class="fld"><label for="a-shift">Сдвиг, календарных дней (минус — раньше)</label><input id="a-shift" type="number" step="1" value="7"></div><p class="faint" style="font-size:13px">Выбрано работ: ${ids.length}. Начало и окончание сдвигаются на одинаковое число дней.</p><div style="display:flex; gap:8px; justify-content:flex-end"><button class="btn" type="button" data-act="close">Отмена</button><button class="btn primary" type="button" id="a-shift-ok">Продолжить</button></div>`);
  document.getElementById('a-shift-ok').onclick = () => {
    const d = Math.round(numOrNull(document.getElementById('a-shift').value) || 0); if (!d) return toast('Укажите сдвиг.');
    closeLayer();
    openConfirm('Массовое изменение сроков', `Сдвинуть ${ids.length} работ на ${d > 0 ? '+' : ''}${d} дн.?`, () => adminCommit(A => ids.forEach(u => { const n = M.nodes.get(u), e = A.edits[u] = A.edits[u] || {}; e.s = iso(n.s0 + d); e.f = iso(n.f0 + d); }), `Сроки ${ids.length} работ сдвинуты на ${d > 0 ? '+' : ''}${d} дн.`), 'Сдвинуть');
  };
}
function adminMassHide(){
  const ids = [...UI.admSel].filter(u => M.nodes.has(u)); if (!ids.length) return;
  openConfirm('Скрыть выбранные работы?', `Будет скрыто: ${ids.length}. Работы останутся в данных и их можно восстановить.`, () => adminCommit(A => { ids.forEach(u => { const e = A.edits[u] = A.edits[u] || {}; e.hidden = true; e.hiddenAt = Date.now(); }); UI.admSel.clear(); }, `Скрыто работ: ${ids.length}`), 'Скрыть');
}
function adminExport(){
  const blob = new Blob([JSON.stringify({ project: CFG.id, name: PROJECT.name, exported: new Date().toISOString(), admin: S.admin }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dsflow-${CFG.id}-правки-${iso(M.T)}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function adminImport(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!data || data.project !== CFG.id || !data.admin) return toast('Файл правок относится к другому объекту или повреждён.');
      openConfirm('Загрузить правки из файла?', 'Текущие правки будут заменены правками из файла. Текущее состояние можно вернуть кнопкой «Отменить последнее».', () => adminCommit(A => { const x = normAdmin(data.admin); A.edits = x.edits; A.added = x.added; A.log = x.log; }, 'Загружены правки из файла'), 'Загрузить');
    } catch(e){ toast('Не удалось прочитать файл правок.'); }
  };
  inp.click();
}
/* Перетаскивание полос Ганта в режиме администрирования: середина — перенос, края — начало и окончание. */
function bindGanttAdmin(sc){
  let drag = null;
  sc.addEventListener('pointerdown', e => {
    if (!UI.admin) return;
    const b = e.target.closest('[data-drag]'); if (!b) return;
    const r = b.getBoundingClientRect(), x = e.clientX - r.left;
    const mode = x < 8 ? 'l' : x > r.width - 8 ? 'r' : 'm';
    drag = { u: +b.dataset.drag, mode, x0: e.clientX, left: parseFloat(b.style.left), width: parseFloat(b.style.width), el: b, days: 0 };
    b.setPointerCapture(e.pointerId); b.classList.add('dragging'); e.preventDefault();
  });
  sc.addEventListener('pointermove', e => {
    if (!drag) return;
    const days = Math.round((e.clientX - drag.x0) / G.px), px = days * G.px, n = M.nodes.get(drag.u);
    drag.days = days;
    const minW = Math.max(3, G.px);
    if (drag.mode === 'm') drag.el.style.left = drag.left + px + 'px';
    else if (drag.mode === 'l'){ const w = Math.max(minW, drag.width - px); drag.el.style.left = drag.left + drag.width - w + 'px'; drag.el.style.width = w + 'px'; }
    else drag.el.style.width = Math.max(minW, drag.width + px) + 'px';
    const s0 = drag.mode === 'r' ? n.s0 : Math.min(n.s0 + days, drag.mode === 'l' ? n.f0 : Infinity), f0 = drag.mode === 'l' ? n.f0 : Math.max(n.f0 + days, drag.mode === 'r' ? n.s0 : -Infinity);
    drag.el.dataset.tip = fds(s0) + ' — ' + fds(f0);
  });
  const end = () => {
    if (!drag) return;
    const d = drag, n = M.nodes.get(d.u); drag = null; d.el.classList.remove('dragging');
    G.dragged = Date.now();
    if (!d.days){ drawGantt(); return; }
    let s0 = n.s0, f0 = n.f0;
    if (d.mode === 'm'){ s0 += d.days; f0 += d.days; } else if (d.mode === 'l') s0 = Math.min(n.f0, n.s0 + d.days); else f0 = Math.max(n.s0, n.f0 + d.days);
    adminCommit(A => { const e = A.edits[d.u] = A.edits[d.u] || {}; e.s = iso(s0); e.f = iso(f0); e.du = workDays(iso(s0), iso(f0)); }, `Гант: «${n.name}» ${fds(s0)} — ${fds(f0)}`, d.u);
  };
  sc.addEventListener('pointerup', end); sc.addEventListener('pointercancel', end);
}

/* Пока открыто окно, мобильное меню или просмотр фото, страница под ним неактивна:
   не прокручивается и не принимает нажатий (важно для iOS). */
const BgLock = {
  on: false, y: 0,
  targets(){ return ['.main', '.sidebar', '#botnav', '.dsf-shellbar', '#qc-layer'].map(q => document.querySelector(q)).filter(Boolean); },
  set(v){
    if (v === this.on) return; this.on = v;
    const b = document.body, st = b.style;
    if (v){
      this.y = window.scrollY;
      st.position = 'fixed'; st.top = -this.y + 'px'; st.left = '0'; st.right = '0'; st.width = '100%';
      this.targets().forEach(el => { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); });
      document.documentElement.classList.add('dsf-locked');
    } else {
      st.position = ''; st.top = ''; st.left = ''; st.right = ''; st.width = '';
      this.targets().forEach(el => { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); });
      document.documentElement.classList.remove('dsf-locked');
      window.scrollTo(0, this.y);
    }
  },
  watch(){
    const layers = () => ['layer', 'ogni-ai-layer'].map(id => document.getElementById(id)).filter(Boolean);
    const check = () => this.set(layers().some(l => l.children.length > 0));
    const mo = new MutationObserver(check);
    const attach = () => layers().forEach(l => { if (!l.dataset.watched){ l.dataset.watched = '1'; mo.observe(l, { childList: true }); } });
    attach(); setTimeout(attach, 0); setTimeout(attach, 1500);
  }
};
BgLock.watch();
/* API для страницы объекта: навигация и состояние расчёта. */
window.DSFEngine = { go: h => go(h), get model(){ return M; }, render: () => render(), toast: (h, a) => toast(h, a), closeLayer: () => closeLayer(), modal: (t, b) => modal(t, b),
  /* выгрузка расчётной модели объекта для единого интерфейса Flow (public/flow/bridge.js). Только существующие данные:
     процедурные демо-кадры фотохроники не передаются. */
  legacy: () => ({ PROJECT, CFG, M, stages: stageUids(M.nodes), stage: currentStage(), shortName, iso,
    photos: [...PHOTOS_REAL, ...S.photos].map(p => ({ id: p.id, date: p.date, work: p.work, zone: p.zone || '', caption: p.caption || '', src: p.src })),
    register: S.upd.risks.filter(r => !r.archived), events: S.upd.events.filter(e => !e.archived), autoModel: !PROGRESS_MODEL, checks: M.model.checks }),
  registerPanel: () => registerPanel(), eventsPanel: n => eventsPanel(n) };
/* ================= СТАРТ ================= */
(function init(){
  if (HEADLESS){
    build();
    window.DSFEngine.ready = initCaps().then(loadLocalPhotos, loadLocalPhotos).then(() => { build(); return true; }, () => { build(); return true; });
    return;
  }
  const foot = document.querySelector('.sidebar .sb-foot');
  if (foot && !foot.querySelector('.sb-admin')) foot.insertAdjacentHTML('beforeend', `<button class="sb-admin" type="button" data-act="admin" title="Администрирование" aria-label="Администрирование">${ico('gear', 15)}</button>`);
  const th = Theme.get(); if (th) document.documentElement.setAttribute('data-theme', th);
  build();
  try { memHash = location.hash || '#/'; } catch(e){}
  render();
  initCaps().then(loadLocalPhotos, loadLocalPhotos);
  // заставка при запуске с домашнего экрана: не дольше ~0,45 с после старта, затем плавно исчезает
  const sp = document.getElementById('splash');
  if (sp){
    if (document.documentElement.classList.contains('standalone')){
      setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 400); }, Math.max(0, 450 - (performance.now ? performance.now() : 0)));
    } else sp.remove();
  }
  let rw = window.innerWidth;
  window.addEventListener('resize', () => { if ((rw < 768) !== (window.innerWidth < 768)){ rw = window.innerWidth; render(); } });
})();
