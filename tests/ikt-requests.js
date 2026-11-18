'use strict';
// «Заявки по ИКТ» (apps-script/IctRequests.gs): a teacher's request, the deputy's login and list.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./schedule-fixture');

const root = path.join(__dirname, '..');

// The schedule fixture plus what the ИКТ module needs: a private spreadsheet made by
// SpreadsheetApp.create, a Drive folder and a settable clock.
function ictHarness() {
  const h = createHarness();
  const ctx = h.context;
  const props = ctx.PropertiesService.getScriptProperties();
  props.setProperty('STAFF_PIN', '2468');
  props.setProperty('IKT_PIN', '135790');
  props.setProperty('LATE_PIN', '5555');
  const privateSheets = new Map();
  const privateSs = { getId: () => 'ict-private', getSheetByName: (n) => privateSheets.get(n) || null, insertSheet: (n) => { const s = h.put(`__ict:${n}`, []); privateSheets.set(n, s); return s; } };
  const publicSs = ctx.SpreadsheetApp.openById('fixture');
  let created = 0;
  ctx.SpreadsheetApp.openById = (id) => (id === 'ict-private' ? privateSs : publicSs);
  ctx.SpreadsheetApp.create = () => { created += 1; return privateSs; };
  const files = [];
  ctx.DriveApp = {
    getFolderById: () => { throw new Error('no folder'); },
    createFolder: () => ({ getId: () => 'folder-1', createFile: (blob) => { files.push(blob); return { getId: () => `file-${files.length}` }; } }),
    getFileById: (id) => ({ getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => files[Number(id.split('-')[1]) - 1].bytes }) }),
  };
  ctx.Utilities.base64Decode = (s) => Array.from(Buffer.from(s, 'base64'));
  ctx.Utilities.base64Encode = (bytes) => Buffer.from(bytes).toString('base64');
  ctx.Utilities.newBlob = (bytes, type, name) => ({ bytes, type, name });
  ctx.Utilities.sleep = () => {};
  ctx.ContentService = { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/IctRequests.gs'), 'utf8'), ctx, { filename: 'IctRequests.gs' });
  const post = (body) => h.plain(ctx.handleIctPost_(body));
  const request = (extra = {}) => post({ action: 'ictRequest', pin: '2468', teacher: h.names[0], type: 'tech', room: '209', device: 'Проектор', text: 'Не включается', urgency: 'yellow', ...extra });
  return { h, ctx, props, post, request, files, privateSheets, created: () => created };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a request goes to a private spreadsheet, not to the one the site reads', () => {
  const t = ictHarness();
  const r = t.request();
  assert.match(r.code, /^[A-Z2-9]{6}$/);
  assert.deepEqual({ ...r, code: undefined }, { ok: true, id: '0001', type: 'tech', executor: 'engineer', urgency: 'yellow', code: undefined });
  assert.equal(t.created(), 1);
  assert.equal(t.props.getProperty('ICT_SPREADSHEET_ID'), 'ict-private');
  assert.equal(t.h.sheets.get('Заявки_ИКТ'), undefined, 'nothing in the public spreadsheet');
  const rows = t.privateSheets.get('Заявки_ИКТ').rows;
  assert.equal(rows[0].length, 18);
  assert.equal(rows[1][0], "'0001");
  assert.equal(rows[1][10], 'new');
  assert.equal(t.request({ type: 'question', room: '', device: 'Сферум', text: 'Как создать чат класса?' }).executor, 'ikt');
  const third = t.request();
  assert.equal(third.id, '0003');
  assert.equal(third.code, r.code, 'one MAX code per teacher');
  assert.notEqual(t.request({ teacher: t.h.names[1] }).code, r.code);
  assert.equal(t.created(), 1, 'the private spreadsheet is created once');
});

test('the teachers’ PIN, the teacher, the room, the text and the rate are checked', () => {
  const t = ictHarness();
  assert.equal(t.request({ pin: '0000' }).error, 'Неверный PIN');
  assert.equal(t.request({ pin: '0000' }).pin, true);
  assert.match(t.request({ teacher: 'Чужой Ч.Ч.' }).error, /фамилию/);
  assert.match(t.request({ room: '999' }).error, /кабинета нет/);
  assert.equal(t.request({ room: 'каб. 304' }).ok, true, 'rooms of a group lesson «304/305» are both known');
  assert.equal(t.request({ room: '305' }).ok, true);
  assert.match(t.request({ room: '' }).error, /кабинет/);
  assert.match(t.request({ device: 'Чайник' }).error, /устройство/);
  assert.match(t.request({ text: 'x'.repeat(1001) }).error, /1000/);
  assert.match(t.request({ urgency: 'purple' }).error, /срочность/);
  assert.match(t.request({ photo: { data: 'AAAA', type: 'application/pdf' } }).error, /картинкой/);
  // «Помещения»: rooms that are not in the timetable.
  t.h.put('Помещения', [['Помещение'], ['Библиотека'], ['Актовый зал']]);
  assert.equal(t.request({ room: 'библиотека' }).ok, true);
  const rows = t.privateSheets.get('Заявки_ИКТ').rows;
  assert.equal(rows[rows.length - 1][4], 'Библиотека');
  // At most 10 requests an hour from one teacher (3 were accepted above).
  for (let i = 0; i < 7; i += 1) assert.equal(t.request().ok, true);
  assert.match(t.request().error, /за час/);
  assert.equal(t.request({ teacher: t.h.names[1] }).ok, true, 'another teacher is not limited');
});

test('20 wrong PINs pause requests for everyone', () => {
  const t = ictHarness();
  for (let i = 0; i < 20; i += 1) t.request({ pin: '1111' });
  assert.match(t.request().error, /15 минут/);
});

test('a photo is stored in the Drive folder; the deputy gets it back', () => {
  const t = ictHarness();
  const data = Buffer.from('fake-jpeg-bytes').toString('base64');
  const r = t.request({ photo: { data: `data:image/jpeg;base64,${data}`, type: 'image/jpeg' } });
  assert.equal(r.ok, true);
  assert.equal(t.files[0].name, '0001.jpg');
  assert.equal(t.props.getProperty('ICT_PHOTOS_FOLDER_ID'), 'folder-1');
  const token = t.post({ action: 'iktLogin', pin: '135790' }).token;
  const list = t.post({ action: 'iktList', token, filter: {} });
  assert.equal(list.items[0].hasPhoto, true);
  assert.equal(list.items[0].photo, undefined, 'the Drive link is not sent to the page');
  assert.equal(t.post({ action: 'iktPhoto', token, id: '1' }).data, data);
});

test('the deputy logs in with IKT_PIN; the token is not a panel session', () => {
  const t = ictHarness();
  assert.equal(t.post({ action: 'iktList', token: 'fixture-token' }).auth, true, 'the panel token does not open the ИКТ page');
  assert.equal(t.post({ action: 'iktLogin', pin: '2468' }).error, 'Неверный PIN');
  const login = t.post({ action: 'iktLogin', pin: '135790' });
  assert.equal(login.ok, true);
  assert.throws(() => t.ctx.assertSession_(login.token), /Сессия истекла/, 'the ИКТ token does not open the panel');
  assert.equal(t.post({ action: 'iktStats', token: login.token }).ok, true);
  t.post({ action: 'iktLogout', token: login.token });
  assert.equal(t.post({ action: 'iktStats', token: login.token }).auth, true);
  t.props.setProperty('IKT_PIN', '1234');
  assert.match(t.post({ action: 'iktLogin', pin: '1234' }).error, /6–8 цифр/);
  t.props.setProperty('ADMIN_PIN', '123456'); t.props.setProperty('IKT_PIN', '123456');
  assert.match(t.post({ action: 'iktLogin', pin: '123456' }).error, /не должен совпадать/);
});

test('the session ends 12 hours after the login', () => {
  const t = ictHarness();
  const token = t.post({ action: 'iktLogin', pin: '135790' }).token;
  const cache = t.ctx.CacheService.getScriptCache();
  cache.put(`ikt:${token}`, String(t.ctx.Date.now() - 11 * 3600000));
  assert.equal(t.post({ action: 'iktStats', token }).ok, true);
  cache.put(`ikt:${token}`, String(t.ctx.Date.now() - 13 * 3600000));
  assert.equal(t.post({ action: 'iktStats', token }).auth, true);
});

test('the deputy sets the teachers’ PIN, never equal to another PIN', () => {
  const t = ictHarness();
  const token = t.post({ action: 'iktLogin', pin: '135790' }).token;
  assert.match(t.post({ action: 'iktSetStaffPin', token, pin: '12' }).error, /4 до 8/);
  assert.match(t.post({ action: 'iktSetStaffPin', token, pin: '1234' }).error, /другого входа/, 'ADMIN_PIN');
  assert.match(t.post({ action: 'iktSetStaffPin', token, pin: '5555' }).error, /другого входа/, 'LATE_PIN');
  assert.equal(t.post({ action: 'iktSetStaffPin', token, pin: '7777' }).ok, true);
  assert.equal(t.request({ pin: '7777' }).ok, true);
});

test('list filters: type, open/closed, urgency, room, teacher search; open 🔴 first', () => {
  const t = ictHarness();
  t.request({ urgency: 'white', text: 'первая' });
  t.request({ type: 'question', room: '', device: 'Почта', urgency: 'yellow', teacher: t.h.names[1], text: 'вторая' });
  t.request({ urgency: 'red', room: '210', text: 'третья' });
  t.request({ urgency: 'red', room: '301', text: 'четвёртая' });
  const token = t.post({ action: 'iktLogin', pin: '135790' }).token;
  const ids = (filter) => t.post({ action: 'iktList', token, filter }).items.map((x) => x.id);
  // Same minute in the fixture clock: open 🔴 first, then by number (all created together).
  assert.deepEqual(ids({}).slice(0, 2).sort(), ['0003', '0004']);
  assert.deepEqual(ids({ type: 'question' }), ['0002']);
  assert.deepEqual(ids({ urgency: 'red' }).sort(), ['0003', '0004']);
  assert.deepEqual(ids({ room: 'Каб. 210' }), ['0003']);
  assert.deepEqual(ids({ q: 'петров' }), ['0002']);
  assert.deepEqual(ids({ q: '301' }), ['0004']);
  assert.equal(t.post({ action: 'iktUpdate', token, id: '0004', status: 'done', comment: 'Дала переносной проектор' }).ok, true);
  assert.deepEqual(ids({ status: 'closed' }), ['0004']);
  assert.equal(ids({ status: 'open' }).includes('0004'), false);
  assert.deepEqual(ids({ from: '2026-09-26' }), []);
  assert.equal(ids({ from: '2026-09-25', to: '2026-09-25' }).length, 4);
  const stats = t.post({ action: 'iktStats', token }).stats;
  assert.deepEqual(stats, { fresh: 3, red: 1, questions: 1, techQueue: 2, closedWeek: 1, total: 4 });
});

test('changes by the deputy are written to the history; closing and reopening', () => {
  const t = ictHarness();
  t.request({ type: 'question', room: '', device: 'Электронный журнал', text: 'Не вижу класс' });
  const token = t.post({ action: 'iktLogin', pin: '135790' }).token;
  const up = (extra) => t.post({ action: 'iktUpdate', token, id: '0001', ...extra });
  assert.equal(up({ status: 'in_work' }).item.status, 'in_work');
  const answered = up({ status: 'answered', comment: 'Откройте «Мои классы» → обновить' }).item;
  assert.ok(answered.closed);
  assert.deepEqual(answered.history.map((x) => x.what), ['заявка создана', 'статус: в работе', 'статус: дан ответ; ответ: Откройте «Мои классы» → обновить']);
  assert.equal(answered.history[1].by, 'зам по ИКТ');
  const moved = up({ status: 'transferred', executor: 'engineer', urgency: 'red' }).item;
  assert.equal(moved.closed, '', 'reopened');
  assert.match(moved.history[3].what, /передана инженеру; срочность: 🔴/);
  assert.equal(up({ status: 'postponed', postponedTo: '2026-10-03' }).item.postponedTo, '2026-10-03');
  assert.equal(up({ status: 'teleported' }).error, 'Неизвестный статус');
  assert.match(t.post({ action: 'iktUpdate', token, id: '0099', status: 'done' }).error, /не найдена/);
  const row = t.privateSheets.get('Заявки_ИКТ').rows[1];
  assert.equal(row[12], '03.10.2026');
  assert.equal(JSON.parse(row[16]).length, 5);
});

test('the bot: secret, feed with holidays, the engineer’s marks, MAX binding, «учитель уведомлён»', () => {
  const t = ictHarness();
  const first = t.request({ urgency: 'red' });
  t.request({ room: '210', device: 'Принтер / МФУ' });
  t.request({ type: 'question', room: '', device: 'Почта', text: 'Не приходят письма' });
  assert.equal(t.post({ action: 'ictBotFeed', secret: 'x' }).error, 'forbidden', 'no ICT_SECRET yet');
  t.props.setProperty('ICT_SECRET', 's3cret-s3cret-s3cret');
  assert.equal(t.post({ action: 'ictBotFeed', secret: 'wrong-wrong-wrong-wrong' }).error, 'forbidden');
  t.h.put('Календарь', [['Дата начала', 'Дата окончания', 'Название'], ['04.11.2026', '04.11.2026', 'День народного единства'], ['30.12.2026', '11.01.2027', 'Зимние каникулы']]);
  const bot = (body) => t.post({ secret: 's3cret-s3cret-s3cret', ...body });
  const feed = bot({ action: 'ictBotFeed' });
  assert.equal(feed.items.length, 3);
  assert.equal(feed.items[0].code, undefined, 'codes are not sent to the bot');
  assert.deepEqual(feed.holidays[1], { from: '2026-12-30', to: '2027-01-11', title: 'Зимние каникулы' });
  // ✅ for two duplicates at once; 🚫 goes to the deputy and stays open; ➡️ needs a date.
  const done = bot({ action: 'ictBotMark', ids: ['0001', '0002'], result: 'done' });
  assert.deepEqual(done.items.map((x) => x.status), ['done', 'done']);
  assert.equal(done.items[0].history.at(-1).by, 'инженер');
  const no = bot({ action: 'ictBotMark', ids: ['0002'], result: 'cannot_fix', comment: 'Нужен новый картридж' });
  assert.equal(no.items[0].executor, 'ikt');
  assert.equal(no.items[0].closed, '', '«нет возможности» stays open for the deputy');
  assert.match(bot({ action: 'ictBotMark', ids: ['0001'], result: 'postponed' }).error, /дату/);
  assert.equal(bot({ action: 'ictBotMark', ids: ['0001'], result: 'postponed', postponedTo: '2026-10-03' }).items[0].postponedTo, '2026-10-03');
  assert.equal(bot({ action: 'ictBotMark', ids: ['0001'], result: 'teleport' }).error, 'Неизвестная отметка');
  // Binding: the code from the form tells whose MAX profile it is.
  assert.equal(bot({ action: 'ictBotLink', code: first.code.toLowerCase() }).teacher, t.h.names[0]);
  assert.equal(bot({ action: 'ictBotLink', code: 'ZZZZZZ' }).ok, false);
  assert.equal(bot({ action: 'ictBotNotified', ids: ['0001', '3'], value: 'да' }).count, 2);
  const rows = t.privateSheets.get('Заявки_ИКТ').rows;
  assert.equal(rows[1][15], 'да');
  assert.equal(rows[2][15], '');
  assert.equal(bot({ action: 'ictBotPhoto', id: '0001' }).ok, false);
});

test('doPost sends ИКТ actions to the module and keeps the others', () => {
  const t = ictHarness();
  const call = (body) => t.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } });
  assert.equal(JSON.parse(call({ action: 'iktLogin', pin: '135790' })).ok, true);
  assert.equal(JSON.parse(call({ action: 'ictRequest', pin: '2468', teacher: t.h.names[0], type: 'tech', room: '209', device: 'Проектор', text: 'Не работает', urgency: 'red' })).id, '0001');
});

test('the form and the server offer the same devices and topics', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ict-core.js'), 'utf8'), ctx);
  const t = ictHarness();
  assert.equal(JSON.stringify(ctx.window.IctCore.DEVICES.map((x) => x.value)), JSON.stringify(vm.runInContext('ICT.devices', t.ctx)));
  assert.equal(JSON.stringify(ctx.window.IctCore.TOPICS.map((x) => x.value)), JSON.stringify(vm.runInContext('ICT.topics', t.ctx)));
});

test('site: rooms come from the timetable and «Помещения», sorted, without duplicates', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ict-core.js'), 'utf8'), ctx);
  const core = ctx.window.IctCore;
  const teachers = [['ФИО', 'УРОК', 'ПН'], ['Иванов И.И.', 1, '5А|Мат|209'], ['Иванов И.И.', 2, '5А|ТРУД|Мастерские'], ['Петров П.П.', 1, '1Б|Ф-РА|']];
  const schedule = [['Класс', 'Урок', 'ПН'], ['5А', 1, 'Английский язык (304/305)'], ['5Б', 1, 'Математика (209)'], ['10А', 1, 'Физика (31)'], ['11А', 1, 'ИИ-ИБ (актовый зал)']];
  const extra = [['Помещение'], ['Библиотека'], ['актовый зал']];
  assert.deepEqual(Array.from(core.roomsFrom(teachers, schedule, extra)), ['31', '209', '304', '305', 'Актовый зал', 'Библиотека', 'Мастерские']);
  assert.equal(core.roomKey('Каб. 211'), core.roomKey('211'));
  assert.equal(core.floor('304'), '3');
  assert.equal(core.floor('Библиотека'), '');
  assert.deepEqual({ ...core.fitBox(4000, 3000, 1600) }, { width: 1600, height: 1200 });
  assert.deepEqual({ ...core.fitBox(800, 600, 1600) }, { width: 800, height: 600 });
});

test('site: how long a request waits, in words', () => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ict-core.js'), 'utf8'), ctx);
  const age = (min) => ctx.window.IctCore.age(new Date(Date.UTC(2026, 8, 25, 10, 0) - min * 60000).toISOString(), new Date(Date.UTC(2026, 8, 25, 10, 0)));
  assert.equal(age(0.5), 'только что');
  assert.equal(age(5), '5 мин');
  assert.equal(age(125), '2 ч');
  assert.equal(age(60 * 49), '2 дн');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (err) { failed += 1; console.error(`✗ ${name}\n  ${err.stack}`); }
  }
  if (failed) { console.error(`${failed} of ${tests.length} ИКТ checks failed`); process.exit(1); }
  console.log(`${tests.length} ИКТ checks passed`);
})();
