// achievements.html «Наши достижения»: счётчики за учебный год, разбивка по уровням,
// лента побед с фильтрами по параллели и направлению. Данные — achievements.json (только проверенные).
(() => {
  'use strict';
  const pub = window.AchievementsPublic, config = window.SCHOOL_CONFIG || {};
  if (!pub) return;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { data: null, parallel: '', direction: '' };
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  const medal = (r) => (/^(Победитель|1 место)$/.test(r) ? '🥇' : r === '2 место' ? '🥈' : r === '3 место' ? '🥉' : '🏅');

  function stats(t) {
    const tiles = [
      [t.records, plural(t.records, 'результат', 'результата', 'результатов'), 'за учебный год'],
      [t.prizes, plural(t.prizes, 'победа и призовое место', 'победы и призовых места', 'побед и призовых мест'), 'призёры и победители'],
      [t.municipal_plus_prizes || 0, plural(t.municipal_plus_prizes || 0, 'призёр', 'призёра', 'призёров'), 'муниципального уровня и выше'],
    ];
    $('[data-wins-stats]').innerHTML = tiles.map(([n, word, note], i) => `<div class="wins-stat wins-stat--${i}"><b>${n}</b><span>${esc(word)}</span><small>${esc(note)}</small></div>`).join('');
  }

  function levels(t) {
    const max = Math.max(1, ...t.by_level.map((x) => x.records));
    $('[data-wins-levels]').innerHTML = `<div class="wins-bars">${t.by_level.map((x) => `<div class="wins-bar">
      <span class="wins-bar__label">${esc(x.level)}</span>
      <span class="wins-bar__track" aria-hidden="true"><span class="wins-bar__all" style="width:${(x.records / max) * 100}%"></span><span class="wins-bar__prize" style="width:${(x.prizes / max) * 100}%"></span></span>
      <span class="wins-bar__value">${x.records}<small> · призёров ${x.prizes}</small></span></div>`).join('')}</div>
      <p class="help-note">Светлая полоса — все результаты, тёмная — победители и призёры.</p>`;
  }

  function filters(data) {
    const parallels = data.totals.by_parallel.filter((x) => pub.filterHighlights(pub.allHighlights(data), { parallel: x.parallel }).length).map((x) => x.parallel);
    const chips = [['', 'Все'], ...parallels.map((p) => [p, `${p} кл.`])];
    $('[data-wins-parallels]').innerHTML = chips.map(([v, l]) => `<button class="chip" type="button" data-parallel="${esc(v)}" aria-pressed="${v === state.parallel}">${esc(l)}</button>`).join('');
    $('[data-wins-parallels]').querySelectorAll('[data-parallel]').forEach((b) => b.addEventListener('click', () => { state.parallel = b.dataset.parallel; filters(data); feed(); }));
    const dirs = [...new Set(pub.allHighlights(data).map((h) => h.direction))].sort();
    const sel = $('[data-wins-direction]');
    sel.innerHTML = `<option value="">Все направления</option>${dirs.map((d) => `<option value="${esc(d)}"${d === state.direction ? ' selected' : ''}>${esc(d)}</option>`).join('')}`;
  }

  function feed() {
    const items = pub.filterHighlights(pub.allHighlights(state.data), state);
    $('[data-wins-feed]').innerHTML = items.length ? items.map((h) => `<article class="wins-card">
      <span class="wins-card__medal" aria-hidden="true">${medal(h.result)}</span>
      <div class="wins-card__body">
        <div class="wins-card__who"><b>${esc(pub.label(h))}</b> — ${esc(pub.resultWord(h.result))}</div>
        <div class="wins-card__event">${esc(h.event)}</div>
        <div class="wins-card__meta">${esc([pub.levelWord(h.level), pub.ruDate(h.date), h.supervisor ? `руководитель ${h.supervisor}` : ''].filter(Boolean).join(' · '))}</div>
      </div></article>`).join('') : '<div class="empty-state"><span>По этому фильтру побед пока нет.</span></div>';
  }

  async function boot() {
    const year = document.querySelector('[data-current-year]');
    if (year) year.textContent = new Date().getFullYear();
    $('[data-wins-direction]').addEventListener('change', (e) => { state.direction = e.target.value; feed(); });
    try {
      const data = await pub.load(config.achievementsPublicUrl);
      $('[data-wins-loading]').hidden = true;
      if (!data || (!data.totals.records && !pub.allHighlights(data).length)) { $('[data-wins-empty]').hidden = false; return; }
      state.data = data;
      $('[data-wins-lead]').textContent = `Победы и призовые места учеников школы, ${data.school_year}/${String(data.school_year + 1).slice(2)} учебный год. Имена — только с согласия родителей.`;
      const upd = $('[data-wins-updated]');
      upd.textContent = `Обновлено ${new Date(data.updated_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`;
      upd.hidden = false;
      stats(data.totals);
      levels(data.totals);
      filters(data);
      feed();
      $('[data-wins]').hidden = false;
    } catch (_) {
      $('[data-wins-loading]').hidden = true;
      $('[data-wins-empty]').hidden = false;
    }
  }
  boot();
})();
