'use strict';
// Задание «Ускорение», шаг 4 — the panel on Apps Script: rarely changed tables from the cache,
// the panel opens with one call, the replacement audit in one write, cached weekly status,
// «Увидел изменения» once per 6 hours.
const assert = require('node:assert/strict');
const { createHarness } = require('./schedule-fixture');

function harness() {
  const h = createHarness();
  h.context.LockService.getScriptLock = () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} });
  h.context.ScriptApp.getProjectTriggers = () => [];
  h.context.ScriptApp.newTrigger = () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }), everyMinutes: () => ({ create() {} }) }) });
  h.context.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json', TEXT: 'text' } };
  return h;
}
// How many times a sheet was read whole (getDataRange) — that is what costs time in Google.
function reads(h, name) {
  const sheet = h.sheets.get(name), real = sheet.getDataRange.bind(sheet);
  let n = 0;
  sheet.getDataRange = () => { n += 1; return real(); };
  return () => n;
}
const set = (teacher, lesson, className) => ({ teacher, lesson, type: 'set', className, subject: 'Математика', room: '209', note: '' });
const cancel = (teacher, lesson) => ({ teacher, lesson, type: 'cancel', className: '', subject: '', room: '', note: '' });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('«Учителя» and «Расписание» are read once per call and then come from the cache', () => {
  const h = harness(), teachers = reads(h, 'Учителя'), schedule = reads(h, 'Расписание');
  const first = h.plain(h.call('getAdminDay', h.token, h.date));
  assert.equal(teachers(), 1);
  assert.equal(schedule(), 1);
  const again = h.plain(h.call('getAdminDay', h.token, h.date));
  h.call('getInitialData', h.token);
  assert.equal(teachers(), 1, 'the next calls take the cached copy');
  assert.equal(schedule(), 1);
  assert.equal(again.revision, first.revision);
});

test('a publication always reads the sheets afresh; a login clears the cache', () => {
  const h = harness(), teachers = reads(h, 'Учителя');
  const day = h.plain(h.call('getAdminDay', h.token, h.date));
  h.call('publishAdminDayEnhanced', h.token, h.date, [cancel(h.names[0], 4)], [], day.revision);
  assert.equal(teachers(), 2, 'one read for the whole publication (it used to be three)');
  h.call('login', '1234');
  h.call('getAdminDay', h.token, h.date);
  assert.equal(teachers(), 3, 'login reads afresh (for its bootstrap); the next call takes that copy');
});

test('the login brings the panel data and the answers for the first day', () => {
  const h = harness();
  const r = h.plain(h.call('login', '1234'));
  assert.ok(r.token);
  assert.equal(r.boot.initial.today, h.date);
  assert.ok(r.boot.initial.classes.includes('5А'));
  const keys = Object.keys(r.boot.prefetch).sort();
  assert.deepEqual(keys, [`getAdminDay|["${h.date}"]`, `getPublicationMeta|["${h.date}"]`, `getReplacementWeeklyStatus|["${h.date}"]`].sort());
  assert.equal(r.boot.prefetch[`getAdminDay|["${h.date}"]`].revision, h.plain(h.call('getAdminDay', r.token, h.date)).revision);
  const saved = h.plain(h.call('getAdminBootstrap', r.token));
  assert.deepEqual(Object.keys(saved.prefetch).sort(), keys, 'a saved session opens the same way');
});

test('saved bells are seen at once, not after the cache expires', () => {
  const h = harness();
  const before = h.plain(h.call('getBells', h.token));
  const times = before.variants['Основное'].map((t, i) => (i === 0 ? '07:55–08:30' : t.join('–')));
  h.call('saveBells', h.token, { 'Основное': times });
  assert.deepEqual(h.plain(h.call('getBells', h.token)).variants['Основное'][0], ['07:55', '08:30']);
});

test('the replacement audit of a publication is written in one go', () => {
  const h = harness();
  const day = h.plain(h.call('getAdminDay', h.token, h.date));
  h.call('publishAdminDayEnhanced', h.token, h.date, [], [], day.revision); // creates the journal sheets
  const audit = h.sheets.get('Замены_аудит');
  let writes = 0, appends = 0;
  const realRange = audit.getRange.bind(audit), realAppend = audit.appendRow.bind(audit);
  audit.getRange = (...a) => { const r = realRange(...a), sv = r.setValues.bind(r); r.setValues = (v) => { writes += 1; return sv(v); }; return r; };
  audit.appendRow = (r) => { appends += 1; return realAppend(r); };
  const before = audit.getLastRow();
  const edits = [cancel(h.names[0], 4), set(h.names[2], 4, '5А'), cancel(h.names[1], 4), set(h.names[3], 4, '5Б')];
  h.call('publishAdminDayEnhanced', h.token, h.date, edits, [], h.plain(h.call('getAdminDay', h.token, h.date)).revision);
  assert.ok(audit.getLastRow() - before >= 2, 'several audit rows');
  assert.equal(appends, 0);
  assert.equal(writes, 1);
});

test('the weekly status of the journal is cached until the journal changes', () => {
  const h = harness();
  const day = h.plain(h.call('getAdminDay', h.token, h.date));
  h.call('publishAdminDayEnhanced', h.token, h.date, [cancel(h.names[0], 4), set(h.names[2], 4, '5А')], [], day.revision);
  const journal = reads(h, 'Журнал_замен');
  const a = h.plain(h.call('getReplacementWeeklyStatus', h.token, h.date));
  const b = h.plain(h.call('getReplacementWeeklyStatus', h.token, h.date));
  assert.deepEqual(a, b);
  assert.equal(journal(), 1, 'the second answer comes from the cache');
  h.call('publishAdminDayEnhanced', h.token, h.date, [], [], h.plain(h.call('getAdminDay', h.token, h.date)).revision);
  const n = journal();
  const c = h.plain(h.call('getReplacementWeeklyStatus', h.token, h.date));
  assert.equal(journal(), n + 1, 'a write to the journal makes it read afresh');
  assert.equal(c.pending, 0, 'the replacement was removed by the new publication');
});

test('during a publication the weekly status does not wait for the lock: the last answer comes at once', () => {
  const h = harness();
  const day = h.plain(h.call('getAdminDay', h.token, h.date));
  h.call('publishAdminDayEnhanced', h.token, h.date, [cancel(h.names[0], 4), set(h.names[2], 4, '5А')], [], day.revision);
  const first = h.plain(h.call('getReplacementWeeklyStatus', h.token, h.date));
  h.context.replacementBump_(); // the journal changed…
  h.context.LockService.getScriptLock = () => ({ waitLock() { throw new Error('busy 15 s'); }, tryLock: () => false, releaseLock() {} }); // …and is being written now
  const journal = reads(h, 'Журнал_замен');
  const busy = h.plain(h.call('getReplacementWeeklyStatus', h.token, h.date));
  assert.equal(busy.stale, true);
  assert.equal(busy.pending, first.pending);
  assert.equal(journal(), 0, 'no reading, no waiting');
});

test('«Увидел изменения» of the same teacher on the same device is written once in 6 hours', () => {
  const h = harness();
  h.call('ensureManagementSheets_');
  const seen = reads(h, 'Просмотры_учителей');
  const mark = () => h.call('markTeacherViewedPublic_', h.date, h.names[0], 'device-1');
  mark(); mark(); mark();
  h.call('markTeacherViewedPublic_', h.date, h.names[0], 'device-2');
  assert.equal(seen(), 0, 'the sheet is never read: a mark is only appended');
  assert.equal(h.sheets.get('Просмотры_учителей').getDataRange().getValues().slice(1).filter((r) => r.some(Boolean)).length, 2, 'once per device');
  h.call('markTeacherViewedPublic_', h.date, h.names[1], 'device-3');
  const summary = h.plain(h.call('getTeacherSeenSummary', h.token, h.date));
  assert.deepEqual(Object.keys(summary).sort(), [h.names[0], h.names[1]].sort(), 'the panel sees each teacher once');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}`); console.error(error); }
}
if (failed) { console.error(`${failed} of ${tests.length} panel speed checks failed`); process.exit(1); }
console.log(`${tests.length} panel speed checks passed`);
