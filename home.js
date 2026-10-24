(() => {
  'use strict';

  // Home page: «Мой класс сегодня» — the remembered class with the current
  // lesson and the day's lessons, or a class picker when none is chosen.

  const site = window.SchoolSite;
  const core = window.ScheduleCore;
  const config = window.SCHOOL_CONFIG || {};
  if (!site || !core) return;

  const esc = site.escapeHtml;
  const STORE = 'school:selectedClass';
  const SHEET_SCHEDULE = config.googleSheets?.sheets?.schedule || 'Расписание';
  const SHEET_CHANGES = config.googleSheets?.sheets?.changes || 'Изменения';
  const box = document.querySelector('[data-home-my]');
  if (!box) return;

  let scheduleRows = [], changesRows = [], classes = [], picking = false, failed = false;

  function pickerMarkup(selected) {
    const groups = new Map();
    classes.forEach((c) => { const g = (String(c).match(/^\d+/) || ['—'])[0]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
    return `<div class="class-groups">${[...groups].map(([g, list]) => `<div class="class-group" role="group" aria-label="${esc(g)}-е классы"><span class="class-group__label">${esc(g)}</span>${list.map((c) => `<button class="chip" type="button" data-pick-class="${esc(c)}" aria-pressed="${String(c === selected)}">${esc(c)}</button>`).join('')}</div>`).join('')}</div>`;
  }

  function dayList(date, lessons, state) {
    if (!lessons.length) return '<div class="empty-state"><span>Уроков нет.</span></div>';
    const isToday = core.sameDay(date, state.today), now = core.nowMinutes();
    return `<ol class="mini-lessons">${lessons.map((x) => {
      const info = core.cellInfo(x);
      const past = isToday && state.moment.type !== 'off' && core.toMin(core.bellEnd(x.lesson)) <= now;
      const cls = [past ? 'is-past' : '', x.type === 'cancelled' ? 'is-cancelled' : ''].filter(Boolean).join(' ');
      const badge = x.type !== 'normal' ? ` <span class="badge ${core.BADGE_CLASS[x.type]}">${esc(info.badge)}</span>` : '';
      return `<li${cls ? ` class="${cls}"` : ''}><b>${x.lesson}</b><span class="tnum">${esc(core.bellStart(x.lesson))}</span><span>${esc(info.subject)}${badge}</span><span class="mini-room">${info.room ? `каб. ${esc(info.room)}` : ''}</span></li>`;
    }).join('')}</ol>`;
  }

  function render() {
    const saved = site.normalizeClass(site.storageGet(STORE));
    const selected = classes.includes(saved) ? saved : '';
    if (failed && !scheduleRows.length) {
      box.innerHTML = '<div class="empty-state"><strong>Не удалось загрузить расписание.</strong><span>Проверьте подключение к интернету.</span><a class="btn btn--ghost btn--sm" href="schedule.html">Открыть расписание</a></div>';
      return;
    }
    if (!selected || picking) {
      box.innerHTML = `<div class="my-class__head"><h2>${selected ? 'Сменить класс' : 'Выберите класс'}</h2>${selected ? '<button class="btn btn--quiet btn--sm" type="button" data-cancel-pick>Отмена</button>' : ''}</div><p class="lead">Класс запомнится на этом устройстве — в следующий раз здесь сразу будет его расписание на сегодня.</p>${pickerMarkup(selected)}`;
      return;
    }
    const state = core.todayFor(scheduleRows, changesRows, selected);
    const showDate = state.moment.type === 'off' || state.moment.type === 'after' || state.moment.type === 'none' ? site.nextSchoolDay(state.today) : state.today;
    const lessons = core.actualDay(scheduleRows, changesRows, showDate, selected);
    const changes = lessons.filter((x) => x.type !== 'normal').length;
    const dayTitle = core.sameDay(showDate, state.today) ? 'Сегодня' : core.sameDay(showDate, site.addUtcDays(state.today, 1)) ? 'Завтра' : core.fmtDay(showDate);
    box.innerHTML = `<div class="my-class__head"><h2>${esc(selected)} — ${esc(dayTitle.toLowerCase())}</h2><button class="btn btn--ghost btn--sm" type="button" data-change-class>Сменить класс</button></div>
      <div class="now-card">${core.nowCardMarkup(scheduleRows, changesRows, selected, state)}</div>
      ${changes ? `<div class="alert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><div><strong>${esc(dayTitle)}: ${changes} ${core.plural(changes, 'изменение', 'изменения', 'изменений')}</strong><a href="schedule.html?class=${encodeURIComponent(selected)}#changes">Посмотреть изменения →</a></div></div>` : ''}
      ${dayList(showDate, lessons, state)}
      <a class="btn btn--block" href="schedule.html?class=${encodeURIComponent(selected)}">Расписание ${esc(selected)} на неделю</a>`;
  }

  box.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick-class]');
    if (pick) { site.storageSet(STORE, pick.dataset.pickClass); picking = false; render(); return; }
    if (e.target.closest('[data-change-class]')) { picking = true; render(); return; }
    if (e.target.closest('[data-cancel-pick]')) { picking = false; render(); }
  });

  async function load() {
    classes = [...new Set((Array.isArray(config.classes) ? config.classes : []).map(site.normalizeClass).filter(Boolean))].sort(core.classCollator.compare);
    const [sr, cr] = await Promise.allSettled([site.loadSheet(SHEET_SCHEDULE), site.loadSheet(SHEET_CHANGES, { optional: true }), site.loadCalendar()]);
    failed = sr.status === 'rejected';
    if (!failed) { scheduleRows = sr.value; const derived = core.deriveClasses(scheduleRows); if (derived.length) classes = derived; }
    if (cr.status === 'fulfilled') changesRows = cr.value;
    render();
  }

  load();
  setInterval(() => { if (!picking) render(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
})();
