'use strict';
// achievements-public.js: «Поздравляем!» на главной, бегущая строка ТВ, лента achievements.html.
// Имя ученика показывается только если оно есть в JSON (сервер кладёт его лишь при согласии).
const assert = require('node:assert/strict');
const pub = require('../achievements-public.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const h = (date, level, over = {}) => ({ date, event: 'Олимпиада по математике', level, direction: 'Предметная олимпиада', result: 'Призёр', class: '8Б', supervisor: 'Учителева А.А.', ...over });
const DATA = {
  school_year: 2026,
  highlights: [
    h('2026-11-15', 'Школьный', { student: 'Тестов Пётр' }),
    h('2026-11-12', 'Муниципальный'),
    h('2026-11-10', 'Региональный', { student: 'Примерова Анна', result: 'Победитель', class: '10А', direction: 'Спорт' }),
    h('2026-10-20', 'Всероссийский', { result: '2 место', class: '5А' }),
    h('2026-09-20', 'Международный', { result: 'Лауреат' }),
  ],
  highlights_regional: [h('2026-11-10', 'Региональный', { student: 'Примерова Анна', result: 'Победитель', class: '10А', direction: 'Спорт' }), h('2025-12-01', 'Региональный')],
  contests: { c1: { participants: 12, prizes: 3 } },
};

test('label: name only when it is in the data, otherwise «ученик 8Б»', () => {
  assert.equal(pub.label(h('2026-11-01', 'Школьный', { student: 'Тестов Пётр' })), 'Тестов Пётр, 8Б');
  assert.equal(pub.label(h('2026-11-01', 'Школьный')), 'ученик 8Б');
});

test('home «Поздравляем!»: three newest of regional level and above, no duplicates', () => {
  const items = pub.congrats(DATA);
  assert.deepEqual(items.map((x) => x.level), ['Региональный', 'Всероссийский', 'Международный']);
  assert.equal(pub.allHighlights(DATA).length, 6, 'одна запись есть в обоих списках — показывается один раз');
});

test('TV ticker: municipal level and above, last 14 days', () => {
  const lines = pub.tickerTexts(DATA, '2026-11-19');
  assert.deepEqual(lines, [
    'Поздравляем! ученик 8Б — призёр: Олимпиада по математике (муниципальный уровень)',
    'Поздравляем! Примерова Анна, 10А — победитель: Олимпиада по математике (региональный уровень)',
  ]);
  assert.equal(pub.tickerTexts(DATA, '2026-12-31').length, 0);
  assert.equal(pub.tickerTexts(null, '2026-11-19').length, 0);
});

test('feed filters by parallel and direction', () => {
  const all = pub.allHighlights(DATA);
  assert.equal(pub.filterHighlights(all, { parallel: '10' }).length, 1);
  assert.equal(pub.filterHighlights(all, { parallel: '8' }).length, 4);
  assert.equal(pub.filterHighlights(all, { direction: 'Спорт' }).length, 1);
  assert.equal(pub.parallelOf('11А'), '11');
});

test('contest totals for contests.html, without names', () => {
  assert.deepEqual(pub.contestTotals(DATA, 'c1'), { participants: 12, prizes: 3, text: 'Итоги: наших участников 12, призёров 3' });
  assert.equal(pub.contestTotals(DATA, 'nope'), null);
});

test('load: cached for 10 minutes, old data when offline, nothing without a URL', async () => {
  pub._reset();
  let calls = 0, fail = false;
  const fetchImpl = async () => { calls += 1; if (fail) throw new Error('offline'); return { ok: true, json: async () => DATA }; };
  assert.equal(await pub.load('', { fetchImpl }), null);
  await pub.load('https://s/a.json', { fetchImpl, now: 0 });
  await pub.load('https://s/a.json', { fetchImpl, now: 60000 });
  assert.equal(calls, 1);
  fail = true;
  const data = await pub.load('https://s/a.json', { fetchImpl, now: 11 * 60000 });
  assert.equal(calls, 2);
  assert.equal(data.school_year, 2026);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); } catch (err) { failed += 1; console.error(`FAIL - ${name}\n${err.stack}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
