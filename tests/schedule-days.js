'use strict';
// Panel: bell variants and shortened days (Bells.gs), class gaps in the grid check.
const assert = require('node:assert/strict');
const { createHarness } = require('./schedule-fixture');

const SHORT = ['08:00–08:30', '08:40–09:10', '09:25–09:55', '10:10–10:40', '10:50–11:20', '11:30–12:00', '12:10–12:40', '12:50–13:20', '13:30–14:00', '14:10–14:40', '14:50–15:20', '15:30–16:00'];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('bell sheets are created with the usual times and an empty shortened variant', () => {
  const h = createHarness();
  const b = h.plain(h.call('getBells', h.token));
  assert.deepEqual(b.order, ['Основное', 'Сокращённое']);
  assert.deepEqual(b.variants['Основное'][0], ['08:00', '08:40']);
  assert.deepEqual(b.variants['Основное'][11], ['17:50', '18:30']);
  assert.equal(b.ready['Основное'], true);
  assert.equal(b.ready['Сокращённое'], false);
  assert.deepEqual(h.sheets.get('Звонки').rows[1], [1, '08:00–08:40', '']);
  assert.deepEqual(h.sheets.get('Звонки_даты').rows[0], ['Дата', 'Вариант', 'Комментарий']);
});

test('a shortened day can be chosen only after its times are filled in', () => {
  const h = createHarness();
  assert.throws(() => h.call('setDayBells', h.token, h.date, 'Сокращённое'), /Сначала заполните время/);
  h.call('saveBells', h.token, { 'Сокращённое': SHORT });
  const day = h.plain(h.call('setDayBells', h.token, h.date, 'Сокращённое', 'концерт'));
  assert.equal(day.variant, 'Сокращённое');
  assert.deepEqual(day.times[1], ['08:40', '09:10']);
  const admin = h.plain(h.call('getAdminDay', h.token, h.date));
  assert.equal(admin.bells.variant, 'Сокращённое');
  assert.deepEqual(h.sheets.get('Звонки_даты').rows[1], ['25.09.2026', 'Сокращённое', 'концерт']);
  h.call('setDayBells', h.token, h.date, 'Основное');
  assert.equal(h.sheets.get('Звонки_даты').getLastRow(), 1);
  assert.equal(h.plain(h.call('getAdminDay', h.token, h.date)).bells.variant, 'Основное');
});

test('bell times are checked before they are saved', () => {
  const h = createHarness();
  assert.throws(() => h.call('saveBells', h.token, { 'Сокращённое': ['8:00', ...SHORT.slice(1)] }), /1 урок: «8:00» — нужно в виде 08:00–08:40/);
  assert.throws(() => h.call('saveBells', h.token, { 'Сокращённое': [SHORT[0], '08:20–08:50', ...SHORT.slice(2)] }), /2 урок начинается раньше конца 1-го/);
  assert.throws(() => h.call('saveBells', h.token, { 'Основное': Array(12).fill('') }), /не может быть пустым/);
  const saved = h.plain(h.call('saveBells', h.token, { 'Сокращённое': SHORT.map((x) => x.replace('–', ' - ').replace(/^0/, '')) }));
  assert.deepEqual(saved.variants['Сокращённое'][0], ['08:00', '08:30']);
  assert.equal(h.sheets.get('Звонки').rows[1][2], '08:00–08:30');
});

test('the panel gets today\'s bells at login', () => {
  const h = createHarness();
  const d = h.plain(h.call('getInitialData', h.token));
  assert.equal(d.todayBells.variant, 'Основное');
  assert.deepEqual(d.bellVariants, ['Основное', 'Сокращённое']);
  assert.equal(d.bellsReady['Сокращённое'], false);
});

// 7Б: lessons 1–3 with three teachers, 7В has a usual empty 2nd lesson.
function gapHarness() {
  const h = createHarness();
  const day = (v) => ['', '', '', '', v];
  h.put('Учителя', [['ФИО', 'УРОК', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'],
    ['Первая А.А.', 1, ...day('7Б|Рус|301')], ['Вторая Б.Б.', 2, ...day('7Б|Мат|302')], ['Третья В.В.', 3, ...day('7Б|Ист|303')],
    ['Первая А.А.', 3, ...day('7В|Рус|301')], ['Вторая Б.Б.', 1, ...day('7В|Мат|302')], ['Свободная Г.Г.', 4, ...day('')]]);
  h.put('Расписание', [['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'],
    ['7Б', 1, '', '', '', '', 'Русский язык (301)'], ['7Б', 2, '', '', '', '', 'Математика (302)'], ['7Б', 3, '', '', '', '', 'История (303)'],
    ['7В', 1, '', '', '', '', 'Математика (302)'], ['7В', 3, '', '', '', '', 'Русский язык (301)']]);
  return h;
}
const warnings = (h, edits) => h.plain(h.call('validateAdminDay', h.token, h.date, edits)).warnings.filter((x) => /окно/.test(x));

test('a lesson taken out of the middle of a class\'s day is reported as a gap', () => {
  const h = gapHarness();
  assert.deepEqual(warnings(h, [{ teacher: 'Вторая Б.Б.', lesson: 2, type: 'cancel' }]), ['7Б: окно на 2 уроке — дети без урока между 1-м и 3-м']);
});

test('moving the first or last lesson, or the usual gap of a class, is not a gap', () => {
  const h = gapHarness();
  assert.deepEqual(warnings(h, [{ teacher: 'Первая А.А.', lesson: 1, type: 'cancel' }]), []);
  assert.deepEqual(warnings(h, [{ teacher: 'Третья В.В.', lesson: 3, type: 'cancel' }]), []);
  assert.deepEqual(warnings(h, []), []);
});

test('a lesson added after an empty period makes a gap; filling it removes the warning', () => {
  const h = gapHarness();
  const late = { teacher: 'Свободная Г.Г.', lesson: 4, type: 'set', className: '7Б', subject: 'Музыка', room: '304' };
  assert.deepEqual(warnings(h, [{ teacher: 'Третья В.В.', lesson: 3, type: 'cancel' }, late]), ['7Б: окно на 3 уроке — дети без урока между 2-м и 4-м']);
  assert.deepEqual(warnings(h, [late]), []);
});

(async () => {
  for (const [name, fn] of tests) { await fn(); console.log('PASS ' + name); }
  console.log(`${tests.length} day settings checks passed`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
