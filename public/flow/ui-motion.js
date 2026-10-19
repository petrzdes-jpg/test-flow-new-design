/*
 * FLOW — DESIGN EXPERIMENT · слой движения (по навыкам Emil Kowalski: emil-design-eng, animate, improve-animations).
 *
 * Интерфейс перерисовывается строками (innerHTML), поэтому у элементов нет «жизненного цикла».
 * Этот модуль наблюдает за #layer и #app и добавляет движение только там, где у него есть назначение:
 *  · слой (окно, боковая панель, лист, просмотр, карточка работы, уведомление) анимируется при ПЕРВОМ
 *    появлении; перерисовки при вводе в форме не повторяют вход (иначе окно «дёргалось» бы на каждый символ);
 *  · уход: удалённый узел клонируется в отдельный контейнер и уходит быстрее, чем пришёл, тем же путём;
 *  · смена раздела: короткое проявление содержимого (180 мс), только при смене маршрута;
 *  · сегментированный переключатель: плашка выбранного пункта переезжает к новому (FLIP, 200 мс);
 *  · «До / После» в анализе влияния: полосы «после» выезжают из положения «до» — движение объясняет сдвиг.
 * Не анимируются: строки графика, фильтры, клавиатурные действия, загрузка страницы.
 * prefers-reduced-motion: смещения и масштаб не применяются, остаётся прозрачность.
 * Бизнес-логика и разметка приложения не меняются.
 */
(function () {
  'use strict';
  const doc = document, layer = doc.getElementById('layer'), app = doc.getElementById('app');
  if (!layer || !app || !window.MutationObserver) return;
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)', EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

  /* ---------- слой: вход и уход ---------- */
  const kindOf = el => {
    if (!el || el.nodeType !== 1) return null;
    const c = el.classList;
    if (c.contains('modal-bg')) return 'modal';
    if (c.contains('sheet-bg')) return 'sheet';
    if (c.contains('viewer')) return 'viewer';
    if (c.contains('qc')) return 'qc:' + (el.querySelector('h3') || {}).textContent;
    if (c.contains('toast')) return 'toast:' + el.textContent.slice(0, 80);
    return null;
  };
  let exitBox = null;
  function exitLayer() { if (!exitBox) { exitBox = doc.createElement('div'); exitBox.id = 'm-exit'; exitBox.setAttribute('aria-hidden', 'true'); exitBox.inert = true; doc.body.appendChild(exitBox); } return exitBox; }
  function leave(node) {
    if (reduce()) { /* только прозрачность */ }
    const clone = node.cloneNode(true);
    clone.classList.remove('m-enter');
    clone.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
    const box = exitLayer();
    box.appendChild(clone);
    // кадр в исходном состоянии, затем класс ухода — переход начинается с текущего вида
    clone.getBoundingClientRect();
    requestAnimationFrame(() => clone.classList.add('m-leave'));
    setTimeout(() => clone.remove(), 260);
  }
  new MutationObserver(muts => {
    const removed = new Map(), added = [];
    muts.forEach(m => {
      m.removedNodes.forEach(n => { const k = kindOf(n); if (k) removed.set(k, n); });
      m.addedNodes.forEach(n => { const k = kindOf(n); if (k) added.push([k, n]); });
    });
    const addedKinds = new Set(added.map(a => a[0]));
    added.forEach(([k, n]) => { if (!removed.has(k)) n.classList.add('m-enter'); });   // новый слой — вход; перерисовка — без анимации
    removed.forEach((n, k) => {
      if (addedKinds.has(k)) return;
      // окно, сменившееся другим окном (шаг формы) — без ухода, чтобы не было двойного изображения
      if (k === 'modal' && addedKinds.has('modal')) return;
      leave(n);
    });
  }).observe(layer, { childList: true });

  /* ---------- смена раздела: короткое проявление ---------- */
  const routeKey = () => { const h = decodeURIComponent((location.hash || '').replace(/^#/, '')).split('.'); return h.slice(0, 2).join('.'); };
  let lastRoute = routeKey(), pendingRoute = false;
  window.addEventListener('hashchange', () => { if (routeKey() !== lastRoute) pendingRoute = true; });
  new MutationObserver(() => {
    if (!pendingRoute) return;
    pendingRoute = false; lastRoute = routeKey();
    const kids = [...app.children].slice(0, 6);
    kids.forEach((el, i) => el.animate(reduce() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
      { duration: 180, delay: Math.min(i, 3) * 30, easing: EASE_OUT, fill: 'backwards' }));
    /* шкала срока: прошедшая часть «дорастает» до сегодняшнего дня — объясняет, где объект во времени.
       Только при входе в раздел, один раз; перерисовки внутри раздела не анимируются. */
    if (!reduce()) app.querySelectorAll('.dl-done').forEach((el, i) => {
      el.style.transformOrigin = '0 50%';
      el.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 520, delay: 80 + Math.min(i, 6) * 40, easing: EASE_IN_OUT, fill: 'backwards' });
    });
  }).observe(app, { childList: true });

  /* ---------- сегментированный переключатель: плашка переезжает (FLIP) ---------- */
  const segKey = (s, i) => (s.getAttribute('aria-label') || '') + '#' + i + '@' + routeKey();
  let segState = new Map();
  function readSegs() {
    const m = new Map();
    doc.querySelectorAll('#app .seg, #layer .seg').forEach((s, i) => {
      const b = s.querySelector('button[aria-pressed="true"]'); if (!b) return;
      const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect();
      m.set(segKey(s, i), { x: br.left - sr.left + s.scrollLeft, w: br.width, h: br.height, y: br.top - sr.top, label: b.textContent });
    });
    return m;
  }
  function animateSegs() {
    const next = readSegs();
    if (!reduce()) doc.querySelectorAll('#app .seg, #layer .seg').forEach((s, i) => {
      const k = segKey(s, i), a = segState.get(k), b = next.get(k);
      if (!a || !b || a.label === b.label || Math.abs(a.x - b.x) < 1) return;
      const btn = s.querySelector('button[aria-pressed="true"]');
      const ind = doc.createElement('i'); ind.className = 'seg-ind';
      Object.assign(ind.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      s.appendChild(ind);
      btn.style.background = 'transparent'; btn.style.boxShadow = 'none';
      const anim = ind.animate([{ transform: `translateX(${a.x - b.x}px) scaleX(${a.w / b.w})` }, { transform: 'none' }], { duration: 200, easing: EASE_OUT });
      ind.style.transformOrigin = '0 0';
      anim.onfinish = anim.oncancel = () => { ind.remove(); btn.style.background = ''; btn.style.boxShadow = ''; };
    });
    segState = next;
  }
  /* ---------- «До / После»: полосы прогноза выезжают из исходного положения ---------- */
  function animateCompare(root) {
    if (reduce()) return;
    root.querySelectorAll('.cmpg-b').forEach((row, i) => {
      const b0 = row.querySelector('.b0'), b1 = row.querySelector('.b1');
      if (!b0 || !b1) return;
      const r0 = b0.getBoundingClientRect(), r1 = b1.getBoundingClientRect();
      if (!r1.width) return;
      b1.style.transformOrigin = '0 50%';
      b1.animate([{ transform: `translateX(${r0.left - r1.left}px) scaleX(${Math.max(0.05, r0.width / r1.width)})` }, { transform: 'none' }],
        { duration: 520, delay: 120 + i * 22, easing: EASE_IN_OUT, fill: 'backwards' });
    });
  }
  const seenCompare = new Set();
  window.addEventListener('hashchange', () => seenCompare.clear());
  const afterRender = () => {
    animateSegs();
    doc.querySelectorAll('.cmpg').forEach(c => {
      const key = location.hash + '|' + (c.closest('.modal') ? 'modal' : 'page');
      if (!seenCompare.has(key)) { seenCompare.add(key); animateCompare(c); }
    });
  };
  // до перерисовки плашки читаются по клику (кнопка ещё старая), после — сравниваются
  doc.addEventListener('pointerdown', () => { segState = readSegs(); }, true);
  doc.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') segState = readSegs(); }, true);
  const mo = new MutationObserver(() => requestAnimationFrame(afterRender));
  mo.observe(app, { childList: true });
  mo.observe(layer, { childList: true });
  segState = readSegs();
})();
