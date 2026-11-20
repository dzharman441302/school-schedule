// «Сегодня в школе» и «Задача дня» для слайда «Сегодня» на ТВ.
//
// События дня: администратор готовит в панели (окно «Сегодня на ТВ») до 5 событий на любую дату:
// Время | Что | Где | только для учителей. «Сохранить черновик» — в закрытую таблицу (на сайт не
// попадает); «Опубликовать» — строки дня в публичный лист «События_сайт»
// (Дата | Время | Что | Где | Для | Опубликовано); «Снять с публикации» — строки дня удаляются.
//
// Задача дня: администратор задаёт в панели задачу, пояснение, параллели и ответ. Задача
// попадает в публичный лист «Задача_дня» (Дата | Задача | Пояснение | Параллели), ответ — только в
// закрытую таблицу. task.html (сюда ведёт QR с экрана) присылает doPost {action:'dailyTask', cls,
// answer, device}; в закрытый лист пишется «дата, время, класс, верно/неверно» без ФИО. На следующий
// день в публичный лист «Задача_дня_итоги» выходит: сколько верных, какой класс решил первым, ответ.
//
// Закрытая таблица — PRIVATE_SPREADSHEET_ID («СОШ20 — служебная, закрытая»); скрипт создаёт её сам.

const DAY = Object.freeze({
  eventsPublic: 'События_сайт',
  eventsHead: ['Дата', 'Время', 'Что', 'Где', 'Для', 'Опубликовано'],
  eventsDrafts: 'События_черновики',
  taskPublic: 'Задача_дня',
  taskHead: ['Дата', 'Задача', 'Пояснение', 'Параллели'],
  taskResults: 'Задача_дня_итоги',
  resultsHead: ['Дата', 'Верных', 'Всего ответов', 'Первым решил', 'Ответ'],
  taskKeys: 'Задача_дня_ключи',
  taskAnswers: 'Задача_дня_ответы',
  maxEvents: 5,
  maxText: 120,
  maxTask: 600,
  maxAnswer: 100,
  perMinute: 120,
});

/* Погода для экранов -------------------------------------------------------------- */

// Экраны берут прогноз у Open-Meteo сами; если браузер устройства туда не достаёт, они просят его
// у скрипта: {action:'weather'}. Ответ хранится 30 минут, так что Open-Meteo видит один запрос
// на всю школу. Координаты — Тверь.
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=56.86&longitude=35.9&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&hourly=temperature_2m,weather_code,precipitation_probability&timezone=Europe%2FMoscow&forecast_days=1&wind_speed_unit=ms';
function handleWeather_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('weather:v1');
  if (cached) return { ok: true, weather: JSON.parse(cached), cached: true };
  try {
    const r = UrlFetchApp.fetch(WEATHER_URL, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return { ok: false, error: 'open-meteo ' + r.getResponseCode() };
    const text = r.getContentText();
    const json = JSON.parse(text);
    if (!json || !json.current) return { ok: false, error: 'пустой прогноз' };
    cache.put('weather:v1', text, 1800);
    return { ok: true, weather: json };
  } catch (err) {
    return { ok: false, error: 'нет связи с сервисом погоды' };
  }
}

function dayPrivateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PRIVATE_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('СОШ20 — служебная (закрытая, не открывать доступ)');
  props.setProperty('PRIVATE_SPREADSHEET_ID', ss.getId());
  return ss;
}
function daySheet_(ss, name, head) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]); sh.setFrozenRows(1); }
  return sh;
}
const dayStamp_ = () => Utilities.formatDate(new Date(), CONFIG.timeZone, 'dd.MM.yyyy HH:mm');

/* События дня ------------------------------------------------------------------ */

// Чистит и проверяет события одного дня: время ЧЧ:ММ (можно пусто — на весь день), «что»
// обязательно, не больше пяти. Возвращает события, отсортированные по времени.
function dayCleanEvents_(events) {
  const list = (Array.isArray(events) ? events : []).map((e) => ({
    time: String(e && e.time || '').trim().replace('.', ':'),
    what: String(e && e.what || '').replace(/\s+/g, ' ').trim(),
    where: String(e && e.where || '').replace(/\s+/g, ' ').trim(),
    teachers: Boolean(e && e.teachers),
  })).filter((e) => e.what || e.where || e.time);
  if (list.length > DAY.maxEvents) throw new Error('Не больше ' + DAY.maxEvents + ' событий на день');
  list.forEach((e, i) => {
    if (!e.what) throw new Error('Событие ' + (i + 1) + ': заполните «Что»');
    if (e.time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(e.time)) throw new Error('Событие ' + (i + 1) + ': время в виде 13:30');
    if (e.time.length === 4) e.time = '0' + e.time;
    if (e.what.length > DAY.maxText || e.where.length > DAY.maxText) throw new Error('Событие ' + (i + 1) + ': слишком длинный текст');
  });
  return list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

function dayPublicRows_(dateIso) {
  const sh = daySheet_(getSpreadsheet_(), DAY.eventsPublic, DAY.eventsHead);
  return perfRows_(sh.getDataRange().getDisplayValues()).slice(1).map((r, i) => ({ row: i + 2, date: normalizeDate_(r[0]), time: String(r[1]).replace(/^'/, ''), what: r[2], where: r[3], teachers: /учител/i.test(r[4]), at: r[5] })).filter((r) => r.date === dateIso);
}

function getDayEvents(token, dateIso) {
  assertSession_(token); validateIsoDate_(dateIso);
  const drafts = daySheet_(dayPrivateSpreadsheet_(), DAY.eventsDrafts, ['Дата', 'События JSON', 'Обновлено']);
  const row = perfRows_(drafts.getDataRange().getValues()).slice(1).find((r) => normalizeDate_(r[0]) === dateIso);
  const published = dayPublicRows_(dateIso);
  return {
    date: dateIso,
    draft: row ? safeJsonParse_(row[1], []) : published.map((p) => ({ time: p.time, what: p.what, where: p.where, teachers: p.teachers })),
    draftAt: row ? String(row[2] || '') : '',
    published: published.map((p) => ({ time: p.time, what: p.what, where: p.where, teachers: p.teachers })),
    publishedAt: published.length ? published[0].at : '',
    upcoming: dayUpcomingDates_(),
  };
}

// Даты от сегодня вперёд, у которых есть черновик или опубликованные события (для списка в панели).
function dayUpcomingDates_() {
  const today = isoToday_(), out = {};
  perfRows_(daySheet_(dayPrivateSpreadsheet_(), DAY.eventsDrafts, ['Дата', 'События JSON', 'Обновлено']).getDataRange().getValues()).slice(1).forEach((r) => {
    const d = normalizeDate_(r[0]); if (d && d >= today && safeJsonParse_(r[1], []).length) (out[d] = out[d] || {}).draft = true;
  });
  perfRows_(daySheet_(getSpreadsheet_(), DAY.eventsPublic, DAY.eventsHead).getDataRange().getDisplayValues()).slice(1).forEach((r) => {
    const d = normalizeDate_(r[0]); if (d && d >= today) (out[d] = out[d] || {}).published = true;
  });
  return Object.keys(out).sort().slice(0, 30).map((d) => ({ date: d, draft: Boolean(out[d].draft), published: Boolean(out[d].published) }));
}

function saveDayEventsDraft(token, dateIso, events) {
  assertSession_(token); validateIsoDate_(dateIso);
  const list = dayCleanEvents_(events);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = daySheet_(dayPrivateSpreadsheet_(), DAY.eventsDrafts, ['Дата', 'События JSON', 'Обновлено']);
    const values = perfRows_(sh.getDataRange().getValues()), at = dayStamp_();
    const i = values.findIndex((r, k) => k > 0 && normalizeDate_(r[0]) === dateIso);
    const row = [formatRuDate_(dateIso), JSON.stringify(list), at];
    if (i > 0) sh.getRange(i + 1, 1, 1, 3).setValues([row]); else sh.appendRow(row);
    return { ok: true, events: list, draftAt: at };
  } finally { lock.releaseLock(); }
}

// Публикация: черновик сохраняется, строки дня в «События_сайт» заменяются новыми.
function publishDayEvents(token, dateIso, events) {
  assertSession_(token); validateIsoDate_(dateIso);
  const list = dayCleanEvents_(events);
  if (!list.length) throw new Error('Добавьте хотя бы одно событие или снимите день с публикации');
  saveDayEventsDraft(token, dateIso, list);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    dayRemovePublic_(dateIso);
    const sh = daySheet_(getSpreadsheet_(), DAY.eventsPublic, DAY.eventsHead), at = dayStamp_();
    const rows = list.map((e) => [formatRuDate_(dateIso), e.time ? "'" + e.time : '', e.what, e.where, e.teachers ? 'Учителям' : 'Всем', at]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, DAY.eventsHead.length).setValues(rows);
    return { ok: true, published: list, publishedAt: at };
  } finally { lock.releaseLock(); }
}

function unpublishDayEvents(token, dateIso) {
  assertSession_(token); validateIsoDate_(dateIso);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try { return { ok: true, removed: dayRemovePublic_(dateIso) }; } finally { lock.releaseLock(); }
}

function dayRemovePublic_(dateIso) {
  const sh = daySheet_(getSpreadsheet_(), DAY.eventsPublic, DAY.eventsHead);
  const rows = dayPublicRows_(dateIso).map((r) => r.row).sort((a, b) => b - a);
  rows.forEach((r) => sh.deleteRow(r));
  return rows.length;
}

/* Задача дня ------------------------------------------------------------------- */

// «Ответ» для сравнения: без регистра, пробелов и ё; запятая в числах = точка.
function dayNormAnswer_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '').replace(/(\d),(\d)/g, '$1.$2').replace(/[«»"'.]+$/g, '');
}
// В ключе можно перечислить несколько верных вариантов через «;»: «12; двенадцать».
function dayAnswerOk_(answer, key) {
  const a = dayNormAnswer_(answer);
  return Boolean(a) && String(key || '').split(';').map(dayNormAnswer_).filter(Boolean).includes(a);
}
const dayGrade_ = (cls) => (String(cls || '').match(/^(\d{1,2})/) || [])[1] || '';
function dayParallels_(text) { return String(text || '').split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean); }

function dayTaskRow_(dateIso) {
  const sh = daySheet_(getSpreadsheet_(), DAY.taskPublic, DAY.taskHead);
  const values = perfRows_(sh.getDataRange().getDisplayValues());
  const i = values.findIndex((r, k) => k > 0 && normalizeDate_(r[0]) === dateIso);
  return { sh, index: i, task: i > 0 ? { task: values[i][1], explain: values[i][2], parallels: values[i][3] } : null };
}
function dayKeyRow_(dateIso) {
  const sh = daySheet_(dayPrivateSpreadsheet_(), DAY.taskKeys, ['Дата', 'Ответ', 'Обновлено']);
  const values = perfRows_(sh.getDataRange().getDisplayValues());
  const i = values.findIndex((r, k) => k > 0 && normalizeDate_(r[0]) === dateIso);
  return { sh, index: i, answer: i > 0 ? values[i][1] : '' };
}

function getDailyTask(token, dateIso) {
  assertSession_(token); validateIsoDate_(dateIso);
  dayPublishResults_();
  const t = dayTaskRow_(dateIso), k = dayKeyRow_(dateIso);
  const answers = perfRows_(daySheet_(dayPrivateSpreadsheet_(), DAY.taskAnswers, ['Дата', 'Время', 'Класс', 'Верно', 'Устройство']).getDataRange().getValues()).slice(1).filter((r) => normalizeDate_(r[0]) === dateIso);
  return { date: dateIso, task: t.task ? t.task.task : '', explain: t.task ? t.task.explain : '', parallels: t.task ? t.task.parallels : '', answer: k.answer, answers: answers.length, correct: answers.filter((r) => String(r[3]) === 'да').length };
}

function saveDailyTask(token, dateIso, item) {
  assertSession_(token); validateIsoDate_(dateIso);
  const task = String(item && item.task || '').trim(), explain = String(item && item.explain || '').trim(), answer = String(item && item.answer || '').trim();
  const parallels = dayParallels_(item && item.parallels).join(', ');
  if (!task) throw new Error('Напишите задачу');
  if (task.length > DAY.maxTask || explain.length > DAY.maxTask) throw new Error('Слишком длинный текст задачи');
  if (!answer) throw new Error('Укажите правильный ответ (он не публикуется до следующего дня)');
  if (answer.length > DAY.maxAnswer) throw new Error('Слишком длинный ответ');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const t = dayTaskRow_(dateIso), row = [formatRuDate_(dateIso), task, explain, parallels];
    if (t.index > 0) t.sh.getRange(t.index + 1, 1, 1, 4).setValues([row]); else t.sh.appendRow(row);
    const k = dayKeyRow_(dateIso), keyRow = [formatRuDate_(dateIso), answer, dayStamp_()];
    if (k.index > 0) k.sh.getRange(k.index + 1, 1, 1, 3).setValues([keyRow]); else k.sh.appendRow(keyRow);
  } finally { lock.releaseLock(); }
  dayEnsureTrigger_();
  return { ok: true };
}

function deleteDailyTask(token, dateIso) {
  assertSession_(token); validateIsoDate_(dateIso);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const t = dayTaskRow_(dateIso); if (t.index > 0) t.sh.deleteRow(t.index + 1);
    const k = dayKeyRow_(dateIso); if (k.index > 0) k.sh.deleteRow(k.index + 1);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

// Ответ ученика с task.html. Без ФИО: дата, время, класс, верно/неверно, хэш устройства.
// Один ответ с устройства в день; не больше DAY.perMinute ответов в минуту на всю школу.
function handleDailyTaskPost_(body) {
  try {
    const today = isoToday_();
    const cls = normalizeClass_(body.cls), device = String(body.device || '');
    if (!/^[\w-]{8,64}$/.test(device)) return { ok: false, error: 'Обнови страницу и попробуй ещё раз' };
    const t = dayTaskRow_(today);
    if (!t.task) return { ok: false, error: 'Сегодня задачи нет' };
    if (!lateClasses_().includes(cls)) return { ok: false, error: 'Выбери свой класс' };
    const parallels = dayParallels_(t.task.parallels);
    if (parallels.length && !parallels.includes(dayGrade_(cls))) return { ok: false, error: 'Эта задача для ' + parallels.join(', ') + ' классов' };
    const answer = String(body.answer || '').trim();
    if (!answer) return { ok: false, error: 'Напиши ответ' };
    if (answer.length > DAY.maxAnswer) return { ok: false, error: 'Слишком длинный ответ' };
    const cache = CacheService.getScriptCache(), minute = 'task:min:' + Utilities.formatDate(new Date(), CONFIG.timeZone, 'HHmm');
    const n = Number(cache.get(minute) || 0);
    if (n >= DAY.perMinute) return { ok: false, error: 'Много ответов сразу — попробуй через минуту' };
    cache.put(minute, String(n + 1), 120);
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, today + '|' + device, Utilities.Charset.UTF_8).slice(0, 8).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
    const lock = LockService.getScriptLock(); lock.waitLock(15000);
    try {
      const sh = daySheet_(dayPrivateSpreadsheet_(), DAY.taskAnswers, ['Дата', 'Время', 'Класс', 'Верно', 'Устройство']);
      const done = perfRows_(sh.getDataRange().getValues()).slice(1).find((r) => normalizeDate_(r[0]) === today && String(r[4]) === hash);
      if (done) return { ok: true, already: true, correct: String(done[3]) === 'да' };
      const correct = dayAnswerOk_(answer, dayKeyRow_(today).answer);
      sh.appendRow([formatRuDate_(today), "'" + Utilities.formatDate(new Date(), CONFIG.timeZone, 'HH:mm:ss'), cls, correct ? 'да' : 'нет', hash]);
      return { ok: true, correct };
    } finally { lock.releaseLock(); }
  } catch (err) {
    return { ok: false, error: 'Не получилось проверить, попробуй ещё раз' };
  }
}

// Итоги прошедших дней в «Задача_дня_итоги»: верных, всего, класс с первым верным ответом, ответ.
// Вызывается ночным триггером, а также при открытии окна в панели — на случай, если триггера нет.
function dayPublishResults_() {
  const today = isoToday_(), ss = getSpreadsheet_();
  const results = daySheet_(ss, DAY.taskResults, DAY.resultsHead);
  const done = new Set(perfRows_(results.getDataRange().getDisplayValues()).slice(1).map((r) => normalizeDate_(r[0])));
  const tasks = perfRows_(daySheet_(ss, DAY.taskPublic, DAY.taskHead).getDataRange().getDisplayValues()).slice(1).map((r) => normalizeDate_(r[0])).filter((d) => d && d < today && !done.has(d));
  if (!tasks.length) return 0;
  const priv = dayPrivateSpreadsheet_();
  const keys = perfRows_(daySheet_(priv, DAY.taskKeys, ['Дата', 'Ответ', 'Обновлено']).getDataRange().getDisplayValues()).slice(1);
  const answers = perfRows_(daySheet_(priv, DAY.taskAnswers, ['Дата', 'Время', 'Класс', 'Верно', 'Устройство']).getDataRange().getDisplayValues()).slice(1);
  const rows = tasks.sort().map((d) => {
    const list = answers.filter((r) => normalizeDate_(r[0]) === d);
    const right = list.filter((r) => r[3] === 'да').sort((a, b) => String(a[1]).replace(/^'/, '').padStart(8, '0').localeCompare(String(b[1]).replace(/^'/, '').padStart(8, '0')));
    const key = (keys.find((r) => normalizeDate_(r[0]) === d) || [])[1] || '';
    return [formatRuDate_(d), right.length, list.length, right.length ? right[0][2] : '', String(key).split(';')[0].trim()];
  });
  results.getRange(results.getLastRow() + 1, 1, rows.length, DAY.resultsHead.length).setValues(rows);
  return rows.length;
}
function publishDailyTaskResults() { dayPublishResults_(); }

// Ночной триггер в 00:xx: итоги вчерашней задачи. Создаётся один раз при сохранении задачи.
function dayEnsureTrigger_() {
  try {
    if (ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'publishDailyTaskResults')) return;
    ScriptApp.newTrigger('publishDailyTaskResults').timeBased().everyDays(1).atHour(0).create();
  } catch (_) { /* без триггера итоги выйдут при следующем открытии панели */ }
}
