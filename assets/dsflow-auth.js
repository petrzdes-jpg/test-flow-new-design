/* Flow: основной вход (реальные проекты «Огни», «Раменки»).
   Подключается первым скриптом в <head> каждой страницы. Если сессия не открыта,
   страница сразу переходит на экран входа (login.html) и возвращается после входа.

   Временная защита интерфейса статического сайта: проверка пароля выполняется
   в браузере по хэшу (сам пароль в файлах не хранится). Это не заменяет серверную
   авторизацию. Для перехода на сервер достаточно заменить провайдер ниже
   (DSFlowAuth.provider): экран входа, охрана страниц и выход останутся прежними.

   API:
     DSFlowAuth.login(password) → Promise<{ ok: boolean, error?: string }>
     DSFlowAuth.isAuthed()      → boolean
     DSFlowAuth.logout()        — сбрасывает сессию и возвращает на экран входа
     Любой элемент с атрибутом data-dsf-logout работает как кнопка «Выйти». */
(function () {
  'use strict';
  var KEY = 'dsflow.session';
  var script = document.currentScript;
  var BASE = new URL('../', script ? script.src : location.href);   // корень сайта (assets/..)
  var LOGIN = new URL('login.html', BASE);

  /* ---------- SHA-256 (работает и вне защищённого контекста) ---------- */
  function sha256(text) {
    var bytes = new TextEncoder().encode(text), K = [], H = [], i, j;
    var isPrime = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    var frac = function (x) { return ((x - Math.floor(x)) * 4294967296) | 0; };
    for (var n = 2, c = 0; c < 64; n++) if (isPrime(n)) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); K[c++] = frac(Math.pow(n, 1 / 3)); }
    var len = bytes.length, words = [], bitLen = len * 8;
    for (i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[(((len + 8) >> 6) << 4) + 15] = bitLen;
    var ror = function (x, s) { return (x >>> s) | (x << (32 - s)); };
    for (i = 0; i < words.length; i += 16) {
      var w = [], a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        if (j < 16) w[j] = words[i + j] | 0;
        else {
          var s0 = ror(w[j - 15], 7) ^ ror(w[j - 15], 18) ^ (w[j - 15] >>> 3);
          var s1 = ror(w[j - 2], 17) ^ ror(w[j - 2], 19) ^ (w[j - 2] >>> 10);
          w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        var t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
        var t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ---------- Провайдер проверки ----------
     Временный статический провайдер. Серверный вариант — пример:
       provider = { login: p => fetch('/api/auth/login', { method:'POST', credentials:'include',
         headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: p }) })
         .then(r => r.ok ? r.json().then(x => ({ ok:true, token:x.token })) : { ok:false }) }; */
  var STATIC_HASH = '5bec60f7472f240d87e261149c7f7d3929aa8817100d955e1454f02a903cc70a';
  var staticLogin = function (password) {
    return new Promise(function (resolve) {
      var ok = sha256('dsflow.v1:' + String(password || '')) === STATIC_HASH;
      setTimeout(function () { resolve(ok ? { ok: true, token: 'static.' + Date.now().toString(36) } : { ok: false }); }, 260);
    });
  };
  /* Сервер Flow (POST /api/auth/login) выдаёт токен реального контура. Если API ещё не развёрнут
     или недоступен, работает прежняя проверка по хэшу — вход в реальные проекты не ломается.
     Неверный пароль, отклонённый сервером, повторно не проверяется. */
  var apiBase = '';
  try { apiBase = localStorage.getItem('flow.api') || ''; } catch (e) {}
  if (!apiBase && window.FLOW_ENV && window.FLOW_ENV.api) apiBase = window.FLOW_ENV.api;
  apiBase = String(apiBase || '').replace(/\/+$/, '');
  var provider = {
    login: function (password) {
      if (typeof fetch !== 'function' || !apiBase && location.protocol === 'file:') return staticLogin(password);
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 6000) : null;
      return fetch(apiBase + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: String(password || '') }), signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          if (timer) clearTimeout(timer);
          if (r.status === 401) return { ok: false };
          if (!r.ok) return staticLogin(password);
          return r.json().then(function (x) { return x && x.token ? { ok: true, token: x.token } : staticLogin(password); });
        }, function () { if (timer) clearTimeout(timer); return staticLogin(password); });
    }
  };

  var store = {
    get: function () { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
    set: function (v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
    clear: function () { try { sessionStorage.removeItem(KEY); } catch (e) {} }
  };

  var api = {
    get provider() { return provider; },
    set provider(p) { provider = p; },
    isAuthed: function () { var s = store.get(); return !!(s && s.token); },
    login: function (password) {
      return Promise.resolve(provider.login(password)).then(function (res) {
        if (res && res.ok) { store.set({ token: res.token, at: Date.now() }); return { ok: true }; }
        return { ok: false, error: 'Неверный пароль' };
      }, function () { return { ok: false, error: 'Не удалось выполнить вход. Попробуйте ещё раз.' }; });
    },
    logout: function () {
      store.clear();
      var top = window.top === window ? window : window.top;
      top.location.replace(LOGIN.href);
    },
    loginURL: LOGIN.href,
    baseURL: BASE.href
  };
  window.DSFlowAuth = api;

  /* ---------- Охрана страниц ---------- */
  var onLogin = location.pathname === LOGIN.pathname;
  var embedded = false;
  try { embedded = window.top !== window && window.top.location.origin === location.origin; } catch (e) {}
  if (!onLogin && !api.isAuthed()) {
    var next = location.pathname + location.search + location.hash;
    var target = LOGIN.href + '?next=' + encodeURIComponent(next);
    document.documentElement.style.visibility = 'hidden';   // содержимое не мелькает до перехода
    (embedded ? window.top : window).location.replace(target);
    return;
  }

  /* Страница, восстановленная кнопками «Назад/Вперёд» из кэша браузера (bfcache),
     повторно проверяет сессию: после выхода защищённое содержимое не показывается. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (!onLogin && !api.isAuthed()) {
      document.documentElement.style.visibility = 'hidden';
      location.replace(LOGIN.href + '?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
    } else if (onLogin && api.isAuthed()) location.replace(BASE.href);
  });

  /* Плавное появление первой страницы после входа */
  try {
    if (!onLogin && !embedded && sessionStorage.getItem('dsflow.enter')) {
      sessionStorage.removeItem('dsflow.enter');
      var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        var st = document.createElement('style');
        st.textContent = '@keyframes dsfEnter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}' +
          'html.dsf-enter body{animation:dsfEnter .7s cubic-bezier(.22,.61,.36,1) both}';
        document.head.appendChild(st);
        document.documentElement.classList.add('dsf-enter');
        setTimeout(function () { document.documentElement.classList.remove('dsf-enter'); }, 900);
      }
    }
  } catch (e) {}

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-dsf-logout]');
    if (el) { e.preventDefault(); api.logout(); }
  });
})();
