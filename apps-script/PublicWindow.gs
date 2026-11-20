// Окно публичных листов (задание «Ускорение», шаг 3).
//
// Сайт, экраны и бот читают «Учителя_сайт» и «Изменения» целиком, а нужны им только
// ближайшие дни. Поэтому в публичных листах остаётся окно: с понедельника прошлой недели
// и всё будущее. Строки старше переносятся в закрытые листы «Учителя_архив» /
// «Изменения_архив» той же таблицы (скрытые, сайт их не читает).
//
// Перенос: триггер archivePublicSheets каждую ночь в 03:00 и первая публикация дня;
// под LockService, без построчного удаления — диапазон перезаписывается целиком.
// Панель берёт старые даты из архива: readPublicRows_ (открыть прошлую дату, журнал замен).

function publicWindowSpecs_() {
  return [
    { name: CONFIG.teacherPublicSheet, archive: 'Учителя_архив', columns: 11 },
    { name: CONFIG.changesSheet, archive: 'Изменения_архив', columns: 5 },
  ];
}

// Понедельник прошлой недели (по Москве): с него начинается окно.
function publicWindowStart_(todayIso) {
  const d = new Date((todayIso || isoToday_()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
}

// Ночной триггер (и вручную из редактора): перенести старые строки в архив.
function archivePublicSheets() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const out = publicWindowRun_();
    try { out.yearly = yearlyArchiveRun_(); } catch (e) { out.yearly = { error: String(e && e.message || e) }; }
    return out;
  } finally { lock.releaseLock(); }
}

/* Рабочие листы кабинетов — только текущий учебный год (с 1 сентября) ----------------------
   «Журнал_замен» (табель замен) и заявки ИКТ прошлых лет уходят в «Журнал_замен_архив» и
   «Заявки_ИКТ_архив» (в той же таблице, что и рабочий лист). Незакрытые заявки остаются. */

function schoolYearStart_(todayIso) {
  const t = todayIso || isoToday_(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return (m >= 9 ? y : y - 1) + '-09-01';
}

function yearlyArchiveSpecs_() {
  const specs = [{ ss: getSpreadsheet_, name: REPLACEMENTS.journal, archive: REPLACEMENTS.journal + '_архив', columns: REPLACEMENTS.headers.length, date: (r) => normalizeDate_(r[0]) }];
  if (typeof ICT !== 'undefined') specs.push({ ss: ictSpreadsheet_, name: ICT.sheet, archive: ICT.sheet + '_архив', columns: ICT.headers.length,
    date: (r) => normalizeDate_(r[ICT_COL['Создана']]), keep: (r) => ictOpen_(ictRow_(r)) });
  return specs;
}

function yearlyArchiveRun_(todayIso) {
  const start = schoolYearStart_(todayIso), out = {};
  yearlyArchiveSpecs_().forEach((spec) => {
    let ss = null;
    try { ss = spec.ss(); } catch (_) { return; }
    const sheet = ss && ss.getSheetByName(spec.name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = perfRows_(sheet.getRange(1, 1, sheet.getLastRow(), spec.columns).getValues());
    const keep = [], old = [];
    values.slice(1).forEach((r) => {
      if (!r.some((c) => String(c == null ? '' : c).trim())) return;
      const d = spec.date(r);
      (d && d < start && !(spec.keep && spec.keep(r)) ? old : keep).push(r);
    });
    if (old.length) {
      let ar = ss.getSheetByName(spec.archive);
      if (!ar) { ar = ss.insertSheet(spec.archive); ar.getRange(1, 1, 1, spec.columns).setValues([values[0]]); ar.setFrozenRows(1); ar.hideSheet(); }
      const first = Math.max(ar.getLastRow(), 1) + 1, need = first + old.length - 1 - ar.getMaxRows();
      if (need > 0) ar.insertRowsAfter(ar.getMaxRows(), need);
      ar.getRange(first, 1, old.length, spec.columns).setValues(old);
      rewriteBody_(sheet, spec.columns, keep);
    }
    out[spec.name] = { kept: keep.length, moved: old.length };
  });
  return out;
}

// Без блокировки: вызывающий её уже держит. → { «Учителя_сайт»: { kept, moved }, … }
function publicWindowRun_(todayIso) {
  const ss = getSpreadsheet_(), start = publicWindowStart_(todayIso), out = {};
  publicWindowSpecs_().forEach((spec) => {
    const sheet = ss.getSheetByName(spec.name);
    if (!sheet) return;
    const values = perfRows_(sheet.getDataRange().getValues());
    const keep = [], old = [];
    values.slice(1).forEach((r) => {
      if (!r.some((c) => String(c == null ? '' : c).trim())) return;
      const row = r.slice(0, spec.columns);
      while (row.length < spec.columns) row.push('');
      const iso = normalizeDate_(r[0]);
      (iso && iso < start ? old : keep).push(row);
    });
    if (old.length) {
      // Сначала архив, потом публичный лист: при сбое строка окажется в двух местах, но не пропадёт
      // (повторный перенос той же даты заменяет её строки в архиве).
      publicArchiveRows_(ss, spec, values[0] || [], old);
      rewriteBody_(sheet, spec.columns, keep);
    }
    publicTrimRows_(sheet, keep.length);
    out[spec.name] = { kept: keep.length, moved: old.length };
  });
  return out;
}

function publicArchiveSheet_(ss, spec, header) {
  let sheet = ss.getSheetByName(spec.archive);
  if (!sheet) {
    sheet = ss.insertSheet(spec.archive);
    const head = (header || []).slice(0, spec.columns);
    while (head.length < spec.columns) head.push('');
    sheet.getRange(1, 1, 1, spec.columns).setValues([head]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function publicArchiveRows_(ss, spec, header, rows) {
  const sheet = publicArchiveSheet_(ss, spec, header);
  const dates = new Set(rows.map((r) => normalizeDate_(r[0])));
  const last = sheet.getLastRow();
  // Обычно — дописать в конец. Если эти даты уже есть в архиве (дату перепубликовали) —
  // их старые строки заменяются: архив перезаписывается целиком.
  const overlap = last > 1 && perfRows_(sheet.getRange(2, 1, last - 1, 1).getValues()).some((r) => dates.has(normalizeDate_(r[0])));
  if (overlap) {
    const rest = perfRows_(sheet.getRange(2, 1, last - 1, spec.columns).getValues()).filter((r) => r.some((c) => String(c == null ? '' : c).trim()) && !dates.has(normalizeDate_(r[0])));
    rewriteBody_(sheet, spec.columns, rest.concat(rows));
    return;
  }
  const first = Math.max(last, 1) + 1, need = first + rows.length - 1 - sheet.getMaxRows();
  if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need);
  sheet.getRange(first, 1, rows.length, spec.columns).setValues(rows);
}

// Пустые строки после переноса тоже занимают место в таблице (лимит — 10 млн ячеек).
function publicTrimRows_(sheet, dataRows) {
  const keepRows = dataRows + 1 + 200, max = sheet.getMaxRows();
  if (max > keepRows + 500) sheet.deleteRows(keepRows + 1, max - keepRows);
}

// После публикации (под её блокировкой): раз в день — перенос и проверка ночного триггера.
function publicWindowAfterPublish_() {
  try {
    const cache = CacheService.getScriptCache(), key = 'publicWindow:' + isoToday_();
    if (cache.get(key)) return;
    publicWindowRun_();
    cache.put(key, '1', 6 * 3600);
    if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'archivePublicSheets')) {
      ScriptApp.newTrigger('archivePublicSheets').timeBased().everyDays(1).atHour(3).create();
    }
  } catch (_) { /* перенос не должен мешать публикации; ночной триггер сделает его позже */ }
}

// Строки публичного листа за даты from…to: из окна, а если период старше окна — ещё из архива.
function readPublicRows_(ss, sheetName, fromIso, toIso) {
  const spec = publicWindowSpecs_().find((s) => s.name === sheetName);
  const read = (name) => { const s = ss.getSheetByName(name); return s ? perfRows_(s.getDataRange().getValues()).slice(1) : []; };
  const inRange = (r) => { const d = normalizeDate_(r[0]); return d && d >= fromIso && d <= toIso; };
  let rows = read(sheetName).filter(inRange);
  if (spec && fromIso < publicWindowStart_()) {
    const seen = new Set(rows.map((r) => normalizeDate_(r[0])));
    // Дата, которая есть в публичном листе (например, её только что перепубликовали), берётся оттуда.
    rows = rows.concat(read(spec.archive).filter((r) => inRange(r) && !seen.has(normalizeDate_(r[0]))));
  }
  return rows;
}
