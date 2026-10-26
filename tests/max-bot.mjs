// MAX bot worker (max-worker/src/index.js) end to end: SQLite stands in for D1, Google Sheets
// and the MAX API are answered from memory. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../max-worker/src/index.js';

const schemaSql = fs.readFileSync(new URL('../max-worker/schema.sql', import.meta.url), 'utf8');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
    exec: () => db.prepare(sql).run(...args)
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s.exec()), sqlite: db };
}

// The next weekday after today in Moscow, so the date is always a school day ahead.
const iso = (d) => d.toISOString().slice(0, 10);
const moscowToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let day = new Date(`${moscowToday}T12:00:00Z`);
do day = new Date(day.getTime() + 86400000); while ([0, 6].includes(day.getUTCDay()));
const DATE = iso(day), RU = DATE.split('-').reverse().join('.');

const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const lesson = (cls, n, text) => [cls, String(n), ...DAYS.map(() => text)];
const CLASSES = ['5А', '5Б', '6А', '7Б', '8В', '9А', '10А'];
function baseSheets() {
  return {
    'Расписание': [['Класс', 'Урок', ...DAYS], ...CLASSES.flatMap((c) => [1, 2, 3, 4, 5].map((n) => lesson(c, n, `Предмет ${n} (30${n})`)))],
    'Учителя': [['ФИО', 'УРОК', ...DAYS], ['Иванова А.А.', '1', ...DAYS.map(() => '7Б|Рус|301')]],
    'Изменения': [['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание']],
    'Изменения_учителей': [['Дата', 'Учитель', 'Урок', 'Тип', 'Класс', 'Предмет', 'Кабинет', 'Примечание']],
    'Статус_публикации': [['Дата', 'Опубликовано', 'Учителя', 'Ученики']],
    'Оповещения': [['ID', 'Опубликовано', 'Заголовок', 'Текст', 'Тип', 'Начало', 'Окончание', 'Картинка', 'Файлы JSON', 'Текст кнопки', 'Ссылка', 'Аудитория', 'Активно', 'Классы', 'Рассылка в бот']]
  };
}

function setup() {
  const sheets = baseSheets(), sent = [], DB = d1();
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('sheets.googleapis.com')) {
      const name = decodeURIComponent(u.match(/\/values\/([^?]+)/)[1]);
      return sheets[name] ? new Response(JSON.stringify({ values: sheets[name] }), { status: 200 }) : new Response('{}', { status: 400 });
    }
    if (u.includes('platform-api.max.ru')) { sent.push({ url: u, body: JSON.parse(options.body || '{}') }); return new Response('{}', { status: 200 }); }
    return new Response('ok', { status: 200 });
  };
  const env = { DB, BOT_TOKEN: 't', WEBHOOK_SECRET: 's', SPREADSHEET_ID: 'x', SHEETS_API_KEY: 'k', TIME_ZONE: 'Europe/Moscow' };
  async function update(body) {
    const jobs = [];
    const res = await worker.fetch(new Request('https://bot/webhook', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': 's' }, body: JSON.stringify(body) }), env, { waitUntil: (p) => jobs.push(p) });
    assert.equal(res.status, 200);
    await Promise.all(jobs);
    return sent[sent.length - 1];
  }
  const press = (userId, payload) => update({ update_type: 'message_callback', callback: { callback_id: `cb-${payload}`, payload, user: { user_id: userId } } });
  const text = (m) => (m.body.message ? m.body.message.text : m.body.text);
  async function cron() { const jobs = []; await worker.scheduled({}, env, { waitUntil: (p) => jobs.push(p) }); await Promise.all(jobs); }
  return { sheets, sent, env, DB, update, press, text, cron };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a parent adds two classes and sees both days at once', async () => {
  const b = setup();
  assert.match(b.text(await b.update({ update_type: 'bot_started', user: { user_id: 1 } })), /Чьё расписание показывать/);
  assert.match(b.text(await b.press(1, 'add:class')), /Выберите класс/);
  assert.match(b.text(await b.press(1, `class:${CLASSES.indexOf('7Б')}`)), /Добавлено: класс 7Б[^]*Мои подписки[^]*Класс 7Б/);
  const second = b.text(await b.press(1, `class:${CLASSES.indexOf('9А')}`));
  assert.match(second, /Класс 7Б\n• Класс 9А/);
  assert.match(b.text(await b.press(1, `class:${CLASSES.indexOf('9А')}`)), /класс 9А — уже в подписках/);
  const day = b.text(await b.press(1, `day:${DATE}`));
  assert.match(day, /\*\*7Б · [^]*\*\*9А · /);
  assert.equal(b.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id=?').get('1').n, 2);
});

test('each subscribed class gets its own notice, with when to come', async () => {
  const b = setup();
  await b.press(1, `class:${CLASSES.indexOf('7Б')}`);
  await b.press(1, `class:${CLASSES.indexOf('9А')}`);
  b.sheets['Изменения'].push([RU, '7Б', '1', 'отмена', ''], [RU, '9А', '3', 'Химия (210)', '']);
  b.sheets['Статус_публикации'].push([RU, 46000.5, 0, 2]);
  const before = b.sent.length;
  await b.cron();
  const notes = b.sent.slice(before).map(b.text);
  assert.equal(notes.length, 2);
  const seven = notes.find((t) => t.includes('· 7Б**')), nine = notes.find((t) => t.includes('· 9А**'));
  assert.match(seven, /\*\*Приходить к 08:50 — к 2-му уроку \(обычно к 08:00\)\*\*/);
  assert.match(seven, /\*\*1 урок\*\* — отменён/);
  assert.match(nine, /\*\*3 урок\*\* — Химия · каб\. 210/);
  assert.doesNotMatch(nine, /Приходить/);
  await b.cron();
  assert.equal(b.sent.length, before + 2, 'the same publication is not sent twice');
});

test('a shortened day uses its own bell times in the notice', async () => {
  const b = setup();
  await b.press(1, `class:${CLASSES.indexOf('7Б')}`);
  const short = ['08:00–08:30', '08:40–09:10', '09:25–09:55', '10:10–10:40', '10:50–11:20', '11:30–12:00', '12:10–12:40', '12:50–13:20', '13:30–14:00', '14:10–14:40', '14:50–15:20', '15:30–16:00'];
  b.sheets['Звонки'] = [['Урок', 'Основное', 'Сокращённое'], ...short.map((x, i) => [String(i + 1), '', x])];
  b.sheets['Звонки_даты'] = [['Дата', 'Вариант'], [RU, 'Сокращённое']];
  b.sheets['Изменения'].push([RU, '7Б', '5', 'отмена', '']);
  b.sheets['Статус_публикации'].push([RU, 46000.5, 0, 1]);
  const before = b.sent.length;
  await b.cron();
  const note = b.text(b.sent[before]);
  assert.match(note, / · сокращённые уроки/);
  assert.match(note, /\*\*Уроки до 10:40 — последний 4-й \(обычно до 11:20\)\*\*/);
});

test('subscriptions can be removed and are limited to six', async () => {
  const b = setup();
  for (const c of CLASSES.slice(0, 6)) await b.press(2, `class:${CLASSES.indexOf(c)}`);
  assert.match(b.text(await b.press(2, `class:${CLASSES.indexOf('10А')}`)), /Можно не больше 6 подписок/);
  assert.match(b.text(await b.press(2, 'del:0')), /Убрано: класс 5А/);
  assert.equal(b.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id=?').get('2').n, 5);
  assert.match(b.text(await b.press(2, 'add:teacher')), /Выберите преподавателя/);
  assert.match(b.text(await b.press(2, 'teacher:0')), /Добавлено: учитель Иванова А\.А\.[^]*Учитель: Иванова А\.А\.\n• Класс 5Б/);
});

test('v0.2 profiles keep their class or teacher after the schema update', async () => {
  const b = setup(), db = b.DB.sqlite;
  db.prepare("INSERT INTO profiles(user_id,role,teacher,class_name,notifications,created_at,updated_at) VALUES('7','student',NULL,'8В',1,'2026-10-01','2026-10-01')").run();
  db.prepare("INSERT INTO profiles(user_id,role,teacher,class_name,notifications,created_at,updated_at) VALUES('8','teacher','Иванова А.А.',NULL,1,'2026-10-01','2026-10-01')").run();
  db.prepare(`INSERT INTO delivery_state(user_id,date_iso,content_hash,updated_at) VALUES('7','${DATE}','abc','2026-10-01')`).run();
  db.exec(schemaSql);
  db.exec(schemaSql);
  assert.deepEqual(db.prepare('SELECT user_id,kind,value FROM subscriptions ORDER BY user_id').all().map((r) => ({ ...r })), [{ user_id: '7', kind: 'class', value: '8В' }, { user_id: '8', kind: 'teacher', value: 'Иванова А.А.' }]);
  assert.equal(db.prepare('SELECT target FROM deliveries WHERE user_id=?').get('7').target, 'c:8В');
  assert.match(b.text(await b.press(7, 'profile')), /• Класс 8В/);
  assert.match(b.text(await b.press(7, 'role:student')), /Выберите класс/);
});

// A notice row as the panel writes it; dates around today so it is active.
const ruOf = (d) => iso(d).split('-').reverse().join('.');
const TODAY_RU = ruOf(new Date(`${moscowToday}T12:00:00Z`)), WEEK_RU = ruOf(new Date(Date.parse(`${moscowToday}T12:00:00Z`) + 7 * 86400000));
const notice = (id, { title = id, text = '', level = 'info', audience = 'all', classes = '', bot = 'true', url = '', files = [] } = {}) =>
  [id, '', title, text, level, TODAY_RU, WEEK_RU, '', JSON.stringify(files), url ? 'Открыть' : '', url, audience, 'true', classes, bot];

// Moscow wall clock for the cron: the worker reads new Date() when it runs.
function at(hour, fn) {
  const Real = Date, fixed = Date.parse(`${moscowToday}T${String(hour - 3).padStart(2, '0')}:30:00Z`);
  globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  return Promise.resolve(fn()).finally(() => { globalThis.Date = Real; });
}

async function people(b) {
  await b.press(11, `class:${CLASSES.indexOf('9А')}`);
  await b.press(12, `class:${CLASSES.indexOf('7Б')}`);
  await b.press(13, 'teacher:0');
  await b.press(14, `class:${CLASSES.indexOf('9А')}`);
  await b.press(14, 'notifications');
}
const sentTo = (b, from) => b.sent.slice(from).filter((m) => m.url.includes('/messages?user_id=')).map((m) => [m.url.match(/user_id=(\d+)/)[1], b.text(m)]);

test('an announcement for 9А reaches only its subscribers, once', async () => {
  const b = setup();
  await people(b);
  b.sheets['Оповещения'].push(notice('n1', { title: 'Собрание 9А', text: 'В четверг в 18:00, каб. 404', level: 'important', audience: 'students', classes: '9А' }));
  const before = b.sent.length;
  await at(12, () => b.cron());
  const got = sentTo(b, before);
  assert.deepEqual(got.map(([u]) => u), ['11'], 'user 14 has notifications off, 12 is in 7Б, 13 follows a teacher');
  assert.match(got[0][1], /🟠 \*\*Собрание 9А\*\*\n_9А_\n\nВ четверг в 18:00, каб\. 404/);
  await at(12, () => b.cron());
  assert.equal(sentTo(b, before).length, 1);
  assert.equal(b.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM bot_state WHERE key='notice-done:n1'").get().n, 1);
});

test('everyone gets a notice for all; ordinary ones wait for the morning, urgent ones do not', async () => {
  const b = setup();
  await people(b);
  b.sheets['Оповещения'].push(notice('n2', { title: 'Отмена занятий', level: 'urgent', url: 'https://sosh20tver.ru/' }), notice('n3', { title: 'Неделя книги' }), notice('n4', { title: 'Только на сайте', bot: '' }));
  const before = b.sent.length;
  await at(23, () => b.cron());
  const night = sentTo(b, before);
  assert.deepEqual(night.map(([u, t]) => `${u}:${t.match(/\*\*(.*?)\*\*/)[1]}`).sort(), ['11:Отмена занятий', '12:Отмена занятий', '13:Отмена занятий']);
  const urgent = b.sent[before];
  assert.deepEqual(urgent.body.attachments[0].payload.buttons[0], [{ type: 'link', text: 'Открыть', url: 'https://sosh20tver.ru/' }]);
  await at(8, () => b.cron());
  assert.deepEqual(sentTo(b, before + night.length).map(([u, t]) => `${u}:${t.match(/\*\*(.*?)\*\*/)[1]}`).sort(), ['11:Неделя книги', '12:Неделя книги', '13:Неделя книги']);
});

test('«Объявления» lists every notice for the user, five per page, and opens each in full', async () => {
  const b = setup();
  await b.press(21, `class:${CLASSES.indexOf('9А')}`);
  for (let i = 1; i <= 6; i += 1) b.sheets['Оповещения'].push(notice(`a${i}`, { title: `Новость ${i}`, text: `Текст ${i}`, bot: '' }));
  b.sheets['Оповещения'].push(notice('t1', { title: 'Для учителей', audience: 'teachers' }), notice('c7', { title: 'Для 7Б', classes: '7Б' }));
  const page1 = await b.press(21, 'notices');
  assert.match(b.text(page1), /^\*\*Объявления\*\* · 1 из 2\n\n🔵 \*\*Новость 6\*\*\nТекст 6/);
  assert.doesNotMatch(b.text(page1), /Для учителей|Для 7Б/);
  const buttons = page1.body.message.attachments[0].payload.buttons;
  assert.deepEqual(buttons[0], [{ type: 'callback', text: 'Открыть: Новость 6', payload: 'notice:a6' }]);
  assert.deepEqual(buttons[5], [{ type: 'callback', text: '→', payload: 'notices:1' }]);
  assert.match(b.text(await b.press(21, 'notices:1')), /2 из 2[^]*Новость 1/);
  assert.match(b.text(await b.press(21, 'notice:a3')), /🔵 \*\*Новость 3\*\*\n\nТекст 3/);
  assert.match(b.text(await b.press(21, 'notice:gone')), /Объявление снято/);
});

test('/stats gives totals and reach without names', async () => {
  const b = setup();
  await people(b);
  await b.press(11, `class:${CLASSES.indexOf('5А')}`);
  const res = await worker.fetch(new Request('https://bot/stats?audience=students&classes=9%D0%90'), b.env, { waitUntil() {} });
  const s = await res.json();
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(s.people, 4);
  assert.equal(s.notificationsOn, 3);
  assert.equal(s.parents, 3);
  assert.equal(s.teachers, 1);
  assert.equal(s.severalClasses, 1);
  assert.deepEqual(s.classes, { '9А': 2, '7Б': 1, '5А': 1 });
  assert.equal(s.reach, 1);
  assert.doesNotMatch(JSON.stringify(s), /Иванова|"1[1-4]"/);
});

(async () => {
  for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
  console.log(`${tests.length} MAX bot checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
