/* DSFlow · стандартный Excel-файл обновления данных проекта.
   Один модуль описывает структуру файла (листы и колонки), собирает файл и читает его обратно.
   Используется в браузере (window.DSFUpdateXlsx) и в Node (tools/build-update-template.js),
   поэтому пустой шаблон и файл с данными проекта всегда совпадают по структуре.
   Структура универсальна: в ней нет перечня конкретных работ, этапов, вех или рисков —
   каждая строка таблицы описывает произвольную сущность конкретного проекта. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DSFUpdateXlsx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 'DSFlow · обновление данных · v1';
  const LISTS = {
    period: ['День', 'Неделя', 'Месяц', 'Произвольный'],
    projectStatus: ['В графике', 'Опережение', 'Отставание', 'Критическое отставание'],
    workStatus: ['Не начата', 'В работе', 'Приостановлена', 'Завершена', 'Скрыта', 'В архиве'],
    msStatus: ['По расчёту', 'Выполнена', 'Отменена'],
    yesno: ['Да', 'Нет'],
    prob: ['Низкая', 'Средняя', 'Высокая'],
    impact: ['Низкое', 'Среднее', 'Высокое'],
    riskStatus: ['Открыт', 'В работе', 'Закрыт'],
    eventStatus: ['На контроле', 'Решено', 'Информация'],
    contractStatus: ['Действует', 'Завершён', 'Приостановлен', 'Расторгнут'],
    units: ['шт.', 'м', 'п.м.', 'м²', 'м³', 'т', 'кг', '%', 'дн.', 'компл.']
  };
  const PERIOD_CODE = { 'День': 'day', 'Неделя': 'week', 'Месяц': 'month', 'Произвольный': 'custom' };
  const PERIOD_NAME = { day: 'День', week: 'Неделя', month: 'Месяц', custom: 'Произвольный' };

  /* type: text | long | num | pct | money | date | list. calc — расчёт Flow (при загрузке не читается).
     soft — список-подсказка, допускается своё значение (единицы измерения). */
  const SHEETS = [
    { key: 'passport', title: 'Паспорт обновления', kind: 'kv', rows: [
      { k: 'project', h: 'Код проекта', req: true, hint: 'Код проекта во Flow, например ogni или ramenki. Указан в шаблоне, выгруженном из проекта.' },
      { k: 'projectName', h: 'Проект', hint: 'Название объекта — для проверки.' },
      { k: 'periodType', h: 'Тип периода', type: 'list', list: 'period', req: true, hint: 'День, неделя, месяц или произвольный период. Базовый сценарий — неделя.' },
      { k: 'from', h: 'Период с', type: 'date', req: true },
      { k: 'to', h: 'Период по', type: 'date', req: true },
      { k: 'asOf', h: 'Дата актуальности', type: 'date', hint: 'На какую дату верны данные. Пусто — окончание периода.' },
      { k: 'responsible', h: 'Ответственный', hint: 'Кто подготовил данные.' },
      { k: 'comment', h: 'Общий комментарий', type: 'long' },
      { k: 'version', h: 'Версия шаблона', calc: true }
    ] },
    { key: 'readiness', title: 'Готовность проекта', kind: 'kv', rows: [
      { k: 'calcPlan', h: 'Плановая готовность по расчёту DSFlow, %', type: 'pct', calc: true },
      { k: 'calcFact', h: 'Фактическая готовность по расчёту DSFlow, %', type: 'pct', calc: true },
      { k: 'plan', h: 'Плановая готовность, %', type: 'pct', hint: 'По данным ответственного. Flow сохранит значение и покажет рядом со своим расчётом.' },
      { k: 'fact', h: 'Фактическая готовность, %', type: 'pct' },
      { k: 'dev', h: 'Отклонение, п.п.', type: 'num', calc: true },
      { k: 'status', h: 'Статус', type: 'list', list: 'projectStatus' },
      { k: 'comment', h: 'Комментарий', type: 'long' }
    ] },
    { key: 'works', title: 'Работы', kind: 'table', idPrefix: 'работы', cols: [
      { k: 'id', h: 'ID DSFlow', w: 12, hint: 'Заполняет Flow. Для новой работы оставьте пустым.' },
      { k: 'name', h: 'Наименование работы', w: 46, req: true },
      { k: 'cat', h: 'Категория / этап', w: 32, hint: 'Этап или раздел проекта. Для новой работы — название существующего этапа или нового.' },
      { k: 'catId', h: 'ID этапа', w: 11, hint: 'Заполняет Flow. Однозначно указывает этап.' },
      { k: 'uom', h: 'Ед. изм.', w: 9, type: 'list', list: 'units', soft: true },
      { k: 'qTotal', h: 'Общий объём', w: 12, type: 'num' },
      { k: 'qPlan', h: 'Плановый объём на дату', w: 13, type: 'num' },
      { k: 'qPeriod', h: 'Факт за период', w: 12, type: 'num', hint: 'Прирост за отчётный период. Прибавляется к накопленному факту.' },
      { k: 'qCum', h: 'Накопленный факт', w: 12, type: 'num', hint: 'С начала работы. Если указан вместе с общим объёмом, % выполнения Flow рассчитает сам.' },
      { k: 'pc', h: '% выполнения', w: 11, type: 'pct', hint: 'Указывайте, если объёмов нет.' },
      { k: 's', h: 'Дата начала', w: 12, type: 'date' },
      { k: 'f', h: 'Плановая дата окончания', w: 13, type: 'date' },
      { k: 'fc', h: 'Факт. / прогнозная дата окончания', w: 14, type: 'date', hint: 'Для завершённой работы — фактическая дата, для остальных — прогноз ответственного.' },
      { k: 'status', h: 'Статус', w: 14, type: 'list', list: 'workStatus' },
      { k: 'dev', h: 'Отклонение, п.п. (расчёт)', w: 12, type: 'num', calc: true },
      { k: 'comment', h: 'Комментарий', w: 40 }
    ] },
    { key: 'milestones', title: 'Вехи', kind: 'table', cols: [
      { k: 'id', h: 'ID DSFlow', w: 12, hint: 'Заполняет Flow. Для новой вехи оставьте пустым.' },
      { k: 'name', h: 'Название вехи', w: 44, req: true },
      { k: 'cat', h: 'Категория', w: 20 },
      { k: 'plan', h: 'Плановая дата', w: 13, type: 'date', hint: 'Пусто — по связанной работе графика.' },
      { k: 'fact', h: 'Фактическая дата', w: 13, type: 'date' },
      { k: 'status', h: 'Статус', w: 13, type: 'list', list: 'msStatus' },
      { k: 'key', h: 'Ключевая', w: 10, type: 'list', list: 'yesno' },
      { k: 'ref', h: 'ID связанной работы', w: 14, hint: 'ID DSFlow работы с листа «Работы». Необязательно.' },
      { k: 'daysTo', h: 'Дней до наступления (расчёт)', w: 13, type: 'num', calc: true },
      { k: 'overdue', h: 'Дней просрочки (расчёт)', w: 13, type: 'num', calc: true },
      { k: 'comment', h: 'Комментарий', w: 36 }
    ] },
    { key: 'budget', title: 'Бюджет', kind: 'kv', rows: [
      { k: 'total', h: 'Общий бюджет, ₽', type: 'money' },
      { k: 'approved', h: 'Утверждённый бюджет, ₽', type: 'money' },
      { k: 'contracted', h: 'Законтрактовано, ₽', type: 'money', hint: 'Пусто — Flow рассчитает по реестру договоров.' },
      { k: 'paid', h: 'Оплачено, ₽', type: 'money', hint: 'Пусто — по договорам.' },
      { k: 'spent', h: 'Освоено, ₽', type: 'money', hint: 'Пусто — по актам КС-2.' },
      { k: 'forecast', h: 'Прогноз, ₽', type: 'money' },
      { k: 'dev', h: 'Отклонение прогноза, ₽', type: 'money', calc: true },
      { k: 'comment', h: 'Комментарий', type: 'long' }
    ] },
    { key: 'contracts', title: 'Договоры', kind: 'table', cols: [
      { k: 'id', h: 'ID DSFlow', w: 12, hint: 'Заполняет Flow. Для нового договора оставьте пустым.' },
      { k: 'counterparty', h: 'Контрагент', w: 30, req: true },
      { k: 'subject', h: 'Предмет', w: 40 },
      { k: 'number', h: 'Номер', w: 16 },
      { k: 'cat', h: 'Категория', w: 18 },
      { k: 'amount', h: 'Сумма, ₽', w: 16, type: 'money' },
      { k: 'date', h: 'Дата', w: 12, type: 'date' },
      { k: 'end', h: 'Срок (окончание)', w: 13, type: 'date' },
      { k: 'paid', h: 'Оплачено, ₽', w: 16, type: 'money' },
      { k: 'spent', h: 'Освоено, ₽', w: 16, type: 'money' },
      { k: 'rest', h: 'Остаток, ₽ (расчёт)', w: 16, type: 'money', calc: true },
      { k: 'status', h: 'Статус', w: 14, type: 'list', list: 'contractStatus' },
      { k: 'comment', h: 'Комментарий', w: 32 }
    ] },
    { key: 'risks', title: 'Риски', kind: 'table', cols: [
      { k: 'id', h: 'ID DSFlow', w: 11, hint: 'Заполняет Flow. Для нового риска оставьте пустым.' },
      { k: 'name', h: 'Название', w: 36, req: true },
      { k: 'cat', h: 'Категория', w: 16 },
      { k: 'desc', h: 'Описание', w: 40 },
      { k: 'prob', h: 'Вероятность', w: 12, type: 'list', list: 'prob' },
      { k: 'impact', h: 'Влияние', w: 12, type: 'list', list: 'impact' },
      { k: 'status', h: 'Статус', w: 12, type: 'list', list: 'riskStatus' },
      { k: 'owner', h: 'Ответственный', w: 20 },
      { k: 'action', h: 'Мероприятие', w: 36 },
      { k: 'due', h: 'Срок', w: 12, type: 'date' },
      { k: 'comment', h: 'Комментарий', w: 30 }
    ] },
    { key: 'events', title: 'События', kind: 'table', cols: [
      { k: 'id', h: 'ID DSFlow', w: 11, hint: 'Заполняет Flow. Для нового события оставьте пустым.' },
      { k: 'date', h: 'Дата', w: 12, type: 'date', req: true },
      { k: 'cat', h: 'Категория', w: 16 },
      { k: 'name', h: 'Событие', w: 40, req: true },
      { k: 'desc', h: 'Описание', w: 46 },
      { k: 'impact', h: 'Влияние', w: 12, type: 'list', list: 'impact' },
      { k: 'status', h: 'Статус', w: 14, type: 'list', list: 'eventStatus' }
    ] },
    { key: 'photos', title: 'Фото', kind: 'table', cols: [
      { k: 'id', h: 'ID DSFlow', w: 11, calc: true },
      { k: 'date', h: 'Дата', w: 12, type: 'date', req: true },
      { k: 'stage', h: 'Этап', w: 24 },
      { k: 'zone', h: 'Зона', w: 24 },
      { k: 'work', h: 'ID связанной работы', w: 14, hint: 'Необязательно: фото не обязательно связано с работой.' },
      { k: 'desc', h: 'Описание', w: 40 },
      { k: 'file', h: 'Имя файла', w: 28, req: true, hint: 'Имя файла фото. Сами файлы прикладываются при загрузке во Flow.' }
    ] },
    { key: 'summary', title: 'Итог периода', kind: 'kv', rows: [
      { k: 'happened', h: 'Что произошло за период', type: 'long' },
      { k: 'done', h: 'Что выполнено', type: 'long' },
      { k: 'deviations', h: 'Основные отклонения', type: 'long' },
      { k: 'causes', h: 'Причины', type: 'long' },
      { k: 'measures', h: 'Принятые меры', type: 'long' },
      { k: 'forecast', h: 'Прогноз', type: 'long' },
      { k: 'changes', h: 'Основные изменения проекта', type: 'long' },
      { k: 'questions', h: 'Вопросы, требующие внимания руководителя', type: 'long' }
    ] }
  ];
  const SHEET = Object.fromEntries(SHEETS.map(s => [s.key, s]));

  const INSTRUCTION = [
    ['Flow — цифровой штаб строительства', 'title'],
    ['Стандартный файл периодического обновления данных проекта', 'sub'],
    ['', ''],
    ['Как заполнить', 'h'],
    ['1. «Паспорт обновления»: код проекта, тип и границы отчётного периода, дату актуальности и ответственного.', ''],
    ['2. «Работы»: одна строка — одна работа проекта. Строк может быть сколько угодно, состав работ у каждого проекта свой.', ''],
    ['   Изменяйте значения в существующих строках. Новую работу добавьте строкой внизу с пустым «ID DSFlow».', ''],
    ['   Завершить работу — статус «Завершена» и фактическая дата окончания. Убрать из графика — «Скрыта» или «В архиве»; вернуть — «В работе» или «Не начата».', ''],
    ['3. Вехи, договоры, риски и события заполняются так же: строка — сущность, новая — с пустым ID.', ''],
    ['4. «Бюджет», «Готовность проекта» и «Итог периода» — значения в столбце «Значение».', ''],
    ['5. «Фото»: строка на каждый снимок с точным именем файла. Файлы фото прикладываются при загрузке во Flow.', ''],
    ['', ''],
    ['Правила', 'h'],
    ['• Пустая ячейка — значение не меняется. Чтобы очистить значение, поставьте «-».', ''],
    ['• Серые столбцы и строки — расчёт Flow. Их можно не заполнять: при загрузке они не читаются.', ''],
    ['• Даты — в формате ДД.ММ.ГГГГ. Суммы — в рублях. Проценты — числом от 0 до 100.', ''],
    ['• Не меняйте названия листов и заголовки столбцов. Порядок столбцов можно менять.', ''],
    ['• Строки без «ID DSFlow» Flow сопоставит с существующими по точному совпадению названия. Если совпадений несколько или название не найдено, DSFlow покажет это при проверке и ничего не применит без вашего решения.', ''],
    ['', ''],
    ['Что происходит при загрузке', 'h'],
    ['Flow определяет проект и период, читает все листы, сопоставляет строки с данными проекта и показывает экран «Было → Стало»:', ''],
    ['«Новая сущность», «Изменено», «Изменён статус», «Не удалось однозначно сопоставить». Изменения применяются только после подтверждения.', ''],
    ['Каждое обновление сохраняется в истории проекта вместе с исходным файлом, старыми и новыми значениями. Прошлые данные не перезаписываются.', '']
  ];

  /* ---------- значения ---------- */
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  function parseDate(v){
    if (v instanceof Date) return isNaN(v) ? undefined : isoOf(v);
    if (typeof v === 'number' && v > 20000 && v < 80000) return isoOf(new Date(Math.round((v - 25569) * 864e5)));
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return valid(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2})$/);
    if (m) return valid(2000 + +m[3], +m[2], +m[1]);
    return undefined;
    function valid(y, mo, d){ const x = new Date(Date.UTC(y, mo - 1, d)); return x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? isoOf(x) : undefined; }
  }
  function parseNum(v){
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    const s = String(v).replace(/[\s  ]/g, '').replace(/₽|руб\.?|%/gi, '').replace(',', '.');
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return undefined;
    return Number(s);
  }
  const CLEAR = new Set(['-', '—', '–']);
  /* Нормализация введённого значения: undefined — «не менять», null — «очистить».
     mode 'file': пустая ячейка = не менять; mode 'form': пустое поле = очистить. */
  function normValue(col, raw, mode, pctCell){
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return mode === 'form' ? { v: null } : { v: undefined };
    if (typeof raw === 'string' && CLEAR.has(raw.trim())) return { v: null };
    const t = col.type || 'text';
    if (t === 'date'){ const d = parseDate(raw); return d ? { v: d } : { err: 'не распознана дата «' + String(raw) + '» (нужно ДД.ММ.ГГГГ)' }; }
    if (t === 'num' || t === 'money' || t === 'pct'){
      let n = parseNum(raw); if (n === undefined) return { err: 'нужно число, указано «' + String(raw) + '»' };
      if (t === 'pct' && pctCell && typeof raw === 'number') n = n * 100;
      if (t === 'pct' && (n < 0 || n > 100)) return { err: 'процент должен быть от 0 до 100' };
      if ((t === 'money' || t === 'num') && col.k !== 'dev' && n < 0) return { err: 'значение не может быть отрицательным' };
      return { v: Math.round(n * 1e6) / 1e6 };
    }
    if (t === 'list'){
      const s = String(raw).trim(), L = LISTS[col.list] || [];
      const hit = L.find(x => x.toLowerCase() === s.toLowerCase());
      if (hit) return { v: hit };
      if (col.soft) return { v: s };
      return { err: '«' + s + '» нет в списке: ' + L.join(', ') };
    }
    return { v: String(raw).replace(/\r\n/g, '\n').trim() };
  }
  function cellRaw(cell){
    let v = cell.value;
    if (v && typeof v === 'object' && !(v instanceof Date)){
      if (Array.isArray(v.richText)) v = v.richText.map(x => x.text).join('');
      else if ('result' in v) v = v.result;
      else if ('text' in v) v = v.text;
      else if ('error' in v) v = null;
    }
    return v;
  }
  const normHead = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9%₽]+/g, ' ').trim();

  /* ---------- сборка файла ---------- */
  const C = { head: 'FF0B1F3A', headInk: 'FFFFFFFF', calc: 'FFEEF1F6', calcInk: 'FF5B6B82', line: 'FFD5DCE6', title: 'FF0B1F3A', accent: 'FF1F6FEB', req: 'FFFFF6E0' };
  const border = { top: { style: 'thin', color: { argb: C.line } }, left: { style: 'thin', color: { argb: C.line } }, bottom: { style: 'thin', color: { argb: C.line } }, right: { style: 'thin', color: { argb: C.line } } };
  function toCell(col, v){
    if (v == null || v === '') return null;
    const t = col.type || 'text';
    if (t === 'date'){ const d = parseDate(v); return d ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))) : String(v); }
    if (t === 'num' || t === 'money' || t === 'pct') return typeof v === 'number' ? v : (parseNum(v) ?? String(v));
    return String(v);
  }
  const fmtOf = col => col.type === 'date' ? 'dd.mm.yyyy' : col.type === 'money' ? '#,##0.00' : col.type === 'pct' ? '0.0' : col.type === 'num' ? '#,##0.###' : '@';

  /* data: { passport:{}, readiness:{}, budget:{}, summary:{}, works:[], milestones:[], contracts:[], risks:[], events:[], photos:[] } */
  function buildWorkbook(ExcelJS, data, opts){
    data = data || {}; opts = opts || {};
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Flow'; wb.created = new Date(); wb.title = 'Flow — обновление данных проекта';
    // Инструкция
    const ins = wb.addWorksheet('Инструкция', { properties: { tabColor: { argb: C.accent } }, views: [{ showGridLines: false }] });
    ins.getColumn(1).width = 110;
    INSTRUCTION.forEach(([t, k], i) => {
      const c = ins.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: 'top' };
      c.font = k === 'title' ? { bold: true, size: 18, color: { argb: C.title } } : k === 'sub' ? { size: 12, color: { argb: C.calcInk } } : k === 'h' ? { bold: true, size: 12, color: { argb: C.accent } } : { size: 11 };
    });
    if (opts.projectLine){ const r = INSTRUCTION.length + 2; ins.getCell(r, 1).value = opts.projectLine; ins.getCell(r, 1).font = { italic: true, color: { argb: C.calcInk } }; }
    // Справочники (скрытый лист) — источники выпадающих списков
    const ref = wb.addWorksheet('Справочники', { state: 'veryHidden' });
    const listAddr = {};
    Object.entries(LISTS).forEach(([k, arr], i) => {
      const col = i + 1; ref.getCell(1, col).value = k;
      arr.forEach((x, j) => { ref.getCell(j + 2, col).value = x; });
      const L = ref.getColumn(col).letter; listAddr[k] = "'Справочники'!$" + L + '$2:$' + L + '$' + (arr.length + 1);
    });
    const ROWS = Math.max(opts.minRows || 300, 0);
    SHEETS.forEach(sh => {
      const ws = wb.addWorksheet(sh.title, { views: [sh.kind === 'table' ? { state: 'frozen', ySplit: 1, xSplit: 2 } : { state: 'frozen', ySplit: 1 }] });
      if (sh.kind === 'kv'){
        ws.columns = [{ width: 48 }, { width: 46 }, { width: 70 }];
        ['Показатель', 'Значение', 'Пояснение'].forEach((h, i) => head(ws.getCell(1, i + 1), h));
        const src = data[sh.key] || {};
        sh.rows.forEach((r, i) => {
          const row = i + 2, a = ws.getCell(row, 1), b = ws.getCell(row, 2), c = ws.getCell(row, 3);
          a.value = r.h + (r.req ? ' *' : ''); a.font = { bold: !r.calc, color: { argb: r.calc ? C.calcInk : 'FF111827' } }; a.border = border; a.alignment = { vertical: 'top', wrapText: true };
          const v = r.k === 'version' ? VERSION : src[r.k];
          b.value = toCell(r, v); b.numFmt = fmtOf(r); b.border = border; b.alignment = { vertical: 'top', wrapText: true, horizontal: r.type === 'long' || !r.type ? 'left' : undefined };
          if (r.calc){ b.fill = fill(C.calc); b.font = { italic: true, color: { argb: C.calcInk } }; }
          else if (r.req) b.fill = fill(C.req);
          if (r.type === 'long') ws.getRow(row).height = 48;
          c.value = r.calc ? 'Расчёт Flow — при загрузке не читается.' + (r.hint ? ' ' + r.hint : '') : r.hint || ''; c.font = { size: 10, color: { argb: C.calcInk } }; c.alignment = { wrapText: true, vertical: 'top' };
          if (r.type === 'list' && listAddr[r.list]) ws.getCell(row, 2).dataValidation = { type: 'list', allowBlank: true, formulae: [listAddr[r.list]], showErrorMessage: !r.soft, errorTitle: 'Значение не из списка', error: 'Выберите значение из списка.' };
        });
      } else {
        ws.columns = sh.cols.map(c => ({ width: c.w || 14 }));
        sh.cols.forEach((c, i) => {
          const cell = ws.getCell(1, i + 1); head(cell, c.h + (c.req ? ' *' : ''), c.calc);
          if (c.hint || c.calc) cell.note = (c.calc ? 'Расчёт Flow — при загрузке не читается. ' : '') + (c.hint || '');
        });
        ws.getRow(1).height = 42;
        const rows = data[sh.key] || [];
        const n = Math.max(rows.length + (opts.spareRows ?? 200), ROWS);
        rows.forEach((r, j) => {
          sh.cols.forEach((c, i) => {
            const cell = ws.getCell(j + 2, i + 1);
            cell.value = toCell(c, r[c.k]);
          });
        });
        sh.cols.forEach((c, i) => {
          const colObj = ws.getColumn(i + 1);
          colObj.numFmt = fmtOf(c);
          if (c.calc) for (let j = 2; j <= rows.length + 1; j++){ const cell = ws.getCell(j, i + 1); cell.fill = fill(C.calc); cell.font = { italic: true, color: { argb: C.calcInk } }; }
          const L = colObj.letter;
          if (c.type === 'list' && listAddr[c.list]) ws.dataValidations.add(L + '2:' + L + (n + 1), { type: 'list', allowBlank: true, formulae: [listAddr[c.list]], showErrorMessage: !c.soft, errorStyle: c.soft ? 'information' : 'stop', errorTitle: 'Значение не из списка', error: 'Выберите значение из списка.' });
          if (c.type === 'date') ws.dataValidations.add(L + '2:' + L + (n + 1), { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorTitle: 'Дата', error: 'Введите дату в формате ДД.ММ.ГГГГ.' });
        });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sh.cols.length } };
      }
    });
    return wb;
    function fill(argb){ return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
    function head(cell, text, calc){
      cell.value = text; cell.font = { bold: true, color: { argb: calc ? C.calcInk : C.headInk } }; cell.fill = fill(calc ? C.calc : C.head);
      cell.alignment = { wrapText: true, vertical: 'middle' }; cell.border = border;
    }
  }

  /* ---------- чтение файла ----------
     Возвращает те же ключи, что buildWorkbook; значения нормализованы (undefined — не менять, null — очистить).
     errors — блокирующие ошибки (строка файла не применяется), warnings — замечания. */
  function parseWorkbook(wb){
    const out = { passport: {}, readiness: {}, budget: {}, summary: {}, works: [], milestones: [], contracts: [], risks: [], events: [], photos: [], errors: [], warnings: [], sheets: [] };
    const byName = new Map(); wb.eachSheet(ws => byName.set(normHead(ws.name), ws));
    SHEETS.forEach(sh => {
      const ws = byName.get(normHead(sh.title));
      if (!ws){ if (sh.key === 'passport') out.errors.push({ where: 'Файл', text: 'нет листа «' + sh.title + '». Используйте стандартный шаблон Flow.' }); else out.warnings.push({ where: 'Файл', text: 'нет листа «' + sh.title + '» — раздел не обновляется.' }); return; }
      out.sheets.push(sh.title);
      if (sh.kind === 'kv'){
        const map = new Map(sh.rows.map(r => [normHead(r.h), r]));
        ws.eachRow((row, rn) => {
          if (rn === 1) return;
          const label = normHead(String(cellRaw(row.getCell(1)) || '').replace(/\*\s*$/, ''));
          const r = map.get(label); if (!r || r.calc) return;
          const cell = row.getCell(2), res = normValue(r, cellRaw(cell), 'file', /%/.test(cell.numFmt || ''));
          if (res.err) out.errors.push({ where: sh.title + ' · ' + r.h, text: res.err, sheet: sh.key });
          else if (res.v !== undefined) out[sh.key][r.k] = res.v;
        });
      } else {
        const hdr = ws.getRow(1), colMap = [];
        const known = new Map(sh.cols.map(c => [normHead(c.h), c]));
        hdr.eachCell((cell, cn) => { const c = known.get(normHead(String(cellRaw(cell) || '').replace(/\*\s*$/, ''))); if (c) colMap.push([cn, c]); });
        if (!colMap.some(([, c]) => c.req)) { out.warnings.push({ where: sh.title, text: 'не найдены заголовки столбцов — лист пропущен.' }); return; }
        const seen = new Set();
        ws.eachRow((row, rn) => {
          if (rn === 1) return;
          const rec = { _row: rn }; let any = false; const errs = [];
          colMap.forEach(([cn, c]) => {
            if (c.calc && c.k !== 'id') return;
            const cell = row.getCell(cn), raw = cellRaw(cell);
            if (raw == null || String(raw).trim() === '') return;
            any = true;
            const res = normValue(c, raw, 'file', /%/.test(cell.numFmt || ''));
            if (res.err) errs.push(c.h + ': ' + res.err); else rec[c.k] = res.v;
          });
          if (!any) return;
          if (rec.id != null) rec.id = String(rec.id).trim();
          if (rec.id){ if (seen.has(rec.id)) errs.push('ID «' + rec.id + '» повторяется в файле'); seen.add(rec.id); }
          if (errs.length){ rec._errors = errs; }
          out[sh.key].push(rec);
        });
      }
    });
    const P = out.passport;
    if (P.periodType) P.period = PERIOD_CODE[P.periodType] || 'custom';
    return out;
  }

  return { VERSION, LISTS, SHEETS, SHEET, PERIOD_CODE, PERIOD_NAME, INSTRUCTION, buildWorkbook, parseWorkbook, normValue, parseDate, parseNum, normHead };
});
