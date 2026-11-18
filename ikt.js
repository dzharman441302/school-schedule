// ikt.html: the ИКТ deputy's page. Login with IKT_PIN (token in sessionStorage, 12 hours),
// all requests of the school as cards, open 🔴 first. Every action can be taken back with
// «Отменить» in the toast instead of a confirmation. The list refreshes every minute; a new
// 🔴 request beeps and makes the tab title blink.
(() => {
  'use strict';
  const site = window.SchoolSite, ict = window.IctCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !ict) return;

  const STORE_TOKEN = 'school20:iktToken';
  const REFRESH_MS = 60000;
  const TABS = [
    ['all', 'Все открытые'], ['questions', 'Вопросы'], ['tech', 'Техника'], ['red', '🔴 Срочные'], ['mine', 'Мои открытые'], ['closed', 'Закрытые'],
  ];
  const $ = (s) => document.querySelector(s), esc = site.escapeHtml;
  const state = { endpoint: '', token: '', items: [], closed: null, stats: null, tab: 'all', q: '', known: null, open: new Set(), photos: new Map(), timer: 0, blink: 0, audio: null, busy: false };

  const session = {
    get: () => { try { return sessionStorage.getItem(STORE_TOKEN) || ''; } catch (_) { return ''; } },
    set: (v) => { try { if (v) sessionStorage.setItem(STORE_TOKEN, v); else sessionStorage.removeItem(STORE_TOKEN); } catch (_) {} },
  };

  async function call(action, extra = {}) {
    const r = await ict.post(state.endpoint, { action, token: state.token, ...extra });
    if (r && r.auth) { logout(r.error); throw new Error(r.error); }
    if (!r || !r.ok) throw new Error((r && r.error) || 'Ошибка сервера');
    return r;
  }

  /* Login --------------------------------------------------------------- */

  function showLogin(message = '') {
    $('[data-app]').hidden = true;
    $('[data-login]').hidden = false;
    const err = $('[data-login-error]');
    err.textContent = message;
    err.hidden = !message;
    $('#ikt-pin').focus();
  }
  async function login(e) {
    e.preventDefault();
    unlockAudio();
    const btn = $('[data-login-btn]'), pin = $('#ikt-pin').value.trim();
    btn.disabled = true;
    try {
      const r = await ict.post(state.endpoint, { action: 'iktLogin', pin });
      if (!r.ok) throw new Error(r.error || 'Не удалось войти');
      state.token = r.token;
      session.set(r.token);
      $('#ikt-pin').value = '';
      startApp();
    } catch (err) {
      showLogin(/Failed to fetch|HTTP|abort/i.test(err.message) ? 'Нет связи с сервером' : err.message);
    } finally {
      btn.disabled = false;
    }
  }
  function logout(message = '') {
    if (state.token) ict.post(state.endpoint, { action: 'iktLogout', token: state.token }).catch(() => {});
    state.token = '';
    session.set('');
    clearInterval(state.timer);
    state.known = null;
    showLogin(message);
  }

  /* Data ------------------------------------------------------------------ */

  async function refresh({ quiet = false } = {}) {
    if (state.busy) return;
    state.busy = true;
    const sync = $('[data-sync]');
    if (!quiet) sync.textContent = 'Обновляем…';
    try {
      const r = await call('iktList', { filter: { status: 'open' } });
      state.items = r.items;
      state.stats = r.stats;
      $('[data-pin-warning]').hidden = r.staffPinSet;
      $('[data-staff-pin-state]').textContent = r.staffPinSet ? 'PIN для учителей задан. Новый PIN сразу заменит старый.' : 'PIN для учителей ещё не задан.';
      if (state.tab === 'closed') state.closed = (await call('iktList', { filter: { status: 'closed' } })).items;
      noticeNewRed();
      sync.textContent = `Обновлено в ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
      sync.classList.remove('is-bad');
      render();
    } catch (err) {
      if (!state.token) return;
      sync.textContent = 'Нет связи — попробуем через минуту';
      sync.classList.add('is-bad');
    } finally {
      state.busy = false;
    }
  }

  // A 🔴 request that was not in the previous list: sound and a blinking tab title.
  function noticeNewRed() {
    const ids = new Set(state.items.map((x) => x.id));
    if (state.known) {
      const fresh = state.items.filter((x) => x.urgency === 'red' && !state.known.has(x.id));
      if (fresh.length) { beep(); blinkTitle(`🔴 Срочная заявка №${fresh[0].id}`); }
    }
    state.known = new Set([...(state.known || []), ...ids]);
  }
  function unlockAudio() {
    try { if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)(); if (state.audio.state === 'suspended') state.audio.resume(); } catch (_) {}
  }
  function beep() {
    const ctx = state.audio;
    if (!ctx) return;
    try {
      [0, 0.25].forEach((delay) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + delay;
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.22);
      });
    } catch (_) {}
  }
  const baseTitle = document.title;
  function blinkTitle(text) {
    clearInterval(state.blink);
    let on = false;
    state.blink = setInterval(() => { on = !on; document.title = on ? text : baseTitle; }, 1000);
  }
  function stopBlink() { if (document.visibilityState === 'visible') { clearInterval(state.blink); document.title = baseTitle; } }

  /* Rendering --------------------------------------------------------------- */

  function visible() {
    const q = state.q.toLowerCase().replace(/ё/g, 'е').trim();
    const source = state.tab === 'closed' ? (state.closed || []) : state.items;
    return source.filter((x) => {
      if (state.tab === 'questions' && x.type !== 'question') return false;
      if (state.tab === 'tech' && x.type !== 'tech') return false;
      if (state.tab === 'red' && x.urgency !== 'red') return false;
      if (state.tab === 'mine' && x.executor !== 'ikt') return false;
      return !q || `${x.teacher} ${x.room} каб.${x.room} каб ${x.room} ${x.id} №${x.id}`.toLowerCase().replace(/ё/g, 'е').includes(q);
    });
  }

  function statsMarkup(s) {
    const box = (key, tab, n, label, extra = '') => `<button type="button" class="ikt-stat${extra}" data-go="${tab}"><strong>${n}</strong><span>${label}</span></button>`;
    return box('fresh', 'all', s.fresh, 'новых')
      + box('red', 'red', s.red, '🔴 срочных открыто', s.red ? ' ikt-stat--red' : '')
      + box('questions', 'questions', s.questions, 'вопросов без ответа')
      + box('tech', 'tech', s.techQueue, 'техника — очередь на субботу')
      + box('closed', 'closed', s.closedWeek, 'закрыто за неделю');
  }

  const dateTime = (iso) => (iso ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '') : '');

  function actionsMarkup(x) {
    const b = (act, label, ghost = true) => `<button class="btn ${ghost ? 'btn--ghost ' : ''}btn--sm" type="button" data-act="${act}">${label}</button>`;
    if (!ict.isOpen(x)) return b('reopen', 'Открыть снова');
    if (x.executor === 'ikt') {
      return [x.status !== 'in_work' ? b('work', 'Взяла в работу') : '', b('answer', x.type === 'question' ? 'Ответить' : 'Написать учителю', false), b('done', 'Решено лично'), b('to-engineer', 'Передать инженеру')].join('');
    }
    const urgency = `<span class="ikt-card__urgency" role="group" aria-label="Срочность">${Object.entries(ict.URGENCY).map(([k, u]) => `<button type="button" data-urgency="${k}" aria-pressed="${x.urgency === k}" title="${esc(u.label)}">${u.mark}</button>`).join('')}</span>`;
    return urgency + b('self-done', 'Решила сама', false) + b('to-me', 'Передать себе');
  }

  function cardMarkup(x) {
    const u = ict.URGENCY[x.urgency] || ict.URGENCY.white, open = ict.isOpen(x);
    const where = x.type === 'tech' ? `${/^\d/.test(x.room) ? 'Каб. ' : ''}${x.room} · ${x.device}` : `${x.device}${x.room ? ` · каб. ${x.room}` : ''}`;
    const engineerNote = (x.type === 'tech' && x.executor === 'engineer' ? `<span class="ikt-card__meta">исполнитель: инженер (суббота)</span>` : x.executor === 'ikt' ? '<span class="ikt-card__meta">исполнитель: вы</span>' : '')
      + (x.notified === 'нет' ? '<span class="ikt-card__warn">Учитель не подключил MAX — ответ или результат до него не дошёл, сообщите лично</span>' : x.notified === 'да' ? '<span class="ikt-card__meta">✓ учитель получил ответ в MAX</span>' : '');
    const comment = x.comment ? `<div class="ikt-card__comment"><b>${x.executor === 'engineer' && x.type === 'tech' ? 'Комментарий' : 'Ответ учителю'}</b>${esc(x.comment)}</div>` : '';
    const photo = x.hasPhoto ? `<div class="ikt-card__photo" data-photo-box>${state.photos.has(x.id) ? `<img src="${state.photos.get(x.id)}" alt="Фото к заявке №${esc(x.id)}" data-photo-open>` : '<button class="btn btn--ghost btn--sm" type="button" data-act="photo">📷 Показать фото</button>'}</div>` : '';
    const history = (x.history || []).map((h) => `<li>${esc(dateTime(h.at))} · ${esc(h.by)}: ${esc(h.what)}</li>`).join('');
    const answerOpen = state.open.has(x.id);
    return `<article class="ikt-card ikt-card--${esc(x.urgency)}${open ? '' : ' is-closed'}" id="r${esc(x.id)}" data-id="${esc(x.id)}">
      <div class="ikt-card__top"><span class="ikt-card__id">№${esc(x.id)}</span><span title="${esc(u.label)}">${u.mark}</span><span class="badge">${esc(ict.TYPE[x.type] || x.type)}</span><span class="ikt-status ikt-status--${esc(x.status)}">${esc(ict.STATUS[x.status] || x.status)}</span>${x.postponedTo ? `<span class="ikt-card__meta">на ${esc(x.postponedTo.split('-').reverse().join('.'))}</span>` : ''}</div>
      <div class="ikt-card__where">${esc(where)}</div>
      <div class="ikt-card__meta">${esc(x.teacher)} · ${esc(dateTime(x.created))} · ${open ? `висит ${esc(ict.age(x.created))}` : `закрыта ${esc(dateTime(x.closed))}`}</div>
      <div class="ikt-card__text">${esc(x.text)}</div>
      ${photo}${comment}${engineerNote}
      ${answerOpen ? `<form class="ikt-answer" data-answer-form><label class="field__label" for="a${esc(x.id)}">${x.executor === 'ikt' && x.type === 'question' ? 'Ответ учителю' : 'Комментарий'}</label><textarea class="input" id="a${esc(x.id)}" maxlength="1000" data-answer-text>${esc(x.comment)}</textarea><p class="help-note">Учитель получит ответ в MAX сразу, если подключил бота. Если нет — на карточке появится отметка, сообщите лично.</p><div class="ikt-card__actions"><button class="btn btn--sm" type="submit">Сохранить</button><button class="btn btn--ghost btn--sm" type="button" data-act="cancel-answer">Не отправлять</button></div></form>` : `<div class="ikt-card__actions">${actionsMarkup(x)}</div>`}
      ${history ? `<details class="ikt-history"><summary>История (${(x.history || []).length})</summary><ol>${history}</ol></details>` : ''}
    </article>`;
  }

  function render() {
    if (state.stats) $('[data-stats]').innerHTML = statsMarkup(state.stats);
    $('[data-tabs]').innerHTML = TABS.map(([key, label]) => `<button type="button" class="chip" data-tab="${key}" aria-pressed="${state.tab === key}">${label}</button>`).join('');
    const list = visible();
    $('[data-list]').innerHTML = list.length ? list.map(cardMarkup).join('') : `<div class="ikt-empty">${state.tab === 'closed' && !state.closed ? 'Загружаем закрытые заявки…' : 'Заявок нет'}</div>`;
    focusHash();
  }

  let hashDone = '';
  function focusHash() {
    const id = location.hash.replace(/^#/, '');
    if (!/^\d{1,6}$/.test(id) || hashDone === id) return;
    const card = document.getElementById(`r${id.padStart(4, '0')}`);
    if (!card) { if (state.tab !== 'closed' && state.items.length) { setTab('closed'); } return; }
    hashDone = id;
    card.classList.add('is-target');
    card.scrollIntoView({ block: 'start' });
  }

  /* Actions ------------------------------------------------------------------ */

  const snapshot = (x) => ({ status: x.status, executor: x.executor, urgency: x.urgency, comment: x.comment, postponedTo: x.postponedTo || '' });

  function replaceItem(item) {
    const swap = (list) => list && list.map((x) => (x.id === item.id ? item : x));
    state.items = swap(state.items);
    if (state.closed) state.closed = swap(state.closed);
    if (ict.isOpen(item) && !state.items.some((x) => x.id === item.id)) state.items.unshift(item);
    if (!ict.isOpen(item)) { state.items = state.items.filter((x) => x.id !== item.id); if (state.closed && !state.closed.some((x) => x.id === item.id)) state.closed.unshift(item); }
    else if (state.closed) state.closed = state.closed.filter((x) => x.id !== item.id);
  }

  async function update(x, change, message) {
    const before = snapshot(x);
    try {
      const r = await call('iktUpdate', { id: x.id, ...change });
      replaceItem(r.item);
      render();
      toast(message, async () => {
        const back = await call('iktUpdate', { id: x.id, ...before });
        replaceItem(back.item);
        render();
        toast('Отменено');
        refreshStats();
      });
      refreshStats();
    } catch (err) {
      toast(`Не сохранилось: ${err.message}`);
    }
  }
  async function refreshStats() {
    try { state.stats = (await call('iktStats')).stats; $('[data-stats]').innerHTML = statsMarkup(state.stats); } catch (_) {}
  }

  async function showPhoto(x) {
    try {
      const r = await call('iktPhoto', { id: x.id });
      state.photos.set(x.id, `data:${r.type};base64,${r.data}`);
      render();
    } catch (err) {
      toast(`Фото не загрузилось: ${err.message}`);
    }
  }

  function onListClick(e) {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const all = [...state.items, ...(state.closed || [])], x = all.find((i) => i.id === card.dataset.id);
    if (!x) return;
    if (e.target.matches('[data-photo-open]')) { const w = window.open(); if (w) w.document.write(`<title>Фото №${esc(x.id)}</title><img src="${e.target.src}" style="max-width:100%">`); return; }
    const urgency = e.target.closest('[data-urgency]');
    if (urgency) { if (urgency.dataset.urgency !== x.urgency) update(x, { urgency: urgency.dataset.urgency }, `Срочность: ${ict.URGENCY[urgency.dataset.urgency].label.toLowerCase()}`); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'photo') return showPhoto(x);
    if (act === 'answer' || act === 'self-done') { state.open.add(x.id); state.pending = { id: x.id, act }; render(); card.querySelector('[data-answer-text]')?.focus(); return; }
    if (act === 'cancel-answer') { state.open.delete(x.id); render(); return; }
    if (act === 'work') return update(x, { status: 'in_work' }, `№${x.id} — в работе`);
    if (act === 'done') return update(x, { status: 'done' }, `№${x.id} — решено`);
    if (act === 'to-engineer') return update(x, { executor: 'engineer', status: 'transferred' }, `№${x.id} передана инженеру`);
    if (act === 'to-me') return update(x, { executor: 'ikt', status: 'transferred' }, `№${x.id} — теперь у вас`);
    if (act === 'reopen') return update(x, { status: 'in_work' }, `№${x.id} снова открыта`);
  }

  function onListSubmit(e) {
    if (!e.target.matches('[data-answer-form]')) return;
    e.preventDefault();
    const card = e.target.closest('[data-id]'), x = state.items.find((i) => i.id === card.dataset.id);
    if (!x) return;
    const text = e.target.querySelector('[data-answer-text]').value.trim();
    const selfDone = state.pending && state.pending.id === x.id && state.pending.act === 'self-done';
    if (!selfDone && !text) { toast('Напишите ответ'); return; }
    state.open.delete(x.id);
    state.pending = null;
    if (selfDone) update(x, { status: 'done', comment: text || x.comment }, `№${x.id} — решено`);
    else update(x, { status: x.type === 'question' ? 'answered' : x.status, comment: text }, x.type === 'question' ? `Ответ на №${x.id} сохранён` : `Комментарий к №${x.id} сохранён`);
  }

  let toastTimer = 0, undoFn = null;
  function toast(text, undo) {
    const box = $('[data-toast]'), btn = $('[data-toast-undo]');
    $('[data-toast-text]').textContent = text;
    undoFn = undo || null;
    btn.hidden = !undo;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; undoFn = null; }, undo ? 8000 : 3500);
  }

  function setTab(tab) {
    state.tab = tab;
    render();
    if (tab === 'closed' && !state.closed) call('iktList', { filter: { status: 'closed' } }).then((r) => { state.closed = r.items; render(); }).catch((err) => toast(err.message));
  }

  async function saveStaffPin(e) {
    e.preventDefault();
    const input = $('#ikt-staff-pin');
    try {
      await call('iktSetStaffPin', { pin: input.value.trim() });
      input.value = '';
      toast('PIN для учителей сохранён');
      refresh({ quiet: true });
    } catch (err) {
      toast(err.message);
    }
  }

  function startApp() {
    $('[data-login]').hidden = true;
    $('[data-app]').hidden = false;
    render();
    refresh();
    clearInterval(state.timer);
    state.timer = setInterval(() => refresh({ quiet: true }), REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('[data-login-form]').addEventListener('submit', login);
    $('[data-logout]').addEventListener('click', () => logout());
    $('[data-refresh]').addEventListener('click', () => refresh());
    $('[data-tabs]').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
    $('[data-stats]').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) setTab(b.dataset.go); });
    $('#ikt-search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
    $('[data-list]').addEventListener('click', onListClick);
    $('[data-list]').addEventListener('submit', onListSubmit);
    $('[data-toast-undo]').addEventListener('click', () => { const fn = undoFn; $('[data-toast]').hidden = true; undoFn = null; if (fn) fn().catch((err) => toast(`Не отменилось: ${err.message}`)); });
    $('[data-staff-pin-form]').addEventListener('submit', saveStaffPin);
    document.addEventListener('visibilitychange', stopBlink);
    window.addEventListener('focus', stopBlink);
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('hashchange', () => { hashDone = ''; focusHash(); });

    state.endpoint = await ict.findEndpoint(site, config).catch(() => '');
    if (!state.endpoint) { showLogin('Адрес сервера не найден в «Настройки_сайта» (appsScriptUrl).'); $('[data-login-btn]').disabled = true; return; }
    state.token = session.get();
    if (state.token) startApp(); else showLogin();
  });
})();
