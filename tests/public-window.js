'use strict';
// apps-script/PublicWindow.gs: the public sheets keep only «с понедельника прошлой недели и всё
// будущее»; older rows go to the hidden archive sheets; the panel still reads old dates.
// The fixture's today is Friday 25.09.2026, so the window starts on Monday 14.09.2026.
const assert = require('node:assert/strict');
const { createHarness } = require('./schedule-fixture');

const PUB_HEAD = ['Дата', 'Учитель', 'Урок', 'Класс', 'Предмет', 'Кабинет', 'Статус', 'Было_класс', 'Было_предмет', 'Было_кабинет', 'Примечание'];
const CH_HEAD = ['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание'];
const pub = (date, teacher, lesson) => [date, teacher, lesson, '5А', 'Математика', '209', 'normal', '5А', 'Математика', '209', ''];
const ch = (date, cls, lesson, text) => [date, cls, lesson, text, ''];

function harness() {
  const h = createHarness();
  const triggers = [];
  h.context.ScriptApp.getProjectTriggers = () => triggers.map((name) => ({ getHandlerFunction: () => name }));
  h.context.ScriptApp.newTrigger = (name) => ({ timeBased: () => ({ everyDays: () => ({ atHour: (hour) => ({ create: () => triggers.push(`${name}@${hour}`) }) }), everyMinutes: () => ({ create: () => {} }) }) });
  h.context.LockService.getScriptLock = () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} });
  h.put('Учителя_сайт', [PUB_HEAD, pub('07.09.2026', 'Иванов И.И.', 1), pub('11.09.2026', 'Петров П.П.', 2), pub('14.09.2026', 'Иванов И.И.', 3), pub('25.09.2026', 'Петров П.П.', 4), pub('28.09.2026', 'Иванов И.И.', 5)], 11);
  h.put('Изменения', [CH_HEAD, ch('01.09.2026', '5А', 2, 'отмена'), ch('13.09.2026', '5Б', 3, 'Физика (301)'), ch('15.09.2026', '6А', 1, 'отмена'), ch('29.09.2026', '5А', 6, 'Химия (210)')], 5);
  return { ...h, triggers };
}
const dates = (sheet) => (sheet ? sheet.getDataRange().getValues().slice(1).filter((r) => r.some(Boolean)).map((r) => String(r[0])) : []);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the window starts on Monday of the previous week', () => {
  const h = harness();
  assert.equal(h.call('publicWindowStart_', '2026-09-25'), '2026-09-14');
  assert.equal(h.call('publicWindowStart_', '2026-09-21'), '2026-09-14', 'a Monday');
  assert.equal(h.call('publicWindowStart_', '2026-09-27'), '2026-09-14', 'a Sunday');
});

test('older rows move to the hidden archive, the window and the future stay', () => {
  const h = harness();
  const { yearly, ...out } = h.plain(h.call('archivePublicSheets'));
  assert.deepEqual(yearly, {}, 'nothing of past school years here');
  assert.deepEqual(out, { 'Учителя_сайт': { kept: 3, moved: 2 }, 'Изменения': { kept: 2, moved: 2 } });
  assert.deepEqual(dates(h.sheets.get('Учителя_сайт')), ['14.09.2026', '25.09.2026', '28.09.2026']);
  assert.deepEqual(dates(h.sheets.get('Изменения')), ['15.09.2026', '29.09.2026']);
  assert.deepEqual(dates(h.sheets.get('Учителя_архив')), ['07.09.2026', '11.09.2026']);
  assert.deepEqual(dates(h.sheets.get('Изменения_архив')), ['01.09.2026', '13.09.2026']);
  assert.ok(h.sheets.get('Учителя_архив').hidden && h.sheets.get('Изменения_архив').hidden, 'the site never reads them');
  assert.deepEqual(h.sheets.get('Изменения_архив').getDataRange().getValues()[0], CH_HEAD);
  const { yearly: _y, ...again } = h.plain(h.call('archivePublicSheets'));
  assert.deepEqual(again, { 'Учителя_сайт': { kept: 3, moved: 0 }, 'Изменения': { kept: 2, moved: 0 } }, 'a second run moves nothing');
  assert.deepEqual(dates(h.sheets.get('Учителя_архив')), ['07.09.2026', '11.09.2026'], 'and duplicates nothing');
});

test('a date published again replaces its old rows in the archive', () => {
  const h = harness();
  h.call('archivePublicSheets');
  const sheet = h.sheets.get('Изменения');
  sheet.appendRow(ch('01.09.2026', '7Б', 4, 'Музыка (106)')); // e.g. a rollback of an old day
  h.call('archivePublicSheets');
  const archived = h.sheets.get('Изменения_архив').getDataRange().getValues().slice(1).filter((r) => String(r[0]) === '01.09.2026');
  assert.deepEqual(archived.map((r) => r[1]), ['7Б']);
});

test('the panel still sees old dates: from the archive', () => {
  const h = harness();
  h.call('archivePublicSheets');
  const old = h.plain(h.call('getDateChanges', h.token, '2026-09-01'));
  assert.deepEqual(old.map((x) => [x.className, x.lesson, x.change]), [['5А', 2, 'отмена']]);
  const recent = h.plain(h.call('getDateChanges', h.token, '2026-09-15'));
  assert.deepEqual(recent.map((x) => x.className), ['6А']);
  const both = h.plain(h.call('readPublicRows_', h.context.getSpreadsheet_(), 'Учителя_сайт', '2026-09-01', '2026-09-30'));
  assert.deepEqual(both.map((r) => String(r[0])).sort(), ['07.09.2026', '11.09.2026', '14.09.2026', '25.09.2026', '28.09.2026']);
});

test('the first publication of the day moves old rows and sets the night trigger', () => {
  const h = harness();
  const day = h.call('getAdminDay', h.token, h.date);
  h.call('publishAdminDayEnhanced', h.token, h.date, [], [], day.revision);
  assert.deepEqual(dates(h.sheets.get('Изменения_архив')), ['01.09.2026', '13.09.2026']);
  assert.deepEqual(h.triggers, ['archivePublicSheets@3']);
  h.sheets.get('Изменения').appendRow(ch('02.09.2026', '5А', 1, 'отмена'));
  h.call('publishAdminDayEnhanced', h.token, h.date, [], [], h.call('getAdminDay', h.token, h.date).revision);
  assert.ok(dates(h.sheets.get('Изменения')).includes('02.09.2026'), 'only once a day — the rest is the night trigger');
  assert.deepEqual(h.triggers, ['archivePublicSheets@3']);
});

test('«Статус_публикации» shows the time of the publication, the cell stays a date', () => {
  const h = harness();
  h.call('publishAdminDayEnhanced', h.token, h.date, [], [], h.call('getAdminDay', h.token, h.date).revision);
  const sheet = h.sheets.get('Статус_публикации'), row = sheet.getDataRange().getValues()[1];
  assert.ok(row[1] instanceof h.context.Date || Object.prototype.toString.call(row[1]) === '[object Date]', 'the MAX bot reads it as a number');
  assert.equal(sheet.formats['1|1'], 'dd.MM.yyyy HH:mm:ss');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}`); console.error(error); }
}
if (failed) { console.error(`${failed} of ${tests.length} public window checks failed`); process.exit(1); }
console.log(`${tests.length} public window checks passed`);
