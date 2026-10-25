// ТВ в учительской: сетка «учитель × урок» на сегодня. На странице 12 учителей
// по алфавиту, страницы сменяются каждые 15 секунд; справа — изменения дня.
(() => {
  'use strict';
  const site = window.SchoolSite, tv = window.TvCore;
  if (!site || !tv) return;

  const ROWS = 12, MAX_COLS = 12, PERIOD = 15000, CHANGES_SHOWN = 4;
  const SHEETS = ['Учителя', 'Учителя_сайт'];
  const DAY_CODES = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const esc = site.escapeHtml;
  const collator = new Intl.Collator('ru', { sensitivity: 'base' });
  const fullSubject = (v) => (window.SchoolSubjects?.expandSubject ? window.SchoolSubjects.expandSubject(v) : String(v ?? ''));
  const board = document.getElementById('board');

  let baseRows = [], changeRows = [], view = null, lastKey = '';
  const rotation = tv.createRotation({ size: ROWS, period: PERIOD, onTurn: () => show(true) });

  /* Data ------------------------------------------------------------ */

  function normalizeDate(v) {
    const s = String(v || '').trim(), m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.slice(0, 10);
  }

  function parseBaseCell(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const p = s.split('|').map((x) => x.trim());
    if (p.length >= 2) return { cls: p[0] || '', subj: fullSubject(p[1] || ''), room: p.slice(2).join('|').trim() };
    const m = s.match(/^([^·]+?)\s*[·-]\s*([^·]+?)(?:\s*[·-]\s*(.+))?$/);
    return m ? { cls: m[1].trim(), subj: fullSubject(m[2].trim()), room: String(m[3] || '').trim() } : { cls: '', subj: fullSubject(s), room: '' };
  }

  // «Учителя»: ФИО | УРОК | ПН … ПТ, клетка «класс|предмет|кабинет».
  function teacherBase(rows, day) {
    const map = new Map();
    if (!Array.isArray(rows) || !rows.length) return map;
    const hasHeader = site.looksLikeHeader(rows[0], ['фио', 'урок', 'пн', 'понедельник']);
    const hs = hasHeader ? rows[0].map((x) => String(x || '').trim()) : ['ФИО', 'УРОК', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
    const data = hasHeader ? rows.slice(1) : rows;
    const dayIndex = hs.findIndex((h) => h.toUpperCase() === day);
    const teacherIndex = Math.max(0, hs.findIndex((h) => /фио|учитель/i.test(h)));
    const lessonIndex = Math.max(1, hs.findIndex((h) => /урок/i.test(h)));
    data.forEach((r) => {
      const teacher = String(r[teacherIndex] || '').trim(), lesson = Number(String(r[lessonIndex] || '').match(/\d+/)?.[0] || 0);
      if (!teacher || !lesson) return;
      if (!map.has(teacher)) map.set(teacher, new Map());
      const cell = dayIndex >= 0 ? parseBaseCell(r[dayIndex]) : null;
      if (cell) map.get(teacher).set(lesson, { lesson, ...cell, status: 'normal' });
    });
    return map;
  }

  function changeType(status) {
    const s = String(status || '').toLowerCase();
    if (/cancel|отмен/.test(s)) return 'cancelled';
    if (/room|кабин/.test(s)) return 'room-change';
    if (/add|добав/.test(s)) return 'added';
    return 'changed';
  }

  // «Учителя_сайт»: Дата | Учитель | Урок | Класс | Предмет | Кабинет | Статус | было: Класс | Предмет | Кабинет.
  function overlayChanges(map, rows, iso) {
    const list = [];
    if (!Array.isArray(rows) || rows.length < 2) return list;
    rows.slice(1).filter((r) => normalizeDate(r[0]) === iso && String(r[6] || 'normal') !== 'normal').forEach((r) => {
      const teacher = String(r[1] || '').trim(), lesson = Number(r[2]) || 0;
      if (!teacher || !lesson) return;
      if (!map.has(teacher)) map.set(teacher, new Map());
      const current = map.get(teacher).get(lesson) || null, status = changeType(r[6]);
      const old = { cls: String(r[7] || current?.cls || ''), subj: fullSubject(String(r[8] || current?.subj || '')), room: String(r[9] || current?.room || '') };
      const next = { cls: String(r[3] || current?.cls || ''), subj: fullSubject(String(r[4] || current?.subj || '')), room: String(r[5] || current?.room || '') };
      map.get(teacher).set(lesson, { lesson, status, old, next, cls: next.cls, subj: next.subj, room: next.room });
      list.push({ teacher, lesson, status, old, next });
    });
    return list;
  }

  function hasRealLesson(x) {
    if (x.status === 'cancelled') return false;
    return Boolean(String(x.cls || '').trim() || String(x.subj || '').trim() || String(x.room || '').trim());
  }

  // A cancelled lesson and a lesson added to someone else for the same class and
  // period are one replacement: «Бакалева Г.А. — заменяет: Крымская Е.Э.».
  function changeItems(list, visible) {
    const same = (a, b) => site.normalizeClass(a) === site.normalizeClass(b);
    const shown = list.filter((x) => visible(x.lesson)).sort((a, b) => a.lesson - b.lesson || collator.compare(a.next.cls || a.old.cls, b.next.cls || b.old.cls));
    const used = new Set(), items = [];
    shown.forEach((x) => {
      if (used.has(x)) return;
      if (x.status === 'cancelled') {
        const y = shown.find((z) => !used.has(z) && z !== x && z.teacher !== x.teacher && z.lesson === x.lesson && (z.status === 'added' || z.status === 'changed') && same(z.next.cls, x.old.cls));
        if (y) {
          used.add(x).add(y);
          items.push({ lesson: x.lesson, cls: y.next.cls, kind: 'changed', tag: 'замена', name: y.teacher, detail: `заменяет: ${x.teacher}${y.next.room ? ` · каб. ${y.next.room}` : ''}` });
          return;
        }
      }
      used.add(x);
      if (x.status === 'cancelled') items.push({ lesson: x.lesson, cls: x.old.cls, kind: 'cancelled', tag: 'снят', name: x.teacher, detail: `урок снят${x.old.subj ? ` · ${x.old.subj}` : ''}` });
      else if (x.status === 'room-change') items.push({ lesson: x.lesson, cls: x.next.cls, kind: 'room', tag: 'кабинет', name: x.teacher, detail: `каб. ${x.old.room || '—'} → ${x.next.room || '—'}` });
      else if (x.status === 'added') items.push({ lesson: x.lesson, cls: x.next.cls, kind: 'added', tag: 'добавлен', name: x.teacher, detail: [x.next.subj, x.next.room ? `каб. ${x.next.room}` : ''].filter(Boolean).join(' · ') || 'добавлен урок' });
      else items.push({ lesson: x.lesson, cls: x.next.cls, kind: 'changed', tag: 'изменён', name: x.teacher, detail: `было: ${[x.old.cls, x.old.room ? `каб. ${x.old.room}` : ''].filter(Boolean).join(' · ') || '—'}` });
    });
    return items;
  }

  // Page labels by surname: «А–Д · Е–Ме · Мо–Ч» (two letters where pages meet on one letter).
  function pageLabels(names) {
    const pages = [];
    for (let i = 0; i < names.length; i += ROWS) pages.push([names[i], names[Math.min(i + ROWS, names.length) - 1]]);
    const len = pages.map(() => [1, 1]);
    for (let i = 0; i + 1 < pages.length; i += 1) {
      if (pages[i][1][0].toUpperCase() === pages[i + 1][0][0].toUpperCase()) { len[i][1] = 2; len[i + 1][0] = 2; }
    }
    return pages.map(([a, b], i) => {
      const x = a.slice(0, len[i][0]), y = b.slice(0, len[i][1]);
      return x === y ? x : `${x}–${y}`;
    });
  }

  function rebuild(m = tv.moment(), s = tv.bellState(m)) {
    const iso = m.date.toISOString().slice(0, 10);
    const map = teacherBase(baseRows, DAY_CODES[m.date.getUTCDay()]);
    const list = overlayChanges(map, changeRows, iso);
    const visible = (lesson) => tv.lessonVisible(lesson, s, m);
    const shown = [];
    map.forEach((lessons, teacher) => {
      const items = [...lessons.values()].filter((x) => visible(x.lesson));
      if (items.some(hasRealLesson)) shown.push({ teacher, lessons: new Map(items.map((x) => [x.lesson, x])) });
    });
    shown.sort((a, b) => collator.compare(a.teacher, b.teacher));
    const used = shown.flatMap((x) => [...x.lessons.keys()]);
    const cols = [];
    if (used.length) {
      const first = s.type === 'lesson' ? s.lesson : s.type === 'break' ? s.next : Math.min(...used);
      const last = Math.min(Math.max(first, ...used), first + MAX_COLS - 1);
      for (let n = first; n <= last; n += 1) cols.push(n);
    }
    const names = shown.map((x) => x.teacher);
    view = { m, s, cols, teachers: new Map(shown.map((x) => [x.teacher, x.lessons])), changes: changeItems(list, visible), labels: pageLabels(names) };
    rotation.setKeys(names);
  }

  /* Markup ---------------------------------------------------------- */

  function headCell(n, s) {
    if (s.type === 'lesson' && s.lesson === n) return `<span class="tg-h is-now"><b>${n}</b><em class="tv-pill">сейчас</em></span>`;
    if (s.type === 'break' && s.next === n) return `<span class="tg-h is-next"><b>${n}</b><em class="tv-pill">далее</em></span>`;
    return `<span class="tg-h"><b>${n}</b><small>${esc(window.ScheduleCore.bellStart(n))}</small></span>`;
  }

  // A grid cell is ~100 px wide: «109/Мастерские» → «109», «Мастерские» → «Маст.».
  function shortRoom(room) {
    const r = String(room || '').trim();
    if (r.length <= 7) return r;
    const numbers = r.match(/\d+[А-ЯA-Zа-яa-z]?/g);
    return numbers ? numbers.join('/') : `${r.slice(0, 4)}.`;
  }

  function lessonCell(x, n, s) {
    const marks = `${s.type === 'lesson' && s.lesson === n ? ' is-now' : ''}${s.type === 'break' && s.next === n ? ' is-next' : ''}`;
    if (!x) return `<span class="tg-c k-empty${marks}"></span>`;
    const status = x.status || 'normal';
    const cls = (v) => esc(String(v || '').split(/\s*\+\s*/).join('+'));
    const room = (v) => esc(shortRoom(v));
    if (status === 'cancelled') return `<span class="tg-c k-cancelled${marks}"><s data-fit="14">${cls(x.old?.cls) || '—'}</s><small>снят</small></span>`;
    if (status === 'room-change') return `<span class="tg-c k-room-change${marks}"><b data-fit="14">${cls(x.next?.cls)}</b><small data-fit="14">→ ${room(x.next?.room) || '—'}</small></span>`;
    if (status === 'added') return `<span class="tg-c k-added${marks}"><b data-fit="14">+${cls(x.next?.cls)}</b><small data-fit="14">${room(x.next?.room)}</small></span>`;
    if (status === 'changed') return `<span class="tg-c k-changed${marks}"><b data-fit="14">${cls(x.next?.cls)}</b><small data-fit="14">${room(x.next?.room)}</small></span>`;
    return `<span class="tg-c k-normal${marks}"><b data-fit="14">${cls(x.cls)}</b><small data-fit="14">${room(x.room)}</small></span>`;
  }

  function changesHtml(items) {
    const head = `<div class="tg-changes__head"><h2 data-fit="18">Изменения сегодня</h2>${items.length ? `<span class="tg-count">${items.length}</span>` : ''}</div>`;
    if (!items.length) return `<aside class="tg-changes">${head}<div class="tg-calm"><b>Изменений нет</b><span>Все уроки идут по расписанию</span></div></aside>`;
    const room = CHANGES_SHOWN;
    const list = items.slice(0, room).map((x) => `<article class="tg-item"><span class="tg-item__top"><b>${x.lesson} урок${x.cls ? ` · ${esc(x.cls)}` : ''}</b><em class="tv-pill p-${x.kind}">${esc(x.tag)}</em></span><strong data-fit="18">${esc(x.name)}</strong><span class="tg-item__detail" data-fit="16">${esc(x.detail)}</span></article>`).join('');
    const more = items.length > room ? `<span class="tg-more">И ещё ${items.length - room} — отмечены в сетке цветом</span>` : '';
    return `<aside class="tg-changes">${head}${list}${more}</aside>`;
  }

  function emptyHtml(m, s) {
    const next = site.capitalize(tv.dayLabel(site.nextSchoolDay(m.date)));
    if (s.type === 'off') return `<section class="tv-empty"><h2>Сегодня выходной</h2><p>Следующий учебный день — ${esc(next)}</p></section>`;
    if (!baseRows.length) return '<section class="tv-empty"><h2>Расписание загружается</h2><p>Если экран не обновится, проверьте подключение к сети</p></section>';
    return `<section class="tv-empty"><h2>Уроки на сегодня закончились</h2><p>Следующий учебный день — ${esc(next)}</p></section>`;
  }

  function show(turned) {
    const { m, s, cols } = view;
    const names = rotation.current();
    if (!names.length) {
      board.innerHTML = emptyHtml(m, s);
    } else {
      const rows = names.map((name) => {
        const lessons = view.teachers.get(name);
        return `<div class="tg-row" data-teacher="${esc(name)}"><span class="tg-name"><span data-fit="18">${esc(name)}</span></span>${cols.map((n) => lessonCell(lessons.get(n), n, s)).join('')}</div>`;
      }).join('');
      board.innerHTML = `<div class="tg"><section class="tv-card" style="--cols:${cols.length}"><div class="tg-head"><span class="tv-corner">Учитель</span>${cols.map((n) => headCell(n, s)).join('')}</div><div class="tg-rows">${rows}</div></section>${changesHtml(view.changes)}</div>`;
    }
    const pages = rotation.pages();
    const started = rotation.sync();
    tv.renderPager(view.labels, rotation.page(), names.length ? (pages > 1 ? `Страница ${rotation.page() + 1} из ${pages} · дальше через 15 с` : 'Все учителя на одном экране') : '');
    if (turned || started || pages <= 1) tv.restartBar(PERIOD, pages > 1);
    tv.fitWhenReady(board);
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
      const [b, c] = await Promise.all(SHEETS.map((name) => site.loadSheet(name, { force: true, optional: true })));
      baseRows = b || [];
      changeRows = c || [];
    } catch (_) {}
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
