/*
 * Демонстрационные сметы для договоров демо-объектов (только демо-режим).
 * Каждая смета помечена demo: true и «ДЕМО»; сумма сметы с НДС равна цене договора.
 * Позиции строятся из работ договора (работы + материалы); детерминированно — без случайных чисел.
 * Для реальных объектов сметы не создаются: там показывается «Смета не загружена».
 */
const MAT = {
  earth: [['Бетон B25 W8 для стены в грунте', 'м³'], ['Арматура А500С', 'т'], ['Анкеры грунтовые', 'шт']],
  found: [['Бетон B30 W8 F150', 'м³'], ['Арматура А500С Ø12–32', 'т'], ['Гидроизоляционная мембрана ПВХ', 'м²']],
  frame: [['Бетон B30 W6 F150', 'м³'], ['Арматура А500С Ø10–28', 'т'], ['Опалубка (аренда)', 'м²·мес']],
  roof: [['Утеплитель минераловатный', 'м³'], ['Мембрана ПВХ', 'м²']],
  facade: [['Фасадные кассеты', 'м²'], ['Светопрозрачные конструкции', 'м²']],
  mep: [['Трубы и фитинги', 'компл.'], ['Кабельная продукция', 'км'], ['Оборудование ИТП', 'компл.']],
  prep: [['Ограждение временное', 'п. м'], ['Щебень фракции 20–40', 'м³']],
  finish: [['Отделочные материалы', 'м²']],
  land: [['Плитка тротуарная', 'м²'], ['Посадочный материал', 'шт']]
};
const UNIT_QTY = { 'м³': 1, 'т': 0.11, 'шт': 0.6, 'м²': 2.2, 'м²·мес': 1.6, 'компл.': 0.02, 'км': 0.05, 'п. м': 0.8 };
const r2 = v => Math.round(v * 100) / 100;

function gen(P) {
  const out = [];
  (P.contracts || []).forEach((c, ci) => {
    if (/технический заказчик|строительный контроль/i.test(c.subject || '') || c.contractor === P.supervisor) return;
    const total = Math.round((+c.amount || 0) * 1e6 * 100) / 100;               // цена договора, ₽ с НДС
    if (!(total > 0)) return;
    const vatRate = c.vat != null ? c.vat : 0.2;
    const net = r2(total / (1 + vatRate));
    const tasks = (P.tasks || []).filter(t => t.contract === c.id && !t.ms);
    const service = c.item === 'pir' || /документац|проект/i.test(c.subject || '');
    const works = tasks.length ? tasks : [{ id: null, name: c.subject, qty: null, unit: null, cost: 1 }];
    const wsum = works.reduce((n, t) => n + (+t.cost || 1), 0);
    const sections = [];
    let acc = 0, pos = 0;
    const items = [];
    works.forEach((t, i) => {
      const share = (+t.cost || 1) / wsum;
      const part = net * share;
      const workPart = service ? part : part * 0.42;
      const qty = t.qty ? +t.qty : (service ? 1 : Math.max(1, Math.round(part / 85000)));
      const unit = t.unit || (service ? 'компл.' : 'м³');
      items.push({ id: c.id + '-p' + (++pos), code: 'ДЕМО-' + (ci + 1) + '.' + pos, name: (service ? '' : 'Выполнение работ: ') + t.name, unit, qty, price: r2(workPart / qty), kind: 'work', task: t.id, workType: c.item, section: 0 });
      acc += r2(workPart / qty) * qty;
      if (!service) {
        const mats = MAT[c.item] || [['Материалы по проекту', 'компл.']];
        const matPart = part - workPart;
        mats.forEach(([name, u], k) => {
          const mp = matPart / mats.length;
          const mq = Math.max(1, Math.round(qty * (UNIT_QTY[u] || 1)));
          items.push({ id: c.id + '-p' + (++pos), code: 'ДЕМО-' + (ci + 1) + '.' + pos, name, unit: u, qty: mq, price: r2(mp / mq), kind: 'material', task: t.id, workType: c.item, section: 1 });
          acc += r2(mp / mq) * mq;
        });
      }
    });
    // округление: остаток — в последнюю позицию работ, итог совпадает с ценой договора
    const diff = r2(net - acc);
    const lastWork = items.filter(x => x.kind === 'work').slice(-1)[0];
    lastWork.price = r2(lastWork.price + diff / lastWork.qty);
    sections.push({ name: 'Раздел 1. Строительно-монтажные работы', items: items.filter(x => x.section === 0) });
    if (!service) sections.push({ name: 'Раздел 2. Материалы и оборудование', items: items.filter(x => x.section === 1) });
    sections.forEach(s => s.items.forEach(x => { delete x.section; }));
    const status = c.demoDocs ? 'approved' : ci % 4 === 1 ? 'review' : ci % 7 === 3 ? 'remarks' : 'approved';
    out.push({ id: 'est-' + c.id, contract: c.id, no: 'ЛСР ДЕМО-' + (ci + 1), title: 'Локальный сметный расчёт (ДЕМО) — ' + c.subject, version: 1, status, vatRate, demo: true,
      date: c.date, author: c.contractor, sections, note: 'Демонстрационная смета. Не является сметной документацией.' });
  });
  return out;
}
module.exports = { gen };
