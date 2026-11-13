// «Опоздания»: the duty administrator at the entrance taps the class of each pupil who
// comes in after the bell (late.html on the site). Only classes and counts are kept, no
// names. Sheet «Опоздания» has one row per tap (+1, or −1 for «отменить»); sheet
// «Опоздания_смены» has one row per shift the duty administrator closed with «Готово».
// Both are read by the site and the corridor TV through the Sheets API.
//
// late.html talks to doPost with a JSON body {action:'late', pin, who, date, events, close}
// and gets the day's counts back. The duty PIN (LATE_PIN) is not the panel's ADMIN_PIN:
// it only lets someone add marks, and the panel can change it at any time.

const LATE_SHEETS = Object.freeze({ marks: 'Опоздания', shifts: 'Опоздания_смены' });
const LATE_MAX_FAILS = 20;
const LATE_WINDOW_SECONDS = 900;
const LATE_MAX_EVENTS = 200;   // one request: an offline queue of a whole morning at most
const LATE_DAYS_BACK = 3;       // a queue that waited over a weekend is still accepted

function ensureLateSheets_() {
  const ss = getSpreadsheet_();
  let marks = ss.getSheetByName(LATE_SHEETS.marks);
  if (!marks) {
    marks = ss.insertSheet(LATE_SHEETS.marks);
    marks.getRange(1, 1, 1, 6).setValues([['ID', 'Дата', 'Время', 'Класс', 'Изменение', 'Дежурный']]);
    marks.setFrozenRows(1);
  }
  let shifts = ss.getSheetByName(LATE_SHEETS.shifts);
  if (!shifts) {
    shifts = ss.insertSheet(LATE_SHEETS.shifts);
    shifts.getRange(1, 1, 1, 4).setValues([['Дата', 'Смена', 'Закрыто', 'Дежурный']]);
    shifts.setFrozenRows(1);
  }
  return { marks, shifts };
}

function lateJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// The same pause as the panel login: after LATE_MAX_FAILS wrong PINs in 15 minutes nobody
// can try again until the window passes, so the PIN cannot be found by trying them all.
function latePinError_(pin) {
  const expected = PropertiesService.getScriptProperties().getProperty('LATE_PIN');
  if (!expected) return 'ПИН для дежурных ещё не задан. Его задаёт завуч в панели замен.';
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('late:fails') || 0);
  if (fails >= LATE_MAX_FAILS) return 'Слишком много неверных попыток. Подождите 15 минут.';
  if (String(pin || '') !== String(expected)) {
    cache.put('late:fails', String(fails + 1), LATE_WINDOW_SECONDS);
    Utilities.sleep(800);
    return 'Неверный ПИН';
  }
  return '';
}

// Dates a mark may carry: today and a few days back, never the future.
function lateDateAllowed_(dateIso) {
  if (!dateIso) return false;
  const days = (new Date(isoToday_() + 'T12:00:00Z') - new Date(dateIso + 'T12:00:00Z')) / 86400000;
  return days >= 0 && days <= LATE_DAYS_BACK;
}

function lateClasses_() {
  return unique_(getScheduleTable_().rows.map((row) => normalizeClass_(row[0])).filter(Boolean)).sort(classCompare_);
}

// Counts of one day by class, the closed shifts of that day and the ids already stored.
function lateDayState_(sheets, dateIso) {
  const counts = {}, ids = new Set();
  sheets.marks.getDataRange().getValues().slice(1).forEach((r) => {
    if (r[0]) ids.add(String(r[0]));
    if (normalizeDate_(r[1]) !== dateIso) return;
    const cls = normalizeClass_(r[3]);
    if (!cls) return;
    counts[cls] = Math.max(0, (counts[cls] || 0) + (Number(r[4]) || 0));
  });
  const closed = [];
  sheets.shifts.getDataRange().getValues().slice(1).forEach((r) => {
    if (normalizeDate_(r[0]) !== dateIso) return;
    const shift = Number(r[1]);
    if ((shift === 1 || shift === 2) && !closed.includes(shift)) closed.push(shift);
  });
  return { counts, closed: closed.sort(), ids };
}

function handleLatePost_(body) {
  const pinError = latePinError_(body.pin);
  if (pinError) return { ok: false, error: pinError, pin: true };
  const date = normalizeDate_(body.date) || isoToday_();
  if (!lateDateAllowed_(date)) return { ok: false, error: 'Можно отмечать только сегодняшний день' };
  const who = String(body.who || '').trim().slice(0, 60);
  const events = Array.isArray(body.events) ? body.events.slice(0, LATE_MAX_EVENTS) : [];
  const close = Number(body.close) || 0;
  if ((events.length || close) && !who) return { ok: false, error: 'Укажите, кто дежурит' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheets = ensureLateSheets_();
    const classes = lateClasses_();
    const known = new Set(classes);
    const state = lateDayState_(sheets, date);
    const accepted = [], rows = [];
    const time = Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss');
    const byDate = { [date]: state };
    events.forEach((ev) => {
      const id = String(ev && ev.id || '');
      if (!/^[\w-]{6,64}$/.test(id)) return;
      if (state.ids.has(id)) { accepted.push(id); return; } // sent before, the answer was lost
      const cls = normalizeClass_(ev.cls);
      const delta = Number(ev.delta) === -1 ? -1 : 1;
      const evDate = normalizeDate_(ev.date) || date;
      if (!known.has(cls) || !lateDateAllowed_(evDate)) { accepted.push(id); return; } // drop, never retry
      if (!byDate[evDate]) byDate[evDate] = lateDayState_(sheets, evDate);
      const day = byDate[evDate];
      if (delta < 0 && !(day.counts[cls] > 0)) { accepted.push(id); return; } // nothing to take back
      day.counts[cls] = (day.counts[cls] || 0) + delta;
      state.ids.add(id);
      rows.push([id, formatRuDate_(evDate), String(ev.time || time).slice(0, 8), cls, delta, String(ev.who || who).trim().slice(0, 60)]);
      accepted.push(id);
    });
    if (rows.length) sheets.marks.getRange(sheets.marks.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    if ((close === 1 || close === 2) && !state.closed.includes(close)) {
      sheets.shifts.appendRow([formatRuDate_(date), close, time, who]);
      state.closed.push(close);
      state.closed.sort();
    }
    return { ok: true, date, today: isoToday_(), classes, counts: state.counts, closed: state.closed, accepted };
  } finally {
    lock.releaseLock();
  }
}

// Panel: whether a duty PIN is set, and setting a new one (4–8 digits).
function getLateSettings(token) {
  assertSession_(token);
  const pin = PropertiesService.getScriptProperties().getProperty('LATE_PIN') || '';
  return { pinSet: Boolean(pin) };
}

function setLatePin(token, pin) {
  assertSession_(token);
  const value = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(value)) throw new Error('ПИН — от 4 до 8 цифр');
  if (value === String(PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '')) throw new Error('ПИН дежурных не должен совпадать с ПИН-кодом панели');
  PropertiesService.getScriptProperties().setProperty('LATE_PIN', value);
  ensureLateSheets_();
  return { pinSet: true };
}
