// achievements-review.html: кабинет ответственного за олимпиады (checker) и администратора.
// Очередь «На проверке», «Проверено» / «Вернуть», массовая отметка, реестр в Excel;
// у администратора — раздел «Педагоги»: роли и личные PIN.
(() => {
  'use strict';
  const core = window.AchievementsCore, config = window.SCHOOL_CONFIG || {};
  if (!core) return;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = core.createApi({ base: config.achievementsApi });
  const ROLE = { teacher: 'Учитель', checker: 'Проверяющий', admin: 'Администратор' };
  const TABS = [['new', 'На проверке'], ['returned', 'Возвращённые'], ['checked', 'Проверенные']];
  const state = { me: null, dict: null, staff: [], tab: 'new', year: core.schoolYearStart(), records: [], counts: {}, selected: new Set(), returning: null, adminStaff: [], loginMounted: false };

  const options = (list, selected = '', empty = '') => (empty !== '' ? `<option value="">${esc(empty)}</option>` : '') + list.map((v) => {
    const [value, label] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');

  let toastTimer = null;
  function toast(text) {
    $('[data-toast-text]').textContent = text;
    $('[data-toast]').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('[data-toast]').hidden = true; }, 4000);
  }

  function showLogin(message) {
    $('[data-app]').hidden = true;
    if (message) { $('[data-login-error]').textContent = message; $('[data-login-error]').hidden = false; }
    if (state.loginMounted) { $('[data-login]').hidden = false; return; }
    state.loginMounted = true;
    core.mountLogin(api, {
      section: $('[data-login]'), form: $('[data-login-form]'), select: $('[data-login-select]'),
      pin: $('[data-login-pin]'), error: $('[data-login-error]'), button: $('[data-login-btn]'),
    }, { onReady: (me) => ready(me) });
  }
  function handle(err) {
    if (err.status === 401) { showLogin('Сессия закончилась — войдите снова.'); return true; }
    toast(err.message);
    return false;
  }

  async function ready(me) {
    state.me = me;
    $('[data-login]').hidden = true;
    if (!['checker', 'admin'].includes(me.role)) { $('[data-denied]').hidden = false; return; }
    $('[data-me]').textContent = `${ROLE[me.role]} · ${me.short_name}`;
    $('[data-app]').hidden = false;
    if (state.dict) { loadRecords(); return; }
    try {
      const [dict, staff] = await Promise.all([api.get('/dictionaries'), api.staffList()]);
      state.dict = dict;
      state.staff = staff.staff;
      state.year = dict.school_year;
      const y = dict.school_year;
      $('[data-year]').innerHTML = options([y, y - 1, y - 2].map((v) => [String(v), `${v}/${String(v + 1).slice(2)}`]), String(y));
      $('[data-filter="level"]').innerHTML = options(dict.levels, '', 'Все уровни');
      $('[data-filter="class_name"]').innerHTML = options(dict.classes, '', 'Все классы');
      $('[data-filter="supervisor_id"]').innerHTML = options(state.staff.map((s) => [s.id, s.short_name]), '', 'Все руководители');
      renderTabs();
      loadRecords();
    } catch (err) { handle(err); }
  }

  function renderTabs() {
    const tabs = TABS.map(([key, label]) => [key, key === 'new' && state.counts.new != null ? `${label} · ${state.counts.new}` : label]);
    if (state.me.role === 'admin') tabs.push(['staff', 'Педагоги'], ['report', 'По руководителям']);
    $('[data-tabs]').innerHTML = tabs.map(([key, label]) => `<button class="chip" type="button" data-tab="${key}" aria-pressed="${key === state.tab}">${esc(label)}</button>`).join('');
    $('[data-tabs]').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.selected.clear();
      renderTabs();
      $('[data-records-view]').hidden = ['staff', 'report'].includes(state.tab);
      $('[data-staff-view]').hidden = state.tab !== 'staff';
      $('[data-report-view]').hidden = state.tab !== 'report';
      if (state.tab === 'staff') loadStaff(); else if (state.tab === 'report') loadReport(); else loadRecords();
    }));
  }

  /* Записи ---------------------------------------------------------------------- */

  function query() {
    const q = new URLSearchParams({ status: state.tab, year: String(state.year) });
    document.querySelectorAll('[data-filter]').forEach((el) => {
      const v = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value.trim();
      if (v) q.set(el.dataset.filter, v);
    });
    return q.toString();
  }

  async function loadRecords() {
    try {
      const data = await api.get(`/review?${query()}`);
      state.records = data.records;
      state.counts = data.counts;
      state.selected = new Set([...state.selected].filter((id) => data.records.some((r) => r.id === id)));
      $('[data-count]').textContent = `На проверке: ${data.counts.new} · возвращено: ${data.counts.returned} · проверено: ${data.counts.checked}`;
      renderTabs();
      renderRecords();
    } catch (err) { handle(err); }
  }

  function diplomaMarkup(r) {
    if (!r.has_diploma) return '<span class="ikt-card__warn">Без диплома</span>';
    if (!r.diploma_url) return '';
    if (core.isPdfUrl(r.diploma_url)) return '<button class="btn btn--ghost btn--sm" type="button" data-diploma>Диплом (PDF)</button>';
    return `<button class="ach-thumb" type="button" data-diploma aria-label="Открыть диплом"><img src="${esc(r.diploma_url)}" alt="" loading="lazy"></button>`;
  }

  function cardMarkup(r) {
    const bulk = state.tab !== 'checked';
    const author = r.author_id !== r.supervisor_id ? ` · внёс ${r.author_name}` : '';
    const returning = state.returning === r.id;
    return `<article class="ikt-card ach-card ach-card--${r.status}" data-id="${esc(r.id)}">
      <div class="ikt-card__top">
        ${bulk ? `<label class="ach-check"><input type="checkbox" data-pick${state.selected.has(r.id) ? ' checked' : ''} aria-label="Выбрать"></label>` : ''}
        <span class="ach-status ach-status--${r.status}">${esc(core.STATUS[r.status])}</span>
        <span class="ikt-card__meta">${esc(core.ruDate(r.event_date))} · ${esc(r.level)} · ${esc(r.form)}</span>
      </div>
      <div class="ach-review">
        <div class="ach-review__text">
          <div class="ach-card__event">${esc(r.event_name)}</div>
          <div class="ach-card__who"><b>${esc(r.student_name)}</b>, ${esc(r.class_name)} — ${esc(r.result)}</div>
          <div class="ikt-card__meta">${esc([r.direction, r.subject].filter(Boolean).join(' · '))}</div>
          <div class="ikt-card__meta">Руководитель ${esc(r.supervisor_name)}${esc(author)} · ${r.consent ? 'ФИО можно публиковать' : 'без публикации ФИО'}</div>
          ${r.return_comment ? `<div class="ach-card__comment"><b>Комментарий:</b> ${esc(r.return_comment)}</div>` : ''}
        </div>
        <div class="ach-review__diploma">${diplomaMarkup(r)}</div>
      </div>
      ${returning ? `<form class="ikt-answer" data-return-form><label class="field__label" for="rv-c-${esc(r.id)}">Что исправить (увидит учитель)</label><textarea class="input" id="rv-c-${esc(r.id)}" maxlength="500" required placeholder="Например: нет диплома; ФИО с ошибкой; уровень не муниципальный"></textarea><div class="ikt-card__actions"><button class="btn btn--sm" type="submit">Вернуть</button><button class="btn btn--ghost btn--sm" type="button" data-cancel>Отмена</button></div></form>`
        : `<div class="ikt-card__actions">
        ${r.status !== 'checked' ? '<button class="btn btn--sm" type="button" data-check>Проверено</button>' : ''}
        ${r.status !== 'returned' ? '<button class="btn btn--ghost btn--sm" type="button" data-return>Вернуть</button>' : ''}
      </div>`}
    </article>`;
  }

  function renderRecords() {
    const list = $('[data-list]');
    const bulk = state.tab !== 'checked' && state.records.length > 0;
    $('[data-bulk]').hidden = !bulk;
    $('[data-select-all]').checked = bulk && state.selected.size === state.records.length;
    $('[data-bulk-check]').disabled = !state.selected.size;
    $('[data-bulk-check]').textContent = state.selected.size ? `Проверено: выбранные (${state.selected.size})` : 'Проверено: выбранные';
    if (!state.records.length) {
      list.innerHTML = `<div class="ikt-empty">${state.tab === 'new' ? 'Новых записей на проверку нет.' : 'Записей нет.'}</div>`;
      return;
    }
    list.innerHTML = state.records.map(cardMarkup).join('');
    list.querySelectorAll('[data-id]').forEach((card) => {
      const r = state.records.find((x) => x.id === card.dataset.id);
      card.querySelector('[data-pick]')?.addEventListener('change', (e) => { if (e.target.checked) state.selected.add(r.id); else state.selected.delete(r.id); renderRecords(); });
      card.querySelector('[data-check]')?.addEventListener('click', () => review(r, 'check'));
      card.querySelector('[data-return]')?.addEventListener('click', () => { state.returning = r.id; renderRecords(); $(`[data-id="${r.id}"] textarea`)?.focus(); });
      card.querySelector('[data-cancel]')?.addEventListener('click', () => { state.returning = null; renderRecords(); });
      card.querySelector('[data-return-form]')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const comment = e.target.querySelector('textarea').value.trim();
        if (!comment) { e.target.querySelector('textarea').focus(); return; }
        review(r, 'return', comment);
      });
      card.querySelector('[data-diploma]')?.addEventListener('click', () => openDiploma(r));
    });
  }

  async function review(r, action, comment = '') {
    try {
      await api.post(`/review/${r.id}`, { action, comment });
      state.returning = null;
      state.selected.delete(r.id);
      toast(action === 'check' ? 'Проверено' : 'Возвращено учителю');
      loadRecords();
    } catch (err) { handle(err); }
  }

  async function bulkCheck() {
    const ids = [...state.selected];
    if (!ids.length) return;
    try {
      const res = await api.post('/review', { action: 'check', ids });
      state.selected.clear();
      toast(`Проверено: ${res.checked}${res.skipped ? `, пропущено: ${res.skipped}` : ''}`);
      loadRecords();
    } catch (err) { handle(err); }
  }

  // Свежая ссылка (живёт 5 минут) — при каждом открытии.
  async function openDiploma(r) {
    const pdf = r.diploma_url && core.isPdfUrl(r.diploma_url);
    const win = pdf ? window.open('about:blank', '_blank') : null;
    try {
      const { url } = await api.get(`/records/${r.id}/diploma`);
      if (pdf || core.isPdfUrl(url)) { if (win) win.location.href = url; else window.open(url, '_blank', 'noopener'); return; }
      $('[data-diploma-img]').src = url;
      $('[data-diploma-open]').href = url;
      $('[data-diploma-dialog]').showModal();
    } catch (err) { if (win) win.close(); handle(err); }
  }

  async function download(button, path, name) {
    button.disabled = true;
    try {
      const res = await api.file(path);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) { handle(err); } finally { button.disabled = false; }
  }
  const exportXlsx = () => download($('[data-export]'), `/export.xlsx?year=${state.year}`, `Реестр достижений ${state.year}-${state.year + 1}.xlsx`);

  // Выгрузка на Диск и публикация сами идут по таймеру; кнопки — «сейчас».
  async function runNow(button, path, okText) {
    button.disabled = true;
    const old = button.textContent;
    button.textContent = 'Подождите…';
    try { await api.post(path); toast(okText); } catch (err) { handle(err); } finally { button.disabled = false; button.textContent = old; }
  }

  /* Отчёт по руководителям (admin) ------------------------------------------------------ */

  function reportPeriod() {
    const f = $('[data-report-form]');
    if (!f.elements.from.value) {
      const now = new Date();
      f.elements.from.value = `${core.schoolYearStart(now)}-09-01`;
      f.elements.to.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    return new URLSearchParams({ from: f.elements.from.value, to: f.elements.to.value });
  }

  async function loadReport() {
    const box = $('[data-report-table]');
    try {
      const data = await api.get(`/report/supervisors?${reportPeriod()}`);
      box.innerHTML = data.rows.length ? `<div class="ach-report__scroll"><table class="ach-table"><thead><tr>${data.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${data.rows.map((r) => `<tr>${r.map((v, i) => (i ? `<td>${v}</td>` : `<th scope="row">${esc(v)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>`
        : '<div class="ikt-empty">За этот период записей нет.</div>';
    } catch (err) { handle(err); }
  }

  /* Педагоги (admin) ----------------------------------------------------------------- */

  async function loadStaff() {
    try {
      state.adminStaff = (await api.get('/admin/staff')).staff;
      renderStaff();
    } catch (err) { handle(err); }
  }

  function renderStaff() {
    const needle = $('[data-staff-search]').value.trim().toLowerCase();
    const items = state.adminStaff.filter((s) => !needle || s.short_name.toLowerCase().includes(needle));
    const box = $('[data-staff-list]');
    box.innerHTML = items.map((s) => `<div class="ach-staff__row${s.active ? '' : ' is-off'}" data-staff="${esc(s.id)}">
      <div><b>${esc(s.short_name)}</b><small>${esc(s.position || 'должность не указана')}${s.active ? '' : ' · отключён'}</small></div>
      <select class="select" data-role aria-label="Роль: ${esc(s.short_name)}"${s.id === state.me.id ? ' disabled' : ''}>${options(Object.entries(ROLE), s.role)}</select>
      <span class="ach-pin-state">${s.has_pin ? `PIN выдан ${esc(new Date(s.pin_set_at * 1000).toLocaleDateString('ru-RU'))}` : 'PIN нет'}</span>
      <button class="btn btn--ghost btn--sm" type="button" data-pin>${s.has_pin ? 'Сбросить PIN' : 'Выдать PIN'}</button>
    </div>`).join('') || '<div class="ikt-empty">Никого не нашли.</div>';
    box.querySelectorAll('[data-staff]').forEach((row) => {
      const s = state.adminStaff.find((x) => x.id === row.dataset.staff);
      row.querySelector('[data-role]').addEventListener('change', async (e) => {
        try { await api.put(`/admin/staff/${s.id}`, { role: e.target.value }); s.role = e.target.value; toast(`${s.short_name}: ${ROLE[s.role]}`); } catch (err) { e.target.value = s.role; handle(err); }
      });
      row.querySelector('[data-pin]').addEventListener('click', () => issuePin(s));
    });
  }

  async function issuePin(s) {
    if (s.has_pin && !window.confirm(`Выдать ${s.short_name} новый PIN? Старый перестанет работать.`)) return;
    try {
      const res = await api.post(`/admin/staff/${s.id}/pin`);
      $('[data-pin-who]').textContent = res.short_name;
      $('[data-pin-value]').textContent = `${res.pin.slice(0, 3)} ${res.pin.slice(3)}`;
      $('[data-pin-dialog]').showModal();
      s.has_pin = true;
      s.pin_set_at = Date.now() / 1000;
      renderStaff();
    } catch (err) { handle(err); }
  }

  /* Запуск ------------------------------------------------------------------------------ */

  function boot() {
    if (!config.achievementsApi) {
      const box = $('[data-broken]');
      box.textContent = 'Сервис достижений ещё не подключён (нет адреса achievementsApi в config.js).';
      box.hidden = false;
      return;
    }
    $('[data-logout]').addEventListener('click', () => { api.logout(); window.location.reload(); });
    $('[data-relogin]').addEventListener('click', () => { api.logout(); window.location.reload(); });
    $('[data-refresh]').addEventListener('click', () => (state.tab === 'staff' ? loadStaff() : state.tab === 'report' ? loadReport() : loadRecords()));
    $('[data-export]').addEventListener('click', exportXlsx);
    $('[data-export-disk]').addEventListener('click', (e) => runNow(e.currentTarget, '/admin/export-disk', 'Реестр выгружен на Яндекс Диск'));
    $('[data-publish]').addEventListener('click', (e) => runNow(e.currentTarget, '/admin/publish', 'Страница «Наши достижения» обновлена'));
    $('[data-report-form]').addEventListener('submit', (e) => { e.preventDefault(); loadReport(); });
    $('[data-report-xlsx]').addEventListener('click', (e) => { const q = reportPeriod(); download(e.currentTarget, `/report/supervisors?${q}&format=xlsx`, `Достижения по руководителям ${q.get('from')}—${q.get('to')}.xlsx`); });
    $('[data-year]').addEventListener('change', (e) => { state.year = Number(e.target.value); loadRecords(); });
    let timer = null;
    document.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', () => { clearTimeout(timer); timer = setTimeout(loadRecords, el.type === 'search' ? 350 : 0); }));
    $('[data-select-all]').addEventListener('change', (e) => { state.selected = new Set(e.target.checked ? state.records.map((r) => r.id) : []); renderRecords(); });
    $('[data-bulk-check]').addEventListener('click', bulkCheck);
    $('[data-staff-search]').addEventListener('input', renderStaff);
    // PIN исчезает с экрана вместе с окном.
    $('[data-pin-close]').addEventListener('click', () => { $('[data-pin-dialog]').close(); });
    $('[data-pin-dialog]').addEventListener('close', () => { $('[data-pin-value]').textContent = ''; });
    $('[data-diploma-close]').addEventListener('click', () => $('[data-diploma-dialog]').close());
    $('[data-diploma-dialog]').addEventListener('close', () => { $('[data-diploma-img]').removeAttribute('src'); });
    const session = api.current();
    if (session) ready(session.staff); else showLogin();
  }
  boot();
})();
