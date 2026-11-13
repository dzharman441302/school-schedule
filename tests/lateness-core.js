'use strict';
// lateness-core.js: marks of the duty administrators → counted days, streaks and the rating.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const HEAD = ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const CLASSES = ['5А', '7А', '9А'];
const MARK_HEAD = ['ID', 'Дата', 'Время', 'Класс', 'Изменение', 'Дежурный'];
const SHIFT_HEAD = ['Дата', 'Смена', 'Закрыто', 'Дежурный'];
const day = (iso) => new Date(`${iso}T12:00:00Z`);
let n = 0;
const mark = (date, cls, delta = 1) => [`id${++n}xx`, date, '08:05', cls, delta, 'Иванова'];
const closed = (date, shift) => [date, shift, '08:30', 'Иванова'];

async function lib() {
  const schedule = [HEAD, ...CLASSES.flatMap((cls) => [1, 2, 3].map((l) => [cls, cls.startsWith('7') ? l + 5 : l, `Предмет (30${l})`, '', '', '', '']))];
  const screen = await startScreen(null, { sheets: { 'Расписание': schedule }, epoch: '2026-11-13T05:10:00Z' });
  await screen.core.bellsReady;
  return { late: screen.late, schedule };
}
const ctx = (iso, minutes = 600, closeAfter = { 1: 520, 2: 800 }) => ({ today: day(iso), minutes, closeAfter });
const plain = (v) => JSON.parse(JSON.stringify(v));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('shifts come from the grade: 7 and 8 are the second shift', async () => {
  const { late } = await lib();
  assert.deepEqual(['5А', '6Б', '7В', '8Г', '9А', '10А', '11А'].map(late.shiftOf), [1, 1, 2, 2, 1, 1, 1]);
});

test('a «−1» takes a mark back and a count never goes below zero', async () => {
  const { late } = await lib();
  const data = late.parse([MARK_HEAD, mark('09.11.2026', '5А'), mark('09.11.2026', '5А'), mark('09.11.2026', '5А', -1), mark('09.11.2026', '9А', -1)], [SHIFT_HEAD]);
  assert.equal(late.countOf(data, day('2026-11-09'), '5А'), 1);
  assert.equal(late.countOf(data, day('2026-11-09'), '9А'), 0);
});

test('a shift counts when closed, or when marked and its first lesson is over', async () => {
  const { late } = await lib();
  const data = late.parse([MARK_HEAD, mark('13.11.2026', '5А'), mark('12.11.2026', '7А')], [SHIFT_HEAD, closed('11.11.2026', 1)]);
  assert.equal(late.isCounted(data, day('2026-11-11'), 1, ctx('2026-11-13')), true, 'closed with «Готово»');
  assert.equal(late.isCounted(data, day('2026-11-11'), 2, ctx('2026-11-13')), false, 'nobody marked the second shift');
  assert.equal(late.isCounted(data, day('2026-11-12'), 2, ctx('2026-11-13')), true, 'marked on a past day');
  assert.equal(late.isCounted(data, day('2026-11-13'), 1, ctx('2026-11-13', 500)), false, 'first lesson still going');
  assert.equal(late.isCounted(data, day('2026-11-13'), 1, ctx('2026-11-13', 530)), true, 'first lesson over');
});

test('the first lesson of a shift comes from the schedule', async () => {
  const { late, schedule } = await lib();
  assert.equal(late.firstLesson(schedule, [], day('2026-11-09'), CLASSES, 1), 1);
  assert.equal(late.firstLesson(schedule, [], day('2026-11-09'), CLASSES, 2), 6);
});

test('mid-week the board shows this week so far, ties share a place', async () => {
  const { late } = await lib();
  const data = late.parse([MARK_HEAD, mark('09.11.2026', '5А'), mark('11.11.2026', '5А'), mark('11.11.2026', '9А'), mark('11.11.2026', '9А'), mark('06.11.2026', '7А')], [SHIFT_HEAD]);
  const b = plain(late.board(data, CLASSES, ctx('2026-11-11')));
  assert.equal(b.mode, 'week');
  assert.deepEqual(b.rows.map((r) => [r.place, r.cls, r.count]), [[1, '7А', 0], [2, '5А', 2], [2, '9А', 2]]);
  assert.equal(b.total, 4);
  assert.deepEqual(b.perfect, []);
});

test('on Monday the board shows last week, «без опозданий» only for a watched week', async () => {
  const { late } = await lib();
  const marks = [MARK_HEAD, mark('02.11.2026', '9А')];
  const shifts = [SHIFT_HEAD, ...['02', '03', '04', '05', '06'].map((d) => closed(`${d}.11.2026`, 1)), closed('06.11.2026', 2)];
  const b = plain(late.board(late.parse(marks, shifts), CLASSES, ctx('2026-11-09', 470)));
  assert.equal(b.mode, 'results');
  assert.equal(b.from.slice(0, 10), '2026-11-02');
  assert.equal(b.to.slice(0, 10), '2026-11-06');
  assert.deepEqual(b.perfect, ['5А'], '7А had only one watched day, 9А was late');
});

test('streaks skip days nobody marked and stop at a late pupil', async () => {
  const { late } = await lib();
  const shifts = [SHIFT_HEAD, ...['03', '05', '06', '09', '10', '11'].map((d) => closed(`${d}.11.2026`, 1))];
  const data = late.parse([MARK_HEAD, mark('02.11.2026', '5А'), mark('10.11.2026', '9А')], shifts);
  assert.equal(late.streak(data, '5А', ctx('2026-11-12', 480)), 6, '04.11 and 12.11 (still open) are skipped');
  assert.equal(late.streak(data, '9А', ctx('2026-11-12', 480)), 1);
  assert.equal(late.streak(data, '7А', ctx('2026-11-12', 480)), 0, 'the second shift was never closed');
  const today = late.parse([MARK_HEAD, mark('12.11.2026', '5А')], shifts);
  assert.equal(late.streak(today, '5А', ctx('2026-11-12', 480)), 0, 'a mark this morning ends it at once');
});

test('nothing is shown without any marks or closed shifts', async () => {
  const { late } = await lib();
  assert.equal(late.board(late.parse([MARK_HEAD], [SHIFT_HEAD]), CLASSES, ctx('2026-11-11')), null);
  assert.equal(late.board(late.parse([], []), CLASSES, ctx('2026-11-14')), null);
});

runTests('lateness checks', tests);
