'use strict';
// apps-script/Скорость.gs: the speed log. Every outer call of a panel function leaves one record
// (when, action, ms, rows read, result) — no data; PERF_LOG=0 turns it off; perfFlush moves the
// records to the hidden sheet «Замеры» in one write.
const assert = require('node:assert/strict');
const { createHarness } = require('./schedule-fixture');

function perfHarness(extra = {}) {
  const h = createHarness();
  const props = new Map([['SPREADSHEET_ID', 'fixture'], ['ADMIN_PIN', '1234'], ...Object.entries(extra)]);
  h.context.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => props.set(k, String(v)),
    deleteProperty: (k) => props.delete(k),
    getProperties: () => Object.fromEntries(props),
  }) };
  const triggers = [];
  h.context.ScriptApp.getProjectTriggers = () => triggers.map((name) => ({ getHandlerFunction: () => name }));
  h.context.ScriptApp.newTrigger = (name) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push(name) }) }) });
  h.context.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json', TEXT: 'text' } };
  h.context.Logger = { log: () => {} };
  h.context.LockService.getScriptLock = () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} });
  const records = () => [...props].filter(([k]) => k.startsWith('perf|')).map(([, v]) => JSON.parse(v));
  return { ...h, props, triggers, records };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a panel call leaves one record with its name, time and rows read — and no data', () => {
  const h = perfHarness();
  h.call('getAdminDay', h.token, h.date);
  const r = h.records();
  assert.equal(r.length, 1, 'nested calls are counted inside the outer one');
  const [when, action, ms, rows, result, steps] = r[0];
  assert.match(when, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(action, 'getAdminDay');
  assert.equal(typeof ms, 'number');
  assert.ok(rows > 0, 'getDataRange reads are counted');
  assert.equal(result, 'ок');
  assert.equal(r[0].length, 6);
  assert.equal(steps, '', 'only long functions mark steps');
  assert.deepEqual(h.triggers, ['perfFlush'], 'the flush trigger is created once');
});

test('an error is logged as «ошибка» and still thrown', () => {
  const h = perfHarness();
  assert.throws(() => h.call('getAdminDay', 'wrong-token', h.date), /Сессия истекла/);
  assert.equal(h.records()[0][1], 'getAdminDay');
  assert.equal(h.records()[0][4], 'ошибка');
});

test('PERF_LOG=0 turns the log off; results stay the same', () => {
  const on = perfHarness(), off = perfHarness({ PERF_LOG: '0' });
  assert.equal(JSON.stringify(on.call('getAdminDay', on.token, on.date)), JSON.stringify(off.call('getAdminDay', off.token, off.date)));
  assert.equal(off.records().length, 0);
});

test('doPost is named by its action without parsing the whole body', () => {
  const h = perfHarness();
  h.call('doPost', { parameter: {}, postData: { contents: JSON.stringify({ action: 'unknownAction', pin: 'x' }) } });
  h.call('doPost', { parameter: { action: 'markSeen' } });
  assert.deepEqual(h.records().map((r) => r[1]).sort(), ['doPost:markSeen', 'doPost:unknownAction']);
});

test('perfFlush moves the records to the hidden sheet «Замеры» and clears them', () => {
  const h = perfHarness();
  h.call('getAdminDay', h.token, h.date);
  h.call('getInitialData', h.token);
  assert.equal(h.call('perfFlush'), 2);
  const sheet = h.sheets.get('Замеры');
  assert.ok(sheet.hidden);
  const rows = sheet.getDataRange().getValues();
  assert.deepEqual(rows[0], ['Когда', 'Действие', 'мс', 'Строк прочитано', 'Итог', 'Шаги']);
  assert.deepEqual(rows.slice(1).map((r) => r[1]).sort(), ['getAdminDay', 'getInitialData']);
  assert.equal(h.records().length, 0);
  assert.equal(h.call('perfFlush'), 0);
});

test('a publication tells where its time goes; old 5-column records are still moved', () => {
  const h = perfHarness();
  h.props.set('perf|1|old', JSON.stringify(['2026-11-20 06:00:00', 'getAdminDay', 100, 5, 'ок']));
  const day = h.plain(h.call('getAdminDay', h.token, h.date));
  h.call('publishAdminDayEnhanced', h.token, h.date, [], [], day.revision);
  const pub = h.records().find((r) => r[1] === 'publishAdminDayEnhanced');
  const steps = pub[5].split('; ').map((x) => x.replace(/ \d+$/, ''));
  ['листы', 'сетка', 'Изменения_учителей', 'Изменения', 'Учителя_сайт', 'статус', 'журнал замен'].forEach((x) => assert.ok(steps.includes(x), x));
  pub[5].split('; ').forEach((x) => assert.match(x, / \d+$/));
  h.call('perfFlush');
  const rows = h.sheets.get('Замеры').getDataRange().getValues().slice(1);
  assert.ok(rows.some((r) => r[1] === 'getAdminDay' && r[2] === 100 && r[5] === ''), 'the old record got an empty «Шаги»');
});

test('perfStatus reports what is wrapped', () => {
  const h = perfHarness();
  const s = h.plain(h.call('perfStatus'));
  assert.equal(s.enabled, true);
  assert.equal(s.hasDoGet, true);
  assert.equal(s.hasDoPost, true);
  assert.ok(s.wrapped > 30);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}`); console.error(error); }
}
if (failed) { console.error(`${failed} of ${tests.length} speed log checks failed`); process.exit(1); }
console.log(`${tests.length} speed log checks passed`);
