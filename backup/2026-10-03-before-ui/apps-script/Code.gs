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

function publishAdminDay(token,dateIso,teacherEdits,studentChanges){assertSession_(token);return publishPayloadCore_(dateIso,teacherEdits,studentChanges,'Сейчас');}

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

function rollbackPublication(token,historyId) {
  assertSession_(token);ensureTechnicalSheets_();const values=getSpreadsheet_().getSheetByName(CONFIG.historySheet).getDataRange().getValues();
  const row=values.slice(1).find(r=>String(r[0]||'')===String(historyId||''));if(!row)throw new Error('Версия истории не найдена');
  const date=normalizeDate_(row[2]);if(!date)throw new Error('Некорректная дата в истории');
  return publishPayloadCore_(date,safeJsonParse_(row[3],[]),safeJsonParse_(row[4],[]),'Откат: '+historyId);
}

function buildBaseDay_(dateIso) {
  const schedule=getScheduleTable_(),teacherTable=getTeacherTable_(),dayIndex=dayColumnIndex_(dateIso,schedule.headers),teacherDayIndex=dayColumnIndex_(dateIso,teacherTable.headers);
  const baseStudent=buildBaseStudentMap_(schedule,dayIndex),cells=[];
  teacherTable.rows.forEach(row=>{
    const teacher=String(row[0]||'').trim(),lesson=Number(row[1])||0;if(!teacher||lesson<1||lesson>12||teacherDayIndex<0)return;
    const tc=parseTeacherCell_(row[teacherDayIndex]),first=S20Schedule.classes(tc.className)[0],student=first?(baseStudent[first+'|'+lesson]||''):'',sp=parseStudentValue_(student);
    cells.push({teacher,lesson,className:tc.className,subject:S20Schedule.subject(tc.subject||sp.subject),room:tc.room||sp.room,baseStudentText:student});
  });return{schedule,teacherTable,dayIndex,teacherDayIndex,baseStudent,cells};
}

function prepareTeacherEdits_(dateIso,teacherEdits) {
  if(!Array.isArray(teacherEdits)||teacherEdits.length>1000)throw new Error('Некорректный список изменений.');
  const base=buildBaseDay_(dateIso),names=new Map(base.teacherTable.teachers.map(t=>[S20Schedule.teacherKey(t),t])),seen=new Map();
  teacherEdits.forEach(raw=>{
    const e=normalizeTeacherEdit_(raw),teacher=names.get(S20Schedule.teacherKey(e.teacher));if(!teacher)throw new Error('Неизвестный учитель: '+e.teacher);e.teacher=teacher;
    if(e.type==='set'){
      const cls=S20Schedule.classes(e.className)[0],parsed=parseStudentValue_(base.baseStudent[cls+'|'+e.lesson]||'');
      if(!e.subject)e.subject=parsed.subject;
      if(!e.room&&!roomOptionalSubject_(e.subject))e.room=parsed.room;
      if(!e.subject)throw new Error(e.teacher+': укажите предмет.');
    }
    // Older archives contain the same initials with and without spaces. Canonical last entry wins.
    seen.set(S20Schedule.slotKey(e),e);
  });return Array.from(seen.values());
}

function buildEffectiveGrid_(dateIso,edits){const base=buildBaseDay_(dateIso);return{base,effective:S20Schedule.effective(base.cells,edits)};}

function validateTeacherGrid_(dateIso,edits) {
  const errors=[],warnings=[],built=buildEffectiveGrid_(dateIso,edits),classes=new Set(built.base.schedule.rows.map(r=>normalizeClass_(r[0])).filter(Boolean));
  edits.forEach(e=>{if(e.type!=='set')return;S20Schedule.classes(e.className).forEach(c=>{if(!classes.has(c)&&!/^[1-4][А-Я]$/.test(c))warnings.push(e.teacher+': класс '+c+' отсутствует в ученическом расписании');});
    if(!e.room&&!roomOptionalSubject_(e.subject))warnings.push(e.teacher+', '+e.lesson+' урок: кабинет не указан');
    if(S20Schedule.classes(e.className).length>1)warnings.push(e.teacher+', '+e.lesson+' урок: объединены '+e.className+'; проверьте общее занятие и учёт часов.');});
  const group=cells=>{const m=new Map();S20Schedule.assignments(cells).forEach(c=>{const k=c.className+'|'+c.lesson;if(!m.has(k))m.set(k,new Set());m.get(k).add(c.teacher);});return m;};
  const before=group(built.base.cells),after=group(built.effective),rooms=new Map();
  after.forEach((teachers,k)=>{if(teachers.size>Math.max(1,before.get(k)?.size||0))errors.push(k.replace('|',', урок ')+': одновременно назначены '+Array.from(teachers).join(', '));});
  built.effective.filter(c=>c.className).forEach(c=>{const room=String(c.room||'').trim();if(!room)return;const k=room+'|'+c.lesson;if(!rooms.has(k))rooms.set(k,new Set());rooms.get(k).add(c.teacher);});
  rooms.forEach((teachers,k)=>{if(teachers.size>1)warnings.push('Кабинет '+k.replace('|',', урок ')+': одновременно '+Array.from(teachers).join(', '));});
  return{ok:!errors.length,errors:unique_(errors),warnings:unique_(warnings)};
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
  return values.slice(1).filter(row => normalizeDate_(row[0]) === dateIso).map(row => ({ teacher:String(row[1]||'').trim(), lesson:Number(row[2])||0, type:String(row[3]||'').trim(), className:S20Schedule.classLabel(row[4]), subject:String(row[5]||'').trim(), room:String(row[6]||'').trim(), note:String(row[7]||'').trim() })).filter(item => item.teacher && item.lesson>=1 && item.lesson<=12 && ['cancel','set'].includes(item.type));
}
function writeTeacherEditsForDate_(dateIso, edits) {
  const sheet = ensureTeacherChangesSheet_(); const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => row.some(cell => String(cell||'').trim()) && normalizeDate_(row[0]) !== dateIso);
  const newRows = edits.sort((a,b)=>localeCompare_(a.teacher,b.teacher)||a.lesson-b.lesson).map(item=>[formatRuDate_(dateIso),item.teacher,item.lesson,item.type,item.className,item.subject,item.room,item.note]);
  rewriteBody_(sheet,8,preserved.concat(newRows));
}
function writeTeacherPublicGrid_(dateIso, edits, preparedGrid) {
  const sheet = ensureTeacherPublicSheet_(); const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => row.some(cell => String(cell||'').trim()) && normalizeDate_(row[0]) !== dateIso);
  const built = preparedGrid || buildEffectiveGrid_(dateIso, edits);
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
  const teacher=String(item&&item.teacher||'').trim(),lesson=Number(item&&item.lesson),type=String(item&&item.type||'').trim();
  if(!teacher||!Number.isInteger(lesson)||lesson<1||lesson>12||!['cancel','set'].includes(type))throw new Error('Некорректная ячейка учителя.');
  const classes=type==='set'?S20Schedule.classes(item.className,true):[];
  if(type==='set'&&!classes.length)throw new Error('Укажите класс для '+teacher+'.');
  return{teacher,lesson,type,className:classes.join(' + '),subject:type==='set'?S20Schedule.subject(item.subject):'',room:type==='set'?String(item.room||'').trim():'',note:String(item.note||'').trim()};
}
function buildBaseStudentMap_(schedule,dayIndex){const out={};if(dayIndex<0)return out;schedule.rows.forEach(row=>{const c=normalizeClass_(row[0]),l=Number(row[1])||0;if(c&&l>=1&&l<=12)out[c+'|'+l]=String(row[dayIndex]||'').trim()});return out}
function parseStudentValue_(value){return S20Schedule.parseLesson(value);}
function parseTeacherCell_(value){
  const text=String(value||'').trim();if(!text)return{className:'',subject:'',room:''};
  const p=text.split(/\r?\n|\s*\|\s*/).map(x=>x.trim());
  return{className:S20Schedule.classLabel(p[0]),subject:S20Schedule.subject(p[1]||''),room:p[2]||''};
}
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
function validateIsoDate_(dateIso){const s=String(dateIso||''),d=new Date(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw new Error('Некорректная дата');}
function normalizeDate_(value){if(value instanceof Date&&!isNaN(value))return Utilities.formatDate(value,CONFIG.timeZone,'yyyy-MM-dd');const text=String(value||'').trim();let m=text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');return''}
function formatRuDate_(dateIso){const p=dateIso.split('-');return p[2]+'.'+p[1]+'.'+p[0]}
function normalizeClass_(value){return String(value||'').trim().toUpperCase().replace(/Ё/g,'Е').replace(/\s+/g,'')}
function extractSubject_(value){const text=String(value||'').trim();return text?text.replace(/\s*\([^)]*\)\s*$/,'').trim():''}
function unique_(items){return Array.from(new Set(items))}
function localeCompare_(a,b){return String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'})}
function classCompare_(a,b){return localeCompare_(a,b)}
