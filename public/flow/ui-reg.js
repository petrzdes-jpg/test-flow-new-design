/*
 * Flow — реестры документов объекта (демо-контур; файлы и права — на сервере):
 *   · ПД/РД: Объект → ПД/РД → Раздел → Комплект → Документы; редакции, статусы, «Передан в производство»;
 *     загрузку ведёт ГИП (или пользователь с правом «Документы: загрузка»); перечень разделов редактируется;
 *   · ИД: АОСР, исполнительные схемы, журналы; приказы о назначении ответственных; документы о качестве
 *     (паспорта, сертификаты); паспорта оборудования — с полями, связями с видами работ и работами графика;
 *   · просмотр в системе: PDF (pdf.js), изображения с масштабом, DOCX, XLSX; DWG — только скачивание;
 *   · проверка: автоматическая проверка по формальным правилам выполняется на сервере и помечается как
 *     таковая; ИИ-проверка выполняется только при подключённом ИИ-сервисе — без него статус
 *     «Проверка не выполнена»; заранее подготовленные «результаты ИИ» не показываются. Подлинность
 *     документа система не устанавливает. Демонстрационные сценарии помечены «Демонстрационный пример».
 */
(function () {
  'use strict';
  if (DSF.mode !== 'demo') return;
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, fd, chip, ico, toast, openModal, closeModal, keepPage, link, plural, num } = H;
  const { dn, iso } = DSF.util;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const err = m => { const e = document.querySelector('.modal .err'); if (e) { e.hidden = false; e.textContent = m; } };
  const has = c => DSF.auth.has(c);
  const M0 = () => { const r = H.route(); return r.pid ? DSF.build(H.byId(r.pid)) : null; };
  const me = () => DSF.auth.user().login || DSF.auth.name();
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const today = () => iso(H.T());
  const FORMATS = ['pdf', 'dwg', 'docx', 'xlsx', 'jpg', 'jpeg', 'png'];
  const DEF_SECTIONS = ['ГП', 'АР', 'КР', 'КЖ', 'КМ', 'ОВ', 'ВК', 'ЭОМ', 'СС', 'НВК', 'НЭС', 'ПОС'];

  const KIND = {
    pd: 'Проектная документация', rd: 'Рабочая документация', aosr: 'АОСР', scheme: 'Исполнительная схема', journal: 'Журнал работ', act: 'Акт',
    order: 'Приказ о назначении ответственного', cert: 'Сертификат', passport: 'Документ о качестве (паспорт)', equipment: 'Паспорт оборудования', contract: 'Договор', other: 'Прочее'
  };
  const PDST = { draft: ['Черновик', 'neutral'], review: ['На проверке', 'accent'], remarks: ['Есть замечания', 'warn'], approved: ['Согласован', 'good'], production: ['Передан в производство', 'good'], cancelled: ['Аннулирован', 'neutral'] };
  const IDST = { draft: ['Черновик', 'neutral'], review: ['На проверке ТЗ', 'accent'], remarks: ['Есть замечания', 'warn'], accepted: ['Принят', 'good'], rejected: ['Отклонён', 'crit'] };
  const CHK = { none: ['Проверка не выполнена', 'neutral'], running: ['Проверяется', 'accent'], ok: ['Замечаний не выявлено', 'good'], issues: ['Выявлены замечания', 'crit'], more: ['Требуется дополнительная проверка', 'warn'], expert: ['Проверено специалистом', 'good'], rejected: ['Отклонено', 'crit'] };
  const FIELDS = {
    order: [['position', 'Должность ответственного'], ['person', 'Ф. И. О.'], ['validFrom', 'Действует с', 'date'], ['validTo', 'Действует по', 'date']],
    cert: [['material', 'Материал / продукция'], ['manufacturer', 'Изготовитель'], ['batch', 'Партия'], ['validTo', 'Действителен до', 'date']],
    passport: [['material', 'Материал'], ['manufacturer', 'Изготовитель'], ['batch', 'Партия'], ['volume', 'Объём партии']],
    equipment: [['equipment', 'Оборудование'], ['model', 'Модель'], ['serial', 'Заводской номер'], ['manufacturer', 'Изготовитель'], ['warranty', 'Гарантия'], ['location', 'Место установки']]
  };
  const isPd = d => d.kind === 'pd' || d.kind === 'rd';
  const stOf = d => (isPd(d) ? PDST : IDST)[d.status] || [d.status || '—', 'neutral'];

  /* ---------- данные: реестр с операциями и проверками ---------- */
  DSF.regdocsOf = function (M) {
    const S = M.store || {};
    const docs = (M.P.regdocs || []).map(d => JSON.parse(JSON.stringify(d))).concat((S.regdocs || []).filter(d => d.kind !== 'sections').map(d => Object.assign({ user: true }, JSON.parse(JSON.stringify(d)))));
    const by = new Map(docs.map(d => [d.id, d]));
    docs.forEach(d => { d.hist = [{ date: d.date, by: d.org || '', text: d.user ? 'Документ загружен' : 'Документ в реестре', to: d.status }]; d.revisions = d.revisions || []; d.links = d.links || []; d.tasks = d.tasks || []; });
    (S.regdocOps || []).forEach(op => {
      const d = by.get(op.doc); if (!d) return;
      if (op.op === 'revision') { d.revisions.forEach(r => { r.replaced = true; }); d.revisions.push({ rev: d.revisions.filter(r => !r.extra).length, date: op.date, file: op.file, note: op.note, by: op.by }); d.status = op.to || 'draft'; d.hist.push({ date: op.date, by: op.by, text: 'Новая редакция: ' + (op.note || ''), to: d.status }); }
      else if (op.op === 'status') { d.status = op.to; d.hist.push({ date: op.date, by: op.by, text: stOf(d)[0], to: op.to, comment: op.comment }); }
    });
    const checks = (S.aiChecks || []);
    docs.forEach(d => {
      d.checks = checks.filter(c => c.doc === d.id);
      const last = d.checks[d.checks.length - 1];
      d.check = last ? last.status : 'none';
      d.cur = d.revisions.filter(r => !r.extra).slice(-1)[0] || null;
      d.linkIds = d.links.map(l => l.includes(':') ? l.split(':')[1] : l);
    });
    docs.forEach(d => { d.backlinks = docs.filter(x => x.linkIds.includes(d.id)).map(x => x.id); });
    return docs;
  };
  const sectionsOf = M => { const s = ((M.store || {}).regdocs || []).filter(d => d.kind === 'sections').slice(-1)[0]; return s ? s.list : DEF_SECTIONS; };
  const TABS = [['reg-pdrd', 'ПД / РД'], ['reg-id', 'ИД'], ['reg-orders', 'Приказы'], ['reg-quality', 'Сертификаты и паспорта'], ['reg-equip', 'Оборудование'], ['reg-check', 'Проверка']];
  const inTab = { 'reg-pdrd': d => isPd(d), 'reg-id': d => ['aosr', 'scheme', 'journal', 'act'].includes(d.kind), 'reg-orders': d => d.kind === 'order', 'reg-quality': d => ['cert', 'passport'].includes(d.kind), 'reg-equip': d => d.kind === 'equipment', 'reg-check': d => !isPd(d) && d.kind !== 'contract' };

  /* ---------- раздел «Документы»: реестры добавляются к существующим категориям ---------- */
  const baseDocs = U.VIEWS.docs;
  U.VIEWS.docs = function (M, r) {
    const D = DSF.regdocsOf(M);
    if (r.sub && r.sub.startsWith('rd-')) { const d = D.find(x => x.id === r.sub); if (d) return docCard(M, d, D); }
    const tab = TABS.some(t => t[0] === r.sub) ? r.sub : null;
    const strip = `<div class="seg doc-tabs reg-tabs" role="tablist" aria-label="Реестры">${TABS.map(([k, t]) => `<button type="button" role="tab" data-go="${link(M.P.id, 'docs', k)}" aria-pressed="${tab === k}">${t} <b>${D.filter(inTab[k]).length}</b></button>`).join('')}</div>`;
    if (!tab) { const v = baseDocs(M, r); v.html = v.html.replace('<div class="seg doc-tabs"', strip + '<div class="seg doc-tabs"'); return v; }
    const body = { 'reg-pdrd': pdrdView, 'reg-check': checkView }[tab] || listView;
    const up = has('docs.upload') || has('iddocs.upload');
    return { crumb: TABS.find(t => t[0] === tab)[1], html: `<section class="head" style="display:flex; flex-wrap:wrap; gap:12px 20px; align-items:flex-end"><div style="flex:1 1 360px; min-width:0"><div class="eyebrow">${esc(M.P.name)} · документооборот</div><h1 style="margin-top:8px">Реестр <span class="ac">документов</span></h1>
        <p class="muted" style="margin-top:8px; max-width:78ch">Документы — объекты системы: редакции, статусы, история, связи с видами работ, работами графика, договорами и друг с другом. Файлы хранятся на сервере, доступ проверяется по роли и назначению.</p></div>
        <div class="hd-r">${up ? `<button class="btn primary" type="button" data-x="rg-new" data-tab="${tab}">${ico('upload')}Загрузить документ</button>` : ''}</div></section>
      ${strip}${body(M, D, tab)}` };
  };
  const docRow = (M, d) => `<button class="reg-i" type="button" data-go="${link(M.P.id, 'docs', d.id)}"><span class="reg-ic">${ico('doc')}</span><span class="reg-x"><b>${esc(d.title)}</b><span class="faint">${esc([d.code, KIND[d.kind], d.org, d.date ? fd(dn(d.date)) : ''].filter(Boolean).join(' · '))}${d.cur ? ' · изм. ' + d.cur.rev : ''}</span>
      <span class="reg-ch">${chip(stOf(d)[0], stOf(d)[1])}${!isPd(d) && d.kind !== 'contract' ? chip(CHK[d.check][0], CHK[d.check][1]) : ''}${d.demo ? '<span class="chip warn">ДЕМО</span>' : ''}</span></span>${ico('chev')}</button>`;
  function pdrdView(M, D) {
    const secs = sectionsOf(M), docs = D.filter(isPd);
    const q = (UI.rgQ || '').toLowerCase();
    const f = docs.filter(d => !q || (d.title + ' ' + (d.code || '') + ' ' + (d.set || '')).toLowerCase().includes(q));
    const used = [...new Set(f.map(d => d.section).filter(Boolean))];
    const order = secs.filter(s => used.includes(s)).concat(used.filter(s => !secs.includes(s)));
    return `<section class="panel"><header style="flex-wrap:wrap; gap:8px"><h2>ПД и РД</h2><span class="sub">раздел → комплект → документы</span><span class="grow"></span><input id="rg-q" class="inp" type="search" placeholder="Поиск: шифр, название" value="${esc(UI.rgQ || '')}" style="max-width:240px">${has('docs.edit') ? `<button class="btn sm" type="button" data-x="rg-secs">${ico('gear')}Разделы</button>` : ''}</header>
      <div class="pad">${['pd', 'rd'].map(kind => { const ks = f.filter(d => d.kind === kind); if (!ks.length) return ''; return `<div class="reg-grp"><h3>${kind === 'pd' ? 'Проектная документация (ПД)' : 'Рабочая документация (РД)'}</h3>
        ${order.filter(s => ks.some(d => d.section === s)).map(s => { const sd = ks.filter(d => d.section === s); const sets = [...new Set(sd.map(d => d.set || d.code))]; return `<div class="reg-sec"><div class="reg-sh"><b>${esc(s)}</b> <span class="faint">${esc(DSF.DOC_SECTIONS[s] || '')}</span></div>
          ${sets.map(st => `<div class="reg-set"><div class="reg-seth">${ico('folder', 14)} Комплект ${esc(st)}</div>${sd.filter(d => (d.set || d.code) === st).map(d => docRow(M, d)).join('')}</div>`).join('')}</div>`; }).join('')}</div>`; }).join('') || '<div class="empty">Документы ПД/РД не загружены.</div>'}
      <div class="faint" style="font-size:12px; margin-top:8px">Разделы: ${secs.map(esc).join(', ')}.</div></div></section>`;
  }
  U.INPUTS['rg-q'] = e => { UI.rgQ = e.target.value; const pos = e.target.selectionStart; keepPage(); const el = document.getElementById('rg-q'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } };
  function listView(M, D, tab) {
    const docs = D.filter(inTab[tab]);
    const wts = DSF.workTypesOf ? DSF.workTypesOf(M) : [];
    const wn = id => (wts.find(w => w.id === id) || {}).name || id;
    const byW = new Map(); docs.forEach(d => { const k = d.workType || '—'; if (!byW.has(k)) byW.set(k, []); byW.get(k).push(d); });
    const warn = [];
    if (tab === 'reg-orders') { const orgs = [...new Set(M.contracts.filter(c => c.tasks.some(t => t.as != null && !t.done) || (c.start && dn(c.start) <= H.T())).map(c => c.contractor))]; orgs.filter(o => o !== M.P.supervisor && !docs.some(d => d.org === o && d.status !== 'rejected')).forEach(o => warn.push('Нет приказа о назначении ответственного: ' + o)); }
    if (tab === 'reg-quality') docs.filter(d => d.kind === 'cert' && d.fields && d.fields.validTo && d.fields.validTo < today()).forEach(d => warn.push('Истёк срок действия: ' + d.title));
    if (tab === 'reg-id') { const ts = M.tasks.filter(t => !t.ms && t.as != null && (t.workType || t.item) && !docs.some(d => d.tasks.includes(t.id))); if (ts.length) warn.push('Начатые работы без ИД в реестре: ' + ts.slice(0, 5).map(t => t.name).join(', ') + (ts.length > 5 ? ' и ещё ' + (ts.length - 5) : '')); }
    const cnt = k => docs.filter(d => d.status === k).length;
    return `${tab === 'reg-id' ? `<section class="tiles">${['draft', 'review', 'remarks', 'accepted'].map(k => `<div class="tile ${k === 'remarks' && cnt(k) ? 'warn' : ''}"><div class="eyebrow">${IDST[k][0]}</div><div class="v">${cnt(k)}</div></div>`).join('')}</section>` : ''}
      ${warn.length ? `<div class="note warn">${warn.map(esc).join('<br>')}</div>` : ''}
      <section class="panel"><header><h2>${esc(TABS.find(t => t[0] === tab)[1])}</h2><span class="sub">${docs.length} · по видам работ</span></header><div class="pad">
      ${docs.length ? [...byW.entries()].map(([w, ds]) => `<div class="reg-sec"><div class="reg-sh"><b>${esc(w === '—' ? 'Вид работ не указан' : wn(w))}</b></div>${ds.map(d => docRow(M, d)).join('')}</div>`).join('') : '<div class="empty">Документов нет.</div>'}</div></section>`;
  }

  /* ---------- карточка документа ---------- */
  function docCard(M, d, D) {
    const P = M.P, by = new Map(D.map(x => [x.id, x]));
    const lk = id => { const x = by.get(id); return x ? `<button class="qlink" type="button" data-go="${link(P.id, 'docs', x.id)}"><b>${esc(KIND[x.kind] || x.kind)}</b> ${esc(x.title)}<span class="faint"> · ${esc(stOf(x)[0])}</span></button>` : `<span class="faint">${esc(id)} — не найден</span>`; };
    const acts = [];
    const own = DSF.auth.role !== 'contractor' || d.org === DSF.auth.org();
    if (isPd(d)) {
      if (has('docs.agree')) { if (d.status === 'draft' || d.status === 'remarks') acts.push(['review', 'На проверку']); if (d.status === 'review') acts.push(['approved', 'Согласовать'], ['remarks', 'Есть замечания']); if (d.status === 'approved') acts.push(['production', 'Передать в производство']); if (d.status !== 'cancelled') acts.push(['cancelled', 'Аннулировать']); }
    } else if (d.kind !== 'contract') {
      if (own && (d.status === 'draft' || d.status === 'remarks') && (has('iddocs.upload') || has('docs.upload'))) acts.push(['review', 'Направить на проверку ТЗ']);
      if (d.status === 'review' && (has('iddocs.agree') || has('docs.agree'))) acts.push(['remarks', 'Есть замечания']);
      if (d.status === 'review' && has('iddocs.approve')) acts.push(['accepted', 'Принять']), acts.push(['rejected', 'Отклонить']);
    }
    const canRev = (isPd(d) ? has('docs.edit') || has('docs.upload') : own && (has('iddocs.upload') || has('docs.upload'))) && d.status !== 'cancelled';
    const wts = DSF.workTypesOf ? DSF.workTypesOf(M) : [];
    const f = d.fields || {};
    const fl = (FIELDS[d.kind] || []).filter(([k]) => f[k]).map(([k, t, ty]) => `<dt>${esc(t)}</dt><dd>${ty === 'date' ? fd(dn(f[k])) : esc(f[k])}</dd>`).join('') + Object.entries(f).filter(([k]) => !(FIELDS[d.kind] || []).some(x => x[0] === k) && k !== 'workType').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    const showChk = !isPd(d) && d.kind !== 'contract';
    return { crumb: d.code || d.title, html: `<div class="topback"><button class="lnk" type="button" data-go="${link(P.id, 'docs', isPd(d) ? 'reg-pdrd' : (TABS.find(t => inTab[t[0]](d) && t[0] !== 'reg-check') || ['reg-id'])[0])}">${ico('left')}Реестр</button></div>
      <section class="panel"><header style="flex-wrap:wrap"><div style="min-width:0; flex:1 1 320px"><div class="eyebrow">${esc(KIND[d.kind] || d.kind)}${d.section ? ' · раздел ' + esc(d.section) : ''}${d.set ? ' · комплект ' + esc(d.set) : ''}</div><h2 style="margin-top:6px">${esc(d.title)}</h2>
          ${d.demo ? '<div class="note warn" style="margin-top:8px">ДЕМО — НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ. Демонстрационный документ: организации, люди и номера вымышлены.</div>' : ''}</div>
        <div class="fchips">${chip(stOf(d)[0], stOf(d)[1])}${showChk ? chip(CHK[d.check][0], CHK[d.check][1]) : ''}</div></header>
        <div class="pad"><div class="grid2"><dl class="kv kvw"><dt>Шифр / номер</dt><dd>${esc(d.code || '—')}</dd><dt>Дата</dt><dd>${d.date ? fd(dn(d.date)) : '—'}</dd><dt>Организация</dt><dd>${esc(d.org || '—')}</dd>
            ${d.contract ? `<dt>Договор</dt><dd>${M.contractBy.get(d.contract) ? `<button class="lnk" type="button" data-go="${link(P.id, 'budget', d.contract)}">${esc(M.contractBy.get(d.contract).no)}</button>` : esc(d.contract)}</dd>` : ''}
            ${d.workType ? `<dt>Вид работ</dt><dd>${esc((wts.find(w => w.id === d.workType) || {}).name || d.workType)}</dd>` : ''}${fl}</dl>
          <div>${d.tasks.length ? `<div class="lb"><div class="eyebrow">Работы графика</div><div class="qlinks">${d.tasks.map(id => { const t = M.byId.get(id); return t ? `<button class="qlink" type="button" data-go="${link(P.id, 'schedule')}" data-task="${t.id}"><b>Работа</b> ${esc(t.name)}</button>` : ''; }).join('')}</div></div>` : ''}
            ${d.linkIds.length ? `<div class="lb"><div class="eyebrow">Связанные документы</div><div class="qlinks">${d.linkIds.map(lk).join('')}</div></div>` : ''}
            ${d.backlinks.length ? `<div class="lb"><div class="eyebrow">Ссылаются на документ</div><div class="qlinks">${d.backlinks.map(lk).join('')}</div></div>` : ''}</div></div>
          <div class="fchips" style="margin-top:14px">${acts.map(([to, t]) => `<button class="btn ${['approved', 'production', 'accepted', 'review'].includes(to) ? 'primary' : ''}" type="button" data-x="rg-st" data-id="${esc(d.id)}" data-to="${to}">${t}</button>`).join('')}
            ${canRev ? `<button class="btn" type="button" data-x="rg-rev" data-id="${esc(d.id)}">${ico('upload')}Новая редакция</button>` : ''}
            ${showChk && has('iddocs.check') ? `<button class="btn" type="button" data-x="rg-check" data-id="${esc(d.id)}">${ico('check')}Проверить по правилам</button><button class="btn" type="button" data-x="rg-ai" data-id="${esc(d.id)}">${ico('target')}ИИ-проверка</button>` : ''}
            ${showChk && (has('iddocs.agree') || has('docs.agree')) ? `<button class="btn" type="button" data-x="rg-expert" data-id="${esc(d.id)}" data-s="expert">Проверено специалистом</button><button class="btn" type="button" data-x="rg-expert" data-id="${esc(d.id)}" data-s="rejected">Отклонить</button>` : ''}</div>
        </div></section>
      <section class="panel"><header><h2>Редакции и файлы</h2></header><div class="pad"><div class="imp-list" style="max-height:none">${d.revisions.slice().reverse().map(rv => `<div class="imp-i" style="${rv.replaced ? 'opacity:.65' : ''}"><div class="imp-h"><b>${rv.extra ? 'Дополнительный файл' : 'Изм. ' + rv.rev}${rv.replaced && !rv.extra ? ' · заменена' : !rv.extra ? ' · действующая' : ''}</b><span class="faint">${rv.date ? fd(dn(rv.date)) : ''}</span></div>
          <div class="imp-m">${esc((rv.file || {}).name || 'файл не приложен')}${rv.file && rv.file.size ? ' · ' + num(rv.file.size / 1024, 0) + ' КБ' : ''}${rv.note ? ' · ' + esc(rv.note) : ''}${rv.by ? ' · ' + esc(rv.by) : ''}</div>
          ${rv.file ? `<div class="fchips"><button class="btn sm" type="button" data-x="rg-view" data-fid="${esc(rv.file.id)}" data-name="${esc(rv.file.name)}">${ico('eye')}Открыть</button><button class="btn sm" type="button" data-x="rg-dl" data-fid="${esc(rv.file.id)}" data-name="${esc(rv.file.name)}">${ico('down')}Скачать</button></div>` : ''}</div>`).join('') || '<div class="empty">Файлов нет.</div>'}</div></div></section>
      ${showChk ? `<section class="panel"><header><h2>Проверка документа</h2><span class="sub">${esc(CHK[d.check][0])}</span></header><div class="pad">${checkHist(d)}</div></section>` : ''}
      <section class="panel"><header><h2>История</h2></header><div class="pad"><div class="audit">${d.hist.slice().reverse().map(h => `<div class="au"><div class="au-t">${esc(h.date || '')}</div><div class="au-x">${esc(h.text)}${h.comment ? `<div style="font-size:12.5px">${esc(h.comment)}</div>` : ''}<div class="faint" style="font-size:12px">${esc(h.by || '')}</div></div></div>`).join('')}</div></div></section>` };
  }
  function checkHist(d) {
    if (!d.checks.length) return '<div class="empty">Проверка не выполнена.</div>';
    return `<div class="imp-list" style="max-height:none">${d.checks.slice().reverse().map(c => `<div class="imp-i"><div class="imp-h"><b>${esc(CHK[c.status] ? CHK[c.status][0] : c.status)}</b><span class="faint">${esc(c.at || c.date || '')}</span></div>
      <div class="imp-m">${c.method === 'rules' ? 'Автоматическая проверка по формальным правилам' : c.method === 'expert' ? 'Решение специалиста' : esc(c.method)}${c.by ? ' · ' + esc(c.by) : ''}${c.rev != null ? ' · изм. ' + c.rev : ''}</div>
      ${(c.findings || []).length ? `<ul class="imp-warn">${c.findings.map(x => `<li style="color:${x.sev === 'error' ? 'var(--crit)' : 'inherit'}">${esc(x.text)}</li>`).join('')}</ul>` : ''}${c.comment ? `<div class="imp-m">${esc(c.comment)}</div>` : ''}${c.note ? `<div class="imp-m faint">${esc(c.note)}</div>` : ''}</div>`).join('')}</div>`;
  }
  function checkView(M, D) {
    const docs = D.filter(inTab['reg-check']);
    const cnt = k => docs.filter(d => d.check === k).length;
    return `<section class="tiles">${Object.entries(CHK).map(([k, [t, c]]) => `<div class="tile ${cnt(k) && (c === 'crit' || c === 'warn') ? c : ''}"><div class="eyebrow">${t}</div><div class="v">${cnt(k)}</div></div>`).join('')}</section>
      <section class="panel"><header><h2>Документы ИД и качества</h2><span class="sub">статус проверки</span></header><div class="pad">${docs.map(d => docRow(M, d)).join('') || '<div class="empty">Документов нет.</div>'}</div></section>
      <section class="panel"><header><h2>Как устроена проверка</h2></header><div class="pad"><ul class="imp-warn" style="font-size:13px">
        <li><b>Проверка по правилам</b> выполняется сервером Flow: наличие файла, обязательные реквизиты, сроки действия, связи АОСР с РД «в производство», документами о качестве, исполнительной схемой и приказом.</li>
        <li><b>ИИ-проверка</b> выполняется только при подключённом к серверу ИИ-сервисе. Если сервис не подключён, кнопка «ИИ-проверка» сообщает об этом, а статус документа не меняется.</li>
        <li>Система не устанавливает подлинность документов. Итоговое решение — «Проверено специалистом» или «Отклонено» — принимает специалист.</li></ul>
        <div class="demo-ex"><div class="eyebrow" style="color:var(--warn-ink)">Демонстрационный пример — не результат проверки</div>
          <p style="font-size:13px; margin-top:6px">Так будет выглядеть ответ ИИ-сервиса после подключения: «АОСР № ДЕМО-01: в акте указана РД КЖ-01 изм. 1; в приложенном сертификате партия ДЕМО-А-118, а в документе о качестве — ДЕМО-А-119 — сверьте партии применённой арматуры». Пример иллюстративный и не относится к фактическому анализу документов.</p></div></div></section>`;
  }

  /* ---------- действия ---------- */
  A['rg-st'] = (el, d) => {
    UI.rgSt = d;
    const need = ['remarks', 'rejected', 'cancelled'].includes(d.to);
    openModal(() => `<form data-form="rg-st" class="mform"><div class="mh"><div><div class="eyebrow">Документ</div><h3 style="margin-top:4px">${esc((PDST[d.to] || IDST[d.to] || [d.to])[0])}</h3></div>${xBtn}</div>
      <div class="mb"><div class="fld"><label>${need ? 'Причина / замечания *' : 'Комментарий'}</label><textarea name="comment" rows="3" ${need ? 'required' : ''}></textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`);
  };
  FM['rg-st'] = function (f, r) {
    const o = UI.rgSt, comment = f.elements.comment.value.trim();
    if (['remarks', 'rejected', 'cancelled'].includes(o.to) && comment.length < 3) return err('Укажите причину.');
    DSF.store.update(r.pid, s => s.regdocOps.push({ doc: o.id, op: 'status', to: o.to, comment, by: me(), date: today() }));
    closeModal(); keepPage(); toast('Статус документа изменён.');
  };
  A['rg-check'] = async (el, d) => {
    const pid = H.route().pid;
    el.disabled = true; el.innerHTML = 'Проверяется…';
    try { const res = await DSF.api.post('/api/demo/check/' + encodeURIComponent(pid) + '/' + encodeURIComponent(d.id)); await DSF.reloadJournal(pid); toast('Проверка по правилам: ' + esc(CHK[res.check.status][0]) + '.'); }
    catch (e) { toast(esc(e.detail || e.message)); keepPage(); }
  };
  A['rg-ai'] = async (el, d) => {
    const pid = H.route().pid;
    try { await DSF.api.post('/api/demo/ai/check/' + encodeURIComponent(pid) + '/' + encodeURIComponent(d.id)); }
    catch (e) { openModal(() => `<div class="mh"><div><div class="eyebrow">ИИ-проверка</div><h3 style="margin-top:4px">Проверка не выполнена</h3></div>${xBtn}</div><div class="mb"><p>${esc(e.detail || e.message)}</p><p class="faint" style="font-size:12.5px">Статус документа не меняется. Чтобы подключить ИИ-сервис, администратор задаёт адрес сервиса на сервере Flow (переменная FLOW_AI_URL).</p></div>`); }
  };
  A['rg-expert'] = (el, d) => { UI.rgEx = d; openModal(() => `<form data-form="rg-expert" class="mform"><div class="mh"><div><div class="eyebrow">Решение специалиста</div><h3 style="margin-top:4px">${d.s === 'expert' ? 'Проверено специалистом' : 'Отклонить документ'}</h3></div>${xBtn}</div>
      <div class="mb"><div class="fld"><label>Комментарий *</label><textarea name="comment" rows="3" required></textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`); };
  FM['rg-expert'] = function (f, r) {
    const o = UI.rgEx, c = f.elements.comment.value.trim(); if (c.length < 3) return err('Добавьте комментарий.');
    const M = M0(), d = DSF.regdocsOf(M).find(x => x.id === o.id);
    DSF.store.update(r.pid, s => s.aiChecks.push({ id: uid('chk'), doc: o.id, rev: d && d.cur ? d.cur.rev : null, method: 'expert', status: o.s, comment: c, by: me(), date: today(), at: new Date().toISOString().slice(0, 16).replace('T', ' ') }));
    closeModal(); keepPage(); toast('Решение специалиста записано.');
  };
  A['rg-secs'] = () => { const M = M0(); UI.rgSecs = sectionsOf(M).join(', '); openModal(() => `<form data-form="rg-secs" class="mform"><div class="mh"><div><div class="eyebrow">ПД / РД</div><h3 style="margin-top:4px">Перечень разделов</h3></div>${xBtn}</div>
    <div class="mb"><div class="fld"><label>Разделы через запятую</label><textarea name="list" rows="3">${esc(UI.rgSecs)}</textarea></div><div class="err" hidden></div></div>
    <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`); };
  FM['rg-secs'] = function (f, r) {
    const list = [...new Set(f.elements.list.value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean))];
    if (!list.length) return err('Укажите хотя бы один раздел.');
    DSF.store.update(r.pid, s => s.regdocs.push({ id: uid('secs'), kind: 'sections', list, public: true, by: me(), date: today() }));
    closeModal(); keepPage(); toast('Перечень разделов сохранён.');
  };

  /* загрузка: файл на сервер (проверка формата и прав), затем запись реестра */
  async function putFile(file, pid, opts) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FORMATS.includes(ext)) throw new Error('Формат не поддерживается. Допустимо: PDF, DWG, DOCX, XLSX, JPG, PNG.');
    const q = new URLSearchParams({ project: pid, name: file.name }); if (opts.contract) q.set('contract', opts.contract); if (opts.public) q.set('public', 'true');
    const r = await fetch(DSF.API_BASE + '/api/demo/files?' + q, { method: 'PUT', headers: { Authorization: 'Bearer ' + DSF.session.token }, body: file });
    let data = null; try { data = await r.json(); } catch (e) { data = null; }
    if (!r.ok) throw new Error((data && data.detail) || 'Не удалось загрузить файл.');
    return { id: data.file.id, name: file.name, ext, size: file.size };
  }
  A['rg-new'] = (el, d) => {
    const M = M0();
    const kinds = d.tab === 'reg-pdrd' ? ['rd', 'pd'] : d.tab === 'reg-orders' ? ['order'] : d.tab === 'reg-quality' ? ['cert', 'passport'] : d.tab === 'reg-equip' ? ['equipment'] : ['aosr', 'scheme', 'journal', 'act'];
    UI.rgNew = { kind: kinds[0], kinds, links: [], tasks: [] };
    openModal(newForm, { wide: true });
  };
  function newForm(M) {
    const D = UI.rgNew, pd = isPd(D), all = DSF.regdocsOf(M), wts = DSF.workTypesOf ? DSF.workTypesOf(M) : [];
    const cons = M.contracts.filter(c => DSF.auth.role !== 'contractor' || c.contractor === DSF.auth.org());
    return `<form data-form="rg-new" class="mform"><div class="mh"><div><div class="eyebrow">${esc(M.P.name)} · реестр документов</div><h3 style="margin-top:4px">Загрузить документ</h3></div>${xBtn}</div>
      <div class="mb"><div class="row-f"><div class="fld"><label>Вид документа *</label><select data-rgk="1">${D.kinds.map(k => opt(k, KIND[k], k === D.kind)).join('')}</select></div><div class="fld"><label>Статус</label><select name="status">${Object.entries(pd ? PDST : IDST).filter(([k]) => ['draft', 'review'].includes(k) || (pd && has('docs.agree') && k !== 'cancelled')).map(([k, v]) => opt(k, v[0], k === 'draft')).join('')}</select></div></div>
        <div class="fld"><label>Наименование *</label><input name="title" required></div>
        <div class="row-f3"><div class="fld"><label>${pd ? 'Шифр *' : 'Номер'}</label><input name="code" ${pd ? 'required' : ''}></div><div class="fld"><label>Дата *</label><input name="date" type="date" required value="${today()}"></div>
          ${pd ? `<div class="fld"><label>Раздел *</label><select name="section" required>${sectionsOf(M).map(s => opt(s, s + ' — ' + (DSF.DOC_SECTIONS[s] || ''), false)).join('')}</select></div>` : `<div class="fld"><label>Вид работ</label><select name="workType"><option value="">—</option>${wts.map(w => opt(w.id, w.name, false)).join('')}</select></div>`}</div>
        ${pd ? '<div class="fld"><label>Комплект (марка) *</label><input name="set" required placeholder="например, КЖ-04"></div>' : `<div class="fld"><label>Договор</label><select name="contract"><option value="">—</option>${cons.map(c => opt(c.id, c.no + ' · ' + c.contractor, false)).join('')}</select></div>`}
        ${(FIELDS[D.kind] || []).map(([k, t, ty]) => `<div class="fld"><label>${esc(t)}</label><input name="f_${k}" ${ty === 'date' ? 'type="date"' : ''}></div>`).join('')}
        ${!pd ? `<div class="fld"><label>Работы графика</label><select name="tasks" multiple size="4">${M.tasks.filter(t => !t.ms).map(t => opt(t.id, t.stage + ' · ' + t.name, false)).join('')}</select></div>
          <div class="fld"><label>Связанные документы (РД, сертификаты, схемы, приказ)</label><select name="links" multiple size="5">${all.filter(x => x.kind !== 'contract').map(x => opt(x.id, (KIND[x.kind] || x.kind) + ' · ' + x.title, false)).join('')}</select></div>` : ''}
        <div class="fld"><label>Файл * (PDF, DWG, DOCX, XLSX, JPG, PNG)</label><input name="file" type="file" required accept=".pdf,.dwg,.docx,.xlsx,.jpg,.jpeg,.png"></div>
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('upload')}Загрузить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.rgk && UI.rgNew) { UI.rgNew.kind = e.target.value; H.renderLayer(); } });
  FM['rg-new'] = async function (f, r) {
    const D = UI.rgNew, fd_ = new FormData(f), g = k => String(fd_.get(k) || '').trim(), file = f.elements.file.files[0];
    if (!file) return err('Выберите файл.');
    if (!g('title') || !g('date')) return err('Заполните обязательные поля.');
    const pd = isPd(D), btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Загрузка…';
    try {
      const fl = await putFile(file, r.pid, { contract: g('contract') || null, public: pd });
      const fields = {}; (FIELDS[D.kind] || []).forEach(([k]) => { if (g('f_' + k)) fields[k] = g('f_' + k); });
      const doc = { id: 'rd-u' + Date.now().toString(36), kind: D.kind, title: g('title'), code: g('code'), date: g('date'), status: g('status') || 'draft', section: g('section') || null, set: g('set') || null,
        org: DSF.auth.org() || (pd ? (M0().P.designer || '') : ''), contract: g('contract') || null, workType: g('workType') || null, public: pd, fields,
        tasks: fd_.getAll('tasks'), links: fd_.getAll('links'), revisions: [{ rev: 0, date: g('date'), file: fl, note: 'Первая редакция', by: me() }], by: me() };
      DSF.store.update(r.pid, s => s.regdocs.push(doc));
      closeModal(); H.go(link(r.pid, 'docs', doc.id)); toast('Документ загружен.' + (pd ? '' : ' Направьте его на проверку, когда комплект будет готов.'));
    } catch (e) { btn.disabled = false; btn.textContent = 'Загрузить'; err(e.message); }
  };
  A['rg-rev'] = (el, d) => { UI.rgRev = d.id; openModal(() => `<form data-form="rg-rev" class="mform"><div class="mh"><div><div class="eyebrow">Документ</div><h3 style="margin-top:4px">Новая редакция</h3></div>${xBtn}</div>
    <div class="mb"><div class="note">Действующая редакция будет помечена «заменена» и останется в истории. Статус документа вернётся в «Черновик».</div>
      <div class="fld"><label>Что изменено *</label><input name="note" required minlength="3"></div><div class="fld"><label>Файл *</label><input name="file" type="file" required accept=".pdf,.dwg,.docx,.xlsx,.jpg,.jpeg,.png"></div><div class="err" hidden></div></div>
    <div class="mf"><button class="btn primary" type="submit">${ico('upload')}Загрузить редакцию</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`); };
  FM['rg-rev'] = async function (f, r) {
    const file = f.elements.file.files[0], note = f.elements.note.value.trim(); if (!file || note.length < 3) return err('Выберите файл и опишите изменения.');
    const d = DSF.regdocsOf(M0()).find(x => x.id === UI.rgRev);
    try { const fl = await putFile(file, r.pid, { contract: d.contract, public: d.public }); DSF.store.update(r.pid, s => s.regdocOps.push({ doc: d.id, op: 'revision', file: fl, note, to: 'draft', by: me(), date: today() })); closeModal(); keepPage(); toast('Новая редакция загружена.'); }
    catch (e) { err(e.message); }
  };

  /* ---------- просмотр файлов ---------- */
  async function fetchFile(fid) {
    const r = await fetch(DSF.API_BASE + '/api/demo/files/' + encodeURIComponent(fid), { headers: { Authorization: 'Bearer ' + DSF.session.token } });
    if (!r.ok) { let m = 'Файл недоступен.'; try { m = (await r.json()).detail || m; } catch (e) { /* */ } throw new Error(m); }
    return r.blob();
  }
  A['rg-dl'] = async (el, d) => { try { const b = await fetchFile(d.fid); DSF.saveFile(d.name, b); } catch (e) { toast(esc(e.message)); } };
  const loadScript = src => new Promise((ok, bad) => { if (document.querySelector('script[data-src="' + src + '"]')) return ok(); const s = document.createElement('script'); s.src = src; s.dataset.src = src; s.onload = ok; s.onerror = () => bad(new Error('Не удалось загрузить модуль просмотра.')); document.head.appendChild(s); });
  const VENDOR = (document.querySelector('script[src*="flow/ui.js"]') || {}).src ? new URL('../assets/vendor/', document.querySelector('script[src*="flow/ui.js"]').src).href : '../assets/vendor/';
  A['rg-view'] = async (el, d) => {
    const ext = (d.name.split('.').pop() || '').toLowerCase();
    UI.fv = { name: d.name, fid: d.fid, ext, zoom: 1, html: '<div class="empty">Загрузка…</div>' };
    openModal(viewer, { wide: true, global: true, cls: 'fv' });
    if (ext === 'dwg') { UI.fv.html = `<div class="empty">Просмотр чертежей DWG в браузере не поддерживается. Скачайте файл и откройте его в программе для работы с DWG.<div style="margin-top:12px"><button class="btn primary" type="button" data-x="rg-dl" data-fid="${esc(d.fid)}" data-name="${esc(d.name)}">${ico('down')}Скачать ${esc(d.name)}</button></div></div>`; H.renderLayer(); return; }
    try {
      const blob = await fetchFile(d.fid);
      if (ext === 'pdf') {
        await loadScript(VENDOR + 'pdf.min.js');
        const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.js';
        const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        UI.fv.pdf = pdf; UI.fv.pages = pdf.numPages; UI.fv.html = `<div class="fv-pages">${Array.from({ length: pdf.numPages }, (_, i) => `<canvas data-pg="${i + 1}" aria-label="Страница ${i + 1}"></canvas>`).join('')}</div>`;
        H.renderLayer(); await renderPdf();
      } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
        UI.fv.url = URL.createObjectURL(blob); UI.fv.html = null; H.renderLayer();
      } else if (ext === 'docx') {
        await loadScript(VENDOR + 'mammoth.browser.min.js');
        const res = await window.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        const tmp = document.createElement('div'); tmp.innerHTML = res.value; tmp.querySelectorAll('script,iframe,object,embed').forEach(x => x.remove()); tmp.querySelectorAll('*').forEach(x => [...x.attributes].forEach(a => { if (/^on/i.test(a.name)) x.removeAttribute(a.name); }));
        UI.fv.html = `<div class="fv-doc">${tmp.innerHTML}</div>`; H.renderLayer();
      } else if (ext === 'xlsx') {
        await loadScript(VENDOR + 'xlsx.full.min.js');
        const wb = window.XLSX.read(await blob.arrayBuffer(), { type: 'array' });
        UI.fv.html = wb.SheetNames.slice(0, 5).map(n => `<h3 style="margin:8px 0">${esc(n)}</h3><div class="tbl-wrap">${window.XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' }).replace(/<script[\s\S]*?<\/script>/gi, '')}</div>`).join(''); H.renderLayer();
      }
    } catch (e) { UI.fv.html = `<div class="empty">${esc(e.message)}</div>`; H.renderLayer(); }
  };
  async function renderPdf() {
    const F = UI.fv; if (!F || !F.pdf) return;
    const box = document.querySelector('.fv-pages'); if (!box) return;
    const w = Math.min(box.clientWidth || 800, 1400) * F.zoom;
    for (let i = 1; i <= F.pages; i++) {
      const page = await F.pdf.getPage(i), v0 = page.getViewport({ scale: 1 }), sc = w / v0.width, vp = page.getViewport({ scale: sc * (window.devicePixelRatio || 1) });
      const cv = document.querySelector(`canvas[data-pg="${i}"]`); if (!cv) return;
      cv.width = vp.width; cv.height = vp.height; cv.style.width = (vp.width / (window.devicePixelRatio || 1)) + 'px';
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
  }
  function viewer() {
    const F = UI.fv;
    const zoomable = F.ext === 'pdf' || ['jpg', 'jpeg', 'png'].includes(F.ext);
    return `<div class="mh"><div style="min-width:0"><div class="eyebrow">Просмотр документа</div><h3 style="margin-top:4px; overflow-wrap:anywhere">${esc(F.name)}</h3></div>
      <div style="display:flex; gap:6px">${zoomable ? `<button class="icon-btn" type="button" data-x="fv-z" data-d="-1" aria-label="Уменьшить">${ico('zout')}</button><button class="icon-btn" type="button" data-x="fv-z" data-d="1" aria-label="Увеличить">${ico('zin')}</button>` : ''}<button class="icon-btn" type="button" data-x="rg-dl" data-fid="${esc(F.fid)}" data-name="${esc(F.name)}" aria-label="Скачать">${ico('down')}</button>${xBtn}</div></div>
      <div class="mb fv-body">${F.url ? `<div class="fv-img"><img src="${F.url}" alt="${esc(F.name)}" style="width:${Math.round(F.zoom * 100)}%"></div>` : F.html}</div>`;
  }
  A['fv-z'] = async (el, d) => { const F = UI.fv; F.zoom = Math.max(0.5, Math.min(4, F.zoom * (+d.d > 0 ? 1.25 : 0.8))); if (F.pdf) { const sc = document.querySelector('.fv-body'); const y = sc ? sc.scrollTop : 0; H.renderLayer(); await renderPdf(); const s2 = document.querySelector('.fv-body'); if (s2) s2.scrollTop = y; } else H.renderLayer(); };

  /* уведомления: документы ждут проверки */
  DSF.notifyHooks.push(M => {
    const D = DSF.regdocsOf(M), out = [];
    if (has('iddocs.agree') || has('iddocs.approve')) D.filter(d => !isPd(d) && d.status === 'review').slice(0, 5).forEach(d => out.push({ sev: 'accent', title: (KIND[d.kind] || 'Документ') + ' ждёт проверки', meta: d.title, go: link(M.P.id, 'docs', d.id) }));
    if (has('docs.agree')) D.filter(d => isPd(d) && d.status === 'review').forEach(d => out.push({ sev: 'accent', title: 'РД/ПД на проверке: ' + (d.code || d.title), meta: d.org || '', go: link(M.P.id, 'docs', d.id) }));
    if (DSF.auth.role === 'contractor') D.filter(d => d.org === DSF.auth.org() && ['remarks', 'rejected'].includes(d.status)).forEach(d => out.push({ sev: 'warn', title: 'Замечания к документу', meta: d.title, go: link(M.P.id, 'docs', d.id) }));
    return out;
  });
})();
