/*
 * Flow — экраны реального контура, которым нужен источник «как есть».
 *
 * Бюджет реальных объектов показывается в единой структуре Flow («Бюджет и КС»), но с показателями
 * исходного реестра объекта: сумма договора, закрытие актами КС-2, план закрытия, аванс, удержание,
 * оплачено. Если показатель в источнике не передан — «—», расчётных подстановок нет.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI;
  const { esc, fd, chip, ico, link, plural, pct } = H;
  const mln = v => v == null || !isFinite(v) ? '—' : (v / 1e6).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const has = v => v != null && isFinite(v);
  const tile = (l, v, s2, c) => `<div class="tile ${c || ''}"><div class="eyebrow">${l}</div><div class="v">${v}</div>${s2 ? `<div class="s">${s2}</div>` : ''}</div>`;
  const sumK = (list, k) => { const xs = list.filter(c => has(c[k])); return xs.length ? xs.reduce((a, c) => a + c[k], 0) : null; };

  DSF.legacyBudget = function (M) {
    const P = M.P, L = P.legacy || {}, cs = L.contracts || [];
    const head = `<section class="head" style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:flex-end">
      <div style="flex:1 1 420px; min-width:0"><div class="eyebrow">${esc(P.name)} · бюджет и КС</div><h1 style="margin-top:8px">Бюджет <span class="ac">и КС</span></h1>
      <p class="muted" style="margin-top:8px; max-width:78ch">Реестр договоров и закрытие актами КС-2 — по данным объекта. Показатели, которых нет в источнике, показаны как «—».</p></div>
      <div class="hd-r"><a class="btn" href="${esc(P.module)}#/budget">${ico('edit')}Договоры и КС-2 — ввод</a></div></section>`;
    if (!cs.length) return { html: head + `<section class="panel"><div class="pad"><div class="empty">Нет данных. ${esc(L.budgetNote || 'Бюджет и договоры объекта не переданы.')}</div></div></section>` };
    const price = sumK(cs, 'price'), closed = sumK(cs, 'closed'), plan = sumK(cs, 'planToDate'), paid = sumK(cs, 'paid'), adv = sumK(cs, 'advance'), ret = sumK(cs, 'retention');
    const total = L.budgetTotal;
    const html = head + `
      <section class="tiles">
        ${tile('Бюджет проекта', has(total) ? mln(total) + ' <small>млн ₽</small>' : '—', has(total) ? '' : 'общая стоимость не передана')}
        ${tile('Законтрактовано', mln(price) + ' <small>млн ₽</small>', cs.length + ' ' + plural(cs.length, 'договор', 'договора', 'договоров'))}
        ${tile('Закрыто актами КС-2', mln(closed) + ' <small>млн ₽</small>', has(price) && price ? pct(closed / price * 100) + ' от суммы договоров' : '', 'good')}
        ${tile('План закрытия на дату', has(plan) ? mln(plan) + ' <small>млн ₽</small>' : '—', has(plan) ? (closed - plan >= 0 ? 'выше плана на ' + mln(closed - plan) : 'ниже плана на ' + mln(plan - closed)) + ' млн ₽' : 'план закрытия не передан', has(plan) && closed < plan ? 'warn' : '')}
        ${tile('Оплачено', has(paid) ? mln(paid) + ' <small>млн ₽</small>' : '—', has(paid) ? '' : 'в источнике не передано')}
        ${tile('Аванс / удержание', (has(adv) ? mln(adv) : '—') + ' / ' + (has(ret) ? mln(ret) : '—'), 'млн ₽')}
      </section>
      ${L.budgetNote ? `<div class="note">${esc(L.budgetNote)}</div>` : ''}
      <section class="panel"><header><h2>Договоры</h2><span class="sub">млн ₽</span></header><div class="pad tbl-wrap"><table class="t">
        <thead><tr><th class="l">Договор</th><th class="l">Контрагент</th><th>Сумма</th><th>Закрыто КС-2</th><th>План на дату</th><th>Физ. выполнение</th><th>Аванс</th><th>Удержание</th><th>Предъявлено</th><th>Оплачено</th><th>Остаток</th><th class="l">Статус</th></tr></thead>
        <tbody>${cs.map(c => `<tr><td class="l w" style="min-width:180px"><b>${esc(c.short || c.number)}</b><div class="faint" style="font-size:12px">${esc(c.subject)}</div></td><td class="l w">${esc(c.counterparty)}</td><td>${mln(c.price)}</td><td>${mln(c.closed)}<div class="faint" style="font-size:11.5px">${has(c.closedPct) ? pct(c.closedPct) : ''}</div></td><td>${mln(c.planToDate)}</td><td>${has(c.phys) ? pct(c.phys) : '—'}</td><td>${mln(c.advance)}</td><td>${mln(c.retention)}</td><td>${mln(c.presented)}</td><td>${mln(c.paid)}</td><td>${mln(c.rest)}</td><td class="l">${c.status ? chip(c.status.t, c.status.c) : '—'}</td></tr>`).join('')}</tbody>
      </table></div></section>
      ${cs.map(c => { const ms = c.months || {}, list = ms.list || []; if (!list.length && !(ms.pre && ms.pre.fact)) return ''; return `<section class="panel"><header><h2>Закрытие по месяцам · ${esc(c.short || c.number)}</h2><span class="sub">млн ₽, акты КС-2</span></header><div class="pad tbl-wrap"><table class="t">
        <thead><tr><th class="l">Период</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>
        ${ms.pre ? `<tr><td class="l">${esc(ms.pre.label || 'ранее')}</td><td>${ms.pre.plan == null ? '—' : ms.pre.plan.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td><td>${ms.pre.fact == null ? '—' : ms.pre.fact.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td><td>${ms.pre.plan == null || ms.pre.fact == null ? '—' : (ms.pre.fact - ms.pre.plan).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td></tr>` : ''}
        ${list.map(([ym, pl, fa]) => `<tr><td class="l">${ym.slice(5)}.${ym.slice(0, 4)}</td><td>${pl == null ? '—' : pl.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td><td>${fa == null ? '—' : fa.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td><td>${pl == null || fa == null ? '—' : (fa - pl).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td></tr>`).join('')}
        </tbody></table>${c.monthsNote ? `<div class="faint" style="font-size:12px; margin-top:6px">${esc(c.monthsNote)}</div>` : ''}</div></section>`; }).join('')}`;
    return { html };
  };

  /* производство реального объекта: суточные сводки и журнал — в рабочем модуле объекта */
  const baseProd = U.VIEWS.production;
  U.VIEWS.production = function (M, r) {
    const v = baseProd(M, r);
    const P = M.P; if (P.source !== 'legacy' || r.sub) return v;
    const nav = (P.legacy && P.legacy.nav) || [];
    const box = `<section class="panel"><header><h2>Данные площадки</h2><span class="sub">источник — рабочий модуль объекта</span></header><div class="pad">
      <p class="muted" style="font-size:13px; margin-bottom:10px">Суточные сводки, журнал, производственные показатели и отчёты объекта ведутся в рабочем модуле — там же сохранена вся история. Ниже — ежедневный факт в формате Flow.</p>
      <div class="fchips">${nav.map(([h, t]) => `<a class="btn" href="${esc(P.module)}${esc(h)}">${esc(t)}</a>`).join('')}<a class="btn" href="${esc(P.module)}#/admin">${ico('edit')}Обновление данных</a></div></div></section>`;
    v.html = v.html.replace('</section>', '</section>' + box);
    return v;
  };
})();
