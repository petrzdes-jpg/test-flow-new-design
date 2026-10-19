/*
 * Хранилище действий пользователя (журнал изменений поверх датасета).
 *
 * Датасет проекта не изменяется. Всё, что делает пользователь — события календаря,
 * загруженные документы и их движение, поручения, КС-2 подрядчика, письма (в т. ч. гарантийные),
 * ежедневные отчёты и их подтверждение, замечания стройконтроля, решения по сигналам —
 * записывается сюда как отдельные записи и операции, а движок накладывает их на
 * датасет при сборке модели. Так у каждого объекта остаётся единственный источник.
 *
 * Адаптер хранения подменяемый:
 *   LocalAdapter  — localStorage браузера (реальный контур: изменения в текущем браузере);
 *   ServerAdapter — журнал на сервере Flow (демо-контур, session.js): права проверяет сервер.
 * Файлы в демо-режиме сохраняются в IndexedDB браузера (DSF.files), при её недоступности — только в памяти вкладки.
 */
(function (root) {
  'use strict';
  const DSF = root.DSF = root.DSF || {};

  const LocalAdapter = {
    name: 'local',
    load(key) { try { const v = root.localStorage && root.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    save(key, val) { try { if (!root.localStorage) return false; root.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { if (DSF.onStorageError) DSF.onStorageError('Не удалось сохранить изменения: хранилище браузера недоступно или заполнено.'); return false; } },
    remove(key) { try { root.localStorage && root.localStorage.removeItem(key); } catch (e) { /* нет доступа */ } }
  };

  const KINDS = ['events', 'eventOps', 'docs', 'docOps', 'orders', 'orderOps', 'ks', 'ksOps', 'letters', 'reports', 'reportOps', 'remarks', 'remarkOps', 'decisions', 'notes', 'changes', 'changeOps',
    'linkOps', 'taskOps', 'baselineOps', 'workTypes', 'contracts', 'contractOps', 'estimates', 'estimateOps', 'regdocs', 'regdocOps', 'aiChecks'];
  const EMPTY = () => Object.assign({ v: 1, seq: 1 }, Object.fromEntries(KINDS.map(k => [k, []])));
  const cache = new Map();
  const files = new Map();   // id файла → { url, name, size, type } (только текущая вкладка)
  const listeners = [];

  const store = {
    adapter: DSF.mode === 'demo' && DSF.ServerAdapter ? DSF.ServerAdapter : LocalAdapter,
    key: pid => (DSF.key ? DSF.key('store-') : 'flow-store-') + pid,
    /* состояние объекта, полученное с сервера (демо-контур) */
    preload(pid, st) {
      const s = EMPTY();
      KINDS.forEach(k => { if (Array.isArray(st && st[k])) s[k] = st[k].slice(); });
      s.seq = 1 + Math.floor(Math.random() * 9e5) * 100;   // идентификаторы новых записей не пересекаются между сеансами
      cache.set(pid, s);
      if (DSF.invalidate) DSF.invalidate(pid);
    },
    get(pid) {
      if (!cache.has(pid)) {
        const s = Object.assign(EMPTY(), store.adapter.load(store.key(pid)) || {});
        cache.set(pid, s);
      }
      return cache.get(pid);
    },
    /* единая точка изменения: fn получает состояние проекта и меняет его */
    update(pid, fn) {
      const s = store.get(pid);
      const out = fn(s);
      store.adapter.save(store.key(pid), s);
      if (DSF.invalidate) DSF.invalidate(pid);
      listeners.forEach(l => l(pid));
      return out;
    },
    nextId(pid, prefix) { return store.update(pid, s => prefix + '-u' + (s.seq++)); },
    reset(pid) {
      /* только локальный кэш удалённого пользователем черновика объекта; серверный журнал не очищается */
      if (store.adapter.name === 'server') return;
      (pid ? [pid] : [...cache.keys()]).forEach(p => { cache.set(p, EMPTY()); store.adapter.remove(store.key(p)); if (DSF.invalidate) DSF.invalidate(p); });
      listeners.forEach(l => l(pid));
    },
    count(pid) { const s = store.get(pid); return KINDS.reduce((n, k) => n + (Array.isArray(s[k]) ? s[k].length : 0), 0); },
    KINDS,
    onChange(fn) { listeners.push(fn); },
    /* файлы — через общее хранилище файлов (IndexedDB в демо), см. config.js */
    putFile(file) {
      if (DSF.files) return DSF.files.put(file);
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      let url = null;
      try { url = root.URL && root.URL.createObjectURL ? root.URL.createObjectURL(file) : null; } catch (e) { url = null; }
      files.set(id, { url, name: file.name, size: file.size, type: file.type });
      return { id, name: file.name, size: file.size, type: file.type };
    },
    file(id) { return (DSF.files && DSF.files.get(id)) || files.get(id) || null; }
  };
  DSF.store = store;
})(typeof window !== 'undefined' ? window : globalThis);
