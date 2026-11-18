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

    /* Blocks --------------------------------------------------------------------- */

    const names = (meal) => (meal?.items || []).map((x) => x.name).join(', ');
    const dish = (x) => `<li class="td-dish"><span class="td-dish__icon" aria-hidden="true">${esc(x.emoji || '🍽️')}</span><b data-fit="30">${esc(x.name)}</b></li>`;

    function menuBlock(m) {
      if (!menu || !data.menuReady) return '';
      const mode = today.menuMode(m, { secondEnd: core.toMin(core.bellEnd(2, m.date) || '09:30'), holidays: data.holidays, nextSchoolDay: site.nextSchoolDay });
      if (mode.kind === 'rest') return `<section class="td-card td-menu td-menu--rest" style="--i:0"><span class="td-menu__big" aria-hidden="true">🎉</span><h2 class="td-title">Приятного отдыха!</h2><p class="td-menu__more">Каникулы — время набраться сил</p></section>`;
      const day = menu.menuFor(mode.date);
      if (!day) return '';
      const [breakfast, lunch] = [day.meals.find((x) => /завтрак/i.test(x.name)) || day.meals[0], day.meals.find((x) => /обед/i.test(x.name)) || day.meals[1]];
      const featured = mode.kind === 'lunch' ? lunch : breakfast;
      const prevDay = (() => { let d = new Date(dateOf(mode.date).getTime() - 86400000); for (let i = 0; i < 10 && !site.isSchoolDay(d); i += 1) d = new Date(d.getTime() - 86400000); return menu.menuFor(d); })();
      const prevFeatured = prevDay ? (mode.kind === 'lunch' ? prevDay.meals[1] : prevDay.meals[0]) : null;
      const phrase = today.phraseFor(data.phrases, mode.date, today.mainDish(featured)?.icon, prevDay ? { date: prevDay.date, icon: today.mainDish(prevFeatured)?.icon } : null);
      const kicker = phrase ? `<p class="td-phrase" data-fit="24">${esc(phrase)}</p>` : '';
      if (mode.kind === 'next') {
        const title = mode.days === 1 ? 'Завтра в меню' : `В ${ACC[dateOf(mode.date).getUTCDay()]} в меню`;
        const col = (meal) => (meal ? `<div class="td-menu__col"><h3>${esc(meal.name)}</h3><ul class="td-dishes td-dishes--one">${meal.items.map(dish).join('')}</ul></div>` : '');
        return `<section class="td-card td-menu td-menu--next" style="--i:0">${kicker}<h2 class="td-title">${esc(title)}</h2><div class="td-menu__cols">${col(breakfast)}${col(lunch)}</div></section>`;
      }
      const title = mode.kind === 'lunch' ? 'Сегодня на обед' : 'Сегодня на завтрак';
      const other = mode.kind === 'lunch' ? (breakfast ? `На завтрак было: ${names(breakfast)}` : '') : (lunch ? `А на обед: ${names(lunch)}` : '');
      return `<section class="td-card td-menu" style="--i:0">${kicker}<h2 class="td-title">${title}</h2><ul class="td-dishes td-dishes--list">${featured.items.map(dish).join('')}</ul>${other ? `<p class="td-menu__more" data-fit="20">${esc(other)}</p>` : ''}</section>`;
    }

    function weatherBlock() {
      const w = data.weather;
      if (!w) return '';
      const later = w.at14 ? `<span class="td-weather__later">в 14:00 ${w.at14.temp > 0 ? '+' : ''}${w.at14.temp}° ${esc(w.at14.icon)}</span>` : '';
      const advice = today.weatherAdvice(w);
      return `<section class="td-card td-weather" data-block="weather"><h3 class="td-label">Погода</h3><div class="td-weather__now"><span class="td-weather__icon" aria-hidden="true">${esc(w.icon)}</span><b class="td-num">${w.temp > 0 ? '+' : ''}${w.temp}°</b></div><p class="td-weather__text" data-fit="20">${esc(w.text)}${later ? ' · ' : ''}${later}</p>${advice ? `<p class="td-advice" data-fit="20">${esc(advice)}</p>` : ''}</section>`;
    }

    function holidaysBlock(m) {
      const c = today.holidayCountdown(data.holidays, m.date);
      if (!c) return '';
      if (c.kind === 'tomorrow') return `<section class="td-card td-holidays" data-block="holidays"><h3 class="td-label">${esc(c.title)}</h3><b class="td-big" data-fit="36">${esc(c.text)}</b></section>`;
      return `<section class="td-card td-holidays" data-block="holidays"><h3 class="td-label">До каникул</h3><b class="td-num">${c.days}</b><p class="td-caption" data-fit="20">${esc(c.caption)}</p></section>`;
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
        return `<p class="td-duty__row"><span>${shift} смена</span><b data-fit="24">${esc(classes.join(', ') || '—')}</b></p>${admin ? `<p class="td-duty__admin" data-fit="16">администратор: ${esc(admin)}</p>` : ''}`;
      }).join('');
      const shifts = rows;
      const star = punctual ? `<p class="td-star" data-fit="20"><span aria-hidden="true">⭐</span> Самый пунктуальный: <b>${esc(punctual.cls)}</b> · ${punctual.days} ${plural(punctual.days, 'день', 'дня', 'дней')} без опозданий</p>` : '';
      return `<section class="td-card td-duty" data-block="duty">${duty || admins.length ? '<h3 class="td-label">Дежурят</h3>' : ''}${shifts}${star}</section>`;
    }

    function eventsBlock(m) {
      const list = today.eventsFor(data.events, m.date, m.minutes, audience, 3);
      if (!list.length) return '';
      return `<section class="td-card td-events" data-block="events"><h3 class="td-label">Сегодня в школе</h3><ul>${list.map((e) => `<li><span class="td-events__time">${esc(e.time || 'весь день')}</span><b data-fit="20">${esc(e.what)}${e.where ? ` <small>· ${esc(e.where)}</small>` : ''}</b></li>`).join('')}</ul></section>`;
    }

    function taskBlock(m) {
      if (audience !== 'students' || !window.QrCode) return '';
      const task = today.taskFor(data.tasks, m.date);
      const past = today.taskResultBefore(data.results, m.date);
      if (!task) return '';
      const url = taskUrl();
      return `<section class="td-card td-task" style="--i:6"><div class="td-task__qr">${window.QrCode.svg(url, { label: 'QR-код: ответить на задачу дня' })}</div><div class="td-task__body"><h3 class="td-label">Задача дня · ответ — по QR-коду</h3><p class="td-task__text" data-fit="26">${esc(task.task)}</p>${past?.text ? `<p class="td-task__past" data-fit="18">${esc(past.text)}</p>` : ''}</div></section>`;
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
        tomorrow = `<p class="td-sched__next" data-fit="18">${next.published ? (next.total ? `На ${m.schoolDay ? 'завтра' : 'следующий учебный день'} уже опубликовано: ${next.total} ${word(next.total)}` : `На ${m.schoolDay ? 'завтра' : 'следующий учебный день'} опубликовано: изменений нет`) : `На ${m.schoolDay ? 'завтра' : 'следующий учебный день'} изменения ещё не опубликованы`}</p>`;
      }
      return `<section class="td-card td-sched" style="--i:6"><h3 class="td-label">Сегодня по расписанию</h3><div class="td-sched__row">${main}${tomorrow}</div></section>`;
    }

    function tickerBlock(m) {
      const items = today.tickerItems(data.ticker, m.date, audience);
      if (!items.length) return '';
      const text = items.map(esc).join('<span class="td-ticker__dot" aria-hidden="true">•</span>');
      return `<div class="td-ticker" role="marquee" aria-label="Объявления"><div class="td-ticker__track">${text}</div></div>`;
    }

    /* Slide ---------------------------------------------------------------------------- */

    // The header tile on the right: the day note (pink) or simply the weekday.
    function head(m) {
      const note = today.dayNote(data.days, m.date);
      return note ? { kicker: 'Праздник дня', title: note, tone: 'note' } : { kicker: 'Сегодня', title: site.capitalize(site.formatSchoolDate(m.date, { weekday: true, year: false }).split(',')[0]), tone: 'day' };
    }

    function render(m, s, extra = {}) {
      const side = [weatherBlock(), holidaysBlock(m), dutyBlock(m, extra), eventsBlock(m)].filter(Boolean);
      const menuHtml = menuBlock(m);
      const sideHtml = side.map((html, i) => html.replace('<section class="td-card', `<section style="--i:${i + 1}" class="td-card${side.length % 2 && i === side.length - 1 ? ' td-wide' : ''}`)).join('');
      const middle = menuHtml || sideHtml ? `<div class="td-middle${menuHtml ? '' : ' td-middle--nomenu'}${sideHtml ? '' : ' td-middle--noside'}">${menuHtml}${sideHtml ? `<div class="td-side td-side--${side.length}">${sideHtml}</div>` : ''}</div>` : '';
      return { head: head(m), html: `<section class="td" data-slide="today" data-audience="${audience}">${middle}${taskBlock(m)}${scheduleBlock(m, extra)}${tickerBlock(m)}</section>` };
    }

    // Anything at all to show (a screen without data shows its usual board instead).
    function available(m) {
      return audience === 'teachers' || Boolean((menu && data.menuReady) || data.weather || today.holidayCountdown(data.holidays, m.date) || today.dutyFor(data.duty, m.date) || today.eventsFor(data.events, m.date, m.minutes, audience).length || today.taskFor(data.tasks, m.date));
    }

    // After the markup is on the screen: a long ticker scrolls (unless motion is reduced).
    function afterRender(root) {
      const box = root?.querySelector?.('.td-ticker'), track = box?.querySelector?.('.td-ticker__track');
      if (!track || !box.clientWidth) return;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const over = track.scrollWidth > box.clientWidth;
      box.classList.toggle('is-scroll', over && !reduce);
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
