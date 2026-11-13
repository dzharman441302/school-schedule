// Страница дежурного «Опоздания» (late.html): после звонка дежурный администратор нажимает
// класс каждого опоздавшего. Нажатия сразу видны на экране и копятся в очереди на телефоне;
// очередь уходит в панель замен (Apps Script, lateness: Lateness.gs), а без связи ждёт и
// отправляется позже. Каждое нажатие имеет свой id, поэтому повторная отправка не удваивает.
(() => {
  'use strict';
  const site = window.SchoolSite, core = window.ScheduleCore, late = window.LatenessCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !core || !late) return;

  const STORE = { pin: 'school20:late:pin', who: 'school20:late:who', queue: 'school20:late:queue', undo: 'school20:late:undo', shift: 'school20:late:shift' };
  const $ = (id) => document.getElementById(id);
  const esc = site.escapeHtml;
  const classes = (config.classes || []).map(site.normalizeClass).filter(Boolean);
  const DUTY = config.lateness?.duty || {};
  const OTHER = '__other__';

  let endpoint = '';
  let server = { date: '', counts: {}, closed: [] };
  let queue = readJson(STORE.queue, []);     // events not yet confirmed by the server
  let undo = readJson(STORE.undo, []);       // this phone's taps today, last one first out
  let shift = 1, sending = false, failed = false, retry = 0, scheduleRows = [];

  function readJson(key, fallback) { try { const v = JSON.parse(site.storageGet(key) || 'null'); return v ?? fallback; } catch (_) { return fallback; } }
  const save = () => { site.storageSet(STORE.queue, JSON.stringify(queue)); site.storageSet(STORE.undo, JSON.stringify(undo)); };

  // Who signs the marks of a shift today: the duty administrator from the timetable (config.js),
  // unless someone else was chosen on this phone for today (a substitution).
  function scheduled(forShift) {
    const day = site.getSchoolToday().getUTCDay();
    return day >= 1 && day <= 5 ? String(DUTY[forShift]?.[day - 1] || '') : '';
  }
  function whoFor(forShift) {
    const o = readJson(STORE.who, null);
    return (o && o.date === todayIso() && o[forShift]) || scheduled(forShift);
  }
  function setWho(forShift, name) {
    const o = readJson(STORE.who, null);
    const next = o && o.date === todayIso() ? o : { date: todayIso() };
    if (name === scheduled(forShift)) delete next[forShift]; else next[forShift] = name;
    site.storageSet(STORE.who, JSON.stringify(next));
  }
  function renderWho() {
    const sel = $('who'), current = whoFor(shift);
    const names = [...new Set([...(DUTY[1] || []), ...(DUTY[2] || []), current].filter(Boolean))];
    sel.innerHTML = (current ? '' : '<option value="" selected>Кто дежурит?</option>')
      + names.map((n) => `<option value="${esc(n)}"${n === current ? ' selected' : ''}>${esc(n)}</option>`).join('')
      + `<option value="${OTHER}">Другой человек…</option>`;
    const plan = scheduled(shift);
    $('duty').textContent = !plan ? 'Сегодня по графику дежурства нет — выберите себя в списке вверху.'
      : current === plan ? `По графику дежурит ${plan.replace(/\.$/, '')}. Если вы заменяете — выберите себя в списке вверху.`
      : `Сегодня дежурит ${current} (по графику — ${plan})`;
  }

  function todayIso() {
    const d = site.getSchoolToday();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function nowTime() {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: config.timeZone || 'Europe/Moscow', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date());
  }
  function nowMinutes() {
    const [h, m] = nowTime().split(':').map(Number);
    return h * 60 + m;
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /* Talking to the panel --------------------------------------------- */

  async function findEndpoint() {
    const rows = await site.loadSheet(config.googleSheets?.sheets?.siteSettings || 'Настройки_сайта', { optional: true, ttl: 60 * 60 * 1000 });
    const r = rows?.slice(1).find((x) => String(x[0] || '') === 'appsScriptUrl');
    const url = String(r?.[1] || '');
    return /^https:\/\/script\.google\.com\//.test(url) ? url : '';
  }

  // The body goes as text/plain: no CORS preflight, and Apps Script answers with JSON.
  async function post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ action: 'late', ...body }), signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function applyServer(r) {
    if (r.date !== todayIso()) return;
    server = { date: r.date, counts: r.counts || {}, closed: r.closed || [] };
  }

  async function flush(extra = {}) {
    if (sending || !endpoint) return;
    const pin = site.storageGet(STORE.pin), who = whoFor(extra.close || shift) || whoFor(1) || whoFor(2) || 'Дежурный';
    if (!pin) return;
    sending = true;
    const batch = queue.slice(0, 200);
    try {
      const r = await post({ pin, who, date: todayIso(), events: batch, ...extra });
      if (!r.ok) {
        if (r.pin) { logout(r.error); return; }
        throw new Error(r.error || 'ошибка');
      }
      const done = new Set(r.accepted || []);
      queue = queue.filter((e) => !done.has(e.id));
      save();
      applyServer(r);
      failed = false;
      retry = 0;
      if (extra.close) toast('Смена закрыта. Спасибо!');
    } catch (err) {
      failed = true;
      retry = Math.min(60000, (retry || 2500) * 2);
      setTimeout(() => flush(), retry);
      if (extra.close) toast('Нет связи — нажмите ещё раз позже');
    } finally {
      sending = false;
      render();
      if (queue.length && !failed) setTimeout(() => flush(), 300);
    }
  }

  /* Taps --------------------------------------------------------------- */

  function counts() {
    const today = todayIso(), out = { ...(server.date === today ? server.counts : {}) };
    queue.filter((e) => e.date === today).forEach((e) => { out[e.cls] = Math.max(0, (out[e.cls] || 0) + e.delta); });
    return out;
  }

  function tap(cls) {
    const today = todayIso();
    queue.push({ id: newId(), date: today, cls, delta: 1, time: nowTime(), who: whoFor(late.shiftOf(cls)) });
    undo = undo.filter((u) => u.date === today).concat([{ date: today, cls }]).slice(-50);
    save();
    try { navigator.vibrate?.(30); } catch (_) {}
    render(cls);
    clearTimeout(tap.timer);
    tap.timer = setTimeout(() => flush(), 400);
  }

  function undoLast() {
    const today = todayIso();
    undo = undo.filter((u) => u.date === today);
    const last = undo.pop();
    if (!last) return;
    queue.push({ id: newId(), date: today, cls: last.cls, delta: -1, time: nowTime(), who: whoFor(late.shiftOf(last.cls)) });
    save();
    toast(`Отменено: ${last.cls}`);
    render();
    flush();
  }

  /* Screen --------------------------------------------------------------- */

  function groups(forShift) {
    const map = new Map();
    classes.filter((c) => late.shiftOf(c) === forShift).forEach((c) => {
      const g = c.match(/^\d+/)[0], key = g === '10' || g === '11' ? '10–11' : g;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });
    return [...map.entries()];
  }

  function render(flash) {
    const c = counts(), today = todayIso();
    $('day').textContent = site.capitalize(site.formatSchoolDate(site.getSchoolToday(), { weekday: true, year: false }));
    renderWho();
    document.querySelectorAll('[data-shift]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.shift) === shift));
    [1, 2].forEach((s) => {
      const total = classes.filter((x) => late.shiftOf(x) === s).reduce((sum, x) => sum + (c[x] || 0), 0);
      const grades = groups(s).map(([g]) => g).join(', ');
      $(`tab${s}`).textContent = total ? `${grades} · опозданий ${total}` : grades;
    });
    $('classes').innerHTML = groups(shift).map(([g, list]) => `<section class="grade"><h2>${esc(g)} классы</h2><div class="grid">${list.map((x) => `<button class="cls${x === flash ? ' is-flash' : ''}" type="button" data-cls="${esc(x)}">${esc(x)}${c[x] ? `<b>${c[x]}</b>` : ''}</button>`).join('')}</div></section>`).join('');
    if (flash) setTimeout(() => document.querySelector(`[data-cls="${CSS.escape(flash)}"]`)?.classList.remove('is-flash'), 250);

    const isClosed = server.date === today && server.closed.includes(shift);
    $('closed').hidden = !isClosed;
    $('closed').textContent = `${shift} смена закрыта. Если кто-то ещё опоздал — всё равно отмечайте.`;
    $('close').textContent = isClosed ? '✓ Смена закрыта' : '✓ Дежурство завершено';
    $('close').classList.toggle('btn--ok', isClosed);
    $('close').classList.toggle('btn--main', !isClosed);
    $('close').disabled = isClosed;
    $('undo').disabled = !undo.some((u) => u.date === today);

    const sync = $('sync'), waiting = queue.length;
    sync.classList.toggle('is-wait', waiting > 0 && !failed);
    sync.classList.toggle('is-bad', failed);
    sync.textContent = failed
      ? `Нет связи · не отправлено: ${waiting}. Отметки сохранены на телефоне и уйдут сами`
      : waiting ? `Отправляем… (${waiting})` : 'Все отметки отправлены';
  }

  // Second shift once its first lesson is less than half an hour away; else the first.
  function defaultShift() {
    const saved = readJson(STORE.shift, null);
    if (saved && saved.date === todayIso()) return saved.shift;
    const n = late.firstLesson(scheduleRows, [], site.getSchoolToday(), classes, 2);
    const start = n && core.bellStart(n, site.getSchoolToday());
    const at = start ? core.toMin(start) - 30 : 12 * 60;
    return nowMinutes() >= at ? 2 : 1;
  }

  function show(view) {
    $('login').hidden = view !== 'login';
    $('app').hidden = view !== 'app';
    $('bar').hidden = view !== 'app';
    $('who').hidden = view !== 'app';
    $('broken').hidden = view !== 'broken';
  }

  function logout(message) {
    site.storageRemove(STORE.pin);
    $('pin').value = '';
    $('login-error').textContent = message || '';
    show('login');
  }

  async function login() {
    const pin = $('pin').value.trim();
    $('login-error').textContent = '';
    if (!/^\d{4,8}$/.test(pin)) { $('login-error').textContent = 'ПИН — от 4 до 8 цифр'; return; }
    $('login-button').disabled = true;
    try {
      const r = await post({ pin, date: todayIso() });
      if (!r.ok) { $('login-error').textContent = r.error || 'Не получилось войти'; return; }
      site.storageSet(STORE.pin, pin);
      applyServer(r);
      show('app');
      render();
      flush();
    } catch (_) {
      $('login-error').textContent = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
    } finally {
      $('login-button').disabled = false;
    }
  }

  function bind() {
    $('classes').addEventListener('click', (e) => { const b = e.target.closest('[data-cls]'); if (b) tap(b.dataset.cls); });
    document.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => {
      shift = Number(b.dataset.shift);
      site.storageSet(STORE.shift, JSON.stringify({ date: todayIso(), shift }));
      render();
    }));
    $('undo').addEventListener('click', undoLast);
    $('close').addEventListener('click', () => flush({ close: shift }));
    $('login-button').addEventListener('click', login);
    $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('who').addEventListener('change', () => {
      let name = $('who').value;
      if (name === OTHER) name = String(prompt('Кто дежурит? Фамилия и инициалы:', '') || '').trim();
      if (name.length >= 3) setWho(shift, name);
      render();
    });
    addEventListener('online', () => flush());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
    // Marks of the other duty administrator show up within half a minute.
    setInterval(() => { if (!document.hidden) flush(); }, 30000);
    setInterval(() => render(), 60000);
  }

  async function start() {
    bind();
    $('day').textContent = site.capitalize(site.formatSchoolDate(site.getSchoolToday(), { weekday: true, year: false }));
    try { await Promise.all([site.loadCalendar?.(), core.loadBells()]); } catch (_) {}
    try { scheduleRows = await site.loadSheet(config.googleSheets?.sheets?.schedule || 'Расписание', { optional: true }); } catch (_) {}
    shift = defaultShift();
    try { endpoint = await findEndpoint(); } catch (_) {}
    if (!endpoint) { show('broken'); return; }
    if (!site.storageGet(STORE.pin)) { logout(''); return; }
    show('app');
    render();
    flush();
  }

  start();
})();
