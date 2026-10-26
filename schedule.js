(() => {
  'use strict';

  const config = window.SCHOOL_CONFIG || {};
  const site = window.SchoolSite;
  const core = window.ScheduleCore;
  if (!site || !core) return;

  const esc = site.escapeHtml;
  const { classCollator, bellStart, bellEnd, bellRange } = core;
  const SHEET_SCHEDULE = config.googleSheets?.sheets?.schedule || 'Расписание';
  const SHEET_CHANGES = config.googleSheets?.sheets?.changes || 'Изменения';

  let selectedClass = '';
  let availableClasses = [...(Array.isArray(config.classes) ? config.classes : [])];
  let scheduleRows = null, changesRows = null, scheduleError = false, changesError = false;
  let selectedDay = null;

  const $ = (s) => document.querySelector(s);
  const fmtDate = core.fmtDay;
  const sameDay = core.sameDay;
  const cellInfo = core.cellInfo;
  const badgeClass = core.BADGE_CLASS;
  const changeCountLabel = (n) => `${n} ${core.plural(n, 'изменение', 'изменения', 'изменений')}`;
  const lessonsLabel = (n) => `${n} ${core.plural(n, 'урок', 'урока', 'уроков')}`;

  /* Tabs: основное расписание / изменения ------------------------- */

  function initViewTabs() {
    const buttons = [...document.querySelectorAll('[data-schedule-view]')], panels = [...document.querySelectorAll('[data-schedule-panel]')];
    if (!buttons.length || !panels.length) return;
    const activate = (view, hash = true) => {
      buttons.forEach((b) => { const on = b.dataset.scheduleView === view; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      panels.forEach((p) => { p.hidden = p.dataset.schedulePanel !== view; });
      document.querySelectorAll('[data-topnav]').forEach((a) => { const on = a.dataset.topnav === view; if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      if (hash) { try { history.replaceState(null, '', `${location.pathname}${location.search}${view === 'changes' ? '#changes' : '#schedule'}`); } catch (_) {} window.dispatchEvent(new HashChangeEvent('hashchange')); }
    };
    buttons.forEach((b) => b.addEventListener('click', () => activate(b.dataset.scheduleView)));
    buttons.forEach((b, i) => b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
      next.focus(); activate(next.dataset.scheduleView);
    }));
    activate(location.hash === '#changes' ? 'changes' : 'schedule', false);
    window.addEventListener('hashchange', (e) => {
      if (location.hash === '#bells') { const b = $('#bells'); if (b) { activate('schedule', false); b.open = true; b.scrollIntoView({ block: 'start' }); } return; }
      activate(location.hash === '#changes' ? 'changes' : 'schedule', false);
      // Bottom navigation «Изменения» on a phone: bring the tab into view.
      if (e.isTrusted && location.hash === '#changes') $('.tabs')?.scrollIntoView({ block: 'start' });
    });
    window.SchedulePage = { showChanges: () => activate('changes') };
  }

  /* Class picker --------------------------------------------------- */

  function gradeOf(cls) { const m = String(cls).match(/^\d+/); return m ? m[0] : '—'; }

  function renderClassPicker() {
    const box = $('[data-class-buttons]');
    if (!box) return;
    const groups = new Map();
    availableClasses.forEach((c) => { const g = gradeOf(c); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
    box.innerHTML = [...groups].map(([g, list]) => `<div class="class-group" role="group" aria-label="${esc(g)}-е классы"><span class="class-group__label">${esc(g)}</span>${list.map((c) => `<button class="chip" type="button" data-class-name="${esc(c)}" aria-pressed="${String(c === selectedClass)}">${esc(c)}</button>`).join('')}</div>`).join('');
  }

  function setCollapsed(collapsed) {
    const picker = $('[data-picker]'), toggle = $('[data-picker-toggle]');
    if (!picker) return;
    picker.dataset.collapsed = String(Boolean(collapsed && selectedClass));
    if (toggle) { toggle.setAttribute('aria-expanded', String(picker.dataset.collapsed !== 'true')); toggle.textContent = picker.dataset.collapsed === 'true' ? 'Сменить класс' : 'Свернуть'; toggle.hidden = !selectedClass; }
  }

  function setClass(className, { rerender = true } = {}) {
    const n = site.normalizeClass(className);
    selectedClass = availableClasses.includes(n) ? n : '';
    selectedDay = null;
    document.querySelectorAll('[data-class-name]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.className === selectedClass)));
    document.querySelectorAll('[data-selected-class-label]').forEach((el) => { el.innerHTML = selectedClass ? `Выбран <b>${esc(selectedClass)}</b>` : 'Класс не выбран'; });
    const title = $('[data-page-title]'); if (title) title.textContent = selectedClass ? `Расписание ${selectedClass}` : 'Расписание';
    document.title = `${selectedClass ? `${selectedClass} — ` : ''}Расписание — МОУ СОШ № 20`;
    const clear = $('[data-clear-class]'); if (clear) clear.hidden = !selectedClass;
    const share = $('[data-share]'); if (share) share.hidden = !selectedClass;
    if (selectedClass) site.storageSet('school:selectedClass', selectedClass); else site.storageRemove('school:selectedClass');
    const p = new URLSearchParams(location.search);
    if (selectedClass) p.set('class', selectedClass); else p.delete('class');
    p.delete('v');
    try { history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}${location.hash}`); } catch (_) {}
    if (rerender) renderAll();
  }

  function initClassPicker() {
    availableClasses = [...new Set(availableClasses.map(site.normalizeClass).filter(Boolean))].sort(classCollator.compare);
    const q = site.normalizeClass(new URLSearchParams(location.search).get('class')), saved = site.normalizeClass(site.storageGet('school:selectedClass'));
    selectedClass = [q, saved].find((x) => availableClasses.includes(x)) || '';
    renderClassPicker();
    setClass(selectedClass, { rerender: false });
    setCollapsed(true);
    $('[data-class-buttons]')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-class-name]');
      if (!b) return;
      setClass(b.dataset.className);
      setCollapsed(true);
    });
    $('[data-picker-toggle]')?.addEventListener('click', () => setCollapsed($('[data-picker]').dataset.collapsed !== 'true'));
    $('[data-clear-class]')?.addEventListener('click', () => { setClass(''); setCollapsed(false); });
  }

  function applyDerivedClasses(rows) {
    const derived = core.deriveClasses(rows);
    if (!derived.length) return;
    const previous = selectedClass;
    availableClasses = derived;
    renderClassPicker();
    setClass(previous && availableClasses.includes(previous) ? previous : '', { rerender: false });
    setCollapsed(true);
  }

  /* Lesson presentation ------------------------------------------- */

  function todayState() { return core.todayFor(scheduleRows, changesRows, selectedClass); }

  function lessonTiming(date, lesson, state) {
    if (!sameDay(date, state.today) || state.moment.type === 'off') return '';
    const m = state.moment;
    if (m.type === 'lesson' && m.current.lesson === lesson) return 'now';
    if (m.type === 'after') return 'past';
    if (m.type === 'lesson' || m.type === 'break') return core.toMin(bellEnd(lesson, date)) <= core.nowMinutes() ? 'past' : '';
    return '';
  }

  /* Week model ------------------------------------------------------ */

  function weekModel(state) {
    const cols = core.dayColumns(scheduleRows);
    const win = site.schoolChangeWindow();
    const anchor = win.first;
    const monday = site.addUtcDays(anchor, -((anchor.getUTCDay() + 6) % 7));
    const days = cols.map((c) => {
      const date = site.addUtcDays(monday, core.DAY_ORDER.indexOf(c.code));
      const holiday = site.holidayFor(date);
      const lessons = holiday ? [] : core.actualDay(scheduleRows, changesRows, date, selectedClass);
      return { code: c.code, date, holiday, lessons, isToday: sameDay(date, state.today), changes: lessons.filter((x) => x.type !== 'normal').length };
    });
    const numbers = [...new Set(days.flatMap((d) => d.lessons.map((x) => x.lesson)))].sort((a, b) => a - b);
    return { days, numbers, monday };
  }

  function weekRange(first, last) {
    if (!first || !last) return '';
    const a = site.formatSchoolDate(first, { year: false }), b = site.formatSchoolDate(last, { year: false });
    return first.getUTCMonth() === last.getUTCMonth() ? `${first.getUTCDate()}–${b}` : `${a} – ${b}`;
  }

  function weekMarkup(model, state) {
    const { days, numbers } = model;
    const range = weekRange(days[0]?.date, days[days.length - 1]?.date);
    const head = `<div class="week__row" role="row"><span class="week__time" role="columnheader"><span>Урок</span></span>${days.map((d) => `<span class="week__head${d.isToday ? ' is-today' : ''}" role="columnheader"><b>${esc(core.DAY_NAMES[d.code] || d.code)}</b><span>${esc(site.formatSchoolDate(d.date, { year: false, shortMonth: true }))}${d.isToday ? ' · сегодня' : ''}</span></span>`).join('')}</div>`;
    const rows = numbers.map((n) => `<div class="week__row" role="row"><span class="week__time" role="rowheader"><b>${n}</b><span>${esc(bellRange(n))}</span></span>${days.map((d) => {
      if (d.holiday) return `<span class="cell cell--holiday" role="cell"><span class="cell__subject">${n === numbers[0] ? esc(d.holiday.title) : ''}</span></span>`;
      const x = d.lessons.find((l) => l.lesson === n);
      if (!x) return '<span class="cell cell--empty" role="cell"><span class="cell__subject">—</span></span>';
      const info = cellInfo(x), timing = lessonTiming(d.date, n, state);
      const kind = x.type !== 'normal' ? x.type : timing === 'now' ? 'now' : timing === 'past' ? 'past' : d.isToday ? 'today' : '';
      const nowBadge = timing === 'now' ? '<span class="badge badge--now">Сейчас</span>' : '';
      return `<span class="cell${kind ? ` cell--${kind}` : ''}${timing === 'now' && kind !== 'now' ? ' cell--now' : ''}" role="cell">${nowBadge}${info.badge ? `<span class="badge ${badgeClass[x.type]}">${esc(info.badge)}</span>` : ''}<span class="cell__subject">${esc(info.subject)}</span>${info.old ? `<span class="cell__old">${esc(info.old)}</span>` : ''}${info.room ? `<span class="cell__room">каб. ${esc(info.room)}</span>` : ''}</span>`;
    }).join('')}</div>`).join('');
    return `<div class="week card" style="--days:${days.length}">
      <div class="section-head" style="margin-bottom:14px"><h2>Неделя ${esc(range)}</h2>
        <ul class="legend" aria-label="Обозначения"><li class="badge badge--now">Сейчас</li><li class="badge badge--changed">Замена</li><li class="badge badge--room">Другой кабинет</li><li class="badge badge--cancelled">Отменён</li><li class="badge badge--added">Добавлен</li></ul></div>
      <div class="week__scroll"><div class="week__grid" role="table" aria-label="Уроки ${esc(selectedClass)} по дням">${head}${rows || `<div class="empty-state"><strong>Для ${esc(selectedClass)} уроки не найдены.</strong></div>`}</div></div>
    </div>`;
  }

  function daysMarkup(model, state) {
    const { days } = model;
    if (!days.length) return '';
    let index = selectedDay;
    if (index === null || index >= days.length) {
      const win = site.schoolChangeWindow();
      index = Math.max(0, days.findIndex((d) => sameDay(d.date, win.first)));
    }
    const d = days[index];
    const tabs = days.map((x, i) => `<button class="day-tab${i === index ? ' is-active' : ''}${x.isToday ? ' is-today' : ''}" type="button" role="tab" aria-selected="${String(i === index)}" data-day-index="${i}" aria-label="${esc(fmtDate(x.date))}${x.isToday ? ', сегодня' : ''}"><b>${esc(x.code)}</b><span>${x.date.getUTCDate()}</span></button>`).join('');
    let body;
    if (d.holiday) body = `<div class="empty-state"><strong>${esc(d.holiday.title)}</strong><span>Уроков нет.</span></div>`;
    else if (!d.lessons.length) body = '<div class="empty-state"><strong>Уроков нет.</strong></div>';
    else body = `<ol class="lessons" aria-label="Уроки">${d.lessons.map((x) => {
      const info = cellInfo(x), timing = lessonTiming(d.date, x.lesson, state);
      const kind = x.type !== 'normal' ? x.type : timing;
      const meta = [bellRange(x.lesson, d.date), timing === 'now' && state.moment.remaining ? `осталось ${state.moment.remaining} мин` : timing === 'past' ? 'прошёл' : '', info.note].filter(Boolean).join(' · ');
      return `<li class="lesson${kind ? ` lesson--${kind}` : ''}${timing === 'now' && kind !== 'now' ? ' lesson--now' : ''}"><div class="lesson__no"><b>${x.lesson}</b><span>${esc(bellStart(x.lesson, d.date))}</span></div><div class="lesson__main">${timing === 'now' ? '<span class="badge badge--now">Идёт сейчас</span>' : ''}${info.badge ? `<span class="badge ${badgeClass[x.type]}">${esc(info.badge)}</span>` : ''}<span class="lesson__subject">${esc(info.subject)}</span>${info.old ? `<span class="lesson__meta">${esc(info.old)}</span>` : ''}<span class="lesson__meta">${esc(meta)}</span></div>${info.room ? `<span class="lesson__room">каб. ${esc(info.room)}</span>` : ''}</li>`;
    }).join('')}</ol>`;
    const real = d.lessons.filter((x) => x.type !== 'cancelled');
    const summary = real.length ? `${lessonsLabel(real.length)} · ${bellStart(real[0].lesson, d.date)}–${bellEnd(real[real.length - 1].lesson, d.date)}${d.changes ? ` · ${changeCountLabel(d.changes)}` : ''}` : '';
    return `<div class="days"><div class="day-tabs" role="tablist" aria-label="День недели" style="--days:${days.length}">${tabs}</div><div class="day-head"><h3>${esc(fmtDate(d.date))}</h3><span>${esc(summary)}</span></div>${d.holiday ? '' : boundsMarkup(d.lessons, d.date)}${body}</div>`;
  }

  function renderSchedule(state) {
    const target = $('[data-schedule-output]');
    if (!target) return;
    if (!selectedClass) { target.innerHTML = '<div class="empty-state empty-state--large"><strong>Выберите класс.</strong><span>Расписание появится здесь и сохранится для следующих посещений.</span></div>'; return; }
    if (scheduleError && (!scheduleRows || !scheduleRows.length)) { target.innerHTML = '<div class="empty-state empty-state--large"><strong>Не удалось загрузить расписание.</strong><span>Проверьте подключение и нажмите «Обновить».</span></div>'; return; }
    const { data, headers } = core.scheduleParts(scheduleRows), { classIndex } = core.mapScheduleColumns(headers);
    if (!data.some((r) => site.normalizeClass(r[classIndex]) === selectedClass)) { target.innerHTML = `<div class="empty-state empty-state--large"><strong>Для ${esc(selectedClass)} расписание не найдено.</strong><span>Проверьте написание класса в Google Таблице.</span></div>`; return; }
    const model = weekModel(state);
    target.innerHTML = weekMarkup(model, state) + daysMarkup(model, state);
  }

  /* «Сейчас» и сводка изменений ----------------------------------- */

  function renderNow(state) {
    const box = $('[data-now-card]');
    if (!box) return;
    if (!selectedClass || !scheduleRows || !scheduleRows.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.className = 'now-card';
    box.innerHTML = core.nowCardMarkup(scheduleRows, changesRows, selectedClass, state);
    box.hidden = false;
  }

  function renderAlert() {
    const box = $('[data-today-alert]'), count = $('[data-changes-count]');
    const win = site.schoolChangeWindow();
    const first = changesRows ? core.changeRowsFor(changesRows, win.first, selectedClass).length : 0;
    const second = changesRows ? core.changeRowsFor(changesRows, win.second, selectedClass).length : 0;
    if (count) { count.textContent = String(first + second); count.hidden = !(first + second); }
    if (!box) return;
    if (!selectedClass || !(first + second)) { box.hidden = true; box.innerHTML = ''; return; }
    const tomorrow = sameDay(win.second, site.addUtcDays(win.first, 1));
    const parts = [first ? `${win.firstIsToday ? 'сегодня' : fmtDate(win.first).toLowerCase()} — ${changeCountLabel(first)}` : '', second ? `${tomorrow && win.firstIsToday ? 'завтра' : fmtDate(win.second).toLowerCase()} — ${changeCountLabel(second)}` : ''].filter(Boolean);
    box.className = 'alert';
    box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><div><strong>Есть изменения в ${esc(selectedClass)}</strong><p>${esc(site.capitalize(parts.join(', ')))}.</p><a href="#changes" data-open-changes>Посмотреть изменения →</a></div>`;
    box.hidden = false;
    box.querySelector('[data-open-changes]')?.addEventListener('click', (e) => { e.preventDefault(); window.SchedulePage?.showChanges(); $('#changes-panel')?.scrollIntoView({ block: 'start' }); });
  }

  function renderBells(state) {
    const box = $('[data-bells]');
    if (!box) return;
    const list = core.bells(state.today), short = core.bellVariant(state.today) !== core.BELL_BASE;
    const column = (title, from, to) => `<div class="bell-column"><h3>${title}</h3>${list.slice(from, to).map((b, i) => { const n = from + i + 1; return `<div class="bell-row" data-bell="${n}"><span>${from ? `${i + 1} урок <em>(${n})</em>` : `${n} урок`}</span><strong>${b[0]}–${b[1]}</strong></div>`; }).join('')}</div>`;
    box.innerHTML = `${short ? '<p class="bells__note">Сегодня сокращённые уроки</p>' : ''}${column('1 смена', 0, 6)}${column('2 смена', 6, 12)}`;
  }

  function highlightBells(state) {
    const bell = site.isSchoolDay(state.today) ? core.bellMoment() : { type: 'off' };
    document.querySelectorAll('[data-bell]').forEach((el) => el.classList.toggle('is-now', bell.type === 'lesson' && Number(el.dataset.bell) === bell.lesson));
  }

  /* Изменения (two school days) ----------------------------------- */

  function lessonOldText(base) { return core.lessonText(base); }
  function lessonNewText(next) { return core.lessonText(next); }
  function typeLabel(type) { return ({ cancelled: 'ОТМЕНЕНО', changed: 'ИЗМЕНЕНО', room: 'НОВЫЙ КАБИНЕТ', added: 'ДОБАВЛЕНО' })[type] || ''; }

  function lessonMarkup(x, isNow, date) {
    const time = bellRange(x.lesson, date), cancel = x.type === 'cancelled', next = x.newLesson || x.base || {}, base = x.base;
    const title = cancel ? 'Урок отменён' : next.subject || x.change || 'Урок';
    const meta = `<span class="student-lesson__time">${esc(time)}</span>${!cancel && next.room ? `<span class="student-lesson__room">Кабинет ${esc(next.room)}</span>` : ''}`;
    let detail = '';
    if (cancel && base) detail = `<span class="student-lesson__previous">${esc(base.subject || '')}${base.room ? ' · каб. ' + esc(base.room) : ''}</span>`;
    else if (x.type === 'room') detail = `<span class="student-room-change">Был кабинет ${esc(base?.room || '—')}</span>`;
    else if (x.type !== 'normal' && base) detail = `<span class="student-lesson__previous">Было: ${esc(lessonOldText(base))}</span>`;
    const label = x.type === 'room' ? 'Новый кабинет' : x.type === 'changed' ? 'Изменён' : x.type === 'added' ? 'Новый урок' : x.type === 'cancelled' ? 'Отменён' : '';
    return `<div class="student-lesson ${x.type}${isNow ? ' is-now' : ''}" data-lesson="${x.lesson}"><div class="student-lesson__number">${x.lesson}</div><div class="student-lesson__body">${isNow ? '<span class="student-lesson__badge badge--now">Идёт сейчас</span>' : ''}<strong>${esc(title)}</strong><div class="student-lesson__meta">${meta}</div>${detail}${x.note ? `<small>${esc(x.note)}</small>` : ''}${label ? `<span class="student-lesson__badge">${label}</span>` : ''}</div></div>`;
  }

  // «Приходить к 08:50 — к 2-му уроку (обычно к 08:00)» and «Сокращённые уроки» for one day of the class.
  function boundsMarkup(lessons, date) {
    const lines = core.boundsLines(core.dayBounds(lessons, date)), short = core.bellVariant(date) !== core.BELL_BASE;
    if (!lines.length && !short) return '';
    return `<div class="day-bounds" role="note">${short ? '<b>Сокращённые уроки</b>' : ''}${lines.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
  }

  function summaryMarkup(rows) {
    const changed = rows.filter((x) => x.type !== 'normal'), counts = { cancelled: 0, changed: 0, room: 0, added: 0 };
    changed.forEach((x) => { counts[x.type] = (counts[x.type] || 0) + 1; });
    if (!changed.length) return '<span class="student-change-pill is-ok">Без изменений</span>';
    return `<span class="student-change-pill">${changeCountLabel(changed.length)}</span>${counts.cancelled ? `<span class="student-change-pill cancelled">отмен ${counts.cancelled}</span>` : ''}${counts.changed ? `<span class="student-change-pill changed">замен ${counts.changed}</span>` : ''}${counts.room ? `<span class="student-change-pill room">кабинетов ${counts.room}</span>` : ''}${counts.added ? `<span class="student-change-pill added">добавлено ${counts.added}</span>` : ''}`;
  }

  function renderSelectedClassDay(label, date, state) {
    const rows = core.actualDay(scheduleRows, changesRows, date, selectedClass), title = fmtDate(date);
    const nowLesson = sameDay(date, state.today) && state.moment.type === 'lesson' ? state.moment.current.lesson : 0;
    return `<section class="student-day-card"><header class="student-day-card__head"><div><span class="section-kicker">${esc(label)} · ${esc(selectedClass)}</span><h3>${esc(title)}</h3></div><div class="student-change-summary">${summaryMarkup(rows)}</div></header>${boundsMarkup(rows, date)}<div class="student-day-lessons">${rows.length ? rows.map((x) => lessonMarkup(x, x.lesson === nowLesson, date)).join('') : '<div class="empty-state"><strong>Уроков нет.</strong><span>На этот день расписание не найдено.</span></div>'}</div></section>`;
  }

  function renderAllClassesDay(label, date) {
    const rows = core.changeRowsFor(changesRows, date), title = fmtDate(date);
    if (!rows.length) return `<section class="student-day-card"><header class="student-day-card__head"><div><span class="section-kicker">${esc(label)}</span><h3>${esc(title)}</h3></div><span class="status status--ok">Без изменений</span></header><div class="student-day-lessons"><div class="empty-state"><strong>Изменений нет.</strong><span>Все классы занимаются по основному расписанию.</span></div></div></section>`;
    const grouped = new Map();
    rows.forEach((r) => { if (!grouped.has(r.className)) grouped.set(r.className, []); grouped.get(r.className).push(r); });
    return `<section class="student-day-card"><header class="student-day-card__head"><div><span class="section-kicker">${esc(label)}</span><h3>${esc(title)}</h3></div><span class="status">${changeCountLabel(rows.length)}</span></header><div class="all-change-groups">${[...grouped].map(([cls, list]) => `<article class="class-change-card"><div class="class-change-card__head"><strong>${esc(cls)}</strong><span class="student-change-pill">${changeCountLabel(list.length)}</span></div><div class="class-change-list">${list.map((ch) => {
      const b = core.baseLessonsFor(scheduleRows, date, cls).get(ch.lesson), x = core.classifyChange(b, ch);
      return `<div class="class-change-row"><span class="class-change-row__lesson">${x.lesson} урок</span><div>${x.type === 'cancelled' ? `<b>Урок отменён</b><span class="student-lesson__previous">${esc(lessonOldText(b) || 'Урок')}</span>` : x.type === 'room' ? `<b>${esc(x.newLesson?.subject || b?.subject || '')}</b><span class="student-room-change">каб. ${esc(b?.room || '—')} → ${esc(x.newLesson?.room || '—')}</span>` : `${b ? `<span class="student-lesson__previous">Было: ${esc(lessonOldText(b))}</span>` : ''}<b>${esc(lessonNewText(x.newLesson) || ch.change)}</b>`}${ch.note ? `<small>${esc(ch.note)}</small>` : ''}</div><span class="student-lesson__badge ${x.type}">${typeLabel(x.type)}</span></div>`;
    }).join('')}</div></article>`).join('')}</div></section>`;
  }

  function renderChanges(state) {
    const target = $('[data-changes-output]');
    if (!target) return;
    if (changesError && (!changesRows || !changesRows.length)) { target.innerHTML = '<div class="empty-state empty-state--large"><strong>Не удалось проверить изменения.</strong><span>Основное расписание доступно на соседней вкладке. Повторите загрузку кнопкой «Обновить».</span></div>'; return; }
    const w = site.schoolChangeWindow();
    const firstLabel = w.firstIsToday ? 'Сегодня' : 'Ближайший учебный день', secondLabel = 'Следующий учебный день';
    target.innerHTML = `<div class="change-context"><span>${selectedClass ? `Показано <strong>актуальное расписание ${esc(selectedClass)}</strong> с уже внесёнными изменениями.` : 'Изменения сгруппированы по классам. Выберите класс выше — увидите готовое актуальное расписание дня.'}</span><span>Выходные и каникулы пропускаются автоматически.</span></div><div class="change-days">${selectedClass ? renderSelectedClassDay(firstLabel, w.first, state) + renderSelectedClassDay(secondLabel, w.second, state) : renderAllClassesDay(firstLabel, w.first) + renderAllClassesDay(secondLabel, w.second)}</div>`;
  }

  /* Data ----------------------------------------------------------- */

  function statusText(failed) {
    const metas = [site.getSheetMeta(SHEET_SCHEDULE), site.getSheetMeta(SHEET_CHANGES)].filter(Boolean), stale = metas.find((m) => m.stale);
    if (stale) return `Сохранённая версия: ${site.formatCacheTime(stale.savedAt)}`;
    if (failed) return 'Часть данных недоступна';
    const latest = Math.max(0, ...metas.map((m) => m.savedAt || 0));
    return latest ? `Обновлено: ${site.formatCacheTime(latest)}` : 'Данные загружены';
  }

  async function loadData({ force = false, quiet = false } = {}) {
    const s = $('[data-schedule-output]'), c = $('[data-changes-output]');
    if (!quiet) {
      if (s) s.innerHTML = '<div class="loading-state"><strong>Загружаем расписание</strong><span>Получаем данные из школьной таблицы.</span></div>';
      if (c) c.innerHTML = '<div class="loading-state"><strong>Проверяем изменения</strong><span>Формируем актуальное расписание.</span></div>';
    }
    const [sr, cr] = await Promise.allSettled([site.loadSheet(SHEET_SCHEDULE, { force }), site.loadSheet(SHEET_CHANGES, { force }), site.loadCalendar({ force }), core.loadBells({ force })]);
    scheduleError = sr.status === 'rejected'; changesError = cr.status === 'rejected';
    scheduleRows = scheduleError ? (scheduleRows || []) : sr.value;
    changesRows = changesError ? (changesRows || []) : cr.value;
    if (!scheduleError) applyDerivedClasses(scheduleRows);
    renderAll();
    const st = $('[data-sync-status]');
    if (st) { const failed = scheduleError || changesError; st.textContent = statusText(failed); st.classList.toggle('has-error', failed); }
  }

  function renderAll() {
    const state = todayState();
    renderNow(state);
    renderAlert();
    renderSchedule(state);
    renderChanges(state);
    renderBells(state);
    highlightBells(state);
  }

  function initActions() {
    const refresh = $('[data-refresh]');
    refresh?.addEventListener('click', async () => {
      refresh.disabled = true; refresh.classList.add('is-loading');
      try { await loadData({ force: true }); window.SiteShell?.refreshFreshness(); } finally { refresh.disabled = false; refresh.classList.remove('is-loading'); }
    });
    $('[data-print]')?.addEventListener('click', () => window.print());
    const share = $('[data-share]');
    share?.addEventListener('click', async () => {
      if (!selectedClass) return;
      const url = `${location.origin}${location.pathname}?class=${encodeURIComponent(selectedClass)}`;
      const label = share.querySelector('span');
      try {
        if (navigator.share) await navigator.share({ title: `Расписание ${selectedClass} — МОУ СОШ № 20`, url });
        else { await navigator.clipboard.writeText(url); if (label) { label.textContent = 'Ссылка скопирована'; setTimeout(() => { label.textContent = 'Ссылка на класс'; }, 2000); } }
      } catch (_) { /* пользователь закрыл окно «Поделиться» */ }
    });
    $('[data-schedule-output]')?.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-day-index]');
      if (!tab) return;
      selectedDay = Number(tab.dataset.dayIndex);
      renderSchedule(todayState());
      $(`[data-day-index="${selectedDay}"]`)?.focus();
    });
    setInterval(renderAll, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && scheduleRows) loadData({ quiet: true }); });
  }

  window.ScheduleUtils = Object.freeze({
    nextSchoolDay: site.nextSchoolDay,
    schoolChangeWindow: (d) => { const w = site.schoolChangeWindow(d); return { ...w, firstLabel: w.firstIsToday ? 'Сегодня' : 'Ближайший учебный день', secondLabel: 'Следующий учебный день' }; },
    normalizeDateValue: core.normalizeDateValue,
    dateKey: site.dateKey
  });

  document.addEventListener('DOMContentLoaded', () => {
    initViewTabs();
    initClassPicker();
    initActions();
    loadData().then(() => {
      if (location.hash === '#changes' && window.matchMedia('(max-width: 979px)').matches) $('.tabs')?.scrollIntoView({ block: 'start' });
    });
    if (location.hash === '#bells') { const b = $('#bells'); if (b) { b.open = true; setTimeout(() => b.scrollIntoView({ block: 'start' }), 300); } }
  });
})();
