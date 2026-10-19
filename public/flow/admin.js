/*
 * FLOW — Цифровой штаб строительства. Администрирование объектов через интерфейс.
 *
 *  «Добавить объект» (#new)            — мастер создания: сведения, участники, разделы, график,
 *                                         готовность, бюджет, документация, ресурсы, показатели, риски, фото;
 *  «Настройки объекта» (#<id>.settings) — те же редакторы для уже созданного объекта или датасета;
 *  «Администрирование» (#admin)        — реестр объектов, организации, роли, хранилище, журнал;
 *  внесение данных                       — факт работ, ресурсы недели, значения показателей, фото, риски,
 *                                         доп. соглашения, КС-2 и оплаты по договорам.
 *
 * Все редакторы работают с описанием объекта (модель Project) через DSF.registry: ни одной
 * строки под конкретный объект. Перед сохранением изменение проверяется пробной сборкой
 * модели — правка, создающая противоречие в данных, не сохраняется.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, REG = DSF.registry;
  const { esc, fd, num, chip, ico, link, route, byId, toast, openModal, closeModal, keepPage, plural, money, pct, can, T, go } = H;
  const { dn, iso, sum } = DSF.util;
  const F = DSF.fmt;
  const A = U.ACTIONS, FM = U.FORMS;
  const today = () => iso(T());
  const clone = o => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('__') ? undefined : v)));
  const empty = t => `<div class="empty">${t}</div>`;
  DSF.onStorageError = msg => toast(esc(msg), 6000);

  /* ---------- права на существующие действия ---------- */
  Object.assign(U.PERM_X, {
    'ev-new': 'data', 'ev-edit': 'data', 'ev-del': 'data', 'letter-save': 'data',
    'ord-new': 'data', 'ord-status': 'data', 'ord-done': 'data', 'ord-comment': 'data', 'ord-event': 'data',
    'doc-upload': 'docs', 'doc-act': 'docs', 'ks-new': 'ksgc', 'ks-act': null,
    'rep-new': 'fact', 'rep-fix': 'fact', 'rem-new': 'quality', 'g-new': 'ksgc', 'sig-decide': 'decide',
    'fact-entry': 'settings', 'task-edit': 'schedule', 'res-entry': 'data', 'metric-entry': 'data', 'photo-upload': 'data', 'photo-edit': 'data',
    'risk-new': 'data', 'risk-edit': 'data', 'ct-edit': 'budget', 'ct-supp': 'budget', 'ct-pay': 'budget', 'ct-act': 'budget',
    'rd-mode': 'settings', 'obj-archive': 'admin', 'obj-restore': 'admin', 'obj-delete': 'admin', 'obj-reset': 'settings',
    'cfg-export': 'admin', 'wiz-create': 'create', 'wiz-reset': 'create'
  });
  Object.assign(U.PERM_F, {
    event: 'data', order: 'data', 'ord-done': 'data', 'ord-comment': 'data', upload: 'docs', 'doc-transfer': 'docs', 'doc-note': 'docs',
    'ks-new': 'ksgc', 'ks-result': null, fact: 'settings', rep: 'fact', 'rem-new': 'quality', 'g-new': 'ksgc', 'sig-decide': 'decide', control: 'settings', 'res-entry': 'data', 'metric-entry': 'data', 'photo-upload': 'data',
    main: 'settings', sections: 'settings', weights: 'settings', 'rd-manual': 'settings', budgetcfg: 'budget', photocats: 'settings', 'cfg-import': 'admin'
  });

  /* ====================================================================
   * ЦЕЛЬ РЕДАКТИРОВАНИЯ: черновик мастера или объект реестра
   * ==================================================================== */
  const DRAFT = DSF.key ? DSF.key('wizard-draft') : 'flow-wizard-draft';
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  function newDraft() {
    return { name: '', short: '', type: '', status: 'plan', city: '', address: '', desc: '', params: { extra: [] }, dates: {},
      participants: [], people: [], sections: DSF.SECTION_DEFS.map(s => s.k), stages: [], tasks: [], readiness: { mode: 'weight' },
      finance: 'entered', budget: { reserve: 0, items: [] }, contracts: [], docSections: [], docCats: [], documents: [],
      resources: { weeks: [], plan: [], fact: [], itr: [], equipment: [], byContractor: [], kinds: [] }, metrics: [], metricLog: [],
      risks: [], photos: [], photoCats: [], events: [], protocols: [], orders: [], letters: [], decisions: [], reports: [], remarks: [], control: {} };
  }
  function wiz() { if (!UI.wiz) UI.wiz = lsGet(DRAFT) || { step: 'main', def: newDraft() }; return UI.wiz; }
  const saveDraft = () => lsSet(DRAFT, UI.wiz);
  function tgt() { const r = route(); return r.sec === 'new' ? 'wizard' : r.sec === 'admin' ? 'orgs' : r.pid; }
  function defOf(t) { if (t === 'wizard') return wiz().def; if (t === 'orgs') return REG.state; return REG.def(t); }
  /* модель объекта для предпросмотра и проверки */
  function modelOf(def, id) {
    const P = DSF.normalizeProject(Object.assign({}, def, { id: id || def.id || '__draft' }));
    return DSF.build(P);
  }
  function mutate(t, fn, text) {
    if (t === 'wizard') { fn(wiz().def); saveDraft(); return true; }
    if (t === 'orgs') { fn(REG.state); REG.log(null, text || 'Справочник организаций изменён'); const ok = REG.save(); DSF.projects.forEach(p => { if (p.__reg) REG.applyOne(p.id); }); return ok; }
    const ok = REG.mutate(t, fn, text);
    if (!ok) toast(esc(REG.lastError || 'Не удалось сохранить изменения.'));
    return ok;
  }
  /* пробная сборка: изменение не должно ломать модель и добавлять ошибок данных */
  function trial(t, fn) {
    if (t === 'orgs') return null;
    const before = defOf(t), d = clone(before);
    try { fn(d); } catch (e) { return 'Ошибка: ' + e.message; }
    let M0 = null, M1;
    try { M0 = modelOf(before, t === 'wizard' ? '__draft' : t); } catch (e) { M0 = null; }
    try { M1 = modelOf(d, t === 'wizard' ? '__draft' : t); } catch (e) { return e.message.startsWith('Цикл') ? 'Связи работ образуют цикл — проверьте зависимости.' : 'Изменение нарушает модель объекта: ' + e.message; }
    const old = new Set(M0 ? M0.issues.filter(i => i.level === 'error').map(i => i.msg) : []);
    const added = M1.issues.filter(i => i.level === 'error' && !old.has(i.msg)).map(i => i.msg);
    return added.length ? 'Изменение создаёт противоречие в данных:<br>• ' + added.slice(0, 5).map(esc).join('<br>• ') : null;
  }
  function commit(t, fn, text, err) {
    const e = trial(t, fn);
    if (e) { if (err) { err.hidden = false; err.innerHTML = e; } else toast(e, 7000); return false; }
    return mutate(t, fn, text);
  }
  const refresh = () => { closeModal(); keepPage(); };

  /* ====================================================================
   * ПОЛЯ ФОРМ ПО ОПИСАНИЮ (schema)
   * ==================================================================== */
  const getPath = (o, k) => k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o);
  function setPath(o, k, v) {
    const ps = k.split('.'); let x = o;
    ps.slice(0, -1).forEach(p => { if (x[p] == null || typeof x[p] !== 'object') x[p] = {}; x = x[p]; });
    const last = ps[ps.length - 1];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length && last !== 'deps')) delete x[last]; else x[last] = v;
  }
  const fid = k => 'f-' + k.replace(/[^\w]/g, '_');
  function fieldHtml(f, v) {
    const id = fid(f.k), nm = `name="${f.k}" id="${id}"`;
    const lab = `<label for="${id}">${esc(f.t)}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
    const hint = f.hint ? `<span class="hint">${f.hint}</span>` : '';
    const opts = (list, cur, multi) => list.map(([val, tt]) => `<option value="${esc(val)}" ${(multi ? (cur || []).includes(val) : String(cur == null ? '' : cur) === String(val)) ? 'selected' : ''}>${esc(tt)}</option>`).join('');
    let inp;
    switch (f.type) {
      case 'textarea': inp = `<textarea ${nm} rows="${f.rows || 3}" placeholder="${esc(f.ph || '')}">${esc(v || '')}</textarea>`; break;
      case 'lines': inp = `<textarea ${nm} rows="${f.rows || 3}" placeholder="${esc(f.ph || 'по одному на строку')}">${esc((v || []).join('\n'))}</textarea>`; break;
      case 'select': inp = `<select ${nm}>${f.req && v != null && v !== '' ? '' : `<option value="">${esc(f.none || '—')}</option>`}${opts(f.opts || [], v)}</select>`; break;
      case 'multi': inp = `<select ${nm} multiple size="${Math.min(7, Math.max(3, (f.opts || []).length))}">${opts(f.opts || [], v, true)}</select>`; if (!(f.opts || []).length) inp = '<div class="faint" style="font-size:12.5px">нет вариантов</div>'; break;
      case 'check': return `<label class="chk"><input type="checkbox" ${nm} ${v ? 'checked' : ''}><span>${esc(f.t)}${f.hint ? `<small>${f.hint}</small>` : ''}</span></label>`;
      case 'checkInv': return `<label class="chk"><input type="checkbox" ${nm} ${v === false ? '' : 'checked'}><span>${esc(f.t)}${f.hint ? `<small>${f.hint}</small>` : ''}</span></label>`;
      case 'file': inp = `<input type="file" ${nm} ${f.accept ? `accept="${f.accept}"` : ''} ${f.multiple ? 'multiple' : ''}>${v && v.name ? `<span class="hint">Текущий файл: ${esc(v.name)}</span>` : ''}`; break;
      case 'pct100': inp = `<input type="number" step="0.1" min="0" max="100" ${nm} value="${v != null && v !== '' ? esc(Math.round(v * 1000) / 10) : ''}">`; break;
      case 'deps': return depsHtml(f, v);
      case 'number': inp = `<input type="number" step="${f.step || 'any'}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${nm} value="${v != null ? esc(v) : ''}" placeholder="${esc(f.ph || '')}">`; break;
      case 'date': inp = `<input type="date" ${nm} value="${esc(v || '')}" ${f.maxToday ? `max="${today()}"` : ''}>`; break;
      default: inp = `<input type="text" ${nm} value="${esc(v == null ? '' : v)}" placeholder="${esc(f.ph || '')}" ${f.list ? `list="${id}-dl"` : ''} ${f.ro ? 'readonly' : ''}>${f.list ? `<datalist id="${id}-dl">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
    }
    return `<div class="fld">${lab}${inp}${hint}</div>`;
  }
  function depsHtml(f, deps) {
    const rows = (deps || []).map(s => { const m = /^([\w.-]+)(?::(FS|SS|FF)([+-]\d+)?)?$/.exec(String(s)); return m ? { id: m[1], ty: m[2] || 'FS', lag: +(m[3] || 0) } : null; }).filter(Boolean);
    while (rows.length < (deps || []).length + 2) rows.push({ id: '', ty: 'FS', lag: 0 });
    return `<div class="fld"><label>${esc(f.t)}</label><div class="deps">${rows.map((r, i) => `<div class="dep">
      <select name="dep_id_${i}" aria-label="Предшествующая работа"><option value="">—</option>${(f.opts || []).map(([v, t]) => `<option value="${esc(v)}" ${v === r.id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <select name="dep_ty_${i}" aria-label="Тип связи">${[['FS', 'окончание → начало'], ['SS', 'начало → начало'], ['FF', 'окончание → окончание']].map(([v, t]) => `<option value="${v}" ${v === r.ty ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="number" name="dep_lag_${i}" value="${r.lag || ''}" placeholder="лаг, дн." aria-label="Лаг, дней"></div>`).join('')}</div>
      <span class="hint">Прогноз сроков и критический путь пересчитываются по связям. Пустые строки не сохраняются.</span></div>`;
  }
  function fieldsHtml(schema, val) {
    let out = '', row = [], cls = '';
    const flush = () => { if (row.length) out += cls ? `<div class="${cls}">${row.join('')}</div>` : row.join(''); row = []; cls = ''; };
    schema.forEach(f => {
      if (f.type === 'section') { flush(); out += `<div class="fsec">${esc(f.t)}${f.hint ? `<span>${f.hint}</span>` : ''}</div>`; return; }
      const h = fieldHtml(f, getPath(val || {}, f.k));
      const c = f.w === 'half' ? 'row-f' : f.w === 'third' ? 'row-f3' : '';
      if (c !== cls || (c === 'row-f' && row.length === 2) || (c === 'row-f3' && row.length === 3)) flush();
      cls = c; row.push(h);
    });
    flush();
    return out;
  }
  function readFields(schema, form) {
    const fd = new FormData(form), out = {}, errs = [];
    schema.forEach(f => {
      if (f.type === 'section') return;
      let v;
      const raw = fd.get(f.k);
      switch (f.type) {
        case 'check': v = !!(form.elements[f.k] && form.elements[f.k].checked); break;
        case 'checkInv': v = form.elements[f.k] && form.elements[f.k].checked ? undefined : false; break;
        case 'multi': v = form.elements[f.k] ? [...form.elements[f.k].selectedOptions].map(o => o.value) : []; break;
        case 'lines': v = String(raw || '').split('\n').map(x => x.trim()).filter(Boolean); break;
        case 'number': case 'pct100': {
          const s = String(raw == null ? '' : raw).trim().replace(',', '.');
          if (s === '') v = null; else { v = Number(s); if (!isFinite(v)) { errs.push('«' + f.t + '»: введите число'); v = null; } else if (f.type === 'pct100') v = v / 100; }
          if (v != null && f.min != null && v < f.min) errs.push('«' + f.t + '»: не меньше ' + f.min);
          if (v != null && f.max != null && v > f.max) errs.push('«' + f.t + '»: не больше ' + f.max);
          break;
        }
        case 'file': v = form.elements[f.k] && form.elements[f.k].files.length ? [...form.elements[f.k].files] : null; break;
        case 'deps': {
          v = [];
          for (let i = 0; form.elements['dep_id_' + i]; i++) {
            const id = form.elements['dep_id_' + i].value; if (!id) continue;
            const ty = form.elements['dep_ty_' + i].value, lag = parseInt(form.elements['dep_lag_' + i].value || '0', 10) || 0;
            v.push(id + (ty !== 'FS' || lag ? ':' + ty + (lag ? (lag > 0 ? '+' : '') + lag : '') : ''));
          }
          break;
        }
        default: v = String(raw == null ? '' : raw).trim(); if (v === '') v = null;
      }
      if (f.req && (v == null || v === '' || (Array.isArray(v) && !v.length))) errs.push('Заполните поле «' + f.t + '»');
      if (f.type === 'date' && f.maxToday && v && v > today()) errs.push('«' + f.t + '» не может быть позже отчётной даты ' + F.date(T()));
      out[f.k] = v;
    });
    return { v: out, errs };
  }
  const showErr = (form, html) => { const e = form.querySelector('.err'); if (e) { e.hidden = false; e.innerHTML = html; } else toast(html, 6000); };

  /* ====================================================================
   * СПРАВОЧНЫЕ СПИСКИ ОБЪЕКТА
   * ==================================================================== */
  const STAGE_MS = 'Ключевые вехи';
  const stageNames = def => { const st = (def.stages || []).filter(s => !s.archived).map(s => s.name); (def.tasks || []).forEach(t => { if (t.stage && !t.archived && !st.includes(t.stage)) st.push(t.stage); }); return st; };
  const taskOpts = (def, fl) => (def.tasks || []).filter(t => !t.archived && (!fl || fl(t))).map(t => [t.id, (t.ms ? '◆ ' : '') + (t.stage ? t.stage + ' · ' : '') + t.name]);
  const itemOpts = def => ((def.budget || {}).items || []).map(i => [i.code, i.name]);
  const contractOpts = def => (def.contracts || []).map(c => [c.id, c.no + (c.contractor ? ' · ' + c.contractor : '')]);
  const partsOf = def => Array.isArray(def.participants) ? def.participants : DSF.participantsOf(DSF.normalizeProject(Object.assign({ id: '__p' }, def)), def.contracts || []);
  const partName = x => { const o = REG.org(x.org); return o ? o.name : x.name || '—'; };
  const orgNames = def => [...new Set(partsOf(def).map(partName).concat(REG.state.orgs.map(o => o.name)).concat((def.contracts || []).map(c => c.contractor)).filter(n => n && n !== '—'))];
  const contractorNames = def => [...new Set(partsOf(def).filter(x => ['gc', 'contractor', 'supplier'].includes(x.role)).map(partName).concat(((def.resources || {}).byContractor || []).map(c => c.name)).filter(Boolean))];
  function ensureStages(def) {
    if (!Array.isArray(def.stages)) def.stages = [];
    stageNames(def).forEach(n => { if (!def.stages.some(s => s.name === n)) def.stages.push({ id: REG.nid(def, 'st'), name: n }); });
    return def.stages;
  }
  function ensureParts(def) {
    if (!Array.isArray(def.participants)) {
      // объект из датасета: реквизиты переводятся в участников со ссылкой на справочник организаций
      def.participants = partsOf(def).map((x, i) => ({ id: 'pt-d' + i, org: REG.upsertOrg({ name: x.name }).id, role: x.role }));
      REG.save();
    }
    return def.participants;
  }
  const docSecOpts = (def, cat) => (def.docSections || []).filter(x => !cat || x.cat === cat).map(x => [x.code, x.code + ' — ' + x.name]);
  const catOptsSec = def => [['rd', 'РД — рабочая документация'], ['pd', 'ПД — проектная документация']].concat((def.docCats || []).map(c => [c.key, c.t + ' — ' + c.full]));
  const catOptsAll = def => [['rd', 'РД'], ['pd', 'ПД'], ['id', 'ИД'], ['reports', 'Отчёты'], ['permits', 'Разрешения']].concat((def.docCats || []).map(c => [c.key, c.t]));
  const RES_CATS = ['Техника', 'Оборудование', 'Прочее'];
  const PERIODS = { day: 'ежедневно', week: 'еженедельно', month: 'ежемесячно', other: 'по мере выполнения' };

  /* ====================================================================
   * КОЛЛЕКЦИИ: универсальный редактор списков объекта
   * ==================================================================== */
  const C = {};
  const yes = b => b ? '✓' : '';
  const qn = v => num(v, Number.isInteger(+v) ? 0 : 1);
  C.stages = {
    title: 'Этапы и группы работ', one: 'этап', perm: 'schedule', idp: 'st', arch: true, del: true,
    list: (def, p, w) => w ? ensureStages(def) : (Array.isArray(def.stages) ? def.stages : stageNames(def).map(n => ({ id: 'st:' + n, name: n }))),
    schema: () => [{ k: 'name', t: 'Наименование этапа / группы', req: true }, { k: 'weight', t: 'Весовой коэффициент этапа', type: 'number', min: 0, hint: 'для правила «по весовым коэффициентам»; можно не задавать' }, { k: 'comment', t: 'Комментарий', type: 'textarea' }],
    cols: [['Этап', x => `<b>${esc(x.name)}</b>`], ['Работ', (x, def) => (def.tasks || []).filter(t => t.stage === x.name && !t.ms && !t.archived).length], ['Вех', (x, def) => (def.tasks || []).filter(t => t.stage === x.name && t.ms && !t.archived).length], ['Вес', x => x.weight != null ? num(x.weight, 1) : '—']],
    validate: (v, def, it) => (def.stages || []).some(s => s !== it && s.name === v.name && !s.archived) ? 'Этап с таким названием уже есть' : null,
    after: (def, it, prev) => { if (prev && prev.name !== it.name) { (def.tasks || []).forEach(t => { if (t.stage === prev.name) t.stage = it.name; }); (def.photos || []).forEach(p => { if (p.stage === prev.name) p.stage = it.name; }); } },
    onArch: (def, it) => { (def.tasks || []).forEach(t => { if (t.stage === it.name) t.archived = !!it.archived || undefined; }); },
    canDel: (def, it) => (def.tasks || []).some(t => t.stage === it.name) ? 'В этапе есть работы — перенесите их или используйте архив' : null
  };
  const taskRefs = (def, id) => {
    const r = [];
    if ((def.tasks || []).some(t => (t.deps || []).some(d => String(d).split(':')[0] === id))) r.push('связи других работ');
    if ((def.photos || []).some(p => p.task === id)) r.push('фото');
    if ((def.documents || []).some(d => (Array.isArray(d) ? [].concat(d[4] || []) : d.tasks || []).includes(id))) r.push('документы');
    if ((def.risks || []).some(x => (x.effect || {}).task === id)) r.push('риски');
    if ((def.events || []).some(e => e.task === id || (e.tasks || []).includes(id))) r.push('события');
    if ((def.metrics || []).some(m => m.task === id)) r.push('показатели');
    if ((def.orders || []).some(o => (o.tasks || []).includes(id))) r.push('поручения');
    return r;
  };
  function taskValidate(v, def, it) {
    if (v.ps && v.pf && v.pf < v.ps) return 'Плановое окончание раньше планового начала';
    const t0 = today();
    if (v.as && v.as > t0) return 'Фактическое начало не может быть позже отчётной даты';
    if (v.af && v.af > t0) return 'Фактическое окончание не может быть позже отчётной даты';
    if (v.af && !v.as) return 'Укажите фактическое начало';
    if (v.af && v.as && v.af < v.as) return 'Фактическое окончание раньше начала';
    const qty = v.qty != null ? v.qty : it && it.qty, qf = v.qtyFact !== undefined ? v.qtyFact : it && it.qtyFact;
    const p = qty && qf != null ? Math.min(100, qf / qty * 100) : (v.pct != null ? v.pct : (it && it.pct) || 0);
    if (p > 0 && !(v.as || (it && it.as))) return 'Есть выполнение — укажите фактическое начало работы';
    if (p >= 100 && !(v.af || (it && it.af))) return 'Работа выполнена на 100% — укажите фактическое окончание';
    if ((v.af || (it && it.af)) && p < 100) return 'Указано фактическое окончание — выполнение должно быть 100% (сейчас ' + num(p, 1) + '%)';
    if (v.deps && it && v.deps.some(d => d.split(':')[0] === it.id)) return 'Работа не может зависеть от самой себя';
    return null;
  }
  C.tasks = {
    title: 'Работы', one: 'работу', perm: 'schedule', idp: 'w', wide: true, arch: true, hide: true, del: true,
    list: def => (def.tasks = def.tasks || []), filter: x => !x.ms,
    sort: (def) => { const st = stageNames(def); return (a, b) => st.indexOf(a.stage) - st.indexOf(b.stage); },
    schema: (def, it) => {
      const rd = (def.readiness || {}).mode || 'cost';
      return [
        { k: 'name', t: 'Наименование работы', req: true },
        { k: 'stage', t: 'Этап / группа', type: 'select', req: true, opts: stageNames(def).map(s => [s, s]), hint: stageNames(def).length ? '' : 'Сначала создайте этап в таблице «Этапы и группы работ»' },
        { type: 'section', t: 'Объёмы', hint: 'если общий объём задан, % выполнения считается из фактического объёма' },
        { k: 'unit', t: 'Ед. изм.', w: 'third', list: ['м³', 'м²', 'т', 'шт.', 'м', 'п. м', 'компл.', 'усл. ед.'] },
        { k: 'qty', t: 'Общий объём', type: 'number', min: 0, w: 'third' },
        { k: 'qtyPlan', t: 'Плановый объём на отчётную дату', type: 'number', min: 0, w: 'third' },
        { type: 'section', t: 'Сроки' },
        { k: 'ps', t: 'Плановое начало', type: 'date', req: true, w: 'half' }, { k: 'pf', t: 'Плановое окончание', type: 'date', req: true, w: 'half' },
        { type: 'section', t: 'Факт', hint: 'фактические данные можно вносить позже через «Внести факт»' },
        { k: 'as', t: 'Фактическое начало', type: 'date', maxToday: true, w: 'third' }, { k: 'af', t: 'Фактическое окончание', type: 'date', maxToday: true, w: 'third' },
        { k: 'qtyFact', t: 'Фактический объём', type: 'number', min: 0, w: 'third' },
        { k: 'pct', t: '% выполнения (если объём не задан)', type: 'number', min: 0, max: 100, w: 'half' },
        { k: 'weight', t: 'Весовой коэффициент готовности', type: 'number', min: 0, w: 'half', hint: rd === 'weight' ? 'без коэффициента работа не участвует в готовности' : 'используется в правиле «по весовым коэффициентам»' },
        { k: 'inReady', t: 'Участвует в общей готовности объекта', type: 'checkInv' },
        { k: 'deps', t: 'Зависимости — предшествующие работы', type: 'deps', opts: taskOpts(def, t => !it || t.id !== it.id) },
        { type: 'section', t: 'Стоимость и договор' },
        { k: 'cost', t: 'Стоимость, млн ₽', type: 'number', min: 0, w: 'third' }, { k: 'item', t: 'Статья бюджета', type: 'select', opts: itemOpts(def), w: 'third' }, { k: 'contract', t: 'Договор', type: 'select', opts: contractOpts(def), w: 'third' },
        { k: 'comment', t: 'Комментарий', type: 'textarea', rows: 2 }
      ];
    },
    validate: taskValidate,
    cols: [['Работа', x => `<b>${esc(x.name)}</b>${x.hidden ? ' ' + chip('скрыта', 'neutral') : ''}`], ['Этап', x => esc(x.stage || '—')], ['План', x => `${fd(dn(x.ps))} – ${fd(dn(x.pf))}`],
      ['Объём', x => x.qty ? `${qn(x.qtyFact || 0)} / ${qn(x.qty)} ${esc(x.unit || '')}` : '—'], ['%', x => x.qty && x.qtyFact != null ? num(Math.min(100, x.qtyFact / x.qty * 100), 1) : num(x.pct || 0, 0)],
      ['Факт', x => x.as ? fd(dn(x.as)) + (x.af ? ' – ' + fd(dn(x.af)) : ' →') : '—'], ['Вес', x => x.weight != null ? num(x.weight, 1) : '—'], ['Связи', x => (x.deps || []).length || '']],
    canDel: (def, it) => { const r = taskRefs(def, it.id); return r.length ? 'Работа используется (' + r.join(', ') + ') — используйте архив или скрытие' : null; }
  };
  C.ms = {
    title: 'Ключевые вехи и контрольные точки', one: 'веху', perm: 'schedule', idp: 'm', arch: true, del: true,
    list: def => (def.tasks = def.tasks || []), filter: x => x.ms, make: () => ({ ms: true }),
    schema: (def, it) => [
      { k: 'name', t: 'Наименование вехи / контрольной точки', req: true },
      { k: 'stage', t: 'Этап', type: 'select', opts: stageNames(def).map(s => [s, s]), none: '— группа «' + STAGE_MS + '» —' },
      { k: 'pf', t: 'Плановая дата', type: 'date', req: true, w: 'third' }, { k: 'directive', t: 'Директивный срок', type: 'date', w: 'third' }, { k: 'af', t: 'Фактическая дата', type: 'date', maxToday: true, w: 'third' },
      { k: 'key', t: 'Ключевая веха (показывается в календаре и на графике)', type: 'check' },
      { k: 'final', t: 'Ввод объекта — финальная веха прогноза', type: 'check', hint: 'по ней считается прогноз завершения объекта' },
      { k: 'deps', t: 'Зависит от работ', type: 'deps', opts: taskOpts(def, t => !it || t.id !== it.id) },
      { k: 'comment', t: 'Комментарий / статус', type: 'textarea', rows: 2 }
    ],
    before: (def, it) => { if (!it.stage) it.stage = STAGE_MS; it.ps = it.pf; },
    after: (def, it) => { if (it.final) def.tasks.forEach(t => { if (t !== it && t.final) delete t.final; }); },
    cols: [['Веха', x => `<b>${esc(x.name)}</b>${x.final ? ' ' + chip('ввод объекта', 'accent') : x.key ? ' ' + chip('ключевая', 'neutral') : ''}`], ['План', x => fd(dn(x.pf))], ['Директивный', x => fd(dn(x.directive))], ['Факт', x => fd(dn(x.af))], ['Статус', (x, def, M) => { const t = M && M.byId.get(x.id); return t ? chip(t.directive != null && t.af == null && t.ef > t.directive ? 'Риск срыва директивного срока' : t.st.t, t.directive != null && t.af == null && t.ef > t.directive ? 'crit' : t.st.c) : '—'; }]],
    canDel: (def, it) => { const r = taskRefs(def, it.id); return r.length ? 'Веха используется (' + r.join(', ') + ')' : null; }
  };
  C.items = {
    title: 'Статьи бюджета', one: 'статью', perm: 'budget', idk: 'code', idp: 'i', del: true,
    list: def => { def.budget = def.budget || { reserve: 0, items: [] }; def.budget.items = def.budget.items || []; return def.budget.items; },
    schema: () => [{ k: 'name', t: 'Наименование статьи', req: true }, { k: 'budget', t: 'Бюджет статьи, млн ₽', type: 'number', min: 0, req: true, w: 'half' }, { k: 'adj', t: 'Корректировка прогноза, млн ₽', type: 'number', w: 'half', hint: 'необязательно' },
      { k: 'mode', t: 'Равномерное освоение по сроку объекта (управление, технадзор, страхование)', type: 'select', opts: [['linear', 'да — равномерно по сроку']], none: 'нет — по выполнению работ' },
      { k: 'inReadiness', t: 'Работы статьи участвуют в готовности (правило «по стоимости»)', type: 'checkInv' }],
    cols: [['Статья', x => `<b>${esc(x.name)}</b>`], ['Бюджет, млн ₽', x => num(x.budget, 1)], ['Работ', (x, def) => (def.tasks || []).filter(t => t.item === x.code && !t.archived).length], ['Договоров', (x, def) => (def.contracts || []).filter(c => c.item === x.code).length], ['В готовности', x => yes(x.inReadiness !== false)]],
    canDel: (def, it) => (def.contracts || []).some(c => c.item === it.code) || (def.tasks || []).some(t => t.item === it.code) ? 'К статье привязаны договоры или работы' : null
  };
  C.contracts = {
    title: 'Договоры', one: 'договор', perm: 'budget', idp: 'c', wide: true, del: true,
    list: def => (def.contracts = def.contracts || []),
    schema: def => [
      { k: 'no', t: 'Номер договора', req: true, w: 'half' }, { k: 'date', t: 'Дата договора', type: 'date', req: true, maxToday: true, w: 'half' },
      { k: 'contractor', t: 'Подрядчик / исполнитель', req: true, list: orgNames(def), hint: 'организация добавится в справочник и в участники объекта' },
      { k: 'subject', t: 'Предмет договора', req: true },
      { k: 'item', t: 'Статья бюджета', type: 'select', req: true, opts: itemOpts(def), w: 'half' }, { k: 'amount', t: 'Сумма договора, млн ₽', type: 'number', min: 0, req: true, w: 'half' },
      { k: 'adv', t: 'Аванс, %', type: 'pct100', w: 'half' }, { k: 'ret', t: 'Гарантийное удержание, %', type: 'pct100', w: 'half' },
      { k: 'note', t: 'Примечание', type: 'textarea', rows: 2 }
    ],
    after: (def, it) => {
      const org = REG.upsertOrg({ name: it.contractor });
      if (Array.isArray(def.participants) && !def.participants.some(x => x.org === org.id)) def.participants.push({ id: REG.nid(def, 'pt'), org: org.id, role: 'contractor' });
      REG.save();
    },
    cols: [['Договор', x => `<b>${esc(x.no)}</b> от ${fd(dn(x.date))}`], ['Подрядчик', x => esc(x.contractor)], ['Предмет', x => esc(x.subject || '')], ['Сумма, млн ₽', x => num((+x.amount || 0) + sum(x.supp || [], a => +a.amount || 0), 1)], ['Доп. согл.', x => (x.supp || []).length || ''], ['КС-2 / оплаты', x => ((x.acts || []).length || 0) + ' / ' + ((x.payments || []).length || 0)]],
    canDel: (def, it) => (def.tasks || []).some(t => t.contract === it.id) || (it.acts || []).length || (it.payments || []).length ? 'По договору есть работы, КС-2 или оплаты' : null
  };
  const ctOf = (def, id) => (def.contracts || []).find(c => c.id === id);
  C.supp = {
    title: 'Дополнительные соглашения', one: 'доп. соглашение', perm: 'budget', idx: true, del: true, defaults: () => ({ date: today() }),
    list: (def, p) => { const c = ctOf(def, p); if (!c) return []; return (c.supp = c.supp || []); },
    schema: () => [{ k: 'no', t: 'Номер', req: true, w: 'half' }, { k: 'date', t: 'Дата', type: 'date', req: true, maxToday: true, w: 'half' }, { k: 'subject', t: 'Предмет изменения', req: true }, { k: 'amount', t: 'Изменение цены, млн ₽ (минус — уменьшение)', type: 'number', req: true }]
  };
  C.pay = {
    title: 'Оплаты', one: 'оплату', perm: 'budget', idx: true, del: true, defaults: () => ({ date: today(), kind: 'act' }),
    list: (def, p) => { const c = ctOf(def, p); if (!c) return []; return (c.payments = c.payments || []); },
    schema: () => [{ k: 'date', t: 'Дата оплаты', type: 'date', req: true, maxToday: true, w: 'half' }, { k: 'amount', t: 'Сумма, млн ₽', type: 'number', min: 0, req: true, w: 'half' }, { k: 'kind', t: 'Назначение', type: 'select', req: true, opts: [['advance', 'Аванс'], ['act', 'Оплата выполненных работ'], ['other', 'Прочее']] }, { k: 'doc', t: 'Основание (счёт, платёжное поручение, КС-2)' }]
  };
  C.acts = {
    title: 'КС-2 по договору', one: 'КС-2', perm: 'budget', idx: true, del: true, defaults: () => ({ date: today(), period: today(), status: 'agreed' }),
    list: (def, p) => { const c = ctOf(def, p); if (!c) return []; return (c.acts = c.acts || []); },
    schema: () => [{ k: 'no', t: 'Номер КС-2', req: true, w: 'half' }, { k: 'date', t: 'Дата', type: 'date', req: true, maxToday: true, w: 'half' },
      { k: 'period', t: 'Отчётный период (любая дата месяца)', type: 'date', w: 'half' }, { k: 'status', t: 'Статус', type: 'select', req: true, opts: [['formed', 'Сформирована'], ['agreed', 'Согласована'], ['period', 'Включена в расчётный период'], ['paid', 'Оплачена']], w: 'half' },
      { k: 'claimed', t: 'Заявлено подрядчиком, млн ₽', type: 'number', min: 0, w: 'third' }, { k: 'accepted', t: 'Принято, млн ₽', type: 'number', min: 0, w: 'third' }, { k: 'amount', t: 'Сумма КС-2, млн ₽', type: 'number', min: 0, req: true, w: 'third' },
      { k: 'note', t: 'Примечание' }],
    validate: v => v.accepted != null && v.amount > v.accepted + 1e-6 ? 'Сумма КС-2 не может превышать принятый объём' : v.claimed != null && v.accepted != null && v.accepted > v.claimed + 1e-6 ? 'Принято больше, чем заявлено' : null
  };
  C.parts = {
    title: 'Участники проекта', one: 'участника', perm: 'settings', idp: 'pt', del: true,
    list: (def, p, w) => w ? ensureParts(def) : partsOf(def).map((x, i) => Object.assign({ id: x.id || 'pt-d' + i }, x)),
    schema: (def, it) => [
      { k: 'org', t: 'Организация из справочника', type: 'select', opts: REG.state.orgs.map(o => [o.id, o.name]), none: '— новая организация —' },
      { k: 'newOrg', t: 'Новая организация (если нет в справочнике)', ph: 'Например: ООО «СтройМонтаж»' },
      { k: 'role', t: 'Роль в проекте', type: 'select', req: true, opts: Object.entries(DSF.PARTY_ROLES), w: 'half' }, { k: 'person', t: 'Контактное лицо', w: 'half' },
      { k: 'position', t: 'Должность', w: 'half' }, { k: 'phone', t: 'Телефон', w: 'half' }, { k: 'email', t: 'Эл. почта' }, { k: 'note', t: 'Примечание' }
    ],
    validate: v => !v.org && !v.newOrg ? 'Выберите организацию из справочника или укажите новую' : null,
    before: (def, it) => { if (it.newOrg) { it.org = REG.upsertOrg({ name: it.newOrg }).id; REG.save(); } delete it.newOrg; delete it.name; delete it.derived; },
    cols: [['Роль', x => esc(DSF.PARTY_ROLES[x.role] || x.role)], ['Организация', x => `<b>${esc(partName(x))}</b>`], ['Контакт', x => esc([x.person, x.position].filter(Boolean).join(', ')) || '—'], ['Связь', x => esc([x.phone, x.email].filter(Boolean).join(' · ')) || '—']]
  };
  C.people = {
    title: 'Ответственные лица', one: 'ответственного', perm: 'settings', idp: 'pp', del: true,
    list: def => (def.people = def.people || []),
    schema: () => [{ k: 'role', t: 'Функция / роль', req: true, list: ['Руководитель проекта', 'Директор по строительству', 'Главный инженер проекта', 'Инженер технического надзора', 'Инженер ПТО', 'Сметчик'], w: 'half' }, { k: 'name', t: 'ФИО', req: true, w: 'half' }, { k: 'org', t: 'Организация', w: 'half' }, { k: 'phone', t: 'Телефон', w: 'half' }, { k: 'email', t: 'Эл. почта' }],
    cols: [['Функция', x => esc(x.role)], ['ФИО', x => `<b>${esc(x.name)}</b>`], ['Организация', x => esc(x.org || '—')], ['Контакты', x => esc([x.phone, x.email].filter(Boolean).join(' · ')) || '—']]
  };
  C.tep = {
    title: 'Технико-экономические показатели', one: 'показатель', perm: 'settings', idx: true, del: true,
    list: def => { def.params = def.params || {}; return (def.params.extra = def.params.extra || []); },
    get: x => ({ label: x[0], value: x[1] }), put: v => [v.label, v.value],
    schema: () => [{ k: 'label', t: 'Показатель', req: true, w: 'half', list: ['Строительный объём', 'Площадь застройки', 'Площадь участка', 'Количество квартир', 'Машино-места', 'Номерной фонд', 'Класс энергоэффективности'] }, { k: 'value', t: 'Значение с единицами', req: true, w: 'half' }],
    cols: [['Показатель', x => esc(x[0])], ['Значение', x => `<b>${esc(x[1])}</b>`]]
  };
  C.docsec = {
    title: 'Разделы и подразделы документации', one: 'раздел', perm: 'settings', idp: 'ds', del: true, defaults: () => ({ cat: 'rd' }),
    list: def => (def.docSections = def.docSections || []),
    schema: (def, it) => [{ k: 'cat', t: 'Категория', type: 'select', req: true, opts: catOptsSec(def), w: 'half' }, { k: 'code', t: 'Шифр раздела', req: true, w: 'half', list: Object.keys(DSF.DOC_SECTIONS) },
      { k: 'name', t: 'Наименование раздела', req: true }, { k: 'parent', t: 'Входит в раздел (для подраздела)', type: 'select', opts: (def.docSections || []).filter(x => x !== it).map(x => [x.code, x.code + ' — ' + x.name]) }],
    validate: (v, def, it) => (def.docSections || []).some(x => x !== it && x.cat === v.cat && x.code === v.code) ? 'Такой раздел в категории уже есть' : null,
    cols: [['Категория', (x, def) => esc((catOptsSec(def).find(c => c[0] === x.cat) || [0, x.cat])[1])], ['Шифр', x => `<b>${esc(x.code)}</b>`], ['Наименование', x => esc(x.name)], ['Подраздел', x => x.parent ? 'в ' + esc(x.parent) : ''], ['Документов', (x, def) => (def.documents || []).filter(d => (Array.isArray(d) ? d[1] : d.section) === x.code).length]]
  };
  const docIdOf = code => 'd-' + DSF.slug(code);
  C.docpos = {
    title: 'Предусмотренные документы', one: 'документ', perm: 'settings', del: true, defaults: () => ({ cat: 'rd' }),
    list: def => (def.documents = def.documents || []), filter: x => !Array.isArray(x),
    schema: (def, it) => [{ k: 'cat', t: 'Категория', type: 'select', req: true, opts: catOptsAll(def), w: 'half' }, { k: 'section', t: 'Раздел', type: 'select', opts: docSecOpts(def), w: 'half' },
      { k: 'code', t: 'Шифр документа', req: true, w: 'half', ro: !!it }, { k: 'due', t: 'Плановый срок поступления', type: 'date', w: 'half' }, { k: 'title', t: 'Наименование', req: true },
      { k: 'org', t: 'Разработчик / организация', list: orgNames(def) }, { k: 'tasks', t: 'Связанные работы', type: 'multi', opts: taskOpts(def, t => !t.ms) }],
    validate: (v, def, it) => !it && (def.documents || []).some(d => (Array.isArray(d) ? docIdOf(d[2]) : (d.id || docIdOf(d.code))) === docIdOf(v.code)) ? 'Документ с таким шифром уже есть' : null,
    before: (def, it) => { if (!it.id) it.id = docIdOf(it.code); },
    cols: [['Кат.', (x, def) => esc((catOptsAll(def).find(c => c[0] === x.cat) || [0, x.cat])[1])], ['Раздел', x => esc(x.section || '—')], ['Шифр', x => `<b>${esc(x.code)}</b>`], ['Наименование', x => esc(x.title)], ['Срок', x => fd(dn(x.due))]],
    canDel: (def, it, M) => { const d = M && M.docBy && M.docBy.get(it.id); return d && d.versions.length ? 'У документа есть загруженные редакции' : null; }
  };
  C.doccat = {
    title: 'Дополнительные категории документов', one: 'категорию', perm: 'settings', idk: 'key', idp: 'cat', del: true,
    list: def => (def.docCats = def.docCats || []),
    schema: () => [{ k: 't', t: 'Краткое название', req: true, w: 'half', ph: 'Например: Сметы' }, { k: 'full', t: 'Полное название', req: true, w: 'half', ph: 'Сметная документация' }],
    cols: [['Категория', x => `<b>${esc(x.t)}</b>`], ['Полное название', x => esc(x.full)]],
    canDel: (def, it) => (def.documents || []).some(d => !Array.isArray(d) && d.cat === it.key) || (def.docSections || []).some(x => x.cat === it.key) ? 'В категории есть разделы или документы' : null
  };
  C.kinds = {
    title: 'Виды техники, оборудования и ресурсов', one: 'вид ресурса', perm: 'settings', idp: 'rk', del: true, defaults: () => ({ cat: 'Техника', unit: 'ед.' }),
    list: def => { def.resources = def.resources || {}; return (def.resources.kinds = def.resources.kinds || []); },
    schema: () => [{ k: 'name', t: 'Наименование', req: true, ph: 'Например: Автокран 50 т' }, { k: 'cat', t: 'Категория', type: 'select', req: true, opts: RES_CATS.map(c => [c, c]), w: 'half' }, { k: 'unit', t: 'Ед. изм.', w: 'half', ph: 'ед.' }],
    cols: [['Вид', x => `<b>${esc(x.name)}</b>`], ['Категория', x => esc(x.cat)], ['Ед.', x => esc(x.unit || 'ед.')]]
  };
  C.metrics = {
    title: 'Периодические показатели', one: 'показатель', perm: 'settings', idp: 'mt', arch: true, del: true, defaults: () => ({ period: 'week' }),
    list: def => (def.metrics = def.metrics || []),
    schema: def => [{ k: 'name', t: 'Показатель', req: true, ph: 'Например: Бетонирование, м³' }, { k: 'unit', t: 'Ед. изм.', req: true, w: 'half', list: ['м³', 'м²', 'т', 'шт.', 'чел.', 'м', '%'] }, { k: 'period', t: 'Периодичность', type: 'select', req: true, opts: Object.entries(PERIODS), w: 'half' },
      { k: 'task', t: 'Связанная работа', type: 'select', opts: taskOpts(def, t => !t.ms), w: 'half' }, { k: 'stage', t: 'Этап', type: 'select', opts: stageNames(def).map(s => [s, s]), w: 'half' },
      { k: 'plan', t: 'План на период', type: 'number', min: 0, w: 'half' }, { k: 'total', t: 'План всего', type: 'number', min: 0, w: 'half' }, { k: 'comment', t: 'Описание', type: 'textarea', rows: 2 }],
    cols: [['Показатель', x => `<b>${esc(x.name)}</b>`], ['Ед.', x => esc(x.unit)], ['Период', x => esc(PERIODS[x.period] || '')], ['План на период', x => x.plan != null ? num(x.plan, 1) : '—'], ['План всего', x => x.total != null ? num(x.total, 1) : '—'], ['Записей', (x, def) => (def.metricLog || []).filter(e => e.metric === x.id).length]],
    canDel: (def, it) => (def.metricLog || []).some(e => e.metric === it.id) ? 'По показателю есть внесённые значения — используйте архив' : null
  };
  C.mlog = {
    title: 'Значения показателей', one: 'значение', perm: 'data', idp: 'mv', del: true, defaults: () => ({ date: today() }),
    list: def => (def.metricLog = def.metricLog || []),
    schema: def => [{ k: 'metric', t: 'Показатель', type: 'select', req: true, opts: (def.metrics || []).filter(m => !m.archived).map(m => [m.id, m.name + ', ' + m.unit]) }, { k: 'date', t: 'Дата', type: 'date', req: true, maxToday: true, w: 'third' }, { k: 'plan', t: 'План', type: 'number', w: 'third' }, { k: 'fact', t: 'Факт', type: 'number', req: true, w: 'third' }, { k: 'comment', t: 'Комментарий' }, { k: 'file', t: 'Вложение', type: 'file' }]
  };
  C.risks = {
    title: 'Риски и проблемные вопросы', one: 'риск', perm: 'data', idp: 'r', del: true, wide: true, defaults: () => ({ kind: 'risk', status: 'Открыт', p: 3, i: 3, since: today() }),
    list: def => (def.risks = def.risks || []),
    schema: (def, it, M) => [
      { k: 'kind', t: 'Тип', type: 'select', req: true, opts: [['risk', 'Риск'], ['issue', 'Проблемный вопрос']], w: 'half' }, { k: 'status', t: 'Статус', type: 'select', req: true, opts: DSF.RISK_STATUS.map(s => [s, s]), w: 'half' },
      { k: 'title', t: 'Риск / проблема', req: true }, { k: 'desc', t: 'Описание', type: 'textarea', rows: 2 },
      { k: 'p', t: 'Вероятность (1–5)', type: 'number', min: 1, max: 5, step: 1, req: true, w: 'third' }, { k: 'i', t: 'Влияние (1–5)', type: 'number', min: 1, max: 5, step: 1, req: true, w: 'third' }, { k: 'cat', t: 'Категория', w: 'third', list: ['Сроки', 'Стоимость', 'Поставки', 'Проектирование', 'Разрешения', 'Качество', 'Охрана труда', 'Подрядчики'] },
      { k: 'owner', t: 'Ответственный', w: 'half' }, { k: 'due', t: 'Срок', type: 'date', w: 'half' }, { k: 'since', t: 'Выявлен', type: 'date', maxToday: true, w: 'half' }, { k: 'control', t: 'Дата контроля', type: 'date', w: 'half' },
      { k: 'measures', t: 'Мероприятия', type: 'lines', ph: 'по одному мероприятию на строку' },
      { type: 'section', t: 'Влияние', hint: 'реализующийся риск сдвигает работу графика и добавляется в прогноз стоимости' },
      { k: 'effect.task', t: 'Работа графика', type: 'select', opts: taskOpts(def, t => !t.ms), w: 'half' }, { k: 'effect.days', t: 'Сдвиг, дн.', type: 'number', min: 0, step: 1, w: 'half' },
      { k: 'effect.item', t: 'Статья бюджета', type: 'select', opts: itemOpts(def), w: 'half' }, { k: 'effect.cost', t: 'Стоимость, млн ₽', type: 'number', min: 0, w: 'half' },
      { k: 'docs', t: 'Связанные документы', type: 'multi', opts: M && M.documents ? M.documents.map(d => [d.id, ((M.docCats || DSF.DOC_CATS)[d.cat] || {}).t + ' · ' + (d.code || '') + ' ' + d.title]) : [] },
      { k: 'photos', t: 'Связанные фото', type: 'multi', opts: (def.photos || []).map(p => [p.file, fd(dn(p.date)) + ' · ' + p.caption]) },
      { k: 'newComment', t: 'Новый комментарий', type: 'textarea', rows: 2 }
    ],
    before: (def, it) => { if (it.newComment) { it.comments = (it.comments || []).concat([{ date: today(), text: it.newComment, by: DSF.auth.name() }]); } delete it.newComment; if (!it.cat) it.cat = ''; },
    cols: [['Риск', x => `<b>${esc(x.title)}</b>`], ['Статус', x => esc(x.status)], ['P×I', x => x.p * x.i], ['Ответственный', x => esc(x.owner || '—')], ['Срок', x => fd(dn(x.due))]]
  };
  C.photos = {
    title: 'Фотографии', one: 'фото', perm: 'data', idk: 'file', del: true,
    list: def => (def.photos = def.photos || []),
    schema: (def) => [{ k: 'caption', t: 'Подпись', req: true }, { k: 'date', t: 'Дата съёмки', type: 'date', req: true, maxToday: true, w: 'half' }, { k: 'cat', t: 'Категория', w: 'half', list: def.photoCats || [] },
      { k: 'stage', t: 'Этап', type: 'select', opts: stageNames(def).map(s => [s, s]), w: 'half' }, { k: 'task', t: 'Работа', type: 'select', opts: taskOpts(def, t => !t.ms), w: 'half' },
      { k: 'desc', t: 'Описание', type: 'textarea', rows: 2 }, { k: 'author', t: 'Автор' }],
    cols: [['Фото', x => `<img class="thumb" src="${H.photoUrl(x.file)}" alt="">`], ['Подпись', x => `<b>${esc(x.caption)}</b>`], ['Дата', x => fd(dn(x.date))], ['Категория', x => esc(x.cat || '—')], ['Этап / работа', (x, def) => esc(x.stage || ((def.tasks || []).find(t => t.id === x.task) || {}).stage || '—')]],
    canDel: () => null,
    onDel: (def, it) => { if (String(it.file).startsWith('u:')) DSF.files.remove(String(it.file).slice(2)); (def.risks || []).forEach(r => { if (r.photos) r.photos = r.photos.filter(f => f !== it.file); }); }
  };
  C.orgs = {
    title: 'Справочник организаций', one: 'организацию', perm: 'admin', idp: 'org', del: true, global: true,
    list: st => st.orgs,
    schema: () => [{ k: 'name', t: 'Наименование', req: true }, { k: 'inn', t: 'ИНН', w: 'half' }, { k: 'kind', t: 'Вид деятельности', w: 'half', list: ['Заказчик', 'Технический заказчик', 'Генподрядчик', 'Подрядчик', 'Проектировщик', 'Поставщик', 'Строительный контроль'] },
      { k: 'person', t: 'Контактное лицо', w: 'half' }, { k: 'phone', t: 'Телефон', w: 'half' }, { k: 'email', t: 'Эл. почта', w: 'half' }, { k: 'address', t: 'Адрес', w: 'half' }, { k: 'note', t: 'Примечание' }],
    validate: (v, st, it) => st.orgs.some(o => o !== it && o.name.trim().toLowerCase() === v.name.trim().toLowerCase()) ? 'Организация с таким наименованием уже есть' : null,
    cols: [['Организация', x => `<b>${esc(x.name)}</b>`], ['ИНН', x => esc(x.inn || '—')], ['Вид', x => esc(x.kind || '—')], ['Контакты', x => esc([x.person, x.phone, x.email].filter(Boolean).join(' · ')) || '—'], ['Объекты', x => esc(REG.orgUsage(x.id).join(', ')) || '—']],
    canDel: (st, it) => REG.orgUsage(it.id).length ? 'Организация участвует в объектах' : null
  };


  /* --- производственный контур: ежедневные отчёты, замечания, гарантийные письма (данные объекта) --- */
  const REP_STATE = [['sub', 'Подан, не подтверждён'], ['step1', 'Подтверждён первой ступенью'], ['full', 'Подтверждён полностью'], ['ret', 'Возвращён подрядчику']];
  const repTasks = (def, M, it) => (def.tasks || []).filter(t => !t.ms && !t.archived && ((it && (it.lines || []).some(l => (Array.isArray(l) ? l[0] : l.task) === t.id)) || !M || (M.byId.get(t.id) && !M.byId.get(t.id).done && (M.byId.get(t.id).as != null || M.byId.get(t.id).pct > 0))));
  C.reports = {
    title: 'Ежедневные отчёты подрядчиков', one: 'отчёт', perm: 'settings', idp: 'rep', del: true, wide: true,
    list: def => (def.reports = def.reports || []),
    sort: () => (a, b) => String(b.date).localeCompare(String(a.date)),
    get: raw => { const chain = DSF.chainOf({ control: (UI.coll && defOf(UI.coll.t) || {}).control }); const ok = raw.ok || [];
      return Object.assign({}, raw, { q: Object.fromEntries((raw.lines || []).map(l => Array.isArray(l) ? [l[0], l[1]] : [l.task, l.v])), state: raw.ret ? 'ret' : chain.every(x => ok.includes(x)) ? 'full' : ok.length ? 'step1' : 'sub', retNote: typeof raw.ret === 'string' ? raw.ret : '' }); },
    put: o => { const chain = DSF.chainOf({ control: (UI.coll && defOf(UI.coll.t) || {}).control }); const x = Object.assign({}, o);
      x.lines = Object.entries(o.q || {}).filter(([, v]) => +v > 0).map(([k, v]) => [k, +v]);
      x.ok = o.state === 'full' ? chain.slice() : o.state === 'step1' ? chain.slice(0, 1) : [];
      if (o.state === 'ret') x.ret = o.retNote || 'Возвращён'; else delete x.ret;
      delete x.q; delete x.state; delete x.retNote; return x; },
    defaults: () => ({ date: today(), state: 'sub' }),
    schema: (def, it, M) => [
      { k: 'date', t: 'Дата работ', type: 'date', req: true, maxToday: true, w: 'third' }, { k: 'org', t: 'Подрядчик', req: true, w: 'third', list: [...new Set((def.contracts || []).map(c => c.contractor).filter(Boolean))] },
      { k: 'crew', t: 'Рабочих, чел.', type: 'number', min: 0, step: 1, w: 'third' },
      { type: 'section', t: 'Выполненные объёмы за день', hint: 'в единицах работы, если задан общий объём, иначе — в процентных пунктах' },
      ...repTasks(def, M, it).map(t => ({ k: 'q.' + t.id, t: t.name + ' (' + (t.qty ? (t.unit || 'ед.') : '%') + ')', type: 'number', min: 0, w: 'half' })),
      { type: 'section', t: 'Подтверждение', hint: 'цепочка: ' + DSF.chainOf(def).map(x => DSF.FACT_STEPS[x]).join(' → ') },
      { k: 'state', t: 'Состояние', type: 'select', req: true, opts: REP_STATE, w: 'half' }, { k: 'retNote', t: 'Причина возврата', w: 'half' },
      { k: 'note', t: 'Комментарий подрядчика' }
    ],
    validate: v => Object.entries(v).some(([k, x]) => k.startsWith('q.') && +x > 0) ? null : 'Укажите объём хотя бы по одной работе',
    cols: [['Дата', x => fd(dn(x.date))], ['Подрядчик', x => esc(x.org || '—')], ['Объёмы', (x, def) => esc((x.lines || []).map(l => { const id = Array.isArray(l) ? l[0] : l.task, v = Array.isArray(l) ? l[1] : l.v; const t = (def.tasks || []).find(z => z.id === id); return (t ? t.name : id) + ': ' + qn(v) + ' ' + (t && t.qty ? (t.unit || '') : '%'); }).join('; '))],
      ['Состояние', (x, def) => { const chain = DSF.chainOf(def); const ok = x.ok || []; return x.ret ? chip('возвращён', 'warn') : chain.every(c => ok.includes(c)) ? chip('подтверждён', 'good') : chip(ok.length ? 'ждёт: ' + DSF.FACT_STEPS[chain.find(c => !ok.includes(c))] : 'подан', 'accent'); }]]
  };
  C.remarks = {
    title: 'Замечания строительного контроля', one: 'замечание', perm: 'settings', idp: 'rm', del: true, wide: true,
    list: def => (def.remarks = def.remarks || []),
    sort: () => (a, b) => String(b.date).localeCompare(String(a.date)),
    defaults: () => ({ date: today(), due: iso(T() + 7), status: 'new', sev: 'major' }),
    schema: (def) => [
      { k: 'no', t: 'Номер', w: 'third' }, { k: 'sev', t: 'Важность', type: 'select', req: true, opts: Object.entries(DSF.REMARK_SEV).map(([k, v]) => [k, v.t]), w: 'third' }, { k: 'status', t: 'Статус', type: 'select', req: true, opts: Object.entries(DSF.REMARK_STATUS).map(([k, v]) => [k, v.t]), w: 'third' },
      { k: 'title', t: 'Замечание', req: true }, { k: 'desc', t: 'Описание', type: 'textarea', rows: 2 },
      { k: 'task', t: 'Работа', type: 'select', req: true, opts: taskOpts(def, t => !t.ms), w: 'half' }, { k: 'loc', t: 'Место', w: 'half' },
      { k: 'org', t: 'Исполнитель (подрядчик)', w: 'half', list: [...new Set((def.contracts || []).map(c => c.contractor).filter(Boolean))] }, { k: 'owner', t: 'Ответственный', w: 'half' },
      { k: 'date', t: 'Выдано', type: 'date', req: true, maxToday: true, w: 'third' }, { k: 'due', t: 'Срок устранения', type: 'date', req: true, w: 'third' }, { k: 'closed', t: 'Закрыто', type: 'date', maxToday: true, w: 'third' },
      { k: 'norm', t: 'Основание (проект, норматив)' }
    ],
    validate: v => v.status === 'closed' && !v.closed ? 'Для закрытого замечания укажите дату закрытия' : v.closed && v.closed < v.date ? 'Дата закрытия раньше даты выдачи' : null,
    cols: [['№', x => esc(x.no || x.id)], ['Замечание', x => `<b>${esc(x.title)}</b>`], ['Работа', (x, def) => esc(((def.tasks || []).find(t => t.id === x.task) || {}).name || '—')], ['Важность', x => chip((DSF.REMARK_SEV[x.sev] || {}).t || '—', (DSF.REMARK_SEV[x.sev] || {}).c)], ['Статус', x => esc((DSF.REMARK_STATUS[x.status] || {}).t || '—')], ['Срок', x => fd(dn(x.due))]]
  };
  C.glet = {
    title: 'Гарантийные письма по ИД', one: 'гарантийное письмо', perm: 'settings', idp: 'gl', del: true, wide: true,
    list: def => (def.letters = def.letters || []), filter: x => x.kind === 'guarantee',
    defaults: () => ({ kind: 'guarantee', dir: 'in', date: today(), status: 'Зарегистрировано' }),
    schema: (def, it, M) => [
      { k: 'no', t: 'Номер письма', req: true, w: 'third' }, { k: 'date', t: 'Дата', type: 'date', req: true, maxToday: true, w: 'third' }, { k: 'dueDate', t: 'Срок передачи ИД', type: 'date', req: true, w: 'third' },
      { k: 'from', t: 'Подрядчик', req: true, w: 'half', list: [...new Set((def.contracts || []).map(c => c.contractor).filter(Boolean))] }, { k: 'ks', t: 'КС-2', type: 'select', opts: M ? M.ks.filter(k => (DSF.KS_STATUS[k.status] || {}).r < 9).map(k => [k.id, k.contract.no + ' · ' + k.no]) : [], w: 'half' },
      { k: 'tasks', t: 'Работы без ИД', type: 'multi', opts: taskOpts(def, t => !t.ms) }, { k: 'subject', t: 'Тема' }
    ],
    before: (def, it) => { it.kind = 'guarantee'; it.dir = it.dir || 'in'; it.to = it.to || def.customer || ''; it.status = it.status || 'Зарегистрировано'; if (!it.subject) it.subject = 'Гарантийное письмо о передаче исполнительной документации'; },
    cols: [['Письмо', x => `<b>${esc(x.no)}</b> от ${fd(dn(x.date))}`], ['Подрядчик', x => esc(x.from || '—')], ['Срок ИД', x => fd(dn(x.dueDate))], ['КС-2', (x, def, M) => { const k = M && x.ks ? M.ksBy.get(x.ks) : null; return k ? esc(k.contract.no + ' · ' + k.no) : '—'; }]]
  };

  /* --- идентификация элементов коллекции --- */
  function itemsOf(key, def, parent) { const K = C[key]; const list = K.list(def, parent, false) || []; return list; }
  function findItem(key, list, id) {
    const K = C[key];
    if (K.idx) return list[+id];
    const k = K.idk || 'id';
    return list.find(x => String(x[k]) === String(id));
  }
  const itemId = (key, x, i) => C[key].idx ? i : x[C[key].idk || 'id'];

  /* --- таблица коллекции --- */
  function collTable(key, t, def, opt) {
    const K = C[key], o = opt || {}, M = o.M || null;
    let list = itemsOf(key, def, o.parent).map((x, i) => ({ x, i }));
    if (K.filter) list = list.filter(({ x }) => K.filter(x));
    if (K.sort) { const s = K.sort(def); list.sort((a, b) => s(a.x, b.x)); }
    const showA = UI.showArch && UI.showArch[key];
    const nArch = list.filter(({ x }) => x.archived).length;
    if (!showA) list = list.filter(({ x }) => !x.archived);
    const at = (x, i) => `data-c="${key}" data-t="${esc(t)}" data-i="${esc(itemId(key, x, i))}" ${o.parent ? `data-parent="${esc(o.parent)}"` : ''} data-perm="${K.perm}"`;
    const cols = K.cols || [];
    const ed = can(K.perm);
    return `<section class="panel ctab"><header><h2>${esc(o.title || K.title)}</h2><span class="sub">${list.length}${nArch ? ' · в архиве ' + nArch : ''}</span><span class="grow"></span>
      ${nArch ? `<button class="lnk" type="button" data-x="c-showarch" data-c="${key}">${showA ? 'Скрыть архив' : 'Показать архив'}</button>` : ''}
      ${o.noAdd ? '' : `<button class="btn sm primary" type="button" data-x="c-add" data-c="${key}" data-t="${esc(t)}" ${o.parent ? `data-parent="${esc(o.parent)}"` : ''} data-perm="${K.perm}">${ico('plus')}${esc(o.addText || 'Добавить ' + K.one)}</button>`}</header>
      ${o.note ? `<div class="pad" style="padding-bottom:0"><div class="note">${o.note}</div></div>` : ''}
      <div class="pad tbl-wrap">${list.length ? `<table class="t ct"><thead><tr>${cols.map(c => `<th class="l">${c[0]}</th>`).join('')}${ed ? '<th></th>' : ''}</tr></thead><tbody>
        ${list.map(({ x, i }) => `<tr class="${x.archived ? 'arch' : ''}">${cols.map(c => `<td class="l">${c[1](x, def, M)}</td>`).join('')}${ed ? `<td class="acts">
          ${K.hide ? `<button class="mini" type="button" data-x="c-hide" ${at(x, i)} title="${x.hidden ? 'Показать на графике' : 'Скрыть с графика'}" aria-label="Скрыть или показать">${ico(x.hidden ? 'eyeoff' : 'eye', 15)}</button>` : ''}
          ${K.arch ? `<button class="mini" type="button" data-x="c-arch" ${at(x, i)} title="${x.archived ? 'Восстановить из архива' : 'В архив'}" aria-label="Архив">${ico(x.archived ? 'restore' : 'archive', 15)}</button>` : ''}
          <button class="mini" type="button" data-x="c-edit" ${at(x, i)} title="Изменить" aria-label="Изменить">${ico('edit', 15)}</button></td>` : ''}</tr>`).join('')}
      </tbody></table>` : empty(o.emptyText || 'Пока ничего не добавлено.')}</div></section>`;
  }

  /* --- форма элемента коллекции --- */
  function collForm(M) {
    const st = UI.coll, K = C[st.key], def = defOf(st.t);
    const list = itemsOf(st.key, def, st.parent);
    const raw = st.id != null ? findItem(st.key, list, st.id) : null;
    const it = raw ? (K.get ? K.get(raw) : raw) : null;
    const val = it || Object.assign({}, K.defaults ? K.defaults() : {}, st.pre || {});
    const canDel = raw && K.del ? (K.canDel ? K.canDel(def, raw, M) : null) : 'нет';
    return `<form data-form="coll" class="mform"><div class="mh"><div><div class="eyebrow">${esc(K.title)}</div><h3 style="margin-top:4px">${it ? 'Изменить ' + esc(K.one) : 'Добавить ' + esc(K.one)}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">${fieldsHtml(K.schema(def, raw, M), val)}<div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button>
        ${raw && K.del && !canDel ? `<span class="grow"></span><button class="btn danger" type="button" data-x="c-del" data-c="${st.key}">${ico('trash')}Удалить</button>` : raw && K.del && canDel !== 'нет' ? `<span class="grow"></span><span class="hint" style="align-self:center">${esc(canDel)}</span>` : ''}</div></form>`;
  }
  function openColl(st) { UI.coll = st; UI.confirmC = null; openModal(collForm, { wide: !!C[st.key].wide, global: true }); }
  /* применение формы к описанию объекта */
  function applyColl(st, v, files) {
    const K = C[st.key];
    return def => {
      const list = K.list(def, st.parent, true);
      let raw = st.id != null ? findItem(st.key, list, st.id) : null;
      const prev = raw ? clone(K.get ? K.get(raw) : raw) : null;
      let obj = raw ? (K.get ? K.get(raw) : raw) : (K.make ? K.make(def) : {});
      Object.keys(v).forEach(k => { if (k !== 'file') setPath(obj, k, v[k]); });
      if (files && files.file) obj.file = files.file;
      if (!raw) {
        if (!K.idx) { const k = K.idk || 'id'; if (!obj[k] && K.idp) obj[k] = REG.nid(def, K.idp); }
        if (K.before) K.before(def, obj);
        list.push(K.put ? K.put(obj) : obj);
        if (K.after) K.after(def, obj, null);
      } else {
        if (K.before) K.before(def, obj);
        if (K.put) list[list.indexOf(raw)] = K.put(obj);
        if (K.after) K.after(def, obj, prev);
      }
      // пустые объекты влияния не нужны
      if (obj.effect && !Object.keys(obj.effect).length) delete obj.effect;
    };
  }
  FM.coll = function (f) {
    const st = UI.coll, K = C[st.key], def = defOf(st.t);
    if (!can(K.perm)) { toast('Недостаточно прав.'); return; }
    const raw = st.id != null ? findItem(st.key, itemsOf(st.key, def, st.parent), st.id) : null;
    const schema = K.schema(def, raw, st.t !== 'wizard' && st.t !== 'orgs' ? safeModel(st.t) : null);
    const { v, errs } = readFields(schema, f);
    if (errs.length) return showErr(f, errs.map(esc).join('<br>'));
    const e = K.validate ? K.validate(v, def, raw) : null;
    if (e) return showErr(f, esc(e));
    let files = null;
    const fileF = schema.find(x => x.type === 'file');
    if (fileF && v[fileF.k]) { files = { file: DSF.files.put(v[fileF.k][0]) }; }
    const fn = applyColl(st, v, files);
    if (commit(st.t, fn, (raw ? 'Изменено: ' : 'Добавлено: ') + K.one + (v.name || v.title || v.no || v.caption ? ' «' + (v.name || v.title || v.no || v.caption) + '»' : ''), f.querySelector('.err'))) refresh();
  };
  const safeModel = pid => { try { return byId(pid) ? DSF.build(byId(pid)) : null; } catch (e) { return null; } };
  A['c-add'] = (el, d) => { const K = C[d.c]; if (!can(K.perm)) return toast('Недостаточно прав.'); openColl({ key: d.c, t: d.t || tgt(), parent: d.parent || null, id: null, pre: d.pre ? JSON.parse(d.pre) : null }); };
  A['c-edit'] = (el, d) => { const K = C[d.c]; if (!can(K.perm)) return toast('Недостаточно прав.'); openColl({ key: d.c, t: d.t || tgt(), parent: d.parent || null, id: d.i }); };
  A['c-showarch'] = (el, d) => { UI.showArch = UI.showArch || {}; UI.showArch[d.c] = !UI.showArch[d.c]; keepPage(); };
  A['c-del'] = (el) => {
    const st = UI.coll, K = C[st.key];
    if (!can(K.perm)) return toast('Недостаточно прав.');
    if (UI.confirmC !== st.id) { UI.confirmC = st.id; el.innerHTML = ico('trash') + 'Подтвердить удаление'; return; }
    const fn = def => { const list = K.list(def, st.parent, true); const raw = findItem(st.key, list, st.id); if (!raw) return; if (K.onDel) K.onDel(def, raw); list.splice(list.indexOf(raw), 1); };
    if (commit(st.t, fn, 'Удалено: ' + K.one)) { UI.confirmC = null; refresh(); toast('Удалено.'); }
  };
  const toggleFlag = flag => (el, d) => {
    const K = C[d.c]; if (!can(K.perm)) return toast('Недостаточно прав.');
    const fn = def => { const list = K.list(def, d.parent, true); const x = findItem(d.c, list, d.i); if (!x) return; x[flag] = !x[flag] || undefined; if (flag === 'archived' && K.onArch) K.onArch(def, x); };
    if (commit(d.t || tgt(), fn, (flag === 'archived' ? 'Архив: ' : 'Видимость: ') + K.one)) keepPage();
  };
  A['c-arch'] = toggleFlag('archived');
  A['c-hide'] = toggleFlag('hidden');

  /* ====================================================================
   * ЭКРАНЫ НАСТРОЙКИ (общие для мастера и «Настроек объекта»)
   * ==================================================================== */
  const TABS = [
    ['main', 'Основное', 'building', 'settings'], ['parts', 'Участники', 'users', 'settings'], ['sections', 'Разделы', 'grid', 'settings'],
    ['schedule', 'График и вехи', 'gantt', 'schedule'], ['readiness', 'Готовность', 'target', 'settings'], ['budget', 'Бюджет и договоры', 'coins', 'budget'],
    ['docs', 'Документация', 'folder', 'settings'], ['control', 'Контроль и отчётность', 'shield', 'settings'], ['resources', 'Ресурсы', 'users', 'settings'], ['metrics', 'Показатели', 'chart', 'settings'],
    ['risks', 'Риски', 'alert', 'data'], ['photos', 'Фото', 'cam', 'data']
  ];
  const STATUS_OPTS = Object.entries(DSF.PROJECT_STATUS).map(([k, v]) => [k, v.t]);
  const MAIN_SCHEMA = () => [
    { type: 'section', t: 'Объект' },
    { k: 'name', t: 'Название проекта', req: true, ph: 'Например: Жилой комплекс «Северный»' },
    { k: 'short', t: 'Краткое название', w: 'third', ph: 'Северный' }, { k: 'code', t: 'Аббревиатура (2–3 буквы)', w: 'third', ph: 'СВ' },
    { k: 'type', t: 'Тип объекта', w: 'third', list: [...new Set(DSF.projects.map(p => p.type).filter(Boolean).concat(['Жилой комплекс', 'Бизнес-центр', 'Логистический комплекс', 'Гостиница', 'Офисный центр', 'Школа', 'Больница', 'Промышленный объект']))] },
    { k: 'fullName', t: 'Полное наименование' },
    { k: 'status', t: 'Статус', type: 'select', req: true, opts: STATUS_OPTS, w: 'half' }, { k: 'city', t: 'Город / регион', w: 'half' },
    { k: 'address', t: 'Адрес' }, { k: 'desc', t: 'Описание', type: 'textarea', rows: 3 },
    { type: 'section', t: 'Сроки' },
    { k: 'dates.start', t: 'Дата начала', type: 'date', w: 'third' }, { k: 'dates.planEnd', t: 'Плановая дата завершения', type: 'date', w: 'third' }, { k: 'dates.actualEnd', t: 'Фактическая дата завершения', type: 'date', maxToday: true, w: 'third' },
    { type: 'section', t: 'Основные технико-экономические показатели', hint: 'необязательные — пустые не показываются' },
    { k: 'params.area', t: 'Общая площадь, м²', type: 'number', min: 0, w: 'third' }, { k: 'params.floors', t: 'Этажность', type: 'number', min: 0, step: 1, w: 'third' }, { k: 'params.under', t: 'Подземных этажей', type: 'number', min: 0, step: 1, w: 'third' },
    { k: 'params.height', t: 'Высота, м', type: 'number', min: 0, w: 'half' }, { k: 'params.areaNote', t: 'Пояснение к площади', w: 'half' },
    { type: 'section', t: 'Обложка' },
    { k: 'coverFile', t: 'Изображение / обложка проекта', type: 'file', accept: 'image/*' }
  ];
  function tabMain(t, def) {
    const img = H.photoUrl(def.cover);
    return `<section class="panel"><header><h2>Основные сведения</h2>${t === 'wizard' ? '<span class="sub">обязательно только название</span>' : ''}</header>
      <div class="pad"><form data-form="main" class="mform plain">${fieldsHtml(MAIN_SCHEMA(), Object.assign({}, def, { status: def.status || 'active' }))}
        ${img ? `<div class="cover-prev"><img src="${img}" alt="Обложка"><label class="chk"><input type="checkbox" name="coverRemove"><span>Убрать обложку</span></label></div>` : ''}
        <div class="err" hidden></div>
        <div class="mf"><button class="btn primary" type="submit">${ico('check')}${t === 'wizard' ? 'Сохранить и далее' : 'Сохранить сведения'}</button></div></form></div></section>
      ${collTable('tep', t, def, { emptyText: 'Дополнительные показатели не заданы.' })}
      ${collTable('people', t, def, { emptyText: 'Ответственные лица не указаны.' })}`;
  }
  FM.main = function (f) {
    const t = tgt(), schema = MAIN_SCHEMA();
    const { v, errs } = readFields(schema, f);
    if (v['dates.start'] && v['dates.planEnd'] && v['dates.planEnd'] < v['dates.start']) errs.push('Плановая дата завершения раньше даты начала');
    if (errs.length) return showErr(f, errs.map(esc).join('<br>'));
    const cover = v.coverFile ? 'u:' + DSF.files.put(v.coverFile[0]).id : null;
    const rm = f.elements.coverRemove && f.elements.coverRemove.checked;
    const fn = def => { Object.keys(v).forEach(k => { if (k !== 'coverFile') setPath(def, k, v[k]); }); if (cover) def.cover = cover; else if (rm) delete def.cover; };
    if (!commit(t, fn, 'Изменены основные сведения', f.querySelector('.err'))) return;
    if (t === 'wizard') { wizStep(1); return; }
    keepPage(); toast('Сведения сохранены.');
  };
  function tabParts(t, def) {
    return collTable('parts', t, def, { note: 'Организации берутся из общего справочника: одна организация может участвовать в нескольких объектах. Подрядчики договоров добавляются в участники автоматически.', emptyText: 'Участники не добавлены.' });
  }
  function tabSections(t, def) {
    const on = DSF.sectionsOf(DSF.normalizeProject(Object.assign({ id: '__s' }, def)));
    return `<section class="panel"><header><h2>Функциональные разделы объекта</h2><span class="sub">отключённый раздел скрывается из меню и навигации; данные не удаляются</span></header>
      <div class="pad"><form data-form="sections" class="mform plain"><div class="secopts">${DSF.SECTION_DEFS.map(s => `<label class="secopt ${s.fixed ? 'fixed' : ''}"><input type="checkbox" name="sec" value="${s.k}" ${on.includes(s.k) ? 'checked' : ''} ${s.fixed ? 'disabled' : ''}><span class="si">${ico(s.ic)}</span><span><b>${esc(s.t)}</b><small>${esc(s.d)}</small></span></label>`).join('')}</div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}${t === 'wizard' ? 'Сохранить и далее' : 'Сохранить разделы'}</button></div></form></div></section>`;
  }
  FM.sections = function (f) {
    const t = tgt(), list = ['overview'].concat([...f.querySelectorAll('input[name="sec"]:checked')].map(x => x.value));
    const off = DSF.SECTION_DEFS.map(x => x.k).filter(k => !list.includes(k) && !DSF.SECTION_DEFS.find(x => x.k === k).fixed);
    if (!mutate(t, def => { def.sections = [...new Set(list)]; def.sectionsOff = off; }, 'Разделы объекта: ' + list.length)) return;
    if (t === 'wizard') return wizStep(1);
    keepPage(); toast('Разделы сохранены.');
  };
  function tabSchedule(t, def, M) {
    return `${collTable('stages', t, def, { emptyText: 'Создайте этапы (группы работ) — например «Подготовительный период», «Каркас», «Инженерные системы».' })}
      ${collTable('tasks', t, def, { M, emptyText: 'Работ пока нет. Добавьте работы с плановыми датами — по ним строится Гант, план/факт и прогноз.' })}
      ${collTable('ms', t, def, { M, emptyText: 'Вехи не заданы. Отметьте финальную веху «ввод объекта» — по ней считается прогноз завершения.' })}`;
  }
  function tabReadiness(t, def, M) {
    const rd = Object.assign({ mode: 'cost' }, def.readiness || {});
    const Mx = M || safeDraft(def);
    const st = ensureStagesRO(def);
    const tasks = (def.tasks || []).filter(x => !x.ms && !x.archived);
    const share = id => { if (!Mx) return '—'; const tt = Mx.byId.get(id); const W = sum(Mx.tasks, z => z.w); return tt && W ? num(tt.w / W * 100, 1) + '%' : '—'; };
    const preview = Mx ? (Mx.root.pc != null ? `Готовность на ${F.date(T())}: <b>${pct(Mx.root.pc)}</b> при плане ${pct(Mx.root.planNow)}` : '<b>Общая готовность не рассчитывается</b> — правила не настроены или веса не заданы. Система не подставляет условные значения.') : '';
    let body = '';
    if (rd.mode === 'weight') body = `<form data-form="weights" class="mform plain">
        <div class="note">Задайте коэффициенты этапам и/или работам. Если заданы веса этапов, вес этапа распределяется между его работами пропорционально их коэффициентам. Работы без коэффициента и с отключённым участием в готовности не учитываются.</div>
        ${st.length ? `<div class="tbl-wrap"><table class="t ct"><thead><tr><th class="l">Этап / работа</th><th>Вес этапа</th><th>Вес работы</th><th>Участвует</th><th>Доля в готовности</th></tr></thead><tbody>
        ${st.map((s, si) => `<tr class="stgrow"><td class="l"><b>${esc(s.name)}</b></td><td><input class="nin" type="number" min="0" step="any" name="sw_${si}" value="${s.weight != null ? s.weight : ''}"></td><td></td><td></td><td></td></tr>` +
          tasks.filter(x => x.stage === s.name).map(x => `<tr><td class="l" style="padding-left:22px">${esc(x.name)}</td><td></td><td><input class="nin" type="number" min="0" step="any" name="tw_${esc(x.id)}" value="${x.weight != null ? x.weight : ''}"></td><td><input type="checkbox" name="ti_${esc(x.id)}" ${x.inReady === false ? '' : 'checked'}></td><td>${share(x.id)}</td></tr>`).join('')).join('')}
        </tbody></table></div>` : empty('Сначала создайте этапы и работы в разделе «График и вехи».')}
        <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить веса</button></div></form>`;
    else if (rd.mode === 'manual') body = `<form data-form="rd-manual" class="mform plain"><div class="row-f">
        <div class="fld"><label for="rd-plan">Плановая готовность на ${F.date(T())}, %</label><input id="rd-plan" name="plan" type="number" min="0" max="100" step="0.1" value="${rd.plan != null ? rd.plan : ''}"></div>
        <div class="fld"><label for="rd-fact">Фактическая готовность на ${F.date(T())}, %</label><input id="rd-fact" name="fact" type="number" min="0" max="100" step="0.1" value="${rd.fact != null ? rd.fact : ''}"></div></div>
        <div class="fld"><label for="rd-note">Основание (комментарий)</label><input id="rd-note" name="note" value="${esc(rd.note || '')}"></div>
        <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button></div></form>`;
    else body = `<div class="note">Вес работы равен её стоимости. Исключить из расчёта можно статью бюджета (флаг «участвует в готовности» в статье) или отдельную работу (флаг в карточке работы). Работы без стоимости в расчёт не попадают.</div>
      <div class="tbl-wrap" style="margin-top:10px"><table class="t ct"><thead><tr><th class="l">Работа</th><th>Стоимость, млн ₽</th><th>Участвует</th><th>Доля</th></tr></thead><tbody>${tasks.map(x => `<tr><td class="l">${esc(x.name)}</td><td>${x.cost ? num(x.cost, 1) : '—'}</td><td>${Mx && Mx.byId.get(x.id) && Mx.byId.get(x.id).w > 0 ? '✓' : x.inReady === false ? 'исключена' : 'нет стоимости или статья исключена'}</td><td>${share(x.id)}</td></tr>`).join('') || `<tr><td colspan="4">${empty('Работ нет.')}</td></tr>`}</tbody></table></div>`;
    return `<section class="panel"><header><h2>Правила расчёта общей готовности</h2></header>
      <div class="pad"><div class="modes">${Object.entries(DSF.READINESS_MODES).map(([k, m]) => `<button class="modeopt" type="button" data-x="rd-mode" data-m="${k}" aria-pressed="${rd.mode === k}"><b>${esc(m.t)}</b><small>${esc(m.d)}</small></button>`).join('')}</div>
        <div class="note ${Mx && Mx.root.pc == null ? 'warn' : ''}" style="margin:14px 0">${preview}</div>${body}</div></section>`;
  }
  function ensureStagesRO(def) { const names = stageNames(def); return names.map(n => (def.stages || []).find(s => s.name === n) || { name: n }); }
  const safeDraft = def => { try { return modelOf(def, tgt() === 'wizard' ? '__draft' : tgt()); } catch (e) { return null; } };
  A['rd-mode'] = (el, d) => { if (mutate(tgt(), def => { def.readiness = Object.assign({}, def.readiness || {}, { mode: d.m }); }, 'Правило готовности: ' + DSF.READINESS_MODES[d.m].t)) keepPage(); };
  FM.weights = function (f) {
    const t = tgt();
    const fn = def => {
      const stg = ensureStages(def);
      ensureStagesRO(def).forEach((s, si) => { const v = f.elements['sw_' + si] ? f.elements['sw_' + si].value.trim().replace(',', '.') : ''; const x = stg.find(z => z.name === s.name); if (x) { if (v === '') delete x.weight; else x.weight = Math.max(0, +v); } });
      (def.tasks || []).forEach(x => {
        const w = f.elements['tw_' + x.id], ir = f.elements['ti_' + x.id];
        if (w) { const v = w.value.trim().replace(',', '.'); if (v === '') delete x.weight; else x.weight = Math.max(0, +v); }
        if (ir) { if (ir.checked) delete x.inReady; else x.inReady = false; }
      });
    };
    if (commit(t, fn, 'Весовые коэффициенты готовности')) { keepPage(); toast('Веса сохранены, готовность пересчитана.'); }
  };
  FM['rd-manual'] = function (f) {
    const fd0 = new FormData(f), num0 = k => { const s = String(fd0.get(k) || '').trim().replace(',', '.'); return s === '' ? null : Math.max(0, Math.min(100, +s)); };
    const fn = def => { def.readiness = Object.assign({}, def.readiness || {}, { mode: 'manual', plan: num0('plan'), fact: num0('fact'), note: String(fd0.get('note') || '').trim(), date: today() }); };
    if (commit(tgt(), fn, 'Готовность внесена вручную')) { keepPage(); toast('Готовность сохранена.'); }
  };
  function tabBudget(t, def) {
    const b = def.budget || {}, entered = def.finance === 'entered';
    const items = (b.items || []), total = sum(items, i => +i.budget || 0);
    return `<section class="panel"><header><h2>Параметры бюджета</h2></header><div class="pad">
      <form data-form="budgetcfg" class="mform plain"><div class="row-f">
        <div class="fld"><label for="bg-res">Резерв проекта, млн ₽</label><input id="bg-res" name="reserve" type="number" min="0" step="any" value="${b.reserve != null ? b.reserve : ''}"></div>
        <div class="fld"><label>Утверждённый бюджет</label><input value="${items.length ? num(total + (+b.reserve || 0), 1) + ' млн ₽ (статьи ' + num(total, 1) + ' + резерв)' : 'складывается из статей и резерва'}" readonly></div></div>
        <div class="note">${entered ? 'Финансовые показатели объекта — только по внесённым данным: КС-2, оплаты и дополнительные соглашения вносятся в карточке договора (раздел «Бюджет»). Если данных нет, показатели не рассчитываются.' : 'Для объекта из датасета используется модель актов и оплат движка (исторические КС-2 по графику, аванс и удержания).'}</div>
        <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button></div></form></div></section>
      ${collTable('items', t, def, { emptyText: 'Статей бюджета нет.' })}
      ${collTable('contracts', t, def, { emptyText: 'Договоров нет.', note: t !== 'wizard' ? 'Доп. соглашения, КС-2 и оплаты — в карточке договора: раздел «Бюджет» → договор.' : '' })}`;
  }
  FM.budgetcfg = function (f) {
    const s = String(new FormData(f).get('reserve') || '').trim().replace(',', '.');
    if (commit(tgt(), def => { def.budget = def.budget || { items: [] }; def.budget.reserve = s === '' ? 0 : Math.max(0, +s); }, 'Резерв бюджета')) { keepPage(); toast('Сохранено.'); }
  };
  function tabDocs(t, def, M) {
    return `<section class="panel"><header><h2>Документооборот объекта</h2></header><div class="pad"><div class="note">Системные категории (РД, ПД, ИД, КС, отчёты, письма, протоколы, разрешения, договоры) доступны всем объектам. Здесь задаются разделы и подразделы РД/ПД, дополнительные категории и предусмотренные документы — они попадают в подсчёт «предусмотрено / загружено / отсутствует». Загрузка файлов и движение редакций — в разделе «Документы».</div>
      ${!def.docSections || !def.docSections.length ? `<div class="mf" style="padding:12px 0 0"><button class="btn" type="button" data-x="docsec-preset" data-perm="settings">${ico('plus')}Добавить типовые разделы РД и ПД</button></div>` : ''}</div></section>
      ${collTable('docsec', t, def, { emptyText: 'Разделы не заданы.' })}
      ${collTable('doccat', t, def, { emptyText: 'Дополнительных категорий нет.' })}
      ${collTable('docpos', t, def, { M, emptyText: 'Предусмотренные документы не внесены.' })}`;
  }
  A['docsec-preset'] = () => {
    const base = ['ГП', 'АР', 'КР', 'ОВ', 'ВК', 'ЭОМ', 'СС', 'АПТ', 'ТХ', 'НС'];
    const fn = def => { def.docSections = def.docSections || []; ['rd', 'pd'].forEach(cat => base.forEach(code => { if (!def.docSections.some(x => x.cat === cat && x.code === code)) def.docSections.push({ id: REG.nid(def, 'ds'), cat, code, name: DSF.DOC_SECTIONS[code] }); })); };
    if (commit(tgt(), fn, 'Типовые разделы РД и ПД')) keepPage();
  };
  function tabResources(t, def) {
    const R = def.resources || {}, weeks = R.weeks || [];
    return `${collTable('kinds', t, def, { emptyText: 'Виды техники и оборудования не заданы.', note: 'Рабочие учитываются по подрядчикам — участникам объекта с ролью «Генеральный подрядчик», «Подрядчик» или «Поставщик».' })}
      <section class="panel ctab"><header><h2>Внесённые данные по неделям</h2><span class="sub">${weeks.length}</span><span class="grow"></span><button class="btn sm primary" type="button" data-x="res-entry">${ico('plus')}Внести данные недели</button></header>
      <div class="pad tbl-wrap">${weeks.length ? `<table class="t ct"><thead><tr><th class="l">Неделя</th><th>План, чел.</th><th>Факт, чел.</th><th>ИТР</th><th></th></tr></thead><tbody>${weeks.map((w, i) => i).reverse().map(i => `<tr><td class="l">${fd(dn(weeks[i]))}</td><td>${num(R.plan[i])}</td><td><b>${num(R.fact[i])}</b></td><td>${(R.itr || [])[i] != null ? num(R.itr[i]) : '—'}</td><td class="acts"><button class="mini" type="button" data-x="res-entry" data-i="${i}" aria-label="Изменить">${ico('edit', 15)}</button></td></tr>`).join('')}</tbody></table>` : empty('Данных пока нет.')}</div></section>`;
  }
  function tabMetrics(t, def) {
    const log = (def.metricLog || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const mn = id => ((def.metrics || []).find(m => m.id === id) || {});
    return `${collTable('metrics', t, def, { emptyText: 'Показатели не заданы. Пример: «Бетонирование — м³ — ежедневно», «Монтаж фасада — м² — еженедельно».' })}
      <section class="panel ctab"><header><h2>Внесённые значения</h2><span class="sub">${log.length}</span><span class="grow"></span>${(def.metrics || []).length ? `<button class="btn sm primary" type="button" data-x="metric-entry">${ico('plus')}Внести значения</button>` : ''}</header>
      <div class="pad tbl-wrap">${log.length ? `<table class="t ct"><thead><tr><th class="l">Дата</th><th class="l">Показатель</th><th>План</th><th>Факт</th><th class="l">Комментарий</th><th></th></tr></thead><tbody>${log.slice(0, 50).map(e => `<tr><td class="l">${fd(dn(e.date))}</td><td class="l">${esc(mn(e.metric).name || '—')}</td><td>${e.plan != null ? num(e.plan, 1) : '—'}</td><td><b>${num(e.fact, 1)}</b> ${esc(mn(e.metric).unit || '')}</td><td class="l">${esc(e.comment || '')}</td><td class="acts"><button class="mini" type="button" data-x="c-edit" data-c="mlog" data-t="${esc(t)}" data-i="${esc(e.id)}" data-perm="data" aria-label="Изменить">${ico('edit', 15)}</button></td></tr>`).join('')}</tbody></table>` : empty('Значения ещё не вносились.')}</div></section>`;
  }
  function tabRisks(t, def) { return collTable('risks', t, def, { emptyText: 'Рисков и проблемных вопросов нет.', addText: 'Добавить риск или проблему' }); }
  function tabPhotos(t, def) {
    return `<section class="panel"><header><h2>Категории фотографий</h2></header><div class="pad"><form data-form="photocats" class="mform plain"><div class="fld"><label for="pc-l">Категории (по одной на строку)</label><textarea id="pc-l" name="cats" rows="3" placeholder="Общий вид&#10;Скрытые работы&#10;Нарушения">${esc((def.photoCats || []).join('\n'))}</textarea></div><div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить категории</button></div></form></div></section>
      ${collTable('photos', t, def, { addText: 'Загрузить фото', emptyText: 'Фотографий нет.', noAdd: true })}
      <div class="mf" style="padding:0"><button class="btn primary" type="button" data-x="photo-upload">${ico('upload')}Загрузить фото</button></div>`;
  }
  FM.photocats = function (f) {
    const list = String(new FormData(f).get('cats') || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (mutate(tgt(), def => { def.photoCats = list; }, 'Категории фото')) { keepPage(); toast('Сохранено.'); }
  };

  /* --- контроль и отчётность: цепочка подтверждения факта, ИД, пороги сигналов --- */
  const CHAINS = [['tz,director', 'Технический заказчик → Директор'], ['director,tz', 'Директор → Технический заказчик'], ['tz', 'Только Технический заказчик'], ['director', 'Только Директор']];
  const CONTROL_SCHEMA = () => [
    { type: 'section', t: 'Ежедневный факт', hint: 'кто и в каком порядке подтверждает отчёт подрядчика; в график и КС-2 идёт только полностью подтверждённый факт' },
    { k: 'chain', t: 'Цепочка подтверждения', type: 'select', req: true, opts: CHAINS },
    { k: 'confirmDays', t: 'Сигнал, если отчёт ждёт подтверждения, дней', type: 'number', min: 1, step: 1, w: 'half' }, { k: 'paceMin', t: 'Сигнал, если темп ниже требуемого, %', type: 'number', min: 10, max: 100, step: 1, w: 'half' },
    { type: 'section', t: 'Исполнительная документация и КС-2' },
    { k: 'idRequired', t: 'КС-2 предъявляется только с принятой ИД (иначе — гарантийное письмо)', type: 'check' },
    { k: 'guaranteeDays', t: 'Срок гарантийного письма по умолчанию, дней', type: 'number', min: 1, step: 1, w: 'half' }, { k: 'ksDays', t: 'Сигнал, если КС-2 стоит на шаге, дней', type: 'number', min: 1, step: 1, w: 'half' },
    { type: 'section', t: 'Сроки' },
    { k: 'slipDays', t: 'Сигнал по сдвигу работы критического пути, дней', type: 'number', min: 1, step: 1, w: 'half' }, { k: 'rdDays', t: 'Контроль передачи РД до начала работ, дней', type: 'number', min: 1, step: 1, w: 'half' }
  ];
  function tabControl(t, def, M) {
    const c = Object.assign({}, DSF.CONTROL_DEFAULTS, def.control || {});
    const val = Object.assign({}, c, { chain: (c.factChain || ['tz', 'director']).join(',') });
    return `<section class="panel"><header><h2>Контроль и отчётность</h2><span class="sub">правила объекта — без изменения кода</span></header>
      <div class="pad"><form data-form="control" class="mform plain">${fieldsHtml(CONTROL_SCHEMA(), val)}<div class="err" hidden></div>
        <div class="mf"><button class="btn primary" type="submit">${ico('check')}${t === 'wizard' ? 'Сохранить и далее' : 'Сохранить правила'}</button></div></form></div></section>
      ${t === 'wizard' ? '' : collTable('reports', t, def, { M, note: 'Данные демо-объекта вымышлены и могут быть скорректированы здесь. Новые отчёты подрядчики подают в разделе «Производство».', emptyText: 'Отчётов нет.' })}
      ${t === 'wizard' ? '' : collTable('remarks', t, def, { emptyText: 'Замечаний нет.' })}
      ${t === 'wizard' ? '' : collTable('glet', t, def, { M, emptyText: 'Гарантийных писем нет.' })}`;
  }
  FM.control = function (f) {
    const t = tgt(), { v, errs } = readFields(CONTROL_SCHEMA(), f);
    if (errs.length) return showErr(f, errs.map(esc).join('<br>'));
    const fn = def => { def.control = Object.assign({}, def.control || {}, { factChain: String(v.chain).split(','), idRequired: !!v.idRequired });
      ['confirmDays', 'paceMin', 'guaranteeDays', 'ksDays', 'slipDays', 'rdDays'].forEach(k => { if (v[k] != null) def.control[k] = v[k]; else delete def.control[k]; }); };
    if (!commit(t, fn, 'Правила контроля и отчётности', f.querySelector('.err'))) return;
    if (t === 'wizard') return wizStep(1);
    keepPage(); toast('Правила сохранены: цепочка подтверждения и сигналы пересчитаны.');
  };
  const TAB_RENDER = { control: tabControl, main: tabMain, parts: tabParts, sections: tabSections, schedule: tabSchedule, readiness: tabReadiness, budget: tabBudget, docs: tabDocs, resources: tabResources, metrics: tabMetrics, risks: tabRisks, photos: tabPhotos };

  /* ====================================================================
   * НАСТРОЙКИ ОБЪЕКТА  (#<id>.settings.<вкладка>)
   * ==================================================================== */
  U.VIEWS.settings = function (M, r) {
    const P = M.P, pid = P.id;
    if (!can('settings') && !can('schedule') && !can('budget')) return { html: `<section class="panel" style="margin-top:12px"><div class="pad">${empty('Недостаточно прав для изменения настроек объекта.')}</div></section>` };
    const tabs = TABS.concat([['check', 'Проверка данных', 'check', 'view'], ['journal', 'Журнал изменений', 'list', 'view']]).filter(x => can(x[3]));
    const tab = tabs.some(x => x[0] === r.sub) ? r.sub : tabs[0][0];
    const def = REG.def(pid);
    const src = REG.isUser(pid) ? 'создан через интерфейс' : REG.isOverride(pid) ? 'датасет · изменён через интерфейс' : 'датасет';
    let body;
    if (tab === 'check') {
      const iss = M.issues;
      body = `<section class="panel"><header><h2>Проверка данных объекта</h2><span class="sub">${iss.filter(i => i.level === 'error').length} ошибок · ${iss.filter(i => i.level === 'warn').length} предупреждений</span></header><div class="pad">${iss.length ? `<div class="list">${iss.map(i => `<div class="li"><span class="t" style="color:${i.level === 'error' ? 'var(--crit)' : 'var(--warn-ink)'}">${esc(i.msg)}</span>${chip(i.level === 'error' ? 'ошибка' : 'предупреждение', i.level === 'error' ? 'crit' : 'warn')}</div>`).join('')}</div>` : empty('Противоречий в данных нет.')}</div></section>
        ${dangerZone(P)}`;
    } else if (tab === 'journal') {
      const log = REG.state.log.filter(x => x.pid === pid);
      body = `<section class="panel"><header><h2>Журнал изменений настроек</h2><span class="sub">${log.length}</span></header><div class="pad">${log.length ? `<div class="feed">${log.map(x => H.feedRow(dn(x.at.slice(0, 10)), 'var(--accent)', esc(x.text), new Date(x.at).toLocaleString('ru-RU') + ' · ' + ((DSF.ROLES[x.role] || {}).t || ''))).join('')}</div>` : empty('Изменений через интерфейс не было.')}</div></section>`;
    } else body = TAB_RENDER[tab](pid, def, M);
    const html = `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
        <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(P.name)} · ${esc(src)}</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Настройки <span class="ac">объекта</span></h1>
        <div class="muted" style="margin-top:6px; font-size:13px">Изменения сразу применяются во всех разделах объекта. Код приложения не меняется.</div></div>
        <div class="hd-r"><button class="btn" type="button" data-go="${pid}">${ico('grid')}К объекту</button></div></section>
      ${REG.isOverride(pid) ? `<div class="note">Объект подключён из датасета. Изменения через интерфейс сохраняются как редактируемая копия конфигурации; исходный датасет не меняется, к нему можно вернуться на вкладке «Проверка данных».</div>` : ''}
      <div class="seg stabs" role="tablist" aria-label="Настройки">${tabs.map(([k, tt]) => `<button type="button" role="tab" data-go="${link(pid, 'settings', k)}" aria-pressed="${tab === k}">${tt}</button>`).join('')}</div>
      ${body}`;
    return { html, crumb: (tabs.find(x => x[0] === tab) || [0, ''])[1] };
  };
  function dangerZone(P) {
    const pid = P.id;
    const items = [];
    if (can('admin')) items.push(`<div class="li"><span class="t">Перенести объект в архив<div class="faint" style="font-weight:400">объект скроется из портфеля; восстановить — в «Администрировании»</div></span><button class="btn sm" type="button" data-x="obj-archive" data-pid="${pid}">${ico('archive')}В архив</button></div>`);
    if (REG.isUser(pid) && can('admin')) items.push(`<div class="li"><span class="t">Удалить объект<div class="faint" style="font-weight:400">описание объекта и его операционные записи будут удалены без возможности восстановления</div></span><button class="btn sm danger" type="button" data-x="obj-delete" data-pid="${pid}">${ico('trash')}Удалить</button></div>`);
    return items.length ? `<section class="panel"><header><h2>Управление объектом</h2></header><div class="pad"><div class="list">${items.join('')}</div></div></section>` : '';
  }
  A['obj-reset'] = (el, d) => { if (UI.confirmO !== 'r' + d.pid) { UI.confirmO = 'r' + d.pid; el.innerHTML = 'Подтвердить сброс'; return; } REG.resetToDataset(d.pid); UI.confirmO = null; keepPage(); toast('Восстановлен исходный датасет.'); };
  A['obj-archive'] = (el, d) => { if (UI.confirmO !== 'a' + d.pid) { UI.confirmO = 'a' + d.pid; el.innerHTML = 'Подтвердить'; return; } REG.setArchived(d.pid, true); UI.confirmO = null; U.order(); go('admin'); toast('Объект перенесён в архив.'); };
  A['obj-restore'] = (el, d) => { REG.setArchived(d.pid, false); U.order(); keepPage(); toast('Объект восстановлен.'); };
  A['obj-delete'] = (el, d) => { if (UI.confirmO !== 'd' + d.pid) { UI.confirmO = 'd' + d.pid; el.innerHTML = 'Подтвердить удаление'; return; } REG.removeUser(d.pid); UI.confirmO = null; go(route().sec === 'admin' ? 'admin' : ''); U.render(); toast('Объект удалён.'); };

  /* ====================================================================
   * МАСТЕР «ДОБАВИТЬ ОБЪЕКТ»  (#new)
   * ==================================================================== */
  const WSTEPS = TABS.map(x => [x[0], x[1], x[2]]).concat([['review', 'Проверка и создание', 'check']]);
  function wizStep(dir) {
    const w = wiz(), i = WSTEPS.findIndex(s => s[0] === w.step);
    w.step = WSTEPS[Math.max(0, Math.min(WSTEPS.length - 1, i + dir))][0];
    saveDraft(); U.render(); window.scrollTo(0, 0);
  }
  U.VIEWS.new = function (M0, r) {
    if (!can('create')) return { html: `<section class="panel" style="margin-top:12px"><div class="pad">${empty('Создавать объекты может только администратор системы. Текущая роль: ' + esc(DSF.auth.name()) + '.')}</div></div></section>`, title: 'Добавить объект' };
    const w = wiz(), def = w.def;
    if (r.sub && WSTEPS.some(s => s[0] === r.sub)) w.step = r.sub;
    const i = WSTEPS.findIndex(s => s[0] === w.step), step = WSTEPS[i];
    const Md = safeDraft(def);
    let body;
    if (step[0] === 'review') {
      const iss = Md ? Md.issues : [];
      const rows = [
        ['Объект', def.name ? esc(def.name) : '<span style="color:var(--crit)">не указано название</span>'],
        ['Сроки', def.dates && (def.dates.start || def.dates.planEnd) ? fd(dn(def.dates.start)) + ' – ' + fd(dn(def.dates.planEnd)) : '—'],
        ['Участники', (def.participants || []).length], ['Разделы', DSF.sectionsOf(DSF.normalizeProject(Object.assign({ id: '__s' }, def))).map(k => DSF.SECTION_DEFS.find(s => s.k === k).s).join(', ')],
        ['Этапы / работы / вехи', ensureStagesRO(def).length + ' / ' + (def.tasks || []).filter(t => !t.ms).length + ' / ' + (def.tasks || []).filter(t => t.ms).length],
        ['Готовность', DSF.READINESS_MODES[(def.readiness || {}).mode || 'weight'].t + (Md && Md.root.pc != null ? ' · ' + pct(Md.root.pc) : ' · не рассчитывается')],
        ['Бюджет', ((def.budget || {}).items || []).length ? ((def.budget.items).length + ' статей · ' + num(sum(def.budget.items, x => +x.budget || 0) + (+def.budget.reserve || 0), 1) + ' млн ₽') : '—'],
        ['Договоры', (def.contracts || []).length], ['Разделы документации / документы', (def.docSections || []).length + ' / ' + (def.documents || []).length],
        ['Виды ресурсов / недель данных', ((def.resources || {}).kinds || []).length + ' / ' + ((def.resources || {}).weeks || []).length],
        ['Показатели', (def.metrics || []).length], ['Риски', (def.risks || []).length], ['Фото', (def.photos || []).length]
      ];
      body = `<section class="panel"><header><h2>Проверка перед созданием</h2></header><div class="pad">
        <dl class="kv kvw">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${iss.length ? `<div class="eyebrow" style="margin:16px 0 6px">Проверка данных</div><div class="list">${iss.map(x => `<div class="li"><span class="t" style="color:${x.level === 'error' ? 'var(--crit)' : 'var(--warn-ink)'}">${esc(x.msg)}</span></div>`).join('')}</div>` : ''}
        <div class="note" style="margin-top:14px">После создания объект появится в портфеле и получит рабочий стол с выбранными разделами. Все данные можно дополнять и менять в «Настройках объекта».</div>
        <div class="mf" style="padding:16px 0 0"><button class="btn primary" type="button" data-x="wiz-create" ${def.name ? '' : 'disabled'}>${ico('check')}Создать объект</button></div></div></section>`;
    } else body = TAB_RENDER[step[0]]('wizard', def, Md);
    const html = `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
        <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">Администрирование · новый объект</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Добавить <span class="ac">объект</span></h1>
        <div class="muted" style="margin-top:6px; font-size:13px">Шаг ${i + 1} из ${WSTEPS.length}: ${esc(step[1])}. Черновик сохраняется автоматически; любой шаг можно пропустить и заполнить позже.</div></div>
        <div class="hd-r"><button class="btn" type="button" data-x="wiz-reset">${ico('trash')}Очистить черновик</button>${def.name ? `<button class="btn primary" type="button" data-x="wiz-create">${ico('check')}Создать объект</button>` : ''}</div></section>
      <div class="wiz">
        <nav class="wsteps" aria-label="Шаги">${WSTEPS.map((s, k) => `<button type="button" data-x="wiz-go" data-s="${s[0]}" aria-current="${k === i ? 'step' : 'false'}" class="${k < i ? 'done' : ''}"><span class="n">${k + 1}</span>${esc(s[1])}</button>`).join('')}</nav>
        <div class="wbody">${body}
          <div class="wnav"><button class="btn" type="button" data-x="wiz-prev" ${i === 0 ? 'disabled' : ''}>${ico('left')}Назад</button><span class="grow"></span>${i < WSTEPS.length - 1 ? `<button class="btn" type="button" data-x="wiz-next">Далее${ico('right')}</button>` : ''}</div>
        </div>
      </div>`;
    return { html, title: 'Добавить объект' };
  };
  A['wiz-go'] = (el, d) => { wiz().step = d.s; saveDraft(); U.render(); window.scrollTo(0, 0); };
  A['wiz-next'] = () => wizStep(1);
  A['wiz-prev'] = () => wizStep(-1);
  A['wiz-reset'] = (el) => { if (UI.confirmW !== 1) { UI.confirmW = 1; el.innerHTML = 'Подтвердить очистку'; return; } UI.confirmW = 0; UI.wiz = { step: 'main', def: newDraft() }; saveDraft(); U.render(); };
  A['wiz-create'] = () => {
    const def = wiz().def;
    if (!def.name) { toast('Укажите название объекта на шаге «Основное».'); return; }
    let M; try { M = modelOf(def); } catch (e) { toast(esc('Объект не может быть создан: ' + e.message)); return; }
    const errs = M.issues.filter(i => i.level === 'error');
    if (errs.length) { toast('Исправьте ошибки данных перед созданием:<br>• ' + errs.slice(0, 4).map(i => esc(i.msg)).join('<br>• '), 8000); return; }
    const id = REG.create(def);
    if (!id) { toast(esc(REG.lastError || 'Не удалось сохранить объект.')); return; }
    UI.wiz = { step: 'main', def: newDraft() }; saveDraft();
    U.order(); go(id);
    toast(`Объект <b>${esc(def.name)}</b> создан и добавлен в портфель.`, 6000);
  };

  /* ====================================================================
   * ВНЕСЕНИЕ ДАННЫХ
   * ==================================================================== */
  /* факт выполнения работы */
  function factForm(M) {
    const pid = M.P.id, def = REG.def(pid);
    const works = (def.tasks || []).filter(x => !x.ms && !x.archived);
    const x = works.find(z => z.id === UI.factTask) || works.find(z => z.as && !z.af) || works[0];
    if (!x) return `<div class="mh"><h3>Нет работ</h3><button class="icon-btn" type="button" data-act="x-close">${ico('x')}</button></div>`;
    UI.factTask = x.id;
    const t = M.byId.get(x.id);
    return `<form data-form="fact" class="mform"><div class="mh"><div><div class="eyebrow">Корректировка факта (администрирование) · ${F.date(T())}</div><h3 style="margin-top:4px">${esc(x.name)}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="fld"><label for="fa-task">Работа</label><select id="fa-task" name="task">${works.map(z => `<option value="${esc(z.id)}" ${z.id === x.id ? 'selected' : ''}>${esc((z.stage ? z.stage + ' · ' : '') + z.name)}</option>`).join('')}</select></div>
        <div class="note">План: ${fd(dn(x.ps))} – ${fd(dn(x.pf))}${t ? ' · сейчас ' + num(t.pct, 1) + '% при плане на дату ' + pct(t.planNow) : ''}${x.qty ? ' · общий объём ' + num(x.qty, 1) + ' ' + esc(x.unit || '') : ''}</div>
        ${t && t.hist && t.hist.length ? `<div class="note warn">По работе ведётся ежедневный факт: здесь задаётся значение <b>на начало журнала</b> (${fd(t.histStart)}); подтверждённые отчёты (${t.qty ? num(t.qtyFact - (x.qtyFact || 0), 1) + ' ' + esc(t.unit || '') : '+' + num(t.pct - (x.pct || 0), 1) + ' п.п.'}) прибавляются к нему. Текущий факт меняется через отчёты подрядчика в разделе «Производство».</div>` : ''}
        <div class="row-f3">${x.qty ? `<div class="fld"><label for="fa-q">Фактический объём, ${esc(x.unit || '')}</label><input id="fa-q" name="qtyFact" type="number" min="0" step="any" value="${x.qtyFact != null ? x.qtyFact : ''}"></div>` : `<div class="fld"><label for="fa-p">% выполнения</label><input id="fa-p" name="pct" type="number" min="0" max="100" step="0.1" value="${x.pct != null ? x.pct : ''}"></div>`}
          <div class="fld"><label for="fa-as">Фактическое начало</label><input id="fa-as" name="as" type="date" max="${today()}" value="${esc(x.as || '')}"></div>
          <div class="fld"><label for="fa-af">Фактическое окончание</label><input id="fa-af" name="af" type="date" max="${today()}" value="${esc(x.af || '')}"></div></div>
        ${x.qty ? `<div class="fld"><label for="fa-qp">Плановый объём на отчётную дату (корректировка плана)</label><input id="fa-qp" name="qtyPlan" type="number" min="0" step="any" value="${x.qtyPlan != null ? x.qtyPlan : ''}"></div>` : ''}
        <div class="fld"><label for="fa-c">Комментарий</label><input id="fa-c" name="comment" value="${esc(x.comment || '')}"></div>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить факт</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  U.INPUTS['fa-task'] = e => { UI.factTask = e.target.value; U.renderLayer(); };
  A['fact-entry'] = (el, d) => { UI.factTask = d.id || UI.sel || null; openModal(factForm, { wide: true }); };
  FM.fact = function (f) {
    const r = route(), fd0 = new FormData(f), id = UI.factTask;
    const n = k => { const s = String(fd0.get(k) == null ? '' : fd0.get(k)).trim().replace(',', '.'); return s === '' ? null : +s; };
    const v = { as: fd0.get('as') || null, af: fd0.get('af') || null, comment: String(fd0.get('comment') || '').trim() || null };
    if (f.elements.qtyFact) v.qtyFact = n('qtyFact'); else v.pct = n('pct');
    if (f.elements.qtyPlan) v.qtyPlan = n('qtyPlan');
    const def = REG.def(r.pid), it = (def.tasks || []).find(z => z.id === id);
    const e = taskValidate(Object.assign({}, it, v), def, Object.assign({}, it, v));
    if (e) return showErr(f, esc(e));
    const fn = d => { const x = d.tasks.find(z => z.id === id); Object.keys(v).forEach(k => setPath(x, k, v[k])); };
    if (commit(r.pid, fn, 'Факт: ' + it.name, f.querySelector('.err'))) { refresh(); toast('Факт сохранён — готовность, прогноз и Гант пересчитаны.'); }
  };
  A['task-edit'] = (el, d) => { const r = route(); const def = REG.def(r.pid); const x = (def.tasks || []).find(z => z.id === d.id); openColl({ key: x && x.ms ? 'ms' : 'tasks', t: r.pid, id: d.id }); };

  /* ресурсы за неделю */
  function resForm() {
    const t = tgt(), def = defOf(t), R = def.resources || {}, i = UI.resIdx;
    const edit = i != null && R.weeks && R.weeks[i] != null;
    const date = edit ? R.weeks[i] : today();
    const last = edit ? null : null;
    const names = contractorNames(def);
    const kinds = [...new Set(((R.kinds || []).map(k => k.name)).concat((R.equipment || []).map(e => e.name)))];
    const bc = Object.fromEntries((R.byContractor || []).map(c => [c.name, c.n]));
    const eq = Object.fromEntries((R.equipment || []).map(e => [e.name, e.count]));
    const kindOf = n => (R.kinds || []).find(k => k.name === n) || (R.equipment || []).find(e => e.name === n) || {};
    void last;
    return `<form data-form="res-entry" class="mform"><div class="mh"><div><div class="eyebrow">Ресурсы на площадке</div><h3 style="margin-top:4px">${edit ? 'Данные недели ' + fd(dn(date)) : 'Внести данные недели'}</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">
        <div class="row-f">
          <div class="fld"><label for="rs-d">Дата (неделя)</label><input id="rs-d" name="date" type="date" required max="${today()}" value="${esc(date)}" ${edit ? 'readonly' : ''}></div>
          <div class="fld"><label for="rs-i">ИТР, чел.</label><input id="rs-i" name="itr" type="number" min="0" step="1" value="${edit && R.itr && R.itr[i] != null ? R.itr[i] : ''}"></div></div>
        <div class="row-f">
          <div class="fld"><label for="rs-p">Рабочие — план, чел.</label><input id="rs-p" name="plan" type="number" min="0" step="1" value="${edit ? R.plan[i] : ''}"></div>
          <div class="fld"><label for="rs-f">Рабочие — факт, чел.</label><input id="rs-f" name="fact" type="number" min="0" step="1" value="${edit ? R.fact[i] : ''}"><span class="hint">если пусто — сумма по подрядчикам</span></div></div>
        ${names.length ? `<div class="fsec">Рабочие по подрядчикам${edit && i !== (R.weeks.length - 1) ? '<span>сохраняются только для последней недели</span>' : ''}</div><div class="grid-in">${names.map((n, k) => `<div class="fld"><label for="rs-c${k}">${esc(n)}</label><input id="rs-c${k}" name="c_${k}" data-name="${esc(n)}" type="number" min="0" step="1" value="${!edit || i === R.weeks.length - 1 ? (bc[n] != null ? bc[n] : '') : ''}"></div>`).join('')}</div>` : '<div class="note">Подрядчиков в участниках объекта нет — численность вносится одной цифрой.</div>'}
        ${kinds.length ? `<div class="fsec">Техника, оборудование и прочие ресурсы</div><div class="grid-in">${kinds.map((n, k) => `<div class="fld"><label for="rs-k${k}">${esc(n)}, ${esc(kindOf(n).unit || 'ед.')}</label><input id="rs-k${k}" name="k_${k}" data-name="${esc(n)}" type="number" min="0" step="1" value="${!edit || i === R.weeks.length - 1 ? (eq[n] != null ? eq[n] : '') : ''}"></div>`).join('')}</div>` : `<div class="note">Виды техники не заданы — их можно создать в «Настройках объекта → Ресурсы».</div>`}
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button>${edit ? `<span class="grow"></span><button class="btn danger" type="button" data-x="res-del">${ico('trash')}Удалить неделю</button>` : ''}</div></form>`;
  }
  A['res-entry'] = (el, d) => { UI.resIdx = d.i != null && d.i !== '' ? +d.i : null; openModal(resForm, { wide: true, global: true }); };
  FM['res-entry'] = function (f) {
    const t = tgt(), def = defOf(t), R0 = def.resources || {};
    const fd0 = new FormData(f), n = k => { const s = String(fd0.get(k) || '').trim(); return s === '' ? null : Math.max(0, Math.round(+s)); };
    const date = fd0.get('date');
    if (!date) return showErr(f, 'Укажите дату');
    if (date > today()) return showErr(f, 'Дата не может быть позже отчётной даты ' + F.date(T()));
    const cons = [...f.querySelectorAll('input[name^="c_"]')].map(x => ({ name: x.dataset.name, n: x.value === '' ? null : Math.max(0, Math.round(+x.value)) })).filter(x => x.n != null);
    const eqs = [...f.querySelectorAll('input[name^="k_"]')].map(x => ({ name: x.dataset.name, count: x.value === '' ? null : Math.max(0, Math.round(+x.value)) })).filter(x => x.count != null);
    let fact = n('fact');
    const cs = sum(cons, c => c.n);
    if (fact == null && cons.length) fact = cs;
    if (fact == null) return showErr(f, 'Укажите фактическую численность рабочих');
    if (cons.length && cs !== fact) return showErr(f, 'Сумма по подрядчикам (' + cs + ') не совпадает с фактом (' + fact + ').');
    const plan = n('plan'), itr = n('itr');
    const fn = d => {
      d.resources = d.resources || {}; const R = d.resources;
      ['weeks', 'plan', 'fact', 'itr'].forEach(k => { R[k] = R[k] || []; });
      while (R.itr.length < R.weeks.length) R.itr.push(null);
      let i = R.weeks.indexOf(date);
      if (i < 0) { R.weeks.push(date); R.plan.push(plan != null ? plan : fact); R.fact.push(fact); R.itr.push(itr); }
      else { R.plan[i] = plan != null ? plan : R.plan[i]; R.fact[i] = fact; R.itr[i] = itr; }
      const ord = R.weeks.map((w, k) => k).sort((a, b) => R.weeks[a].localeCompare(R.weeks[b]));
      ['weeks', 'plan', 'fact', 'itr'].forEach(k => { R[k] = ord.map(j => R[k][j]); });
      if (R.itr.every(v => v == null)) R.itr = [];
      if (date === R.weeks[R.weeks.length - 1]) {
        // снимок последней недели: численность по подрядчикам и техника по видам
        if (cons.length) R.byContractor = cons;
        const kinds = R.kinds || [];
        if (eqs.length || f.querySelector('input[name^="k_"]')) R.equipment = eqs.map(e => { const k = kinds.find(z => z.name === e.name) || (R.equipment || []).find(z => z.name === e.name) || {}; return Object.assign({ name: e.name, count: e.count }, k.cat ? { cat: k.cat } : {}, k.unit ? { unit: k.unit } : {}); });
      }
    };
    if (commit(t, fn, 'Ресурсы за ' + F.date(dn(date)), f.querySelector('.err'))) { refresh(); toast('Данные ресурсов сохранены.'); }
  };
  A['res-del'] = (el) => {
    if (UI.confirmR !== 1) { UI.confirmR = 1; el.innerHTML = 'Подтвердить удаление'; return; }
    UI.confirmR = 0; const i = UI.resIdx;
    const fn = d => { const R = d.resources; ['weeks', 'plan', 'fact', 'itr'].forEach(k => { if (R[k] && R[k].length > i) R[k].splice(i, 1); }); };
    if (commit(tgt(), fn, 'Удалена неделя ресурсов')) refresh();
  };

  /* значения периодических показателей */
  function metricForm() {
    const t = tgt(), def = defOf(t), mets = (def.metrics || []).filter(m => !m.archived);
    return `<form data-form="metric-entry" class="mform"><div class="mh"><div><div class="eyebrow">Производственные показатели</div><h3 style="margin-top:4px">Внести значения</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb"><div class="fld" style="max-width:220px"><label for="me-d">Дата</label><input id="me-d" name="date" type="date" required max="${today()}" value="${today()}"></div>
        <div class="tbl-wrap"><table class="t ct me"><thead><tr><th class="l">Показатель</th><th>План</th><th>Факт</th><th class="l">Комментарий</th><th class="l">Вложение</th></tr></thead><tbody>
        ${mets.map(m => `<tr><td class="l"><b>${esc(m.name)}</b><div class="faint" style="font-size:11.5px">${esc(m.unit)} · ${esc(PERIODS[m.period] || '')}</div></td><td><input class="nin" type="number" step="any" name="p_${esc(m.id)}" value="${m.plan != null ? m.plan : ''}"></td><td><input class="nin" type="number" step="any" name="f_${esc(m.id)}"></td><td class="l"><input class="tin" name="c_${esc(m.id)}"></td><td class="l"><input type="file" name="a_${esc(m.id)}" class="fin"></td></tr>`).join('')}
        </tbody></table></div><span class="hint">Сохраняются строки, где указан факт. Повторный ввод за ту же дату заменяет значение.</span><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  A['metric-entry'] = () => openModal(metricForm, { wide: true, global: true });
  FM['metric-entry'] = function (f) {
    const t = tgt(), def = defOf(t), date = f.elements.date.value;
    if (!date || date > today()) return showErr(f, 'Укажите дату не позже отчётной ' + F.date(T()));
    const rows = (def.metrics || []).filter(m => !m.archived).map(m => {
      const fv = f.elements['f_' + m.id].value.trim().replace(',', '.'), pv = f.elements['p_' + m.id].value.trim().replace(',', '.');
      if (fv === '') return null;
      const file = f.elements['a_' + m.id].files[0];
      return { metric: m.id, date, fact: +fv, plan: pv === '' ? null : +pv, comment: f.elements['c_' + m.id].value.trim() || null, file: file ? DSF.files.put(file) : null };
    }).filter(Boolean);
    if (!rows.length) return showErr(f, 'Укажите факт хотя бы по одному показателю');
    const fn = d => {
      d.metricLog = d.metricLog || [];
      rows.forEach(x => {
        const ex = d.metricLog.find(e => e.metric === x.metric && e.date === x.date);
        const rec = Object.assign(ex || { id: REG.nid(d, 'mv') }, x);
        Object.keys(rec).forEach(k => { if (rec[k] == null) delete rec[k]; });
        if (!ex) d.metricLog.push(rec);
      });
    };
    if (commit(t, fn, 'Значения показателей за ' + F.date(dn(date)), f.querySelector('.err'))) { refresh(); toast('Значения сохранены.'); }
  };

  /* фотографии */
  function photoForm(M) {
    const t = tgt(), def = defOf(t);
    return `<form data-form="photo-upload" class="mform"><div class="mh"><div><div class="eyebrow">Фотохроника</div><h3 style="margin-top:4px">Загрузить фото</h3></div><button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button></div>
      <div class="mb">${DSF.files.persistent ? '' : '<div class="note warn">Хранилище файлов браузера недоступно: фото будут видны только до закрытия вкладки.</div>'}
        <div class="fld"><label for="ph-f">Файлы изображений <span class="req">*</span></label><input id="ph-f" name="files" type="file" accept="image/*" multiple required></div>
        ${fieldsHtml([{ k: 'caption', t: 'Подпись', req: true }, { k: 'date', t: 'Дата съёмки', type: 'date', req: true, maxToday: true, w: 'half' }, { k: 'cat', t: 'Категория', w: 'half', list: def.photoCats || [] },
          { k: 'stage', t: 'Этап', type: 'select', opts: stageNames(def).map(s => [s, s]), w: 'half' }, { k: 'task', t: 'Работа', type: 'select', opts: taskOpts(def, x => !x.ms), w: 'half' },
          { k: 'desc', t: 'Описание', type: 'textarea', rows: 2 }, { k: 'author', t: 'Автор' }], { date: today(), author: DSF.auth.name() })}
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('upload')}Загрузить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  A['photo-upload'] = () => openModal(photoForm, { wide: true, global: true });
  FM['photo-upload'] = function (f) {
    const t = tgt(), def = defOf(t);
    const files = [...f.elements.files.files];
    if (!files.length) return showErr(f, 'Выберите файл');
    if (files.some(x => x.type && !x.type.startsWith('image/'))) return showErr(f, 'Можно загружать только изображения');
    const schema = [{ k: 'caption', t: 'Подпись', req: true }, { k: 'date', t: 'Дата съёмки', type: 'date', req: true, maxToday: true }, { k: 'cat', t: 'Категория' }, { k: 'stage', t: 'Этап', type: 'select' }, { k: 'task', t: 'Работа', type: 'select' }, { k: 'desc', t: 'Описание' }, { k: 'author', t: 'Автор' }];
    const { v, errs } = readFields(schema, f);
    if (errs.length) return showErr(f, errs.map(esc).join('<br>'));
    const task = v.task && (def.tasks || []).find(x => x.id === v.task);
    if (task && (!task.as || v.date < task.as)) return showErr(f, task.as ? 'Дата съёмки раньше фактического начала работы «' + esc(task.name) + '» (' + F.date(dn(task.as)) + ')' : 'Работа «' + esc(task.name) + '» ещё не начата — привяжите фото к этапу или другой работе');
    const metas = files.map(x => DSF.files.put(x));
    const fn = d => { d.photos = d.photos || []; metas.forEach((m, k) => { const p = { file: 'u:' + m.id }; Object.keys(v).forEach(key => { if (v[key] != null) p[key] = v[key]; }); if (files.length > 1) p.caption = v.caption + ' (' + (k + 1) + ')'; if (!p.stage && task) p.stage = task.stage; d.photos.push(p); }); if (v.cat && !(d.photoCats || []).includes(v.cat)) d.photoCats = (d.photoCats || []).concat([v.cat]); };
    if (commit(t, fn, 'Загружено фото: ' + files.length, f.querySelector('.err'))) { refresh(); toast('Фото загружено: ' + files.length + '.'); }
  };
  A['photo-edit'] = (el, d) => { UI.viewer = null; openColl({ key: 'photos', t: route().pid, id: d.file }); };

  /* риски */
  A['risk-new'] = () => openColl({ key: 'risks', t: route().pid, id: null, pre: { kind: 'risk', status: 'Открыт', p: 3, i: 3, since: today() } });
  A['risk-edit'] = (el, d) => openColl({ key: 'risks', t: route().pid, id: d.id });

  /* договор: изменение, доп. соглашения, КС-2, оплаты */
  A['ct-edit'] = (el, d) => openColl({ key: 'contracts', t: route().pid, id: d.cid });
  A['ct-supp'] = (el, d) => openColl({ key: 'supp', t: route().pid, parent: d.cid, id: null, pre: { date: today() } });
  A['ct-pay'] = (el, d) => openColl({ key: 'pay', t: route().pid, parent: d.cid, id: null, pre: { date: today(), kind: 'act' } });
  A['ct-act'] = (el, d) => { const def = REG.def(route().pid), c = ctOf(def, d.cid); openColl({ key: 'acts', t: route().pid, parent: d.cid, id: null, pre: { date: today(), period: today(), status: 'agreed', no: 'КС-2 № ' + (((c && c.acts) || []).length + 1) } }); };

  /* роль пользователя */

  /* ====================================================================
   * РАЗДЕЛ «ПРОИЗВОДСТВЕННЫЕ ПОКАЗАТЕЛИ»
   * ==================================================================== */
  U.VIEWS.metrics = function (M) {
    const P = M.P, mets = (P.metrics || []).filter(m => !m.archived);
    const log = (P.metricLog || []).map(x => Object.assign({}, x, { d: dn(x.date) })).sort((a, b) => b.d - a.d);
    const sel = UI.metricSel && mets.some(m => m.id === UI.metricSel) ? UI.metricSel : 'all';
    const head = `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
      <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(P.name)} · периодическая отчётность</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Производственные <span class="ac">показатели</span></h1>
      <div class="muted" style="margin-top:6px; font-size:13px">Работа → показатель → единица → план → факт → дата → комментарий → вложение. Состав показателей задаётся в настройках объекта.</div></div>
      <div class="hd-r">${can('settings') ? `<button class="btn" type="button" data-go="${link(P.id, 'settings', 'metrics')}">${ico('gear')}Показатели</button>` : ''}${mets.length && can('data') ? `<button class="btn primary" type="button" data-x="metric-entry">${ico('plus')}Внести значения</button>` : ''}</div></section>`;
    if (!mets.length) return { html: head + `<section class="panel"><div class="pad">${empty('Показатели для объекта не настроены.')}</div></section>` };
    const cards = mets.map(m => {
      const es = log.filter(e => e.metric === m.id), last = es[0], tot = sum(es, e => e.fact), pl = sum(es.filter(e => e.plan != null), e => e.plan);
      const tk = m.task ? M.byId.get(m.task) : null;
      const chron = es.slice(0, 14).reverse();
      return `<button class="mcard" type="button" data-x="metric-sel" data-id="${esc(m.id)}" aria-pressed="${sel === m.id}">
        <span class="eyebrow">${esc(PERIODS[m.period] || '')}${tk ? ' · ' + esc(tk.name) : m.stage ? ' · ' + esc(m.stage) : ''}</span>
        <b class="mn">${esc(m.name)}</b>
        <span class="mv">${last ? num(last.fact, 1) : '—'} <small>${esc(m.unit)}${last ? ' · ' + F.date(last.d) : ''}</small></span>
        <span class="ms">${last && last.plan != null ? 'план ' + num(last.plan, 1) + ' · ' + (last.fact >= last.plan ? '<span style="color:var(--good)">выполнен</span>' : '<span style="color:var(--warn-ink)">ниже плана на ' + num(last.plan - last.fact, 1) + '</span>') : 'план на период ' + (m.plan != null ? num(m.plan, 1) : '—')}</span>
        ${m.total ? `<span class="minib"><span class="bar"><i style="width:${Math.min(100, tot / m.total * 100).toFixed(1)}%; --c:var(--accent)"></i></span><b>${num(Math.min(100, tot / m.total * 100), 0)}%</b></span><span class="ms">накоплено ${num(tot, 1)} из ${num(m.total, 1)}</span>` : `<span class="ms">накоплено ${num(tot, 1)}${pl ? ' при плане ' + num(pl, 1) : ''}</span>`}
        ${chron.length > 1 ? H.spark(chron.map(e => e.fact), chron.map(e => e.plan != null ? e.plan : e.fact), 160, 30) : ''}
      </button>`;
    }).join('');
    const rows = log.filter(e => sel === 'all' || e.metric === sel);
    const mn = id => mets.find(m => m.id === id) || (P.metrics || []).find(m => m.id === id) || {};
    const html = head + `<section class="mcards">${cards}</section>
      <section class="panel"><header><h2>История значений</h2><span class="sub">${sel === 'all' ? 'все показатели' : esc(mn(sel).name)} · ${rows.length}</span><span class="grow"></span>${sel !== 'all' ? `<button class="lnk" type="button" data-x="metric-sel" data-id="all">Все показатели</button>` : ''}</header>
      <div class="pad tbl-wrap">${rows.length ? `<table class="t"><thead><tr><th class="l">Дата</th><th class="l">Показатель</th><th>План</th><th>Факт</th><th>Отклонение</th><th class="l">Комментарий</th><th class="l">Вложение</th></tr></thead><tbody>${rows.slice(0, 200).map(e => { const m = mn(e.metric), dv = e.plan != null ? e.fact - e.plan : null, fl = e.file && DSF.files.get(e.file.id); return `<tr><td class="l">${F.date(e.d)}</td><td class="l">${esc(m.name || '—')}</td><td>${e.plan != null ? num(e.plan, 1) : '—'}</td><td><b>${num(e.fact, 1)}</b> ${esc(m.unit || '')}</td><td class="${dv == null ? '' : dv < 0 ? 'pos' : 'neg'}">${dv == null ? '—' : (dv > 0 ? '+' : dv < 0 ? '−' : '') + num(Math.abs(dv), 1)}</td><td class="l w">${esc(e.comment || '')}</td><td class="l">${e.file ? (fl ? `<button class="lnk" type="button" data-x="file-save" data-fid="${esc(e.file.id)}" data-name="${esc(e.file.name)}">${esc(e.file.name)}</button>` : esc(e.file.name) + ' <span class="faint">(файл недоступен в этом браузере)</span>') : ''}</td></tr>`; }).join('')}</tbody></table>` : empty('Значения ещё не вносились.')}</div></section>`;
    return { html };
  };
  A['metric-sel'] = (el, d) => { UI.metricSel = d.id; keepPage(); };

  /* ====================================================================
   * АДМИНИСТРИРОВАНИЕ  (#admin)
   * ==================================================================== */
  U.VIEWS.admin = function () {
    if (!can('admin')) return { html: `<section class="panel" style="margin-top:12px"><div class="pad">${empty('Раздел доступен администратору системы.')}</div></section>`, title: 'Администрирование' };
    const defs = REG.state.defs;
    const rows = DSF.projects.map(p => ({ p, id: p.id, arch: false })).concat(Object.keys(defs).filter(id => defs[id].archived).map(id => ({ p: defs[id], id, arch: true })));
    const srcOf = id => REG.isUser(id) ? chip('создан в интерфейсе', 'accent') : REG.isOverride(id) ? chip('датасет · изменён', 'warn') : chip('датасет', 'neutral');
    const used = (() => { try { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('flow-')) n += (localStorage.getItem(k) || '').length; } return n; } catch (e) { return null; } })();
    const html = `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end">
        <div style="flex:1 1 360px; min-width:0"><div class="eyebrow">Flow — цифровой штаб строительства${DSF.mode === 'demo' ? ' · демо-режим' : ''}</div><h1 style="margin-top:8px; font-size:clamp(24px,2.6vw,34px)">Администри<span class="ac">рование</span></h1>
        <div class="muted" style="margin-top:6px; font-size:13px">Подключение объектов, справочник организаций, роли и права, хранилище и журнал изменений.</div></div>
        <div class="hd-r"><button class="btn primary" type="button" data-go="new">${ico('plus')}Добавить объект</button>${DSF.mode === 'demo' ? `<button class="btn" type="button" data-go="base">${ico('users')}База подрядчиков</button>` : ''}</div></section>
      <section class="panel"><header><h2>Объекты</h2><span class="sub">${rows.length}</span></header>
        <div class="pad tbl-wrap"><table class="t ct"><thead><tr><th class="l">Объект</th><th class="l">Источник</th><th class="l">Статус</th><th class="l">Разделы</th><th class="l">Изменён</th><th></th></tr></thead><tbody>
        ${rows.map(({ p, id, arch }) => `<tr class="${arch ? 'arch' : ''}"><td class="l"><b>${esc(p.name)}</b><div class="faint" style="font-size:12px">#${esc(id)}</div></td><td class="l">${srcOf(id)}</td><td class="l">${arch ? chip('в архиве', 'neutral') : esc((DSF.PROJECT_STATUS[p.status] || {}).t || 'Строительство')}</td><td class="l">${arch ? '—' : DSF.sectionsOf(p).length}</td><td class="l">${defs[id] && defs[id].updatedAt ? new Date(defs[id].updatedAt).toLocaleString('ru-RU') : '—'}</td>
          <td class="acts" style="white-space:nowrap">${arch ? `<button class="btn sm" type="button" data-x="obj-restore" data-pid="${esc(id)}">${ico('restore')}Восстановить</button>` : `<button class="btn sm" type="button" data-go="${esc(id)}">Открыть</button> <button class="btn sm" type="button" data-go="${esc(id)}.settings">${ico('gear')}Настройки</button>`}</td></tr>`).join('')}
        </tbody></table></div></section>
      ${collTable('orgs', 'orgs', REG.state, { emptyText: 'Справочник пуст. Организации добавляются здесь, в участниках объекта или автоматически из договоров.' })}
      ${DSF.mode === 'demo' ? '' : `<section class="panel"><header><h2>Роли и права</h2><span class="sub">роль определяется учётной записью при входе · права проверяет сервер</span></header>
        <div class="pad tbl-wrap"><table class="t ct"><thead><tr><th class="l">Право</th>${Object.values(DSF.ROLES).map(r => `<th>${esc(r.t)}</th>`).join('')}</tr></thead><tbody>${Object.entries(DSF.PERMS).map(([k, t]) => `<tr><td class="l">${esc(t)}</td>${Object.values(DSF.ROLES).map(r => `<td>${r.perms.includes(k) ? '✓' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`}
      <section class="panel"><header><h2>Хранилище данных</h2></header><div class="pad">
        <dl class="kv kvw"><dt>Описания объектов и справочники</dt><dd>${REG.persistent() ? 'localStorage браузера' : '<span style="color:var(--crit)">недоступно — изменения действуют только до перезагрузки страницы</span>'}${used != null ? ' · занято ' + num(used / 1024, 0) + ' КБ' : ''}</dd>
          <dt>Файлы (документы, фото, вложения)</dt><dd>${DSF.files.persistent ? 'IndexedDB браузера · файлов: ' + DSF.files.map.size : '<span style="color:var(--warn-ink)">IndexedDB недоступна — файлы хранятся только до закрытия вкладки</span>'}</dd>
          <dt>Операционные записи</dt><dd>${DSF.mode === 'demo' ? 'события, отчёты, КС-2, замечания, корректировки — журнал объекта на сервере Flow (права проверяются сервером)' : 'события, поручения, КС-2, письма — журнал действий объекта в этом браузере; данные объекта — рабочий модуль объекта'}</dd></dl>
        <div class="note" style="margin-top:12px">${DSF.mode === 'demo' ? 'Действия пользователей демо-режима хранятся на сервере в отдельном демо-хранилище и не затрагивают реальные объекты. Настройки объектов, созданных в интерфейсе, хранятся в этом браузере.' : 'Настройки объектов, созданных в интерфейсе, хранятся в этом браузере.'} Экспорт сохраняет конфигурацию и данные всех объектов (без самих файлов) — его можно перенести в другой браузер или использовать для загрузки в серверное хранилище.</div>
        <div class="mf" style="padding:14px 0 0"><button class="btn" type="button" data-x="cfg-export">${ico('upload')}Экспорт конфигурации (JSON)</button>
          <form data-form="cfg-import" class="inline-imp"><label class="btn" for="imp-f">${ico('restore')}Импорт…</label><input id="imp-f" name="file" type="file" accept="application/json,.json" hidden><button class="btn sm" type="submit" hidden>Импортировать</button></form></div>
      </div></section>
      <section class="panel"><header><h2>Журнал изменений</h2><span class="sub">последние ${Math.min(60, REG.state.log.length)}</span></header><div class="pad">${REG.state.log.length ? `<div class="feed">${REG.state.log.slice(0, 60).map(x => H.feedRow(dn(x.at.slice(0, 10)), 'var(--accent)', esc((x.pid ? ((byId(x.pid) || REG.def(x.pid) || {}).name || x.pid) + ': ' : '') + x.text), new Date(x.at).toLocaleString('ru-RU') + ' · ' + ((DSF.ROLES[x.role] || {}).t || ''))).join('')}</div>` : empty('Изменений пока не было.')}</div></section>`;
    return { html, title: 'Администрирование' };
  };
  /* выдача файла пользователю: в просмотрщике claude.ai — через подтверждение (capability downloads), в браузере — обычное скачивание */
  DSF.saveFile = async function (name, data) {
    let dl = null;
    try { if (window.claude && typeof window.claude.use === 'function') dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename: name, data }); return 'saved'; }
      catch (e) {
        const c = e && e.code;
        if (c === 'declined') return 'declined';
        if (c === 'rejected_extension' || c === 'extension_not_enabled') { toast('Файлы этого типа нельзя сохранить в этом просмотрщике.'); return 'rejected'; }
        if (c === 'rate_limited') { toast('Подтвердите предыдущее сохранение и повторите.'); return 'busy'; }
        if (c !== 'unavailable' && c !== 'not_granted') { toast('Не удалось сохранить файл.'); return 'error'; }
      }
    }
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
      return 'saved';
    } catch (e) { toast('Браузер не разрешил сохранение файла.'); return 'error'; }
  };
  A['file-save'] = (el, d) => { const b = DSF.files.blob(d.fid); if (!b) return toast('Файл недоступен в этом браузере.'); DSF.saveFile(d.name, b); };
  A['cfg-export'] = () => {
    const stores = {}; DSF.projects.forEach(p => { if (DSF.store.count(p.id)) stores[p.id] = DSF.store.get(p.id); });
    const data = { format: 'dsf-config', v: 1, exportedAt: new Date().toISOString(), registry: REG.state, stores };
    DSF.saveFile('dsf-config-' + today() + '.json', JSON.stringify(data, null, 1)).then(st => { if (st === 'saved') toast('Файл конфигурации сохранён.'); });
  };
  document.addEventListener('change', e => { if (e.target.id === 'imp-f' && e.target.files.length) { const f = e.target.closest('form'); if (f) f.requestSubmit ? f.requestSubmit() : f.querySelector('[type=submit]').click(); } });
  FM['cfg-import'] = function (f) {
    const file = f.elements.file.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      let data; try { data = JSON.parse(rd.result); } catch (e) { return toast('Файл не является JSON.'); }
      if (!data || data.format !== 'dsf-config' || !data.registry || typeof data.registry.defs !== 'object') return toast('Это не файл конфигурации «Цифрового штаба».');
      const cur = Object.keys(REG.state.defs);
      REG.state = Object.assign({ v: 1, seq: 1, defs: {}, order: [], orgs: [], log: [] }, data.registry);
      REG.log(null, 'Импорт конфигурации из файла ' + file.name);
      if (!REG.save()) return;
      cur.forEach(id => { if (!REG.state.defs[id]) REG.applyOne(id); });
      REG.apply();
      Object.entries(data.stores || {}).forEach(([pid, s]) => DSF.store.update(pid, st => { Object.keys(st).forEach(k => delete st[k]); Object.assign(st, s); }));
      U.order(); U.render(); toast('Конфигурация импортирована.');
    };
    rd.readAsText(file);
  };

  /* ====================================================================
   * ЗАПУСК
   * ==================================================================== */
  // запуск — со страницы (DSF.ui.boot()), после подключения всех модулей
})();
