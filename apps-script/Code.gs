const CONFIG = Object.freeze({
  scheduleSheet: 'Расписание',
  changesSheet: 'Изменения',
  teachersSheet: 'Учителя',
  teacherChangesSheet: 'Изменения_учителей',
  teacherPublicSheet: 'Учителя_сайт',
  historySheet: 'История_публикаций',
  timeZone: 'Europe/Moscow',
  sessionSeconds: 21600,
  historyLimit: 30,
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
  ensureTechnicalSheets_();
  const schedule = getScheduleTable_();
  const classes = unique_(schedule.rows.map(row => normalizeClass_(row[0])).filter(Boolean)).sort(classCompare_);
  const subjects = unique_(schedule.rows.flatMap(row => row.slice(2)).map(extractSubject_).filter(Boolean)).sort(localeCompare_);
  const teachers = getTeacherTable_().teachers;
  return { classes, subjects, teachers, today: isoToday_(), schoolName: 'МОУ СОШ № 20 г. Твери' };
}

function getAdminDay(token, dateIso) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  ensureTechnicalSheets_();
  const base = buildBaseDay_(dateIso);
  return {
    date: dateIso,
    dayName: weekdayName_(dateIso),
    weekend: base.dayIndex < 0,
    teachers: base.teacherTable.teachers,
    cells: base.cells,
    edits: readTeacherEditsForDate_(dateIso),
    studentChanges: readChangesForDate_(dateIso),
    baseStudent: base.baseStudent,
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

function validateAdminDay(token, dateIso, teacherEdits) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  const prepared = prepareTeacherEdits_(dateIso, teacherEdits || []);
  return validateTeacherGrid_(dateIso, prepared);
}

function publishAdminDay(token, dateIso, teacherEdits, studentChanges) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  if (!Array.isArray(teacherEdits) || !Array.isArray(studentChanges)) throw new Error('Некорректные данные публикации');

  ensureTechnicalSheets_();
  const normalizedEdits = prepareTeacherEdits_(dateIso, teacherEdits);
  const normalizedChanges = studentChanges.map(item => ({
    className: normalizeClass_(item.className),
    lesson: Number(item.lesson),
    change: String(item.change || '').trim(),
    note: String(item.note || '').trim(),
  })).filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change);

  const check = validateTeacherGrid_(dateIso, normalizedEdits);
  if (check.errors.length) {
    throw new Error('Публикация остановлена.\n' + check.errors.map((x, i) => (i + 1) + '. ' + x).join('\n'));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const previousEdits = readTeacherEditsForDate_(dateIso);
    const previousChanges = readChangesForDate_(dateIso);
    writeTeacherEditsForDate_(dateIso, normalizedEdits);
    writeStudentChangesForDate_(dateIso, normalizedChanges);
    writeTeacherPublicGrid_(dateIso, normalizedEdits);
    appendHistory_(dateIso, previousEdits, previousChanges, normalizedEdits, normalizedChanges);
    SpreadsheetApp.flush();
    return {
      teacherCount: normalizedEdits.length,
      studentCount: normalizedChanges.length,
      date: dateIso,
      savedAt: Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss'),
      warnings: check.warnings,
    };
  } finally {
    lock.releaseLock();
  }
}

function publishChanges(token, dateIso, changes) {
  return publishAdminDay(token, dateIso, readTeacherEditsForDate_(dateIso), changes);
}

function getPublicationHistory(token, limit) {
  assertSession_(token);
  ensureTechnicalSheets_();
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.historySheet);
  const values = sheet.getDataRange().getValues();
  return values.slice(1).filter(row => row.some(Boolean)).reverse().slice(0, Math.max(1, Math.min(Number(limit) || 15, 50))).map(row => ({
    id: String(row[0] || ''),
    publishedAt: row[1] instanceof Date ? Utilities.formatDate(row[1], CONFIG.timeZone, 'dd.MM.yyyy HH:mm:ss') : String(row[1] || ''),
    date: normalizeDate_(row[2]),
    teacherCount: safeJsonParse_(row[3], []).length,
    studentCount: safeJsonParse_(row[4], []).length,
    comment: String(row[6] || ''),
  }));
}

function rollbackPublication(token, historyId) {
  assertSession_(token);
  ensureTechnicalSheets_();
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.historySheet);
  const values = sheet.getDataRange().getValues();
  const row = values.slice(1).find(r => String(r[0] || '') === String(historyId || ''));
  if (!row) throw new Error('Версия истории не найдена');
  const dateIso = normalizeDate_(row[2]);
  const previousEdits = safeJsonParse_(row[3], []);
  const previousChanges = safeJsonParse_(row[4], []);
  if (!dateIso) throw new Error('Некорректная дата в истории');
  const check = validateTeacherGrid_(dateIso, prepareTeacherEdits_(dateIso, previousEdits));
  if (check.errors.length) throw new Error('Нельзя откатить: ' + check.errors.join('; '));

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const currentEdits = readTeacherEditsForDate_(dateIso);
    const currentChanges = readChangesForDate_(dateIso);
    writeTeacherEditsForDate_(dateIso, previousEdits);
    writeStudentChangesForDate_(dateIso, previousChanges);
    writeTeacherPublicGrid_(dateIso, previousEdits);
    appendHistory_(dateIso, currentEdits, currentChanges, previousEdits, previousChanges, 'Откат к ' + historyId);
    SpreadsheetApp.flush();
    return { date: dateIso, teacherCount: previousEdits.length, studentCount: previousChanges.length };
  } finally {
    lock.releaseLock();
  }
}

function buildBaseDay_(dateIso) {
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
    const teacherCell = parseTeacherCell_(row[teacherDayIndex]);
    const rawClass = teacherCell.className;
    const student = rawClass ? (baseStudent[rawClass + '|' + lesson] || '') : '';
    const parsedStudent = parseStudentValue_(student);
    cells.push({ teacher, lesson, className: rawClass, subject: teacherCell.subject || parsedStudent.subject, room: teacherCell.room || parsedStudent.room, baseStudentText: student });
  });
  return { schedule, teacherTable, dayIndex, teacherDayIndex, baseStudent, cells };
}

function prepareTeacherEdits_(dateIso, teacherEdits) {
  if (!Array.isArray(teacherEdits)) return [];
  const base = buildBaseDay_(dateIso);
  const seen = {};
  return teacherEdits.map(normalizeTeacherEdit_).filter(Boolean).map(item => {
    const k = item.teacher + '|' + item.lesson;
    if (seen[k]) return null;
    seen[k] = true;
    if (item.type === 'set' && item.className) {
      const parsed = parseStudentValue_(base.baseStudent[item.className + '|' + item.lesson] || '');
      if (!item.subject) item.subject = parsed.subject;
      if (!item.room) item.room = parsed.room;
    }
    return item;
  }).filter(Boolean);
}

function buildEffectiveGrid_(dateIso, edits) {
  const base = buildBaseDay_(dateIso);
  const editMap = {};
  edits.forEach(e => { editMap[e.teacher + '|' + e.lesson] = e; });
  const effective = base.cells.map(cell => {
    const edit = editMap[cell.teacher + '|' + cell.lesson];
    const out = { teacher: cell.teacher, lesson: cell.lesson, baseClass: cell.className, baseSubject: cell.subject, baseRoom: cell.room, className: cell.className, subject: cell.subject, room: cell.room, status: 'normal', note: '' };
    if (!edit) return out;
    out.note = edit.note || '';
    if (edit.type === 'cancel') { out.className = ''; out.subject = ''; out.room = ''; out.status = 'cancelled'; return out; }
    out.className = edit.className; out.subject = edit.subject; out.room = edit.room;
    if (!cell.className) out.status = 'added';
    else if (cell.className === edit.className && cell.subject === edit.subject && cell.room !== edit.room) out.status = 'room';
    else if (cell.className === edit.className && cell.subject === edit.subject && cell.room === edit.room) out.status = 'normal';
    else out.status = 'changed';
    return out;
  });
  return { base, effective };
}

function validateTeacherGrid_(dateIso, edits) {
  const errors = [];
  const warnings = [];
  const built = buildEffectiveGrid_(dateIso, edits);
  const teachers = new Set(built.base.teacherTable.teachers);
  const classes = new Set(built.base.schedule.rows.map(r => normalizeClass_(r[0])).filter(Boolean));
  edits.forEach(e => {
    if (!teachers.has(e.teacher)) errors.push('Неизвестный учитель: ' + e.teacher);
    if (e.type === 'set') {
      if (!e.className) errors.push(e.teacher + ', ' + e.lesson + ' урок: не указан класс');
      else if (!classes.has(e.className) && !/^[1-4][А-Я]$/.test(e.className)) warnings.push(e.teacher + ', ' + e.lesson + ' урок: класс ' + e.className + ' отсутствует в ученическом расписании');
      if (!e.subject) errors.push(e.teacher + ', ' + e.lesson + ' урок: не указан предмет');
      if (!e.room && !roomOptionalSubject_(e.subject)) warnings.push(e.teacher + ', ' + e.lesson + ' урок: кабинет не указан');
    }
  });

  const baseClassTeachers = {};
  built.base.cells.forEach(c => { if (!c.className) return; const k = c.className + '|' + c.lesson; if (!baseClassTeachers[k]) baseClassTeachers[k] = new Set(); baseClassTeachers[k].add(c.teacher); });
  const effectiveClassTeachers = {};
  const roomTeachers = {};
  built.effective.forEach(c => {
    if (c.className) { const k = c.className + '|' + c.lesson; if (!effectiveClassTeachers[k]) effectiveClassTeachers[k] = new Set(); effectiveClassTeachers[k].add(c.teacher); }
    if (/^\d{3}$/.test(String(c.room || ''))) { const rk = c.room + '|' + c.lesson; if (!roomTeachers[rk]) roomTeachers[rk] = new Set(); roomTeachers[rk].add(c.teacher); }
  });
  Object.keys(effectiveClassTeachers).forEach(k => {
    const count = effectiveClassTeachers[k].size;
    const allowed = Math.max(1, baseClassTeachers[k] ? baseClassTeachers[k].size : 0);
    if (count > allowed) { const parts = k.split('|'); errors.push(parts[0] + ', ' + parts[1] + ' урок: назначен одновременно ' + Array.from(effectiveClassTeachers[k]).join(', ')); }
  });
  Object.keys(roomTeachers).forEach(k => {
    if (roomTeachers[k].size > 1) { const parts = k.split('|'); errors.push('Кабинет ' + parts[0] + ', ' + parts[1] + ' урок: одновременно ' + Array.from(roomTeachers[k]).join(', ')); }
  });
  return { ok: errors.length === 0, errors: unique_(errors), warnings: unique_(warnings) };
}

function writeStudentChangesForDate_(dateIso, normalized) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.changesSheet);
  if (!sheet) throw new Error('Не найден лист «' + CONFIG.changesSheet + '»');
  const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => row.some(cell => String(cell || '').trim()) && normalizeDate_(row[0]) !== dateIso);
  const newRows = normalized.sort((a, b) => classCompare_(a.className, b.className) || a.lesson - b.lesson).map(item => [formatRuDate_(dateIso), item.className, item.lesson, item.change, item.note]);
  rewriteBody_(sheet, 5, preserved.concat(newRows));
}

function ensureTechnicalSheets_() { ensureTeacherChangesSheet_(); ensureTeacherPublicSheet_(); ensureHistorySheet_(); }
function ensureTeacherChangesSheet_() {
  const ss = getSpreadsheet_(); let sheet = ss.getSheetByName(CONFIG.teacherChangesSheet);
  if (!sheet) { sheet = ss.insertSheet(CONFIG.teacherChangesSheet); sheet.getRange(1,1,1,8).setValues([['Дата','Учитель','Урок','Тип','Класс','Предмет','Кабинет','Примечание']]); sheet.hideSheet(); }
  return sheet;
}
function ensureTeacherPublicSheet_() {
  const ss = getSpreadsheet_(); let sheet = ss.getSheetByName(CONFIG.teacherPublicSheet);
  if (!sheet) { sheet = ss.insertSheet(CONFIG.teacherPublicSheet); sheet.getRange(1,1,1,11).setValues([['Дата','Учитель','Урок','Класс','Предмет','Кабинет','Статус','Было_класс','Было_предмет','Было_кабинет','Примечание']]); }
  return sheet;
}
function ensureHistorySheet_() {
  const ss = getSpreadsheet_(); let sheet = ss.getSheetByName(CONFIG.historySheet);
  if (!sheet) { sheet = ss.insertSheet(CONFIG.historySheet); sheet.getRange(1,1,1,7).setValues([['ID','Дата публикации','Дата расписания','Предыдущие учителя JSON','Предыдущие ученики JSON','Новые ученики JSON','Комментарий']]); sheet.hideSheet(); }
  return sheet;
}
function readTeacherEditsForDate_(dateIso) {
  const sheet = ensureTeacherChangesSheet_(); const values = sheet.getDataRange().getValues();
  return values.slice(1).filter(row => normalizeDate_(row[0]) === dateIso).map(row => ({ teacher:String(row[1]||'').trim(), lesson:Number(row[2])||0, type:String(row[3]||'').trim(), className:normalizeClass_(row[4]), subject:String(row[5]||'').trim(), room:String(row[6]||'').trim(), note:String(row[7]||'').trim() })).filter(item => item.teacher && item.lesson>=1 && item.lesson<=12 && ['cancel','set'].includes(item.type));
}
function writeTeacherEditsForDate_(dateIso, edits) {
  const sheet = ensureTeacherChangesSheet_(); const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => row.some(cell => String(cell||'').trim()) && normalizeDate_(row[0]) !== dateIso);
  const newRows = edits.sort((a,b)=>localeCompare_(a.teacher,b.teacher)||a.lesson-b.lesson).map(item=>[formatRuDate_(dateIso),item.teacher,item.lesson,item.type,item.className,item.subject,item.room,item.note]);
  rewriteBody_(sheet,8,preserved.concat(newRows));
}
function writeTeacherPublicGrid_(dateIso, edits) {
  const sheet = ensureTeacherPublicSheet_(); const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => row.some(cell => String(cell||'').trim()) && normalizeDate_(row[0]) !== dateIso);
  const built = buildEffectiveGrid_(dateIso, edits);
  const rows = built.effective.map(c=>[formatRuDate_(dateIso),c.teacher,c.lesson,c.className,c.subject,c.room,c.status,c.baseClass,c.baseSubject,c.baseRoom,c.note]);
  rewriteBody_(sheet,11,preserved.concat(rows));
}
function appendHistory_(dateIso, previousEdits, previousChanges, newEdits, newChanges, comment) {
  const sheet = ensureHistorySheet_();
  sheet.appendRow([Utilities.getUuid(),new Date(),formatRuDate_(dateIso),JSON.stringify(previousEdits||[]),JSON.stringify(previousChanges||[]),JSON.stringify(newChanges||[]),comment||'']);
  const dataRows = sheet.getLastRow()-1; if (dataRows>CONFIG.historyLimit) sheet.deleteRows(2,dataRows-CONFIG.historyLimit);
}
function rewriteBody_(sheet, columns, rows) {
  const currentRows=Math.max(sheet.getMaxRows()-1,1); if(rows.length>currentRows) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length-currentRows);
  sheet.getRange(2,1,Math.max(sheet.getMaxRows()-1,1),columns).clearContent(); if(rows.length) sheet.getRange(2,1,rows.length,columns).setValues(rows);
}
function normalizeTeacherEdit_(item) {
  const teacher=String(item&&item.teacher||'').trim(), lesson=Number(item&&item.lesson), type=String(item&&item.type||'').trim();
  if(!teacher||lesson<1||lesson>12||!['cancel','set'].includes(type))return null;
  return {teacher,lesson,type,className:type==='set'?normalizeClass_(item.className):'',subject:type==='set'?String(item.subject||'').trim():'',room:type==='set'?String(item.room||'').trim():'',note:String(item.note||'').trim()};
}
function buildBaseStudentMap_(schedule,dayIndex){const out={};if(dayIndex<0)return out;schedule.rows.forEach(row=>{const c=normalizeClass_(row[0]),l=Number(row[1])||0;if(c&&l>=1&&l<=12)out[c+'|'+l]=String(row[dayIndex]||'').trim()});return out}
function parseStudentValue_(value){const text=String(value||'').trim();if(!text)return{subject:'',room:''};const m=text.match(/^(.*?)\s*\(([^()]*)\)\s*$/);return m?{subject:m[1].trim(),room:m[2].trim()}:{subject:text,room:''}}
function parseTeacherCell_(value){const text=String(value||'').trim();if(!text)return{className:'',subject:'',room:''};const p=text.split(/\r?\n|\s*\|\s*/).map(x=>x.trim()).filter(Boolean);if(p.length>=2&&/^(?:10|11|[1-9])[А-Я]$/i.test(p[0]))return{className:normalizeClass_(p[0]),subject:p[1]||'',room:p[2]||''};return{className:normalizeClass_(text),subject:'',room:''}}
function getTeacherTable_(){const sheet=getSpreadsheet_().getSheetByName(CONFIG.teachersSheet);if(!sheet)throw new Error('Не найден технический лист «'+CONFIG.teachersSheet+'»');const values=sheet.getDataRange().getDisplayValues();if(!values.length)return{headers:[],rows:[],teachers:[]};const rows=values.slice(1).filter(row=>row.some(Boolean)),teachers=unique_(rows.map(row=>String(row[0]||'').trim()).filter(Boolean));return{headers:values[0],rows,teachers}}
function assertSession_(token){const key='session:'+String(token||''),cache=CacheService.getScriptCache();if(!token||cache.get(key)!=='1')throw new Error('Сессия истекла. Введите PIN-код ещё раз.');cache.put(key,'1',CONFIG.sessionSeconds)}
function getSpreadsheet_(){return SpreadsheetApp.openById(getRequiredProperty_('SPREADSHEET_ID'))}
function getRequiredProperty_(name){const value=PropertiesService.getScriptProperties().getProperty(name);if(!value)throw new Error('Не задано свойство скрипта '+name);return value}
function getScheduleTable_(){const sheet=getSpreadsheet_().getSheetByName(CONFIG.scheduleSheet);if(!sheet)throw new Error('Не найден лист «'+CONFIG.scheduleSheet+'»');const values=sheet.getDataRange().getDisplayValues();if(!values.length)return{headers:[],rows:[]};return{headers:values[0],rows:values.slice(1).filter(row=>row.some(Boolean))}}
function readChangesForDate_(dateIso){const sheet=getSpreadsheet_().getSheetByName(CONFIG.changesSheet);if(!sheet)throw new Error('Не найден лист «'+CONFIG.changesSheet+'»');const values=sheet.getDataRange().getValues();return values.slice(1).filter(row=>normalizeDate_(row[0])===dateIso).map(row=>({className:normalizeClass_(row[1]),lesson:Number(row[2])||0,change:String(row[3]||'').trim(),note:String(row[4]||'').trim()})).filter(item=>item.className&&item.lesson>=1&&item.lesson<=12&&item.change).sort((a,b)=>classCompare_(a.className,b.className)||a.lesson-b.lesson)}
function dayColumnIndex_(dateIso,headers){const codes=['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'],code=codes[new Date(dateIso+'T12:00:00Z').getUTCDay()];if(code==='СБ'||code==='ВС')return-1;const aliases={ПОНЕДЕЛЬНИК:'ПН',ВТОРНИК:'ВТ',СРЕДА:'СР',ЧЕТВЕРГ:'ЧТ',ПЯТНИЦА:'ПТ'};const normalized=headers.map(value=>{const v=String(value||'').trim().toUpperCase();return aliases[v]||v});return normalized.indexOf(code)}
function weekdayName_(dateIso){const names=['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];return names[new Date(dateIso+'T12:00:00Z').getUTCDay()]}
function roomOptionalSubject_(subject){return/Ф-?РА|ФИЗИЧЕСК|ТРУД|ПРОФ|ВНЕУР/i.test(String(subject||''))}
function safeJsonParse_(value,fallback){try{return JSON.parse(String(value||''))}catch(_){return fallback}}
function isoToday_(){return Utilities.formatDate(new Date(),CONFIG.timeZone,'yyyy-MM-dd')}
function validateIsoDate_(dateIso){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso||'')))throw new Error('Некорректная дата')}
function normalizeDate_(value){if(value instanceof Date&&!isNaN(value))return Utilities.formatDate(value,CONFIG.timeZone,'yyyy-MM-dd');const text=String(value||'').trim();let m=text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');return''}
function formatRuDate_(dateIso){const p=dateIso.split('-');return p[2]+'.'+p[1]+'.'+p[0]}
function normalizeClass_(value){return String(value||'').trim().toUpperCase().replace(/Ё/g,'Е').replace(/\s+/g,'')}
function extractSubject_(value){const text=String(value||'').trim();return text?text.replace(/\s*\([^)]*\)\s*$/,'').trim():''}
function unique_(items){return Array.from(new Set(items))}
function localeCompare_(a,b){return String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'})}
function classCompare_(a,b){return localeCompare_(a,b)}
