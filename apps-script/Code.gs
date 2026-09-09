const CONFIG = Object.freeze({
  scheduleSheet: 'Расписание',
  changesSheet: 'Изменения',
  teachersSheet: 'Учителя',
  teacherChangesSheet: 'Изменения_учителей',
  timeZone: 'Europe/Moscow',
  sessionSeconds: 21600,
});

function doGet() {
  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('Панель замен — МОУ СОШ № 20')
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
  ensureTeacherChangesSheet_();
  const schedule = getScheduleTable_();
  const classes = unique_(schedule.rows.map(row => normalizeClass_(row[0])).filter(Boolean)).sort(classCompare_);
  const subjects = unique_(schedule.rows.flatMap(row => row.slice(2)).map(extractSubject_).filter(Boolean)).sort(localeCompare_);
  const teachers = getTeacherTable_().teachers;
  return { classes, subjects, teachers, today: isoToday_(), schoolName: 'МОУ СОШ № 20 г. Твери' };
}

function getAdminDay(token, dateIso) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  const schedule = getScheduleTable_();
  const teacherTable = getTeacherTable_();
  const dayIndex = dayColumnIndex_(dateIso, schedule.headers);
  const teacherDayIndex = dayColumnIndex_(dateIso, teacherTable.headers);
  const baseStudent = buildBaseStudentMap_(schedule, dayIndex);
  const cells = [];

  teacherTable.rows.forEach(row => {
    const teacher = String(row[0] || '').trim();
    const lesson = Number(row[1]) || 0;
    if (!teacher || lesson < 1 || lesson > 12 || teacherDayIndex < 0) return;
    const rawClass = normalizeClass_(row[teacherDayIndex]);
    const student = rawClass ? (baseStudent[rawClass + '|' + lesson] || '') : '';
    const parsed = parseStudentValue_(student);
    cells.push({
      teacher,
      lesson,
      className: rawClass,
      subject: parsed.subject,
      room: parsed.room,
      baseStudentText: student,
    });
  });

  return {
    date: dateIso,
    dayName: weekdayName_(dateIso),
    weekend: dayIndex < 0,
    teachers: teacherTable.teachers,
    cells,
    edits: readTeacherEditsForDate_(dateIso),
    studentChanges: readChangesForDate_(dateIso),
    baseStudent,
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
  return { className: normalizedClass, dayName: weekdayName_(dateIso), lessons };
}

function publishAdminDay(token, dateIso, teacherEdits, studentChanges) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  if (!Array.isArray(teacherEdits) || !Array.isArray(studentChanges)) throw new Error('Некорректные данные публикации');

  const normalizedEdits = teacherEdits.map(normalizeTeacherEdit_).filter(Boolean);
  const normalizedChanges = studentChanges.map(item => ({
    className: normalizeClass_(item.className),
    lesson: Number(item.lesson),
    change: String(item.change || '').trim(),
    note: String(item.note || '').trim(),
  })).filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    writeTeacherEditsForDate_(dateIso, normalizedEdits);
    writeStudentChangesForDate_(dateIso, normalizedChanges);
    SpreadsheetApp.flush();
    return {
      teacherCount: normalizedEdits.length,
      studentCount: normalizedChanges.length,
      date: dateIso,
      savedAt: Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss'),
    };
  } finally {
    lock.releaseLock();
  }
}

function publishChanges(token, dateIso, changes) {
  return publishAdminDay(token, dateIso, readTeacherEditsForDate_(dateIso), changes);
}

function writeStudentChangesForDate_(dateIso, normalized) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.changesSheet);
  if (!sheet) throw new Error('Не найден лист «' + CONFIG.changesSheet + '»');
  const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => {
    if (!row.some(cell => String(cell || '').trim())) return false;
    return normalizeDate_(row[0]) !== dateIso;
  });
  const newRows = normalized
    .sort((a, b) => classCompare_(a.className, b.className) || a.lesson - b.lesson)
    .map(item => [formatRuDate_(dateIso), item.className, item.lesson, item.change, item.note]);
  const output = preserved.concat(newRows);
  const clearRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, clearRows, 5).clearContent();
  if (output.length) sheet.getRange(2, 1, output.length, 5).setValues(output);
}

function ensureTeacherChangesSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.teacherChangesSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.teacherChangesSheet);
    sheet.getRange(1, 1, 1, 8).setValues([['Дата','Учитель','Урок','Тип','Класс','Предмет','Кабинет','Примечание']]);
    sheet.hideSheet();
  }
  return sheet;
}

function readTeacherEditsForDate_(dateIso) {
  const sheet = ensureTeacherChangesSheet_();
  const values = sheet.getDataRange().getValues();
  return values.slice(1)
    .filter(row => normalizeDate_(row[0]) === dateIso)
    .map(row => ({
      teacher: String(row[1] || '').trim(),
      lesson: Number(row[2]) || 0,
      type: String(row[3] || '').trim(),
      className: normalizeClass_(row[4]),
      subject: String(row[5] || '').trim(),
      room: String(row[6] || '').trim(),
      note: String(row[7] || '').trim(),
    }))
    .filter(item => item.teacher && item.lesson >= 1 && item.lesson <= 12 && ['cancel','set'].includes(item.type));
}

function writeTeacherEditsForDate_(dateIso, edits) {
  const sheet = ensureTeacherChangesSheet_();
  const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => {
    if (!row.some(cell => String(cell || '').trim())) return false;
    return normalizeDate_(row[0]) !== dateIso;
  });
  const newRows = edits
    .sort((a, b) => localeCompare_(a.teacher, b.teacher) || a.lesson - b.lesson)
    .map(item => [formatRuDate_(dateIso), item.teacher, item.lesson, item.type, item.className, item.subject, item.room, item.note]);
  const output = preserved.concat(newRows);
  const clearRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, clearRows, 8).clearContent();
  if (output.length) sheet.getRange(2, 1, output.length, 8).setValues(output);
}

function normalizeTeacherEdit_(item) {
  const teacher = String(item && item.teacher || '').trim();
  const lesson = Number(item && item.lesson);
  const type = String(item && item.type || '').trim();
  if (!teacher || lesson < 1 || lesson > 12 || !['cancel','set'].includes(type)) return null;
  return {
    teacher,
    lesson,
    type,
    className: type === 'set' ? normalizeClass_(item.className) : '',
    subject: type === 'set' ? String(item.subject || '').trim() : '',
    room: type === 'set' ? String(item.room || '').trim() : '',
    note: String(item.note || '').trim(),
  };
}

function buildBaseStudentMap_(schedule, dayIndex) {
  const out = {};
  if (dayIndex < 0) return out;
  schedule.rows.forEach(row => {
    const className = normalizeClass_(row[0]);
    const lesson = Number(row[1]) || 0;
    if (!className || lesson < 1 || lesson > 12) return;
    out[className + '|' + lesson] = String(row[dayIndex] || '').trim();
  });
  return out;
}

function parseStudentValue_(value) {
  const text = String(value || '').trim();
  if (!text) return { subject: '', room: '' };
  const match = text.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return match ? { subject: match[1].trim(), room: match[2].trim() } : { subject: text, room: '' };
}

function getTeacherTable_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.teachersSheet);
  if (!sheet) throw new Error('Не найден технический лист «' + CONFIG.teachersSheet + '»');
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { headers: [], rows: [], teachers: [] };
  const rows = values.slice(1).filter(row => row.some(Boolean));
  const teachers = unique_(rows.map(row => String(row[0] || '').trim()).filter(Boolean));
  return { headers: values[0], rows, teachers };
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
    .map(row => ({ className: normalizeClass_(row[1]), lesson: Number(row[2]) || 0, change: String(row[3] || '').trim(), note: String(row[4] || '').trim() }))
    .filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change)
    .sort((a, b) => classCompare_(a.className, b.className) || a.lesson - b.lesson);
}

function dayColumnIndex_(dateIso, headers) {
  const codes = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const code = codes[new Date(dateIso + 'T12:00:00Z').getUTCDay()];
  if (code === 'СБ' || code === 'ВС') return -1;
  const aliases = {ПОНЕДЕЛЬНИК:'ПН',ВТОРНИК:'ВТ',СРЕДА:'СР',ЧЕТВЕРГ:'ЧТ',ПЯТНИЦА:'ПТ'};
  const normalized = headers.map(value => {
    const v = String(value || '').trim().toUpperCase();
    return aliases[v] || v;
  });
  return normalized.indexOf(code);
}

function weekdayName_(dateIso) {
  const names = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return names[new Date(dateIso + 'T12:00:00Z').getUTCDay()];
}

function isoToday_() { return Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd'); }
function validateIsoDate_(dateIso) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || ''))) throw new Error('Некорректная дата'); }
function normalizeDate_(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, CONFIG.timeZone, 'yyyy-MM-dd');
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) return match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
  return '';
}
function formatRuDate_(dateIso) { const p = dateIso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
function normalizeClass_(value) { return String(value || '').trim().toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ''); }
function extractSubject_(value) { const text = String(value || '').trim(); return text ? text.replace(/\s*\([^)]*\)\s*$/, '').trim() : ''; }
function unique_(items) { return Array.from(new Set(items)); }
function localeCompare_(a, b) { return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' }); }
function classCompare_(a, b) { return localeCompare_(a, b); }
