(() => {
  'use strict';
  const site = window.SchoolSite;
  const core = window.ScheduleCore;
  const config = window.SCHOOL_CONFIG || {};
  if (!site) return;

  const PUBLIC_SHEET = 'Учителя_сайт', BASE_TEACHERS = 'Учителя', SCHEDULE = config.googleSheets?.sheets?.schedule || 'Расписание';
  const SETTINGS_SHEET = config.googleSheets?.sheets?.siteSettings || 'Настройки_сайта';
  const DAY_CODES = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const DAY_NAMES = { ПН: 'Понедельник', ВТ: 'Вторник', СР: 'Среда', ЧТ: 'Четверг', ПТ: 'Пятница', СБ: 'Суббота', ВС: 'Воскресенье' };
  const TIMES = ['08:00–08:40', '08:50–09:30', '09:45–10:25', '10:45–11:25', '11:40–12:20', '12:30–13:10', '13:20–14:00', '14:15–14:55', '15:10–15:50', '16:05–16:45', '17:00–17:40', '17:50–18:30'];
  const STORE_TEACHER = 'school20:myTeacher';
  const STORE_DEVICE = 'school20:staffDevice';
  const state = { publicRows: [], teacherRows: [], scheduleRows: [], cells: [], teachers: [], date: '', dateNote: '', search: '', onlyChanged: false, selectedTeacher: '' };
  const $ = (s) => document.querySelector(s), esc = site.escapeHtml;
  const normalizeClass = (v) => String(v || '').split(/\s*\+\s*/).map(site.normalizeClass).filter(Boolean).join(' + ');
  const fullSubject = (v) => (window.SchoolSubjects?.expandSubject ? window.SchoolSubjects.expandSubject(v) : String(v ?? ''));
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
  function parseStudent(text) { return window.SchoolSubjects?.parseLesson ? window.SchoolSubjects.parseLesson(text) : { subject: fullSubject(text), room: '' }; }
  function parseTeacherCell(value) { const s = String(value || '').trim(); if (!s) return { className: '', subject: '', room: '' }; const p = s.split(/\r?\n|\s*\|\s*/).map((x) => x.trim()).filter(Boolean); return p.length >= 2 ? { className: normalizeClass(p[0]), subject: fullSubject(p[1] || ''), room: p[2] || '' } : { className: normalizeClass(s), subject: '', room: '' }; }
  function headerIndex(headers, names, fallback = -1) { return site.findHeaderIndex(headers, names, fallback); }
  function teacherOrderFromBase() { if (!state.teacherRows.length) return []; const h = state.teacherRows[0], d = state.teacherRows.slice(1), ix = headerIndex(h, ['ФИО', 'Учитель'], 0), out = []; d.forEach((r) => { const t = String(r[ix] || '').trim(); if (t && !out.includes(t)) out.push(t); }); return out; }

  function publicCellsForDate() {
    if (!state.publicRows.length) return [];
    const h = state.publicRows[0], d = state.publicRows.slice(1);
    const ix = { date: headerIndex(h, ['Дата'], 0), teacher: headerIndex(h, ['Учитель'], 1), lesson: headerIndex(h, ['Урок'], 2), cls: headerIndex(h, ['Класс'], 3), subject: headerIndex(h, ['Предмет'], 4), room: headerIndex(h, ['Кабинет'], 5), status: headerIndex(h, ['Статус'], 6), oldClass: headerIndex(h, ['Было_класс'], 7), oldSubject: headerIndex(h, ['Было_предмет'], 8), oldRoom: headerIndex(h, ['Было_кабинет'], 9), note: headerIndex(h, ['Примечание'], 10) };
    return d.filter((r) => normalizeDate(r[ix.date]) === state.date).map((r) => ({ teacher: String(r[ix.teacher] || '').trim(), lesson: Number(r[ix.lesson]) || 0, className: normalizeClass(r[ix.cls]), subject: fullSubject(String(r[ix.subject] || '').trim()), room: String(r[ix.room] || '').trim(), status: String(r[ix.status] || 'normal').trim() || 'normal', oldClass: normalizeClass(r[ix.oldClass]), oldSubject: fullSubject(String(r[ix.oldSubject] || '').trim()), oldRoom: String(r[ix.oldRoom] || '').trim(), note: String(r[ix.note] || '').trim() })).filter((x) => x.teacher && x.lesson >= 1 && x.lesson <= 12);
  }

  function baseCells() {
    if (!state.teacherRows.length) return [];
    const th = state.teacherRows[0], td = state.teacherRows.slice(1), code = dateCode(state.date);
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
      const tc = parseTeacherCell(r[dayIx]), sp = parseStudent(scheduleMap[`${tc.className}|${lesson}`] || '');
      return { teacher, lesson, className: tc.className, subject: tc.subject || sp.subject, room: tc.room || sp.room, status: 'normal', oldClass: '', oldSubject: '', oldRoom: '', note: '' };
    }).filter(Boolean);
  }

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
  function currentLesson() {
    if (state.date !== todayIso() || !core) return 0;
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
    let html = `<div class="sg-head teacher">Учитель</div>${TIMES.map((time, i) => `<div class="sg-head${i + 1 === nowLesson ? ' is-now' : ''}"><b>${i + 1}</b><small>${time}</small></div>`).join('')}`;
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
  function syncTeacherSelects() { ['#teacher-select', '#staff-my-teacher'].forEach((sel) => { const e = $(sel); if (!e) return; e.innerHTML = state.teachers.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join(''); e.value = state.selectedTeacher; }); }
  function teacherLink(t = state.selectedTeacher) { const u = new URL(location.href); u.searchParams.set('teacher', t); u.searchParams.set('mine', '1'); u.searchParams.delete('v'); return u.href; }
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
    target.innerHTML = rows.length ? rows.map((c) => {
      const r = rel.get(`${c.teacher}|${c.lesson}`), gap = !c.className && c.status === 'normal';
      let body;
      if (c.status === 'cancelled') { const old = [c.oldClass, stripWindow(c.oldSubject)].filter(Boolean).map(esc).join(' · '); body = `<h3>Урок снят</h3><p>${old || 'Урок'}${c.oldRoom ? ` · кабинет ${esc(c.oldRoom)}` : ''}</p>`; }
      else if (gap) body = '<h3>Свободно</h3><p>Перерыв между уроками</p>';
      else body = `<h3>${esc(c.className)} · ${esc(stripWindow(c.subject))}</h3><p>${c.room ? `Кабинет ${esc(c.room)}` : 'Кабинет не указан'}${c.oldClass && c.oldClass !== c.className ? ` · было ${esc(c.oldClass)}` : ''} · ${esc(TIMES[c.lesson - 1] || '')}</p>`;
      return `<article class="teacher-card ${esc(c.status)}${gap ? ' is-gap' : ''}"${c.lesson === nowLesson ? ' style="border:2px solid var(--accent)"' : ''}><div class="teacher-card__lesson">${c.lesson}</div><div>${body}${r ? `<span class="tag">${esc(r)}</span>` : ''}${c.note ? `<p>${esc(c.note)}</p>` : ''}</div></article>`;
    }).join('') : '<div class="staff-empty">Для выбранного учителя уроков по этому фильтру нет.</div>';
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
    $('[data-day-title]').textContent = `${DAY_NAMES[code] || code}, ${ruDate(state.date)}${holiday ? ` · ${holiday.title}` : ''}`;
    $('[data-publish-note]').textContent = state.dateNote || (publicCellsForDate().length ? 'Показана опубликованная сетка изменений.' : 'Изменения на эту дату ещё не публиковались — показано основное расписание.');
    renderGrid(); renderMobile(); renderStats();
    if (new URLSearchParams(location.search).get('mine') === '1') setTimeout(showOnlyMine, 30);
  }

  async function load(force = false) {
    setStatus('Загружаю сетку…');
    try {
      const [pub, teachers, schedule] = await Promise.all([site.loadSheet(PUBLIC_SHEET, { force, optional: true }), site.loadSheet(BASE_TEACHERS, { force, optional: true }), site.loadSheet(SCHEDULE, { force, optional: true })]);
      state.publicRows = pub; state.teacherRows = teachers; state.scheduleRows = schedule;
      const published = publicCellsForDate();
      state.cells = published.length ? published : baseCells();
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
    $('#staff-date').addEventListener('change', () => { setDate($('#staff-date').value); load(true); });
    document.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => { setDate(b.dataset.date === 'tomorrow' ? nextSchoolIso(todayIso()) : todayIso()); load(true); }));
    $('#staff-search').addEventListener('input', (e) => { state.search = e.target.value; renderGrid(); });
    $('[data-only-changed]').addEventListener('change', (e) => { state.onlyChanged = e.target.checked; renderGrid(); });
    $('[data-mobile-only-changed]').addEventListener('change', renderMobile);
    $('[data-my-only]')?.addEventListener('click', showOnlyMine);
    $('[data-teacher-link]')?.addEventListener('click', async () => { const url = teacherLink(); try { await navigator.clipboard.writeText(url); setStatus('Персональная ссылка скопирована', 'ok'); } catch (_) { prompt('Скопируйте ссылку:', url); } });
    $('[data-refresh]').addEventListener('click', () => { load(true); window.SiteShell?.refreshFreshness(); });
    $('[data-print]').addEventListener('click', () => window.print());
    let markSeen = () => {};
    const seenReady = setupSeen();
    $('#teacher-select').addEventListener('change', (e) => { saveTeacher(e.target.value); renderMobile(); markSeen(e.target.value); });
    $('#staff-my-teacher')?.addEventListener('change', (e) => { saveTeacher(e.target.value); renderMobile(); markSeen(e.target.value); });
    await load(true);
    markSeen = await seenReady;
    const saved = new URLSearchParams(location.search).get('teacher') || site.storageGet(STORE_TEACHER);
    if (saved && state.teachers.includes(saved)) markSeen(saved);
    setInterval(() => { if (state.date === todayIso()) { renderGrid(); renderMobile(); } }, 60000);
  });
})();
