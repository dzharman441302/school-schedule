// Данные слайда «Сегодня» (ТВ в коридоре и в учительской): погода, «до каникул», дежурные
// классы, самый пунктуальный класс недели, бегущая строка, праздник дня. Чистые функции
// выбора отдельно от загрузки, чтобы их можно было проверить тестами. Каждый источник с
// кэшем: если он недоступен, функция отдаёт последние данные или null — блок на экране просто
// скрывается, ошибок на экране не бывает.
(() => {
  'use strict';
  const site = window.SchoolSite;
  const config = window.SCHOOL_CONFIG || {};
  if (!site) return;

  const sheets = config.googleSheets?.sheets || {};
  const TODAY = config.today || {};
  const WEATHER_MS = 30 * 60 * 1000;
  const DAY = 86400000;
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const dateOf = (v) => (typeof v?.getUTCFullYear === 'function' ? new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 12)) : new Date(`${String(v).slice(0, 10)}T12:00:00Z`));
  function isoDate(v) {
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  }
  // fetch with a time limit: a site blocked by the school network answers nothing at all.
  function fetchSoon(url, ms = 8000, options = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      fetch(url, options).then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }
  const headerIndex = (row, names, fallback) => { const n = (v) => String(v ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s_]+/g, ''); const i = (row || []).map(n).findIndex((h) => names.map(n).includes(h)); return i >= 0 ? i : fallback; };

  /* Погода (Open-Meteo, без ключа) ------------------------------------------- */

  // WMO weather_code → русское описание и иконка.
  const WMO = [
    [[0], 'Ясно', '☀️'], [[1], 'Почти ясно', '🌤️'], [[2], 'Переменная облачность', '⛅'], [[3], 'Пасмурно', '☁️'],
    [[45, 48], 'Туман', '🌫️'], [[51, 53, 55], 'Морось', '🌦️'], [[56, 57], 'Ледяная морось', '🌧️'],
    [[61], 'Небольшой дождь', '🌧️'], [[63], 'Дождь', '🌧️'], [[65], 'Сильный дождь', '🌧️'], [[66, 67], 'Ледяной дождь', '🌧️'],
    [[71], 'Небольшой снег', '🌨️'], [[73], 'Снег', '🌨️'], [[75], 'Сильный снег', '❄️'], [[77], 'Снежная крупа', '🌨️'],
    [[80], 'Небольшой ливень', '🌦️'], [[81], 'Ливень', '🌧️'], [[82], 'Сильный ливень', '⛈️'], [[85, 86], 'Снегопад', '🌨️'],
    [[95], 'Гроза', '⛈️'], [[96, 99], 'Гроза с градом', '⛈️'],
  ];
  function weatherText(code) {
    const hit = WMO.find(([codes]) => codes.includes(Number(code)));
    return hit ? { text: hit[1], icon: hit[2] } : { text: 'Погода', icon: '🌡️' };
  }
  const RAIN = [51, 53, 55, 61, 63, 65, 80, 81, 82];
  const FREEZING = [56, 57, 66, 67];
  const SNOW = [71, 73, 75, 77, 85, 86];
  const STORM = [95, 96, 99];

  // Open-Meteo answer → { temp, feels, code, text, icon, wind, precipitation, at14 }.
  // at14 — прогноз на 14:00 сегодняшнего дня (пока 14:00 не прошло).
  function parseWeather(json, now = new Date()) {
    const c = json?.current;
    if (!c || typeof c.temperature_2m !== 'number') return null;
    const out = { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature ?? c.temperature_2m), code: Number(c.weather_code), wind: Math.round(Number(c.wind_speed_10m) || 0), precipitation: Number(c.precipitation) || 0, ...weatherText(c.weather_code), at14: null };
    const h = json.hourly, today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(now);
    const i = h?.time ? h.time.indexOf(`${today}T14:00`) : -1;
    const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (i >= 0 && hourNow < 14) out.at14 = { temp: Math.round(h.temperature_2m[i]), code: Number(h.weather_code?.[i]), rain: Number(h.precipitation_probability?.[i]) || 0, ...weatherText(h.weather_code?.[i]) };
    return out;
  }

  // Короткий совет по погоде: первое подходящее из восьми простых правил.
  function weatherAdvice(w) {
    if (!w) return '';
    const later = w.at14 || {}, codes = [w.code, later.code];
    const wet = codes.some((c) => RAIN.includes(c) || FREEZING.includes(c)) || w.precipitation > 0 || later.rain >= 50;
    if (codes.some((c) => STORM.includes(c))) return 'Гроза — переждите в школе';
    if (w.temp <= -15) return 'Мороз! Шарф и варежки обязательны';
    if (codes.some((c) => FREEZING.includes(c)) || (w.temp >= -3 && w.temp <= 2 && (wet || codes.some((c) => SNOW.includes(c))))) return 'Скользко — не беги';
    if (codes.some((c) => SNOW.includes(c))) return 'Снег — надень непромокаемую обувь';
    if (wet) return 'Не забудь зонт';
    if (w.temp <= 5) return 'Шапка обязательна';
    if (w.wind >= 10) return 'Сильный ветер — застегнись';
    if (w.temp >= 25) return 'Жарко — возьми с собой воду';
    return [0, 1].includes(w.code) ? 'Хорошая погода — погуляй после уроков' : 'Одевайся по погоде';
  }

  const WEATHER_KEY = 'school20:weather';
  let weatherMemory = null;
  // What happened to the weather last time — shown on a screen opened with ?debug=1.
  const weatherStatus = { source: '', at: 0, error: '' };
  const errorText = (e) => String(e?.message || e || 'ошибка').slice(0, 80);

  // The school's Apps Script (address in «Настройки_сайта») fetches the same forecast on Google's
  // side: for a screen whose browser cannot reach Open-Meteo (a wrong clock, a blocker, an old browser).
  async function weatherViaSchool() {
    const rows = await site.loadSheet(sheets.siteSettings || 'Настройки_сайта', { optional: true, ttl: 60 * 60 * 1000 });
    const url = String(rows?.slice(1).find((r) => String(r[0] || '') === 'appsScriptUrl')?.[1] || '');
    if (!/^https:\/\/script\.google\.com\//.test(url)) throw new Error('нет адреса скрипта');
    const res = await fetchSoon(url, 15000, { method: 'POST', body: JSON.stringify({ action: 'weather' }) });
    if (!res.ok) throw new Error(`скрипт ${res.status}`);
    const answer = await res.json();
    if (!answer?.ok) throw new Error(answer?.error || 'скрипт без погоды');
    return answer.weather;
  }

  // Тверь по умолчанию; координаты можно поменять в config.js → today.
  async function loadWeather({ force = false } = {}) {
    const now = Date.now();
    if (!weatherMemory) { try { weatherMemory = JSON.parse(site.storageGet(WEATHER_KEY) || 'null'); } catch (_) {} }
    if (!force && weatherMemory && now - weatherMemory.at < WEATHER_MS) return parseWeather(weatherMemory.json);
    const lat = TODAY.latitude ?? 56.86, lon = TODAY.longitude ?? 35.9;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m,weather_code,precipitation_probability&timezone=Europe%2FMoscow&forecast_days=1&wind_speed_unit=ms`;
    let json = null, direct = '';
    try {
      const res = await fetchSoon(url);
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      json = await res.json();
      if (!parseWeather(json)) throw new Error('open-meteo: пустой ответ');
      Object.assign(weatherStatus, { source: 'open-meteo', at: now, error: '' });
    } catch (e) {
      direct = errorText(e);
      try {
        json = await weatherViaSchool();
        if (!parseWeather(json)) throw new Error('пустой ответ');
        Object.assign(weatherStatus, { source: 'через скрипт школы', at: now, error: `напрямую: ${direct}` });
      } catch (e2) {
        json = null;
        Object.assign(weatherStatus, { error: `напрямую: ${direct}; через скрипт: ${errorText(e2)}` });
      }
    }
    if (json) {
      weatherMemory = { at: now, json };
      try { site.storageSet(WEATHER_KEY, JSON.stringify(weatherMemory)); } catch (_) {}
    } else if (!weatherMemory || now - weatherMemory.at > 3 * 60 * 60 * 1000) {
      // Нет связи: старые данные годятся до трёх часов, дальше блок скрывается.
      return null;
    }
    return parseWeather(weatherMemory.json);
  }

  /* До каникул ----------------------------------------------------------------- */

  // holidays — записи листа «Календарь» ({ from, to, title }, даты ISO или отметки времени).
  // Ближайшие будущие каникулы: «40 дней до зимних каникул», «до лета 120 дней»; в последний
  // учебный день — «Завтра каникулы!»; во время каникул — null (блок не показывается).
  function holidayCountdown(holidays, date) {
    const today = dateOf(date), t = today.getTime();
    const list = (holidays || []).map((h) => ({ from: dateOf(typeof h.from === 'number' ? new Date(h.from) : h.from), to: dateOf(typeof h.to === 'number' ? new Date(h.to) : (h.to || h.from)), title: String(h.title || '') }))
      .filter((h) => /каникул/i.test(h.title)).sort((a, b) => a.from - b.from);
    if (list.some((h) => t >= h.from.getTime() && t <= h.to.getTime())) return null;
    const next = list.find((h) => h.from.getTime() > t);
    if (!next) return null;
    let last = new Date(next.from.getTime() - DAY);
    for (let i = 0; i < 30 && !site.isSchoolDay(last); i += 1) last = new Date(last.getTime() - DAY);
    const summer = /летн/i.test(next.title);
    if (last.getTime() === t) return { kind: 'tomorrow', days: Math.round((next.from - today) / DAY), title: next.title, text: summer ? 'Завтра лето!' : 'Завтра каникулы!' };
    const days = Math.round((next.from - today) / DAY);
    const which = next.title.split(/\s+/)[0].toLowerCase().replace(/ие$/, 'их');
    return summer
      ? { kind: 'summer', days, title: next.title, text: `до лета ${days} ${plural(days, 'день', 'дня', 'дней')}`, caption: plural(days, 'день', 'дня', 'дней') + ' до лета' }
      : { kind: 'holidays', days, title: next.title, text: `${days} ${plural(days, 'день', 'дня', 'дней')} до ${which} каникул`, caption: `${plural(days, 'день', 'дня', 'дней')} до ${which} каникул` };
  }

  /* Дежурство -------------------------------------------------------------------- */

  // Лист «Дежурство»: Неделя с | Неделя по | Смена | Классы. Обе смены недели, в которую
  // попадает дата; null — если на эту неделю строк нет.
  function dutyFor(rows, date) {
    if (!rows?.length) return null;
    const h = rows[0], iso = isoOf(dateOf(date));
    const i = { from: headerIndex(h, ['Неделя с', 'С'], 0), to: headerIndex(h, ['Неделя по', 'По'], 1), shift: headerIndex(h, ['Смена'], 2), classes: headerIndex(h, ['Классы', 'Класс'], 3) };
    const shifts = rows.slice(1).map((r) => ({ from: isoDate(r[i.from]), to: isoDate(r[i.to]) || isoDate(r[i.from]), shift: Number(String(r[i.shift]).replace(/\D/g, '')) || 1, classes: String(r[i.classes] || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean) }))
      .filter((r) => r.from && r.from <= iso && r.to >= iso && r.classes.length)
      .sort((a, b) => a.shift - b.shift);
    if (!shifts.length) return null;
    return { shifts: shifts.map((s) => ({ shift: s.shift, classes: s.classes })), text: shifts.map((s) => `${s.shift} смена: ${s.classes.join(', ')}`).join(' · ') };
  }

  // Дежурные администраторы на дату: config.js → lateness.duty = { 1: [пн…пт], 2: [пн…пт] }.
  function dutyAdmins(duty, date) {
    const dow = dateOf(date).getUTCDay();
    if (!duty || dow < 1 || dow > 5) return [];
    return [1, 2].map((shift) => ({ shift, name: String(duty[shift]?.[dow - 1] || '').trim() })).filter((x) => x.name);
  }

  /* Сегодня по расписанию (учительская) ------------------------------------------- */

  // «Учителя_сайт» (Дата | Учитель | Урок | Класс | Предмет | Кабинет | Статус | …): изменения
  // опубликованной сетки на дату. published — есть ли вообще опубликованная сетка на эту дату.
  function changesSummary(rows, date) {
    const iso = isoOf(dateOf(date));
    const day = (rows || []).slice(1).filter((r) => isoDate(r[0]) === iso);
    const out = { published: day.length > 0, total: 0, cancelled: 0, changed: 0, room: 0, teachers: 0 };
    const teachers = new Set();
    day.forEach((r) => {
      const status = String(r[6] || 'normal').trim().toLowerCase();
      if (!status || status === 'normal') return;
      out.total += 1;
      if (/cancel|отмен/.test(status)) out.cancelled += 1;
      else if (/room|кабин/.test(status)) out.room += 1;
      else out.changed += 1;
      teachers.add(String(r[1] || '').trim());
    });
    teachers.delete('');
    out.teachers = teachers.size;
    return out;
  }

  /* Самый пунктуальный класс ---------------------------------------------------- */

  // По рейтингу опозданий (LatenessCore.board): класс с самой длинной серией учебных дней
  // подряд без опозданий; при равенстве — у кого меньше опозданий за неделю, потом по алфавиту.
  function punctualClass(board) {
    const rows = (board?.rows || []).filter((r) => r.streak >= 1);
    if (!rows.length) return null;
    const collator = new Intl.Collator('ru', { numeric: true });
    const best = rows.slice().sort((a, b) => b.streak - a.streak || a.count - b.count || collator.compare(a.cls, b.cls))[0];
    return { cls: best.cls, days: best.streak, text: `${best.cls} · ${best.streak} ${plural(best.streak, 'день', 'дня', 'дней')} без опозданий` };
  }

  /* Бегущая строка --------------------------------------------------------------- */

  // «Оповещения» из панели: действующие сегодня объявления с отметкой в столбце «На экран»:
  // «Всем», «Ученикам» или «Учителям» (пусто — на ТВ не показывать). Экран учеников берёт
  // «Всем» и «Ученикам», учительская — «Всем» и «Учителям». Новые первыми.
  function tickerItems(rows, date, audience = 'students') {
    if (!rows?.length) return [];
    const h = rows[0], iso = isoOf(dateOf(date));
    const i = { title: headerIndex(h, ['Заголовок'], 2), text: headerIndex(h, ['Текст'], 3), start: headerIndex(h, ['Начало'], 5), end: headerIndex(h, ['Окончание'], 6), active: headerIndex(h, ['Активно'], 12), screen: headerIndex(h, ['На экран', 'Наэкран'], -1) };
    if (i.screen < 0) return [];
    const wanted = audience === 'teachers' ? ['всем', 'учителям'] : ['всем', 'ученикам'];
    return rows.slice(1).filter((r) => {
      const from = isoDate(r[i.start]), to = isoDate(r[i.end]);
      return String(r[i.active] ?? 'true').toLowerCase() !== 'false' && wanted.includes(String(r[i.screen] || '').trim().toLowerCase()) && (!from || from <= iso) && (!to || to >= iso);
    }).reverse().map((r) => {
      const title = String(r[i.title] || '').trim(), text = String(r[i.text] || '').replace(/\s+/g, ' ').trim();
      const body = text.length > 160 ? `${text.slice(0, 159)}…` : text;
      return title && body ? `${title} — ${body}` : title || body;
    }).filter(Boolean);
  }

  /* «Сегодня в школе» ------------------------------------------------------------- */

  // Лист «События_сайт» (Дата | Время | Что | Где | Для | Опубликовано) — только то, что
  // администратор опубликовал в панели. До трёх ближайших событий дня; прошедшие по времени
  // исчезают (событие без времени — на весь день). «Для: Учителям» видит только учительская.
  function eventsFor(rows, date, minutes, audience = 'students', limit = 3) {
    if (!rows?.length) return [];
    const h = rows[0], iso = isoOf(dateOf(date));
    const i = { date: headerIndex(h, ['Дата'], 0), time: headerIndex(h, ['Время'], 1), what: headerIndex(h, ['Что'], 2), where: headerIndex(h, ['Где'], 3), who: headerIndex(h, ['Для'], 4) };
    const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    return rows.slice(1).filter((r) => isoDate(r[i.date]) === iso && String(r[i.what] || '').trim())
      .map((r) => { const at = toMin(String(r[i.time] || '').replace(/^'/, '')); return { time: at == null ? '' : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`, at, what: String(r[i.what]).trim(), where: String(r[i.where] || '').trim(), teachers: /учител/i.test(String(r[i.who] || '')) }; })
      .filter((e) => audience === 'teachers' || !e.teachers)
      .filter((e) => e.at == null || minutes == null || e.at + 10 > minutes) // ещё идёт: 10 минут после начала
      .sort((a, b) => (a.at ?? -1) - (b.at ?? -1))
      .slice(0, limit);
  }

  /* Задача дня ---------------------------------------------------------------------- */

  // «Задача_дня»: Дата | Задача | Пояснение | Параллели. Задача на дату или null.
  function taskFor(rows, date) {
    if (!rows?.length) return null;
    const h = rows[0], iso = isoOf(dateOf(date));
    const i = { date: headerIndex(h, ['Дата'], 0), task: headerIndex(h, ['Задача'], 1), explain: headerIndex(h, ['Пояснение'], 2), parallels: headerIndex(h, ['Параллели'], 3) };
    const r = rows.slice(1).find((x) => isoDate(x[i.date]) === iso && String(x[i.task] || '').trim());
    return r ? { date: iso, task: String(r[i.task]).trim(), explain: String(r[i.explain] || '').trim(), parallels: String(r[i.parallels] || '').split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean) } : null;
  }
  // «Задача_дня_итоги»: Дата | Верных | Всего ответов | Первым решил | Ответ — итог последней
  // прошедшей задачи до даты: «вчера первым решил 9В · ответ: 6».
  function taskResultBefore(rows, date) {
    if (!rows?.length) return null;
    const h = rows[0], iso = isoOf(dateOf(date));
    const i = { date: headerIndex(h, ['Дата'], 0), right: headerIndex(h, ['Верных'], 1), total: headerIndex(h, ['Всего ответов', 'Всего'], 2), first: headerIndex(h, ['Первым решил'], 3), answer: headerIndex(h, ['Ответ'], 4) };
    const list = rows.slice(1).map((r) => ({ date: isoDate(r[i.date]), right: Number(r[i.right]) || 0, total: Number(r[i.total]) || 0, first: String(r[i.first] || '').trim(), answer: String(r[i.answer] || '').trim() })).filter((r) => r.date && r.date < iso).sort((a, b) => b.date.localeCompare(a.date));
    const r = list[0];
    if (!r) return null;
    const ago = Math.round((dateOf(iso) - dateOf(r.date)) / DAY);
    const when = ago === 1 ? 'вчера' : ago <= 3 ? 'в прошлый раз' : '';
    if (!when) return null; // старые итоги не показываем
    return { ...r, text: r.first ? `${when === 'вчера' ? 'Вчера' : 'В прошлый раз'} первым решил ${r.first}${r.answer ? ` · ответ: ${r.answer}` : ''}` : (r.answer ? `Ответ на задачу: ${r.answer}` : '') };
  }

  async function loadEvents({ force = false } = {}) {
    try { return await site.loadSheet(sheets.dayEvents || 'События_сайт', { optional: true, force, ttl: 5 * 60 * 1000 }); } catch (_) { return []; }
  }
  async function loadTask({ force = false } = {}) {
    const get = (name) => site.loadSheet(name, { optional: true, force, ttl: 10 * 60 * 1000 }).catch(() => []);
    const [tasks, results] = await Promise.all([get(sheets.dailyTask || 'Задача_дня'), get(sheets.dailyTaskResults || 'Задача_дня_итоги')]);
    return { tasks, results };
  }

  /* Меню на экране ------------------------------------------------------------------ */

  // Что показывать в карточке меню в этот момент. m: { date, minutes, schoolDay }.
  // breakfast — до конца 2-го урока; lunch — с 3-го урока до 14:00; next — после 14:00 и в
  // нерабочие дни (меню следующего учебного дня); rest — каникулы или до следующего учебного
  // дня больше четырёх дней («Приятного отдыха!»).
  function menuMode(m, { secondEnd = 570, holidays = [], nextSchoolDay } = {}) {
    const d = dateOf(m.date), t = d.getTime();
    const onHolidays = (holidays || []).some((h) => /каникул/i.test(String(h.title || '')) && t >= dateOf(typeof h.from === 'number' ? new Date(h.from) : h.from).getTime() && t <= dateOf(typeof h.to === 'number' ? new Date(h.to) : (h.to || h.from)).getTime());
    if (onHolidays) return { kind: 'rest' };
    if (m.schoolDay && m.minutes < 840) return { kind: m.minutes < secondEnd ? 'breakfast' : 'lunch', date: isoOf(d) };
    const next = nextSchoolDay ? dateOf(nextSchoolDay(d)) : null;
    if (!next) return { kind: 'rest' };
    const days = Math.round((next - d) / DAY);
    return days > 4 ? { kind: 'rest' } : { kind: 'next', date: isoOf(next), days };
  }

  const SIDE = ['salad', 'tea', 'cocoa', 'coffee', 'compote', 'fruit', 'sweet'];
  // Главное блюдо приёма пищи: первое, что не салат, не напиток, не фрукт и не сладкое.
  function mainDish(meal) {
    const items = meal?.items || [];
    return items.find((x) => !SIDE.includes(x.icon) && x.icon !== 'soup') || items.find((x) => !SIDE.includes(x.icon)) || items[0] || null;
  }

  // Шуточная подпись: по главному блюду, дню недели и общим фразам; одна и та же весь день,
  // и не та же, что в прошлый учебный день (prev: { date, icon }).
  function phraseFor(phrases, date, icon, prev) {
    if (!phrases) return '';
    const d = dateOf(date), dow = String(d.getUTCDay());
    const list = [...(phrases.byIcon?.[icon] || []), ...(phrases.byWeekday?.[dow] || []), ...(phrases.any || [])];
    if (!list.length) return '';
    const pick = Math.floor(d.getTime() / DAY) % list.length;
    let text = list[pick];
    if (prev?.date && text === phraseFor(phrases, prev.date, prev.icon)) text = list[(pick + 1) % list.length];
    return text;
  }

  let phrasesMemory = null;
  async function loadPhrases() {
    if (phrasesMemory) return phrasesMemory;
    try { const res = await fetchSoon('data/menu-phrases.json?v=1'); if (res.ok) phrasesMemory = await res.json(); } catch (_) {}
    return phrasesMemory;
  }

  /* Праздник дня ------------------------------------------------------------------ */

  // data/days.json: { "ММ-ДД": "строка" }. Пустой день — пустая строка, плашка не показывается.
  function dayNote(days, date) {
    const d = dateOf(date);
    const key = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return String(days?.[key] || '').trim();
  }

  let daysMemory = null;
  async function loadDays() {
    if (daysMemory) return daysMemory;
    try {
      const res = await fetchSoon('data/days.json?v=1');
      if (res.ok) daysMemory = (await res.json()).days || {};
    } catch (_) {}
    return daysMemory || {};
  }

  async function loadDuty({ force = false } = {}) {
    try { return await site.loadSheet(sheets.duty || 'Дежурство', { optional: true, force, ttl: 30 * 60 * 1000 }); } catch (_) { return []; }
  }
  async function loadTickerRows({ force = false } = {}) {
    try { return await site.loadSheet(sheets.notices || 'Оповещения', { optional: true, force, ttl: 5 * 60 * 1000 }); } catch (_) { return []; }
  }

  window.TodayCore = Object.freeze({ fetchSoon, weatherStatus, weatherText, parseWeather, weatherAdvice, loadWeather, holidayCountdown, dutyFor, punctualClass, tickerItems, eventsFor, taskFor, taskResultBefore, menuMode, mainDish, phraseFor, loadPhrases, dutyAdmins, changesSummary, dayNote, loadDays, loadDuty, loadTickerRows, loadEvents, loadTask, plural });
})();
