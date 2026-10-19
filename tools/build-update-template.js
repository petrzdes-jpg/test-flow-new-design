/* Пустой стандартный Excel-шаблон обновления данных DSFlow.
   Собирается тем же модулем, что и шаблон с данными проекта в браузере (public/assets/dsflow-update-xlsx.js).
   Запуск: npm i exceljs@4.4.0 && node tools/build-update-template.js */
const path = require('path');
const ExcelJS = require('exceljs');
const X = require('../public/assets/dsflow-update-xlsx.js');
(async () => {
  const wb = X.buildWorkbook(ExcelJS, { passport: { periodType: 'Неделя' } }, { minRows: 500, spareRows: 500, projectLine: 'Пустой шаблон. Шаблон с данными конкретного проекта выгружается в DSFlow: Администрирование → Обновление данных.' });
  const out = path.join(__dirname, '..', 'public', 'assets', 'templates', 'dsflow-update-template.xlsx');
  require('fs').mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);
  console.log('written', out);
})();
