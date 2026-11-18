'use strict';
// menu-core.js: the 10-day menu cycle over school days, the start from «Настройки_сайта»,
// replacements from «Меню_замены». The real data/menu-cycle.json is used.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const CALENDAR = [['Дата начала', 'Дата окончания', 'Название'], ['26.10.2026', '03.11.2026', 'Осенние каникулы'], ['04.11.2026', '', 'День народного единства'], ['31.12.2026', '10.01.2027', 'Зимние каникулы'], ['27.03.2027', '04.04.2027', 'Весенние каникулы'], ['27.05.2027', '31.08.2027', 'Летние каникулы']];
const plain = (v) => JSON.parse(JSON.stringify(v));

async function menu(extra = {}) {
  const screen = await startScreen(null, { sheets: { 'Календарь': CALENDAR, 'Расписание': [['Класс', 'Урок', 'ПН']], ...extra }, epoch: '2026-11-18T05:00:00Z' });
  await screen.menu.loadMenuCycle();
  return screen.menu;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('days of the cycle go by school days only: 09.11 → 1, 20.11 → 10, 23.11 → 1 again', async () => {
  const m = await menu();
  const days = ['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23', '2026-11-24'].map((d) => m.cycleDayFor(d));
  assert.deepEqual(days, [1, 2, 5, 6, 8, 10, 1, 2]);
  const today = plain(m.menuFor('2026-11-18'));
  assert.equal(today.cycleDay, 8);
  assert.deepEqual(today.meals.map((x) => x.name), ['Завтрак', 'Обед']);
  assert.equal(today.meals[0].items[0].name, 'Жаркое по-домашнему с птицей', 'the menu of the canteen file of 18.11');
  assert.equal(today.meals[0].items[0].emoji, '🍗');
  assert.equal(today.meals[1].items.length, 5);
});

test('weekends and holidays have no menu; the holidays do not move the cycle', async () => {
  const m = await menu();
  assert.equal(m.menuFor('2026-11-21'), null, 'Saturday');
  assert.equal(m.menuFor('2026-11-22'), null, 'Sunday');
  assert.equal(m.menuFor('2027-01-05'), null, 'winter holidays');
  const last = m.cycleDayFor('2026-12-30'), first = m.cycleDayFor('2027-01-11');
  assert.equal(first, (last % 10) + 1, '30.12 and 11.01 go one after another in the cycle');
  assert.equal(plain(m.nextSchoolDayMenu('2026-12-30')).date, '2027-01-11');
  assert.equal(plain(m.nextSchoolDayMenu('2026-11-20')).cycleDay, 1, 'Friday → Monday 23.11, day 1');
  assert.equal(m.cycleDayFor('2026-11-06'), 10, 'the school day before the start is day 10');
  assert.equal(m.menuFor('2026-11-03'), null, 'autumn holidays');
});

test('«menuCycleStart» in the settings moves the cycle', async () => {
  const m = await menu({ 'Настройки_сайта': [['Ключ', 'Значение'], ['appsScriptUrl', 'https://script.google.com/x'], ['menuCycleStart', '10.11.2026']] });
  assert.equal(m.cycleDayFor('2026-11-10'), 1);
  assert.equal(m.cycleDayFor('2026-11-09'), 10);
  assert.equal(plain(m.menuFor('2026-11-18')).cycleDay, 7);
});

test('replacements of «Меню_замены»: replace, remove, add — only on that date', async () => {
  const m = await menu({ 'Меню_замены': [['Дата', 'Приём пищи', 'Было', 'Стало'],
    ['18.11.2026', 'Обед', 'Мясо тушёное', 'Тефтели из птицы'],
    ['18.11.2026', 'завтрак', 'Фрукты', ''],
    ['18.11.2026', 'Завтрак', '', 'Булочка с маком'],
    ['18.11.2026', 'Обед', 'Пицца', 'Бургер']] });
  const day = plain(m.menuFor('2026-11-18'));
  const lunch = day.meals[1].items, breakfast = day.meals[0].items;
  assert.equal(lunch[2].name, 'Тефтели из птицы');
  assert.equal(lunch[2].icon, 'meat', 'the icon of the replaced dish stays');
  assert.equal(lunch[2].replaced, true);
  assert.deepEqual(breakfast.map((x) => x.name), ['Жаркое по-домашнему с птицей', 'Кофейный напиток', 'Булочка с маком']);
  assert.equal(lunch.length, 5, 'a replacement of a dish that is not there changes nothing');
  assert.equal(plain(m.menuFor('2026-12-02')).meals[1].items.some((x) => x.replaced), false, 'another day with the same cycle day is untouched');
});

test('without the cycle file there is no menu, and nothing breaks', async () => {
  const screen = await startScreen(null, { sheets: { 'Календарь': CALENDAR }, epoch: '2026-11-18T05:00:00Z' });
  screen.menu.setData({ cycle: null });
  assert.equal(screen.menu.menuFor('2026-11-18'), null);
});

runTests('menu cycle checks', tests);
