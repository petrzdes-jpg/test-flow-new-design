/*
 * Flow — оболочка интерфейса: статус объекта в портфеле, «Проекты», календарь портфеля,
 * уведомления, блокировка прокрутки под модальными окнами.
 *
 *  · Статус объекта рассчитывается автоматически: прогноз ввода (CPM) против директивного срока
 *    (директивная дата финальной вехи → P.dates.directive → плановый ввод). Зелёный — в срок,
 *    жёлтый — отставание до порога (по умолчанию 30 дн.), красный — больше порога. Если логика
 *    графика неполная, статус помечается «оценка неполная»; если прогноза нет — «нет данных».
 *  · Уведомления собираются из данных объектов с учётом роли: что ждёт решения пользователя
 *    (корректировки, подтверждение факта, КС-2, сметы, документы) и что просрочено.
 *    Модули добавляют свои источники через DSF.notifyHooks.
 *  · Модальные окна и листы: фон не прокручивается, позиция страницы восстанавливается при
 *    закрытии, полосы прокрутки не сдвигают макет, прокрутка внутри окна не уходит на фон.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS;
  const { esc, fd, fds, chip, ico, link, plural, stVar, can, keepPage, models } = H;
  const { dn, iso } = DSF.util;
  const T = () => H.T();

  /* ===================================================== статус объекта */
  DSF.objStatus = function (M) {
    const P = M.P, fin = M.finalTask;
    const directive = (fin && fin.directive != null) ? fin.directive : dn(P.dates && P.dates.directive) != null ? dn(P.dates.directive) : M.root.planEnd;
    const forecast = M.root.forecastEnd;
    const lim = +((P.control || {}).portfolioWarnDays || 30);
    const net = M.network || {};
    const partial = P.source === 'legacy' ? false : (net.state && net.state !== 'ok');
    const ps = DSF.PROJECT_STATUS && DSF.PROJECT_STATUS[P.status];
    if (ps && P.status && P.status !== 'active') return { c: ps.c || 'neutral', t: ps.t, delay: null, directive, forecast, partial };
    if (forecast == null || directive == null || !isFinite(forecast) || !isFinite(directive)) return { c: 'neutral', t: 'Нет данных для прогноза', delay: null, directive, forecast, partial };
    if (net.state === 'error') return { c: 'crit', t: 'Ошибка расчёта графика', delay: null, directive, forecast, partial: true };
    const delay = Math.round(forecast - directive);
    const c = delay <= 0 ? 'good' : delay <= lim ? 'warn' : 'crit';
    const t = delay <= 0 ? 'В срок' : delay <= lim ? 'Риск срыва срока' : 'Срыв срока';
    return { c, t, delay, directive, forecast, partial, lim };
  };

  /* ===================================================== уведомления */
  DSF.notifyHooks = DSF.notifyHooks || [];
  function collect(M) {
    const out = [], role = DSF.auth.role, org = DSF.auth.org(), pid = M.P.id;
    const add = (sev, title, meta, go, d) => out.push({ sev, title, meta, go, pid, pname: M.P.name, d: d == null ? T() : d });
    // корректировки графика
    (M.changes || []).forEach(c => {
      if (DSF.uiRoles && DSF.uiRoles.waitsMe(c)) {
        const t = M.byId.get(c.task);
        add(c.status === 'returned' ? 'warn' : 'accent', c.status === 'returned' ? 'Корректировка возвращена на доработку' : 'Корректировка графика ждёт вашего решения', (t ? t.name + ' · ' : '') + (c.org || ''), link(pid, 'corrections', c.id), dn(c.date));
      }
    });
    // подтверждение ежедневного факта
    const pend = (M.dayReports || []).filter(r => r.status === 'pending' && DSF.auth.canStep(r.next));
    if (pend.length) add('accent', 'Факт ждёт подтверждения: ' + pend.length + ' ' + plural(pend.length, 'отчёт', 'отчёта', 'отчётов'), [...new Set(pend.map(r => r.org))].slice(0, 2).join(', '), link(pid, 'production'), Math.min(...pend.map(r => r.d)));
    if (role === 'contractor') {
      (M.dayReports || []).filter(r => r.returned && r.org === org).forEach(r => add('warn', 'Отчёт за ' + fd(r.d) + ' возвращён', r.retNote || '', link(pid, 'production'), r.d));
      (M.remarks || []).filter(r => r.open && r.org === org).forEach(r => add(r.overdue ? 'crit' : 'warn', 'Замечание ' + (r.no || '') + (r.overdue ? ' просрочено' : ' к устранению'), r.title, link(pid, 'quality', r.id), r.due));
      (M.ks || []).filter(k => ['remarks', 'rejected'].includes(k.status) && k.contract && k.contract.contractor === org).forEach(k => add('warn', k.no + ': ' + (DSF.KS_STATUS[k.status] || {}).t, k.contract.no, link(pid, 'budget', k.contract.id), k.d));
    } else {
      if (can('kstz')) (M.ks || []).filter(k => ['sent', 'accept'].includes(k.status)).forEach(k => add('accent', k.no + ' ждёт проверки', (k.contract || {}).contractor || '', link(pid, 'budget', (k.contract || {}).id), k.d));
      if (DSF.auth.has('budget.approve')) (M.ks || []).filter(k => k.status === 'formed').forEach(k => add('accent', k.no + ' ждёт согласования', (k.contract || {}).contractor || '', link(pid, 'budget', (k.contract || {}).id), k.d));
      if (DSF.auth.has('quality.approve')) (M.remarks || []).filter(r => r.status === 'presented').forEach(r => add('accent', 'Устранение замечания ' + (r.no || '') + ' ждёт проверки', r.org || '', link(pid, 'quality', r.id), r.d));
      if (role === 'director' || role === 'admin') (M.attention || []).filter(a => a.sev === 'crit' && a.kind !== 'order').slice(0, 3).forEach(a => add('crit', a.text, a.meta || '', link(pid, a.go ? a.go.split('.')[0] : 'overview', a.go && a.go.split('.')[1]), a.due));
    }
    (M.orders || []).filter(o => o.status === 'overdue' && (role !== 'contractor' || o.owner === org)).forEach(o => add('crit', 'Просрочено поручение № ' + o.no, o.text, link(pid, 'orders', o.id), o.due));
    DSF.notifyHooks.forEach(fn => { try { (fn(M) || []).forEach(x => out.push(Object.assign({ pid, pname: M.P.name, d: T() }, x))); } catch (e) { console.error(e); } });
    return out;
  }
  let cache = { k: null, list: [] };
  DSF.notifications = function () {
    const Ms = models();
    const k = Ms.map(M => M.P.id + ':' + (DSF.store ? DSF.store.count(M.P.id) : 0)).join('|');
    if (cache.k !== k) cache = { k, list: Ms.flatMap(collect).sort((a, b) => ({ crit: 0, warn: 1, accent: 2 }[a.sev] - { crit: 0, warn: 1, accent: 2 }[b.sev]) || (a.d || 0) - (b.d || 0)) };
    return cache.list;
  };
  DSF.notifyCount = () => { try { return DSF.notifications().length; } catch (e) { return 0; } };

  const head = (eyebrow, h1, ac, sub, right) => `<section class="head" style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:flex-end">
      <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${eyebrow}</div><h1 style="margin-top:8px">${h1} <span class="ac">${ac}</span></h1>${sub ? `<p class="muted" style="margin-top:8px; max-width:78ch">${sub}</p>` : ''}</div>
      ${right ? `<div class="hd-r">${right}</div>` : ''}</section>`;

  U.VIEWS.notify = function () {
    const list = DSF.notifications();
    const f = UI.ntfF || 'all';
    const shown = list.filter(x => f === 'all' || x.pid === f);
    const pids = [...new Set(list.map(x => x.pid))];
    return { title: 'Уведомления', html: `${head('Flow', 'Уведомления', '', 'Что ждёт вашего решения и что просрочено — по всем доступным объектам. Список формируется из данных объектов с учётом вашей роли.')}
      <section class="panel"><div class="pad" style="padding-top:16px">
        ${pids.length > 1 ? `<div class="fchips" style="margin-bottom:12px"><button class="fchip" type="button" data-x="ntf-f" data-f="all" ${f === 'all' ? 'aria-pressed="true"' : ''}>Все · ${list.length}</button>${pids.map(p => `<button class="fchip" type="button" data-x="ntf-f" data-f="${esc(p)}" ${f === p ? 'aria-pressed="true"' : ''}>${esc(H.byId(p).name)} · ${list.filter(x => x.pid === p).length}</button>`).join('')}</div>` : ''}
        ${shown.length ? `<div class="ntf">${shown.map(x => `<button class="ntf-i" type="button" data-go="${esc(x.go)}"><span class="ntf-k" style="background:${stVar(x.sev)}"></span><span class="ntf-x"><b>${esc(x.title)}</b>${x.meta ? `<span class="faint">${esc(x.meta)}</span>` : ''}<span class="ntf-m">${esc(x.pname)}${x.d != null ? ' · ' + fd(x.d) : ''}</span></span>${ico('chev')}</button>`).join('')}</div>` : '<div class="empty">Новых уведомлений нет — ничего не ждёт вашего решения.</div>'}
      </div></section>` };
  };
  A['ntf-f'] = (el, d) => { UI.ntfF = d.f; keepPage(); };

  /* ===================================================== «Проекты» */
  U.VIEWS.projects = function () {
    const Ms = models(), q = (UI.prjQ || '').toLowerCase();
    const list = Ms.filter(M => !q || (M.P.name + ' ' + (M.P.city || '') + ' ' + (M.P.code || '')).toLowerCase().includes(q));
    return { title: 'Проекты', html: `${head('Flow', 'Проекты', '', DSF.auth.role === 'contractor' ? 'Объекты, назначенные вашей организации.' : 'Все доступные вам объекты. Добавление нового объекта — здесь.', can('create') ? `<button class="btn primary" type="button" data-go="new">${ico('plus')}Добавить объект</button>` : '')}
      <section class="panel"><div class="pad" style="padding-top:16px">
        <input id="prj-q" class="inp" type="search" placeholder="Поиск по названию, городу, коду" value="${esc(UI.prjQ || '')}" style="width:100%; margin-bottom:12px">
        <div class="plist">${list.map(M => { const s = DSF.objStatus(M); return `<button class="pli" type="button" data-go="${M.P.id}">
          <span class="pli-k" style="background:${stVar(s.c)}"></span>
          <span class="pli-x"><b>${esc(M.P.name)}</b><span class="faint">${esc([M.P.city, M.phase].filter(Boolean).join(' · '))}</span>
            <span class="pli-m">${chip(esc(s.t), s.c)} <span>ввод ${fd(s.forecast)}${s.delay > 0 ? ' · +' + s.delay + ' дн.' : ''}</span>${s.partial ? ' <span class="faint">· оценка неполная</span>' : ''}</span></span>
          <span class="pli-p">${M.root.pc == null ? '—' : Math.round(M.root.pc) + '%'}</span>${ico('chev')}</button>`; }).join('') || '<div class="empty">Ничего не найдено.</div>'}</div>
      </div></section>` };
  };
  U.INPUTS['prj-q'] = e => { UI.prjQ = e.target.value; const pos = e.target.selectionStart; keepPage(); const el = document.getElementById('prj-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } };

  /* ===================================================== календарь портфеля */
  U.VIEWS.pcal = function () {
    const Ms = models(), t = T(), span = UI.pcalSpan || 30;
    const from = t - 7, to = t + span;
    const items = [];
    Ms.forEach(M => {
      (M.events || []).forEach(e => { if (e.date != null && e.date >= from && e.date <= to) items.push({ d: e.date, pid: M.P.id, pname: M.P.name, title: e.title, type: e.type, time: e.time, done: e.done, go: e.task && e.type === 'milestone' ? link(M.P.id, 'schedule') : link(M.P.id, 'calendar') }); });
      (M.orders || []).forEach(o => { if (o.status !== 'done' && o.due != null && o.due >= from && o.due <= to) items.push({ d: o.due, pid: M.P.id, pname: M.P.name, title: 'Срок поручения № ' + o.no + ': ' + o.text, type: 'order', overdue: o.status === 'overdue', go: link(M.P.id, 'orders', o.id) }); });
    });
    items.sort((a, b) => a.d - b.d || String(a.time || '').localeCompare(String(b.time || '')));
    const days = [...new Set(items.map(x => x.d))];
    const wd = d => new Date(d * 864e5).toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' });
    return { title: 'Календарь', html: `${head('Flow · все объекты', 'Календарь', '', 'События, приёмки, вехи и сроки поручений по всем доступным объектам. Отчётная дата ' + fd(t) + '.')}
      <section class="panel"><header style="flex-wrap:wrap; gap:8px"><h2>Ближайшие ${span} дн.</h2><span class="grow"></span><div class="seg">${[14, 30, 90].map(n => `<button class="seg-b" type="button" data-x="pcal-span" data-n="${n}" ${span === n ? 'aria-pressed="true"' : ''}>${n} дн.</button>`).join('')}</div></header>
        <div class="pad">${days.length ? days.map(d => `<div class="agd ${d === t ? 'today' : ''} ${d < t ? 'past' : ''}"><div class="agd-h"><b>${fds(d)}</b> <span class="faint">${wd(d)}${d === t ? ' · сегодня' : ''}</span></div>
          ${items.filter(x => x.d === d).map(x => `<button class="agi" type="button" data-go="${esc(x.go)}"><span class="agi-k" style="background:${x.overdue ? 'var(--crit)' : H.evColor(x.type)}"></span><span class="agi-x"><b>${esc(x.title)}</b><span class="faint">${esc(x.pname)}${x.time ? ' · ' + esc(x.time) : ''}${x.done ? ' · выполнено' : ''}</span></span>${ico('chev')}</button>`).join('')}</div>`).join('') : '<div class="empty">Событий в выбранном периоде нет.</div>'}</div></section>` };
  };
  A['pcal-span'] = (el, d) => { UI.pcalSpan = +d.n; keepPage(); };

  /* ===================================================== блокировка прокрутки под модальными окнами */
  const html = document.documentElement, body = document.body;
  let locked = false, savedY = 0, savedHash = '';
  const OPEN = '.modal-bg, .sheet-bg, .viewer';
  function lock() {
    if (locked) return;
    locked = true; savedY = window.scrollY || html.scrollTop || 0; savedHash = location.hash;
    const sb = window.innerWidth - html.clientWidth;          // ширина полосы прокрутки — без сдвига макета
    body.style.position = 'fixed'; body.style.top = -savedY + 'px'; body.style.left = '0'; body.style.right = '0'; body.style.width = '100%';
    if (sb > 0) body.style.paddingRight = sb + 'px';
    html.classList.add('scroll-lock');
  }
  function unlock() {
    if (!locked) return;
    locked = false;
    body.style.position = body.style.top = body.style.left = body.style.right = body.style.width = body.style.paddingRight = '';
    html.classList.remove('scroll-lock');
    // позиция восстанавливается, если окно закрыто без перехода на другую страницу
    if (location.hash === savedHash) window.scrollTo(0, savedY);
  }
  function sync() { const layer = document.getElementById('layer'); (layer && layer.querySelector(OPEN)) ? lock() : unlock(); }
  const layer = document.getElementById('layer');
  if (layer && window.MutationObserver) new MutationObserver(sync).observe(layer, { childList: true, subtree: false });
  /* render() основной страницы при открытом окне не должен сбрасывать позицию: страница зафиксирована, позиция хранится в savedY */
  DSF.scrollLock = { lock, unlock, sync, get y() { return savedY; } };
  /* iOS: жест прокрутки по затемнению не уходит на фон */
  document.addEventListener('touchmove', e => { if (!locked) return; const t = e.target; if (t.closest && !t.closest('.mb, .psheet, .viewer .vi, .modal .tbl-wrap, .scroll-y')) e.preventDefault(); }, { passive: false });
})();
