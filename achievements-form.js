// achievements-form.html: учитель вносит участие и результаты учеников.
// Черновик формы (ФИО учеников, файлы дипломов) живёт только в памяти страницы: ни
// localStorage, ни sessionStorage. Мероприятие и дата остаются для следующей партии.
(() => {
  'use strict';
  const core = window.AchievementsCore, config = window.SCHOOL_CONFIG || {};
  if (!core) return;
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = core.createApi({ base: config.achievementsApi });
  const form = $('[data-form]');
  const state = { me: null, dict: null, staff: [], rows: [], nextKey: 1, contestId: null, year: core.schoolYearStart(), mine: [], editing: null, sending: false, loginMounted: false };

  const options = (list, selected = '', empty = '') => (empty ? `<option value="">${esc(empty)}</option>` : '') + list.map((v) => {
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
  function showError(text) {
    const el = $('[data-error]');
    el.textContent = text;
    el.hidden = !text;
    if (text) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* Вход ---------------------------------------------------------------------- */

  function showLogin(message) {
    $('[data-app]').hidden = true;
    if (message) { $('[data-login-error]').textContent = message; $('[data-login-error]').hidden = false; }
    if (state.loginMounted) { $('[data-login]').hidden = false; $('[data-login-pin]').focus(); return; }
    state.loginMounted = true;
    core.mountLogin(api, {
      section: $('[data-login]'), form: $('[data-login-form]'), select: $('[data-login-select]'),
      pin: $('[data-login-pin]'), error: $('[data-login-error]'), button: $('[data-login-btn]'),
    }, { onReady: (me) => ready(me) });
  }

  // Любой ответ 401 — сессия кончилась: просим войти снова, черновик формы остаётся.
  function handle(err) {
    if (err.status === 401) { showLogin('Сессия закончилась — войдите снова. Заполненная форма сохранится.'); return true; }
    return false;
  }

  async function ready(me) {
    const first = !state.me;
    state.me = me;
    $('[data-me]').textContent = me.short_name;
    $('[data-review-link]').hidden = !['checker', 'admin'].includes(me.role);
    $('[data-login]').hidden = true;
    $('[data-app]').hidden = false;
    if (!first) return;
    try {
      const [dict, staff] = await Promise.all([api.get('/dictionaries'), api.staffList()]);
      state.dict = dict;
      state.staff = staff.staff;
      state.year = dict.school_year;
      fillForm();
      addRow();
      loadMine();
      void preselectContest();
    } catch (err) {
      if (!handle(err)) showError(err.message);
    }
  }

  /* Мероприятие ---------------------------------------------------------------- */

  function fillForm() {
    const d = state.dict;
    form.elements.direction.innerHTML = options(d.directions, '', 'Выберите');
    form.elements.level.innerHTML = options(d.levels, '', 'Выберите');
    form.elements.form.innerHTML = options(d.forms, 'Очно');
    form.elements.supervisor_id.innerHTML = options(state.staff.map((s) => [s.id, s.id === state.me.id ? `${s.short_name} (я)` : s.short_name]), state.me.id);
    $('[data-same-result]').innerHTML = options(d.results, '', 'Выберите');
    const y = d.school_year;
    $('[data-year]').innerHTML = options([y, y - 1, y - 2].map((v) => [String(v), `${v}/${String(v + 1).slice(2)} учебный год`]), String(y));
    if (!d.contests.length) $('[data-event-note]').textContent = 'Впишите название мероприятия.';
  }

  const ddmmyyyy = (s) => { const m = String(s || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''); };

  async function preselectContest() {
    const id = new URLSearchParams(window.location.search).get('contest');
    if (!id || !/^[\da-zA-Z_-]{1,64}$/.test(id)) return;
    try {
      const { contest } = await api.get('/contests/' + encodeURIComponent(id));
      if (!form.elements.event_name.value.trim() && contest.audience === 'students' && contest.status !== 'draft') pickContest(contest);
    } catch (err) {
      if (!handle(err) && !form.elements.event_name.value.trim()) {
        $('[data-event-note]').textContent = 'Не удалось подставить конкурс. Выберите его из списка или укажите название вручную.';
      }
    }
  }

  function pickContest(c) {
    const el = form.elements;
    el.event_name.value = c.name;
    state.contestId = c.id || null;
    if (c.direction) el.direction.value = c.direction;
    if (c.level) el.level.value = c.level;
    if (c.form) el.form.value = c.form;
    if (c.subject) el.subject.value = c.subject;
    const date = ddmmyyyy(c.event_date || c.date);
    if (date && !el.event_date.value) el.event_date.value = date;
    $('[data-suggest]').hidden = true;
    $('[data-event-note]').textContent = 'Из списка конкурсов школы — направление и уровень подставлены, их можно поправить.';
  }

  function onEventInput() {
    state.contestId = null;
    const list = core.matchContests(form.elements.event_name.value, state.dict ? state.dict.contests : []);
    const box = $('[data-suggest]');
    box.innerHTML = list.map((c, i) => `<button type="button" role="option" data-pick="${i}"><b>${esc(c.name)}</b><small>${esc([c.level, c.subject, c.date].filter(Boolean).join(' · '))}</small></button>`).join('')
      + (list.length ? '<button type="button" role="option" data-pick="-1"><small>Другое — оставить как вписано</small></button>' : '');
    box.hidden = !list.length;
    box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.pick);
      if (i >= 0) pickContest(list[i]); else box.hidden = true;
    }));
    $('[data-event-note]').textContent = form.elements.event_name.value.trim() ? 'Своё мероприятие — укажите направление и уровень.' : 'Выберите из списка конкурсов школы или впишите своё.';
  }

  /* Ученики ---------------------------------------------------------------------- */

  const sameResult = () => ($('[data-same-toggle]').checked ? $('[data-same-result]').value : null);

  function addRow(focus = false) {
    if (state.rows.length >= core.MAX_STUDENTS) { toast(`Не больше ${core.MAX_STUDENTS} учеников за раз`); return; }
    const prev = state.rows[state.rows.length - 1];
    state.rows.push({ key: state.nextKey++, student_name: '', class_name: prev ? prev.class_name : '', result: '', consent: false, diploma: null, diplomaName: '', error: '' });
    renderRows();
    if (focus) $(`[data-row="${state.rows.length - 1}"] [data-f="student_name"]`).focus();
  }

  function rowMarkup(r, i) {
    const d = state.dict, same = $('[data-same-toggle]').checked;
    return `<div class="ach-row${r.error ? ' has-error' : ''}" data-row="${i}">
      <div class="ach-row__head"><b>${i + 1}</b>${state.rows.length > 1 ? `<button class="btn btn--quiet btn--sm" type="button" data-remove aria-label="Убрать ученика ${i + 1}">Убрать</button>` : ''}</div>
      <div class="field ach-row__name"><label for="ach-n${r.key}">ФИО ученика</label><input class="input" id="ach-n${r.key}" data-f="student_name" value="${esc(r.student_name)}" maxlength="60" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Фамилия Имя Отчество"></div>
      <div class="field"><label for="ach-c${r.key}">Класс</label><select class="select" id="ach-c${r.key}" data-f="class_name">${options(d.classes, r.class_name, '—')}</select></div>
      <div class="field"${same ? ' hidden' : ''}><label for="ach-r${r.key}">Результат</label><select class="select" id="ach-r${r.key}" data-f="result">${options(d.results, r.result, 'Выберите')}</select></div>
      <label class="ach-check ach-row__consent"><input type="checkbox" data-f="consent"${r.consent ? ' checked' : ''}> Можно публиковать ФИО</label>
      <div class="ach-row__diploma">${r.diploma
        ? `<span class="ach-file">📎 ${esc(r.diplomaName)}</span><button class="btn btn--quiet btn--sm" type="button" data-diploma-remove>убрать</button>`
        : `<label class="help-photo ach-photo"><input type="file" accept="image/*,application/pdf" data-diploma hidden><span aria-hidden="true">📷</span> Диплом: фото или файл</label>`}</div>
      <p class="ach-row__error" role="alert"${r.error ? '' : ' hidden'}>${esc(r.error)}</p>
    </div>`;
  }

  function renderRows() {
    const box = $('[data-rows]');
    box.innerHTML = state.rows.map(rowMarkup).join('');
    box.querySelectorAll('[data-row]').forEach((el) => {
      const r = state.rows[Number(el.dataset.row)];
      el.querySelectorAll('[data-f]').forEach((input) => input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', () => {
        r[input.dataset.f] = input.type === 'checkbox' ? input.checked : input.value;
        if (r.error) { r.error = ''; el.classList.remove('has-error'); el.querySelector('.ach-row__error').hidden = true; }
      }));
      el.querySelector('[data-remove]')?.addEventListener('click', () => { state.rows.splice(Number(el.dataset.row), 1); renderRows(); });
      el.querySelector('[data-diploma-remove]')?.addEventListener('click', () => { r.diploma = null; r.diplomaName = ''; renderRows(); });
      el.querySelector('[data-diploma]')?.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const label = e.target.closest('label');
        label.lastChild.textContent = ' Обрабатываем…';
        try {
          r.diploma = await core.prepareDiploma(file);
          r.diplomaName = file.type === 'application/pdf' ? file.name : 'фото диплома';
        } catch (err) { r.error = err.message; }
        renderRows();
      });
    });
  }

  /* Отправка ------------------------------------------------------------------------ */

  function eventValues() {
    const el = form.elements;
    return { event_name: el.event_name.value, contest_id: state.contestId, direction: el.direction.value, level: el.level.value, form: el.form.value, subject: el.subject.value, event_date: el.event_date.value, supervisor_id: el.supervisor_id.value };
  }

  function markErrors(eventErrors, rowErrors) {
    form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    eventErrors.forEach((e) => form.elements[e.field]?.setAttribute('aria-invalid', 'true'));
    state.rows.forEach((r) => { r.error = ''; });
    rowErrors.forEach((e) => { if (e.row != null && state.rows[e.row] && !state.rows[e.row].error) state.rows[e.row].error = e.message; });
    renderRows();
  }

  async function submit(e) {
    e.preventDefault();
    if (state.sending || !state.dict) return;
    const ev = eventValues();
    const eventErrors = core.validateEvent(ev, state.dict);
    const same = sameResult();
    const rowErrors = core.validateRows(state.rows, { classes: state.dict.classes, results: state.dict.results, sameResult: same });
    markErrors(eventErrors, rowErrors);
    const first = eventErrors[0] || rowErrors.find((x) => x.row == null) || rowErrors[0];
    if (first) { showError(first.message + (rowErrors.length + eventErrors.length > 1 ? ' (и ещё ошибки — они отмечены)' : '')); return; }
    showError('');
    const { payload, rowIndexes } = core.buildPayload(ev, state.rows, { sameResult: same || '', me: state.me.id });
    state.sending = true;
    const button = $('[data-send]');
    button.disabled = true;
    button.textContent = 'Записываем…';
    try {
      const res = await api.post('/records', payload);
      let uploaded = 0, failed = 0;
      const withDiploma = rowIndexes.map((rowIndex, k) => [state.rows[rowIndex], res.ids[k]]).filter(([r]) => r.diploma);
      for (const [n, [r, id]] of withDiploma.entries()) {
        button.textContent = `Загружаем дипломы ${n + 1} из ${withDiploma.length}…`;
        try { await api.uploadDiploma(id, r.diploma); uploaded += 1; } catch (_) { failed += 1; }
      }
      done(res.created, uploaded, failed);
    } catch (err) {
      if (!handle(err)) {
        if (err.errors && err.errors.length) markErrors(err.errors.filter((x) => x.row == null && x.field), err.errors.filter((x) => x.row != null).map((x) => ({ ...x, row: rowIndexes[x.row] })));
        showError(err.message);
      }
    } finally {
      state.sending = false;
      button.disabled = false;
      button.textContent = 'Записать';
    }
  }

  function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; }

  function done(created, uploaded, failed) {
    const box = $('[data-done]');
    box.innerHTML = `<b>✓ Записано ${created} ${plural(created, 'ученик', 'ученика', 'учеников')}</b>`
      + (uploaded ? `<span>Дипломов загружено: ${uploaded}.</span>` : '')
      + (failed ? `<span class="ach-warn">Не загрузились дипломы: ${failed}. Добавьте их в «Моих записях» ниже.</span>` : '')
      + '<span>Мероприятие и дата остались — можно вносить следующих учеников.</span>';
    box.hidden = false;
    // Очищаем только учеников; ФИО больше нигде не остаются.
    state.rows = [];
    addRow();
    box.focus();
    loadMine();
  }

  /* Мои записи ------------------------------------------------------------------------- */

  async function loadMine() {
    const list = $('[data-mine]');
    try {
      const data = await api.get(`/records/mine?year=${state.year}`);
      state.mine = core.sortMine(data.records);
      renderMine();
    } catch (err) {
      if (!handle(err)) list.innerHTML = `<div class="ikt-empty">${esc(err.message)}</div>`;
    }
  }

  function cardMarkup(r) {
    const editing = state.editing === r.id;
    const role = r.author_id === state.me.id ? (r.supervisor_id !== state.me.id ? `руководитель ${r.supervisor_name}` : '') : `внёс ${r.author_name}`;
    const canDiploma = r.status !== 'checked' && (r.author_id === state.me.id || r.supervisor_id === state.me.id);
    return `<article class="ach-card ach-card--${r.status}" data-id="${esc(r.id)}">
      <div class="ach-card__top"><span class="ach-status ach-status--${r.status}">${esc(core.STATUS[r.status])}</span><span class="ikt-card__meta">${esc(core.ruDate(r.event_date))} · ${esc(r.level)}</span></div>
      <div class="ach-card__event">${esc(r.event_name)}</div>
      <div class="ach-card__who"><b>${esc(r.student_name)}</b>, ${esc(r.class_name)} — ${esc(r.result)}</div>
      <div class="ikt-card__meta">${esc([r.direction, r.subject, role, r.consent ? 'ФИО можно публиковать' : 'без публикации ФИО', r.has_diploma ? 'диплом есть' : 'без диплома'].filter(Boolean).join(' · '))}</div>
      ${r.status === 'returned' && r.return_comment ? `<div class="ach-card__comment"><b>Что исправить:</b> ${esc(r.return_comment)}</div>` : ''}
      ${editing ? editMarkup(r) : `<div class="ikt-card__actions">
        ${r.can_edit ? '<button class="btn btn--ghost btn--sm" type="button" data-edit>Изменить</button><button class="btn btn--ghost btn--sm" type="button" data-delete>Удалить</button>' : ''}
        ${r.has_diploma ? '<button class="btn btn--ghost btn--sm" type="button" data-open-diploma>Диплом</button>' : ''}
        ${canDiploma ? `<label class="btn btn--ghost btn--sm"><input type="file" accept="image/*,application/pdf" data-card-diploma hidden>${r.has_diploma ? 'Заменить диплом' : 'Добавить диплом'}</label>` : ''}
      </div>`}
    </article>`;
  }

  function editMarkup(r) {
    const d = state.dict;
    return `<form class="ach-edit" data-edit-form novalidate>
      <div class="field"><label>Мероприятие</label><input class="input" name="event_name" maxlength="200" value="${esc(r.event_name)}"></div>
      <div class="ach-grid">
        <div class="field"><label>Дата</label><input class="input" name="event_date" type="date" value="${esc(r.event_date)}"></div>
        <div class="field"><label>Уровень</label><select class="select" name="level">${options(d.levels, r.level)}</select></div>
        <div class="field ach-row__name"><label>ФИО ученика</label><input class="input" name="student_name" maxlength="60" value="${esc(r.student_name)}" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label>Класс</label><select class="select" name="class_name">${options(d.classes, r.class_name)}</select></div>
        <div class="field"><label>Результат</label><select class="select" name="result">${options(d.results, r.result)}</select></div>
      </div>
      <label class="ach-check"><input type="checkbox" name="consent"${r.consent ? ' checked' : ''}> Можно публиковать ФИО</label>
      <div class="help-error" data-edit-error role="alert" hidden></div>
      <div class="ikt-card__actions"><button class="btn btn--sm" type="submit">Сохранить${r.status === 'returned' ? ' и отправить на проверку' : ''}</button><button class="btn btn--ghost btn--sm" type="button" data-cancel>Отмена</button></div>
    </form>`;
  }

  function renderMine() {
    const list = $('[data-mine]');
    if (!state.mine.length) { list.innerHTML = '<div class="ikt-empty">За этот учебный год записей пока нет.</div>'; return; }
    const returned = state.mine.filter((r) => r.status === 'returned').length;
    list.innerHTML = (returned ? `<div class="ach-returned-note">Возвращено на исправление: ${returned}</div>` : '') + state.mine.map(cardMarkup).join('');
    list.querySelectorAll('[data-id]').forEach((card) => {
      const r = state.mine.find((x) => x.id === card.dataset.id);
      card.querySelector('[data-edit]')?.addEventListener('click', () => { state.editing = r.id; renderMine(); card.ownerDocument.querySelector(`[data-id="${r.id}"] input`)?.focus(); });
      card.querySelector('[data-cancel]')?.addEventListener('click', () => { state.editing = null; renderMine(); });
      card.querySelector('[data-edit-form]')?.addEventListener('submit', (e) => saveEdit(e, r));
      card.querySelector('[data-delete]')?.addEventListener('click', () => remove(r));
      card.querySelector('[data-open-diploma]')?.addEventListener('click', () => openDiploma(r.id));
      card.querySelector('[data-card-diploma]')?.addEventListener('change', (e) => cardDiploma(e, r));
    });
  }

  async function saveEdit(e, r) {
    e.preventDefault();
    const f = e.target, el = f.elements;
    const body = { event_name: el.event_name.value, event_date: el.event_date.value, level: el.level.value, student_name: core.normalizeName(el.student_name.value), class_name: el.class_name.value, result: el.result.value, consent: el.consent.checked };
    const err = core.studentNameError(body.student_name) || (!body.event_name.trim() ? 'Укажите мероприятие' : '');
    const box = $('[data-edit-error]', f);
    if (err) { box.textContent = err; box.hidden = false; return; }
    try {
      await api.put(`/records/${r.id}`, body);
      state.editing = null;
      toast(r.status === 'returned' ? 'Исправлено и отправлено на проверку' : 'Сохранено');
      loadMine();
    } catch (x) {
      if (!handle(x)) { box.textContent = x.errors && x.errors[0] ? x.errors[0].message : x.message; box.hidden = false; }
    }
  }

  async function remove(r) {
    if (!window.confirm(`Удалить запись: ${r.student_name}, ${r.event_name}?`)) return;
    try { await api.del(`/records/${r.id}`); toast('Запись удалена'); loadMine(); } catch (err) { if (!handle(err)) toast(err.message); }
  }

  async function openDiploma(id) {
    const win = window.open('about:blank', '_blank');
    try {
      const { url } = await api.get(`/records/${id}/diploma`);
      if (win) win.location.href = url; else window.location.href = url;
    } catch (err) { if (win) win.close(); if (!handle(err)) toast(err.message); }
  }

  async function cardDiploma(e, r) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    toast('Загружаем диплом…');
    try {
      await api.uploadDiploma(r.id, await core.prepareDiploma(file));
      toast('Диплом загружен');
      loadMine();
    } catch (err) { if (!handle(err)) toast(err.message); }
  }

  /* Запуск --------------------------------------------------------------------------- */

  function boot() {
    if (!config.achievementsApi) {
      const box = $('[data-broken]');
      box.textContent = 'Сервис достижений ещё не подключён. Обратитесь к администратору сайта.';
      box.hidden = false;
      return;
    }
    $('[data-logout]').addEventListener('click', () => { api.logout(); window.location.reload(); });
    $('[data-add-row]').addEventListener('click', () => addRow(true));
    $('[data-same-toggle]').addEventListener('change', (e) => { $('[data-same-wrap]').hidden = !e.target.checked; renderRows(); });
    $('[data-year]').addEventListener('change', (e) => { state.year = Number(e.target.value); loadMine(); });
    form.elements.event_name.addEventListener('input', onEventInput);
    form.elements.event_name.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('[data-suggest]').hidden = true; });
    document.addEventListener('click', (e) => { if (!e.target.closest('.ach-search')) $('[data-suggest]').hidden = true; });
    form.addEventListener('submit', submit);
    // Не потерять заполненную форму случайным закрытием вкладки.
    window.addEventListener('beforeunload', (e) => { if (state.rows.some((r) => !core.isBlankRow(r))) { e.preventDefault(); e.returnValue = ''; } });
    const session = api.current();
    if (session) ready(session.staff); else showLogin();
  }
  boot();
})();
