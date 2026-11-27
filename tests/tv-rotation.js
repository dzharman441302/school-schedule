'use strict';
// Staff room TV (tv.js): 10 teachers per page in alphabetical order, pages turn
// every 20 s, minute refreshes and lesson bells never restart or reorder the cycle.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const HEAD = ['ФИО', 'УРОК', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const CHANGES_HEAD = ['Дата', 'Учитель', 'Урок', 'Класс', 'Предмет', 'Кабинет', 'Статус', 'Было: класс', 'Было: предмет', 'Было: кабинет'];
const MONDAY = '2026-09-28T05:10:00Z'; // 08:10 in Moscow, the 1st lesson is on
const names = (n) => Array.from({ length: n }, (_, i) => `Учитель ${String(i + 1).padStart(2, '0')}`);
const rows = (teachers, lesson = 12) => [HEAD, ...teachers.map((t) => [t, lesson, ...Array(5).fill('5А|Рус|305')])];

async function staff(teachers, options = {}) {
  const sheets = { 'Учителя': options.rows || rows(teachers), 'Учителя_сайт': options.changes || [CHANGES_HEAD] };
  const screen = await startScreen('tv.js', { sheets, epoch: options.epoch || MONDAY });
  return {
    ...screen,
    names: () => [...screen.board().matchAll(/data-teacher="([^"]*)"/g)].map((m) => m[1]),
    page: () => screen.text('next-text'),
    setTeachers(list) { sheets['Учителя'] = rows(list); }
  };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('ten teachers a page in alphabetical order, pages named by letters', async () => {
  const sorted = ['Абрамова А.А.', 'Белова Б.Б.', 'Васильева В.В.', 'Громова Г.Г.', 'Дмитриева Д.Д.', 'Егорова Е.Е.', 'Жукова Ж.Ж.', 'Зайцева З.З.', 'Иванова И.И.', 'Козлова К.К.', 'Кузнецова К.К.', 'Лебедева Л.Л.',
    'Ломова Л.Л.', 'Морозова М.М.', 'Новикова Н.Н.', 'Орлова О.О.', 'Павлова П.П.', 'Романова Р.Р.', 'Соколова С.С.', 'Тихонова Т.Т.', 'Уварова У.У.', 'Фёдорова Ф.Ф.', 'Чернова Ч.Ч.', 'Шилова Ш.Ш.',
    'Щукина Щ.Щ.', 'Яковлева Я.Я.'];
  const h = await staff(sorted.slice().reverse());
  assert.deepEqual(h.names(), sorted.slice(0, 10));
  assert.match(h.page(), /^Страница 1 из 3 · дальше через 20 с$/);
  const chips = [...h.html('pager').matchAll(/<span class="tv-chip[^"]*">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(chips, ['А–Ко', 'Ку–Т', 'У–Я']);
  await h.advance(19999);
  assert.deepEqual(h.names(), sorted.slice(0, 10));
  await h.advance(1);
  assert.deepEqual(h.names(), sorted.slice(10, 20));
});

test('43 teachers complete two ordered cycles despite minute refreshes', async () => {
  const all = names(43), h = await staff(all);
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(h.names(), all.slice((i % 5) * 10, (i % 5) * 10 + 10));
    await h.advance(20000);
  }
  assert(h.fetches('Учителя') >= 3);
  assert.equal(h.pageTimers(20000), 1);
});

test('slow refresh finishing after a page turn keeps the page and the timer', async () => {
  const h = await staff(names(30));
  await h.advance(50000);
  assert.match(h.page(), /^Страница 3 из 3/);
  h.hold();
  await h.advance(15000);
  assert.match(h.page(), /^Страница 1 из 3/);
  await h.release();
  assert.match(h.page(), /^Страница 1 из 3/);
  await h.advance(15000);
  assert.match(h.page(), /^Страница 2 из 3/);
  assert.equal(h.pageTimers(20000), 1);
});

test('removing earlier teachers keeps the place in the list', async () => {
  const all = names(43), h = await staff(all);
  await h.advance(59000);
  assert.deepEqual(h.names(), all.slice(20, 30));
  h.setTeachers(all.slice(5));
  // The refresh at 60 s keeps «Учитель 21» in view before the next page turn.
  await h.advance(1000);
  assert.deepEqual(h.names(), all.slice(25, 35));
});

test('removing the teachers on screen continues with the next one', async () => {
  const all = names(43), h = await staff([]);
  const rotation = h.tv.createRotation({ size: 12, period: 15000, onTurn() {} });
  rotation.setKeys(all);
  rotation.sync();
  await h.advance(45000);
  assert.deepEqual(rotation.current(), all.slice(36));
  rotation.setKeys(all.filter((_, i) => i < 36 || i > 38));
  assert.deepEqual(rotation.current(), all.slice(39));
  rotation.setKeys(all.slice(0, 20));
  assert.deepEqual(rotation.current(), all.slice(0, 12));
});

test('page timer follows the refreshed number of pages', async () => {
  const h = await staff(names(10));
  assert.equal(h.pageTimers(20000), 0);
  assert.equal(h.page(), 'Все учителя на одном экране');
  h.setTeachers(names(30));
  await h.advance(60000);
  assert.match(h.page(), /^Страница 1 из 3/);
  assert.equal(h.pageTimers(20000), 1);
  await h.advance(20000);
  assert.match(h.page(), /^Страница 2 из 3/);
  h.setTeachers(names(10));
  await h.advance(40000);
  assert.equal(h.pageTimers(20000), 0);
  assert.equal(h.page(), 'Все учителя на одном экране');
});

test('resizing the window keeps the page and never adds a second timer', async () => {
  const h = await staff(names(30));
  await h.advance(20000);
  assert.match(h.page(), /^Страница 2 из 3/);
  await h.resize(1280, 720);
  await h.resize(3840, 2160);
  assert.match(h.page(), /^Страница 2 из 3/);
  assert.equal(h.pageTimers(20000), 1);
});

test('the bell rebuilds the grid without restarting the cycle', async () => {
  const h = await staff(names(30), { epoch: '2026-09-28T05:39:00Z' });
  assert.match(h.text('status-label'), /^Идёт 1-й урок/);
  await h.advance(50000);
  assert.match(h.page(), /^Страница 3 из 3/);
  await h.advance(12000);
  assert.match(h.text('status-label'), /^Перемена · 2-й урок в 08:50/);
  assert.match(h.page(), /^Страница 1 из 3/);
  assert.equal(h.pageTimers(20000), 1);
});

test('empty, one-page and multi-page lists start and stop only the page timer', async () => {
  const h = await staff([]);
  assert.equal(h.pageTimers(20000), 0);
  assert.match(h.board(), /Уроки на сегодня закончились/);
  h.setTeachers(names(1));
  await h.advance(60000);
  assert.equal(h.pageTimers(20000), 0);
  h.setTeachers(names(11));
  await h.advance(60000);
  assert.equal(h.pageTimers(20000), 1);
  h.setTeachers(names(1));
  await h.advance(60000);
  assert.equal(h.pageTimers(20000), 0);
});

test('past lessons and teachers with only cancelled lessons stay hidden', async () => {
  const data = [HEAD, ['Учитель 01', 1, '5А|Рус|305', '', '', '', ''], ['Учитель 02', 12, '6А|Лит|306', '', '', '', ''], ['Учитель 03', 3, '7А|Алг|307', '', '', '', '']];
  const changes = [CHANGES_HEAD, ['28.09.2026', 'Учитель 02', 12, '', '', '', 'cancelled', '6А', 'Лит', '306']];
  const h = await staff([], { rows: data, changes, epoch: '2026-09-28T06:00:00Z' });
  assert.deepEqual(h.names(), ['Учитель 03']);
});

test('columns run from the lesson on now to the last lesson left', async () => {
  const data = [HEAD, ['Учитель 01', 3, '7А|Алг|307', '', '', '', ''], ['Учитель 01', 9, '7Б|Алг|307', '', '', '', '']];
  const h = await staff([], { rows: data, epoch: '2026-09-28T06:00:00Z' });
  const head = h.board().match(/<div class="tg-head">(.*?)<\/div>/)[1];
  assert.deepEqual([...head.matchAll(/<b>(\d+)<\/b>/g)].map((m) => Number(m[1])), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(head, /tg-h is-now"><b>2<\/b><em class="tv-pill">сейчас/);
  assert.match(h.board(), /data-fit="14">7А<\/b><small data-fit="14">307</);
});

test('changes are marked in the grid itself, with no side panel', async () => {
  const changes = [CHANGES_HEAD,
    ['28.09.2026', 'Учитель 02', 3, '', '', '', 'cancelled', '7А', 'Рус', '305'],
    ['28.09.2026', 'Учитель 05', 3, '7А', 'Рус', '214', 'added', '', '', ''],
    ['28.09.2026', 'Учитель 03', 12, '5А', 'Рус', '214', 'room', '5А', 'Рус', '305']];
  const h = await staff(names(6), { changes });
  assert.match(h.board(), /^<section class="tv-card tg" style="--cols:12">/);
  assert.doesNotMatch(h.board(), /<aside|Изменения сегодня/);
  assert.match(h.board(), /k-cancelled"><s data-fit="14">7А<\/s><small>снят/);
  assert.match(h.board(), /k-added"><b data-fit="14">\+7А<\/b><small data-fit="14">214</);
  assert.match(h.board(), /k-room-change"><b data-fit="14">5А<\/b><small data-fit="14">→ 214</);
});

test('a day off shows the next school day instead of an empty grid', async () => {
  const h = await staff(names(6), { epoch: '2026-10-03T08:00:00Z' });
  assert.match(h.board(), /Сегодня выходной.*Понедельник, 5 октября/);
  assert.equal(h.text('status-value'), 'Понедельник, 5 октября');
  assert.equal(h.pageTimers(20000), 0);
});

/* The «Сегодня» slide on the staff TV (tv-today.js, audience «teachers») ------------------- */

// Wednesday 18.11.2026 (cycle day 8 of the menu). Times are Moscow.
const at = (hhmm, date = '2026-11-18') => { const [h, m] = hhmm.split(':').map(Number); const [y, mo, d] = date.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 3, m)).toISOString(); };
async function staffToday(teachers, time, options = {}) {
  const sheets = { 'Учителя': options.rows || rows(teachers), 'Учителя_сайт': options.changes || [CHANGES_HEAD], 'Дежурство': [['Неделя с', 'Неделя по', 'Смена', 'Классы'], ['16.11.2026', '20.11.2026', '1', '6К, 4Б'], ['16.11.2026', '20.11.2026', '2', '8Г, 3Г']], ...(options.extra || {}) };
  const screen = await startScreen('tv.js', { sheets, epoch: at(time, options.date), search: options.search || '', before: ['tv-today.js'], fetchMore: options.fetchMore });
  const today = () => /data-slide="today"/.test(screen.board());
  return { ...screen, sheets, today, names: () => [...screen.board().matchAll(/data-teacher="([^"]*)"/g)].map((m) => m[1]), chips: () => [...screen.html('pager').matchAll(/<span class="tv-chip[^"]*">([^<]*)</g)].map((m) => m[1]), seen: () => (today() ? 'Сегодня' : [...screen.board().matchAll(/data-teacher="([^"]*)"/g)][0]?.[1]) };
}

test('the slide comes once after a full round of grid pages, for 20 s; a dot of its own', async () => {
  const h = await staffToday(names(25), '10:00');
  assert.equal(h.chips().length, 4, 'three grid pages and «Сегодня»');
  assert.equal(h.chips()[3], 'Сегодня');
  const seen = [];
  for (let i = 0; i < 5; i += 1) { seen.push(h.seen()); await h.advance(20000); }
  assert.deepEqual(seen, ['Учитель 01', 'Учитель 11', 'Учитель 21', 'Сегодня', 'Учитель 01']);
  await h.advance(45000);
  assert.ok(h.today());
  assert.match(h.html('pager'), /tv-chip is-on">Сегодня</, 'the «Сегодня» dot is lit');
  assert.equal(h.text('next-text'), 'Дальше сетка учителей через 20 с');
});

test('one grid page, before 08:00 and after the lessons: the slide every other time; no grid — only it', async () => {
  const one = await staffToday(names(6), '10:00');
  const seq = [];
  for (let i = 0; i < 4; i += 1) { seq.push(one.today() ? 'Сегодня' : 'сетка'); await one.advance(20000); }
  assert.deepEqual(seq, ['сетка', 'Сегодня', 'сетка', 'Сегодня']);
  const early = await staffToday(names(25), '07:45');
  const seq2 = [];
  for (let i = 0; i < 4; i += 1) { seq2.push(early.seen()); await early.advance(20000); }
  assert.deepEqual(seq2, ['Учитель 01', 'Сегодня', 'Учитель 11', 'Сегодня']);
  const evening = await staffToday(names(25), '19:00');
  assert.ok(evening.today(), 'all lessons over: only the slide');
  assert.equal(evening.pageTimers(20000), 0);
});

test('the teachers’ variant: upcoming olympiads instead of the task and changes, duty administrators, teacher-only events', async () => {
  const changes = [CHANGES_HEAD,
    ['18.11.2026', 'Учитель 01', 3, '', '', '', 'cancelled', '7А', 'Рус', '305'], ['18.11.2026', 'Учитель 02', 3, '7А', 'Рус', '214', 'changed', '', '', ''],
    ['18.11.2026', 'Учитель 02', 4, '7А', 'Рус', '214', 'room', '7А', 'Рус', '305'], ['18.11.2026', 'Учитель 03', 5, '5А', 'Рус', '305', 'normal', '', '', ''],
    ['19.11.2026', 'Учитель 04', 2, '', '', '', 'cancelled', '5А', 'Рус', '305']];
  const events = [['Дата', 'Время', 'Что', 'Где', 'Для', 'Опубликовано'], ['18.11.2026', '14:00', 'Педсовет', 'Каб. 211', 'Учителям', ''], ['18.11.2026', '15:00', 'Концерт', 'Актовый зал', 'Всем', '']];
  const task = [['Дата', 'Задача', 'Пояснение', 'Параллели'], ['18.11.2026', 'Задача для учеников', '', '']];
  const olympiad = (name, event_date, deadline = '2026-11-18', status = 'published') => ({ name, event_date, deadline, status, classes: ['8А', '8Б'], audience: 'students' });
  let olympiads = [olympiad('Дальняя', '2026-12-01'), olympiad('Прошедшая', '2026-11-17'), olympiad('Физика', '2026-11-20', '2026-11-16', 'closed'), olympiad('Черновик', '2026-11-18', '2026-11-18', 'draft'), olympiad('Математика <и логика>', '2026-11-19'), olympiad('Информатика', null)];
  let fail = false, calls = 0;
  const fetchMore = (url, options) => {
    if (!url.endsWith('/public/upcoming-olympiads')) return null;
    calls += 1;
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return { ok: !fail, status: fail ? 503 : 200, json: async () => ({ olympiads }) };
  };
  const noon = await staffToday(names(6), '11:30', { search: '?slide=today', changes, extra: { 'События_сайт': events, 'Задача_дня': task }, fetchMore });
  const board = noon.board();
  assert.match(board, /Ближайшие олимпиады[\s\S]*18\.11[\s\S]*Приём до[\s\S]*Информатика[\s\S]*Дата уточняется[\s\S]*19\.11[\s\S]*Математика &lt;и логика&gt;[\s\S]*Заявки до 18\.11 · 8А, 8Б[\s\S]*20\.11[\s\S]*Физика[\s\S]*Приём завершён/);
  assert.doesNotMatch(board, /Дальняя|Прошедшая|Черновик|Сегодня по расписанию|Сегодня изменений нет|td-sched/);
  assert.doesNotMatch(board, /td-task|Задача для учеников/, 'no task strip for teachers');
  assert.match(board, /Педсовет[\s\S]*Концерт/, 'teachers see teacher-only events');
  assert.match(board, /1 смена[\s\S]*6К, 4Б[\s\S]*администратор: Дятлов В\. С\.[\s\S]*2 смена[\s\S]*8Г, 3Г[\s\S]*администратор: Фатьянова Е\. А\./, 'Wednesday duty administrators of config.js');
  assert.match(board, /Сегодня на обед/, 'the menu is the same as for pupils');
  fail = true;
  await noon.advance(60000);
  assert.match(noon.board(), /Математика &lt;и логика&gt;/, 'last successful feed survives a network error');
  fail = false;
  olympiads = [olympiad('Новая олимпиада', '2026-11-18')];
  await noon.advance(60000);
  assert.match(noon.board(), /Новая олимпиада/);
  assert.doesNotMatch(noon.board(), /Математика &lt;и логика&gt;/);
  assert.ok(calls >= 3, 'refreshes with the TV every minute');
  olympiads = [];
  await noon.advance(60000);
  assert.match(noon.board(), /Предстоящих олимпиад пока нет/);
  const offline = await staffToday(names(6), '15:30', { search: '?slide=today', changes });
  assert.doesNotMatch(offline.board(), /td-olympiads|Сегодня по расписанию|На завтра уже опубликовано/, 'a failed initial fetch is not an empty catalogue');
});

test('duty administrators by weekday and shift; the changes summary', async () => {
  const h = await startScreen(null, { sheets: {}, epoch: at('09:00') });
  const duty = { 1: ['А', 'Б', 'В', 'Г', 'Д'], 2: ['Е', 'Ж', '', 'И', 'К'] };
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(h.today.dutyAdmins(duty, '2026-11-16')), [{ shift: 1, name: 'А' }, { shift: 2, name: 'Е' }], 'Monday');
  assert.deepEqual(plain(h.today.dutyAdmins(duty, '2026-11-18')), [{ shift: 1, name: 'В' }], 'Wednesday, nobody in the 2nd shift');
  assert.deepEqual(plain(h.today.dutyAdmins(duty, '2026-11-21')), [], 'Saturday');
  assert.deepEqual(plain(h.today.changesSummary([CHANGES_HEAD, ['18.11.2026', 'X', 1, '', '', '', 'added', '', '', '']], '2026-11-18')), { published: true, total: 1, cancelled: 0, changed: 1, room: 0, teachers: 1 }, 'an added lesson counts as a replacement');
});

runTests('staff TV checks', tests);
