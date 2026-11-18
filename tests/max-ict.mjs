// «Заявки по ИКТ» in the MAX bot (max-worker/src/ict.js): timing rules, the Friday list, the
// engineer's buttons, Monday reports, the deputy's notifications. SQLite stands in for D1,
// Apps Script and MAX are answered from memory, the clock is set by each step. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../max-worker/src/index.js';
import * as ict from '../max-worker/src/ict.js';

const schemaSql = fs.readFileSync(new URL('../max-worker/schema.sql', import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
    exec: () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s.exec()), sqlite: db };
}

const at = (iso, hhmm) => ict.atMsk(iso, hhmm);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* Timing ------------------------------------------------------------------------ */

// Week of Monday 2026-11-23 (Friday 27.11, Saturday 28.11).
const MON = '2026-11-23';
const item = (over) => ({ id: '0001', created: new Date(at(MON, '10:00')).toISOString(), type: 'tech', teacher: 'Иванова А.А.', room: '211', device: 'Проектор', text: 'Не включается', urgency: 'yellow', executor: 'engineer', status: 'new', comment: '', postponedTo: '', history: [], ...over });

test('the deputy hears about 🔴 at once in the day, the rest in working time or at the next slot', () => {
  const due = (iso, hhmm, urgency, mode = 'instant', holidays = []) => new Date(ict.iktDueAt(item({ created: new Date(at(iso, hhmm)).toISOString(), urgency }), mode, holidays)).toISOString();
  const iso = (d, t) => new Date(at(d, t)).toISOString();
  assert.equal(due(MON, '10:00', 'red'), iso(MON, '10:00'));
  assert.equal(due(MON, '22:30', 'red'), iso('2026-11-24', '07:00'));
  assert.equal(due('2026-11-28', '06:10', 'red'), iso('2026-11-28', '07:00'), 'Saturday too');
  assert.equal(due('2026-11-27', '16:59', 'yellow'), iso('2026-11-27', '16:59'));
  assert.equal(due('2026-11-27', '17:00', 'white'), iso('2026-11-30', '08:00'), 'Friday evening → Monday');
  assert.equal(due('2026-11-28', '12:00', 'yellow', 'instant', [{ from: '2026-11-30', to: '2026-11-30' }]), iso('2026-12-01', '08:00'), 'Monday off → Tuesday');
  assert.equal(due(MON, '07:15', 'yellow'), iso(MON, '08:00'));
  assert.equal(due(MON, '10:05', 'yellow', 'digest'), iso(MON, '14:00'));
  assert.equal(due('2026-11-27', '15:00', 'white', 'digest'), iso('2026-11-30', '10:00'));
  assert.equal(due(MON, '10:05', 'red', 'digest'), iso(MON, '10:05'), '🔴 is never in the digest');
});

test('the Friday list moves to the last school day; Monday reports to the first one', () => {
  assert.equal(ict.fridayListAt(MON, []), at('2026-11-27', '17:00'));
  assert.equal(ict.fridayListAt(MON, [{ from: '2026-11-27', to: '2026-11-27' }]), at('2026-11-26', '17:00'));
  assert.equal(ict.fridayListAt('2026-12-28', [{ from: '2026-12-28', to: '2027-01-11' }]), null, 'a week off: no list');
  assert.equal(ict.firstWorkingDay('2026-11-02', [{ from: '2026-11-04', to: '2026-11-04' }]), '2026-11-02');
  assert.equal(ict.firstWorkingDay('2026-11-30', [{ from: '2026-11-30', to: '2026-11-30' }]), '2026-12-01');
  assert.equal(new Date(ict.questionRemindAt(item({ created: new Date(at('2026-11-27', '15:30')).toISOString() }), [])).toISOString(), new Date(at('2026-11-30', '15:30')).toISOString());
});

test('the queue: by floor and room, duplicates of one room and device together, later postponements out', () => {
  const q = ict.engineerQueue([
    item({ id: '0005', room: '304', device: 'Принтер / МФУ' }),
    item({ id: '0002', room: '211' }),
    item({ id: '0003', room: '211', urgency: 'red' }),
    item({ id: '0004', room: '106', device: 'Компьютер ученика' }),
    item({ id: '0006', room: 'Библиотека', device: 'Сеть / интернет' }),
    item({ id: '0007', room: '211', status: 'postponed', postponedTo: '2026-12-05' }),
    item({ id: '0008', room: '211', status: 'done' }),
    item({ id: '0009', type: 'question', executor: 'ikt', room: '', device: 'Почта' }),
    item({ id: '0010', room: '107', status: 'cannot_fix', executor: 'ikt' }),
  ], '2026-11-28');
  const groups = ict.groupQueue(q);
  assert.deepEqual(groups.map((g) => `${ict.floorTitle(g.floor)}|${g.room}|${g.items.map((x) => x.id).join('+')}`), ['Этаж 1|106|0004', 'Этаж 2|211|0002+0003', 'Этаж 3|304|0005', 'Другие помещения|Библиотека|0006']);
  assert.match(ict.queueHeader(groups, 'Заявки на субботу'), /\*\*Заявки на субботу: 5\*\*\nЭтаж 1: 1 · Этаж 2: 2 · Этаж 3: 1 · Другие помещения: 1/);
  assert.match(ict.groupText(groups[1]), /^\*\*Этаж 2 · Каб\. 211 · Проектор\*\* · 2 заявки\n\n🟡 №0002/);
  assert.equal(JSON.stringify(ict.markButtons(['0002', '0003'])[0][0]), JSON.stringify({ type: 'callback', text: '✅ Сделано', payload: 'ie:d:0002,0003' }));
});

test('a teacher gets one message with all their requests the engineer marked', () => {
  const mark = (iso) => [{ at: iso, by: 'инженер', what: 'статус: …' }];
  const sat = new Date(at('2026-11-28', '11:00')).toISOString();
  const reports = ict.teacherReports([
    item({ id: '0002', status: 'done', history: mark(sat) }),
    item({ id: '0003', room: '304', device: 'Принтер / МФУ', status: 'cannot_fix', comment: 'нужна запчасть: фьюзер', history: mark(sat) }),
    item({ id: '0004', teacher: 'Петров П.П.', status: 'postponed', postponedTo: '2026-12-05', history: mark(sat) }),
    item({ id: '0005', status: 'done', history: mark(new Date(at('2026-11-14', '11:00')).toISOString()) }),
  ], at('2026-11-27', '00:00'), at('2026-11-30', '08:00'));
  assert.deepEqual(reports.map((r) => [r.teacher, r.ids]), [['Иванова А.А.', ['0002', '0003']], ['Петров П.П.', ['0004']]]);
  assert.match(reports[0].text, /№0002 · Каб\. 211, проектор — ✅ исправлено\n№0003 · Каб\. 304, принтер \/ МФУ — 🚫 нужна закупка или ремонт: нужна запчасть: фьюзер, передано заму по ИКТ/);
  assert.match(reports[1].text, /➡️ перенесено на 05\.12\.2026/);
  assert.equal(ict.parseDay('5.12', at('2026-11-28', '12:00')), '2026-12-05');
  assert.equal(ict.parseDay('03.01', at('2026-11-28', '12:00')), '2027-01-03');
  assert.equal(ict.parseDay('завтра', at('2026-11-28', '12:00')), '');
});

/* End to end ----------------------------------------------------------------------- */

const SECRET = 'ict-secret-0123456789';
function setup() {
  const DB = d1(), sent = [], answers = [], calls = [];
  let clock = at(MON, '09:00');
  const items = [];
  const codes = { ABC234: 'Иванова А.А.' };
  const notified = {};
  const holidays = [];
  const reply = (data) => new Response(JSON.stringify(data), { status: 200 });
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.startsWith('https://script.test/')) {
      const b = JSON.parse(options.body || '{}');
      calls.push(b.action);
      if (b.secret !== SECRET) return reply({ ok: false, error: 'forbidden' });
      if (b.action === 'ictBotFeed') return reply({ ok: true, items: JSON.parse(JSON.stringify(items)), holidays });
      if (b.action === 'ictBotLink') return codes[b.code] ? reply({ ok: true, teacher: codes[b.code] }) : reply({ ok: false, error: 'Код не найден' });
      if (b.action === 'ictBotNotified') { b.ids.forEach((id) => { notified[id] = b.value; }); return reply({ ok: true }); }
      if (b.action === 'ictBotMark') {
        b.ids.forEach((id) => {
          const x = items.find((i) => i.id === id);
          x.status = b.result; if (b.comment) x.comment = b.comment; if (b.postponedTo) x.postponedTo = b.postponedTo;
          if (b.result === 'cannot_fix') x.executor = 'ikt';
          x.history.push({ at: new Date(clock).toISOString(), by: 'инженер', what: `статус: ${b.result}` });
        });
        return reply({ ok: true });
      }
      if (b.action === 'ictBotPhoto') return reply({ ok: true, type: 'image/jpeg', data: Buffer.from('jpeg!').toString('base64') });
      return reply({ ok: false, error: '?' });
    }
    if (u.includes('platform-api.max.ru')) {
      const body = JSON.parse(options.body || '{}');
      if (u.includes('/answers')) answers.push(body.message); else sent.push({ to: new URL(u).searchParams.get('user_id'), ...body });
      return new Response('{}', { status: 200 });
    }
    if (u.includes('sheets.googleapis.com')) return new Response(JSON.stringify({ values: [] }), { status: 200 });
    return new Response('ok', { status: 200 });
  };
  const env = { DB, BOT_TOKEN: 't', WEBHOOK_SECRET: 's', SPREADSHEET_ID: 'x', SHEETS_API_KEY: 'k', TIME_ZONE: 'Europe/Moscow', APPS_SCRIPT_URL: 'https://script.test/exec', ICT_SECRET: SECRET, ENGINEER_CODE: 'eng-code-1', IKT_CODE: 'ikt-code-2', SCHOOL_SITE_URL: 'https://sosh20tver.ru' };
  async function update(body) {
    const jobs = [];
    const res = await worker.fetch(new Request('https://bot/webhook', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': 's' }, body: JSON.stringify(body) }), env, { waitUntil: (p) => jobs.push(p) });
    assert.equal(res.status, 200);
    await Promise.all(jobs);
  }
  const user = (id) => ({ user_id: id, name: `u${id}`, is_bot: false });
  const say = (id, text) => update({ update_type: 'message_created', message: { sender: user(id), body: { text } } });
  const press = (id, payload, text = '') => update({ update_type: 'message_callback', callback: { callback_id: `cb${answers.length}`, payload, user: user(id) }, message: { body: { text } } });
  const run = (hhmm, iso = MON, budget = 45) => { clock = at(iso, hhmm); ict.clock.now = () => clock; return ict.runIct(env, { now: clock, budget, reason: 'test' }); };
  return { env, DB, sent, answers, calls, items, notified, holidays, say, press, update, run, user, setClock: (c) => { clock = c; ict.clock.now = () => clock; } };
}
const textsTo = (s, id) => s.sent.filter((m) => m.to === String(id)).map((m) => m.text);

test('roles by codes, a wrong code is counted, a teacher binds by the code from the form', async () => {
  const s = setup();
  await s.say(1, '/role eng-code-1');
  await s.say(2, '/role ikt-code-2');
  await s.say(3, '/role guess');
  assert.match(textsTo(s, 1)[0], /Роль: инженер/);
  assert.match(textsTo(s, 2)[0], /Роль: зам по ИКТ/);
  assert.match(textsTo(s, 3)[0], /Неверный код/);
  for (let i = 0; i < 5; i += 1) await s.say(4, '/role nope-nope');
  await s.say(4, '/role eng-code-1');
  assert.match(textsTo(s, 4).at(-1), /Слишком много/, 'five wrong codes block even the right one for an hour');
  await s.update({ update_type: 'bot_started', user: s.user(5), payload: 'ikt-ABC234' });
  assert.match(textsTo(s, 5)[0], /для «Иванова А\.А\.»/);
  await s.say(6, '/link zzz999');
  assert.match(textsTo(s, 6)[0], /Код не найден/);
  assert.deepEqual(s.DB.sqlite.prepare('SELECT user_id,teacher FROM ict_links').all().map((r) => ({ ...r })), [{ user_id: '5', teacher: 'Иванова А.А.' }]);
  await s.say(2, '/ikt_mode digest');
  assert.equal(s.DB.sqlite.prepare("SELECT mode FROM ict_roles WHERE user_id='2'").get().mode, 'digest');
  await s.say(1, '/ikt_mode digest');
  assert.match(textsTo(s, 1).at(-1), /СОШ №20|Выберите|подписки|Расписание/i, 'not a deputy: the usual menu');
});

test('a week: deputy alerts, the Friday list, buttons with comments, Saturday leftovers, Monday reports', async () => {
  const s = setup();
  await s.say(1, '/role eng-code-1');
  await s.say(2, '/role ikt-code-2');
  await s.update({ update_type: 'bot_started', user: s.user(5), payload: 'ikt-ABC234' });
  s.sent.length = 0;
  const add = (over) => s.items.push(item(over));
  // Monday: a 🔴 at 10:00 and a question at 11:00; a 🟡 at 22:00 waits for Tuesday 08:00.
  add({ id: '0001', created: new Date(at(MON, '10:00')).toISOString(), urgency: 'red', hasPhoto: true });
  add({ id: '0002', created: new Date(at(MON, '11:00')).toISOString(), type: 'question', executor: 'ikt', room: '', device: 'Электронный журнал', text: 'Не вижу 7А', teacher: 'Иванова А.А.' });
  add({ id: '0003', created: new Date(at(MON, '22:00')).toISOString(), room: '211', device: 'Проектор', teacher: 'Петров П.П.' });
  await s.run('11:05');
  assert.deepEqual(textsTo(s, 2).map((t) => t.split(' · ').slice(0, 4).join(' · ')), ['🔴 · Техника · от Иванова А.А. · каб. 211', '🟡 · Вопрос · от Иванова А.А. · Электронный журнал']);
  assert.equal(s.sent[0].attachments[0].payload.buttons[0][0].url, 'https://sosh20tver.ru/ikt.html#0001');
  await s.run('11:10');
  assert.equal(textsTo(s, 2).length, 2, 'nothing twice');
  await s.run('22:05');
  assert.equal(textsTo(s, 2).length, 2, 'the evening 🟡 waits');
  await s.run('08:00', '2026-11-24');
  assert.match(textsTo(s, 2)[2], /^🟡 · Техника · от Петров П\.П\./);
  // The deputy answers the question: the bound teacher gets it at once, «уведомлён = да».
  const q = s.items.find((x) => x.id === '0002');
  q.status = 'answered'; q.comment = 'Добавила вас в 7А'; q.history.push({ at: new Date(at('2026-11-24', '09:00')).toISOString(), by: 'зам по ИКТ', what: 'статус: дан ответ; ответ: Добавила вас в 7А' });
  await s.run('09:05', '2026-11-24');
  assert.match(textsTo(s, 5)[0], /Ответ по заявке №0002[\s\S]*Добавила вас в 7А/);
  assert.equal(s.notified['0002'], 'да');
  // Friday 16:55: nothing for the engineer yet; 17:00 the list: header + one message per room and device.
  add({ id: '0004', created: new Date(at('2026-11-26', '12:00')).toISOString(), room: '211', device: 'Проектор', teacher: 'Иванова А.А.', urgency: 'white' });
  add({ id: '0005', created: new Date(at('2026-11-26', '12:30')).toISOString(), room: '104', device: 'Принтер / МФУ', teacher: 'Петров П.П.' });
  await s.run('16:55', '2026-11-27');
  assert.equal(textsTo(s, 1).length, 0);
  await s.run('17:00', '2026-11-27');
  const eng = textsTo(s, 1);
  assert.match(eng[0], /Заявки на субботу 28\.11: 4\*\*\nЭтаж 1: 1 · Этаж 2: 3/);
  assert.match(eng[1], /Этаж 1 · Каб\. 104 · Принтер/);
  assert.match(eng[2], /Этаж 2 · Каб\. 211 · Проектор\*\* · 3 заявки/);
  const buttons = s.sent.filter((m) => m.to === '1')[2].attachments[0].payload.buttons;
  assert.equal(buttons[0][0].payload, 'ie:d:0001,0003,0004');
  assert.match(buttons[2][0].url, /\/ict-photo\/0001\?s=[0-9a-f]{32}$/, 'a signed photo link');
  // Saturday: a new request comes in the morning → at once with «Новая заявка».
  add({ id: '0006', created: new Date(at('2026-11-28', '09:00')).toISOString(), room: '305', device: 'Сеть / интернет', teacher: 'Петров П.П.' });
  await s.run('09:00', '2026-11-28');
  assert.match(textsTo(s, 1).at(-1), /Новая заявка на субботу[\s\S]*Каб\. 305/);
  // The engineer's buttons: ✅ for the three duplicates; ❌ asks a comment; ➡️ asks the date.
  s.setClock(at('2026-11-28', '11:00'));
  await s.press(1, 'ie:d:0001,0003,0004', 'Этаж 2 · Каб. 211');
  assert.match(s.answers.at(-1).text, /Этаж 2 · Каб\. 211\n\n· · ·\n\*\*✅ Сделано\*\*/);
  assert.deepEqual(s.items.filter((x) => ['0001', '0003', '0004'].includes(x.id)).map((x) => x.status), ['done', 'done', 'done']);
  await s.press(1, 'ie:x:0005', 'Каб. 104');
  assert.match(s.answers.at(-1).text, /напишите коротко/);
  await s.say(1, 'Нужен новый фьюзер');
  assert.equal(s.items.find((x) => x.id === '0005').status, 'cannot_fix');
  assert.equal(s.items.find((x) => x.id === '0005').comment, 'Нужен новый фьюзер');
  assert.match(textsTo(s, 1).at(-1), /🚫 Нет возможности: Нужен новый фьюзер/);
  await s.say(1, 'просто текст');
  assert.match(textsTo(s, 1).at(-1), /СОШ №20|Выберите|Расписание/i, 'no pending mark: the usual menu');
  // Saturday 18:00: 0006 is still without a mark.
  await s.run('18:00', '2026-11-28');
  assert.match(textsTo(s, 1).at(-2), /Осталось без отметки: 1/);
  await s.press(1, 'ie:p:0006', 'Каб. 305');
  assert.match(JSON.stringify(s.answers.at(-1)), /ie-p:2026-12-05:0006/);
  await s.press(1, 'ie-p:2026-12-05:0006', 'Каб. 305');
  await s.press(1, 'ie-s', 'Каб. 305');
  assert.equal(s.items.find((x) => x.id === '0006').postponedTo, '2026-12-05');
  // Monday 08:00: teachers; Иванова is bound, Петров is not → «нет». 08:30 the deputy's report.
  await s.run('08:00', '2026-11-30');
  const report = textsTo(s, 5).at(-1);
  assert.match(report, /результат работы инженера[\s\S]*№0001 · Каб\. 211, проектор — ✅ исправлено\n№0004/);
  assert.equal(s.notified['0001'], 'да');
  assert.equal(s.notified['0005'], 'нет');
  assert.equal(s.notified['0006'], 'нет');
  await s.run('08:30', '2026-11-30');
  const deputy = textsTo(s, 2).at(-1);
  assert.match(deputy, /Отчёт инженера за выходные[\s\S]*✅ Сделано: 3[\s\S]*🚫 Нет возможности — что купить или отдать в ремонт: 1\*\*\n• №0005 Каб\. 104, принтер \/ МФУ — Нужен новый фьюзер[\s\S]*➡️ Перенесено: 1\*\*\n• №0006 Каб\. 305, сеть \/ интернет → 05\.12/);
  const before = s.sent.length;
  await s.run('09:00', '2026-11-30');
  await s.run('09:05', '2026-11-30');
  assert.equal(s.sent.length, before, 'everything marked: no reminder, nothing repeated');
});

test('a question waits a school day → one reminder; the digest collects non-urgent requests', async () => {
  const s = setup();
  await s.say(2, '/role ikt-code-2');
  await s.say(2, '/ikt_mode digest');
  s.sent.length = 0;
  s.items.push(item({ id: '0011', created: new Date(at(MON, '10:20')).toISOString(), type: 'question', executor: 'ikt', room: '', device: 'Почта' }));
  s.items.push(item({ id: '0012', created: new Date(at(MON, '11:00')).toISOString(), urgency: 'white' }));
  s.items.push(item({ id: '0013', created: new Date(at(MON, '12:00')).toISOString(), urgency: 'red' }));
  await s.run('12:00');
  assert.deepEqual(textsTo(s, 2).map((t) => t.slice(0, 2)), ['🔴'], 'Monday without engineer marks: no empty report');
  await s.run('14:00');
  assert.match(textsTo(s, 2)[1], /^\*\*Новые заявки: 2\*\*[\s\S]*№0011[\s\S]*№0012/);
  await s.run('10:15', '2026-11-24');
  assert.equal(textsTo(s, 2).length, 2);
  await s.run('10:20', '2026-11-24');
  assert.match(textsTo(s, 2)[2], /Вопрос ждёт ответа/);
  await s.run('10:25', '2026-11-24');
  assert.equal(textsTo(s, 2).length, 3, 'one reminder');
});

test('the ping needs the secret; a photo link needs its signature; the cron polls every 5 minutes', async () => {
  const s = setup();
  const call = (req) => { const jobs = []; return worker.fetch(req, s.env, { waitUntil: (p) => jobs.push(p) }).then(async (r) => { await Promise.all(jobs); return r; }); };
  assert.equal((await call(new Request('https://bot/ict-ping', { method: 'POST', body: JSON.stringify({ secret: 'no' }) }))).status, 403);
  assert.equal((await call(new Request('https://bot/ict-ping', { method: 'POST', body: JSON.stringify({ secret: SECRET }) }))).status, 200);
  assert.ok(s.calls.includes('ictBotFeed'), 'the ping makes the bot read the feed');
  assert.equal((await call(new Request('https://bot/ict-photo/0001?s=00000000000000000000000000000000'))).status, 403);
  s.items.push(item({ hasPhoto: true }));
  await s.say(1, '/role eng-code-1');
  await s.say(1, '/requests');
  const photo = JSON.stringify(s.sent).match(/https:\/\/[^"]+\/ict-photo\/0001\?s=[0-9a-f]+/)[0];
  const r = await call(new Request(photo.replace(/^https:\/\/[^/]+/, 'https://bot')));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'jpeg!');
  s.calls.length = 0;
  assert.equal(await ict.runIct(s.env, { now: at(MON, '10:03'), budget: 40 }), 0, '10:03 — not a polling minute');
  assert.ok(await ict.runIct(s.env, { now: at(MON, '10:05'), budget: 40 }) >= 2);
  assert.equal(await ict.runIct(s.env, { now: at(MON, '23:05'), budget: 40 }), 0, 'every 15 minutes at night');
  assert.equal(await ict.runIct({ ...s.env, ICT_SECRET: '' }, { now: at(MON, '10:05'), budget: 40 }), 0, 'not set up: nothing');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`PASS ${name}`); } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack}`); }
}
if (failed) { console.error(`${failed} of ${tests.length} ИКТ bot checks failed`); process.exit(1); }
console.log(`${tests.length} ИКТ bot checks passed`);
