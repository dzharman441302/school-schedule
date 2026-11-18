'use strict';
// today-core.js: what the «Сегодня» slide picks from each source — weather advice, the
// holiday countdown, duty classes of the week, the most punctual class, the ticker, the day note.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startScreen, runTests } = require('./tv-harness');

const CALENDAR = [['Дата начала', 'Дата окончания', 'Название'], ['26.10.2026', '03.11.2026', 'Осенние каникулы'], ['04.11.2026', '', 'День народного единства'], ['31.12.2026', '10.01.2027', 'Зимние каникулы'], ['27.03.2027', '04.04.2027', 'Весенние каникулы'], ['27.05.2027', '31.08.2027', 'Летние каникулы']];
const plain = (v) => JSON.parse(JSON.stringify(v));
async function today() {
  const screen = await startScreen(null, { sheets: { 'Календарь': CALENDAR }, epoch: '2026-11-18T05:00:00Z' });
  const holidays = plain(await screen.site.loadCalendar({ force: true }));
  return { t: screen.today, holidays };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('weather: the Open-Meteo answer, the forecast at 14:00 and the advice by simple rules', async () => {
  const { t } = await today();
  const json = { current: { temperature_2m: -2.4, apparent_temperature: -6.1, weather_code: 73, wind_speed_10m: 4, precipitation: 0.3 }, hourly: { time: ['2026-11-18T13:00', '2026-11-18T14:00'], temperature_2m: [-1, 0.4], weather_code: [73, 3], precipitation_probability: [60, 20] } };
  const w = plain(t.parseWeather(json, new Date('2026-11-18T07:00:00Z')));
  assert.deepEqual({ temp: w.temp, feels: w.feels, text: w.text, icon: w.icon }, { temp: -2, feels: -6, text: 'Снег', icon: '🌨️' });
  assert.deepEqual(w.at14, { temp: 0, code: 3, rain: 20, text: 'Пасмурно', icon: '☁️' });
  assert.equal(t.parseWeather(json, new Date('2026-11-18T12:00:00Z')).at14, null, 'after 14:00 no forecast for 14:00');
  const advice = (over) => t.weatherAdvice({ temp: 10, code: 1, wind: 2, precipitation: 0, at14: null, ...over });
  assert.equal(advice({ code: 95 }), 'Гроза — переждите в школе');
  assert.equal(advice({ temp: -20, code: 0 }), 'Мороз! Шарф и варежки обязательны');
  assert.equal(advice({ temp: -1, code: 73 }), 'Скользко — не беги');
  assert.equal(advice({ temp: 5, code: 66 }), 'Скользко — не беги');
  assert.equal(advice({ temp: -8, code: 71 }), 'Снег — надень непромокаемую обувь');
  assert.equal(advice({ code: 3, at14: { code: 61, rain: 80 } }), 'Не забудь зонт');
  assert.equal(advice({ temp: 4, code: 3 }), 'Шапка обязательна');
  assert.equal(advice({ wind: 12, code: 3 }), 'Сильный ветер — застегнись');
  assert.equal(advice({ temp: 27, code: 0 }), 'Жарко — возьми с собой воду');
  assert.equal(advice({ code: 0 }), 'Хорошая погода — погуляй после уроков');
  assert.equal(t.weatherAdvice(null), '');
  assert.equal(t.parseWeather({}), null);
});

test('holidays: days before, «Завтра каникулы!» on the last school day, nothing during, summer', async () => {
  const { t, holidays } = await today();
  const c = (iso) => plain(t.holidayCountdown(holidays, iso));
  assert.deepEqual({ ...c('2026-11-18'), title: undefined }, { kind: 'holidays', days: 43, title: undefined, text: '43 дня до зимних каникул', caption: 'дня до зимних каникул' });
  assert.equal(c('2026-12-30').text, 'Завтра каникулы!');
  assert.equal(c('2027-01-05'), null, 'during the holidays');
  assert.equal(c('2027-01-11').text, '75 дней до весенних каникул');
  assert.equal(c('2027-03-26').text, 'Завтра каникулы!', 'Friday before holidays from Saturday');
  assert.equal(c('2027-04-05').text, 'до лета 52 дня');
  assert.equal(c('2027-05-26').text, 'Завтра лето!');
  assert.equal(c('2026-11-04').text, '57 дней до зимних каникул', 'a one-day holiday is not «каникулы»: the countdown stays');
});

test('duty: both shifts of the week that has the date; nothing for a week without rows', async () => {
  const { t } = await today();
  const rows = [['Неделя с', 'Неделя по', 'Смена', 'Классы'], ['16.11.2026', '20.11.2026', '1', '6К, 4Б'], ['23.11.2026', '27.11.2026', '1', '5А, 4В'], ['16.11.2026', '20.11.2026', '2', '8Г, 3Г']];
  assert.equal(t.dutyFor(rows, '2026-11-18').text, '1 смена: 6К, 4Б · 2 смена: 8Г, 3Г');
  assert.deepEqual(plain(t.dutyFor(rows, '2026-11-25')).shifts, [{ shift: 1, classes: ['5А', '4В'] }]);
  assert.equal(t.dutyFor(rows, '2026-12-02'), null);
  assert.equal(t.dutyFor([], '2026-11-18'), null);
});

test('the most punctual class: the longest run without a late pupil, then fewer lates', async () => {
  const { t } = await today();
  const board = { rows: [{ cls: '9В', streak: 5, count: 0 }, { cls: '7А', streak: 5, count: 1 }, { cls: '6К', streak: 2, count: 0 }, { cls: '5А', streak: 0, count: 3 }] };
  assert.deepEqual(plain(t.punctualClass(board)), { cls: '9В', days: 5, text: '9В · 5 дней без опозданий' });
  assert.equal(t.punctualClass({ rows: [{ cls: '5А', streak: 0, count: 1 }] }), null);
  assert.equal(t.punctualClass(null), null);
  assert.equal(t.punctualClass({ rows: [{ cls: '8Б', streak: 1, count: 0 }] }).text, '8Б · 1 день без опозданий');
});

test('ticker: only notices marked «На экран» for this audience, active and within dates', async () => {
  const { t } = await today();
  const head = ['ID', 'Опубликовано', 'Заголовок', 'Текст', 'Тип', 'Начало', 'Окончание', 'Картинка', 'Файлы JSON', 'Текст кнопки', 'Ссылка', 'Аудитория', 'Активно', 'Классы', 'Рассылка в бот', 'На экран'];
  const row = (id, title, screen, extra = {}) => { const r = Array(16).fill(''); r[0] = id; r[2] = title; r[3] = extra.text || ''; r[5] = extra.from || ''; r[6] = extra.to || ''; r[12] = extra.active ?? 'true'; r[15] = screen; return r; };
  const rows = [head, row('1', 'Концерт в актовом зале', 'Всем', { text: 'в 15:00' }), row('2', 'Педсовет', 'Учителям'), row('3', 'Сбор макулатуры', 'Ученикам', { to: '17.11.2026' }), row('4', 'Не на экран', ''), row('5', 'Выключено', 'Всем', { active: 'false' }), row('6', 'Олимпиада по математике', 'ученикам', { from: '18.11.2026' })];
  assert.deepEqual(plain(t.tickerItems(rows, '2026-11-18', 'students')), ['Олимпиада по математике', 'Концерт в актовом зале — в 15:00']);
  assert.deepEqual(plain(t.tickerItems(rows, '2026-11-18', 'teachers')), ['Педсовет', 'Концерт в актовом зале — в 15:00']);
  assert.deepEqual(plain(t.tickerItems([head.slice(0, 15)], '2026-11-18')), [], 'no «На экран» column yet: nothing on the TV');
});

test('day note: one line per date from data/days.json, empty days give nothing', async () => {
  const { t } = await today();
  const days = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'days.json'), 'utf8')).days;
  assert.equal(t.dayNote(days, '2026-11-18'), 'День рождения Деда Мороза');
  assert.equal(t.dayNote(days, '2027-04-12'), 'День космонавтики');
  assert.equal(t.dayNote(days, '2026-11-17'), '');
  assert.ok(Object.keys(days).every((k) => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(k)), 'keys are ММ-ДД');
  assert.ok(Object.values(days).every((v) => v.length <= 90), 'short enough for the badge');
});

test('«Сегодня в школе»: published events of the day, up to three, past ones gone, teachers-only hidden from pupils', async () => {
  const { t } = await today();
  const rows = [['Дата', 'Время', 'Что', 'Где', 'Для', 'Опубликовано'],
    ['18.11.2026', '8:30:00', 'Линейка', 'Холл', 'Всем', ''], ['18.11.2026', "'11:00", 'Олимпиада по физике', '304', 'Всем', ''],
    ['18.11.2026', '14:00', 'Педсовет', '211', 'Учителям', ''], ['18.11.2026', '15:00', 'Концерт', 'Актовый зал', 'Всем', ''],
    ['18.11.2026', '', 'Неделя безопасности', '', 'Всем', ''], ['19.11.2026', '10:00', 'Завтрашнее', '', 'Всем', '']];
  const at = (hhmm, audience, limit) => plain(t.eventsFor(rows, '2026-11-18', hhmm == null ? null : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), audience, limit)).map((e) => `${e.time || 'весь день'} ${e.what}`);
  assert.deepEqual(at('07:50'), ['весь день Неделя безопасности', '08:30 Линейка', '11:00 Олимпиада по физике']);
  assert.deepEqual(at('11:05', 'students', 5), ['весь день Неделя безопасности', '11:00 Олимпиада по физике', '15:00 Концерт'], 'started 5 min ago: still shown; teachers-only hidden');
  assert.deepEqual(at('11:30', 'teachers', 5), ['весь день Неделя безопасности', '14:00 Педсовет', '15:00 Концерт']);
  assert.deepEqual(at('16:00'), ['весь день Неделя безопасности']);
  assert.deepEqual(plain(t.eventsFor([], '2026-11-18', 600)), []);
});

test('«Задача дня»: the task of the date and the result of the last one', async () => {
  const { t } = await today();
  const tasks = [['Дата', 'Задача', 'Пояснение', 'Параллели'], ['18.11.2026', 'Сколько будет 2+2×2?', 'Порядок действий', '5, 6'], ['19.11.2026', 'Завтрашняя', '', '']];
  assert.deepEqual(plain(t.taskFor(tasks, '2026-11-18')), { date: '2026-11-18', task: 'Сколько будет 2+2×2?', explain: 'Порядок действий', parallels: ['5', '6'] });
  assert.equal(t.taskFor(tasks, '2026-11-20'), null);
  const results = [['Дата', 'Верных', 'Всего ответов', 'Первым решил', 'Ответ'], ['16.11.2026', '3', '9', '7А', '12'], ['17.11.2026', '5', '20', '9В', '6']];
  assert.equal(t.taskResultBefore(results, '2026-11-18').text, 'Вчера первым решил 9В · ответ: 6');
  assert.equal(t.taskResultBefore(results, '2026-11-20').text, 'В прошлый раз первым решил 9В · ответ: 6', 'after a weekend');
  assert.equal(t.taskResultBefore(results, '2026-11-30'), null, 'old results are not shown');
  assert.equal(t.taskResultBefore([results[0], ['17.11.2026', '0', '4', '', '6']], '2026-11-18').text, 'Ответ на задачу: 6', 'nobody solved it');
});

test('weather: Open-Meteo first; if the screen cannot reach it — through the school script; status for ?debug=1', async () => {
  const forecast = { current: { temperature_2m: 3.6, apparent_temperature: 1, weather_code: 3, wind_speed_10m: 2, precipitation: 0 } };
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  let direct = true, posts = 0;
  const screen = await startScreen(null, {
    sheets: { 'Настройки_сайта': [['Ключ', 'Значение'], ['appsScriptUrl', 'https://script.google.com/macros/s/x/exec']] }, epoch: '2026-11-18T08:00:00Z',
    fetchMore: (url, options) => {
      if (/open-meteo/.test(url)) return direct ? reply(forecast) : Promise.reject(new Error('Failed to fetch'));
      if (/script\.google\.com/.test(url)) { posts += 1; assert.equal(JSON.parse(options.body).action, 'weather'); return reply({ ok: true, weather: { ...forecast, current: { ...forecast.current, temperature_2m: -1.2 } } }); }
      return null;
    },
  });
  const t = screen.today;
  assert.equal((await t.loadWeather({ force: true })).temp, 4);
  assert.equal(t.weatherStatus.source, 'open-meteo');
  assert.equal(posts, 0, 'the script is not asked when Open-Meteo answers');
  direct = false;
  const w = await t.loadWeather({ force: true });
  assert.equal(w.temp, -1, 'the forecast came through the school script');
  assert.equal(t.weatherStatus.source, 'через скрипт школы');
  assert.match(t.weatherStatus.error, /напрямую: Failed to fetch/);
  assert.equal(posts, 1);
});

runTests('«Сегодня» data checks', tests);
