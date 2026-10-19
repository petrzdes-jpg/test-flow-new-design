/*
 * Расширение универсального движка: документооборот, протоколы и поручения, письма.
 *
 * Документ — объект системы: категория, раздел, шифр, версии со статусами и историей,
 * связи с работами, событиями, поручениями и письмами. Ни один документ не копируется
 * между разделами: все экраны ссылаются на один объект по id.
 *
 * Компактная запись документа в датасете:
 *   [категория, раздел, шифр, название, работы, версии, доп. поля]
 *   версия: 'ред|дата|статус|дата передачи|кому'
 *   статусы: none — не загружено, up — загружено, rev — на проверке, ok — согласовано,
 *            prod — передано в производство работ, ret — возвращено с замечаниями, ann — аннулировано
 */
(function (root) {
  'use strict';
  const DSF = root.DSF;
  const { dn, iso, sum, monthStart, addMonths, DAY } = DSF.util;

  DSF.DOC_CATS = {
    rd:        { t: 'РД', full: 'Рабочая документация', versioned: true, sections: true },
    pd:        { t: 'ПД', full: 'Проектная документация', versioned: true, sections: true },
    id:        { t: 'ИД', full: 'Исполнительная документация', byWork: true },
    ks:        { t: 'КС', full: 'Выполнение, приёмка и расчёты (КС-2)', virtual: true },
    reports:   { t: 'Отчёты', full: 'Отчёты' },
    letters:   { t: 'Письма', full: 'Входящие и исходящие письма', virtual: true },
    protocols: { t: 'Протоколы', full: 'Протоколы совещаний', virtual: true },
    permits:   { t: 'Разрешения', full: 'Разрешительная документация' },
    contracts: { t: 'Договоры', full: 'Договоры', virtual: true }
  };
  DSF.DOC_SECTIONS = {
    'ГП': 'Генеральный план и благоустройство', 'АР': 'Архитектурные решения', 'КР': 'Конструктивные решения',
    'КЖ': 'Конструкции железобетонные', 'КМ': 'Конструкции металлические', 'НВК': 'Наружные сети водоснабжения и канализации', 'НЭС': 'Наружные сети электроснабжения',
    'ОВ': 'Отопление, вентиляция и кондиционирование', 'ВК': 'Водоснабжение и канализация', 'ЭОМ': 'Электроснабжение и освещение',
    'СС': 'Сети связи и слаботочные системы', 'АПТ': 'Автоматическое пожаротушение и сигнализация', 'ТХ': 'Технологические решения',
    'НС': 'Наружные сети', 'ПОС': 'Проект организации строительства', 'ЛФТ': 'Лифты и вертикальный транспорт',
    'АОСР': 'Акты освидетельствования скрытых работ', 'АООК': 'Акты освидетельствования ответственных конструкций',
    'ИС': 'Исполнительные схемы', 'ПИ': 'Протоколы испытаний и лабораторного контроля', 'АПР': 'Акты приёмки и пусконаладки',
    'РАЗ': 'Разрешения и заключения', 'ТУ': 'Технические условия', 'ОРД': 'Ордера и согласования', 'МЕС': 'Ежемесячные отчёты', 'ОТЧ': 'Отчёты и обследования'
  };
  DSF.DOC_STATUS = {
    none: { t: 'Не загружено', c: 'neutral' },
    up:   { t: 'Загружено', c: 'neutral' },
    rev:  { t: 'На проверке', c: 'accent' },
    ok:   { t: 'Согласовано', c: 'good' },
    prod: { t: 'Передано в производство работ', c: 'good' },
    ret:  { t: 'Возвращено с замечаниями', c: 'warn' },
    ann:  { t: 'Аннулировано', c: 'crit' },
    sup:  { t: 'Заменено новой редакцией', c: 'neutral' }
  };
  const OK_LABEL = { id: 'Подписан', permits: 'Действует', reports: 'Выпущен', pd: 'Согласовано' };
  DSF.docStatusLabel = (doc, st) => (st === 'ok' && OK_LABEL[doc.cat]) || (DSF.DOC_STATUS[st] || DSF.DOC_STATUS.none).t;
  DSF.DOC_ACTIONS = {
    up: [['review', 'Направить на проверку']],
    rev: [['approve', 'Согласовать'], ['return', 'Вернуть с замечаниями']],
    ret: [],
    ok: [['transfer', 'Передать в производство работ']],
    prod: [], ann: [], none: []
  };
  DSF.ORDER_STATUS = { new: { t: 'Новое', c: 'accent' }, work: { t: 'В работе', c: 'neutral' }, done: { t: 'Выполнено', c: 'good' }, overdue: { t: 'Просрочено', c: 'crit' } };
  DSF.ORDER_PRIORITY = { critical: { t: 'Критический', c: 'crit' }, high: { t: 'Высокий', c: 'warn' }, normal: { t: 'Обычный', c: 'neutral' } };

  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  DSF.slug = s => String(s).toLowerCase().split('').map(ch => TR[ch] != null ? TR[ch] : ch).join('').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

  function parseDoc(x, P) {
    if (!Array.isArray(x)) return Object.assign({ versions: [] }, x);
    const [cat, section, code, title, tasks, vers, extra] = x;
    return Object.assign({
      cat, section, code, title,
      tasks: tasks == null ? [] : [].concat(tasks),
      versions: (vers || []).map(v => {
        const [rev, date, status, sent, to] = String(v).split('|');
        return { rev, date, status: status || 'up', sent: sent || null, to: to || null };
      })
    }, extra || {});
  }

  function histFor(v, T) {
    const d = v.d, h = [{ d, st: 'up', text: 'Загружена редакция ' + v.rev }];
    const cl = x => Math.min(T, Math.max(d, x));
    if (['rev', 'ok', 'prod', 'ret'].includes(v.status)) h.push({ d: cl(d + 1), st: 'rev', text: 'Направлено на проверку' });
    if (v.status === 'ret') h.push({ d: cl(d + 4), st: 'ret', text: 'Возвращено с замечаниями' });
    if (['ok', 'prod'].includes(v.status)) h.push({ d: cl(v.sent != null ? Math.min(d + 5, v.sent) : d + 5), st: 'ok', text: 'Согласовано' });
    if (v.status === 'prod') h.push({ d: v.sent, st: 'prod', text: 'Передано в производство работ' + (v.to ? ': ' + v.to : '') });
    if (v.status === 'ann') h.push({ d: cl(d + 1), st: 'ann', text: 'Аннулировано' });
    return h;
  }

  DSF.extensions.push(function records(ctx) {
    const { P, S, T, byId, contracts, events } = ctx;
    /* категории и разделы документации: системные + настроенные для объекта */
    const docCats = Object.assign({}, DSF.DOC_CATS);
    (P.docCats || []).filter(c => c && c.key && !DSF.DOC_CATS[c.key]).forEach(c => { docCats[c.key] = { t: c.t || c.key, full: c.full || c.t || c.key, custom: true, versioned: true, sections: true }; });
    const docSecNames = Object.assign({}, DSF.DOC_SECTIONS);
    (P.docSections || []).forEach(x => { if (x && x.code) docSecNames[x.code] = x.name || docSecNames[x.code] || x.code; });
    Object.assign(ctx, { docCats, docSecNames, docSections: (P.docSections || []).filter(x => x && x.code && !x.archived) });
    const contractor = taskIds => { for (const id of taskIds) { const t = byId.get(id); const c = t && t.contract && contracts.find(z => z.id === t.contract); if (c) return c.contractor; } return P.gc || ''; };

    /* ---------- документы ---------- */
    const raw = (P.documents || []).map(x => parseDoc(x, P)).concat(S.docs.map(x => Object.assign({ user: true }, x, { versions: [] })));
    const docs = raw.map(r => {
      const d = {
        id: r.id || ('d-' + DSF.slug(r.code || r.title)), cat: r.cat, section: r.section || '', code: r.code || '', title: r.title,
        org: r.org || (r.cat === 'rd' || r.cat === 'pd' ? P.designer : r.cat === 'reports' ? P.supervisor : ''), issuer: r.issuer || '', desc: r.desc || '',
        due: dn(r.due), taskIds: r.tasks || [], user: !!r.user
      };
      d.versions = (r.versions || []).map(v => {
        const o = { rev: v.rev, d: dn(v.date), status: v.status, sent: dn(v.sent), to: v.to || null, by: v.by || d.org, file: v.file || null, note: v.note || '' };
        if (o.status === 'prod' && !o.to) o.to = contractor(d.taskIds);
        o.history = histFor(o, T);
        return o;
      });
      return d;
    });
    /* ежемесячные отчёты Технического заказчика — формируются системой */
    for (let m = addMonths(monthStart(T), -12); m < monthStart(T); m = addMonths(m, 1)) {
      if (m < monthStart(ctx.start)) continue;
      const nd = addMonths(m, 1) + 4;
      if (nd > T) continue;
      const mm = new Date(m * DAY);
      docs.push({ id: 'rep-' + iso(m).slice(0, 7), cat: 'reports', section: 'МЕС', code: 'ОТЧ-' + iso(m).slice(0, 7), title: 'Ежемесячный отчёт Технического заказчика за ' + DSF.fmt.MONTHS_FULL[mm.getUTCMonth()] + ' ' + mm.getUTCFullYear(),
        org: P.supervisor, issuer: '', desc: '', due: null, taskIds: [], auto: true, versions: [{ rev: '1', d: nd, status: 'ok', sent: null, to: null, by: P.supervisor, history: [{ d: nd, st: 'ok', text: 'Отчёт выпущен' }] }] });
    }
    const docBy = new Map(docs.map(d => [d.id, d]));
    /* загрузки и движение документов, выполненные пользователем */
    S.docOps.forEach(op => {
      const d = docBy.get(op.doc); if (!d) return;
      const date = dn(op.date) || T;
      if (op.op === 'upload') {
        const v = { rev: op.rev, d: dn(op.verDate) || date, status: 'up', sent: null, to: null, by: op.by || d.org, file: op.file || null, note: op.note || '', user: true,
          history: [{ d: date, st: 'up', text: 'Загружена редакция ' + op.rev + (op.file ? ' · файл ' + op.file.name : ''), by: op.by }] };
        d.versions.push(v);
        if (op.tasks && op.tasks.length) d.taskIds = [...new Set(d.taskIds.concat(op.tasks))];
        return;
      }
      const v = d.versions.find(x => x.rev === op.rev); if (!v) return;
      const map = { review: 'rev', approve: 'ok', return: 'ret', transfer: 'prod', annul: 'ann' };
      v.status = map[op.op] || v.status;
      if (op.op === 'transfer') { v.sent = date; v.to = op.to || contractor(d.taskIds); }
      v.history.push({ d: date, st: v.status, text: (DSF.DOC_STATUS[v.status] || {}).t + (op.op === 'transfer' ? ': ' + v.to : '') + (op.note ? ' — ' + op.note : ''), by: op.by });
    });
    docs.forEach(d => {
      d.tasks = d.taskIds.map(id => byId.get(id)).filter(Boolean);
      const vs = d.versions;
      vs.forEach((v, i) => {
        const later = vs.slice(i + 1);
        const laterProd = later.some(x => x.status === 'prod');
        const laterOk = later.some(x => x.status === 'ok' || x.status === 'prod');
        v.shown = v.status !== 'ann' && (laterProd || (laterOk && v.status !== 'prod')) ? 'sup' : v.status;
      });
      d.cur = [...vs].reverse().find(v => v.status !== 'ann') || null;
      d.prod = [...vs].reverse().find(v => v.status === 'prod') || null;
      d.state = d.cur ? d.cur.status : (vs.length ? 'ann' : 'none');
      d.d = d.cur ? d.cur.d : null;
      d.events = []; d.orders = []; d.letters = [];
      // события «Выдача РД» — по фактическим передачам в производство
      if (d.cat === 'rd') vs.filter(v => v.sent != null).forEach(v => events.push({ id: 'rd-' + d.id + '-' + v.rev, sys: true, type: 'rd', title: 'Выдача РД в производство: ' + d.code + ', ред. ' + v.rev, date: v.sent, plan: null, time: '', place: '', people: v.to ? [v.to] : [], owner: d.org,
        desc: d.title, task: d.tasks[0] || null, tasks: d.tasks, docIds: [d.id], done: v.sent < T }));
      // освидетельствования — по актам ИД
      if (d.cat === 'id' && (d.section === 'АОСР' || d.section === 'АООК') && d.cur) events.push({ id: 'id-' + d.id, sys: true, type: 'inspection', title: /^освидетельствование/i.test(d.title) ? d.title : 'Освидетельствование: ' + d.title, date: d.versions[0].d, plan: null, time: '', place: 'Объект', people: [], owner: d.org,
        desc: d.code, task: d.tasks[0] || null, tasks: d.tasks, docIds: [d.id], done: d.versions[0].d < T });
    });

    /* ---------- протоколы и поручения ---------- */
    const protocols = (P.protocols || []).map(p => Object.assign({}, p, { d: dn(p.date), people: p.people || [], orders: [], cat: 'protocols' }));
    const protocolBy = new Map(protocols.map(p => [p.id, p]));
    const oraw = (P.orders || []).map(o => Object.assign({}, o)).concat(S.orders.map(o => Object.assign({ user: true }, o)));
    const orderOps = S.orderOps;
    const orders = oraw.map(o => {
      const x = {
        id: o.id, no: o.no, text: o.text, protocolId: o.protocol || null, set: dn(o.set), due: dn(o.due), owner: o.owner || '', priority: o.priority || 'normal',
        raw: o.status || 'new', doneD: dn(o.done), comment: o.comment || '', taskIds: o.tasks || [], docIds: o.docs || [], eventId: o.event || null, riskId: o.risk || null, user: !!o.user,
        history: [{ d: dn(o.set), text: 'Поручение поставлено' + (o.protocol ? ' по протоколу' : ''), by: '' }].concat(o.status === 'work' ? [{ d: Math.min(T, dn(o.set) + 2), text: 'Принято в работу', by: o.owner }] : [])
          .concat(o.status === 'done' && o.done ? [{ d: dn(o.done), text: 'Выполнено' + (o.comment ? ': ' + o.comment : ''), by: o.owner }] : [])
      };
      orderOps.filter(op => op.order === x.id).forEach(op => {
        const d = dn(op.date) || T;
        if (op.op === 'status') { x.raw = op.to; if (op.to === 'done') x.doneD = d; x.history.push({ d, text: (DSF.ORDER_STATUS[op.to] || {}).t + (op.comment ? ': ' + op.comment : ''), by: op.by }); }
        if (op.op === 'comment') { x.comment = op.comment; x.history.push({ d, text: 'Комментарий: ' + op.comment, by: op.by }); }
        if (op.op === 'link-event') { x.eventId = op.event; x.history.push({ d, text: 'Назначено событие в календаре', by: op.by }); }
      });
      x.status = x.raw === 'done' ? 'done' : x.due != null && x.due < T ? 'overdue' : x.raw;
      x.tasks = x.taskIds.map(id => byId.get(id)).filter(Boolean);
      x.protocol = protocolBy.get(x.protocolId) || null;
      if (x.protocol) x.protocol.orders.push(x);
      // срок исполнения — в календаре (один объект, показанный по дате срока)
      events.push({ id: 'ord-' + x.id, sys: true, type: 'order', title: 'Срок поручения № ' + x.no + ': ' + x.text, date: x.status === 'done' && x.doneD != null ? Math.min(x.due, x.doneD) : x.due, plan: x.due, time: '', place: '', people: x.owner ? [x.owner] : [], owner: x.owner,
        desc: x.comment, task: x.tasks[0] || null, tasks: x.tasks, docIds: x.docIds, orderId: x.id, done: x.status === 'done', orderStatus: x.status });
      return x;
    });
    const orderBy = new Map(orders.map(o => [o.id, o]));

    /* ---------- письма ---------- */
    const letters = (P.letters || []).map(l => Object.assign({}, l)).concat(S.letters.map(l => Object.assign({ user: true }, l))).map(l => Object.assign(l, {
      d: dn(l.date), docIds: l.docs || [], taskIds: l.tasks || [], orderIds: l.orders || [], eventIds: l.events || [], cat: 'letters'
    }));
    // черновик мог ссылаться на событие, которое пользователь затем удалил: связь снимается, письмо остаётся
    letters.filter(l => l.user).forEach(l => { l.eventIds = l.eventIds.filter(id => events.some(e => e.id === id || e.series === id)); });
    const letterBy = new Map(letters.map(l => [l.id, l]));

    /* ---------- обратные связи ---------- */
    const evAll = () => events;
    orders.forEach(o => { o.docs = o.docIds.map(id => docBy.get(id)).filter(Boolean); o.docs.forEach(d => d.orders.push(o)); });
    letters.forEach(l => { l.docs = l.docIds.map(id => docBy.get(id)).filter(Boolean); l.docs.forEach(d => d.letters.push(l)); l.tasks = l.taskIds.map(id => byId.get(id)).filter(Boolean); l.orders = l.orderIds.map(id => orderBy.get(id)).filter(Boolean); });
    evAll().forEach(e => { (e.docIds || []).forEach(id => { const d = docBy.get(id); if (d) d.events.push(e); }); });

    Object.assign(ctx, { documents: docs, docBy, orders, orderBy, protocols, protocolBy, letters, letterBy, reports: docs.filter(d => d.cat === 'reports') });
  });

  /* универсальный поиск объекта по id: документ, КС-2, поручение, протокол, письмо, событие, договор, работа */
  DSF.resolve = function (M, id) {
    if (!id) return null;
    if (M.docBy && M.docBy.get(id)) return { kind: 'doc', obj: M.docBy.get(id) };
    if (M.ksBy && M.ksBy.get(id)) return { kind: 'ks', obj: M.ksBy.get(id) };
    if (M.orderBy && M.orderBy.get(id)) return { kind: 'order', obj: M.orderBy.get(id) };
    if (M.protocolBy && M.protocolBy.get(id)) return { kind: 'protocol', obj: M.protocolBy.get(id) };
    if (M.letterBy && M.letterBy.get(id)) return { kind: 'letter', obj: M.letterBy.get(id) };
    if (M.evBy && M.evBy.get(id)) return { kind: 'event', obj: M.evBy.get(id) };
    if (M.contractBy && M.contractBy.get(id)) return { kind: 'contract', obj: M.contractBy.get(id) };
    if (M.byId && M.byId.get(id)) return { kind: 'task', obj: M.byId.get(id) };
    return null;
  };

  /* проверки целостности новых сущностей */
  DSF.validators = DSF.validators || [];
  DSF.validators.push(function (P, M, E, W) {
    const T = M.T, seen = new Set();
    M.documents.forEach(d => {
      const n = '«' + (d.code || d.title) + '»';
      if (seen.has(d.id)) E('Повтор документа ' + n); seen.add(d.id);
      if (!(M.docCats || DSF.DOC_CATS)[d.cat]) E(n + ': неизвестная категория ' + d.cat);
      d.taskIds.forEach(id => { if (!M.byId.get(id)) E(n + ': связь с несуществующей работой ' + id); });
      d.versions.forEach(v => {
        if (v.d == null) E(n + ' ред. ' + v.rev + ': нет даты');
        if (v.d > T) E(n + ' ред. ' + v.rev + ': дата в будущем');
        if (v.sent != null && v.sent < v.d) E(n + ' ред. ' + v.rev + ': передано раньше загрузки');
        if (v.sent != null && v.sent > T) E(n + ' ред. ' + v.rev + ': передача в будущем');
        if (v.status === 'prod' && v.sent == null) E(n + ' ред. ' + v.rev + ': передано в производство без даты');
        if (!DSF.DOC_STATUS[v.status]) E(n + ': неизвестный статус ' + v.status);
      });
      if (d.cat === 'rd') {
        // работа начата по РД, которая ещё не передана в производство
        d.tasks.forEach(t => { if (t.as != null && !d.prod && d.versions.length && d.state !== 'ann' && t.done) W(n + ': работа «' + t.name + '» завершена, а РД не передана в производство'); });
      }
    });
    M.orders.forEach(o => {
      const n = 'Поручение № ' + o.no;
      if (o.protocolId && !o.protocol) E(n + ': неизвестный протокол ' + o.protocolId);
      if (o.protocol && o.set < o.protocol.d) E(n + ': поставлено раньше протокола');
      if (o.due < o.set) E(n + ': срок раньше даты постановки');
      if (o.raw === 'done' && o.doneD == null) E(n + ': выполнено без даты');
      if (o.doneD != null && o.doneD > T) E(n + ': дата выполнения в будущем');
      o.taskIds.forEach(id => { if (!M.byId.get(id)) E(n + ': неизвестная работа ' + id); });
      o.docIds.forEach(id => { if (!DSF.resolve(M, id)) E(n + ': неизвестный документ ' + id); });
      if (o.eventId && !M.evBy.get(o.eventId)) E(n + ': неизвестное событие ' + o.eventId);
    });
    M.protocols.forEach(p => { if (p.event && !M.evBy.get(p.event)) E('Протокол № ' + p.no + ': неизвестное событие ' + p.event); if (p.d > T) E('Протокол № ' + p.no + ' датирован будущим'); });
    M.letters.forEach(l => {
      if (l.d > T) E('Письмо ' + l.no + ' датировано будущим');
      l.docIds.forEach(id => { if (!DSF.resolve(M, id)) E('Письмо ' + l.no + ': неизвестный документ ' + id); });
      l.orderIds.forEach(id => { if (!M.orderBy.get(id)) E('Письмо ' + l.no + ': неизвестное поручение ' + id); });
      l.eventIds.forEach(id => { if (!M.evBy.get(id)) E('Письмо ' + l.no + ': неизвестное событие ' + id); });
      l.taskIds.forEach(id => { if (!M.byId.get(id)) E('Письмо ' + l.no + ': неизвестная работа ' + id); });
    });
    M.events.forEach(e => {
      (e.docIds || []).forEach(id => { if (!DSF.resolve(M, id)) E('Событие «' + e.title + '»: неизвестный документ ' + id); });
      if (e.orderId && !M.orderBy.get(e.orderId)) E('Событие «' + e.title + '»: неизвестное поручение ' + e.orderId);
      if (e.ksId && !M.ksBy.get(e.ksId)) E('Событие «' + e.title + '»: неизвестная КС-2 ' + e.ksId);
    });
    M.ks.forEach(k => { if (k.event && !M.evBy.get(k.event)) E(k.contract.no + ' ' + k.no + ': неизвестное событие приёмки ' + k.event); });
  });
})(typeof window !== 'undefined' ? window : globalThis);
