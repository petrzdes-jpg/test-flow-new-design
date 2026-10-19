/*
 * FLOW — Цифровой штаб строительства. Экраны производственного и контрольного контура:
 *
 *  Производство (#<id>.production)  — ежедневный факт подрядчика, цепочка подтверждения
 *                                       (порядок ступеней задаёт администратор), темп и прогноз по темпу;
 *  Качество (#<id>.quality)          — замечания строительного контроля: выдача → назначение →
 *                                       устранение → проверка, аналитика по подрядчикам;
 *  Хронология (#<id>.timeline)       — история проекта из всех разделов;
 *  Штаб (обзор объекта)              — сигналы с причиной, ответственным и решением руководителя;
 *  Карточка работы «почему»          — открывается из любого раздела (data-x="work");
 *  КС-2                               — основание из подтверждённого факта, проверка ИД, гарантийное письмо.
 *
 * Экраны одинаковы для всех объектов и строятся только из модели DSF.build().
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, fd, fds, num, money, plural, chip, ico, link, route, byId, T, openModal, closeModal, toast, keepPage, stVar, days } = H;
  const { dn, iso, sum } = DSF.util;
  const F = DSF.fmt;
  const store = DSF.store;
  const can = p => DSF.can(p);
  const today = () => iso(T());
  const M0 = () => { const r = route(); return r.pid ? DSF.build(byId(r.pid)) : null; };
  const roleName = () => DSF.auth.name();
  const kv = rows => `<dl class="kv kvw">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const empty = t => `<div class="empty">${t}</div>`;
  const tile = (l, v, s, c) => `<div class="tile ${c || ''}"><div class="eyebrow">${l}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const head = (eyebrow, title, accent, sub, right) => `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
    <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${eyebrow}</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">${title} <span class="ac">${accent}</span></h1>${sub ? `<div class="muted" style="margin-top:6px; font-size:13px">${sub}</div>` : ''}</div>
    ${right ? `<div class="hd-r">${right}</div>` : ''}</section>`;
  const backBtn = (to, t) => `<button class="btn sm" type="button" data-go="${to}">${ico('back')}${esc(t)}</button>`;
  const seg = (items, cur, label) => `<div class="seg" role="tablist" aria-label="${esc(label)}">${items.map(([go, t, k]) => `<button type="button" role="tab" data-go="${go}" aria-pressed="${cur === k}">${t}</button>`).join('')}</div>`;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const numIn = s => { const v = Number(String(s == null ? '' : s).trim().replace(',', '.')); return String(s == null ? '' : s).trim() === '' ? null : v; };

  /* ---------- единицы и форматы факта ---------- */
  const unitOf = t => t && t.qty ? (t.unit || 'ед.') : '%';
  const vNum = (t, v) => num(v, t && t.qty && Number.isInteger(+v) ? 0 : 1);
  const vText = (t, v) => '+' + vNum(t, v) + ' ' + unitOf(t);
  const stepName = s => DSF.FACT_STEPS[s] || s;
  const repStatus = r => r.status === 'canceled' ? chip('Отменён', 'neutral') : r.status === 'returned' ? chip('Возвращён подрядчику', 'warn') : r.status === 'pending' ? chip('Ждёт: ' + stepName(r.next), 'accent') : chip('Подтверждён' + (r.corrected ? ' · исправлен' : ''), 'good');
  const chainDots = r => `<span class="fchain">${['Подрядчик'].concat(r.chain.map(stepName)).map((s, i) => {
    const done = i === 0 ? true : r.ok.has(r.chain[i - 1]);
    const cur = i > 0 && r.status === 'pending' && r.chain[i - 1] === r.next;
    const ret = r.status === 'returned' && i === 0;
    return `<span class="ch ${done ? 'on' : ''} ${cur ? 'cur' : ''} ${ret ? 'ret' : ''}">${esc(s)}</span>`;
  }).join('<span class="ch-a">→</span>')}</span>`;
  const canConfirm = r => r.status === 'pending' && DSF.auth.canStep(r.next);

  /* ====================================================================
   * ПРОИЗВОДСТВО
   * ==================================================================== */
  const eligible = (M, org) => M.tasks.filter(t => !t.ms && t.weighted && !t.done && (!org || t.contractor === org) && (t.as != null || t.es <= M.T + 14));
  const factOrgs = M => [...new Set(eligible(M).map(t => t.contractor).filter(Boolean))].filter(o => DSF.auth.role !== 'contractor' || o === DSF.auth.org());

  U.VIEWS.production = function (M, r) {
    const P = M.P, J = M.dayReports || [], t = M.T;
    if (r.sub && J.some(x => x.id === r.sub)) return reportCard(M, J.find(x => x.id === r.sub));
    const tab = r.sub === 'pace' ? 'pace' : 'journal';
    const chain = (M.journal && M.journal.chain) || DSF.chainOf(P);
    const orgs = factOrgs(M);
    const todayRep = J.filter(x => x.d === t && x.status !== 'returned');
    const pend = J.filter(x => x.status === 'pending');
    const mine = pend.filter(canConfirm);
    const ret = J.filter(x => x.status === 'returned');
    const conf14 = J.filter(x => x.status === 'confirmed' && x.d > t - 14);
    const right = `${can('fact') ? `<button class="btn primary" type="button" data-x="rep-new">${ico('plus')}Подать отчёт</button>` : ''}${can('settings') ? `<button class="btn" type="button" data-go="${link(P.id, 'settings', 'control')}">${ico('gear')}Цепочка подтверждения</button>` : ''}`;
    let body;
    if (tab === 'pace') body = paceTable(M);
    else {
      const f = UI.repFilter || 'all';
      const fl = { all: x => true, mine: canConfirm, pending: x => x.status === 'pending', returned: x => x.status === 'returned', confirmed: x => x.status === 'confirmed' };
      const list = J.filter(fl[f] || fl.all);
      const byDay = new Map(); list.forEach(x => { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x); });
      const chips = [['all', 'Все', J.length], ['mine', 'Ждут моего подтверждения', mine.length], ['pending', 'На подтверждении', pend.length], ['returned', 'Возвращены', ret.length], ['confirmed', 'Подтверждены', J.length - pend.length - ret.length]];
      body = `<section class="panel"><header style="flex-wrap:wrap"><h2>Журнал ежедневных отчётов</h2><span class="sub">${J.length} ${plural(J.length, 'отчёт', 'отчёта', 'отчётов')}</span><span class="grow"></span>
          ${mine.length ? `<button class="btn sm primary" type="button" data-x="rep-confirm-mine">${ico('check')}Подтвердить ожидающие меня (${mine.length})</button>` : ''}</header>
        <div class="pad"><div class="fchips" style="margin-bottom:12px" role="group" aria-label="Фильтр">${chips.map(([k, tt, n]) => `<button class="fchip" type="button" data-x="rep-filter" data-f="${k}" aria-pressed="${f === k}">${tt} <b>${n}</b></button>`).join('')}</div>
        ${byDay.size ? [...byDay.entries()].slice(0, UI.repDays || 7).map(([d, rs]) => `<div class="repday"><div class="eyebrow">${fd(d)}${d === t ? ' · сегодня' : ''} · ${rs.length} ${plural(rs.length, 'отчёт', 'отчёта', 'отчётов')}</div>
          ${rs.map(x => `<button class="rep-i" type="button" data-go="${link(P.id, 'production', x.id)}">
            <span class="sev" style="background:${stVar(x.status === 'returned' ? 'warn' : x.status === 'pending' ? 'accent' : 'good')}"></span>
            <span class="tx"><b>${esc(x.org)}</b><span class="m">${x.lines.filter(l => l.v).map(l => esc(l.t ? l.t.name : l.task) + ': ' + (l.t ? vText(l.t, l.v) : num(l.v, 1))).join(' · ') || 'без объёмов'}${x.crew != null ? ' · ' + num(x.crew) + ' чел.' : ''}</span></span>
            <span class="rt">${repStatus(x)}${x.wait >= 2 ? `<span class="m" style="color:var(--warn-ink)">ждёт ${days(x.wait)}</span>` : ''}</span></button>`).join('')}</div>`).join('') : empty('Отчётов по выбранному фильтру нет.')}
        ${byDay.size > (UI.repDays || 7) ? `<div class="mf" style="padding:6px 0 0"><button class="btn" type="button" data-x="rep-more">Показать ранее (ещё ${byDay.size - (UI.repDays || 7)} ${plural(byDay.size - (UI.repDays || 7), 'день', 'дня', 'дней')})</button></div>` : ''}
        </div></section>`;
    }
    const html = `${head(esc(P.name) + ' · производство', 'Ежедневный', 'факт', 'Подрядчик вносит выполненные объёмы за день → ' + chain.map(stepName).join(' → ') + ' подтверждают. В график, готовность, прогноз и основание КС-2 попадает только полностью подтверждённый факт.', right)}
      <section class="tiles">
        ${tile('Отчёты за ' + fds(t), todayRep.length + ' <small>из ' + orgs.length + '</small>', orgs.length ? 'подрядчиков с работами в производстве' : 'нет работ в производстве', orgs.length && todayRep.length < orgs.length ? 'warn' : '')}
        ${chain.map(s => { const n = pend.filter(x => x.next === s).length, old = pend.filter(x => x.next === s && x.wait >= 2).length; return tile('Ждут: ' + esc(stepName(s)), String(n), old ? old + ' ждут дольше 2 дней' : 'на этой ступени', old ? 'warn' : ''); }).join('')}
        ${tile('Возвращены', String(ret.length), 'на исправлении у подрядчика', ret.length ? 'warn' : '')}
        ${tile('Подтверждено за 14 дней', String(conf14.length), 'отчётов вошли в график и КС-2', 'good')}
      </section>
      ${seg([[link(P.id, 'production'), 'Журнал отчётов', 'journal'], [link(P.id, 'production', 'pace'), 'Темп и прогноз по работам', 'pace']], tab, 'Производство')}
      ${body}`;
    return { html, crumb: tab === 'pace' ? 'Темп и прогноз' : null };
  };

  function paceTable(M) {
    const P = M.P, list = M.tasks.filter(t => !t.ms && t.weighted && !t.done && (t.pace || t.pend || (t.as != null)));
    if (!list.length) return `<section class="panel"><div class="pad">${empty('Работ в производстве нет.')}</div></section>`;
    list.sort((a, b) => ((a.pace && a.pace.ratio != null ? a.pace.ratio : 9) - (b.pace && b.pace.ratio != null ? b.pace.ratio : 9)));
    return `<section class="panel"><header><h2>Темп по подтверждённому факту</h2><span class="sub">окно 14 дней · прогноз по темпу считается при 6+ днях с отчётами и готовности от 10%</span></header>
      <div class="pad tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th class="l">Подрядчик</th><th>Готовность</th><th>Темп, в день</th><th>Требуется</th><th>Темп к требуемому</th><th>План окончания</th><th>Прогноз по темпу</th><th>Не подтверждено</th></tr></thead>
      <tbody>${list.map(t => {
        const p = t.pace, ratio = p && p.ratio != null ? p.ratio : null;
        const rate = p ? (t.qty ? num(p.unitRate, p.unitRate < 10 ? 1 : 0) + ' ' + esc(t.unit || '') : num(p.rate, 2) + ' %') : '—';
        const need = p && p.need != null ? (t.qty ? num(p.need * t.qty / 100, p.need * t.qty / 100 < 10 ? 1 : 0) + ' ' + esc(t.unit || '') : num(p.need, 2) + ' %') : '—';
        return `<tr class="link" data-x="work" data-id="${t.id}"><td class="l w"><b>${esc(t.name)}</b>${t.crit ? ' ' + chip('КП', 'crit') : ''}</td><td class="l">${esc(t.contractor || '—')}</td>
          <td>${num(t.pct, 1)}%${t.qty ? `<div class="faint" style="font-size:11.5px">${vNum(t, t.qtyFact || 0)} / ${vNum(t, t.qty)} ${esc(t.unit || '')}</div>` : ''}</td>
          <td>${rate}</td><td>${need}</td><td>${ratio != null ? chip(Math.round(ratio * 100) + '%', ratio >= 0.95 ? 'good' : ratio >= 0.8 ? 'warn' : 'crit') : p && p.need == null ? '<span class="faint">план. срок прошёл</span>' : '—'}</td>
          <td>${fd(t.f0)}</td><td style="color:${t.efPace && t.efPace > t.f0 ? 'var(--crit)' : 'inherit'}">${t.efPace ? fd(t.efPace) : '<span class="faint">мало данных</span>'}</td>
          <td>${t.pend ? vText(t, t.pend.v) + `<div class="faint" style="font-size:11.5px">ждёт: ${esc(stepName(t.pend.step))}</div>` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="pad" style="padding-top:0"><div class="note">Прогноз окончания работы в графике не раньше прогноза по темпу: если подрядчик работает медленнее требуемого, график сдвигается автоматически и сдвиг виден в штабе. Неподтверждённые объёмы в расчёт не входят.</div></div></section>`;
  }

  function reportCard(M, x) {
    const P = M.P;
    const acts = [];
    if (canConfirm(x)) acts.push(`<button class="btn primary" type="button" data-x="rep-confirm" data-id="${esc(x.id)}">${ico('check')}<span class="role">${esc(stepName(x.next))}:</span> Подтвердить</button>`, `<button class="btn" type="button" data-x="rep-return" data-id="${esc(x.id)}">${ico('back')}Вернуть подрядчику</button>`);
    if (x.status === 'returned' && can('fact')) acts.push(`<button class="btn primary" type="button" data-x="rep-fix" data-id="${esc(x.id)}">${ico('edit')}<span class="role">Подрядчик:</span> Исправить и направить повторно</button>`);
    if (x.status !== 'canceled' && can('factfix') && DSF.mode === 'demo') acts.push(`<button class="btn" type="button" data-x="rep-correct" data-id="${esc(x.id)}">${ico('edit')}Корректировать факт</button>`, `<button class="btn" type="button" data-x="rep-cancel" data-id="${esc(x.id)}">${ico('x')}Аннулировать как ошибочный</button>`);
    const ph = (x.photos || []).map(f => `<img class="thumb" src="${H.photoUrl(f)}" alt="Фото к отчёту">`).join('');
    const html = `<div class="topback">${backBtn(link(P.id, 'production'), 'Ежедневный факт')}</div>
      <section class="panel"><header style="flex-wrap:wrap"><div style="min-width:0; flex:1 1 320px"><div class="eyebrow">Ежедневный отчёт подрядчика${x.user ? ' · внесён в системе' : ''}</div><h2 style="margin-top:6px">${esc(x.org)} — ${fd(x.d)}</h2></div><div class="fchips">${repStatus(x)}</div></header>
        <div class="pad">
          <div style="margin-bottom:14px">${chainDots(x)}</div>
          ${x.status === 'returned' ? `<div class="note warn" style="margin-bottom:12px">Возвращён: ${esc(x.retNote || 'без комментария')}. Объёмы отчёта не учитываются, пока подрядчик не исправит и не направит его повторно.</div>` : x.status === 'pending' ? `<div class="note" style="margin-bottom:12px">Объёмы ещё не в графике: отчёт должен пройти ${x.chain.length - x.done} ${plural(x.chain.length - x.done, 'ступень', 'ступени', 'ступеней')} подтверждения. Следующая — ${esc(stepName(x.next))}.</div>` : ''}
          <div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th>Объём за день</th><th>Готовность работы</th><th>Темп к требуемому</th></tr></thead>
          <tbody>${x.lines.map(l => { const t = l.t; return `<tr class="link" data-x="work" data-id="${esc(l.task)}"><td class="l w">${esc(t ? t.name : l.task)}</td><td><b>${t ? vText(t, l.v) : num(l.v, 1)}</b>${l.orig != null ? `<div class="faint" style="font-size:11.5px">подано ${t ? vText(t, l.orig) : num(l.orig, 1)}, скорректировано при подтверждении</div>` : ''}</td><td>${t ? num(t.pct, 1) + '%' : '—'}</td><td>${t && t.pace && t.pace.ratio != null ? chip(Math.round(t.pace.ratio * 100) + '%', t.pace.ratio >= 0.95 ? 'good' : t.pace.ratio >= 0.8 ? 'warn' : 'crit') : '—'}</td></tr>`; }).join('')}</tbody></table></div>
          ${kv([x.crew != null ? ['Рабочие на площадке', num(x.crew) + ' чел.'] : null, x.itr != null ? ['ИТР', num(x.itr) + ' чел.'] : null, x.note ? ['Комментарий подрядчика', esc(x.note)] : null, ['Подан', fd(x.sub)]])}
          ${ph ? `<div class="thumbs" style="margin-top:10px">${ph}</div>` : ''}
          ${acts.length ? `<div class="mf" style="padding:14px 0 0">${acts.join('')}</div>` : x.status === 'pending' ? `<div class="faint" style="font-size:12.5px; margin-top:12px">Подтвердить может: ${esc(stepName(x.next))} (или администратор). Текущая роль — ${esc(roleName())}.</div>` : ''}
        </div></section>
      <section class="panel"><header><h2>История</h2></header><div class="pad"><div class="feed">${x.hist.slice().reverse().map(h => H.feedRow(h.d, stVar(h.st === 'ret' ? 'warn' : h.st === 'sub' ? 'accent' : 'good'), esc(h.text), h.by || '')).join('')}</div></div></section>`;
    return { html, crumb: fd(x.d) + ' · ' + x.org };
  }

  /* --- корректировка внесённого факта уполномоченным пользователем: история сохраняется --- */
  A['rep-correct'] = (el, d) => { UI.repCor = d.id; openModal(M => { const x = (M.dayReports || []).find(r => r.id === UI.repCor); return `<form data-form="rep-correct" class="mform"><div class="mh"><div><div class="eyebrow">${esc(x.org)} · ${fd(x.d)}</div><h3 style="margin-top:4px">Корректировка внесённого факта</h3></div>${xBtn}</div>
      <div class="mb"><div class="note">Исходные значения сохраняются в истории отчёта. Прогноз и готовность пересчитываются.</div>
        ${x.lines.map((l, i) => `<div class="row-f"><div class="fld"><label>${esc(l.t ? l.t.name : l.task)}</label><input value="подано ${esc(l.orig != null ? l.orig : l.v)}" disabled></div><div class="fld"><label>Исправленный объём${l.t && l.t.unit ? ', ' + esc(l.t.unit) : ''}</label><input name="v_${i}" data-task="${esc(l.task)}" type="number" step="any" min="0" value="${l.v}"></div></div>`).join('')}
        <div class="fld"><label>Дата отчёта</label><input name="newDate" type="date" value="${iso(x.d)}" max="${today()}"></div>
        <div class="fld"><label>Основание корректировки *</label><input name="comment" required minlength="3"></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить корректировку</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`; }); };
  U.PERM_F['rep-correct'] = 'factfix'; U.PERM_X['rep-correct'] = 'factfix'; U.PERM_X['rep-cancel'] = 'factfix';
  FM['rep-correct'] = function (f, r) {
    const M = M0(), x = (M.dayReports || []).find(z => z.id === UI.repCor), comment = f.elements.comment.value.trim();
    if (comment.length < 3) return err(f, 'Укажите основание корректировки.');
    const lines = [...f.querySelectorAll('input[name^="v_"]')].map(i => [i.dataset.task, Math.max(0, +i.value || 0)]);
    const op = { rep: x.id, op: 'correct', lines, comment, by: DSF.auth.user().login || roleName(), date: today() };
    if (f.elements.newDate.value && f.elements.newDate.value !== iso(x.d)) op.newDate = f.elements.newDate.value;
    store.update(r.pid, s => s.reportOps.push(op));
    closeModal(); keepPage(); toast('Факт скорректирован. Прежние значения — в истории отчёта.');
  };
  A['rep-cancel'] = (el, d) => { UI.repCor = d.id; openModal(() => `<form data-form="rep-cancel" class="mform"><div class="mh"><div><div class="eyebrow">Ежедневный факт</div><h3 style="margin-top:4px">Аннулировать отчёт как ошибочный</h3></div>${xBtn}</div>
      <div class="mb"><div class="note warn">Отчёт не удаляется: он помечается аннулированным, его объёмы исключаются из расчёта, запись остаётся в истории.</div><div class="fld"><label>Основание *</label><input name="comment" required minlength="3"></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Аннулировать</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`); };
  U.PERM_F['rep-cancel'] = 'factfix';
  FM['rep-cancel'] = function (f, r) {
    const comment = f.elements.comment.value.trim(); if (comment.length < 3) return err(f, 'Укажите основание.');
    store.update(r.pid, s => s.reportOps.push({ rep: UI.repCor, op: 'cancel', comment, by: DSF.auth.user().login || roleName(), date: today() }));
    closeModal(); keepPage(); toast('Отчёт аннулирован. Запись сохранена в истории.');
  };

  /* --- форма отчёта подрядчика (новый / исправление) --- */
  function repForm(M) {
    const D = UI.repDraft, orgs = factOrgs(M);
    const fix = D.fix ? (M.dayReports || []).find(x => x.id === D.fix) : null;
    const org = fix ? fix.org : (D.org && orgs.includes(D.org) ? D.org : orgs[0]);
    const ts = eligible(M, org);
    const pre = fix ? Object.fromEntries(fix.lines.map(l => [l.task, l.v])) : {};
    const fixTs = fix ? fix.lines.map(l => l.t).filter(t => t && !ts.includes(t)) : [];
    const rows = ts.concat(fixTs).map(t => {
      const left = t.qty ? t.qty - (t.qtyFact || 0) - (t.pend ? t.pend.v : 0) + (pre[t.id] || 0) * (fix && fix.status === 'pending' ? 1 : 0) : 100 - t.pct - (t.pend ? t.pend.v : 0);
      return `<tr><td class="l w"><b>${esc(t.name)}</b><div class="faint" style="font-size:11.5px">готовность ${num(t.pct, 1)}%${t.qty ? ' · выполнено ' + vNum(t, t.qtyFact || 0) + ' из ' + vNum(t, t.qty) + ' ' + esc(t.unit || '') : ''}${t.pend ? ' · ещё не подтверждено ' + vText(t, t.pend.v) : ''}</div></td>
        <td><div style="display:flex; align-items:center; gap:6px; justify-content:flex-end"><input class="nin" type="number" step="any" min="0" name="l_${esc(t.id)}" value="${pre[t.id] != null ? pre[t.id] : ''}" aria-label="Объём: ${esc(t.name)}"><span class="faint" style="min-width:34px">${esc(unitOf(t))}</span></div><div class="faint" style="font-size:11px; text-align:right">остаток ${vNum(t, Math.max(0, left))}</div></td></tr>`;
    }).join('');
    return `<form data-form="rep" class="mform"><div class="mh"><div><div class="eyebrow">Подрядчик · ежедневный факт</div><h3 style="margin-top:4px">${fix ? 'Исправление отчёта за ' + fd(fix.d) : 'Отчёт о выполненных работах'}</h3></div>${xBtn}</div>
      <div class="mb">
        <div class="note">После отправки отчёт проходит подтверждение: ${esc(DSF.chainOf(M.P).map(stepName).join(' → '))}. До полного подтверждения объёмы не попадают в график, готовность и КС-2.</div>
        <div class="row-f"><div class="fld"><label for="rep-org">Подрядчик</label><select id="rep-org" name="org" ${fix ? 'disabled' : ''}>${orgs.map(o => opt(o, o, o === org)).join('')}</select></div>
          <div class="fld"><label for="rep-date">Дата работ</label><input id="rep-date" name="date" type="date" required value="${fix ? iso(fix.d) : esc(D.date || today())}" max="${today()}" min="${iso(T() - 7)}" ${fix ? 'readonly' : ''}></div></div>
        ${rows ? `<div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th>Выполнено за день</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('У подрядчика нет работ в производстве.')}
        <div class="row-f"><div class="fld"><label for="rep-crew">Рабочих на площадке, чел.</label><input id="rep-crew" name="crew" type="number" min="0" step="1" value="${fix && fix.crew != null ? fix.crew : ''}"></div>
          <div class="fld"><label for="rep-photo">Фото (необязательно)</label><input id="rep-photo" name="photos" type="file" accept="image/*" multiple></div></div>
        <div class="fld"><label for="rep-note">Комментарий</label><input id="rep-note" name="note" value="${esc(fix ? fix.note : '')}" placeholder="простои, погода, поставки"></div>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('send')}${fix ? 'Направить повторно' : 'Направить на подтверждение'}</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.INPUTS['rep-org'] = e => { UI.repDraft.org = e.target.value; const dt = document.getElementById('rep-date'); if (dt) UI.repDraft.date = dt.value; U.renderLayer(); };
  const err = (f, html) => { const e = f.querySelector('.err'); if (e) { e.hidden = false; e.innerHTML = html; } else toast(html); };
  FM.rep = function (f, r) {
    const M = M0(), D = UI.repDraft, fd_ = new FormData(f);
    const fix = D.fix ? M.dayReports.find(x => x.id === D.fix) : null;
    const org = fix ? fix.org : String(fd_.get('org') || '');
    const date = fix ? iso(fix.d) : String(fd_.get('date') || '');
    const lines = [], errs = [];
    [...f.querySelectorAll('input[name^="l_"]')].forEach(inp => {
      const id = inp.name.slice(2), v = numIn(inp.value); if (v == null || v === 0) return;
      const t = M.byId.get(id);
      if (!(v > 0)) { errs.push('«' + t.name + '»: объём должен быть положительным'); return; }
      const before = fix ? (fix.lines.find(l => l.task === id) || {}).v || 0 : 0;
      const left = t.qty ? t.qty - (t.qtyFact || 0) - ((t.pend ? t.pend.v : 0) - (fix && fix.status === 'pending' ? before : 0)) : 100 - t.pct - (t.pend ? t.pend.v : 0);
      if (v > left + 1e-6) errs.push('«' + t.name + '»: больше остатка работы (' + vNum(t, Math.max(0, left)) + ' ' + unitOf(t) + ')');
      lines.push([id, v]);
    });
    if (!date || dn(date) > T() || dn(date) < T() - 7) errs.push('Дата работ — не позже ' + F.date(T()) + ' и не раньше ' + F.date(T() - 7));
    if (!lines.length) errs.push('Укажите выполненный объём хотя бы по одной работе');
    if (!fix && M.dayReports.some(x => x.org === org && x.d === dn(date) && x.status !== 'returned')) errs.push('Отчёт ' + org + ' за ' + F.date(dn(date)) + ' уже подан — исправления вносятся через возврат');
    if (errs.length) return err(f, errs.map(esc).join('<br>'));
    const crew = numIn(fd_.get('crew')), note = String(fd_.get('note') || '').trim();
    const files = f.elements.photos && f.elements.photos.files ? [...f.elements.photos.files] : [];
    const photos = files.map(fl => 'u:' + DSF.files.put(fl).id);
    let id;
    store.update(r.pid, s => {
      if (fix) { s.reportOps.push({ rep: fix.id, op: 'resubmit', date: today(), by: org, lines, crew, note }); id = fix.id; return; }
      id = 'rep-u' + (s.seq++);
      s.reports.push({ id, date, org, by: org, lines, crew, note, photos, ok: [], sub: today() });
    });
    closeModal(); H.go(link(r.pid, 'production', id));
    toast(fix ? 'Отчёт исправлен и направлен повторно.' : 'Отчёт направлен на подтверждение: ' + esc(stepName(DSF.chainOf(M.P)[0])) + '.');
  };
  A['rep-new'] = () => { const M = M0(); UI.repDraft = { org: UI.repDraft && UI.repDraft.org || null }; if (!factOrgs(M).length) { toast('Нет работ в производстве, по которым можно подать факт.'); return; } openModal(repForm, { wide: true }); };
  A['rep-fix'] = (el, d) => { UI.repDraft = { fix: d.id }; openModal(repForm, { wide: true }); };
  A['rep-filter'] = (el, d) => { UI.repFilter = d.f; keepPage(); };
  A['rep-more'] = () => { UI.repDays = (UI.repDays || 7) + 14; keepPage(); };

  /* --- подтверждение ступени (с корректировкой объёмов) и возврат --- */
  function confirmForm(M) {
    const x = M.dayReports.find(z => z.id === UI.repAct.id);
    if (!x) return `<div class="mh"><h3>Отчёт не найден</h3>${xBtn}</div>`;
    const ret = UI.repAct.op === 'return';
    return `<form data-form="rep-step" class="mform"><div class="mh"><div><div class="eyebrow">${esc(stepName(x.next))} · отчёт ${esc(x.org)} за ${fd(x.d)}</div><h3 style="margin-top:4px">${ret ? 'Вернуть отчёт подрядчику' : 'Подтвердить выполненные объёмы'}</h3></div>${xBtn}</div>
      <div class="mb">${ret ? '' : `<div class="note">Если фактический объём меньше заявленного, скорректируйте его — в график пойдёт подтверждённое значение, исходное сохранится в истории.</div>
        <div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th>Заявлено</th><th>Подтверждаю</th></tr></thead><tbody>${x.lines.map(l => `<tr><td class="l w">${esc(l.t ? l.t.name : l.task)}</td><td>${l.t ? vText(l.t, l.v) : num(l.v, 1)}</td><td><div style="display:flex; gap:6px; align-items:center; justify-content:flex-end"><input class="nin" type="number" step="any" min="0" max="${l.v}" name="a_${esc(l.task)}" value="${l.v}"><span class="faint">${esc(unitOf(l.t))}</span></div></td></tr>`).join('')}</tbody></table></div>`}
        <div class="fld"><label for="rs-c">${ret ? 'Причина возврата' : 'Комментарий (необязательно)'}</label><textarea id="rs-c" name="comment" ${ret ? 'required' : ''} rows="2"></textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico(ret ? 'back' : 'check')}${ret ? 'Вернуть' : 'Подтвердить'}</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  FM['rep-step'] = function (f, r) {
    const M = M0(), a = UI.repAct, x = M.dayReports.find(z => z.id === a.id);
    if (!x || !canConfirm(x)) { toast('Недостаточно прав для этой ступени подтверждения.'); return; }
    const comment = String(new FormData(f).get('comment') || '').trim();
    if (a.op === 'return') {
      if (!comment) return err(f, 'Укажите причину возврата.');
      store.update(r.pid, s => s.reportOps.push({ rep: x.id, op: 'return', step: x.next, date: today(), by: stepName(x.next), comment }));
      closeModal(); keepPage(); toast('Отчёт возвращён подрядчику.'); return;
    }
    const adj = {}; let bad = false;
    x.lines.forEach(l => { const v = numIn(f.elements['a_' + l.task] && f.elements['a_' + l.task].value); if (v == null || v < 0 || v > l.v + 1e-9) bad = true; else if (v !== l.v) adj[l.task] = v; });
    if (bad) return err(f, 'Подтверждаемый объём — от нуля до заявленного.');
    store.update(r.pid, s => s.reportOps.push({ rep: x.id, op: 'confirm', step: x.next, date: today(), by: stepName(x.next), comment, adj: Object.keys(adj).length ? adj : undefined }));
    closeModal(); keepPage();
    const last = x.chain.indexOf(x.next) === x.chain.length - 1;
    toast(last ? 'Отчёт подтверждён полностью: объёмы вошли в график, готовность и основание КС-2.' : 'Ступень подтверждена. Следующая — ' + esc(stepName(x.chain[x.chain.indexOf(x.next) + 1])) + '.');
  };
  A['rep-confirm'] = (el, d) => { UI.repAct = { id: d.id, op: 'confirm' }; openModal(confirmForm, { wide: true }); };
  A['rep-return'] = (el, d) => { UI.repAct = { id: d.id, op: 'return' }; openModal(confirmForm); };
  A['rep-confirm-mine'] = () => {
    const r = route(), M = M0(), list = M.dayReports.filter(canConfirm);
    if (!list.length) return;
    store.update(r.pid, s => list.forEach(x => s.reportOps.push({ rep: x.id, op: 'confirm', step: x.next, date: today(), by: stepName(x.next), comment: 'Пакетное подтверждение' })));
    keepPage(); toast('Подтверждено отчётов: ' + list.length + '.');
  };

  /* ====================================================================
   * КАЧЕСТВО / СТРОЙКОНТРОЛЬ
   * ==================================================================== */
  const remSt = x => DSF.REMARK_STATUS[x.status] || DSF.REMARK_STATUS.new;
  const sevChip = x => chip(DSF.REMARK_SEV[x.sev].t, DSF.REMARK_SEV[x.sev].c);
  U.VIEWS.quality = function (M, r) {
    const P = M.P, R = M.remarks || [], t = M.T;
    if (r.sub && M.remarkBy && M.remarkBy.get(r.sub)) return remarkCard(M, M.remarkBy.get(r.sub));
    const open = R.filter(x => x.open), crit = open.filter(x => x.sev === 'critical'), over = R.filter(x => x.overdue);
    const closed = R.filter(x => !x.open && x.fixDays != null);
    const avg = closed.length ? sum(closed, x => x.fixDays) / closed.length : null;
    const f = UI.remFilter || 'open';
    const fl = { all: () => true, open: x => x.open, overdue: x => x.overdue, critical: x => x.open && x.sev === 'critical', presented: x => x.status === 'presented', closed: x => !x.open };
    const fo = UI.remOrg || '', fk = UI.remK || '', fw = UI.remW || '';
    const list = R.filter(fl[f] || fl.open).filter(x => (!fo || x.org === fo) && (!fk || x.contractId === fk) && (!fw || x.workType === fw));
    const wtsR = [...new Map(R.filter(x => x.workType).map(x => [x.workType, x.workTypeName])).entries()];
    const ksR = [...new Map(R.filter(x => x.contract && (!fo || x.org === fo)).map(x => [x.contract.id, x.contract.no])).entries()];
    const fsel = `<div class="fchips" style="margin-bottom:12px">
      <select class="inp" data-remf="remOrg" aria-label="Подрядчик" style="max-width:240px"><option value="">Все подрядчики</option>${[...new Set(R.map(x => x.org).filter(Boolean))].map(o => opt(o, o, o === fo)).join('')}</select>
      <select class="inp" data-remf="remK" aria-label="Договор" style="max-width:200px"><option value="">Все договоры</option>${ksR.map(([id, no]) => opt(id, no, id === fk)).join('')}</select>
      <select class="inp" data-remf="remW" aria-label="Вид работ" style="max-width:260px"><option value="">Все виды работ</option>${wtsR.map(([id, n]) => opt(id, n, id === fw)).join('')}</select></div>`;
    const orgs = [...new Set(R.map(x => x.org).filter(Boolean))].map(o => { const xs = R.filter(x => x.org === o), cl = xs.filter(x => x.fixDays != null); return { o, n: xs.length, open: xs.filter(x => x.open).length, over: xs.filter(x => x.overdue).length, crit: xs.filter(x => x.sev === 'critical').length, avg: cl.length ? sum(cl, x => x.fixDays) / cl.length : null }; }).sort((a, b) => b.open - a.open || b.n - a.n);
    const chips = [['open', 'Открытые', open.length], ['critical', 'Критические', crit.length], ['overdue', 'Просроченные', over.length], ['presented', 'Ждут проверки', R.filter(x => x.status === 'presented').length], ['closed', 'Устранённые', R.length - open.length], ['all', 'Все', R.length]];
    const html = `${head(esc(P.name) + ' · строительный контроль', 'Качество', 'и замечания', 'Замечание проходит путь: выдано → назначено подрядчику → устраняется → предъявлено → проверено и закрыто. Срок устранения контролируется в календаре; открытые замечания видны в карточке работы и КС-2.',
      can('quality') ? `<button class="btn primary" type="button" data-x="rem-new">${ico('plus')}Выдать замечание</button>` : '')}
      <section class="tiles">
        ${tile('Открыто', String(open.length), R.length + ' ' + plural(R.length, 'замечание', 'замечания', 'замечаний') + ' всего', open.length ? 'warn' : 'good')}
        ${tile('Критические', String(crit.length), 'не устранены', crit.length ? 'crit' : 'good')}
        ${tile('Просрочены', String(over.length), 'срок устранения прошёл', over.length ? 'crit' : 'good')}
        ${tile('Среднее время устранения', avg != null ? num(avg, 1) + ' <small>дн.</small>' : '—', closed.length ? 'по ' + closed.length + ' ' + plural(closed.length, 'закрытому', 'закрытым', 'закрытым') : 'закрытых замечаний нет')}
      </section>
      <div class="grid2 q2">
        <section class="panel"><header><h2>Замечания</h2><span class="sub">${list.length}</span></header>
          <div class="pad"><div class="fchips" style="margin-bottom:12px" role="group" aria-label="Фильтр">${chips.map(([k, tt, n]) => `<button class="fchip" type="button" data-x="rem-filter" data-f="${k}" aria-pressed="${f === k}">${tt} <b>${n}</b></button>`).join('')}</div>${fsel}
          ${list.length ? `<div class="att">${list.map(x => `<button class="att-i" type="button" data-go="${link(P.id, 'quality', x.id)}"><span class="sev" style="background:${stVar(DSF.REMARK_SEV[x.sev].c)}"></span><span class="tx"><b>№ ${esc(x.no)}</b> ${esc(x.title)}<div class="m">${esc(x.org)}${x.contract ? ' · ' + esc(x.contract.no) : ''}${x.workTypeName ? ' · ' + esc(x.workTypeName) : ''}${x.task ? ' · ' + esc(x.task.name) : ''}${x.loc ? ' · ' + esc(x.loc) : ''}</div></span>
            <span class="rt">${chip(remSt(x).t, x.overdue ? 'crit' : remSt(x).c)}<span class="m" style="${x.overdue ? 'color:var(--crit)' : ''}">${x.open ? 'срок ' + fds(x.due) : 'закрыто ' + fds(x.closedD)}</span></span></button>`).join('')}</div>` : empty('Замечаний по выбранному фильтру нет.')}</div></section>
        <section class="panel"><header><h2>По подрядчикам</h2></header><div class="pad">${orgs.length ? `<div class="list">${orgs.map(o => `<div class="li"><span class="t">${esc(o.o)}</span><span class="num"><b>${o.open}</b> откр. / ${o.n}</span><span class="m">${o.crit ? chip('критических ' + o.crit, 'crit') + ' ' : ''}${o.over ? chip('просрочено ' + o.over, 'warn') + ' ' : ''}${o.avg != null ? 'устраняет в среднем за ' + days(Math.round(o.avg)) : ''}</span></div>`).join('')}</div>` : empty('Нет данных.')}</div></section>
      </div>`;
    return { html };
  };

  function remarkCard(M, x) {
    const P = M.P, s = x.status;
    const acts = [];
    if (s === 'new' && can('quality')) acts.push(`<button class="btn primary" type="button" data-x="rem-step" data-id="${esc(x.id)}" data-to="assigned"><span class="role">Стройконтроль:</span> Назначить исполнителя и срок</button>`);
    if (s === 'assigned' && can('fix')) acts.push(`<button class="btn primary" type="button" data-x="rem-step" data-id="${esc(x.id)}" data-to="work"><span class="role">Подрядчик:</span> Принять в работу</button>`);
    if (s === 'work' && can('fix')) acts.push(`<button class="btn primary" type="button" data-x="rem-step" data-id="${esc(x.id)}" data-to="presented"><span class="role">Подрядчик:</span> Предъявить устранение</button>`);
    if (s === 'presented' && can('quality')) acts.push(`<button class="btn primary" type="button" data-x="rem-step" data-id="${esc(x.id)}" data-to="closed"><span class="role">Стройконтроль:</span> Принять устранение</button>`, `<button class="btn" type="button" data-x="rem-step" data-id="${esc(x.id)}" data-to="work" data-back="1">Вернуть на доработку</button>`);
    const pics = (arr, t) => arr.length ? `<div class="eyebrow" style="margin:10px 0 6px">${t}</div><div class="thumbs">${arr.map(f => `<img class="thumb" src="${H.photoUrl(f)}" alt="${esc(t)}">`).join('')}</div>` : '';
    const html = `<div class="topback">${backBtn(link(P.id, 'quality'), 'Качество')}</div>
      <section class="panel"><header style="flex-wrap:wrap"><div style="min-width:0; flex:1 1 320px"><div class="eyebrow">Замечание строительного контроля № ${esc(x.no)}${x.user ? ' · выдано в системе' : ''}</div><h2 style="margin-top:6px">${esc(x.title)}</h2></div>
        <div class="fchips">${sevChip(x)}${chip(remSt(x).t, remSt(x).c)}${x.overdue ? chip('Просрочено', 'crit') : ''}</div></header>
        <div class="pad grid2" style="gap:24px"><div>
          ${kv([['Описание', esc(x.desc) || '—'], ['Место', esc(x.loc) || '—'], x.norm ? ['Основание', esc(x.norm)] : null, ['Выдал', esc(x.by)], ['Выдано', fd(x.d)], ['Исполнитель', esc(x.org) + (x.owner ? ', ' + esc(x.owner) : '')], ['Договор', x.contract ? `<button class="lnk" type="button" data-go="${link(P.id, 'budget', x.contract.id)}">${esc(x.contract.no)}</button>` : x.noContractReason ? 'не указан — ' + esc(x.noContractReason) : '—'], ['Вид работ', esc(x.workTypeName || '—')], ['Срок устранения', `<span style="color:${x.overdue ? 'var(--crit)' : 'inherit'}">${fd(x.due)}</span>`], !x.open ? ['Закрыто', fd(x.closedD) + (x.fixDays != null ? ' · за ' + days(x.fixDays) : '')] : null])}
          ${pics(x.photos, 'Фото при выдаче')}${pics(x.after, 'Фото после устранения')}
          ${acts.length ? `<div class="mf" style="padding:14px 0 0">${acts.join('')}</div>` : ''}</div>
          <div>${x.task ? `<div class="lb"><div class="eyebrow">Работа</div><button class="qlink" type="button" data-x="work" data-id="${x.task.id}"><b>Работа</b> ${esc(x.task.name)}<span class="faint"> · ${Math.round(x.task.pct)}%</span></button></div>` : ''}
            ${(() => { const ks = M.ks.filter(k => (k.remarksOpen || []).includes(x)); return ks.length ? `<div class="lb"><div class="eyebrow">Влияет на КС-2</div><div class="qlinks">${ks.map(k => `<button class="qlink" type="button" data-go="${link(P.id, 'budget', k.id)}"><b>КС</b> ${esc(k.contract.no + ' · ' + k.no)}</button>`).join('')}</div></div>` : ''; })()}
            ${x.doc ? `<div class="lb"><div class="eyebrow">Документ</div>${(M.docBy.get(x.doc) ? `<button class="qlink" type="button" data-go="${link(P.id, 'docs', x.doc)}">${esc(M.docBy.get(x.doc).code)}</button>` : '')}</div>` : ''}
          </div></div></section>
      <section class="panel"><header><h2>История</h2></header><div class="pad"><div class="feed">${x.hist.slice().reverse().map(h => H.feedRow(h.d, stVar(h.st === 'closed' ? 'good' : h.st === 'new' ? 'crit' : 'accent'), esc(h.text), h.by || '')).join('')}</div></div></section>`;
    return { html, crumb: '№ ' + x.no };
  }
  /* ---------- форма замечания: подрядная организация → договор → вид работ ---------- */
  const normS = v => String(v || '').toLowerCase().replace(/ё/g, 'е').trim();
  DSF.workTypesOf = function (M) {
    const P = M.P, base = (P.workTypes && P.workTypes.length ? P.workTypes : (P.budget && P.budget.items || []).map(i => ({ id: i.code, name: i.name })));
    const add = ((M.store && M.store.workTypes) || []).filter(w => !base.some(x => normS(x.name) === normS(w.name)));
    return base.concat(add.map(w => ({ id: w.id, name: w.name, added: true })));
  };
  /* организации, назначенные на объект: база подрядчиков (по видам работ) и исполнители договоров объекта */
  DSF.objectOrgs = function (M) {
    const out = new Map();
    (M.contracts || []).forEach(c => { if (c.contractor && c.contractor !== M.P.supervisor) out.set(c.contractor, { name: c.contractor, src: 'договор' }); });
    if (DSF.baseOrgsOf) DSF.baseOrgsOf(M.P.id).forEach(c => out.set(c.name, Object.assign(out.get(c.name) || {}, { name: c.name, src: 'база', base: c })));
    (M.participants || []).filter(x => x.role === 'contractor' || x.role === 'gc').forEach(x => { if (x.name && !out.has(x.name)) out.set(x.name, { name: x.name, src: 'участник' }); });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  };
  const contractWT = c => (c.workTypes && c.workTypes.length ? c.workTypes : (c.item ? [c.item] : []));
  function remNewForm(M) {
    const D = UI.remDraft || (UI.remDraft = {});
    const ts = M.tasks.filter(t => !t.ms && t.weighted && (t.as != null || t.pct > 0));
    const orgs = DSF.objectOrgs(M), q = normS(D.orgQ);
    const orgList = orgs.filter(o => !q || normS(o.name).includes(q) || o.name === D.org);
    const cons = D.org ? M.contracts.filter(c => c.contractor === D.org) : [];
    const k = cons.find(c => c.id === D.contract) || null;
    const wts = DSF.workTypesOf(M), kw = k ? contractWT(k) : [];
    const baseW = D.org && DSF.baseOrgsOf ? ((DSF.objectOrgs(M).find(o => o.name === D.org) || {}).base || null) : null;
    const orgW = baseW ? ((baseW.assignments || []).find(a => a.project === M.P.id) || { workTypes: [] }).workTypes.filter(w => w.active !== false).map(w => w.id) : [];
    const first = wts.filter(w => kw.includes(w.id)), second = wts.filter(w => !kw.includes(w.id) && orgW.includes(w.id)), rest = wts.filter(w => !kw.includes(w.id) && !orgW.includes(w.id));
    const mism = D.workType && k && kw.length && !kw.includes(D.workType);
    const og = (label, arr) => arr.length ? `<optgroup label="${esc(label)}">${arr.map(w => opt(w.id, w.name, w.id === D.workType)).join('')}</optgroup>` : '';
    return `<form data-form="rem-new" class="mform"><div class="mh"><div><div class="eyebrow">Строительный контроль</div><h3 style="margin-top:4px">Выдать замечание</h3></div>${xBtn}</div>
      <div class="mb">
        <div class="fld"><label for="rn-t">Замечание</label><input id="rn-t" name="title" data-rd="title" required placeholder="Кратко: что нарушено" value="${esc(D.title || '')}"></div>
        <div class="fld"><label for="rn-d">Описание</label><textarea id="rn-d" name="desc" data-rd="desc" rows="2">${esc(D.desc || '')}</textarea></div>
        <div class="fld"><label for="rn-org">Подрядная организация *</label>
          <input class="inp" type="search" data-rdq="1" placeholder="Поиск организации" value="${esc(D.orgQ || '')}" style="margin-bottom:6px">
          <select id="rn-org" name="org" data-rds="org" required><option value="">— выберите организацию, назначенную на объект —</option>${orgList.map(o => opt(o.name, o.name, o.name === D.org)).join('')}</select>
          ${orgs.length ? '' : '<div class="hint" style="color:var(--warn-ink)">На объект не назначено ни одной организации — назначьте подрядчика в базе подрядчиков.</div>'}</div>
        ${D.org ? `<div class="fld"><label for="rn-k">Номер договора *</label><select id="rn-k" name="contract" data-rds="contract" required><option value="">— выберите договор —</option>${cons.map(c => opt(c.id, c.no + (c.date ? ' от ' + F.date(dn(c.date)) : '') + ' · ' + c.subject, c.id === D.contract)).join('')}<option value="none" ${D.contract === 'none' ? 'selected' : ''}>Договор не указан</option></select>
          ${!cons.length ? '<div class="hint">У организации нет договоров на этом объекте — выберите «Договор не указан» и укажите причину.</div>' : ''}</div>` : ''}
        ${D.contract === 'none' ? `<div class="fld"><label for="rn-nr">Причина, по которой договор не указан *</label><input id="rn-nr" name="noContractReason" data-rd="noContractReason" required value="${esc(D.noContractReason || '')}" placeholder="Например: договор на подписании"></div>` : ''}
        ${D.org ? `<div class="fld"><label for="rn-wt">Вид работ *</label><select id="rn-wt" name="workType" data-rds="workType" required><option value="">— выберите вид работ —</option>${og('По договору', first)}${og('Назначены организации на объекте', second)}${og('Другие виды работ объекта', rest)}</select>
          ${mism ? '<div class="hint" style="color:var(--warn-ink)">Вид работ не входит в предмет выбранного договора. Проверьте выбор — замечание будет выдано с этим предупреждением.</div>' : ''}</div>` : ''}
        <div class="row-f"><div class="fld"><label for="rn-task">Работа графика</label><select id="rn-task" name="task" data-rds="task" required>${ts.filter(t => !D.workType || !(t.workType || t.item) || (t.workType || t.item) === D.workType || t.id === D.task).map(t => opt(t.id, t.stage + ' · ' + t.name, t.id === D.task)).join('')}</select></div>
          <div class="fld"><label for="rn-sev">Важность</label><select id="rn-sev" name="sev" data-rds="sev">${Object.entries(DSF.REMARK_SEV).map(([k2, v]) => opt(k2, v.t, k2 === (D.sev || 'major'))).join('')}</select></div></div>
        <div class="row-f"><div class="fld"><label for="rn-loc">Место (оси, этаж, захватка)</label><input id="rn-loc" name="loc" data-rd="loc" value="${esc(D.loc || '')}"></div>
          <div class="fld"><label for="rn-due">Срок устранения</label><input id="rn-due" name="due" data-rd="due" type="date" required min="${today()}" value="${esc(D.due || iso(T() + 7))}"></div></div>
        <div class="row-f"><div class="fld"><label for="rn-norm">Основание (проект, норматив)</label><input id="rn-norm" name="norm" data-rd="norm" value="${esc(D.norm || '')}"></div>
          <div class="fld"><label for="rn-ph">Фото</label><input id="rn-ph" name="photos" type="file" accept="image/*" multiple></div></div>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Выдать</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.remf; if (k) { UI[k] = e.target.value; if (k === 'remOrg') UI.remK = ''; keepPage(); } });
  document.addEventListener('input', e => {
    const el = e.target; if (!UI.remDraft || !el.closest || !el.closest('form[data-form="rem-new"]')) return;
    if (el.dataset.rd) UI.remDraft[el.dataset.rd] = el.value;
    if (el.dataset.rdq) { UI.remDraft.orgQ = el.value; const pos = el.selectionStart; H.renderLayer(); const n = document.querySelector('[data-rdq]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  document.addEventListener('change', e => {
    const el = e.target; if (!UI.remDraft || !el.dataset || !el.dataset.rds) return;
    const D = UI.remDraft, k = el.dataset.rds; D[k] = el.value;
    if (k === 'org') { D.contract = ''; D.workType = ''; const M = M0(); const cs = M.contracts.filter(c => c.contractor === D.org); if (cs.length === 1) { D.contract = cs[0].id; D.workType = contractWT(cs[0])[0] || ''; } }
    if (k === 'contract' && D.contract && D.contract !== 'none') { const c = M0().contracts.find(x => x.id === D.contract); const w = c ? contractWT(c) : []; if (w.length && !w.includes(D.workType)) D.workType = w[0]; }
    if (['org', 'contract', 'workType'].includes(k)) H.renderLayer();
  });
  FM['rem-new'] = function (f, r) {
    if (!can('quality')) { toast('Недостаточно прав.'); return; }
    const M = M0(), fd_ = new FormData(f), D = UI.remDraft || {};
    const rec = { title: String(fd_.get('title') || '').trim(), desc: String(fd_.get('desc') || '').trim(), task: fd_.get('task'), sev: fd_.get('sev'), loc: String(fd_.get('loc') || '').trim(), norm: String(fd_.get('norm') || '').trim(), due: fd_.get('due'), date: today(), status: 'new', by: M.P.supervisor || roleName(),
      org: D.org || '', contract: D.contract && D.contract !== 'none' ? D.contract : null, noContractReason: D.contract === 'none' ? String(D.noContractReason || '').trim() : '', workType: D.workType || null };
    if (!rec.title || !rec.task || !rec.due) return err(f, 'Заполните замечание, работу и срок.');
    if (!rec.org) return err(f, 'Выберите подрядную организацию.');
    if (!D.contract) return err(f, 'Выберите договор или «Договор не указан».');
    if (D.contract === 'none' && rec.noContractReason.length < 3) return err(f, 'Укажите причину, по которой договор не указан.');
    if (!rec.workType) return err(f, 'Выберите вид работ.');
    const kk = rec.contract && M.contracts.find(c => c.id === rec.contract);
    if (kk && contractWT(kk).length && !contractWT(kk).includes(rec.workType)) rec.wtMismatch = true;
    if (dn(rec.due) < T()) return err(f, 'Срок устранения не может быть раньше ' + F.date(T()) + '.');
    const files = f.elements.photos && f.elements.photos.files ? [...f.elements.photos.files] : [];
    rec.photos = files.map(fl => 'u:' + DSF.files.put(fl).id);
    let id;
    store.update(r.pid, s => { id = 'rem-u' + (s.seq++); rec.no = M.P.code + '-' + String((M.remarks || []).length + 1).padStart(3, '0'); s.remarks.push(Object.assign({ id }, rec)); });
    UI.remDraft = null; closeModal(); H.go(link(r.pid, 'quality', id)); toast('Замечание выдано. Следующий шаг — назначить исполнителя и срок.');
  };
  function remStepForm(M) {
    const a = UI.remAct, x = M.remarkBy.get(a.id), to = a.to;
    const orgs = [...new Set(M.contracts.map(c => c.contractor).concat(x.org ? [x.org] : []))];
    const title = { assigned: 'Назначить исполнителя и срок', work: a.back ? 'Вернуть на доработку' : 'Принять в работу', presented: 'Предъявить устранение', closed: 'Принять устранение' }[to];
    return `<form data-form="rem-step" class="mform"><div class="mh"><div><div class="eyebrow">Замечание № ${esc(x.no)}</div><h3 style="margin-top:4px">${esc(title)}</h3></div>${xBtn}</div>
      <div class="mb">${to === 'assigned' ? `<div class="row-f"><div class="fld"><label for="rs-org">Подрядчик</label><select id="rs-org" name="org">${orgs.map(o => opt(o, o, o === x.org)).join('')}</select></div>
          <div class="fld"><label for="rs-due">Срок устранения</label><input id="rs-due" name="due" type="date" required min="${today()}" value="${iso(Math.max(T(), x.due || T() + 7))}"></div></div>
        <div class="fld"><label for="rs-ow">Ответственный подрядчика</label><input id="rs-ow" name="owner" value="${esc(x.owner)}"></div>` : ''}
        ${to === 'presented' ? `<div class="fld"><label for="rs-af">Фото после устранения</label><input id="rs-af" name="after" type="file" accept="image/*" multiple></div>` : ''}
        <div class="fld"><label for="rs-cm">Комментарий${a.back ? '' : ' (необязательно)'}</label><textarea id="rs-cm" name="comment" rows="2" ${a.back ? 'required' : ''}></textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  FM['rem-step'] = function (f, r) {
    const a = UI.remAct, fd_ = new FormData(f), need = { assigned: 'quality', closed: 'quality', work: a.back ? 'quality' : 'fix', presented: 'fix' }[a.to];
    if (!can(need)) { toast('Недостаточно прав.'); return; }
    const op = { rem: a.id, op: 'status', to: a.to, date: today(), by: roleName(), comment: String(fd_.get('comment') || '').trim(), back: !!a.back };
    if (a.to === 'assigned') { op.org = fd_.get('org'); op.owner = String(fd_.get('owner') || '').trim(); op.due = fd_.get('due'); if (!op.due || dn(op.due) < T()) return err(f, 'Укажите срок не раньше ' + F.date(T()) + '.'); }
    if (a.back && !op.comment) return err(f, 'Укажите, что не устранено.');
    if (a.to === 'presented' && f.elements.after && f.elements.after.files.length) op.after = [...f.elements.after.files].map(fl => 'u:' + DSF.files.put(fl).id);
    store.update(r.pid, s => s.remarkOps.push(op));
    closeModal(); keepPage(); toast(a.to === 'closed' ? 'Замечание закрыто.' : 'Статус замечания обновлён.');
  };
  A['rem-new'] = (el, d) => { UI.remDraft = { task: d.task || null }; openModal(remNewForm, { wide: true }); };
  A['rem-step'] = (el, d) => { UI.remAct = { id: d.id, to: d.to, back: !!d.back }; openModal(remStepForm); };
  A['rem-filter'] = (el, d) => { UI.remFilter = d.f; keepPage(); };

  /* ====================================================================
   * ХРОНОЛОГИЯ
   * ==================================================================== */
  const TL_KINDS = { fact: 'Ежедневный факт', ks: 'КС-2', doc: 'Документы', remark: 'Замечания', order: 'Поручения', guarantee: 'Гарантийные письма', decision: 'Решения', ms: 'Вехи', work: 'Работы', risk: 'Риски', photo: 'Фото' };
  U.VIEWS.timeline = function (M) {
    const P = M.P, all = M.timeline || [];
    if (!UI.tlKinds) UI.tlKinds = new Set(Object.keys(TL_KINDS));
    const list = all.filter(x => UI.tlKinds.has(x.kind));
    const n = UI.tlN || 120, shown = list.slice(0, n);
    const byDay = new Map(); shown.forEach(x => { if (!byDay.has(x.d)) byDay.set(x.d, []); byDay.get(x.d).push(x); });
    const counts = {}; all.forEach(x => { counts[x.kind] = (counts[x.kind] || 0) + 1; });
    const html = `${head(esc(P.name) + ' · хронология', 'Хронология', 'проекта', 'Всё, что произошло на объекте за 120 дней: факт, документы, приёмка и КС-2, замечания, поручения, решения и вехи — в одной ленте. Каждая запись ведёт к первичному объекту.')}
      <section class="panel"><div class="pad">
        <div class="fchips" style="margin-bottom:14px" role="group" aria-label="Типы записей">${Object.entries(TL_KINDS).filter(([k]) => counts[k]).map(([k, t]) => `<button class="fchip" type="button" data-x="tl-kind" data-k="${k}" aria-pressed="${UI.tlKinds.has(k)}">${t} <b>${counts[k]}</b></button>`).join('')}</div>
        ${byDay.size ? [...byDay.entries()].map(([d, xs]) => `<div class="tlday"><div class="eyebrow">${fd(d)}${d === M.T ? ' · сегодня' : ''}</div>${xs.map(x => `<button class="tl-i" type="button" ${x.go ? (x.go.startsWith('work:') ? `data-x="work" data-id="${esc(x.go.slice(5))}"` : `data-go="${(() => { const [s, ...rest] = x.go.split('.'); return link(P.id, s, rest.join('.') || null); })()}"`) : 'disabled'}><span class="k" style="background:${stVar(x.sev)}"></span><span class="x">${esc(x.text)}<small>${esc(TL_KINDS[x.kind] || '')}${x.meta ? ' · ' + esc(x.meta) : ''}</small></span></button>`).join('')}</div>`).join('') : empty('Записей выбранных типов нет.')}
        ${list.length > n ? `<div class="mf" style="padding:12px 0 0"><button class="btn" type="button" data-x="tl-more">Показать ещё ${Math.min(120, list.length - n)}</button></div>` : ''}
      </div></section>`;
    return { html };
  };
  A['tl-kind'] = (el, d) => { if (!UI.tlKinds) UI.tlKinds = new Set(Object.keys(TL_KINDS)); UI.tlKinds.has(d.k) ? UI.tlKinds.delete(d.k) : UI.tlKinds.add(d.k); keepPage(); };
  A['tl-more'] = () => { UI.tlN = (UI.tlN || 120) + 120; keepPage(); };

  /* ====================================================================
   * КАРТОЧКА РАБОТЫ «ПОЧЕМУ»
   * ==================================================================== */
  function workCard(M) {
    const t = M.byId.get(UI.workOpen), P = M.P;
    if (!t) return `<div class="mh"><h3>Работа не найдена</h3>${xBtn}</div>`;
    const causes = DSF.causesOf(M, t);
    const ks = M.ks.filter(k => (k.lines || []).some(l => l.task === t) && (DSF.KS_STATUS[k.status] || {}).r < 9).slice(-3);
    const p = t.pace;
    const goSec = g => { const [s, ...rest] = String(g).split('.'); return link(P.id, s, rest.join('.') || null); };
    const hist = (t.hist || []).slice(-10).reverse();
    return `<div class="mh"><div style="min-width:0"><div class="eyebrow">${esc(t.stage)}${t.contractor ? ' · ' + esc(t.contractor) : ''}</div><h3 style="margin-top:4px">${esc(t.name)}</h3></div>${xBtn}</div>
      <div class="mb">
        <div class="fchips">${chip(t.st.t, t.st.c)}${t.crit ? chip('Критический путь', 'crit') : isFinite(t.float) && !t.done ? chip('Резерв ' + days(t.float), 'neutral') : ''}${t.ms ? '' : chip(DSF.ID_STATE[t.idState].t, DSF.ID_STATE[t.idState].c)}</div>
        ${t.ms ? '' : `<div class="minib" style="margin:10px 0"><span class="bar"><i style="width:${t.pct}%; --c:${t.done ? 'var(--good)' : 'var(--accent)'}"></i><b style="left:${t.planNow}%"></b></span><b>${num(t.pct, 1)}%</b></div>`}
        <div class="wc-grid">
          ${kv([['План', t.ms ? fd(t.f0) : fd(t.s0) + ' – ' + fd(t.f0)], ['План на сегодня', t.ms ? '—' : num(t.planNow, 1) + '%'], [t.af != null ? 'Факт окончания' : 'Прогноз окончания', `<b style="color:${t.slip > 14 ? 'var(--crit)' : t.slip > 3 ? 'var(--warn-ink)' : 'inherit'}">${fd(t.af != null ? t.af : t.ef)}</b>${t.slip ? ' (' + (t.slip > 0 ? '+' : '−') + days(Math.abs(t.slip)) + ')' : ''}`],
            t.qty ? ['Объём', vNum(t, t.qtyFact || 0) + ' из ' + vNum(t, t.qty) + ' ' + esc(t.unit || '')] : null])}
          ${p ? kv([['Темп за 14 дней', t.qty ? num(p.unitRate, 1) + ' ' + esc(t.unit || '') + '/день' : num(p.rate, 2) + ' %/день'], ['Требуемый темп', p.need != null ? (t.qty ? num(p.need * t.qty / 100, 1) + ' ' + esc(t.unit || '') + '/день' : num(p.need, 2) + ' %/день') : 'плановый срок прошёл'], ['Прогноз по темпу', t.efPace ? fd(t.efPace) : 'мало данных (' + p.days + ' ' + plural(p.days, 'день', 'дня', 'дней') + ' с отчётами)'], t.pend ? ['Не подтверждено', vText(t, t.pend.v) + ' · ждёт ' + esc(stepName(t.pend.step))] : null]) : ''}
        </div>
        <div class="eyebrow" style="margin:14px 0 6px">Почему так — по данным системы</div>
        ${causes.length ? `<div class="att">${causes.map(c => `<button class="att-i" type="button" ${c.go ? `data-go="${goSec(c.go)}"` : 'disabled'}><span class="sev" style="background:${stVar(c.sev)}"></span><span class="tx">${esc(c.text)}</span>${c.go ? ico('chev') : ''}</button>`).join('')}</div>` : `<div class="faint" style="font-size:12.5px">${t.slip > 3 ? 'Связанных причин в данных нет — укажите причину ниже.' : 'Отклонений и открытых вопросов по работе нет.'}</div>`}
        ${hist.length ? `<div class="eyebrow" style="margin:14px 0 6px">Подтверждённый факт (последние записи)</div><div class="feed">${hist.map(h => H.feedRow(h.d, 'var(--good)', vText(t, h.v), '')).join('')}</div>` : ''}
        ${t.idDocs && t.idDocs.length ? `<div class="eyebrow" style="margin:14px 0 6px">Исполнительная документация</div><div class="qlinks">${t.idDocs.map(d => `<button class="qlink" type="button" data-go="${link(P.id, 'docs', d.id)}"><b>ИД</b> ${esc(d.code)}<span class="faint"> · ${esc(DSF.docStatusLabel(d, d.state))}</span></button>`).join('')}</div>` : ''}
        ${ks.length ? `<div class="eyebrow" style="margin:14px 0 6px">КС-2 с этой работой</div><div class="qlinks">${ks.map(k => `<button class="qlink" type="button" data-go="${link(P.id, 'budget', k.id)}"><b>КС</b> ${esc(k.contract.no + ' · ' + k.no)}<span class="faint"> · ${esc((DSF.KS_STATUS[k.status] || {}).t || '')}</span></button>`).join('')}</div>` : ''}
        ${(t.notes || []).length ? `<div class="eyebrow" style="margin:14px 0 6px">Причины и мероприятия, указанные участниками</div><div class="list">${t.notes.map(n => `<div class="li"><span class="t">${esc(n.reason)}${n.text ? ' — ' + esc(n.text) : ''}</span><span class="num faint">${fd(n.d)}</span><span class="m">${n.measure ? 'Мероприятие: ' + esc(n.measure) + (n.owner ? ' · ' + esc(n.owner) : '') + (n.dueD != null ? ' · срок ' + fd(n.dueD) : '') + ' · ' : ''}${esc(n.by || '')}</span></div>`).join('')}</div>` : ''}
        ${!t.ms && (can('data') || can('fact')) && !t.done ? `<details class="wc-note" ${UI.workNote ? 'open' : ''}><summary>Указать причину отклонения и мероприятие</summary>
          <form data-form="work-note" class="mform plain" style="margin-top:10px"><div class="row-f"><div class="fld"><label for="wn-r">Причина</label><select id="wn-r" name="reason">${DSF.DEV_REASONS.map(x => opt(x, x)).join('')}</select></div><div class="fld"><label for="wn-t">Пояснение</label><input id="wn-t" name="text"></div></div>
          <div class="row-f3"><div class="fld"><label for="wn-m">Мероприятие</label><input id="wn-m" name="measure"></div><div class="fld"><label for="wn-o">Ответственный</label><input id="wn-o" name="owner"></div><div class="fld"><label for="wn-d">Срок</label><input id="wn-d" name="due" type="date" min="${today()}"></div></div>
          <div class="mf" style="padding:6px 0 0"><button class="btn sm primary" type="submit">${ico('check')}Сохранить</button></div></form></details>` : ''}
      </div>
      <div class="mf">
        <button class="btn" type="button" data-go="${link(P.id, 'schedule')}" data-task="${t.id}">${ico('gantt')}В графике</button>
        ${can('fact') && !t.ms && !t.done ? `<button class="btn" type="button" data-x="rep-new">${ico('plus')}Подать факт</button>` : ''}
        ${can('quality') && !t.ms ? `<button class="btn" type="button" data-x="rem-new" data-task="${t.id}">${ico('shield')}Замечание</button>` : ''}
      </div>`;
  }
  A.work = (el, d) => { UI.workOpen = d.id; UI.workNote = false; UI.qc = null; openModal(workCard, { wide: true }); };
  FM['work-note'] = function (f, r) {
    if (!can('data') && !can('fact')) { toast('Недостаточно прав.'); return; }
    const fd_ = new FormData(f);
    const rec = { task: UI.workOpen, reason: fd_.get('reason'), text: String(fd_.get('text') || '').trim(), measure: String(fd_.get('measure') || '').trim(), owner: String(fd_.get('owner') || '').trim(), due: fd_.get('due') || null, date: today(), by: roleName() };
    store.update(r.pid, s => { rec.id = 'note-u' + (s.seq++); s.notes.push(rec); });
    UI.workNote = false; U.renderLayer(); toast('Причина сохранена — она видна в карточке работы и штабе.');
  };

  /* ====================================================================
   * ШТАБ: сигналы с решениями и контрольные блоки
   * ==================================================================== */
  const goOf = (P, g) => { const [s, ...rest] = String(g || 'overview').split('.'); return link(P.id, s, rest.join('.') || null); };
  function signalsPanel(M) {
    const P = M.P, open = M.signalsOpen || [], decided = (M.signals || []).filter(s => s.decision);
    const n = UI.sigAll ? open.length : Math.min(open.length, 7);
    return `<section class="panel"><header style="flex-wrap:wrap"><h2>Требует решения</h2><span class="sub">${open.length} ${plural(open.length, 'сигнал', 'сигнала', 'сигналов')}${decided.length ? ' · решено ' + decided.length : ''}</span><span class="grow"></span>${secOn(M, 'timeline') ? `<button class="lnk" type="button" data-go="${link(P.id, 'timeline')}">Хронология ${ico('chev')}</button>` : ''}</header>
      <div class="pad">${open.length ? `<div class="att">${open.slice(0, n).map(s => `<div class="sig">
          <button class="att-i" type="button" data-go="${goOf(P, s.go)}"><span class="sev" style="background:${stVar(s.sev)}"></span><span class="tx"><span class="chip ${s.sev === 'crit' ? 'crit' : s.sev === 'warn' ? 'warn' : 'neutral'}" style="margin-right:6px">${esc(s.area)}</span>${esc(s.title)}
            <div class="m">${s.cause ? '<b>Почему:</b> ' + esc(s.cause) : ''}${s.owner ? (s.cause ? ' · ' : '') + '<b>Отвечает:</b> ' + esc(s.owner) : ''}</div></span>${ico('chev')}</button>
          <div class="sig-a">${s.task ? `<button class="lnk" type="button" data-x="work" data-id="${s.task.id}">Почему?</button>` : ''}${can('decide') ? `<button class="lnk" type="button" data-x="sig-decide" data-key="${esc(s.key)}">Решение</button>` : ''}</div></div>`).join('')}</div>
        ${open.length > n ? `<button class="lnk" type="button" data-x="sig-all" style="margin-top:8px">Показать все (${open.length})</button>` : ''}` : empty('Сигналов, требующих решения, нет.' + (decided.length ? ' Решения по ' + decided.length + ' ' + plural(decided.length, 'сигналу', 'сигналам', 'сигналам') + ' записаны в хронологию.' : ''))}</div></section>`;
  }
  const secOn = (M, k) => H.secOn(M, k);
  function controlBlocks(M) {
    const P = M.P, t = M.T, J = M.dayReports || [], R = M.remarks || [], I = M.idStats || {};
    const card = (sec, title, body, foot) => `<${secOn(M, sec) ? `button type="button" data-go="${link(P.id, sec)}"` : 'div'} class="cc">
      <div class="cc-h"><span>${title}</span>${secOn(M, sec) ? ico('arrow') : ''}</div><div class="cc-b">${body}</div>${foot ? `<div class="cc-f">${foot}</div>` : ''}</${secOn(M, sec) ? 'button' : 'div'}>`;
    const row = (l, v, c) => `<div class="cc-r"><span>${l}</span><b style="${c ? 'color:' + stVar(c) : ''}">${v}</b></div>`;
    const orgs = factOrgs(M), todayRep = J.filter(x => x.d === t && x.status !== 'returned').length;
    const pend = J.filter(x => x.status === 'pending');
    const chain = (M.journal && M.journal.chain) || [];
    const slow = M.tasks.filter(x => x.pace && x.pace.ratio != null && x.pace.days >= 6 && x.pace.ratio < ((M.control || {}).paceMin || 80) / 100);
    const ksWork = M.ks.filter(k => { const r = (DSF.KS_STATUS[k.status] || {}).r; return r >= 1 && r < 7 && k.status !== 'rejected'; });
    const ksTz = ksWork.filter(k => ['sent', 'review', 'pre', 'accept', 'formed'].includes(k.status));
    const ksPay = M.ks.filter(k => ['agreed', 'period'].includes(k.status));
    const ksNoId = ksWork.filter(k => (k.idMissing || []).length);
    const G = M.guarantees || [];
    const open = R.filter(x => x.open);
    const parts = [];
    /* реальный объект: контуры Flow, по которым в источнике нет данных, показываются как «—», а не нулями */
    if (P.source === 'legacy') {
      const nd = '<span class="faint">—</span>';
      if (secOn(M, 'production') && !J.length) parts.push(card('production', 'Производство сегодня', row('Ежедневный факт подрядчиков', nd) + row('Ждут подтверждения', nd), 'суточные сводки — в рабочем модуле объекта'));
      if (secOn(M, 'budget') && !ksWork.length) { const acts = M.ks.filter(k => k.entered); parts.push(card('budget', 'Деньги: КС-2', row('Закрыто актами КС-2', acts.length ? money(sum(acts, k => k.amount || 0)) : nd) + row('Заявки КС-2 на проверке', nd) + row('Оплачено', M.contracts.some(c => c.payments.length) ? money(sum(M.contracts, c => c.paid)) : nd), M.contracts.length ? 'по реестру договоров объекта' : 'договоры не переданы')); }
      if (secOn(M, 'docs') && !(P.documents || []).length && !((M.store || {}).docs || []).length) parts.push(card('docs', 'Исполнительная документация', row('ИД принята по работам', nd) + row('На проверке', nd), 'реестр ИД в Flow не вёлся'));
      if (secOn(M, 'quality') && !R.length) parts.push(card('quality', 'Качество', row('Открытых замечаний', nd) + row('Просрочено', nd), 'замечания стройконтроля не передавались'));
    }
    const skip = new Set(parts.map(x => (x.match(/data-go="[^".]*\.(\w+)"/) || [])[1]));
    if (secOn(M, 'production') && !skip.has('production')) parts.push(card('production', 'Производство сегодня',
      row('Отчёты за ' + fds(t), todayRep + ' из ' + orgs.length, orgs.length && todayRep < orgs.length ? 'warn' : null) + chain.map(s => row('Ждут: ' + esc(stepName(s)), pend.filter(x => x.next === s).length, pend.some(x => x.next === s && x.wait >= 2) ? 'warn' : null)).join('') + row('Работ с темпом ниже нормы', slow.length, slow.length ? 'crit' : 'good'),
      slow.length ? esc(slow.slice(0, 2).map(x => x.name).join('; ')) : 'темп в норме'));
    if (secOn(M, 'budget') && !skip.has('budget')) parts.push(card('budget', 'Деньги: КС-2',
      row('В работе', ksWork.length + ' · ' + money(sum(ksWork, k => k.claimed))) + row('Ждут Технического заказчика', ksTz.length, ksTz.length ? 'warn' : null) + row('К оплате', ksPay.length + (ksPay.length ? ' · ' + money(sum(ksPay, k => k.amount || 0)) : '')) + row('Без принятой ИД', ksNoId.length, ksNoId.length ? 'warn' : 'good'),
      M.fin.configured ? 'прогноз стоимости ' + money(M.fin.eac) : ''));
    if (secOn(M, 'docs') && !skip.has('docs')) parts.push(card('docs', 'Исполнительная документация',
      row('ИД принята по работам', I.works ? I.worksOk + ' из ' + I.works : '—', I.works && I.worksOk < I.works ? 'warn' : null) + row('На проверке', I.review || 0) + row('С замечаниями', I.ret || 0, I.ret ? 'warn' : null) + row('Гарантийные письма', G.filter(g => g.gStatus === 'active').length + ' активн.' + (G.some(g => g.gStatus === 'overdue') ? ' · ' + G.filter(g => g.gStatus === 'overdue').length + ' просроч.' : ''), G.some(g => g.gStatus === 'overdue') ? 'crit' : null),
      ''));
    if (secOn(M, 'quality') && !skip.has('quality')) { const cl = R.filter(x => x.fixDays != null); parts.push(card('quality', 'Качество',
      row('Открытых замечаний', open.length, open.length ? 'warn' : 'good') + row('Критических', open.filter(x => x.sev === 'critical').length, open.some(x => x.sev === 'critical') ? 'crit' : 'good') + row('Просрочено', R.filter(x => x.overdue).length, R.some(x => x.overdue) ? 'crit' : 'good') + row('Устранение в среднем', cl.length ? days(Math.round(sum(cl, x => x.fixDays) / cl.length)) : '—'),
      '')); }
    return parts.length ? `<section class="ccs" aria-label="Контрольные блоки">${parts.join('')}</section>` : '';
  }
  function decideForm(M) {
    const s = (M.signals || []).find(x => x.key === UI.sigKey);
    if (!s) return `<div class="mh"><h3>Сигнал уже обработан</h3>${xBtn}</div>`;
    const act = UI.sigAct || 'ack';
    const owners = [...new Set([s.owner].concat(M.contracts.map(c => c.contractor)).concat([M.P.supervisor, M.P.manager]).filter(Boolean))];
    return `<form data-form="sig-decide" class="mform"><div class="mh"><div><div class="eyebrow">Решение руководителя · ${esc(s.area)}</div><h3 style="margin-top:4px">${esc(s.title)}</h3></div>${xBtn}</div>
      <div class="mb">${s.cause ? `<div class="note">${esc(s.cause)}</div>` : ''}
        <div class="seg" role="radiogroup" aria-label="Решение">${[['order', 'Поставить поручение'], ['risk', 'Зарегистрировать риск'], ['ack', 'Принять к сведению']].map(([k, tt]) => `<button type="button" data-x="sig-act" data-a="${k}" aria-pressed="${act === k}">${tt}</button>`).join('')}</div>
        ${act === 'order' ? `<div class="fld"><label for="sd-t">Поручение</label><input id="sd-t" name="text" required value="${esc('Устранить: ' + s.title)}"></div>
          <div class="row-f3"><div class="fld"><label for="sd-o">Исполнитель</label><input id="sd-o" name="owner" required list="sd-ol" value="${esc(s.owner || '')}"><datalist id="sd-ol">${owners.map(o => `<option value="${esc(o)}">`).join('')}</datalist></div>
            <div class="fld"><label for="sd-c">Контролёр</label><input id="sd-c" name="controller" value="${esc(M.P.supervisor || '')}"></div>
            <div class="fld"><label for="sd-d">Срок</label><input id="sd-d" name="due" type="date" required min="${today()}" value="${iso(T() + 7)}"></div></div>` : ''}
        ${act === 'risk' ? `<div class="fld"><label for="sd-rt">Риск</label><input id="sd-rt" name="title" required value="${esc(s.title)}"></div>
          <div class="row-f3"><div class="fld"><label for="sd-p">Вероятность (1–5)</label><input id="sd-p" name="p" type="number" min="1" max="5" step="1" value="${s.sev === 'crit' ? 4 : 3}"></div><div class="fld"><label for="sd-i">Влияние (1–5)</label><input id="sd-i" name="i" type="number" min="1" max="5" step="1" value="${s.sev === 'crit' ? 4 : 3}"></div><div class="fld"><label for="sd-ro">Владелец риска</label><input id="sd-ro" name="owner" value="${esc(s.owner || '')}"></div></div>` : ''}
        <div class="fld"><label for="sd-cm">Комментарий к решению</label><textarea id="sd-cm" name="comment" rows="2" ${act === 'ack' ? 'required' : ''}></textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Записать решение</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  A['sig-decide'] = (el, d) => { UI.sigKey = d.key; UI.sigAct = 'order'; openModal(decideForm, { wide: true }); };
  A['sig-act'] = (el, d) => { UI.sigAct = d.a; U.renderLayer(); };
  A['sig-all'] = () => { UI.sigAll = !UI.sigAll; keepPage(); };
  FM['sig-decide'] = function (f, r) {
    if (!can('decide')) { toast('Решения принимает директор проекта.'); return; }
    const M = M0(), s = (M.signals || []).find(x => x.key === UI.sigKey), act = UI.sigAct || 'ack', fd_ = new FormData(f);
    if (!s) { closeModal(); return; }
    const comment = String(fd_.get('comment') || '').trim();
    const dec = { key: s.key, act, title: s.title, area: s.area, comment, date: today(), by: roleName() };
    if (act === 'ack' && !comment) return err(f, 'Укажите, почему сигнал принят к сведению.');
    if (act === 'order') {
      const rec = { text: String(fd_.get('text') || '').trim(), owner: String(fd_.get('owner') || '').trim(), controller: String(fd_.get('controller') || '').trim(), due: fd_.get('due'), priority: s.sev === 'crit' ? 'critical' : 'high', tasks: s.task ? [s.task.id] : [], docs: [], comment, set: today(), status: 'new', signal: s.key };
      if (!rec.text || !rec.owner || !rec.due || dn(rec.due) < T()) return err(f, 'Заполните поручение, исполнителя и срок (не раньше ' + F.date(T()) + ').');
      store.update(r.pid, st => { const id = 'or-u' + (st.seq++); rec.no = 'Ш-' + (st.orders.filter(o => String(o.no).startsWith('Ш-')).length + 1); st.orders.push(Object.assign({ id }, rec)); dec.order = id; dec.ref = rec.no; st.decisions.push(dec); });
      closeModal(); keepPage(); toast('Поручение № ' + esc(rec.no) + ' поставлено; срок — в календаре.'); return;
    }
    if (act === 'risk') {
      const title = String(fd_.get('title') || '').trim(), p = Math.min(5, Math.max(1, +fd_.get('p') || 3)), i = Math.min(5, Math.max(1, +fd_.get('i') || 3));
      if (!title) return err(f, 'Укажите риск.');
      const ok = DSF.registry.mutate(r.pid, def => { def.risks = def.risks || []; const id = DSF.registry.nid(def, 'r'); def.risks.push({ id, kind: 'risk', status: 'Открыт', title, desc: s.cause || '', p, i, owner: String(fd_.get('owner') || '').trim(), since: today(), cat: s.area, effect: s.task ? { task: s.task.id } : undefined, comments: comment ? [{ date: today(), text: comment, by: roleName() }] : [] }); dec.risk = id; }, 'Риск по сигналу штаба: ' + title);
      if (!ok) return err(f, 'Не удалось сохранить риск.');
      store.update(r.pid, st => st.decisions.push(dec));
      closeModal(); keepPage(); toast('Риск зарегистрирован в реестре рисков.'); return;
    }
    store.update(r.pid, st => st.decisions.push(dec));
    closeModal(); keepPage(); toast('Решение записано в хронологию.');
  };

  /* ====================================================================
   * КС-2: основание из подтверждённого факта, ИД, гарантийное письмо
   * ==================================================================== */
  function ksBasis(M, k) {
    const c = k.contract, prev = c.ks.filter(z => z !== k && z.d < k.d).map(z => z.d);
    const from = prev.length ? Math.max(...prev) : -Infinity;
    return (k.works || []).map(t => {
      const hs = (t.hist || []).filter(h => h.d > from && h.d <= k.d);
      return { t, v: sum(hs, h => h.v), n: hs.length, rem: (t.remarksOpen || []).length };
    });
  }
  function ksExtra(M, k) {
    const P = M.P, r = (DSF.KS_STATUS[k.status] || {}).r, B = ksBasis(M, k), g = k.guarantee;
    const C = M.control || {};
    const miss = k.idMissing || [];
    const canG = can('ksgc') && !g && miss.length && r < 8 && k.status !== 'rejected';
    return `<section class="panel"><header style="flex-wrap:wrap"><h2>Основание и исполнительная документация</h2><span class="sub">подтверждённый ежедневный факт за период · ИД по работам</span><span class="grow"></span>${canG ? `<button class="btn sm primary" type="button" data-x="g-new" data-ks="${esc(k.id)}">${ico('mail')}Сформировать гарантийное письмо</button>` : ''}</header>
      <div class="pad">
        ${miss.length && C.idRequired !== false ? `<div class="note ${g && g.gStatus !== 'overdue' ? '' : 'warn'}" style="margin-bottom:12px">${g ? `ИД по ${miss.length} ${plural(miss.length, 'работе', 'работам', 'работам')} не принята. Подрядчик дал гарантийное письмо ${esc(g.no)} со сроком ${fd(g.due)}${g.gStatus === 'overdue' ? ' — <b>срок прошёл</b>' : ''}. Контроль — в календаре.` : `Нет принятой ИД по ${miss.length} ${plural(miss.length, 'работе', 'работам', 'работам')}. КС-2 можно предъявить с гарантийным письмом о сроке передачи ИД.`}</div>` : B.length ? '<div class="note" style="margin-bottom:12px">ИД по работам заявки принята.</div>' : ''}
        ${B.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Работа</th><th>Подтверждённый факт за период</th><th>Отчётов</th><th>ИД</th><th>Открытые замечания</th></tr></thead>
        <tbody>${B.map(b => `<tr class="link" data-x="work" data-id="${b.t.id}"><td class="l w">${esc(b.t.name)}</td><td>${b.n ? vText(b.t, b.v) : '<span class="faint">до начала журнала</span>'}</td><td>${b.n || '—'}</td><td>${chip(DSF.ID_STATE[b.t.idState].t, DSF.ID_STATE[b.t.idState].c)}</td><td>${b.rem ? chip(String(b.rem), 'warn') : '—'}</td></tr>`).join('')}</tbody></table></div>` : empty('Услуги по договору — без привязки к работам.')}
        ${g ? `<div class="lb" style="margin-top:12px"><div class="eyebrow">Гарантийное письмо</div><button class="qlink" type="button" data-go="${link(P.id, 'docs', g.id)}"><b>Вх.</b> ${esc(g.no)}<span class="faint"> · срок ${fd(g.due)} · ${esc(g.gStatus === 'done' ? 'исполнено' : g.gStatus === 'overdue' ? 'просрочено' : 'на контроле')}</span></button></div>` : ''}
      </div></section>`;
  }
  function ksNewExtra(M, c) {
    const pend = c.tasks.filter(t => t.pend && t.pend.v);
    const miss = c.tasks.filter(t => t.idReq && t.pct > 0 && t.idState !== 'ok');
    return `${pend.length ? `<div class="note warn">Не вошло в сумму: неподтверждённый факт по ${pend.length} ${plural(pend.length, 'работе', 'работам', 'работам')} (${esc(pend.map(t => t.name + ' ' + vText(t, t.pend.v)).join('; '))}). Он будет учтён после подтверждения отчётов.</div>` : ''}
      ${miss.length && (M.control || {}).idRequired !== false ? `<div class="note warn">ИД не принята по ${miss.length} ${plural(miss.length, 'работе', 'работам', 'работам')}: ${esc(miss.map(t => t.name).join('; '))}. При отправке КС-2 потребуется гарантийное письмо.</div>` : ''}`;
  }
  function gForm(M) {
    const k = M.ksBy.get(UI.gKs), C = M.control || {};
    const miss = k.idMissing || [];
    return `<form data-form="g-new" class="mform"><div class="mh"><div><div class="eyebrow">Подрядчик · ${esc(k.contract.contractor)}</div><h3 style="margin-top:4px">Гарантийное письмо о передаче ИД</h3></div>${xBtn}</div>
      <div class="mb"><div class="note">${UI.gSend ? 'КС-2 направляется без принятой исполнительной документации. ' : ''}Письмо регистрируется во входящих заказчика, срок передачи ИД появляется в календаре и контролируется в штабе; при приёмке ИД письмо закрывается автоматически.</div>
        ${kv([['КС-2', esc(k.contract.no + ' · ' + k.no)], ['Получатель', esc(M.P.customer || '—')]])}
        <div class="eyebrow" style="margin:10px 0 6px">Работы без принятой ИД</div>
        <div class="list">${miss.map(t => `<label class="li chk" style="grid-template-columns:auto 1fr auto"><input type="checkbox" name="w" value="${t.id}" checked><span class="t">${esc(t.name)}</span>${chip(DSF.ID_STATE[t.idState].t, DSF.ID_STATE[t.idState].c)}</label>`).join('')}</div>
        <div class="row-f"><div class="fld"><label for="g-due">Срок передачи ИД</label><input id="g-due" name="due" type="date" required min="${iso(T() + 1)}" value="${iso(T() + (C.guaranteeDays || 14))}"></div>
          <div class="fld"><label for="g-no">Исходящий № подрядчика</label><input id="g-no" name="no" required placeholder="например, ИСХ-125"></div></div>
        <div class="fld"><label for="g-b">Текст</label><textarea id="g-b" name="body" rows="3">${esc('Гарантируем передачу исполнительной документации по работам, предъявленным в ' + k.no + ' по договору ' + k.contract.no + ', в срок до указанной даты.')}</textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('send')}${UI.gSend ? 'Зарегистрировать письмо и направить КС-2' : 'Зарегистрировать письмо'}</button>${UI.gSend ? `<button class="btn" type="button" data-x="ks-send-anyway">Направить без письма</button>` : ''}<button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  FM['g-new'] = function (f, r) {
    if (!can('ksgc')) { toast('Гарантийное письмо формирует подрядчик.'); return; }
    const M = M0(), k = M.ksBy.get(UI.gKs), fd_ = new FormData(f);
    const tasks = [...f.querySelectorAll('input[name="w"]:checked')].map(x => x.value);
    const due = fd_.get('due'), no = String(fd_.get('no') || '').trim();
    if (!tasks.length) return err(f, 'Отметьте хотя бы одну работу.');
    if (!due || dn(due) <= T()) return err(f, 'Срок передачи ИД — позже ' + F.date(T()) + '.');
    if (!no) return err(f, 'Укажите номер письма.');
    let id;
    store.update(r.pid, s => {
      id = 'gl-u' + (s.seq++);
      s.letters.push({ id, dir: 'in', kind: 'guarantee', no, date: today(), from: k.contract.contractor, to: M.P.customer, subject: 'Гарантийное письмо о передаче исполнительной документации к ' + k.no + ' по договору ' + k.contract.no, status: 'Зарегистрировано', dueDate: due, ks: k.id, tasks, body: String(fd_.get('body') || '').trim() });
    });
    const send = UI.gSend; UI.gSend = null; closeModal();
    if (send) { UI.ksSkipId = k.id; A['ks-act'](null, send, r); UI.ksSkipId = null; return; }
    keepPage(); toast('Гарантийное письмо зарегистрировано; срок ' + F.date(dn(due)) + ' — в календаре.');
  };
  A['g-new'] = (el, d) => { UI.gKs = d.ks; UI.gSend = null; openModal(gForm, { wide: true }); };
  A['ks-send-anyway'] = () => { const send = UI.gSend, r = route(); UI.gSend = null; closeModal(); UI.ksSkipId = send.ks; A['ks-act'](null, send, r); UI.ksSkipId = null; };
  // перехват отправки КС-2 подрядчиком: без принятой ИД — предупреждение и гарантийное письмо
  const ksAct0 = A['ks-act'];
  A['ks-act'] = function (el, d, r) {
    const gc = ['sent', 'formed'].includes(d.to);
    if (!can(gc ? 'ksgc' : 'kstz')) { toast(gc ? 'Это действие выполняет подрядчик.' : 'Это действие выполняет Технический заказчик.'); return; }
    const M = M0(), k = M.ksBy.get(d.ks);
    if (d.to === 'sent' && k && UI.ksSkipId !== k.id && (k.idMissing || []).length && !k.guarantee && (M.control || {}).idRequired !== false) {
      UI.gKs = k.id; UI.gSend = { ks: d.ks, to: d.to }; openModal(gForm, { wide: true }); return;
    }
    return ksAct0(el, d, r);
  };
  U.PERM_X['ks-act'] = null; U.PERM_X['ks-new'] = 'ksgc'; U.PERM_F['ks-new'] = 'ksgc'; U.PERM_F['ks-result'] = null;

  /* письма, события, документы ИД */
  function letterExtra(M, l) {
    if (l.kind !== 'guarantee') return '';
    const P = M.P, st = { done: ['ИД передана и принята', 'good'], overdue: ['Срок прошёл', 'crit'], active: ['На контроле', 'accent'] }[l.gStatus] || ['—', 'neutral'];
    return `<div class="lb"><div class="eyebrow">Гарантийное письмо по ИД</div><div class="fchips" style="margin-bottom:8px">${chip(st[0], st[1])}${chip('срок ' + fd(l.due), l.gStatus === 'overdue' ? 'crit' : 'neutral')}</div>
      ${l.ksObj ? `<button class="qlink" type="button" data-go="${link(P.id, 'budget', l.ksObj.id)}"><b>КС</b> ${esc(l.ksObj.contract.no + ' · ' + l.ksObj.no)}</button>` : ''}
      <div class="qlinks" style="margin-top:6px">${(l.gTasks || []).map(t => `<button class="qlink" type="button" data-x="work" data-id="${t.id}"><b>Работа</b> ${esc(t.name)}<span class="faint"> · ${esc(DSF.ID_STATE[t.idState].t)}</span></button>`).join('')}</div></div>`;
  }
  function eventExtra(M, e) {
    const P = M.P;
    if (e.letterId) { const l = M.letterBy.get(e.letterId); return l ? `<div class="lb"><div class="eyebrow">Гарантийное письмо</div><button class="qlink" type="button" data-go="${link(P.id, 'docs', l.id)}"><b>Вх.</b> ${esc(l.no)}<span class="faint"> · ${esc(l.from)}</span></button></div>` : ''; }
    if (e.remarkId) { const x = M.remarkBy.get(e.remarkId); return x ? `<div class="lb"><div class="eyebrow">Замечание стройконтроля</div><button class="qlink" type="button" data-go="${link(P.id, 'quality', x.id)}"><b>№ ${esc(x.no)}</b> ${esc(x.title)}<span class="faint"> · ${esc(remSt(x).t)}</span></button></div>` : ''; }
    return '';
  }
  function idSummary(M) {
    const I = M.idStats || {}, P = M.P;
    const works = M.tasks.filter(t => t.idReq && (t.pct > 0 || (t.idDocs || []).length) && t.idState !== 'ok');
    const G = (M.guarantees || []).filter(g => g.gStatus !== 'done');
    return `<section class="tiles">
        ${tile('ИД принята по работам', I.works ? I.worksOk + ' <small>из ' + I.works + '</small>' : '—', 'выполненные и начатые работы', I.works && I.worksOk < I.works ? 'warn' : 'good')}
        ${tile('Документов ИД', String(I.required || 0), 'принято ' + (I.ok || 0) + ' · на проверке ' + (I.review || 0))}
        ${tile('С замечаниями', String(I.ret || 0), 'возвращены на доработку', I.ret ? 'warn' : '')}
        ${tile('Гарантийные письма', String(G.length), G.some(g => g.gStatus === 'overdue') ? 'просрочено ' + G.filter(g => g.gStatus === 'overdue').length : 'на контроле', G.some(g => g.gStatus === 'overdue') ? 'crit' : '')}
      </section>
      ${works.length ? `<section class="panel"><header><h2>Работы без принятой ИД</h2><span class="sub">${works.length}</span></header><div class="pad"><div class="att">${works.map(t => `<button class="att-i" type="button" data-x="work" data-id="${t.id}"><span class="sev" style="background:${stVar(DSF.ID_STATE[t.idState].c)}"></span><span class="tx">${esc(t.name)}<div class="m">${esc(t.contractor || '')} · готовность ${num(t.pct, 0)}% · ${esc(DSF.ID_STATE[t.idState].t)}${(M.guarantees || []).some(g => g.gStatus !== 'done' && g.gTasks.includes(t)) ? ' · есть гарантийное письмо' : ''}</div></span>${ico('chev')}</button>`).join('')}</div></div></section>` : ''}`;
  }

  DSF.uiFlow = { signalsPanel, controlBlocks, ksExtra, ksNewExtra, letterExtra, eventExtra, idSummary, workCard };
})();
