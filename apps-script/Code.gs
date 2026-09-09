const CONFIG = Object.freeze({
  scheduleSheet: 'Расписание',
  changesSheet: 'Изменения',
  timeZone: 'Europe/Moscow',
  sessionSeconds: 21600,
});

function doGet() {
  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('Панель изменений — МОУ СОШ № 20')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function login(pin) {
  const expected = getRequiredProperty_('ADMIN_PIN');
  if (String(pin || '') !== String(expected)) throw new Error('Неверный PIN-код');

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, '1', CONFIG.sessionSeconds);
  return { token, expiresHours: 6 };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('session:' + token);
  return true;
}

function getInitialData(token) {
  assertSession_(token);
  const schedule = getScheduleTable_();
  const classes = unique_(schedule.rows.map(row => normalizeClass_(row[0])).filter(Boolean)).sort(classCompare_);
  const subjects = unique_(schedule.rows.flatMap(row => row.slice(2)).map(extractSubject_).filter(Boolean)).sort(localeCompare_);
  return {
    classes,
    subjects,
    today: isoToday_(),
    schoolName: 'МОУ СОШ № 20 г. Твери',
  };
}

function getDateChanges(token, dateIso) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  return readChangesForDate_(dateIso);
}

function getClassSchedule(token, dateIso, className) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  const normalizedClass = normalizeClass_(className);
  if (!normalizedClass) throw new Error('Не выбран класс');

  const schedule = getScheduleTable_();
  const dayIndex = dayColumnIndex_(dateIso, schedule.headers);
  if (dayIndex < 0) return { className: normalizedClass, dayName: 'Выходной', lessons: [] };

  const lessons = schedule.rows
    .filter(row => normalizeClass_(row[0]) === normalizedClass)
    .map(row => ({ lesson: Number(row[1]) || 0, subject: String(row[dayIndex] || '').trim() }))
    .filter(item => item.lesson >= 1 && item.lesson <= 12)
    .sort((a, b) => a.lesson - b.lesson);

  return {
    className: normalizedClass,
    dayName: weekdayName_(dateIso),
    lessons,
  };
}

function publishChanges(token, dateIso, changes) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  if (!Array.isArray(changes)) throw new Error('Некорректный список изменений');

  const normalized = changes.map(item => ({
    className: normalizeClass_(item.className),
    lesson: Number(item.lesson),
    change: String(item.change || '').trim(),
    note: String(item.note || '').trim(),
  })).filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.changesSheet);
    if (!sheet) throw new Error('Не найден лист «' + CONFIG.changesSheet + '»');

    const values = sheet.getDataRange().getValues();
    for (let row = values.length; row >= 2; row--) {
      if (normalizeDate_(values[row - 1][0]) === dateIso) sheet.deleteRow(row);
    }

    if (normalized.length) {
      const rows = normalized
        .sort((a, b) => classCompare_(a.className, b.className) || a.lesson - b.lesson)
        .map(item => [formatRuDate_(dateIso), item.className, item.lesson, item.change, item.note]);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    }

    SpreadsheetApp.flush();
    return {
      count: normalized.length,
      date: dateIso,
      savedAt: Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss'),
    };
  } finally {
    lock.releaseLock();
  }
}

function assertSession_(token) {
  const key = 'session:' + String(token || '');
  const cache = CacheService.getScriptCache();
  if (!token || cache.get(key) !== '1') throw new Error('Сессия истекла. Введите PIN-код ещё раз.');
  cache.put(key, '1', CONFIG.sessionSeconds);
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredProperty_('SPREADSHEET_ID'));
}

function getRequiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Не задано свойство скрипта ' + name);
  return value;
}

function getScheduleTable_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.scheduleSheet);
  if (!sheet) throw new Error('Не найден лист «' + CONFIG.scheduleSheet + '»');
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { headers: [], rows: [] };
  return { headers: values[0], rows: values.slice(1).filter(row => row.some(Boolean)) };
}

function readChangesForDate_(dateIso) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.changesSheet);
  if (!sheet) throw new Error('Не найден лист «' + CONFIG.changesSheet + '»');
  const values = sheet.getDataRange().getValues();
  return values.slice(1)
    .filter(row => normalizeDate_(row[0]) === dateIso)
    .map(row => ({
      className: normalizeClass_(row[1]),
      lesson: Number(row[2]) || 0,
      change: String(row[3] || '').trim(),
      note: String(row[4] || '').trim(),
    }))
    .filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change)
    .sort((a, b) => classCompare_(a.className, b.className) || a.lesson - b.lesson);
}

function dayColumnIndex_(dateIso, headers) {
  const codes = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const code = codes[new Date(dateIso + 'T12:00:00Z').getUTCDay()];
  if (code === 'СБ' || code === 'ВС') return -1;
  const normalized = headers.map(value => String(value || '').trim().toUpperCase());
  return normalized.indexOf(code);
}

function weekdayName_(dateIso) {
  const names = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return names[new Date(dateIso + 'T12:00:00Z').getUTCDay()];
}

function isoToday_() {
  return Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd');
}

function validateIsoDate_(dateIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || ''))) throw new Error('Некорректная дата');
}

function normalizeDate_(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, CONFIG.timeZone, 'yyyy-MM-dd');
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) return match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
  return '';
}

function formatRuDate_(dateIso) {
  const parts = dateIso.split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function normalizeClass_(value) {
  return String(value || '').trim().toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, '');
}

function extractSubject_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function unique_(items) {
  return Array.from(new Set(items));
}

function localeCompare_(a, b) {
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

function classCompare_(a, b) {
  return localeCompare_(a, b);
}
