// Меню столовой по 10-дневному циклу (data/menu-cycle.json), для сайта и ТВ-экранов.
//
// Дни цикла идут только по учебным дням: выходные и каникулы/праздники листа «Календарь»
// пропускаются. День цикла = (учебных дней от начала цикла до даты, не включая её) mod 10 + 1.
// Начало цикла — cycleStart из файла; если столовая сбилась, в «Настройки_сайта» задаётся
// menuCycleStart (дата, которая была днём 1) — он важнее файла.
// Необязательный лист «Меню_замены»: Дата | Приём пищи | Было | Стало — замена блюда на день
// («Стало» пустое — блюдо убрано, «Было» пустое — блюдо добавлено).
(() => {
  'use strict';
  const site = window.SchoolSite;
  const config = window.SCHOOL_CONFIG || {};
  if (!site) return;

  const FILE = 'data/menu-cycle.json?v=1';
  const SETTINGS = config.googleSheets?.sheets?.siteSettings || 'Настройки_сайта';
  const REPLACEMENTS = config.googleSheets?.sheets?.menuReplacements || 'Меню_замены';
  const CACHE_KEY = 'school20:menuCycle';
  const CACHE_MS = 6 * 60 * 60 * 1000;
  const DAY = 86400000;
  const state = { cycle: null, start: '', replacements: [], loaded: 0 };

  const isoOf = (d) => d.toISOString().slice(0, 10);
  // A date as the site keeps it: UTC noon of the school (Moscow) day.
  function dateOf(v) {
    if (typeof v?.getUTCFullYear === 'function') return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 12));
    const iso = normalizeDate(v);
    return iso ? new Date(`${iso}T12:00:00Z`) : null;
  }
  function normalizeDate(v) {
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim();

  function storedCycle() {
    try {
      const saved = JSON.parse(site.storageGet(CACHE_KEY) || 'null');
      return saved && Date.now() - saved.at < CACHE_MS && Array.isArray(saved.cycle?.days) ? saved.cycle : null;
    } catch (_) { return null; }
  }

  // The cycle file (memory → localStorage for 6 hours → network), the start from the settings,
  // the replacements and the school calendar. Never throws: without a file the menu is just absent.
  async function loadMenuCycle({ force = false } = {}) {
    if (!force && state.cycle && Date.now() - state.loaded < CACHE_MS) return state;
    let cycle = force ? null : storedCycle();
    if (!cycle) {
      try {
        const soon = window.TodayCore?.fetchSoon, init = { cache: force ? 'no-cache' : 'default' };
        const res = await (soon ? soon(FILE, 8000, init) : fetch(FILE, init));
        if (res.ok) {
          cycle = await res.json();
          try { site.storageSet(CACHE_KEY, JSON.stringify({ at: Date.now(), cycle })); } catch (_) {}
        }
      } catch (_) {}
    }
    if (!cycle) cycle = state.cycle || storedCycle();
    const [settings, replacements] = await Promise.all([
      site.loadSheet(SETTINGS, { optional: true, force }).catch(() => []),
      site.loadSheet(REPLACEMENTS, { optional: true, force }).catch(() => []),
      site.loadCalendar ? site.loadCalendar({ force }).catch(() => []) : null,
    ]);
    setData({ cycle, settings, replacements });
    return state;
  }

  // Also used by tests: everything menuFor needs, without the network.
  function setData({ cycle, settings = [], replacements = [] }) {
    if (cycle && Array.isArray(cycle.days) && cycle.days.length) state.cycle = cycle;
    const row = (settings || []).slice(1).find((r) => String(r[0] || '').trim() === 'menuCycleStart');
    state.start = normalizeDate(row?.[1]) || normalizeDate(state.cycle?.cycleStart) || '';
    state.replacements = (replacements || []).slice(1).map((r) => ({ date: normalizeDate(r[0]), meal: norm(r[1]), was: String(r[2] ?? '').trim(), now: String(r[3] ?? '').trim() }))
      .filter((r) => r.date && r.meal && (r.was || r.now));
    state.loaded = Date.now();
  }

  // Number of school days from the start of the cycle to the date (the date itself not counted);
  // negative before the start. Holidays come from the calendar loaded by app.js.
  function schoolDaysBetween(from, to) {
    const sign = to >= from ? 1 : -1;
    let a = sign > 0 ? from : to;
    const b = sign > 0 ? to : from;
    let n = 0;
    for (let i = 0; i < 4000 && a < b; i += 1, a = new Date(a.getTime() + DAY)) if (site.isSchoolDay(a)) n += 1;
    return sign * n;
  }

  function cycleDayFor(date, start = state.start) {
    const d = dateOf(date), s = dateOf(start);
    const length = state.cycle?.cycleLength || state.cycle?.days?.length || 10;
    if (!d || !s) return 0;
    const n = schoolDaysBetween(s, d);
    return (((n % length) + length) % length) + 1;
  }

  function applyReplacements(iso, meals) {
    state.replacements.filter((r) => r.date === iso).forEach((r) => {
      const meal = meals.find((m) => norm(m.name) === r.meal);
      if (!meal) return;
      const i = r.was ? meal.items.findIndex((x) => norm(x.name) === norm(r.was) || norm(x.source) === norm(r.was)) : -1;
      if (r.was && i < 0) return;
      if (!r.now) { meal.items.splice(i, 1); return; }
      const item = { name: r.now, icon: i >= 0 ? meal.items[i].icon : 'sweet', emoji: '', replaced: true };
      if (i >= 0) meal.items[i] = { ...meal.items[i], ...item }; else meal.items.push(item);
    });
    return meals;
  }

  // The menu of a school day: { date, cycleDay, meals: [{ name, items: [{ name, icon, emoji, … }] }] };
  // null on a weekend, a holiday or without the cycle file.
  function menuFor(date) {
    const d = dateOf(date);
    if (!d || !state.cycle || !site.isSchoolDay(d)) return null;
    const cycleDay = cycleDayFor(d);
    const day = state.cycle.days.find((x) => Number(x.day) === cycleDay);
    if (!day) return null;
    const iso = isoOf(d), icons = state.cycle.icons || {};
    const meals = applyReplacements(iso, (day.meals || []).map((m) => ({ name: m.name, items: (m.items || []).map((x) => ({ ...x })) })));
    meals.forEach((m) => m.items.forEach((x) => { x.emoji = icons[x.icon] || '🍽️'; }));
    return { date: iso, cycleDay, meals };
  }

  // The menu of the next school day after the date (for «Завтра в меню» after lunch and on days off).
  function nextSchoolDayMenu(date) {
    const d = dateOf(date);
    return d ? menuFor(site.nextSchoolDay(d)) : null;
  }

  window.MenuCore = Object.freeze({ loadMenuCycle, setData, cycleDayFor, menuFor, nextSchoolDayMenu, normalizeDate, get state() { return state; } });
})();
