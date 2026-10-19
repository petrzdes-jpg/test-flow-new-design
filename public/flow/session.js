/*
 * Flow — сессия, контур и доступ к API.
 *
 * Один интерфейс Flow работает в двух строго разделённых контурах:
 *   real — реальные проекты («Огни», «Раменки»): вход по основному паролю стартового экрана;
 *   demo — демо-режим: вход под ролью (admin, director, tech, investor, contractorN).
 *
 * Контур задаёт страница атрибутом <html data-flow-mode="real|demo">. Ключи браузерного
 * хранилища, сессии и источники данных у контуров разные, поэтому действия в демо
 * не могут попасть в реальные проекты и наоборот.
 *
 * В демо данные объектов и журнал действий выдаёт сервер (/api/demo/*) с учётом роли:
 * права проверяются на сервере, интерфейс только не показывает недоступное.
 */
(function (root) {
  'use strict';
  const DSF = root.DSF = root.DSF || {};
  const doc = root.document;
  const mode = (doc && doc.documentElement.getAttribute('data-flow-mode')) || 'demo';
  DSF.mode = mode;
  DSF.key = k => 'flow-' + mode + '-' + k;
  DSF.config = Object.assign({ today: null, title: 'Flow — цифровой штаб строительства' }, DSF.config || {});

  /* ---------- адрес API ---------- */
  let base = '';
  try { base = root.localStorage.getItem('flow.api') || ''; } catch (e) { base = ''; }
  const meta = doc && doc.querySelector('meta[name="flow-api"]');
  if (!base && meta) base = meta.getAttribute('content') || '';
  if (!base && root.FLOW_ENV && root.FLOW_ENV.api) base = root.FLOW_ENV.api;
  DSF.API_BASE = String(base).replace(/\/+$/, '');

  /* ---------- сессия ---------- */
  const DEMO_KEY = 'flow.demo.session';
  const ss = {
    get(k) { try { return JSON.parse(root.sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { root.sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* недоступно */ } },
    del(k) { try { root.sessionStorage.removeItem(k); } catch (e) { /* недоступно */ } }
  };
  let session = null;
  if (mode === 'demo') {
    session = ss.get(DEMO_KEY);
    const onLogin = /\/login\.html$/.test(root.location.pathname);
    if (!onLogin && !(session && session.token)) {
      doc.documentElement.style.visibility = 'hidden';
      root.location.replace('login.html');
      return;
    }
  } else {
    const real = ss.get('dsflow.session');
    session = { token: real && real.token && !/^static\./.test(real.token) ? real.token : null,
      user: { login: 'main', role: 'real', roleTitle: 'Рабочий контур', name: 'Реальные проекты', projects: null } };
  }
  DSF.session = session;
  DSF.saveDemoSession = s => { ss.set(DEMO_KEY, s); DSF.session = s; };
  DSF.logout = function () {
    if (mode === 'demo') { ss.del(DEMO_KEY); root.location.replace('login.html'); }
    else if (root.DSFlowAuth) root.DSFlowAuth.logout();
    else root.location.replace('login.html');
  };

  /* ---------- запросы к API ---------- */
  function ApiError(status, detail) { this.status = status; this.detail = detail || 'Сервер недоступен'; this.message = this.detail; }
  ApiError.prototype = Object.create(Error.prototype);
  DSF.ApiError = ApiError;
  DSF.api = {
    async req(method, path, body, opt) {
      const h = { 'Accept': 'application/json' };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const tok = (opt && opt.token) || (DSF.session && DSF.session.token);
      if (tok) h.Authorization = 'Bearer ' + tok;
      let r;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), (opt && opt.timeout) || 15000) : null;
      try { r = await fetch(DSF.API_BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined }); }
      catch (e) { throw new ApiError(0, 'Нет связи с сервером Flow. Проверьте подключение и повторите.'); }
      finally { if (timer) clearTimeout(timer); }
      let data = null;
      try { data = await r.json(); } catch (e) { data = null; }
      if (!r.ok) {
        const detail = data && (typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail) ? 'Проверьте заполнение полей.' : null);
        if (r.status === 401 && mode === 'demo' && !(opt && opt.noLogout)) { DSF.logout(); }
        throw new ApiError(r.status, detail || ('Ошибка сервера (' + r.status + ')'));
      }
      return data;
    },
    get(p, o) { return this.req('GET', p, undefined, o); },
    post(p, b, o) { return this.req('POST', p, b === undefined ? {} : b, o); },
    put(p, b, o) { return this.req('PUT', p, b, o); },
    del(p, o) { return this.req('DELETE', p, undefined, o); }
  };

  /* ---------- журнал демо: синхронизация с сервером ----------
     Действие сначала отображается сразу (оптимистично), затем записи отправляются на сервер.
     Если сервер отклонил действие (нет прав, чужой договор и т. п.), состояние объекта
     перезагружается с сервера, а пользователь видит причину. */
  const synced = new Map();   // pid → { kind: длина, подтверждённая сервером }
  const lens = st => { const o = {}; (DSF.store ? DSF.store.KINDS : []).forEach(k => { o[k] = Array.isArray(st[k]) ? st[k].length : 0; }); return o; };
  DSF.ServerAdapter = {
    name: 'server',
    load() { return null; },
    remove() { /* состояние живёт на сервере */ },
    save(key, st) {
      const pid = String(key).replace(/^.*store-/, '');
      const prev = synced.get(pid) || {};
      const appends = [];
      let shrink = false;
      DSF.store.KINDS.forEach(k => {
        const a = Array.isArray(st[k]) ? st[k] : [], n0 = prev[k] || 0;
        if (a.length < n0) shrink = true;
        for (let i = n0; i < a.length; i++) appends.push({ kind: k, entry: a[i] });
      });
      synced.set(pid, lens(st));
      /* журнал только дополняется: удалить подтверждённые записи нельзя (общей функции сброса нет) */
      if (shrink) { DSF.reloadJournal(pid, { detail: 'Удаление записей журнала не поддерживается — используйте корректировку с указанием основания.' }); return true; }
      if (!appends.length) return true;
      DSF.api.post('/api/demo/journal/' + encodeURIComponent(pid), { appends }).catch(e => DSF.reloadJournal(pid, e));
      return true;
    }
  };
  DSF.reloadJournal = async function (pid, err) {
    try {
      const j = await DSF.api.get('/api/demo/journal/' + encodeURIComponent(pid));
      DSF.store.preload(pid, j.journal || {});
      synced.set(pid, lens(DSF.store.get(pid)));
    } catch (e) { /* сервер недоступен — остаётся текущее состояние */ }
    if (DSF.invalidate) DSF.invalidate(pid);
    if (DSF.ui) { DSF.ui.render(); if (err) DSF.ui.h.toast('Действие не сохранено: ' + DSF.ui.h.esc(err.detail || err.message || 'ошибка сервера')); }
  };

  /* ---------- загрузка данных демо-контура ---------- */
  DSF.refreshMe = async function () {
    const me = await DSF.api.get('/api/demo/me');
    DSF.saveDemoSession(Object.assign({}, DSF.session, { user: me.user, catalog: me.catalog, today: me.today }));
    return me.user;
  };
  DSF.loadDemo = async function () {
    await DSF.refreshMe();   // роль, права и объекты могли измениться администратором
    const list = await DSF.api.get('/api/demo/projects');
    DSF.config.today = list.today || DSF.config.today;
    const ids = (list.projects || []).map(p => p.id);
    const got = await Promise.all(ids.map(id => Promise.all([
      DSF.api.get('/api/demo/projects/' + encodeURIComponent(id)),
      DSF.api.get('/api/demo/journal/' + encodeURIComponent(id))
    ])));
    got.forEach(([P, j]) => {
      P.today = P.today || DSF.config.today;
      DSF.register(P);
      DSF.store.preload(P.id, j.journal || {});
      synced.set(P.id, lens(DSF.store.get(P.id)));
    });
    DSF.manifest = ids;
    return ids;
  };
})(typeof window !== 'undefined' ? window : globalThis);
