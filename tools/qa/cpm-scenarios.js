/*
 * QA-сценарии расчёта сроков (CPM) и анализа влияния — запуск: node tools/qa/cpm-scenarios.js
 * Работает на демо-датасетах api/demo_data (отчётная дата 05.10.2026). Код возврата 1 при ошибке.
 */
global.window = global;
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../../public/flow/');
['cpm', 'engine-fin', 'store', 'engine', 'engine-records', 'engine-flow', 'engine-changes', 'config'].forEach(f => require(R + f + '.js'));
const DATA = path.join(__dirname, '../../api/demo_data/');
const load = id => { const P = JSON.parse(fs.readFileSync(DATA + id + '.json')); P.today = '2026-10-05'; DSF.register(P); return P; };
DSF.config.today = '2026-10-05';
const { iso } = DSF.util;
let fail = 0;
const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!cond) fail++; };
const K = load('kristall'), B = load('bereg');
const imp = (P, tid, days) => { const M = DSF.build(P), t = M.byId.get(tid); return DSF.changeImpact(P, { id: 'q', task: tid, ps: iso(t.s0), pf: iso(t.f0 + days) }); };
const clone = (P, f) => { const Q = JSON.parse(JSON.stringify(P, (k, v) => k.startsWith('__') ? undefined : v)); Q.id = P.id + '-q' + Math.random().toString(36).slice(2, 6); f(Q); return Q; };

// 1. Работа на критическом пути: +21 дн. к сваям → ввод сдвигается на 21 дн.
let I = imp(K, 'k09', 21);
ok('1 сваи +21 → сдвиг ввода', I.state === 'ok' && I.endShift === 21, 'ввод ' + I.endShift + ' дн., затронуто работ ' + I.rows.filter(r => !r.task.ms).length);
// 2. Сдвиг в пределах резерва поглощается
I = imp(K, 'k03', 5);
ok('2 сдвиг в пределах резерва не меняет ввод', I.endShift === 0 && /резерв/.test(I.endText), 'резерв ' + I.float0 + ' дн.');
// 3. Сдвиг сверх резерва
I = imp(K, 'k03', 260);
ok('3 сдвиг сверх резерва меняет ввод', I.endShift > 0, '+' + I.endShift + ' дн.');
// 4. Нет связей → «недостаточно данных»
const N = clone(K, Q => Q.tasks.forEach(t => { t.deps = []; }));
DSF.register(N);
I = imp(N, 'k09', 21);
ok('4 без связей — недостаточно данных', I.state === 'insufficient' && I.endText.startsWith('Недостаточно данных для достоверной оценки влияния на ввод объекта'), I.endText);
// 5. Цикл → ошибка расчёта
const C = clone(K, Q => { const a = Q.tasks.find(t => t.id === 'k08'); a.deps = (a.deps || []).concat(['k12']); });
DSF.register(C);
const MC = DSF.build(C);
ok('5 цикл обнаруживается', MC.network.state === 'error' && MC.network.cycles.length > 0, MC.network.cycles.map(c => c.map(t => t.id).join('→')).join('; '));
// 6. Завершённая работа → ошибка запроса
const done = DSF.build(K).tasks.find(t => t.done && !t.ms);
I = DSF.changeImpact(K, { id: 'q', task: done.id, ps: iso(done.s0), pf: iso(done.f0 + 10) });
ok('6 завершённую работу перенести нельзя', I.state === 'error', I.errors[0]);
// 7. Утверждённое изменение → рабочий прогноз, базовый план не меняется
const S = DSF.store.get(K.id);
const M0 = DSF.build(K), t0 = M0.byId.get('k09');
S.changes.push({ id: 'qa-ch', task: 'k09', ps: iso(t0.s0), pf: iso(t0.f0 + 21), ps0: iso(t0.s0), pf0: iso(t0.f0), org: 'q', date: '2026-10-05' });
S.changeOps.push({ change: 'qa-ch', op: 'tz-approve', date: '2026-10-05' }, { change: 'qa-ch', op: 'dir-approve', date: '2026-10-05' });
DSF.invalidate && DSF.invalidate(K.id); delete K.__model;
const M1 = DSF.build(K), t1 = M1.byId.get('k09');
ok('7 после утверждения база не меняется, прогноз меняется', t1.f0 === t0.f0 && t1.ef > t0.ef && M1.root.forecastEnd - M0.root.forecastEnd === 21, 'план ' + iso(t1.f0) + ', прогноз ' + iso(t0.ef) + ' → ' + iso(t1.ef));
// 8. Портфельный статус синхронизирован с прогнозом
const lim = 30, d0 = M0.root.forecastEnd - M0.root.planEnd, d1 = M1.root.forecastEnd - M1.root.planEnd;
ok('8 отклонение объекта пересчитано', d1 - d0 === 21, d0 + ' → ' + d1 + ' дн. (порог жёлтого ' + lim + ' дн.)');
S.changes.pop(); S.changeOps.splice(-2, 2); delete K.__model;
// 9. Типы связей SS/FF с лагами учитываются
const L = DSF.build(K).tasks.find(t => (t.deps || []).some(d => d.type === 'FF' || d.type === 'SS'));
ok('9 связи SS/FF с задержкой учитываются', !!L, L ? L.id + ': ' + L.deps.map(d => d.id + ':' + d.type + (d.lag ? '+' + d.lag : '')).join(', ') : '');
// 10. Береговой: подрядчики, затронутые сдвигом
I = imp(B, 'b06', 60);
ok('10 затронутые подрядчики определяются', I.orgs.length > 0 && I.endShift > 0, 'ввод +' + I.endShift + ' · ' + I.orgs.join(', '));
// сети демо-объектов полные
['kristall', 'bereg', 'vostok', 'briz', 'ladoga'].forEach(id => { const P = id === 'kristall' ? K : id === 'bereg' ? B : load(id); const st = DSF.build(P).network.state; ok('сеть ' + id, st === 'ok', st); });
process.exit(fail ? 1 : 0);
