// Каталог и заявки в личном кабинете. Список участников хранится в памяти страницы.
(() => {
  'use strict';

  const core = window.AchievementsCore;
  const base = window.SCHOOL_CONFIG?.achievementsApi;
  if (!core) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const option = (value, label, selected = '') => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  const options = (values, selected) => values.map((value) => option(value, value, selected)).join('');
  const yearLabel = (year) => `${year}/${String(year + 1).slice(-2)}`;
  const date = (value) => core.ruDate(value) || 'уточняется';
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format();
  const appStatus = { submitted: 'На проверке', accepted: 'Принята', returned: 'Возвращена' };
  const statusStyle = { accepted: 'checked', returned: 'returned' };
  const catalogStatus = { draft: 'Черновик', published: 'Опубликовать и открыть приём', closed: 'Приём закрыт' };
  const api = core.createApi({ base });
  const state = { me: null, data: null, year: null, view: 'catalog', request: 0, loginMounted: false, busy: false };
  const dialog = $('[data-dialog]');

  const isManager = () => ['checker', 'admin'].includes(state.me?.role);
  const endpoint = (contest) => '/contests/' + encodeURIComponent(contest.id);

  function message(node, text) {
    node.textContent = text;
    node.hidden = !text;
  }

  function errorText(error) {
    const detail = error.errors?.[0];
    return detail?.message ? `${Number.isInteger(detail.row) ? `Строка ${detail.row + 1}. ` : ''}${detail.message}` : error.message;
  }

  function showLogin(notice) {
    state.request += 1;
    state.me = state.data = null;
    state.year = null;
    state.busy = false;
    if (dialog.open) dialog.close();
    $('[data-dialog-content]').replaceChildren();
    $('[data-contest-list]').replaceChildren();
    $('[data-app]').hidden = true;
    if (state.loginMounted) {
      $('[data-login]').hidden = false;
      $('[data-login-pin]').focus();
    } else {
      state.loginMounted = true;
      core.mountLogin(api, {
        section: $('[data-login]'), form: $('[data-login-form]'), select: $('[data-login-select]'),
        pin: $('[data-login-pin]'), error: $('[data-login-error]'), button: $('[data-login-btn]'),
      }, { onReady: ready });
    }
    if (notice) message($('[data-login-error]'), notice);
  }

  function requireLogin(error) {
    if (error.status !== 401) return false;
    showLogin('Сессия закончилась. Войдите снова.');
    return true;
  }

  function ready(me) {
    state.me = me;
    state.view = 'catalog';
    $('[data-me]').textContent = me.short_name;
    $('[data-scope]').value = isManager() ? 'all' : 'open';
    $('[data-login]').hidden = true;
    $('[data-app]').hidden = false;
    void loadCatalog();
  }

  async function loadCatalog(year = state.year, notice = '') {
    const request = ++state.request;
    const list = $('[data-contest-list]');
    state.year = year;
    $('[data-create]').hidden = !isManager();
    $('[data-create]').disabled = true;
    $('[data-reload-catalog]').disabled = true;
    $('[data-catalog-error]').hidden = true;
    message($('[data-notice]'), 'Загружаем конкурсы…');
    list.setAttribute('aria-busy', 'true');
    list.replaceChildren();
    try {
      const data = await api.get('/contests' + (year ? '?year=' + encodeURIComponent(year) : ''));
      if (request !== state.request) return;
      state.data = data;
      state.year = data.school_year;
      const current = data.current_year || data.school_year;
      const years = [...new Set([current + 1, current, current - 1, current - 2, state.year])].sort((a, b) => b - a);
      $('[data-year]').innerHTML = years.map((value) => option(value, yearLabel(value), state.year)).join('');
      const classFilter = $('[data-class]');
      classFilter.innerHTML = option('', 'Все участники') + option('staff', 'Педагоги', classFilter.value) + options(data.classes, classFilter.value);
      for (const control of [$('[data-year]'), classFilter, $('[data-scope]'), $('[data-create]')]) control.disabled = false;
      renderCatalog();
      message($('[data-notice]'), notice);
    } catch (error) {
      if (request !== state.request || requireLogin(error)) return;
      state.data = null;
      $('[data-catalog-error]').hidden = false;
      $('[data-error-text]').textContent = errorText(error);
      message($('[data-notice]'), notice);
    } finally {
      if (request === state.request) {
        list.removeAttribute('aria-busy');
        $('[data-reload-catalog]').disabled = false;
      }
    }
  }

  function safeLink(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\]/.test(value)) return '';
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch (_) {}
    return '';
  }

  function statusBadge(application) {
    return `<span class="ach-status ach-status--${statusStyle[application.status] || 'new'}">${esc(appStatus[application.status] || application.status)}</span>`;
  }

  function commentMarkup(application) {
    return application.return_comment ? `<p class="ikt-card__comment"><b>Комментарий ответственного</b>${esc(application.return_comment)}</p>` : '';
  }

  function card(contest, now) {
    const mine = contest.mine;
    const url = safeLink(contest.regulation_url);
    const status = contest.registration_open ? 'Приём открыт' : contest.status === 'draft' ? 'Черновик' : 'Приём завершён';
    const results = contest.status !== 'draft' && contest.audience === 'students'
      && !contest.registration_open && (contest.status === 'closed' || (contest.event_date && contest.event_date <= now));
    return `<article class="ikt-card contest-card">
      <div class="ikt-card__top">
        <span class="ikt-status ${contest.registration_open ? 'ikt-status--done' : ''}">${status}</span>
        ${contest.required ? '<span class="ikt-status ikt-status--in_work">Обязательное участие</span>' : ''}
        ${mine ? statusBadge(mine) : ''}
      </div>
      <h2>${esc(contest.name)}</h2>
      <p>${esc(contest.audience === 'staff' ? 'Для педагогов' : 'Классы: ' + contest.classes.join(', '))}</p>
      <p class="ikt-card__meta">${esc([contest.direction, contest.level, contest.form, contest.subject].filter(Boolean).join(' · '))}</p>
      <p class="ikt-card__meta">Приём до ${esc(date(contest.deadline))} включительно · Дата проведения: ${esc(date(contest.event_date))}</p>
      ${mine ? `<p class="ikt-card__meta">Участников в вашей заявке: ${mine.students.length}</p>${commentMarkup(mine)}` : ''}
      <div class="ikt-card__actions">
        ${url ? `<a class="btn btn--ghost btn--sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Открыть положение</a>` : ''}
        ${contest.registration_open && !mine ? `<button class="btn btn--sm" type="button" data-action="apply" data-id="${esc(contest.id)}">Подать заявку</button>` : ''}
        ${mine ? `<button class="btn btn--ghost btn--sm" type="button" data-action="apply" data-id="${esc(contest.id)}">Моя заявка</button>` : ''}
        ${results ? `<a class="btn btn--ghost btn--sm" href="achievements-form.html?contest=${encodeURIComponent(contest.id)}">Внести результат</a>` : ''}
        ${isManager() ? `<button class="btn btn--ghost btn--sm" type="button" data-action="edit" data-id="${esc(contest.id)}">Редактировать</button>
          ${contest.status !== 'draft' ? `<button class="btn btn--ghost btn--sm" type="button" data-action="review" data-id="${esc(contest.id)}">Заявки</button>` : ''}` : ''}
      </div>
    </article>`;
  }

  function renderCatalog() {
    const mine = state.view === 'mine';
    for (const button of $$('[data-view]')) {
      const active = button.dataset.view === state.view;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('btn--ghost', !active);
    }
    $('[data-scope]').closest('.field').hidden = mine;
    if (!state.data) return;

    const className = $('[data-class]').value;
    const scope = $('[data-scope]').value;
    const contests = state.data.contests.filter((contest) => {
      if (className === 'staff' && contest.audience !== 'staff') return false;
      if (className && className !== 'staff' && (contest.audience !== 'students' || !contest.classes.includes(className))) return false;
      if (mine) return Boolean(contest.mine);
      if (scope === 'open') return contest.registration_open;
      if (scope === 'closed') return !contest.registration_open && contest.status !== 'draft';
      return true;
    });
    const now = today();
    $('[data-contest-list]').innerHTML = contests.length ? contests.map((contest) => card(contest, now)).join('')
      : `<p class="ikt-empty">${mine ? 'В этом учебном году заявок по выбранным фильтрам пока нет.' : 'По выбранным фильтрам конкурсов пока нет.'}</p>`;
  }

  function openDialog(title, content) {
    $('[data-dialog-title]').textContent = title;
    $('[data-dialog-content]').innerHTML = content;
    message($('[data-dialog-error]'), '');
    if (!dialog.open) dialog.showModal();
    if (state.busy) setBusy(true);
  }

  function setBusy(busy) {
    state.busy = busy;
    $('[data-dialog-close]').disabled = busy;
    const fieldset = $('[data-dialog-fields]');
    if (fieldset) fieldset.disabled = busy;
    dialog.setAttribute('aria-busy', String(busy));
  }

  async function run(action) {
    if (state.busy) return;
    message($('[data-dialog-error]'), '');
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!requireLogin(error)) message($('[data-dialog-error]'), errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function classChecks(selected) {
    const grades = new Map();
    for (const value of state.data.classes) {
      const grade = value.match(/^\d+/)?.[0] || value;
      if (!grades.has(grade)) grades.set(grade, []);
      grades.get(grade).push(value);
    }
    return [...grades].map(([grade, classes]) => `<details${classes.some((value) => selected.includes(value)) ? ' open' : ''}>
      <summary>${esc(grade)} классы</summary>
      <label class="ach-check"><input type="checkbox" data-grade> Выбрать все ${esc(grade)} классы</label>
      <div class="contest-class-grid">${classes.map((value) => `<label class="ach-check"><input type="checkbox" name="classes" value="${esc(value)}"${selected.includes(value) ? ' checked' : ''}> ${esc(value)}</label>`).join('')}</div>
    </details>`).join('');
  }

  function syncGrade(group) {
    const total = $$('[name="classes"]', group);
    const selected = total.filter((input) => input.checked).length;
    const all = $('[data-grade]', group);
    all.checked = selected === total.length;
    all.indeterminate = selected > 0 && selected < total.length;
  }

  function manage(contest) {
    const editing = Boolean(contest);
    const values = contest || { audience: 'students', status: 'draft', classes: [] };
    const statuses = Object.keys(catalogStatus).filter((status) => status !== 'draft' || values.status === 'draft');
    openDialog(editing ? 'Редактировать конкурс' : 'Новый конкурс', `<form data-manage>
      <fieldset class="contest-fields" data-dialog-fields>
        <div class="field"><label for="ct-name">Название</label><input class="input" id="ct-name" name="name" value="${esc(values.name)}" maxlength="200" required></div>
        <div class="ach-grid">
          <div class="field"><label for="ct-direction">Направление</label><select class="select" id="ct-direction" name="direction" required>${option('', 'Выберите')}${options(state.data.directions, values.direction)}</select></div>
          <div class="field"><label for="ct-level">Уровень</label><select class="select" id="ct-level" name="level" required>${option('', 'Выберите')}${options(state.data.levels, values.level)}</select></div>
          <div class="field"><label for="ct-form">Форма участия</label><select class="select" id="ct-form" name="form" required>${options(state.data.forms, values.form)}</select></div>
          <div class="field"><label for="ct-subject">Предмет / номинация</label><input class="input" id="ct-subject" name="subject" value="${esc(values.subject)}" maxlength="120"></div>
          <div class="field"><label for="ct-deadline">Приём до (включительно, МСК)</label><input class="input" type="date" id="ct-deadline" name="deadline" value="${esc(values.deadline)}" required></div>
          <div class="field"><label for="ct-event-date">Дата проведения (если известна)</label><input class="input" type="date" id="ct-event-date" name="event_date" value="${esc(values.event_date)}"></div>
        </div>
        <div class="field"><label for="ct-regulation">Ссылка на положение</label><input class="input" type="url" id="ct-regulation" name="regulation_url" value="${esc(values.regulation_url)}" placeholder="https://disk.yandex.ru/…" maxlength="1000" required></div>
        <div class="ach-grid">
          <div class="field"><label for="ct-audience">Участники</label><select class="select" id="ct-audience" name="audience">${option('students', 'Ученики', values.audience)}${option('staff', 'Педагоги', values.audience)}</select></div>
          <div class="field"><label for="ct-status">Статус конкурса</label><select class="select" id="ct-status" name="status">${statuses.map((status) => option(status, catalogStatus[status], values.status)).join('')}</select></div>
        </div>
        <fieldset class="contest-classes" data-class-selection${values.audience === 'staff' ? ' hidden' : ''}>
          <legend>Допущенные классы</legend>${classChecks(values.classes)}
        </fieldset>
        <label class="ach-check"><input type="checkbox" name="required"${values.required ? ' checked' : ''}> Обязательное участие</label>
        <div><button class="btn" type="submit">Сохранить конкурс</button></div>
      </fieldset>
    </form>`);
    const form = $('[data-manage]');
    form.elements.audience.addEventListener('change', () => { $('[data-class-selection]').hidden = form.elements.audience.value === 'staff'; });
    for (const group of $$('[data-class-selection] details')) syncGrade(group);
    $('[data-class-selection]').addEventListener('change', ({ target }) => {
      const group = target.closest('details');
      if (!group) return;
      if (target.matches('[data-grade]')) for (const input of $$('[name="classes"]', group)) input.checked = target.checked;
      syncGrade(group);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const body = Object.fromEntries(data);
      body.classes = body.audience === 'students' ? data.getAll('classes') : [];
      body.required = data.has('required');
      body.event_date ||= null;
      if (editing) body.revision = contest.revision;
      if (!safeLink(body.regulation_url)) return message($('[data-dialog-error]'), 'Укажите ссылку на положение, начинающуюся с https://.');
      if (body.audience === 'students' && !body.classes.length) return message($('[data-dialog-error]'), 'Выберите хотя бы один класс.');
      if (body.event_date && body.event_date < body.deadline) return message($('[data-dialog-error]'), 'Дата проведения должна быть не раньше срока подачи заявок.');
      void run(async () => {
        const saved = editing ? await api.put(endpoint(contest), body) : await api.post('/contests', body);
        dialog.close();
        $('[data-scope]').value = 'all';
        state.view = 'catalog';
        const savedYear = saved.contest.school_year || core.schoolYearStart(new Date((saved.contest.event_date || saved.contest.deadline) + 'T12:00:00'));
        await loadCatalog(savedYear, 'Конкурс сохранён.');
      });
    });
  }

  function people(students) {
    return `<ul>${students.map((student) => `<li>${esc(student.student_name)}${student.class_name ? ' · ' + esc(student.class_name) : ''}</li>`).join('')}</ul>`;
  }

  function application(contest) {
    const mine = contest.mine;
    const editable = contest.registration_open && mine?.status !== 'accepted';
    const staff = contest.audience === 'staff';
    openDialog(mine ? 'Моя заявка' : 'Подать заявку', `
      <div class="stack">
        <p><strong>${esc(contest.name)}</strong></p>
        ${mine ? `<p>${statusBadge(mine)}</p>${commentMarkup(mine)}` : ''}
        ${editable ? `<form data-application autocomplete="off">
          <fieldset class="contest-fields" data-dialog-fields>
            ${staff ? `<p>Участник: ${esc(state.me.short_name)}</p>` : `<div class="ach-rows" data-students></div>
              <div><button class="btn btn--ghost btn--sm" data-add-student type="button">Добавить ученика</button></div>`}
            <div><button class="btn" type="submit">${mine ? 'Отправить изменения' : 'Отправить заявку'}</button></div>
          </fieldset>
        </form>` : `${mine ? people(mine.students) : ''}<p class="help-note">${mine?.status === 'accepted' ? 'Заявка принята.' : 'Приём заявок завершён.'}</p>`}
      </div>`);
    if (!editable) return;

    const form = $('[data-application]');
    if (!staff) {
      const filter = $('[data-class]').value;
      const defaultClass = contest.classes.includes(filter) ? filter : contest.classes.length === 1 ? contest.classes[0] : '';
      const students = $('[data-students]', form);
      const addButton = $('[data-add-student]', form);
      let key = 0;
      function updateRows() {
        addButton.disabled = students.childElementCount >= core.MAX_STUDENTS;
        for (const button of $$('[data-remove-student]', students)) button.disabled = students.childElementCount === 1;
      }
      function addStudent(student = {}, focus = false) {
        if (students.childElementCount >= core.MAX_STUDENTS) return;
        key += 1;
        const selected = student.class_name ?? defaultClass;
        const available = contest.classes.includes(selected) || !selected ? contest.classes : [...contest.classes, selected];
        students.insertAdjacentHTML('beforeend', `<div class="ach-row contest-student" data-student>
          <div class="field"><label for="ct-student-${key}">ФИО ученика</label><input class="input" id="ct-student-${key}" name="student_name" value="${esc(student.student_name)}" maxlength="60" autocomplete="off"></div>
          <div class="field"><label for="ct-student-class-${key}">Класс</label><select class="select" id="ct-student-class-${key}" name="class_name">${option('', 'Класс')}${options(available, selected)}</select></div>
          <button class="btn btn--ghost btn--sm" type="button" data-remove-student aria-label="Убрать ученика">Убрать</button>
        </div>`);
        updateRows();
        if (focus) $('input', students.lastElementChild).focus();
      }
      for (const student of mine?.students || [{}]) addStudent(student);
      addButton.addEventListener('click', () => addStudent({}, true));
      students.addEventListener('click', ({ target }) => {
        const remove = target.closest('[data-remove-student]');
        if (!remove) return;
        remove.closest('[data-student]').remove();
        updateRows();
        addButton.focus();
      });
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const students = $$('[data-student]', form).map((row) => ({
        student_name: core.normalizeName($('[name="student_name"]', row).value),
        class_name: $('[name="class_name"]', row).value,
      })).filter((row) => row.student_name);
      if (!staff && !students.length) return message($('[data-dialog-error]'), 'Добавьте хотя бы одного ученика.');
      for (const [i, student] of students.entries()) {
        const issue = core.studentNameError(student.student_name) || (!contest.classes.includes(student.class_name) ? 'Выберите допущенный класс.' : '');
        if (issue) return message($('[data-dialog-error]'), `Строка ${i + 1}. ${issue}`);
      }
      void run(async () => {
        await api.put(endpoint(contest) + '/application', { students, revision: mine?.revision ?? null });
        dialog.close();
        state.view = 'mine';
        $('[data-class]').value = '';
        await loadCatalog(state.year, 'Заявка отправлена.');
      });
    });
  }

  function applicationCard(item, index) {
    const duplicates = item.duplicate_students || [];
    const canAccept = item.status === 'submitted';
    const canReturn = item.status !== 'returned';
    return `<article class="ach-card" data-review-item>
      <div class="ikt-card__top"><h3 class="contest-review-heading">${esc(item.author_name || 'Педагог')}</h3>${statusBadge(item)}</div>
      ${people(item.students)}
      ${duplicates.length ? `<div class="ikt-card__comment"><b>Возможные дубли в заявках</b>${people(duplicates)}</div>` : ''}
      ${commentMarkup(item)}
      ${canAccept || canReturn ? `<div class="ikt-card__actions">
        ${canAccept ? `<button class="btn btn--sm" type="button" data-accept="${index}">Принять</button>` : ''}
        ${canReturn ? '<button class="btn btn--ghost btn--sm" type="button" data-return aria-expanded="false">Вернуть</button>' : ''}
      </div>` : ''}
      ${canReturn ? `<form class="ikt-answer" data-return-form="${index}" hidden>
        <div class="field"><label for="ct-return-${index}">Комментарий учителю</label><textarea class="input" id="ct-return-${index}" name="comment" maxlength="500" required></textarea></div>
        <div><button class="btn btn--sm" type="submit">Возвратить заявку</button></div>
      </form>` : ''}
    </article>`;
  }

  async function download(contest) {
    const response = await api.file(endpoint(contest) + '/applications.xlsx');
    const address = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.download = 'Участники конкурса.xlsx';
    link.href = address;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(address), 1000);
  }

  async function renderReview(contest, notice = '') {
    const { applications, missing_classes: missing } = await api.get(endpoint(contest) + '/applications');
    openDialog('Заявки на конкурс', `<fieldset class="contest-fields" data-dialog-fields>
      <p><strong>${esc(contest.name)}</strong></p>
      ${notice ? `<p class="help-note" role="status">${esc(notice)}</p>` : ''}
      ${contest.required && contest.audience === 'students' ? `<p class="help-note">${missing.length ? 'Пока нет заявок по классам: ' + esc(missing.join(', ')) : 'Есть заявки от всех допущенных классов.'}</p>` : ''}
      <div class="ikt-card__actions">
        <button class="btn btn--ghost btn--sm" type="button" data-reload-applications>Обновить заявки</button>
        <button class="btn btn--ghost btn--sm" type="button" data-download${applications.some((item) => item.status === 'accepted') ? '' : ' disabled'}>Скачать принятые заявки (Excel)</button>
      </div>
      <div class="ach-list">${applications.length ? applications.map(applicationCard).join('') : '<p class="ikt-empty">Заявок пока нет.</p>'}</div>
    </fieldset>`);
    $('[data-reload-applications]').addEventListener('click', () => void run(() => renderReview(contest)));
    $('[data-download]').addEventListener('click', () => void run(() => download(contest)));
    function decide(index, action, comment) {
      const item = applications[index];
      if (!item) return;
      void run(async () => {
        await api.post(endpoint(contest) + '/applications/' + encodeURIComponent(item.author_id), { action, comment, revision: item.revision });
        await renderReview(contest, action === 'accept' ? 'Заявка принята.' : 'Заявка возвращена учителю.');
        await loadCatalog(state.year);
      });
    }
    for (const button of $$('[data-accept]', dialog)) button.addEventListener('click', () => decide(button.dataset.accept, 'accept', ''));
    for (const button of $$('[data-return]', dialog)) button.addEventListener('click', () => {
      const form = $('[data-return-form]', button.closest('[data-review-item]'));
      form.hidden = !form.hidden;
      button.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) form.elements.comment.focus();
    });
    for (const form of $$('[data-return-form]', dialog)) form.addEventListener('submit', (event) => {
      event.preventDefault();
      const comment = form.elements.comment.value.trim();
      if (!comment) return message($('[data-dialog-error]'), 'Укажите, что нужно исправить.');
      decide(form.dataset.returnForm, 'return', comment);
    });
  }

  function boot() {
    if (!base) {
      message($('[data-broken]'), 'Сервис достижений ещё не подключён. Обратитесь к администратору сайта.');
      return;
    }

    $('[data-logout]').addEventListener('click', () => { api.logout(); showLogin(); });
    $('[data-create]').addEventListener('click', () => { if (isManager() && state.data) manage(); });
    $('[data-refresh]').addEventListener('click', () => void loadCatalog());
    $('[data-reload-catalog]').addEventListener('click', () => void loadCatalog());
    $('[data-year]').addEventListener('change', ({ target }) => void loadCatalog(Number(target.value)));
    for (const select of [$('[data-class]'), $('[data-scope]')]) select.addEventListener('change', renderCatalog);
    for (const button of $$('[data-view]')) button.addEventListener('click', () => { state.view = button.dataset.view; renderCatalog(); });
    $('[data-dialog-close]').addEventListener('click', () => { if (!state.busy) dialog.close(); });
    dialog.addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { if (!dialog.open) $('[data-dialog-content]').replaceChildren(); });
    $('[data-contest-list]').addEventListener('click', ({ target }) => {
      const button = target.closest('[data-action]');
      const contest = state.data?.contests.find((entry) => entry.id === button?.dataset.id);
      if (!contest) return;
      const action = button.dataset.action;
      if (action === 'apply') application(contest);
      if (action === 'edit' && isManager()) manage(contest);
      if (action === 'review' && isManager()) {
        openDialog('Заявки на конкурс', '<p class="help-note" role="status">Загружаем заявки…</p>');
        void run(() => renderReview(contest));
      }
    });
    window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });

    const session = api.current();
    if (session) ready(session.staff);
    else showLogin();
  }

  boot();
})();
