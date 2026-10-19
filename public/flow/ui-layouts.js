/*
 * FLOW — DESIGN EXPERIMENT · новая компоновка экранов «Портфель» и «Обзор объекта» (вариант A «Командный центр»).
 *
 * Только слой представления: данные — из тех же моделей (DSF.build / H.models), действия — те же
 * data-go / data-x / data-task, права — те же can() / secOn(). Расчёты, API, роли не меняются.
 * Подключается ПОСЛЕ ui-flow.js и ДО ui-roles.js: обёртка ролей (инвестор, подрядчик, примечание
 * реального объекта) продолжает работать поверх новой компоновки.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h;
  const { esc, fd, fds, num, pct, money, bn, plural, days, chip, ico, ring, spark, stVar, link, can, secOn, photoUrl, miniGantt, photoCard, T } = H;
  const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const has = v => v != null && isFinite(v);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  document.documentElement.setAttribute('data-dv', 'a');

  /* ---------- общие элементы ---------- */
  const delayTxt = d => d == null ? '—' : d > 0 ? '+' + d + ' дн.' : d < 0 ? '−' + (-d) + ' дн.' : 'в срок';
  const pcTxt = M => has(M.root.pc) ? Math.round(M.root.pc) + '%' : '—';

  /* шкала срока: начало → сегодня → директивный срок (метка) → прогноз (точка цвета статуса) */
  function deadlineScale(M, o) {
    o = o || {};
    const R = M.root, os = DSF.objStatus(M), t = T();
    const s0 = has(R.start) ? R.start : null;
    if (s0 == null || !has(os.directive) && !has(os.forecast)) return `<div class="dl dl-empty">${o.compact ? '' : '<span class="faint">Сроки объекта не заданы</span>'}</div>`;
    const end = Math.max(has(os.directive) ? os.directive : 0, has(os.forecast) ? os.forecast : 0, t);
    const x0 = o.x0 != null ? o.x0 : s0, x1 = o.x1 != null ? o.x1 : end + Math.max(20, (end - s0) * 0.04);
    const X = d => clamp((d - x0) / (x1 - x0) * 100, 0, 100).toFixed(2) + '%';
    const edge = d => { const v = (d - x0) / (x1 - x0) * 100; return v > 82 ? ' class="r"' : v < 12 ? ' class="l"' : ''; };
    const c = stVar(os.c === 'neutral' ? 'accent' : os.c);
    const late = has(os.forecast) && has(os.directive) && os.forecast > os.directive;
    return `<div class="dl ${o.compact ? 'dl-c' : ''}" style="--dl-c:${c}">
      <div class="dl-track">
        <span class="dl-span" style="left:${X(s0)}; width:calc(${X(has(os.forecast) ? os.forecast : end)} - ${X(s0)})"></span>
        <span class="dl-done" style="left:${X(s0)}; width:calc(${X(Math.min(t, has(os.forecast) ? os.forecast : t))} - ${X(s0)})"></span>
        ${late ? `<span class="dl-late" style="left:${X(os.directive)}; width:calc(${X(os.forecast)} - ${X(os.directive)})"></span>` : ''}
        <span class="dl-today" style="left:${X(t)}"></span>
        ${has(os.directive) ? `<span class="dl-dir" style="left:${X(os.directive)}"></span>` : ''}
        ${has(os.forecast) ? `<span class="dl-fc" style="left:${X(os.forecast)}"></span>` : ''}
      </div>
      ${o.compact ? '' : `<div class="dl-lab dl-lab-top">
          <span${edge(t)} style="left:${X(t)}">Сегодня · ${fds(t)}</span>
          ${has(os.directive) ? `<span class="dl-l-dir${(edge(os.directive).match(/"(\w)"/) || [, ""])[1] ? ' ' + edge(os.directive).match(/"(\w)"/)[1] : ''}" style="left:${X(os.directive)}">Директивный · ${fd(os.directive)}</span>` : ''}
        </div>
        <div class="dl-lab dl-lab-bot">
          <span class="dl-l-start" style="left:${X(s0)}">Старт · ${fd(s0)}</span>
          ${has(os.forecast) ? `<span class="dl-l-fc${(edge(os.forecast).match(/"(\w)"/) || [, ""])[1] ? ' ' + edge(os.forecast).match(/"(\w)"/)[1] : ''}" style="left:${X(os.forecast)}">Прогноз · ${fd(os.forecast)}</span>` : ''}
        </div>`}
    </div>`;
  }

  /* показатели обзора: те же данные и переходы, что в исходном обзоре */
  function kpiSet(M) {
    const P = M.P, R = M.root, f = M.fin, t = T(), RS = M.res, sched = M.status.schedule;
    const wrap = (sec, sub, title, key, inner) => secOn(M, sec)
      ? `<button class="lk lk-${key}" type="button" data-go="${link(P.id, sec, sub)}" title="${esc(title)}">${inner}<span class="lk-go">${ico('arrow')}</span></button>`
      : `<div class="lk lk-${key} lk-static">${inner}</div>`;
    const ready = wrap('schedule', null, 'Реализация / График работ', 'ready', `<div class="lk-t">Готовность</div>
      <div class="lk-v">${R.pc != null ? num(R.pc, 1) + '<small>%</small>' : '—'}</div>
      <div class="lk-bar"><i style="width:${clamp(R.pc || 0, 0, 100)}%"></i>${has(R.planNow) ? `<b style="left:${clamp(R.planNow, 0, 100)}%" title="План на дату"></b>` : ''}</div>
      <div class="lk-s">${R.pc == null ? (R.mode === 'manual' ? 'фактическая готовность не внесена' : 'правила расчёта не настроены') : R.dev == null ? 'план на дату не задан' : `план на ${fds(t)} — ${pct(R.planNow)} · ${chip(Math.abs(R.dev) < 0.05 ? 'по плану' : (R.dev > 0 ? '+' : '−') + num(Math.abs(R.dev), 1) + ' п.п.', R.dev >= -1 ? 'good' : R.dev > -5 ? 'warn' : 'crit')}`}</div>`);
    const term = wrap('calendar', null, 'Календарь проекта', 'term', `<div class="lk-t">Срок</div>
      <div class="lk-v ${sched}">${R.actualEnd != null ? 'сдан' : R.delay == null ? '—' : R.delay > 0 ? '+' + R.delay + '<small> дн.</small>' : R.delay < 0 ? '−' + (-R.delay) + '<small> дн.</small>' : 'в срок'}</div>
      <div class="lk-bar lk-bar-time"><i style="width:${clamp(R.timePct || 0, 0, 100)}%"></i></div>
      <div class="lk-s">${R.timePct != null ? `прошло ${Math.round(R.timePct)}% срока · осталось ${days(R.left)}` : 'сроки объекта не заданы'}</div>`);
    const money_ = wrap('budget', null, 'Бюджет', 'money', f.configured ? `<div class="lk-t">Бюджет</div>
      <div class="lk-v">${bn(f.done)}<small> / ${bn(f.approved)} млрд ₽</small></div>
      <div class="lk-bar lk-bar-fin"><i class="c" style="width:${clamp(f.contracted / f.approved * 100, 0, 100)}%"></i><i style="width:${clamp(f.done / f.approved * 100, 0, 100)}%"></i><b style="left:${clamp(f.eac / f.approved * 100, 0, 100)}%" title="Прогноз стоимости"></b></div>
      <div class="lk-s">${chip(f.eac > f.approved ? 'перерасход ' + money(f.eacDelta) : 'прогноз ' + bn(f.eac) + ' млрд · в бюджете', f.state)} оплачено ${bn(f.paid)}</div>`
      : `<div class="lk-t">Бюджет</div><div class="lk-v">—</div><div class="lk-s">${M.contracts.length ? M.contracts.length + ' ' + plural(M.contracts.length, 'договор', 'договора', 'договоров') : 'бюджет объекта не задан'}</div>`);
    const res = wrap('resources', 'wf', 'Ресурсы — график движения рабочей силы', 'res', `<div class="lk-t">Ресурсы</div>
      <div class="lk-v">${RS.has ? num(RS.now) : '—'}<small> рабочих</small></div>
      <div class="lk-spark">${RS.has && RS.fact.length > 1 ? spark(RS.fact, RS.plan, 160, 30) : ''}</div>
      <div class="lk-s">${RS.has ? `план ${num(RS.planNowWf)} · ИТР ${RS.itrNow != null ? num(RS.itrNow) : '—'} · техника ${RS.equipment.length ? num(RS.equipTotal) : '—'}` : 'данные о ресурсах не вносились'}</div>`);
    return { ready, term, money: money_, res };
  }

  const flowBlocks = M => DSF.uiFlow ? { sig: DSF.uiFlow.signalsPanel(M), cc: DSF.uiFlow.controlBlocks(M) } : { sig: '', cc: '' };
  const ganttPanel = M => secOn(M, 'schedule') ? `<section class="panel">
      <header><h2>График реализации</h2><span class="sub">этапы: факт и прогноз против плана</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(M.P.id, 'schedule')}">Диаграмма Ганта ${ico('chev')}</button></header>
      <div class="pad">${miniGantt(M)}${M.root.pc == null && M.tasks.length && can('settings') ? `<div class="note" style="margin-top:12px">Общая готовность не рассчитывается: не заданы правила участия работ и веса. <button class="lnk" type="button" data-go="${link(M.P.id, 'settings', 'readiness')}">Настроить готовность ${ico('chev')}</button></div>` : ''}</div>
    </section>` : '';
  const photosPanel = (M, n) => secOn(M, 'photos') ? `<section class="panel">
      <header><h2>Фотохроника</h2><span class="sub">последние снимки с объекта</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(M.P.id, 'photos')}">Все фото ${ico('chev')}</button></header>
      <div class="pad">${M.photos.length ? `<div class="photostrip">${M.photos.slice(0, n || 6).map(p => photoCard(M, p)).join('')}</div>` : `<div class="empty">Фотографий пока нет.${can('data') && M.P.source !== 'legacy' ? ' <button class="lnk" type="button" data-x="photo-upload">Загрузить фото</button>' : ''}</div>`}</div>
    </section>` : '';
  const statusLine = M => { const os = DSF.objStatus(M); return `${chip(os.t, os.c)}${os.partial ? ' <span class="chip warn">оценка неполная</span>' : ''}`; };

  /* ======================================================================
   * ОБЗОР ОБЪЕКТА
   * ====================================================================== */
  const baseOverview = U.VIEWS.overview;
  U.VIEWS.overview = function (M, r) { return ovA(M, r); };
  DSF.expBaseOverview = baseOverview;

  /* A · Командный центр: шапка-строка, большой модуль срока, справа — решения и контроль */
  function ovA(M) {
    const P = M.P, os = DSF.objStatus(M), img = photoUrl(P.cover), K = kpiSet(M), FB = flowBlocks(M);
    const html = `
    <section class="ox-head">
      <div class="ox-id">${img ? `<img class="ox-ph" src="${img}" alt="">` : `<span class="ox-ph ox-code">${esc(P.code)}</span>`}
        <div class="ox-tx"><h1>${esc(P.name)}</h1><div class="ox-meta">${esc([P.type, P.city, 'этап: ' + M.phase].filter(Boolean).join(' · '))}</div></div></div>
      <div class="ox-st"><div class="ox-st-l">Прогноз ввода</div><div class="ox-st-v" style="color:${stVar(os.c === 'neutral' ? 'accent' : os.c)}">${fd(os.forecast)}</div><div class="ox-st-c">${statusLine(M)}${has(os.delay) ? `<span class="ox-delay">${delayTxt(os.delay)} к директивному</span>` : ''}</div></div>
    </section>
    <section class="panel ox-term">
      <header><h2>Срок ввода</h2><span class="sub">директивный срок — синяя метка, прогноз — точка; красная зона — отставание</span></header>
      <div class="pad">${deadlineScale(M)}</div>
    </section>
    <div class="ox-grid">
      <div class="ox-main">
        <section class="lks lks-3">${K.ready}${K.money}${K.res}</section>
        ${FB.cc}
        ${ganttPanel(M)}
        ${photosPanel(M, 4)}
      </div>
      <aside class="ox-rail">${FB.sig}</aside>
    </div>`;
    return { html };
  }

  /* ======================================================================
   * ПОРТФЕЛЬ
   * ====================================================================== */
  function pfData() {
    const Ms = H.models();
    const fins = Ms.filter(m => m.fin.configured);
    const approved = sum(fins, m => m.fin.approved), done = sum(fins, m => m.fin.done), area = sum(Ms, m => +m.P.params.area || 0);
    const rdy = Ms.filter(m => has(m.root.pc) && m.fin.configured);
    const wavg = rdy.length ? sum(rdy, m => m.root.pc * m.fin.approved) / sum(rdy, m => m.fin.approved) : null;
    const workers = sum(Ms, m => m.res.now || 0), high = sum(Ms, m => m.highRisks.length);
    const st = Ms.map(m => DSF.objStatus(m));
    const cnt = c => st.filter(s => s.c === c).length;
    const over = Ms.filter(m => m.fin.configured && m.fin.eac > m.fin.approved).length;
    const t = T();
    const tl = Ms.filter(m => has(m.root.start));
    const ends = Ms.flatMap(m => { const s = DSF.objStatus(m); return [s.directive, s.forecast, m.root.planEnd].filter(has); });
    const x0 = tl.length ? Math.min(...tl.map(m => m.root.start)) - 30 : t - 30;
    const x1 = ends.length ? Math.max(...ends, t) + 60 : t + 60;
    return { Ms, fins, approved, done, area, wavg, rdy, workers, high, cnt, over, t, x0, x1, lite: DSF.auth.role === 'contractor' };
  }
  const pfHead = (extra) => `<section class="head px-head">
      <div style="flex:1 1 420px; min-width:0">
        <h1>${DSF.auth.role === 'contractor' ? 'Мои объекты' : 'Портфель проектов'}</h1>
        <p class="muted">${DSF.auth.role === 'contractor' ? 'Объекты, назначенные вашей организации. Выберите объект, чтобы внести прогресс, подать КС-2 или запросить корректировку графика.' : DSF.mode === 'real' ? 'Реальные объекты. Показатели — только из данных объекта; если значение не передано, показывается «—».' : 'Демонстрационные объекты. Все компании, люди и показатели вымышлены.'}</p>
        ${extra || ''}
      </div>
      <div class="hd-r">${can('create') ? `<button class="btn primary" type="button" data-go="new">${ico('plus')}Добавить объект</button>` : ''}${can('admin') ? `<button class="btn" type="button" data-go="admin">${ico('shield')}Администрирование</button>` : ''}</div>
    </section>`;
  const yearTicks = (x0, x1) => { const out = []; for (let y = new Date(x0 * 864e5).getUTCFullYear() + 1; ; y++) { const d = Math.round(Date.UTC(y, 0, 1) / 864e5); if (d > x1) break; out.push({ d, l: String(y) }); } return out; };
  const sumSentence = D => { const { Ms, cnt } = D; const p = (n, c, t) => n ? `<span class="ps-${c}"><b>${n}</b> ${t}</span>` : ''; return `<div class="px-sent"><span><b>${Ms.length}</b> ${plural(Ms.length, 'объект', 'объекта', 'объектов')}</span>${p(cnt('good'), 'good', 'в срок')}${p(cnt('warn'), 'warn', 'с риском срыва')}${p(cnt('crit'), 'crit', plural(cnt('crit'), 'срыв срока', 'срыва срока', 'срывов срока'))}${p(cnt('neutral'), 'neutral', 'без прогноза')}</div>`; };
  const totals = D => D.lite ? '' : [
    ['Бюджет', D.approved ? bn(D.approved) + '<small> млрд ₽</small>' : '—', D.approved ? 'выполнено ' + pct(D.done / D.approved * 100) : 'не задан'],
    ['Готовность', pct(D.wavg), 'взвешено по бюджету'],
    ['Площадь', D.area ? num(D.area / 1000, 1) + '<small> тыс. м²</small>' : '—', D.Ms.length + ' ' + plural(D.Ms.length, 'объект', 'объекта', 'объектов')],
    ['На площадках', num(D.workers) + '<small> чел.</small>', 'техника ' + (D.Ms.some(m => m.res.equipment.length) ? num(sum(D.Ms, m => m.res.equipTotal)) + ' ед.' : '—')],
    ['Риски', D.high + '<small> высоких</small>', D.over ? D.over + ' с перерасходом' : 'перерасхода нет']
  ];
  const cmpTable = D => D.lite ? '' : `<section class="panel">
      <header><h2>Сравнение проектов</h2><span class="sub">одинаковые показатели для любой стадии</span></header>
      <div class="pad tbl-wrap"><table class="t">
        <thead><tr><th>Проект</th><th class="l">Текущий этап</th><th>Готовность</th><th>План на дату</th><th>Прогноз ввода</th><th>Отклонение</th><th>Бюджет</th><th>Прогноз стоимости</th><th>Освоено</th><th>Риски</th></tr></thead>
        <tbody>${D.Ms.map(M => `<tr class="link" data-go="${M.P.id}"><td><b>${esc(M.P.name)}</b><div class="faint" style="font-size:12px">${esc(M.P.type)}</div></td><td class="l">${esc(M.phase)}</td><td>${pct(M.root.pc)}</td><td>${pct(M.root.planNow)}</td><td>${fd(M.root.forecastEnd)}</td><td>${M.root.delay == null ? chip('нет графика', 'neutral') : M.root.delay > 0 ? chip('+' + M.root.delay + ' дн.', M.status.schedule) : chip('в срок', 'good')}</td><td>${M.fin.configured ? money(M.fin.approved) : '—'}</td><td style="color:${stVar(M.status.budget)}">${M.fin.configured ? money(M.fin.eac) : '—'}</td><td>${pct(M.fin.finPct)}</td><td>${M.highRisks.length} / ${M.midRisks.length}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
  /* сигналы всех объектов — для правой колонки варианта A */
  function allSignals(D) {
    const out = [];
    D.Ms.forEach(M => (M.signalsOpen || []).forEach(s => out.push({ M, s })));
    const w = { crit: 0, warn: 1 };
    out.sort((a, b) => (w[a.s.sev] ?? 2) - (w[b.s.sev] ?? 2));
    return out;
  }
  const goOf = (P, g) => { const [s, ...rest] = String(g || 'overview').split('.'); return link(P.id, s, rest.join('.') || null); };

  const basePortfolio = U.VIEWS.portfolio;
  U.VIEWS.portfolio = function (M, r) {
    if (!H.models().length && basePortfolio) return basePortfolio(M, r);
    return pfA();
  };

  /* A · Командный центр: объекты строками на общей шкале сроков + решения справа */
  function pfA() {
    const D = pfData(), X = d => clamp((d - D.x0) / (D.x1 - D.x0) * 100, 0, 100).toFixed(2) + '%';
    const sig = allSignals(D);
    const html = pfHead(sumSentence(D)) + `
    ${D.lite ? '' : `<section class="px-totals">${totals(D).map(([l, v, s]) => `<div><span>${l}</span><b>${v}</b><em>${s}</em></div>`).join('')}</section>`}
    ${DSF.portfolioExtra ? DSF.portfolioExtra(D.Ms) : ''}
    <div class="px-grid">
      <section class="panel px-board">
        <header><h2>Объекты и сроки ввода</h2><span class="sub">общая шкала · сегодня ${fds(D.t)}</span></header>
        <div class="px-axis"><span></span><div class="px-ticks">${yearTicks(D.x0, D.x1).map(k => `<i style="left:${X(k.d)}">${k.l}</i>`).join('')}<em class="px-now" style="left:${X(D.t)}"></em></div><span></span></div>
        ${D.Ms.map(M => {
          const P = M.P, os = DSF.objStatus(M), img = photoUrl(P.cover);
          return `<button class="px-row" type="button" data-go="${P.id}">
            <span class="px-id">${img ? `<img src="${img}" alt="" loading="lazy">` : `<span class="px-ini">${esc(P.code)}</span>`}<span class="px-nm"><b>${esc(P.name)}</b><small>${esc([P.city, M.phase].filter(Boolean).join(' · '))}</small><span class="px-kv"><span>готовн. <b>${pcTxt(M)}</b></span><span>бюджет <b style="color:${stVar(M.status.budget)}">${M.fin.configured ? bn(M.fin.eac) + ' млрд' : '—'}</b></span><span>риски <b>${M.highRisks.length}/${M.midRisks.length}</b></span></span></span></span>
            <span class="px-tl">${deadlineScale(M, { compact: true, x0: D.x0, x1: D.x1 })}</span>
            <span class="px-m"><span class="px-st">${chip(os.t, os.c)}</span><span class="px-in"><small>ввод</small><b style="color:${os.delay > 0 ? stVar(os.c) : 'var(--ink)'}">${fd(os.forecast)}</b></span></span>
          </button>`;
        }).join('')}
        <div class="px-legend"><span><i class="lg-span"></i>срок реализации</span><span><i class="lg-done"></i>прошло</span><span><i class="lg-dir"></i>директивный срок</span><span><i class="lg-fc"></i>прогноз ввода</span><span><i class="lg-late"></i>отставание</span></div>
      </section>
      <aside class="px-rail">
        <section class="panel"><header><h2>Требует решения</h2><span class="sub">${sig.length} по всем объектам</span></header>
          <div class="pad">${sig.length ? `<div class="px-sig">${sig.slice(0, 8).map(({ M, s }) => `<button class="px-sig-i" type="button" data-go="${goOf(M.P, s.go)}"><span class="sev" style="background:${stVar(s.sev)}"></span><span><small>${esc(M.P.name)} · ${esc(s.area)}</small>${esc(s.title)}</span></button>`).join('')}</div>${sig.length > 8 ? `<button class="lnk" type="button" data-go="notify" style="margin-top:10px">Все уведомления ${ico('chev')}</button>` : ''}` : '<div class="empty">Открытых сигналов нет.</div>'}</div>
        </section>
        ${can('create') ? `<button class="px-add-wide" type="button" data-go="new">${ico('plus')}<span><b>Добавить объект</b><small>мастер создания</small></span></button>` : ''}
      </aside>
    </div>
    ${cmpTable(D)}`;
    return { html, title: 'Портфель проектов' };
  }

})();
