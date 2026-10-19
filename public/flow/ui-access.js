/*
 * Flow — администрирование доступа (демо-контур; права проверяет сервер, api/app/demo.py):
 *   Объекты · Пользователи · Роли · Матрица прав · Доступ к объектам · История изменений.
 *
 *  · роль = набор ячеек «раздел.действие»; системные роли нельзя удалить, роль «Администратор» — изменить;
 *  · пользователю можно добавить индивидуальное разрешение или запрет поверх роли — интерфейс
 *    показывает источник каждого права (роль / индивидуально);
 *  · доступ к объектам: по роли (все или назначенные) или явный список; подрядчик — по назначениям;
 *  · пароль: администратор задаёт новый (дважды), текущий пароль не виден никому; прежние сессии
 *    пользователя завершаются; пароли администраторов — отдельное полномочие;
 *  · каждое изменение пишется в журнал безопасности (без паролей).
 * Свой пароль любой пользователь меняет сам, указав текущий («Сменить пароль» в меню профиля).
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, chip, ico, toast, openModal, closeModal, keepPage } = H;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const err = (f, m) => { const e = f.querySelector('.err'); if (e) { e.hidden = false; e.textContent = m; } };
  const has = c => DSF.auth.has(c);
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const SHORT = { view: 'Просм.', create: 'Созд.', edit: 'Ред.', delete: 'Удал.', upload: 'Загр.', check: 'Пров.', agree: 'Согл.', approve: 'Утв.', export: 'Эксп.', settings: 'Настр.', roles: 'Роли', passwords: 'Пароли', passwordsAdmin: 'Пароли адм.' };
  const KIND = { staff: 'Сотрудник', contractor: 'Подрядчик', investor: 'Инвестор / зритель' };

  /* ---------- данные ---------- */
  async function load(force) {
    if (UI.adm && !force) return UI.adm;
    try { UI.adm = await DSF.api.get('/api/demo/admin/meta'); UI.admErr = null; }
    catch (e) { UI.admErr = e.detail || e.message; }
    if (H.route().sec === 'admin') keepPage();
    return UI.adm;
  }
  const cat = () => (UI.adm && UI.adm.catalog) || (DSF.session && DSF.session.catalog) || { sections: [], actions: {} };
  const roleOf = id => ((UI.adm && UI.adm.roles) || []).find(r => r.id === id);
  const pname = id => (((UI.adm && UI.adm.projects) || []).find(p => p.id === id) || {}).name || id;
  const cellTitle = c => { const [s, a] = c.split('.'); const S = cat().sections.find(x => x.k === s); return (S ? S.t : s) + ': ' + ((cat().actions || {})[a] || a); };

  /* ---------- оболочка раздела ---------- */
  const TABS = [['objects', 'Объекты', 'admin.view'], ['users', 'Пользователи', 'admin.view'], ['roles', 'Роли', 'admin.view'], ['matrix', 'Матрица прав', 'admin.view'],
    ['access', 'Доступ к объектам', 'admin.view'], ['history', 'История изменений', 'admin.view']];
  const baseAdmin = U.VIEWS.admin;
  U.VIEWS.admin = function (M, r) {
    if (DSF.mode !== 'demo') return baseAdmin(M, r);
    if (!has('admin.view')) return { html: `<section class="panel" style="margin-top:12px"><div class="pad"><div class="empty">Раздел доступен администратору системы.</div></div></section>`, title: 'Администрирование' };
    const tab = TABS.some(t => t[0] === r.sub) ? r.sub : 'users';
    const nav = `<nav class="adm-tabs" aria-label="Разделы администрирования">${TABS.map(([k, t]) => `<button class="seg-b" type="button" data-go="admin.${k}" ${k === tab ? 'aria-current="page"' : ''}>${t}</button>`).join('')}</nav>`;
    const headHtml = `<section class="head"><div class="eyebrow">Flow · демо-режим</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Администри<span class="ac">рование</span></h1>
      <div class="muted" style="margin-top:6px; font-size:13px">Пользователи, роли и матрица прав, доступ к объектам, пароли и журнал изменений. Права проверяются сервером при каждом действии.</div></section>${nav}`;
    if (tab === 'objects') { const v = baseAdmin(M, r); return { title: 'Администрирование', html: headHtml + v.html.replace(/^[\s\S]*?<\/section>/, '') }; }
    if (!UI.adm) { load(); return { title: 'Администрирование', html: headHtml + `<section class="panel"><div class="pad"><div class="empty">${UI.admErr ? 'Не удалось загрузить: ' + esc(UI.admErr) : 'Загрузка…'}</div></div></section>` }; }
    const body = { users: viewUsers, roles: viewRoles, matrix: viewMatrix, access: viewAccess, history: viewHistory }[tab]();
    return { title: 'Администрирование', html: headHtml + body };
  };

  /* ---------- пользователи ---------- */
  function accessText(u) {
    if (u.kind === 'contractor') return 'по назначениям подрядчика';
    if (u.projects == null) { const r = roleOf(u.role) || {}; return r.scope === 'all' ? 'все объекты (по роли)' : 'нет назначенных объектов'; }
    return u.projects.length ? u.projects.map(pname).join(', ') : 'объекты не назначены';
  }
  function viewUsers() {
    const q = (UI.admQ || '').toLowerCase(), f = UI.admF || 'all';
    const list = UI.adm.users.filter(u => (f === 'all' || (f === 'off' ? !u.active : u.active && u.kind === f)) && (!q || (u.login + ' ' + u.name + ' ' + u.roleTitle).toLowerCase().includes(q)));
    const pw = has('admin.passwords');
    return `<section class="panel"><header style="flex-wrap:wrap; gap:10px"><h2>Пользователи</h2><span class="sub">${UI.adm.users.length}</span><span class="grow"></span>
        <input id="adm-q" class="inp" type="search" placeholder="Поиск: логин, имя, роль" value="${esc(UI.admQ || '')}" style="max-width:260px">
        ${has('admin.edit') ? `<button class="btn primary" type="button" data-x="adm-user" data-id="">${ico('plus')}Пользователь</button>` : ''}</header>
      <div class="pad"><div class="fchips" style="margin-bottom:10px">${[['all', 'Все'], ['staff', 'Сотрудники'], ['contractor', 'Подрядчики'], ['investor', 'Инвесторы'], ['off', 'Отключённые']].map(([k, t]) => `<button class="fchip" type="button" data-x="adm-f" data-f="${k}" ${f === k ? 'aria-pressed="true"' : ''}>${t}</button>`).join('')}</div>
      <div class="ucards">${list.map(u => `<div class="ucard ${u.active ? '' : 'off'}">
          <div class="uc-h"><div style="min-width:0"><b>${esc(u.name)}</b><div class="faint" style="font-size:12px"><span class="cred" style="padding:2px 6px">${esc(u.login)}</span>${u.superadmin ? ' · суперадминистратор' : ''}</div></div>${u.active ? chip(esc(u.roleTitle), u.kind === 'contractor' ? 'neutral' : 'accent') : chip('отключена', 'neutral')}</div>
          <div class="uc-m"><span class="faint">Объекты:</span> ${esc(accessText(u))}</div>
          ${(u.grants || []).length || (u.denies || []).length ? `<div class="uc-m">${(u.grants || []).length ? `<span class="chip good">+${u.grants.length} индивид.</span> ` : ''}${(u.denies || []).length ? `<span class="chip crit">−${u.denies.length} запрет</span>` : ''}</div>` : ''}
          <div class="uc-a">${has('admin.edit') ? `<button class="btn sm" type="button" data-x="adm-user" data-id="${esc(u.id)}">${ico('edit')}Изменить</button><button class="btn sm" type="button" data-x="adm-rights" data-id="${esc(u.id)}">${ico('shield')}Права</button>` : ''}
            ${pw && !(u.superadmin && !UI.adm.superadmin) ? `<button class="btn sm" type="button" data-x="adm-pw" data-id="${esc(u.id)}">${ico('lock')}Изменить пароль</button>` : ''}</div></div>`).join('') || '<div class="empty">Пользователей не найдено.</div>'}</div></div></section>`;
  }
  U.INPUTS['adm-q'] = e => { UI.admQ = e.target.value; const pos = e.target.selectionStart; keepPage(); const el = document.getElementById('adm-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } };
  A['adm-f'] = (el, d) => { UI.admF = d.f; keepPage(); };
  U.PERM_X['adm-user'] = 'admin';
  A['adm-user'] = (el, d) => { UI.admEdit = d.id ? JSON.parse(JSON.stringify(UI.adm.users.find(u => u.id === d.id))) : { active: true, projects: null }; openModal(userForm, { global: true }); };
  function userForm() {
    const u = UI.admEdit, isNew = !u.id, roles = UI.adm.roles;
    const r = roleOf(u.role) || {};
    const mode = u.projects == null ? 'role' : 'list';
    const lastAdmin = u.id && UI.adm.users.filter(x => x.active && (x.superadmin || (x.perms || []).includes('admin.roles'))).length <= 1 && (u.perms || []).includes('admin.roles');
    return `<form data-form="adm-user" class="mform"><div class="mh"><div><div class="eyebrow">Администрирование · пользователь</div><h3 style="margin-top:4px">${isNew ? 'Новый пользователь' : esc(u.name)}</h3></div>${xBtn}</div>
      <div class="mb">
        <div class="row-f"><div class="fld"><label for="au-l">Логин</label><input id="au-l" name="login" ${isNew ? 'required pattern="[a-z0-9._-]{3,40}" autocapitalize="off"' : 'disabled'} value="${esc(u.login || '')}"></div>
          <div class="fld"><label for="au-n">Имя / должность</label><input id="au-n" name="name" required value="${esc(u.name || '')}"></div></div>
        <div class="fld"><label for="au-r">Роль</label><select id="au-r" name="role" required ${u.superadmin ? 'disabled' : ''}>${isNew ? opt('', 'Выберите роль', true) : ''}${roles.filter(x => x.kind !== 'contractor' || u.contractorId).map(x => opt(x.id, x.title + (x.system ? '' : ' · своя роль'), x.id === u.role)).join('')}</select>
          <div class="faint" style="font-size:12px; margin-top:4px">Смена роли меняет набор прав пользователя. Остальные настройки учётной записи сохраняются.</div></div>
        ${u.kind === 'contractor' ? '<div class="note">Объекты подрядчика задаются назначениями в «Базе подрядчиков».</div>' : `<div class="fld"><label>Доступ к объектам</label>
          <div class="seg" style="margin-bottom:6px"><label class="seg-b"><input type="radio" name="pmode" value="role" ${mode === 'role' ? 'checked' : ''}> По роли${r.scope ? ' (' + (r.scope === 'all' ? 'все' : 'назначенные') + ')' : ''}</label><label class="seg-b"><input type="radio" name="pmode" value="list" ${mode === 'list' ? 'checked' : ''}> Выбранные объекты</label></div>
          <div class="chk-list">${UI.adm.projects.map(p => `<label><input type="checkbox" name="p_${esc(p.id)}" ${(u.projects || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div></div>`}
        ${isNew ? `<div class="row-f"><div class="fld"><label for="au-p">Пароль</label><input id="au-p" name="password" type="password" autocomplete="new-password" minlength="4" required></div><div class="fld"><label for="au-p2">Подтверждение</label><input id="au-p2" name="password2" type="password" autocomplete="new-password" minlength="4" required></div></div>` : ''}
        ${!isNew && !u.superadmin ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${lastAdmin ? 'disabled' : ''}> Учётная запись активна${lastAdmin ? ' <span class="faint">(последний администратор — отключить нельзя)</span>' : ''}</label>` : ''}
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.PERM_F['adm-user'] = 'admin';
  FM['adm-user'] = async function (f) {
    const u = UI.admEdit, fd = new FormData(f);
    const body = { name: String(fd.get('name') || '').trim() };
    if (!u.superadmin) body.role = fd.get('role') || u.role;
    if (u.kind !== 'contractor') {
      if (fd.get('pmode') === 'list') body.projects = UI.adm.projects.filter(p => fd.get('p_' + p.id)).map(p => p.id);
      else body.projectsMode = 'role';
    }
    if (u.id && !u.superadmin && f.elements.active && !f.elements.active.disabled) body.active = !!fd.get('active');
    if (!body.role) return err(f, 'Выберите роль.');
    try {
      if (!u.id) {
        body.login = String(fd.get('login') || '').trim().toLowerCase();
        if (fd.get('password') !== fd.get('password2')) return err(f, 'Пароль и подтверждение не совпадают.');
        body.password = fd.get('password');
        await DSF.api.post('/api/demo/admin/users', body);
        toast('Пользователь <b>' + esc(body.login) + '</b> создан. Передайте ему пароль по защищённому каналу.');
      } else {
        await DSF.api.put('/api/demo/admin/users/' + encodeURIComponent(u.id), body);
        toast('Изменения сохранены.');
      }
      closeModal(); await load(true);
    } catch (e) { err(f, e.detail || e.message); }
  };

  /* индивидуальные права: поверх роли, с указанием источника */
  U.PERM_X['adm-rights'] = 'admin';
  A['adm-rights'] = (el, d) => { UI.admEdit = JSON.parse(JSON.stringify(UI.adm.users.find(u => u.id === d.id))); openModal(rightsForm, { global: true, wide: true }); };
  function rightsForm() {
    const u = UI.admEdit, r = roleOf(u.role) || { perms: [] }, rp = new Set(r.perms), g = new Set(u.grants || []), dn = new Set(u.denies || []);
    const canEdit = has('admin.roles');
    return `<form data-form="adm-rights" class="mform"><div class="mh"><div><div class="eyebrow">Индивидуальные права · ${esc(u.login)}</div><h3 style="margin-top:4px">${esc(u.name)}</h3></div>${xBtn}</div>
      <div class="mb"><p class="muted" style="font-size:13px">Роль «${esc(r.title || u.role)}». Для каждого права указан источник: <span class="src-r">роль</span>, <span class="src-g">разрешено индивидуально</span>, <span class="src-d">запрещено индивидуально</span>. Индивидуальная настройка действует поверх роли.${canEdit ? '' : ' Изменять права может пользователь с полномочием «Роли и матрица прав».'}</p>
      ${cat().sections.map(S => `<div class="rsec"><div class="rsec-h">${esc(S.t)}</div><div class="rsec-b">${Object.keys(S.a).map(a => {
        const c = S.k + '.' + a, cur = g.has(c) ? 'grant' : dn.has(c) ? 'deny' : 'role', eff = cur === 'grant' || (cur === 'role' && rp.has(c));
        return `<label class="rcell ${eff ? 'on' : ''} ${cur !== 'role' ? 'ind' : ''}" title="${esc(S.a[a])}"><span><b>${esc(cat().actions[a] || a)}</b><span class="faint">${esc(S.a[a])}</span></span>
          <select name="c_${esc(c)}" ${canEdit ? '' : 'disabled'}>${opt('role', rp.has(c) ? 'По роли: есть' : 'По роли: нет', cur === 'role')}${opt('grant', 'Разрешить индивидуально', cur === 'grant')}${opt('deny', 'Запретить индивидуально', cur === 'deny')}</select></label>`;
      }).join('')}</div></div>`).join('')}
      <div class="err" hidden></div></div>
      <div class="mf">${canEdit ? `<button class="btn primary" type="submit">${ico('check')}Сохранить права</button>` : ''}<button class="btn" type="button" data-act="x-close">Закрыть</button></div></form>`;
  }
  FM['adm-rights'] = async function (f) {
    const u = UI.admEdit, fd = new FormData(f), grants = [], denies = [];
    for (const [k, v] of fd.entries()) { if (!k.startsWith('c_')) continue; const c = k.slice(2); if (v === 'grant') grants.push(c); if (v === 'deny') denies.push(c); }
    try { await DSF.api.put('/api/demo/admin/users/' + encodeURIComponent(u.id), { grants, denies }); closeModal(); await load(true); toast('Индивидуальные права сохранены.'); }
    catch (e) { err(f, e.detail || e.message); }
  };

  /* смена пароля администратором: новый пароль дважды; текущий не показывается и не нужен */
  U.PERM_X['adm-pw'] = 'admin';
  A['adm-pw'] = (el, d) => {
    const u = UI.adm.users.find(x => x.id === d.id);
    UI.admPw = u;
    openModal(() => `<form data-form="adm-pw" class="mform"><div class="mh"><div><div class="eyebrow">Изменить пароль</div><h3 style="margin-top:4px">${esc(u.name)} · ${esc(u.login)}</h3></div>${xBtn}</div>
      <div class="mb"><p class="muted" style="font-size:13px">Задайте новый пароль. Текущий пароль не отображается. После смены все активные сессии пользователя завершатся; остальные данные учётной записи не меняются.</p>
        <div class="fld"><label for="ap-1">Новый пароль</label><input id="ap-1" name="p1" type="password" autocomplete="new-password" minlength="4" required autofocus></div>
        <div class="fld"><label for="ap-2">Подтверждение пароля</label><input id="ap-2" name="p2" type="password" autocomplete="new-password" minlength="4" required></div>
        <label class="chk"><input type="checkbox" data-pwshow="1"> Показать вводимые символы</label>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить пароль</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`, { global: true });
  };
  U.PERM_F['adm-pw'] = 'admin';
  FM['adm-pw'] = async function (f) {
    const p1 = f.elements.p1.value, p2 = f.elements.p2.value;
    if (p1 !== p2) return err(f, 'Пароль и подтверждение не совпадают.');
    try {
      await DSF.api.post('/api/demo/admin/users/' + encodeURIComponent(UI.admPw.id) + '/password', { password: p1, confirm: p2 });
      closeModal(); await load(true);
      toast('Пароль пользователя <b>' + esc(UI.admPw.login) + '</b> изменён. Его прежние сессии завершены.');
      if (UI.admPw.id === DSF.auth.user().id) setTimeout(() => DSF.logout(), 1200);
    } catch (e) { err(f, e.detail || e.message); }
  };

  /* ---------- роли ---------- */
  function viewRoles() {
    const n = id => UI.adm.users.filter(u => u.role === id).length;
    return `<section class="panel"><header><h2>Роли</h2><span class="sub">${UI.adm.roles.length}</span><span class="grow"></span>${has('admin.roles') ? `<button class="btn primary" type="button" data-x="adm-role" data-id="">${ico('plus')}Новая роль</button>` : ''}</header>
      <div class="pad"><div class="ucards">${UI.adm.roles.map(r => `<div class="ucard">
        <div class="uc-h"><div style="min-width:0"><b>${esc(r.title)}</b><div class="faint" style="font-size:12px">${esc(KIND[r.kind] || r.kind)} · ${r.scope === 'all' ? 'все объекты' : 'назначенные объекты'}${r.step ? ' · ступень согласования: ' + (r.step === 'tz' ? 'техзаказчик' : 'директор') : ''}</div></div>${r.system ? chip('системная', 'neutral') : chip('своя', 'accent')}</div>
        <div class="uc-m">${r.perms.length} ${H.plural(r.perms.length, 'право', 'права', 'прав')} · ${n(r.id)} ${H.plural(n(r.id), 'пользователь', 'пользователя', 'пользователей')}</div>
        <div class="uc-a"><button class="btn sm" type="button" data-x="adm-mrole" data-id="${esc(r.id)}">${ico('grid')}Права</button>
          ${has('admin.roles') ? `${r.id !== 'admin' ? `<button class="btn sm" type="button" data-x="adm-role" data-id="${esc(r.id)}">${ico('edit')}Изменить</button>` : ''}<button class="btn sm" type="button" data-x="adm-role" data-copy="${esc(r.id)}">${ico('plus')}Копировать</button>${!r.system ? `<button class="btn sm" type="button" data-x="adm-rdel" data-id="${esc(r.id)}">${ico('trash')}Удалить</button>` : ''}` : ''}</div></div>`).join('')}</div>
      <div class="note" style="margin-top:12px">Системные роли нельзя удалить; права роли «Администратор» защищены. Роль, назначенную пользователям, удалить нельзя — сначала смените им роль. Изменение прав роли применяется ко всем её пользователям при следующем действии.</div></div></section>`;
  }
  U.PERM_X['adm-role'] = 'admin';
  A['adm-role'] = (el, d) => {
    const src = d.copy ? roleOf(d.copy) : d.id ? roleOf(d.id) : null;
    UI.admRole = d.id ? JSON.parse(JSON.stringify(src)) : { title: src ? src.title + ' (копия)' : '', kind: src ? src.kind : 'staff', scope: src ? src.scope : 'assigned', copyFrom: d.copy || null, perms: src ? src.perms.slice() : [] };
    openModal(() => { const r = UI.admRole; return `<form data-form="adm-role" class="mform"><div class="mh"><div><div class="eyebrow">Роль</div><h3 style="margin-top:4px">${r.id ? 'Изменить роль' : r.copyFrom ? 'Копия роли' : 'Новая роль'}</h3></div>${xBtn}</div>
      <div class="mb"><div class="fld"><label for="ar-t">Название</label><input id="ar-t" name="title" required minlength="2" value="${esc(r.title || '')}" autofocus></div>
        <div class="row-f"><div class="fld"><label for="ar-k">Вид интерфейса</label><select id="ar-k" name="kind" ${r.system ? 'disabled' : ''}>${Object.entries(KIND).map(([k, t]) => opt(k, t, r.kind === k)).join('')}</select></div>
          <div class="fld"><label for="ar-s">Объекты по умолчанию</label><select id="ar-s" name="scope">${opt('all', 'Все объекты', r.scope === 'all')}${opt('assigned', 'Только назначенные', r.scope !== 'all')}</select></div></div>
        <p class="faint" style="font-size:12px">${r.id ? 'Права роли настраиваются в «Матрице прав».' : 'Права ' + (r.copyFrom ? 'копируются из исходной роли' : 'задаются') + ' в «Матрице прав» после создания.'}</p>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`; }, { global: true });
  };
  U.PERM_F['adm-role'] = 'admin';
  FM['adm-role'] = async function (f) {
    const r = UI.admRole, body = { title: f.elements.title.value.trim(), kind: f.elements.kind.value, scope: f.elements.scope.value, perms: r.perms, copyFrom: r.copyFrom || null };
    try {
      const res = r.id ? await DSF.api.put('/api/demo/admin/roles/' + encodeURIComponent(r.id), body) : await DSF.api.post('/api/demo/admin/roles', body);
      closeModal(); await load(true); toast(r.id ? 'Роль сохранена.' : 'Роль «' + esc(res.role.title) + '» создана.');
      if (!r.id) { UI.admMRole = res.role.id; H.go('admin.matrix'); }
    } catch (e) { err(f, e.detail || e.message); }
  };
  U.PERM_X['adm-rdel'] = 'admin';
  A['adm-rdel'] = async (el, d) => {
    if (UI.admDel !== d.id) { UI.admDel = d.id; el.innerHTML = 'Подтвердить удаление'; return; }
    UI.admDel = null;
    try { await DSF.api.del('/api/demo/admin/roles/' + encodeURIComponent(d.id)); await load(true); toast('Роль удалена.'); } catch (e) { toast(esc(e.detail || e.message)); }
  };

  /* ---------- матрица прав ---------- */
  A['adm-mrole'] = (el, d) => { UI.admMRole = d.id; UI.admMDraft = null; H.go('admin.matrix'); };
  function viewMatrix() {
    const roles = UI.adm.roles, rid = roleOf(UI.admMRole) ? UI.admMRole : roles[0].id, r = roleOf(rid);
    if (!UI.admMDraft || UI.admMDraft.rid !== rid) UI.admMDraft = { rid, perms: new Set(r.perms) };
    const dr = UI.admMDraft.perms, locked = rid === 'admin' || !has('admin.roles');
    const added = [...dr].filter(c => !r.perms.includes(c)), removed = r.perms.filter(c => !dr.has(c));
    const acts = Object.keys(cat().actions);
    return `<section class="panel"><header style="flex-wrap:wrap; gap:10px"><h2>Матрица прав</h2><span class="grow"></span>
        <select id="adm-mrole" class="inp" style="max-width:320px" aria-label="Роль">${roles.map(x => opt(x.id, x.title, x.id === rid)).join('')}</select></header>
      <div class="pad">${locked ? `<div class="note" style="margin-bottom:10px">${rid === 'admin' ? 'Права роли «Администратор» защищены от изменения.' : 'Просмотр. Изменять матрицу может пользователь с полномочием «Роли и матрица прав».'}</div>` : ''}
        <div class="tbl-wrap mx-desk"><table class="t pmx"><thead><tr><th class="l">Раздел</th>${acts.map(a => `<th title="${esc(cat().actions[a])}">${esc(SHORT[a] || cat().actions[a])}</th>`).join('')}</tr></thead><tbody>
          ${cat().sections.map(S => `<tr><td class="l"><b>${esc(S.t)}</b></td>${acts.map(a => S.a[a] ? `<td><label class="mx-c" title="${esc(S.t + ': ' + S.a[a])}"><input type="checkbox" data-mx="1" data-c="${S.k}.${a}" ${dr.has(S.k + '.' + a) ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(S.t + ': ' + cat().actions[a])}"></label></td>` : '<td class="mx-na">·</td>').join('')}</tr>`).join('')}
        </tbody></table></div>
        <div class="mx-mob">${cat().sections.map(S => `<div class="rsec"><div class="rsec-h">${esc(S.t)}</div><div class="rsec-b">${Object.keys(S.a).map(a => `<label class="rcell ${dr.has(S.k + '.' + a) ? 'on' : ''}"><span><b>${esc(cat().actions[a])}</b><span class="faint">${esc(S.a[a])}</span></span><input type="checkbox" data-mx="1" data-c="${S.k}.${a}" ${dr.has(S.k + '.' + a) ? 'checked' : ''} ${locked ? 'disabled' : ''}></label>`).join('')}</div></div>`).join('')}</div>
        ${!locked ? `<div class="mx-bar"><span class="faint">${added.length || removed.length ? `Изменения: ${added.length ? '+' + added.length : ''} ${removed.length ? '−' + removed.length : ''} — применятся ко всем пользователям роли (${UI.adm.users.filter(u => u.role === rid).length}).` : 'Изменений нет.'}</span><span class="grow"></span>
          <button class="btn" type="button" data-x="adm-mx-undo" ${added.length || removed.length ? '' : 'disabled'}>Отменить</button><button class="btn primary" type="button" data-x="adm-mx-save" ${added.length || removed.length ? '' : 'disabled'}>${ico('check')}Сохранить права роли</button></div>` : ''}
      </div></section>`;
  }
  document.addEventListener('change', e => { if (e.target.id === 'adm-mrole') { UI.admMRole = e.target.value; UI.admMDraft = null; keepPage(); } });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.mx && UI.admMDraft) { const c = el.dataset.c; if (el.checked) UI.admMDraft.perms.add(c); else UI.admMDraft.perms.delete(c); keepPage(); }
    if (el.dataset && el.dataset.pwshow) el.closest('form').querySelectorAll('input[type=password],input[data-pw]').forEach(i => { i.dataset.pw = 1; i.type = el.checked ? 'text' : 'password'; });
  });
  A['adm-mx-undo'] = () => { UI.admMDraft = null; keepPage(); };
  U.PERM_X['adm-mx-save'] = 'admin';
  A['adm-mx-save'] = async () => {
    const r = roleOf(UI.admMDraft.rid);
    try { await DSF.api.put('/api/demo/admin/roles/' + encodeURIComponent(r.id), { title: r.title, perms: [...UI.admMDraft.perms] }); UI.admMDraft = null; await load(true); toast('Права роли «' + esc(r.title) + '» сохранены.'); }
    catch (e) { toast(esc(e.detail || e.message)); }
  };

  /* ---------- доступ к объектам ---------- */
  function viewAccess() {
    const P = UI.adm.projects, us = UI.adm.users.filter(u => u.active);
    const sees = (u, p) => {
      if (u.superadmin) return ['all', 'суперадминистратор'];
      if (u.kind === 'contractor') return u.projectsEff && u.projectsEff.includes(p) ? ['asg', 'назначение подрядчика'] : null;
      if (u.projects != null) return u.projects.includes(p) ? ['ind', 'назначено пользователю'] : null;
      return (roleOf(u.role) || {}).scope === 'all' ? ['role', 'по роли'] : null;
    };
    return `<section class="panel"><header><h2>Доступ к объектам</h2><span class="sub">источник доступа указан в ячейке</span></header>
      <div class="pad"><div class="tbl-wrap"><table class="t acc"><thead><tr><th class="l">Пользователь</th>${P.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
        ${us.filter(u => u.kind !== 'contractor').map(u => `<tr><td class="l"><b>${esc(u.name)}</b><div class="faint" style="font-size:12px">${esc(u.login)} · ${esc(u.roleTitle)}</div></td>${P.map(p => { const s = sees(u, p.id); return `<td>${s ? `<span class="acc-c ${s[0]}" title="${esc(s[1])}">✓<small>${esc(s[1])}</small></span>` : '<span class="faint">—</span>'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="note" style="margin-top:12px">Изменить доступ сотрудника: «Пользователи» → «Изменить» → «Доступ к объектам». Объекты подрядчиков задаются назначениями в «Базе подрядчиков». Сервер отказывает в доступе к неназначенному объекту, даже если подставить его адрес вручную.</div></div></section>`;
  }

  /* ---------- журнал ---------- */
  function viewHistory() {
    const a = UI.adm.audit || [];
    const det = x => { const d = x.details; if (!d) return ''; if (d.changes) return d.changes.map(esc).join('; '); if (d.added || d.removed) return [(d.added || []).length ? 'добавлено: ' + d.added.map(cellTitle).join(', ') : '', (d.removed || []).length ? 'снято: ' + d.removed.map(cellTitle).join(', ') : ''].filter(Boolean).map(esc).join('<br>'); if (d.role) return 'роль: ' + esc(d.role); if (d.org) return esc(d.org); return ''; };
    return `<section class="panel"><header><h2>История изменений</h2><span class="sub">${a.length}</span></header><div class="pad">
      ${a.length ? `<div class="audit">${a.map(x => `<div class="au"><div class="au-t">${esc(x.at.slice(0, 16).replace('T', ' '))}</div><div class="au-x"><b>${esc(x.action)}</b>${x.target ? ' · ' + esc(x.target) : ''}<div class="faint" style="font-size:12px">кто: ${esc(x.actor)}</div>${det(x) ? `<div style="font-size:12.5px; margin-top:2px">${det(x)}</div>` : ''}</div></div>`).join('')}</div>` : '<div class="empty">Изменений пока не было.</div>'}
      <div class="note" style="margin-top:12px">В журнал записываются изменения ролей, прав, доступа, учётных записей и паролей (факт смены, без самого пароля).</div></div></section>`;
  }

  /* ---------- свой пароль ---------- */
  A['my-pw'] = () => {
    UI.sheet = null;
    openModal(() => `<form data-form="my-pw" class="mform"><div class="mh"><div><div class="eyebrow">Профиль · ${esc(DSF.auth.user().login || '')}</div><h3 style="margin-top:4px">Сменить пароль</h3></div>${xBtn}</div>
      <div class="mb"><div class="fld"><label for="mp-0">Текущий пароль</label><input id="mp-0" name="cur" type="password" autocomplete="current-password" required autofocus></div>
        <div class="fld"><label for="mp-1">Новый пароль</label><input id="mp-1" name="p1" type="password" autocomplete="new-password" minlength="4" required></div>
        <div class="fld"><label for="mp-2">Подтверждение</label><input id="mp-2" name="p2" type="password" autocomplete="new-password" minlength="4" required></div>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сменить пароль</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`, { global: true });
  };
  FM['my-pw'] = async function (f) {
    if (f.elements.p1.value !== f.elements.p2.value) return err(f, 'Пароль и подтверждение не совпадают.');
    try {
      const r = await DSF.api.post('/api/demo/me/password', { current: f.elements.cur.value, password: f.elements.p1.value, confirm: f.elements.p2.value }, { noLogout: true });
      DSF.saveDemoSession(Object.assign({}, DSF.session, { token: r.token }));
      closeModal(); toast('Пароль изменён. Другие ваши сессии завершены.');
    } catch (e) { err(f, e.detail || e.message); }
  };

  DSF.uiAccess = { load };
})();
