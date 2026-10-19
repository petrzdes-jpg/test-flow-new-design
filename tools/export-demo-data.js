/*
 * Сборка демо-датасетов для API: api/demo_data/src/{projects,flow}/<id>.js → api/demo_data/<id>.json.
 * Запуск: node tools/export-demo-data.js
 *
 * Демо-данные отдаёт только сервер (GET /api/demo/projects/<id>) с учётом роли и назначений,
 * поэтому в public/ их нет. Источник для правки — файлы в api/demo_data/src.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
global.window = global;
['cpm', 'engine-fin', 'engine', 'engine-records', 'engine-flow', 'engine-changes', 'config'].forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, 'public/flow', f + '.js'), 'utf8')));
const man = require(path.join(root, 'api/demo_data/manifest.json'));
const src = path.join(root, 'api/demo_data/src');
man.projects.forEach(id => {
  const fl = path.join(src, 'flow', id + '.js');
  if (fs.existsSync(fl)) vm.runInThisContext(fs.readFileSync(fl, 'utf8'));
  vm.runInThisContext(fs.readFileSync(path.join(src, 'projects', id + '.js'), 'utf8'));
});
DSF.config.today = man.today;
let errors = 0;
const DSF_REGDOCS = fs.existsSync(path.join(__dirname, 'demo-docs.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-docs.json'), 'utf8')) : null;
DSF.projects.forEach(P => {
  const clean = JSON.parse(JSON.stringify(P, (k, v) => (k.startsWith('__') ? undefined : v)));
  if (!clean.estimates) clean.estimates = require('./demo-estimates').gen(clean);   // демо-сметы по договорам
  if (DSF_REGDOCS && DSF_REGDOCS[P.id]) clean.regdocs = DSF_REGDOCS[P.id];
  const M = DSF.build(P);
  const errs = M.issues.filter(i => i.level === 'error');
  errors += errs.length;
  errs.forEach(e => console.error(P.id, e.msg));
  fs.writeFileSync(path.join(root, 'api/demo_data', P.id + '.json'), JSON.stringify(clean));
  console.log(P.id.padEnd(10), 'работ', String(P.tasks.length).padStart(3), '· договоров', String(P.contracts.length).padStart(2), '· готовность', M.root.pc == null ? '—' : M.root.pc.toFixed(1) + '%', '· смет', clean.estimates.length, '· ошибок', errs.length);
});
process.exit(errors ? 1 : 0);
