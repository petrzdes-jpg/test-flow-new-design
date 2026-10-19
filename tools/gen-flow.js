/*
 * Генератор вымышленного производственного контура демо-объектов (data/flow/<id>.js).
 * Запуск: node tools/gen-flow.js && node tools/export-demo-data.js
 *
 * Строит для каждого объекта ежедневные отчёты подрядчиков, ИД по работам, замечания
 * стройконтроля и гарантийные письма так, чтобы итоговая готовность совпадала с исходным
 * описанием объекта, а темп по отчётам — с прогнозом графика. Все данные вымышлены.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
global.window = global;
['cpm', 'engine', 'engine-records', 'engine-flow', 'engine-changes', 'config'].forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, 'public/flow', f + '.js'), 'utf8')));
const ids = require(path.join(root, 'api/demo_data/manifest.json')).projects;
ids.forEach(id => vm.runInThisContext(fs.readFileSync(path.join(root, 'api/demo_data/src/projects', id + '.js'), 'utf8')));
const { dn, iso } = DSF.util;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/* ---------- настройки объектов (вымышленные) ---------- */
const CFG = {
  kristall: {
    days: 20, lagDirector: 0, retDay: 4, ret: { org: 'АО «ГеоФундамент Инжиниринг»', note: 'Количество свай за день не совпадает с журналом бетонных работ — уточнить по исполнительной схеме' },
    qty: { k07: [168000, 'м³', 10], k08: [520, 'шт.', 1], k09: [412, 'шт.', 1], k10: [5400, 'м²', 10] },
    crew: { k07: [38, 6], k08: [22, 4], k09: [31, 5], k10: [18, 6] },
    id: { k08: [['АОСР', 'АОСР-112', 'Устройство грунтовых анкеров, ярус 1', '2026-09-04', 'ok'], ['АОСР', 'АОСР-124', 'Устройство грунтовых анкеров, ярус 2', '2026-10-01', 'ret']], k07: [['ИС', 'ИС-КТ-05', 'Исполнительная съёмка дна котлована, захватка 3', '2026-09-28', 'ok']] },
    remarks: [
      { task: 'k09', sev: 'major', title: 'Отклонение оголовков свай от проектной отметки', desc: 'Оголовки свай ряда Г/4–Г/9 выше проектной отметки на 40–70 мм, срубка не выполнена.', loc: 'Ось Г, сваи 214–231', norm: 'СП 45.13330, проект КЖ0', date: -12, due: -4, status: 'closed', closed: -5 },
      { task: 'k07', sev: 'critical', title: 'Перебор грунта ниже проектной отметки дна котлована', desc: 'На захватке 4 выявлен перебор грунта до 25 см; требуется досыпка и уплотнение по согласованию с проектировщиком.', loc: 'Захватка 4, оси 7–11', norm: 'СП 45.13330', date: -6, due: -1, status: 'work' },
      { task: 'k08', sev: 'major', title: 'Нет протоколов натяжения анкеров яруса 2', desc: 'Анкеры яруса 2 смонтированы, протоколы испытаний натяжением не представлены.', loc: 'Ярус 2, северная сторона', norm: 'проект КЖ0', date: -5, due: 3, status: 'assigned' },
      { task: 'k10', sev: 'minor', title: 'Складирование гидроизоляции без защиты от осадков', desc: 'Рулоны гидроизоляционной мембраны хранятся на открытой площадке без укрытия.', loc: 'Площадка складирования № 2', norm: 'ППР', date: -3, due: 1, status: 'presented' },
      { task: 'k06', sev: 'minor', title: 'Не очищены выпуски арматуры стены в грунте', desc: 'Выпуски арматуры по оси 1 не очищены от бетона.', loc: 'Ось 1', norm: 'проект КЖ0', date: -40, due: -33, status: 'closed', closed: -34 },
      { task: 'k09', sev: 'major', title: 'Защитный слой бетона ниже проектного', desc: 'На трёх сваях фактический защитный слой 50 мм при проектных 70 мм.', loc: 'Сваи 187, 190, 193', norm: 'СП 63.13330, проект КЖ0', date: -21, due: -14, status: 'closed', closed: -15 }
    ],
    guarantees: [{ contract: 'kc3', days: 7, letter: 'ГФИ-ИСХ-0418' }]
  },
  bereg: {
    days: 20, lagDirector: 3, retDay: 6, ret: { org: 'ООО «КамСтройКладка»', note: 'Объём кладки указан с учётом 9 этажа, на котором не принята армированная перемычка' },
    qty: { b06: [18500, 'м³', 1], b07: [15200, 'м³', 1], b08: [11800, 'м³', 1], b10: [9600, 'м³', 1] },
    crew: { b06: [64, 10], b07: [58, 8], b08: [44, 8], b10: [36, 6], b14: [18, 5] },
    id: { b10: [['АОСР', 'АОСР-КЛ-031', 'Кладка наружных стен 2–4 этажей корпуса 2', '2026-09-18', 'ok'], ['АОСР', 'АОСР-КЛ-036', 'Кладка наружных стен 5–7 этажей корпуса 2', '2026-10-01', 'rev']], b14: [['АОСР', 'АОСР-ОВ-004', 'Прокладка стояков отопления паркинга', '2026-10-02', 'rev']], b08: [['АОСР', 'АОСР-К3-142', 'Армирование перекрытия 10 этажа корпуса 3', '2026-09-30', 'ret']] },
    remarks: [
      { task: 'b06', sev: 'critical', title: 'Недостаточный защитный слой в перекрытии 14 этажа', desc: 'Фиксаторы защитного слоя установлены с шагом 1,5 м вместо 0,8 м, арматура лежит на опалубке.', loc: 'Корпус 1, 14 этаж, оси 3–8', norm: 'СП 70.13330, проект КЖ', date: -9, due: -2, status: 'work' },
      { task: 'b07', sev: 'major', title: 'Отклонение стен от вертикали', desc: 'Отклонение стен лестничной клетки 15 этажа до 18 мм при допуске 8 мм.', loc: 'Корпус 2, 15 этаж, ЛК-1', norm: 'СП 70.13330', date: -6, due: 2, status: 'presented' },
      { task: 'b06', sev: 'major', title: 'Нет защитных ограждений по контуру перекрытия', desc: 'По контуру перекрытия 13 этажа отсутствуют временные ограждения на участке 18 м.', loc: 'Корпус 1, 13 этаж', norm: 'требования охраны труда', date: -11, due: -8, status: 'closed', closed: -8 },
      { task: 'b10', sev: 'minor', title: 'Незаполненные вертикальные швы кладки', desc: 'Вертикальные швы кладки заполнены не полностью на площади около 30 м².', loc: 'Корпус 2, 6 этаж, секция 2', norm: 'СП 70.13330', date: -4, due: 3, status: 'assigned' },
      { task: 'b08', sev: 'major', title: 'Раковины на поверхности колонн', desc: 'Раковины глубиной до 20 мм на колоннах 9 этажа после распалубки.', loc: 'Корпус 3, 9 этаж, колонны К-12…К-15', norm: 'СП 70.13330', date: -14, due: -7, status: 'work' },
      { task: 'b07', sev: 'minor', title: 'Не установлены закладные под ограждения балконов', desc: 'Закладные детали под ограждения балконов 12 этажа отсутствуют.', loc: 'Корпус 2, 12 этаж', norm: 'проект КЖ', date: -30, due: -23, status: 'closed', closed: -24 },
      { task: 'b04', sev: 'major', title: 'Протечки по деформационному шву паркинга', desc: 'После дождя выявлены протечки по деформационному шву в осях 5–6.', loc: 'Паркинг, уровень −1', norm: 'проект КЖ', date: -45, due: -30, status: 'closed', closed: -31 }
    ],
    guarantees: [{ contract: 'bc4', days: 10, letter: 'ВМ-ИСХ-1488' }, { contract: 'bc5', days: -2, letter: 'КСК-ИСХ-0233', overdue: true }]
  },
  vostok: {
    days: 20, lagDirector: 0, retDay: 3, ret: { org: 'ООО «ПанельСтрой»', note: 'Площадь панелей указана с проёмами ворот — пересчитать за вычетом проёмов' },
    late: { v09: 12 },   // монтаж ворот идёт по мере поставок: отчёты — за последние 12 дней
    qty: { v07: [48000, 'м²', 10], v08: [36500, 'м²', 10], v09: [92, 'шт.', 1], v10: [42000, 'м²', 10], v11: [31000, 'м²', 10] },
    crew: { v07: [26, 4], v08: [32, 5], v09: [8, 2], v10: [20, 4], v11: [12, 3], v12: [46, 6], v13: [22, 4], v14: [18, 4] },
    id: { v12: [['АОСР', 'АОСР-ЭМ-11', 'Прокладка кабельных лотков корпуса А', '2026-09-15', 'ok'], ['АОСР', 'АОСР-ОВ-08', 'Монтаж воздуховодов приточной системы П1', '2026-09-29', 'rev']], v14: [['АОСР', 'АОСР-НВК-05', 'Прокладка наружного водопровода, участок 1', '2026-09-22', 'ok']], v09: [['АОСР', 'АОСР-ВР-01', 'Монтаж закладных под секционные ворота, ряд 1', '2026-09-30', 'ok']] },
    remarks: [
      { task: 'v08', sev: 'major', title: 'Негерметичные стыки сэндвич-панелей', desc: 'Не установлены уплотнители в вертикальных стыках панелей по оси 1.', loc: 'Корпус Б, ось 1, ряды А–Д', norm: 'проект АР, инструкция изготовителя', date: -8, due: -1, status: 'work' },
      { task: 'v07', sev: 'critical', title: 'Разрывы ПВХ-мембраны у воронок водостока', desc: 'Повреждения мембраны у трёх воронок, риск протечек при осадках.', loc: 'Корпус А, кровля, воронки В-4, В-7, В-9', norm: 'СП 17.13330', date: -4, due: 1, status: 'assigned' },
      { task: 'v10', sev: 'minor', title: 'Трещины усадки на захватке 6', desc: 'Сетка усадочных трещин на захватке 6 промышленного пола.', loc: 'Корпус А, захватка 6', norm: 'СП 29.13330', date: -16, due: -9, status: 'closed', closed: -9 },
      { task: 'v12', sev: 'major', title: 'Кабельные линии без маркировки', desc: 'Кабельные линии в лотках корпуса А не промаркированы.', loc: 'Корпус А, ряды 3–8', norm: 'ПУЭ', date: -10, due: -3, status: 'presented' },
      { task: 'v13', sev: 'minor', title: 'Спринклеры без защитных колпачков', desc: 'Оросители смонтированы без защитных колпачков до окончания отделочных работ.', loc: 'АБК, 2 этаж', norm: 'проект АПТ', date: -2, due: 5, status: 'new' },
      { task: 'v05', sev: 'major', title: 'Не обработаны огнезащитой узлы каркаса', desc: 'Узлы сопряжения ригелей с колоннами по оси 12 не обработаны огнезащитным составом.', loc: 'Корпус Б, ось 12', norm: 'проект КМ', date: -38, due: -28, status: 'closed', closed: -29 }
    ],
    guarantees: [{ contract: 'vc6', days: 9, letter: 'ПС-ИСХ-0907' }]
  },
  briz: {
    days: 20, lagDirector: 0, retDay: 5, ret: { org: 'ООО «Интерьер Групп»', note: 'Номера 4 этажа включены в объём до приёмки чистовой отделки' },
    qty: { h07: [14800, 'м²', 10], h16: [3200, 'м', 1], h13: [21500, 'м²', 10], h17: [18600, 'м²', 10] },
    crew: { h07: [34, 5], h09: [52, 7], h10: [24, 4], h11: [10, 2], h16: [16, 4], h13: [70, 10], h14: [28, 6], h17: [12, 4] },
    id: { h09: [['АОСР', 'АОСР-ВК-22', 'Прокладка трубопроводов ВК, 5–7 этажи', '2026-09-20', 'ok'], ['АОСР', 'АОСР-ОВ-29', 'Монтаж фанкойлов номерного фонда, 8 этаж', '2026-10-02', 'rev']], h16: [['АОСР', 'АОСР-НС-07', 'Прокладка наружной канализации К1', '2026-09-10', 'ok']], h14: [['АОСР', 'АОСР-ОЗ-03', 'Устройство перегородок лобби', '2026-09-24', 'ok']] },
    remarks: [
      { task: 'h13', sev: 'major', title: 'Отслоение керамической плитки в санузлах', desc: 'Глухой звук при простукивании плитки пола в 6 санузлах 5 этажа.', loc: '5 этаж, номера 512–517', norm: 'СП 71.13330', date: -7, due: 0, status: 'work' },
      { task: 'h07', sev: 'critical', title: 'Протечка витража при испытании', desc: 'При испытании на водонепроницаемость выявлена протечка по импосту витража.', loc: 'Фасад 1, оси 4–5, 2 этаж', norm: 'проект АР', date: -10, due: -3, status: 'work' },
      { task: 'h09', sev: 'minor', title: 'Не изолированы трубопроводы холодоснабжения', desc: 'Участки трубопроводов холодоснабжения в коридоре 7 этажа без теплоизоляции.', loc: '7 этаж, коридор', norm: 'проект ОВ', date: -5, due: 2, status: 'presented' },
      { task: 'h14', sev: 'minor', title: 'Сколы облицовки колонн лобби', desc: 'Сколы на кромках облицовки двух колонн.', loc: 'Лобби, колонны К-3, К-4', norm: 'проект АИ', date: -3, due: 7, status: 'assigned' },
      { task: 'h11', sev: 'major', title: 'Не смонтировано ограждение приямка лифта', desc: 'Отсутствует ограждение приямка лифта Л-4.', loc: 'Лифт Л-4, приямок', norm: 'требования охраны труда', date: -19, due: -16, status: 'closed', closed: -16 },
      { task: 'h05', sev: 'major', title: 'Трещина в парапете кровли', desc: 'Волосяная трещина в монолитном парапете по оси 9.', loc: 'Кровля, ось 9', norm: 'проект КЖ', date: -60, due: -45, status: 'closed', closed: -47 }
    ],
    guarantees: [{ contract: 'hc6', days: 4, letter: 'ИК-ИСХ-1120' }]
  },
  ladoga: {
    days: 20, lagDirector: 1, retDay: 2, ret: { org: 'ООО «ГринЛайн»', note: 'Площадь газона указана с учётом участка, где не завершена планировка' },
    qty: { l12: [9800, 'м²', 10], l13: [26400, 'м²', 10], l14: [12500, 'м²', 10] },
    crew: { l12: [42, 6], l13: [36, 6], l14: [24, 5], l15: [14, 3] },
    id: { l12: [['АОСР', 'АОСР-МОП-17', 'Устройство потолков МОП 1–4 этажей', '2026-09-25', 'ok'], ['АОСР', 'АОСР-МОП-21', 'Облицовка санузлов 5–8 этажей', '2026-10-01', 'rev']], l13: [['АОСР', 'АОСР-ОФ-09', 'Стяжка пола офисных этажей 2–6', '2026-09-12', 'ok']], l15: [['ПИ', 'ПИ-ВЕНТ-02', 'Протоколы аэродинамических испытаний систем вентиляции', '2026-09-30', 'ok']] },
    remarks: [
      { task: 'l12', sev: 'major', title: 'Перепады между листами потолка', desc: 'Перепады между листами ГКЛ потолка лифтового холла до 3 мм.', loc: '6 этаж, лифтовой холл', norm: 'СП 71.13330', date: -6, due: -1, status: 'work' },
      { task: 'l14', sev: 'minor', title: 'Неровности мощения у входной группы', desc: 'Просадки плитки мощения у входа до 8 мм.', loc: 'Главный вход', norm: 'СП 82.13330', date: -4, due: 3, status: 'presented' },
      { task: 'l15', sev: 'critical', title: 'Не срабатывает автоматика дымоудаления', desc: 'При комплексном опробовании не открылись клапаны дымоудаления на 3 этаже.', loc: '3 этаж, клапаны КДУ-3.1, КДУ-3.2', norm: 'СП 7.13130', date: -3, due: 2, status: 'assigned' },
      { task: 'l13', sev: 'minor', title: 'Загрязнение витражей после шпаклёвки', desc: 'Остатки шпаклёвки на остеклении офисных этажей.', loc: '4 этаж', norm: '—', date: -9, due: -5, status: 'closed', closed: -5 },
      { task: 'l12', sev: 'major', title: 'Уклон пола санузла в сторону от трапа', desc: 'Вода не стекает к трапу в санузле 2 этажа.', loc: '2 этаж, санузел С-2.1', norm: 'СП 29.13330', date: -15, due: -9, status: 'closed', closed: -10 },
      { task: 'l11', sev: 'minor', title: 'Не закреплены решётки вентиляции', desc: 'Вентиляционные решётки на 7 этаже держатся без крепежа.', loc: '7 этаж', norm: 'проект ОВ', date: -25, due: -20, status: 'closed', closed: -21 }
    ],
    guarantees: [{ contract: 'lc8', days: -3, letter: 'ОП-ИСХ-0711', overdue: true }]
  }
};

const fmtNum = v => Math.round(v * 100) / 100;

for (const P of DSF.projects) {
  const cfg = CFG[P.id]; if (!cfg) continue;
  const R = rng(hash(P.id));
  const M = DSF.build(P);
  const T = M.T;
  const C = id => M.contracts.find(c => c.id === id);
  const out = { taskPatch: {}, reports: [], remarks: [], documents: [], letters: [] };

  /* 1. Ежедневные отчёты */
  const active = M.tasks.filter(t => !t.ms && t.weighted && t.pct > 0 && t.pct < 100 && t.as != null);
  const days = []; for (let d = T - cfg.days; d <= T; d++) { if (new Date(d * 86400000).getUTCDay() !== 0) days.push(d); }
  // статус отчёта за день d: подтверждён / ждёт директора / ждёт ТЗ
  const stOf = d => d === T ? [] : d >= T - 2 - cfg.lagDirector ? ['tz'] : ['tz', 'director'];
  const retDay = days[days.length - 1 - cfg.retDay];
  const plan = {};
  active.forEach(t => {
    const left0 = 100 - t.pct;
    // темп (п.п. в календарный день), при котором прогноз по темпу совпадает с прогнозом графика;
    // для недавно начатых работ — не больше 85% их готовности за время журнала
    const horizon = Math.max(4, t.ef - T);
    let rate = left0 / horizon * (0.97 + R() * 0.06);
    t.jfrom = Math.max(t.as, T - ((cfg.late || {})[t.id] || cfg.days));
    const cal = T - t.jfrom + 1;
    rate = Math.min(rate, t.pct * 0.85 / cal);
    plan[t.id] = { rate, q: cfg.qty[t.id] };
  });
  const orgs = [...new Set(active.map(t => t.contractor))];
  let n = 0;
  // проход 1: сырые объёмы (п.п.) по дням
  days.forEach(d => orgs.forEach(org => {
    const ts = active.filter(t => t.contractor === org);
    const lines = [], crewTot = [];
    ts.forEach(t => {
      if (d < t.jfrom || R() < 0.08) return;                     // работа ещё не начата или день без выработки
      lines.push([t.id, 0.7 + R() * 0.6]);
      const cr = cfg.crew[t.id] || [15, 4]; crewTot.push(Math.round(cr[0] + (R() - 0.5) * 2 * cr[1]));
    });
    if (!lines.length) return;
    n++;
    const r = { id: P.id + '-r' + n, date: iso(d), org, lines, crew: crewTot.reduce((a, b) => a + b, 0), ok: stOf(d) };
    if (d === retDay && org === cfg.ret.org) { r.ok = []; r.ret = cfg.ret.note; }
    if (R() < 0.12) r.note = ['Работа в две смены', 'Простой 2 ч из-за ливня', 'Поставка материала после обеда', 'Ожидание бетона 1,5 ч', 'Работа крана ограничена ветром'][Math.floor(R() * 5)];
    r._d = d;
    out.reports.push(r);
  }));
  // проход 2: калибровка — подтверждённый объём за 14 дней даёт ровно заданный темп; округление до шага единицы
  const confirmed = {};
  active.forEach(t => {
    const p = plan[t.id];
    const inWin = [], all = [];
    out.reports.forEach(r => r.lines.forEach(l => { if (l[0] !== t.id) return; all.push(l); if (r.ok.length === 2 && r._d > T - 14) inWin.push(l); }));
    const raw = inWin.reduce((a, l) => a + l[1], 0);
    const k = raw ? p.rate * 14 / raw : 0;
    all.forEach(l => {
      let v = l[1] * k;
      if (p.q) { const [qty, , step] = p.q; v = Math.max(step, Math.round(v * qty / 100 / step) * step); } else v = Math.max(0.01, fmtNum(v));
      l[1] = v;
    });
  });
  out.reports.forEach(r => { if (r.ok.length === 2) r.lines.forEach(([id, v]) => { confirmed[id] = (confirmed[id] || 0) + v; }); delete r._d; });
  // факт на начало журнала: так, чтобы подтверждённый итог совпал с исходной готовностью
  active.forEach(t => {
    const p = plan[t.id], c = confirmed[t.id] || 0;
    if (p.q) {
      const [qty, unit] = p.q;
      out.taskPatch[t.id] = { qty, unit, qtyFact: Math.max(0, Math.round(qty * t.pct / 100 - c)) };
    } else out.taskPatch[t.id] = { pct: Math.max(0, fmtNum(t.pct - c)) };
  });

  /* 2. Исполнительная документация */
  const addDoc = (task, sec, code, title, date, st) => out.documents.push(['id', sec, code, title, task, ['1|' + date + '|' + st], { org: M.byId.get(task).contractor }]);
  M.tasks.filter(t => !t.ms && t.weighted && t.pct >= 100 && t.idState !== 'ok').forEach((t, i) => {
    const d = Math.min(T - 3, (t.af || t.ef) + 12);
    addDoc(t.id, 'АПР', 'ИД-' + P.code + '-' + String(i + 1).padStart(2, '0'), 'Комплект исполнительной документации: ' + t.name, iso(d), 'ok');
  });
  Object.entries(cfg.id).forEach(([task, list]) => list.forEach(([sec, code, title, date, st]) => addDoc(task, sec, code, title, date, st)));

  /* 3. Замечания стройконтроля */
  cfg.remarks.forEach((r, i) => {
    const x = { id: P.id + '-rm' + (i + 1), no: P.code + '-' + String(i + 1).padStart(3, '0'), task: r.task, sev: r.sev, title: r.title, desc: r.desc, loc: r.loc, norm: r.norm,
      date: iso(T + r.date), due: iso(T + r.due), status: r.status, by: P.supervisor };
    if (r.closed != null) x.closed = iso(T + r.closed);
    out.remarks.push(x);
  });

  /* 4. Гарантийные письма по ИД к текущим КС-2 */
  cfg.guarantees.forEach((g, i) => {
    const c = C(g.contract); if (!c) { console.warn(P.id, 'нет договора', g.contract); return; }
    const k = c.pendingKs[c.pendingKs.length - 1] || c.ks[c.ks.length - 1];
    if (!k) { console.warn(P.id, 'нет КС-2 по', g.contract); return; }
    const sent = k.history.length ? k.history[0].d : k.d;
    const tasks = [...new Set(k.lines.map(l => l.task.id))].filter(id => M.byId.get(id).weighted);
    out.letters.push({ id: P.id + '-gl' + (i + 1), dir: 'in', kind: 'guarantee', no: g.letter, date: iso(sent), from: c.contractor, to: P.customer,
      subject: 'Гарантийное письмо о передаче исполнительной документации к ' + k.no + ' по договору ' + c.no, status: 'Зарегистрировано',
      dueDate: iso(T + g.days), ks: k.id, tasks });
    // выполненное письмо: ИД по работам заявки принята
    if (g.fulfill) tasks.forEach(id => out.documents.push(['id', 'АПР', 'ИД-' + P.code + '-ГП-' + id, 'Исполнительная документация по гарантийному письму ' + g.letter + ': ' + M.byId.get(id).name, id, ['1|' + iso(T - 2) + '|ok'], { org: c.contractor }]));
  });

  const js = '/* ' + P.name + ' — производственный контур демо: ежедневные отчёты, ИД, замечания стройконтроля, гарантийные письма.\n * Все данные вымышлены. Сформировано tools/gen-flow.js; корректируется в администрировании объекта. */\n' +
    'DSF.augment(' + JSON.stringify(P.id) + ', ' + JSON.stringify(out, null, 1).replace(/\n\s+(?=[\]\d"-])/g, ' ').replace(/\[\s+/g, '[') + ');\n';
  fs.mkdirSync(path.join(root, 'data/flow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'api/demo_data/src/flow', P.id + '.js'), js);
  console.log(P.id, 'reports', out.reports.length, 'docs', out.documents.length, 'remarks', out.remarks.length, 'letters', out.letters.length, 'active', active.map(t => t.id).join(','));
}
