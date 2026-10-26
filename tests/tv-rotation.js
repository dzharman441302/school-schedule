'use strict';
// Staff room TV (tv.js): 10 teachers per page in alphabetical order, pages turn
// every 15 s, minute refreshes and lesson bells never restart or reorder the cycle.
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
  assert.match(h.page(), /^Страница 1 из 3 · дальше через 15 с$/);
  const chips = [...h.html('pager').matchAll(/<span class="tv-chip[^"]*">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(chips, ['А–Ко', 'Ку–Т', 'У–Я']);
  await h.advance(15000);
  assert.deepEqual(h.names(), sorted.slice(10, 20));
});

test('43 teachers complete two ordered cycles despite minute refreshes', async () => {
  const all = names(43), h = await staff(all);
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(h.names(), all.slice((i % 5) * 10, (i % 5) * 10 + 10));
    await h.advance(15000);
  }
  assert(h.fetches('Учителя') >= 3);
  assert.equal(h.pageTimers(15000), 1);
});

test('slow refresh finishing after a page turn keeps the page and the timer', async () => {
  const h = await staff(names(30));
  await h.advance(50000);
  assert.match(h.page(), /^Страница 1 из 3/);
  h.hold();
  await h.advance(15000);
  assert.match(h.page(), /^Страница 2 из 3/);
  await h.release();
  assert.match(h.page(), /^Страница 2 из 3/);
  await h.advance(10000);
  assert.match(h.page(), /^Страница 3 из 3/);
  assert.equal(h.pageTimers(15000), 1);
});

test('removing earlier teachers keeps the place in the list', async () => {
  const all = names(43), h = await staff(all);
  await h.advance(50000);
  assert.deepEqual(h.names(), all.slice(30, 40));
  h.setTeachers(all.slice(5));
  // The refresh at 60 s finds «Учитель 31» on the 3rd page, then the page turns to the 4th.
  await h.advance(10000);
  assert.deepEqual(h.names(), all.slice(35));
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
  assert.equal(h.pageTimers(15000), 0);
  assert.equal(h.page(), 'Все учителя на одном экране');
  h.setTeachers(names(30));
  await h.advance(60000);
  assert.match(h.page(), /^Страница 1 из 3/);
  assert.equal(h.pageTimers(15000), 1);
  await h.advance(15000);
  assert.match(h.page(), /^Страница 2 из 3/);
  h.setTeachers(names(10));
  await h.advance(45000);
  assert.equal(h.pageTimers(15000), 0);
  assert.equal(h.page(), 'Все учителя на одном экране');
});

test('resizing the window keeps the page and never adds a second timer', async () => {
  const h = await staff(names(30));
  await h.advance(20000);
  assert.match(h.page(), /^Страница 2 из 3/);
  await h.resize(1280, 720);
  await h.resize(3840, 2160);
  assert.match(h.page(), /^Страница 2 из 3/);
  assert.equal(h.pageTimers(15000), 1);
});

test('the bell rebuilds the grid without restarting the cycle', async () => {
  const h = await staff(names(30), { epoch: '2026-09-28T05:39:00Z' });
  assert.match(h.text('status-label'), /^Идёт 1-й урок/);
  await h.advance(50000);
  assert.match(h.page(), /^Страница 1 из 3/);
  await h.advance(12000);
  assert.match(h.text('status-label'), /^Перемена · 2-й урок в 08:50/);
  assert.match(h.page(), /^Страница 2 из 3/);
  assert.equal(h.pageTimers(15000), 1);
});

test('empty, one-page and multi-page lists start and stop only the page timer', async () => {
  const h = await staff([]);
  assert.equal(h.pageTimers(15000), 0);
  assert.match(h.board(), /Уроки на сегодня закончились/);
  h.setTeachers(names(1));
  await h.advance(60000);
  assert.equal(h.pageTimers(15000), 0);
  h.setTeachers(names(11));
  await h.advance(60000);
  assert.equal(h.pageTimers(15000), 1);
  h.setTeachers(names(1));
  await h.advance(60000);
  assert.equal(h.pageTimers(15000), 0);
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
  assert.equal(h.pageTimers(15000), 0);
});

runTests('staff TV checks', tests);
