(() => {
  'use strict';

  const config = window.SCHOOL_CONFIG || {};
  const site = window.SchoolSite;
  if (!site) return;

  const DAY_ORDER = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const DAY_NAMES = {
    ПН: 'Понедельник', ВТ: 'Вторник', СР: 'Среда',
    ЧТ: 'Четверг', ПТ: 'Пятница', СБ: 'Суббота', ВС: 'Воскресенье'
  };
  const DAY_ALIASES = {
    пн: 'ПН', понедельник: 'ПН',
    вт: 'ВТ', вторник: 'ВТ',
    ср: 'СР', среда: 'СР',
    чт: 'ЧТ', четверг: 'ЧТ',
    пт: 'ПТ', пятница: 'ПТ',
    сб: 'СБ', суббота: 'СБ',
    вс: 'ВС', воскресенье: 'ВС'
  };
  const DEFAULT_SCHEDULE_HEADERS = ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'];
  const DEFAULT_CHANGES_HEADERS = ['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание'];
  const classCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

  let selectedClass = '';
  let availableClasses = [...(Array.isArray(config.classes) ? config.classes : [])];
  let scheduleRows = null;
  let changesRows = null;
  let scheduleError = false;
  let changesError = false;
  let classButtonsElement = null;
  let classSelectElement = null;

  const addUtcDays = (date, count) => new Date(date.getTime() + count * 86400000);
  const dateKey = (date) => {
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${date.getUTCFullYear()}`;
  };

  function nextSchoolDay(date) {
    let candidate = addUtcDays(date, 1);
    while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
      candidate = addUtcDays(candidate, 1);
    }
    return candidate;
  }

  function schoolChangeWindow(baseDate = site.getSchoolToday()) {
    let first = new Date(baseDate.getTime());
    const originalDay = first.getUTCDay();
    if (originalDay === 6) first = addUtcDays(first, 2);
    if (originalDay === 0) first = addUtcDays(first, 1);
    const second = nextSchoolDay(first);
    return {
      first,
      second,
      firstLabel: (originalDay === 0 || originalDay === 6) ? 'Ближайший учебный день' : 'Сегодня',
      secondLabel: 'Следующий учебный день'
    };
  }

  function normalizeDateValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';

    const numeric = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (numeric) {
      const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
      return `${numeric[1].padStart(2, '0')}.${numeric[2].padStart(2, '0')}.${year}`;
    }

    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[3].padStart(2, '0')}.${iso[2].padStart(2, '0')}.${iso[1]}`;

    return text;
  }

  function lessonNumber(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : 999;
  }

  function changeCountLabel(count) {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return `${count} изменений`;
    if (last === 1) return `${count} изменение`;
    if (last >= 2 && last <= 4) return `${count} изменения`;
    return `${count} изменений`;
  }

  function initViewTabs() {
    const buttons = [...document.querySelectorAll('[data-schedule-view]')];
    const panels = [...document.querySelectorAll('[data-schedule-panel]')];
    if (!buttons.length || !panels.length) return;

    const activate = (view, updateHash = true) => {
      buttons.forEach((button) => {
        const active = button.dataset.scheduleView === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.schedulePanel !== view;
      });
      if (updateHash) {
        const hash = view === 'changes' ? '#changes' : '#schedule';
        try {
          history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
        } catch (_) {
          // Локальный предпросмотр и некоторые встроенные браузеры могут запрещать History API.
          // Переключение вкладок при этом продолжает работать без изменения адресной строки.
        }
      }
    };

    buttons.forEach((button) => button.addEventListener('click', () => activate(button.dataset.scheduleView)));
    const initial = location.hash === '#changes' ? 'changes' : 'schedule';
    activate(initial, false);
    window.addEventListener('hashchange', () => activate(location.hash === '#changes' ? 'changes' : 'schedule', false));
  }

  function renderClassPicker() {
    if (!classButtonsElement || !classSelectElement) return;
    classSelectElement.innerHTML = '<option value="">Все классы</option>' + availableClasses
      .map((className) => `<option value="${site.escapeHtml(className)}">${site.escapeHtml(className)}</option>`)
      .join('');

    classButtonsElement.innerHTML = availableClasses.map((className) => `
      <button class="class-chip" type="button" data-class-name="${site.escapeHtml(className)}">${site.escapeHtml(className)}</button>`).join('');

    classSelectElement.value = selectedClass;
    classButtonsElement.querySelectorAll('[data-class-name]').forEach((button) => {
      const active = button.dataset.className === selectedClass;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setClass(className, { rerender = true } = {}) {
    const normalized = site.normalizeClass(className);
    selectedClass = availableClasses.includes(normalized) ? normalized : '';

    if (classSelectElement) classSelectElement.value = selectedClass;
    if (classButtonsElement) {
      classButtonsElement.querySelectorAll('[data-class-name]').forEach((button) => {
        const active = button.dataset.className === selectedClass;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    document.querySelectorAll('[data-selected-class-label]').forEach((element) => {
      element.textContent = selectedClass ? `Выбран класс ${selectedClass}` : 'Класс не выбран';
    });

    if (selectedClass) site.storageSet('school:selectedClass', selectedClass);
    else site.storageRemove('school:selectedClass');

    const params = new URLSearchParams(location.search);
    if (selectedClass) params.set('class', selectedClass); else params.delete('class');
    const query = params.toString();
    try {
      history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    } catch (_) {
      // В ограниченном локальном предпросмотре History API может быть недоступен.
    }

    if (rerender) renderAll();
  }

  function initClassPicker() {
    classButtonsElement = document.querySelector('[data-class-buttons]');
    classSelectElement = document.querySelector('[data-class-select]');
    if (!classButtonsElement || !classSelectElement) return;

    availableClasses = [...new Set(availableClasses.map(site.normalizeClass).filter(Boolean))].sort(classCollator.compare);
    const queryClass = site.normalizeClass(new URLSearchParams(location.search).get('class'));
    const storedClass = site.normalizeClass(site.storageGet('school:selectedClass'));
    const initial = [queryClass, storedClass].find((item) => availableClasses.includes(item)) || '';
    selectedClass = initial;
    renderClassPicker();
    setClass(initial, { rerender: false });

    classButtonsElement.addEventListener('click', (event) => {
      const button = event.target.closest('[data-class-name]');
      if (button) setClass(button.dataset.className);
    });
    classSelectElement.addEventListener('change', () => setClass(classSelectElement.value));

    const clearButton = document.querySelector('[data-clear-class]');
    if (clearButton) clearButton.addEventListener('click', () => setClass(''));
  }

  function scheduleTableParts(rows) {
    if (!Array.isArray(rows) || !rows.length) return { headers: DEFAULT_SCHEDULE_HEADERS, data: [] };
    const hasHeader = site.looksLikeHeader(rows[0], ['класс', 'урок', 'пн', 'понедельник']);
    return hasHeader
      ? { headers: rows[0], data: rows.slice(1) }
      : { headers: DEFAULT_SCHEDULE_HEADERS, data: rows };
  }

  function changesTableParts(rows) {
    if (!Array.isArray(rows) || !rows.length) return { headers: DEFAULT_CHANGES_HEADERS, data: [] };
    const hasHeader = site.looksLikeHeader(rows[0], ['дата', 'класс', 'урок', 'изменения']);
    return hasHeader
      ? { headers: rows[0], data: rows.slice(1) }
      : { headers: DEFAULT_CHANGES_HEADERS, data: rows };
  }

  function mapScheduleColumns(headers) {
    const classIndex = site.findHeaderIndex(headers, ['класс', 'классы'], 0);
    const lessonIndex = site.findHeaderIndex(headers, ['урок', 'номерурока', '№урока'], 1);
    const dayColumns = [];
    headers.forEach((header, index) => {
      const code = DAY_ALIASES[site.normalize(header)];
      if (code && code !== 'ВС' && !dayColumns.some((item) => item.code === code)) dayColumns.push({ code, index });
    });
    dayColumns.sort((a, b) => DAY_ORDER.indexOf(a.code) - DAY_ORDER.indexOf(b.code));
    return { classIndex, lessonIndex, dayColumns };
  }

  function deriveClasses(rows) {
    const { headers, data } = scheduleTableParts(rows);
    const classIndex = site.findHeaderIndex(headers, ['класс', 'классы'], 0);
    return [...new Set(data
      .map((row) => site.normalizeClass(row[classIndex]))
      .filter(Boolean))]
      .sort(classCollator.compare);
  }

  function applyDerivedClasses(rows) {
    const derived = deriveClasses(rows);
    if (!derived.length) return;
    const previous = selectedClass;
    availableClasses = derived;
    renderClassPicker();
    setClass(previous && availableClasses.includes(previous) ? previous : '', { rerender: false });
  }

  function todayCode() {
    return ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][site.getSchoolToday().getUTCDay()];
  }

  function renderSchedule() {
    const target = document.querySelector('[data-schedule-output]');
    if (!target) return;

    if (!selectedClass) {
      target.innerHTML = '<div class="empty-state empty-state--large"><strong>Выберите класс.</strong><span>Расписание появится здесь и сохранится для следующих посещений.</span></div>';
      return;
    }

    if (scheduleError && (!scheduleRows || !scheduleRows.length)) {
      target.innerHTML = '<div class="empty-state empty-state--large"><strong>Не удалось загрузить расписание.</strong><span>Проверьте подключение и нажмите «Обновить».</span></div>';
      return;
    }

    const { headers, data } = scheduleTableParts(scheduleRows);
    const { classIndex, lessonIndex, dayColumns } = mapScheduleColumns(headers);
    const classRows = data
      .filter((row) => site.normalizeClass(row[classIndex]) === selectedClass)
      .sort((a, b) => lessonNumber(a[lessonIndex]) - lessonNumber(b[lessonIndex]));

    if (!classRows.length) {
      target.innerHTML = `<div class="empty-state empty-state--large"><strong>Для ${site.escapeHtml(selectedClass)} расписание не найдено.</strong><span>Проверьте написание класса в Google Таблице.</span></div>`;
      return;
    }

    const currentCode = todayCode();
    const cards = dayColumns.map(({ code, index }) => {
      const lessons = classRows
        .filter((row) => String(row[index] ?? '').trim())
        .map((row) => ({ number: row[lessonIndex], subject: row[index] }));
      const isToday = code === currentCode;
      return `
        <article class="day-card${isToday ? ' is-today' : ''}">
          <header class="day-card__header">
            <div>
              <span class="day-code">${site.escapeHtml(code)}</span>
              <h3>${site.escapeHtml(DAY_NAMES[code] || code)}</h3>
            </div>
            ${isToday ? '<span class="today-badge">Сегодня</span>' : ''}
          </header>
          <ol class="lesson-list">
            ${lessons.length ? lessons.map((lesson) => `
              <li>
                <span class="lesson-number">${site.escapeHtml(lesson.number)}</span>
                <span class="lesson-name">${site.escapeHtml(lesson.subject).replace(/\n/g, '<br>')}</span>
              </li>`).join('') : '<li class="lesson-list__empty">Уроков нет</li>'}
          </ol>
        </article>`;
    }).join('');

    target.innerHTML = cards || '<div class="empty-state empty-state--large"><strong>В таблице не найдены дни недели.</strong><span>Первая строка должна содержать ПН, ВТ, СР, ЧТ и ПТ.</span></div>';
  }

  function mapChangesColumns(headers) {
    return {
      date: site.findHeaderIndex(headers, ['дата'], 0),
      className: site.findHeaderIndex(headers, ['класс', 'классы'], 1),
      lesson: site.findHeaderIndex(headers, ['урок', 'номерурока', '№урока'], 2),
      change: site.findHeaderIndex(headers, ['изменения', 'изменение', 'замена'], 3),
      note: site.findHeaderIndex(headers, ['примечание', 'комментарий'], 4)
    };
  }

  function renderChangeBlock(label, date, rows, columns) {
    const title = site.formatSchoolDate(date, { weekday: true });
    const sorted = [...rows].sort((a, b) => {
      const classCompare = classCollator.compare(site.normalizeClass(a[columns.className]), site.normalizeClass(b[columns.className]));
      return classCompare || lessonNumber(a[columns.lesson]) - lessonNumber(b[columns.lesson]);
    });

    if (!sorted.length) {
      return `
        <section class="change-day-card">
          <header class="change-day-card__header">
            <div><span class="section-kicker">${site.escapeHtml(label)}</span><h3>${site.escapeHtml(title)}</h3></div>
            <span class="status status--ok">Без изменений</span>
          </header>
          <div class="empty-state"><strong>Изменений нет.</strong><span>Все уроки проходят по основному расписанию.</span></div>
        </section>`;
    }

    return `
      <section class="change-day-card">
        <header class="change-day-card__header">
          <div><span class="section-kicker">${site.escapeHtml(label)}</span><h3>${site.escapeHtml(title)}</h3></div>
          <span class="status">${changeCountLabel(sorted.length)}</span>
        </header>
        <div class="change-table-wrap">
          <table class="change-table">
            <thead><tr><th>Класс</th><th>Урок</th><th>Изменение</th><th>Примечание</th></tr></thead>
            <tbody>${sorted.map((row) => `
              <tr>
                <td><strong>${site.escapeHtml(row[columns.className] || '')}</strong></td>
                <td>${site.escapeHtml(row[columns.lesson] || '')}</td>
                <td>${site.escapeHtml(row[columns.change] || '')}</td>
                <td>${site.escapeHtml(row[columns.note] || '—')}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="change-mobile-list">${sorted.map((row) => `
          <article class="change-mobile-item">
            <div class="change-mobile-item__top"><strong>${site.escapeHtml(row[columns.className] || '')}</strong><span>${site.escapeHtml(row[columns.lesson] || '')} урок</span></div>
            <p>${site.escapeHtml(row[columns.change] || '')}</p>
            ${row[columns.note] ? `<small>${site.escapeHtml(row[columns.note])}</small>` : ''}
          </article>`).join('')}</div>
      </section>`;
  }

  function renderChanges() {
    const target = document.querySelector('[data-changes-output]');
    if (!target) return;

    if (changesError && (!changesRows || !changesRows.length)) {
      target.innerHTML = '<div class="empty-state empty-state--large"><strong>Не удалось проверить изменения.</strong><span>Основное расписание доступно выше. Повторите загрузку кнопкой «Обновить».</span></div>';
      return;
    }

    const { headers, data } = changesTableParts(changesRows);
    const columns = mapChangesColumns(headers);
    const windowDates = schoolChangeWindow();
    const firstKey = dateKey(windowDates.first);
    const secondKey = dateKey(windowDates.second);

    const relevant = data.filter((row) => {
      if (!row.some((cell) => String(cell ?? '').trim())) return false;
      if (selectedClass && site.normalizeClass(row[columns.className]) !== selectedClass) return false;
      return true;
    });

    const firstRows = relevant.filter((row) => normalizeDateValue(row[columns.date]) === firstKey);
    const secondRows = relevant.filter((row) => normalizeDateValue(row[columns.date]) === secondKey);

    const filterNote = selectedClass
      ? `<span>Показаны изменения для <strong>${site.escapeHtml(selectedClass)}</strong>.</span>`
      : '<span>Показаны изменения для всех классов. Выберите класс выше, чтобы сократить список.</span>';

    target.innerHTML = `
      <div class="change-context">
        ${filterNote}
        <span>Суббота и воскресенье автоматически пропускаются.</span>
      </div>
      <div class="change-days">
        ${renderChangeBlock(windowDates.firstLabel, windowDates.first, firstRows, columns)}
        ${renderChangeBlock(windowDates.secondLabel, windowDates.second, secondRows, columns)}
      </div>`;
  }

  function statusText(scheduleSheetName, changesSheetName, failed) {
    const metas = [site.getSheetMeta(scheduleSheetName), site.getSheetMeta(changesSheetName)].filter(Boolean);
    const stale = metas.find((meta) => meta.stale);
    if (stale) return `Сохранённая версия: ${site.formatCacheTime(stale.savedAt)}`;
    if (failed) return 'Часть данных недоступна';
    const latest = Math.max(0, ...metas.map((meta) => meta.savedAt || 0));
    return latest ? `Обновлено: ${site.formatCacheTime(latest)}` : 'Данные загружены';
  }

  async function loadData({ force = false } = {}) {
    const scheduleTarget = document.querySelector('[data-schedule-output]');
    const changesTarget = document.querySelector('[data-changes-output]');
    if (scheduleTarget) scheduleTarget.innerHTML = '<div class="loading-state"><strong>Загружаем расписание</strong><span>Получаем данные из школьной таблицы.</span></div>';
    if (changesTarget) changesTarget.innerHTML = '<div class="loading-state"><strong>Проверяем изменения</strong><span>Суббота и воскресенье будут автоматически пропущены.</span></div>';

    const scheduleSheetName = config.googleSheets?.sheets?.schedule || 'Расписание';
    const changesSheetName = config.googleSheets?.sheets?.changes || 'Изменения';
    const [scheduleResult, changesResult] = await Promise.allSettled([
      site.loadSheet(scheduleSheetName, { force }),
      site.loadSheet(changesSheetName, { force })
    ]);

    scheduleError = scheduleResult.status === 'rejected';
    changesError = changesResult.status === 'rejected';
    scheduleRows = scheduleError ? [] : scheduleResult.value;
    changesRows = changesError ? [] : changesResult.value;

    if (!scheduleError) applyDerivedClasses(scheduleRows);
    renderAll();

    const status = document.querySelector('[data-sync-status]');
    if (status) {
      const failed = scheduleError || changesError;
      status.textContent = statusText(scheduleSheetName, changesSheetName, failed);
      status.classList.toggle('has-error', failed);
    }
  }

  function renderAll() {
    renderSchedule();
    renderChanges();
  }

  function initRefresh() {
    const button = document.querySelector('[data-refresh]');
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

  window.ScheduleUtils = Object.freeze({ nextSchoolDay, schoolChangeWindow, normalizeDateValue, dateKey });

  document.addEventListener('DOMContentLoaded', () => {
    initViewTabs();
    initClassPicker();
    initRefresh();
    loadData();
  });
})();
