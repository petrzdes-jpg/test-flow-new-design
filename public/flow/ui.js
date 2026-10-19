/*
 * FLOW — Цифровой штаб строительства. Универсальный интерфейс.
 * Все экраны строятся из модели DSF.build(project). Ни одной строки
 * под конкретный объект: проект определяет содержание, а не вёрстку.
 */
(function () {
  'use strict';
  const { dn, iso, clamp, sum, monthStart, monthEnd, addMonths } = DSF.util;
  const F = DSF.fmt;
  let CUR = null;   // текущий объект: у реальных объектов своя дата среза
  const T = () => dn((CUR && CUR.today) || DSF.config.today);

  /* ---------- мелкие помощники ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fd = d => F.date(d);
  const fds = d => F.date(d).slice(0, 5);
  const num = (v, d = 0) => F.num(v, d);
  const pct = (v, d = 1) => v == null || !isFinite(v) ? '—' : F.num(v, d) + '%';
  const money = v => F.money(v);
  const bn = v => F.num(v / 1000, 2);
  const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  const days = n => num(n) + ' ' + plural(n, 'день', 'дня', 'дней');
  const photoUrl = id => DSF.imageUrl(id);
  const stVar = c => ({ good: 'var(--good)', warn: 'var(--warn)', crit: 'var(--crit)', accent: 'var(--accent)', neutral: 'var(--ink-3)' }[c] || 'var(--ink-3)');
  const chip = (t, c) => `<span class="chip ${c || 'neutral'}">${esc(t)}</span>`;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(DSF.key('ui-' + k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(DSF.key('ui-' + k), JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } }
  };

  const I = {
    grid: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    gantt: '<path d="M4 6h8M8 12h9M12 18h8"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    arrow: '<path d="M7 17L17 7M9 7h8v8"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    chevd: '<path d="M6 9l6 6 6-6"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    building: '<path d="M6 21V5.5L12 3v18"/><path d="M12 21V8l6 2.5V21"/><path d="M4 21h16"/><path d="M8.5 8v.01M8.5 11v.01M8.5 14v.01M8.5 17v.01M15 13v.01M15 16v.01"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.6c2.6.1 4.6 1.8 5.1 4.9"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4h6v3"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
    dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    down: '<path d="M12 4v12M6 11l6 6 6-6M5 21h14"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    ruble: '<path d="M8 21V4h6a4 4 0 0 1 0 8H6M6 16h8"/>',
    zin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>', zout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>'
  };
  const ico = (k, sz) => `<svg viewBox="0 0 24 24" ${sz ? `width="${sz}" height="${sz}"` : ''} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k] || ''}</svg>`;

  /* единая структура разделов (config.js): [ключ, название в меню, иконка, короткое название].
     Какие разделы видит объект — определяет его конфигурация (DSF.sectionsOf). */
  const SECTIONS = DSF.SECTION_DEFS.map(x => [x.k, x.t, x.ic, x.s]);
  const PAGES = { settings: ['settings', 'Настройки объекта', 'gear', 'Настройки'] };
  const secDef = k => SECTIONS.find(s => s[0] === k) || PAGES[k] || [k, k, '', k];
  const secTitle = k => secDef(k)[1];
  const secShort = k => secDef(k)[3];
  const secOn = (M, k) => k === 'overview' || (k === 'settings' ? can('settings') && M.P.source !== 'legacy' : DSF.roleSees(k) && (!M.sections || M.sections.includes(k) || (k === 'iddocs' && M.sections.includes('docs'))));
  const can = p => DSF.can(p);

  const UI = {
    theme: LS.get('theme', null),
    gScale: LS.get('gScale', 'month'), gFilter: 'all', gCols: null, gCollapsed: {}, sel: null,
    calMonth: {}, calTypes: null, photoStage: 'all', docKind: 'all', docQ: '', riskCell: null, riskFilter: 'active', sheet: null, viewer: null,
    navOpen: LS.get('navOpen', true), modal: null, toast: null
  };
  if (UI.theme) document.documentElement.setAttribute('data-theme', UI.theme);

  /* ---------- маршрутизация: #  ·  #<проект>  ·  #<проект>.<раздел> ---------- */
  const byId = id => DSF.projects.find(p => p.id === id);
  const SYS = ['admin', 'new', 'base', 'queue', 'projects', 'pcal', 'notify'];   // системные страницы вне объекта
  function route() {
    const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    CUR = null;
    if (!h) return { pid: null, sec: 'portfolio' };
    const [pid, sec, ...rest] = h.split('.');
    if (SYS.includes(pid)) return { pid: null, sec: pid, sub: [sec].concat(rest).filter(Boolean).join('.') || null };
    if (!byId(pid)) return { pid: null, sec: 'portfolio' };
    CUR = byId(pid);
    const ok = SECTIONS.some(s => s[0] === sec) || !!PAGES[sec];
    return { pid, sec: ok ? sec : 'overview', sub: ok && rest.length ? rest.join('.') : null };
  }
  function go(h) {
    if (('#' + h) === location.hash || (h === '' && !location.hash)) { render(); return; }
    location.hash = h;
  }
  const link = (pid, sec, sub) => pid ? pid + (sec && (sec !== 'overview' || sub) ? '.' + sec : '') + (sub ? '.' + sub : '') : '';

  /* ---------- графические примитивы ---------- */
  function ring(size, sw, parts, center) {
    const c = size / 2;
    let out = `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`;
    parts.forEach(p => {
      const r = p.r != null ? p.r : (c - sw / 2 - 1), L = 2 * Math.PI * r, w = p.w || sw;
      out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${w}"/>`;
      if (p.v > 0) out += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${(L * clamp(p.v, 0, 100) / 100).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>`;
      if (p.tick != null) {
        const a = (-90 + 3.6 * p.tick) * Math.PI / 180, r1 = r - w / 2 - 3, r2 = r + w / 2 + 3;
        out += `<line x1="${(c + r1 * Math.cos(a)).toFixed(1)}" y1="${(c + r1 * Math.sin(a)).toFixed(1)}" x2="${(c + r2 * Math.cos(a)).toFixed(1)}" y2="${(c + r2 * Math.sin(a)).toFixed(1)}" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/>`;
      }
    });
    return out + (center || '') + '</svg>';
  }
  function monthTicks(x0, x1, maxN) {
    const out = [];
    let m = addMonths(monthStart(x0), 1);
    const months = []; for (; m <= x1; m = addMonths(m, 1)) months.push(m);
    const step = Math.max(1, Math.ceil(months.length / maxN));
    months.forEach((t, i) => {
      const d = new Date(t * 864e5);
      if (d.getUTCMonth() % step === 0 || step === 1) out.push({ t, label: F.MONTHS[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2) });
    });
    return out;
  }
  let chartSeq = 0;
  const CHARTS = {};
  function lineChart(o) {
    const id = 'c' + (++chartSeq);
    const w = o.w || 760, h = o.h || 300, P = { l: 52, r: 14, t: 38, b: 28 };
    const X = t => P.l + (t - o.x0) / (o.x1 - o.x0) * (w - P.l - P.r);
    const Y = v => P.t + (1 - (v - o.y0) / (o.y1 - o.y0)) * (h - P.t - P.b);
    let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label || 'График')}">`;
    (o.yTicks || []).forEach(v => {
      s += `<line class="gl" x1="${P.l}" x2="${w - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`;
      s += `<text class="ax" x="${P.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${o.yFmt ? o.yFmt(v) : v}</text>`;
    });
    monthTicks(o.x0, o.x1, o.maxTicks || Math.max(3, Math.floor(w / 90))).forEach(k => {
      s += `<line class="gl" x1="${X(k.t).toFixed(1)}" x2="${X(k.t).toFixed(1)}" y1="${h - P.b}" y2="${h - P.b + 4}"/>`;
      s += `<text class="ax" x="${X(k.t).toFixed(1)}" y="${h - P.b + 17}" text-anchor="middle">${k.label}</text>`;
    });
    s += `<line x1="${P.l}" x2="${w - P.r}" y1="${h - P.b}" y2="${h - P.b}" stroke="var(--line-strong)"/>`;
    (o.marks || []).forEach(m => {
      if (m.t < o.x0 || m.t > o.x1) return;
      const x = X(m.t).toFixed(1);
      s += `<line x1="${x}" x2="${x}" y1="${P.t - 4}" y2="${h - P.b}" stroke="${m.color}" stroke-width="1.5" ${m.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
      const anchor = X(m.t) > w - 110 ? 'end' : X(m.t) < P.l + 50 ? 'start' : 'middle';
      s += `<text x="${x}" y="${P.t - 9 - (m.row || 0) * 12}" text-anchor="${anchor}" font-size="11" font-weight="650" fill="${m.color}" font-family="var(--font-ui)">${esc(m.label)}</text>`;
    });
    o.series.forEach(se => {
      const pts = se.pts.filter(p => p[1] != null);
      if (!pts.length) return;
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
      if (se.area && pts.length > 1) s += `<path d="${d} L${X(pts[pts.length - 1][0]).toFixed(1)} ${Y(o.y0)} L${X(pts[0][0]).toFixed(1)} ${Y(o.y0)} Z" fill="${se.color}" opacity=".1"/>`;
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2.25}" stroke-linejoin="round" stroke-linecap="round" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/>`;
      if (se.end) { const p = pts[pts.length - 1]; s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="4.5" fill="${se.color}" stroke="var(--surface)" stroke-width="2"/>`; }
    });
    s += `<line class="hl" x1="0" x2="0" y1="${P.t}" y2="${h - P.b}" stroke="var(--ink-3)" stroke-width="1" opacity="0"/>`;
    s += `<rect x="${P.l}" y="${P.t}" width="${w - P.l - P.r}" height="${h - P.t - P.b}" fill="transparent"/></svg>`;
    CHARTS[id] = { o, w, P };
    const legend = `<div class="legend" style="margin-top:6px">${o.series.filter(x => x.name).map(x => `<span><i style="height:${x.dash ? 3 : 4}px;background:${x.dash ? `repeating-linear-gradient(90deg,${x.color} 0 5px,transparent 5px 9px)` : x.color}"></i>${esc(x.name)}</span>`).join('')}</div>`;
    return `<div class="chart" data-cid="${id}">${s}<div class="tip" hidden></div></div>${legend}`;
  }
  function valAt(pts, t) {
    const p = pts.filter(x => x[1] != null);
    if (!p.length || t < p[0][0] || t > p[p.length - 1][0]) return null;
    for (let i = 1; i < p.length; i++) if (t <= p[i][0]) { const [a, va] = p[i - 1], [b, vb] = p[i]; return b === a ? vb : va + (vb - va) * (t - a) / (b - a); }
    return p[p.length - 1][1];
  }
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.chart[data-cid]');
    document.querySelectorAll('.chart[data-cid]').forEach(c => { if (c !== el) { const t = c.querySelector('.tip'); if (t) t.hidden = true; const l = c.querySelector('.hl'); if (l) l.setAttribute('opacity', 0); } });
    if (!el) return;
    const c = CHARTS[el.dataset.cid]; if (!c) return;
    const svg = el.querySelector('svg'), r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * c.w / r.width;
    if (x < c.P.l || x > c.w - c.P.r) return;
    const t = Math.round(c.o.x0 + (x - c.P.l) / (c.w - c.P.l - c.P.r) * (c.o.x1 - c.o.x0));
    const hl = svg.querySelector('.hl'); hl.setAttribute('x1', x); hl.setAttribute('x2', x); hl.setAttribute('opacity', .7);
    const rows = c.o.series.filter(s => s.name).map(s => { const v = valAt(s.pts, t); return v == null ? '' : `<div class="tr"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}<b>${c.o.tipFmt ? c.o.tipFmt(v) : pct(v)}</b></div>`; }).join('');
    const tip = el.querySelector('.tip');
    tip.innerHTML = `<div class="tt">${fd(t)}</div>${rows || '<div class="tr">нет данных</div>'}`;
    tip.hidden = false;
    tip.style.left = clamp(x / c.w * r.width + 12, 0, r.width - 190) + 'px'; tip.style.top = '6px';
  });
  function spark(vals, plan, w = 120, h = 34) {
    const all = vals.concat(plan || []), mn = Math.min(...all) * 0.96, mx = Math.max(...all) * 1.02;
    const X = i => 2 + i / (vals.length - 1) * (w - 6), Y = v => 3 + (1 - (v - mn) / (mx - mn || 1)) * (h - 6);
    const path = a => a.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${plan ? `<path d="${path(plan)}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="3 3"/>` : ''}<path d="${path(vals)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/><circle cx="${X(vals.length - 1)}" cy="${Y(vals[vals.length - 1])}" r="3.5" fill="var(--accent)"/></svg>`;
  }
  function wfBars(res, size) {
    const w = (size && size.w) || 560, h = (size && size.h) || 190, P = { l: 36, r: 8, t: 14, b: 26 }, n = res.fact.length, bw = (w - P.l - P.r) / n;
    const mx = Math.ceil(Math.max(...res.plan, ...res.fact) * 1.1 / 50) * 50;
    const Y = v => P.t + (1 - v / mx) * (h - P.t - P.b);
    let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Рабочие по неделям">`;
    [0, mx / 2, mx].forEach(v => { s += `<line class="gl" x1="${P.l}" x2="${w - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${num(v)}</text>`; });
    res.fact.forEach((v, i) => {
      const x = P.l + i * bw + bw * 0.18, bwi = bw * 0.64, below = v < res.plan[i];
      s += `<rect x="${x.toFixed(1)}" y="${Y(v).toFixed(1)}" width="${bwi.toFixed(1)}" height="${(h - P.b - Y(v)).toFixed(1)}" rx="3" fill="${below ? 'var(--warn)' : 'var(--accent)'}" opacity="${i === n - 1 ? 1 : .75}"><title>${fds(res.weeks[i])}: ${v} чел. (план ${res.plan[i]})</title></rect>`;
      if (i % 2 === (n - 1) % 2) s += `<text class="ax" x="${(x + bwi / 2).toFixed(1)}" y="${h - P.b + 16}" text-anchor="middle">${fds(res.weeks[i])}</text>`;
    });
    s += `<path d="${res.plan.map((v, i) => (i ? 'L' : 'M') + (P.l + i * bw + bw / 2).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="1.75" stroke-dasharray="4 4"/>`;
    s += `<line x1="${P.l}" x2="${w - P.r}" y1="${h - P.b}" y2="${h - P.b}" stroke="var(--line-strong)"/></svg>`;
    return `<div class="chart">${s}</div><div class="legend" style="margin-top:6px"><span><i style="background:var(--accent)"></i>Факт</span><span><i style="background:var(--warn)"></i>Факт ниже плана</span><span><i style="height:3px;background:repeating-linear-gradient(90deg,var(--ink) 0 5px,transparent 5px 9px)"></i>План</span></div>`;
  }

  /* ---------- каркас: сайдбар, нижняя панель, шапка ---------- */
  const models = () => DSF.projects.map(p => DSF.build(p));
  function sidebar(r) {
    const M = r.pid ? DSF.build(byId(r.pid)) : null;
    const proj = M ? M.P : null;
    const user = DSF.auth.user(), role = { t: DSF.auth.name(), short: (DSF.ROLES[DSF.auth.role] || {}).short || DSF.auth.name() };
    const demo = DSF.mode === 'demo', ctr = DSF.auth.role === 'contractor';
    const badge = k => {
      if (!M) return '';
      if (k === 'risks' && M.highRisks.length) return `<span class="cnt">${M.highRisks.length}</span>`;
      if (k === 'orders') { const n = M.orders.filter(o => o.status === 'overdue').length; return n ? `<span class="cnt" title="Просрочено">${n}</span>` : ''; }
      if (k === 'corrections') { const n = (M.changes || []).filter(c => DSF.uiRoles && DSF.uiRoles.waitsMe(c)).length; return n ? `<span class="cnt" title="Ждут вашего решения">${n}</span>` : ''; }
      return '';
    };
    const item = ([k, t, ic]) => `<a class="nav-i" href="#${link(proj.id, k)}" data-go="${link(proj.id, k)}" ${r.sec === k ? 'aria-current="page"' : ''} title="${esc(secTitle(k))}">${ico(ic)}<span class="nl">${esc(secTitle(k))}</span>${badge(k)}</a>`;
    const groups = proj ? DSF.SECTION_GROUPS.map(([g, ks]) => [g, ks.filter(k => secOn(M, k)).map(k => secDef(k))]).filter(g => g[1].length) : [];
    const sysItem = (go, ic, t) => `<a class="nav-i" href="#${go}" data-go="${go}" ${r.sec === (go || 'portfolio') ? 'aria-current="page"' : ''}>${ico(ic)}<span class="nl">${t}</span></a>`;
    const checks = (can('admin') || DSF.auth.role === 'director') ? (() => {
      const issues = models().reduce((x, m) => x + m.issues.filter(i => i.level === 'error').length, 0), warns = models().reduce((x, m) => x + m.issues.filter(i => i.level === 'warn').length, 0);
      return `<button class="sb-card" type="button" data-act="checks" style="border:0; text-align:left; cursor:pointer; font:inherit"><div class="eyebrow">Проверка данных · ${fd(T())}</div><div class="ok">${ico('check', 16)} ${issues ? issues + ' ' + plural(issues, 'ошибка', 'ошибки', 'ошибок') : 'Противоречий нет'}${warns ? ' · ' + warns + ' предупр.' : ''}</div></button>`;
    })() : '';
    document.getElementById('sidebar').innerHTML = `
      <button class="sb-brand" type="button" data-go="" title="${ctr ? 'Мои объекты' : 'Портфель проектов'}">
        <span class="logo">${ico('building')}</span>
        <span class="sb-text"><div class="sb-name">Flow${demo ? ' <span class="sb-demo">демо</span>' : ''}</div><div class="sb-sub">Цифровой штаб строительства</div></span>
      </button>
      <button class="sb-proj" type="button" data-act="switch" title="Сменить объект">
        ${proj ? miniRing(M, 34, 'var(--sb-ink-2)') : `<span class="logo" style="background:var(--sb-hover)">${ico('layers')}</span>`}
        <span class="pt"><div class="pn">${proj ? esc(proj.name) : ctr ? 'Мои объекты' : 'Все проекты'}</div><div class="pm">${proj ? esc([proj.type, proj.city].filter(Boolean).join(' · ') || 'объект') : DSF.projects.length + ' ' + plural(DSF.projects.length, 'объект', 'объекта', 'объектов') + (ctr ? ' назначено' : ' в портфеле')}</div></span>
        ${ico('swap').replace('<svg', '<svg class="ch"')}
      </button>
      <nav class="sb-nav" aria-label="Разделы">
        ${proj ? item(SECTIONS[0]) + groups.map(([g, list]) => `<div class="sb-grp">${esc(g)}</div>` + list.map(item).join('')).join('') +
          (can('settings') ? `<div class="sb-grp">Администрирование</div><a class="nav-i" href="#${link(proj.id, 'settings')}" data-go="${link(proj.id, 'settings')}" ${r.sec === 'settings' ? 'aria-current="page"' : ''} title="Настройки объекта">${ico('gear')}<span class="nl">Настройки объекта</span></a>` + (DSF.realWorkLink ? DSF.realWorkLink(proj) : '') : '')
        : sysItem('', 'layers', ctr ? 'Мои объекты' : 'Портфель') + DSF.projects.map(p => `<a class="nav-i" href="#${p.id}" data-go="${p.id}">${ico('building')}<span class="nl">${esc(p.name)}</span></a>`).join('') +
          (can('corr_dir') || can('corr_tz') ? sysItem('queue', 'swap', can('corr_dir') ? 'График на корректировку' : 'Корректировки графика') : '') +
          (can('create') || can('admin') || can('base') ? '<div class="sb-grp">Администрирование</div>' : '') +
          (can('create') ? sysItem('new', 'plus', 'Добавить объект') : '') +
          (can('base') && demo ? sysItem('base', 'users', 'База подрядчиков') : '') +
          (can('admin') ? sysItem('admin', 'shield', 'Администрирование') : '')}
      </nav>
      <div class="sb-foot">
        <div class="sb-card sb-user"><div class="eyebrow">${demo ? 'Демо-режим · ' : ''}${esc(role.t || user.roleTitle || '')}</div><div class="sb-un">${esc(user.name || '')}</div>${user.login && demo ? `<div class="sb-ul">логин: ${esc(user.login)}</div>` : ''}
          <div style="display:flex; gap:6px; flex-wrap:wrap">${demo ? `<button class="sb-out" type="button" data-x="my-pw">${ico('lock', 14)}<span class="nl">Пароль</span></button>` : ''}<button class="sb-out" type="button" data-act="logout">${ico('back', 14)}<span class="nl">Выйти</span></button></div></div>
        ${checks}
      </div>`;
    /* нижняя навигация (телефон): глобальная — Портфель | Проекты | Календарь | Уведомления | Ещё;
       внутри объекта — Обзор | График | Календарь | Документы | Ещё */
    const bot = r.pid ? [['overview', 'Обзор', 'grid'], ['schedule', 'График', 'gantt'], ['calendar', 'Календарь', 'cal'], ['docs', 'Документы', 'folder']] : [];
    const nN = DSF.notifyCount ? DSF.notifyCount() : 0;
    const bb = (go, cur, ic, t, extra) => `<button type="button" data-go="${go}" ${cur ? 'aria-current="page"' : ''}>${ico(ic)}<span>${t}</span>${extra || ''}</button>`;
    document.getElementById('botnav').innerHTML = r.pid
      ? bot.map(([k, t, ic]) => secOn(M, k) ? bb(link(r.pid, k), r.sec === k, ic, t) : `<button type="button" disabled aria-disabled="true" title="Раздел недоступен">${ico(ic)}<span>${t}</span></button>`).join('') + `<button type="button" data-act="more" ${!bot.some(b => b[0] === r.sec) ? 'aria-current="page"' : ''}>${ico('dots')}<span>Ещё</span></button>`
      : bb('', r.sec === 'portfolio', 'layers', ctr ? 'Объекты' : 'Портфель') + bb('projects', r.sec === 'projects', 'building', 'Проекты') + bb('pcal', r.sec === 'pcal', 'cal', 'Календарь') +
        bb('notify', r.sec === 'notify', 'bell', 'Уведомления', nN ? `<i class="bn-badge">${nN > 99 ? '99+' : nN}</i>` : '') + `<button type="button" data-act="more" ${['admin', 'base', 'queue', 'new'].includes(r.sec) ? 'aria-current="page"' : ''}>${ico('dots')}<span>Ещё</span></button>`;
  }
  /* кольцо готовности: «—», если готовность объекта не настроена */
  function miniRing(M, size, fill) {
    const v = M.root.pc;
    return ring(size, 4, [{ v: v || 0, color: stVar(M.status.overall === 'neutral' ? 'accent' : M.status.overall) }], `<text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" font-size="${size > 34 ? 10 : 9.5}" font-weight="700" fill="${fill}" font-family="var(--font-ui)">${v == null ? '—' : Math.round(v)}</text>`);
  }
  function topbar(r, M, v) {
    const theme = document.documentElement.getAttribute('data-theme');
    const crumbs = [{ t: 'Портфель', go: '' }];
    if (!M && (r.sec === 'admin' || r.sec === 'new')) crumbs.push({ t: r.sec === 'admin' ? 'Администрирование' : 'Добавить объект' });
    if (M) {
      crumbs.push({ t: M.P.name, go: r.sec === 'overview' ? null : M.P.id });
      if (r.sec !== 'overview') crumbs.push({ t: secShort(r.sec), go: v && v.crumb ? link(M.P.id, r.sec) : null });
      if (v && v.crumbParent) crumbs.splice(crumbs.length, 0, { t: v.crumbParent.t, go: v.crumbParent.go });
      if (v && v.crumb) crumbs.push({ t: v.crumb });
    }
    else if (r.sec === 'portfolio') crumbs[0].go = null;
    return `<div class="topbar">
      <nav class="crumbs" aria-label="Путь">${crumbs.map((c, i) => (i ? '<span class="sep">/</span>' : '') + (c.go != null ? `<button type="button" data-go="${c.go}">${esc(c.t)}</button>` : `<span class="cur">${esc(c.t)}</span>`)).join('')}</nav>
      ${M ? `<button class="mswitch" type="button" data-act="switch">${miniRing(M, 36, 'var(--ink)')}<span class="pt"><div class="pn">${esc(M.P.name)} · ${esc(secShort(r.sec))}</div><div class="pm">${esc(M.P.type ? M.P.type + ' · ' : '')}сменить проект</div></span>${ico('swap')}</button>`
        : `<button class="mswitch" type="button" data-act="switch">${ico('layers')}<span class="pt"><div class="pn">Портфель проектов</div><div class="pm">Выбрать проект</div></span>${ico('swap')}</button>`}
      <div class="tb-r">
        <span class="datepill">Отчётная дата <b>${fd(T())}</b></span>
        <button class="icon-btn" type="button" data-act="theme" aria-label="Переключить тему" title="Переключить тему">${ico(theme === 'light' ? 'moon' : 'sun')}</button>
      </div>
    </div>`;
  }

  /* ---------- портфель ---------- */
  function viewPortfolio() {
    const Ms = models();
    const head = `<section class="head" style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:flex-end">
      <div style="flex:1 1 420px; min-width:0">
        <div class="eyebrow">Flow — цифровой штаб строительства${DSF.mode === 'demo' ? ' · демо-режим' : ''}</div>
        <h1 style="margin-top:8px">${DSF.auth.role === 'contractor' ? 'Мои <span class="ac">объекты</span>' : 'Портфель <span class="ac">проектов</span>'}</h1>
        <p class="muted" style="margin-top:8px; max-width:70ch">${DSF.auth.role === 'contractor' ? 'Объекты, назначенные вашей организации администратором. Выберите объект, чтобы внести прогресс, подать КС-2 или запросить корректировку графика.' : DSF.mode === 'real' ? 'Реальные объекты на единой архитектуре Flow. Показатели берутся только из данных объекта; если значение не передано, показывается «—».' : 'Демонстрационные объекты на единой архитектуре Flow. Все компании, люди и показатели вымышлены.'}</p>
      </div>
      <div class="hd-r">${can('create') ? `<button class="btn primary" type="button" data-go="new">${ico('plus')}Добавить объект</button>` : ''}${can('admin') ? `<button class="btn" type="button" data-go="admin">${ico('shield')}Администрирование</button>` : ''}</div>
    </section>`;
    if (!Ms.length) return { html: head + `<section class="panel"><div class="pad"><div class="empty">В портфеле нет объектов.${can('create') ? ' Нажмите «Добавить объект».' : ''}</div></div></section>`, title: 'Портфель проектов' };
    const has = v => v != null && isFinite(v);
    const fins = Ms.filter(m => m.fin.configured);
    const approved = sum(fins, m => m.fin.approved), done = sum(fins, m => m.fin.done), area = sum(Ms, m => +m.P.params.area || 0);
    const rdy = Ms.filter(m => has(m.root.pc) && m.fin.configured);
    const wavg = rdy.length ? sum(rdy, m => m.root.pc * m.fin.approved) / sum(rdy, m => m.fin.approved) : null;
    const workers = sum(Ms, m => m.res.now || 0);
    const high = sum(Ms, m => m.highRisks.length);
    const late = Ms.filter(m => m.root.delay > 0).length;
    const over = Ms.filter(m => m.fin.configured && m.fin.eac > m.fin.approved).length;
    const t = T();
    const tl = Ms.filter(m => has(m.root.start) && has(m.root.planEnd));
    const x0 = tl.length ? Math.min(...tl.map(m => m.root.start)) - 30 : t - 30, x1 = tl.length ? Math.max(...tl.map(m => Math.max(m.root.planEnd, has(m.root.forecastEnd) ? m.root.forecastEnd : m.root.planEnd))) + 40 : t + 30;
    const X = d => ((d - x0) / (x1 - x0) * 100).toFixed(2) + '%';
    const ticks = []; for (let y = new Date(x0 * 864e5).getUTCFullYear() + 1; ; y++) { const d = Math.round(Date.UTC(y, 0, 1) / 864e5); if (d > x1) break; ticks.push({ d, l: String(y) }); }
    const pcTxt = M => has(M.root.pc) ? Math.round(M.root.pc) + '%' : '—';
    const delayChip = M => M.root.delay == null ? chip('нет графика', 'neutral') : M.root.delay > 0 ? chip('+' + M.root.delay + ' дн.', M.status.schedule) : chip('в срок', 'good');
    const stName = M => { const ps = DSF.PROJECT_STATUS[M.P.status]; if (ps && M.P.status !== 'active') return [ps.t, ps.c]; const o = M.status.overall; return o === 'neutral' ? ['Настраивается', 'neutral'] : [o === 'good' ? 'В графике' : o === 'warn' ? 'Внимание' : 'Требует решений', o]; };
    const lite = DSF.auth.role === 'contractor';
    const html = head + (lite ? '' : `
    <section class="tiles" aria-label="Сводка портфеля">
      <div class="tile"><div class="eyebrow">Бюджет портфеля</div><div class="v">${approved ? bn(approved) + ' <small>млрд ₽</small>' : '—'}</div><div class="s">${approved ? 'выполнено ' + bn(done) + ' млрд · ' + pct(done / approved * 100) : 'бюджеты не заданы'}${fins.length < Ms.length && approved ? ' · без бюджета: ' + (Ms.length - fins.length) : ''}</div></div>
      <div class="tile"><div class="eyebrow">Готовность портфеля</div><div class="v">${pct(wavg)}</div><div class="s">взвешено по бюджету${rdy.length < Ms.length ? ' · ' + rdy.length + ' из ' + Ms.length + ' объектов' : ''}</div></div>
      <div class="tile"><div class="eyebrow">Площадь</div><div class="v">${area ? num(area / 1000, 1) + ' <small>тыс. м²</small>' : '—'}</div><div class="s">${Ms.length} ${plural(Ms.length, 'объект', 'объекта', 'объектов')}</div></div>
      <div class="tile"><div class="eyebrow">На площадках</div><div class="v">${num(workers)} <small>чел.</small></div><div class="s">техника ${Ms.some(m => m.res.equipment.length) ? num(sum(Ms, m => m.res.equipTotal)) + ' ед.' : '—'}</div></div>
      <div class="tile ${late ? 'warn' : 'good'}"><div class="eyebrow">Отставание от графика</div><div class="v">${late} <small>из ${Ms.length}</small></div><div class="s">прогноз позже плана ввода</div></div>
      <div class="tile ${over ? 'crit' : 'good'}"><div class="eyebrow">Риски</div><div class="v">${high} <small>высоких</small></div><div class="s">${over ? over + ' ' + plural(over, 'проект', 'проекта', 'проектов') + ' с перерасходом' : (fins.length ? 'перерасхода нет' : 'бюджеты не заданы')}</div></div>
    </section>`) + `
    ${DSF.portfolioExtra ? DSF.portfolioExtra(Ms) : ''}
    <section class="pcards" aria-label="Проекты">
      ${Ms.map(M => {
        const P = M.P, st = M.status, os = DSF.objStatus(M), sn = [os.t, os.c], img = photoUrl(P.cover);
        return `<button class="pcard" type="button" data-go="${P.id}">
          <div class="ph">${img ? `<img src="${img}" alt="${esc(P.name)}: ${esc(M.phase)}" loading="lazy">` : `<div class="ph-empty">${ico('building', 40)}<span>${esc(P.code)}</span></div>`}<div class="ov">${P.type ? `<span class="pill-dark">${esc(P.type)}</span>` : '<span></span>'}${chip(sn[0], sn[1])}</div></div>
          <div class="bd">
            <div class="row"><div style="min-width:0"><h3>${esc(P.name)}</h3><div class="meta">${esc([P.city, M.phase].filter(Boolean).join(' · '))}</div></div>
              ${ring(58, 6, [{ v: M.root.pc || 0, color: 'var(--good)', tick: M.root.planNow }], `<text x="29" y="33" text-anchor="middle" font-size="13" font-weight="750" fill="var(--ink)" font-family="var(--font-ui)">${pcTxt(M)}</text>`)}</div>
            <div class="pk">
              <div><div class="l">Прогноз ввода</div><div class="v" style="color:${os.delay > 0 ? stVar(os.c) : 'var(--ink)'}">${fd(os.forecast)}</div><div class="l" style="margin-top:2px">директ. ${fd(os.directive)}</div></div>
              <div><div class="l">Отклонение</div><div class="v" style="color:${stVar(os.c)}">${os.delay == null ? '—' : os.delay > 0 ? '+' + os.delay + ' дн.' : os.delay < 0 ? '−' + (-os.delay) + ' дн.' : 'в срок'}</div>${os.partial ? '<div class="l" style="margin-top:2px; color:var(--warn-ink)">оценка неполная</div>' : ''}</div>
              <div><div class="l">Бюджет</div><div class="v" style="color:${stVar(st.budget)}">${M.fin.configured ? bn(M.fin.eac) + ' млрд' : '—'}</div></div>
            </div>
            <div class="row" style="font-size:12px; color:var(--ink-2)"><span>${M.res.has ? num(M.res.now) + ' чел.' : 'ресурсы —'} · ${M.highRisks.length} выс. / ${M.midRisks.length} ср. рисков</span><span class="lnk">Открыть ${ico('chev')}</span></div>
          </div>
        </button>`;
      }).join('')}
      ${can('create') ? `<button class="pcard pcard-add" type="button" data-go="new"><span class="pa-ic">${ico('plus', 28)}</span><b>Добавить объект</b><span class="faint">Мастер создания: сведения, участники, разделы, график, готовность, бюджет, документация, ресурсы, показатели</span></button>` : ''}
    </section>
    <section class="panel">
      <header><h2>Сроки портфеля</h2><span class="sub">план и прогноз ввода, отчётная дата ${fd(t)}</span></header>
      <div class="pad">
        <div class="mg" style="min-width:0">
          <div class="mg-axis"><div></div><div class="tm">${ticks.map(k => `<span style="left:${X(k.d)}">${k.l}</span>`).join('')}</div></div>
          ${Ms.map(M => has(M.root.start) && has(M.root.planEnd) ? `<button class="mg-row" type="button" data-go="${M.P.id}.schedule" title="${esc(M.P.name)}: план ${fd(M.root.planEnd)}, прогноз ${fd(M.root.forecastEnd)}">
            <span class="nm"><span>${esc(M.P.name)}</span><span>${pcTxt(M)}</span></span>
            <span class="tl">
              <span class="gbar" style="left:${X(M.root.start)}; width:calc(${X(has(M.root.forecastEnd) ? M.root.forecastEnd : M.root.planEnd)} - ${X(M.root.start)})"><i style="width:${M.root.pc || 0}%; background:${M.root.delay > 0 ? stVar(M.status.schedule) : 'var(--good)'}"></i></span>
              <span class="gplan" style="left:${X(M.root.start)}; width:calc(${X(M.root.planEnd)} - ${X(M.root.start)})"></span>
              <span class="today" style="left:${X(t)}"></span>
            </span></button>` : `<div class="mg-row" style="cursor:default"><span class="nm"><span>${esc(M.P.name)}</span><span>—</span></span><span class="tl faint" style="font-size:12px; padding-left:8px">сроки не заданы</span></div>`).join('')}
        </div>
        <div class="legend" style="margin-top:10px"><span><i style="background:var(--good)"></i>Готовность (в срок)</span><span><i style="background:var(--warn)"></i>Готовность (с отставанием)</span><span><i style="height:3px;background:var(--ink-3)"></i>Плановый срок</span><span><i style="width:2px;height:12px;background:var(--accent)"></i>Отчётная дата</span></div>
      </div>
    </section>
    ${lite ? '' : `<section class="panel">
      <header><h2>Сравнение проектов</h2><span class="sub">одинаковые показатели для любой стадии</span></header>
      <div class="pad tbl-wrap"><table class="t">
        <thead><tr><th>Проект</th><th class="l">Текущий этап</th><th>Готовность</th><th>План на дату</th><th>Прогноз ввода</th><th>Отклонение</th><th>Бюджет</th><th>Прогноз стоимости</th><th>Освоено</th><th>Риски</th></tr></thead>
        <tbody>${Ms.map(M => `<tr class="link" data-go="${M.P.id}"><td><b>${esc(M.P.name)}</b><div class="faint" style="font-size:12px">${esc(M.P.type)}</div></td><td class="l">${esc(M.phase)}</td><td>${pct(M.root.pc)}</td><td>${pct(M.root.planNow)}</td><td>${fd(M.root.forecastEnd)}</td><td>${delayChip(M)}</td><td>${M.fin.configured ? money(M.fin.approved) : '—'}</td><td style="color:${stVar(M.status.budget)}">${M.fin.configured ? money(M.fin.eac) : '—'}</td><td>${pct(M.fin.finPct)}</td><td>${M.highRisks.length} / ${M.midRisks.length}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`}`;
    return { html, title: DSF.auth.role === 'contractor' ? 'Мои объекты' : 'Портфель проектов' };
  }
  /* ---------- обзор проекта ---------- */
  function stamp(M, extra) {
    const P = M.P, pp = P.params || {}, img = photoUrl(P.cover);
    const addr = [P.address, pp.area ? num(pp.area) + ' м²' : '', pp.floors ? pp.floors + ' ' + plural(+pp.floors, 'этаж', 'этажа', 'этажей') + (pp.under ? ' + ' + pp.under + ' подз.' : '') : ''].filter(Boolean).join(' · ');
    const ps = DSF.PROJECT_STATUS[P.status];
    return `<section class="stamp">
      ${img ? `<div class="bg" style="background-image:url('${img}')"></div>` : ''}
      <div class="stamp-main">
        <div class="mark" aria-hidden="true">${esc(P.code)}</div>
        <div style="min-width:0">
          <div class="eyebrow">${esc([P.type, P.city, 'этап: ' + M.phase].filter(Boolean).join(' · '))}${ps && P.status !== 'active' ? ' · ' + esc(ps.t) : ''}</div>
          <h1><span class="ac">${esc(P.name)}</span></h1>
          <div class="addr">${esc(addr) || '—'}</div>
        </div>
      </div>
      <dl>${extra || ''}</dl>
    </section>`;
  }
  function viewOverview(M) {
    const P = M.P, R = M.root, f = M.fin, t = T(), RS = M.res;
    const sched = M.status.schedule;
    const attGo = a => { const [sec, ...rest] = String(a.go || 'overview').split('.'); return link(P.id, sec, rest.join('.') || null); };
    // KPI ведёт в раздел, только если раздел включён у объекта
    const kpi = (sec, sub, title, inner) => secOn(M, sec) ? `<button class="kpi" type="button" data-go="${link(P.id, sec, sub)}" title="${esc(title)}">${inner(true)}</button>` : `<div class="kpi kpi-static">${inner(false)}</div>`;
    const top = (t, on) => `<div class="kpi-top"><span class="t">${t}</span>${on ? `<span class="go">${ico('arrow')}</span>` : ''}</div>`;
    const setLink = can('settings') ? `<button class="lnk" type="button" data-go="${link(P.id, 'settings', 'readiness')}">Настроить готовность ${ico('chev')}</button>` : '';
    const attentionPanel = () => `<section class="panel">
        <header><h2>Требует внимания</h2><span class="sub">${M.attention.length} ${plural(M.attention.length, 'вопрос', 'вопроса', 'вопросов')}</span><span class="grow"></span>${secOn(M, 'orders') ? `<button class="lnk" type="button" data-go="${link(P.id, 'orders')}">Все поручения ${ico('chev')}</button>` : ''}</header>
        <div class="pad">${M.attention.length ? `<div class="att">${M.attention.slice(0, 6).map(a => `<button class="att-i" type="button" data-go="${attGo(a)}" ${a.task ? `data-task="${a.task.id}"` : ''}><span class="sev" style="background:${stVar(a.sev)}"></span><span class="tx">${a.kind === 'order' ? `<span class="chip ${a.order.status === 'overdue' ? 'crit' : 'warn'}" style="margin-right:6px">${a.order.status === 'overdue' ? 'Просрочено' : 'Критическое'}</span>` : ''}${esc(a.text)}<div class="m">${esc(a.meta || '')}</div></span>${ico('chev')}</button>`).join('')}</div>` : '<div class="empty">Просроченных и критических поручений нет.</div>'}</div>
      </section>`;
    const html = `
    ${stamp(M, `<div><dt>Заказчик</dt><dd style="font-size:13.5px">${esc(P.customer) || '—'}</dd></div><div><dt>Отчётная дата</dt><dd>${fd(t)}</dd></div>`)}
    <section class="kpis kpis4" aria-label="Ключевые показатели">
      ${kpi('schedule', null, 'Реализация / График работ', on => `${top('Готовность', on)}
        <div class="kpi-mid"><div><div class="big">${R.pc != null ? num(R.pc, 1) + '<small>%</small>' : '—'}</div>
          <div class="kv2"><span>План:</span><b>${fd(R.planEnd)}</b><span>Прогноз:</span><b style="color:${R.delay > 0 ? stVar(sched) : R.delay == null ? 'var(--ink)' : 'var(--good)'}">${fd(R.forecastEnd)}</b></div></div>
          ${ring(84, 9, [{ v: R.pc || 0, color: 'var(--good)', tick: R.planNow, r: 34 }])}</div>
        <div class="kpi-foot">${R.pc == null ? `<span>${R.mode === 'manual' ? 'фактическая готовность не внесена' : 'правила расчёта готовности не настроены'}</span>` : R.dev == null ? '<span>план на дату не задан</span>' : `${chip(Math.abs(R.dev) < 0.05 ? 'по плану' : (R.dev > 0 ? '+' : '−') + num(Math.abs(R.dev), 1) + ' п.п. к плану', R.dev >= -1 ? 'good' : R.dev > -5 ? 'warn' : 'crit')}<span>план на ${fds(t)} — ${pct(R.planNow)}</span>`}</div>`)}
      ${kpi('calendar', null, 'Календарь проекта', on => `${top('Срок', on)}
        <div class="kpi-mid"><div><div class="big ${sched}">${R.actualEnd != null ? 'сдан' : R.delay == null ? '—' : R.delay > 0 ? '+' + R.delay + '<small>дн.</small>' : R.delay < 0 ? '−' + (-R.delay) + '<small>дн.</small>' : 'в срок'}</div><div class="s" style="margin-top:8px">${R.actualEnd != null ? 'фактическое завершение ' + fd(R.actualEnd) : R.delay == null ? 'нет плановой даты завершения или графика' : R.delay > 0 ? 'отставание прогноза от плана ввода' : R.delay < 0 ? 'опережение плана ввода' : 'прогноз совпадает с планом ввода'}</div></div>
          ${ring(84, 9, [{ v: R.timePct || 0, color: 'var(--accent)', r: 34 }], `<text x="42" y="46" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)" font-family="var(--font-ui)">${R.timePct != null ? Math.round(R.timePct) + '%' : '—'}</text>`)}</div>
        <div class="kpi-foot">${R.timePct != null ? `<span>прошло ${Math.round(R.timePct)}% срока</span><span>осталось ${days(R.left)}</span>` : '<span>сроки объекта не заданы</span>'}</div>`)}
      ${kpi('budget', null, 'Бюджет', on => f.configured ? `${top('Бюджет', on)}
        <div><div class="big bigm" style="font-size:clamp(24px,2.1vw,32px); white-space:normal">${bn(f.done)} <span class="faint">/</span> <span style="white-space:nowrap">${bn(f.approved)}<small> млрд ₽</small></span></div><div class="s" style="margin-top:8px">выполнено из утверждённого · оплачено <b>${bn(f.paid)}</b></div></div>
        <div class="bar" style="margin-top:4px"><i style="width:${clamp(f.contracted / f.approved * 100, 0, 100)}%; --c:var(--accent-soft); box-shadow:inset 0 0 0 1px var(--accent)"></i><i style="width:${clamp(f.done / f.approved * 100, 0, 100)}%; --c:var(--good)"></i><b style="left:${clamp(f.eac / f.approved * 100, 0, 100)}%" title="Прогноз стоимости"></b></div>
        <div class="kpi-foot">${chip(f.eac > f.approved ? 'перерасход ' + money(f.eacDelta) : 'прогноз ' + bn(f.eac) + ' млрд · в бюджете', f.state)}</div>` : `${top('Бюджет', on)}<div><div class="big">—</div><div class="s" style="margin-top:8px">бюджет объекта не задан</div></div><div class="kpi-foot"><span>${M.contracts.length ? M.contracts.length + ' ' + plural(M.contracts.length, 'договор', 'договора', 'договоров') : 'статьи и договоры не внесены'}</span></div>`)}
      ${kpi('resources', 'wf', 'Ресурсы — график движения рабочей силы', on => `${top('Ресурсы', on)}
        <div class="res3">
          <div><div class="l">Рабочие</div><div class="v ${RS.has && RS.now < RS.planNowWf * 0.95 ? 'warn' : ''}">${RS.has ? num(RS.now) : '—'}</div></div>
          <div><div class="l">ИТР</div><div class="v">${RS.itrNow != null ? num(RS.itrNow) : '—'}</div></div>
          <div><div class="l">Техника</div><div class="v">${RS.equipment.length ? num(RS.equipTotal) + '<small> ед.</small>' : '—'}</div></div>
        </div>
        <div class="kpi-foot">${RS.has ? `<span>план рабочих ${num(RS.planNowWf)}</span><span>неделя ${fds(RS.lastWeek)}</span>${RS.fact.length > 1 ? spark(RS.fact, RS.plan, 90, 26) : ''}` : '<span>данные о ресурсах ещё не вносились</span>'}</div>`)}
    </section>
    ${DSF.uiFlow ? DSF.uiFlow.controlBlocks(M) + DSF.uiFlow.signalsPanel(M) : ''}

    <div class="${DSF.uiFlow ? '' : 'grid2'}">
      ${secOn(M, 'schedule') ? `<section class="panel">
        <header><h2>График реализации</h2><span class="sub">этапы: факт и прогноз против плана</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'schedule')}">Диаграмма Ганта ${ico('chev')}</button></header>
        <div class="pad">${miniGantt(M)}${R.pc == null && M.tasks.length ? `<div class="note" style="margin-top:12px">Общая готовность не рассчитывается: для объекта не заданы правила участия работ и весовые коэффициенты. ${setLink}</div>` : ''}</div>
      </section>` : ''}
      ${DSF.uiFlow ? '' : attentionPanel()}
    </div>

    ${secOn(M, 'photos') ? `<section class="panel">
      <header><h2>Фотохроника</h2><span class="sub">последние снимки с объекта</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'photos')}">Все фото ${ico('chev')}</button></header>
      <div class="pad">${M.photos.length ? `<div class="photostrip">${M.photos.slice(0, 6).map(p => photoCard(M, p)).join('')}</div>` : `<div class="empty">Фотографий пока нет.${P.source === 'legacy' ? ` <a class="lnk" href="${esc(P.module)}#/photos">Загрузить в рабочем модуле</a>` : can('data') ? ` <button class="lnk" type="button" data-x="photo-upload">Загрузить фото</button>` : ''}</div>`}</div>
    </section>` : ''}`;
    return { html };
  }
  const levelName = l => ({ high: 'высокий', mid: 'средний', low: 'низкий' }[l]);
  const levelColor = l => ({ high: 'crit', mid: 'warn', low: 'neutral' }[l]);
  function riskEffectText(r) {
    const a = [];
    if (r.eff.task && r.task) a.push((r.eff.days ? '+' + r.eff.days + ' дн. к «' : 'влияет на «') + r.task.name + '»');
    if (r.eff.cost) a.push('+' + money(r.eff.cost));
    return a.join(' · ') || 'без прямого влияния на срок и стоимость';
  }
  function feedRow(d, color, text, small) { return `<div class="fe"><span class="d">${fds(d)}</span><span class="k" style="background:${color}"></span><span class="x">${text}${small ? `<small>${esc(small)}</small>` : ''}</span></div>`; }
  function evColor(type) { return ({ milestone: 'var(--accent)', conference: 'var(--accent)', meeting: 'var(--accent-2)', rd: 'var(--accent-2)', delivery: 'var(--warn)', acceptance: 'var(--good)', inspection: 'var(--good)', finish: 'var(--good)', control: 'var(--crit)', order: 'var(--warn)', guarantee: 'var(--warn)', remark: 'var(--crit)', site: 'var(--ink-2)', other: 'var(--ink-3)', start: 'var(--ink-3)' }[type] || 'var(--ink-3)'); }
  function feedColor(k) { return ({ done: 'var(--good)', ms: 'var(--accent)', start: 'var(--accent-2)', decision: 'var(--ink)', risk: 'var(--crit)' }[k] || evColor(k)); }
  function feedLabel(e) { return ({ done: 'работа завершена', ms: 'веха', start: 'начало работ', decision: 'решение · ' + (e.by || ''), risk: 'риск' }[e.kind] || (DSF.EVENT_TYPES[e.kind] || {}).t || ''); }
  function budgetStack(M) {
    const f = M.fin, A = f.approved;
    const parts = [
      ['КС-2 согласовано', f.agreed, 'var(--good)'],
      ['Выполнено, ещё не закрыто КС-2', Math.max(0, f.done - f.agreed), 'var(--accent-2)'],
      ['Законтрактовано, не выполнено', Math.max(0, f.contracted - Math.max(f.done, f.agreed)), 'var(--accent)'],
      ['Не законтрактовано', Math.max(0, f.uncontracted), 'var(--ink-3)'],
      ['Резерв', f.reserve, 'var(--warn)']
    ];
    return `<div class="stack" style="height:14px">${parts.map(p => `<i style="width:${(p[1] / A * 100).toFixed(2)}%; background:${p[2]}" title="${esc(p[0])}: ${money(p[1])}"></i>`).join('')}</div>
      <div class="list" style="margin-top:8px">${parts.map(p => `<div class="li"><span class="t" style="font-weight:550"><span class="dot" style="background:${p[2]}; margin-right:8px"></span>${esc(p[0])}</span><span class="num">${money(p[1])}</span></div>`).join('')}
      <div class="li"><span class="t">Прогноз стоимости</span><span class="num" style="font-weight:700; color:${stVar(f.state)}">${money(f.eac)}</span><span class="m">${f.eac > f.approved ? 'выше утверждённого бюджета на ' + money(f.eacDelta) : 'использовано ' + Math.max(0, Math.round(f.reserveUsedPct)) + '% резерва'}</span></div></div>`;
  }
  function miniGantt(M) {
    const t = T();
    if (!M.stages.length) return `<div class="empty">График объекта ещё не сформирован.${can('schedule') ? ` <button class="lnk" type="button" data-go="${link(M.P.id, 'settings', 'schedule')}">Добавить этапы и работы ${ico('chev')}</button>` : ''}</div>`;
    const x0 = Math.min(...M.stages.map(s => Math.min(s.s0, s.es))) - 15, x1 = Math.max(...M.stages.map(s => Math.max(s.f0, s.ef))) + 30;
    const X = d => ((d - x0) / (x1 - x0) * 100).toFixed(2) + '%';
    const span = x1 - x0;
    const ticks = [];
    for (let m = monthStart(x0); m <= x1; m = addMonths(m, 1)) {
      const d = new Date(m * 864e5), mo = d.getUTCMonth();
      const step = span > 900 ? 6 : span > 450 ? 3 : 1;
      if (m > x0 && mo % step === 0) ticks.push({ d: m, l: F.MONTHS[mo] + ' ' + String(d.getUTCFullYear()).slice(2) });
    }
    return `<div class="mg">
      <div class="mg-axis"><div class="eyebrow" style="padding:6px 6px 0">Этап</div><div class="tm">${ticks.map((k, i) => `<span class="${i % 2 ? 'o' : ''}" style="left:${X(k.d)}">${k.l}</span>`).join('')}</div></div>
      ${M.stages.map(s => {
        const col = s.done ? 'var(--good)' : s.slip > 14 ? 'var(--crit)' : s.slip > 3 ? 'var(--warn)' : 'var(--accent)';
        return `<button class="mg-row" type="button" data-go="${link(M.P.id, 'schedule')}" title="${esc(s.name)}: план ${fd(s.s0)}–${fd(s.f0)}, ${s.done ? 'факт' : 'прогноз'} ${fd(s.es)}–${fd(s.ef)}">
          <span class="nm"><span>${esc(s.name)}</span><span>${Math.round(s.pct)}%</span></span>
          <span class="tl"><span class="gbar" style="left:${X(s.es)}; width:calc(${X(s.ef)} - ${X(s.es)} + 2px)"><i style="width:${s.pct}%; background:${col}"></i></span><span class="gplan" style="left:${X(s.s0)}; width:calc(${X(s.f0)} - ${X(s.s0)})"></span></span>
        </button>`;
      }).join('')}
      <div class="mg-over"><span class="today" style="left:${X(t)}"></span><span class="today-pill" style="left:${X(t)}">${fds(t)}</span></div>
    </div>
    <div class="legend" style="margin-top:10px"><span><i style="background:var(--good)"></i>Завершено</span><span><i style="background:var(--accent)"></i>В графике</span><span><i style="background:var(--warn)"></i>Сдвиг до 14 дн.</span><span><i style="background:var(--crit)"></i>Сдвиг более 14 дн.</span><span><i style="height:3px;background:var(--ink-3)"></i>План</span></div>`;
  }
  function photoCard(M, p) {
    return `<button class="ph-card" type="button" data-photo="${esc(p.file)}" data-pid="${M.P.id}"><img src="${photoUrl(p.file)}" alt="${esc(p.caption)}" loading="lazy"><span class="pc"><span class="faint num">${fd(p.d)} · ${esc(p.stage || (p.task ? p.task.stage : '') || p.cat || '')}</span><span class="c">${esc(p.caption)}</span></span></button>`;
  }
  /* ---------- график (Гант) ---------- */
  const CW = () => window.innerWidth < 768 ? 420 : 760, CH = () => window.innerWidth < 768 ? 280 : 300;
  const SCALES = { day: 40, week: 14, month: 3, quarter: 1.2, year: 0.45 };
  const GFILTERS = [['all', 'Все'], ['active', 'В работе'], ['crit', 'Критический путь'], ['late', 'Отставание'], ['done', 'Завершено'], ['wait', 'Будущие']];
  function matchG(x, f) {
    if (f === 'all') return true;
    if (f === 'active') return x.state === 'active';
    if (f === 'crit') return x.crit;
    if (f === 'late') return x.st.c === 'warn' || x.st.c === 'crit';
    if (f === 'done') return x.state === 'done';
    if (f === 'wait') return x.state === 'wait';
    return true;
  }
  function gCols() {
    const full = UI.gCols != null ? UI.gCols : window.innerWidth >= 1500;
    const mob = window.innerWidth < 768;
    const cols = [{ k: 'name', t: 'Этап / работа', w: mob ? 150 : full ? 300 : 280 }];
    if (full && !mob) cols.push({ k: 'ps', t: 'План начало', w: 80 }, { k: 'pf', t: 'План оконч.', w: 80 }, { k: 'as', t: 'Факт начало', w: 80 }, { k: 'af', t: 'Факт / прогн. оконч.', w: 92 });
    cols.push({ k: 'pct', t: '%', w: mob ? 46 : 56 });
    if (!mob) cols.push({ k: 'dev', t: 'Откл., дн.', w: 66 }, { k: 'st', t: 'Статус', w: 158 });
    return cols;
  }
  /* вид графика: «Список» (телефон по умолчанию) или «Гант» */
  const gMode = () => UI.gMode || LS.get('gMode', window.innerWidth < 768 ? 'list' : 'gantt');
  const depOf = d => DSF.cpm.parseDep(d);
  const DEP_T = { FS: 'ОН', SS: 'НН', FF: 'ОО', SF: 'НО' };
  const depTxt = (M, d) => { const p = depOf(d); if (!p) return ''; const t = M.byId.get(p.id); return (t ? t.name : p.id) + ' · ' + (DEP_T[p.type] || p.type) + (p.lag ? (p.lag > 0 ? '+' : '') + p.lag + ' дн.' : '') + (p.active === false ? ' (откл.)' : ''); };
  DSF.depText = depTxt;
  function schedList(M, rows) {
    if (!rows.length) return '<div class="pad"><div class="empty">Работ с таким статусом нет.</div></div>';
    return `<div class="pad"><div class="slist">${rows.map(r => {
      if (r.stage) { const s = r.stage, c = UI.gCollapsed[M.P.id + s.id]; return `<button class="sl-stg" type="button" data-act="gtoggle" data-sid="${s.id}" aria-expanded="${!c}">${ico(c ? 'chev' : 'chevd')}<b>${esc(s.name)}</b><span>${Math.round(s.pct)}%</span><span class="faint">${fds(s.es)}–${fds(s.ef)}</span></button>`; }
      const x = r.task, deps = (x.deps || []).map(d => depTxt(M, d)).filter(Boolean);
      return `<button class="sl-i ${UI.sel === x.id ? 'sel' : ''}" type="button" data-task="${x.id}">
        <div class="sl-h">${x.crit ? '<span class="cp" title="Критический путь"></span>' : ''}<b>${x.ms ? '◆ ' : ''}${esc(x.name)}</b>${chip(x.st.t, x.st.c)}</div>
        <div class="sl-g"><span><small>План</small>${x.ms ? fd(x.f0) : fds(x.s0) + ' – ' + fd(x.f0)}</span><span><small>${x.af != null ? 'Факт' : 'Прогноз'}</small>${x.ms ? fd(x.af != null ? x.af : x.ef) : fds(x.as != null ? x.as : x.es) + ' – ' + fd(x.af != null ? x.af : x.ef)}</span>
          ${x.ms ? '' : `<span><small>Готово</small>${Math.round(x.pct)}%</span>`}<span><small>Откл.</small><b style="color:${x.slip > 14 ? 'var(--crit)' : x.slip > 3 ? 'var(--warn-ink)' : 'inherit'}">${x.slip > 0 ? '+' + x.slip : x.slip < 0 ? '−' + (-x.slip) : '0'}</b></span>
          <span><small>Резерв</small>${x.float == null ? '—' : x.float + ' дн.'}</span></div>
        ${!x.ms ? `<div class="bar sl-bar"><i style="width:${x.pct}%; --c:${x.done ? 'var(--good)' : stVar(x.st.c === 'neutral' ? 'accent' : x.st.c)}"></i></div>` : ''}
        ${deps.length ? `<div class="sl-d">${ico('link', 13)} после: ${deps.slice(0, 3).map(esc).join('; ')}${deps.length > 3 ? ' и ещё ' + (deps.length - 3) : ''}</div>` : x.ms || x.idx === 0 ? '' : '<div class="sl-d faint">нет предшествующих работ</div>'}</button>`;
    }).join('')}</div></div>`;
  }
  /* стрелки зависимостей на диаграмме: FS — конец→начало, SS — начало→начало, FF — конец→конец, SF — начало→конец */
  function linkSvg(M, rows, LW, W, X) {
    const yOf = new Map(); rows.forEach((r, i) => { if (r.task) yOf.set(r.task.id, 51 + i * 34 + 17); });
    const H2 = 51 + rows.length * 34;
    const paths = [];
    rows.forEach(r => { const x = r.task; if (!x) return; (x.deps || []).forEach(d => {
      const p = depOf(d); if (!p || p.active === false) return; const a = M.byId.get(p.id); if (!a || !yOf.has(a.id)) return;
      const startA = p.type === 'SS' || p.type === 'SF', endB = p.type === 'FF' || p.type === 'SF';
      const xa = startA ? X(a.es) : X(a.ef + 1), xb = endB ? X(x.ef + 1) : X(x.es), ya = yOf.get(a.id), yb = yOf.get(x.id);
      const cr = a.crit && x.crit;
      const mx = endB ? Math.max(xa, xb) + 8 : Math.min(xa + 8, xb - 6);
      paths.push(`<path d="M${xa} ${ya} H${mx} V${yb} H${xb}" class="${cr ? 'crit' : ''}" marker-end="url(#ga${cr ? 'c' : ''})"/>`);
    }); });
    if (!paths.length) return '';
    return `<svg class="gt-links" style="left:${LW}px; width:${W}px; height:${H2}px" width="${W}" height="${H2}" aria-hidden="true"><defs><marker id="ga" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--ink-3)"/></marker><marker id="gac" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--crit)"/></marker></defs>${paths.join('')}</svg>`;
  }
  function viewSchedule(M) {
    const P = M.P;
    const cols = gCols(), LW = sum(cols, c => c.w);
    const px = (SCALES[UI.gScale] || 3) * (window.innerWidth < 768 && UI.gScale !== 'week' ? 0.6 : 1);
    const t = T();
    const editBtn = can('schedule') ? `<button class="btn" type="button" data-go="${link(P.id, 'settings', 'schedule')}">${ico('edit')}Изменить график</button>` : '';
    const factBtn = (can('fact') && M.tasks.some(x => !x.ms) ? `<button class="btn primary" type="button" data-x="rep-new">${ico('plus')}Подать ежедневный факт</button>` : '') + (P.source === 'legacy' ? `<a class="btn primary" href="${esc(P.module)}">${ico('edit')}Ввод факта и обновление ГПР</a>` : '') + (secOn(M, 'settings') && M.tasks.some(x => !x.ms) ? `<button class="btn" type="button" data-x="fact-entry" title="Административная корректировка факта на начало журнала">${ico('edit')}Корректировка факта</button>` : '');
    if (!M.tasks.length) return { html: `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end"><div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(P.name)} · реализация</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">График <span class="ac">работ</span></h1></div><div class="hd-r">${editBtn}</div></section>
      <section class="panel"><div class="pad"><div class="empty">Структура графика ещё не задана: добавьте этапы, работы и ключевые вехи в настройках объекта.</div></div></section>` };
    const vis = M.tasks.filter(x => !x.hidden || UI.gHidden);
    const x0 = monthStart(Math.min(...vis.concat(M.tasks).map(x => Math.min(x.s0, x.es))) - 10), x1 = monthEnd(Math.max(...vis.concat(M.tasks).map(x => Math.max(x.f0, x.ef))) + 20);
    const W = Math.round((x1 - x0 + 1) * px);
    const X = d => Math.round((d - x0) * px);
    const rows = [];
    const f = UI.gFilter;
    M.stages.forEach(s => {
      const ts = s.tasks.filter(x => matchG(x, f) && (!x.hidden || UI.gHidden));
      if (!ts.length) return;
      rows.push({ stage: s });
      if (!UI.gCollapsed[P.id + s.id]) ts.forEach(x => rows.push({ task: x }));
    });
    // шкала
    const t1 = [], t2 = [];
    for (let m = monthStart(x0); m <= x1; m = addMonths(m, 1)) {
      const d = new Date(m * 864e5), mo = d.getUTCMonth(), y = d.getUTCFullYear();
      if (UI.gScale === 'week' || UI.gScale === 'day') t1.push({ x: X(m), l: F.MONTHS_FULL[mo] + ' ' + y });
      else if (mo === 0 || m === monthStart(x0)) t1.push({ x: X(m), l: String(y) });
      if (UI.gScale === 'year') { if (mo % 3 === 0) t2.push({ x: X(m), l: 'Q' + (mo / 3 + 1) }); }
      else if (UI.gScale === 'quarter') { if (mo % 3 === 0) t2.push({ x: X(m), l: F.MONTHS[mo] }); }
      else if (UI.gScale === 'month') t2.push({ x: X(m), l: F.MONTHS[mo] });
    }
    if (UI.gScale === 'week') { for (let d = x0 - ((x0 + 3) % 7 + 7) % 7; d <= x1; d += 7) if (d >= x0) t2.push({ x: X(d), l: fds(d) }); }
    if (UI.gScale === 'day') { for (let d = x0; d <= x1; d++) t2.push({ x: X(d), l: String(new Date(d * 864e5).getUTCDate()) }); }
    const grid = t2.map(k => `<span class="gt-grid" style="left:${k.x}px"></span>`).join('');
    const cell = (c, v, extra) => `<div class="gt-c ${c.k === 'name' ? 'gt-name' : ''}" style="width:${c.w}px;${extra || ''}">${v}</div>`;
    const rowHtml = r => {
      if (r.stage) {
        const s = r.stage, collapsed = UI.gCollapsed[P.id + s.id];
        const L = cols.map(c => {
          if (c.k === 'name') return cell(c, `<button class="tw" type="button" data-act="gtoggle" data-sid="${s.id}" aria-expanded="${!collapsed}" aria-label="Свернуть этап">${ico('chevd')}</button><span class="nt">${esc(s.name)}</span>`);
          if (c.k === 'ps') return cell(c, fds(s.s0) + '.' + iso(s.s0).slice(2, 4));
          if (c.k === 'pf') return cell(c, fds(s.f0) + '.' + iso(s.f0).slice(2, 4));
          if (c.k === 'as') return cell(c, s.as != null ? fds(s.as) + '.' + iso(s.as).slice(2, 4) : '—');
          if (c.k === 'af') return cell(c, (s.af != null ? '' : '~') + fds(s.ef) + '.' + iso(s.ef).slice(2, 4));
          if (c.k === 'pct') return cell(c, Math.round(s.pct) + '%');
          if (c.k === 'dev') return cell(c, s.slip > 0 ? '+' + s.slip : s.slip < 0 ? '−' + (-s.slip) : '0', s.slip > 3 ? 'color:var(--warn-ink)' : '');
          if (c.k === 'st') return cell(c, s.done ? chip('Завершён', 'good') : s.state === 'active' ? chip('В работе', s.slip > 14 ? 'crit' : s.slip > 3 ? 'warn' : 'accent') : chip('Не начат', 'neutral'));
          return cell(c, '');
        }).join('');
        const R = `<span class="gb gb-base" style="left:${X(s.s0)}px; width:${Math.max(2, X(s.f0 + 1) - X(s.s0))}px"></span><span class="gb gb-stg" style="left:${X(s.es)}px; width:${Math.max(3, X(s.ef + 1) - X(s.es))}px"><i style="width:${s.pct}%"></i></span>`;
        return `<div class="gt-row stg"><div class="gt-l" style="width:${LW}px">${L}</div><div class="gt-r" style="width:${W}px">${grid}${R}</div></div>`;
      }
      const x = r.task;
      const L = cols.map(c => {
        if (c.k === 'name') return cell(c, `<span style="width:22px; flex:none"></span>${x.crit ? '<span class="cp" title="Критический путь"></span>' : ''}<span class="nt" title="${esc(x.name)}${x.qty ? ' · ' + num(x.qtyFact || 0) + ' из ' + num(x.qty) + ' ' + esc(x.unit || '') : ''}">${x.hidden ? '<span class="faint">(скрыта) </span>' : ''}${esc(x.name)}</span>`);
        if (c.k === 'ps') return cell(c, x.ms ? '' : fd(x.s0).slice(0, 6) + fd(x.s0).slice(8));
        if (c.k === 'pf') return cell(c, fd(x.f0).slice(0, 6) + fd(x.f0).slice(8));
        if (c.k === 'as') return cell(c, x.ms ? '' : x.as != null ? fd(x.as).slice(0, 6) + fd(x.as).slice(8) : '—', x.as == null ? 'color:var(--ink-3)' : '');
        if (c.k === 'af') return cell(c, x.af != null ? fd(x.af).slice(0, 6) + fd(x.af).slice(8) : '~' + fd(x.ef).slice(0, 6) + fd(x.ef).slice(8), x.af == null ? 'color:var(--ink-2)' : '');
        if (c.k === 'pct') return cell(c, x.ms ? (x.af != null ? '✓' : '') : Math.round(x.pct) + '%');
        if (c.k === 'dev') return cell(c, x.slip > 0 ? '+' + x.slip : x.slip < 0 ? '−' + (-x.slip) : '0', x.slip > 14 ? 'color:var(--crit)' : x.slip > 3 ? 'color:var(--warn-ink)' : x.slip < 0 ? 'color:var(--good)' : '');
        if (c.k === 'st') return cell(c, chip(x.st.t, x.st.c));
        return cell(c, '');
      }).join('');
      let R;
      if (x.ms) {
        const done = x.af != null;
        R = `<span class="gb gb-msp" style="left:${X(x.f0)}px" title="План ${fd(x.f0)}"></span>` +
          (done || x.ef !== x.f0 ? `<span class="gb gb-ms" style="left:${X(done ? x.af : x.ef)}px; background:${done ? 'var(--good)' : stVar(x.st.c === 'neutral' ? 'accent' : x.st.c)}" title="${done ? 'Факт' : 'Прогноз'} ${fd(done ? x.af : x.ef)}"></span>` : '') +
          `<span class="gb-lbl" style="left:${Math.max(X(x.f0), X(done ? x.af : x.ef)) + 12}px">${fds(done ? x.af : x.ef)}${!done && x.slip > 0 ? ' · +' + x.slip + ' дн.' : ''}</span>`;
      } else {
        const done = x.state === 'done';
        const fill = done ? 'var(--good)' : x.st.c === 'crit' ? 'var(--crit)' : x.st.c === 'warn' ? 'var(--warn)' : 'var(--accent)';
        const bg = done ? 'var(--good)' : x.state === 'active' ? 'color-mix(in srgb, ' + fill + ' 24%, var(--surface))' : 'var(--track)';
        const left = X(x.es), w = Math.max(3, X(x.ef + 1) - X(x.es));
        R = `<span class="gb gb-base" style="left:${X(x.s0)}px; width:${Math.max(2, X(x.f0 + 1) - X(x.s0))}px" title="План ${fd(x.s0)} – ${fd(x.f0)}"></span>` +
          `<span class="gb gb-main ${x.crit ? 'gb-crit' : ''}" style="left:${left}px; width:${w}px; background:${bg}"><i style="width:${done ? 100 : x.pct}%; background:${fill}"></i></span>` +
          (x.ef > x.f0 && !done ? `<span class="gb gb-ext" style="left:${X(x.f0 + 1)}px; width:${Math.max(2, X(x.ef + 1) - X(x.f0 + 1))}px" title="Сдвиг к плану +${x.slip} дн."></span>` : '') +
          `<span class="gb-lbl" style="left:${left + w + 8}px">${x.ms ? '' : Math.round(x.pct) + '%'}${x.slip > 3 && !done ? ' · +' + x.slip + ' дн.' : ''}</span>`;
      }
      return `<div class="gt-row ${UI.sel === x.id ? 'sel' : ''}" data-task="${x.id}"><div class="gt-l" style="width:${LW}px">${L}</div><div class="gt-r" style="width:${W}px">${grid}${R}</div></div>`;
    };
    const counts = Object.fromEntries(GFILTERS.map(([k]) => [k, M.tasks.filter(x => matchG(x, k)).length]));
    const html = `
    <section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
      <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(M.P.name)} · реализация</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">График <span class="ac">работ</span></h1>
      <div class="muted" style="margin-top:6px; font-size:13px">Готовность ${pct(M.root.pc)} при плане ${pct(M.root.planNow)} · прогноз ввода ${fd(M.root.forecastEnd)} ${M.root.delay == null ? '' : M.root.delay > 0 ? chip('+' + M.root.delay + ' дн.', M.status.schedule) : chip('в срок', 'good')}</div></div>
      <div class="hd-r">${factBtn}${editBtn}</div>
    </section>
    <section class="panel">
      <header style="flex-wrap:wrap; gap:8px"><h2>${gMode() === 'list' ? 'Список работ' : 'Диаграмма Ганта'}</h2><span class="sub">${M.tasks.length} ${plural(M.tasks.length, 'позиция', 'позиции', 'позиций')} · ${M.stages.length} ${plural(M.stages.length, 'этап', 'этапа', 'этапов')}</span><span class="grow"></span>
        <div class="seg sm" role="group" aria-label="Вид графика"><button type="button" data-act="gmode" data-m="list" aria-pressed="${gMode() === 'list'}">${ico('list')}Список</button><button type="button" data-act="gmode" data-m="gantt" aria-pressed="${gMode() === 'gantt'}">${ico('gantt')}Гант</button></div></header>
      ${DSF.scheduleNotice ? DSF.scheduleNotice(M) : ''}
      <div class="gt-tools">
        <div class="fchips" role="group" aria-label="Фильтр работ">${GFILTERS.map(([k, tt]) => `<button class="fchip" type="button" data-gf="${k}" aria-pressed="${UI.gFilter === k}">${tt} <b>${counts[k]}</b></button>`).join('')}</div>
        <span class="grow"></span>
        <div class="seg sm" role="group" aria-label="Масштаб">${[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['quarter', 'Квартал'], ['year', 'Год']].map(([k, tt]) => `<button type="button" data-gs="${k}" aria-pressed="${UI.gScale === k}">${tt}</button>`).join('')}</div>
        <button class="btn sm" type="button" data-act="glinks" aria-pressed="${UI.gLinks !== false}">${ico('link')}Связи</button>
        <button class="btn sm" type="button" data-act="gcols" title="Показать или скрыть колонки дат">${ico('layers')}${UI.gCols != null ? (UI.gCols ? 'Кратко' : 'Все колонки') : (window.innerWidth >= 1500 ? 'Кратко' : 'Все колонки')}</button>
        <button class="btn sm" type="button" data-act="gtoday">${ico('target')}Сегодня</button>
        ${M.tasks.some(x => x.hidden) ? `<button class="btn sm" type="button" data-act="ghidden">${ico(UI.gHidden ? 'eyeoff' : 'eye')}${UI.gHidden ? 'Без скрытых' : 'Скрытые: ' + M.tasks.filter(x => x.hidden).length}</button>` : ''}
      </div>
      ${gMode() === 'list' ? schedList(M, rows) : `      <div class="gt-scroll" id="gt-scroll">
        <div class="gt-inner" style="width:${LW + W}px">
          <div class="gt-head"><div class="gt-lh" style="width:${LW}px; height:50px">${cols.map(c => `<div class="gt-c" style="width:${c.w}px; ${c.k === 'name' ? 'text-align:left; padding-left:12px' : ''}">${c.t}</div>`).join('')}</div>
            <div class="gt-th" style="width:${W}px"><div class="t1">${t1.map(k => `<span style="left:${k.x}px">${k.l}</span>`).join('')}</div><div class="t2">${t2.map(k => `<span style="left:${k.x}px">${k.l}</span>`).join('')}</div></div></div>
          ${rows.length ? rows.map(rowHtml).join('') : `<div class="empty" style="width:${LW}px">Работ с таким статусом нет.</div>`}
          ${UI.gLinks !== false ? linkSvg(M, rows, LW, W, X) : ''}
          <div style="position:absolute; top:0; bottom:0; left:${LW + X(t)}px; width:2px; margin-left:-1px; background:var(--signal, var(--accent)); z-index:4; pointer-events:none"></div>
          <div style="position:absolute; top:52px; left:${LW + X(t)}px; transform:translateX(-50%); z-index:5; pointer-events:none" class="today-pill">${fds(t)}</div>
        </div>
      </div>
`}
      <div class="gt-legend legend" ${gMode() === 'list' ? 'hidden' : ''}>
        <span><i style="background:var(--good)"></i>Выполнено</span><span><i style="background:var(--accent)"></i>В работе</span><span><i style="background:var(--warn)"></i>Отставание</span><span><i style="background:var(--track)"></i>Прогноз будущих работ</span>
        <span><i style="height:3px;background:var(--ink-3)"></i>План (базовый)</span><span><i style="background:transparent;border:1.5px dashed var(--warn)"></i>Сдвиг к плану</span><span><i style="background:transparent;box-shadow:inset 0 0 0 1.5px var(--crit)"></i>Критический путь</span>
        <span><i style="width:10px;height:10px;transform:rotate(45deg);background:var(--good);border-radius:2px"></i>Веха</span>
      </div>
    </section>
    <div class="grid2">
      <section class="panel">
        <header><h2>Динамика готовности</h2><span class="sub">план, факт и прогноз, % ${M.root.mode === 'cost' ? 'по стоимости работ' : M.root.mode === 'weight' ? 'по весовым коэффициентам' : M.root.mode === 'external' ? 'расчёт объекта: ' + esc(M.root.source || '') : 'вносится вручную'}</span></header>
        <div class="pad">${!M.curve.length ? `<div class="empty">${M.root.mode === 'manual' ? 'Готовность вносится вручную: ' + pct(M.root.pc) + ' при плане ' + pct(M.root.planNow) + '.' : 'Кривая готовности строится после настройки правил расчёта готовности.'}</div>` : lineChart({
          w: CW(), h: CH(), x0: M.curve[0].t - 20, x1: M.curve[M.curve.length - 1].t, y0: 0, y1: 100, yTicks: [0, 25, 50, 75, 100], yFmt: v => v + '%', label: 'Кривая готовности',
          series: [
            { name: 'План', color: 'var(--ink-3)', pts: M.curve.map(c => [c.t, c.plan]), dash: '5 5', width: 2 },
            { name: 'Прогноз', color: 'var(--warn)', pts: [[M.curveT.t, M.curveT.fc]].concat(M.curve.filter(c => c.fc != null && c.t > M.T).map(c => [c.t, c.fc])), dash: '2 4', width: 2.25 },
            { name: 'Факт', color: 'var(--good)', pts: M.curve.filter(c => c.fact != null).map(c => [c.t, c.fact]).concat([[M.curveT.t, M.curveT.fact]]), area: true, end: true, width: 2.75 }
          ],
          marks: [{ t: M.T, label: 'сегодня', color: 'var(--accent)' }, { t: M.root.planEnd, label: 'ввод (план)', color: 'var(--ink-3)', dash: 1, row: 1 }, ...(M.root.forecastEnd !== M.root.planEnd ? [{ t: M.root.forecastEnd, label: 'прогноз', color: 'var(--warn)', dash: 1 }] : [])]
        })}</div>
      </section>
      <section class="panel">
        <header><h2>Ресурсы</h2><span class="sub">численность и техника — в разделе «Ресурсы»</span></header>
        <div class="pad"><div class="res3" style="margin-bottom:12px"><div><div class="l">Рабочие</div><div class="v">${num(M.res.now)}</div></div><div><div class="l">ИТР</div><div class="v">${M.res.itrNow != null ? num(M.res.itrNow) : '—'}</div></div><div><div class="l">Техника</div><div class="v">${M.res.equipment.length ? num(M.res.equipTotal) + '<small> ед.</small>' : '—'}</div></div></div>
          ${secOn(M, 'resources') ? `<button class="btn sm" type="button" data-go="${link(M.P.id, 'resources', 'wf')}">${ico('users')}График движения рабочей силы</button>` : ''}</div>
      </section>
    </div>`;
    return { html, after: () => { const sc = document.getElementById('gt-scroll'); if (sc && UI.gScrollToday !== false) { sc.scrollLeft = Math.max(0, X(t) - (sc.clientWidth - LW) / 2); } UI.gScrollToday = true; } };
  }
  /* работа подрядчика, вошедшего в систему (для остальных ролей — любая) */
  const mine = x => DSF.auth.role !== 'contractor' || (!!x.contract && x.contractor === DSF.auth.org());
  function quickCard(M, x) {
    const c = x.contract ? M.contractBy.get(x.contract) : null;
    const rs = M.risks.filter(r => r.eff.task === x.id);
    const ph = M.photos.filter(p => p.task && p.task.id === x.id);
    const ev = M.events.filter(e => e.task && e.task.id === x.id && !String(e.id).match(/^(s|f|ms)-/));
    return `<div class="qc" role="dialog" aria-label="${esc(x.name)}">
      <div class="qc-h"><div style="flex:1; min-width:0"><div class="eyebrow">${esc(x.stage)}</div><h3 style="margin-top:4px">${esc(x.name)}</h3></div><button class="icon-btn" type="button" data-act="qc-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="fchips">${chip(x.st.t, x.st.c)}${x.crit ? chip('Критический путь', 'crit') : x.state !== 'done' && isFinite(x.float) ? chip('Резерв ' + x.float + ' дн.', 'neutral') : ''}</div>
      ${x.ms ? '' : `<div class="minib"><span class="bar"><i style="width:${x.pct}%; --c:${x.state === 'done' ? 'var(--good)' : 'var(--accent)'}"></i><b style="left:${x.planNow}%"></b></span><b>${Math.round(x.pct)}%</b></div>`}
      <dl class="kv">
        <dt>План</dt><dd>${x.ms ? fd(x.f0) : fd(x.s0) + ' – ' + fd(x.f0)}</dd>
        ${x.ms ? `<dt>${x.af != null ? 'Факт' : 'Прогноз'}</dt><dd>${fd(x.af != null ? x.af : x.ef)}</dd>` : `<dt>Факт начало</dt><dd>${x.as != null ? fd(x.as) : '—'}</dd><dt>${x.af != null ? 'Факт окончание' : 'Прогноз окончания'}</dt><dd>${fd(x.af != null ? x.af : x.ef)}</dd><dt>План на ${fds(T())}</dt><dd>${pct(x.planNow)}</dd>`}
        <dt>Отклонение</dt><dd style="color:${x.slip > 14 ? 'var(--crit)' : x.slip > 3 ? 'var(--warn-ink)' : 'inherit'}">${x.slip > 0 ? '+' + days(x.slip) : x.slip < 0 ? '−' + days(-x.slip) : 'нет'}</dd>
        ${x.qty ? `<dt>Объём</dt><dd>${num(x.qtyFact || 0, 1)} из ${num(x.qty, 1)} ${esc(x.unit || '')}${x.qtyPlan != null ? ' · план на дату ' + num(x.qtyPlan, 1) : ''}</dd>` : ''}
        ${x.directive != null ? `<dt>Директивный срок</dt><dd style="color:${x.af == null && x.ef > x.directive ? 'var(--crit)' : 'inherit'}">${fd(x.directive)}</dd>` : ''}
        ${x.comment ? `<dt>Комментарий</dt><dd>${esc(x.comment)}</dd>` : ''}
        ${x.cost ? `<dt>Стоимость</dt><dd>${money(x.cost)}</dd>` : ''}
        ${c ? `<dt>Договор</dt><dd>${esc(c.no)} · ${esc(c.contractor)}</dd>` : !x.ms && M.contracts.length ? '<dt>Договор</dt><dd class="faint">ещё не заключён</dd>' : ''}
        ${x.extra ? `<dt>Влияние рисков</dt><dd style="color:var(--crit)">+${x.extra} дн.</dd>` : ''}
      </dl>
      ${rs.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Связанные риски</div>${rs.map(r => `<div style="font-size:12.5px; margin-bottom:4px">${chip(r.status, r.realized ? 'crit' : 'neutral')} ${esc(r.title)}${r.eff.days ? ' · +' + r.eff.days + ' дн.' : ''}</div>`).join('')}</div>` : ''}
      ${ev.length ? `<div><div class="eyebrow" style="margin-bottom:6px">События</div>${ev.map(e => `<div style="font-size:12.5px; margin-bottom:3px"><span class="num faint">${fd(e.date)}</span> · ${esc(e.title)}</div>`).join('')}</div>` : ''}
      ${docsOfTask(M, x)}
      <button class="btn sm" type="button" data-x="work" data-id="${x.id}">${ico('target')}Почему так — карточка работы</button>
      ${ph.length ? `<div class="thumbs">${ph.slice(0, 2).map(p => photoCard(M, p)).join('')}</div>` : ''}
      ${(can('fact') && !x.ms) || can('schedule') || can('corr_req') ? `<div class="fchips">${can('fact') && !x.ms && !x.done && mine(x) ? `<button class="btn sm primary" type="button" data-x="rep-new">${ico('plus')}Подать факт</button>` : ''}${can('corr_req') && !x.ms && !x.done && mine(x) ? `<button class="btn sm" type="button" data-x="corr-new" data-id="${x.id}">${ico('swap')}Запросить корректировку срока</button>` : ''}${can('schedule') ? `<button class="btn sm" type="button" data-x="task-edit" data-id="${x.id}">${ico('edit')}Изменить работу</button>` : ''}</div>` : ''}
      ${DSF.auth.role === 'contractor' && !mine(x) && !x.ms ? '<div class="faint" style="font-size:12px">Работа другого исполнителя — показана информационно.</div>' : ''}
    </div>`;
  }
  function docsOfTask(M, x) {
    const ds = (M.documents || []).filter(d => d.taskIds.includes(x.id) && (M.docCats || DSF.DOC_CATS)[d.cat]);
    const c = x.contract ? M.contractBy.get(x.contract) : null;
    const grp = cat => ds.filter(d => d.cat === cat);
    const row = d => `<button class="qlink" type="button" data-go="${link(M.P.id, 'docs', d.id)}"><b>${esc((M.docCats || DSF.DOC_CATS)[d.cat].t)}</b> ${esc(d.code)} <span class="faint">· ${esc(d.cur ? 'ред. ' + d.cur.rev + ' · ' : '')}${esc(DSF.docStatusLabel(d, d.state))}${d.prod ? ' · в производстве ред. ' + esc(d.prod.rev) : ''}</span></button>`;
    const ks = c ? c.ks.slice(-2).reverse() : [];
    const rg = DSF.regdocsOf ? DSF.regdocsOf(M).filter(d => (d.tasks || []).includes(x.id)) : [];
    if (!ds.length && !ks.length && !rg.length) return '';
    return `<div><div class="eyebrow" style="margin-bottom:6px">Документы по работе</div>
      ${['rd', 'pd', 'id'].map(cat => grp(cat).map(row).join('')).join('')}
      ${rg.map(d => `<button class="qlink" type="button" data-go="${link(M.P.id, 'docs', d.id)}"><b>${esc(d.kind === 'aosr' ? 'АОСР' : d.kind === 'rd' ? 'РД' : d.kind === 'scheme' ? 'Схема' : d.kind === 'journal' ? 'Журнал' : 'Док.')}</b> ${esc(d.code || d.title)}</button>`).join('')}
      ${ks.map(k => `<button class="qlink" type="button" data-go="${link(M.P.id, 'budget', k.id)}"><b>КС</b> ${esc(c.no)} · ${esc(k.no)} <span class="faint">· ${esc((DSF.KS_STATUS[k.status] || {}).t || '')}</span></button>`).join('')}
    </div>`;
  }

  /* ---------- фото ---------- */
  function viewPhotos(M) {
    const P = M.P;
    const stOf = p => p.stage || (p.task ? p.task.stage : '') || '';
    const stages = [...new Set(M.photos.map(stOf).filter(Boolean))];
    const cats = [...new Set(M.photos.map(p => p.cat).filter(Boolean))];
    const sel = UI.photoStage;
    const list = M.photos.filter(p => sel === 'all' || stOf(p) === sel || p.cat === sel);
    const groups = [];
    list.forEach(p => { const k = iso(p.d).slice(0, 7); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, d: p.d, items: [] }); g.items.push(p); });
    const ds = M.photos.some(p => !String(p.file).startsWith('u:'));
    const html = `
    <section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
      <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(P.name)} · фотохроника</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Фото <span class="ac">со стройки</span></h1>
      <div class="muted" style="margin-top:6px; font-size:13px">${M.photos.length} ${plural(M.photos.length, 'снимок', 'снимка', 'снимков')} · фото привязаны к дате съёмки, этапу и работе графика</div></div>
      <div class="hd-r">${can('data') ? `<button class="btn primary" type="button" data-x="photo-upload">${ico('upload')}Загрузить фото</button>` : ''}</div>
    </section>
    ${M.photos.length ? `<div class="fchips" role="group" aria-label="Этапы и категории">${[['all', 'Все', M.photos.length]].concat(stages.map(s => [s, s, M.photos.filter(p => stOf(p) === s).length])).concat(cats.filter(c => !stages.includes(c)).map(c => [c, c, M.photos.filter(p => p.cat === c).length])).map(([k, tt, n]) => `<button class="fchip" type="button" data-ps="${esc(k)}" aria-pressed="${sel === k}">${esc(tt)} <b>${n}</b></button>`).join('')}</div>
    <section class="panel"><header><h2>Хроника</h2><span class="sub">от новых к старым</span></header><div class="pad"><div class="pgrid">${groups.map(g => { const d = new Date(g.d * 864e5); return `<div class="eyebrow" style="grid-column:1/-1; margin-top:6px">${F.MONTHS_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${g.items.length} ${plural(g.items.length, 'снимок', 'снимка', 'снимков')}</div>` + g.items.map(p => photoCard(M, p)).join(''); }).join('') || '<div class="empty">Нет фото с таким фильтром.</div>'}</div></div></section>`
      : `<section class="panel"><div class="pad"><div class="empty">Фотографий пока нет.</div></div></section>`}
    ${ds ? '<p class="credit">Фотографии датасетов — Unsplash (лицензия Unsplash), авторы указаны в просмотре. Подписи и привязка к работам вымышлены.</p>' : ''}`;
    return { html };
  }
  function viewer(M, file) {
    const list = M.photos, i = list.findIndex(p => p.file === file);
    if (i < 0) return '';
    const p = list[i], up = String(p.file).startsWith('u:');
    return `<div class="viewer" role="dialog" aria-label="Просмотр фото">
      <div class="vt"><div style="min-width:0"><div style="font-weight:680">${esc(p.caption)}</div><div style="font-size:12.5px; color:#A4B1C5">${fd(p.d)} · ${esc(M.P.name)}</div></div>${up && can('data') ? `<button class="x" type="button" data-x="photo-edit" data-file="${esc(p.file)}" aria-label="Изменить">${ico('edit')}</button>` : ''}<button class="x" type="button" data-act="v-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="vi"><img src="${photoUrl(p.file)}" alt="${esc(p.caption)}">
        ${list.length > 1 ? `<button class="nav" type="button" data-vnav="${list[(i - 1 + list.length) % list.length].file}" style="left:12px" aria-label="Предыдущее">${ico('left')}</button><button class="nav" type="button" data-vnav="${list[(i + 1) % list.length].file}" style="right:12px" aria-label="Следующее">${ico('right')}</button>` : ''}</div>
      <div class="vc">${p.stage || p.task ? `<span>Этап: <b>${esc(p.stage || p.task.stage)}</b></span>` : ''}${p.task ? `<span>Работа: <b>${esc(p.task.name)}</b> · ${Math.round(p.task.pct)}% сейчас</span>` : ''}${p.cat ? `<span>Категория: <b>${esc(p.cat)}</b></span>` : ''}${p.desc ? `<span>${esc(p.desc)}</span>` : ''}<span>${i + 1} из ${list.length}</span><span>Фото: ${esc(p.author || '—')}${up ? '' : ' / Unsplash'}</span></div>
    </div>`;
  }
  /* ---------- риски ---------- */
  function viewRisks(M) {
    const P = M.P;
    const cell = UI.riskCell;
    const flt = UI.riskFilter;
    let list = M.risks.filter(r => flt === 'all' ? true : flt === 'active' ? r.active : flt === 'realized' ? r.realized : !r.active);
    if (cell) list = list.filter(r => r.p === cell[0] && r.i === cell[1]);
    list.sort((a, b) => (b.realized - a.realized) || (b.score - a.score));
    const mxColor = (p, i) => { const s = p * i; return s >= 15 ? 'var(--crit-soft)' : s >= 8 ? 'var(--warn-soft)' : 'var(--good-soft)'; };
    const act = M.risks.filter(r => r.active);
    const html = `
    <section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
      <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(P.name)} · управление рисками</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Риски <span class="ac">и решения</span></h1>
      <div class="muted" style="margin-top:6px; font-size:13px">Реализующиеся риски автоматически сдвигают работы графика и добавляются в прогноз стоимости.</div></div>
      <div class="hd-r">${can('data') ? `<button class="btn primary" type="button" data-x="risk-new">${ico('plus')}Риск или проблема</button>` : ''}</div>
    </section>
    <section class="tiles">
      <div class="tile ${M.highRisks.length ? 'crit' : 'good'}"><div class="eyebrow">Высокие</div><div class="v">${M.highRisks.length}</div><div class="s">оценка 15–25</div></div>
      <div class="tile ${M.midRisks.length ? 'warn' : ''}"><div class="eyebrow">Средние</div><div class="v">${M.midRisks.length}</div><div class="s">оценка 8–14</div></div>
      <div class="tile"><div class="eyebrow">Низкие</div><div class="v">${act.filter(r => r.level === 'low').length}</div><div class="s">оценка до 7</div></div>
      <div class="tile ${M.risks.some(r => r.realized) ? 'crit' : ''}"><div class="eyebrow">Реализуются</div><div class="v">${M.risks.filter(r => r.realized).length}</div><div class="s">${M.risks.filter(r => r.realized && r.projectDays).length ? 'сдвиг ввода +' + sum(M.risks.filter(r => r.realized), r => r.projectDays) + ' дн.' : 'без сдвига ввода'}</div></div>
      <div class="tile"><div class="eyebrow">Стоимостная оценка</div><div class="v">${money(sum(M.risks.filter(r => r.realized), r => r.eff.cost || 0))}</div><div class="s">в прогнозе · ещё ${money(M.fin.riskOpenCost)} потенциально</div></div>
    </section>
    <div class="grid2 rk">
      <section class="panel">
        <header><h2>Карта рисков</h2><span class="sub">вероятность × влияние</span></header>
        <div class="pad">
          <div class="matrix" role="group" aria-label="Матрица рисков">
            ${[5, 4, 3, 2, 1].map(p => `<div class="ax">${p}</div>` + [1, 2, 3, 4, 5].map(i => { const n = act.filter(r => r.p === p && r.i === i).length; return `<button class="mx ${n ? 'has' : ''}" type="button" ${n ? `data-rc="${p},${i}"` : 'disabled'} aria-pressed="${!!(cell && cell[0] === p && cell[1] === i)}" style="background:${mxColor(p, i)}" title="Вероятность ${p}, влияние ${i}">${n || ''}</button>`; }).join('')).join('')}
            <div></div>${[1, 2, 3, 4, 5].map(i => `<div class="ax">${i}</div>`).join('')}
          </div>
          <div class="legend" style="margin-top:10px"><span>↑ вероятность</span><span>→ влияние</span>${cell ? `<button class="lnk" type="button" data-rc="">Сбросить выбор</button>` : ''}</div>
        </div>
      </section>
      <section class="panel">
        <header><h2>Поручения по рискам</h2><span class="sub">мероприятия, поставленные протоколами</span><span class="grow"></span><button class="lnk" type="button" data-go="${link(P.id, 'orders')}">Все поручения ${ico('chev')}</button></header>
        <div class="pad"><div class="list">${M.orders.filter(o => o.riskId).map(o => `<button class="li btnrow" type="button" data-go="${link(P.id, 'orders', o.id)}"><span class="t">${esc(o.text)}</span>${chip(DSF.ORDER_STATUS[o.status].t, DSF.ORDER_STATUS[o.status].c)}<span class="m">№ ${esc(o.no)} · ${esc(o.owner)} · срок ${fd(o.due)} · риск: ${esc((M.risks.find(r => r.id === o.riskId) || {}).title || '')}</span></button>`).join('') || '<div class="empty">Поручений по рискам нет.</div>'}</div>
          <div class="eyebrow" style="margin:16px 0 4px">Управленческие решения</div>
          <div class="feed">${(P.decisions || []).map(x => feedRow(dn(x.date), 'var(--ink)', esc(x.title), x.by)).join('')}</div></div>
      </section>
    </div>
    <section class="panel">
      <header><h2>Реестр рисков</h2><span class="grow"></span><div class="seg sm" role="group" aria-label="Статус">${[['active', 'Активные'], ['realized', 'Реализуются'], ['closed', 'Закрытые'], ['all', 'Все']].map(([k, tt]) => `<button type="button" data-rf="${k}" aria-pressed="${flt === k}">${tt}</button>`).join('')}</div></header>
      <div class="pad"><div class="rcards">${list.length ? list.map(r => `<article class="rcard"><span class="sv" style="background:${stVar(levelColor(r.level))}"></span><div>
        <div class="rh"><h3>${esc(r.title)}</h3>${r.kind === 'issue' ? chip('Проблемный вопрос', 'warn') : ''}${chip(r.status, r.realized ? 'crit' : r.active ? 'neutral' : 'good')}${chip('P' + r.p + ' × I' + r.i + ' = ' + r.score + ' · ' + levelName(r.level), levelColor(r.level))}${can('data') ? `<button class="mini" type="button" data-x="risk-edit" data-id="${esc(r.id)}" aria-label="Изменить" title="Изменить">${ico('edit', 15)}</button>` : ''}</div>
        ${r.desc ? `<p class="muted" style="margin:6px 0 0; font-size:13px">${esc(r.desc)}</p>` : ''}
        <div class="rm">${r.cat ? `<span>Категория: <b>${esc(r.cat)}</b></span>` : ''}<span>Ответственный: <b>${esc(r.owner || '—')}</b></span><span>Контроль: <b>${fd(dn(r.control))}</b></span>${r.due ? `<span>Срок: <b style="color:${dn(r.due) < T() && r.active ? 'var(--crit)' : 'inherit'}">${fd(dn(r.due))}</b></span>` : ''}</div>
        <div class="eff">${r.eff.task && r.task ? `<button class="chip ${r.realized ? 'crit' : 'neutral'}" style="border:0; cursor:pointer" type="button" data-go="${link(P.id, 'schedule')}" data-task="${r.task.id}">${r.eff.days ? (r.realized ? 'Сдвигает' : 'Может сдвинуть') + ' «' + esc(r.task.name) + '» на ' + r.eff.days + ' дн.' : '«' + esc(r.task.name) + '»'}</button>` : ''}${r.realized && r.projectDays ? chip('Ввод объекта: +' + r.projectDays + ' дн.', 'crit') : ''}${r.eff.cost ? chip((r.realized ? 'В прогнозе стоимости: +' : 'Потенциально: +') + money(r.eff.cost), r.realized ? 'warn' : 'neutral') : ''}</div>
        ${r.measures && r.measures.length ? `<ul>${r.measures.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
        ${(r.docs || []).length || (r.photos || []).length ? `<div class="qlinks" style="margin-top:8px">${(r.docs || []).map(id => { const d = M.docBy && M.docBy.get(id); return d ? `<button class="qlink" type="button" data-go="${link(P.id, 'docs', d.id)}"><b>${esc(((M.docCats || DSF.DOC_CATS)[d.cat] || {}).t || 'Док.')}</b> ${esc(d.code || d.title)}</button>` : ''; }).join('')}${(r.photos || []).map(f => { const ph = M.photos.find(x => x.file === f); return ph ? `<button class="qlink" type="button" data-photo="${esc(f)}" data-pid="${P.id}"><b>Фото</b> ${esc(ph.caption)} · ${fd(ph.d)}</button>` : ''; }).join('')}</div>` : ''}
        ${(r.comments || []).length ? `<div class="feed" style="margin-top:8px">${r.comments.map(c => feedRow(dn(c.date), 'var(--ink-3)', esc(c.text), c.by || '')).join('')}</div>` : ''}
      </div></article>`).join('') : '<div class="empty">Рисков с таким фильтром нет.</div>'}</div></div>
    </section>`;
    return { html };
  }

  /* ---------- слои: выбор проекта, проверка данных, меню ---------- */
  function projectSheet(cur) {
    return `<div class="sheet-bg" data-act="sheet-close"><div class="psheet" role="dialog" aria-label="Выбор проекта">
      <div class="ph"><div class="eyebrow">Проекты портфеля</div></div>
      <button class="popt" type="button" data-go="" ${!cur ? 'aria-current="true"' : ''}><span class="logo" style="width:46px;height:46px;border-radius:14px">${ico('layers')}</span><span><div class="pn">Портфель</div><div class="pm">сводка по всем проектам</div></span><span></span></button>
      ${models().map(M => `<button class="popt" type="button" data-go="${link(M.P.id, cur && UI.lastSec && secOn(M, UI.lastSec) ? UI.lastSec : 'overview')}" ${cur === M.P.id ? 'aria-current="true"' : ''}>
        ${ring(46, 5, [{ v: M.root.pc || 0, color: 'var(--good)', tick: M.root.planNow }], `<text x="23" y="27" text-anchor="middle" font-size="11" font-weight="750" fill="var(--ink)" font-family="var(--font-ui)">${M.root.pc == null ? '—' : Math.round(M.root.pc)}</text>`)}
        <span style="min-width:0"><div class="pn">${esc(M.P.name)}</div><div class="pm">${esc([M.P.type, M.phase].filter(Boolean).join(' · '))}</div></span>
        ${M.root.delay == null ? chip('—', 'neutral') : chip(M.root.delay > 0 ? '+' + M.root.delay + ' дн.' : 'в срок', M.status.schedule)}
      </button>`).join('')}
      ${can('create') ? `<button class="popt" type="button" data-go="new"><span class="logo" style="width:46px;height:46px;border-radius:14px; background:var(--accent)">${ico('plus')}</span><span><div class="pn">Добавить объект</div><div class="pm">мастер создания и настройки</div></span><span></span></button>` : ''}
      ${cur ? `<div class="ph" style="padding-top:12px"><div class="eyebrow">Раздел сохранится при переключении</div></div>` : ''}
    </div></div>`;
  }
  function moreSheet(pid) {
    const M = pid ? DSF.build(byId(pid)) : null;
    const opt = (go, ic, t, act) => `<button class="popt" type="button" ${act ? `data-act="${act}"` : `data-go="${go}"`} style="grid-template-columns:32px 1fr auto">${ico(ic, 22)}<span class="pn">${t}</span><span></span></button>`;
    const user = DSF.auth.user(), role = { t: DSF.auth.name(), short: (DSF.ROLES[DSF.auth.role] || {}).short || DSF.auth.name() };
    return `<div class="sheet-bg" data-act="sheet-close"><div class="psheet" role="dialog" aria-label="Разделы">
      ${M ? `<div class="ph"><div class="eyebrow">Разделы объекта</div></div>${opt(link(pid, 'overview'), 'grid', 'Обзор')}
      ${DSF.SECTION_GROUPS.map(([g, ks]) => { const l = ks.filter(k => secOn(M, k)); return l.length ? `<div class="ph" style="padding-top:8px"><div class="eyebrow">${esc(g)}</div></div>` + l.map(k => opt(link(pid, k), secDef(k)[2], esc(secTitle(k)))).join('') : ''; }).join('')}
      ${can('settings') ? opt(link(pid, 'settings'), 'gear', 'Настройки объекта') : ''}` : ''}
      <div class="ph" style="padding-top:8px"><div class="eyebrow">Flow</div></div>
      ${opt('', 'layers', DSF.auth.role === 'contractor' ? 'Мои объекты' : 'Портфель')}
      ${can('corr_dir') || can('corr_tz') ? opt('queue', 'swap', can('corr_dir') ? 'График на корректировку' : 'Корректировки графика') : ''}
      ${can('create') ? opt('new', 'plus', 'Добавить объект') : ''}
      ${can('base') && DSF.mode === 'demo' ? opt('base', 'users', 'База подрядчиков') : ''}
      ${can('admin') ? opt('admin', 'shield', 'Администрирование') : ''}
      ${can('admin') || DSF.auth.role === 'director' ? opt('', 'check', 'Проверка данных', 'checks') : ''}
      <div class="ph" style="padding-top:8px"><div class="eyebrow">${DSF.mode === 'demo' ? 'Демо-режим · ' : ''}${esc(role.t || '')}</div><div class="pm" style="margin-top:4px">${esc(user.name || '')}</div></div>
      ${DSF.mode === 'demo' ? `<button class="popt" type="button" data-x="my-pw" style="grid-template-columns:32px 1fr auto">${ico('lock', 22)}<span class="pn">Сменить пароль</span><span></span></button>` : ''}
      ${opt('', 'back', 'Выйти', 'logout')}
    </div></div>`;
  }
  function checksSheet() {
    return `<div class="sheet-bg" data-act="sheet-close"><div class="psheet" role="dialog" aria-label="Проверка данных" style="width:min(520px,calc(100vw - 24px))">
      <div class="ph"><div class="eyebrow">Проверка целостности данных</div><p class="muted" style="margin-top:6px; font-size:12.5px">Движок проверяет каждый датасет: начатые работы с 0%, проценты без фактического начала, даты в будущем, суммы статей и работ, связи, фото до начала работы и другие противоречия.</p></div>
      ${models().map(M => { const e = M.issues.filter(i => i.level === 'error'), w = M.issues.filter(i => i.level === 'warn'); return `<div class="popt" style="cursor:default; grid-template-columns:1fr auto"><span><div class="pn">${esc(M.P.name)}</div><div class="pm">${M.tasks.length} работ · ${M.contracts.length} договоров · ${M.risks.length} рисков · ${M.events.length} событий · ${M.photos.length} фото</div>${M.issues.slice(0, 4).map(i => `<div class="pm" style="color:${i.level === 'error' ? 'var(--crit)' : 'var(--warn-ink)'}">${esc(i.msg)}</div>`).join('')}</span>${chip(e.length ? e.length + ' ошиб.' : w.length ? w.length + ' предупр.' : 'OK', e.length ? 'crit' : w.length ? 'warn' : 'good')}</div>`; }).join('')}
      <div class="ph" style="margin-top:6px"><div class="eyebrow">Журнал действий</div><p class="muted" style="margin-top:6px; font-size:12.5px">События, документы, поручения, КС-2, корректировки и письма хранятся в журнале объекта отдельно от исходных данных. Журнал только дополняется: ошибочная запись исправляется корректировкой с основанием, история сохраняется.</p></div>
      ${DSF.projects.map(P => { const n = DSF.store ? DSF.store.count(P.id) : 0; return `<div class="popt" style="cursor:default; grid-template-columns:1fr auto"><span><div class="pn">${esc(P.name)}</div><div class="pm">${n ? n + ' ' + plural(n, 'запись', 'записи', 'записей') + ' в журнале' : 'записей нет'}</div></span></div>`; }).join('')}
    </div></div>`;
  }

  /* ---------- отрисовка ---------- */
  function render() {
    const r = route();
    let M = null, v;
    if (r.pid) { M = DSF.build(byId(r.pid)); UI.lastSec = r.sec; }
    if (r.pid && r.sec !== 'overview' && UI.lastKey !== r.pid + r.sec) UI.navOpen = true;
    UI.lastKey = r.pid ? r.pid + r.sec : '';
    sidebar(r);
    if (!M) v = (r.sec !== 'portfolio' && VIEWS[r.sec] ? VIEWS[r.sec] : VIEWS.portfolio)(null, r);
    else if (!secOn(M, r.sec)) v = { html: `<section class="panel" style="margin-top:12px"><div class="pad"><div class="empty">${!DSF.roleSees(r.sec) || r.sec === 'settings' ? 'Раздел «' + esc(secTitle(r.sec)) + '» недоступен для роли «' + esc(DSF.auth.name()) + '».' : 'Раздел «' + esc(secTitle(r.sec)) + '» отключён для этого объекта.'}${can('settings') ? ` <button class="lnk" type="button" data-go="${link(M.P.id, 'settings', 'sections')}">Настроить разделы ${ico('chev')}</button>` : ''}</div></div></section>` };
    else v = (VIEWS[r.sec] || VIEWS.overview)(M, r);
    document.getElementById('app').innerHTML = topbar(r, M, v) + v.html;
    document.title = (M ? M.P.name + ' · ' + (v.crumb || secShort(r.sec)) + ' — ' : (v.title ? v.title + ' — ' : '')) + 'Flow' + (DSF.mode === 'demo' ? ' · демо' : '');
    guard(document.getElementById('app')); guard(document.getElementById('sidebar'));
    renderLayer();
    if (v.after) v.after();
  }
  /* права: элементы действий, недоступных роли, не показываются; обработчики проверяют права повторно */
  const PERM_X = {}, PERM_F = {};
  function guard(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-x]').forEach(el => { const p = PERM_X[el.dataset.x]; if (p && !can(p)) el.remove(); });
    rootEl.querySelectorAll('[data-perm]').forEach(el => { if (!can(el.dataset.perm)) el.remove(); });
  }
  function renderLayer() {
    const r = route(), M = r.pid ? DSF.build(byId(r.pid)) : null;
    let h = '';
    if (UI.sheet === 'switch') h = projectSheet(r.pid);
    else if (UI.sheet === 'more' && r.pid) h = moreSheet(r.pid);
    else if (UI.sheet === 'checks') h = checksSheet();
    else if (UI.sheet === 'more') h = moreSheet(null);
    if (M && UI.sel && r.sec === 'schedule' && M.byId.get(UI.sel)) h += quickCard(M, M.byId.get(UI.sel));
    if (UI.viewer) { const pm = DSF.build(byId(UI.viewer.pid)); h += viewer(pm, UI.viewer.file); }
    if (UI.modal && (M || UI.modal.global)) { try { h += modalFrame(UI.modal.render(M, r), UI.modal.wide); } catch (err) { console.error(err); UI.modal = null; } }
    if (UI.toast) h += `<div class="toast" role="status">${UI.toast.html}</div>`;
    document.getElementById('layer').innerHTML = h;
    guard(document.getElementById('layer'));
    if (UI.modal && UI.modal.focus) { const el = document.querySelector('.modal [autofocus]'); if (el) el.focus(); UI.modal.focus = false; }
  }

  function modalFrame(inner, wide) {
    return `<div class="modal-bg" data-act="modal-close"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${inner}</div></div>`;
  }
  function openModal(render, opt) { UI.modal = Object.assign({ render, focus: true }, opt || {}); renderLayer(); }
  function closeModal() { UI.modal = null; renderLayer(); }
  function toast(html, ms) { UI.toast = { html }; renderLayer(); clearTimeout(toast.t); toast.t = setTimeout(() => { UI.toast = null; renderLayer(); }, ms || 4200); }

  /* ---------- события ---------- */
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const p = PERM_F[f.dataset.form]; if (p && !can(p)) { toast('Недостаточно прав для этого действия.'); return; }
    const fn = FORMS[f.dataset.form]; if (fn) fn(f, route());
  });
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-go],[data-act],[data-gf],[data-gs],[data-ps],[data-rc],[data-rf],[data-photo],[data-vnav],[data-task],[data-x]');
    if (!el) return;
    const r = route();
    const d = el.dataset;
    if (d.act === 'modal-close') { if (e.target === el) closeModal(); return; }
    if (d.x) { e.preventDefault(); const p = PERM_X[d.x]; if (p && !can(p)) { toast('Недостаточно прав для этого действия.'); return; } const fn = ACTIONS[d.x]; if (fn) fn(el, d, r); return; }
    if (d.act === 'sheet-close') { if (e.target === el) { UI.sheet = null; renderLayer(); } return; }
    if (d.photo) { UI.viewer = { pid: d.pid, file: d.photo }; renderLayer(); return; }
    if (d.vnav) { UI.viewer.file = d.vnav; renderLayer(); return; }
    if (d.act) {
      e.preventDefault();
      if (d.act === 'switch' || d.act === 'more' || d.act === 'checks') { UI.sheet = d.act; renderLayer(); return; }
      if (d.act === 'logout') { DSF.logout(); return; }
      if (d.act === 'ghidden') { UI.gHidden = !UI.gHidden; keepScroll(); return; }
      if (d.act === 'theme') {
        const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        const nx = cur === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', nx); LS.set('theme', nx); render(); return;
      }
      if (d.act === 'v-close') { UI.viewer = null; renderLayer(); return; }
      if (d.act === 'qc-close') { UI.sel = null; document.querySelectorAll('.gt-row.sel').forEach(x => x.classList.remove('sel')); renderLayer(); return; }
      if (d.act === 'gtoggle') { const k = r.pid + d.sid; UI.gCollapsed[k] = !UI.gCollapsed[k]; keepScroll(); return; }
      if (d.act === 'gcols') { const full = UI.gCols != null ? UI.gCols : window.innerWidth >= 1500; UI.gCols = !full; keepScroll(); return; }
      if (d.act === 'gtoday') { UI.gScrollToday = true; render(); return; }
      if (d.act === 'gmode') { UI.gMode = d.m; LS.set('gMode', d.m); render(); return; }
      if (d.act === 'glinks') { UI.gLinks = UI.gLinks === false; keepScroll(); return; }
      if (d.act === 'navtoggle') { UI.navOpen = !UI.navOpen; LS.set('navOpen', UI.navOpen); const sub = document.querySelector('.sb-sub-nav'); if (sub) { sub.hidden = !UI.navOpen; el.setAttribute('aria-expanded', UI.navOpen); } return; }
      if (d.act === 'x-close') { closeModal(); return; }
    }
    if (d.gf) { UI.gFilter = d.gf; keepScroll(); return; }
    if (d.gs) { UI.gScale = d.gs; LS.set('gScale', d.gs); UI.gScrollToday = true; render(); return; }
    if (false) { const M = DSF.build(byId(r.pid)); const cur = UI.calMonth[r.pid] != null ? UI.calMonth[r.pid] : monthStart(T()); UI.calMonth[r.pid] = d.cal === '0' ? monthStart(T()) : addMonths(cur, +d.cal); keepPage(); return; }
    if (d.ps) { UI.photoStage = d.ps; keepPage(); return; }
    if (d.rc != null) { UI.riskCell = d.rc ? d.rc.split(',').map(Number) : null; keepPage(); return; }
    if (d.rf) { UI.riskFilter = d.rf; keepPage(); return; }
    if (d.go != null) {
      e.preventDefault();
      UI.sheet = null; UI.modal = null;
      if (d.task) { UI.sel = d.task; UI.gFilter = 'all'; }
      if (d.go === decodeURIComponent((location.hash || '').replace(/^#/, '')) && r.pid) { renderLayer(); if (d.task) focusTask(d.task); return; }
      UI.gScrollToday = !d.task;
      go(d.go);
      if (d.task) setTimeout(() => focusTask(d.task), 30);
      window.scrollTo(0, 0);
      return;
    }
    if (d.task && r.sec === 'schedule') { UI.sel = d.task; document.querySelectorAll('.gt-row').forEach(x => x.classList.toggle('sel', x.dataset.task === d.task)); renderLayer(); }
  });
  document.addEventListener('input', e => { if (INPUTS[e.target.id]) { INPUTS[e.target.id](e); return; } if (e.target.id === 'doc-q') { UI.docQ = e.target.value; const pos = e.target.selectionStart; keepPage(); const el = document.getElementById('doc-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (UI.modal) UI.modal = null; else if (UI.viewer) UI.viewer = null; else if (UI.sheet) UI.sheet = null; else if (UI.sel) UI.sel = null; renderLayer(); }
    if (UI.viewer && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const b = document.querySelector('.viewer .nav[style*="' + (e.key === 'ArrowRight' ? 'right' : 'left') + '"]'); if (b) b.click(); }
  });
  function keepPage() { const y = window.scrollY; render(); window.scrollTo(0, y); }
  function keepScroll() { const sc = document.getElementById('gt-scroll'); const l = sc ? sc.scrollLeft : 0, tp = sc ? sc.scrollTop : 0, y = window.scrollY; UI.gScrollToday = false; render(); const s2 = document.getElementById('gt-scroll'); if (s2) { s2.scrollLeft = l; s2.scrollTop = tp; } window.scrollTo(0, y); }
  function focusTask(id) {
    const row = document.querySelector('.gt-row[data-task="' + id + '"]'), sc = document.getElementById('gt-scroll');
    if (!row || !sc) return;
    row.classList.add('sel');
    sc.scrollTop = Math.max(0, row.offsetTop - 120);
    const bar = row.querySelector('.gb-main,.gb-ms,.gb-msp');
    if (bar) sc.scrollLeft = Math.max(0, bar.offsetLeft - 200);
    sc.scrollIntoView({ block: 'nearest' });
  }
  window.addEventListener('hashchange', () => { UI.sheet = null; UI.modal = null; render(); });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (route().sec === 'schedule') keepScroll(); }, 200); });

  /* ---------- загрузка датасетов по манифесту ---------- */
  function boot() {
    // данные объектов: демо — с сервера по роли (session.js), реальный контур — из рабочих модулей объектов (bridge.js)
    const app = document.getElementById('app');
    const start = () => { const go2 = () => { if (DSF.registry) DSF.registry.apply(); order(); render(); if (DSF.afterBoot) DSF.afterBoot(); }; if (DSF.files) DSF.files.init().then(go2, go2); else go2(); };
    const loader = DSF.mode === 'demo' ? DSF.loadDemo : DSF.loadReal;
    if (!loader) { start(); return; }
    Promise.resolve().then(loader).then(start, e => {
      console.error(e);
      app.innerHTML = `<section class="panel" style="margin-top:40px"><div class="pad"><div class="eyebrow">Flow</div><h2 style="margin-top:8px">Не удалось загрузить данные</h2><p class="muted" style="margin-top:8px">${esc(e && (e.detail || e.message) || 'Ошибка загрузки')}</p><div style="display:flex; gap:10px; margin-top:16px"><button class="btn primary" type="button" onclick="location.reload()">Повторить</button><button class="btn" type="button" data-act="logout">Выйти</button></div></div></section>`;
    });
  }
  function order() {
    const m = DSF.manifest || [], o = DSF.registry && DSF.registry.state ? DSF.registry.state.order : [];
    const rank = id => { const i = m.indexOf(id); if (i >= 0) return i; const j = o.indexOf(id); return 1000 + (j >= 0 ? j : 999); };
    DSF.projects.sort((a, b) => rank(a.id) - rank(b.id));
  }
  const VIEWS = { overview: viewOverview, schedule: viewSchedule, photos: viewPhotos, risks: viewRisks, portfolio: viewPortfolio };
  const ACTIONS = {}, FORMS = {}, INPUTS = {};
  DSF.ui = {
    render, renderLayer, boot, order, UI, VIEWS, ACTIONS, FORMS, INPUTS, SECTIONS, PERM_X, PERM_F, guard,
    h: { miniGantt, models, renderLayer, secDef, secOn, miniRing, can, photoUrl, riskEffectText, levelName, levelColor, quickCard, esc, fd, fds, num, pct, money, bn, plural, days, chip, ico, ring, lineChart, wfBars, spark, stVar, link, go, route, byId, photoCard, feedRow, evColor, budgetStack, stamp, LS, T, CW, CH, keepPage, openModal, closeModal, toast, focusTask, secTitle, secShort, models }
  };
})();
