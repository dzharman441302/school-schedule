(() => {
  'use strict';
  const site = window.SchoolSite;
  const core = window.ScheduleCore;
  const config = window.SCHOOL_CONFIG || {};
  if (!site) return;

  const PUBLIC_SHEET = 'Учителя_сайт', BASE_TEACHERS = 'Учителя', SCHEDULE = config.googleSheets?.sheets?.schedule || 'Расписание';
  const SETTINGS_SHEET = config.googleSheets?.sheets?.siteSettings || 'Настройки_сайта';
  // All the sheets of this page go to Google in one request, before the page asks for them one by one.
  site.preloadSheets?.([PUBLIC_SHEET, BASE_TEACHERS, SCHEDULE, SETTINGS_SHEET]);
  const DAY_CODES = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const DAY_NAMES = { ПН: 'Понедельник', ВТ: 'Вторник', СР: 'Среда', ЧТ: 'Четверг', ПТ: 'Пятница', СБ: 'Суббота', ВС: 'Воскресенье' };
  // Bell times of the shown date (shortened days included) from schedule-core.js.
  const timesFor = (iso) => Array.from({ length: 12 }, (_, i) => core.bellRange(i + 1, dateOf(iso)));
  const times = () => timesFor(state.date);
  const STORE_TEACHER = 'school20:myTeacher';
  const STORE_DEVICE = 'school20:staffDevice';
  const state = { publicRows: [], teacherRows: [], scheduleRows: [], cells: [], teachers: [], date: '', dateNote: '', search: '', onlyChanged: false, selectedTeacher: '', view: 'day' };
  const $ = (s) => document.querySelector(s), esc = site.escapeHtml;
  const normalizeClass = (v) => String(v || '').split(/\s*\+\s*/).map(site.normalizeClass).filter(Boolean).join(' + ');
  const fullSubject = (v, cls) => (window.SchoolSubjects?.expandSubject ? window.SchoolSubjects.expandSubject(v, cls) : String(v ?? ''));
  const stripWindow = (v) => (/^\s*окно\s*$/i.test(String(v || '')) ? '' : String(v || ''));
  const ruDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
  const isoOf = (date) => date.toISOString().slice(0, 10);
  const dateOf = (iso) => new Date(`${iso}T12:00:00Z`);
  const todayIso = () => isoOf(site.getSchoolToday());
  const nextSchoolIso = (iso) => isoOf(site.nextSchoolDay(dateOf(iso)));
  const statusEl = $('[data-status]');

  function setStatus(text, type = '') { if (!statusEl) return; statusEl.textContent = text; statusEl.className = `staff-status${type ? ` ${type}` : ''}`; }
  function dateCode(iso) { return DAY_CODES[dateOf(iso).getUTCDay()]; }
  function normalizeDate(v) { const s = String(v || '').trim(); let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; }
  function parseStudent(text, cls) { return window.SchoolSubjects?.parseLesson ? window.SchoolSubjects.parseLesson(text, cls) : { subject: fullSubject(text), room: '' }; }
  function parseTeacherCell(value) { const s = String(value || '').trim(); if (!s) return { className: '', subject: '', room: '' }; const p = s.split(/\r?\n|\s*\|\s*/).map((x) => x.trim()).filter(Boolean); return p.length >= 2 ? { className: normalizeClass(p[0]), subject: fullSubject(p[1] || '', p[0]), room: p[2] || '' } : { className: normalizeClass(s), subject: '', room: '' }; }
  function headerIndex(headers, names, fallback = -1) { return site.findHeaderIndex(headers, names, fallback); }
  function teacherOrderFromBase() { if (!state.teacherRows.length) return []; const h = state.teacherRows[0], d = state.teacherRows.slice(1), ix = headerIndex(h, ['ФИО', 'Учитель'], 0), out = []; d.forEach((r) => { const t = String(r[ix] || '').trim(); if (t && !out.includes(t)) out.push(t); }); return out; }

  function publicCellsForDate(iso = state.date) {
    if (!state.publicRows.length) return [];
    const h = state.publicRows[0], d = state.publicRows.slice(1);
    const ix = { date: headerIndex(h, ['Дата'], 0), teacher: headerIndex(h, ['Учитель'], 1), lesson: headerIndex(h, ['Урок'], 2), cls: headerIndex(h, ['Класс'], 3), subject: headerIndex(h, ['Предмет'], 4), room: headerIndex(h, ['Кабинет'], 5), status: headerIndex(h, ['Статус'], 6), oldClass: headerIndex(h, ['Было_класс'], 7), oldSubject: headerIndex(h, ['Было_предмет'], 8), oldRoom: headerIndex(h, ['Было_кабинет'], 9), note: headerIndex(h, ['Примечание'], 10) };
    return d.filter((r) => normalizeDate(r[ix.date]) === iso).map((r) => ({ teacher: String(r[ix.teacher] || '').trim(), lesson: Number(r[ix.lesson]) || 0, className: normalizeClass(r[ix.cls]), subject: fullSubject(r[ix.subject], r[ix.cls]), room: String(r[ix.room] || '').trim(), status: String(r[ix.status] || 'normal').trim() || 'normal', oldClass: normalizeClass(r[ix.oldClass]), oldSubject: fullSubject(r[ix.oldSubject], r[ix.oldClass]), oldRoom: String(r[ix.oldRoom] || '').trim(), note: String(r[ix.note] || '').trim() })).filter((x) => x.teacher && x.lesson >= 1 && x.lesson <= 12);
  }

  function baseCells(iso = state.date) {
    if (!state.teacherRows.length) return [];
    const th = state.teacherRows[0], td = state.teacherRows.slice(1), code = dateCode(iso);
    if (code === 'СБ' || code === 'ВС') return [];
    const teacherIx = headerIndex(th, ['ФИО', 'Учитель'], 0), lessonIx = headerIndex(th, ['УРОК', 'Урок'], 1), dayIx = th.map((x) => String(x || '').trim().toUpperCase()).indexOf(code);
    const scheduleMap = {};
    if (state.scheduleRows.length) {
      const sh = state.scheduleRows[0], sd = state.scheduleRows.slice(1), ci = headerIndex(sh, ['Класс'], 0), li = headerIndex(sh, ['Урок'], 1), di = sh.map((x) => String(x || '').trim().toUpperCase()).indexOf(code);
      if (di >= 0) sd.forEach((r) => { const cls = normalizeClass(r[ci]), l = Number(r[li]) || 0; if (cls && l) scheduleMap[`${cls}|${l}`] = String(r[di] || '').trim(); });
    }
    return td.map((r) => {
      const teacher = String(r[teacherIx] || '').trim(), lesson = Number(r[lessonIx]) || 0;
      if (!teacher || lesson < 1 || lesson > 12 || dayIx < 0) return null;
      const tc = parseTeacherCell(r[dayIx]), sp = parseStudent(scheduleMap[`${tc.className}|${lesson}`] || '', tc.className);
      return { teacher, lesson, className: tc.className, subject: tc.subject || sp.subject, room: tc.room || sp.room, status: 'normal', oldClass: '', oldSubject: '', oldRoom: '', note: '' };
    }).filter(Boolean);
  }

  function cellsFor(iso) { const published = publicCellsForDate(iso); return published.length ? published : baseCells(iso); }

  function relationMap(cells) {
    const split = (v) => String(v || '').split(/\s*\+\s*/).filter(Boolean), removed = new Map(), added = new Map();
    const put = (m, k, t) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t); };
    cells.forEach((c) => { const old = split(c.oldClass), next = split(c.className); old.filter((cls) => !next.includes(cls)).forEach((cls) => put(removed, `${cls}|${c.lesson}`, c.teacher)); next.filter((cls) => !old.includes(cls) && c.status !== 'normal').forEach((cls) => put(added, `${cls}|${c.lesson}`, c.teacher)); });
    const out = new Map();
    cells.forEach((c) => { const from = new Set(), to = new Set(); split(c.className).forEach((cls) => (removed.get(`${cls}|${c.lesson}`) || []).forEach((t) => { if (t !== c.teacher) from.add(t); })); split(c.oldClass).forEach((cls) => (added.get(`${cls}|${c.lesson}`) || []).forEach((t) => { if (t !== c.teacher) to.add(t); })); const labels = []; if (from.size) labels.push(`← ${[...from].join(', ')}`); if (to.size) labels.push(`→ ${[...to].join(', ')}`); if (labels.length) out.set(`${c.teacher}|${c.lesson}`, labels.join(' · ')); });
    return out;
  }
  function hasChange(t) { return state.cells.some((c) => c.teacher === t && c.status !== 'normal'); }
  function matchingTeacher(t) { const q = site.normalize(state.search); return !q || site.normalize(t).includes(q); }

  // The lesson that is running right now, when the grid shows today.
  function currentLesson(iso = state.date) {
    if (iso !== todayIso() || !core) return 0;
    const m = core.bellMoment();
    return m.type === 'lesson' ? m.lesson : 0;
  }

  function cellMarkup(c, rel, nowLesson) {
    const type = c.status || 'normal', cancel = type === 'cancelled', cls = cancel ? c.oldClass : c.className, subject = stripWindow(fullSubject(cancel ? c.oldSubject : c.subject)), room = cancel ? c.oldRoom : c.room;
    const label = ({ cancelled: 'Снят', changed: 'Изменён', added: 'Новый', room: 'Кабинет', 'room-change': 'Кабинет' })[type] || '';
    let inner = cls ? `${label ? `<span class="staff-cell-state ${esc(type)}">${label}</span>` : ''}<span class="cls">${esc(cls)}</span><span class="subj">${esc(subject)}</span>${room ? `<span class="room">${esc(room)}</span>` : ''}` : '<span class="staff-empty-mark">—</span>';
    if (rel) inner += `<span class="arrow">${esc(rel)}</span>`;
    return `<div class="sg-cell ${esc(type)}${!cls ? ' empty' : ''}${c.lesson === nowLesson ? ' is-now' : ''}" data-lesson="${c.lesson}" title="${esc([label, cls, subject, room, rel].filter(Boolean).join(' · '))}">${inner}</div>`;
  }

  function orderedTeachers() { const present = [...new Set(state.cells.map((c) => c.teacher).filter(Boolean))], base = teacherOrderFromBase(); return [...base.filter((t) => present.includes(t)), ...present.filter((t) => !base.includes(t))]; }

  function renderGrid() {
    const grid = $('[data-grid]'), rel = relationMap(state.cells), nowLesson = currentLesson();
    let html = `<div class="sg-head teacher">Учитель</div>${times().map((time, i) => `<div class="sg-head${i + 1 === nowLesson ? ' is-now' : ''}"><b>${i + 1}</b><small>${time}</small></div>`).join('')}`;
    const visible = state.teachers.filter((t) => (!state.onlyChanged || hasChange(t)) && matchingTeacher(t));
    visible.forEach((t) => {
      html += `<div class="staff-grid-row"><div class="sg-teacher ${hasChange(t) ? 'changed' : ''}">${esc(t)}</div>`;
      for (let l = 1; l <= 12; l += 1) { const c = state.cells.find((x) => x.teacher === t && x.lesson === l) || { teacher: t, lesson: l, className: '', subject: '', room: '', status: 'normal', oldClass: '', oldSubject: '', oldRoom: '' }; html += cellMarkup(c, rel.get(`${t}|${l}`), nowLesson); }
      html += '</div>';
    });
    grid.innerHTML = visible.length ? html : `<div class="staff-empty" style="grid-column:1/-1">${state.cells.length ? 'По выбранному фильтру учителя не найдены.' : 'На эту дату уроков нет.'}</div>`;
  }

  function currentTeacherFromStorage() { const q = new URLSearchParams(location.search).get('teacher'); const stored = site.storageGet(STORE_TEACHER); const desired = q || stored; return state.teachers.find((t) => site.normalize(t) === site.normalize(desired)) || state.teachers[0] || ''; }
  function saveTeacher(t) { state.selectedTeacher = t; site.storageSet(STORE_TEACHER, t); const u = new URL(location.href); if (t) u.searchParams.set('teacher', t); else u.searchParams.delete('teacher'); u.searchParams.delete('v'); history.replaceState(null, '', u.pathname + u.search + u.hash); syncTeacherSelects(); }
  function syncTeacherSelects() { ['#teacher-select', '#staff-my-teacher', '#week-teacher'].forEach((sel) => { const e = $(sel); if (!e) return; e.innerHTML = state.teachers.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join(''); e.value = state.selectedTeacher; }); }
  function teacherLink(t = state.selectedTeacher) { const u = new URL(location.href); u.searchParams.set('teacher', t); u.searchParams.set('mine', '1'); if (state.view === 'week') u.searchParams.set('view', 'week'); else u.searchParams.delete('view'); u.searchParams.delete('v'); u.hash = ''; return u.href; }
  function showOnlyMine() { if (!state.selectedTeacher) return; state.search = state.selectedTeacher; $('#staff-search').value = state.selectedTeacher; state.onlyChanged = false; $('[data-only-changed]').checked = false; renderGrid(); document.querySelector('.staff-grid-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  // Phone: one teacher's lessons. Lessons before the first and after the last
  // one are hidden; free lessons in between are shown as breaks.
  function renderMobile() {
    syncTeacherSelects();
    const only = $('[data-mobile-only-changed]')?.checked, rel = relationMap(state.cells), target = $('[data-teacher-cards]'), nowLesson = currentLesson();
    const all = state.cells.filter((c) => c.teacher === state.selectedTeacher).sort((a, b) => a.lesson - b.lesson);
    const scheduled = all.filter((c) => c.className || c.oldClass || c.status !== 'normal');
    if (!scheduled.length) { target.innerHTML = '<div class="staff-empty">На этот день у выбранного учителя уроков нет.</div>'; return; }
    const first = scheduled[0].lesson, last = scheduled[scheduled.length - 1].lesson;
    const rows = all.filter((c) => c.lesson >= first && c.lesson <= last && (!only || c.status !== 'normal'));
    target.innerHTML = rows.length ? rows.map((c) => cardMarkup(c, rel, nowLesson, times())).join('') : '<div class="staff-empty">Для выбранного учителя уроков по этому фильтру нет.</div>';
  }

  function cardMarkup(c, rel, nowLesson, bells, week = false) {
      const r = rel.get(`${c.teacher}|${c.lesson}`), gap = !c.className && c.status === 'normal';
      let body;
      if (c.status === 'cancelled') { const old = [c.oldClass, stripWindow(c.oldSubject)].filter(Boolean).map(esc).join(' · '); body = `<h3>Урок снят</h3><p>${old || 'Урок'}${c.oldRoom ? ` · кабинет ${esc(c.oldRoom)}` : ''}</p>`; }
      else if (gap) body = week ? '<h3>Окно</h3><p>Свободный урок</p>' : '<h3>Свободно</h3><p>Перерыв между уроками</p>';
      else body = `<h3>${esc(c.className)} · ${esc(stripWindow(c.subject))}</h3><p>${c.room ? `Кабинет ${esc(c.room)}` : 'Кабинет не указан'}${c.oldClass && c.oldClass !== c.className ? ` · было ${esc(c.oldClass)}` : ''} · ${esc(bells[c.lesson - 1] || '')}</p>`;
      return `<article class="teacher-card ${esc(c.status)}${gap ? ' is-gap' : ''}"${c.lesson === nowLesson ? ' style="border:2px solid var(--accent)"' : ''}><div class="teacher-card__lesson">${c.lesson}</div><div>${body}${r ? `<span class="tag">${esc(r)}</span>` : ''}${c.note ? `<p>${esc(c.note)}</p>` : ''}</div></article>`;
  }


  /* «Моя неделя»: ПН–ПТ of the chosen date for one teacher ---------- */

  const taught = (c) => c && c.status !== 'cancelled' && c.className;
  const shown = (c) => c.className || c.oldClass || c.status !== 'normal';
  const emptyCell = (teacher, lesson) => ({ teacher, lesson, className: '', subject: '', room: '', status: 'normal', oldClass: '', oldSubject: '', oldRoom: '' });
  // Saturday and Sunday open the coming week.
  function weekDates(iso) {
    const d = dateOf(iso), day = d.getUTCDay(), monday = site.addUtcDays(d, day === 0 ? 1 : day === 6 ? 2 : 1 - day);
    return [0, 1, 2, 3, 4].map((i) => isoOf(site.addUtcDays(monday, i)));
  }
  function weekData(teacher) {
    return weekDates(state.date).map((iso) => {
      const holiday = site.holidayFor(dateOf(iso)), all = holiday ? [] : cellsFor(iso);
      const mine = all.filter((c) => c.teacher === teacher), lessons = mine.filter(taught).map((c) => c.lesson);
      const short = !holiday && core.bellVariant(dateOf(iso)) !== core.BELL_BASE;
      return { iso, code: dateCode(iso), off: Boolean(holiday), holiday, short, all, mine, lessons, changed: mine.some((c) => c.status !== 'normal'), first: Math.min(...lessons), last: Math.max(...lessons) };
    });
  }
  const shortName = (code) => String(code).toLowerCase();
  function summaryMarkup(sum) {
    const metric = (n, text) => `<div class="staff-metric"><strong>${n}</strong><span>${esc(text)}</span></div>`;
    const gaps = sum.gaps.map((g) => `${shortName(g.code)} ${g.count}`).join(', ');
    return metric(sum.total, `${core.plural(sum.total, 'урок', 'урока', 'уроков')} за неделю`)
      + metric(sum.gapsTotal, `${core.plural(sum.gapsTotal, 'окно', 'окна', 'окон')}${gaps ? ` (${gaps})` : ''}`)
      + metric(sum.maxRun, `${core.plural(sum.maxRun, 'урок', 'урока', 'уроков')} подряд — максимум`)
      + (sum.changedDays.length ? metric(sum.changedDays.length, `${core.plural(sum.changedDays.length, 'день', 'дня', 'дней')} с изменениями: ${sum.changedDays.map(shortName).join(', ')}`) : metric('0', 'дней с изменениями'));
  }
  function weekCell(day, lesson, rel) {
    const c = day.mine.find((x) => x.lesson === lesson) || emptyCell(state.selectedTeacher, lesson);
    if (!shown(c)) {
      const gap = lesson > day.first && lesson < day.last;
      return `<div class="sg-cell empty${gap ? ' is-gap' : ''}">${gap ? '<span class="staff-gap-mark">окно</span>' : '<span class="staff-empty-mark">—</span>'}</div>`;
    }
    return cellMarkup(c, rel.get(`${c.teacher}|${lesson}`), currentLesson(day.iso));
  }
  function renderWeek() {
    const teacher = state.selectedTeacher, days = weekData(teacher), dates = days.map((d) => d.iso), today = todayIso();
    const month = (iso) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(dateOf(iso));
    const range = dates[0].slice(5, 7) === dates[4].slice(5, 7) ? `${Number(dates[0].slice(8))}–${month(dates[4])}` : `${month(dates[0])} – ${month(dates[4])}`;
    $('[data-week-title]').textContent = `${range} · ${teacher || 'учитель не выбран'}`;
    $('[data-week-summary]').innerHTML = summaryMarkup(core.teacherWeekSummary(days));
    const last = Math.max(0, ...days.map((d) => Math.max(0, ...d.mine.filter(shown).map((c) => c.lesson))));
    const rels = days.map((d) => relationMap(d.all)), bells = timesFor(dates.find((iso) => !site.holidayFor(dateOf(iso)) && core.bellVariant(dateOf(iso)) === core.BELL_BASE) || dates[0]);
    const head = days.map((d) => `<th scope="col"${d.iso === today ? ' class="is-today"' : ''}><b>${DAY_NAMES[d.code]}</b><small>${ruDate(d.iso).slice(0, 5)}${d.short ? ' · сокр.' : ''}</small></th>`).join('');
    let body = '';
    for (let l = 1; l <= last; l += 1) {
      body += `<tr><th scope="row"><b>${l}</b><small>${esc(bells[l - 1] || '')}</small></th>`;
      days.forEach((d, i) => {
        if (d.off) { if (l === 1) body += `<td class="is-off" rowspan="${last}"><div class="staff-week__off"><b>Нет занятий</b><span>${esc(d.holiday.title)}</span></div></td>`; return; }
        body += `<td${d.iso === today ? ' class="is-today"' : ''}>${weekCell(d, l, rels[i])}</td>`;
      });
      body += '</tr>';
    }
    $('[data-week-table]').innerHTML = last ? `<thead><tr><th scope="col">Урок</th>${head}</tr></thead><tbody>${body}</tbody>` : '<tbody><tr><td><div class="staff-empty">На этой неделе у выбранного учителя уроков нет.</div></td></tr></tbody>';
    // Phone: the same week as a list of days.
    $('[data-week-list]').innerHTML = days.map((d, i) => {
      const title = `${DAY_NAMES[d.code]}, ${ruDate(d.iso).slice(0, 5)}${d.short ? ' · сокращённые уроки' : ''}`;
      let cards;
      const lessons = d.mine.filter(shown).map((c) => c.lesson);
      if (d.off) cards = `<div class="staff-empty">Нет занятий · ${esc(d.holiday.title)}</div>`;
      else if (!lessons.length) cards = '<div class="staff-empty">Уроков нет</div>';
      else {
        const list = [];
        for (let l = Math.min(...lessons); l <= Math.max(...lessons); l += 1) list.push(d.mine.find((c) => c.lesson === l) || emptyCell(teacher, l));
        cards = list.map((c) => cardMarkup(c, rels[i], currentLesson(d.iso), timesFor(d.iso), true)).join('');
      }
      return `<section class="staff-week__day${d.iso === today ? ' is-today' : ''}"><h3>${esc(title)}</h3><div class="teacher-cards">${cards}</div></section>`;
    }).join('');
  }
  function setView(view, { push = true } = {}) {
    state.view = view === 'week' ? 'week' : 'day';
    const week = state.view === 'week';
    document.body.classList.toggle('is-week', week);
    $('[data-week]').hidden = !week;
    document.querySelectorAll('.segmented [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    if (push) { const u = new URL(location.href); if (week) u.searchParams.set('view', 'week'); else u.searchParams.delete('view'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
    if (week && state.teacherRows.length) renderWeek();
  }

  function renderStats() {
    const changes = state.cells.filter((c) => c.status !== 'normal'), teachers = new Set(changes.map((c) => c.teacher)), el = $('[data-staff-stats]');
    if (el) el.innerHTML = `<div class="staff-metric"><strong>${changes.length}</strong><span>изменённых клеток</span></div><div class="staff-metric"><strong>${teachers.size}</strong><span>учителей с изменениями</span></div>`;
  }

  function updateDateButtons() {
    const tomorrow = $('[data-date="tomorrow"]');
    if (!tomorrow) return;
    const next = nextSchoolIso(todayIso()), plain = isoOf(site.addUtcDays(dateOf(todayIso()), 1));
    tomorrow.textContent = next === plain ? 'Завтра' : `${site.capitalize(new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short' }).format(dateOf(next)))}, ${ruDate(next).slice(0, 5)}`;
  }

  function render() {
    state.teachers = orderedTeachers();
    if (!state.selectedTeacher || !state.teachers.includes(state.selectedTeacher)) state.selectedTeacher = currentTeacherFromStorage();
    const code = dateCode(state.date), holiday = site.holidayFor(dateOf(state.date));
    const short = !holiday && core.bellVariant(dateOf(state.date)) !== core.BELL_BASE;
    $('[data-day-title]').textContent = `${DAY_NAMES[code] || code}, ${ruDate(state.date)}${holiday ? ` · ${holiday.title}` : short ? ' · сокращённые уроки' : ''}`;
    $('[data-publish-note]').textContent = state.dateNote || (publicCellsForDate().length ? 'Показана опубликованная сетка изменений.' : 'Изменения на эту дату ещё не публиковались — показано основное расписание.');
    renderGrid(); renderMobile(); renderStats();
    const mine = new URLSearchParams(location.search).get('mine') === '1' && !state.mineShown;
    if (state.view === 'week') { renderWeek(); if (mine) { state.mineShown = true; setTimeout(() => $('[data-week]').scrollIntoView({ block: 'start', behavior: 'instant' }), 400); } }
    else if (mine) setTimeout(showOnlyMine, 30);
  }

  async function load(force = false) {
    setStatus('Загружаю сетку…');
    try {
      const [pub, teachers, schedule] = await Promise.all([site.loadSheet(PUBLIC_SHEET, { force, optional: true }), site.loadSheet(BASE_TEACHERS, { force, optional: true }), site.loadSheet(SCHEDULE, { force, optional: true }), core.loadBells({ force })]);
      state.publicRows = pub; state.teacherRows = teachers; state.scheduleRows = schedule;
      const published = publicCellsForDate();
      state.cells = published.length ? published : baseCells(state.date);
      render();
      setStatus(published.length ? 'Опубликованные изменения загружены' : 'Показано основное расписание', 'ok');
    } catch (e) {
      setStatus('Не удалось загрузить сетку', 'bad');
      $('[data-grid]').innerHTML = `<div class="staff-empty" style="grid-column:1/-1">${esc(e.message)}</div>`;
    }
  }

  function setDate(iso, note = '') { state.date = iso; state.dateNote = note; $('#staff-date').value = iso; }

  /* «Увидел изменения»: the same Apps Script endpoint as before ---- */

  async function setupSeen() {
    let endpoint = '';
    try {
      const rows = await site.loadSheet(SETTINGS_SHEET, { optional: true, ttl: 60 * 60 * 1000 });
      const r = rows?.slice(1).find((x) => String(x[0] || '') === 'appsScriptUrl');
      endpoint = String(r?.[1] || '');
    } catch (_) {}
    if (!/^https:\/\/script\.google\.com\//.test(endpoint)) return () => {};
    let device = site.storageGet(STORE_DEVICE);
    if (!device) { device = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`; site.storageSet(STORE_DEVICE, device); }
    return (teacher) => {
      if (!teacher) return;
      const body = new URLSearchParams({ action: 'markSeen', date: $('#staff-date')?.value || todayIso(), teacher, device });
      fetch(endpoint, { method: 'POST', mode: 'no-cors', body }).catch(() => {});
      site.storageSet(STORE_TEACHER, teacher);
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await site.loadCalendar();
    const today = todayIso();
    if (site.isSchoolDay(dateOf(today))) setDate(today);
    else { const next = nextSchoolIso(today); setDate(next, `Сегодня выходной — показан ближайший учебный день, ${ruDate(next)}.`); }
    updateDateButtons();
    $('#staff-date').addEventListener('change', () => { setDate($('#staff-date').value); load(); });
    document.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => { setDate(b.dataset.date === 'tomorrow' ? nextSchoolIso(todayIso()) : todayIso()); load(); }));
    $('#staff-search').addEventListener('input', (e) => { state.search = e.target.value; renderGrid(); });
    $('[data-only-changed]').addEventListener('change', (e) => { state.onlyChanged = e.target.checked; renderGrid(); });
    $('[data-mobile-only-changed]').addEventListener('change', renderMobile);
    $('[data-my-only]')?.addEventListener('click', showOnlyMine);
    $('[data-teacher-link]')?.addEventListener('click', async () => { const url = teacherLink(); try { await navigator.clipboard.writeText(url); setStatus('Персональная ссылка скопирована', 'ok'); } catch (_) { prompt('Скопируйте ссылку:', url); } });
    $('[data-refresh]').addEventListener('click', () => { load(true); window.SiteShell?.refreshFreshness(); });
    document.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { setView(b.dataset.view); if (state.view === 'week') $('[data-week]').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    document.querySelectorAll('[data-week-shift]').forEach((b) => b.addEventListener('click', () => { setDate(isoOf(site.addUtcDays(dateOf(weekDates(state.date)[0]), Number(b.dataset.weekShift)))); load(); }));
    $('#week-teacher')?.addEventListener('change', (e) => { saveTeacher(e.target.value); renderMobile(); renderWeek(); markSeen(e.target.value); });
    setView(new URLSearchParams(location.search).get('view'), { push: false });
    let markSeen = () => {};
    const seenReady = setupSeen();
    $('#teacher-select').addEventListener('change', (e) => { saveTeacher(e.target.value); renderMobile(); markSeen(e.target.value); });
    $('#staff-my-teacher')?.addEventListener('change', (e) => { saveTeacher(e.target.value); renderMobile(); if (state.view === 'week') renderWeek(); markSeen(e.target.value); });
    // The saved copy is drawn at once; a newer one from Google redraws the grid (only if it changed).
    await load();
    site.onSheetsUpdated?.((names) => { if ([PUBLIC_SHEET, BASE_TEACHERS, SCHEDULE, 'Звонки', 'Звонки_даты'].some((n) => names.has(n))) load(); });
    markSeen = await seenReady;
    const saved = new URLSearchParams(location.search).get('teacher') || site.storageGet(STORE_TEACHER);
    if (saved && state.teachers.includes(saved)) markSeen(saved);
    setInterval(() => { if (state.date === todayIso()) { renderGrid(); renderMobile(); } if (state.view === 'week') renderWeek(); }, 60000);
  });
})();
