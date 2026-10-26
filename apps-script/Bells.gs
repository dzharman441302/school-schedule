// Bell times in one place. Sheet «Звонки»: Урок | Основное | Сокращённое (cells like
// «08:00–08:40»); sheet «Звонки_даты»: Дата | Вариант | Комментарий for the days that use a
// variant other than the usual one. The site, the TV screens, the MAX bot and this panel all
// read these sheets; without them everything falls back to BELL_DEFAULT below.
const BELL_SHEETS = Object.freeze({ times: 'Звонки', dates: 'Звонки_даты' });
const BELL_BASE = 'Основное', BELL_SHORT = 'Сокращённое';
const BELL_DEFAULT = [['08:00', '08:40'], ['08:50', '09:30'], ['09:45', '10:25'], ['10:45', '11:25'], ['11:40', '12:20'], ['12:30', '13:10'], ['13:20', '14:00'], ['14:15', '14:55'], ['15:10', '15:50'], ['16:05', '16:45'], ['17:00', '17:40'], ['17:50', '18:30']];

function ensureBellSheets_() {
  const ss = getSpreadsheet_();
  if (!ss.getSheetByName(BELL_SHEETS.times)) {
    const sh = ss.insertSheet(BELL_SHEETS.times);
    sh.getRange(1, 1, 13, 3).setValues([['Урок', BELL_BASE, BELL_SHORT]].concat(BELL_DEFAULT.map((b, i) => [i + 1, b.join('–'), ''])));
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(BELL_SHEETS.dates)) {
    const sh = ss.insertSheet(BELL_SHEETS.dates);
    sh.getRange(1, 1, 1, 3).setValues([['Дата', 'Вариант', 'Комментарий']]);
    sh.setFrozenRows(1);
  }
}

// «8:00-8:40», «08:00 – 08:40» → ['08:00', '08:40']; anything else → null.
function parseBellRange_(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59 || b <= a) return null;
  const hm = (h, mm) => String(h).padStart(2, '0') + ':' + mm;
  return [hm(m[1], m[2]), hm(m[3], m[4])];
}

const bellMinutes_ = (t) => { const p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1]); };

// A full variant: 12 lessons, each ending before the next one starts.
function bellProblems_(times) {
  const problems = [];
  times.forEach((t, i) => {
    if (!t) problems.push((i + 1) + ' урок: время не указано');
    else if (i && times[i - 1] && bellMinutes_(t[0]) < bellMinutes_(times[i - 1][1])) problems.push((i + 1) + ' урок начинается раньше конца ' + i + '-го');
  });
  return problems;
}

function readBells_() {
  ensureBellSheets_();
  const ss = getSpreadsheet_(), rows = ss.getSheetByName(BELL_SHEETS.times).getDataRange().getDisplayValues();
  const head = rows[0] || [], variants = {}, order = [];
  for (let c = 1; c < head.length; c++) {
    const name = String(head[c] || '').trim();
    if (!name || variants[name]) continue;
    const times = [];
    for (let l = 1; l <= 12; l++) {
      const row = rows.slice(1).find((r) => Number(r[0]) === l);
      times.push(parseBellRange_(row ? row[c] : ''));
    }
    variants[name] = times;
    order.push(name);
  }
  if (!variants[BELL_BASE]) { variants[BELL_BASE] = BELL_DEFAULT.map((b) => b.slice()); order.unshift(BELL_BASE); }
  variants[BELL_BASE] = variants[BELL_BASE].map((t, i) => t || BELL_DEFAULT[i].slice());
  const ready = {};
  order.forEach((name) => { ready[name] = !bellProblems_(variants[name]).length; });
  const dates = {};
  ss.getSheetByName(BELL_SHEETS.dates).getDataRange().getValues().slice(1).forEach((r) => {
    const date = normalizeDate_(r[0]), name = String(r[1] || '').trim();
    if (date && name && ready[name] && name !== BELL_BASE) dates[date] = { variant: name, comment: String(r[2] || '').trim() };
  });
  return { variants, order, ready, dates };
}

function bellsForDate_(dateIso, bells) {
  const b = bells || readBells_(), day = b.dates[dateIso], name = day ? day.variant : BELL_BASE;
  return { variant: name, times: b.variants[name] || b.variants[BELL_BASE] };
}

function getBells(token) {
  assertSession_(token);
  const b = readBells_(), today = isoToday_();
  return { variants: b.variants, order: b.order, ready: b.ready, dates: Object.keys(b.dates).filter((d) => d >= today).sort().map((d) => ({ date: d, variant: b.dates[d].variant, comment: b.dates[d].comment })) };
}

// Saves whole variants from the panel editor: { 'Сокращённое': ['08:00–08:30', …12] }.
// The usual variant must be complete; another one may stay empty until it is needed.
function saveBells(token, input) {
  assertSession_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureBellSheets_();
    const sh = getSpreadsheet_().getSheetByName(BELL_SHEETS.times), rows = sh.getDataRange().getDisplayValues();
    const head = (rows[0] || ['Урок']).map((x) => String(x || '').trim());
    Object.keys(input || {}).forEach((name) => {
      const label = String(name || '').trim();
      if (!label || label.length > 40) throw new Error('Некорректное название варианта звонков');
      const raw = (input[name] || []).slice(0, 12).map((x) => String(x || '').trim());
      const empty = raw.every((x) => !x);
      if (label === BELL_BASE && empty) throw new Error('Основное расписание звонков не может быть пустым');
      const times = raw.map(parseBellRange_);
      if (!empty) {
        const bad = raw.map((x, i) => (x && !times[i] ? (i + 1) + ' урок: «' + x + '» — нужно в виде 08:00–08:40' : '')).filter(Boolean).concat(bellProblems_(times));
        if (bad.length) throw new Error(label + ': ' + bad.slice(0, 3).join('; '));
      }
      let col = head.indexOf(label);
      if (col < 1) { col = head.length; head.push(label); sh.getRange(1, col + 1).setValue(label); }
      const values = [];
      for (let l = 1; l <= 12; l++) values.push([empty ? '' : times[l - 1].join('–')]);
      sh.getRange(2, 1, 12, 1).setValues(BELL_DEFAULT.map((_, i) => [i + 1]));
      sh.getRange(2, col + 1, 12, 1).setValues(values);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return getBells(token);
}

// Which bells a school day uses. The usual variant removes the row.
function setDayBells(token, dateIso, variant, comment) {
  assertSession_(token);
  validateIsoDate_(dateIso);
  const b = readBells_(), name = String(variant || BELL_BASE).trim();
  if (!b.variants[name]) throw new Error('Нет такого варианта звонков: ' + name);
  if (!b.ready[name]) throw new Error('Сначала заполните время для варианта «' + name + '»: Ещё → Расписание звонков');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSpreadsheet_().getSheetByName(BELL_SHEETS.dates), values = sh.getDataRange().getValues();
    const keep = values.slice(1).filter((r) => r.some((x) => String(x || '').trim()) && normalizeDate_(r[0]) !== dateIso).map((r) => [r[0], r[1] || '', r[2] || '']);
    if (name !== BELL_BASE) keep.push([formatRuDate_(dateIso), name, String(comment || '').trim()]);
    keep.sort((x, y) => normalizeDate_(x[0]).localeCompare(normalizeDate_(y[0])));
    rewriteBody_(sh, 3, keep);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return bellsForDate_(dateIso);
}
