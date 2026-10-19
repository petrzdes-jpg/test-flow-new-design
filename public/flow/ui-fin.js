/*
 * Flow — договоры, сметы, КС-2 по позициям сметы, КС-3, освоение, оплаты (интерфейс).
 *
 *  · Регистрация договора: контрагент (из базы подрядчиков объекта или новый), номер, дата, предмет,
 *    виды работ, статья бюджета, цена с НДС, ставка НДС, сроки, аванс, удержание, условия оплаты.
 *    Договор сразу появляется в «Бюджет и КС». Изменения — только с основанием, история сохраняется.
 *  · Сметы: разделы, позиции (работы / материалы), НДС, версии; статусы
 *    Черновик → На проверке → Есть замечания / Возвращена на корректировку → Проверена сметчиком → Утверждена.
 *    В демо — демонстрационные сметы по всем договорам (помечены «ДЕМО»); в реальных объектах — «Смета не загружена».
 *  · КС-2 по позициям утверждённой сметы с контролем объёмов: превышение — предупреждение, не запрет.
 *  · КС-3 — по периодам из принятых КС-2. Освоение = принято / актуальная стоимость договора × 100 %.
 */
(function () {
  'use strict';
  const U = DSF.ui, H = U.h, UI = U.UI, A = U.ACTIONS, FM = U.FORMS;
  const { esc, fd, chip, ico, toast, openModal, closeModal, keepPage, link, plural, num, money } = H;
  const { dn, iso } = DSF.util;
  const xBtn = `<button class="icon-btn" type="button" data-act="x-close" aria-label="Закрыть">${ico('x')}</button>`;
  const err = m => { const e = document.querySelector('.modal .err'); if (e) { e.hidden = false; e.textContent = m; } };
  const has = c => DSF.auth.has(c);
  const demo = DSF.mode === 'demo';
  const M0 = () => { const r = H.route(); return r.pid ? DSF.build(H.byId(r.pid)) : null; };
  const me = () => DSF.auth.user().login || DSF.auth.name();
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const rub = v => v == null ? '—' : new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' ₽';
  const mlnR = v => v == null ? '—' : num(v, v < 100 ? 2 : 1) + ' млн ₽';
  const ES = k => DSF.ESTIMATE_STATUS[k] || { t: k, c: 'neutral' };
  const today = () => iso(H.T());
  const tile = (l, v, s2, c) => `<div class="tile ${c || ''}"><div class="eyebrow">${l}</div><div class="v">${v}</div>${s2 ? `<div class="s">${s2}</div>` : ''}</div>`;
  const head = (eyebrow, h1, ac, sub, right) => `<section class="head" style="display:flex; flex-wrap:wrap; gap:14px 24px; align-items:flex-end">
      <div style="flex:1 1 420px; min-width:0"><div class="eyebrow">${eyebrow}</div><h1 style="margin-top:8px">${h1} <span class="ac">${ac}</span></h1>${sub ? `<p class="muted" style="margin-top:8px; max-width:78ch">${sub}</p>` : ''}</div>
      ${right ? `<div class="hd-r">${right}</div>` : ''}</section>`;
  const monthTxt = d => { const x = new Date(d * 864e5); return DSF.fmt.MONTHS_FULL[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); };
  const mine = c => DSF.auth.role !== 'contractor' || c.contractor === DSF.auth.org();

  /* ===================================================== сметы: раздел */
  U.VIEWS.estimates = function (M, r) {
    const E = DSF.estimatesOf(M);
    if (r.sub) { const e = E.find(x => x.id === r.sub); if (e) return estCard(M, e); }
    const cs = M.contracts.filter(c => !/технический заказчик|строительный контроль/i.test(c.subject || '') && mine(c));
    const st = UI.estF || 'all';
    const rows = cs.map(c => ({ c, es: E.filter(e => e.contract === c.id) }));
    const cnt = k => E.filter(e => e.status === k).length;
    const real = M.P.source === 'legacy' || DSF.mode === 'real';
    return { html: `${head(esc(M.P.name) + ' · финансы', 'Сметы', '', 'Смета по договору: разделы и позиции (работы и материалы), НДС, версии. Проверку выполняет сметчик, утверждает директор. КС-2 формируется по позициям утверждённой сметы с контролем объёмов.' + (demo ? ' Сметы в демо-режиме — демонстрационные и помечены «ДЕМО».' : ''))}
      <section class="tiles">${tile('Договоров', cs.length, '')}${tile('Смет', E.length, E.some(e => e.demo) ? 'демонстрационные' : '')}${tile('На проверке', cnt('review'), 'ждут сметчика', cnt('review') ? 'warn' : '')}${tile('Утверждено', cnt('approved'), 'основа для КС-2', 'good')}</section>
      <section class="panel"><header style="flex-wrap:wrap; gap:8px"><h2>Сметы по договорам</h2><span class="grow"></span><div class="fchips">${[['all', 'Все'], ['review', 'На проверке'], ['remarks', 'С замечаниями'], ['checked', 'Проверены'], ['approved', 'Утверждены']].map(([k, t]) => `<button class="fchip" type="button" data-x="est-f" data-f="${k}" aria-pressed="${st === k}">${t}</button>`).join('')}</div></header>
        <div class="pad"><div class="ucards">${rows.map(({ c, es }) => {
          const list = es.filter(e => st === 'all' || e.status === st);
          if (st !== 'all' && !list.length) return '';
          return `<div class="ucard"><div class="uc-h"><div style="min-width:0"><b>${esc(c.no)}</b> <span class="faint">от ${fd(c.d)}</span><div class="faint" style="font-size:12px">${esc(c.contractor)} · ${esc(c.subject)}</div></div><span class="faint" style="white-space:nowrap">${mlnR(c.amount)}</span></div>
            ${list.length ? list.map(e => `<button class="est-row" type="button" data-go="${link(M.P.id, 'estimates', e.id)}"><span><b>${esc(e.no)}</b>${e.demo ? ' <span class="chip warn">ДЕМО</span>' : ''} · версия ${e.version}<span class="faint" style="display:block; font-size:12px">${e.tot.positions} ${plural(e.tot.positions, 'позиция', 'позиции', 'позиций')} · ${rub(e.tot.total)}${Math.abs(e.tot.total / 1e6 - c.amount) > 0.01 ? ' · <span style="color:var(--warn-ink)">не совпадает с ценой договора</span>' : ''}</span></span>${chip(ES(e.status).t, ES(e.status).c)}</button>`).join('')
              : `<div class="uc-m">${real ? '<b>Смета не загружена.</b>' : 'Смета не загружена.'}</div>`}
            ${!es.length && (has('estimates.create') || has('estimates.edit')) && mine(c) ? `<div class="uc-a"><button class="btn sm" type="button" data-x="est-new" data-cid="${esc(c.id)}">${ico('plus')}Составить смету</button></div>` : ''}</div>`;
        }).join('') || '<div class="empty">Договоров нет.</div>'}</div></div></section>` };
  };
  A['est-f'] = (el, d) => { UI.estF = d.f; keepPage(); };

  function estCard(M, e) {
    const c = e.contractObj || {}, use = DSF.estimateUsage(M, e), P = M.P;
    const acts = [];
    const own = mine(c);
    if (['draft', 'remarks', 'returned'].includes(e.status) && own && (has('estimates.create') || has('estimates.edit'))) acts.push(['review', 'Направить на проверку сметчику', 'primary']);
    if (e.status === 'review' && has('estimates.agree')) acts.push(['checked', 'Проверена — без замечаний', 'primary'], ['remarks', 'Есть замечания', ''], ['returned', 'Вернуть на корректировку', '']);
    if (e.status === 'checked' && has('estimates.approve')) acts.push(['approved', 'Утвердить смету', 'primary'], ['returned', 'Вернуть на корректировку', '']);
    const canEdit = own && (has('estimates.edit') || has('estimates.create')) && ['draft', 'remarks', 'returned'].includes(e.status);
    const canVer = own && (has('estimates.edit') || has('estimates.create')) && ['approved', 'checked'].includes(e.status);
    const T2 = e.tot;
    return { crumb: e.no, html: `<div class="topback"><button class="lnk" type="button" data-go="${link(P.id, 'estimates')}">${ico('left')}Сметы</button></div>
      <section class="panel"><header style="flex-wrap:wrap"><div style="min-width:0; flex:1 1 320px"><div class="eyebrow">Договор ${esc(c.no || e.contract)} · ${esc(c.contractor || '')}</div><h2 style="margin-top:6px">${esc(e.no)} — ${esc(e.title || '')}</h2>
          ${e.demo ? '<div class="note warn" style="margin-top:8px">ДЕМО — демонстрационная смета. Не является сметной документацией.</div>' : ''}</div>
        <div class="fchips">${chip(ES(e.status).t, ES(e.status).c)}${chip('версия ' + e.version, 'neutral')}</div></header>
        <div class="pad"><div class="tiles">${tile('Работы', rub(T2.work))}${tile('Материалы', rub(T2.material))}${tile('Без НДС', rub(T2.net))}${tile('НДС ' + Math.round(e.vatRate * 100) + '%', rub(T2.vat))}${tile('Итого с НДС', rub(T2.total), c.amount != null ? 'цена договора ' + mlnR(c.amount) : '', c.amount != null && Math.abs(T2.total / 1e6 - c.amount) > 0.01 ? 'warn' : 'good')}</div>
          ${acts.length || canEdit || canVer ? `<div class="fchips" style="margin-top:14px">${acts.map(([to, t, cl]) => `<button class="btn ${cl}" type="button" data-x="est-op" data-id="${esc(e.id)}" data-to="${to}">${t}</button>`).join('')}${canEdit ? `<button class="btn" type="button" data-x="est-edit" data-id="${esc(e.id)}">${ico('edit')}Изменить позиции</button>` : ''}${canVer ? `<button class="btn" type="button" data-x="est-edit" data-id="${esc(e.id)}" data-ver="1">${ico('plus')}Новая версия</button>` : ''}</div>` : ''}
        </div></section>
      ${e.sections.map(s => `<section class="panel"><header><h2>${esc(s.name)}</h2><span class="sub">${(s.items || []).length}</span></header><div class="pad">
        <div class="tbl-wrap est-desk"><table class="t"><thead><tr><th class="l">Код</th><th class="l">Наименование</th><th class="l">Ед.</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th><th>В КС-2 (заявл./принято)</th></tr></thead><tbody>
          ${(s.items || []).map(i => { const u = use.get(i.id) || { claimed: 0, accepted: 0 }; const over = u.claimed > i.qty + 1e-9; return `<tr><td class="l faint">${esc(i.code || '')}</td><td class="l w">${esc(i.name)}${i.kind === 'material' ? ' <span class="chip neutral">материал</span>' : ''}</td><td class="l">${esc(i.unit || '')}</td><td>${num(i.qty, 2)}</td><td>${num(i.price, 2)}</td><td>${num(i.qty * i.price, 2)}</td><td style="${over ? 'color:var(--crit)' : ''}">${num(u.claimed, 2)} / ${num(u.accepted, 2)}${over ? ' · превышение' : ''}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="est-mob">${(s.items || []).map(i => { const u = use.get(i.id) || { claimed: 0, accepted: 0 }; return `<div class="imp-i"><div class="imp-h"><b>${esc(i.name)}</b><span>${num(i.qty * i.price, 0)} ₽</span></div><div class="imp-m">${esc(i.code || '')} · ${num(i.qty, 2)} ${esc(i.unit || '')} × ${num(i.price, 2)} ₽${i.kind === 'material' ? ' · материал' : ''}</div><div class="imp-m">в КС-2: ${num(u.claimed, 2)} / принято ${num(u.accepted, 2)}</div></div>`; }).join('')}</div>
        </div></section>`).join('')}
      <section class="panel"><header><h2>История и версии</h2></header><div class="pad"><div class="audit">${e.hist.slice().reverse().map(h => `<div class="au"><div class="au-t">${esc(h.date || '')}</div><div class="au-x"><b>${esc(h.text)}</b>${h.comment ? `<div style="font-size:12.5px">${esc(h.comment)}</div>` : ''}<div class="faint" style="font-size:12px">${esc(h.by || '')}</div></div></div>`).join('')}</div>
        ${e.versions.length > 1 ? `<div class="faint" style="font-size:12px; margin-top:8px">Версий: ${e.versions.length}. Предыдущие версии сохраняются: ${e.versions.slice(0, -1).map(v => 'v' + v.v + ' — ' + rub(DSF.estimateTotals(v.sections, e.vatRate).total)).join('; ')}.</div>` : ''}</div></section>` };
  }
  A['est-op'] = (el, d) => {
    UI.estOp = { id: d.id, to: d.to };
    const need = ['remarks', 'returned'].includes(d.to);
    openModal(() => `<form data-form="est-op" class="mform"><div class="mh"><div><div class="eyebrow">Смета</div><h3 style="margin-top:4px">${esc(ES(d.to).t)}</h3></div>${xBtn}</div>
      <div class="mb"><div class="fld"><label for="eo-c">${need ? 'Замечания *' : 'Комментарий'}</label><textarea id="eo-c" name="comment" ${need ? 'required' : ''} rows="3"></textarea></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`);
  };
  FM['est-op'] = function (f, r) {
    const o = UI.estOp, comment = f.elements.comment.value.trim();
    if (['remarks', 'returned'].includes(o.to) && comment.length < 3) return err('Опишите замечания.');
    DSF.store.update(r.pid, s => s.estimateOps.push({ estimate: o.id, to: o.to, comment, by: me(), date: today() }));
    closeModal(); keepPage(); toast('Статус сметы: ' + esc(ES(o.to).t) + '.');
  };
  /* редактор позиций: правка текущей версии (черновик / после замечаний) или новая версия утверждённой сметы */
  function estEditor(M) {
    const D = UI.estDraft;
    const T2 = DSF.estimateTotals(D.sections, D.vatRate);
    return `<form data-form="est-save" class="mform"><div class="mh"><div><div class="eyebrow">${esc(D.title || 'Смета')}</div><h3 style="margin-top:4px">${D.isNew ? 'Новая смета' : D.ver ? 'Новая версия сметы' : 'Изменение позиций'}</h3></div>${xBtn}</div>
      <div class="mb">${D.isNew ? `<div class="row-f"><div class="fld"><label>Номер сметы</label><input data-ed="no" value="${esc(D.no || '')}" required></div><div class="fld"><label>НДС, %</label><input data-ed="vat" type="number" min="0" max="30" value="${Math.round(D.vatRate * 100)}"></div></div>` : ''}
        ${D.sections.map((s, si) => `<div class="est-sec"><input class="inp" data-es="${si}" value="${esc(s.name)}" style="width:100%; font-weight:650">
          ${s.items.map((i, ii) => `<div class="est-it"><input data-ei="${si}.${ii}.name" value="${esc(i.name)}" placeholder="Наименование" class="inp"><select data-ei="${si}.${ii}.kind" class="inp">${opt('work', 'работа', i.kind !== 'material')}${opt('material', 'материал', i.kind === 'material')}</select>
            <input data-ei="${si}.${ii}.unit" value="${esc(i.unit || '')}" placeholder="ед." class="inp"><input data-ei="${si}.${ii}.qty" type="number" step="any" min="0" value="${i.qty}" class="inp" aria-label="Количество"><input data-ei="${si}.${ii}.price" type="number" step="0.01" min="0" value="${i.price}" class="inp" aria-label="Цена"><span class="est-sum">${num(i.qty * i.price, 2)}</span><button class="icon-btn" type="button" data-x="est-del" data-p="${si}.${ii}" aria-label="Удалить позицию">${ico('trash')}</button></div>`).join('')}
          <button class="btn sm" type="button" data-x="est-add" data-s="${si}">${ico('plus')}Позиция</button></div>`).join('')}
        <button class="btn sm" type="button" data-x="est-addsec">${ico('plus')}Раздел</button>
        <div class="note">Итого: работы ${rub(T2.work)} · материалы ${rub(T2.material)} · без НДС ${rub(T2.net)} · НДС ${rub(T2.vat)} · <b>с НДС ${rub(T2.total)}</b>${D.amount != null ? ' · цена договора ' + mlnR(D.amount) : ''}</div>
        <div class="fld"><label>Комментарий к изменениям</label><input data-ed="comment" value="${esc(D.comment || '')}"></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  A['est-new'] = (el, d) => {
    const M = M0(), c = M.contractBy.get(d.cid);
    const items = c.tasks.filter(t => !t.ms).map((t, k) => ({ id: uid('pos'), code: String(k + 1), name: t.name, unit: t.unit || 'компл.', qty: t.qty || 1, price: 0, kind: 'work', task: t.id, workType: c.item }));
    UI.estDraft = { isNew: true, contract: c.id, no: 'ЛСР-' + c.no, title: 'Локальный сметный расчёт — ' + c.subject, vatRate: c.vat == null ? 0.2 : c.vat, amount: c.amount,
      sections: [{ name: 'Раздел 1. Строительно-монтажные работы', items: items.length ? items : [{ id: uid('pos'), code: '1', name: c.subject, unit: 'компл.', qty: 1, price: 0, kind: 'work' }] }, { name: 'Раздел 2. Материалы', items: [] }] };
    openModal(estEditor, { wide: true });
  };
  A['est-edit'] = (el, d) => {
    const M = M0(), e = DSF.estimatesOf(M).find(x => x.id === d.id);
    UI.estDraft = { id: e.id, ver: !!d.ver, title: e.title, vatRate: e.vatRate, amount: e.contractObj && e.contractObj.amount, sections: JSON.parse(JSON.stringify(e.sections)) };
    openModal(estEditor, { wide: true });
  };
  A['est-add'] = (el, d) => { UI.estDraft.sections[+d.s].items.push({ id: uid('pos'), code: '', name: '', unit: '', qty: 1, price: 0, kind: 'work' }); H.renderLayer(); };
  A['est-addsec'] = () => { UI.estDraft.sections.push({ name: 'Раздел ' + (UI.estDraft.sections.length + 1), items: [] }); H.renderLayer(); };
  A['est-del'] = (el, d) => { const [si, ii] = d.p.split('.').map(Number); UI.estDraft.sections[si].items.splice(ii, 1); H.renderLayer(); };
  document.addEventListener('input', e => {
    const el = e.target, D = UI.estDraft; if (!D || !el.dataset) return;
    if (el.dataset.ed) { if (el.dataset.ed === 'vat') D.vatRate = (+el.value || 0) / 100; else D[el.dataset.ed] = el.value; }
    if (el.dataset.es != null && el.dataset.es !== '') D.sections[+el.dataset.es].name = el.value;
    if (el.dataset.ei) { const [si, ii, k] = el.dataset.ei.split('.'); const it = D.sections[+si].items[+ii]; it[k] = ['qty', 'price'].includes(k) ? (+el.value || 0) : el.value; const sumEl = el.parentElement.querySelector('.est-sum'); if (sumEl) sumEl.textContent = num(it.qty * it.price, 2); }
  });
  document.addEventListener('change', e => { const el = e.target; if (UI.estDraft && el.dataset && el.dataset.ei && el.dataset.ei.endsWith('.kind')) { const [si, ii] = el.dataset.ei.split('.'); UI.estDraft.sections[+si].items[+ii].kind = el.value; } });
  FM['est-save'] = function (f, r) {
    const D = UI.estDraft;
    const bad = D.sections.flatMap(s => s.items).find(i => !String(i.name || '').trim() || !(i.qty > 0) || i.price < 0);
    if (bad) return err('У каждой позиции должны быть наименование, количество больше нуля и неотрицательная цена.');
    D.sections.forEach((s, si) => s.items.forEach((i, ii) => { if (!i.code) i.code = (si + 1) + '.' + (ii + 1); }));
    if (D.isNew) {
      const e = { id: uid('est'), contract: D.contract, no: D.no, title: D.title, version: 1, status: 'draft', vatRate: D.vatRate, sections: D.sections, date: today(), by: me(), author: DSF.auth.org() || me() };
      DSF.store.update(r.pid, s => s.estimates.push(e));
      closeModal(); H.go(link(r.pid, 'estimates', e.id)); toast('Смета сохранена как черновик. Направьте её на проверку сметчику.'); return;
    }
    DSF.store.update(r.pid, s => s.estimateOps.push({ estimate: D.id, op: D.ver ? 'version' : 'edit', to: D.ver ? 'draft' : undefined, sections: D.sections, comment: D.comment || '', by: me(), date: today() }));
    closeModal(); keepPage(); toast(D.ver ? 'Создана новая версия сметы (черновик). Предыдущая версия сохранена.' : 'Позиции сметы изменены.');
  };

  /* ===================================================== регистрация и изменение договора */
  A['ct-reg'] = () => {
    const M = M0();
    UI.ctDraft = { vat: 20, adv: 10, ret: 5, date: today(), workTypes: [] };
    openModal(ctForm, { wide: true });
  };
  function ctForm(M) {
    const D = UI.ctDraft, orgs = DSF.objectOrgs ? DSF.objectOrgs(M) : [], wts = DSF.workTypesOf ? DSF.workTypesOf(M) : [];
    const edit = !!D.id;
    return `<form data-form="ct-save" class="mform"><div class="mh"><div><div class="eyebrow">${esc(M.P.name)} · договоры</div><h3 style="margin-top:4px">${edit ? 'Изменение договора ' + esc(D.no) : 'Регистрация договора'}</h3></div>${xBtn}</div>
      <div class="mb">
        <div class="fld"><label>Контрагент *</label><input name="contractor" list="ct-orgs" required value="${esc(D.contractor || '')}" placeholder="Организация из базы подрядчиков объекта или новая"><datalist id="ct-orgs">${orgs.map(o => `<option value="${esc(o.name)}">`).join('')}</datalist></div>
        <div class="row-f3"><div class="fld"><label>ИНН контрагента</label><input name="inn" inputmode="numeric" maxlength="12" value="${esc(D.inn || '')}"></div><div class="fld"><label>Номер договора *</label><input name="no" required value="${esc(D.no || '')}"></div><div class="fld"><label>Дата *</label><input name="date" type="date" required value="${esc(D.date || '')}"></div></div>
        <div class="fld"><label>Предмет договора *</label><input name="subject" required value="${esc(D.subject || '')}"></div>
        <div class="row-f"><div class="fld"><label>Статья бюджета *</label><select name="item" required>${opt('', '—', !D.item)}${M.items.map(i => opt(i.code, i.name, i.code === D.item)).join('')}</select></div>
          <div class="fld"><label>Виды работ</label><select name="workTypes" multiple size="4">${wts.map(w => opt(w.id, w.name, (D.workTypes || []).includes(w.id))).join('')}</select></div></div>
        <div class="row-f3"><div class="fld"><label>Цена с НДС, ₽ *</label><input name="amount" type="number" step="0.01" min="0.01" required value="${D.amount != null ? D.amount : ''}"></div><div class="fld"><label>НДС, %</label><input name="vat" type="number" min="0" max="30" value="${D.vat}"></div><div class="fld"><label>Условия оплаты</label><input name="payTerms" value="${esc(D.payTerms || '')}" placeholder="например, 30 дней после КС-2"></div></div>
        <div class="row-f3"><div class="fld"><label>Начало работ</label><input name="start" type="date" value="${esc(D.start || '')}"></div><div class="fld"><label>Окончание работ</label><input name="end" type="date" value="${esc(D.end || '')}"></div><div class="fld"><label>Аванс / удержание, %</label><div style="display:flex; gap:6px"><input name="adv" type="number" min="0" max="100" value="${D.adv}"><input name="ret" type="number" min="0" max="20" value="${D.ret}"></div></div></div>
        ${edit ? '<div class="fld"><label>Основание изменения *</label><input name="reason" required minlength="3" placeholder="Доп. соглашение, письмо, решение…"></div>' : ''}
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}${edit ? 'Сохранить изменения' : 'Зарегистрировать'}</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  FM['ct-save'] = function (f, r) {
    const M = M0(), D = UI.ctDraft, fd_ = new FormData(f), g = k => String(fd_.get(k) || '').trim();
    const amountR = +g('amount');
    if (!g('contractor') || !g('no') || !g('date') || !g('subject') || !g('item') || !(amountR > 0)) return err('Заполните обязательные поля.');
    if (g('inn') && !/^\d{10}(\d{2})?$/.test(g('inn'))) return err('ИНН — 10 или 12 цифр.');
    if (g('start') && g('end') && g('end') < g('start')) return err('Окончание работ раньше начала.');
    const data = { contractor: g('contractor'), inn: g('inn'), no: g('no'), date: g('date'), subject: g('subject'), item: g('item'), workTypes: fd_.getAll('workTypes'),
      amount: Math.round(amountR) / 1e6, vat: (+g('vat') || 0) / 100, payTerms: g('payTerms'), start: g('start'), end: g('end'), adv: (+g('adv') || 0) / 100, ret: (+g('ret') || 0) / 100 };
    const base = DSF.objectOrgs ? (DSF.objectOrgs(M).find(o => o.name === data.contractor) || {}).base : null;
    if (base) data.contractorId = base.id;
    if (!D.id) {
      if (M.contracts.some(c => c.no === data.no && c.contractor === data.contractor)) return err('У этого контрагента уже есть договор с таким номером на объекте.');
      const c = Object.assign({ id: uid('ct'), regDate: today(), by: me() }, data);
      DSF.store.update(r.pid, s => s.contracts.push(c));
      closeModal(); H.go(link(r.pid, 'budget', c.id)); toast('Договор зарегистрирован и добавлен в «Бюджет и КС».'); return;
    }
    const reason = g('reason'); if (reason.length < 3) return err('Укажите основание изменения.');
    const c0 = M.contractBy.get(D.id), patch = {};
    Object.entries(data).forEach(([k, v]) => { const cur = k === 'amount' ? c0.base : c0[k]; if (JSON.stringify(cur == null ? '' : cur) !== JSON.stringify(v == null ? '' : v)) patch[k] = v; });
    if (!Object.keys(patch).length) return err('Изменений нет.');
    DSF.store.update(r.pid, s => s.contractOps.push({ contract: D.id, op: 'edit', patch, reason, by: me(), date: today() }));
    closeModal(); keepPage(); toast('Изменения договора сохранены. Прежние значения — в истории договора.');
  };
  const ctFrom = c => ({ id: c.id, contractor: c.contractor, inn: c.inn || '', no: c.no, date: iso(c.d), subject: c.subject, item: c.item, workTypes: c.workTypes || (c.item ? [c.item] : []), amount: Math.round(c.base * 1e6 * 100) / 100, vat: Math.round((c.vat == null ? 0.2 : c.vat) * 100), payTerms: c.payTerms || '', start: c.start || '', end: c.end || '', adv: Math.round((c.adv || 0) * 100), ret: Math.round((c.ret || 0) * 100) });
  if (demo) {
    A['ct-edit'] = (el, d) => { const M = M0(); UI.ctDraft = ctFrom(M.contractBy.get(d.cid)); openModal(ctForm, { wide: true }); };
    A['ct-supp'] = (el, d) => { UI.ctOp = { cid: d.cid, op: 'supp' }; openModal(ctOpForm); };
    A['ct-pay'] = (el, d) => { UI.ctOp = { cid: d.cid, op: 'pay' }; openModal(ctOpForm); };
    U.PERM_X['ct-edit'] = 'contracts.edit'; U.PERM_X['ct-supp'] = 'contracts.approve'; U.PERM_X['ct-pay'] = 'budget.edit'; U.PERM_X['ct-reg'] = 'contracts.create'; U.PERM_X['pay-fix'] = 'budget.edit';
  }
  function ctOpForm(M) {
    const o = UI.ctOp, c = M.contractBy.get(o.cid);
    return `<form data-form="ct-op" class="mform"><div class="mh"><div><div class="eyebrow">Договор ${esc(c.no)}</div><h3 style="margin-top:4px">${o.op === 'supp' ? 'Дополнительное соглашение' : o.op === 'payfix' ? 'Корректировка оплаты' : 'Оплата'}</h3></div>${xBtn}</div>
      <div class="mb">${o.op === 'supp' ? `<div class="row-f"><div class="fld"><label>Номер *</label><input name="no" required></div><div class="fld"><label>Дата *</label><input name="date" type="date" required value="${today()}"></div></div><div class="fld"><label>Предмет *</label><input name="subject" required></div><div class="fld"><label>Изменение цены, ₽ (± с НДС) *</label><input name="amount" type="number" step="0.01" required></div>`
        : o.op === 'payfix' ? `<div class="fld"><label>Сумма оплаты, ₽ *</label><input name="amount" type="number" step="0.01" min="0" required></div><div class="fld"><label>Основание корректировки *</label><input name="reason" required minlength="3"></div>`
        : `<div class="row-f"><div class="fld"><label>Дата *</label><input name="date" type="date" required value="${today()}" max="${today()}"></div><div class="fld"><label>Сумма, ₽ *</label><input name="amount" type="number" step="0.01" min="0.01" required></div></div><div class="row-f"><div class="fld"><label>Назначение</label><select name="kind">${opt('act', 'Оплата выполненных работ', true)}${opt('advance', 'Аванс', false)}${opt('other', 'Прочее', false)}</select></div><div class="fld"><label>Платёжный документ</label><input name="doc" placeholder="п/п № …"></div></div>`}
        <div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Сохранить</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  FM['ct-op'] = function (f, r) {
    const o = UI.ctOp, fd_ = new FormData(f), g = k => String(fd_.get(k) || '').trim();
    const amt = (+g('amount')) / 1e6;
    if (!isFinite(amt) || (o.op !== 'supp' && amt < 0)) return err('Проверьте сумму.');
    const e = { id: uid('cop'), contract: o.cid, op: o.op, by: me(), date: g('date') || today() };
    if (o.op === 'supp') Object.assign(e, { no: g('no'), subject: g('subject'), amount: amt, reason: g('subject') });
    else if (o.op === 'payfix') { Object.assign(e, { pay: o.pay, amount: amt, reason: g('reason') }); if (e.reason.length < 3) return err('Укажите основание.'); }
    else Object.assign(e, { amount: amt, kind: g('kind'), doc: g('doc') });
    DSF.store.update(r.pid, s => s.contractOps.push(e));
    closeModal(); keepPage(); toast(o.op === 'supp' ? 'Доп. соглашение учтено: цена договора изменена.' : 'Сохранено. Оплаты учитываются отдельно от освоения.');
  };
  A['pay-fix'] = (el, d) => { UI.ctOp = { cid: d.cid, op: 'payfix', pay: d.pay }; openModal(ctOpForm); };

  /* ===================================================== КС-2 по позициям сметы */
  A['ks-est'] = (el, d) => {
    const M = M0(), e = DSF.estimatesOf(M).find(x => x.contract === d.cid && x.status === 'approved');
    if (!e) return toast('Нет утверждённой сметы по договору.');
    UI.ksEst = { cid: d.cid, est: e.id, q: {}, from: iso(H.T() - 30), to: today() };
    openModal(ksEstForm, { wide: true });
  };
  function ksEstForm(M) {
    const D = UI.ksEst, e = DSF.estimatesOf(M).find(x => x.id === D.est), c = M.contractBy.get(D.cid), use = DSF.estimateUsage(M, e);
    let sumR = 0; const over = [];
    const rows = e.items.map(i => {
      const u = use.get(i.id) || { claimed: 0, accepted: 0 }, q = +D.q[i.id] || 0, left = i.qty - u.claimed;
      if (q > 0) sumR += q * i.price;
      if (q > 0 && q > left + 1e-9) over.push(i.name);
      return `<div class="ksl ${q > left + 1e-9 && q > 0 ? 'over' : ''}"><div class="ksl-n"><b>${esc(i.name)}</b><span class="faint">${esc(i.code || '')} · по смете ${num(i.qty, 2)} ${esc(i.unit || '')} · ранее ${num(u.claimed, 2)} · остаток ${num(Math.max(0, left), 2)} · ${num(i.price, 2)} ₽</span></div>
        <input class="inp" type="number" step="any" min="0" data-ksq="${esc(i.id)}" value="${D.q[i.id] || ''}" placeholder="0" aria-label="Объём за период"><span class="ksl-s">${q ? num(q * i.price, 2) : '—'}</span></div>`;
    }).join('');
    const vatPart = sumR * e.vatRate / (1 + e.vatRate);
    return `<form data-form="ks-est" class="mform"><div class="mh"><div><div class="eyebrow">${esc(c.no)} · ${esc(c.contractor)} · смета ${esc(e.no)} v${e.version}</div><h3 style="margin-top:4px">КС-2 по позициям сметы</h3></div>${xBtn}</div>
      <div class="mb"><div class="row-f"><div class="fld"><label>Период с</label><input type="date" data-ksp="from" value="${D.from}"></div><div class="fld"><label>по</label><input type="date" data-ksp="to" value="${D.to}" max="${today()}"></div></div>
        <div class="ksl-list">${rows}</div>
        ${over.length ? `<div class="note warn">Превышение объёма по смете: ${over.map(esc).join(', ')}. КС-2 можно направить — проверяющий увидит предупреждение.</div>` : ''}
        <div class="note">Итого по КС-2: <b>${num(sumR, 2)} ₽</b>${e.vatRate ? ' (в т. ч. НДС ' + num(vatPart, 2) + ' ₽)' : ''}. Сумма попадёт в «Заявлено»; в «Принято» — после приёмки.</div>
        <div class="fld"><label>Комментарий</label><input name="note"></div><div class="err" hidden></div></div>
      <div class="mf"><button class="btn primary" type="submit">${ico('check')}Создать КС-2</button><button class="btn" type="button" data-act="x-close">Отмена</button></div></form>`;
  }
  document.addEventListener('input', e => {
    const el = e.target; if (!UI.ksEst || !el.dataset) return;
    if (el.dataset.ksq) { UI.ksEst.q[el.dataset.ksq] = el.value; const pos = el.selectionStart; const id = el.dataset.ksq; H.renderLayer(); const n = document.querySelector(`[data-ksq="${id}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* number */ } } }
    if (el.dataset.ksp) UI.ksEst[el.dataset.ksp] = el.value;
  });
  FM['ks-est'] = function (f, r) {
    const M = M0(), D = UI.ksEst, e = DSF.estimatesOf(M).find(x => x.id === D.est), c = M.contractBy.get(D.cid), use = DSF.estimateUsage(M, e);
    const lines = e.items.filter(i => +D.q[i.id] > 0).map(i => ({ pos: i.id, name: i.name, unit: i.unit, qty: +D.q[i.id], price: i.price, amount: Math.round(+D.q[i.id] * i.price * 100) / 100 }));
    if (!lines.length) return err('Укажите объём хотя бы по одной позиции.');
    if (D.to < D.from) return err('Конец периода раньше начала.');
    const overrun = lines.filter(l => { const i = e.items.find(x => x.id === l.pos), u = use.get(l.pos) || { claimed: 0 }; return l.qty > i.qty - u.claimed + 1e-9; }).map(l => l.pos);
    const claimed = lines.reduce((n, l) => n + l.amount, 0) / 1e6;
    const id = 'ks-' + c.id + '-u' + Date.now().toString(36);
    DSF.store.update(r.pid, s => s.ks.push({ id, contract: c.id, date: today(), periodFrom: D.from, periodTo: D.to, obj: claimed, claimed, estimate: e.id, lines, overrun, note: String(f.elements.note.value || '').trim(), by: c.contractor, no: 'КС-2 № ' + (c.ks.length + 1) }));
    UI.ksEst = null; closeModal(); H.go(link(r.pid, 'budget', id));
    toast('КС-2 по смете создана' + (overrun.length ? ' с предупреждением о превышении объёмов' : '') + '. Следующий шаг — «Направить на предварительную проверку».');
  };

  /* ===================================================== дополнения к экранам «Бюджет и КС» */
  const baseBudget = U.VIEWS.budget;
  U.VIEWS.budget = function (M, r) {
    const v = baseBudget(M, r);
    if (r.sub && M.contractBy.get(r.sub)) return contractExtra(M, M.contractBy.get(r.sub), v);
    if (!r.sub && DSF.auth.role === 'contractor' && M.contracts.length === 1) return contractExtra(M, M.contracts[0], v);
    if (r.sub && M.ksBy.get(r.sub)) return ksExtra(M, M.ksBy.get(r.sub), v);
    if (!r.sub && demo && has('contracts.create')) v.html = v.html.replace('<div class="hd-r">', `<div class="hd-r"><button class="btn primary" type="button" data-x="ct-reg">${ico('plus')}Зарегистрировать договор</button>`);
    if (!r.sub) {
      const cs = M.contracts.filter(c => c.amount > 0), acc = cs.reduce((n, c) => n + c.accepted, 0), amt = cs.reduce((n, c) => n + c.amount, 0);
      v.html = v.html.replace('<section class="tiles">', `<section class="tiles">${tile('Освоение', amt ? num(acc / amt * 100, 1) + '%' : '—', 'принято ' + mlnR(acc) + ' из ' + mlnR(amt) + ' по договорам')}`);
    }
    return v;
  };
  function contractExtra(M, c, v) {
    const E = DSF.estimatesOf(M).filter(e => e.contract === c.id), ap = E.find(e => e.status === 'approved');
    const ks3 = DSF.ks3Of(M, c);
    const btn = (ap && DSF.can('ksgc') && mine(c) ? `<button class="btn primary" type="button" data-x="ks-est" data-cid="${esc(c.id)}">${ico('plus')}КС-2 по смете</button>` : '');
    const payBtn = demo && !M.fin.entered && has('budget.edit') ? `<button class="btn" type="button" data-x="ct-pay" data-cid="${esc(c.id)}">${ico('plus')}Оплата</button>` : '';
    v.html = v.html.replace('<div class="hd-r">', '<div class="hd-r">' + btn + payBtn);
    v.html = v.html.replace(/(<div class="tiles" style="margin-bottom:14px">)/, `$1${tile('Освоение', c.osv == null ? '—' : num(c.osv, 1) + '%', 'принято / актуальная стоимость')}`);
    const extra = `<div class="grid2">
      <section class="panel"><header><h2>Смета</h2></header><div class="pad">${E.length ? E.map(e => `<button class="est-row" type="button" data-go="${link(M.P.id, 'estimates', e.id)}"><span><b>${esc(e.no)}</b>${e.demo ? ' <span class="chip warn">ДЕМО</span>' : ''} · v${e.version}<span class="faint" style="display:block; font-size:12px">${rub(e.tot.total)}</span></span>${chip(ES(e.status).t, ES(e.status).c)}</button>`).join('') : '<div class="empty">Смета не загружена.</div>'}</div></section>
      <section class="panel"><header><h2>Реквизиты и история договора</h2></header><div class="pad">
        <dl class="kv kvw"><dt>Контрагент</dt><dd>${esc(c.contractor)}${c.inn ? ' · ИНН ' + esc(c.inn) : ''}</dd><dt>Цена</dt><dd>${mlnR(c.amount)}${c.vat != null ? ' · НДС ' + Math.round(c.vat * 100) + '%' : ''}</dd><dt>Сроки работ</dt><dd>${c.start ? fd(dn(c.start)) : '—'} – ${c.end ? fd(dn(c.end)) : '—'}</dd><dt>Условия оплаты</dt><dd>${esc(c.payTerms || '—')}</dd><dt>Виды работ</dt><dd>${esc((c.workTypes || (c.item ? [c.item] : [])).map(w => ((DSF.workTypesOf ? DSF.workTypesOf(M) : []).find(x => x.id === w) || {}).name || w).join(', ') || '—')}</dd></dl>
        ${(c.history || []).length ? `<div class="audit" style="margin-top:10px">${c.history.slice().reverse().map(h => `<div class="au"><div class="au-t">${esc(h.date || '')}</div><div class="au-x">${esc(h.text)}${h.reason ? `<div class="faint" style="font-size:12px">основание: ${esc(h.reason)}</div>` : ''}${h.before ? `<div class="faint" style="font-size:12px">было: ${esc(Object.entries(h.before).map(([k, x]) => (DSF.CONTRACT_FIELD_T[k] || k) + ' ' + (x == null ? '—' : Array.isArray(x) ? x.join(', ') : x)).join('; '))}</div>` : ''}<div class="faint" style="font-size:12px">${esc(h.by || '')}</div></div></div>`).join('')}</div>` : '<div class="faint" style="font-size:12.5px; margin-top:8px">Изменений не было.</div>'}
        ${(c.payments || []).some(p => p.user) ? `<div class="eyebrow" style="margin-top:10px">Внесённые оплаты</div>${c.payments.filter(p => p.user).map(p => `<div class="li"><span class="t">${fd(p.d)} · ${mlnR(p.amount)}${p.fixed ? ' <span class="chip warn">скорректировано</span>' : ''}</span><span class="m">${esc(p.doc || '')}</span>${has('budget.edit') ? `<button class="btn sm" type="button" data-x="pay-fix" data-cid="${esc(c.id)}" data-pay="${esc(p.id)}">Корректировать</button>` : ''}</div>`).join('')}` : ''}
      </div></section></div>
      <section class="panel"><header><h2>Справки КС-3</h2><span class="sub">стоимость выполненных работ по принятым КС-2</span></header><div class="pad">${ks3.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th class="l">КС-3</th><th class="l">Период</th><th>КС-2</th><th>За период</th><th>С начала года</th><th>С начала работ</th><th>В т. ч. НДС</th><th></th></tr></thead><tbody>${ks3.map(x => `<tr><td class="l"><b>№ ${x.n}</b></td><td class="l">${esc(monthTxt(x.period))}</td><td>${x.ks.length}</td><td>${mlnR(x.amount)}</td><td>${mlnR(x.ytd)}</td><td>${mlnR(x.cum)}</td><td>${mlnR(x.amount * x.vat / (1 + x.vat))}</td><td><button class="btn sm" type="button" data-x="ks3-open" data-cid="${esc(c.id)}" data-n="${x.n}">Открыть</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Принятых КС-2 нет — КС-3 не формируется.</div>'}</div></section>`;
    v.html += extra;
    return v;
  }
  A['ks3-open'] = (el, d) => {
    const M = M0(), c = M.contractBy.get(d.cid), x = DSF.ks3Of(M, c).find(z => z.n === +d.n);
    openModal(() => `<div class="mh"><div><div class="eyebrow">Форма КС-3 · ${esc(c.no)}</div><h3 style="margin-top:4px">Справка о стоимости выполненных работ и затрат № ${x.n}</h3></div>${xBtn}</div>
      <div class="mb"><dl class="kv kvw"><dt>Заказчик</dt><dd>${esc(c.customerParty || M.P.customer || '—')}</dd><dt>Подрядчик</dt><dd>${esc(c.contractor)}</dd><dt>Договор</dt><dd>${esc(c.no)} от ${fd(c.d)}</dd><dt>Отчётный период</dt><dd>${esc(monthTxt(x.period))}</dd></dl>
        <div class="tbl-wrap"><table class="t"><thead><tr><th class="l">Наименование</th><th>С начала работ</th><th>С начала года</th><th>За отчётный период</th></tr></thead><tbody>
          ${x.ks.map(k => `<tr><td class="l">${esc(k.no)}</td><td></td><td></td><td>${mlnR(k.accepted)}</td></tr>`).join('')}
          <tr><td class="l"><b>Всего работ и затрат</b></td><td><b>${mlnR(x.cum)}</b></td><td><b>${mlnR(x.ytd)}</b></td><td><b>${mlnR(x.amount)}</b></td></tr>
          <tr><td class="l">в т. ч. НДС ${Math.round(x.vat * 100)}%</td><td>${mlnR(x.cum * x.vat / (1 + x.vat))}</td><td>${mlnR(x.ytd * x.vat / (1 + x.vat))}</td><td>${mlnR(x.amount * x.vat / (1 + x.vat))}</td></tr></tbody></table></div>
        <p class="faint" style="font-size:12px">Сформировано по принятым КС-2. ${demo ? 'Демонстрационные данные.' : ''}</p></div>`, { wide: true });
  };
  function ksExtra(M, k, v) {
    if (!k.estLines) return v;
    const e = DSF.estimatesOf(M).find(x => x.id === k.estimate);
    const over = new Set(k.overrun || []);
    v.html += `<section class="panel"><header><h2>Позиции сметы в КС-2</h2><span class="sub">${e ? esc(e.no) + ' v' + e.version : ''}${k.periodTo ? ' · период по ' + fd(k.periodTo) : ''}</span></header><div class="pad">
      ${over.size ? '<div class="note warn" style="margin-bottom:8px">Есть превышение объёмов по смете — проверьте позиции, отмеченные красным.</div>' : ''}
      <div class="imp-list" style="max-height:none">${k.estLines.map(l => `<div class="imp-i" style="${over.has(l.pos) ? 'box-shadow:inset 3px 0 0 var(--crit)' : ''}"><div class="imp-h"><b>${esc(l.name)}</b><span>${num(l.amount, 2)} ₽</span></div><div class="imp-m">${num(l.qty, 2)} ${esc(l.unit || '')} × ${num(l.price, 2)} ₽${over.has(l.pos) ? ' · превышение объёма сметы' : ''}</div></div>`).join('')}</div></div></section>`;
    return v;
  }

  /* уведомления: сметы на проверке / утверждении */
  DSF.notifyHooks.push(M => {
    const E = DSF.estimatesOf(M), out = [];
    if (has('estimates.agree')) E.filter(e => e.status === 'review').forEach(e => out.push({ sev: 'accent', title: 'Смета ' + e.no + ' ждёт проверки', meta: (e.contractObj || {}).contractor || '', go: link(M.P.id, 'estimates', e.id) }));
    if (has('estimates.approve')) E.filter(e => e.status === 'checked').forEach(e => out.push({ sev: 'accent', title: 'Смета ' + e.no + ' ждёт утверждения', meta: (e.contractObj || {}).contractor || '', go: link(M.P.id, 'estimates', e.id) }));
    if (DSF.auth.role === 'contractor') E.filter(e => ['remarks', 'returned'].includes(e.status) && mine(e.contractObj || {})).forEach(e => out.push({ sev: 'warn', title: 'Смета ' + e.no + ': ' + ES(e.status).t, meta: '', go: link(M.P.id, 'estimates', e.id) }));
    return out;
  });
})();
