// ТВ для учеников: табло одной параллели — строки классы, столбцы уроки, которые
// ещё будут сегодня. Параллели сменяются каждые 15 секунд; ?parallel=9 закрепляет
// одну параллель за экраном (10 и 11 классы показываются вместе). После параллелей —
// слайд «Пунктуальность»: рейтинг классов по опозданиям (lateness-core.js).
// Слайд «Сегодня» (tv-today.js, 20 с): на переменах — один раз за круг, в остальное время
// (уроки, до 1-го урока, после 14:00) — через раз; когда уроков нет — он один. На экране,
// закреплённом за параллелью (?parallel=N), его нет. ?slide=today — только он
// (с &time=11:30 и &date=2026-11-23 — превью любого момента).
(() => {
  'use strict';
  const site = window.SchoolSite, core = window.ScheduleCore, tv = window.TvCore, late = window.LatenessCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !core || !tv) return;

  const PERIOD = 15000, MAX_COLS = 10;
  const SHEETS = ['Расписание', 'Изменения'];
  const esc = site.escapeHtml;
  const board = document.getElementById('board');
  const rawLock = new URLSearchParams(location.search).get('parallel');
  const asked = rawLock === '10' || rawLock === '11' ? '10-11' : rawLock || '';
  let lock = '';

  const LATE_KEY = 'late';
  const TODAY_KEY = 'today';
  const onlyToday = new URLSearchParams(location.search).get('slide') === 'today';
  const todaySlide = window.TvToday && !asked ? window.TvToday.create({ audience: 'students' }) : null;
  const isToday = (key) => String(key || '').startsWith(TODAY_KEY);
  let scheduleRows = [], changesRows = [], markRows = [], shiftRows = [], loaded = false, failed = false, view = null, lastKey = '';
  const rotation = tv.createRotation({ size: 1, period: PERIOD, onTurn: () => show(true), periodOf: (keys) => (isToday(keys[0]) ? todaySlide.period : PERIOD) });

  const gradeLabel = (key) => (key === '10-11' ? '10–11' : key === LATE_KEY ? 'Рейтинг' : isToday(key) ? 'Сегодня' : key);

  // Where the «Сегодня» slide goes among the boards: once per round on a break, otherwise
  // after every board; alone when there is no board. Keys stay unique for the rotation.
  function withToday(base, s, m) {
    if (!todaySlide || !todaySlide.available(m)) return base;
    if (onlyToday || !base.length) return [`${TODAY_KEY}:0`];
    if (s.type === 'break') return [...base, `${TODAY_KEY}:0`];
    return base.flatMap((key, i) => [key, `${TODAY_KEY}:${i}`]);
  }

  // Parallels from the class list in config.js (or the schedule itself): 5, 6, … 10–11.
  function parallels() {
    const listed = Array.isArray(config.classes) && config.classes.length ? config.classes : core.deriveClasses(scheduleRows);
    const map = new Map();
    listed.map(site.normalizeClass).filter(Boolean).forEach((cls) => {
      const grade = cls.match(/^(\d{1,2})/)?.[1];
      if (!grade) return;
      const key = grade === '10' || grade === '11' ? '10-11' : grade;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(cls);
    });
    return [...map.entries()]
      .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
      .map(([key, classes]) => ({ key, classes: classes.sort(core.classCollator.compare) }));
  }

  function isReal(x) {
    if (x.type === 'cancelled') return false;
    const n = x.newLesson || x.base;
    return Boolean(String(n?.subject || '').trim() || String(n?.room || '').trim());
  }

  // One parallel right now: the classes that still have lessons and the lesson
  // numbers left today. The number of columns is capped, so nothing is cut off.
  function snapshot(group, m, s) {
    const rows = group.classes
      .map((cls) => ({ cls, lessons: core.actualDay(scheduleRows, changesRows, m.date, cls).filter((x) => tv.lessonVisible(x.lesson, s, m)) }))
      .filter((r) => r.lessons.some(isReal));
    const cols = [...new Set(rows.flatMap((r) => r.lessons.map((x) => x.lesson)))].sort((a, b) => a - b).slice(0, MAX_COLS);
    return { key: group.key, rows, cols };
  }

  function rebuild(m = tv.moment(), s = tv.bellState(m)) {
    const all = parallels();
    lock = all.some((g) => g.key === asked) ? asked : ''; // an unknown ?parallel= is ignored
    const groups = all.filter((g) => !lock || g.key === lock);
    const snaps = groups.map((g) => snapshot(g, m, s)).filter((x) => x.rows.length);
    const rating = lock ? null : lateBoard(all.flatMap((g) => g.classes), m);
    const base = snaps.map((x) => x.key).concat(rating ? [LATE_KEY] : []);
    view = { m, s, rating, base, snaps: new Map(snaps.map((x) => [x.key, x])), keys: withToday(base, s, m) };
    rotation.setKeys(view.keys);
  }

  // The punctuality rating of now, or null (no marks yet, a screen locked to a parallel).
  function lateBoard(classes, m) {
    if (!late || !markRows.length) return null;
    try {
      const closeAfter = {};
      [1, 2].forEach((shift) => {
        const n = late.firstLesson(scheduleRows, changesRows, m.date, classes, shift);
        const end = n && core.bellEnd(n, m.date);
        if (end) closeAfter[shift] = core.toMin(end);
      });
      return late.board(late.parse(markRows, shiftRows), classes, { today: m.date, minutes: m.minutes, closeAfter });
    } catch (_) {
      return null;
    }
  }

  /* Markup ---------------------------------------------------------- */

  // «109/Мастерские» → «Мастерские»: a named room is what children look for.
  function roomHtml(room) {
    const parts = String(room || '').split('/').map((x) => x.trim()).filter(Boolean);
    const named = parts.find((x) => /[А-Яа-яЁё]{4,}/.test(x));
    const r = named || parts.join('/');
    if (!r) return '';
    if (r.length > 7) return `<span class="pb-room is-word"><b data-fit="18">${esc(r)}</b></span>`;
    return `<span class="pb-room"><small>каб.</small><b data-fit="16">${esc(r)}</b></span>`;
  }

  function headCell(n, s, nextCol, date) {
    const time = `<small data-fit="14">${esc(core.bellRange(n, date))}</small>`;
    if (s.type === 'lesson' && s.lesson === n) return `<span class="pb-h is-now"><span><b>${n}</b><em class="tv-pill">сейчас</em></span>${time}</span>`;
    if (n === nextCol) return `<span class="pb-h is-next"><span><b>${n}</b><em class="tv-pill">${s.type === 'before' ? 'первым' : 'далее'}</em></span>${time}</span>`;
    return `<span class="pb-h"><span><b>${n}</b></span>${time}</span>`;
  }

  function cell(x, n, s, nextCol) {
    const marks = `${s.type === 'lesson' && s.lesson === n ? ' is-now' : ''}${n === nextCol ? ' is-next' : ''}`;
    if (!x) return `<div class="pb-c k-empty${marks}"></div>`;
    const info = core.cellInfo(x);
    const subject = esc(tv.shortSubject(info.subject));
    if (info.kind === 'cancelled') return `<div class="pb-c k-cancelled${marks}"><span class="pb-tag"><em>Отменён</em></span><s class="pb-subj" data-fit="20">${subject || 'Урок'}</s><span class="pb-note">урока не будет</span></div>`;
    let tag = '';
    if (info.kind === 'room') tag = `<span class="pb-tag"><em>Кабинет</em>${x.base?.room ? `<s>${esc(x.base.room)}</s>` : ''}</span>`;
    else if (info.kind === 'merged') tag = `<span class="pb-tag"><em>Весь класс</em><s>${esc(x.base.room)}</s></span>`;
    else if (info.kind === 'changed') tag = `<span class="pb-tag"><em>Замена</em>${x.base?.subject ? `<s>${esc(tv.shortSubject(x.base.subject))}</s>` : ''}</span>`;
    else if (info.kind === 'added') tag = '<span class="pb-tag"><em>Добавлен</em></span>';
    return `<div class="pb-c k-${info.kind}${marks}">${tag}<strong class="pb-subj" data-fit="20">${subject}</strong>${roomHtml(info.room)}</div>`;
  }

  const dayMonth = (d) => site.formatSchoolDate(d, { year: false });
  function weekLabel(r) {
    if (r.from.getTime() === r.to.getTime()) return dayMonth(r.from);
    const a = dayMonth(r.from).split(' '), b = dayMonth(r.to).split(' ');
    return a[1] === b[1] ? `${a[0]}–${b[0]} ${b[1]}` : `${dayMonth(r.from)} – ${dayMonth(r.to)}`;
  }
  const lateWord = (n) => core.plural(n, 'опоздание', 'опоздания', 'опозданий');
  const dayWord = (n) => core.plural(n, 'день', 'дня', 'дней');

  // Two columns of classes, fewest late first; the right column: the week's total and its heroes.
  function ratingHtml(r) {
    const half = Math.ceil(r.rows.length / 2);
    const row = (x) => {
      const width = r.max ? Math.max(x.count ? 4 : 0, Math.round((x.count / r.max) * 100)) : 0;
      const hot = x.count >= 3 && x.count >= r.max * 0.6;
      const streak = x.streak >= 3 ? `<span class="lr-streak">${x.streak} ${dayWord(x.streak)}</span>` : '<span></span>';
      return `<div class="lr-row${x.count ? '' : ' is-zero'}${hot ? ' is-hot' : ''}" data-class="${esc(x.cls)}"><span class="lr-place">${x.place}</span><span class="lr-class">${esc(x.cls)}</span><span class="lr-bar"><i style="width:${width}%"></i></span><b class="lr-count">${x.count}</b>${streak}</div>`;
    };
    const cols = [r.rows.slice(0, half), r.rows.slice(half)].map((list) => `<div class="lr-col" style="--rows:${half}">${list.map(row).join('')}</div>`).join('');
    const title = r.mode === 'results' ? 'Итоги недели' : 'Неделя на сегодня';
    const hero = r.perfect.length
      ? `<section class="lr-hero is-win"><strong data-fit="36">${esc(r.perfect.join(', '))} — 0</strong><span>Неделя без опозданий!</span><small>Пример организованности и пунктуальности</small></section>`
      : `<section class="lr-hero"><span>${r.mode === 'results' ? 'За неделю' : 'С понедельника'}</span><strong>${r.total}</strong><small>${lateWord(r.total)} в 5–11 классах</small></section>`;
    const side = r.streaks.length
      ? `<section class="lr-side"><h3>Без опозданий подряд</h3>${r.streaks.map((x) => `<p><b>${esc(x.cls)}</b><span>${x.streak} ${dayWord(x.streak)}</span></p>`).join('')}</section>`
      : '<section class="lr-side lr-motto"><h3>Пунктуальность —</h3><p>признак ответственности!</p></section>';
    return `<section class="lr"><div class="tv-card lr-card"><div class="lr-head"><b>${title}</b><span>${esc(weekLabel(r))}</span><em>меньше — лучше</em></div><div class="lr-cols">${cols}</div></div><aside class="lr-aside">${hero}${side}</aside></section>`;
  }

  function emptyHtml(m, s) {
    const next = site.capitalize(tv.dayLabel(site.nextSchoolDay(m.date)));
    if (s.type === 'off') return `<section class="tv-empty"><h2>Сегодня выходной</h2><p>Следующий учебный день — ${esc(next)}</p></section>`;
    if (!loaded) return failed
      ? '<section class="tv-empty"><h2>Не удалось загрузить расписание</h2><p>Проверьте подключение к сети — экран попробует снова через минуту</p></section>'
      : '<section class="tv-empty"><h2>Загружаем расписание</h2><p>Получаем данные из школьной таблицы</p></section>';
    const who = lock ? `${gradeLabel(lock)}-х классов ` : '';
    return `<section class="tv-empty"><h2>Уроки ${who}на сегодня закончились</h2><p>Следующий учебный день — ${esc(next)}</p></section>`;
  }

  function show(turned) {
    const { m, s } = view;
    const key = rotation.current()[0];
    const stage = document.getElementById('stage');
    stage.classList.toggle('is-today', isToday(key));
    if (isToday(key)) return showToday(turned, m, s);
    const rating = key === LATE_KEY ? view.rating : null;
    const snap = rating ? null : view.snaps.get(key);
    const grade = snap ? snap.key : lock || '';
    document.getElementById('kicker').textContent = rating ? 'Опоздания' : 'Параллель';
    document.getElementById('grade').textContent = rating ? 'Рейтинг' : grade ? gradeLabel(grade) : '5–11';
    document.getElementById('grade-note').textContent = rating ? '' : 'классы';
    if (rating) {
      board.innerHTML = ratingHtml(rating);
    } else if (!snap) {
      board.innerHTML = emptyHtml(m, s);
    } else {
      const nextCol = s.type === 'before' ? snap.cols[0] : s.type === 'break' ? s.next : 0;
      const rows = snap.rows.map((r) => {
        const byLesson = new Map(r.lessons.map((x) => [x.lesson, x]));
        return `<div class="pb-row" data-class="${esc(r.cls)}"><div class="pb-class"><span data-fit="28">${esc(r.cls)}</span></div>${snap.cols.map((n) => cell(byLesson.get(n), n, s, nextCol)).join('')}</div>`;
      }).join('');
      board.innerHTML = `<section class="tv-card" style="--cols:${snap.cols.length};--rows:${snap.rows.length}"><div class="pb-head"><span class="tv-corner">Класс</span>${snap.cols.map((n) => headCell(n, s, nextCol, m.date)).join('')}</div><div class="pb-rows">${rows}</div></section>`;
    }
    const pages = rotation.pages();
    const started = rotation.sync();
    const nextKey = view.keys[(rotation.page() + 1) % view.keys.length];
    const last = rotation.current()[0] === view.base[view.base.length - 1];
    const text = lock ? 'Параллель закреплена за этим экраном' : pages <= 1 ? '' : isToday(nextKey) ? 'Дальше «Сегодня» через 15 с' : last && view.rating ? 'Снова расписание через 15 с' : 'Следующая параллель через 15 с';
    renderPager(key);
    document.getElementById('next-text').textContent = snap || rating ? text : '';
    if (turned || started || pages <= 1) tv.restartBar(rotation.currentPeriod(), pages > 1);
    tv.fitWhenReady(stage);
  }

  // The boards as chips, and one «Сегодня» chip lit while the slide is on.
  function renderPager(key) {
    if (lock || onlyToday) return tv.renderPager([], 0, '');
    const labels = view.base.map(gradeLabel).concat(view.keys.some(isToday) && view.base.length ? ['Сегодня'] : []);
    const index = isToday(key) ? labels.length - 1 : view.base.indexOf(key);
    tv.renderPager(labels, Math.max(0, index), '');
  }

  function showToday(turned, m, s) {
    const { head, html } = todaySlide.render(m, s, { rating: view.rating });
    document.getElementById('kicker').textContent = head.kicker;
    document.getElementById('grade').textContent = head.title;
    document.getElementById('grade-note').textContent = '';
    document.querySelector('.tv-title')?.setAttribute('data-tone', head.tone);
    board.innerHTML = html;
    const pages = rotation.pages();
    const started = rotation.sync();
    renderPager(rotation.current()[0]);
    document.getElementById('next-text').textContent = pages > 1 ? 'Дальше расписание через 20 с' : '';
    if (turned || started || pages <= 1) tv.restartBar(rotation.currentPeriod(), pages > 1);
    const stage = document.getElementById('stage');
    tv.fitWhenReady(stage);
    todaySlide.afterRender(board);
  }

  /* Clock and data -------------------------------------------------- */

  function tick() {
    const m = tv.moment(), s = tv.bellState(m), key = tv.stateKey(m, s);
    tv.renderHeader(m, s);
    tv.fit(document.querySelector('.tv-head'));
    if (lastKey && key !== lastKey && view) {
      lastKey = key;
      rebuild(m, s);
      show(false);
      return;
    }
    lastKey = key;
  }

  async function load() {
    try {
      await Promise.all([site.loadCalendar?.(), core.loadBells()]);
      const [schedule, changes] = await Promise.all([site.loadSheet(SHEETS[0], { force: true }), site.loadSheet(SHEETS[1], { force: true, optional: true })]);
      scheduleRows = schedule || [];
      changesRows = changes || [];
      if (late && !asked) { // a screen pinned to a parallel never shows the rating
        // The rating is extra: a missing sheet or a failed request never stops the schedule.
        try {
          const [marks, shifts] = await Promise.all([site.loadSheet(late.SHEETS.marks, { force: true, optional: true }), site.loadSheet(late.SHEETS.shifts, { force: true, optional: true })]);
          markRows = marks || [];
          shiftRows = shifts || [];
        } catch (_) {}
      }
      if (todaySlide) await todaySlide.load({ force: true }).catch(() => {});
      loaded = true;
      failed = false;
    } catch (_) {
      failed = !loaded;
    }
    rebuild();
    show(false);
    tv.renderFreshness(SHEETS);
  }

  tv.initStage();
  tick();
  load();
  tv.syncClock().then(tick);
  setInterval(tick, 5000);
  setInterval(load, 60000);
  setInterval(tv.syncClock, 30 * 60 * 1000);
})();
