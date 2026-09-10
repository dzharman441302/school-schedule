function publishAdminDayAllowWarnings(token, dateIso, teacherEdits, studentChanges) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  if (!Array.isArray(teacherEdits) || !Array.isArray(studentChanges)) {
    throw new Error('Некорректные данные публикации');
  }

  ensureTechnicalSheets_();
  const normalizedEdits = prepareTeacherEdits_(dateIso, teacherEdits);
  const normalizedChanges = studentChanges.map(item => ({
    className: normalizeClass_(item.className),
    lesson: Number(item.lesson),
    change: String(item.change || '').trim(),
    note: String(item.note || '').trim(),
  })).filter(item => item.className && item.lesson >= 1 && item.lesson <= 12 && item.change);

  // Проверка остаётся диагностической: любые найденные конфликты показываются
  // администратору как предупреждения, но не блокируют публикацию.
  const check = validateTeacherGrid_(dateIso, normalizedEdits);
  const notices = unique_([].concat(check.errors || [], check.warnings || []));

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

    SpreadsheetApp.flush();
    return {
      teacherCount: normalizedEdits.length,
      studentCount: normalizedChanges.length,
      date: dateIso,
      savedAt: Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss'),
      warnings: notices,
    };
  } finally {
    lock.releaseLock();
  }
}
