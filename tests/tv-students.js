'use strict';
// Student TV (tv-students.js): one parallel per page, classes × lessons left today,
// changes from the «Изменения» sheet, parallels turn every 15 s or stay locked.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const HEAD = ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const CHANGES_HEAD = ['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание'];
const MONDAY = (time) => `2026-09-28T${time}:00Z`; // UTC; Moscow is three hours ahead
const CLASSES = ['5А', '5Б', '5В', '5И', '6А', '6Б', '6И', '6К', '7А', '7Б', '7В', '8А', '8Б', '8В', '8Г', '9А', '9Б', '9В', '9Г', '10А', '11А'];

function schedule() {
  const out = [HEAD];
  CLASSES.forEach((cls) => {
    const count = cls.startsWith('9') ? 8 : 6;
    for (let n = 1; n <= count; n += 1) out.push([cls, n, `Предмет ${n} (30${n})`, '', '', '', '']);
  });
  return out;
}

async function students(options = {}) {
  const sheets = { 'Расписание': schedule(), 'Изменения': options.changes || [CHANGES_HEAD], ...(options.extra || {}) };
  const screen = await startScreen('tv-students.js', { sheets, epoch: options.epoch || MONDAY('05:10'), search: options.search || '' });
  return {
    ...screen, sheets,
    grade: () => screen.text('grade'),
    classes: () => [...screen.board().matchAll(/data-class="([^"]*)"/g)].map((m) => m[1]),
    columns: () => [...(screen.board().match(/<div class="pb-head">(.*?)<\/div>/)?.[1] || '').matchAll(/<b>(\d+)<\/b>/g)].map((m) => Number(m[1])),
    row: (cls) => screen.board().match(new RegExp(`data-class="${cls}">(.*?)</div><div class="pb-row|data-class="${cls}">(.*)</div></div></section>`))?.slice(1).find(Boolean) || ''
  };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('parallels turn every 15 seconds and 10–11 share one page', async () => {
  const h = await students();
  const chips = [...h.html('pager').matchAll(/<span class="tv-chip[^"]*">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(chips, ['5', '6', '7', '8', '9', '10–11']);
  assert.equal(h.grade(), '5');
  assert.deepEqual(h.classes(), ['5А', '5Б', '5В', '5И']);
  assert.equal(h.text('next-text'), 'Следующая параллель через 15 с');
  for (const grade of ['6', '7', '8', '9', '10–11', '5']) {
    await h.advance(15000);
    assert.equal(h.grade(), grade);
  }
  await h.advance(75000);
  assert.equal(h.grade(), '10–11');
  assert.deepEqual(h.classes(), ['10А', '11А']);
  assert.equal(h.pageTimers(15000), 1);
});

test('?parallel=9 keeps one parallel on the screen; 11 opens 10–11', async () => {
  const h = await students({ search: '?parallel=9' });
  assert.equal(h.grade(), '9');
  assert.deepEqual(h.classes(), ['9А', '9Б', '9В', '9Г']);
  assert.equal(h.html('pager'), '');
  assert.equal(h.text('next-text'), 'Параллель закреплена за этим экраном');
  assert.equal(h.pageTimers(15000), 0);
  const upper = await students({ search: '?parallel=11' });
  assert.equal(upper.grade(), '10–11');
  const unknown = await students({ search: '?parallel=4' });
  assert.equal(unknown.grade(), '5');
  assert.equal(unknown.pageTimers(15000), 1);
});

test('before lessons the whole day is on the board, the first lesson marked', async () => {
  const h = await students({ search: '?parallel=9', epoch: MONDAY('04:30') });
  assert.deepEqual(h.columns(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(h.board(), /pb-h is-next"><span><b>1<\/b><em class="tv-pill">первым/);
  assert.equal((h.board().match(/class="pb-c /g) || []).length, 4 * 8);
  assert.equal(h.text('status-value'), 'Первый урок в 08:00');
});

test('during a lesson earlier lessons leave and the current column is marked', async () => {
  const h = await students({ search: '?parallel=9', epoch: MONDAY('06:00') });
  assert.deepEqual(h.columns(), [2, 3, 4, 5, 6, 7, 8]);
  assert.match(h.board(), /pb-h is-now"><span><b>2<\/b><em class="tv-pill">сейчас/);
  assert.match(h.row('9А'), /pb-c k-normal is-now"><strong class="pb-subj" data-fit="20">Предмет 2<\/strong><span class="pb-room"><small>каб\.<\/small><b data-fit="16">302<\/b>/);
  assert.match(h.text('status-label'), /^Идёт 2-й урок · 08:50–09:30$/);
});

test('changes show as another room, a replacement, a cancelled and an added lesson', async () => {
  const changes = [CHANGES_HEAD,
    ['28.09.2026', '9А', '3', 'Предмет 3 (214)', ''],
    ['28.09.2026', '9А', '4', 'Химия (305)', ''],
    ['28.09.2026', '9А', '5', 'отмена', ''],
    ['28.09.2026', '9А', '9', 'Информатика (301)', ''],
    ['29.09.2026', '9А', '6', 'отмена', '']];
  const h = await students({ search: '?parallel=9', changes });
  const row = h.row('9А');
  assert.deepEqual(h.columns(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(row, /k-room"><span class="pb-tag"><em>Кабинет<\/em><s>303<\/s><\/span><strong class="pb-subj" data-fit="20">Предмет 3<\/strong><span class="pb-room"><small>каб\.<\/small><b data-fit="16">214/);
  assert.match(row, /k-changed"><span class="pb-tag"><em>Замена<\/em><s>Предмет 4<\/s><\/span><strong class="pb-subj" data-fit="20">Химия/);
  assert.match(row, /k-cancelled"><span class="pb-tag"><em>Отменён<\/em><\/span><s class="pb-subj" data-fit="20">Предмет 5<\/s><span class="pb-note">урока не будет/);
  assert.match(row, /k-added"><span class="pb-tag"><em>Добавлен<\/em><\/span><strong class="pb-subj" data-fit="20">Информатика/);
  assert.match(row, /k-normal"><strong class="pb-subj" data-fit="20">Предмет 6</);
  assert.equal((row.match(/k-cancelled/g) || []).length, 1);
});

test('a refresh keeps the parallel that is on the screen', async () => {
  const h = await students();
  await h.advance(50000);
  assert.equal(h.grade(), '8');
  await h.advance(10000);
  assert.equal(h.grade(), '9');
  assert(h.fetches('Расписание') >= 2);
  assert.equal(h.pageTimers(15000), 1);
});

test('long subject names are shortened for the TV', async () => {
  const h = await students({ search: '?parallel=5' });
  h.sheets['Расписание'].push(['5А', 7, 'ОБЗР (210)', '', '', '', ''], ['5Б', 7, 'Обществознание (211)', '', '', '', '']);
  await h.advance(60000);
  assert.match(h.row('5А'), />ОБЗР<\/strong>/);
  assert.match(h.row('5Б'), />Общество­знание<\/strong>/);
});

test('after the last lesson the board names the next school day', async () => {
  const h = await students({ epoch: MONDAY('16:00') });
  assert.match(h.board(), /Уроки на сегодня закончились.*Вторник, 29 сентября/);
  assert.equal(h.text('next-text'), '');
  assert.equal(h.pageTimers(15000), 0);
});

test('lost connection keeps the last schedule and says how old it is', async () => {
  const h = await students({ search: '?parallel=9' });
  assert.match(h.text('fresh'), /^Данные на 08:10 · обновляются каждую минуту$/);
  delete h.sheets['Расписание'];
  await h.advance(60000);
  assert.deepEqual(h.classes(), ['9А', '9Б', '9В', '9Г']);
  assert.equal(h.text('fresh'), 'Нет связи · данные от 08:10');
});

test('a shortened day uses its own bell times on the board and in the header', async () => {
  const short = ['08:00–08:30', '08:40–09:10', '09:25–09:55', '10:10–10:40', '10:50–11:20', '11:30–12:00', '12:10–12:40', '12:50–13:20', '13:30–14:00', '14:10–14:40', '14:50–15:20', '15:30–16:00'];
  const sheets = {
    'Звонки': [['Урок', 'Основное', 'Сокращённое'], ...short.map((x, i) => [String(i + 1), '', x])],
    'Звонки_даты': [['Дата', 'Вариант'], ['28.09.2026', 'Сокращённое']]
  };
  const h = await students({ search: '?parallel=9', epoch: MONDAY('05:45'), extra: sheets });
  await h.advance(5000); // the header is redrawn every 5 s
  assert.match(h.text('status-label'), /^Сокращённые уроки · Идёт 2-й урок · 08:40–09:10$/);
  assert.match(h.board(), /pb-h is-now"><span><b>2<\/b><em class="tv-pill">сейчас<\/em><\/span><small data-fit="14">08:40–09:10/);
  assert.equal(h.core.bellRange(1, new Date('2026-09-29T12:00:00Z')), '08:00–08:40');
});

runTests('student TV checks', tests);
