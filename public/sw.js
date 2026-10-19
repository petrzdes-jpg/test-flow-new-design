/* Flow: one worker for the whole site. Bump VERSION with every release. */
'use strict';
const VERSION = '2026.10.16-design-exp.5';
const CACHE_PREFIX = 'dsflow-static-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const BASE = new URL('./', self.location.href);
const CORE = [
  'index.html', 'login.html', 'assets/dsflow-auth.js?v=3', 'ogni/index.html', 'ogni/work.html', 'ogni/report.html', 'ramenki/index.html', 'ramenki/work.html',
  'demo/index.html', 'demo/login.html',
  'manifest.webmanifest', 'favicon.ico',
  'flow/env.js?v=2', 'flow/flow.css?v=2', 'flow/session.js?v=2', 'flow/store.js?v=2', 'flow/cpm.js?v=2', 'flow/engine-fin.js?v=2', 'flow/engine.js?v=2', 'flow/engine-records.js?v=2',
  'flow/engine-flow.js?v=2', 'flow/engine-changes.js?v=2', 'flow/config.js?v=2', 'flow/bridge.js?v=2', 'flow/ui.js?v=3', 'flow/ui-work.js?v=2', 'flow/ui-flow.js?v=2', 'flow/admin.js?v=2',
  'flow/ui-roles.js?v=2', 'flow/ui-shell.js?v=3', 'flow/ui-plan.js?v=2', 'flow/ui-fin.js?v=3', 'flow/ui-access.js?v=2', 'flow/ui-base.js?v=2', 'flow/ui-reg.js?v=2', 'flow/ui-real.js?v=2', 'flow/exp.css?v=3', 'flow/exp-bold.css?v=4', 'flow/exp-layouts.css?v=9', 'flow/ui-layouts.js?v=4', 'flow/ui-motion.js?v=2', 'flow/login-exp.css?v=1',
  'assets/shell.css?v=8', 'assets/dsflow-ui.css?v=6', 'assets/dashboard.css?v=16', 'assets/dsflow.js?v=8', 'assets/dsflow.js?v=7',
  'assets/dsflow-core.css?v=2', 'assets/dsflow-engine.js?v=6', 'assets/ogni-project.js?v=4',
  'assets/dsflow-update-xlsx.js?v=2', 'assets/dsflow-update.js?v=2', 'assets/templates/dsflow-update-template.xlsx',
  'assets/data/ogni-gpr.js?v=1', 'assets/data/ogni-daily.js?v=1',
  'assets/sidebar.css?v=17', 'assets/project-components.css?v=25', 'assets/project-components.js?v=18', 'assets/ogni-ai.js?v=18',
  'assets/projects/ogni-icon.png',
  'assets/projects/ramenki-render.png', 'assets/projects/ogni-cover.png', 'assets/icons/mark.svg',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-192.png', 'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png', 'assets/icons/favicon-32x32.png', 'assets/icons/favicon-16x16.png',
  'ramenki/assets/icons/icon-192.png', 'ramenki/assets/icons/logo-mark-white.png',
  'assets/fonts/05cf802c73c174d1.woff2',
  'assets/fonts/2b2f25a453b4fdfb.woff2',
  'assets/fonts/31cf398692ba3b51.woff2',
  'assets/fonts/467acc7aa76b62d6.woff2',
  'assets/fonts/6e85163c68a33810.woff2',
  'assets/fonts/7048add3bf7c79c5.woff2',
  'assets/fonts/79b02f847ae98478.woff2',
  'assets/fonts/7bc0ec665e0e25f3.woff2',
  'assets/fonts/8850c1292d3fd608.woff2',
  'assets/fonts/9be0371ef54b377a.woff2',
  'assets/fonts/a28b7e319024809f.woff2',
  'assets/fonts/fonts.css',
  'assets/vendor/mammoth.browser.min.js',
  'assets/vendor/pdf.min.js',
  'assets/vendor/pdf.worker.min.js',
  'assets/vendor/xlsx.full.min.js',
  'assets/vendor/exceljs.min.js'
];
const CORE_URLS = new Set(CORE.map(path => new URL(path, BASE).href));

function documentURL(url) {
  const localPath = url.pathname.slice(BASE.pathname.length);
  const pages = new Map([
    ['', 'index.html'], ['index.html', 'index.html'], ['login.html', 'login.html'],
    ['ogni/', 'ogni/index.html'], ['ogni/index.html', 'ogni/index.html'], ['ogni/work.html', 'ogni/work.html'], ['ogni/report.html', 'ogni/report.html'],
    ['ramenki/', 'ramenki/index.html'], ['ramenki/index.html', 'ramenki/index.html'], ['ramenki/work.html', 'ramenki/work.html'],
    ['demo/', 'demo/index.html'], ['demo/index.html', 'demo/index.html'], ['demo/login.html', 'demo/login.html']
  ]);
  const page = pages.get(localPath);
  return page ? new URL(page, BASE).href : null;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...CORE_URLS].map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Do not delete caches belonging to other applications on the same origin.
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function pageResponse(event, canonical) {
  const cache = caches.open(CACHE_NAME);
  const network = fetch(event.request, { cache: 'no-store' });
  // Clone before delivering the response; writing the cache must not delay rendering.
  event.waitUntil(network.then(response => {
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      const copy = response.clone();
      return cache.then(store => store.put(canonical, copy));
    }
  }).catch(() => {}));
  try {
    const response = await network;
    if (response.status >= 500) {
      const cached = await (await cache).match(canonical);
      if (cached) return cached;
    }
    return response;
  } catch (error) {
    const cached = await (await cache).match(canonical);
    if (cached) return cached;
    return new Response('Нет подключения. Откройте этот проект при доступной сети.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function assetResponse(request, key) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key);
  const mutable = /\.(?:js|css|json)$/i.test(new URL(key).pathname);
  if (cached && !mutable) return cached;
  try {
    const response = await fetch(request, { cache: mutable ? 'no-store' : 'default' });
    if (response.ok) {
      // A cache quota error must not turn a valid network response into a failure.
      try { await cache.put(key, response.clone()); } catch (_) {}
    }
    if (response.status >= 500 && cached) return cached;
    return response;
  } catch (_) {
    if (cached) return cached;
    return new Response('Ресурс недоступен без сети.', { status: 503 });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  const localPath = url.pathname.slice(BASE.pathname.length);
  // Keep relative links and assets correct when opening a project without a trailing slash.
  if (request.mode === 'navigate' && (localPath === 'ogni' || localPath === 'ramenki' || localPath === 'demo')) {
    event.respondWith(Response.redirect(new URL(localPath + '/' + url.search, BASE).href, 301));
    return;
  }
  const canonical = documentURL(url);
  if (canonical) {
    event.respondWith(pageResponse(event, canonical));
    return;
  }
  // Only known public assets are cached. API responses and uploads never enter this cache.
  if (CORE_URLS.has(url.href)) event.respondWith(assetResponse(request, url.href));
});
