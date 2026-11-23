(() => {
  'use strict';

  // Shared timetable logic for the schedule page and the home page:
  // sheet parsing, the actual day with published changes applied, and
  // where the school day stands right now.

  const site = window.SchoolSite;
  if (!site) return;

  const BELLS = [['08:00', '08:40'], ['08:50', '09:30'], ['09:45', '10:25'], ['10:45', '11:25'], ['11:40', '12:20'], ['12:30', '13:10'], ['13:20', '14:00'], ['14:15', '14:55'], ['15:10', '15:50'], ['16:05', '16:45'], ['17:00', '17:40'], ['17:50', '18:30']];
  const DAY_ORDER = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const DAY_NAMES = { ПН: 'Понедельник', ВТ: 'Вторник', СР: 'Среда', ЧТ: 'Четверг', ПТ: 'Пятница', СБ: 'Суббота', ВС: 'Воскресенье' };
  const DAY_ALIASES = { пн: 'ПН', понедельник: 'ПН', вт: 'ВТ', вторник: 'ВТ', ср: 'СР', среда: 'СР', чт: 'ЧТ', четверг: 'ЧТ', пт: 'ПТ', пятница: 'ПТ', сб: 'СБ', суббота: 'СБ', вс: 'ВС', воскресенье: 'ВС' };
  const DEFAULT_SCHEDULE_HEADERS = ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
  const DEFAULT_CHANGES_HEADERS = ['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание'];
  const classCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

  // Bells come from the sheets «Звонки» (Урок | Основное | Сокращённое, «08:00–08:40») and
  // «Звонки_даты» (Дата | Вариант), filled in the admin panel. BELLS above is the usual
  // timetable used until they load or when they are missing. Every bell function takes an
  // optional date; without it the school's today is meant.
  const BELL_BASE = 'Основное';
  let bellVariants = { [BELL_BASE]: BELLS }, bellDates = new Map();
  const bellVariant = (date = site.getSchoolToday()) => bellDates.get(site.dateKey(date)) || BELL_BASE;
  const bells = (date) => bellVariants[bellVariant(date)] || BELLS;
  const bellStart = (n, date) => (bells(date)[n - 1] || [''])[0];
  const bellEnd = (n, date) => (bells(date)[n - 1] || ['', ''])[1];
  const bellRange = (n, date) => { const b = bells(date)[n - 1]; return b ? `${b[0]}–${b[1]}` : ''; };

  function parseBellRange(value) {
    const m = String(value ?? '').trim().match(/^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/);
    if (!m) return null;
    const hm = (h, mm) => `${String(h).padStart(2, '0')}:${mm}`, range = [hm(m[1], m[2]), hm(m[3], m[4])];
    return toMin(range[1]) > toMin(range[0]) ? range : null;
  }

  // A variant other than the usual one counts only when all 12 lessons are filled in.
  function setBells(timesRows, dateRows) {
    const variants = { [BELL_BASE]: BELLS };
    if (Array.isArray(timesRows) && timesRows.length > 1) {
      timesRows[0].forEach((name, col) => {
        const label = String(name ?? '').trim();
        if (!col || !label) return;
        const list = [];
        for (let n = 1; n <= 12; n += 1) list.push(parseBellRange(timesRows.slice(1).find((r) => Number(r[0]) === n)?.[col]));
        if (label === BELL_BASE) variants[label] = list.map((x, i) => x || BELLS[i]);
        else if (list.every(Boolean)) variants[label] = list;
      });
    }
    const dates = new Map();
    (Array.isArray(dateRows) ? dateRows.slice(1) : []).forEach((r) => {
      const key = normalizeDateValue(r[0]), name = String(r[1] ?? '').trim();
      if (key && name !== BELL_BASE && variants[name]) dates.set(key, name);
    });
    bellVariants = variants;
    bellDates = dates;
  }

  async function loadBells({ force = false } = {}) {
    const names = window.SCHOOL_CONFIG?.googleSheets?.sheets || {};
    try {
      const [times, dates] = await Promise.all([site.loadSheet(names.bells || 'Звонки', { force, optional: true }), site.loadSheet(names.bellDates || 'Звонки_даты', { force, optional: true })]);
      setBells(times, dates);
    } catch (_) {}
    return bellVariants;
  }
  const dayCode = (date) => ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getUTCDay()];
  const fullSubject = (v) => (window.SchoolSubjects?.expandSubject ? window.SchoolSubjects.expandSubject(v) : String(v ?? ''));
  const sameText = (a, b) => site.normalize(String(a || '')) === site.normalize(String(b || ''));

  function lessonNumber(v) { const m = String(v ?? '').match(/\d+/); return m ? Number(m[0]) : 999; }

  function normalizeDateValue(value) {
    const s = String(value ?? '').trim(); if (!s) return '';
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${y}`; }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? `${m[3].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[1]}` : s;
  }

  function parseLesson(value, className) {
    if (window.SchoolSubjects?.parseLesson) return window.SchoolSubjects.parseLesson(value, className);
    const raw = String(value ?? '').trim();
    return { subject: fullSubject(raw), room: '', raw };
  }

  function scheduleParts(rows) {
    if (!Array.isArray(rows) || !rows.length) return { headers: DEFAULT_SCHEDULE_HEADERS, data: [] };
    return site.looksLikeHeader(rows[0], ['класс', 'урок', 'пн', 'понедельник']) ? { headers: rows[0], data: rows.slice(1) } : { headers: DEFAULT_SCHEDULE_HEADERS, data: rows };
  }
  function changesParts(rows) {
    if (!Array.isArray(rows) || !rows.length) return { headers: DEFAULT_CHANGES_HEADERS, data: [] };
    return site.looksLikeHeader(rows[0], ['дата', 'класс', 'урок', 'изменения']) ? { headers: rows[0], data: rows.slice(1) } : { headers: DEFAULT_CHANGES_HEADERS, data: rows };
  }
  function mapScheduleColumns(headers) {
    const classIndex = site.findHeaderIndex(headers, ['класс', 'классы'], 0);
    const lessonIndex = site.findHeaderIndex(headers, ['урок', 'номерурока', '№урока'], 1);
    const dayColumns = [];
    headers.forEach((h, i) => { const code = DAY_ALIASES[site.normalize(h)]; if (code && code !== 'ВС' && !dayColumns.some((x) => x.code === code)) dayColumns.push({ code, index: i }); });
    dayColumns.sort((a, b) => DAY_ORDER.indexOf(a.code) - DAY_ORDER.indexOf(b.code));
    return { classIndex, lessonIndex, dayColumns };
  }
  function mapChangesColumns(headers) {
    return {
      date: site.findHeaderIndex(headers, ['дата'], 0),
      className: site.findHeaderIndex(headers, ['класс', 'классы'], 1),
      lesson: site.findHeaderIndex(headers, ['урок', 'номерурока', '№урока'], 2),
      change: site.findHeaderIndex(headers, ['изменения', 'изменение', 'замена'], 3),
      note: site.findHeaderIndex(headers, ['примечание', 'комментарий'], 4)
    };
  }
  function deriveClasses(rows) {
    const { headers, data } = scheduleParts(rows);
    const ci = site.findHeaderIndex(headers, ['класс', 'классы'], 0);
    return [...new Set(data.map((r) => site.normalizeClass(r[ci])).filter(Boolean))].sort(classCollator.compare);
  }
  function dayColumns(scheduleRows) { return mapScheduleColumns(scheduleParts(scheduleRows).headers).dayColumns; }

  function baseLessonsFor(scheduleRows, date, className) {
    const { headers, data } = scheduleParts(scheduleRows);
    const { classIndex, lessonIndex, dayColumns: days } = mapScheduleColumns(headers);
    const day = days.find((x) => x.code === dayCode(date));
    const out = new Map();
    if (!day) return out;
    const cls = site.normalizeClass(className);
    data.filter((r) => site.normalizeClass(r[classIndex]) === cls).forEach((r) => {
      const lesson = lessonNumber(r[lessonIndex]), raw = String(r[day.index] ?? '').trim();
      if (lesson >= 1 && lesson <= 12 && raw) out.set(lesson, { lesson, ...parseLesson(raw, cls) });
    });
    return out;
  }

  function changeRowsFor(changesRows, date, className = '') {
    const { headers, data } = changesParts(changesRows);
    const c = mapChangesColumns(headers), key = site.dateKey(date), cls = site.normalizeClass(className);
    return data
      .filter((r) => r.some((x) => String(x ?? '').trim()) && normalizeDateValue(r[c.date]) === key && (!cls || site.normalizeClass(r[c.className]) === cls))
      .map((r) => ({ className: site.normalizeClass(r[c.className]), lesson: lessonNumber(r[c.lesson]), change: String(r[c.change] || '').trim(), note: String(r[c.note] || '').trim() }))
      .filter((x) => x.className && x.lesson >= 1 && x.lesson <= 12 && x.change)
      .sort((a, b) => classCollator.compare(a.className, b.className) || a.lesson - b.lesson);
  }

  // «304/301» or «304 / 305»: the rooms of a lesson split into groups.
  function groupRooms(room) { return String(room || '').split('/').map((x) => x.trim()).filter(Boolean); }

  // A lesson in groups that keeps only some of them — «Английский язык (304/301)» becomes
  // «Английский язык (304)» when one group's teacher is away: the whole class meets together.
  function isMerged(base, next) {
    const before = groupRooms(base.room), after = groupRooms(next.room);
    if (before.length < 2 || !after.length || after.length >= before.length) return false;
    const subjects = String(base.subject || '').split(' / ');
    return String(next.subject || base.subject).split(' / ').every((s) => subjects.some((b) => sameText(b, s)));
  }

  function classifyChange(base, change) {
    if (/^отмена$/i.test(change.change)) return { type: 'cancelled', base, newLesson: null, ...change };
    const next = parseLesson(change.change, change.className);
    if (!base) return { type: 'added', base: null, newLesson: next, ...change };
    if (isMerged(base, next)) return { type: 'merged', base, newLesson: { subject: next.subject || base.subject, room: next.room, raw: change.change }, ...change };
    if (sameText(base.subject, next.subject || base.subject) && next.room && String(base.room || '') !== String(next.room || '')) return { type: 'room', base, newLesson: { subject: next.subject || base.subject, room: next.room, raw: change.change }, ...change };
    return { type: 'changed', base, newLesson: next, ...change };
  }

  function actualDay(scheduleRows, changesRows, date, className) {
    const base = baseLessonsFor(scheduleRows, date, className);
    const changes = changeRowsFor(changesRows, date, className);
    const changeMap = new Map(changes.map((x) => [x.lesson, x]));
    const lessons = new Set([...base.keys(), ...changeMap.keys()]);
    return [...lessons].sort((a, b) => a - b).map((lesson) => {
      const b = base.get(lesson), ch = changeMap.get(lesson);
      if (!ch) return { type: 'normal', lesson, base: b, newLesson: b, note: '' };
      return classifyChange(b, ch);
    });
  }

  function nowMinutes(date = new Date()) {
    const t = new Intl.DateTimeFormat('ru-RU', { timeZone: window.SCHOOL_CONFIG?.timeZone || 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  // Where the school day of one class stands. `lessons` is actualDay() output.
  function classMoment(lessons, minutes = nowMinutes(), date) {
    const real = lessons.filter((x) => x.type !== 'cancelled' && x.lesson >= 1 && x.lesson <= 12);
    if (!real.length) return { type: 'none' };
    const first = real[0], last = real[real.length - 1];
    for (let i = 0; i < real.length; i += 1) {
      const x = real[i], start = toMin(bellStart(x.lesson, date)), end = toMin(bellEnd(x.lesson, date));
      if (minutes >= start && minutes < end) return { type: 'lesson', current: x, next: real[i + 1] || null, remaining: end - minutes, progress: Math.round(((minutes - start) / (end - start)) * 100) };
      if (minutes < start) return { type: i === 0 ? 'before' : 'break', next: x, until: start - minutes };
    }
    return { type: 'after', first, last };
  }

  // School-wide bell state, for the header pill.
  function bellMoment(minutes = nowMinutes(), date) {
    const list = bells(date);
    for (let i = 0; i < list.length; i += 1) {
      const a = toMin(list[i][0]), b = toMin(list[i][1]);
      if (minutes >= a && minutes < b) return { type: 'lesson', lesson: i + 1, remaining: b - minutes };
      if (minutes < a) return { type: i ? 'break' : 'before', next: i + 1, remaining: a - minutes };
    }
    return { type: 'after' };
  }

  // When a class's day starts and ends with the changes, and how that differs from its usual day.
  function dayBounds(lessons, date) {
    const span = (list) => (list.length ? { first: list[0].lesson, last: list[list.length - 1].lesson, start: bellStart(list[0].lesson, date), end: bellEnd(list[list.length - 1].lesson, date) } : null);
    const now = span(lessons.filter((x) => x.type !== 'cancelled'));
    const usual = span(lessons.filter((x) => x.base && x.type !== 'added'));
    return { now, usual, startChanged: Boolean(now && usual && now.first !== usual.first), endChanged: Boolean(now && usual && now.last !== usual.last), none: Boolean(!now && usual) };
  }

  // «Приходить к 08:50 — к 2-му уроку (обычно к 08:00)», only for what changed.
  function boundsLines(b) {
    if (b.none) return ['Уроков не будет'];
    const out = [];
    if (b.startChanged) out.push(`Приходить к ${b.now.start} — к ${b.now.first}-му уроку (обычно к ${b.usual.start})`);
    if (b.endChanged) out.push(`Уроки до ${b.now.end} — последний ${b.now.last}-й (обычно до ${b.usual.end})`);
    return out;
  }

  function lessonText(lesson) {
    if (!lesson) return '';
    return [lesson.subject, lesson.room ? `каб. ${lesson.room}` : ''].filter(Boolean).join(' · ');
  }

  function plural(n, one, few, many) {
    const n10 = n % 10, n100 = n % 100;
    if (n100 >= 11 && n100 <= 14) return many;
    if (n10 === 1) return one;
    if (n10 >= 2 && n10 <= 4) return few;
    return many;
  }

  // What to print for one lesson of actualDay(): subject, room, the old value and a label.
  function cellInfo(x) {
    const base = x.base || null, next = x.newLesson || null;
    const info = { kind: x.type, subject: '', room: '', old: '', badge: '', note: x.note || '' };
    if (x.type === 'normal') { info.subject = base?.subject || ''; info.room = base?.room || ''; }
    else if (x.type === 'cancelled') { info.subject = base?.subject || 'Урок'; info.room = base?.room || ''; info.badge = 'Отменён'; }
    else if (x.type === 'room') { info.subject = next?.subject || base?.subject || ''; info.room = next?.room || ''; info.old = base?.room ? `было: каб. ${base.room}` : ''; info.badge = 'Другой кабинет'; }
    else if (x.type === 'merged') { info.subject = next?.subject || base?.subject || ''; info.room = next?.room || ''; info.old = `было по группам: каб. ${base.room}`; info.badge = 'Весь класс вместе'; }
    else if (x.type === 'added') { info.subject = next?.subject || x.change || ''; info.room = next?.room || ''; info.badge = 'Добавлен'; }
    else { info.subject = next?.subject || x.change || ''; info.room = next?.room || ''; info.old = base ? `было: ${lessonText(base)}` : ''; info.badge = 'Замена'; }
    return info;
  }

  const BADGE_CLASS = { cancelled: 'badge--cancelled', changed: 'badge--changed', room: 'badge--room', merged: 'badge--merged', added: 'badge--added' };
  const sameDay = (a, b) => site.dateKey(a) === site.dateKey(b);
  const fmtDay = (date) => site.capitalize(site.formatSchoolDate(date, { weekday: true, year: false }));
  const duration = (min) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60 ? `${min % 60} мин` : ''}`.trim());

  // What a card of today's lesson says about time. `moment` is classMoment() of that class:
  // the lesson on now («до звонка 12 мин», how much of it has passed), the next one during a break
  // or before school, or a lesson already over. Other days and other lessons get null.
  // «Моя неделя» of a teacher. days: [{ code, off, lessons: [numbers taught], changed }].
  // A gap is a free lesson between the first and the last one of that day.
  function teacherWeekSummary(days) {
    let total = 0, gapsTotal = 0, maxRun = 0;
    const gaps = [], changedDays = [];
    days.forEach((d) => {
      if (d.off) return;
      const list = [...new Set(d.lessons)].sort((a, b) => a - b);
      total += list.length;
      if (d.changed) changedDays.push(d.code);
      if (!list.length) return;
      const free = list[list.length - 1] - list[0] + 1 - list.length;
      if (free) { gaps.push({ code: d.code, count: free }); gapsTotal += free; }
      let run = 1;
      list.forEach((n, i) => { run = i && n === list[i - 1] + 1 ? run + 1 : 1; maxRun = Math.max(maxRun, run); });
    });
    return { total, gapsTotal, gaps, maxRun, changedDays };
  }

  function lessonClock(x, moment, minutes = nowMinutes(), date) {
    if (!moment || moment.type === 'off' || moment.type === 'none') return null;
    if (moment.type === 'lesson' && moment.current.lesson === x.lesson) return { state: 'now', percent: moment.progress, minutes: moment.remaining, label: `до звонка ${moment.remaining} мин` };
    if ((moment.type === 'break' || moment.type === 'before') && moment.next.lesson === x.lesson) {
      return { state: 'next', minutes: moment.until, label: moment.type === 'break' ? `перемена, следующий урок через ${duration(moment.until)}` : `первый урок через ${duration(moment.until)}` };
    }
    if (moment.type === 'after' || toMin(bellEnd(x.lesson, date)) <= minutes) return { state: 'past' };
    return null;
  }

  // A room for the big badge of a card: «304/407» may break only after the slash, never inside a number.
  const roomMarkup = (room) => site.escapeHtml(room).replace(/\//g, '/<wbr>');

  // The line under a card: the text and, for the lesson on now, a progress bar along the bottom.
  function clockMarkup(clock) {
    if (!clock || clock.state === 'past') return '';
    const bar = clock.state === 'now' ? `<span class="lesson-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${clock.percent}" aria-label="Прошло ${clock.percent}% урока"><i style="width:${clock.percent}%"></i></span>` : '';
    return `<span class="lesson-clock lesson-clock--${clock.state}">${site.escapeHtml(clock.label)}</span>${bar}`;
  }

  // State of today for one class: { today, lessons, moment }.
  function todayFor(scheduleRows, changesRows, className) {
    const today = site.getSchoolToday();
    if (!className || !site.isSchoolDay(today)) return { today, lessons: [], moment: { type: 'off' } };
    const lessons = actualDay(scheduleRows, changesRows, today, className);
    return { today, lessons, moment: classMoment(lessons) };
  }

  // Inner markup of the «Сейчас» card (current lesson, next lesson or the next school day).
  function nowCardMarkup(scheduleRows, changesRows, className, state = todayFor(scheduleRows, changesRows, className)) {
    const esc = site.escapeHtml, m = state.moment;
    const badge = (x) => (x && x.type !== 'normal' ? `<span class="badge ${BADGE_CLASS[x.type]} now-card__badge">${esc(cellInfo(x).badge)}</span>` : '');
    if (m.type === 'off' || m.type === 'none' || m.type === 'after') {
      const holiday = site.holidayFor(state.today);
      const label = m.type === 'after' ? 'Уроки на сегодня закончились' : holiday && ![0, 6].includes(state.today.getUTCDay()) ? holiday.title : m.type === 'none' ? `Сегодня у ${className} уроков нет` : 'Сегодня выходной';
      const nextDay = site.nextSchoolDay(state.today);
      const lessons = actualDay(scheduleRows, changesRows, nextDay, className).filter((x) => x.type !== 'cancelled');
      const when = sameDay(nextDay, site.addUtcDays(state.today, 1)) ? 'Завтра' : fmtDay(nextDay);
      if (!lessons.length) return `<div class="now-card__top"><span class="now-card__label">${esc(label)}</span></div><div class="now-card__title">${esc(when)}: уроков нет</div>`;
      const first = lessons[0], info = cellInfo(first);
      return `<div class="now-card__top"><span class="now-card__label">${esc(label)}</span></div>${badge(first)}<div class="now-card__title">${esc(when)}: первый урок в ${esc(bellStart(first.lesson))}</div><div class="now-card__meta">${esc([info.subject, info.room ? `каб. ${info.room}` : ''].filter(Boolean).join(' · '))}</div>`;
    }
    if (m.type === 'lesson') {
      const info = cellInfo(m.current), next = m.next ? cellInfo(m.next) : null;
      return `<div class="now-card__top"><span class="now-card__label">Сейчас · ${m.current.lesson}-й урок</span><span class="now-card__pill">до звонка ${m.remaining} мин</span></div>${badge(m.current)}<div class="now-card__title">${esc(info.subject)}</div><div class="now-card__meta">${info.room ? `Кабинет ${esc(info.room)} · ` : ''}${esc(bellRange(m.current.lesson))}</div><div class="now-card__bar" role="progressbar" aria-label="Прошло от урока" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.progress}"><span style="width:${m.progress}%"></span></div><div class="now-card__next">${next ? `<span>Дальше</span><strong>${esc(next.subject)}</strong><em>${next.room ? `каб. ${esc(next.room)} · ` : ''}в ${esc(bellStart(m.next.lesson))}</em>` : '<span>Это последний урок сегодня</span>'}</div>`;
    }
    const info = cellInfo(m.next);
    const label = m.type === 'before' ? 'До начала уроков' : m.until > 25 ? 'Окно' : 'Перемена';
    return `<div class="now-card__top"><span class="now-card__label">${label} · далее ${m.next.lesson}-й урок</span><span class="now-card__pill">через ${esc(duration(m.until))}</span></div>${badge(m.next)}<div class="now-card__title">${esc(info.subject)}</div><div class="now-card__meta">${info.room ? `Кабинет ${esc(info.room)} · ` : ''}начало в ${esc(bellStart(m.next.lesson))}</div>`;
  }

  const bellsReady = loadBells();

  window.ScheduleCore = Object.freeze({
    BELLS, BELL_BASE, DAY_ORDER, DAY_NAMES, DAY_ALIASES, BADGE_CLASS, classCollator,
    toMin, bells, bellVariant, bellStart, bellEnd, bellRange, parseBellRange, setBells, loadBells, bellsReady,
    dayCode, fullSubject, sameText, sameDay, fmtDay, duration, lessonNumber, normalizeDateValue, parseLesson,
    scheduleParts, changesParts, mapScheduleColumns, mapChangesColumns, deriveClasses, dayColumns,
    baseLessonsFor, changeRowsFor, classifyChange, actualDay,
    nowMinutes, classMoment, bellMoment, lessonClock, clockMarkup, roomMarkup, teacherWeekSummary, dayBounds, boundsLines, lessonText, plural, cellInfo, todayFor, nowCardMarkup
  });
})();
