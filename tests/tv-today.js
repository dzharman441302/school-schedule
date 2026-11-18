'use strict';
// The «Сегодня» slide on the pupils' TV (tv-today.js + tv-students.js): what the menu card
// says by the time of day, and where the slide goes among the parallel boards.
const assert = require('node:assert/strict');
const { startScreen, runTests } = require('./tv-harness');

const HEAD = ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
const CLASSES = ['5А', '5Б', '6А', '7А', '9А', '10А', '11А'];
const CALENDAR = [['Дата начала', 'Дата окончания', 'Название'], ['31.12.2026', '10.01.2027', 'Зимние каникулы'], ['27.05.2027', '31.08.2027', 'Летние каникулы']];
// Wednesday 18.11.2026 — cycle day 8 of data/menu-cycle.json. Times are Moscow.
const at = (hhmm, date = '2026-11-18') => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(...date.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), h - 3, m)).toISOString(); };
function schedule(lessons = 6) {
  const out = [HEAD];
  CLASSES.forEach((cls) => { for (let n = 1; n <= lessons; n += 1) out.push([cls, n, `Предмет ${n} (30${n})`, `Предмет ${n} (30${n})`, `Предмет ${n} (30${n})`, `Предмет ${n} (30${n})`, `Предмет ${n} (30${n})`]); });
  return out;
}
async function tvAt(time, { search = '', date, lessons, extra = {} } = {}) {
  const sheets = { 'Расписание': schedule(lessons), 'Изменения': [['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание']], 'Календарь': CALENDAR, 'Дежурство': [['Неделя с', 'Неделя по', 'Смена', 'Классы'], ['16.11.2026', '20.11.2026', '1', '6К, 4Б'], ['16.11.2026', '20.11.2026', '2', '8Г, 3Г']], ...extra };
  const h = await startScreen('tv-students.js', { sheets, epoch: at(time, date), search, before: ['qr.js', 'tv-today.js'] });
  return { ...h, sheets, grade: () => h.text('grade'), today: () => /data-slide="today"/.test(h.board()), chips: () => [...h.html('pager').matchAll(/<span class="tv-chip[^"]*">([^<]*)</g)].map((m) => m[1]) };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('menu mode: breakfast until the 2nd lesson ends, lunch until 14:00, then tomorrow; holidays rest', async () => {
  const h = await startScreen(null, { sheets: { 'Календарь': CALENDAR }, epoch: at('09:00') });
  const holidays = JSON.parse(JSON.stringify(await h.site.loadCalendar({ force: true })));
  const mode = (iso, hhmm, schoolDay = true) => { const [a, b] = hhmm.split(':').map(Number); return JSON.parse(JSON.stringify(h.today.menuMode({ date: new Date(`${iso}T12:00:00Z`), minutes: a * 60 + b, schoolDay }, { secondEnd: 9 * 60 + 30, holidays, nextSchoolDay: h.site.nextSchoolDay }))); };
  assert.equal(mode('2026-11-18', '07:50').kind, 'breakfast');
  assert.equal(mode('2026-11-18', '09:29').kind, 'breakfast');
  assert.equal(mode('2026-11-18', '09:30').kind, 'lunch');
  assert.equal(mode('2026-11-18', '13:59').kind, 'lunch');
  assert.deepEqual(mode('2026-11-18', '14:00'), { kind: 'next', date: '2026-11-19', days: 1 });
  assert.deepEqual(mode('2026-11-20', '15:00'), { kind: 'next', date: '2026-11-23', days: 3 }, 'Friday → Monday');
  assert.deepEqual(mode('2026-11-21', '10:00', false), { kind: 'next', date: '2026-11-23', days: 2 }, 'Saturday');
  assert.equal(mode('2027-01-05', '10:00', false).kind, 'rest', 'winter holidays');
  assert.equal(mode('2026-12-30', '15:00').kind, 'rest', 'after lessons before the holidays');
});

test('the joke line: by the main dish and weekday, never the same two school days in a row', async () => {
  const h = await startScreen(null, { sheets: {}, epoch: at('09:00') });
  const phrases = { byIcon: { meat: ['Котлета!'] }, byWeekday: { 3: ['Среда!'] }, any: ['Всем привет'] };
  const a = h.today.phraseFor(phrases, '2026-11-18', 'meat');
  assert.ok(['Котлета!', 'Среда!', 'Всем привет'].includes(a));
  assert.equal(h.today.phraseFor(phrases, '2026-11-18', 'meat'), a, 'the same all day');
  const b = h.today.phraseFor({ any: ['Один', 'Два'] }, '2026-11-19', 'meat', { date: '2026-11-18', icon: 'meat' });
  assert.notEqual(b, h.today.phraseFor({ any: ['Один', 'Два'] }, '2026-11-18', 'meat'));
  assert.equal(h.today.mainDish({ items: [{ icon: 'salad' }, { icon: 'soup' }, { icon: 'meat', name: 'Котлета' }, { icon: 'compote' }] }).name, 'Котлета');
  assert.equal(h.today.phraseFor(null, '2026-11-18', 'meat'), '');
});

test('the menu card follows the time: 07:50 breakfast, 11:30 lunch, 15:00 tomorrow', async () => {
  const morning = await tvAt('07:50', { search: '?slide=today' });
  assert.match(morning.board(), /Сегодня на завтрак[\s\S]*Жаркое по-домашнему с птицей[\s\S]*А на обед: Салат витаминный/);
  const noon = await tvAt('11:30', { search: '?slide=today' });
  assert.match(noon.board(), /Сегодня на обед[\s\S]*td-dishes--list[\s\S]*Мясо тушёное[\s\S]*На завтрак было: Жаркое/);
  const after = await tvAt('15:00', { search: '?slide=today' });
  assert.match(after.board(), /Завтра в меню[\s\S]*Завтрак[\s\S]*Запеканка творожная[\s\S]*Обед[\s\S]*Плов с птицей/, 'Thursday is cycle day 9');
  assert.doesNotMatch(after.board(), /ккал|kcal| г</, 'no grams or calories on the screen');
  const friday = await tvAt('15:00', { search: '?slide=today', date: '2026-11-20' });
  assert.match(friday.board(), /В понедельник в меню[\s\S]*Блинчики/);
  const holidays = await tvAt('11:00', { search: '?slide=today', date: '2027-01-05' });
  assert.match(holidays.board(), /Приятного отдыха!/);
});

test('blocks: no empty cards; duty, task with QR and the yesterday result when there is data', async () => {
  const bare = await tvAt('11:30', { search: '?slide=today' });
  assert.match(bare.board(), /td-duty[\s\S]*1 смена[\s\S]*6К, 4Б[\s\S]*2 смена[\s\S]*8Г, 3Г/);
  assert.doesNotMatch(bare.board(), /td-events|td-task|td-ticker|нет данных/, 'nothing published — no cards for it');
  const full = await tvAt('11:30', { search: '?slide=today', extra: {
    'События_сайт': [['Дата', 'Время', 'Что', 'Где', 'Для', 'Опубликовано'], ['18.11.2026', '08:30', 'Линейка', 'Холл', 'Всем', ''], ['18.11.2026', '14:00', 'Педсовет', '211', 'Учителям', ''], ['18.11.2026', '15:00', 'Концерт', 'Актовый зал', 'Всем', '']],
    'Задача_дня': [['Дата', 'Задача', 'Пояснение', 'Параллели'], ['18.11.2026', 'Сколько будет 2+2×2?', '', '']],
    'Задача_дня_итоги': [['Дата', 'Верных', 'Всего ответов', 'Первым решил', 'Ответ'], ['17.11.2026', '5', '20', '9В', '12']],
  } });
  const board = full.board();
  assert.match(board, /Сегодня в школе[\s\S]*15:00[\s\S]*Концерт/);
  assert.doesNotMatch(board, /Линейка|Педсовет/, '08:30 is over; teachers-only is not for pupils');
  assert.match(board, /td-task[\s\S]*<svg[^>]+aria-label="QR-код: ответить на задачу дня"[\s\S]*Сколько будет 2\+2×2\?[\s\S]*Вчера первым решил 9В · ответ: 12/);
  assert.equal(full.context.document.getElementById('kicker').textContent, 'Праздник дня');
  assert.equal(full.grade(), 'День рождения Деда Мороза');
});

test('rotation in a lesson: «Сегодня» after every parallel, 20 s; boards stay 15 s', async () => {
  const h = await tvAt('08:10');
  assert.deepEqual(h.chips(), ['5', '6', '7', '9', '10–11', 'Сегодня']);
  assert.equal(h.grade(), '5');
  assert.equal(h.pageTimers(15000), 1);
  await h.advance(15000);
  assert.ok(h.today(), 'then «Сегодня»');
  assert.equal(h.pageTimers(20000), 1, 'for 20 seconds');
  assert.equal(h.text('next-text'), 'Дальше расписание через 20 с');
  await h.advance(20000);
  assert.equal(h.grade(), '6');
  await h.advance(15000);
  assert.ok(h.today());
});

test('rotation on a break: «Сегодня» once per round, after all parallels', async () => {
  const h = await tvAt('08:43'); // the break after the 1st lesson
  const seen = [];
  for (let i = 0; i < 7; i += 1) { seen.push(h.today() ? 'Сегодня' : h.grade()); await h.advance(h.today() ? 20000 : 15000); }
  assert.deepEqual(seen, ['5', '6', '7', '9', '10–11', 'Сегодня', '5']);
});

test('no lessons left — only «Сегодня»; a locked parallel never shows it', async () => {
  const late = await tvAt('16:00');
  assert.ok(late.today());
  assert.match(late.board(), /Завтра в меню/);
  assert.equal(late.pageTimers(20000) + late.pageTimers(15000), 0, 'one page, nothing turns');
  const locked = await tvAt('08:10', { search: '?parallel=9' });
  for (let i = 0; i < 4; i += 1) { assert.ok(!locked.today()); await locked.advance(15000); }
  assert.equal(locked.grade(), '9');
});

runTests('«Сегодня» slide checks', tests);
