/* БЦ «Огни» в общем движке DSFlow.
   Данные объекта: ГПР из MS Project (ogni-gpr.js, сохранён 30.06.2026) и суточные сводки площадки
   (ogni-daily.js, 45 сводок по 29.09.2026 + подтверждённые локальные добавления).
   Интерфейс и расчёты — те же, что у всех объектов (dsflow-engine.js). Здесь только данные
   и подключение специализированного раздела «Данные и отчёты» (ogni/report.html). */
/* global MPP_ROWS, DATA */

const OGNI_ROWS = DATA.rows;
const OGNI_LAST = OGNI_ROWS[OGNI_ROWS.length - 1];

/* Привязка показателей суточной сводки площадки к строкам ГПР (uid строки ГПР = ID строки MS Project + 1).
   Это данные объекта, а не архитектура DSFlow: таблица описывает исторический формат суточного отчёта
   текущего этапа. Новые работы, вехи и их факт вносятся через «Обновление данных» (форма или Excel)
   без изменения кода; строки, которых нет в этой таблице, работают по общим правилам движка. */
const OGNI_DAILY = {
  stage: 51,   // этап ГПР, к которому относятся показатели сводки без собственной строки в ГПР
  bound: [
    { uid: 62, title: 'Форшахта', metric: 'fs_pm', total: 'fs_pm', unit: 'п.м.', volUnit: 'п.м.', pc: { metric: 'fs_pct', total: 100 }, events: ['Форшахта'], doneText: 'Выполнено по сводке' },
    { uid: 63, title: 'Стена в грунте', metric: 'dw_zah', planMetric: 'plan_zah', total: 'dw_zah', unit: 'захваток', volUnit: 'захв.', events: ['СВГ'], chart: 'dw', analytics: 'dw', rateMul: 1, etaKey: 'eta' },
    { uid: 67, title: 'Буронабивные сваи', metric: 'bns_rep', planMetric: 'plan_bns_total', total: 'bns_total', unit: 'свай', volUnit: 'шт.', events: ['БНС', 'Обеспечение'], chart: 'bns', analytics: 'bns', rateMul: 7, etaKey: 'eta_plan' },
    { uid: 64, title: 'Обвязочная балка', metric: 'beam_m3', total: null, unit: 'м³', events: ['Обвязочная балка'] },
    { uid: 66, title: 'Испытания свай', tests: true, unit: 'испытаний', events: ['Испытания'] }
  ],
  // показатели сводки без однозначной строки ГПР: показываются на этапе, на готовность не влияют
  unbound: [
    { title: 'Укрепление откоса', metric: 'slope', total: 'slope_m2', unit: 'м²' },
    { title: 'Газовая труба', target: 'gas_done', total: 'gas_pm', unit: 'п.м.' },
    { title: 'Вывоз грунта', metric: 'soil_pct', totalValue: 100, unit: '%' },
    { title: 'Демонтаж форшахты', metric: 'dis_pm', totalValue: 262, unit: 'п.м.' },   // 262 п.м. по внутренней стороне — из текста сводки
    { title: 'Рабочая сила', sum: ['itr_d', 'itr_n', 'wrk_d', 'wrk_n'], unit: 'чел.' }
  ]
};
const ogniTotal = b => b.totalValue != null ? b.totalValue : b.total ? DATA.targets[b.total] ?? null : null;
/* Подтверждённый факт площадки, который однозначно соответствует строкам ГПР (с общим объёмом).
   Остальные строки ГПР несут процент выполнения из MS Project на 30.06.2026. */
const OGNI_FACT_LINKS = OGNI_DAILY.bound.filter(b => b.metric && ogniTotal(b)).map(b => ({
  uid: b.uid, key: b.pc ? b.pc.metric : b.metric, total: b.pc ? b.pc.total : ogniTotal(b), label: b.title,
  text: r => `${fmtN(r[b.metric])} из ${fmtN(ogniTotal(b))} ${b.unit}${b.pc ? ', ' + fmtN(r[b.pc.metric]) + ' %' : ''}`
}));
function ogniLast(key){ for (let i = OGNI_ROWS.length - 1; i >= 0; i--) if (OGNI_ROWS[i][key] != null) return Number(OGNI_ROWS[i][key]); return null; }
function fmtN(v){ return v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }

function ogniBaseRecords(){
  const out = [];
  OGNI_FACT_LINKS.forEach(link => {
    let prev = 0;
    OGNI_ROWS.forEach(r => {
      const v = r[link.key];
      if (v == null || !Number.isFinite(Number(v))) return;
      const pc = Math.max(0, Math.min(100, Number(v) / link.total * 100));
      const delta = pc - prev;
      if (Math.abs(delta) < 1e-9) return;
      out.push({ id: 'src-' + link.uid + '-' + r.d, uid: link.uid, date: r.d, delta, author: 'Суточная сводка', note: link.text(r), source: 'Суточная сводка площадки', at: 0 });
      prev = pc;
    });
  });
  return out;
}

/* Рабочая сила по неделям: ИТР и рабочие обеих смен на последнюю сводку недели. */
function ogniWorkforce(){
  const byWeek = new Map();
  OGNI_ROWS.forEach(r => {
    const d = new Date(r.d + 'T00:00:00Z'); const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    const total = ['itr_d', 'itr_n', 'wrk_d', 'wrk_n'].reduce((a, k) => a + (Number(r[k]) || 0), 0);
    byWeek.set(monday, total);
  });
  const weeks = [...byWeek.keys()].sort().slice(-9);
  return { weeks, fact: weeks.map(w => byWeek.get(w)), plan: weeks.map(() => null) };
}
const OGNI_WF = ogniWorkforce();

const PROJECT = {
  name: 'БЦ «Огни»',
  statusDate: OGNI_LAST.d,      // дата последней суточной сводки
  fileDate: '2026-06-30',       // дата сохранения ГПР (процент выполнения в файле — на эту дату)
  start: '2025-03-03',
  planEnd: '2029-04-13',        // «ЗОС, РВ» — окончание по ГПР
  gcName: null,
  budgetTotal: null,
  engine: {
    id: 'ogni', storagePrefix: 'ogni.', gpRoot: 1,
    icon: '../assets/projects/ogni-icon.png', planEndLabel: 'ЗОС, РВ',
    stampNote: 'оперативный срез площадки',
    objectType: 'Бизнес-центр', ganttSource: 'ГПР из MS Project, сохранён 30.06.2026',
    workforceGo: '#/data/production', photoDb: 'dsflow-ogni-photos', risksGo: '#/data/risks',
    budgetNote: 'Бюджет, договоры и финансовое закрытие по БЦ «Огни» не переданы. Значения появятся после загрузки подтверждённых данных; суммы из графика производства работ бюджетом не считаются.',
    navData: [['#/data/production', 'Производство', 'trend'], ['#/data/journal', 'Журнал', 'doc'], ['#/data/risks', 'Риски', 'alert'], ['#/data/timeline', 'Хронология', 'events'], ['#/data/report', 'Отчёт', 'chart']],
    baseRecords: ogniBaseRecords(),
    // Объёмы из суточных сводок для работ с однозначной строкой ГПР (у остальных работ объёмов в источнике нет — «—»)
    volumes: Object.fromEntries(OGNI_DAILY.bound.filter(b => b.volUnit && ogniTotal(b)).map(b => [b.uid, { unit: b.volUnit, plan: ogniTotal(b), fact: ogniLast(b.metric) }])),
    hooks: {}
  }
};

const EXTRA_NODES = [{ u: -1, name: 'БЦ «Огни»', parent: null, summary: true }];
const TOP_WEIGHTS = {};
const CONTRACTS = [];
const WEEKS = OGNI_WF.weeks;
const WORKFORCE = { fact: OGNI_WF.fact, plan: OGNI_WF.plan };
const PRESCRIPTIONS = { issued: WEEKS.map(() => null), fixed: WEEKS.map(() => null), open: WEEKS.map(() => null) };
/* Вехи: четыре события с признаком «веха» в MS Project и окончания ключевых этапов ГПР. */
const MILESTONES = [
  { name: 'Начало работ по ГПР', ref: 1, ev: 'start', key: true },
  { name: 'Разрешение на строительство', ref: 29, ev: 'finish' },
  { name: 'Стена в грунте', ref: 63, ev: 'finish', key: true },
  { name: 'Буронабивные сваи', ref: 67, ev: 'finish', key: true },
  { name: 'РнС (по соглашению МПТ)', ref: 1487, ev: 'finish', key: true },
  { name: 'Разработка грунта завершена', ref: 79, ev: 'finish', key: true },
  { name: 'Подготовка под фундаментную плиту завершена', ref: 91, ev: 'finish' },
  { name: 'Фундаментные плиты', ref: 92, ev: 'finish', key: true },
  { name: 'Ж/б конструкции подземной части', ref: 94, ev: 'finish' },
  { name: 'Ж/б конструкции надземной части', ref: 109, ev: 'finish', key: true },
  { name: 'Кровля', ref: 464, ev: 'finish' },
  { name: 'Фасады', ref: 342, ev: 'finish' },
  { name: 'Наружные сети', ref: 1477, ev: 'finish' },
  { name: 'Благоустройство', ref: 1459, ev: 'finish' },
  { name: 'РнВ (по соглашению МПТ)', ref: 1488, ev: 'finish', key: true },
  { name: 'ЗОС, РВ', ref: 1484, ev: 'finish', key: true }
];
const PHOTO_DATES = [];
const PHOTO_SHOTS = [];
const PHOTOS_REAL = [];
const PROGRESS_MODEL = null;   // согласованной модели весов нет — движок применяет веса по длительности ГПР

/* ================= Раздел «Данные и отчёты»: суточный отчёт площадки =================
   Исходное приложение ежедневного отчёта (report.html) показывается внутри оболочки
   одним экземпляром: фильтры, период и выбранные графики сохраняются между переходами. */
const OGNI_DATA_VIEWS = { production: 'Производство', journal: 'Журнал', risks: 'Риски', timeline: 'Хронология', report: 'Отчёт' };
const OgniFrame = {
  host: null, frame: null, ready: false, pending: null,
  ensure(){
    if (this.frame) return this.frame;
    const host = document.createElement('section');
    host.className = 'dsf-frame-host'; host.hidden = true; host.setAttribute('aria-label', 'Данные и отчёты');
    const f = document.createElement('iframe');
    f.src = 'report.html#production'; f.title = 'Суточный отчёт БЦ «Огни»'; f.setAttribute('scrolling', 'no');
    host.appendChild(f);
    document.getElementById('view').after(host);
    f.addEventListener('load', () => this.onLoad());
    this.host = host; this.frame = f;
    return f;
  },
  win(){ try { return this.frame && this.frame.contentWindow; } catch(e){ return null; } },
  onLoad(){
    const w = this.win(); if (!w) return;
    this.syncTheme();
    try {
      const RO = w.ResizeObserver || window.ResizeObserver;
      // следим за содержимым (body), а не за документом: высота документа не меньше высоты iframe и не уменьшается
      new RO(() => this.fit()).observe(w.document.body);
    } catch(e){}
    this.fit();
  },
  fit(){
    const w = this.win(); if (!w || !w.document || !w.document.documentElement) return;
    // Высота по содержимому текущего экрана отчёта: после длинного «Журнала» короткий раздел не оставляет пустоту внизу.
    const body = w.document.body; if (!body) return;
    const h = Math.ceil(body.getBoundingClientRect().height);
    if (h && Math.abs(this.frame.offsetHeight - h) > 1) this.frame.style.height = h + 'px';
  },
  syncTheme(){
    const w = this.win(); if (!w || !w.document) return;
    const th = document.documentElement.getAttribute('data-theme');
    if (th) w.document.documentElement.setAttribute('data-theme', th);
  },
  show(view, chart){
    this.ensure();
    this.host.hidden = false;
    const w = this.win();
    if (this.ready && w && w.DSF_OGNI) { w.DSF_OGNI.show(view, chart); this.fit(); requestAnimationFrame(() => this.fit()); setTimeout(() => this.fit(), 300); }
    else this.pending = [view, chart];
  },
  hide(){ if (this.host) this.host.hidden = true; },
  analytics(){ const w = this.win(); try { return this.ready && w && w.DSF_OGNI ? w.DSF_OGNI.analytics() : null; } catch(e){ return null; } }
};
window.addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
  if (e.data.dsf === 'ogni-ready'){
    OgniFrame.ready = true; OgniFrame.onLoad();
    if (OgniFrame.pending){ const [v, c] = OgniFrame.pending; OgniFrame.pending = null; OgniFrame.show(v, c); }
    // карточки работ используют расчёты суточного отчёта — перерисовать, если они на экране
    if (/^#\/(work|node)\//.test(location.hash) && window.DSFEngine) window.DSFEngine.render();
  }
  if (e.data.dsf === 'ogni-nav' && OGNI_DATA_VIEWS[e.data.view] && window.DSFEngine) window.DSFEngine.go('#/data/' + e.data.view);
});
new MutationObserver(() => OgniFrame.syncTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

PROJECT.engine.hooks.route = p => {
  if (p[0] !== 'data') return null;
  const view = OGNI_DATA_VIEWS[p[1]] ? p[1] : 'production';
  // реестр рисков и ключевые события проекта (общие для всех объектов) — над соответствующим разделом суточного отчёта
  const E = window.DSFEngine, extra = !E ? '' : view === 'risks' ? E.registerPanel() : view === 'timeline' ? E.eventsPanel() : '';
  return { crumbs: [{ t: PROJECT.name, go: '#/' }, { t: 'Данные и отчёты', mid: true }, { t: OGNI_DATA_VIEWS[view] }], html: extra, nav: '#/data/' + view, frame: { view, chart: p[2] || null } };
};
PROJECT.engine.hooks.afterRender = v => {
  const sb = document.getElementById('sb-date'); if (sb) sb.textContent = fd(M.T);
  if (v.frame) OgniFrame.show(v.frame.view, v.frame.chart);
  else {
    OgniFrame.hide();
    // экземпляр отчёта готовится заранее: расчёты для карточек работ и мгновенный переход в раздел
    if (!OgniFrame.frame) setTimeout(() => OgniFrame.ensure(), 400);
  }
};
PROJECT.engine.hooks.dataHub = () => {
  window.DSFEngine.modal('Внести данные ИИ', DSFlowProject.dataHub({
    manualAction: 'data-ogni-ai-manual', aiAction: 'data-ogni-ai-open',
    manualText: 'Вручную: показатели суточной сводки на дату.',
    aiText: 'Суточные сводки и документы — ИИ предложит показатели для подтверждения.'
  }));
};

/* ================= Оперативный факт на уровне работы =================
   Карточки строятся по таблице OGNI_DAILY.bound: у работы без привязки к сводке блока нет. */
const OGNI_WORK_SPECS = Object.fromEntries(OGNI_DAILY.bound.map(b => [b.uid, {
  title: b.title, key: b.tests ? null : b.metric, planKey: b.planMetric || null, target: () => ogniTotal(b), unit: b.unit, events: b.events, chart: b.chart || null,
  doneText: b.doneText, tests: !!b.tests,
  rate: b.analytics ? a => a && a[b.analytics] ? a[b.analytics].r7 * (b.rateMul || 1) : null : null,
  eta: b.analytics ? a => a && a[b.analytics] ? a[b.analytics][b.etaKey] : null : null,
  plan: b.analytics ? a => a && a[b.analytics] ? a[b.analytics].plan : null : null
}]));
const ogniDate = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '—';
PROJECT.engine.hooks.workExtra = n => {
  const spec = OGNI_WORK_SPECS[n.u]; if (!spec) return '';
  const a = OgniFrame.analytics();
  const rows = spec.key ? OGNI_ROWS.filter(r => r[spec.key] != null) : [];
  const last = rows[rows.length - 1];
  const fact = spec.tests ? (DATA.tests || []).length : last ? Number(last[spec.key]) : null;
  const target = spec.target ? spec.target() : null;
  const planV = spec.plan ? spec.plan(a) : (spec.planKey && last ? last[spec.planKey] : null);
  const pct = fact != null && target ? fact / target * 100 : null;
  const dev = fact != null && planV != null ? fact - planV : null;
  const rate = spec.rate ? spec.rate(a) : null;
  const eta = spec.eta ? spec.eta(a) : null;
  const u = spec.unit;
  const tiles = `<div class="tiles">
    <div class="tile"><div class="eyebrow">Плановый объём</div><div class="v">${target ? fmtN(target) : '—'} <small>${target ? esc(u) : ''}</small></div><div class="s">по суточной сводке</div></div>
    <div class="tile"><div class="eyebrow">Факт</div><div class="v">${fmtN(fact)} <small>${fact != null ? esc(u) : ''}</small></div><div class="s">сводка ${ogniDate(spec.tests ? OGNI_LAST.d : last && last.d)}</div></div>
    <div class="tile"><div class="eyebrow">Выполнение</div><div class="v">${pct == null ? '—' : fp(pct, 1) + ' <small>%</small>'}</div><div class="s">${target ? 'от планового объёма' : 'общий объём не задан'}</div></div>
    <div class="tile ${dev == null ? '' : dev < 0 ? 'warn' : 'good'}"><div class="eyebrow">План / факт на дату</div><div class="v">${planV == null ? '—' : fmtN(planV) + ' / ' + fmtN(fact)}</div><div class="s">${dev == null ? 'план на дату не задан' : (dev >= 0 ? '+' : '−') + fmtN(Math.abs(dev)) + ' ' + esc(u) + ' к плану'}</div></div>
    <div class="tile"><div class="eyebrow">Темп за 7 суток</div><div class="v">${rate == null ? '—' : fmtN(rate)} <small>${rate == null ? '' : esc(u) + '/нед.'}</small></div><div class="s">${a ? 'расчёт суточного отчёта' : 'расчёт загружается'}</div></div>
    <div class="tile"><div class="eyebrow">Прогноз завершения</div><div class="v" style="font-size:18px">${eta ? ogniDate(eta) : spec.doneText && pct >= 99.95 ? esc(spec.doneText) : '—'}</div><div class="s">по темпу площадки</div></div>
  </div>`;
  let chart = '';
  if (rows.length > 1){
    const pts = k => rows.filter(r => r[k] != null).map(r => [dn(r.d), Number(r[k])]);
    const factPts = pts(spec.key), planPts = spec.planKey ? pts(spec.planKey) : [];
    const ymax = Math.max(target || 0, ...factPts.map(p => p[1]), ...planPts.map(p => p[1])) * 1.06 || 1;
    const step = ymax > 200 ? 50 : ymax > 40 ? 10 : ymax > 10 ? 5 : 1;
    const top = Math.ceil(ymax / step) * step;
    const ticks = [0, top / 4, top / 2, top * 3 / 4, top].map(v => Math.round(v));
    chart = lineChart({ w: 900, h: 280, x0: factPts[0][0] - 2, x1: Math.max(M.T, factPts[factPts.length - 1][0]) + 3, y0: 0, y1: top, yTicks: ticks, yFmt: v => fmtN(v),
      tipFmt: v => fmtN(v) + ' ' + u,
      series: [...(planPts.length ? [{ name: 'План по сводкам', color: 'var(--ink-2)', pts: planPts, width: 2 }] : []), { name: 'Факт по сводкам', color: 'var(--accent)', pts: factPts, width: 3, dots: true, area: true }],
      marks: [{ t: M.T, label: 'Сегодня', color: 'var(--accent)', w: 2 }], label: 'Суточная динамика ' + spec.title });
  }
  const recent = rows.slice(-7).reverse().map(r => {
    const i = rows.indexOf(r), prev = i > 0 ? rows[i - 1] : null;
    const d = prev ? Number(r[spec.key]) - Number(prev[spec.key]) : null;
    return `<tr><td>${ogniDate(r.d)}</td><td>${spec.planKey && r[spec.planKey] != null ? fmtN(r[spec.planKey]) : '—'}</td><td><b>${fmtN(r[spec.key])}</b></td><td style="color:${d > 0 ? 'var(--good)' : 'inherit'}">${d == null ? '—' : (d > 0 ? '+' : '') + fmtN(d)}</td></tr>`;
  }).join('');
  const events = (DATA.events || []).filter(e => spec.events.includes(e.kind)).slice(-5).reverse();
  const tests = spec.tests ? `<div class="tbl-wrap"><table class="t" style="min-width:640px"><thead><tr><th class="l">Свая</th><th class="l">Куст</th><th class="l">Период</th><th class="l">Результат</th></tr></thead><tbody>${(DATA.tests || []).map(x => `<tr><td class="l"><b>${esc(x.pile)}</b></td><td class="l">${esc(x.cluster || '')}</td><td class="l">${esc(x.period || '')}</td><td class="l wrap">${esc(x.result || '')}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<section class="panel"><header><h2>Оперативный факт площадки</h2><span class="sub">${esc(spec.title)} · суточные сводки по ${ogniDate(OGNI_LAST.d)}</span>
      <button class="btn sm" type="button" data-go="#/data/production${spec.chart ? '/' + spec.chart : ''}" style="margin-left:auto">${ico('trend')}Производство</button></header>
    <div class="pad" style="display:flex; flex-direction:column; gap:16px">${tiles}${chart}${tests}
      ${recent ? `<div class="tbl-wrap"><table class="t" style="min-width:420px"><thead><tr><th>Сводка</th><th>План</th><th>Факт</th><th>Прирост</th></tr></thead><tbody>${recent}</tbody></table></div>` : ''}
      <div><div class="eyebrow" style="margin-bottom:8px">События, причины и мероприятия</div>${events.length ? events.map(e => `<div class="note" style="margin-bottom:6px"><b class="num">${ogniDate(e.d)}</b> · ${esc(e.text)}</div>`).join('') : '<p class="faint" style="font-size:13px">Отдельные события по работе не зарегистрированы.</p>'}</div>
      <p class="faint" style="font-size:12px">Процент выполнения работы в ГПР пересчитан из этих сводок: ${esc(spec.title.toLowerCase())} — ${target ? fmtN(fact) + ' из ' + fmtN(target) + ' ' + esc(u) : 'объём без общего итога не пересчитывается'}. Полные графики, прогнозы и журнал — в разделе «Производство».</p>
    </div></section>`;
};
/* Виды работ из суточного отчёта, у которых нет однозначной строки в ГПР: показываются на этапе,
   на готовность не влияют (факт не приписывается другой работе). */
PROJECT.engine.hooks.nodeExtra = n => {
  if (n.u !== OGNI_DAILY.stage) return '';
  const L = OGNI_LAST;
  const items = OGNI_DAILY.unbound.map(b => [b.title, b.sum ? b.sum.reduce((a, k) => a + (Number(L[k]) || 0), 0) : b.target ? DATA.targets[b.target] : L[b.metric], ogniTotal(b), b.unit]);
  return `<section class="panel"><header><h2>Работы из суточного отчёта</h2><span class="sub">нет однозначной строки в ГПР — на готовность не влияют · сводка ${ogniDate(L.d)}</span></header>
    <div class="pad"><div class="tiles">${items.map(([t, v, tot, u]) => `<button class="tile" type="button" data-go="#/data/production" style="text-align:left; cursor:pointer"><div class="eyebrow">${esc(t)}</div><div class="v">${fmtN(v)} <small>${tot ? '/ ' + fmtN(tot) + ' ' : ''}${esc(u)}</small></div><div class="s">${tot && v != null ? fp(v / tot * 100, 1) + ' % · ' : ''}Производство →</div></button>`).join('')}</div></div></section>`;
};
