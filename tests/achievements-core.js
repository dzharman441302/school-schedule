'use strict';
// achievements-core.js: разбор формы «Внести достижение» в записи, проверка строк учеников,
// сессия без ФИО учеников в localStorage/sessionStorage. Все ФИО — вымышленные.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../achievements-core.js');

const root = path.join(__dirname, '..');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const CLASSES = ['1А', '5А', '8Б', '11А'];
const RESULTS = ['Участник', 'Призёр', 'Победитель'];
const DICT = { directions: ['Конкурс', 'Предметная олимпиада'], levels: ['Школьный', 'Муниципальный'], forms: ['Очно', 'Дистанционно'] };
const row = (over = {}) => ({ student_name: 'Тестов Пётр Иванович', class_name: '8Б', result: 'Призёр', consent: false, diploma: null, ...over });
const EVENT = { event_name: '  Олимпиада   по математике ', contest_id: 'c1', direction: 'Предметная олимпиада', level: 'Муниципальный', form: 'Очно', subject: ' Математика ', event_date: '2026-11-10', supervisor_id: 't1' };

test('student names: 2–3 Cyrillic words up to 60 characters, hyphen and ё allowed', () => {
  for (const ok of ['Тестов Пётр', 'Тестова-Примерова Алёна Игоревна', 'ёлкин ёж']) assert.equal(core.studentNameError(ok), '', ok);
  for (const bad of ['', 'Тестов', 'Testov Petr', 'Тестов П.', 'А Б В Г', 'А'.repeat(30) + ' ' + 'Б'.repeat(30)]) assert.ok(core.studentNameError(bad), bad);
  assert.equal(core.normalizeName('  Тестов  Пётр  '), 'Тестов Пётр');
});

test('row validation reports form row numbers and skips blank rows', () => {
  const rows = [row(), row({ student_name: '', class_name: '' }), row({ student_name: 'Petrov', class_name: '12А', result: 'Чемпион' })];
  const errors = core.validateRows(rows, { classes: CLASSES, results: RESULTS });
  assert.deepEqual(errors.map((e) => [e.row, e.field]), [[2, 'student_name'], [2, 'class_name'], [2, 'result']]);
  assert.deepEqual(core.validateRows([row({ student_name: '', class_name: '' })], { classes: CLASSES, results: RESULTS }).map((e) => e.field), ['students']);
});

test('«результат одинаковый для всех» checks the shared result once, not per row', () => {
  const rows = [row({ result: '' }), row({ result: '' })];
  assert.deepEqual(core.validateRows(rows, { classes: CLASSES, results: RESULTS, sameResult: 'Победитель' }), []);
  const errors = core.validateRows(rows, { classes: CLASSES, results: RESULTS, sameResult: '' });
  assert.deepEqual(errors.map((e) => [e.row, e.field]), [[null, 'result']]);
});

test('no more than 40 students in one form', () => {
  const errors = core.validateRows(Array.from({ length: 41 }, () => row()), { classes: CLASSES, results: RESULTS });
  assert.ok(errors.some((e) => e.field === 'students' && /40/.test(e.message)));
});

test('event validation needs name, direction, level, form and date', () => {
  assert.deepEqual(core.validateEvent(EVENT, DICT), []);
  assert.deepEqual(core.validateEvent({}, DICT).map((e) => e.field), ['event_name', 'direction', 'level', 'form', 'event_date']);
});

test('form → one payload with a student per filled row; row indexes map server ids back to rows', () => {
  const rows = [row({ consent: true }), row({ student_name: '', class_name: '' }), row({ student_name: ' Примерова  Анна ', class_name: '5А', result: 'Участник', consent: 'да' })];
  const { payload, rowIndexes } = core.buildPayload(EVENT, rows, { me: 't2' });
  assert.equal(payload.event_name, 'Олимпиада по математике');
  assert.equal(payload.subject, 'Математика');
  assert.equal(payload.supervisor_id, 't1');
  assert.deepEqual(payload.students, [
    { student_name: 'Тестов Пётр Иванович', class_name: '8Б', result: 'Призёр', consent: true },
    { student_name: 'Примерова Анна', class_name: '5А', result: 'Участник', consent: false },
  ]);
  assert.deepEqual(rowIndexes, [0, 2]);
  assert.equal(core.buildPayload(EVENT, rows, { me: 't1' }).payload.supervisor_id, null, 'руководитель по умолчанию — автор');
  assert.deepEqual(core.buildPayload(EVENT, rows, { sameResult: 'Победитель' }).payload.students.map((s) => s.result), ['Победитель', 'Победитель']);
});

test('contest search by words, ё = е', () => {
  const contests = [{ name: 'Всероссийская олимпиада школьников по математике', subject: 'Математика' }, { name: 'Конкурс «Зелёная планета»', subject: '' }];
  assert.equal(core.matchContests('олимп матем', contests).length, 1);
  assert.equal(core.matchContests('зеленая', contests)[0].name, 'Конкурс «Зелёная планета»');
  assert.deepEqual(core.matchContests('  ', contests), []);
});

test('my records: returned first, then newest event', () => {
  const sorted = core.sortMine([{ id: 'a', status: 'new', event_date: '2026-11-01' }, { id: 'b', status: 'returned', event_date: '2026-09-10' }, { id: 'c', status: 'checked', event_date: '2026-11-15' }]);
  assert.deepEqual(sorted.map((r) => r.id), ['b', 'c', 'a']);
});

test('school year starts on 1 September', () => {
  assert.equal(core.schoolYearStart(new Date(2026, 7, 31)), 2025);
  assert.equal(core.schoolYearStart(new Date(2026, 8, 1)), 2026);
  assert.equal(core.ruDate('2026-11-10'), '10.11.2026');
  assert.deepEqual(core.fitBox(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.ok(core.isPdfUrl('https://s/diplomas/x/y.pdf?X-Amz-Signature=1'));
});

// Фейковый API: запоминает запросы, отвечает как yc-achievements.
function fakeServer() {
  const calls = [];
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    if (url.endsWith('/login')) return json(200, { token: 'tok123', expires_at: Date.now() / 1000 + 3600, staff: { id: 't1', short_name: 'Учителева А.А.', role: 'teacher' } });
    if (url.endsWith('/records')) return json(201, { created: 2, ids: ['r1', 'r2'] });
    if (url.endsWith('/diploma-upload-url')) return json(200, { upload_url: 'https://storage.example/diplomas/r1/x.jpg?sig' });
    if (url.startsWith('https://storage.example')) return { ok: true, status: 200 };
    if (url.endsWith('/records/mine?year=2026')) return json(401, { error: 'auth', message: 'Войдите заново' });
    return json(404, { error: 'not_found', message: 'Нет' });
  };
  return { calls, fetchImpl };
}

test('after login and submitting a form, neither storage holds student names', async () => {
  const server = fakeServer();
  const session = core.memoryStore(), local = core.memoryStore();
  const api = core.createApi({ base: 'https://api.example/', fetchImpl: server.fetchImpl, session });
  await api.login('t1', '274915');
  local.setItem(core.ME_KEY, 't1');
  const { payload } = core.buildPayload(EVENT, [row({ consent: true }), row({ student_name: 'Примерова Анна Сергеевна' })], { me: 't1' });
  const res = await api.post('/records', payload);
  assert.deepEqual(res.ids, ['r1', 'r2']);
  const sent = server.calls.find((c) => c.url === 'https://api.example/records');
  assert.equal(sent.headers.Authorization, 'Bearer tok123');
  assert.equal(sent.cache, 'no-store');
  const dump = (store) => [core.SESSION_KEY, core.ME_KEY].map((k) => store.getItem(k) || '').join('|');
  for (const store of [session, local]) {
    for (const name of ['Тестов', 'Примерова', 'Пётр', 'Анна']) assert.ok(!dump(store).includes(name), name);
    assert.ok(!dump(store).includes('274915'), 'PIN не хранится');
  }
  assert.deepEqual(Object.keys(JSON.parse(session.getItem(core.SESSION_KEY))).sort(), ['expires_at', 'staff', 'token']);
});

test('401 clears the session; expired session is dropped', async () => {
  const server = fakeServer();
  const session = core.memoryStore();
  const api = core.createApi({ base: 'https://api.example', fetchImpl: server.fetchImpl, session });
  await api.login('t1', '274915');
  assert.ok(api.current());
  await assert.rejects(api.get('/records/mine?year=2026'), (e) => e.status === 401);
  assert.equal(api.current(), null);
  session.setItem(core.SESSION_KEY, JSON.stringify({ token: 'x', expires_at: 1, staff: {} }));
  assert.equal(api.current(), null);
});

test('diploma upload: type and size checked before asking for a link, PUT carries the content type', async () => {
  const server = fakeServer();
  const api = core.createApi({ base: 'https://api.example', fetchImpl: server.fetchImpl, session: core.memoryStore() });
  await api.login('t1', '274915');
  await assert.rejects(api.uploadDiploma('r1', { type: 'image/gif', size: 10 }));
  await assert.rejects(api.uploadDiploma('r1', { type: 'image/jpeg', size: 11 * 1024 * 1024 }));
  assert.ok(!server.calls.some((c) => c.url.endsWith('/diploma-upload-url')));
  const blob = { type: 'image/jpeg', size: 1234 };
  assert.equal(await api.uploadDiploma('r1', blob), true);
  const ask = server.calls.find((c) => c.url.endsWith('/diploma-upload-url'));
  assert.deepEqual(JSON.parse(ask.body), { record_id: 'r1', content_type: 'image/jpeg', size: 1234 });
  const put = server.calls.find((c) => c.method === 'PUT');
  assert.equal(put.headers['Content-Type'], 'image/jpeg');
  assert.equal(put.headers.Authorization, undefined, 'токен не уходит в хранилище');
});

test('no API address — a clear message, no request', async () => {
  const server = fakeServer();
  const api = core.createApi({ base: '', fetchImpl: server.fetchImpl, session: core.memoryStore() });
  await assert.rejects(api.staffList(), /не подключён/);
  assert.equal(server.calls.length, 0);
});

test('private achievement pages never persist pupil data or use the service worker cache', async () => {
  const listeners = {};
  const origin = 'https://school.example';
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  vm.runInNewContext(sw, {
    self: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    URL, location: { origin },
    fetch: (request, options) => Promise.resolve({ request, options, clone: () => ({}) }),
    caches: { open: async () => ({ put: async () => {} }) },
  });
  const pages = ['achievements-form', 'achievements-review', 'achievements-contests'];
  for (const url of [...pages.flatMap((page) => [page + '.html', page + '.js']), 'achievements-contests.css']) {
    const request = { url: origin + '/' + url + '?v=1', method: 'GET' };
    let response;
    listeners.fetch({ request, respondWith: (pending) => { response = pending; } });
    assert.equal((await response).options?.cache, 'no-store', url);
  }
  for (const page of pages) {
    const file = page + '.js';
    const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/localStorage|sessionStorage/.test(src), file);
    assert.ok(fs.readFileSync(path.join(root, page + '.html'), 'utf8').includes('name="robots" content="noindex'), page);
  }
  const shell = sw.match(/const SHELL=\[(.*?)\]/)[1];
  assert.ok(!/achievements/.test(shell));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (err) { failed += 1; console.error(`FAIL - ${name}\n${err.stack}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
