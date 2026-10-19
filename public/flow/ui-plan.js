/*
 * Flow — управление графиком (единый расчёт CPM, cpm.js):
 *   · проверка логических связей графика (циклы, дубли, работы без предшественников и последователей);
 *   · корректировка работы по слоям: факт / рабочий прогноз / базовый план / свойства / связи —
 *     каждая правка — запись журнала с автором, датой и основанием, история сохраняется;
 *   · базовый план: версии, новая версия из рабочего прогноза, перенос даты начала проекта
 *     (пересчёт CPM: сдвигаются только не начатые работы, подтверждённый факт не меняется);
 *   · импорт графика MS Project (XML, формат MSPDI) с сохранением связей и проверкой связности.
 * Права: факт — «Выполнение работ: редактирование»; прогноз, свойства и связи — «График: редактирование»;
 * базовый план и импорт — «График: управление настройками». Сервер проверяет каждую запись.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, fd, chip, ico, toast, openModal, closeModal, keepPage, link, plural } = H;
  const { dn, iso } = DSF.util;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const err = (m) => { const e = document.querySelector('.modal .err'); if (e) { e.hidden = false; e.textContent = m; } };
  const has = c => DSF.auth.has(c);
  const demo = DSF.mode === 'demo';
  const M0 = () => { const r = H.route(); return r.pid ? DSF.build(H.byId(r.pid)) : null; };
  const me = () => DSF.auth.user().login || DSF.auth.name();
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const editable = M => demo || (DSF.registry && DSF.registry.isUser && DSF.registry.isUser(M.P.id));
  const MISSING = 'Для части работ отсутствуют логические зависимости. Расчёт влияния на сроки объекта может быть неполным.';

  /* ===================================================== проверка связей */
  DSF.scheduleNotice = function (M) {
    const N = M.network; if (!N || M.P.source === 'legacy') return '';
    if (N.state === 'ok') return '';
    const txt = N.state === 'error' ? 'В графике есть циклические зависимости — расчёт сроков недостоверен.' : N.state === 'none' ? 'В графике нет логических связей между работами. Расчёт влияния на сроки объекта невозможен.' : MISSING;
    return `<div class="pad" style="padding-bottom:0"><div class="note ${N.state === 'error' ? '' : 'warn'}" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; ${N.state === 'error' ? 'border-left:3px solid var(--crit)' : ''}"><span style="flex:1 1 300px">${esc(txt)}</span><button class="btn sm" type="button" data-x="net-check">${ico('link')}Проверить связи</button></div></div>`;
  };
  A['net-check'] = () => openModal(netForm, { global: true, wide: true });
  function netForm() {
    const M = M0(), N = M.network;
    const li = (arr, f) => arr.length ? `<div class="imp-list">${arr.slice(0, 60).map(f).join('')}</div>${arr.length > 60 ? `<div class="faint">и ещё ${arr.length - 60}</div>` : ''}` : '<div class="faint" style="font-size:13px">нет</div>';
    const tk = t => `<div class="imp-i"><div class="imp-h"><b>${esc(t.name)}</b>${t.crit ? chip('крит.', 'crit') : ''}</div><div class="imp-m">${esc(t.stage || '')}</div></div>`;
    return `<div class="mh"><div><div class="eyebrow">${esc(M.P.name)} · проверка графика</div><h3 style="margin-top:4px">Логические связи</h3></div>${xBtn}</div>
      <div class="mb"><dl class="kv kvw"><dt>Состояние</dt><dd>${{ ok: chip('связи полные', 'good'), partial: chip('связи неполные', 'warn'), none: chip('связей нет', 'warn'), error: chip('ошибка: цикл', 'crit') }[N.state]}</dd><dt>Связей</dt><dd>${N.links}</dd><dt>Покрытие работ</dt><dd>${N.coverage != null ? Math.round(N.coverage * 100) + '%' : '—'}</dd></dl>
        ${N.state !== 'ok' ? `<div class="note warn">${esc(MISSING)}</div>` : ''}
        ${N.cycles.length ? `<h3>Циклы</h3>${li(N.cycles, c => `<div class="imp-i">${c.map(t => esc(t.name)).join(' → ')}</div>`)}` : ''}
        ${N.duplicates.length ? `<h3>Дублирующие связи</h3>${li(N.duplicates, d => `<div class="imp-i">${esc(JSON.stringify(d))}</div>`)}` : ''}
        ${N.unknown.length ? `<h3>Ссылки на несуществующие работы</h3>${li(N.unknown, d => `<div class="imp-i">${esc(typeof d === 'string' ? d : JSON.stringify(d))}</div>`)}` : ''}
        <h3>Работы без последующих (кроме финальной вехи)</h3>${li(N.openEnds.filter(t => !t.done), tk)}
        <h3>Не начатые работы без предшествующих</h3>${li(N.openStarts.filter(t => !t.done && !t.started), tk)}
        <p class="faint" style="font-size:12px">Связи добавляются в карточке работы: «Корректировка» → «Связи». Система не создаёт связи автоматически.</p></div>`;
  }

  /* ===================================================== корректировка работы */
  const LAYERS = [['fact', 'Факт', 'production.edit'], ['forecast', 'Прогноз', 'schedule.edit'], ['baseline', 'Базовый план', 'schedule.settings'], ['props', 'Свойства', 'schedule.edit'], ['links', 'Связи', 'schedule.edit'], ['hist', 'История', 'schedule.view']];
  const baseTaskEdit = A['task-edit'];
  A['task-edit'] = (el, d) => {
    const M = M0();
    if (!editable(M)) return baseTaskEdit ? baseTaskEdit(el, d) : null;
    const first = LAYERS.find(l => has(l[2]) && l[0] !== 'hist');
    UI.tfix = { id: d.id, layer: (first || LAYERS[5])[0] };
    openModal(taskFix, { wide: true });
  };
  U.PERM_X['task-edit'] = null;
  function taskFix(M) {
    const F = UI.tfix, t = M.byId.get(F.id);
    if (!t) return `<div class="mh"><h3>Работа не найдена</h3>${xBtn}</div>`;
    const tabs = `<div class="seg" style="margin-bottom:8px">${LAYERS.filter(l => has(l[2])).map(([k, n]) => `<button type="button" data-x="tf-layer" data-l="${k}" aria-pressed="${F.layer === k}">${n}</button>`).join('')}</div>`;
    const reason = `<div class="fld"><label for="tf-r">Основание корректировки *</label><input id="tf-r" name="reason" required minlength="3" placeholder="Документ, письмо, решение совещания…"></div>`;
    let body = '';
    if (F.layer === 'fact') body = `<p class="muted" style="font-size:13px">Правка ранее внесённого факта. Подтверждённые отчёты не удаляются — корректировка сохраняется отдельной записью и видна в истории.</p>
      <div class="row-f3"><div class="fld"><label>Факт. начало</label><input name="as" type="date" value="${t.as != null ? iso(t.as) : ''}" max="${iso(H.T())}"></div><div class="fld"><label>Факт. окончание</label><input name="af" type="date" value="${t.af != null ? iso(t.af) : ''}" max="${iso(H.T())}"></div>
        ${t.ms ? '' : `<div class="fld"><label>Выполнено, %</label><input name="pct" type="number" min="0" max="100" step="0.1" value="${Math.round(t.pct * 10) / 10}"></div>`}</div>${reason}`;
    else if (F.layer === 'forecast') body = `<p class="muted" style="font-size:13px">Ограничения рабочего прогноза: «начало не ранее» и «окончание не ранее». Базовый план не меняется. Сроки последующих работ пересчитываются по связям.</p>
      <div class="row-f"><div class="fld"><label>Начало не ранее</label><input name="ps" type="date" value="${t.snet != null ? iso(t.snet) : ''}" ${t.as != null ? 'disabled title="Работа начата"' : ''}></div><div class="fld"><label>Окончание не ранее</label><input name="pf" type="date" value="${t.fnet != null ? iso(t.fnet) : ''}"></div></div>
      <div class="faint" style="font-size:12px">Сейчас: прогноз ${fd(t.es)} – ${fd(t.ef)}, резерв ${t.float == null ? '—' : t.float + ' дн.'}</div>${reason}`;
    else if (F.layer === 'baseline') body = `<div class="note warn">Изменение базового плана — отдельное утверждаемое действие. Прежнее значение сохраняется в истории.</div>
      <div class="row-f"><div class="fld"><label>Плановое начало</label><input name="ps" type="date" required value="${iso(t.s0)}"></div><div class="fld"><label>Плановое окончание</label><input name="pf" type="date" required value="${iso(t.f0)}"></div></div>${reason}`;
    else if (F.layer === 'props') body = `<div class="fld"><label>Наименование</label><input name="name" required value="${esc(t.name)}"></div>
      <div class="row-f3"><div class="fld"><label>Объём</label><input name="qty" type="number" min="0" step="any" value="${t.qty || ''}"></div><div class="fld"><label>Ед. изм.</label><input name="unit" value="${esc(t.unit || '')}"></div><div class="fld"><label>Директивный срок</label><input name="directive" type="date" value="${t.directive != null ? iso(t.directive) : ''}"></div></div>
      <div class="fld"><label>Вид работ</label><select name="workType"><option value="">—</option>${(DSF.workTypesOf ? DSF.workTypesOf(M) : []).map(w => opt(w.id, w.name, w.id === (t.workType || t.item))).join('')}</select></div>${reason}`;
    else if (F.layer === 'links') {
      const deps = t.deps || [];
      const succ = M.tasks.filter(x => (x.deps || []).some(d => d.id === t.id));
      body = `<p class="muted" style="font-size:13px">Предшествующие работы этой работы. Типы: ОН (FS) — окончание→начало, НН (SS), ОО (FF), НО (SF); задержка в днях, допускается отрицательная. Циклы и дубли не допускаются.</p>
        <div class="imp-list">${deps.map(d => { const p = M.byId.get(d.id); return `<div class="imp-i"><div class="imp-h"><b>${esc(p ? p.name : d.id)}</b><span>${d.type}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}${d.active === false ? ' · откл.' : ''}</span></div>
          <div class="fchips">${d.active === false ? `<button class="btn sm" type="button" data-x="tf-link" data-op="activate" data-pred="${esc(d.id)}">Включить</button>` : `<button class="btn sm" type="button" data-x="tf-link" data-op="deactivate" data-pred="${esc(d.id)}">Отключить</button>`}<button class="btn sm" type="button" data-x="tf-link" data-op="remove" data-pred="${esc(d.id)}">${ico('trash')}Удалить</button></div></div>`; }).join('') || '<div class="faint">Предшествующих работ нет.</div>'}</div>
        <div class="row-f3" style="margin-top:6px"><div class="fld"><label>Предшествующая работа</label><select name="pred"><option value="">—</option>${M.tasks.filter(x => x.id !== t.id).map(x => opt(x.id, (x.ms ? '◆ ' : '') + x.stage + ' · ' + x.name, false)).join('')}</select></div>
          <div class="fld"><label>Тип</label><select name="type">${['FS', 'SS', 'FF', 'SF'].map(k => opt(k, { FS: 'ОН — окончание→начало', SS: 'НН — начало→начало', FF: 'ОО — окончание→окончание', SF: 'НО — начало→окончание' }[k], k === 'FS')).join('')}</select></div>
          <div class="fld"><label>Задержка, дн.</label><input name="lag" type="number" step="1" value="0"></div></div>${reason}
        <div class="faint" style="font-size:12px">Последующие работы: ${succ.length ? succ.map(x => esc(x.name)).join(', ') : 'нет'}</div>`;
    }
    else {
      const ops = (M.taskOps || []).filter(o => o.task === t.id).concat((M.linkOps || []).filter(o => o.succ === t.id).map(o => Object.assign({ layer: 'links' }, o)));
      const L = { fact: 'Факт', forecast: 'Прогноз', baseline: 'Базовый план', props: 'Свойства', links: 'Связи' };
      body = ops.length ? `<div class="audit">${ops.slice().reverse().map(o => `<div class="au"><div class="au-t">${esc(o.date || '')}</div><div class="au-x"><b>${esc(L[o.layer] || o.layer || o.op)}</b>: ${esc(Object.entries(o.patch || {}).map(([k, v]) => k + ' → ' + (v === '' || v == null ? '—' : v)).join(', ') || (o.op + (o.pred ? ' ' + ((M.byId.get(o.pred) || {}).name || o.pred) : '') + (o.type ? ' ' + o.type + (o.lag ? (o.lag > 0 ? '+' : '') + o.lag : '') : '')))}${o.before ? `<div class="faint" style="font-size:12px">было: ${esc(Object.entries(o.before).map(([k, v]) => k + ' ' + (v == null ? '—' : v)).join(', '))}</div>` : ''}<div class="faint" style="font-size:12px">${esc(o.by || '')} · ${esc(o.reason || '')}</div></div></div>`).join('')}</div>` : '<div class="empty">Корректировок не было.</div>';
    }
    const canSave = F.layer !== 'hist';
    return `<form data-form="task-fix" class="mform"><div class="mh"><div><div class="eyebrow">${esc(M.P.name)} · корректировка работы</div><h3 style="margin-top:4px">${esc(t.name)}</h3></div>${xBtn}</div>
      <div class="mb">${tabs}${body}<div class="err" hidden></div></div>
      <div class="mf">${canSave ? `<button class="btn primary" type="submit">${ico('check')}${F.layer === 'links' ? 'Добавить связь' : 'Сохранить корректировку'}</button>` : ''}<button class="btn" type="button" data-act="x-close">Закрыть</button></div></form>`;
  }
  A['tf-layer'] = (el, d) => { UI.tfix.layer = d.l; H.renderLayer(); };
  const reasonOf = () => { const r = document.getElementById('tf-r'); return r ? r.value.trim() : ''; };
  /* проверка цикла до сохранения: добавляемая связь не должна замыкать сеть */
  function wouldCycle(M, succ, pred) {
    const seen = new Set(), q = [succ];
    const succOf = id => M.tasks.filter(x => (x.deps || []).some(d => d.id === id && d.active !== false)).map(x => x.id);
    while (q.length) { const x = q.shift(); if (x === pred) return true; succOf(x).forEach(y => { if (!seen.has(y)) { seen.add(y); q.push(y); } }); }
    return false;
  }
  A['tf-link'] = (el, d) => {
    const M = M0(), t = M.byId.get(UI.tfix.id), reason = reasonOf();
    if (reason.length < 3) return err('Укажите основание корректировки.');
    if (d.op === 'activate' && wouldCycle(M, t.id, d.pred)) return err('Связь образует цикл.');
    DSF.store.update(M.P.id, s => s.linkOps.push({ id: uid('lk'), succ: t.id, pred: d.pred, op: d.op, reason, by: me(), date: iso(H.T()) }));
    keepPage(); H.renderLayer(); toast('Связь изменена. Сроки пересчитаны по CPM.');
  };
  U.PERM_F['task-fix'] = null;
  FM['task-fix'] = function (f, r) {
    const M = M0(), F = UI.tfix, t = M.byId.get(F.id), fd_ = new FormData(f), reason = String(fd_.get('reason') || '').trim();
    if (reason.length < 3) return err('Укажите основание корректировки.');
    const L = LAYERS.find(l => l[0] === F.layer); if (!has(L[2])) return err('Недостаточно прав для этого слоя.');
    const g = k => { const v = fd_.get(k); return v == null ? undefined : String(v).trim(); };
    let patch = {}, before = {};
    if (F.layer === 'links') {
      const pred = g('pred'); if (!pred) return err('Выберите предшествующую работу.');
      const type = g('type') || 'FS', lag = Math.round(+g('lag') || 0);
      if ((t.deps || []).some(d => d.id === pred)) return err('Такая связь уже есть — дубли не допускаются.');
      if (wouldCycle(M, t.id, pred)) return err('Связь образует цикл: «' + M.byId.get(pred).name + '» уже зависит от этой работы.');
      DSF.store.update(r.pid, s => s.linkOps.push({ id: uid('lk'), succ: t.id, pred, type, lag, op: 'add', source: 'manual', reason, by: me(), date: iso(H.T()) }));
      keepPage(); H.renderLayer(); toast('Связь добавлена. Сроки пересчитаны по CPM.'); return;
    }
    if (F.layer === 'fact') {
      const as = g('as'), af = g('af'), pc = g('pct');
      if (as) patch.as = as; if (af) patch.af = af; if (pc != null && pc !== '') patch.pct = Math.max(0, Math.min(100, +pc));
      if (af && as && af < as) return err('Окончание раньше начала.');
      if (af && patch.pct != null && patch.pct < 100) return err('Если указано фактическое окончание, выполнение — 100%.');
      if (af && patch.pct == null) patch.pct = 100;
      before = { as: t.as != null ? iso(t.as) : null, af: t.af != null ? iso(t.af) : null, pct: Math.round(t.pct * 10) / 10 };
    } else if (F.layer === 'forecast') {
      const ps = g('ps'), pf = g('pf'); patch = { ps: ps || '', pf: pf || '' };
      if (ps && pf && pf < ps) return err('Окончание раньше начала.');
      before = { es: iso(t.es), ef: iso(t.ef) };
    } else if (F.layer === 'baseline') {
      const ps = g('ps'), pf = g('pf'); if (!ps || !pf || pf < ps) return err('Проверьте плановые даты.');
      patch = { ps, pf }; before = { ps: iso(t.s0), pf: iso(t.f0) };
    } else {
      patch = { name: g('name'), qty: g('qty') === '' ? '' : +g('qty'), unit: g('unit'), directive: g('directive') || '', workType: g('workType') || '' };
      before = { name: t.name, qty: t.qty, unit: t.unit, directive: t.directive != null ? iso(t.directive) : null, workType: t.workType || t.item || null };
    }
    if (!Object.keys(patch).length) return err('Нет изменений.');
    DSF.store.update(r.pid, s => s.taskOps.push({ id: uid('to'), task: t.id, layer: F.layer, patch, before, reason, by: me(), date: iso(H.T()) }));
    closeModal(); keepPage(); toast('Корректировка сохранена и пересчитана. Прежние значения — в истории работы.');
  };

  /* ===================================================== базовый план: версии, перенос начала */
  function bump(M) { return 1 + Math.max(0, ...(M.baselines || []).map(b => +b.version || 0)); }
  A['bl-open'] = () => { UI.bl = { tab: 'versions' }; openModal(blForm, { wide: true }); };
  function blForm(M) {
    const B = UI.bl, vs = M.baselines || [];
    const tabs = `<div class="seg" style="margin-bottom:8px">${[['versions', 'Версии'], ['forecast', 'Новая версия из прогноза'], ['start', 'Перенос начала проекта'], ['import', 'Импорт MS Project']].map(([k, n]) => `<button type="button" data-x="bl-tab" data-t="${k}" aria-pressed="${B.tab === k}">${n}</button>`).join('')}</div>`;
    let body = '';
    const start0 = Math.min(...M.tasks.map(t => t.s0));
    if (B.tab === 'versions') body = `<div class="audit"><div class="au"><div class="au-t">исходная</div><div class="au-x"><b>Версия 0 — исходный базовый план</b><div class="faint" style="font-size:12px">из графика объекта</div></div></div>${vs.map(v => `<div class="au"><div class="au-t">${esc(v.date || '')}</div><div class="au-x"><b>Версия ${esc(v.version)}</b> · ${esc({ forecast: 'из рабочего прогноза', start: 'перенос начала проекта', import: 'импорт графика' }[v.kind] || v.kind || '')}${v.start ? ' · начало ' + fd(dn(v.start)) : ''}<div class="faint" style="font-size:12px">${Object.keys(v.tasks || {}).length} работ · ${esc(v.by || '')} · ${esc(v.reason || '')}</div></div></div>`).join('')}</div>
      <p class="faint" style="font-size:12px">Предыдущие версии не удаляются. Текущая версия — последняя.</p>`;
    else if (B.tab === 'forecast') { const ch = M.tasks.filter(t => !t.done && (t.es !== t.s0 || t.ef !== t.f0)); body = `<p class="muted" style="font-size:13px">Плановые сроки не завершённых работ станут равны рабочему прогнозу (CPM). Завершённые работы и подтверждённый факт не меняются.</p>
      <dl class="kv kvw"><dt>Изменятся</dt><dd>${ch.length} ${plural(ch.length, 'работа', 'работы', 'работ')}</dd><dt>Окончание по базовому плану</dt><dd>${fd(Math.max(...M.tasks.map(t => t.f0)))} → <b>${fd(M.root.forecastEnd)}</b></dd><dt>Директивный срок ввода</dt><dd>${fd(M.root.planEnd)} — не меняется</dd><dt>Новая версия</dt><dd>${bump(M)}</dd></dl>
      <div class="fld"><label for="bl-r">Основание (решение об утверждении) *</label><input id="bl-r" name="reason" required minlength="3"></div>`; }
    else if (B.tab === 'start') { const nd = B.start ? dn(B.start) : null, prev = nd != null ? shiftPreview(M, nd - start0) : null; body = `<p class="muted" style="font-size:13px">Новая дата начала проекта. Не начатые работы сдвигаются, сроки пересчитываются по связям (CPM) с учётом рабочего календаря. Начатые и завершённые работы и подтверждённый факт не меняются. Создаётся новая версия базового плана.</p>
      <div class="row-f"><div class="fld"><label>Текущее начало</label><input value="${fd(start0)}" disabled></div><div class="fld"><label for="bl-s">Новое начало *</label><input id="bl-s" name="start" type="date" required value="${esc(B.start || '')}" data-blstart="1"></div></div>
      ${prev ? `<dl class="kv kvw"><dt>Сдвиг</dt><dd>${nd - start0 > 0 ? '+' : ''}${nd - start0} дн.</dd><dt>Сдвигается работ</dt><dd>${Object.keys(prev.tasks).length}${prev.fixed ? ' · не меняются (начаты): ' + prev.fixed : ''}</dd><dt>Окончание по базовому плану</dt><dd>${fd(Math.max(...M.tasks.map(t => t.f0)))} → <b>${fd(prev.end)}</b></dd><dt>Директивный срок ввода</dt><dd>${fd(M.root.planEnd)} — не меняется</dd></dl>` : ''}
      <div class="fld"><label for="bl-r">Основание *</label><input id="bl-r" name="reason" required minlength="3"></div>`; }
    else body = importBody(M);
    const canSave = B.tab !== 'versions' && has('schedule.settings') && !(B.tab === 'import' && !B.imp);
    return `<form data-form="bl-save" class="mform"><div class="mh"><div><div class="eyebrow">${esc(M.P.name)} · график</div><h3 style="margin-top:4px">Базовый план</h3></div>${xBtn}</div>
      <div class="mb">${tabs}${body}<div class="err" hidden></div></div>
      <div class="mf">${canSave ? `<button class="btn primary" type="submit">${ico('check')}${B.tab === 'import' ? 'Загрузить работы' : 'Утвердить новую версию'}</button>` : ''}<button class="btn" type="button" data-act="x-close">Закрыть</button></div></form>`;
  }
  A['bl-tab'] = (el, d) => { UI.bl.tab = d.t; H.renderLayer(); };
  document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.blstart) { UI.bl.start = e.target.value; H.renderLayer(); } });
  /* перенос начала: сдвиг плановых дат не начатых работ на delta с пересчётом CPM по связям */
  function shiftPreview(M, delta) {
    const P = M.P, started = new Set(M.tasks.filter(t => t.as != null || t.done).map(t => t.id));
    const tasks = M.tasks.map(t => started.has(t.id) ? t : Object.assign({}, t, { s0: t.s0 + delta, f0: t.f0 + delta, snet: null, fnet: null, fcE: null }));
    const byId = new Map(tasks.map(t => [t.id, t]));
    let res;
    try { res = DSF.cpm.forward(tasks, byId, Math.min(H.T(), ...tasks.map(t => t.s0)), { cal: M.cal, finalId: M.finalTask && M.finalTask.id }); } catch (e) { res = null; }
    const out = { tasks: {}, fixed: started.size, end: null };
    tasks.forEach(t => {
      if (started.has(t.id)) return;
      const r = res && res.res && (res.res.get ? res.res.get(t.id) : res.res[t.id]);
      const es = r ? r.es : t.s0, ef = r ? r.ef : t.f0;
      out.tasks[t.id] = { ps: iso(es), pf: iso(ef) };
    });
    out.end = Math.max(...Object.values(out.tasks).map(x => dn(x.pf)), ...M.tasks.filter(t => started.has(t.id)).map(t => t.f0));
    return out;
  }
  U.PERM_F['bl-save'] = 'baseline';
  FM['bl-save'] = function (f, r) {
    const M = M0(), B = UI.bl, reason = String((f.elements.reason || {}).value || '').trim();
    if (B.tab === 'import') return importApply(M, r);
    if (reason.length < 3) return err('Укажите основание.');
    let entry;
    if (B.tab === 'forecast') {
      const tasks = {}; M.tasks.filter(t => !t.done).forEach(t => { tasks[t.id] = { ps: iso(t.es), pf: iso(t.ef) }; });
      entry = { id: uid('bl'), version: bump(M), kind: 'forecast', tasks, reason, by: me(), date: iso(H.T()) };
    } else {
      if (!B.start) return err('Укажите новую дату начала.');
      const start0 = Math.min(...M.tasks.map(t => t.s0)), p = shiftPreview(M, dn(B.start) - start0);
      entry = { id: uid('bl'), version: bump(M), kind: 'start', start: B.start, startBefore: iso(start0), tasks: p.tasks, reason, by: me(), date: iso(H.T()) };
    }
    DSF.store.update(r.pid, s => s.baselineOps.push(entry));
    closeModal(); keepPage(); toast('Утверждена версия ' + entry.version + ' базового плана. Предыдущие версии сохранены.');
  };

  /* ===================================================== импорт MS Project (XML / MSPDI) */
  const MSP_TYPE = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };
  function parseMSP(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Файл не является корректным XML.');
    const q = (el, n) => { const x = el.getElementsByTagName(n)[0]; return x ? x.textContent.trim() : ''; };
    const nodes = [...doc.getElementsByTagName('Task')];
    if (!nodes.length) throw new Error('В файле нет работ (элементов Task). Сохраните проект в MS Project как «XML-формат (*.xml)».');
    const stack = [], tasks = [];
    nodes.forEach(n => {
      const uidv = q(n, 'UID'), lvl = +q(n, 'OutlineLevel') || 1, name = q(n, 'Name');
      if (!name || uidv === '0') return;
      const summary = q(n, 'Summary') === '1';
      stack.length = lvl - 1;
      if (summary) { stack[lvl - 1] = name; return; }
      const preds = [...n.getElementsByTagName('PredecessorLink')].map(p => {
        const lagRaw = +q(p, 'LinkLag') || 0, fmt = +q(p, 'LagFormat') || 7;
        const lagDays = Math.round(lagRaw / 10 / 60 / ([3, 4].includes(fmt) ? 8 : 24) * ([3, 4].includes(fmt) ? 1 : 1));
        return { pred: 'msp' + q(p, 'PredecessorUID'), type: MSP_TYPE[+q(p, 'Type')] || 'FS', lag: fmt === 7 || fmt === 8 ? Math.round(lagRaw / 4800) : lagDays, source: 'import' };
      });
      tasks.push({ id: 'msp' + uidv, name, stage: stack.filter(Boolean).slice(-1)[0] || 'Импорт', ps: q(n, 'Start').slice(0, 10), pf: q(n, 'Finish').slice(0, 10), ms: q(n, 'Milestone') === '1', pct: +q(n, 'PercentComplete') || 0, deps: preds });
    });
    const ids = new Set(tasks.map(t => t.id));
    tasks.forEach(t => { t.deps = t.deps.filter(d => ids.has(d.pred)); });
    return tasks;
  }
  function importBody(M) {
    const B = UI.bl, I = B.imp;
    return `<p class="muted" style="font-size:13px">Загрузите график из MS Project в формате XML (Файл → Сохранить как → «XML-формат»). Сохраняются работы, этапы (суммарные задачи), вехи, даты, % выполнения и логические связи FS/SS/FF/SF с задержками. Формат .mpp напрямую не читается.</p>
      <div class="fld"><label for="msp-f">Файл XML</label><input id="msp-f" type="file" accept=".xml,application/xml,text/xml" data-mspfile="1"></div>
      ${B.impErr ? `<div class="err">${esc(B.impErr)}</div>` : ''}
      ${I ? `<dl class="kv kvw"><dt>Работ</dt><dd>${I.tasks.length} (вех: ${I.tasks.filter(t => t.ms).length})</dd><dt>Этапов</dt><dd>${new Set(I.tasks.map(t => t.stage)).size}</dd><dt>Связей</dt><dd>${I.links} · ${Object.entries(I.types).map(([k, v]) => k + ': ' + v).join(', ') || '—'}</dd>
        <dt>Связность</dt><dd>${{ ok: chip('полная', 'good'), partial: chip('неполная', 'warn'), none: chip('связей нет', 'warn'), error: chip('цикл', 'crit') }[I.check.state]}</dd></dl>
        ${I.check.state !== 'ok' ? `<div class="note warn">${esc(MISSING)}${I.check.openEnds.length ? ' Без последующих: ' + I.check.openEnds.length + '.' : ''}${I.check.openStarts.length ? ' Без предшествующих: ' + I.check.openStarts.length + '.' : ''}</div>` : ''}
        ${I.check.state === 'error' ? '<div class="err">Обнаружены циклические связи — импорт невозможен, исправьте график в MS Project.</div>' : ''}
        <div class="fld"><label for="bl-r">Основание *</label><input id="bl-r" name="reason" required minlength="3" value="Импорт графика из MS Project: ${esc(I.file)}"></div>` : ''}`;
  }
  document.addEventListener('change', e => {
    if (!e.target.dataset || !e.target.dataset.mspfile || !e.target.files.length) return;
    const file = e.target.files[0], rd = new FileReader();
    rd.onload = () => {
      try {
        const tasks = parseMSP(rd.result);
        const chk = DSF.cpm.check(tasks.map(t => Object.assign({}, t, { deps: t.deps.map(d => DSF.cpm.parseDep(d)) })), {});
        const types = {}; tasks.forEach(t => t.deps.forEach(d => { types[d.type] = (types[d.type] || 0) + 1; }));
        UI.bl.imp = { file: file.name, tasks, links: tasks.reduce((n, t) => n + t.deps.length, 0), types, check: chk }; UI.bl.impErr = null;
      } catch (er) { UI.bl.imp = null; UI.bl.impErr = er.message; }
      H.renderLayer();
    };
    rd.readAsText(file);
  });
  function importApply(M, r) {
    const I = UI.bl.imp, reason = (document.getElementById('bl-r') || {}).value || '';
    if (!I) return err('Выберите файл.');
    if (I.check.state === 'error') return err('Импорт невозможен: в графике циклические связи.');
    const exists = new Set(M.tasks.map(t => t.id));
    const fresh = I.tasks.filter(t => !exists.has(t.id));
    if (!fresh.length) return err('Все работы из файла уже загружены.');
    DSF.store.update(r.pid, s => fresh.forEach(t => s.taskOps.push({ id: uid('to'), task: t.id, op: 'add', layer: 'baseline', data: { name: t.name, stage: t.stage, ps: t.ps, pf: t.pf, ms: t.ms, pct: t.pct, deps: t.deps.map(d => ({ pred: d.pred, type: d.type, lag: d.lag, source: 'import' })) }, reason: reason.trim() || 'Импорт MS Project', by: me(), date: iso(H.T()) })));
    closeModal(); keepPage(); toast('Загружено работ: ' + fresh.length + '. Связи сохранены; сроки рассчитаны по CPM.' + (I.check.state !== 'ok' ? ' ' + MISSING : ''), 8000);
  }
  DSF.parseMSP = parseMSP;

  /* кнопки управления графиком в заголовке раздела */
  const baseSched = U.VIEWS.schedule;
  U.VIEWS.schedule = function (M, r) {
    const v = baseSched(M, r);
    if (!editable(M) || !M.tasks.length) return v;
    const btns = (has('schedule.settings') ? `<button class="btn" type="button" data-x="bl-open">${ico('layers')}Базовый план</button>` : '') + (M.network && M.network.state !== 'ok' ? '' : `<button class="btn" type="button" data-x="net-check">${ico('link')}Связи</button>`);
    v.html = v.html.replace('<div class="hd-r">', '<div class="hd-r">' + btns);
    if (demo) v.html = v.html.replace(/<button class="btn" type="button" data-go="[^"]*settings[^"]*">[\s\S]*?Изменить график<\/button>/, '');
    return v;
  };
})();
