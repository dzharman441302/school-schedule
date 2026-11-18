'use strict';
// schedule-core.js: bells of a date and «во сколько прийти и уйти» for a class.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const HEAD = ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const MONDAY = new Date('2026-09-28T12:00:00Z');
const schedule = [HEAD, ...[1, 2, 3, 4, 5, 6].map((n) => ['7Б', n, `Предмет ${n} (30${n})`, '', '', '', ''])];
const changes = (...rows) => [['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание'], ...rows.map(([lesson, text]) => ['28.09.2026', '7Б', String(lesson), text, ''])];

async function core(extra = {}) {
  const screen = await startScreen(null, { sheets: { 'Расписание': schedule, ...extra }, epoch: '2026-09-28T05:10:00Z' });
  await screen.core.bellsReady;
  return screen.core;
}
const plain = (v) => JSON.parse(JSON.stringify(v)); // values made inside the VM have its own prototypes
const lines = (c, changeRows) => plain(c.boundsLines(c.dayBounds(c.actualDay(schedule, changeRows, MONDAY, '7Б'), MONDAY)));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('an ordinary day says nothing about start and end', async () => {
  const c = await core();
  assert.deepEqual(lines(c, changes()), []);
  assert.deepEqual(lines(c, changes([3, 'Химия (210)'])), []);
});

test('a cancelled first lesson moves the start, a cancelled last one the end', async () => {
  const c = await core();
  assert.deepEqual(lines(c, changes([1, 'отмена'])), ['Приходить к 08:50 — к 2-му уроку (обычно к 08:00)']);
  assert.deepEqual(lines(c, changes([5, 'отмена'], [6, 'отмена'])), ['Уроки до 11:25 — последний 4-й (обычно до 13:10)']);
  assert.deepEqual(lines(c, changes([7, 'Химия (210)'])), ['Уроки до 14:00 — последний 7-й (обычно до 13:10)']);
  assert.deepEqual(lines(c, [1, 2, 3, 4, 5, 6].map((n) => [n, 'отмена']).reduce((rows, x) => rows.concat([['28.09.2026', '7Б', String(x[0]), x[1], '']]), [changes()[0]])), ['Уроков не будет']);
});

test('times follow the bells of that date', async () => {
  const short = ['08:00–08:30', '08:40–09:10', '09:25–09:55', '10:10–10:40', '10:50–11:20', '11:30–12:00', '12:10–12:40', '12:50–13:20', '13:30–14:00', '14:10–14:40', '14:50–15:20', '15:30–16:00'];
  const c = await core({ 'Звонки': [['Урок', 'Основное', 'Сокращённое'], ...short.map((x, i) => [String(i + 1), '', x])], 'Звонки_даты': [['Дата', 'Вариант'], ['28.09.2026', 'Сокращённое']] });
  assert.equal(c.bellVariant(MONDAY), 'Сокращённое');
  assert.deepEqual(lines(c, changes([1, 'отмена'])), ['Приходить к 08:40 — к 2-му уроку (обычно к 08:00)']);
  assert.equal(c.bellRange(3, new Date('2026-09-29T12:00:00Z')), '09:45–10:25');
});

test('an unfinished bells variant is ignored', async () => {
  const c = await core({ 'Звонки': [['Урок', 'Основное', 'Сокращённое'], ['1', '08:00–08:40', '08:00–08:30']], 'Звонки_даты': [['Дата', 'Вариант'], ['28.09.2026', 'Сокращённое']] });
  assert.equal(c.bellVariant(MONDAY), 'Основное');
  assert.equal(c.bellRange(2, MONDAY), '08:50–09:30');
});

test('a lesson in groups that keeps part of them is «весь класс вместе», not another room', async () => {
  const c = await core();
  const groups = [HEAD, ['7Б', 1, 'Английский язык (304/301)', '', '', '', ''], ['7Б', 2, 'Информатика / Английский язык (308/406)', '', '', '', ''],
    ['7Б', 3, 'Английский язык (304/301)', '', '', '', ''], ['7Б', 4, 'Химия (210)', '', '', '', ''], ['7Б', 5, 'Английский язык (304/301)', '', '', '', '']];
  const day = plain(c.actualDay(groups, changes([1, 'Английский язык (304)'], [2, 'Английский язык (406)'], [3, 'Английский язык (305/306)'], [4, 'Химия (211)'], [5, 'Физика (310)']), MONDAY, '7Б'));
  assert.deepEqual(day.map((x) => x.type), ['merged', 'merged', 'room', 'room', 'changed']);
  const info = plain(c.cellInfo(day[0]));
  assert.equal(info.badge, 'Весь класс вместе');
  assert.equal(info.room, '304');
  assert.equal(info.old, 'было по группам: каб. 304/301');
  assert.equal(c.BADGE_CLASS.merged, 'badge--merged');
});

test('lesson cards count «до звонка» and the break from the bells of that day', async () => {
  const short = ['08:00–08:30', '08:40–09:10', '09:25–09:55', '10:10–10:40', '10:50–11:20', '11:30–12:00', '12:10–12:40', '12:50–13:20', '13:30–14:00', '14:10–14:40', '14:50–15:20', '15:30–16:00'];
  const c = await core({ 'Звонки': [['Урок', 'Основное', 'Сокращённое'], ...short.map((x, i) => [String(i + 1), '', x])], 'Звонки_даты': [['Дата', 'Вариант'], ['29.09.2026', 'Сокращённое']] });
  const TUESDAY = new Date('2026-09-29T12:00:00Z');
  const tuesday = [HEAD, ...[1, 2, 3, 4, 5, 6].map((n) => ['7Б', n, '', `Предмет ${n} (30${n})`, '', '', ''])];
  const clocks = (rows, date, hhmm) => {
    const day = c.actualDay(rows, changes(), date, '7Б'), minutes = c.toMin(hhmm), moment = c.classMoment(day, minutes, date);
    return plain(day.map((x) => c.lessonClock(x, moment, minutes, date)));
  };
  // Usual Monday: 1st lesson 08:00–08:40, 2nd from 08:50.
  const lesson = clocks(schedule, MONDAY, '08:10');
  assert.deepEqual(lesson[0], { state: 'now', percent: 25, minutes: 30, label: 'до звонка 30 мин' });
  assert.equal(lesson[1], null);
  const pause = clocks(schedule, MONDAY, '08:45');
  assert.deepEqual(pause[0], { state: 'past' });
  assert.equal(pause[1].label, 'перемена, следующий урок через 5 мин');
  assert.equal(clocks(schedule, MONDAY, '07:30')[0].label, 'первый урок через 30 мин');
  // Shortened Tuesday: 1st lesson 08:00–08:30, 2nd from 08:40.
  assert.deepEqual(clocks(tuesday, TUESDAY, '08:10')[0], { state: 'now', percent: 33, minutes: 20, label: 'до звонка 20 мин' });
  assert.equal(clocks(tuesday, TUESDAY, '08:35')[1].label, 'перемена, следующий урок через 5 мин');
  const html = c.clockMarkup(c.lessonClock({ lesson: 1 }, c.classMoment(c.actualDay(schedule, changes(), MONDAY, '7Б'), c.toMin('08:10'), MONDAY), c.toMin('08:10'), MONDAY));
  assert.match(html, /<span class="lesson-clock lesson-clock--now">до звонка 30 мин<\/span><span class="lesson-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25"/);
});

test('«Моя неделя» counts lessons, gaps between lessons and the longest run', async () => {
  const c = await core();
  const sum = plain(c.teacherWeekSummary([
    { code: 'ПН', lessons: [1, 2, 3, 5], changed: false },   // окно на 4-м
    { code: 'ВТ', lessons: [2, 6], changed: true },          // три окна
    { code: 'СР', lessons: [], changed: false },             // свободный день — не окна
    { code: 'ЧТ', off: true, lessons: [1, 2, 3, 4, 5, 6] },  // каникулы не считаются
    { code: 'ПТ', lessons: [3, 4, 5, 6, 7], changed: false }
  ]));
  assert.deepEqual(sum, { total: 11, gapsTotal: 4, gaps: [{ code: 'ПН', count: 1 }, { code: 'ВТ', count: 3 }], maxRun: 5, changedDays: ['ВТ'] });
  assert.deepEqual(plain(c.teacherWeekSummary([{ code: 'ПН', lessons: [4], changed: false }])), { total: 1, gapsTotal: 0, gaps: [], maxRun: 1, changedDays: [] });
});

runTests('site core checks', tests);
