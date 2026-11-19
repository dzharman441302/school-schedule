// «Наши достижения»: публичный achievements.json из Яндекс Облака (achievementsPublicUrl в config.js).
// Там только проверенные результаты; имя ученика (фамилия и имя) — только при согласии родителей,
// иначе поля student нет и показывается «ученик 8Б». Используют achievements.html, главная
// («Поздравляем!») и бегущая строка ТВ. Данные не сохраняются в localStorage — только кэш в памяти.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AchievementsPublic = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const LEVELS = ['Школьный', 'Муниципальный', 'Региональный', 'Межрегиональный', 'Всероссийский', 'Международный'];
  const CACHE_MS = 10 * 60 * 1000;
  let cache = { url: '', at: 0, data: null };

  const rank = (level) => LEVELS.indexOf(level);
  const label = (h) => (h.student ? `${h.student}, ${h.class}` : `ученик ${h.class}`);
  const parallelOf = (cls) => (String(cls || '').match(/^\d+/) || ['—'])[0];
  const ruDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
  const resultWord = (r) => String(r || '').replace(/^([А-ЯЁ])/, (c) => c.toLowerCase());
  // «Муниципальный» → «муниципальный уровень»
  const levelWord = (level) => `${String(level || '').toLowerCase()} уровень`;

  function isoDay(date) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    return isoDay(new Date(y, m - 1, d + days));
  }

  // Все результаты «призёр и выше» без повторов (highlights + highlights_regional), новые выше.
  function allHighlights(data) {
    if (!data) return [];
    const seen = new Set(), out = [];
    for (const h of [...(data.highlights || []), ...(data.highlights_regional || [])]) {
      const key = [h.date, h.event, h.class, h.result, h.student || '', h.supervisor].join('|');
      if (!seen.has(key)) { seen.add(key); out.push(h); }
    }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  // Главная: последние результаты регионального уровня и выше.
  function congrats(data, { minLevel = 'Региональный', limit = 3 } = {}) {
    return allHighlights(data).filter((h) => rank(h.level) >= rank(minLevel)).slice(0, limit);
  }

  // ТВ: муниципальный уровень и выше за 14 дней — строки для бегущей строки.
  function tickerTexts(data, today = new Date(), { days = 14, minLevel = 'Муниципальный', limit = 8 } = {}) {
    const to = isoDay(today), from = addDays(to, -days);
    return allHighlights(data)
      .filter((h) => rank(h.level) >= rank(minLevel) && h.date >= from && h.date <= to)
      .slice(0, limit)
      .map((h) => `Поздравляем! ${label(h)} — ${resultWord(h.result)}: ${h.event} (${levelWord(h.level)})`);
  }

  function filterHighlights(list, { parallel = '', direction = '' } = {}) {
    return list.filter((h) => (!parallel || parallelOf(h.class) === parallel) && (!direction || h.direction === direction));
  }

  // contests.html (когда появится): «Итоги: наших участников N, призёров M» — без ФИО.
  function contestTotals(data, contestId) {
    const c = data && data.contests && data.contests[contestId];
    return c ? { participants: c.participants, prizes: c.prizes, text: `Итоги: наших участников ${c.participants}, призёров ${c.prizes}` } : null;
  }

  async function load(url, { fetchImpl, now = Date.now(), force = false } = {}) {
    if (!url) return null;
    if (!force && cache.url === url && cache.data && now - cache.at < CACHE_MS) return cache.data;
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    try {
      const res = await doFetch(url, { cache: 'no-cache', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache = { url, at: now, data };
      return data;
    } catch (err) {
      if (cache.url === url && cache.data) return cache.data; // без связи — прошлые данные
      throw err;
    }
  }

  /* Главная: блок «Поздравляем!» ---------------------------------------------------------- */

  async function mountCongrats(section, url) {
    if (!section || !url) return;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    try {
      const items = congrats(await load(url));
      if (!items.length) return;
      section.querySelector('[data-congrats-list]').innerHTML = items.map((h) => `<li class="congrats__item">
        <span class="congrats__medal" aria-hidden="true">${/^(Победитель|1 место)$/.test(h.result) ? '🥇' : /^2 место$/.test(h.result) ? '🥈' : /^3 место$/.test(h.result) ? '🥉' : '🏅'}</span>
        <span><b>${esc(label(h))}</b> — ${esc(resultWord(h.result))}<small>${esc(h.event)} · ${esc(levelWord(h.level))}</small></span></li>`).join('');
      section.hidden = false;
    } catch (_) { /* блок просто не показывается */ }
  }

  // Главная: блок [data-congrats] заполняется сам, если на странице он есть.
  if (typeof document !== 'undefined') {
    const start = () => {
      const section = document.querySelector('[data-congrats]');
      const url = (typeof window !== 'undefined' && window.SCHOOL_CONFIG && window.SCHOOL_CONFIG.achievementsPublicUrl) || '';
      if (section) mountCongrats(section, url);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  return Object.freeze({ LEVELS, rank, label, parallelOf, ruDate, resultWord, levelWord, allHighlights, congrats, tickerTexts, filterHighlights, contestTotals, load, mountCongrats, _reset: () => { cache = { url: '', at: 0, data: null }; } });
});
