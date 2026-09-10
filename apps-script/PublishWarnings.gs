const ENHANCEMENT_SHEETS = Object.freeze({
  status: 'Статус_публикации',
  queue: 'Отложенные_публикации',
  archive: 'Архив_дней',
});

function publishAdminDayAllowWarnings(token, dateIso, teacherEdits, studentChanges) {
  assertSession_(token);
  return publishPayloadCore_(dateIso, teacherEdits, studentChanges, 'Сейчас');
}

function publishAdminDayEnhanced(token, dateIso, teacherEdits, studentChanges) {
  assertSession_(token);
  return publishPayloadCore_(dateIso, teacherEdits, studentChanges, 'Сейчас');
}

function publishPayloadCore_(dateIso, teacherEdits, studentChanges, mode) {
  validateIsoDate_(dateIso);
  if (!Array.isArray(teacherEdits) || !Array.isArray(studentChanges)) {
    throw new Error('Некорректные данные публикации');
  }

  ensureTechnicalSheets_();
  ensureEnhancementSheets_();

  const normalizedEdits = prepareTeacherEdits_(dateIso, teacherEdits);
  const normalizedChanges = studentChanges.map(item => ({
    className: normalizeClass_(item.className),
    lesson: Number(item.lesson),
    change: String(item.change || '').trim(),
    note: String(item.note || '').trim(),
  })).filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change);

  const check = validateTeacherGrid_(dateIso, normalizedEdits);
  const notices = unique_([].concat(check.errors || [], check.warnings || []));
  const summary = buildPublicationSummary_(normalizedEdits, normalizedChanges, notices);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const previousEdits = readTeacherEditsForDate_(dateIso);
    const previousChanges = readChangesForDate_(dateIso);

    writeTeacherEditsForDate_(dateIso, normalizedEdits);
    writeStudentChangesForDate_(dateIso, normalizedChanges);
    writeTeacherPublicGrid_(dateIso, normalizedEdits);
    appendHistory_(dateIso, previousEdits, previousChanges, normalizedEdits, normalizedChanges,
      notices.length ? 'Опубликовано с предупреждениями: ' + notices.length : '');
    const archiveId = appendDailyArchive_(dateIso, normalizedEdits, normalizedChanges, summary, mode || 'Сейчас');
    writePublicationStatus_(dateIso, summary, mode || 'Сейчас');

    SpreadsheetApp.flush();
    return {
      teacherCount: normalizedEdits.length,
      studentCount: normalizedChanges.length,
      date: dateIso,
      savedAt: Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss'),
      warnings: notices,
      summary: summary,
      archiveId: archiveId,
    };
  } finally {
    lock.releaseLock();
  }
}

function getPublicationMeta(token, dateIso) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  const sheet = ensurePublicationStatusSheet_();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).filter(row => normalizeDate_(row[0]) === dateIso);
  if (!rows.length) return null;
  const row = rows[rows.length - 1];
  return {
    date: dateIso,
    publishedAt: row[1] instanceof Date ? Utilities.formatDate(row[1], CONFIG.timeZone, 'dd.MM.yyyy HH:mm:ss') : String(row[1] || ''),
    students: Number(row[2]) || 0,
    teachers: Number(row[3]) || 0,
    warnings: Number(row[4]) || 0,
    mode: String(row[5] || ''),
  };
}

function scheduleAdminPublication(token, dateIso, publishAtIso, teacherEdits, studentChanges) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  const when = new Date(String(publishAtIso || ''));
  if (isNaN(when.getTime())) throw new Error('Некорректное время публикации');
  if (when.getTime() < Date.now() + 30000) throw new Error('Время публикации должно быть хотя бы на минуту позже текущего');
  if (!Array.isArray(teacherEdits) || !Array.isArray(studentChanges)) throw new Error('Некорректные данные публикации');

  const edits = prepareTeacherEdits_(dateIso, teacherEdits);
  const changes = studentChanges.map(item => ({
    className: normalizeClass_(item.className), lesson: Number(item.lesson),
    change: String(item.change || '').trim(), note: String(item.note || '').trim(),
  })).filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change);

  const check = validateTeacherGrid_(dateIso, edits);
  const notices = unique_([].concat(check.errors || [], check.warnings || []));
  const sheet = ensureScheduledSheet_();
  const id = Utilities.getUuid();
  sheet.appendRow([
    id, new Date(), when, formatRuDate_(dateIso), JSON.stringify(edits), JSON.stringify(changes),
    'Ожидает', JSON.stringify(notices), ''
  ]);
  ScriptApp.newTrigger('processScheduledPublications').timeBased().at(when).create();
  return { id, date: dateIso, publishAt: Utilities.formatDate(when, CONFIG.timeZone, 'dd.MM.yyyy HH:mm'), warnings: notices };
}

function getScheduledPublications(token) {
  assertSession_(token);
  const sheet = ensureScheduledSheet_();
  const values = sheet.getDataRange().getValues();
  return values.slice(1).filter(row => row.some(Boolean)).map(row => ({
    id: String(row[0] || ''),
    createdAt: row[1] instanceof Date ? Utilities.formatDate(row[1], CONFIG.timeZone, 'dd.MM.yyyy HH:mm') : String(row[1] || ''),
    publishAt: row[2] instanceof Date ? Utilities.formatDate(row[2], CONFIG.timeZone, 'dd.MM.yyyy HH:mm') : String(row[2] || ''),
    date: normalizeDate_(row[3]),
    status: String(row[6] || ''),
    warnings: safeJsonParse_(row[7], []),
    result: String(row[8] || ''),
  })).reverse().slice(0, 30);
}

function cancelScheduledPublication(token, id) {
  assertSession_(token);
  const sheet = ensureScheduledSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '') !== String(id || '')) continue;
    if (String(values[i][6] || '') !== 'Ожидает') throw new Error('Эта публикация уже обработана');
    sheet.getRange(i + 1, 7).setValue('Отменена');
    return true;
  }
  throw new Error('Отложенная публикация не найдена');
}

function processScheduledPublications() {
  ensureEnhancementSheets_();
  const sheet = ensureScheduledSheet_();
  const values = sheet.getDataRange().getValues();
  const now = Date.now();
  for (let i = 1; i < values.length; i++) {
    const status = String(values[i][6] || '');
    const when = values[i][2] instanceof Date ? values[i][2] : new Date(values[i][2]);
    if (status !== 'Ожидает' || isNaN(when.getTime()) || when.getTime() > now + 15000) continue;
    const dateIso = normalizeDate_(values[i][3]);
    const edits = safeJsonParse_(values[i][4], []);
    const changes = safeJsonParse_(values[i][5], []);
    try {
      const r = publishPayloadCore_(dateIso, edits, changes, 'Отложенно');
      sheet.getRange(i + 1, 7, 1, 3).setValues([['Опубликована', values[i][7] || '[]', 'Опубликовано ' + r.savedAt]]);
    } catch (e) {
      sheet.getRange(i + 1, 7, 1, 3).setValues([['Ошибка', values[i][7] || '[]', String(e && e.message ? e.message : e)]]);
    }
  }
}

function getDailyArchive(token, limit) {
  assertSession_(token);
  const sheet = ensureDailyArchiveSheet_();
  const values = sheet.getDataRange().getValues();
  return values.slice(1).filter(row => row.some(Boolean)).reverse().slice(0, Math.max(1, Math.min(Number(limit) || 30, 100))).map(row => {
    const summary = safeJsonParse_(row[5], {});
    return {
      id: String(row[0] || ''),
      publishedAt: row[1] instanceof Date ? Utilities.formatDate(row[1], CONFIG.timeZone, 'dd.MM.yyyy HH:mm:ss') : String(row[1] || ''),
      date: normalizeDate_(row[2]),
      teacherCount: Number(summary.teacherEdits) || safeJsonParse_(row[3], []).length,
      studentCount: Number(summary.studentChanges) || safeJsonParse_(row[4], []).length,
      cancellations: Number(summary.cancellations) || 0,
      affectedTeachers: Number(summary.affectedTeachers) || 0,
      warnings: Number(summary.warnings) || 0,
      mode: String(row[6] || ''),
    };
  });
}

function getArchiveSnapshot(token, archiveId) {
  assertSession_(token);
  const sheet = ensureDailyArchiveSheet_();
  const values = sheet.getDataRange().getValues();
  const row = values.slice(1).find(r => String(r[0] || '') === String(archiveId || ''));
  if (!row) throw new Error('Снимок архива не найден');
  return {
    id: String(row[0] || ''),
    publishedAt: row[1] instanceof Date ? Utilities.formatDate(row[1], CONFIG.timeZone, 'dd.MM.yyyy HH:mm:ss') : String(row[1] || ''),
    date: normalizeDate_(row[2]),
    teacherEdits: safeJsonParse_(row[3], []),
    studentChanges: safeJsonParse_(row[4], []),
    summary: safeJsonParse_(row[5], {}),
    mode: String(row[6] || ''),
  };
}

function buildPublicationSummary_(edits, changes, notices) {
  const cancellations = edits.filter(x => x.type === 'cancel').length;
  const assignments = edits.filter(x => x.type === 'set').length;
  const affectedTeachers = unique_(edits.map(x => x.teacher).filter(Boolean)).length;
  return {
    teacherEdits: edits.length,
    studentChanges: changes.length,
    cancellations: cancellations,
    windows: cancellations,
    assignments: assignments,
    affectedTeachers: affectedTeachers,
    warnings: (notices || []).length,
  };
}

function writePublicationStatus_(dateIso, summary, mode) {
  const sheet = ensurePublicationStatusSheet_();
  const values = sheet.getDataRange().getValues();
  const preserved = values.slice(1).filter(row => row.some(Boolean) && normalizeDate_(row[0]) !== dateIso);
  const row = [formatRuDate_(dateIso), new Date(), summary.studentChanges, summary.teacherEdits, summary.warnings, mode || 'Сейчас'];
  rewriteBody_(sheet, 6, preserved.concat([row]));
}

function appendDailyArchive_(dateIso, edits, changes, summary, mode) {
  const sheet = ensureDailyArchiveSheet_();
  const id = Utilities.getUuid();
  sheet.appendRow([id, new Date(), formatRuDate_(dateIso), JSON.stringify(edits || []), JSON.stringify(changes || []), JSON.stringify(summary || {}), mode || 'Сейчас']);
  const rows = sheet.getLastRow() - 1;
  if (rows > 180) sheet.deleteRows(2, rows - 180);
  return id;
}

function ensureEnhancementSheets_() {
  ensurePublicationStatusSheet_();
  ensureScheduledSheet_();
  ensureDailyArchiveSheet_();
}

function ensurePublicationStatusSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(ENHANCEMENT_SHEETS.status);
  if (!sheet) {
    sheet = ss.insertSheet(ENHANCEMENT_SHEETS.status);
    sheet.getRange(1, 1, 1, 6).setValues([['Дата','Опубликовано','Ученики','Учителя','Предупреждения','Режим']]);
  }
  return sheet;
}

function ensureScheduledSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(ENHANCEMENT_SHEETS.queue);
  if (!sheet) {
    sheet = ss.insertSheet(ENHANCEMENT_SHEETS.queue);
    sheet.getRange(1, 1, 1, 9).setValues([['ID','Создано','Опубликовать','Дата расписания','Учителя JSON','Ученики JSON','Статус','Предупреждения JSON','Результат']]);
    sheet.hideSheet();
  }
  return sheet;
}

function ensureDailyArchiveSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(ENHANCEMENT_SHEETS.archive);
  if (!sheet) {
    sheet = ss.insertSheet(ENHANCEMENT_SHEETS.archive);
    sheet.getRange(1, 1, 1, 7).setValues([['ID','Опубликовано','Дата расписания','Учителя JSON','Ученики JSON','Сводка JSON','Режим']]);
    sheet.hideSheet();
  }
  return sheet;
}
