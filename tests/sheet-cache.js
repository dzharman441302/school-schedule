'use strict';
// app.js: sheets come from the saved copy first, then from Google in one batchGet request;
// the big publication sheets are downloaded only when «Статус_публикации» changed;
// old localStorage copies move to IndexedDB; Google silent for 6 s → the saved copy stays.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const T0 = '2026-11-20T06:00:00Z';
const LATER = '2026-11-20T06:11:00Z'; // 11 minutes later: the copies are older than 10 minutes

// A tiny IndexedDB: one object store, requests answer on the next turn like the real one.
function fakeIndexedDB(data = new Map()) {
  const req = (fn) => {
    const r = {};
    setImmediate(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } });
    return r;
  };
  const store = {
    get: (k) => req(() => (data.has(k) ? structuredClone(data.get(k)) : undefined)),
    put: (v, k) => req(() => { data.set(k, structuredClone(v)); }),
    delete: (k) => req(() => { data.delete(k); })
  };
  const db = { createObjectStore() {}, transaction: () => ({ objectStore: () => store }) };
  return { data, open: () => { const r = {}; setImmediate(() => { r.result = db; r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
}

const STATUS = [['Дата', 'Опубликовано', 'Ученики', 'Учителя', 'Предупреждения', 'Режим'], ['20.11.2026', '20.11.2026 06:00:00', '5', '7', '0', 'Сейчас']];
const sheets = (extra = {}) => ({
  'Расписание': [['Класс', 'Урок', 'ПН'], ['5А', '1', 'Математика (209)']],
  'Учителя': [['ФИО', 'УРОК', 'ПН'], ['Иванов И.И.', '1', '5А|Мат|209']],
  'Учителя_сайт': [['Дата', 'Учитель'], ['20.11.2026', 'Иванов И.И.']],
  'Изменения': [['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание']],
  'Статус_публикации': STATUS,
  ...extra
});

async function page(db, epoch, sheetRows = sheets(), more = {}) {
  return startScreen(null, { sheets: sheetRows, epoch, globals: { indexedDB: db }, ...more });
}
const plain = (v) => JSON.parse(JSON.stringify(v));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sheets asked together go to Google in one batchGet request', async () => {
  const db = fakeIndexedDB(), h = await page(db, T0);
  const before = h.batches().length;
  await Promise.all(['Расписание', 'Учителя', 'Учителя_сайт'].map((n) => h.site.loadSheet(n)));
  await h.advance(0);
  const batches = h.batches().slice(before);
  assert.equal(batches.length, 1);
  assert.deepEqual([...batches[0]].sort(), ['Расписание', 'Статус_публикации', 'Учителя', 'Учителя_сайт']);
  assert.ok(db.data.has('Учителя_сайт'), 'the copy is saved in IndexedDB');
  assert.ok(db.data.get('Учителя_сайт').version, 'a publication sheet remembers the status version');
});

test('cache first: the saved copy comes at once, a newer one redraws the page only if it changed', async () => {
  const db = fakeIndexedDB();
  const first = await page(db, T0);
  await first.site.loadSheet('Расписание');
  await first.site.loadSheet('Учителя');
  await first.advance(0);

  const changed = sheets({ 'Расписание': [['Класс', 'Урок', 'ПН'], ['5А', '1', 'Физика (301)']] });
  const h = await page(db, LATER, changed);
  const updates = [];
  h.site.onSheetsUpdated((names) => updates.push([...names].sort()));
  const fetchedBefore = h.fetches('Расписание');
  const rows = plain(await h.site.loadSheet('Расписание'));
  assert.equal(rows[1][2], 'Математика (209)', 'the saved copy, without waiting for Google');
  assert.equal(h.fetches('Расписание'), fetchedBefore, 'returned before any request');
  await h.site.loadSheet('Учителя'); // same rows in Google
  await h.advance(0);
  assert.equal(h.fetches('Расписание'), fetchedBefore + 1, 'then the fresh copy was asked for in the background');
  assert.deepEqual(updates, [['Расписание']], 'only the sheet that changed is reported');
  assert.equal(plain(await h.site.loadSheet('Расписание'))[1][2], 'Физика (301)');
});

test('the big publication sheets are not downloaded while «Статус_публикации» is the same', async () => {
  const db = fakeIndexedDB();
  const first = await page(db, T0);
  await first.site.loadSheet('Учителя_сайт', { fresh: true });
  await first.advance(0);

  const same = await page(db, LATER);
  const before = same.fetches('Учителя_сайт');
  assert.deepEqual(plain(await same.site.loadSheet('Учителя_сайт', { fresh: true })), sheets()['Учителя_сайт']);
  assert.equal(same.fetches('Учителя_сайт'), before, 'version unchanged — not downloaded');
  assert.ok(same.fetches('Статус_публикации') >= 1, 'only the small status sheet was read');

  const status2 = [...STATUS, ['21.11.2026', '20.11.2026 06:10:00', '1', '1', '0', 'Сейчас']];
  const fresh = sheets({ 'Статус_публикации': status2, 'Учителя_сайт': [['Дата', 'Учитель'], ['21.11.2026', 'Петров П.П.']] });
  const next = await page(db, LATER, fresh);
  const rows = plain(await next.site.loadSheet('Учителя_сайт', { fresh: true }));
  assert.equal(rows[1][1], 'Петров П.П.', 'a new publication — downloaded');
  await next.advance(0);

  const forced = await page(db, LATER, fresh);
  const n = forced.fetches('Учителя_сайт');
  await forced.site.loadSheet('Учителя_сайт', { force: true });
  assert.equal(forced.fetches('Учителя_сайт'), n + 1, '«Обновить» always downloads');
});

test('old localStorage copies move to IndexedDB once and are removed', async () => {
  const db = fakeIndexedDB();
  const old = { savedAt: Date.parse(T0) - 60000, rows: [['Класс', 'Урок', 'ПН'], ['7Б', '2', 'История (305)']] };
  const h = await page(db, T0, sheets(), { stored: { 'school20:sheet:v3:Расписание': JSON.stringify(old), 'school20:sheet:v4:Изменения': JSON.stringify(old), 'school20:staffDevice': 'abc' } });
  const before = h.fetches('Расписание');
  const rows = plain(await h.site.loadSheet('Расписание'));
  assert.equal(rows[1][0], '7Б', 'the migrated copy is used');
  assert.equal(h.fetches('Расписание'), before, 'it is fresh (1 minute old) — no request');
  await h.advance(0);
  assert.ok(db.data.has('Расписание') && db.data.has('Изменения'));
  assert.equal(h.storage.has('school20:sheet:v3:Расписание'), false);
  assert.equal(h.storage.has('school20:sheet:v4:Изменения'), false);
  assert.equal(h.storage.get('school20:staffDevice'), 'abc', 'small settings stay in localStorage');
});

test('a missing optional sheet does not break the batch and is not asked for again', async () => {
  const db = fakeIndexedDB(), h = await page(db, T0);
  const [rooms, schedule] = await Promise.all([h.site.loadSheet('Помещения', { optional: true }), h.site.loadSheet('Расписание')]);
  assert.deepEqual(plain(rooms), []);
  assert.equal(plain(schedule)[1][0], '5А');
  const n = h.fetches('Помещения');
  assert.deepEqual(plain(await h.site.loadSheet('Помещения', { optional: true })), []);
  assert.equal(h.fetches('Помещения'), n);
  await assert.rejects(h.site.loadSheet('Нет_такого'), /нет листа/);
});

test('Google silent for 6 s: the saved copy stays, marked as old', async () => {
  const db = fakeIndexedDB();
  const first = await page(db, T0);
  await first.site.loadSheet('Расписание');
  await first.advance(0);

  const h = await page(db, LATER);
  h.hold();
  let rows = null;
  h.site.loadSheet('Расписание', { fresh: true }).then((r) => { rows = r; });
  await h.advance(0); // the request has gone
  await h.advance(5000);
  assert.equal(rows, null, 'still waiting at 5 s');
  await h.advance(1000);
  assert.equal(plain(rows)[1][0], '5А', 'at 6 s the saved copy is shown');
  const meta = plain(h.site.getSheetMeta('Расписание'));
  assert.equal(meta.stale, true);
  assert.equal(meta.savedAt, Date.parse(T0));

  const empty = await page(fakeIndexedDB(), T0);
  empty.hold();
  let error = null;
  empty.site.loadSheet('Расписание').catch((e) => { error = e; });
  await empty.advance(0);
  await empty.advance(6000);
  assert.match(String(error), /6 с/, 'no saved copy — a readable error, no endless waiting');
});

runTests('sheet cache checks', tests);
