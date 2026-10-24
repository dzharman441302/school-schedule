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
  const bellStart = (n) => (BELLS[n - 1] || [''])[0];
  const bellEnd = (n) => (BELLS[n - 1] || ['', ''])[1];
  const bellRange = (n) => (BELLS[n - 1] ? `${BELLS[n - 1][0]}–${BELLS[n - 1][1]}` : '');
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

  function parseLesson(value) {
    if (window.SchoolSubjects?.parseLesson) return window.SchoolSubjects.parseLesson(value);
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
      if (lesson >= 1 && lesson <= 12 && raw) out.set(lesson, { lesson, ...parseLesson(raw) });
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

  function classifyChange(base, change) {
    if (/^отмена$/i.test(change.change)) return { type: 'cancelled', base, newLesson: null, ...change };
    const next = parseLesson(change.change);
    if (!base) return { type: 'added', base: null, newLesson: next, ...change };
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
  function classMoment(lessons, minutes = nowMinutes()) {
    const real = lessons.filter((x) => x.type !== 'cancelled' && x.lesson >= 1 && x.lesson <= 12);
    if (!real.length) return { type: 'none' };
    const first = real[0], last = real[real.length - 1];
    for (let i = 0; i < real.length; i += 1) {
      const x = real[i], start = toMin(bellStart(x.lesson)), end = toMin(bellEnd(x.lesson));
      if (minutes >= start && minutes < end) return { type: 'lesson', current: x, next: real[i + 1] || null, remaining: end - minutes, progress: Math.round(((minutes - start) / (end - start)) * 100) };
      if (minutes < start) return { type: i === 0 ? 'before' : 'break', next: x, until: start - minutes };
    }
    return { type: 'after', first, last };
  }

  // School-wide bell state, for the header pill.
  function bellMoment(minutes = nowMinutes()) {
    for (let i = 0; i < BELLS.length; i += 1) {
      const a = toMin(BELLS[i][0]), b = toMin(BELLS[i][1]);
      if (minutes >= a && minutes < b) return { type: 'lesson', lesson: i + 1, remaining: b - minutes };
      if (minutes < a) return { type: i ? 'break' : 'before', next: i + 1, remaining: a - minutes };
    }
    return { type: 'after' };
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
    else if (x.type === 'added') { info.subject = next?.subject || x.change || ''; info.room = next?.room || ''; info.badge = 'Добавлен'; }
    else { info.subject = next?.subject || x.change || ''; info.room = next?.room || ''; info.old = base ? `было: ${lessonText(base)}` : ''; info.badge = 'Замена'; }
    return info;
  }

  const BADGE_CLASS = { cancelled: 'badge--cancelled', changed: 'badge--changed', room: 'badge--room', added: 'badge--added' };
  const sameDay = (a, b) => site.dateKey(a) === site.dateKey(b);
  const fmtDay = (date) => site.capitalize(site.formatSchoolDate(date, { weekday: true, year: false }));
  const duration = (min) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч ${min % 60 ? `${min % 60} мин` : ''}`.trim());

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

  window.ScheduleCore = Object.freeze({
    BELLS, DAY_ORDER, DAY_NAMES, DAY_ALIASES, BADGE_CLASS, classCollator,
    toMin, bellStart, bellEnd, bellRange, dayCode, fullSubject, sameText, sameDay, fmtDay, duration, lessonNumber, normalizeDateValue, parseLesson,
    scheduleParts, changesParts, mapScheduleColumns, mapChangesColumns, deriveClasses, dayColumns,
    baseLessonsFor, changeRowsFor, classifyChange, actualDay,
    nowMinutes, classMoment, bellMoment, lessonText, plural, cellInfo, todayFor, nowCardMarkup
  });
})();
