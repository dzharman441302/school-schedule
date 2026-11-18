// Слайд «Сегодня» для ТВ-экранов (tv-students.html; на этапе 4 — и tv.html).
// Один модуль на оба экрана: create({ audience: 'students' | 'teachers' }).
//
// Раскладка (сцена 1920×1080 из tv-core.js, стили td-* в tv.css):
//  • шапка: часы и дата слева, урок/перемена с полосой по центру, праздник дня справа;
//  • средний ряд: меню (коралловый, ~60 %) и колонка карточек: погода, до каникул,
//    дежурство + пунктуальный класс, «Сегодня в школе»;
//  • полоса «Задача дня» с QR на task.html (ученики) или «Сегодня по расписанию» (учительская:
//    сколько изменений сегодня, сколько учителей затронуто, после 15:00 — что уже на завтра);
//  • бегущая строка из «Оповещений» с отметкой «На экран».
// Блока без данных нет на экране — соседние растягиваются; «нет данных» не пишется никогда.
(() => {
  'use strict';
  const site = window.SchoolSite, core = window.ScheduleCore, menu = window.MenuCore, today = window.TodayCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !core || !today) return;
  const esc = site.escapeHtml;
  const SLIDE_MS = (Number(config.today?.slideSeconds) || 20) * 1000;
  const SIDE_ORDER = ['weather', 'holidays', 'duty', 'events'];
  const ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
  const dateOf = (iso) => new Date(`${iso}T12:00:00Z`);
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const plural = today.plural;

  // Printed links must lead to the public site even when a screen is opened locally.
  function taskUrl() {
    const local = typeof location === 'undefined' || !/^https?:$/.test(location.protocol || '') || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname || '');
    return local ? 'https://sosh20tver.ru/task.html' : new URL('task.html', location.href).href;
  }

  function create({ audience = 'students' } = {}) {
    const data = { holidays: [], weather: null, duty: [], events: [], tasks: [], results: [], ticker: [], days: {}, phrases: null, menuReady: false, late: null };
    const lateCore = window.LatenessCore;

    async function load({ force = false } = {}) {
      // Every source on its own: a slow one gives its old value after 12 s, never blocks the others.
      const safe = (p, fallback) => new Promise((resolve) => {
        const timer = setTimeout(() => resolve(fallback), 12000);
        Promise.resolve(p).catch(() => fallback).then((v) => { clearTimeout(timer); resolve(v); });
      });
      const [holidays, weather, duty, events, task, ticker, days, phrases, menuState] = await Promise.all([
        safe(site.loadCalendar ? site.loadCalendar({ force }) : [], []),
        safe(today.loadWeather({ force: false }), null),
        safe(today.loadDuty({ force }), []),
        safe(today.loadEvents({ force }), []),
        safe(today.loadTask({ force }), { tasks: [], results: [] }),
        safe(today.loadTickerRows({ force }), []),
        safe(today.loadDays(), {}),
        safe(today.loadPhrases(), null),
        safe(menu ? menu.loadMenuCycle({ force: false }) : null, null),
      ]);
      if (audience === 'teachers' && lateCore) data.late = await loadLate().catch(() => data.late);
      Object.assign(data, { holidays: holidays || [], weather: weather || data.weather, duty: duty || [], events: events || [], tasks: task?.tasks || [], results: task?.results || [], ticker: ticker || [], days: days || {}, phrases, menuReady: Boolean(menuState?.cycle) });
    }

    // The staff TV has no lateness data of its own: the slide reads the marks for «самый пунктуальный».
    async function loadLate() {
      const get = (name) => site.loadSheet(name, { optional: true, ttl: 5 * 60 * 1000 }).catch(() => []);
      const [marks, shifts, schedule, changes] = await Promise.all([get(lateCore.SHEETS.marks), get(lateCore.SHEETS.shifts), get(config.googleSheets?.sheets?.schedule || 'Расписание'), get('Изменения')]);
      return { marks, shifts, schedule, changes };
    }
    function ratingFor(m) {
      const l = data.late;
      if (!lateCore || !l?.marks?.length) return null;
      try {
        const classes = (config.classes || []).map(site.normalizeClass);
        const closeAfter = {};
        [1, 2].forEach((shift) => { const n = lateCore.firstLesson(l.schedule, l.changes, m.date, classes, shift); const end = n && core.bellEnd(n, m.date); if (end) closeAfter[shift] = core.toMin(end); });
        return lateCore.board(lateCore.parse(l.marks, l.shifts), classes, { today: m.date, minutes: m.minutes, closeAfter });
      } catch (_) { return null; }
    }

    /* Icons: one line set (24×24, stroke), instead of emoji that look different on every TV ------ */

    const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
    const CLOUD = '<path d="M17.5 18H7a4.5 4.5 0 1 1 .9-8.9A5.5 5.5 0 0 1 18 10.5a3.75 3.75 0 0 1-.5 7.5Z"/>';
    const ICON = {
      bowl: svg('<path d="M3 12h18a9 9 0 0 1-18 0Z"/><path d="M8 8c0-1.2 1-1.6 1-2.8M12 8c0-1.2 1-1.6 1-2.8M16 8c0-1.2 1-1.6 1-2.8"/>'),
      porridge: svg('<path d="M3 12h18a9 9 0 0 1-18 0Z"/><path d="M14 12l4-8"/>'),
      utensils: svg('<path d="M6 3v6a2 2 0 0 0 2 2v10M10 3v6a2 2 0 0 1-2 2M8 3v5"/><path d="M17 21V3c-2.2 1.5-3 4-3 7v3h3"/>'),
      leaf: svg('<path d="M5 19C5 10.5 10.5 5 19 5c0 8.5-5.5 14-14 14Z"/><path d="M5 19l8.5-8.5"/>'),
      cup: svg('<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2M12 3.5v2"/>'),
      glass: svg('<path d="M6 4h12l-1.6 15.2A2 2 0 0 1 14.4 21H9.6a2 2 0 0 1-2-1.8Z"/><path d="M6.6 10h10.8"/>'),
      apple: svg('<path d="M12 8c-1.6-1.6-5.5-2-7 1-1.6 3.2.6 12 3.8 12 1.3 0 1.9-.6 3.2-.6s1.9.6 3.2.6c3.2 0 5.4-8.8 3.8-12-1.5-3-5.4-2.6-7-1Z"/><path d="M12 8c0-2.2 1.1-3.8 3.2-4.5"/>'),
      cookie: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M14 8.5h.01M15 14h.01M9.5 15h.01M12 12h.01" stroke-width="3"/>'),
      pancakes: svg('<ellipse cx="12" cy="7" rx="8.5" ry="2.8"/><path d="M3.5 7v3.2c0 1.6 3.8 2.8 8.5 2.8s8.5-1.2 8.5-2.8V7M3.5 10.2v3.2c0 1.6 3.8 2.8 8.5 2.8s8.5-1.2 8.5-2.8v-3.2M3.5 13.4v3.2c0 1.6 3.8 2.8 8.5 2.8s8.5-1.2 8.5-2.8v-3.2"/>'),
      egg: svg('<path d="M12 3C8.5 3 5.5 9 5.5 13.5a6.5 6.5 0 0 0 13 0C18.5 9 15.5 3 12 3Z"/>'),
      cake: svg('<path d="M3.5 20h17v-8l-8.5-6.5L3.5 12Z"/><path d="M3.5 15.5h17"/>'),
      sun: svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
      cloudSun: svg('<path d="M9.5 3.5v1.5M4.4 5.4l1 1M3 10.5h1.5M14.6 5.4l-1 1"/><path d="M6.6 11.7A4 4 0 0 1 13.4 8"/>' + '<path d="M18.5 20H9a3.8 3.8 0 1 1 .8-7.5A4.8 4.8 0 0 1 19 13.7a3.2 3.2 0 0 1-.5 6.3Z"/>'),
      cloud: svg(CLOUD),
      rain: svg('<path d="M17.5 15H7a4.5 4.5 0 1 1 .9-8.9A5.5 5.5 0 0 1 18 7.5a3.75 3.75 0 0 1-.5 7.5Z"/><path d="M8 18l-1 3M12.5 18l-1 3M17 18l-1 3"/>'),
      snow: svg('<path d="M17.5 15H7a4.5 4.5 0 1 1 .9-8.9A5.5 5.5 0 0 1 18 7.5a3.75 3.75 0 0 1-.5 7.5Z"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 22.5h.01M14 22.5h.01" stroke-width="3"/>'),
      fog: svg('<path d="M4 9h16M3 13h18M5 17h14"/>'),
      storm: svg('<path d="M17.5 14H7a4.5 4.5 0 1 1 .9-8.9A5.5 5.5 0 0 1 18 6.5a3.75 3.75 0 0 1-.5 7.5Z"/><path d="M12.5 15l-2.5 4h4l-2.5 4"/>'),
      calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
      flag: svg('<path d="M5 21V4"/><path d="M5 4.5h11.5l-2.2 4 2.2 4H5"/>'),
      clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
      star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z"/>', ' class="td-star__icon"'),
      puzzle: svg('<path d="M10 3.5a2 2 0 0 1 4 0V5h4v4h1.5a2 2 0 0 1 0 4H18v6h-6v-1.5a2 2 0 0 0-4 0V19H4v-4h1.5a2 2 0 0 0 0-4H4V5h6Z"/>'),
      chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
      megaphone: svg('<path d="M3.5 10v4a1 1 0 0 0 1 1H7l8 4.5V4.5L7 9H4.5a1 1 0 0 0-1 1Z"/><path d="M18.5 8.5a5 5 0 0 1 0 7"/>'),
      party: svg('<path d="M4 20l4.5-12 7.5 7.5Z"/><path d="M14 4.5c.5 1.5 0 2.5-1 3.5M19.5 10c-1.5-.5-2.5 0-3.5 1"/><path d="M17 3.5h.01M20.5 6.5h.01M19 15h.01" stroke-width="3"/>'),
    };
    const DISH_ICON = { soup: 'bowl', porridge: 'porridge', grain: 'utensils', meat: 'utensils', sausage: 'utensils', fish: 'utensils', pasta: 'utensils', potato: 'utensils', salad: 'leaf', compote: 'glass', tea: 'cup', cocoa: 'cup', coffee: 'cup', pancake: 'pancakes', casserole: 'cake', egg: 'egg', fruit: 'apple', sweet: 'cookie' };
    const weatherIcon = (code) => {
      const c = Number(code);
      if ([95, 96, 99].includes(c)) return 'storm';
      if ([71, 73, 75, 77, 85, 86].includes(c)) return 'snow';
      if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return 'rain';
      if ([45, 48].includes(c)) return 'fog';
      if (c === 0 || c === 1) return 'sun';
      if (c === 2) return 'cloudSun';
      return 'cloud';
    };
    const head = (icon, label) => `<header class="td-head"><span class="td-head__icon">${ICON[icon]}</span><h3 class="td-label">${label}</h3></header>`;
    const signed = (t) => `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}°`;

    /* Blocks --------------------------------------------------------------------- */

    const names = (meal) => (meal?.items || []).map((x) => x.name).join(', ');
    const dish = (x) => `<li class="td-dish"><span class="td-dish__icon">${ICON[DISH_ICON[x.icon] || 'utensils']}</span><b data-fit="28">${esc(x.name)}</b></li>`;

    function menuBlock(m) {
      if (!menu || !data.menuReady) return '';
      const mode = today.menuMode(m, { secondEnd: core.toMin(core.bellEnd(2, m.date) || '09:30'), holidays: data.holidays, nextSchoolDay: site.nextSchoolDay });
      if (mode.kind === 'rest') return `<section class="td-card td-menu td-menu--rest" style="--i:0"><span class="td-menu__big">${ICON.party}</span><h2 class="td-title">Приятного отдыха!</h2><p class="td-phrase">Каникулы — время набраться сил</p></section>`;
      const day = menu.menuFor(mode.date);
      if (!day) return '';
      const [breakfast, lunch] = [day.meals.find((x) => /завтрак/i.test(x.name)) || day.meals[0], day.meals.find((x) => /обед/i.test(x.name)) || day.meals[1]];
      const featured = mode.kind === 'lunch' ? lunch : breakfast;
      const prevDay = (() => { let d = new Date(dateOf(mode.date).getTime() - 86400000); for (let i = 0; i < 10 && !site.isSchoolDay(d); i += 1) d = new Date(d.getTime() - 86400000); return menu.menuFor(d); })();
      const prevFeatured = prevDay ? (mode.kind === 'lunch' ? prevDay.meals[1] : prevDay.meals[0]) : null;
      const phrase = today.phraseFor(data.phrases, mode.date, today.mainDish(featured)?.icon, prevDay ? { date: prevDay.date, icon: today.mainDish(prevFeatured)?.icon } : null);
      const sub = phrase ? `<p class="td-phrase" data-fit="22">${esc(phrase)}</p>` : '';
      if (mode.kind === 'next') {
        const title = mode.days === 1 ? 'Завтра в меню' : `В ${ACC[dateOf(mode.date).getUTCDay()]} в меню`;
        const col = (meal) => (meal ? `<div class="td-menu__col"><h3 class="td-menu__meal">${esc(meal.name)}</h3><ul class="td-dishes td-dishes--one">${meal.items.map(dish).join('')}</ul></div>` : '');
        return `<section class="td-card td-menu td-menu--next" style="--i:0">${head('utensils', 'Меню столовой')}<h2 class="td-title">${esc(title)}</h2>${sub}<div class="td-menu__cols">${col(breakfast)}${col(lunch)}</div></section>`;
      }
      const title = mode.kind === 'lunch' ? 'Сегодня на обед' : 'Сегодня на завтрак';
      const other = mode.kind === 'lunch' ? (breakfast ? `На завтрак было: ${names(breakfast)}` : '') : (lunch ? `А на обед: ${names(lunch)}` : '');
      return `<section class="td-card td-menu" style="--i:0">${head('utensils', 'Меню столовой')}<h2 class="td-title">${title}</h2>${sub}<ul class="td-dishes td-dishes--list">${featured.items.map(dish).join('')}</ul>${other ? `<p class="td-menu__more" data-fit="20">${esc(other)}</p>` : ''}</section>`;
    }

    function weatherBlock() {
      const w = data.weather;
      if (!w) return '';
      const later = w.at14 ? ` · в 14:00 ${signed(w.at14.temp)}` : '';
      const advice = today.weatherAdvice(w);
      return `<section class="td-card td-weather" data-block="weather">${head('sun', 'Погода')}<div class="td-weather__now"><b class="td-num">${signed(w.temp)}</b><span class="td-weather__icon">${ICON[weatherIcon(w.code)]}</span></div><p class="td-text" data-fit="20">${esc(w.text)}${later}</p>${advice ? `<p class="td-chip td-chip--ink" data-fit="18">${esc(advice)}</p>` : ''}</section>`;
    }

    function holidaysBlock(m) {
      const c = today.holidayCountdown(data.holidays, m.date);
      if (!c) return '';
      if (c.kind === 'tomorrow') return `<section class="td-card td-holidays" data-block="holidays">${head('calendar', esc(c.title))}<b class="td-big" data-fit="34">${esc(c.text)}</b></section>`;
      return `<section class="td-card td-holidays" data-block="holidays">${head('calendar', 'До каникул')}<b class="td-num">${c.days}</b><p class="td-text" data-fit="20">${esc(c.caption)}</p></section>`;
    }

    function dutyBlock(m, extra) {
      const duty = today.dutyFor(data.duty, m.date);
      const punctual = today.punctualClass(extra?.rating ?? (audience === 'teachers' ? ratingFor(m) : null));
      const admins = audience === 'teachers' ? today.dutyAdmins(config.lateness?.duty, m.date) : [];
      if (!duty && !punctual && !admins.length) return '';
      const rows = [1, 2].map((shift) => {
        const classes = duty?.shifts.find((x) => x.shift === shift)?.classes || [];
        const admin = admins.find((x) => x.shift === shift)?.name || '';
        if (!classes.length && !admin) return '';
        return `<div class="td-duty__shift"><p class="td-duty__row"><span>${shift} смена</span><b data-fit="24">${esc(classes.join(', ') || '—')}</b></p>${admin ? `<p class="td-duty__admin" data-fit="16">администратор: ${esc(admin)}</p>` : ''}</div>`;
      }).join('');
      const days = punctual ? `${punctual.days} ${plural(punctual.days, 'день', 'дня', 'дней')}` : '';
      // Учительская: две строки администраторов — пунктуальный класс уходит значком в шапку карточки.
      const badge = punctual && admins.length ? `<p class="td-star td-star--badge" title="Самый пунктуальный класс: дней подряд без опозданий">${ICON.star}<span><b>${esc(punctual.cls)}</b> · ${days}</span></p>` : '';
      const star = punctual && !admins.length ? `<p class="td-star" data-fit="18">${ICON.star}<span>Самый пунктуальный — <b>${esc(punctual.cls)}</b>, ${days} без опозданий</span></p>` : '';
      return `<section class="td-card td-duty" data-block="duty">${head('flag', duty || admins.length ? 'Дежурят' : 'Пунктуальность').replace('</header>', `${badge}</header>`)}<div class="td-duty__shifts">${rows}</div>${star}</section>`;
    }

    function eventsBlock(m) {
      const list = today.eventsFor(data.events, m.date, m.minutes, audience, 3);
      if (!list.length) return '';
      return `<section class="td-card td-events" data-block="events">${head('clock', 'Сегодня в школе')}<ul>${list.map((e) => `<li><span class="td-events__time">${esc(e.time || 'весь день')}</span><b data-fit="20">${esc(e.what)}${e.where ? ` <small>· ${esc(e.where)}</small>` : ''}</b></li>`).join('')}</ul></section>`;
    }

    function taskBlock(m) {
      if (audience !== 'students' || !window.QrCode) return '';
      const task = today.taskFor(data.tasks, m.date);
      const past = today.taskResultBefore(data.results, m.date);
      if (!task) return '';
      const url = taskUrl();
      return `<section class="td-card td-task" style="--i:6"><div class="td-task__qr">${window.QrCode.svg(url, { label: 'QR-код: ответить на задачу дня' })}</div><div class="td-task__body">${head('puzzle', 'Задача дня · ответ — по QR-коду')}<p class="td-task__text" data-fit="24">${esc(task.task)}</p></div>${past?.text ? `<p class="td-chip td-chip--sun td-task__past" data-fit="18">${esc(past.text)}</p>` : ''}</section>`;
    }

    // Учительская: «Сегодня по расписанию» из той же опубликованной сетки, что на ТВ.
    function scheduleBlock(m, extra) {
      if (audience !== 'teachers') return '';
      const rows = extra?.changeRows || [];
      const now = today.changesSummary(rows, m.date);
      const word = (n) => plural(n, 'изменение', 'изменения', 'изменений');
      const parts = [];
      if (now.cancelled) parts.push(`отмен ${now.cancelled}`);
      if (now.changed) parts.push(`замен ${now.changed}`);
      if (now.room) parts.push(`смен кабинета ${now.room}`);
      const main = now.total
        ? `<b class="td-sched__num">${now.total}</b><div class="td-sched__text"><strong data-fit="24">${word(now.total)} сегодня</strong><span data-fit="18">${esc(parts.join(' · '))} · затронуто учителей: ${now.teachers}</span></div>`
        : `<div class="td-sched__text"><strong data-fit="24">Сегодня изменений нет</strong><span>работаем по основному расписанию</span></div>`;
      let tomorrow = '';
      if (m.minutes >= 900 || !m.schoolDay) {
        const next = today.changesSummary(rows, site.nextSchoolDay(m.date));
        tomorrow = `<p class="td-chip td-chip--sun td-sched__next" data-fit="18">${next.published ? (next.total ? `На ${m.schoolDay ? 'завтра' : 'следующий учебный день'} уже опубликовано: ${next.total} ${word(next.total)}` : `На ${m.schoolDay ? 'завтра' : 'следующий учебный день'} опубликовано: изменений нет`) : `На ${m.schoolDay ? 'завтра' : 'следующий учебный день'} изменения ещё не опубликованы`}</p>`;
      }
      return `<section class="td-card td-sched" style="--i:6"><div class="td-sched__body">${head('chart', 'Сегодня по расписанию')}<div class="td-sched__row">${main}</div></div>${tomorrow}</section>`;
    }

    function tickerBlock(m) {
      const items = today.tickerItems(data.ticker, m.date, audience);
      if (!items.length) return '';
      const text = items.map(esc).join('<span class="td-ticker__dot" aria-hidden="true">•</span>');
      return `<div class="td-ticker" role="marquee" aria-label="Объявления"><span class="td-ticker__tag">${ICON.megaphone}<b>Объявления</b></span><div class="td-ticker__window"><div class="td-ticker__track">${text}</div></div></div>`;
    }

    /* Slide ---------------------------------------------------------------------------- */

    // The header tile on the right: the day note or simply the weekday.
    function headTile(m) {
      const note = today.dayNote(data.days, m.date);
      return note ? { kicker: 'Праздник дня', title: note, tone: 'note' } : { kicker: 'Сегодня', title: site.capitalize(site.formatSchoolDate(m.date, { weekday: true, year: false }).split(',')[0]), tone: 'day' };
    }

    function render(m, s, extra = {}) {
      const side = [weatherBlock(), holidaysBlock(m), dutyBlock(m, extra), eventsBlock(m)].filter(Boolean);
      const menuHtml = menuBlock(m);
      const sideHtml = side.map((html, i) => html.replace('<section class="td-card', `<section style="--i:${i + 1}" class="td-card${side.length % 2 && i === side.length - 1 ? ' td-wide' : ''}`)).join('');
      const middle = menuHtml || sideHtml ? `<div class="td-middle${menuHtml ? '' : ' td-middle--nomenu'}${sideHtml ? '' : ' td-middle--noside'}">${menuHtml}${sideHtml ? `<div class="td-side td-side--${side.length}">${sideHtml}</div>` : ''}</div>` : '';
      return { head: headTile(m), html: `<section class="td" data-slide="today" data-audience="${audience}">${middle}${taskBlock(m)}${scheduleBlock(m, extra)}${tickerBlock(m)}</section>` };
    }

    // Anything at all to show (a screen without data shows its usual board instead).
    function available(m) {
      return audience === 'teachers' || Boolean((menu && data.menuReady) || data.weather || today.holidayCountdown(data.holidays, m.date) || today.dutyFor(data.duty, m.date) || today.eventsFor(data.events, m.date, m.minutes, audience).length || today.taskFor(data.tasks, m.date));
    }

    // After the markup is on the screen: a long ticker scrolls (unless motion is reduced).
    function afterRender(root) {
      const ticker = root?.querySelector?.('.td-ticker'), box = ticker?.querySelector?.('.td-ticker__window'), track = box?.querySelector?.('.td-ticker__track');
      if (!track || !box.clientWidth) return;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const over = track.scrollWidth > box.clientWidth;
      ticker.classList.toggle('is-scroll', over && !reduce);
      if (!over || reduce) return;
      // Two copies one after another: the text is on screen from the first second and loops without a gap.
      const width = track.scrollWidth;
      track.innerHTML += `<span class="td-ticker__dot" aria-hidden="true">•</span><span aria-hidden="true">${track.innerHTML}</span>`;
      track.style.setProperty('--td-ticker-s', `${Math.max(12, Math.round(width / 110))}s`);
    }

    return { load, render, available, afterRender, period: SLIDE_MS, data };
  }

  window.TvToday = Object.freeze({ create, SLIDE_MS, taskUrl });
})();
