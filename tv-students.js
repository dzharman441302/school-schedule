// ТВ для учеников: табло одной параллели — строки классы, столбцы уроки, которые
// ещё будут сегодня. Параллели сменяются каждые 15 секунд; ?parallel=9 закрепляет
// одну параллель за экраном (10 и 11 классы показываются вместе).
(() => {
  'use strict';
  const site = window.SchoolSite, core = window.ScheduleCore, tv = window.TvCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !core || !tv) return;

  const PERIOD = 15000, MAX_COLS = 10;
  const SHEETS = ['Расписание', 'Изменения'];
  const esc = site.escapeHtml;
  const board = document.getElementById('board');
  const rawLock = new URLSearchParams(location.search).get('parallel');
  const asked = rawLock === '10' || rawLock === '11' ? '10-11' : rawLock || '';
  let lock = '';

  let scheduleRows = [], changesRows = [], loaded = false, failed = false, view = null, lastKey = '';
  const rotation = tv.createRotation({ size: 1, period: PERIOD, onTurn: () => show(true) });

  const gradeLabel = (key) => (key === '10-11' ? '10–11' : key);

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
    view = { m, s, snaps: new Map(snaps.map((x) => [x.key, x])), keys: snaps.map((x) => x.key) };
    rotation.setKeys(view.keys);
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

  function headCell(n, s, nextCol) {
    const time = `<small data-fit="14">${esc(core.bellRange(n))}</small>`;
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
    else if (info.kind === 'changed') tag = `<span class="pb-tag"><em>Замена</em>${x.base?.subject ? `<s>${esc(tv.shortSubject(x.base.subject))}</s>` : ''}</span>`;
    else if (info.kind === 'added') tag = '<span class="pb-tag"><em>Добавлен</em></span>';
    return `<div class="pb-c k-${info.kind}${marks}">${tag}<strong class="pb-subj" data-fit="20">${subject}</strong>${roomHtml(info.room)}</div>`;
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
    const snap = view.snaps.get(rotation.current()[0]);
    const grade = snap ? snap.key : lock || '';
    document.getElementById('grade').textContent = grade ? gradeLabel(grade) : '5–11';
    if (!snap) {
      board.innerHTML = emptyHtml(m, s);
    } else {
      const nextCol = s.type === 'before' ? snap.cols[0] : s.type === 'break' ? s.next : 0;
      const rows = snap.rows.map((r) => {
        const byLesson = new Map(r.lessons.map((x) => [x.lesson, x]));
        return `<div class="pb-row" data-class="${esc(r.cls)}"><div class="pb-class"><span data-fit="28">${esc(r.cls)}</span></div>${snap.cols.map((n) => cell(byLesson.get(n), n, s, nextCol)).join('')}</div>`;
      }).join('');
      board.innerHTML = `<section class="tv-card" style="--cols:${snap.cols.length};--rows:${snap.rows.length}"><div class="pb-head"><span class="tv-corner">Класс</span>${snap.cols.map((n) => headCell(n, s, nextCol)).join('')}</div><div class="pb-rows">${rows}</div></section>`;
    }
    const pages = rotation.pages();
    const started = rotation.sync();
    const text = lock ? 'Параллель закреплена за этим экраном' : pages > 1 ? 'Следующая параллель через 15 с' : '';
    tv.renderPager(lock ? [] : view.keys.map(gradeLabel), rotation.page(), snap ? text : '');
    if (turned || started || pages <= 1) tv.restartBar(PERIOD, pages > 1);
    tv.fitWhenReady(document.getElementById('stage'));
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
      await site.loadCalendar?.();
      const [schedule, changes] = await Promise.all([site.loadSheet(SHEETS[0], { force: true }), site.loadSheet(SHEETS[1], { force: true, optional: true })]);
      scheduleRows = schedule || [];
      changesRows = changes || [];
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
