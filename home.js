(() => {
  'use strict';

  // Home page: the hero with class chips, the bell ring and the line of the day; «Мой день» of
  // the chosen class for today or the next school day; changes across the school; the class's
  // week and the bells. Notices and the publication time are filled in by site-shell.js.

  const site = window.SchoolSite;
  const core = window.ScheduleCore;
  const config = window.SCHOOL_CONFIG || {};
  if (!site || !core) return;

  const esc = site.escapeHtml;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STORE = 'school:selectedClass';
  const RECENT = 'school:recentClasses';
  const SHEET_SCHEDULE = config.googleSheets?.sheets?.schedule || 'Расписание';
  const SHEET_CHANGES = config.googleSheets?.sheets?.changes || 'Изменения';
  const TICKER_LIMIT = 8;
  const dayBox = $('[data-hd-day]');
  if (!dayBox) return;

  let scheduleRows = [], changesRows = [], classes = [], loaded = false, failed = false;
  const ui = { cls: '', day: null, picking: false };

  /* Remembered class and recently opened classes ------------------- */

  const stored = () => site.normalizeClass(site.storageGet(STORE));
  function recent() {
    try { return (JSON.parse(site.storageGet(RECENT) || '[]') || []).map(site.normalizeClass).filter((c) => classes.includes(c)); } catch (_) { return []; }
  }
  function remember(cls) { site.storageSet(RECENT, JSON.stringify([cls, ...recent().filter((c) => c !== cls)].slice(0, 6))); }
  function choose(cls) {
    ui.cls = cls; ui.day = null; ui.picking = false;
    remember(cls);
    if (!stored()) site.storageSet(STORE, cls);
    renderAll();
  }

  /* Dates ----------------------------------------------------------- */

  const today = () => site.getSchoolToday();
  const weekdayName = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long' }).format(d);
  function dayLabel(d) {
    const t = today();
    if (core.sameDay(d, t)) return 'Сегодня';
    if (core.sameDay(d, site.addUtcDays(t, 1))) return 'Завтра';
    return site.capitalize(weekdayName(d));
  }
  // «Мой день» offers today (when it is a school day) and the next school day.
  function dayChoices() {
    const w = site.schoolChangeWindow(today());
    return [w.first, w.second].map((date) => ({ date, label: dayLabel(date) }));
  }
  // The day whose changes matter now: today until its lessons end, then the next school day.
  function changesDay() {
    const w = site.schoolChangeWindow(today());
    return w.firstIsToday && core.bellMoment().type === 'after' ? w.second : w.first;
  }
  const inDay = (d) => (core.sameDay(d, today()) ? 'сегодня' : dayLabel(d) === 'Завтра' ? 'на завтра' : `на ${weekdayName(d).replace(/а$/, 'у')}`);

  /* Hero: class chips --------------------------------------------- */

  function pickerMarkup() {
    const groups = new Map();
    classes.forEach((c) => { const g = (String(c).match(/^\d+/) || ['—'])[0]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
    return `<div class="hd-picker">${[...groups].map(([g, list]) => `<div class="hd-picker__group" role="group" aria-label="${esc(g)}-е классы"><span class="hd-picker__label">${esc(g)}</span>${list.map((c) => `<button class="hd-chip" type="button" data-hd-class="${esc(c)}" aria-pressed="${String(c === ui.cls)}">${esc(c)}</button>`).join('')}</div>`).join('')}
      ${ui.cls ? '<div><button class="hd-chip hd-chip--more" type="button" data-hd-pick-cancel>Отмена</button></div>' : '<p class="hd-hint">Класс запомнится на этом устройстве — в следующий раз сайт сразу откроет его день.</p>'}</div>`;
  }

  function renderClasses() {
    const box = $('[data-hd-classes]');
    if (!box) return;
    if (!classes.length) { box.innerHTML = ''; return; }
    if (ui.picking || !ui.cls) { box.innerHTML = pickerMarkup(); return; }
    const mine = stored();
    const list = [...new Set([mine, ...recent(), ui.cls].filter(Boolean))].slice(0, 6);
    box.innerHTML = list.map((c) => `<button class="hd-chip" type="button" data-hd-class="${esc(c)}" aria-pressed="${String(c === ui.cls)}"${c === mine ? ' title="Мой класс"' : ''}>${c === mine ? '★ ' : ''}${esc(c)}</button>`).join('') +
      '<button class="hd-chip hd-chip--more" type="button" data-hd-pick>Все классы</button>';
  }

  /* Hero: bell ring and line of the day; bells card -------------------- */

  function renderClock() {
    const t = today(), school = site.isSchoolDay(t), holiday = site.holidayFor(t);
    const m = school ? core.bellMoment() : { type: 'off' }, now = core.nowMinutes();
    const dateEl = $('[data-hd-date]');
    if (dateEl) dateEl.textContent = core.fmtDay(t) + (school ? '' : holiday && ![0, 6].includes(t.getUTCDay()) ? ` · ${holiday.title}` : ' · выходной');

    let value = '—', unit = '', title = 'Звонки', sub = '', deg = 0, note = '';
    if (m.type === 'lesson') {
      const start = core.toMin(core.bellStart(m.lesson)), end = core.toMin(core.bellEnd(m.lesson));
      value = String(m.remaining); unit = 'мин'; title = `Идёт ${m.lesson}-й урок`; sub = `до звонка · в ${core.bellEnd(m.lesson)}`;
      deg = Math.round(360 * (now - start) / (end - start)); note = `звонок в ${core.bellEnd(m.lesson)}`;
    } else if (m.type === 'break') {
      const from = core.toMin(core.bellEnd(m.next - 1)), to = core.toMin(core.bellStart(m.next));
      value = String(m.remaining); unit = 'мин'; title = 'Перемена'; sub = `${m.next}-й урок в ${core.bellStart(m.next)}`;
      deg = Math.round(360 * (now - from) / Math.max(1, to - from)); note = `${m.next}-й урок в ${core.bellStart(m.next)}`;
    } else if (m.type === 'before') {
      const hours = m.remaining >= 100;
      value = String(hours ? Math.round(m.remaining / 60) : m.remaining); unit = hours ? 'ч' : 'мин'; title = 'До уроков'; sub = 'первый урок в 08:00'; note = 'первый урок в 08:00';
    } else {
      const next = site.nextSchoolDay(t), days = Math.round((next - t) / 86400000);
      value = m.type === 'after' ? '0' : String(days); unit = m.type === 'after' ? 'мин' : core.plural(days, 'день', 'дня', 'дней');
      title = m.type === 'after' ? 'Уроки закончились' : holiday && ![0, 6].includes(t.getUTCDay()) ? holiday.title : 'Выходной';
      sub = `${dayLabel(next).toLowerCase()} — снова в школу`; deg = m.type === 'after' ? 360 : 0;
      note = m.type === 'after' ? 'уроки на сегодня закончились' : 'сегодня уроков нет';
    }
    if (m.type === 'after') value = '—';
    const ring = $('[data-hd-ring]');
    if (ring) ring.style.setProperty('--p', `${Math.max(0, Math.min(360, deg))}deg`);
    const set = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
    set('[data-hd-ring-value]', value); set('[data-hd-ring-unit]', m.type === 'after' ? '' : unit);
    set('[data-hd-now-title]', title); set('[data-hd-now-sub]', sub); set('[data-hd-line-note]', note);

    const line = $('[data-hd-line]');
    if (line) line.innerHTML = core.BELLS.map((b, i) => {
      const n = i + 1, past = school && core.toMin(b[1]) <= now, isNow = m.type === 'lesson' && m.lesson === n;
      const fill = isNow ? Math.round(100 * (now - core.toMin(b[0])) / (core.toMin(b[1]) - core.toMin(b[0]))) : 0;
      return `<span class="hd-seg${past ? ' is-past' : ''}${isNow ? ' is-now' : ''}"><span class="hd-seg__bar"><span style="width:${fill}%"></span></span><span class="hd-seg__n">${n}</span></span>`;
    }).join('');

    const bells = $('[data-hd-bells]');
    if (bells) bells.innerHTML = core.BELLS.map((b, i) => {
      const n = i + 1, past = school && core.toMin(b[1]) <= now && !(m.type === 'lesson' && m.lesson === n), isNow = m.type === 'lesson' && m.lesson === n;
      return `<div class="hd-bell${isNow ? ' is-now' : past ? ' is-past' : ''}"><span>${n} урок</span><b>${b[0]}–${b[1]}</b></div>`;
    }).join('');
    const next = m.type === 'lesson' ? `Следующий звонок — ${core.bellEnd(m.lesson)}` : m.type === 'break' || m.type === 'before' ? `Следующий звонок — ${core.bellStart(m.next)}` : m.type === 'after' ? 'Уроки на сегодня закончились' : 'Сегодня уроков нет';
    set('[data-hd-bells-next]', next); set('[data-hd-bells-text]', next);
  }

  /* «Мой день» ----------------------------------------------------- */

  function lessonRow(x, isToday, moment, now) {
    const info = core.cellInfo(x);
    const current = moment?.type === 'lesson' && moment.current.lesson === x.lesson;
    const past = isToday && !current && core.toMin(core.bellEnd(x.lesson)) <= now;
    const classes = ['hd-lesson', x.type !== 'normal' ? 'is-changed' : '', x.type === 'cancelled' ? 'is-cancelled' : '', current ? 'is-now' : '', past && x.type === 'normal' ? 'is-past' : ''].filter(Boolean).join(' ');
    const badge = current ? 'Сейчас' : info.badge;
    return `<li class="${classes}"><b class="hd-lesson__n">${x.lesson}</b><span class="hd-lesson__main"><span class="hd-lesson__subj">${esc(info.subject)}</span><span class="hd-lesson__meta">${esc(core.bellStart(x.lesson))}${info.room ? ` · каб. ${esc(info.room)}` : ''}</span>${info.old ? `<span class="hd-lesson__was">${esc(info.old)}</span>` : ''}${info.note ? `<span class="hd-lesson__meta">${esc(info.note)}</span>` : ''}</span>${badge ? `<span class="hd-badge">${esc(badge)}</span>` : ''}</li>`;
  }

  function defaultDay(days, cls) {
    if (!core.sameDay(days[0].date, today())) return 0;
    const m = core.classMoment(core.actualDay(scheduleRows, changesRows, days[0].date, cls));
    return m.type === 'after' || m.type === 'none' ? 1 : 0;
  }

  function renderDay() {
    if (failed && !scheduleRows.length) {
      dayBox.innerHTML = '<div class="hd-head"><h2 class="hd-title">Мой день</h2></div><div class="hd-empty"><strong>Не удалось загрузить расписание.</strong><span>Проверьте подключение к интернету.</span><a class="hd-link" href="schedule.html">Открыть расписание →</a></div>';
      return;
    }
    if (!loaded) return;
    const cls = ui.cls;
    if (!cls) {
      dayBox.innerHTML = '<div class="hd-head"><h2 class="hd-title">Мой день</h2></div><div class="hd-empty"><strong>Выберите класс</strong><span>Нажмите на свой класс в синем блоке — здесь появятся уроки на сегодня и следующий учебный день.</span></div>';
      return;
    }
    const days = dayChoices();
    if (ui.day === null) ui.day = defaultDay(days, cls);
    const d = days[ui.day].date, lessons = core.actualDay(scheduleRows, changesRows, d, cls);
    const isToday = core.sameDay(d, today()), moment = isToday ? core.classMoment(lessons) : null, now = core.nowMinutes();
    const count = lessons.filter((x) => x.type !== 'cancelled').length, changes = lessons.filter((x) => x.type !== 'normal').length;
    const mine = stored() === cls;
    const summary = `${core.fmtDay(d)} · ${count} ${core.plural(count, 'урок', 'урока', 'уроков')}${changes ? ` · ${changes} ${core.plural(changes, 'изменение', 'изменения', 'изменений')}` : ' · без изменений'}`;
    dayBox.innerHTML = `<div class="hd-head"><h2 class="hd-title">Мой день · ${esc(cls)}</h2>
        <div class="hd-tabs" role="group" aria-label="День">${days.map((x, i) => `<button class="hd-tab" type="button" data-hd-day-tab="${i}" aria-pressed="${String(i === ui.day)}">${esc(x.label)}</button>`).join('')}</div></div>
      <div class="hd-day__meta"><span class="hd-sub">${esc(summary)}</span><button class="hd-pin" type="button" data-hd-pin aria-pressed="${String(mine)}">${mine ? '★ Мой класс — откроется сразу' : `☆ Запомнить ${esc(cls)} как мой класс`}</button></div>
      ${lessons.length ? `<ol class="hd-lessons">${lessons.map((x) => lessonRow(x, isToday, moment, now)).join('')}</ol>` : '<div class="hd-empty"><strong>Уроков нет</strong><span>В этот день у класса нет уроков.</span></div>'}
      <a class="hd-link" href="schedule.html?class=${encodeURIComponent(cls)}">Неделя ${esc(cls)} целиком →</a>`;
  }

  /* Hero: what is next for the chosen class ---------------------------- */

  const lessonPlace = (info) => `${info.subject}${info.room ? `, каб. ${info.room}` : ''}`;
  function renderHeroNext() {
    const el = $('[data-hd-hero-next]');
    if (!el) return;
    const cls = ui.cls, t = today();
    let text = '';
    if (!loaded || !cls || ui.picking) { el.hidden = true; return; }
    if (site.isSchoolDay(t)) {
      const m = core.classMoment(core.actualDay(scheduleRows, changesRows, t, cls));
      if (m.type === 'lesson') text = `Сейчас у ${cls}: ${lessonPlace(core.cellInfo(m.current))}${m.next ? ` · дальше ${core.cellInfo(m.next).subject} в ${core.bellStart(m.next.lesson)}` : ' · это последний урок'}`;
      else if (m.type === 'break' || m.type === 'before') text = `${m.type === 'before' ? 'Первый' : 'Следующий'} урок у ${cls} в ${core.bellStart(m.next.lesson)} — ${lessonPlace(core.cellInfo(m.next))}`;
    }
    if (!text) {
      const next = site.isSchoolDay(t) ? site.nextSchoolDay(t) : site.schoolChangeWindow(t).first;
      const first = core.actualDay(scheduleRows, changesRows, next, cls).find((x) => x.type !== 'cancelled');
      if (first) text = `${dayLabel(next)} у ${cls} первый урок в ${core.bellStart(first.lesson)} — ${lessonPlace(core.cellInfo(first))}`;
    }
    el.textContent = text;
    el.hidden = !text;
  }

  /* Changes across the school -------------------------------------- */

  function changeWhat(x) {
    if (/^отмен/i.test(x.change)) return 'отменён';
    const p = core.parseLesson(x.change);
    return `${p.subject || x.change}${p.room ? `, каб. ${p.room}` : ''}`;
  }
  const changeText = (x) => (/^отмен/i.test(x.change) ? `${x.lesson} урок отменён` : `${x.lesson} урок — ${changeWhat(x)}`);

  // The MAX tile shows the class's real nearest change, never an invented one.
  function renderBot() {
    const me = $$('[data-hd-chat-class]'), bubble = $('[data-hd-chat-bot]');
    if (!bubble) return;
    const cls = ui.cls;
    me.forEach((el) => { el.textContent = cls || 'Ваш класс'; });
    if (!cls || !loaded) { bubble.innerHTML = '<b>Изменения в расписании</b><br>Бот пришлёт их, как только школа опубликует замену.'; return; }
    const w = site.schoolChangeWindow(today());
    for (const d of [w.first, w.second]) {
      const rows = core.changeRowsFor(changesRows, d, cls);
      if (rows.length) {
        bubble.innerHTML = `<b>Изменения в расписании · ${esc(cls)}</b><br>${esc(core.fmtDay(d))}<br>${rows.slice(0, 3).map((x) => `<b>${x.lesson} урок</b> — ${esc(changeWhat(x))}`).join('<br>')}`;
        return;
      }
    }
    bubble.innerHTML = `<b>${esc(cls)}</b><br>Сейчас изменений нет. Как только школа опубликует замену, бот сразу напишет.`;
  }

  function renderChanges() {
    const box = $('[data-hd-ticker]');
    if (!box || !loaded) return;
    const d = changesDay(), rows = core.changeRowsFor(changesRows, d);
    const w = site.schoolChangeWindow(today()), other = core.sameDay(d, w.first) ? w.second : null;
    const otherRows = other ? core.changeRowsFor(changesRows, other) : [];
    const classesHit = new Set(rows.map((x) => x.className)).size;
    const label = `Изменения ${inDay(d)}`;
    box.innerHTML = `<span class="hd-ticker__label">${esc(label)}</span>` +
      (rows.length ? rows.slice(0, TICKER_LIMIT).map((x) => `<span class="hd-ticker__item"><b>${esc(x.className)}</b>${esc(changeText(x))}</span>`).join('') : '<span class="hd-ticker__item">Изменений нет — всё по расписанию</span>') +
      `<a class="hd-ticker__more" href="schedule.html#changes">${rows.length > TICKER_LIMIT ? `Ещё ${rows.length - TICKER_LIMIT} · ` : ''}Все изменения →</a>`;

    const big = $('[data-hd-changes-count]'), text = $('[data-hd-changes-text]'), note = $('[data-hd-changes-note]');
    if (big) { big.textContent = String(rows.length); big.hidden = false; }
    if (text) text.textContent = rows.length ? `${inDay(d)} в ${classesHit} ${core.plural(classesHit, 'классе', 'классах', 'классах')}` : `${site.capitalize(inDay(d))} изменений нет`;
    if (note) { note.hidden = !otherRows.length; note.textContent = otherRows.length ? `${inDay(other)}: ${otherRows.length}` : ''; }
  }

  /* Week of the class ---------------------------------------------- */

  function renderWeek() {
    const box = $('[data-hd-week-days]'), title = $('#hd-week-title');
    if (!box || !loaded) return;
    const cls = ui.cls;
    if (title) title.textContent = cls ? `Неделя ${cls}` : 'Неделя класса';
    if (!cls) { box.innerHTML = '<div class="hd-empty" style="grid-column:1/-1"><span>Выберите класс — здесь появится его неделя с отметками изменений.</span></div>'; return; }
    const first = site.schoolChangeWindow(today()).first, monday = site.addUtcDays(first, -((first.getUTCDay() + 6) % 7)), t = today();
    box.innerHTML = Array.from({ length: 5 }, (_, i) => {
      const d = site.addUtcDays(monday, i), holiday = site.holidayFor(d), lessons = holiday ? [] : core.actualDay(scheduleRows, changesRows, d, cls);
      const count = lessons.filter((x) => x.type !== 'cancelled').length, changes = lessons.filter((x) => x.type !== 'normal').length, isToday = core.sameDay(d, t);
      const tag = holiday ? holiday.title : changes ? `${changes} изм.` : isToday ? 'сегодня' : '';
      const aria = `${core.fmtDay(d)}: ${holiday ? holiday.title : `${count} ${core.plural(count, 'урок', 'урока', 'уроков')}`}${changes ? `, изменений: ${changes}` : ''}`;
      return `<a class="hd-wday${isToday ? ' is-today' : ''}${changes ? ' has-changes' : ''}${holiday ? ' is-holiday' : ''}" href="schedule.html?class=${encodeURIComponent(cls)}" aria-label="${esc(aria)}">
        <span class="hd-wday__dow">${esc(new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' }).format(d))}</span><span class="hd-wday__date">${d.getUTCDate()}</span>
        <span class="hd-wday__count">${holiday ? 'нет уроков' : `${count} ${core.plural(count, 'урок', 'урока', 'уроков')}`}</span>${tag ? `<span class="hd-wday__tag">${esc(tag)}</span>` : ''}<span class="hd-wday__dot" aria-hidden="true"></span></a>`;
    }).join('');
  }

  function renderAll() {
    renderClasses();
    renderDay();
    renderChanges();
    renderWeek();
    renderHeroNext();
    renderBot();
    const link = $('[data-hd-schedule-link]');
    if (link) link.href = ui.cls ? `schedule.html?class=${encodeURIComponent(ui.cls)}` : 'schedule.html';
  }

  /* Events and loading ---------------------------------------------- */

  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-hd-class]');
    if (pick) { choose(pick.dataset.hdClass); return; }
    if (e.target.closest('[data-hd-pick]')) { ui.picking = true; renderClasses(); renderHeroNext(); return; }
    if (e.target.closest('[data-hd-pick-cancel]')) { ui.picking = false; renderClasses(); renderHeroNext(); return; }
    const tab = e.target.closest('[data-hd-day-tab]');
    if (tab) { ui.day = Number(tab.dataset.hdDayTab) || 0; renderDay(); return; }
    if (e.target.closest('[data-hd-pin]')) {
      if (stored() === ui.cls) site.storageRemove(STORE); else site.storageSet(STORE, ui.cls);
      renderClasses(); renderDay();
    }
  });

  const maxLink = site.safeUrl(config.links?.maxBot);
  if (maxLink) $$('[data-max-link]').forEach((a) => { a.href = maxLink; });

  async function load() {
    classes = [...new Set((Array.isArray(config.classes) ? config.classes : []).map(site.normalizeClass).filter(Boolean))].sort(core.classCollator.compare);
    const [sr, cr] = await Promise.allSettled([site.loadSheet(SHEET_SCHEDULE), site.loadSheet(SHEET_CHANGES, { optional: true }), site.loadCalendar()]);
    failed = sr.status === 'rejected';
    if (!failed) { scheduleRows = sr.value; const derived = core.deriveClasses(scheduleRows); if (derived.length) classes = derived; }
    if (cr.status === 'fulfilled') changesRows = cr.value;
    loaded = !failed || !!scheduleRows.length;
    if (!ui.cls || !classes.includes(ui.cls)) ui.cls = [stored(), ...recent()].find((c) => c && classes.includes(c)) || '';
    renderClock();
    renderAll();
  }

  renderClock();
  load();
  setInterval(renderClock, 20000);
  setInterval(() => { if (loaded) { renderDay(); renderChanges(); renderHeroNext(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
})();
