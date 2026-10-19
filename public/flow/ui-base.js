/*
 * Flow — база подрядчиков (демо-контур; сервер: /api/demo/base).
 *
 * Модель: Объект → Вид работ → Подрядчик. Вид работ, подрядчик и договор — отдельные сущности:
 *   · один подрядчик может выполнять несколько видов работ на нескольких объектах;
 *   · один вид работ может выполняться несколькими подрядчиками (у каждого — своя зона ответственности);
 *   · договор для назначения не обязателен, привязывается позже в реестре договоров.
 * Форма нового подрядчика — по шагам: карточка организации → объекты → виды работ → проверка.
 * Список видов работ показывает только названия (без номеров договоров и исполнителей);
 * новый вид работ добавляется в структуру объекта без создания фиктивных работ графика
 * и без дублей (проверка на сервере). Исключение из вида работ не удаляет историю:
 * назначение помечается завершённым с датой. Смена подрядчика не меняет расчёт графика.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, chip, ico, toast, openModal, closeModal, keepPage, plural } = H;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const err = (f, m) => { const e = (f || document).querySelector('.modal .err'); if (e) { e.hidden = false; e.textContent = m; } };
  const has = c => DSF.auth.has(c);
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

  async function loadBase(force) {
    if (UI.baseCache && !force) return;
    try { const d = await DSF.api.get('/api/demo/base'); UI.baseCache = d.contractors; UI.baseProjects = d.projects; UI.baseErr = null; }
    catch (e) { UI.baseErr = e.detail || e.message; }
    if (['base', 'contractors'].includes(H.route().sec)) keepPage();
  }
  DSF.loadBase = loadBase;
  const prj = id => (UI.baseProjects || []).find(p => p.id === id) || { id, name: id, workTypes: [], contracts: [], tasks: [] };
  const wtName = (pid, id) => (prj(pid).workTypes.find(w => w.id === id) || {}).name || id;
  DSF.baseWorkTypes = (pid) => prj(pid).workTypes;
  DSF.baseOrgsOf = (pid) => (UI.baseCache || []).filter(c => !c.archived && (c.assignments || []).some(a => a.project === pid && (a.workTypes || []).some(w => w.active !== false)));

  const head = (right) => `<section class="head" style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:flex-end">
      <div style="flex:1 1 420px; min-width:0"><div class="eyebrow">Flow · администрирование</div><h1 style="margin-top:8px">База <span class="ac">подрядчиков</span></h1>
      <p class="muted" style="margin-top:8px; max-width:78ch">Подрядчики назначаются на объекты по видам работ: Объект → Вид работ → Подрядчик. Договор для назначения не обязателен — его регистрируют в реестре договоров. Учётные записи и пароли — в «Администрирование → Пользователи».</p></div>
      ${right ? `<div class="hd-r">${right}</div>` : ''}</section>`;

  U.VIEWS.base = function () {
    if (DSF.mode !== 'demo' || !has('base.view')) return { html: '<section class="panel" style="margin-top:12px"><div class="pad"><div class="empty">База подрядчиков недоступна для этой роли.</div></div></section>', title: 'База подрядчиков' };
    if (!UI.baseCache) { loadBase(); return { title: 'База подрядчиков', html: `${head()}<section class="panel"><div class="pad"><div class="empty">${UI.baseErr ? 'Не удалось загрузить: ' + esc(UI.baseErr) : 'Загрузка…'}</div></div></section>` }; }
    const f = UI.baseF || 'active', q = norm(UI.baseQ), fp = UI.basePF || '', fw = UI.baseWF || '';
    const list = UI.baseCache.filter(c => (f === 'archived' ? c.archived : !c.archived)
      && (!q || norm(c.name + ' ' + (c.login || '') + ' ' + (c.inn || '')).includes(q))
      && (!fp || (c.assignments || []).some(a => a.project === fp && (!fw || (a.workTypes || []).some(w => w.id === fw && w.active !== false)))));
    const wtOpts = fp ? prj(fp).workTypes : [];
    return { title: 'База подрядчиков', html: `${head(has('base.create') ? `<button class="btn primary" type="button" data-x="base-new">${ico('plus')}Добавить подрядчика</button>` : '')}
      <section class="panel"><header style="flex-wrap:wrap; gap:10px"><div class="seg"><button type="button" data-x="base-f" data-f="active" ${f === 'active' ? 'aria-pressed="true"' : ''}>Действующие · ${UI.baseCache.filter(c => !c.archived).length}</button><button type="button" data-x="base-f" data-f="archived" ${f === 'archived' ? 'aria-pressed="true"' : ''}>Архив · ${UI.baseCache.filter(c => c.archived).length}</button></div><span class="grow"></span>
        <input id="base-q" class="inp" type="search" placeholder="Поиск: название, ИНН, логин" value="${esc(UI.baseQ || '')}" style="max-width:260px"></header>
        <div class="pad"><div class="fchips" style="margin-bottom:12px; align-items:center">
          <select id="base-pf" class="inp" aria-label="Объект" style="max-width:240px"><option value="">Все объекты</option>${UI.baseProjects.map(p => `<option value="${esc(p.id)}" ${fp === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          ${fp ? `<select id="base-wf" class="inp" aria-label="Вид работ" style="max-width:280px"><option value="">Все виды работ</option>${wtOpts.map(w => `<option value="${esc(w.id)}" ${fw === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}
          <span class="faint" style="font-size:12.5px">${list.length} ${plural(list.length, 'организация', 'организации', 'организаций')}</span></div>
        <div class="ucards">${list.map(card).join('') || `<div class="empty">${f === 'archived' ? 'Архив пуст.' : 'Подрядчиков не найдено.'}</div>`}</div></div></section>` };
  };
  function card(c) {
    const asg = (c.assignments || []).filter(a => (a.workTypes || []).length);
    return `<div class="ucard ${c.archived ? 'off' : ''}">
      <div class="uc-h"><div style="min-width:0"><b>${esc(c.name)}</b><div class="faint" style="font-size:12px">${c.inn ? 'ИНН ' + esc(c.inn) : 'реквизиты не заполнены'} · <span class="cred" style="padding:1px 6px">${esc(c.login || '—')}</span></div></div>${c.archived ? chip('архив', 'neutral') : ''}</div>
      ${asg.length ? asg.map(a => `<div class="bwt"><div class="bwt-p">${ico('building', 14)} ${esc(prj(a.project).name)}</div>${a.workTypes.map(w => `<div class="bwt-w ${w.active === false ? 'gone' : ''}"><span>${esc(wtName(a.project, w.id))}</span>${w.zone ? `<span class="faint">зона: ${esc(w.zone)}</span>` : ''}${w.active === false ? `<span class="faint">исключён ${esc(w.until || '')}</span>` : ''}${(w.contracts || []).length ? `<span class="faint">${w.contracts.length} ${plural(w.contracts.length, 'договор', 'договора', 'договоров')}</span>` : ''}</div>`).join('')}</div>`).join('') : '<div class="uc-m faint">Объекты и виды работ не назначены.</div>'}
      <div class="uc-a">${has('base.edit') && !c.archived ? `<button class="btn sm" type="button" data-x="base-edit" data-id="${esc(c.id)}">${ico('edit')}Изменить</button>` : ''}
        <button class="btn sm" type="button" data-x="base-hist" data-id="${esc(c.id)}">${ico('clock')}История</button>
        ${has('base.delete') ? `<button class="btn sm" type="button" data-x="base-arch" data-id="${esc(c.id)}">${ico(c.archived ? 'restore' : 'archive')}${c.archived ? 'Восстановить' : 'В архив'}</button>` : ''}</div></div>`;
  }
  U.INPUTS['base-q'] = e => { UI.baseQ = e.target.value; const pos = e.target.selectionStart; keepPage(); const el = document.getElementById('base-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } };
  document.addEventListener('change', e => {
    if (e.target.id === 'base-pf') { UI.basePF = e.target.value; UI.baseWF = ''; keepPage(); }
    if (e.target.id === 'base-wf') { UI.baseWF = e.target.value; keepPage(); }
  });
  A['base-f'] = (el, d) => { UI.baseF = d.f; keepPage(); };
  A['base-hist'] = (el, d) => {
    const c = UI.baseCache.find(x => x.id === d.id);
    openModal(() => `<div class="mh"><div><div class="eyebrow">История изменений</div><h3 style="margin-top:4px">${esc(c.name)}</h3></div>${xBtn}</div>
      <div class="mb">${(c.history || []).length ? `<div class="audit">${c.history.slice().reverse().map(h => `<div class="au"><div class="au-t">${esc(h.at)}</div><div class="au-x">${esc(h.text)}<div class="faint" style="font-size:12px">${esc(h.by || '')}</div></div></div>`).join('')}</div>` : '<div class="empty">Записей нет.</div>'}</div>`, { global: true });
  };
  U.PERM_X['base-arch'] = 'base';
  A['base-arch'] = async (el, d) => {
    const c = UI.baseCache.find(x => x.id === d.id); if (!c) return;
    if (!c.archived && UI.baseArch !== c.id) { UI.baseArch = c.id; el.innerHTML = 'Подтвердить: в архив'; return; }
    UI.baseArch = null;
    try { await DSF.api.post('/api/demo/base/' + encodeURIComponent(c.id) + (c.archived ? '/restore' : '/archive')); await loadBase(true); toast(c.archived ? 'Подрядчик восстановлен.' : 'Подрядчик перенесён в архив — вход для него закрыт. История назначений сохранена.'); }
    catch (e) { toast(esc(e.detail || e.message)); }
  };

  /* ===================================================== форма по шагам */
  const STEPS = [['org', 'Организация'], ['objects', 'Объекты'], ['works', 'Виды работ'], ['check', 'Проверка']];
  A['base-new'] = () => { UI.bw = { step: 'org', c: { contacts: [], assignments: [] } }; openModal(wizard, { wide: true, global: true }); };
  U.PERM_X['base-edit'] = 'base';
  A['base-edit'] = (el, d) => { const c = JSON.parse(JSON.stringify(UI.baseCache.find(x => x.id === d.id))); UI.bw = { step: 'org', c }; openModal(wizard, { wide: true, global: true }); };
  const asgOf = (c, pid) => (c.assignments || []).find(a => a.project === pid);
  function wizard() {
    const w = UI.bw, c = w.c, si = STEPS.findIndex(s => s[0] === w.step);
    const steps = `<ol class="wsteps">${STEPS.map(([k, t], i) => `<li class="${i < si ? 'done' : i === si ? 'cur' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>`;
    let body = '';
    if (w.step === 'org') body = `
      <div class="fld"><label for="bw-n">Наименование организации *</label><input id="bw-n" data-bw="name" required value="${esc(c.name || '')}" autofocus></div>
      <div class="row-f3"><div class="fld"><label for="bw-inn">ИНН</label><input id="bw-inn" data-bw="inn" inputmode="numeric" maxlength="12" value="${esc(c.inn || '')}"></div><div class="fld"><label for="bw-kpp">КПП</label><input id="bw-kpp" data-bw="kpp" inputmode="numeric" maxlength="9" value="${esc(c.kpp || '')}"></div><div class="fld"><label for="bw-ogrn">ОГРН</label><input id="bw-ogrn" data-bw="ogrn" inputmode="numeric" maxlength="15" value="${esc(c.ogrn || '')}"></div></div>
      <div class="fld"><label for="bw-a">Юридический адрес</label><input id="bw-a" data-bw="address" value="${esc(c.address || '')}"></div>
      <div class="fld"><label for="bw-b">Банковские реквизиты</label><input id="bw-b" data-bw="bank" value="${esc(c.bank || '')}"></div>
      <div class="eyebrow" style="margin-top:4px">Контактное лицо</div>
      <div class="row-f"><div class="fld"><label for="bw-cn">ФИО</label><input id="bw-cn" data-bwc="name" value="${esc((c.contacts[0] || {}).name || '')}"></div><div class="fld"><label for="bw-cp">Должность</label><input id="bw-cp" data-bwc="position" value="${esc((c.contacts[0] || {}).position || '')}"></div></div>
      <div class="row-f"><div class="fld"><label for="bw-ct">Телефон</label><input id="bw-ct" data-bwc="phone" type="tel" value="${esc((c.contacts[0] || {}).phone || '')}"></div><div class="fld"><label for="bw-ce">E-mail</label><input id="bw-ce" data-bwc="email" type="email" value="${esc((c.contacts[0] || {}).email || '')}"></div></div>`;
    else if (w.step === 'objects') body = `<p class="muted" style="font-size:13px">Выберите объекты, на которых организация будет работать. Виды работ — на следующем шаге.</p>
      <div class="chk-list">${UI.baseProjects.map(p => `<label><input type="checkbox" data-bwp="${esc(p.id)}" ${asgOf(c, p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>`;
    else if (w.step === 'works') body = (c.assignments || []).map(a => { const p = prj(a.project), q = norm((w.q || {})[a.project]); const sel = a.workTypes || [];
      const opts = p.workTypes.filter(x => !q || norm(x.name).includes(q));
      return `<div class="bw-obj"><div class="bw-oh"><b>${esc(p.name)}</b><span class="faint">выбрано: ${sel.filter(x => x.active !== false).length}</span></div>
        <input class="inp" type="search" data-bwq="${esc(p.id)}" placeholder="Поиск вида работ" value="${esc((w.q || {})[a.project] || '')}" style="width:100%; margin:6px 0">
        <div class="wt-list">${opts.map(x => { const s = sel.find(y => y.id === x.id); const on = s && s.active !== false; return `<label class="wt ${on ? 'on' : ''}"><input type="checkbox" data-bwt="${esc(p.id)}" data-id="${esc(x.id)}" ${on ? 'checked' : ''}><span>${esc(x.name)}</span>${x.added ? '<small class="faint">добавлен</small>' : ''}</label>${on ? `<input class="inp wt-zone" data-bwz="${esc(p.id)}" data-id="${esc(x.id)}" placeholder="Зона ответственности (корпус, секция, этажи…)" value="${esc(s.zone || '')}">` : ''}`; }).join('') || '<div class="faint" style="font-size:12.5px">Ничего не найдено.</div>'}</div>
        ${has('base.edit') || has('schedule.edit') ? `<div class="wt-add"><input class="inp" data-bwn="${esc(p.id)}" placeholder="Новый вид работ для объекта" style="flex:1"><button class="btn sm" type="button" data-x="bw-addwt" data-pid="${esc(p.id)}">${ico('plus')}Добавить</button></div>` : ''}</div>`; }).join('') || '<div class="empty">Сначала выберите объекты.</div>';
    else body = `<dl class="kv kvw"><dt>Организация</dt><dd><b>${esc(c.name)}</b>${c.inn ? ' · ИНН ' + esc(c.inn) : ''}</dd><dt>Контакт</dt><dd>${esc([(c.contacts[0] || {}).name, (c.contacts[0] || {}).phone, (c.contacts[0] || {}).email].filter(Boolean).join(', ') || '—')}</dd></dl>
      <div class="eyebrow" style="margin-top:6px">Объект → Вид работ → Подрядчик</div>
      ${(c.assignments || []).map(a => `<div class="bwt"><div class="bwt-p">${ico('building', 14)} ${esc(prj(a.project).name)}</div>${(a.workTypes || []).filter(x => x.active !== false).map(x => `<div class="bwt-w"><span>${esc(wtName(a.project, x.id))}</span><span class="faint">→ ${esc(c.name)}${x.zone ? ' · зона: ' + esc(x.zone) : ''}</span></div>`).join('') || '<div class="faint" style="font-size:12.5px">виды работ не выбраны</div>'}</div>`).join('') || '<div class="faint">Объекты не выбраны — организация будет добавлена в базу без назначений.</div>'}
      <div class="note" style="margin-top:8px">Договор не обязателен. Расчёт графика не меняется. ${c.id ? 'Снятые виды работ сохранятся в истории как завершённые.' : 'После сохранения будет создана учётная запись подрядчика; пароль покажем один раз.'}</div>`;
    return `<div class="mh"><div><div class="eyebrow">База подрядчиков</div><h3 style="margin-top:4px">${c.id ? esc(c.name) : 'Новый подрядчик'}</h3></div>${xBtn}</div>
      <div class="mb">${steps}${body}<div class="err" hidden></div></div>
      <div class="mf">${si > 0 ? `<button class="btn" type="button" data-x="bw-step" data-d="-1">${ico('left')}Назад</button>` : ''}<span class="grow" style="flex:1"></span>
        ${si < STEPS.length - 1 ? `<button class="btn primary" type="button" data-x="bw-step" data-d="1">Далее ${ico('chev')}</button>` : `<button class="btn primary" type="button" data-x="bw-save">${ico('check')}Сохранить</button>`}</div>`;
  }
  /* поля шага сохраняются в черновике при вводе */
  document.addEventListener('input', e => {
    const el = e.target, w = UI.bw; if (!w || !el.dataset) return;
    if (el.dataset.bw) w.c[el.dataset.bw] = el.value;
    if (el.dataset.bwc) { w.c.contacts[0] = Object.assign({}, w.c.contacts[0], { [el.dataset.bwc]: el.value }); }
    if (el.dataset.bwz) { const a = asgOf(w.c, el.dataset.bwz), x = a && a.workTypes.find(y => y.id === el.dataset.id); if (x) x.zone = el.value; }
    if (el.dataset.bwq != null && el.dataset.bwq) { w.q = Object.assign({}, w.q, { [el.dataset.bwq]: el.value }); const pos = el.selectionStart; H.renderLayer(); const n = document.querySelector(`[data-bwq="${el.dataset.bwq}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  document.addEventListener('change', e => {
    const el = e.target, w = UI.bw; if (!w || !el.dataset) return;
    if (el.dataset.bwp) {
      const pid = el.dataset.bwp;
      if (el.checked && !asgOf(w.c, pid)) w.c.assignments.push({ project: pid, workTypes: [] });
      if (!el.checked) { const a = asgOf(w.c, pid); if (a && !a.workTypes.some(x => x.since && w.c.id)) w.c.assignments = w.c.assignments.filter(x => x !== a); else if (a) a.workTypes.forEach(x => { x.active = false; }); }
    }
    if (el.dataset.bwt) {
      const a = asgOf(w.c, el.dataset.bwt), id = el.dataset.id; let x = a.workTypes.find(y => y.id === id);
      if (el.checked) { if (x) x.active = true; else a.workTypes.push({ id, zone: '', tasks: [], contracts: [], active: true }); }
      else if (x) { if (w.c.id && x.since) x.active = false; else a.workTypes = a.workTypes.filter(y => y !== x); }
      H.renderLayer();
    }
  });
  A['bw-step'] = (el, d) => {
    const w = UI.bw, si = STEPS.findIndex(s => s[0] === w.step) + +d.d;
    if (+d.d > 0 && w.step === 'org') {
      if (String(w.c.name || '').trim().length < 2) return err(null, 'Укажите наименование организации.');
      if (w.c.inn && !/^\d{10}(\d{2})?$/.test(w.c.inn)) return err(null, 'ИНН — 10 или 12 цифр.');
      const dup = UI.baseCache.find(x => x.id !== w.c.id && norm(x.name) === norm(w.c.name));
      if (dup) return err(null, 'Организация с таким названием уже есть в базе' + (dup.archived ? ' (в архиве)' : '') + '.');
    }
    if (+d.d > 0 && w.step === 'works') {
      const empty = w.c.assignments.filter(a => !a.workTypes.some(x => x.active !== false));
      if (empty.length) return err(null, 'Выберите хотя бы один вид работ для объекта «' + prj(empty[0].project).name + '» или снимите объект на предыдущем шаге.');
    }
    w.step = STEPS[Math.max(0, Math.min(STEPS.length - 1, si))][0];
    H.renderLayer();
  };
  A['bw-addwt'] = async (el, d) => {
    const inp = document.querySelector(`[data-bwn="${d.pid}"]`), name = (inp && inp.value || '').trim();
    if (name.length < 3) return err(null, 'Название вида работ — не короче 3 символов.');
    const ex = prj(d.pid).workTypes.find(x => norm(x.name) === norm(name));
    if (ex) { const a = asgOf(UI.bw.c, d.pid); if (!a.workTypes.some(y => y.id === ex.id)) a.workTypes.push({ id: ex.id, zone: '', tasks: [], contracts: [], active: true }); H.renderLayer(); return toast('Такой вид работ уже есть — выбран существующий.'); }
    const entry = { id: 'wt-' + Date.now().toString(36), name, by: DSF.auth.user().login, date: H.T ? DSF.util.iso(H.T()) : null };
    try {
      await DSF.api.post('/api/demo/journal/' + encodeURIComponent(d.pid), { appends: [{ kind: 'workTypes', entry }] });
      prj(d.pid).workTypes.push({ id: entry.id, name, added: true });
      asgOf(UI.bw.c, d.pid).workTypes.push({ id: entry.id, zone: '', tasks: [], contracts: [], active: true });
      if (DSF.projects.some(p => p.id === d.pid)) DSF.reloadJournal(d.pid);
      H.renderLayer(); toast('Вид работ «' + esc(name) + '» добавлен в структуру объекта. Работы графика не создавались.');
    } catch (e) { err(null, e.detail || e.message); }
  };
  U.PERM_X['bw-save'] = 'base';
  A['bw-save'] = async () => {
    const c = UI.bw.c;
    const body = { name: String(c.name || '').trim(), inn: c.inn || '', kpp: c.kpp || '', ogrn: c.ogrn || '', address: c.address || '', bank: c.bank || '', extra: c.extra || '',
      contacts: (c.contacts || []).filter(x => x && (x.name || x.phone || x.email)), assignments: c.assignments };
    try {
      const res = c.id ? await DSF.api.put('/api/demo/base/' + encodeURIComponent(c.id), body) : await DSF.api.post('/api/demo/base', body);
      await loadBase(true);
      if (c.id) { closeModal(); toast('Изменения сохранены. История назначений обновлена.'); return; }
      UI.bw = null;
      openModal(() => `<div class="mh"><div><div class="eyebrow">Подрядчик добавлен</div><h3 style="margin-top:4px">${esc(res.contractor.name)}</h3></div>${xBtn}</div>
        <div class="mb"><p>Учётная запись: <span class="cred">${esc(res.login)}</span></p><p>Начальный пароль: <span class="cred">${esc(res.password)}</span></p>
        <p class="faint" style="font-size:12.5px">Пароль показывается один раз и больше нигде не отображается. Передайте его по защищённому каналу; сменить пароль можно в «Администрирование → Пользователи».</p></div>
        <div class="mf"><button class="btn primary" type="button" data-act="x-close">Готово</button></div>`, { global: true });
    } catch (e) { err(null, e.detail || e.message); }
  };
})();
