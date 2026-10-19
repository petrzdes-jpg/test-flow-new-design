/*
 * FLOW — Цифровой штаб строительства. Рабочие экраны универсального интерфейса:
 * Ресурсы, Календарь (события, письма), Протокольные поручения, Документы
 * (РД/ПД/ИД/КС/отчёты/письма/протоколы), Бюджет → Договор → КС-2.
 * Экраны одинаковы для всех проектов и строятся только из модели DSF.build().
 * Действия пользователя записываются в DSF.store и сразу пересчитываются движком.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI;
  const { esc, fd, fds, num, pct, money, bn, plural, chip, ico, link, route, byId, T, openModal, closeModal, toast, keepPage, stVar } = H;
  const { dn, iso, clamp, sum, monthStart, monthEnd, addMonths } = DSF.util;
  const F = DSF.fmt;
  const store = DSF.store;
  const ROLE = { tz: 'Технический заказчик', gc: 'Подрядчик' };
  const today = () => iso(T());
  const M0 = () => { const r = route(); return r.pid ? DSF.build(byId(r.pid)) : null; };

  /* ---------- общие элементы ---------- */
  const head = (eyebrow, title, accent, sub, right) => `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
    <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${eyebrow}</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">${title} <span class="ac">${accent}</span></h1>${sub ? `<div class="muted" style="margin-top:6px; font-size:13px">${sub}</div>` : ''}</div>
    ${right ? `<div class="hd-r">${right}</div>` : ''}</section>`;
  const backBtn = (to, t) => `<button class="btn sm" type="button" data-go="${to}">${ico('back')}${esc(t)}</button>`;
  const ksSt = k => DSF.KS_STATUS[k.status] || DSF.KS_STATUS.draft;
  const ordSt = o => DSF.ORDER_STATUS[o.status] || DSF.ORDER_STATUS.new;
  const docSt = d => (DSF.DOC_STATUS[d.state] || DSF.DOC_STATUS.none);
  const mon = d => { const x = new Date(d * 864e5); return F.MONTHS_FULL[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); };
  const durText = m => m >= 60 ? (Math.floor(m / 60) + ' ч' + (m % 60 ? ' ' + (m % 60) + ' мин' : '')) : m + ' мин';
  const kv = rows => `<dl class="kv kvw">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const empty = t => `<div class="empty">${esc(t)}</div>`;
  const tile = (l, v, s, c) => `<div class="tile ${c || ''}"><div class="eyebrow">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const mln = v => num(v, v < 100 ? 1 : 0);
  const CATS = M => M.docCats || DSF.DOC_CATS;
  const SECN = M => M.docSecNames || DSF.DOC_SECTIONS;
  const can = p => DSF.can(p);
  const secOn = (M, k) => H.secOn(M, k);

  /* ссылка на любой объект системы по id — единый способ связывать разделы */
  function objLink(M, id, label) {
    const R = DSF.resolve(M, id); const P = M.P;
    if (!R) return `<span class="faint">${esc(id)}</span>`;
    const o = R.obj;
    switch (R.kind) {
      case 'doc': return `<button class="qlink" type="button" data-go="${link(P.id, 'docs', o.id)}"><b>${esc(CATS(M)[o.cat].t)}</b> ${esc(label || o.code || o.title)}<span class="faint"> · ${esc(DSF.docStatusLabel(o, o.state))}</span></button>`;
      case 'ks': return `<button class="qlink" type="button" data-go="${link(P.id, 'budget', o.id)}"><b>КС</b> ${esc(label || o.contract.no + ' · ' + o.no)}<span class="faint"> · ${esc(ksSt(o).t)}</span></button>`;
      case 'order': return `<button class="qlink" type="button" data-go="${link(P.id, 'orders', o.id)}"><b>Поручение</b> № ${esc(o.no)}<span class="faint"> · ${esc(ordSt(o).t)} · ${esc(label || o.text)}</span></button>`;
      case 'protocol': return `<button class="qlink" type="button" data-go="${link(P.id, 'docs', o.id)}"><b>Протокол</b> № ${esc(o.no)} от ${fd(o.d)}</button>`;
      case 'letter': return `<button class="qlink" type="button" data-go="${link(P.id, 'docs', o.id)}"><b>${o.dir === 'in' ? 'Вх.' : 'Исх.'}</b> ${esc(o.no)}<span class="faint"> · ${esc(o.subject)}</span></button>`;
      case 'event': return `<button class="qlink" type="button" data-x="ev" data-id="${esc(o.id)}"><b>${esc((DSF.EVENT_TYPES[o.type] || {}).t || 'Событие')}</b> ${fd(o.date)}${o.time ? ' ' + esc(o.time) : ''}<span class="faint"> · ${esc(label || o.title)}</span></button>`;
      case 'contract': return `<button class="qlink" type="button" data-go="${link(P.id, 'budget', o.id)}"><b>Договор</b> ${esc(o.no)}<span class="faint"> · ${esc(o.contractor)}</span></button>`;
      case 'task': return `<button class="qlink" type="button" data-go="${link(P.id, 'schedule')}" data-task="${o.id}"><b>Работа</b> ${esc(o.name)}<span class="faint"> · ${Math.round(o.pct)}% · ${esc(o.st.t)}</span></button>`;
    }
    return '';
  }
  const links = (M, ids) => ids && ids.length ? `<div class="qlinks">${ids.map(id => objLink(M, id)).join('')}</div>` : '<span class="faint">—</span>';
  const linkBlock = (title, html) => html ? `<div class="lb"><div class="eyebrow">${title}</div>${html}</div>` : '';

  /* ====================================================================
   * РЕСУРСЫ
   * ==================================================================== */
  U.VIEWS.resources = function (M, r) {
    const P = M.P, R = M.res, tab = ['wf', 'contr', 'equip'].includes(r.sub) ? r.sub : 'wf';
    const entryBtn = `${can('settings') ? `<button class="btn" type="button" data-go="${link(P.id, 'settings', 'resources')}">${ico('gear')}Виды ресурсов</button>` : ''}<button class="btn primary" type="button" data-x="res-entry">${ico('plus')}Внести данные</button>`;
    if (!R.has) return { html: `${head(esc(P.name) + ' · ресурсы', 'Ресурсы', 'на площадке', 'Данные о численности и технике ещё не вносились.', entryBtn)}
      <section class="panel"><div class="pad"><div class="empty">Внесите данные за неделю: план и факт рабочих, ИТР, рабочих по подрядчикам, технику и оборудование по видам${R.kinds.length ? ' (' + R.kinds.map(k => esc(k.name)).join(', ') + ')' : ''}.</div></div></section>` };
    const n = R.weeks.length, delta = R.now - R.planNowWf;
    const tabs = [['wf', 'График движения рабочей силы'], ['contr', 'По подрядчикам'], ['equip', 'Техника']];
    let body = '';
    if (tab === 'wf') {
      body = `<section class="panel"><header><h2>График движения рабочей силы</h2><span class="sub">рабочие по неделям: план и факт, ИТР</span></header>
        <div class="pad">${H.wfBars(R, window.innerWidth < 768 ? { w: 420, h: 240 } : { w: 1100, h: 280 })}
          <div class="tbl-wrap" style="margin-top:14px"><table class="t"><thead><tr><th>Неделя</th><th>План, чел.</th><th>Факт, чел.</th><th>Отклонение</th><th>ИТР</th><th>Всего на площадке</th></tr></thead>
          <tbody>${R.weeks.map((w, i) => i).reverse().map(i => { const d = R.fact[i] - R.plan[i]; return `<tr><td>${fd(R.weeks[i])}</td><td>${num(R.plan[i])}</td><td><b>${num(R.fact[i])}</b></td><td class="${d < 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : d < 0 ? '−' : ''}${num(Math.abs(d))}</td><td>${R.itr[i] != null ? num(R.itr[i]) : '—'}</td><td>${num(R.fact[i] + (R.itr[i] || 0))}</td></tr>`; }).join('')}</tbody></table></div></div></section>`;
    } else if (tab === 'contr') {
      const tot = sum(R.byContractor, c => c.n) || 1;
      body = `<section class="panel"><header><h2>Рабочие по подрядчикам</h2><span class="sub">неделя ${fd(R.weeks[n - 1])}</span></header>
        <div class="pad"><div class="list">${R.byContractor.map(c => `<div class="li"><span class="t">${esc(c.name)}</span><span class="num"><b>${num(c.n)}</b> чел.</span><span class="m"><span class="minib"><span class="bar"><i style="width:${(c.n / tot * 100).toFixed(1)}%"></i></span><b>${Math.round(c.n / tot * 100)}%</b></span></span></div>`).join('')}</div>
        <div class="note" style="margin-top:12px">Итого ${num(tot)} чел. — совпадает с фактом недели (${num(R.now)}).</div></div></section>`;
    } else {
      const cats = [...new Set(R.equipment.map(e => e.cat || 'Техника'))];
      body = cats.map(c => { const list = R.equipment.filter(e => (e.cat || 'Техника') === c); return `<section class="panel"><header><h2>${esc(c)}</h2><span class="sub">${num(sum(list, e => e.count))} ${esc((list[0] || {}).unit || 'ед.')}</span></header>
        <div class="pad"><div class="list">${list.map(e => `<div class="li"><span class="t">${esc(e.name)}</span><span class="num"><b>${num(e.count)}</b> ${esc(e.unit || 'ед.')}</span></div>`).join('')}</div></div></section>`; }).join('') || `<section class="panel"><div class="pad">${empty('Техника и оборудование не вносились.')}</div></section>`;
    }
    const html = `${head(esc(P.name) + ' · ресурсы', 'Ресурсы', 'на площадке', 'Неделя ' + fd(R.weeks[n - 1]) + ' · данные суточных рапортов подрядчиков', entryBtn)}
      <section class="tiles">
        ${tile('Рабочие', num(R.now) + ' <small>чел.</small>', 'план ' + num(R.planNowWf), R.now < R.planNowWf * 0.95 ? 'warn' : '')}
        ${tile('ИТР', R.itrNow != null ? num(R.itrNow) + ' <small>чел.</small>' : '—', 'инженерно-технический персонал')}
        ${tile('Техника', R.equipment.length ? num(R.equipTotal) + ' <small>ед.</small>' : '—', R.equipment.length + ' ' + plural(R.equipment.length, 'вид', 'вида', 'видов') + ' ресурсов')}
        ${tile('Отклонение от плана', (delta > 0 ? '+' : delta < 0 ? '−' : '') + num(Math.abs(delta)) + ' <small>чел.</small>', 'за неделю ' + (R.now >= R.prev ? '+' : '−') + Math.abs(R.now - R.prev), delta < -R.planNowWf * 0.05 ? 'crit' : delta < 0 ? 'warn' : 'good')}
      </section>
      <div class="seg" role="tablist" aria-label="Ресурсы">${tabs.map(([k, t]) => `<button type="button" role="tab" data-go="${link(P.id, 'resources', k)}" aria-pressed="${tab === k}">${t}</button>`).join('')}</div>
      ${body}`;
    return { html, crumb: tabs.find(t => t[0] === tab)[1], crumbParent: null };
  };

  /* ====================================================================
   * КАЛЕНДАРЬ
   * ==================================================================== */
  const CAL_TYPES = ['conference', 'meeting', 'acceptance', 'inspection', 'rd', 'delivery', 'control', 'site', 'order', 'guarantee', 'remark', 'other', 'milestone', 'start', 'finish'];
  const USER_TYPES = Object.keys(DSF.EVENT_TYPES).filter(k => DSF.EVENT_TYPES[k].user);
  function calFilter(e) {
    if (!UI.calTypes) UI.calTypes = new Set(CAL_TYPES);
    return UI.calTypes.has(e.type);
  }
  const evBtn = (e, cls) => `<button class="ev ${cls || ''}" type="button" data-x="ev" data-id="${esc(e.id)}" title="${esc(e.title)}" style="box-shadow:inset 3px 0 0 ${H.evColor(e.type)}; ${e.done ? 'opacity:.72' : ''}">${e.time ? `<span class="tm">${esc(e.time)}</span> ` : ''}${esc(e.title)}</button>`;
  const evRow = e => `<button class="evr" type="button" data-x="ev" data-id="${esc(e.id)}"><span class="d">${fds(e.date)}${e.time ? '<br>' + esc(e.time) : ''}</span><span class="k" style="background:${H.evColor(e.type)}"></span><span class="x">${esc(e.title)}<small>${esc(DSF.EVENT_TYPES[e.type].t)}${e.user ? ' · создано в системе' : ''}${e.plan != null && e.date !== e.plan ? ' · план ' + fds(e.plan) : ''}${e.orderStatus === 'overdue' ? ' · просрочено' : ''}</small></span></button>`;

  U.VIEWS.calendar = function (M) {
    const P = M.P, t = T();
    const view = UI.calView || (window.innerWidth < 768 ? 'agenda' : 'month');
    const cm = UI.calMonth[P.id] != null ? UI.calMonth[P.id] : monthStart(t);
    const evs = M.events.filter(calFilter);
    const counts = Object.fromEntries(CAL_TYPES.map(k => [k, M.events.filter(e => e.type === k).length]));
    const byDay = new Map(); evs.forEach(e => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
    const past = M.feed.filter(calFilter).slice(0, 10), now = M.today.filter(calFilter), next = M.upcoming.filter(calFilter).slice(0, 10);
    let main = '';
    if (view === 'month') {
      const ms0 = cm, ms1 = monthEnd(cm), gs = ms0 - ((new Date(ms0 * 864e5).getUTCDay() + 6) % 7), cells = [];
      for (let d = gs; d <= ms1 || cells.length % 7; d++) cells.push(d);
      main = `<div class="cal-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells.map(d => { const list = (byDay.get(d) || []); return `<div class="cal-d ${d < ms0 || d > ms1 ? 'out' : ''} ${d === t ? 'td' : ''} ${d < t ? 'past' : ''}"><button class="n" type="button" data-x="ev-new" data-date="${iso(d)}" title="Создать событие ${fd(d)}">${new Date(d * 864e5).getUTCDate()}</button>${list.slice(0, 4).map(e => evBtn(e)).join('')}${list.length > 4 ? `<button class="ev more" type="button" data-x="cal-day" data-date="${d}">ещё ${list.length - 4}</button>` : ''}</div>`; }).join('')}</div>`;
    } else if (view === 'week') {
      const ws = UI.calWeek && UI.calWeek[P.id] != null ? UI.calWeek[P.id] : t - ((new Date(t * 864e5).getUTCDay() + 6) % 7);
      main = `<div class="wk">${Array.from({ length: 7 }, (_, i) => ws + i).map(d => { const list = (byDay.get(d) || []).slice().sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99'))); return `<div class="wk-d ${d === t ? 'td' : ''}"><div class="wk-h"><b>${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i_(d)]}</b> ${fds(d)}<button class="mini" type="button" data-x="ev-new" data-date="${iso(d)}" aria-label="Создать событие">${ico('plus', 14)}</button></div>${list.map(e => evBtn(e, 'wk-e')).join('') || '<div class="faint" style="font-size:12px; padding:6px">—</div>'}</div>`; }).join('')}</div>`;
    } else {
      const ms0 = cm, ms1 = monthEnd(cm);
      const daysL = [...new Set(evs.filter(e => e.date >= ms0 && e.date <= ms1).map(e => e.date))].sort((a, b) => a - b);
      main = `<div class="agenda">${daysL.map(d => `<div class="ag-day ${d < t ? 'past' : ''} ${d === t ? 'tdy' : ''}"><div class="dd">${new Date(d * 864e5).getUTCDate()}<small>${['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][new Date(d * 864e5).getUTCDay()]}</small></div><div>${byDay.get(d).map(e => `<button class="ag-ev" type="button" data-x="ev" data-id="${esc(e.id)}"><span class="dot" style="background:${H.evColor(e.type)}"></span><span style="min-width:0"><span>${e.time ? '<b>' + esc(e.time) + '</b> · ' : ''}${esc(e.title)}</span><span class="m">${esc(DSF.EVENT_TYPES[e.type].t)}${e.place ? ' · ' + esc(e.place) : ''}${e.done ? ' · состоялось' : ''}</span></span></button>`).join('')}</div></div>`).join('') || empty('В этом месяце нет событий выбранных типов.')}</div>`;
    }
    function i_(d) { return (new Date(d * 864e5).getUTCDay() + 6) % 7; }
    const md = new Date(cm * 864e5);
    const ws = UI.calWeek && UI.calWeek[P.id] != null ? UI.calWeek[P.id] : t - ((new Date(t * 864e5).getUTCDay() + 6) % 7);
    const period = view === 'week' ? fds(ws) + ' – ' + fd(ws + 6) : F.MONTHS_FULL[md.getUTCMonth()] + ' ' + md.getUTCFullYear();
    const html = `${head(esc(P.name) + ' · календарь проекта', 'Календарь', 'проекта', 'События проекта, протокольные поручения, приёмки, выдача РД и даты графика — в одном календаре. Прошедшие — по факту, будущие — по прогнозу.',
      `<button class="btn primary" type="button" data-x="ev-new">${ico('plus')}Событие</button>`)}
      <section class="panel tl">
        <header><h2>Что произошло <span class="faint">←</span> Сегодня <span class="faint">→</span> Что предстоит</h2></header>
        <div class="pad tl3">
          <div><div class="eyebrow">Последние 30 дней</div>${past.map(evRow).join('') || empty('Событий не было.')}</div>
          <div class="tl-today"><div class="eyebrow" style="color:var(--accent-2)">Сегодня, ${fd(t)}</div>${now.map(evRow).join('') || empty('Событий на сегодня нет.')}<button class="btn sm" type="button" data-x="ev-new" data-date="${iso(t)}" style="margin-top:8px">${ico('plus')}Добавить на сегодня</button></div>
          <div><div class="eyebrow">Ближайшие 45 дней</div>${next.map(evRow).join('') || empty('Событий не запланировано.')}</div>
        </div>
      </section>
      <section class="panel">
        <header>
          <div class="cal-h"><button class="icon-btn" type="button" data-x="cal-nav" data-dir="-1" aria-label="Назад">${ico('left')}</button><span class="mt">${period}</span><button class="icon-btn" type="button" data-x="cal-nav" data-dir="1" aria-label="Вперёд">${ico('right')}</button><button class="btn sm" type="button" data-x="cal-nav" data-dir="0">Сегодня</button></div>
          <span class="grow"></span>
          <div class="seg sm" role="group" aria-label="Вид">${[['month', 'Месяц'], ['week', 'Неделя'], ['agenda', 'Повестка']].map(([k, tt]) => `<button type="button" data-x="cal-view" data-v="${k}" aria-pressed="${view === k}">${tt}</button>`).join('')}</div>
        </header>
        <div class="pad">
          <div class="fchips" style="margin-bottom:14px" role="group" aria-label="Типы событий">${CAL_TYPES.map(k => `<button class="fchip" type="button" data-x="cal-type" data-t="${k}" aria-pressed="${calFilter({ type: k })}"><span class="dot" style="background:${H.evColor(k)}"></span>${DSF.EVENT_TYPES[k].t} <b>${counts[k]}</b></button>`).join('')}</div>
          ${main}
        </div>
      </section>`;
    return { html, crumb: null };
  };

  /* карточка события */
  function eventCard(M, id) {
    const e = M.evBy.get(id);
    if (!e) return `<div class="mh"><h3>Событие не найдено</h3><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>`;
    const P = M.P, ty = DSF.EVENT_TYPES[e.type];
    const protos = M.protocols.filter(p => p.event && (p.event === e.id || p.event === e.series));
    const ks = e.ksId ? M.ksBy.get(e.ksId) : M.ks.find(k => k.event === e.id || k.event === e.series);
    const lettersOf = M.letters.filter(l => l.eventIds.includes(e.id) || (e.series && l.eventIds.includes(e.series)));
    const editable = !e.sys;
    const lt = ty.letter;
    return `<div class="mh"><div style="min-width:0"><div class="eyebrow">${esc(ty.t)}${e.series ? ' · повторяется еженедельно' : ''}${e.user ? ' · создано в системе' : e.sys ? ' · формируется из данных проекта' : ''}</div><h3 style="margin-top:4px">${esc(e.title)}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="fchips">${chip(fd(e.date) + (e.time ? ', ' + e.time : ''), e.done ? 'neutral' : 'accent')}${e.dur ? chip(durText(e.dur), 'neutral') : ''}${e.done ? chip('Состоялось', 'good') : e.date === T() ? chip('Сегодня', 'accent') : chip('Предстоит', 'neutral')}${e.plan != null && e.plan !== e.date ? chip('план ' + fd(e.plan), 'warn') : ''}</div>
        ${kv([e.place ? ['Место', esc(e.place)] : null, e.owner ? ['Ответственный', esc(e.owner)] : null, e.people && e.people.length ? ['Участники', esc(e.people.join(', '))] : null, e.desc ? ['Описание', esc(e.desc)] : null])}
        ${linkBlock('Связанные работы', e.tasks && e.tasks.length ? `<div class="qlinks">${e.tasks.map(x => objLink(M, x.id)).join('')}</div>` : '')}
        ${linkBlock('Связанные документы', (e.docIds || []).length ? links(M, e.docIds) : '')}
        ${linkBlock('Протокольное поручение', e.orderId ? links(M, [e.orderId]) : '')}
        ${linkBlock('КС-2 / заявка на приёмку', ks ? links(M, [ks.id]) : '')}
        ${linkBlock('Протокол совещания', protos.length ? links(M, protos.map(p => p.id)) : '')}
        ${linkBlock('Письма', lettersOf.length ? links(M, lettersOf.map(l => l.id)) : '')}
        ${DSF.uiFlow ? DSF.uiFlow.eventExtra(M, e) : ''}
      </div>
      <div class="mf">
        ${lt ? `<button class="btn primary" type="button" data-x="letter" data-id="${esc(e.id)}">${ico('mail')}${lt === 'invite' ? 'Подготовить приглашение' : 'Подготовить письмо'}</button>` : ''}
        ${editable ? `<button class="btn" type="button" data-x="ev-edit" data-id="${esc(e.series || e.id)}">${ico('edit')}Редактировать${e.series ? ' серию' : ''}</button>` : ''}
        ${e.user && !e.series ? `<button class="btn" type="button" data-x="ev-del" data-id="${esc(e.id)}">Удалить</button>` : ''}
        ${e.tasks && e.tasks[0] ? `<button class="btn" type="button" data-go="${link(P.id, 'schedule')}" data-task="${e.tasks[0].id}">${ico('gantt')}В графике</button>` : ''}
      </div>`;
  }

  /* форма события: создание и редактирование */
  function eventForm(M) {
    const d = UI.evDraft, P = M.P;
    const docs = M.documents.filter(x => ['rd', 'pd', 'id'].includes(x.cat));
    const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
    return `<form data-form="event" class="mform"><div class="mh"><div><div class="eyebrow">${d.editId ? 'Редактирование события' : 'Новое событие'}${d.ks ? ' · приёмка по КС-2' : ''}</div><h3 style="margin-top:4px">${esc(d.title || 'Событие проекта')}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="fld"><label for="ev-title">Название</label><input id="ev-title" name="title" required value="${esc(d.title || '')}" autofocus></div>
        <div class="row-f"><div class="fld"><label for="ev-type">Тип</label><select id="ev-type" name="type">${USER_TYPES.map(k => opt(k, DSF.EVENT_TYPES[k].t, k === d.type)).join('')}</select></div>
          <div class="fld"><label for="ev-owner">Ответственный</label><input id="ev-owner" name="owner" value="${esc(d.owner || '')}"></div></div>
        <div class="row-f3"><div class="fld"><label for="ev-date">Дата</label><input id="ev-date" name="date" type="date" required value="${esc(d.date || today())}"></div>
          <div class="fld"><label for="ev-time">Время</label><input id="ev-time" name="time" type="time" value="${esc(d.time || '10:00')}"></div>
          <div class="fld"><label for="ev-dur">Длительность, мин</label><input id="ev-dur" name="dur" type="number" min="0" step="15" value="${esc(d.dur != null ? d.dur : 60)}"></div></div>
        <div class="fld"><label for="ev-place">Место</label><input id="ev-place" name="place" value="${esc(d.place || '')}" placeholder="Например: штаб строительства, корпус 1"></div>
        <div class="fld"><label for="ev-people">Участники</label><textarea id="ev-people" name="people" placeholder="По одному на строку: организация или ФИО">${esc((d.people || []).join('\n'))}</textarea></div>
        <div class="fld"><label for="ev-desc">Описание / повестка</label><textarea id="ev-desc" name="desc">${esc(d.desc || '')}</textarea></div>
        <div class="row-f"><div class="fld"><label for="ev-tasks">Связанные работы</label><select id="ev-tasks" name="tasks" multiple size="6">${M.tasks.filter(x => !x.ms).map(x => opt(x.id, x.name, (d.tasks || []).includes(x.id))).join('')}</select><span class="hint">Ctrl/⌘ — выбрать несколько</span></div>
          <div class="fld"><label for="ev-docs">Связанные документы</label><select id="ev-docs" name="docs" multiple size="6">${docs.map(x => opt(x.id, CATS(M)[x.cat].t + ' · ' + x.code + ' · ' + x.title, (d.docs || []).includes(x.id))).join('')}</select></div></div>
        <div class="fld"><label for="ev-order">Протокольное поручение</label><select id="ev-order" name="order">${opt('', '— не связано —', !d.order)}${M.orders.map(o => opt(o.id, '№ ' + o.no + ' · ' + o.text, d.order === o.id)).join('')}</select></div>
        ${d.ks ? `<div class="note">Событие будет связано с ${esc(M.ksBy.get(d.ks).contract.no)} · ${esc(M.ksBy.get(d.ks).no)}; заявка перейдёт в статус «Направлено на приёмку».</div>` : ''}
        <div class="err" id="ev-err" hidden></div>
      </div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}${d.editId ? 'Сохранить изменения' : 'Создать событие'}</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.FORMS.event = function (f, r) {
    const fd_ = new FormData(f), d = UI.evDraft, pid = r.pid;
    const multi = n => [...f.querySelector('[name="' + n + '"]').selectedOptions].map(o => o.value);
    const rec = {
      title: String(fd_.get('title') || '').trim(), type: fd_.get('type'), date: fd_.get('date'), time: fd_.get('time') || '', dur: +fd_.get('dur') || 0,
      place: String(fd_.get('place') || '').trim(), owner: String(fd_.get('owner') || '').trim(), desc: String(fd_.get('desc') || '').trim(),
      people: String(fd_.get('people') || '').split(/\n|;/).map(x => x.trim()).filter(Boolean), tasks: multi('tasks'), docs: multi('docs'), order: fd_.get('order') || null
    };
    const err = f.querySelector('#ev-err');
    if (!rec.title || !rec.date) { err.hidden = false; err.textContent = 'Укажите название и дату события.'; return; }
    let id = d.editId;
    store.update(pid, s => {
      if (d.editId) s.eventOps.push({ op: 'edit', id: d.editId, patch: Object.assign({}, rec, { task: null, rel: null, offset: null }) });
      else {
        id = 'ev-u' + (s.seq++);
        s.events.push(Object.assign({ id, ks: d.ks || null }, rec));
        if (d.ks) s.ksOps.push({ ks: d.ks, to: 'accept', event: id, date: today(), by: ROLE.tz, text: 'Назначена приёмка работ на ' + F.date(dn(rec.date)) + (rec.time ? ' ' + rec.time : '') });
        if (d.forOrder) s.orderOps.push({ order: d.forOrder, op: 'link-event', event: id, date: today(), by: ROLE.tz });
      }
    });
    UI.evDraft = null;
    closeModal();
    keepPage();
    toast(`${d.editId ? 'Событие обновлено' : 'Событие создано'}: <b>${esc(rec.title)}</b>, ${F.date(dn(rec.date))}${rec.time ? ' ' + esc(rec.time) : ''}<div class="ta"><button type="button" data-x="ev" data-id="${esc(id)}">Открыть</button>${DSF.EVENT_TYPES[rec.type].letter ? `<button type="button" data-x="letter" data-id="${esc(id)}">${DSF.EVENT_TYPES[rec.type].letter === 'invite' ? 'Подготовить приглашение' : 'Подготовить письмо'}</button>` : ''}</div>`, 7000);
  };
  function startEventForm(M, preset) {
    UI.evDraft = Object.assign({ type: 'conference', date: today(), time: '10:00', dur: 60, people: [], tasks: [], docs: [] }, preset || {});
    openModal(eventForm, { wide: true });
  }

  /* ---------- письма из календаря: черновик без отправки ---------- */
  function letterFor(M, e) {
    const P = M.P, ty = DSF.EVENT_TYPES[e.type];
    const when = F.date(e.date) + (e.time ? ' в ' + e.time : '');
    const dur = e.dur ? ' (продолжительность — ' + durText(e.dur) + ')' : '';
    const place = e.place || 'на объекте';
    const works = (e.tasks || []).map(t => '— ' + t.name).join('\n');
    const docs = (e.docIds || []).map(id => DSF.resolve(M, id)).filter(Boolean).map(R => '— ' + (R.obj.code ? R.obj.code + ' «' + R.obj.title + '»' + (R.obj.cur ? ', ред. ' + R.obj.cur.rev : '') : (R.obj.no || R.obj.title)));
    const ks = e.ksId ? M.ksBy.get(e.ksId) : null;
    const obj = `объекту «${P.fullName}» (${P.address})`;
    const sign = `\n\nС уважением,\n${P.customer}`;
    let subject, intro, extra = '';
    switch (e.type) {
      case 'meeting': case 'conference':
        subject = `Приглашение: ${e.title} — ${F.date(e.date)}`;
        intro = `Приглашаем Вас принять участие в ${e.type === 'conference' ? 'совещании' : 'встрече'} по ${obj}.\n\nТема: ${e.title}.\nДата и время: ${when}${dur}.\nМесто: ${place}.`;
        extra = (e.desc ? `\nПовестка: ${e.desc}` : '') + '\n\nПросим подтвердить участие и состав представителей.';
        break;
      case 'acceptance':
        subject = `Приглашение на приёмку работ — ${F.date(e.date)}`;
        intro = `Приглашаем уполномоченных представителей на приёмку выполненных работ по ${obj}.\n\nПредмет приёмки: ${e.title}.\nДата и время: ${when}${dur}.\nМесто: ${place}.`;
        if (ks) extra += `\nОснование: договор ${ks.contract.no} от ${F.date(ks.contract.d)} (${ks.contract.contractor}), ${ks.no} за ${mon(ks.period)}; заявлено подрядчиком ${F.money(ks.claimed)}.`;
        extra += '\n\nПросим обеспечить присутствие представителей и подготовить комплект исполнительной документации на предъявляемые работы.';
        break;
      case 'inspection':
        subject = `Уведомление об освидетельствовании — ${F.date(e.date)}`;
        intro = `Уведомляем о проведении освидетельствования ${e.title.toLowerCase().startsWith('освидетельствование') ? '' : 'работ / конструкций '}по ${obj}.\n\nПредмет: ${e.title}.\nДата и время: ${when}.\nМесто: ${place}.`;
        extra = '\n\nПросим обеспечить явку представителей для подписания актов освидетельствования.';
        break;
      case 'rd':
        subject = `Уведомление о выдаче рабочей документации в производство работ`;
        intro = `Уведомляем о выдаче рабочей документации в производство работ по ${obj}.\n\nДата выдачи: ${F.date(e.date)}.`;
        extra = '\n\nПросим принять документацию к производству работ и обеспечить выполнение работ по актуальной редакции. Предыдущие редакции считать недействительными для производства.';
        break;
      case 'delivery':
        subject = `Уведомление о поставке — ${F.date(e.date)}`;
        intro = `Уведомляем о поставке на ${obj}.\n\nПредмет поставки: ${e.title}.\nДата и время: ${when}.\nМесто приёмки: ${place}.`;
        extra = '\n\nПросим обеспечить готовность площадки складирования, подъёмных механизмов и представителей для приёмки по количеству и качеству.';
        break;
      default:
        subject = `${e.title} — ${F.date(e.date)}`;
        intro = `Информируем по ${obj}.\n\nСобытие: ${e.title}.\nДата: ${when}.${e.place ? '\nМесто: ' + e.place + '.' : ''}`;
        extra = e.desc ? '\n\n' + e.desc : '';
    }
    const body = `Уважаемые коллеги!\n\n${intro}${works ? '\n\nСвязанные работы:\n' + works : ''}${docs.length ? '\n\nДокументы:\n' + docs.join('\n') : ''}${extra}${sign}`;
    return { eventId: e.id, kind: ty.letter, to: (e.people && e.people.length ? e.people : [e.owner].filter(Boolean)).join(', '), subject, body };
  }
  function letterModal(M) {
    const L = UI.letterDraft, e = M.evBy.get(L.eventId);
    return `<div class="mh"><div><div class="eyebrow">${L.kind === 'invite' ? 'Приглашение' : 'Письмо'} · черновик</div><h3 style="margin-top:4px">${esc(e ? e.title : '')}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="note warn">Демо-режим: почтовая интеграция не подключена — письмо не отправляется. Скопируйте текст в вашу почту или сохраните черновик в раздел «Документы → Письма». Адреса электронной почты в данных проекта не хранятся и не подставляются.</div>
        <div class="fld"><label for="letter-to">Кому</label><input id="letter-to" value="${esc(L.to)}"></div>
        <div class="fld"><label for="letter-subj">Тема</label><input id="letter-subj" value="${esc(L.subject)}"></div>
        <div class="fld"><label for="letter-body">Текст</label><textarea id="letter-body" rows="16" style="height:auto">${esc(L.body)}</textarea></div>
      </div>
      <div class="mf"><button class="btn primary" type="button" data-x="letter-save">${ico('check')}Сохранить черновик в «Письма»</button><button class="btn" type="button" data-x="letter-copy">${ico('copy')}Скопировать текст</button><button class="btn" type="button" data-act="x-close">Закрыть</button></div>`;
  }
  ['letter-to', 'letter-subj', 'letter-body'].forEach(id => { U.INPUTS[id] = e => { if (!UI.letterDraft) return; const k = { 'letter-to': 'to', 'letter-subj': 'subject', 'letter-body': 'body' }[id]; UI.letterDraft[k] = e.target.value; }; });

  /* ====================================================================
   * ПРОТОКОЛЬНЫЕ ПОРУЧЕНИЯ
   * ==================================================================== */
  const ORD_FILTERS = [['active', 'Открытые'], ['overdue', 'Просрочено'], ['new', 'Новые'], ['work', 'В работе'], ['done', 'Выполнено'], ['all', 'Все']];
  const matchOrd = (o, f) => f === 'all' ? true : f === 'active' ? o.status !== 'done' : o.status === f;
  U.VIEWS.orders = function (M, r) {
    const P = M.P;
    if (r.sub && M.orderBy.get(r.sub)) return orderCard(M, M.orderBy.get(r.sub));
    const f = UI.ordFilter || 'active';
    const list = M.orders.filter(o => matchOrd(o, f)).sort((a, b) => ((a.status === 'overdue' ? 0 : 1) - (b.status === 'overdue' ? 0 : 1)) || ((a.priority === 'critical' ? 0 : 1) - (b.priority === 'critical' ? 0 : 1)) || (a.due - b.due));
    const cnt = k => M.orders.filter(o => matchOrd(o, k)).length;
    const html = `${head(esc(P.name) + ' · исполнение решений', 'Протокольные', 'поручения', 'Поручения формируются из протоколов совещаний. Просроченные и критические автоматически попадают в «Требует внимания» на Обзоре, сроки — в Календарь.',
      `<button class="btn primary" type="button" data-x="ord-new">${ico('plus')}Поручение</button>`)}
      <section class="tiles">
        ${tile('Всего', num(M.orders.length), M.protocols.length + ' ' + plural(M.protocols.length, 'протокол', 'протокола', 'протоколов'))}
        ${tile('Открытые', num(cnt('active')), 'новые и в работе')}
        ${tile('Просрочено', num(cnt('overdue')), 'срок истёк', cnt('overdue') ? 'crit' : 'good')}
        ${tile('Критические', num(M.orders.filter(o => o.priority === 'critical' && o.status !== 'done').length), 'не выполнены', M.orders.some(o => o.priority === 'critical' && o.status !== 'done') ? 'warn' : '')}
        ${tile('Выполнено', num(cnt('done')), pct(cnt('done') / Math.max(1, M.orders.length) * 100, 0) + ' от общего числа', 'good')}
      </section>
      <section class="panel">
        <header><div class="seg sm" role="group" aria-label="Статус">${ORD_FILTERS.map(([k, t]) => `<button type="button" data-x="ord-filter" data-f="${k}" aria-pressed="${f === k}">${t} <b>${cnt(k)}</b></button>`).join('')}</div></header>
        <div class="pad tbl-wrap"><table class="t">
          <thead><tr><th>№</th><th class="l">Поручение</th><th class="l">Протокол</th><th class="l">Ответственный</th><th>Поставлено</th><th>Срок</th><th>Приоритет</th><th>Статус</th></tr></thead>
          <tbody>${list.map(o => `<tr class="link" data-go="${link(P.id, 'orders', o.id)}"><td><b>${esc(o.no)}</b></td><td class="l w">${esc(o.text)}</td><td class="l">${o.protocol ? '№ ' + esc(o.protocol.no) + ' от ' + fds(o.protocol.d) : '<span class="faint">—</span>'}</td><td class="l w" style="min-width:150px">${esc(o.owner)}</td><td>${fd(o.set)}</td><td style="${o.status === 'overdue' ? 'color:var(--crit); font-weight:650' : ''}">${fd(o.due)}</td><td>${chip(DSF.ORDER_PRIORITY[o.priority].t, DSF.ORDER_PRIORITY[o.priority].c)}</td><td>${chip(ordSt(o).t, ordSt(o).c)}</td></tr>`).join('') || `<tr><td colspan="8" class="l">${empty('Поручений с таким статусом нет.')}</td></tr>`}</tbody>
        </table></div>
      </section>
      <section class="panel">
        <header><h2>Протоколы</h2><span class="sub">источник поручений</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'docs', 'protocols')}">В документах ${ico('chev')}</button></header>
        <div class="pad"><div class="list">${M.protocols.slice().sort((a, b) => b.d - a.d).map(p => `<button class="li btnrow" type="button" data-go="${link(P.id, 'docs', p.id)}"><span class="t">Протокол № ${esc(p.no)} от ${fd(p.d)} — ${esc(p.title)}</span><span>${chip(p.orders.length + ' ' + plural(p.orders.length, 'поручение', 'поручения', 'поручений'), 'neutral')}</span><span class="m">${esc(p.chair)} · открыто ${p.orders.filter(o => o.status !== 'done').length}, просрочено ${p.orders.filter(o => o.status === 'overdue').length}</span></button>`).join('')}</div></div>
      </section>`;
    return { html };
  };
  function orderCard(M, o) {
    const P = M.P, lets = M.letters.filter(l => l.orderIds.includes(o.id));
    const deadline = M.evBy.get('ord-' + o.id);
    const html = `<div class="topback">${backBtn(link(P.id, 'orders'), 'Все поручения')}</div>
      <section class="panel">
        <header><div style="min-width:0; flex:1"><div class="eyebrow">Протокольное поручение № ${esc(o.no)}${o.user ? ' · создано в системе' : ''}</div><h2 style="margin-top:6px">${esc(o.text)}</h2></div>
          <div class="fchips">${chip(ordSt(o).t, ordSt(o).c)}${chip(DSF.ORDER_PRIORITY[o.priority].t, DSF.ORDER_PRIORITY[o.priority].c)}</div></header>
        <div class="pad grid2" style="gap:24px">
          <div>
            ${kv([['Номер', esc(o.no)], ['Источник', o.protocol ? `<button class="lnk" type="button" data-go="${link(P.id, 'docs', o.protocol.id)}">Протокол № ${esc(o.protocol.no)} от ${fd(o.protocol.d)}</button>` : 'поставлено вне протокола'], ['Дата постановки', fd(o.set)], ['Срок', `<b style="${o.status === 'overdue' ? 'color:var(--crit)' : ''}">${fd(o.due)}</b>${o.status === 'overdue' ? ' · просрочено на ' + (T() - o.due) + ' дн.' : ''}`], ['Ответственный', esc(o.owner)], o.doneD != null ? ['Выполнено', fd(o.doneD)] : null, ['Комментарий', o.comment ? esc(o.comment) : '<span class="faint">—</span>']])}
            <div class="mf" style="padding:16px 0 0">
              ${o.raw === 'new' ? `<button class="btn primary" type="button" data-x="ord-status" data-id="${o.id}" data-to="work">Принять в работу</button>` : ''}
              ${o.status !== 'done' ? `<button class="btn ${o.raw === 'new' ? '' : 'primary'}" type="button" data-x="ord-done" data-id="${o.id}">${ico('check')}Отметить выполненным</button>` : `<button class="btn" type="button" data-x="ord-status" data-id="${o.id}" data-to="work">Вернуть в работу</button>`}
              <button class="btn" type="button" data-x="ord-comment" data-id="${o.id}">${ico('edit')}Комментарий</button>
              <button class="btn" type="button" data-x="ord-event" data-id="${o.id}">${ico('cal')}Назначить событие</button>
            </div>
          </div>
          <div>
            ${linkBlock('Календарь', (deadline ? objLink(M, deadline.id, 'срок исполнения') : '') + (o.eventId ? objLink(M, o.eventId) : ''))}
            ${linkBlock('Связанные работы', o.tasks.length ? `<div class="qlinks">${o.tasks.map(x => objLink(M, x.id)).join('')}</div>` : '')}
            ${linkBlock('Связанные документы', o.docIds.length ? links(M, o.docIds) : '')}
            ${linkBlock('Письма', lets.length ? links(M, lets.map(l => l.id)) : '')}
            ${linkBlock('Риск', o.riskId ? `<button class="qlink" type="button" data-go="${link(P.id, 'risks')}"><b>Риск</b> ${esc((M.risks.find(r => r.id === o.riskId) || {}).title || '')}</button>` : '')}
          </div>
        </div>
      </section>
      <section class="panel"><header><h2>История</h2></header><div class="pad"><div class="feed">${o.history.slice().sort((a, b) => b.d - a.d).map(h => H.feedRow(h.d, 'var(--accent)', esc(h.text), h.by || '')).join('')}</div></div></section>`;
    return { html, crumb: 'Поручение № ' + o.no };
  }
  function orderForm(M) {
    const d = UI.ordDraft, opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
    return `<form data-form="order" class="mform"><div class="mh"><div><div class="eyebrow">Новое протокольное поручение</div><h3 style="margin-top:4px">${d.protocol ? 'По протоколу № ' + esc(M.protocolBy.get(d.protocol).no) : 'Поручение'}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="fld"><label for="or-protocol">Протокол-источник</label><select id="or-protocol" name="protocol">${opt('', '— без протокола —', !d.protocol)}${M.protocols.slice().sort((a, b) => b.d - a.d).map(p => opt(p.id, '№ ' + p.no + ' от ' + F.date(p.d) + ' — ' + p.title, d.protocol === p.id)).join('')}</select></div>
        <div class="fld"><label for="or-text">Формулировка</label><textarea id="or-text" name="text" required autofocus>${esc(d.text || '')}</textarea></div>
        <div class="row-f"><div class="fld"><label for="or-owner">Ответственный</label><input id="or-owner" name="owner" required value="${esc(d.owner || '')}"></div>
          <div class="fld"><label for="or-due">Срок</label><input id="or-due" name="due" type="date" required value="${esc(d.due || iso(T() + 7))}"></div></div>
        <div class="row-f"><div class="fld"><label for="or-pr">Приоритет</label><select id="or-pr" name="priority">${Object.keys(DSF.ORDER_PRIORITY).map(k => opt(k, DSF.ORDER_PRIORITY[k].t, (d.priority || 'normal') === k)).join('')}</select></div>
          <div class="fld"><label for="or-tasks">Связанные работы</label><select id="or-tasks" name="tasks" multiple size="4">${M.tasks.filter(x => !x.ms).map(x => opt(x.id, x.name, (d.tasks || []).includes(x.id))).join('')}</select></div></div>
        <div class="fld"><label for="or-docs">Связанные документы</label><select id="or-docs" name="docs" multiple size="4">${M.documents.map(x => opt(x.id, CATS(M)[x.cat].t + ' · ' + x.code + ' · ' + x.title, (d.docs || []).includes(x.id))).join('')}</select></div>
        <div class="fld"><label for="or-comment">Комментарий</label><input id="or-comment" name="comment" value=""></div>
      </div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Создать поручение</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.FORMS.order = function (f, r) {
    const fd_ = new FormData(f), M = M0();
    const multi = n => [...f.querySelector('[name="' + n + '"]').selectedOptions].map(o => o.value);
    const proto = fd_.get('protocol') || null;
    const rec = { text: String(fd_.get('text') || '').trim(), owner: String(fd_.get('owner') || '').trim(), due: fd_.get('due'), priority: fd_.get('priority'), tasks: multi('tasks'), docs: multi('docs'), comment: String(fd_.get('comment') || '').trim(), protocol: proto, set: today(), status: 'new' };
    if (!rec.text || !rec.owner || !rec.due) return;
    if (dn(rec.due) < T()) { toast('Срок поручения не может быть раньше отчётной даты ' + F.date(T()) + '.'); return; }
    let id;
    store.update(r.pid, s => {
      id = 'or-u' + (s.seq++);
      const p = proto ? M.protocolBy.get(proto) : null;
      rec.no = p ? p.no + '/' + (p.orders.length + 1 + s.orders.filter(o => o.protocol === proto).length) : 'П-' + (s.orders.filter(o => !o.protocol).length + 1);
      s.orders.push(Object.assign({ id }, rec));
    });
    UI.ordDraft = null; closeModal();
    H.go(link(r.pid, 'orders', id));
    toast('Поручение № ' + esc(rec.no) + ' создано. Срок исполнения появился в Календаре.');
  };
  function smallForm(title, label, name, val, form, extra) {
    return `<form data-form="${form}" class="mform"><div class="mh"><h3>${esc(title)}</h3><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">${extra || ''}<div class="fld"><label for="sf-${name}">${esc(label)}</label><textarea id="sf-${name}" name="${name}" autofocus>${esc(val || '')}</textarea></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.FORMS['ord-done'] = function (f, r) {
    const c = String(new FormData(f).get('comment') || '').trim();
    store.update(r.pid, s => s.orderOps.push({ order: UI.ordTarget, op: 'status', to: 'done', date: today(), comment: c, by: ROLE.tz }));
    closeModal(); keepPage(); toast('Поручение отмечено выполненным. «Требует внимания» на Обзоре обновлён.');
  };
  U.FORMS['ord-comment'] = function (f, r) {
    const c = String(new FormData(f).get('comment') || '').trim(); if (!c) return;
    store.update(r.pid, s => s.orderOps.push({ order: UI.ordTarget, op: 'comment', comment: c, date: today(), by: ROLE.tz }));
    closeModal(); keepPage();
  };

  /* ====================================================================
   * ДОКУМЕНТЫ
   * ==================================================================== */
  const CAT_BASE = ['rd', 'pd', 'id', 'ks', 'reports', 'letters', 'protocols', 'permits', 'contracts'];
  const catOrder = M => CAT_BASE.concat(Object.keys(CATS(M)).filter(k => !CAT_BASE.includes(k)));
  const UPLOAD_CATS = M => ['rd', 'pd', 'id', 'reports', 'permits'].concat(Object.keys(CATS(M)).filter(k => CATS(M)[k].custom));
  function catCount(M, c) {
    if (c === 'ks') return M.ks.length;
    if (c === 'letters') return M.letters.length;
    if (c === 'protocols') return M.protocols.length;
    if (c === 'contracts') return M.contracts.length;
    return M.documents.filter(d => d.cat === c).length;
  }
  function secStats(docs) {
    const st = { plan: docs.length, loaded: 0, none: 0, rev: 0, actual: 0, prod: 0, ret: 0, up: 0, sup: 0 };
    docs.forEach(d => {
      if (d.versions.length) st.loaded++; else st.none++;
      if (d.state === 'rev') st.rev++;
      if (d.state === 'ok' || d.state === 'prod') st.actual++;
      if (d.state === 'ret') st.ret++;
      if (d.state === 'up') st.up++;
      if (d.prod) st.prod++;
      st.sup += d.versions.filter(v => v.shown === 'sup').length;
    });
    return st;
  }
  function docRow(M, d) {
    const P = M.P;
    return `<tr class="link" data-go="${link(P.id, 'docs', d.id)}"><td><b>${esc(d.code)}</b>${d.user ? ' <span class="chip accent">новый</span>' : ''}</td><td class="l w">${esc(d.title)}</td><td class="l">${esc(d.section)}</td><td>${d.cur ? esc(d.cur.rev) : '—'}</td><td>${chip(DSF.docStatusLabel(d, d.state), docSt(d).c)}</td>
      <td>${d.prod ? `<span class="prodmark">${ico('check', 13)} ред. ${esc(d.prod.rev)} · ${fd(d.prod.sent)}</span>` : (d.cat === 'rd' ? '<span class="faint">не передано</span>' : '')}</td>
      <td>${d.cur ? fd(d.cur.d) : ''}</td><td class="l" style="max-width:220px; white-space:normal">${d.tasks.map(t => esc(t.name)).slice(0, 2).join('; ')}${d.tasks.length > 2 ? ' …' : ''}</td></tr>`;
  }
  U.VIEWS.docs = function (M, r) {
    const P = M.P;
    if (r.sub && !CATS(M)[r.sub]) {
      const R = DSF.resolve(M, r.sub);
      if (R && R.kind === 'doc') return docCard(M, R.obj);
      if (R && R.kind === 'protocol') return protocolCard(M, R.obj);
      if (R && R.kind === 'letter') return letterCard(M, R.obj);
    }
    const cat = CATS(M)[r.sub] ? r.sub : (CATS(M)[UI.docCat] ? UI.docCat : 'rd');
    UI.docCat = cat;
    let body = '';
    if (cat === 'rd' || cat === 'pd' || CATS(M)[cat].custom) body = viewRdPd(M, cat);
    else if (cat === 'id') body = viewId(M);
    else if (cat === 'ks') body = viewKsList(M);
    else if (cat === 'letters') body = viewLetters(M);
    else if (cat === 'protocols') body = viewProtocols(M);
    else if (cat === 'contracts') body = viewContractsDoc(M);
    else body = viewSimple(M, cat);
    const html = `${head(esc(P.name) + ' · документооборот', 'Документы', 'проекта', 'Каждый документ — объект системы: раздел, шифр, редакции со статусами и историей, связи с работами, событиями, поручениями и КС-2.',
      `${can('settings') ? `<button class="btn" type="button" data-go="${link(P.id, 'settings', 'docs')}">${ico('gear')}Структура</button>` : ''}<button class="btn primary" type="button" data-x="doc-upload" data-cat="${UPLOAD_CATS(M).includes(cat) ? cat : 'rd'}">${ico('upload')}Загрузить документ</button>`)}
      <div class="seg doc-tabs" role="tablist" aria-label="Категории">${catOrder(M).map(c => `<button type="button" role="tab" data-go="${link(P.id, 'docs', c)}" aria-pressed="${cat === c}" title="${esc(CATS(M)[c].full)}">${CATS(M)[c].t} <b>${catCount(M, c)}</b></button>`).join('')}</div>
      ${body}`;
    return { html, crumb: CATS(M)[cat].full };
  };
  function viewRdPd(M, cat) {
    const P = M.P, docs = M.documents.filter(d => d.cat === cat);
    // разделы: настроенные для объекта (в т. ч. пустые) и встречающиеся в документах
    const cfgSecs = (M.docSections || []).filter(x => x.cat === cat);
    const secs = [...new Set(cfgSecs.map(x => x.code).concat(docs.map(d => d.section)).filter(x => x != null))];
    const parentOf = code => (cfgSecs.find(x => x.code === code) || {}).parent || '';
    const sel = (UI.docSection || {})[P.id + cat] || 'all';
    const all = secStats(docs);
    const cards = secs.map(sc => {
      const st = secStats(docs.filter(d => d.section === sc)), w = v => st.plan ? (v / st.plan * 100).toFixed(1) + '%' : '0%';
      return `<button class="sec-card" type="button" data-x="doc-sec" data-cat="${cat}" data-sec="${esc(sc)}" aria-pressed="${sel === sc}">
        <span class="sec-h"><b>${esc(sc || 'Без раздела')}</b><span>${esc(SECN(M)[sc] || sc)}${parentOf(sc) ? ' · подраздел ' + esc(parentOf(sc)) : ''}</span></span>
        <span class="stack" style="height:8px"><i style="width:${w(cat === 'rd' ? st.prod : st.actual)}; background:var(--good)"></i><i style="width:${w(cat === 'rd' ? Math.max(0, st.actual - st.prod) : 0)}; background:var(--accent)"></i><i style="width:${w(st.rev)}; background:var(--accent-2)"></i><i style="width:${w(st.up + st.ret)}; background:var(--warn)"></i></span>
        <span class="sec-n"><span>Предусмотрено <b>${st.plan}</b></span><span>Загружено <b>${st.loaded}</b></span>${st.none ? `<span class="w">Нет <b>${st.none}</b></span>` : ''}${st.rev ? `<span>На проверке <b>${st.rev}</b></span>` : ''}<span>Актуально <b>${st.actual}</b></span>${cat === 'rd' ? `<span>Передано <b>${st.prod}</b></span>` : ''}${st.sup ? `<span class="faint">Заменено ред. <b>${st.sup}</b></span>` : ''}${st.ret ? `<span class="w">С замечаниями <b>${st.ret}</b></span>` : ''}</span>
      </button>`;
    }).join('');
    const list = docs.filter(d => sel === 'all' || d.section === sel).sort((a, b) => a.section.localeCompare(b.section) || a.code.localeCompare(b.code));
    return `<section class="tiles">
        ${tile('Предусмотрено', num(all.plan), secs.length + ' ' + plural(secs.length, 'раздел', 'раздела', 'разделов'))}
        ${tile('Загружено', num(all.loaded), all.none ? 'отсутствует ' + all.none : 'все документы загружены', all.none ? 'warn' : 'good')}
        ${tile('На проверке', num(all.rev), all.ret ? 'возвращено с замечаниями ' + all.ret : '')}
        ${tile('Актуально', num(all.actual), 'согласованные редакции', 'good')}
        ${cat === 'rd' ? tile('Передано в производство', num(all.prod), 'заменено редакций ' + all.sup, 'good') : tile('Заменено редакций', num(all.sup), 'хранятся в истории')}
      </section>
      <section class="panel"><header><h2>${cat === 'rd' ? 'Разделы рабочей документации' : cat === 'pd' ? 'Разделы проектной документации' : 'Разделы: ' + esc(CATS(M)[cat].full)}</h2><span class="sub">нажмите раздел, чтобы отфильтровать реестр</span>${sel !== 'all' ? `<span class="grow"></span><button class="lnk" type="button" data-x="doc-sec" data-cat="${cat}" data-sec="all">Все разделы</button>` : ''}</header>
        <div class="pad">${secs.length ? `<div class="sec-grid">${cards}</div>` : `<div class="empty">Разделы не заданы.${can('settings') ? ` <button class="lnk" type="button" data-go="${link(P.id, 'settings', 'docs')}">Создать структуру документации ${ico('chev')}</button>` : ''}</div>`}
        <div class="legend" style="margin-top:12px">${cat === 'rd' ? '<span><i style="background:var(--good)"></i>Передано в производство</span><span><i style="background:var(--accent)"></i>Согласовано</span>' : '<span><i style="background:var(--good)"></i>Согласовано</span>'}<span><i style="background:var(--accent-2)"></i>На проверке</span><span><i style="background:var(--warn)"></i>Загружено / замечания</span><span><i style="background:var(--surface-2)"></i>Не загружено</span></div></div></section>
      <section class="panel"><header><h2>Реестр: ${esc(CATS(M)[cat].t)}${sel !== 'all' ? ' · ' + esc(sel) : ''}</h2><span class="sub">${list.length} ${plural(list.length, 'документ', 'документа', 'документов')}</span></header>
        <div class="pad tbl-wrap"><table class="t"><thead><tr><th>Шифр</th><th class="l">Наименование</th><th class="l">Раздел</th><th>Ред.</th><th>Статус</th><th>${cat === 'rd' ? 'В производстве' : ''}</th><th>Дата</th><th class="l">Работы</th></tr></thead>
        <tbody>${list.map(d => docRow(M, d)).join('') || `<tr><td colspan="8" class="l">${empty('Документов пока нет.')}</td></tr>`}</tbody></table></div></section>`;
  }
  function viewId(M) {
    const P = M.P, docs = M.documents.filter(d => d.cat === 'id');
    const tasks = M.tasks.filter(t => !t.ms && (t.state === 'active' || docs.some(d => d.taskIds.includes(t.id))));
    const hidden = M.tasks.filter(t => !t.ms && t.done && !docs.some(d => d.taskIds.includes(t.id))).length;
    const blocks = tasks.map(t => {
      const ds = docs.filter(d => d.taskIds.includes(t.id));
      const acc = M.events.filter(e => (e.type === 'acceptance' || e.type === 'inspection') && e.tasks && e.tasks.some(x => x.id === t.id) && !e.series);
      const c = t.contract ? M.contractBy.get(t.contract) : null;
      const ks = c ? c.ks.filter(k => k.lines && k.lines.some(l => l.task.id === t.id)).slice(-2).reverse() : [];
      return `<div class="idb">
        <div class="idb-h"><button class="lnk" type="button" data-go="${link(P.id, 'schedule')}" data-task="${t.id}" style="font-size:14px">${esc(t.name)}</button>${chip(t.st.t, t.st.c)}<span class="faint" style="font-size:12px">${Math.round(t.pct)}% · ${esc(t.stage)}</span></div>
        <div class="chain">
          <div><div class="eyebrow">Исполнительная документация · ${ds.length}</div>${ds.map(d => objLink(M, d.id, d.code + ' — ' + d.title)).join('') || '<div class="faint" style="font-size:12.5px">ИД не загружена</div>'}</div>
          <div><div class="eyebrow">Приёмка / освидетельствование</div>${acc.slice(-3).map(e => objLink(M, e.id)).join('') || '<div class="faint" style="font-size:12.5px">—</div>'}</div>
          <div><div class="eyebrow">КС-2</div>${ks.map(k => objLink(M, k.id)).join('') || '<div class="faint" style="font-size:12.5px">—</div>'}</div>
        </div></div>`;
    }).join('');
    const loose = docs.filter(d => !d.taskIds.length);
    const st = secStats(docs);
    if (DSF.uiFlow) return DSF.uiFlow.idSummary(M) + `<section class="panel"><header><h2>ИД по работам</h2><span class="sub">работа → исполнительная документация → приёмка → КС-2</span></header><div class="pad">${blocks || '<div class="empty">Работ с ИД нет.</div>'}${loose.length ? `<div class="idb"><div class="idb-h"><b>Без привязки к работе</b></div><div class="qlinks">${loose.map(d => objLink(M, d.id, d.code + ' — ' + d.title)).join('')}</div></div>` : ''}</div></section>`;
    return `<section class="tiles">${tile('Документов ИД', num(st.plan), 'по ' + tasks.length + ' работам')}${tile('Подписано', num(st.actual), '', 'good')}${tile('На проверке', num(st.rev))}${tile('Не загружено', num(st.none), 'ожидается от подрядчиков', st.none ? 'warn' : 'good')}</section>
      <section class="panel"><header><h2>ИД по работам</h2><span class="sub">работа → исполнительная документация → приёмка → КС-2 · выполняемые работы и работы с загруженной ИД${hidden ? ' · завершённых без ИД в реестре: ' + hidden : ''}</span></header><div class="pad">${blocks}
        ${loose.length ? `<div class="idb"><div class="idb-h"><b>Без привязки к работе</b></div><div class="qlinks">${loose.map(d => objLink(M, d.id, d.code + ' — ' + d.title)).join('')}</div></div>` : ''}</div></section>`;
  }
  function viewKsList(M) {
    const P = M.P, f = UI.ksFilter || 'work';
    const list = M.ks.filter(k => f === 'all' || (DSF.KS_STATUS[k.status].r < 9 && (k.origin !== 'history' || k.status !== 'paid'))).filter(k => f === 'all' || k.status !== 'paid').sort((a, b) => b.d - a.d || a.contract.no.localeCompare(b.contract.no));
    const shown = list.slice(0, 120);
    return `<section class="panel"><header><h2>КС-2 и заявки подрядчиков</h2><span class="sub">заявлено → принято → КС-2 → оплачено</span><span class="grow"></span>
      <div class="seg sm">${[['work', 'Не оплаченные'], ['all', 'Все']].map(([k, t]) => `<button type="button" data-x="ks-filter" data-f="${k}" aria-pressed="${f === k}">${t}</button>`).join('')}</div></header>
      <div class="pad tbl-wrap"><table class="t"><thead><tr><th>КС-2</th><th class="l">Договор / подрядчик</th><th>Период</th><th>Заявлено</th><th>Принято</th><th>Сумма КС-2</th><th>Статус</th></tr></thead>
      <tbody>${shown.map(k => `<tr class="link" data-go="${link(P.id, 'budget', k.id)}"><td><b>${esc(k.no)}</b>${k.user ? ' <span class="chip accent">новая</span>' : ''}</td><td class="l w"><b>${esc(k.contract.no)}</b> · ${esc(k.contract.contractor)}</td><td>${esc(mon(k.period))}</td><td>${mln(k.claimed)}</td><td>${k.accepted != null ? mln(k.accepted) : '<span class="faint">—</span>'}</td><td>${k.amount != null ? mln(k.amount) : '<span class="faint">—</span>'}</td><td>${chip(ksSt(k).t, ksSt(k).c)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('Нет КС-2.')}</td></tr>`}</tbody></table>
      <div class="faint" style="font-size:12px; margin-top:8px">Суммы — млн ₽. ${list.length > shown.length ? 'Показаны ' + shown.length + ' из ' + list.length + '.' : ''}</div></div></section>`;
  }
  function viewLetters(M) {
    const P = M.P, list = M.letters.slice().sort((a, b) => b.d - a.d);
    return `<section class="panel"><header><h2>Письма</h2><span class="sub">входящие и исходящие</span></header>
      <div class="pad tbl-wrap"><table class="t"><thead><tr><th></th><th class="l">Номер</th><th>Дата</th><th class="l">Отправитель → получатель</th><th class="l">Тема</th><th>Связи</th><th>Статус</th></tr></thead>
      <tbody>${list.map(l => `<tr class="link" data-go="${link(P.id, 'docs', l.id)}"><td>${chip(l.dir === 'in' ? 'Вх.' : 'Исх.', l.dir === 'in' ? 'accent' : 'neutral')}</td><td class="l"><b>${esc(l.no)}</b></td><td>${fd(l.d)}</td><td class="l w" style="min-width:200px">${esc(l.from)} → ${esc(l.to)}</td><td class="l w">${esc(l.subject)}</td><td>${l.docIds.length + l.orderIds.length + l.eventIds.length + l.taskIds.length}</td><td>${chip(l.status, l.status === 'Черновик' ? 'warn' : l.status === 'На рассмотрении' ? 'accent' : 'good')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function viewProtocols(M) {
    const P = M.P;
    return `<section class="panel"><header><h2>Протоколы совещаний</h2><span class="sub">протокол → поручения → ответственные → сроки</span></header>
      <div class="pad tbl-wrap"><table class="t"><thead><tr><th class="l">Протокол</th><th>Дата</th><th class="l">Председатель</th><th>Поручений</th><th>Открыто</th><th>Просрочено</th><th>Выполнено</th></tr></thead>
      <tbody>${M.protocols.slice().sort((a, b) => b.d - a.d).map(p => `<tr class="link" data-go="${link(P.id, 'docs', p.id)}"><td class="l"><b>№ ${esc(p.no)}</b> · ${esc(p.title)}</td><td>${fd(p.d)}</td><td class="l">${esc(p.chair)}</td><td>${p.orders.length}</td><td>${p.orders.filter(o => o.status !== 'done').length}</td><td style="${p.orders.some(o => o.status === 'overdue') ? 'color:var(--crit); font-weight:650' : ''}">${p.orders.filter(o => o.status === 'overdue').length}</td><td>${p.orders.filter(o => o.status === 'done').length}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function viewContractsDoc(M) {
    const P = M.P;
    return `<section class="panel"><header><h2>Договоры</h2><span class="sub">карточки договоров открываются в разделе «Бюджет»</span></header>
      <div class="pad tbl-wrap"><table class="t"><thead><tr><th class="l">Договор</th><th>Дата</th><th class="l">Подрядчик</th><th class="l">Предмет</th><th>Сумма, млн ₽</th><th>КС-2</th></tr></thead>
      <tbody>${M.contracts.map(c => `<tr class="link" data-go="${link(P.id, 'budget', c.id)}"><td class="l"><b>${esc(c.no)}</b></td><td>${fd(c.d)}</td><td class="l w">${esc(c.contractor)}</td><td class="l w">${esc(c.subject)}</td><td>${num(c.amount)}</td><td>${c.ks.length}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function viewSimple(M, cat) {
    const docs = M.documents.filter(d => d.cat === cat).sort((a, b) => (b.d || 0) - (a.d || 0));
    return `<section class="panel"><header><h2>${esc(CATS(M)[cat].full)}</h2><span class="sub">${docs.length} ${plural(docs.length, 'документ', 'документа', 'документов')}</span></header>
      <div class="pad tbl-wrap"><table class="t"><thead><tr><th>Номер / шифр</th><th class="l">Наименование</th><th class="l">Организация</th><th>Дата</th><th>Срок</th><th>Статус</th></tr></thead>
      <tbody>${docs.map(d => `<tr class="link" data-go="${link(M.P.id, 'docs', d.id)}"><td><b>${esc(d.code)}</b></td><td class="l w">${esc(d.title)}</td><td class="l w" style="min-width:160px">${esc(d.issuer || d.org || '')}</td><td>${d.d != null ? fd(d.d) : '—'}</td><td style="${d.due != null && d.due < T() && d.state !== 'ok' ? 'color:var(--crit)' : ''}">${d.due != null ? fd(d.due) : ''}</td><td>${chip(DSF.docStatusLabel(d, d.state), docSt(d).c)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  /* карточка документа: редакции, движение, связи */
  function docCard(M, d) {
    const P = M.P, cur = d.cur, acts = cur ? (DSF.DOC_ACTIONS[cur.status] || []) : [];
    const cat = CATS(M)[d.cat];
    const contracts = [...new Set(d.tasks.map(t => t.contract).filter(Boolean))].map(id => M.contractBy.get(id)).filter(Boolean);
    const ks = d.cat === 'id' ? contracts.flatMap(c => c.ks.filter(k => k.lines && k.lines.some(l => d.taskIds.includes(l.task.id)) && cur && k.d >= cur.d - 40)).slice(-3) : [];
    const html = `<div class="topback">${backBtn(link(P.id, 'docs', d.cat), cat.full)}</div>
      <section class="panel">
        <header><div style="min-width:0; flex:1"><div class="eyebrow">${esc(cat.full)} · ${esc(d.section)} ${esc(SECN(M)[d.section] || '')}</div><h2 style="margin-top:6px">${esc(d.code)} — ${esc(d.title)}</h2>
          <div class="muted" style="margin-top:4px; font-size:12.5px">${esc(d.org || d.issuer || '')}${d.due != null ? ' · контрольный срок ' + fd(d.due) : ''}${d.user ? ' · создан в системе' : ''}</div></div>
          <div class="fchips">${chip(DSF.docStatusLabel(d, d.state), docSt(d).c)}</div></header>
        <div class="pad">
          <div class="docstate">
            <div class="ds-box"><div class="eyebrow">Актуальная редакция</div>${cur ? `<div class="v">Ред. ${esc(cur.rev)} <small>от ${fd(cur.d)}</small></div><div>${chip(DSF.docStatusLabel(d, cur.status), (DSF.DOC_STATUS[cur.status] || {}).c)}</div>` : '<div class="v">—</div><div class="faint">Документ ещё не загружен</div>'}</div>
            ${d.cat === 'rd' ? `<div class="ds-box ${d.prod ? 'prod' : ''}"><div class="eyebrow">Передано в производство работ</div>${d.prod ? `<div class="v">${ico('check', 18)} Ред. ${esc(d.prod.rev)} <small>· ${fd(d.prod.sent)}</small></div><div class="faint">${esc(d.prod.to || '')}</div>${cur && d.prod !== cur ? `<div class="warnline">Актуальная ред. ${esc(cur.rev)} ещё не передана — на площадке действует ред. ${esc(d.prod.rev)}</div>` : ''}` : '<div class="v faint">Не передавалось</div>'}</div>` : ''}
            <div class="ds-box"><div class="eyebrow">Редакций</div><div class="v">${d.versions.length}</div><div class="faint">${d.versions.filter(v => v.shown === 'sup').length} заменено, история сохранена</div></div>
          </div>
          <div class="mf" style="padding:14px 0 0">
            ${acts.map(([op, t]) => `<button class="btn ${op === 'transfer' || op === 'approve' ? 'primary' : ''}" type="button" data-x="doc-act" data-op="${op}" data-doc="${esc(d.id)}" data-rev="${esc(cur.rev)}">${op === 'transfer' ? ico('send') : op === 'approve' ? ico('check') : ''}${t}</button>`).join('')}
            ${cat.versioned || ['id', 'reports', 'permits'].includes(d.cat) ? `<button class="btn ${acts.length ? '' : 'primary'}" type="button" data-x="doc-upload" data-doc="${esc(d.id)}" data-cat="${d.cat}">${ico('upload')}${d.versions.length ? 'Загрузить новую редакцию' : 'Загрузить документ'}</button>` : ''}
            ${cur && ['up', 'ret', 'rev'].includes(cur.status) ? `<button class="btn" type="button" data-x="doc-act" data-op="annul" data-doc="${esc(d.id)}" data-rev="${esc(cur.rev)}">Аннулировать ред. ${esc(cur.rev)}</button>` : ''}
          </div>
        </div>
      </section>
      <div class="grid2">
        <section class="panel"><header><h2>История редакций</h2><span class="sub">предыдущие редакции не удаляются</span></header>
          <div class="pad">${d.versions.length ? d.versions.slice().reverse().map(v => `<div class="ver ${v === cur ? 'cur' : ''}">
            <div class="ver-h"><b>Ред. ${esc(v.rev)}</b><span class="faint">${fd(v.d)}</span>${chip(DSF.docStatusLabel(d, v.shown), (DSF.DOC_STATUS[v.shown] || {}).c)}${v === cur ? chip('актуальная', 'accent') : ''}${v.sent != null ? `<span class="prodmark">${ico('check', 13)} в производстве с ${fd(v.sent)}</span>` : ''}</div>
            ${v.to ? `<div class="faint" style="font-size:12px">Передано: ${esc(v.to)}</div>` : ''}
            ${v.file ? `<div style="font-size:12.5px; margin-top:4px">Файл: ${store.file(v.file.id) ? `<button class="lnk" type="button" data-x="file-save" data-fid="${esc(v.file.id)}" data-name="${esc(v.file.name)}">${ico('upload', 13)}${esc(v.file.name)}</button>` : esc(v.file.name) + ' <span class="faint">(файл недоступен в этом браузере)</span>'} · ${num(v.file.size / 1024)} КБ</div>` : ''}
            ${v.note ? `<div style="font-size:12.5px; margin-top:4px">${esc(v.note)}</div>` : ''}
            <ul class="vh">${v.history.map(h => `<li><span class="num">${fd(h.d)}</span> ${esc(h.text)}${h.by ? ' <span class="faint">· ' + esc(h.by) + '</span>' : ''}</li>`).join('')}</ul></div>`).join('') : empty('Редакций нет — документ ожидается.')}</div></section>
        <section class="panel"><header><h2>Связи</h2></header><div class="pad">
          ${linkBlock('Работы графика', d.tasks.length ? `<div class="qlinks">${d.tasks.map(t => objLink(M, t.id)).join('')}</div>` : '')}
          ${linkBlock('События календаря', d.events.length ? `<div class="qlinks">${d.events.map(e => objLink(M, e.id)).join('')}</div>` : '')}
          ${linkBlock('Протокольные поручения', d.orders.length ? links(M, d.orders.map(o => o.id)) : '')}
          ${linkBlock('Письма', d.letters.length ? links(M, d.letters.map(l => l.id)) : '')}
          ${linkBlock('Договоры', contracts.length ? links(M, contracts.map(c => c.id)) : '')}
          ${linkBlock('КС-2 по работам', ks.length ? links(M, ks.map(k => k.id)) : '')}
          ${!d.tasks.length && !d.events.length && !d.orders.length && !d.letters.length ? empty('Связей нет.') : ''}
        </div></section>
      </div>`;
    return { html, crumb: d.code, crumbParent: { t: cat.t, go: link(P.id, 'docs', d.cat) } };
  }
  function protocolCard(M, p) {
    const P = M.P;
    const html = `<div class="topback">${backBtn(link(P.id, 'docs', 'protocols'), 'Протоколы')}</div>
      <section class="panel"><header><div style="min-width:0; flex:1"><div class="eyebrow">Протокол совещания</div><h2 style="margin-top:6px">№ ${esc(p.no)} от ${fd(p.d)} — ${esc(p.title)}</h2></div>
        <button class="btn primary" type="button" data-x="ord-new" data-protocol="${p.id}">${ico('plus')}Поручение по протоколу</button></header>
        <div class="pad grid2" style="gap:24px"><div>${kv([['Председатель', esc(p.chair)], ['Место', esc(p.place || '')], ['Участники', esc(p.people.join(', '))]])}</div>
          <div>${linkBlock('Совещание в календаре', p.event && M.evBy.get(p.event) ? objLink(M, p.event) : '')}</div></div></section>
      <section class="panel"><header><h2>Поручения по протоколу</h2><span class="sub">${p.orders.length}</span></header>
        <div class="pad tbl-wrap"><table class="t"><thead><tr><th>№</th><th class="l">Поручение</th><th class="l">Ответственный</th><th>Срок</th><th>Статус</th></tr></thead>
        <tbody>${p.orders.map(o => `<tr class="link" data-go="${link(P.id, 'orders', o.id)}"><td><b>${esc(o.no)}</b></td><td class="l w">${esc(o.text)}</td><td class="l w" style="min-width:150px">${esc(o.owner)}</td><td>${fd(o.due)}</td><td>${chip(ordSt(o).t, ordSt(o).c)}</td></tr>`).join('') || `<tr><td colspan="5">${empty('Поручений нет.')}</td></tr>`}</tbody></table></div></section>`;
    return { html, crumb: 'Протокол № ' + p.no, crumbParent: { t: 'Протоколы', go: link(P.id, 'docs', 'protocols') } };
  }
  function letterCard(M, l) {
    const P = M.P;
    const html = `<div class="topback">${backBtn(link(P.id, 'docs', 'letters'), 'Письма')}</div>
      <section class="panel"><header><div style="min-width:0; flex:1"><div class="eyebrow">${l.dir === 'in' ? 'Входящее письмо' : 'Исходящее письмо'}${l.user ? ' · подготовлено в системе' : ''}</div><h2 style="margin-top:6px">${esc(l.subject)}</h2></div>${chip(l.status, l.status === 'Черновик' ? 'warn' : 'good')}</header>
        <div class="pad grid2" style="gap:24px"><div>${kv([[l.dir === 'in' ? 'Входящий №' : 'Исходящий №', esc(l.no)], ['Дата', fd(l.d)], ['Отправитель', esc(l.from)], ['Получатель', esc(l.to)], ['Статус', esc(l.status)]])}
          ${l.body ? `<pre class="letter">${esc(l.body)}</pre>` : ''}
          ${DSF.uiFlow ? DSF.uiFlow.letterExtra(M, l) : ''}
          ${l.status === 'Черновик' ? `<div class="note warn" style="margin-top:10px">Черновик не отправлен: в демо-версии почтовая интеграция не подключена.</div>` : ''}</div>
          <div>${linkBlock('Документы', l.docIds.length ? links(M, l.docIds) : '')}${linkBlock('Работы', l.taskIds.length ? links(M, l.taskIds) : '')}${linkBlock('Поручения', l.orderIds.length ? links(M, l.orderIds) : '')}${linkBlock('События', l.eventIds.length ? links(M, l.eventIds) : '')}</div></div></section>`;
    return { html, crumb: l.no, crumbParent: { t: 'Письма', go: link(P.id, 'docs', 'letters') } };
  }

  /* загрузка документа: новая позиция или новая редакция существующей */
  function uploadForm(M) {
    const d = UI.upDraft, opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
    const ex = d.docId ? M.docBy.get(d.docId) : null;
    const cats = UPLOAD_CATS(M);
    const secs = secOptions(d.cat, M);
    const nextRev = ex ? nextRevOf(ex) : (d.cat === 'rd' ? '0' : '1');
    return `<form data-form="upload" class="mform"><div class="mh"><div><div class="eyebrow">${ex ? 'Новая редакция документа' : 'Загрузка документа'}</div><h3 style="margin-top:4px">${ex ? esc(ex.code + ' — ' + ex.title) : 'Новый документ'}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="note">Демо-режим: сведения о документе и его движении сохраняются в браузере, сам файл — только в текущей вкладке. В рабочей версии файл передаётся в хранилище через тот же интерфейс хранения.</div>
        <div class="fld"><label for="up-file">Файл</label><input id="up-file" name="file" type="file" required></div>
        <div class="row-f"><div class="fld"><label for="up-cat">Категория</label><select id="up-cat" name="cat" ${ex ? 'disabled' : ''}>${cats.map(c => opt(c, CATS(M)[c].t + ' — ' + CATS(M)[c].full, d.cat === c)).join('')}</select></div>
          <div class="fld"><label for="up-sec">Раздел</label><select id="up-sec" name="section" ${ex ? 'disabled' : ''}>${secs.map(s => opt(s, s + ' — ' + (SECN(M)[s] || s), (ex ? ex.section : d.section) === s)).join('')}</select></div></div>
        <div class="row-f"><div class="fld"><label for="up-code">Шифр</label><input id="up-code" name="code" required value="${esc(ex ? ex.code : d.code || '')}" ${ex ? 'readonly' : ''} placeholder="Например: ${esc(M.P.code)}-КЖ-05"></div>
          <div class="fld"><label for="up-rev">Версия / редакция</label><input id="up-rev" name="rev" required value="${esc(d.rev || nextRev)}"></div></div>
        <div class="fld"><label for="up-title">Название</label><input id="up-title" name="title" required value="${esc(ex ? ex.title : d.title || '')}" ${ex ? 'readonly' : ''}></div>
        <div class="row-f"><div class="fld"><label for="up-date">Дата документа</label><input id="up-date" name="date" type="date" required value="${esc(d.date || today())}" max="${today()}"></div>
          <div class="fld"><label for="up-org">Автор / организация</label><input id="up-org" name="org" value="${esc(ex ? ex.org : d.org || M.P.designer)}"></div></div>
        <div class="fld"><label for="up-tasks">Связанные работы / этап</label><select id="up-tasks" name="tasks" multiple size="5">${M.tasks.filter(x => !x.ms).map(x => opt(x.id, x.stage + ' · ' + x.name, (ex ? ex.taskIds : d.tasks || []).includes(x.id))).join('')}</select></div>
        <div class="fld"><label for="up-desc">Описание изменений</label><textarea id="up-desc" name="desc">${esc(d.desc || '')}</textarea></div>
        <div class="err" id="up-err" hidden></div>
      </div>
      <div class="mf"><button class="btn primary" type="submit">${ico('upload')}Загрузить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  function secOptions(cat, M) {
    const base = { rd: ['ГП', 'АР', 'КР', 'ОВ', 'ВК', 'ЭОМ', 'СС', 'АПТ', 'ТХ', 'НС', 'ЛФТ'], pd: ['ГП', 'АР', 'КР', 'ОВ', 'ВК', 'ЭОМ', 'СС', 'АПТ', 'ТХ', 'НС', 'ЛФТ', 'ПОС'], id: ['АОСР', 'АООК', 'ИС', 'ПИ', 'АПР', 'ОТЧ'], reports: ['МЕС', 'ОТЧ'], permits: ['РАЗ', 'ТУ', 'ОРД'] }[cat] || [];
    const used = M.documents.filter(d => d.cat === cat).map(d => d.section);
    const cfg = (M.docSections || []).filter(x => x.cat === cat).map(x => x.code);
    return [...new Set(cfg.concat(used).concat(cfg.length && !['id', 'reports', 'permits'].includes(cat) ? [] : base))].filter(x => x != null && x !== '');
  }
  function nextRevOf(d) {
    const last = d.versions.length ? d.versions[d.versions.length - 1].rev : null;
    if (last == null) return d.cat === 'rd' ? '0' : '1';
    return /^\d+$/.test(last) ? String(+last + 1) : last + "'";
  }
  U.INPUTS['up-cat'] = e => {
    const M = M0(); const sel = document.getElementById('up-sec'); if (!sel || !M) return;
    UI.upDraft.cat = e.target.value;
    sel.innerHTML = secOptions(e.target.value, M).map(s => `<option value="${esc(s)}">${esc(s + ' — ' + (SECN(M)[s] || s))}</option>`).join('');
    const rev = document.getElementById('up-rev'); if (rev && !UI.upDraft.docId) rev.value = e.target.value === 'rd' ? '0' : '1';
  };
  U.FORMS.upload = function (f, r) {
    const M = M0(), d = UI.upDraft, fd_ = new FormData(f);
    const file = f.querySelector('#up-file').files[0];
    const err = msg => { const el = f.querySelector('#up-err'); el.hidden = false; el.textContent = msg; };
    if (!file) return err('Выберите файл документа.');
    const ex0 = d.docId ? M.docBy.get(d.docId) : null;
    const cat = ex0 ? ex0.cat : fd_.get('cat'), code = String(ex0 ? ex0.code : fd_.get('code') || '').trim(), rev = String(fd_.get('rev') || '').trim();
    const title = String(ex0 ? ex0.title : fd_.get('title') || '').trim(), date = fd_.get('date');
    if (!code || !rev || !title || !date) return err('Заполните шифр, редакцию, название и дату.');
    if (dn(date) > T()) return err('Дата документа не может быть позже отчётной даты ' + F.date(T()) + '.');
    const ex = ex0 || M.documents.find(x => x.cat === cat && x.code.toLowerCase() === code.toLowerCase());
    if (ex && ex.versions.some(v => v.rev === rev)) return err('Редакция ' + rev + ' документа ' + ex.code + ' уже есть. Укажите новую редакцию — предыдущие сохраняются в истории.');
    const tasks = [...f.querySelector('[name="tasks"]').selectedOptions].map(o => o.value);
    const meta = store.putFile(file);
    let id = ex ? ex.id : null;
    store.update(r.pid, s => {
      if (!ex) {
        id = 'd-' + DSF.slug(code);
        if (M.docBy.get(id)) id += '-u' + (s.seq++);
        s.docs.push({ id, cat, section: fd_.get('section'), code, title, org: String(fd_.get('org') || '').trim(), tasks, desc: String(fd_.get('desc') || '') });
      }
      s.docOps.push({ op: 'upload', doc: id, rev, verDate: date, date: today(), file: meta, note: String(fd_.get('desc') || '').trim(), tasks, by: String(fd_.get('org') || '').trim() || ROLE.tz });
    });
    UI.upDraft = null; closeModal();
    H.go(link(r.pid, 'docs', id));
    toast(`${ex ? 'Загружена новая редакция' : 'Документ загружен'}: <b>${esc(code)}</b>, ред. ${esc(rev)}. Следующий шаг — «Направить на проверку».`);
  };
  function docActForm(M) {
    const a = UI.docAct, d = M.docBy.get(a.doc), c = d.tasks.map(t => t.contract && M.contractBy.get(t.contract)).filter(Boolean)[0];
    if (a.op === 'transfer') return `<form data-form="doc-transfer" class="mform"><div class="mh"><div><div class="eyebrow">Передача в производство работ</div><h3 style="margin-top:4px">${esc(d.code)}, ред. ${esc(a.rev)}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb"><div class="fld"><label for="tr-to">Кому передано</label><input id="tr-to" name="to" required value="${esc(c ? c.contractor : M.P.gc)}" autofocus></div>
        <div class="fld"><label for="tr-date">Дата передачи</label><input id="tr-date" name="date" type="date" value="${today()}" max="${today()}" min="${iso(d.versions.find(v => v.rev === a.rev).d)}"></div>
        ${d.prod ? `<div class="note">Сейчас в производстве ред. ${esc(d.prod.rev)} от ${fd(d.prod.sent)}. После передачи она будет отмечена как «Заменено новой редакцией», история сохранится.</div>` : ''}
        <div class="fld"><label for="tr-note">Комментарий</label><input id="tr-note" name="note"></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('send')}Передать в производство</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
    return smallForm(a.op === 'return' ? 'Вернуть с замечаниями: ' + d.code : 'Аннулировать ред. ' + a.rev, a.op === 'return' ? 'Замечания' : 'Основание', 'note', '', 'doc-note');
  }
  U.FORMS['doc-transfer'] = function (f, r) {
    const a = UI.docAct, fd_ = new FormData(f);
    store.update(r.pid, s => s.docOps.push({ op: 'transfer', doc: a.doc, rev: a.rev, to: String(fd_.get('to') || '').trim(), date: fd_.get('date') || today(), note: String(fd_.get('note') || '').trim(), by: ROLE.tz }));
    closeModal(); keepPage(); toast('Редакция ' + esc(a.rev) + ' передана в производство работ. Событие «Выдача РД» появилось в Календаре.');
  };
  U.FORMS['doc-note'] = function (f, r) {
    const a = UI.docAct, note = String(new FormData(f).get('note') || '').trim();
    store.update(r.pid, s => s.docOps.push({ op: a.op, doc: a.doc, rev: a.rev, note, date: today(), by: ROLE.tz }));
    closeModal(); keepPage();
  };

  /* ====================================================================
   * БЮДЖЕТ → ДОГОВОР → КС-2
   * ==================================================================== */
  U.VIEWS.budget = function (M, r) {
    if (r.sub) {
      if (M.contractBy.get(r.sub)) return contractCard(M, M.contractBy.get(r.sub));
      if (M.ksBy.get(r.sub)) return ksCard(M, M.ksBy.get(r.sub));
    }
    const P = M.P, f = M.fin;
    const setBtn = can('budget') ? `<button class="btn" type="button" data-go="${link(P.id, 'settings', 'budget')}">${ico('gear')}Статьи и договоры</button>` : '';
    if (!M.items.length && !M.contracts.length) return { html: `${head(esc(P.name) + ' · финансы', 'Бюджет', 'проекта', 'Бюджет объекта ещё не сформирован.', setBtn)}
      <section class="panel"><div class="pad"><div class="empty">Нет статей бюджета и договоров. Финансовые показатели не рассчитываются, пока данные не внесены.</div></div></section>` };
    const Y1 = Math.max(1000, Math.ceil(Math.max(f.approved, f.eac) / 1000) * 1000), step = Y1 / 4;
    const open = (UI.biOpen = UI.biOpen || {});
    const pending = M.ks.filter(k => DSF.KS_STATUS[k.status].r < 7);
    const html = `${head(esc(P.name) + ' · финансы', 'Бюджет', 'проекта', 'Статья бюджета → договоры → КС-2. «Заявлено подрядчиком» и «Принято Техническим заказчиком» — разные показатели; в выполнение включается только принятый и согласованный объём.' + (f.entered ? ' Финансы объекта — только по внесённым данным: КС-2 и оплаты вносятся в карточке договора.' : ''), setBtn)}
      <section class="tiles">
        ${tile('Утверждённый бюджет', f.configured ? bn(f.approved) + ' <small>млрд ₽</small>' : '—', f.configured ? 'включая резерв ' + money(f.reserve) : 'статьи без сумм')}
        ${tile('Законтрактовано', bn(f.contracted) + ' <small>млрд ₽</small>', (f.configured ? pct(f.contracted / f.approved * 100) + ' · ' : '') + M.contracts.length + ' ' + plural(M.contracts.length, 'договор', 'договора', 'договоров'))}
        ${tile('Заявлено подрядчиками', bn(f.claimed) + ' <small>млрд ₽</small>', 'в т. ч. на проверке ' + money(sum(pending, k => k.claimed)))}
        ${tile('Принято ТЗ', bn(f.accepted) + ' <small>млрд ₽</small>', 'КС-2 согласовано ' + money(f.agreed), 'good')}
        ${tile('Оплачено', bn(f.paid) + ' <small>млрд ₽</small>', 'с учётом авансов и удержаний')}
        ${tile('Прогноз стоимости', bn(f.eac) + ' <small>млрд ₽</small>', !f.configured ? 'бюджет не задан' : f.eac > f.approved ? 'перерасход ' + money(f.eacDelta) : 'резерв: остаток ' + money(Math.min(f.reserve, f.reserveLeft)), f.state)}
      </section>
      <section class="panel">
        <header><h2>Статьи бюджета</h2><span class="sub">нажмите статью, чтобы увидеть договоры · млн ₽</span></header>
        <div class="pad tbl-wrap"><table class="t bi">
          <thead><tr><th>Статья</th><th>Бюджет</th><th>Законтр.</th><th>Заявлено</th><th>Принято</th><th>КС-2 согл.</th><th>Оплачено</th><th>Прогноз</th><th>Откл.</th></tr></thead>
          <tbody>${M.items.map(i => {
            const isOpen = !!open[P.id + i.code];
            return `<tr class="link ${isOpen ? 'open' : ''}" data-x="bi-toggle" data-code="${esc(i.code)}"><td><span class="tw2">${ico(isOpen ? 'chevd' : 'chev', 14)}</span><b>${esc(i.name)}</b> <span class="faint">· ${i.contracts.length} ${plural(i.contracts.length, 'договор', 'договора', 'договоров')}</span></td><td>${num(i.budget)}</td><td>${i.contracted ? num(i.contracted) : '<span class="faint">—</span>'}</td><td>${num(i.claimed)}</td><td>${num(i.accepted)}</td><td>${num(i.agreed)}</td><td>${num(i.paid)}</td><td>${num(i.forecast)}</td><td class="${i.variance > 0.5 ? 'pos' : i.variance < -0.5 ? 'neg' : ''}">${i.variance > 0.5 ? '+' : i.variance < -0.5 ? '−' : ''}${num(Math.abs(i.variance))}</td></tr>
            ${isOpen ? `<tr class="sub"><td colspan="9" class="l" style="white-space:normal; padding:8px 0 14px">${i.contracts.length ? `<table class="t inner"><thead><tr><th class="l">Договор</th><th class="l">Предмет</th><th class="l">Подрядчик</th><th>Сумма</th><th>Статус</th><th>Выполнено</th><th>Оплачено</th><th>Остаток</th><th>КС-2</th></tr></thead><tbody>${i.contracts.map(c => `<tr class="link" data-go="${link(P.id, 'budget', c.id)}"><td class="l"><b>${esc(c.no)}</b></td><td class="l w">${esc(c.subject)}</td><td class="l w" style="min-width:150px">${esc(c.contractor)}</td><td>${num(c.amount)}</td><td>${chip(c.state === 'done' ? 'Исполнен' : c.state === 'active' ? 'Исполняется' : 'Не начат', c.state === 'done' ? 'good' : c.state === 'active' ? 'accent' : 'neutral')}</td><td>${num(c.agreed)}</td><td>${num(c.paid)}</td><td>${num(c.left)}</td><td><span class="lnk">${c.ks.length} ${ico('chev', 12)}</span></td></tr>`).join('')}</tbody><tfoot><tr><td class="l" colspan="3">Итого по статье · бюджет ${num(i.budget)}</td><td>${num(i.contracted)}</td><td></td><td>${num(i.agreed)}</td><td>${num(i.paid)}</td><td>${num(sum(i.contracts, c => c.left))}</td><td>${sum(i.contracts, c => c.ks.length)}</td></tr></tfoot></table>${i.uncontracted > 0.5 ? `<div class="faint" style="font-size:12px; margin-top:6px">Не законтрактовано по статье: ${num(i.uncontracted)} млн ₽</div>` : ''}` : `<span class="faint">По статье договоров нет — ${i.uncontracted > 0.5 ? 'не законтрактовано ' + num(i.uncontracted) + ' млн ₽' : 'работы не начаты'}.</span>`}</td></tr>` : ''}`;
          }).join('')}
          <tr class="sub"><td>Резерв проекта</td><td>${num(f.reserve)}</td><td colspan="5"></td><td>${f.reserveLeft >= 0 ? num(Math.min(f.reserve, f.reserveLeft)) : '0'}</td><td class="${f.reserveUsed > 0 ? 'pos' : ''}">${f.reserveUsed > 0 ? 'исп. ' + num(f.reserveUsed) : ''}</td></tr></tbody>
          <tfoot><tr><td>Итого</td><td>${num(f.approved)}</td><td>${num(f.contracted)}</td><td>${num(f.claimed)}</td><td>${num(f.accepted)}</td><td>${num(f.agreed)}</td><td>${num(f.paid)}</td><td>${num(f.eac)}</td><td class="${f.eacDelta > 0 ? 'pos' : 'neg'}">${f.eacDelta > 0 ? '+' : '−'}${num(Math.abs(f.eacDelta))}</td></tr></tfoot>
        </table></div>
      </section>
      <section class="panel"><header><h2>КС-2 в работе</h2><span class="sub">заявки подрядчиков до согласования</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'docs', 'ks')}">Все КС-2 ${ico('chev')}</button></header>
        <div class="pad"><div class="list">${pending.map(k => `<button class="li btnrow" type="button" data-go="${link(P.id, 'budget', k.id)}"><span class="t">${esc(k.contract.no)} · ${esc(k.no)} — ${esc(k.contract.contractor)}</span>${chip(ksSt(k).t, ksSt(k).c)}<span class="m">${esc(mon(k.period))} · заявлено ${money(k.claimed)}${k.accepted != null ? ' · принято ' + money(k.accepted) : ''} · этап ${ksSt(k).stage} из 2</span></button>`).join('') || empty('Заявок на проверке нет.')}</div></div></section>
      ${M.money.length && f.configured ? `<div class="grid2">
        <section class="panel"><header><h2>Освоение бюджета</h2><span class="sub">нарастающим итогом, млрд ₽</span></header>
          <div class="pad">${H.lineChart({ w: H.CW(), h: H.CH(), x0: M.money[0].t - 20, x1: M.money[M.money.length - 1].t, y0: 0, y1: Y1, yTicks: [0, step, step * 2, step * 3, Y1], yFmt: v => num(v / 1000, 1), label: 'Освоение бюджета', tipFmt: v => money(v),
            series: [
              { name: 'План', color: 'var(--ink-3)', pts: M.money.map(c => [c.t, c.plan]), dash: '5 5', width: 2 },
              { name: 'Прогноз', color: 'var(--warn)', pts: [[M.T, f.done]].concat(M.money.filter(c => c.fc != null && c.t > M.T).map(c => [c.t, c.fc])), dash: '2 4' },
              { name: 'Выполнение по графику', color: 'var(--good)', pts: M.money.filter(c => c.fact != null).map(c => [c.t, c.fact]).concat([[M.T, f.done]]), area: true, end: true, width: 2.75 }
            ], marks: [{ t: M.T, label: 'сегодня', color: 'var(--accent)' }] })}</div></section>
        <section class="panel"><header><h2>Структура</h2><span class="sub">утверждённый бюджет</span></header><div class="pad">${H.budgetStack(M)}</div></section>
      </div>` : ''}`;
    return { html };
  };
  function stageBars(c) {
    const A = c.amount, w = v => clamp(v / A * 100, 0, 100).toFixed(1) + '%';
    const rows = [['Выполнено по графику', c.done, 'var(--ink-3)'], ['Заявлено подрядчиком', c.claimed, 'var(--accent-2)'], ['Принято ТЗ', c.accepted, 'var(--accent)'], ['КС-2 согласовано', c.agreed, 'var(--good)'], ['Оплачено', c.paid, 'var(--good)']];
    return `<div class="sbars">${rows.map(([l, v, col]) => `<div class="sbar"><span>${l}</span><span class="bar"><i style="width:${w(v)}; --c:${col}"></i></span><b>${mln(v)}</b></div>`).join('')}</div>`;
  }
  function contractCard(M, c) {
    const P = M.P, it = M.itemBy.get(c.item);
    const idDocs = M.documents.filter(d => d.cat === 'id' && d.taskIds.some(id => c.tasks.some(t => t.id === id)));
    const canNew = DSF.can('ksgc') && c.tasks.length && c.unacted > 0.5 && !c.ks.some(k => DSF.KS_STATUS[k.status].r < 5 && k.status !== 'rejected');
    const html = `<div class="topback">${backBtn(link(P.id, 'budget'), 'Бюджет')}</div>
      <section class="panel"><header style="flex-wrap:wrap"><div style="min-width:0; flex:1 1 320px"><div class="eyebrow">Договор · статья «${esc(it ? it.name : c.item || '—')}»</div><h2 style="margin-top:6px">${esc(c.no)} от ${fd(c.d)} — ${esc(c.subject)}</h2><div class="muted" style="font-size:13px; margin-top:4px">${esc(c.contractor)} · аванс ${Math.round(c.adv * 100)}% · гарантийное удержание ${Math.round(c.ret * 100)}%</div></div>
        <div class="hd-r">${canNew ? `<button class="btn primary" type="button" data-x="ks-new" data-cid="${c.id}">${ico('plus')}КС-2 от подрядчика</button>` : ''}<button class="btn" type="button" data-x="ct-edit" data-cid="${c.id}">${ico('edit')}Договор</button><button class="btn" type="button" data-x="ct-supp" data-cid="${c.id}">${ico('plus')}Доп. соглашение</button>${M.fin.entered ? `<button class="btn" type="button" data-x="ct-act" data-cid="${c.id}">${ico('plus')}Внести КС-2</button><button class="btn" type="button" data-x="ct-pay" data-cid="${c.id}">${ico('plus')}Оплата</button>` : ''}</div></header>
        <div class="pad">
          <div class="tiles" style="margin-bottom:14px">
            ${tile('Сумма договора', mln(c.amount) + ' <small>млн ₽</small>')}
            ${tile('Заявлено', mln(c.claimed) + ' <small>млн ₽</small>', 'подрядчиком')}
            ${tile('Принято', mln(c.accepted) + ' <small>млн ₽</small>', 'Техническим заказчиком')}
            ${tile('КС-2 согласовано', mln(c.agreed) + ' <small>млн ₽</small>', '', 'good')}
            ${tile('Оплачено', mln(c.paid) + ' <small>млн ₽</small>', 'в т. ч. непогашенный аванс ' + mln(c.advance * (1 - c.paidActs / c.amount)))}
            ${tile('Остаток', mln(c.left) + ' <small>млн ₽</small>', 'не предъявлено ' + mln(c.unacted))}
          </div>
          ${c.amount ? stageBars(c) : ''}
          ${c.supp.length ? `<div class="eyebrow" style="margin:16px 0 6px">Цена договора: ${mln(c.base)} млн ₽ по договору${c.supp.map(a => ' ' + (a.amount >= 0 ? '+' : '−') + ' ' + mln(Math.abs(a.amount))).join('')} = ${mln(c.amount)} млн ₽</div>
            <div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Доп. соглашение</th><th>Дата</th><th class="l">Предмет</th><th>Сумма, млн ₽</th></tr></thead><tbody>${c.supp.map(a => `<tr><td class="l"><b>${esc(a.no || '—')}</b></td><td>${fd(a.d)}</td><td class="l w">${esc(a.subject || '')}</td><td>${a.amount >= 0 ? '+' : '−'}${mln(Math.abs(a.amount))}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${(c.payments || []).length ? `<div class="eyebrow" style="margin:16px 0 6px">Оплаты · всего ${mln(sum(c.payments, p => p.amount))} млн ₽</div>
            <div class="tbl-wrap"><table class="t"><thead><tr><th>Дата</th><th class="l">Назначение</th><th class="l">Основание</th><th>Сумма, млн ₽</th></tr></thead><tbody>${c.payments.map(pm => `<tr><td>${fd(pm.d)}</td><td class="l">${esc({ advance: 'Аванс', act: 'Оплата выполненных работ', other: 'Прочее' }[pm.kind] || pm.kind || '')}</td><td class="l w">${esc(pm.doc || '')}</td><td>${mln(pm.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          <div class="note" style="margin-top:12px">${M.fin.entered ? 'Финансы договора — по внесённым данным: КС-2, оплаты и доп. соглашения. Выполнение по графику (' + mln(c.done) + ' млн ₽) рассчитывается из фактического прогресса работ договора.' : 'Выполнение по графику (' + mln(c.done) + ' млн ₽) — объективная оценка по проценту выполнения работ. В КС-2 попадает только принятый объём; непринятое возвращается в «не предъявлено».'}</div>
        </div></section>
      <section class="panel"><header><h2>История КС-2</h2><span class="sub">${c.ks.length} · млн ₽</span></header>
        <div class="pad tbl-wrap"><table class="t"><thead><tr><th>КС-2</th><th>Период</th><th>Дата</th><th>Заявлено</th><th>Принято</th><th>Сумма КС-2</th><th>Статус</th></tr></thead>
        <tbody>${c.ks.slice().reverse().map(k => `<tr class="link" data-go="${link(P.id, 'budget', k.id)}"><td><b>${esc(k.no)}</b>${k.user ? ' <span class="chip accent">новая</span>' : ''}</td><td>${esc(mon(k.period))}</td><td>${fd(k.d)}</td><td>${mln(k.claimed)}</td><td>${k.accepted != null ? mln(k.accepted) : '<span class="faint">—</span>'}</td><td>${k.amount != null ? mln(k.amount) : '<span class="faint">—</span>'}</td><td>${chip(ksSt(k).t, ksSt(k).c)}</td></tr>`).join('') || `<tr><td colspan="7">${empty('КС-2 по договору ещё не предъявлялись.')}</td></tr>`}</tbody></table></div></section>
      <div class="grid2">
        <section class="panel"><header><h2>Работы по договору</h2></header><div class="pad"><div class="qlinks">${c.tasks.map(t => objLink(M, t.id)).join('') || empty('Работы не привязаны (договор услуг).')}</div></div></section>
        <section class="panel"><header><h2>Исполнительная документация</h2></header><div class="pad"><div class="qlinks">${idDocs.map(d => objLink(M, d.id, d.code + ' — ' + d.title)).join('') || empty('ИД по работам договора нет.')}</div></div></section>
      </div>`;
    return { html, crumb: c.no };
  }
  const STEPS = [['sent', 'Заявка'], ['review', 'Проверка'], ['pre', 'Предв. согласовано'], ['accept', 'Приёмка'], ['accepted', 'Принято'], ['formed', 'КС-2'], ['agreed', 'Согласовано'], ['period', 'Расчётный период'], ['paid', 'Оплата']];
  function ksActions(k) {
    const nx = DSF.KS_NEXT[k.status] || [];
    const L = {
      sent: [ROLE.gc, k.status === 'draft' ? 'Направить на предварительную проверку' : 'Направить повторно'], review: [ROLE.tz, 'Начать проверку'], pre: [ROLE.tz, 'Предварительно согласовать'], remarks: [ROLE.tz, 'Вернуть с замечаниями'],
      accept: [ROLE.tz, 'Назначить приёмку'], accepted: [ROLE.tz, 'Работы приняты'], partial: [ROLE.tz, 'Принято частично'], rejected: [ROLE.tz, 'Не принято — замечания'],
      formed: [ROLE.gc, 'Сформировать КС-2 по принятому объёму'], agreed: [ROLE.tz, 'Согласовать КС-2'], period: [ROLE.tz, 'Включить в расчётный период']
    };
    return nx.filter(to => DSF.can(['sent', 'formed'].includes(to) ? 'ksgc' : 'kstz')).map(to => `<button class="btn ${['accept', 'formed', 'agreed', 'pre', 'accepted', 'sent', 'review', 'period'].includes(to) ? 'primary' : ''}" type="button" data-x="ks-act" data-ks="${esc(k.id)}" data-to="${to}"><span class="role">${L[to][0]}:</span> ${L[to][1]}</button>`).join('');
  }
  function ksCard(M, k) {
    const P = M.P, c = k.contract, st = ksSt(k), r = st.r;
    const ev = k.event ? M.evBy.get(k.event) : null;
    const idDocs = M.documents.filter(d => d.cat === 'id' && d.taskIds.some(id => (k.lines || []).some(l => l.task.id === id)) && d.cur && d.cur.d <= k.d + 20 && d.cur.d >= k.period - 40);
    const stepIdx = STEPS.findIndex(s => DSF.KS_STATUS[s[0]].r >= r && s[0] !== 'remarks');
    const reached = s => DSF.KS_STATUS[s].r <= r && !(k.status === 'rejected' && s === 'accepted') && !(k.status === 'remarks' && s === 'pre');
    const kclaim = k.obj ? k.claimed / k.obj : 1;
    const html = `<div class="topback">${backBtn(link(P.id, 'budget', c.id), c.no)}</div>
      <section class="panel"><header><div style="min-width:0; flex:1"><div class="eyebrow">${esc(c.no)} · ${esc(c.contractor)} · ${esc(mon(k.period))}</div><h2 style="margin-top:6px">${esc(k.no)}${k.user ? ' (создана в системе)' : ''}</h2></div><div class="fchips">${chip(st.t, st.c)}${chip('Этап ' + st.stage + ' из 2', 'neutral')}</div></header>
        <div class="pad">
          <div class="steps"><div class="st-g"><span class="eyebrow">Этап 1 · приёмка работ</span><div>${STEPS.slice(0, 5).map(([s, t]) => `<span class="stp ${reached(s) ? 'on' : ''} ${s === k.status ? 'cur' : ''}">${t}</span>`).join('')}</div></div>
            <div class="st-g"><span class="eyebrow">Этап 2 · КС-2 по принятому</span><div>${STEPS.slice(5).map(([s, t]) => `<span class="stp ${reached(s) ? 'on' : ''} ${s === k.status ? 'cur' : ''}">${t}</span>`).join('')}</div></div></div>
          <div class="tiles" style="margin-top:14px">
            ${tile('Выполнено по графику', mln(k.obj) + ' <small>млн ₽</small>', 'за период')}
            ${tile('Заявлено подрядчиком', mln(k.claimed) + ' <small>млн ₽</small>', k.claimed > k.obj + 0.05 ? 'выше выполнения на ' + mln(k.claimed - k.obj) + ' млн ₽' : '', k.claimed > k.obj * 1.03 ? 'warn' : '')}
            ${tile('Принято ТЗ', k.accepted != null ? mln(k.accepted) + ' <small>млн ₽</small>' : '—', k.accepted != null && k.accepted < k.obj - 0.05 ? 'не принято ' + mln(k.obj - k.accepted) : r < 5 ? 'после приёмки' : '', k.status === 'partial' ? 'warn' : k.accepted ? 'good' : '')}
            ${tile('Сумма КС-2', k.amount != null ? mln(k.amount) + ' <small>млн ₽</small>' : '—', r >= 6 ? (r >= 7 ? 'согласовано' : 'на согласовании') : 'формируется после приёмки', r >= 7 ? 'good' : '')}
            ${tile('Оплата', k.status === 'paid' ? 'Оплачено' : r >= 7 ? 'К оплате' : '—', k.status === 'paid' ? fd(k.history.find(h => h.st === 'paid').d) : '')}
          </div>
          ${ksActions(k) ? `<div class="mf" style="padding:14px 0 0">${ksActions(k)}${ev ? `<button class="btn" type="button" data-x="letter" data-id="${esc(ev.id)}">${ico('mail')}Подготовить приглашение на приёмку</button>` : ''}</div>` : ev ? `<div class="mf" style="padding:14px 0 0"><button class="btn" type="button" data-x="letter" data-id="${esc(ev.id)}">${ico('mail')}Подготовить письмо по приёмке</button></div>` : ''}
          ${k.note ? `<div class="note warn" style="margin-top:12px">${esc(k.note)}</div>` : ''}
        </div></section>
      ${DSF.uiFlow ? DSF.uiFlow.ksExtra(M, k) : ''}
      <div class="grid2">
        <section class="panel"><header><h2>Заявленные работы</h2><span class="sub">объём за период по работам графика · млн ₽</span></header>
          <div class="pad tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th>Объём в периоде</th><th>По графику</th><th>Заявлено</th></tr></thead>
          <tbody>${(k.lines || []).map(l => `<tr class="link" data-go="${link(P.id, 'schedule')}" data-task="${l.task.id}"><td class="l w">${esc(l.task.name)}</td><td>${num(l.p0, 0)} → ${num(l.p1, 0)}%</td><td>${mln(l.amount)}</td><td>${mln(l.amount * kclaim)}</td></tr>`).join('') || `<tr><td colspan="4" class="l">${empty('Услуги по договору — без привязки к объёмам работ.')}</td></tr>`}</tbody>
          <tfoot><tr><td class="l">Итого</td><td></td><td>${mln(sum(k.lines || [], l => l.amount))}</td><td>${mln(sum(k.lines || [], l => l.amount) * kclaim)}</td></tr></tfoot></table></div></section>
        <section class="panel"><header><h2>Приёмка и документы</h2></header><div class="pad">
          ${linkBlock('Приёмка в календаре', ev ? objLink(M, ev.id) + `<div class="faint" style="font-size:12px; margin-top:4px">${esc(ev.place || '')}${ev.people && ev.people.length ? ' · ' + esc(ev.people.join(', ')) : ''}</div>` : (r < 4 ? '<div class="faint" style="font-size:12.5px">Приёмка назначается после предварительного согласования.</div>' : ''))}
          ${linkBlock('Договор и статья бюджета', objLink(M, c.id) + `<button class="qlink" type="button" data-x="bi-open" data-code="${esc(c.item)}"><b>Статья</b> ${esc((M.itemBy.get(c.item) || {}).name || c.item)}</button>`)}
          ${linkBlock('Исполнительная документация', idDocs.length ? `<div class="qlinks">${idDocs.map(d => objLink(M, d.id, d.code + ' — ' + d.title)).join('')}</div>` : '<div class="faint" style="font-size:12.5px">ИД за период не найдена</div>')}
        </div></section>
      </div>
      <section class="panel"><header><h2>История прохождения</h2></header><div class="pad"><div class="feed">${k.history.slice().sort((a, b) => b.d - a.d).map(h => H.feedRow(h.d, stVar((DSF.KS_STATUS[h.st] || {}).c || 'neutral'), esc(h.text || (DSF.KS_STATUS[h.st] || {}).t || ''), [h.by, h.note].filter(Boolean).join(' · '))).join('')}</div></div></section>`;
    return { html, crumb: k.no, crumbParent: { t: c.no, go: link(P.id, 'budget', c.id) } };
  }
  function ksNewForm(M) {
    const c = M.contractBy.get(UI.ksTarget);
    return `<form data-form="ks-new" class="mform"><div class="mh"><div><div class="eyebrow">${ROLE.gc} · ${esc(c.contractor)}</div><h3 style="margin-top:4px">Предварительная КС-2 по договору ${esc(c.no)}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb"><div class="note">Заявка подрядчика не считается принятым выполнением: сумма попадёт в «Заявлено», в «Принято» — только после приёмки Техническим заказчиком.</div>
        ${kv([['Выполнено после последней КС-2', mln(c.unacted) + ' млн ₽ — по подтверждённому ежедневному факту'], ['Период', mon(monthStart(T()))]])}
        ${DSF.uiFlow ? DSF.uiFlow.ksNewExtra(M, c) : ''}
        <div class="fld"><label for="ks-claim">Заявляемая сумма, млн ₽</label><input id="ks-claim" name="claimed" type="number" step="0.1" min="0.1" required value="${(Math.round(c.unacted * 10) / 10).toFixed(1)}" autofocus></div>
        <div class="fld"><label for="ks-note">Комментарий подрядчика</label><input id="ks-note" name="note"></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Создать черновик КС-2</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.FORMS['ks-new'] = function (f, r) {
    const M = M0(), c = M.contractBy.get(UI.ksTarget), fd_ = new FormData(f);
    const claimed = +String(fd_.get('claimed')).replace(',', '.');
    if (!(claimed > 0)) return;
    let id;
    store.update(r.pid, s => { id = 'ks-' + c.id + '-u' + (s.seq++); s.ks.push({ id, contract: c.id, date: today(), obj: c.unacted, claimed, note: String(fd_.get('note') || '').trim(), by: c.contractor, no: 'КС-2 № ' + (c.ks.length + 1) }); });
    closeModal(); H.go(link(r.pid, 'budget', id));
    toast('Черновик КС-2 создан. Следующий шаг — «Направить на предварительную проверку».');
  };
  function ksResultForm(M) {
    const k = M.ksBy.get(UI.ksAct.ks), to = UI.ksAct.to;
    const title = { partial: 'Принято частично', rejected: 'Не принято — замечания', remarks: 'Вернуть с замечаниями', sent: 'Направить повторно' }[to];
    return `<form data-form="ks-result" class="mform"><div class="mh"><div><div class="eyebrow">${esc(k.contract.no)} · ${esc(k.no)}</div><h3 style="margin-top:4px">${esc(title)}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">${to === 'partial' ? `${kv([['Выполнено по графику', mln(k.obj) + ' млн ₽'], ['Заявлено', mln(k.claimed) + ' млн ₽']])}<div class="fld"><label for="ksr-acc">Принятый объём, млн ₽</label><input id="ksr-acc" name="accepted" type="number" step="0.1" min="0" max="${k.obj.toFixed(1)}" required value="${(Math.round(k.obj * 0.9 * 10) / 10).toFixed(1)}" autofocus><span class="hint">Не больше фактически выполненного объёма (${mln(k.obj)}). Непринятое вернётся в «не предъявлено».</span></div>` : ''}
        ${to === 'sent' ? `<div class="fld"><label for="ksr-claim">Заявляемая сумма, млн ₽</label><input id="ksr-claim" name="claimed" type="number" step="0.1" min="0.1" value="${(Math.round(Math.min(k.claimed, k.obj) * 10) / 10).toFixed(1)}"></div>` : ''}
        <div class="fld"><label for="ksr-note">${to === 'sent' ? 'Комментарий подрядчика' : 'Замечания'}</label><textarea id="ksr-note" name="note" ${to !== 'sent' ? 'required' : ''}></textarea></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.FORMS['ks-result'] = function (f, r) {
    const fd_ = new FormData(f), a = UI.ksAct, M = M0(), k = M.ksBy.get(a.ks);
    const op = { ks: a.ks, to: a.to, date: today(), note: String(fd_.get('note') || '').trim(), by: a.to === 'sent' ? k.contract.contractor : ROLE.tz };
    if (a.to === 'partial') { const v = +String(fd_.get('accepted')).replace(',', '.'); if (!(v >= 0) || v > k.obj + 0.05) { toast('Принятый объём не может превышать выполненный (' + mln(k.obj) + ' млн ₽).'); return; } op.accepted = v; op.text = 'Принято частично: ' + F.num(v, 1) + ' млн ₽ из ' + F.num(k.claimed, 1); }
    if (a.to === 'sent' && fd_.get('claimed')) op.claimed = +String(fd_.get('claimed')).replace(',', '.');
    store.update(r.pid, s => s.ksOps.push(op));
    closeModal(); keepPage();
  };

  /* ====================================================================
   * ДЕЙСТВИЯ (data-x)
   * ==================================================================== */
  const A = U.ACTIONS;
  A.ev = (el, d) => { UI.evOpen = d.id; openModal(M => eventCard(M, UI.evOpen)); };
  A['ev-new'] = (el, d) => { const M = M0(); startEventForm(M, d.date ? { date: d.date } : {}); };
  A['ev-edit'] = (el, d) => {
    const M = M0(); const src = (M.P.events || []).concat(M.store.events).find(e => e.id === d.id);
    const ev = M.events.find(e => e.id === d.id || e.series === d.id);
    if (!ev) return;
    startEventForm(M, { editId: d.id, title: ev.title, type: ev.type, date: iso(ev.series ? dn((src && src.date) || iso(ev.date)) : ev.date), time: ev.time, dur: ev.dur, place: ev.place, people: ev.people, owner: ev.owner, desc: ev.desc, tasks: (ev.tasks || []).map(t => t.id), docs: ev.docIds || [], order: ev.orderId });
  };
  A['ev-del'] = (el, d) => {
    const r = route();
    if (UI.confirmDel !== d.id) { UI.confirmDel = d.id; el.textContent = 'Подтвердить удаление'; el.classList.add('danger'); return; }
    store.update(r.pid, s => s.eventOps.push({ op: 'delete', id: d.id }));
    UI.confirmDel = null; closeModal(); keepPage(); toast('Событие удалено.');
  };
  A.letter = (el, d) => {
    const M = M0(), e = M.evBy.get(d.id); if (!e) return;
    UI.letterDraft = letterFor(M, e); UI.toast = null;
    openModal(letterModal, { wide: true });
  };
  A['letter-copy'] = () => {
    const L = UI.letterDraft, text = 'Кому: ' + L.to + '\nТема: ' + L.subject + '\n\n' + L.body;
    const ok = () => toast('Текст письма скопирован.');
    const fallback = () => { const ta = document.getElementById('letter-body'); if (ta) { ta.focus(); ta.select(); } toast('Выделите текст и скопируйте его (Ctrl/⌘ + C).'); };
    try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
  };
  A['letter-save'] = () => {
    const r = route(), M = M0(), L = UI.letterDraft, e = M.evBy.get(L.eventId);
    let id;
    store.update(r.pid, s => {
      id = 'let-u' + (s.seq++);
      s.letters.push({ id, dir: 'out', no: 'Черновик ' + id.split('-u')[1], date: today(), from: M.P.customer, to: L.to, subject: L.subject, status: 'Черновик', body: L.body,
        events: e ? [e.series && !M.evBy.get(e.id) ? e.series : e.id] : [], docs: e ? (e.docIds || []) : [], tasks: e ? (e.tasks || []).map(t => t.id) : [], orders: e && e.orderId ? [e.orderId] : [] });
    });
    UI.letterDraft = null; closeModal();
    toast(`Черновик сохранён в «Документы → Письма».<div class="ta"><button type="button" data-go="${link(r.pid, 'docs', id)}">Открыть письмо</button></div>`, 7000);
  };
  A['cal-view'] = (el, d) => { UI.calView = d.v; keepPage(); };
  A['cal-type'] = (el, d) => { if (!UI.calTypes) UI.calTypes = new Set(CAL_TYPES); UI.calTypes.has(d.t) ? UI.calTypes.delete(d.t) : UI.calTypes.add(d.t); keepPage(); };
  A['cal-nav'] = (el, d) => {
    const r = route(), t = T(), view = UI.calView || (window.innerWidth < 768 ? 'agenda' : 'month');
    UI.calWeek = UI.calWeek || {};
    if (view === 'week') { const cur = UI.calWeek[r.pid] != null ? UI.calWeek[r.pid] : t - ((new Date(t * 864e5).getUTCDay() + 6) % 7); UI.calWeek[r.pid] = d.dir === '0' ? t - ((new Date(t * 864e5).getUTCDay() + 6) % 7) : cur + 7 * (+d.dir); }
    else { const cur = UI.calMonth[r.pid] != null ? UI.calMonth[r.pid] : monthStart(t); UI.calMonth[r.pid] = d.dir === '0' ? monthStart(t) : addMonths(cur, +d.dir); }
    keepPage();
  };
  A['cal-day'] = (el, d) => { const r = route(); UI.calView = 'week'; UI.calWeek = UI.calWeek || {}; const x = +d.date; UI.calWeek[r.pid] = x - ((new Date(x * 864e5).getUTCDay() + 6) % 7); keepPage(); };
  A['ord-filter'] = (el, d) => { UI.ordFilter = d.f; keepPage(); };
  A['ord-new'] = (el, d) => { UI.ordDraft = { protocol: d.protocol || null }; openModal(orderForm, { wide: true }); };
  A['ord-status'] = (el, d) => { const r = route(); store.update(r.pid, s => s.orderOps.push({ order: d.id, op: 'status', to: d.to, date: today(), by: ROLE.tz })); keepPage(); toast(d.to === 'work' ? 'Поручение в работе.' : 'Статус обновлён.'); };
  A['ord-done'] = (el, d) => { UI.ordTarget = d.id; openModal(() => smallForm('Отметить выполненным', 'Результат исполнения', 'comment', '', 'ord-done')); };
  A['ord-comment'] = (el, d) => { UI.ordTarget = d.id; const o = M0().orderBy.get(d.id); openModal(() => smallForm('Комментарий к поручению № ' + o.no, 'Комментарий', 'comment', o.comment, 'ord-comment')); };
  A['ord-event'] = (el, d) => { const M = M0(), o = M.orderBy.get(d.id); startEventForm(M, { title: 'Контроль исполнения поручения № ' + o.no, type: 'conference', date: iso(Math.max(T(), o.due)), order: o.id, forOrder: o.id, owner: o.owner, people: [o.owner], tasks: o.taskIds, docs: o.docIds.filter(id => M.docBy.get(id)), desc: o.text }); };
  A['doc-sec'] = (el, d) => { const r = route(); UI.docSection = UI.docSection || {}; UI.docSection[r.pid + d.cat] = UI.docSection[r.pid + d.cat] === d.sec ? 'all' : d.sec; keepPage(); };
  A['doc-upload'] = (el, d) => { const M = M0(); const ex = d.doc ? M.docBy.get(d.doc) : null; UI.upDraft = { cat: ex ? ex.cat : (d.cat || 'rd'), docId: ex ? ex.id : null, section: ex ? ex.section : null }; openModal(uploadForm, { wide: true }); };
  A['doc-act'] = (el, d) => {
    const r = route();
    if (d.op === 'transfer' || d.op === 'return' || d.op === 'annul') { UI.docAct = { doc: d.doc, rev: d.rev, op: d.op }; openModal(docActForm); return; }
    store.update(r.pid, s => s.docOps.push({ op: d.op, doc: d.doc, rev: d.rev, date: today(), by: ROLE.tz }));
    keepPage(); toast(d.op === 'review' ? 'Редакция направлена на проверку.' : 'Редакция согласована. Следующий шаг — «Передать в производство работ».');
  };
  A['ks-filter'] = (el, d) => { UI.ksFilter = d.f; keepPage(); };
  A['bi-toggle'] = (el, d) => { const r = route(); UI.biOpen = UI.biOpen || {}; UI.biOpen[r.pid + d.code] = !UI.biOpen[r.pid + d.code]; keepPage(); };
  A['bi-open'] = (el, d) => { const r = route(); UI.biOpen = UI.biOpen || {}; UI.biOpen[r.pid + d.code] = true; H.go(link(r.pid, 'budget')); };
  A['ks-new'] = (el, d) => { UI.ksTarget = d.cid; openModal(ksNewForm); };
  A['ks-act'] = (el, d) => {
    const r = route(), M = M0(), k = M.ksBy.get(d.ks);
    if (d.to === 'accept') {
      const c = k.contract;
      startEventForm(M, { ks: k.id, type: 'acceptance', title: 'Приёмка работ: ' + c.subject + ' (' + k.no + ')', date: iso(T() + 2), time: '10:00', dur: 120, place: 'Объект', owner: M.P.supervisor, people: [M.P.supervisor, c.contractor, M.P.customer], tasks: (k.lines || []).map(l => l.task.id), desc: 'Приёмка объёмов, заявленных в ' + k.no + ' за ' + mon(k.period) + ': ' + F.num(k.claimed, 1) + ' млн ₽.' });
      return;
    }
    if (['partial', 'rejected', 'remarks'].includes(d.to) || (d.to === 'sent' && ['remarks', 'rejected'].includes(k.status))) { UI.ksAct = { ks: d.ks, to: d.to }; openModal(ksResultForm); return; }
    const texts = { sent: 'Подрядчик направил КС-2 на предварительную проверку', review: 'Технический заказчик начал проверку', pre: 'Предварительно согласовано Техническим заказчиком', accepted: 'Работы приняты в полном объёме', formed: 'КС-2 сформирована по принятому объёму', agreed: 'КС-2 согласована', period: 'Включено в расчётный период ' + mon(monthStart(T())) };
    store.update(r.pid, s => s.ksOps.push({ ks: d.ks, to: d.to, date: today(), by: d.to === 'sent' || d.to === 'formed' ? k.contract.contractor : ROLE.tz, text: texts[d.to] }));
    keepPage(); toast(esc(texts[d.to] || 'Статус обновлён') + '.');
  };

  /* запуск — в admin.js после регистрации административных экранов */
})();
