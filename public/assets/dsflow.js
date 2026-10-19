/* Shared navigation and the only service-worker registration in DSFlow. */
(() => {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  const menus = [...document.querySelectorAll('.dsf-switch')];
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const menu of menus) {
      if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    }
  });
  document.addEventListener('click', event => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
  });
  /* Установленная web-app на iPhone может показывать сохранённую страницу после выхода новой
     версии. При запуске и возврате из фона версия страницы сверяется с опубликованной
     (<meta name="app-version">); при расхождении — одна перезагрузка с защитой от цикла.
     Одинаково для всех страниц DSFlow. */
  (function appUpdate(){
    if (typeof fetch !== 'function' || !/^https?:$/.test(location.protocol) || window.top !== window) return;
    const current = document.querySelector('meta[name="app-version"]')?.content;
    if (!current) return;
    const GUARD = 'dsflow.app-update', RETRY = 6e5, GAP = 6e4, MIN = 5e3, AWAY = 2e4;
    let busy = false, lastCheck = 0, hiddenAt = 0;
    const mayReload = v => {
      try { if (new URLSearchParams(location.search).get('v') === v) return false; } catch (e) {}
      try {
        const g = JSON.parse(localStorage.getItem(GUARD) || 'null');
        if (g && g.v === v && Date.now() - g.t < RETRY) return false;
        localStorage.setItem(GUARD, JSON.stringify({ v, t: Date.now() }));
      } catch (e) {}
      return true;
    };
    const check = force => {
      if (busy || navigator.onLine === false || Date.now() - lastCheck < (force ? MIN : GAP)) return;
      lastCheck = Date.now(); busy = true;
      fetch(location.pathname + '?_=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
        .then(r => r.ok ? r.text() : null)
        .then(html => {
          const m = html && html.match(/<meta\s+name=["']app-version["']\s+content=["']([^"']+)["']/i);
          const v = m && m[1];
          if (!v || v === current || !mayReload(v)) return;
          if (document.querySelector('.modal-bg, dialog[open]')) return;   // не прерывать ввод данных
          location.replace(location.pathname + '?v=' + encodeURIComponent(v) + location.hash);
        })
        .catch(() => {})
        .then(() => { busy = false; });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt < AWAY) return;
      hiddenAt = 0; check(true);
    });
    window.addEventListener('pageshow', e => { if (e.persisted) check(true); });
    check();
  })();
  if (!('serviceWorker' in navigator) || !window.isSecureContext || window.top !== window) return;
  const register = async () => {
    try {
      // Retire only the old Ramenki worker at this site's known path.
      const oldScript = new URL('ramenki/sw.js', base).href;
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        const worker = registration.active || registration.waiting || registration.installing;
        if (worker?.scriptURL === oldScript) await registration.unregister();
      }
      const registration = await navigator.serviceWorker.register(new URL('sw.js', base).href, {
        scope: base.pathname, updateViaCache: 'none'
      });
      let checkedAt = Date.now();
      const check = () => {
        if (navigator.onLine === false || Date.now() - checkedAt < 60000) return;
        checkedAt = Date.now();
        registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      window.addEventListener('online', check);
      // Activation does not reload a page containing unsaved form input.
    } catch (error) {
      console.warn('DSFlow: автономный режим пока недоступен.', error);
    }
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
})();
