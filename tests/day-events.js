'use strict';
// apps-script/DayEvents.gs: «Сегодня в школе» (drafts, publishing, teacher-only) and «Задача дня»
// (the answer key stays private, one answer per device, results the next day).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./schedule-fixture');

const root = path.join(__dirname, '..');
function dayHarness() {
  const h = createHarness();
  const ctx = h.context;
  const privateSheets = new Map();
  const privateSs = { getId: () => 'private', getSheetByName: (n) => privateSheets.get(n) || null, insertSheet: (n) => { const s = h.put(`__private:${n}`, []); privateSheets.set(n, s); return s; } };
  const publicSs = ctx.SpreadsheetApp.openById('fixture');
  let created = 0;
  ctx.SpreadsheetApp.openById = (id) => (id === 'private' ? privateSs : publicSs);
  ctx.SpreadsheetApp.create = () => { created += 1; return privateSs; };
  const triggers = [];
  ctx.ScriptApp.getProjectTriggers = () => triggers.map((name) => ({ getHandlerFunction: () => name }));
  ctx.ScriptApp.newTrigger = (name) => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => triggers.push(name) }) }) }) });
  ctx.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };
  for (const f of ['Lateness.gs', 'IctRequests.gs', 'DayEvents.gs', 'Скорость.gs']) vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', f), 'utf8'), ctx, { filename: f });
  const pub = (name) => h.sheets.get(name)?.rows || [];
  const priv = (name) => privateSheets.get(name)?.rows || [];
  return { h, ctx, call: (n, ...a) => h.plain(ctx[n](h.token, ...a)), pub, priv, triggers, created: () => created, post: (body) => h.plain(ctx.handleDailyTaskPost_(body)) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const D = '2026-09-28';

test('events: a draft stays private, publishing writes the public sheet, unpublishing removes the day', () => {
  const t = dayHarness();
  const events = [{ time: '15:00', what: 'Концерт ко Дню учителя', where: 'Актовый зал' }, { time: '8.30', what: 'Линейка', where: 'Холл' }, { time: '', what: 'Неделя безопасности' }, { time: '14:00', what: 'Педсовет', where: '211', teachers: true }];
  const draft = t.call('saveDayEventsDraft', D, events);
  assert.deepEqual(draft.events.map((e) => e.time), ['08:30', '14:00', '15:00', ''], 'sorted by time, «8.30» → «08:30», all-day last');
  assert.equal(t.pub('События_сайт').length, 0, 'a draft is not on the site');
  assert.equal(t.created(), 1, 'drafts live in the private spreadsheet');
  const got = t.call('getDayEvents', D);
  assert.equal(got.draft.length, 4);
  assert.deepEqual(got.published, []);
  const pub = t.call('publishDayEvents', D, events);
  assert.match(pub.publishedAt, /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/);
  const rows = t.pub('События_сайт');
  assert.deepEqual(rows[0], ['Дата', 'Время', 'Что', 'Где', 'Для', 'Опубликовано']);
  assert.deepEqual(rows.slice(1).map((r) => [r[0], r[1], r[2], r[4]]), [['28.09.2026', "'08:30", 'Линейка', 'Всем'], ['28.09.2026', "'14:00", 'Педсовет', 'Учителям'], ['28.09.2026', "'15:00", 'Концерт ко Дню учителя', 'Всем'], ['28.09.2026', '', 'Неделя безопасности', 'Всем']]);
  t.call('publishDayEvents', '2026-09-29', [{ time: '10:00', what: 'Олимпиада' }]);
  t.call('publishDayEvents', D, [{ time: '12:00', what: 'Только одно' }]);
  assert.equal(t.pub('События_сайт').filter((r) => r[0] === '28.09.2026').length, 1, 'publishing again replaces the day');
  assert.deepEqual(t.call('getDayEvents', D).upcoming.map((u) => [u.date, u.published]), [['2026-09-28', true], ['2026-09-29', true]]);
  assert.equal(t.call('unpublishDayEvents', D).removed, 1);
  assert.deepEqual(t.pub('События_сайт').slice(1).map((r) => r[2]), ['Олимпиада'], 'other days stay');
  assert.equal(t.call('getDayEvents', D).draft[0].what, 'Только одно', 'the draft survives unpublishing');
});

test('events are checked: at most five, «что» required, a real time, a valid session', () => {
  const t = dayHarness();
  assert.throws(() => t.call('saveDayEventsDraft', D, Array.from({ length: 6 }, (_, i) => ({ what: `x${i}` }))), /Не больше 5/);
  assert.throws(() => t.call('saveDayEventsDraft', D, [{ time: '10:00', where: 'Зал' }]), /заполните «Что»/);
  assert.throws(() => t.call('saveDayEventsDraft', D, [{ time: '25:00', what: 'Ночь' }]), /время/);
  assert.throws(() => t.call('publishDayEvents', D, []), /хотя бы одно/);
  assert.throws(() => t.ctx.getDayEvents('bad-token', D), /Сессия истекла/);
});

test('the task: public text, private answer, a nightly trigger', () => {
  const t = dayHarness();
  assert.throws(() => t.call('saveDailyTask', D, { task: 'Сколько будет 2+2×2?' }), /правильный ответ/);
  t.call('saveDailyTask', D, { task: 'Сколько будет 2+2×2?', explain: 'Порядок действий', parallels: '5, 6 и 7', answer: '6; шесть' });
  assert.deepEqual(t.pub('Задача_дня')[1], ['28.09.2026', 'Сколько будет 2+2×2?', 'Порядок действий', '5, 6, 7']);
  assert.ok(!JSON.stringify(t.h.sheets.get('Задача_дня').rows).includes('шесть'), 'the answer is not in the public sheet');
  assert.equal(t.priv('Задача_дня_ключи')[1][1], '6; шесть');
  assert.deepEqual(t.triggers, ['publishDailyTaskResults']);
  t.call('saveDailyTask', D, { task: 'Новая', answer: '1' });
  assert.equal(t.pub('Задача_дня').length, 2, 'saving again replaces the day');
  assert.equal(t.triggers.length, 1, 'one trigger');
  t.call('deleteDailyTask', D);
  assert.equal(t.pub('Задача_дня').length, 1);
  assert.equal(t.priv('Задача_дня_ключи').length, 1);
});

test('answers: case and spaces do not matter, one per device, only listed parallels, no names', () => {
  const t = dayHarness();
  const today = '2026-09-25'; // the fixture clock
  t.call('saveDailyTask', today, { task: 'Столица России?', parallels: '5', answer: 'Москва; г. Москва' });
  const send = (cls, answer, device) => t.post({ action: 'dailyTask', cls, answer, device });
  assert.deepEqual(send('5А', '  москва ', 'device-0001'), { ok: true, correct: true });
  assert.deepEqual(send('5А', 'Тверь', 'device-0001'), { ok: true, already: true, correct: true }, 'the second answer of a device is not counted');
  assert.deepEqual(send('5Б', 'Тверь', 'device-0002'), { ok: true, correct: false });
  assert.equal(send('5А', 'Г. МОСКВА', 'device-0003').correct, true, 'another accepted variant');
  assert.match(send('6А', 'Москва', 'device-0004').error, /для 5 классов/);
  assert.match(send('9Ж', 'Москва', 'device-0005').error, /свой класс/);
  assert.match(send('5А', '', 'device-0006').error, /Напиши ответ/);
  assert.match(send('5А', 'Москва', 'x').error, /Обнови/);
  const rows = t.priv('Задача_дня_ответы');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].slice(2, 4), ['5А', 'да']);
  assert.ok(!rows.flat().includes('device-0001'), 'only a hash of the device is kept');
  assert.equal(t.call('getDailyTask', today).correct, 2);
});

test('results come out the next day: correct answers, the first class, the answer', () => {
  const t = dayHarness();
  t.call('getDailyTask', '2026-09-25'); // opens the private sheets, as the panel does
  t.call('saveDailyTask', '2026-09-24', { task: 'Вчерашняя', answer: '6; шесть' });
  const answers = t.ctx.SpreadsheetApp.openById('private').getSheetByName('Задача_дня_ответы');
  answers.appendRow(['24.09.2026', "'10:05:00", '9Б', 'да', 'h1']);
  answers.appendRow(['24.09.2026', "'9:58:00", '7А', 'нет', 'h2']);
  answers.appendRow(['24.09.2026', "'9:59:30", '9В', 'да', 'h3']);
  t.call('saveDailyTask', '2026-09-25', { task: 'Сегодняшняя', answer: '1' });
  t.ctx.publishDailyTaskResults();
  const results = t.pub('Задача_дня_итоги');
  assert.deepEqual(results.slice(1), [['24.09.2026', 2, 3, '9В', '6']], 'today is not published yet; «9:59» comes before «10:05»');
  t.ctx.publishDailyTaskResults();
  assert.equal(t.pub('Задача_дня_итоги').length, 2, 'published once');
});

test('doPost: «dailyTask» goes to the task, «На экран» of notices is saved', () => {
  const t = dayHarness();
  t.call('saveDailyTask', '2026-09-25', { task: 'Задача', answer: '42' });
  const res = t.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'dailyTask', cls: '5А', answer: '42', device: 'device-1234' }) } });
  assert.equal(JSON.parse(res).correct, true);
  t.ctx.saveNotice(t.h.token, { title: 'Концерт', text: 'в 15:00', screen: 'Всем' });
  const notices = t.h.sheets.get('Оповещения').rows;
  assert.equal(notices[0][15], 'На экран');
  assert.equal(notices[1][15], 'Всем');
  assert.equal(t.ctx.noticeScreen_('teachers'), 'Учителям');
  assert.equal(t.ctx.noticeScreen_('что-то'), '');
});

test('weather for the screens: fetched by the script, kept 30 minutes, errors told plainly', () => {
  const t = dayHarness();
  let calls = 0, code = 200;
  t.ctx.UrlFetchApp = { fetch: (url) => { calls += 1; assert.match(url, /open-meteo/); return { getResponseCode: () => code, getContentText: () => JSON.stringify({ current: { temperature_2m: 1.5 } }) }; } };
  assert.equal(t.h.plain(t.ctx.handleWeather_()).weather.current.temperature_2m, 1.5);
  assert.equal(t.h.plain(t.ctx.handleWeather_()).cached, true);
  assert.equal(calls, 1, 'one request to Open-Meteo for the whole school');
  t.ctx.CacheService.getScriptCache().remove('weather:v1');
  code = 503;
  assert.deepEqual(t.h.plain(t.ctx.handleWeather_()), { ok: false, error: 'open-meteo 503' });
  const res = t.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'weather' }) } });
  assert.equal(JSON.parse(res).ok, false, 'routed through doPost');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack}`); }
}
if (failed) { console.error(`${failed} of ${tests.length} day events checks failed`); process.exit(1); }
console.log(`${tests.length} day events checks passed`);
