// Опоздания: the marks of the duty administrators (sheets «Опоздания» and «Опоздания_смены»)
// turned into the punctuality rating that the corridor TV shows. Used by tv-students.js
// and late.html; no DOM here.
//
// A shift of a day is «counted» when the duty administrator closed it with «Готово», or,
// when they forgot, once it has at least one mark and its first lesson is over (or the day
// has passed). Only counted days give a class a zero and keep its streak going; a day
// nobody marked is skipped, never read as «nobody was late».
(() => {
  'use strict';
  const site = window.SchoolSite, core = window.ScheduleCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !core) return;

  const SHEETS = Object.freeze({ marks: 'Опоздания', shifts: 'Опоздания_смены' });
  const SECOND = (config.lateness?.secondShiftGrades || ['7', '8']).map(String);
  const STREAK_DAYS = 200; // how far back a streak is looked for

  const grade = (cls) => String(cls || '').match(/^(\d{1,2})/)?.[1] || '';
  const shiftOf = (cls) => (SECOND.includes(grade(cls)) ? 2 : 1);
  const toKey = (value) => site.normalizeDateValue(value);

  // Marks by day and class; days with a shift closed, days with a mark per shift.
  function parse(markRows, shiftRows) {
    const counts = new Map(), closed = new Set(), marked = new Set();
    let first = '';
    (markRows || []).slice(1).forEach((r) => {
      const key = toKey(r[1]), cls = site.normalizeClass(r[3]), delta = Number(r[4]) || 0;
      if (!/^\d\d\.\d\d\.\d{4}$/.test(key) || !cls || !delta) return;
      if (!counts.has(key)) counts.set(key, new Map());
      const day = counts.get(key);
      day.set(cls, Math.max(0, (day.get(cls) || 0) + delta));
      marked.add(`${key}|${shiftOf(cls)}`);
      const ts = site.parseDateValue(key).timestamp;
      if (!first || ts < site.parseDateValue(first).timestamp) first = key;
    });
    (shiftRows || []).slice(1).forEach((r) => {
      const key = toKey(r[0]), shift = Number(r[1]);
      if (/^\d\d\.\d\d\.\d{4}$/.test(key) && (shift === 1 || shift === 2)) closed.add(`${key}|${shift}`);
    });
    closed.forEach((k) => {
      const key = k.split('|')[0];
      if (!first || site.parseDateValue(key).timestamp < site.parseDateValue(first).timestamp) first = key;
    });
    return { counts, closed, marked, first: first ? new Date(site.parseDateValue(first).timestamp) : null };
  }

  const countOf = (data, date, cls) => data.counts.get(site.dateKey(date))?.get(cls) || 0;

  // The first lesson of a shift today, from the schedule with today's changes: the smallest
  // lesson number any class of the shift really has.
  function isReal(x) {
    if (x.type === 'cancelled') return false;
    const n = x.newLesson || x.base;
    return Boolean(String(n?.subject || '').trim() || String(n?.room || '').trim());
  }
  function firstLesson(scheduleRows, changesRows, date, classes, shift) {
    let first = 0;
    classes.filter((cls) => shiftOf(cls) === shift).forEach((cls) => {
      core.actualDay(scheduleRows, changesRows, date, cls).filter(isReal).forEach((x) => {
        if (!first || x.lesson < first) first = x.lesson;
      });
    });
    return first;
  }

  // ctx: { today: Date, minutes: now in Moscow, closeAfter: {1: minutes, 2: minutes} } — the
  // end of each shift's first lesson today (missing: the shift is not auto-closed today).
  function isCounted(data, date, shift, ctx) {
    const key = site.dateKey(date);
    if (data.closed.has(`${key}|${shift}`)) return true;
    if (!data.marked.has(`${key}|${shift}`)) return false;
    if (date.getTime() < ctx.today.getTime()) return true;
    const after = ctx.closeAfter?.[shift];
    return date.getTime() === ctx.today.getTime() && Number.isFinite(after) && ctx.minutes >= after;
  }

  // School days Monday–Friday of the week of a date.
  function weekDays(date) {
    const monday = site.addUtcDays(date, -((date.getUTCDay() + 6) % 7));
    return [0, 1, 2, 3, 4].map((i) => site.addUtcDays(monday, i)).filter((d) => site.isSchoolDay(d));
  }

  // Counted days in a row without a late pupil, back from today. Uncounted days are skipped;
  // any mark, even on a day still open, ends the streak.
  function streak(data, cls, ctx) {
    if (!data.first) return 0;
    const shift = shiftOf(cls);
    let n = 0, d = ctx.today;
    for (let i = 0; i < STREAK_DAYS && d.getTime() >= data.first.getTime(); i += 1, d = site.addUtcDays(d, -1)) {
      if (!site.isSchoolDay(d)) continue;
      if (countOf(data, d, cls) > 0) break;
      if (isCounted(data, d, shift, ctx)) n += 1;
    }
    return n;
  }

  // What the TV shows now. On the first school day of a week (and on days off) — the results
  // of the last finished week; on the other days — this week so far. null: nothing to show.
  function board(data, classes, ctx) {
    const today = ctx.today;
    const thisWeek = weekDays(today);
    let mode = 'week', days = thisWeek.filter((d) => d.getTime() <= today.getTime());
    if (!site.isSchoolDay(today) || (thisWeek.length && thisWeek[0].getTime() === today.getTime())) {
      mode = 'results';
      days = site.isSchoolDay(today) || !thisWeek.some((d) => d.getTime() < today.getTime())
        ? weekDays(site.addUtcDays(today, -7))
        : thisWeek.filter((d) => d.getTime() < today.getTime());
    }
    if (!days.length) return null;
    const counted = { 1: 0, 2: 0 };
    days.forEach((d) => [1, 2].forEach((s) => { if (isCounted(data, d, s, ctx)) counted[s] += 1; }));
    const anyMark = days.some((d) => data.counts.has(site.dateKey(d)));
    if (!anyMark && !counted[1] && !counted[2]) return null;

    const rows = classes.map((cls) => {
      const shift = shiftOf(cls);
      return { cls, shift, count: days.reduce((sum, d) => sum + countOf(data, d, cls), 0), streak: streak(data, cls, ctx), counted: counted[shift] };
    }).sort((a, b) => a.count - b.count || core.classCollator.compare(a.cls, b.cls));
    rows.forEach((r, i) => { r.place = i && rows[i - 1].count === r.count ? rows[i - 1].place : i + 1; });
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const max = Math.max(0, ...rows.map((r) => r.count));
    // «Неделя без опозданий»: a zero over a week that was really watched (all days but one counted).
    const perfect = mode === 'results' ? rows.filter((r) => r.count === 0 && r.counted >= Math.max(1, days.length - 1)).map((r) => r.cls) : [];
    const streaks = rows.filter((r) => r.streak >= 3).sort((a, b) => b.streak - a.streak || core.classCollator.compare(a.cls, b.cls)).slice(0, 3);
    return { mode, from: days[0], to: days[days.length - 1], rows, total, max, perfect, streaks };
  }

  window.LatenessCore = Object.freeze({ SHEETS, shiftOf, parse, firstLesson, isCounted, weekDays, streak, board, countOf });
})();
