(() => {
  'use strict';

  const config = window.SCHOOL_CONFIG || {};
  const site = window.SchoolSite;
  if (!site) return;

  const DAY_ORDER = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
  const DAY_NAMES = {
    ПН: 'Понедельник', ВТ: 'Вторник', СР: 'Среда', ЧТ: 'Четверг', ПТ: 'Пятница'
  };
  const DAY_ALIASES = {
    пн: 'ПН', понедельник: 'ПН',
    вт: 'ВТ', вторник: 'ВТ',
    ср: 'СР', среда: 'СР',
    чт: 'ЧТ', четверг: 'ЧТ',
    пт: 'ПТ', пятница: 'ПТ'
  };
  const DEFAULT_HEADERS = ['ФИО', 'УРОК', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

  let rows = [];
  let selectedTeacher = '';
  let teacherNames = [];
  let loadError = false;
  let buttonsElement = null;
  let selectElement = null;

  function lessonNumber(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : 999;
  }

  function parts(input) {
    if (!Array.isArray(input) || !input.length) return { headers: DEFAULT_HEADERS, data: [] };
    const hasHeader = site.looksLikeHeader(input[0], ['фио', 'урок', 'пн', 'понедельник']);
    return hasHeader ? { headers: input[0], data: input.slice(1) } : { headers: DEFAULT_HEADERS, data: input };
  }

  function columns(headers) {
    const teacherIndex = site.findHeaderIndex(headers, ['фио', 'учитель', 'педагог'], 0);
    const lessonIndex = site.findHeaderIndex(headers, ['урок', 'номерурока', '№урока'], 1);
    const dayColumns = [];
    headers.forEach((header, index) => {
      const code = DAY_ALIASES[site.normalize(header)];
      if (code && !dayColumns.some((item) => item.code === code)) dayColumns.push({ code, index });
    });
    dayColumns.sort((a, b) => DAY_ORDER.indexOf(a.code) - DAY_ORDER.indexOf(b.code));
    return { teacherIndex, lessonIndex, dayColumns };
  }

  function deriveTeachers(input) {
    const { headers, data } = parts(input);
    const teacherIndex = site.findHeaderIndex(headers, ['фио', 'учитель', 'педагог'], 0);
    return [...new Set(data.map((row) => String(row[teacherIndex] ?? '').trim()).filter(Boolean))].sort(collator.compare);
  }

  function renderPicker() {
    if (!buttonsElement || !selectElement) return;
    buttonsElement.innerHTML = teacherNames.map((name) => `
      <button class="teacher-chip${name === selectedTeacher ? ' is-active' : ''}" type="button" data-teacher-name="${site.escapeHtml(name)}" aria-pressed="${name === selectedTeacher}">${site.escapeHtml(name)}</button>`).join('');
    selectElement.innerHTML = '<option value="">Выберите учителя</option>' + teacherNames
      .map((name) => `<option value="${site.escapeHtml(name)}">${site.escapeHtml(name)}</option>`).join('');
    selectElement.value = selectedTeacher;
  }

  function setTeacher(name, { rerender = true } = {}) {
    selectedTeacher = teacherNames.includes(name) ? name : '';
    if (selectedTeacher) site.storageSet('school:selectedTeacher', selectedTeacher);
    else site.storageRemove('school:selectedTeacher');

    if (selectElement) selectElement.value = selectedTeacher;
    if (buttonsElement) {
      buttonsElement.querySelectorAll('[data-teacher-name]').forEach((button) => {
        const active = button.dataset.teacherName === selectedTeacher;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    document.querySelectorAll('[data-selected-teacher-label]').forEach((element) => {
      element.textContent = selectedTeacher || 'Учитель не выбран';
    });

    const params = new URLSearchParams(location.search);
    if (selectedTeacher) params.set('teacher', selectedTeacher); else params.delete('teacher');
    try {
      history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
    } catch (_) {}

    if (rerender) renderSchedule();
  }

  function initPicker() {
    buttonsElement = document.querySelector('[data-teacher-buttons]');
    selectElement = document.querySelector('[data-teacher-select]');
    if (!buttonsElement || !selectElement) return;

    const queryTeacher = new URLSearchParams(location.search).get('teacher') || '';
    const storedTeacher = site.storageGet('school:selectedTeacher') || '';
    const initial = [queryTeacher, storedTeacher].find((name) => teacherNames.includes(name)) || '';
    selectedTeacher = initial;
    renderPicker();
    setTeacher(initial, { rerender: false });

    buttonsElement.addEventListener('click', (event) => {
      const button = event.target.closest('[data-teacher-name]');
      if (button) setTeacher(button.dataset.teacherName);
    });
    selectElement.addEventListener('change', () => setTeacher(selectElement.value));

    const clearButton = document.querySelector('[data-clear-teacher]');
    if (clearButton) clearButton.addEventListener('click', () => setTeacher(''));
  }

  function todayCode() {
    return ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][site.getSchoolToday().getUTCDay()];
  }

  function renderSchedule() {
    const target = document.querySelector('[data-teacher-schedule-output]');
    if (!target) return;

    if (!selectedTeacher) {
      target.innerHTML = '<div class="empty-state empty-state--large"><strong>Выберите учителя.</strong><span>Недельное расписание появится здесь.</span></div>';
      return;
    }

    if (loadError && !rows.length) {
      target.innerHTML = '<div class="empty-state empty-state--large"><strong>Не удалось загрузить расписание учителей.</strong><span>Проверьте подключение и нажмите «Обновить».</span></div>';
      return;
    }

    const { headers, data } = parts(rows);
    const { teacherIndex, lessonIndex, dayColumns } = columns(headers);
    const teacherRows = data
      .filter((row) => String(row[teacherIndex] ?? '').trim() === selectedTeacher)
      .sort((a, b) => lessonNumber(a[lessonIndex]) - lessonNumber(b[lessonIndex]));

    if (!teacherRows.length) {
      target.innerHTML = `<div class="empty-state empty-state--large"><strong>Для ${site.escapeHtml(selectedTeacher)} расписание не найдено.</strong><span>Проверьте лист «Учителя» в Google Таблице.</span></div>`;
      return;
    }

    const currentCode = todayCode();
    target.innerHTML = dayColumns.map(({ code, index }) => {
      const lessons = teacherRows
        .filter((row) => String(row[index] ?? '').trim())
        .map((row) => ({ number: row[lessonIndex], className: row[index] }));
      const isToday = code === currentCode;
      return `
        <article class="day-card${isToday ? ' is-today' : ''}">
          <header class="day-card__header">
            <div><span class="day-code">${code}</span><h3>${DAY_NAMES[code]}</h3></div>
            ${isToday ? '<span class="today-badge">Сегодня</span>' : ''}
          </header>
          <ol class="lesson-list">
            ${lessons.length ? lessons.map((lesson) => `
              <li><span class="lesson-number">${site.escapeHtml(lesson.number)}</span><span class="lesson-name">${site.escapeHtml(lesson.className).replace(/\n/g, '<br>')}</span></li>`).join('') : '<li class="lesson-list__empty">Уроков нет</li>'}
          </ol>
        </article>`;
    }).join('');
  }

  function statusText(sheetName) {
    const meta = site.getSheetMeta(sheetName);
    if (!meta) return loadError ? 'Данные недоступны' : 'Данные загружены';
    if (meta.stale) return `Сохранённая версия: ${site.formatCacheTime(meta.savedAt)}`;
    if (loadError) return 'Данные недоступны';
    return meta.savedAt ? `Обновлено: ${site.formatCacheTime(meta.savedAt)}` : 'Данные загружены';
  }

  async function loadData({ force = false } = {}) {
    const target = document.querySelector('[data-teacher-schedule-output]');
    if (target) target.innerHTML = '<div class="loading-state"><strong>Загружаем расписание учителей</strong><span>Получаем данные из школьной Google Таблицы.</span></div>';

    const sheetName = config.googleSheets?.sheets?.teachers || 'Учителя';
    try {
      rows = await site.loadSheet(sheetName, { force });
      loadError = false;
      teacherNames = deriveTeachers(rows);
      const previous = selectedTeacher;
      renderPicker();
      setTeacher(previous && teacherNames.includes(previous) ? previous : '', { rerender: false });
    } catch (_) {
      rows = [];
      loadError = true;
    }

    renderSchedule();
    const status = document.querySelector('[data-teacher-sync-status]');
    if (status) {
      status.textContent = statusText(sheetName);
      status.classList.toggle('has-error', loadError);
    }
  }

  function initRefresh() {
    const button = document.querySelector('[data-teacher-refresh]');
    if (!button) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.classList.add('is-loading');
      try { await loadData({ force: true }); }
      finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    teacherNames = [];
    initPicker();
    initRefresh();
    await loadData();
    const queryTeacher = new URLSearchParams(location.search).get('teacher') || '';
    const storedTeacher = site.storageGet('school:selectedTeacher') || '';
    const initial = [queryTeacher, storedTeacher].find((name) => teacherNames.includes(name)) || '';
    setTeacher(initial);
  });
})();
