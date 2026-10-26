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

runTests('site core checks', tests);
