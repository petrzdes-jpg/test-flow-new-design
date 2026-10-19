/*
 * Flow — ролевые экраны.
 *
 *  · Корректировки графика: запрос подрядчика → техзаказчик → директор, анализ влияния;
 *    у директора — раздел «График на корректировку» (по объекту и по всем объектам).
 *  · Кабинет подрядчика: свои работы, ежедневный прогресс, свой договор, свои КС-2.
 *  · Обзор инвестора: только «Готовность», «Срок», «Бюджет», график реализации и фото.
 *  · Подрядчики и договоры объекта; исполнительная документация.
 *  · База подрядчиков (администратор демо-режима): реквизиты, контакты, назначения, учётные записи.
 *
 * Интерфейс показывает только доступное роли; сервер повторно проверяет каждое действие.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, fd, fds, num, pct, money, bn, chip, ico, link, plural, days, stVar, can, toast, openModal, closeModal, keepPage } = H;
  const { dn, iso, sum } = DSF.util;
  const T = () => H.T();
  const today = () => iso(T());
  const role = () => DSF.auth.role;
  const myOrg = () => DSF.auth.org();
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const err = (f, m) => { const e = f.querySelector('.err'); if (e) { e.hidden = false; e.textContent = m; } };
  const shift = d => d == null ? '—' : d === 0 ? '0 дн.' : `<span class="cr-shift ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${Math.abs(d)} дн.</span>`;
  const M0 = () => { const r = H.route(); return r.pid ? DSF.build(H.byId(r.pid)) : null; };
  const head = (eyebrow, h1, ac, sub, right) => `<section class="head" style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:flex-end">
      <div style="flex:1 1 420px; min-width:0"><div class="eyebrow">${eyebrow}</div><h1 style="margin-top:8px">${h1} <span class="ac">${ac}</span></h1>${sub ? `<p class="muted" style="margin-top:8px; max-width:78ch">${sub}</p>` : ''}</div>
      ${right ? `<div class="hd-r">${right}</div>` : ''}</section>`;
  const tile = (l, v, s2, c) => `<div class="tile ${c || ''}"><div class="eyebrow">${l}</div><div class="v">${v}</div>${s2 ? `<div class="s">${s2}</div>` : ''}</div>`;
  const mineTask = t => role() !== 'contractor' || (!!t.contract && t.contractor === myOrg());

  /* название раздела корректировок зависит от роли */
  const corrTitle = () => can('corr_dir') && !can('corr_tz') ? 'График на корректировку' : role() === 'contractor' ? 'Корректировка графика' : 'Корректировки графика';
  const sec = U.SECTIONS.find(x => x[0] === 'corrections'); if (sec) { sec[1] = corrTitle(); sec[3] = role() === 'director' ? 'На корректировку' : 'Корректировки'; }
  const bsec = U.SECTIONS.find(x => x[0] === 'budget'); if (bsec && role() === 'contractor') { bsec[1] = 'Мой договор и КС-2'; bsec[3] = 'Мой договор'; }
  const bsec2 = U.SECTIONS.find(x => x[0] === 'budget'); if (bsec2 && role() !== 'contractor') { bsec2[1] = 'Бюджет и КС'; }

  /* ===================================================== корректировки графика */
  const ST = k => DSF.CHANGE_STATUS[k] || { t: k, c: 'neutral' };
  const waitsMe = c => (c.status === 'tz' && can('corr_tz')) || (c.status === 'director' && can('corr_dir')) || (c.status === 'returned' && role() === 'contractor' && c.org === myOrg());
  const impactCache = new Map();
  function impactOf(M, c) {
    const k = M.P.id + ':' + c.id + ':' + c.ps + ':' + c.pf + ':' + (M.store.changeOps || []).length + ':' + (M.store.reportOps || []).length;
    if (!impactCache.has(k)) { try { impactCache.set(k, DSF.changeImpact(M.P, c)); } catch (e) { console.error(e); impactCache.set(k, null); } }
    return impactCache.get(k);
  }
  function rowsOf(M) {
    return (M.changes || []).map(c => ({ c, t: M.byId.get(c.task), M })).filter(x => x.t);
  }
  function corrTable(rows, withProject) {
    if (!rows.length) return corrTableDesk(rows, withProject);
    return `<div class="cr-desk">${corrTableDesk(rows, withProject)}</div><div class="cr-cards">${rows.map(({ c, t, M }) => { const I = c.status === 'tz' || c.status === 'director' || c.status === 'returned' ? impactOf(M, c) : null; return `<button class="cr-card" type="button" data-go="${link(M.P.id, 'corrections', c.id)}">
      <div class="cr-ch">${chip(ST(c.status).t, ST(c.status).c)}${waitsMe(c) ? chip('ждёт вашего решения', 'warn') : ''}</div>
      <b>${esc(t.name)}</b><div class="faint" style="font-size:12px">${withProject ? esc(M.P.name) + ' · ' : ''}${esc(c.org || '—')}</div>
      <div class="cr-dates" style="font-size:12.5px">${fd(dn(c.pf0))} → ${fd(dn(c.pf))} ${shift(dn(c.pf) - dn(c.pf0))}</div>
      ${I ? `<div style="font-size:12.5px">Ввод: ${I.state === 'insufficient' ? 'недостаточно данных' : I.state === 'error' ? 'ошибка расчёта' : I.endShift ? shift(I.endShift) : 'не меняется'}</div>` : ''}</button>`; }).join('')}</div>`;
  }
  function corrTableDesk(rows, withProject) {
    if (!rows.length) return `<div class="empty">${role() === 'contractor' ? 'Вы ещё не направляли запросов на корректировку графика.' : 'Запросов на корректировку графика нет.'}</div>`;
    return `<div class="tbl-wrap"><table class="t cr-tbl"><thead><tr>${withProject ? '<th class="l">Объект</th>' : ''}<th class="l">Подрядчик</th><th class="l">Работа</th><th class="l">Текущий срок</th><th class="l">Предложенный срок</th><th class="l">Обоснование</th><th class="l">Решение ТЗ</th><th>Влияние на ввод</th><th class="l">Статус</th></tr></thead><tbody>
      ${rows.map(({ c, t, M }) => { const I = c.status === 'tz' || c.status === 'director' || c.status === 'returned' ? impactOf(M, c) : null; return `<tr class="link" data-go="${link(M.P.id, 'corrections', c.id)}">
        ${withProject ? `<td class="l"><b>${esc(M.P.name)}</b></td>` : ''}
        <td class="l w" style="min-width:120px">${esc(c.org || '—')}</td>
        <td class="l w" style="min-width:150px"><b>${esc(t.name)}</b><div class="faint" style="font-size:12px">${esc(t.stage)}</div></td>
        <td class="l cr-dates">${fd(dn(c.ps0))} – ${fd(dn(c.pf0))}</td>
        <td class="l cr-dates">${fd(dn(c.ps))} – ${fd(dn(c.pf))}<div>${shift(dn(c.pf) - dn(c.pf0))}</div></td>
        <td class="l w" style="min-width:140px">${esc(c.reason || '—')}${c.comment ? `<div class="faint" style="font-size:12px">${esc(c.comment)}</div>` : ''}</td>
        <td class="l">${c.tzDecision ? chip(c.tzDecision.t, c.tzDecision.c) : '<span class="faint">ожидается</span>'}</td>
        <td>${I ? (I.state === 'error' ? chip('ошибка', 'crit') : I.state === 'insufficient' ? chip('нет данных', 'warn') : I.endShift ? shift(I.endShift) : '<span class="faint">не влияет</span>') + (I.orgs && I.orgs.length ? `<div class="faint" style="font-size:11.5px">затронуто подрядчиков: ${I.orgs.length}</div>` : '') : c.status === 'approved' ? '<span class="faint">в прогнозе</span>' : '—'}</td>
        <td class="l">${chip(ST(c.status).t, ST(c.status).c)}${waitsMe(c) ? '<div style="margin-top:4px">' + chip('ждёт вашего решения', 'warn') + '</div>' : ''}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  }
  U.VIEWS.corrections = function (M, r) {
    if (r.sub) { const c = (M.changes || []).find(x => x.id === r.sub); if (c) return corrCard(M, c); }
    const rows = rowsOf(M).sort((a, b) => (waitsMe(b.c) - waitsMe(a.c)) || String(b.c.date).localeCompare(String(a.c.date)));
    const waiting = rows.filter(x => waitsMe(x.c));
    const right = can('corr_req') ? `<button class="btn primary" type="button" data-x="corr-new">${ico('plus')}Запросить корректировку</button>` : '';
    const sub = role() === 'contractor' ? 'Утверждённый график подрядчик не меняет. Запрос проходит согласование: Технический заказчик → Директор по строительству. До утверждения график не меняется.'
      : 'Запросы подрядчиков на изменение сроков. Для каждого запроса система строит теоретический сценарий: какие работы, вехи и подрядчики сдвинутся и как изменится срок ввода. Смежные сроки автоматически не меняются.';
    return { html: `${head(esc(M.P.name) + ' · планирование', role() === 'director' ? 'График на' : 'Корректировка', role() === 'director' ? 'корректировку' : 'графика', sub, right)}
      <section class="tiles">${tile('Ждут решения', waiting.length, can('corr_dir') && !can('corr_tz') ? 'на утверждении директора' : can('corr_tz') && !can('corr_dir') ? 'на рассмотрении ТЗ' : 'на вашей ступени', waiting.length ? 'warn' : 'good')}
        ${tile('На согласовании', rows.filter(x => x.c.status === 'tz' || x.c.status === 'director').length, 'ТЗ и директор')}
        ${tile('Утверждено', rows.filter(x => x.c.status === 'approved').length, 'внесено в рабочий прогноз', 'good')}
        ${tile('Отклонено / возвращено', rows.filter(x => x.c.status === 'rejected' || x.c.status === 'returned').length, '')}</section>
      <section class="panel"><header><h2>Запросы</h2><span class="sub">маршрут: Подрядчик → Технический заказчик → Директор по строительству</span></header><div class="pad">${corrTable(rows, false)}</div></section>` };
  };
  /* анализ влияния: 9 блоков + сравнение «До/После» (единый расчёт CPM, engine-changes.js) */
  const fl = v => v == null ? '—' : v + ' дн.';
  function cmpGantt(I) {
    const items = [{ t: I.target, es0: I.target.es, ef0: I.target.ef, es1: I.prop.es, ef1: I.prop.ef, main: true }].concat(I.rows.slice(0, 14).map(r => ({ t: r.task, es0: r.es0, ef0: r.ef0, es1: r.es1, ef1: r.ef1 })));
    const all = items.flatMap(x => [x.es0, x.ef0, x.es1, x.ef1]).filter(v => v != null && isFinite(v));
    if (!all.length) return '';
    const x0 = Math.min(...all) - 3, x1 = Math.max(...all) + 3, X = d => ((d - x0) / (x1 - x0) * 100).toFixed(2) + '%', W = (a, b2) => Math.max(0.6, (b2 - a + 1) / (x1 - x0) * 100).toFixed(2) + '%';
    const T0 = H.T();
    return `<div class="cmpg">${items.map(x => `<div class="cmpg-r ${x.main ? 'main' : ''}"><div class="cmpg-n" title="${esc(x.t.name)}">${x.t.ms ? '◆ ' : ''}${esc(x.t.name)}</div>
        <div class="cmpg-b">${x.es0 != null ? `<i class="b0" style="left:${X(x.es0)}; width:${x.t.ms ? '0.8%' : W(x.es0, x.ef0)}" title="До: ${fd(x.es0)} – ${fd(x.ef0)}"></i>` : ''}${x.es1 != null ? `<i class="b1 ${x.ef1 > x.ef0 ? 'late' : ''}" style="left:${X(x.es1)}; width:${x.t.ms ? '0.8%' : W(x.es1, x.ef1)}" title="После: ${fd(x.es1)} – ${fd(x.ef1)}"></i>` : ''}
        ${T0 >= x0 && T0 <= x1 ? `<span class="cmpg-t" style="left:${X(T0)}"></span>` : ''}</div><div class="cmpg-d">${shift((x.ef1 || 0) - (x.ef0 || 0))}</div></div>`).join('')}
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--ink-3)"></i>До — текущий прогноз</span><span><i style="background:var(--accent)"></i>После — по запросу</span><span><i style="background:var(--crit)"></i>Сдвиг позже</span><span><i style="width:2px;height:12px;background:var(--accent)"></i>Отчётная дата</span></div></div>`;
  }
  function impRows(list) {
    if (!list.length) return '<div class="faint" style="font-size:13px">нет</div>';
    return `<div class="imp-list">${list.map(x => `<div class="imp-i"><div class="imp-h"><b>${esc(x.task.name)}</b>${shift(x.df)}</div>
      <div class="imp-m">${esc(x.task.stage || '')}${x.contractor ? ' · ' + esc(x.contractor) : ''}</div>
      <div class="imp-m cr-dates">${x.task.ms ? fd(x.ef0) + ' → ' + fd(x.ef1) : fd(x.es0) + ' – ' + fd(x.ef0) + ' → ' + fd(x.es1) + ' – ' + fd(x.ef1)} · резерв ${fl(x.float0)} → ${fl(x.float1)}</div>
      <div class="fchips">${!x.crit0 && x.crit1 ? chip('становится критической', 'crit') : x.crit1 ? chip('крит. путь', 'crit') : ''}${x.overDirective ? chip('позже директивного срока', 'crit') : ''}</div></div>`).join('')}</div>`;
  }
  function impactPanel(M, c) {
    const I = impactOf(M, c);
    if (!I) return '<div class="empty">Не удалось построить сценарий.</div>';
    if (I.state === 'error' && !I.rows.length) return `<div class="note warn" style="border-left:3px solid var(--crit)"><b>Ошибка расчёта.</b> ${I.errors.map(esc).join(' ')}</div>`;
    const conf = { ok: ['Расчёт достоверен', 'good'], partial: ['Расчёт с оговоркой', 'warn'], insufficient: ['Недостаточно данных', 'warn'], error: ['Ошибка расчёта', 'crit'] }[I.state] || ['—', 'neutral'];
    const blk = (n, title, body) => `<div class="imp-b"><div class="imp-bh"><span class="imp-n">${n}</span><h3>${title}</h3></div>${body}</div>`;
    return `<div class="imp-sum ${I.state}"><div>${chip(conf[0], conf[1])}</div><div class="imp-end"><b>${esc(I.endText)}</b></div>
        ${I.errors.length ? `<div class="err" style="margin-top:6px">${I.errors.map(esc).join('<br>')}</div>` : ''}
        ${I.warnings.length ? `<ul class="imp-warn">${I.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>
      <div class="imp-blocks">
        ${blk(1, 'Изменение работы', `<dl class="kv kvw"><dt>План (база)</dt><dd class="cr-dates">${fd(I.cur.ps)} – ${fd(I.cur.pf)}</dd><dt>Прогноз сейчас</dt><dd class="cr-dates">${fd(I.cur.es)} – ${fd(I.cur.ef)}</dd><dt>Предложено</dt><dd class="cr-dates">${fd(I.prop.ps)} – ${fd(I.prop.pf)} · ${shift(I.shiftEnd)} к плану</dd><dt>Прогноз по запросу</dt><dd class="cr-dates">${fd(I.prop.es)} – ${fd(I.prop.ef)} · ${shift(I.shiftForecast)} к прогнозу</dd></dl>`)}
        ${blk(2, 'Резервы времени', `<dl class="kv kvw"><dt>Общий резерв</dt><dd>${fl(I.float0)} → <b>${fl(I.float1)}</b></dd><dt>Свободный резерв</dt><dd>${fl(I.free0)} → <b>${fl(I.free1)}</b></dd></dl><p class="faint" style="font-size:12px; margin-top:6px">Сдвиг в пределах общего резерва не меняет ввод объекта; в пределах свободного — не сдвигает последующие работы.</p>`)}
        ${blk(3, 'Критический путь', `<p>${I.crit0 ? 'Работа на критическом пути.' : I.crit1 ? '<b>Работа становится критической.</b>' : 'Работа не на критическом пути.'}</p>${I.newCrit.length ? `<p style="margin-top:6px">Становятся критическими: ${I.newCrit.slice(0, 6).map(t => esc(t.name)).join(', ')}${I.newCrit.length > 6 ? '…' : ''}</p>` : ''}${I.leftCrit.length ? `<p style="margin-top:6px" class="faint">Выходят с критического пути: ${I.leftCrit.slice(0, 6).map(t => esc(t.name)).join(', ')}</p>` : ''}${!I.critChanged ? '<p class="faint" style="margin-top:6px">Состав критического пути не меняется.</p>' : ''}`)}
        ${blk(4, 'Последующие работы', impRows(I.next))}
        ${blk(5, 'Этапы', I.stages.length ? `<div class="imp-list">${I.stages.map(s2 => `<div class="imp-i"><div class="imp-h"><b>${esc(s2.name)}</b>${shift(s2.d)}</div><div class="imp-m cr-dates">окончание ${fd(s2.ef0)} → ${fd(s2.ef1)}</div></div>`).join('')}</div>` : '<div class="faint" style="font-size:13px">Сроки этапов не меняются.</div>')}
        ${blk(6, 'Вехи и директивные сроки', impRows(I.milestones) + (I.msConflicts.length ? `<div class="note" style="margin-top:8px; border-left:3px solid var(--crit)">Нарушаются директивные сроки: ${I.msConflicts.map(t => esc(t.name) + ' (' + fd(t.directive) + ')').join(', ')}</div>` : ''))}
        ${blk(7, 'Подрядчики', I.byOrg.size ? `<div class="imp-list">${[...I.byOrg.entries()].map(([o, rs]) => `<div class="imp-i"><div class="imp-h"><b>${esc(o)}</b><span class="faint">${rs.length} ${plural(rs.length, 'работа', 'работы', 'работ')}</span></div><div class="imp-m">${rs.slice(0, 4).map(r2 => esc(r2.task.name) + ' ' + (r2.df > 0 ? '+' : '') + r2.df + ' дн.').join('; ')}${rs.length > 4 ? '…' : ''}</div></div>`).join('')}</div>` : '<div class="faint" style="font-size:13px">Работы других подрядчиков не затрагиваются.</div>')}
        ${blk(8, 'Ввод объекта', `<dl class="kv kvw"><dt>Прогноз ввода</dt><dd>${fd(I.end0)}${I.endShift ? ' → <b>' + fd(I.end1) + '</b> ' + shift(I.endShift) : ' — без изменений'}</dd><dt>Директивный срок</dt><dd>${fd(I.planEnd)}</dd><dt>Отклонение</dt><dd>${I.delay0 == null ? '—' : (I.delay0 > 0 ? '+' : '') + I.delay0 + ' дн.'} → <b>${I.delay1 == null ? '—' : (I.delay1 > 0 ? '+' : '') + I.delay1 + ' дн.'}</b></dd></dl>${I.state === 'insufficient' ? '<p class="note warn" style="margin-top:8px">Недостаточно данных для достоверной оценки влияния на ввод объекта. Требуется проверка логических связей графика.</p>' : ''}`)}
        ${blk(9, 'Достоверность расчёта', `<dl class="kv kvw"><dt>Сеть связей</dt><dd>${{ ok: 'полная', partial: 'неполная', none: 'связей нет', error: 'ошибка (цикл)' }[I.network.state] || '—'}</dd><dt>Связей в графике</dt><dd>${I.network.links || 0}${I.network.coverage != null ? ' · покрытие ' + Math.round(I.network.coverage * 100) + '%' : ''}</dd><dt>Без последователей</dt><dd>${(I.network.openEnds || []).length}</dd><dt>Без предшественников</dt><dd>${(I.network.openStarts || []).length}</dd></dl><p class="faint" style="font-size:12px; margin-top:6px">Расчёт: прямой и обратный проход CPM с учётом связей FS/SS/FF/SF, лагов, рабочего календаря и ограничений.</p>`)}
      </div>
      <h3 style="margin:18px 0 8px">Сравнение «До / После»</h3>${cmpGantt(I)}
      <p class="faint" style="font-size:12px; margin-top:12px">Сценарий «как если бы запрос утвердили». После утверждения директором изменение вносится в рабочий прогноз (ограничения «начало не ранее» / «окончание не ранее»); базовый план меняется только отдельным действием «Новая версия базового плана».</p>`;
  }
  function corrCard(M, c) {
    const t = M.byId.get(c.task);
    const acts = [];
    if (c.status === 'tz' && can('corr_tz')) acts.push(['tz-approve', 'Согласовать и направить директору', 'primary'], ['tz-return', 'Вернуть на доработку', ''], ['tz-reject', 'Отклонить', '']);
    if (c.status === 'director' && can('corr_dir')) acts.push(['dir-approve', 'Утвердить — внести в рабочий прогноз', 'primary'], ['dir-return', 'Вернуть на доработку', ''], ['dir-reject', 'Отклонить', '']);
    if (role() === 'contractor' && c.org === myOrg()) {
      if (c.status === 'returned') acts.push(['resubmit', 'Исправить и направить повторно', 'primary']);
      if (c.status === 'tz' || c.status === 'director' || c.status === 'returned') acts.push(['withdraw', 'Отозвать запрос', '']);
    }
    const html = `<section class="panel"><header style="flex-wrap:wrap"><div style="min-width:0; flex:1 1 320px"><div class="eyebrow">Запрос на корректировку графика · ${esc(c.org || '')}</div><h2 style="margin-top:6px">${esc(t ? t.name : c.task)}</h2></div><div class="fchips">${chip(ST(c.status).t, ST(c.status).c)}${waitsMe(c) ? chip('ждёт вашего решения', 'warn') : ''}</div></header>
        <div class="pad"><div class="grid2">
          <dl class="kv kvw">
            <dt>Объект</dt><dd>${esc(M.P.name)}</dd><dt>Работа</dt><dd>${esc(t ? t.stage + ' · ' + t.name : c.task)}</dd>
            <dt>Подрядчик</dt><dd>${esc(c.org || '—')}</dd>
            <dt>Текущий срок</dt><dd class="cr-dates">${fd(dn(c.ps0))} – ${fd(dn(c.pf0))}</dd>
            <dt>Предложенный срок</dt><dd class="cr-dates">${fd(dn(c.ps))} – ${fd(dn(c.pf))} · ${shift(dn(c.pf) - dn(c.pf0))}</dd>
            <dt>Причина</dt><dd>${esc(c.reason || '—')}</dd><dt>Обоснование</dt><dd>${esc(c.comment || '—')}</dd>
            <dt>Решение ТЗ</dt><dd>${c.tzDecision ? chip(c.tzDecision.t, c.tzDecision.c) + (c.tzDecision.comment ? ' ' + esc(c.tzDecision.comment) : '') : '—'}</dd>
            <dt>Решение директора</dt><dd>${c.dirDecision ? chip(c.dirDecision.t, c.dirDecision.c) + (c.dirDecision.comment ? ' ' + esc(c.dirDecision.comment) : '') : '—'}</dd>
          </dl>
          <div><div class="eyebrow" style="margin-bottom:8px">История</div><div class="feed">${c.hist.map(h => `<div class="fe"><span class="d">${fds(h.d)}</span><span class="k" style="background:var(--accent)"></span><span class="x">${esc(h.text)}${h.comment ? `<small>${esc(h.comment)}</small>` : ''}${h.by ? `<small>${esc(h.by)}</small>` : ''}</span></div>`).join('')}</div></div>
        </div>
        ${acts.length ? `<div class="fchips" style="margin-top:16px">${acts.map(([op, tx, cl]) => `<button class="btn ${cl}" type="button" data-x="corr-op" data-id="${esc(c.id)}" data-op="${op}">${tx}</button>`).join('')}</div>` : ''}
        </div></section>
      ${c.status !== 'approved' && c.status !== 'withdrawn' ? `<section class="panel"><header><h2>Анализ влияния на график</h2><span class="sub">что будет, если запрос утвердить</span></header><div class="pad">${impactPanel(M, c)}</div></section>` : ''}`;
    return { html, crumb: t ? t.name : 'Запрос' };
  }
  /* форма запроса подрядчика */
  function corrForm(M) {
    const D = UI.corrDraft || {};
    const own = M.tasks.filter(t => !t.ms && !t.done && mineTask(t));
    if (!own.length) return `<div class="mh"><h3>Нет работ для корректировки</h3>${xBtn}</div><div class="mb"><p class="muted">Все ваши работы завершены или не назначены.</p></div>`;
    const t = M.byId.get(D.task) || own[0];
    const fix = D.fix ? (M.changes || []).find(c => c.id === D.fix) : null;
    return `<form data-form="corr-new" class="mform"><div class="mh"><div><div class="eyebrow">${esc(M.P.name)} · ${esc(myOrg() || '')}</div><h3 style="margin-top:4px">${fix ? 'Исправить запрос на корректировку' : 'Запрос на корректировку графика'}</h3></div>${xBtn}</div>
      <div class="mb">
        <div class="fld"><label for="cr-task">Работа</label><select id="cr-task" name="task" ${fix ? 'disabled' : ''}>${own.map(x => opt(x.id, x.stage + ' · ' + x.name, x.id === t.id)).join('')}</select></div>
        <div class="row-f"><div class="fld"><label>Текущее начало</label><input value="${fd(t.s0)}" disabled></div><div class="fld"><label>Текущее окончание</label><input value="${fd(t.f0)}" disabled></div></div>
        <div class="row-f"><div class="fld"><label for="cr-ps">Предлагаемое начало</label><input id="cr-ps" name="ps" type="date" required value="${esc(fix ? fix.ps : iso(t.s0))}" ${t.as != null ? 'readonly title="Работа уже начата — меняется только окончание"' : ''}></div>
          <div class="fld"><label for="cr-pf">Предлагаемое окончание</label><input id="cr-pf" name="pf" type="date" required value="${esc(fix ? fix.pf : iso(t.f0))}"></div></div>
        <div class="fld"><label for="cr-reason">Причина</label><select id="cr-reason" name="reason">${DSF.CHANGE_REASONS.map(x => opt(x, x, fix ? fix.reason === x : false)).join('')}</select></div>
        <div class="fld"><label for="cr-cm">Обоснование</label><textarea id="cr-cm" name="comment" rows="3" required placeholder="Что произошло, что требуется, какие документы подтверждают">${esc(fix ? fix.comment || '' : '')}</textarea></div>
        <p class="faint" style="font-size:12px">До утверждения директором утверждённый график не меняется. Влияние на смежные работы рассчитывается автоматически и будет видно техзаказчику и директору.</p>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('send')}${fix ? 'Направить повторно' : 'Направить техзаказчику'}</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.PERM_X['corr-new'] = 'corr_req'; U.PERM_F['corr-new'] = 'corr_req';
  A['corr-new'] = (el, d) => { UI.corrDraft = { task: d.id || null }; UI.sel = null; openModal(corrForm, { wide: true }); };
  U.INPUTS['cr-task'] = e => { UI.corrDraft = Object.assign({}, UI.corrDraft, { task: e.target.value }); U.renderLayer(); };
  FM['corr-new'] = function (f, r) {
    const M = M0(); if (!M) return;
    const D = UI.corrDraft || {}, fd_ = new FormData(f);
    const fix = D.fix ? (M.changes || []).find(c => c.id === D.fix) : null;
    const taskId = fix ? fix.task : fd_.get('task');
    const t = M.byId.get(taskId);
    if (!t || !mineTask(t)) return err(f, 'Выберите свою работу.');
    const ps = fd_.get('ps'), pf = fd_.get('pf'), comment = String(fd_.get('comment') || '').trim(), reason = fd_.get('reason');
    if (!ps || !pf || dn(pf) < dn(ps)) return err(f, 'Окончание не может быть раньше начала.');
    if (dn(ps) === t.s0 && dn(pf) === t.f0) return err(f, 'Предложенные даты совпадают с текущими.');
    if (!comment) return err(f, 'Укажите обоснование.');
    const by = myOrg() || (DSF.auth.user().name || '');
    if (fix) DSF.store.update(r.pid, s => s.changeOps.push({ change: fix.id, op: 'resubmit', ps, pf, reason, comment, date: today(), by }));
    else DSF.store.update(r.pid, s => s.changes.push({ id: 'ch-u' + (s.seq++), task: t.id, ps0: iso(t.s0), pf0: iso(t.f0), ps, pf, reason, comment, org: myOrg(), by, date: today() }));
    closeModal(); H.go(link(r.pid, 'corrections')); toast('Запрос направлен техническому заказчику. График не меняется до утверждения директором.');
  };
  /* решения ТЗ и директора; действия подрядчика по своему запросу */
  const OP_PERM = { 'tz-approve': 'corr_tz', 'tz-reject': 'corr_tz', 'tz-return': 'corr_tz', 'dir-approve': 'corr_dir', 'dir-reject': 'corr_dir', 'dir-return': 'corr_dir', resubmit: 'corr_req', withdraw: 'corr_req' };
  A['corr-op'] = (el, d) => {
    if (!can(OP_PERM[d.op])) { toast('Недостаточно прав.'); return; }
    if (d.op === 'resubmit') { const M = M0(), c = M.changes.find(x => x.id === d.id); UI.corrDraft = { task: c.task, fix: c.id }; openModal(corrForm, { wide: true }); return; }
    UI.corrOp = { id: d.id, op: d.op };
    openModal(() => `<form data-form="corr-op" class="mform"><div class="mh"><div><div class="eyebrow">Корректировка графика</div><h3 style="margin-top:4px">${esc(DSF.CHANGE_OPS[d.op])}</h3></div>${xBtn}</div>
      <div class="mb"><div class="fld"><label for="co-cm">Комментарий${/return|reject/.test(d.op) ? '' : ' (необязательно)'}</label><textarea id="co-cm" name="comment" rows="3" ${/return|reject/.test(d.op) ? 'required' : ''}></textarea></div>
      ${d.op === 'dir-approve' ? '<p class="faint" style="font-size:12px">После утверждения новые сроки работы становятся плановыми. Сроки смежных работ пересчитываются в прогнозе по связям графика.</p>' : ''}<div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Подтвердить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`);
  };
  FM['corr-op'] = function (f, r) {
    const a = UI.corrOp, comment = String(new FormData(f).get('comment') || '').trim();
    if (!a || !can(OP_PERM[a.op])) { toast('Недостаточно прав.'); return; }
    if (/return|reject/.test(a.op) && !comment) return err(f, 'Укажите причину.');
    const by = role() === 'contractor' ? myOrg() : DSF.auth.name();
    DSF.store.update(r.pid, s => s.changeOps.push({ change: a.id, op: a.op, comment, date: today(), by }));
    closeModal(); keepPage();
    toast(a.op === 'dir-approve' ? 'Изменение утверждено — график объекта пересчитан.' : a.op === 'tz-approve' ? 'Запрос согласован и направлен директору.' : 'Решение сохранено.');
  };
  /* сводный реестр по всем объектам (директор / ТЗ) */
  U.VIEWS.queue = function () {
    const Ms = H.models();
    const all = Ms.flatMap(M => rowsOf(M));
    const f = UI.queueF || 'wait';
    const rows = all.filter(x => f === 'all' || (f === 'wait' ? waitsMe(x.c) : x.c.status === f)).sort((a, b) => String(b.c.date).localeCompare(String(a.c.date)));
    const tab = (k, t, n) => `<button class="seg-b" type="button" data-x="queue-f" data-f="${k}" ${f === k ? 'aria-pressed="true"' : ''}>${t}${n != null ? ' · ' + n : ''}</button>`;
    return { title: corrTitle(), html: `${head('Flow · все объекты', can('corr_dir') && !can('corr_tz') ? 'График на' : 'Корректировки', can('corr_dir') && !can('corr_tz') ? 'корректировку' : 'графика', 'Запросы подрядчиков на изменение сроков по всем объектам. Решение техзаказчика, теоретическое влияние на график и статус — в одной таблице.')}
      <section class="panel"><header style="flex-wrap:wrap; gap:10px"><h2>Запросы</h2><span class="grow"></span><div class="seg">${tab('wait', 'Ждут моего решения', all.filter(x => waitsMe(x.c)).length)}${tab('director', 'У директора', all.filter(x => x.c.status === 'director').length)}${tab('tz', 'У техзаказчика', all.filter(x => x.c.status === 'tz').length)}${tab('approved', 'Утверждено')}${tab('all', 'Все', all.length)}</div></header>
      <div class="pad">${corrTable(rows, true)}</div></section>` };
  };
  A['queue-f'] = (el, d) => { UI.queueF = d.f; keepPage(); };
  DSF.portfolioExtra = function (Ms) {
    if (!(can('corr_dir') || can('corr_tz'))) return '';
    const w = Ms.flatMap(M => rowsOf(M)).filter(x => waitsMe(x.c));
    if (!w.length) return '';
    return `<section class="panel"><header><h2>${esc(corrTitle())}</h2><span class="sub">ждут вашего решения: ${w.length}</span><span class="grow"></span><button class="lnk" type="button" data-go="queue">Все запросы ${ico('chev')}</button></header><div class="pad">${corrTable(w.slice(0, 5), true)}</div></section>`;
  };

  /* ===================================================== обзор: инвестор и подрядчик */
  const baseOverview = U.VIEWS.overview;
  U.VIEWS.overview = function (M, r) {
    if (role() === 'viewer') return investorOverview(M, r);
    if (role() === 'contractor') return contractorOverview(M, r);
    const v = baseOverview(M, r);
    if (DSF.realNote) v.html = DSF.realNote(M) + v.html;
    return v;
  };
  function investorOverview(M) {
    const P = M.P, R = M.root, f = M.fin, sched = M.status.schedule, t = T();
    const keyMs = M.tasks.filter(x => x.ms && x.key);
    const html = `${H.stamp(M, `<div><dt>Заказчик</dt><dd style="font-size:13.5px">${esc(P.customer) || '—'}</dd></div><div><dt>Отчётная дата</dt><dd>${fd(t)}</dd></div>`)}
      <section class="inv-grid" aria-label="Ключевые показатели">
        <details class="inv"><summary>
          <div class="kpi-top"><span class="t">Готовность</span></div>
          <div class="kpi-mid"><div><div class="big">${R.pc != null ? num(R.pc, 1) + '<small>%</small>' : '—'}</div><div class="s" style="margin-top:6px">${R.planNow != null ? 'план на ' + fds(t) + ' — ' + pct(R.planNow) : 'план на дату не задан'}</div></div>${H.ring(84, 9, [{ v: R.pc || 0, color: 'var(--good)', tick: R.planNow, r: 34 }])}</div>
          <div class="kpi-foot">${R.dev == null ? '<span>—</span>' : chip(Math.abs(R.dev) < 0.05 ? 'по плану' : (R.dev > 0 ? '+' : '−') + num(Math.abs(R.dev), 1) + ' п.п. к плану', R.dev >= -1 ? 'good' : R.dev > -5 ? 'warn' : 'crit')}<span class="more"><span class="o">Подробнее ▾</span><span class="c">Свернуть ▴</span></span></div>
        </summary><div class="inv-body">
          <div class="eyebrow" style="margin-bottom:8px">По этапам</div>
          <div class="list">${M.stages.map(s => `<div class="li"><span class="t">${esc(s.name)}</span><span class="num"><b>${Math.round(s.pct)}%</b> · план ${Math.round(s.planNow)}%</span><span class="m"><span class="bar" style="display:block"><i style="width:${s.pct}%; --c:${s.done ? 'var(--good)' : s.slip > 14 ? 'var(--crit)' : s.slip > 3 ? 'var(--warn)' : 'var(--accent)'}"></i><b style="left:${s.planNow}%"></b></span></span></div>`).join('') || '<div class="empty">Нет данных</div>'}</div>
        </div></details>
        <details class="inv"><summary>
          <div class="kpi-top"><span class="t">Срок</span></div>
          <div><div class="big ${sched}">${R.actualEnd != null ? 'сдан' : R.delay == null ? '—' : R.delay > 0 ? '+' + R.delay + '<small>дн.</small>' : 'в срок'}</div>
            <div class="kv2" style="margin-top:8px"><span>Плановый ввод:</span><b>${fd(R.planEnd)}</b><span>Прогноз:</span><b style="color:${R.delay > 0 ? stVar(sched) : 'var(--ink)'}">${fd(R.forecastEnd)}</b></div></div>
          <div class="kpi-foot">${chip(R.delay == null ? 'нет данных' : R.delay > 0 ? 'отставание' : 'в графике', R.delay == null ? 'neutral' : sched)}<span class="more"><span class="o">Подробнее ▾</span><span class="c">Свернуть ▴</span></span></div>
        </summary><div class="inv-body">
          <div class="eyebrow" style="margin-bottom:8px">Ключевые вехи — информационно</div>
          <div class="list">${keyMs.map(x => `<div class="li"><span class="t">${esc(x.name)}</span><span class="num">${x.af != null ? 'достигнута ' + fd(x.af) : 'прогноз ' + fd(x.ef)}</span><span class="m">план ${fd(x.f0)}${x.af == null && x.ef > x.f0 ? ' · ' + chip('+' + (x.ef - x.f0) + ' дн.', x.ef - x.f0 > 14 ? 'crit' : 'warn') : ''}</span></div>`).join('') || '<div class="empty">Нет данных</div>'}</div>
        </div></details>
        <button class="kpi" type="button" data-x="inv-budget" style="text-align:left">
          <div class="kpi-top"><span class="t">Бюджет</span><span class="go">${ico('arrow')}</span></div>
          ${f.configured ? `<div><div class="big bigm" style="font-size:clamp(24px,2.1vw,32px); white-space:normal">${bn(f.done)} <span class="faint">/</span> ${bn(f.approved)}<small> млрд ₽</small></div><div class="s" style="margin-top:8px">выполнено из утверждённого</div></div>
          <div class="kpi-foot">${chip(f.eac > f.approved ? 'прогноз выше бюджета на ' + money(f.eacDelta) : 'прогноз в бюджете', f.state)}</div>` : `<div><div class="big">—</div><div class="s" style="margin-top:8px">бюджет объекта не задан</div></div><div class="kpi-foot"><span>нет данных</span></div>`}
        </button>
      </section>
      <section class="panel"><header><h2>График реализации проекта</h2><span class="sub">этапы: факт и прогноз против плана · информационно</span></header><div class="pad">${H.miniGantt(M).replace(/data-go="[^"]*"/g, '')}</div></section>
      <section class="panel"><header><h2>Фотохроника</h2><span class="sub">последние снимки с объекта</span></header>
        <div class="pad">${M.photos.length ? `<div class="photostrip">${M.photos.slice(0, 6).map(p => H.photoCard(M, p)).join('')}</div>` : '<div class="empty">Фотографий пока нет.</div>'}</div></section>`;
    return { html };
  }
  A['inv-budget'] = () => openModal(M => {
    const f = M.fin;
    return `<div class="mh"><div><div class="eyebrow">${esc(M.P.name)}</div><h3 style="margin-top:4px">Бюджет проекта</h3></div>${xBtn}</div>
      <div class="mb">${f.configured ? `<div class="imp-grid">${tile('Утверждённый бюджет', bn(f.approved) + ' <small>млрд ₽</small>', 'включая резерв')}${tile('Законтрактовано', bn(f.contracted) + ' <small>млрд ₽</small>', pct(f.contracted / f.approved * 100))}${tile('Выполнено', bn(f.done) + ' <small>млрд ₽</small>', pct(f.finPct))}${tile('Оплачено', bn(f.paid) + ' <small>млрд ₽</small>', '')}${tile('Прогноз стоимости', bn(f.eac) + ' <small>млрд ₽</small>', f.eac > f.approved ? 'выше на ' + money(f.eacDelta) : 'в пределах бюджета', f.state)}</div>
        <div class="tbl-wrap" style="margin-top:14px"><table class="t"><thead><tr><th class="l">Статья</th><th>Бюджет</th><th>Законтрактовано</th><th>Выполнено</th><th>Прогноз</th></tr></thead><tbody>${M.items.map(i => `<tr><td class="l"><b>${esc(i.name)}</b></td><td>${num(i.budget)}</td><td>${num(i.contracted)}</td><td>${num(i.done)}</td><td>${num(i.forecast)}</td></tr>`).join('')}</tbody></table><div class="faint" style="font-size:12px; margin-top:6px">млн ₽. Промежуточные КС-2 и внутренние согласования не показываются.</div></div>`
        : '<div class="empty">Бюджет объекта не задан — нет данных.</div>'}</div>`;
  }, { wide: true });

  function contractorOverview(M) {
    const P = M.P, org = myOrg(), t = T();
    const own = M.tasks.filter(x => !x.ms && mineTask(x));
    const cs = M.contracts;
    const reps = (M.dayReports || []).filter(x => x.org === org).slice(0, 6);
    const rems = (M.remarks || []).filter(x => x.open);
    const chs = (M.changes || []).filter(c => c.org === org);
    const kss = M.ks.filter(k => cs.includes(k.contract)).sort((a, b) => b.d - a.d);
    const html = `${H.stamp(M, `<div><dt>Организация</dt><dd style="font-size:13.5px">${esc(org || '—')}</dd></div><div><dt>Отчётная дата</dt><dd>${fd(t)}</dd></div>`)}
      <section class="panel"><header><h2>Кабинет подрядчика</h2><span class="sub">${esc(org || '')}</span></header><div class="pad">
        <div class="fchips">
          ${can('fact') && own.some(x => !x.done) ? `<button class="btn primary" type="button" data-x="rep-new">${ico('plus')}Внести ежедневный прогресс</button>` : ''}
          ${cs.length ? `<button class="btn" type="button" data-go="${link(P.id, 'budget', cs.length === 1 ? cs[0].id : null)}">${ico('coins')}Мой договор и КС-2</button>` : ''}
          ${can('corr_req') && own.some(x => !x.done) ? `<button class="btn" type="button" data-x="corr-new">${ico('swap')}Запросить корректировку графика</button>` : ''}
          <button class="btn" type="button" data-go="${link(P.id, 'schedule')}">${ico('gantt')}Общий график</button>
        </div>
        <p class="faint" style="font-size:12.5px; margin-top:10px">Вы видите только свои работы, договор и КС-2. Общий график объекта доступен информационно. Данные других подрядчиков скрыты.</p>
      </div></section>
      <section class="panel my-works"><header><h2>Мои работы</h2><span class="sub">${own.length} ${plural(own.length, 'работа', 'работы', 'работ')}</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'schedule')}">На графике ${ico('chev')}</button></header>
        <div class="pad">${own.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th>Выполнено</th><th>План на дату</th><th class="l">Срок по плану</th><th class="l">Прогноз</th><th class="l">Статус</th><th></th></tr></thead><tbody>${own.map(x => `<tr class="link" data-go="${link(P.id, 'schedule')}" data-task="${x.id}"><td class="l w"><b>${esc(x.name)}</b><div class="faint" style="font-size:12px">${esc(x.stage)}${x.qty ? ' · ' + num(x.qtyFact || 0, 1) + ' из ' + num(x.qty, 1) + ' ' + esc(x.unit || '') : ''}</div></td><td><b>${Math.round(x.pct)}%</b></td><td>${pct(x.planNow, 0)}</td><td class="l cr-dates">${fd(x.s0)} – ${fd(x.f0)}</td><td class="l cr-dates">${fd(x.af != null ? x.af : x.ef)}</td><td class="l">${chip(x.st.t, x.st.c)}${x.corrected ? ' ' + chip('скорректировано', 'accent') : ''}</td><td>${can('corr_req') && !x.done ? `<button class="btn sm" type="button" data-x="corr-new" data-id="${x.id}" title="Запросить корректировку">${ico('swap')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">На объекте за вашей организацией нет работ.</div>'}</div></section>
      <div class="grid2">
        <section class="panel"><header><h2>Мой договор</h2></header><div class="pad">${cs.length ? cs.map(c => `<button class="att-i" type="button" data-go="${link(P.id, 'budget', c.id)}"><span class="sev" style="background:var(--accent)"></span><span class="tx"><b>${esc(c.no)}</b> · ${esc(c.subject)}<div class="m">сумма ${money(c.amount)} · выполнено ${money(c.done)} · КС-2 согласовано ${money(c.agreed)} · остаток ${money(c.left)}</div></span>${ico('chev')}</button>`).join('') : '<div class="empty">Договор не назначен.</div>'}</div></section>
        <section class="panel"><header><h2>Мои КС-2</h2><span class="grow"></span>${cs.length ? `<button class="lnk" type="button" data-go="${link(P.id, 'budget', cs.length === 1 ? cs[0].id : null)}">Подать / открыть ${ico('chev')}</button>` : ''}</header><div class="pad">${kss.length ? `<div class="list">${kss.slice(0, 6).map(k => `<button class="li" type="button" data-go="${link(P.id, 'budget', k.id)}" style="text-align:left; background:none; border:0; cursor:pointer; font:inherit; color:inherit"><span class="t">${esc(k.no)} · ${esc(k.contract.no)}</span><span class="num">${money(k.claimed)}</span><span class="m">${chip((DSF.KS_STATUS[k.status] || {}).t || k.status, (DSF.KS_STATUS[k.status] || {}).c)} · этап ${(DSF.KS_STATUS[k.status] || {}).stage === 2 ? '2 — оформление КС' : '1 — приёмка работ'}</span></button>`).join('')}</div>` : '<div class="empty">КС-2 ещё не подавались.</div>'}</div></section>
      </div>
      <div class="grid2">
        <section class="panel"><header><h2>Мои ежедневные отчёты</h2><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'production')}">Все ${ico('chev')}</button></header><div class="pad">${reps.length ? `<div class="list">${reps.map(x => `<button class="li" type="button" data-go="${link(P.id, 'production', x.id)}" style="text-align:left; background:none; border:0; cursor:pointer; font:inherit; color:inherit"><span class="t">${fd(x.d)}</span><span class="num">${x.crew != null ? num(x.crew) + ' чел.' : ''}</span><span class="m">${x.status === 'confirmed' ? chip('Подтверждён', 'good') : x.status === 'returned' ? chip('Возвращён', 'crit') : chip('На подтверждении', 'warn')}</span></button>`).join('')}</div>` : '<div class="empty">Отчётов пока нет.</div>'}</div></section>
        <section class="panel"><header><h2>Замечания и корректировки</h2></header><div class="pad">
          <div class="list">${rems.slice(0, 4).map(x => `<button class="li" type="button" data-go="${link(P.id, 'quality', x.id)}" style="text-align:left; background:none; border:0; cursor:pointer; font:inherit; color:inherit"><span class="t">№ ${esc(x.no)} · ${esc(x.title)}</span><span class="num">до ${fd(x.due)}</span><span class="m">${chip((DSF.REMARK_STATUS[x.status] || {}).t || x.status, x.overdue ? 'crit' : 'warn')}</span></button>`).join('')}
          ${chs.slice(0, 4).map(c => { const tk = M.byId.get(c.task); return `<button class="li" type="button" data-go="${link(P.id, 'corrections', c.id)}" style="text-align:left; background:none; border:0; cursor:pointer; font:inherit; color:inherit"><span class="t">Корректировка: ${esc(tk ? tk.name : c.task)}</span><span class="num">${fd(dn(c.pf))}</span><span class="m">${chip(ST(c.status).t, ST(c.status).c)}</span></button>`; }).join('')}</div>
          ${!rems.length && !chs.length ? '<div class="empty">Открытых замечаний и запросов нет.</div>' : ''}
        </div></section>
      </div>`;
    return { html };
  }

  /* бюджет подрядчика: сразу карточка своего договора */
  const baseBudget = U.VIEWS.budget;
  U.VIEWS.budget = function (M, r) {
    if (role() === 'contractor' && !r.sub && M.contracts.length === 1) return baseBudget(M, Object.assign({}, r, { sub: M.contracts[0].id }));
    if (DSF.legacyBudget && M.P.source === 'legacy') return DSF.legacyBudget(M, r);
    return baseBudget(M, r);
  };

  /* ===================================================== подрядчики и договоры объекта */
  U.VIEWS.contractors = function (M) {
    const P = M.P;
    const orgs = [...new Set(M.contracts.map(c => c.contractor))];
    const base = UI.baseCache || [];
    const rows = orgs.map(o => {
      const cs = M.contracts.filter(c => c.contractor === o);
      const tasks = M.tasks.filter(t => !t.ms && cs.some(c => c.id === t.contract));
      const reps = (M.dayReports || []).filter(x => x.org === o);
      const rems = (M.remarks || []).filter(x => x.open && x.org === o);
      const ch = (M.changes || []).filter(c => c.org === o && (c.status === 'tz' || c.status === 'director'));
      const b = base.find(x => x.name === o);
      return { o, cs, tasks, reps, rems, ch, b };
    });
    const parts = (M.participants || []).filter(x => x.role !== 'contractor');
    return { html: `${head(esc(P.name) + ' · участники', 'Подрядчики', 'и договоры', 'Исполнители объекта и их договоры. Подрядчики объекта формируются из общей базы подрядчиков Flow; назначает их администратор.', DSF.mode === 'demo' && DSF.auth.has('base.view') ? `<button class="btn" type="button" data-go="base">${ico('users')}База подрядчиков</button>` : '')}
      ${parts.length ? `<section class="panel"><header><h2>Участники</h2></header><div class="pad"><div class="list">${parts.map(x => `<div class="li"><span class="t">${esc(x.name)}</span><span class="m">${esc(DSF.PARTY_ROLES[x.role] || x.role)}</span></div>`).join('')}</div></div></section>` : ''}
      <section class="panel"><header><h2>Подрядчики</h2><span class="sub">${rows.length}</span></header><div class="pad">${rows.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Подрядчик</th><th class="l">Договоры</th><th>Сумма</th><th>Выполнено</th><th>КС-2 согл.</th><th>Работ</th><th>Отчётов</th><th>Замечаний</th><th class="l">Корректировки</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td class="l w" style="min-width:170px"><b>${esc(x.o)}</b>${x.b ? `<div class="faint" style="font-size:12px">${esc(x.b.login)}${x.b.inn ? ' · ИНН ' + esc(x.b.inn) : ''}</div>` : ''}</td><td class="l w" style="min-width:200px">${x.cs.map(c => `<button class="lnk" type="button" data-go="${link(P.id, 'budget', c.id)}">${esc(c.no)}</button> <span class="faint">${esc(c.subject)}</span>`).join('<br>')}</td><td>${money(sum(x.cs, c => c.amount))}</td><td>${money(sum(x.cs, c => c.done))}</td><td>${money(sum(x.cs, c => c.agreed))}</td><td>${x.tasks.length}</td><td>${x.reps.length}</td><td>${x.rems.length ? chip(x.rems.length, 'warn') : '0'}</td><td class="l">${x.ch.length ? chip(x.ch.length + ' на согласовании', 'warn') : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Договоры с подрядчиками не внесены — нет данных.</div>'}</div></section>` };
  };
  U.VIEWS.iddocs = function (M, r) {
    const v = U.VIEWS.docs(M, Object.assign({}, r, { sub: r.sub || 'id' }));
    return v;
  };

  /* база подрядчиков — модуль ui-base.js */
  DSF.afterBoot = function () {
    if (DSF.mode === 'demo' && DSF.auth.has('base.view') && DSF.loadBase) DSF.loadBase();
    // подрядчик с одним объектом сразу попадает в кабинет объекта
    if (role() === 'contractor' && DSF.projects.length === 1 && !location.hash) H.go(DSF.projects[0].id);
  };

  DSF.uiRoles = { waitsMe, impactOf, corrTitle };
})();
