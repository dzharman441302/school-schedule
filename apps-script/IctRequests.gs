// «Заявки по ИКТ»: a teacher sends a request from help.html (technology that does not work, or a
// question about software); the ИКТ deputy works with all requests on ikt.html.
//
// Where the data lives. The working spreadsheet (SPREADSHEET_ID) is the one the site reads with a
// public API key, so requests are NOT kept there: they go to a separate private spreadsheet
// (property ICT_SPREADSHEET_ID; created by the script on the first request when missing, visible
// only to the script owner). Photos go to a private Drive folder (ICT_PHOTOS_FOLDER_ID, also
// created when missing). The public sheet «Помещения» (other rooms for the form and the QR
// stickers) stays in the working spreadsheet: it holds only room names.
//
// Every call is doPost with a JSON body sent as text/plain (no CORS preflight):
//   {action:'ictRequest', pin, teacher, type, room, device, text, urgency, photo:{data,type}}
//   {action:'iktLogin', pin} → {token}; then {action:'iktList'|'iktUpdate'|'iktStats'|
//   'iktSetStaffPin'|'iktPhoto'|'iktLogout', token, ...}
// PINs: STAFF_PIN (4–8 digits, shared by teachers, set by the deputy on ikt.html) and IKT_PIN
// (6–8 digits, the deputy's own, set by hand in the script properties).
//
// The MAX bot (max-worker) calls {action:'ictBot…', secret} with ICT_SECRET (the same value is
// the Cloudflare secret ICT_SECRET): ictBotFeed (requests + holidays), ictBotMark (the engineer's
// buttons), ictBotLink (a teacher binds MAX by the code from the form), ictBotNotified,
// ictBotPhoto. The script itself never writes to MAX: after a new request or a change by the
// deputy it only pings the bot (POST BOT_URL/ict-ping), and the bot fetches the feed.

const ICT = Object.freeze({
  sheet: 'Заявки_ИКТ',
  roomsSheet: 'Помещения',
  headers: ['ID', 'Создана', 'Тип', 'Учитель', 'Кабинет', 'Устройство/Тема', 'Описание', 'Срочность', 'Фото', 'Исполнитель', 'Статус', 'Комментарий исполнителя', 'Перенесено_на', 'Обновлена', 'Закрыта', 'Учитель_уведомлён', 'История', 'Код_MAX'],
  types: ['tech', 'question'],
  urgencies: ['red', 'yellow', 'white'],
  executors: ['engineer', 'ikt'],
  statuses: ['new', 'in_work', 'done', 'not_done', 'cannot_fix', 'postponed', 'transferred', 'answered'],
  closedStatuses: ['done', 'answered'],
  engineerResults: ['done', 'not_done', 'cannot_fix', 'postponed'],
  feedDays: 21,
  devices: ['Компьютер учителя', 'Компьютер ученика', 'Принтер / МФУ', 'Проектор', 'Интерактивная панель / доска', 'Документ-камера', 'Сеть / интернет', 'Другое'],
  topics: ['Электронный журнал', 'Отчёты', 'Excel / Word', 'Сферум', 'Почта', 'Сайт', 'Другое'],
  maxText: 1000,
  maxPhotoBytes: 5 * 1024 * 1024,
  photoTypes: ['image/jpeg', 'image/png', 'image/webp'],
  perTeacherHour: 10,
  maxFails: 20,
  failWindowSeconds: 900,
  sessionHours: 12,
  listLimit: 300,
  historyLimit: 60,
});
const ICT_COL = Object.freeze(ICT.headers.reduce((o, h, i) => { o[h] = i; return o; }, {}));

function ictJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// One entry point for doPost. Errors come back as {ok:false,error} with a readable text.
function handleIctPost_(body) {
  try {
    const action = String(body.action || '');
    if (action === 'ictRequest') return handleIctRequest_(body);
    if (action === 'iktLogin') return iktLogin_(body.pin);
    if (action.indexOf('ictBot') === 0) {
      if (!ictBotSecretOk_(body.secret)) return { ok: false, error: 'forbidden' };
      if (action === 'ictBotFeed') return ictBotFeed_();
      if (action === 'ictBotMark') return ictBotMark_(body);
      if (action === 'ictBotLink') return ictBotLink_(body.code);
      if (action === 'ictBotNotified') return ictBotNotified_(body.ids, body.value);
      if (action === 'ictBotPhoto') return iktPhoto_(body.id);
      return { ok: false, error: 'Неизвестное действие' };
    }
    if (action === 'iktLogout') { if (body.token) CacheService.getScriptCache().remove('ikt:' + String(body.token)); return { ok: true }; }
    const session = iktSessionError_(body.token);
    if (session) return { ok: false, error: session, auth: true };
    if (action === 'iktList') return iktList_(body.filter || {});
    if (action === 'iktStats') return { ok: true, stats: ictStats_(ictReadAll_(), new Date()) };
    if (action === 'iktUpdate') return iktUpdate_(body);
    if (action === 'iktSetStaffPin') return iktSetStaffPin_(body.pin);
    if (action === 'iktPhoto') return iktPhoto_(body.id);
    return { ok: false, error: 'Неизвестное действие' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

/* Storage ------------------------------------------------------------- */

function ictSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ICT_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('СОШ20 — Заявки ИКТ (служебная, не открывать доступ)');
  props.setProperty('ICT_SPREADSHEET_ID', ss.getId());
  return ss;
}

function ensureIctSheet_() {
  const ss = ictSpreadsheet_();
  let sheet = ss.getSheetByName(ICT.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(ICT.sheet);
    sheet.getRange(1, 1, 1, ICT.headers.length).setValues([ICT.headers]);
    sheet.setFrozenRows(1);
  } else if (sheet.getRange(1, ICT.headers.length).getValue() !== ICT.headers[ICT.headers.length - 1]) {
    sheet.getRange(1, 1, 1, ICT.headers.length).setValues([ICT.headers]);
  }
  return sheet;
}

function ictPhotoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ICT_PHOTOS_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (_) {} }
  const folder = DriveApp.createFolder('СОШ20 — фото заявок ИКТ');
  props.setProperty('ICT_PHOTOS_FOLDER_ID', folder.getId());
  return folder;
}

// IDs are kept as text («0142»); Sheets may still hand back the number 142.
function ictId_(value) {
  const s = String(value == null ? '' : value).replace(/^'/, '').trim();
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
}
const ictIso_ = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString() : String(v || ''));

function ictRow_(r) {
  const c = ICT_COL;
  return {
    id: ictId_(r[c['ID']]), created: ictIso_(r[c['Создана']]), type: String(r[c['Тип']] || ''), teacher: String(r[c['Учитель']] || ''),
    room: String(r[c['Кабинет']] || ''), device: String(r[c['Устройство/Тема']] || ''), text: String(r[c['Описание']] || ''),
    urgency: String(r[c['Срочность']] || 'white'), photo: String(r[c['Фото']] || ''), executor: String(r[c['Исполнитель']] || ''),
    status: String(r[c['Статус']] || 'new'), comment: String(r[c['Комментарий исполнителя']] || ''), postponedTo: normalizeDate_(r[c['Перенесено_на']]),
    updated: ictIso_(r[c['Обновлена']]), closed: ictIso_(r[c['Закрыта']]), notified: String(r[c['Учитель_уведомлён']] || ''),
    history: safeJsonParse_(r[c['История']], []), code: String(r[c['Код_MAX']] || ''),
  };
}

function ictReadAll_(sheet) {
  const values = perfRows_((sheet || ensureIctSheet_()).getDataRange().getValues());
  return values.slice(1).filter((r) => r[0] !== '' && r[0] != null).map(ictRow_);
}

/* Rooms ------------------------------------------------------------------ */

// Room key for comparing: «Каб. 211», «211 », «зал» and «Зал» are the same room.
function ictRoomKey_(v) { return String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/^каб(инет)?\.?\s*/, '').replace(/\s+/g, ''); }
function ictRoomLabel_(v) { const s = String(v || '').trim().replace(/\s+/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// Rooms of the timetable («Учителя» cells «класс|предмет|кабинет», «Расписание» «Предмет (каб)»,
// «304/407» = two rooms) and of the sheet «Помещения» (first column).
function ictRooms_() {
  const out = new Map();
  const add = (v) => String(v || '').split('/').forEach((x) => {
    const label = ictRoomLabel_(x), key = ictRoomKey_(label);
    if (key && !/^[-—–]+$/.test(key) && !out.has(key)) out.set(key, label);
  });
  getTeacherTable_().rows.forEach((row) => row.slice(2).forEach((cell) => { const p = String(cell || '').split(/\r?\n|\s*\|\s*/); if (p.length >= 3) add(p[2]); }));
  getScheduleTable_().rows.forEach((row) => row.slice(2).forEach((cell) => { const m = String(cell || '').match(/\(([^)]*)\)\s*$/); if (m) add(m[1]); }));
  const extra = getSpreadsheet_().getSheetByName(ICT.roomsSheet);
  if (extra) perfRows_(extra.getDataRange().getDisplayValues()).slice(1).forEach((r) => add(String(r[0] || '').replace(/\//g, ' ')));
  return out;
}

/* Teacher's request ------------------------------------------------------ */

function ictSafeEqual_(a, b) {
  const x = String(a == null ? '' : a), y = String(b == null ? '' : b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// Wrong PINs: after ICT.maxFails in 15 minutes nobody can try again until the window passes.
function ictPinError_(pin, property, failKey, missing) {
  const expected = PropertiesService.getScriptProperties().getProperty(property);
  if (!expected) return missing;
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= ICT.maxFails) return 'Слишком много неверных попыток. Подождите 15 минут.';
  if (!ictSafeEqual_(String(pin || '').trim(), expected)) {
    cache.put(failKey, String(fails + 1), ICT.failWindowSeconds);
    if (typeof Utilities.sleep === 'function') Utilities.sleep(800);
    return 'Неверный PIN';
  }
  return '';
}

// Checks of a request that need no spreadsheet writes. Returns {error} or the clean request.
function ictValidate_(body, teachers, rooms) {
  const type = String(body.type || '');
  if (!ICT.types.includes(type)) return { error: 'Выберите: техника или вопрос' };
  const teacher = String(body.teacher || '').trim();
  if (!teachers.includes(teacher)) return { error: 'Выберите свою фамилию из списка' };
  const roomKey = ictRoomKey_(body.room);
  if (type === 'tech' && !roomKey) return { error: 'Укажите кабинет' };
  if (roomKey && !rooms.has(roomKey)) return { error: 'Такого кабинета нет в списке' };
  const device = String(body.device || '').trim();
  if (!(type === 'tech' ? ICT.devices : ICT.topics).includes(device)) return { error: type === 'tech' ? 'Выберите устройство' : 'Выберите тему' };
  const text = String(body.text || '').trim();
  if (text.length < 3) return { error: 'Опишите, что случилось' };
  if (text.length > ICT.maxText) return { error: 'Описание длиннее ' + ICT.maxText + ' символов' };
  const urgency = String(body.urgency || '');
  if (!ICT.urgencies.includes(urgency)) return { error: 'Выберите срочность' };
  let photo = null;
  if (body.photo && body.photo.data) {
    const mime = String(body.photo.type || '');
    if (!ICT.photoTypes.includes(mime)) return { error: 'Фото должно быть картинкой JPEG или PNG' };
    const data = String(body.photo.data).replace(/^data:[^,]*,/, '');
    if (data.length > Math.ceil(ICT.maxPhotoBytes * 4 / 3) + 4) return { error: 'Фото больше 5 МБ' };
    photo = { data, type: mime };
  }
  return { type, teacher, room: roomKey ? rooms.get(roomKey) : '', device, text, urgency, photo, executor: type === 'tech' ? 'engineer' : 'ikt' };
}

function ictRecentCount_(items, teacher, now) {
  const hour = now.getTime() - 3600000;
  return items.filter((x) => x.teacher === teacher && Date.parse(x.created) > hour).length;
}

function ictNextId_(items) {
  return String(items.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1).padStart(4, '0');
}

function handleIctRequest_(body) {
  const pinError = ictPinError_(body.pin, 'STAFF_PIN', 'ict:fails', 'PIN сотрудников ещё не задан. Его задаёт зам по ИКТ.');
  if (pinError) return { ok: false, error: pinError, pin: true };
  const clean = ictValidate_(body, getTeacherTable_().teachers, ictRooms_());
  if (clean.error) return { ok: false, error: clean.error };
  const lock = LockService.getScriptLock();
  let result;
  lock.waitLock(20000);
  try {
    const sheet = ensureIctSheet_(), items = ictReadAll_(sheet), now = new Date();
    if (ictRecentCount_(items, clean.teacher, now) >= ICT.perTeacherHour) return { ok: false, error: 'Слишком много заявок за час. Если срочно — позвоните заму по ИКТ.' };
    const id = ictNextId_(items);
    let photoUrl = '';
    if (clean.photo) {
      const bytes = Utilities.base64Decode(clean.photo.data);
      if (bytes.length > ICT.maxPhotoBytes) return { ok: false, error: 'Фото больше 5 МБ' };
      const ext = clean.photo.type === 'image/png' ? 'png' : clean.photo.type === 'image/webp' ? 'webp' : 'jpg';
      const file = ictPhotoFolder_().createFile(Utilities.newBlob(bytes, clean.photo.type, id + '.' + ext));
      photoUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    }
    const history = [{ at: now.toISOString(), by: 'учитель', what: 'заявка создана' }];
    const row = ICT.headers.map(() => '');
    const set = (h, v) => { row[ICT_COL[h]] = v; };
    set('ID', "'" + id); set('Создана', now); set('Тип', clean.type); set('Учитель', clean.teacher); set('Кабинет', clean.room);
    set('Устройство/Тема', clean.device); set('Описание', clean.text); set('Срочность', clean.urgency); set('Фото', photoUrl);
    set('Исполнитель', clean.executor); set('Статус', 'new'); set('Обновлена', now); set('История', JSON.stringify(history));
    const code = ictTeacherCode_(items, clean.teacher);
    set('Код_MAX', code);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    result = { ok: true, id, type: clean.type, executor: clean.executor, urgency: clean.urgency, code };
  } finally {
    lock.releaseLock();
  }
  ictPingBot_();
  return result;
}

// The code a teacher sends to the bot to get answers in MAX. One code per teacher: the
// same as on their earlier requests, so a bound MAX profile stays valid.
function ictTeacherCode_(items, teacher) {
  const old = items.find((x) => x.teacher === teacher && /^[A-Z2-9]{6}$/.test(x.code));
  if (old) return old.code;
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const taken = new Set(items.map((x) => x.code));
  let code = '';
  do { code = ''; for (let i = 0; i < 6; i += 1) code += abc.charAt(Math.floor(Math.random() * abc.length)); } while (taken.has(code));
  return code;
}

/* The ИКТ deputy's login -------------------------------------------------- */

function iktLogin_(pin) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('IKT_PIN') || '');
  if (expected && !/^\d{6,8}$/.test(expected)) return { ok: false, error: 'IKT_PIN в свойствах скрипта должен состоять из 6–8 цифр' };
  if (expected && expected === String(PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '')) return { ok: false, error: 'IKT_PIN не должен совпадать с PIN-кодом панели замен' };
  const error = ictPinError_(pin, 'IKT_PIN', 'iktlogin:fails', 'Вход ещё не настроен: задайте свойство скрипта IKT_PIN.');
  if (error) return { ok: false, error, pin: true };
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('ikt:' + token, String(Date.now()), 21600);
  // The open requests come with the login: the page shows them without a second round trip.
  const out = { ok: true, token, hours: ICT.sessionHours };
  try { out.list = iktList_({ status: 'open' }); } catch (_) {}
  return out;
}

// A session lives 12 hours from the login. The cache keeps a value at most 6 hours, so each
// call renews it; the login time inside caps the whole session. The key prefix differs from
// the panel's «session:», so this token never opens the panel and the other way round.
function iktSessionError_(token) {
  const key = 'ikt:' + String(token || ''), cache = CacheService.getScriptCache();
  const started = Number(token ? cache.get(key) : 0);
  if (!started || Date.now() - started > ICT.sessionHours * 3600000) { if (token) cache.remove(key); return 'Сессия истекла. Войдите ещё раз.'; }
  cache.put(key, String(started), 21600);
  return '';
}

/* The deputy's list ------------------------------------------------------- */

const ictOpen_ = (x) => !ICT.closedStatuses.includes(x.status);


// Filters of ikt.html. status: 'open' | 'closed' | one of ICT.statuses; dates are YYYY-MM-DD.
function ictFilter_(items, f) {
  const has = (v) => v != null && v !== '';
  const q = String(f.q || '').toLowerCase().replace(/ё/g, 'е').trim();
  const roomKey = ictRoomKey_(f.room);
  const out = items.filter((x) => {
    if (has(f.type) && x.type !== f.type) return false;
    if (f.status === 'open' && !ictOpen_(x)) return false;
    if (f.status === 'closed' && ictOpen_(x)) return false;
    if (has(f.status) && !['open', 'closed'].includes(f.status) && x.status !== f.status) return false;
    if (has(f.executor) && x.executor !== f.executor) return false;
    if (has(f.urgency) && x.urgency !== f.urgency) return false;
    if (roomKey && ictRoomKey_(x.room) !== roomKey) return false;
    if (has(f.teacher) && !x.teacher.toLowerCase().includes(String(f.teacher).toLowerCase())) return false;
    if (q && !(`${x.teacher} ${x.room} каб.${x.room} ${x.id}`).toLowerCase().replace(/ё/g, 'е').includes(q)) return false;
    const day = x.created.slice(0, 10);
    if (has(f.from) && day < f.from) return false;
    if (has(f.to) && day > f.to) return false;
    return true;
  });
  // Open 🔴 first, then the newest.
  return out.sort((a, b) => (Number(!(ictOpen_(a) && a.urgency === 'red')) - Number(!(ictOpen_(b) && b.urgency === 'red'))) || (b.created > a.created ? 1 : b.created < a.created ? -1 : 0));
}

function ictStats_(items, now) {
  const week = now.getTime() - 7 * 86400000;
  const open = items.filter(ictOpen_);
  return {
    fresh: open.filter((x) => x.status === 'new').length,
    red: open.filter((x) => x.urgency === 'red').length,
    questions: open.filter((x) => x.type === 'question' && x.executor === 'ikt').length,
    techQueue: open.filter((x) => x.type === 'tech' && x.executor === 'engineer').length,
    closedWeek: items.filter((x) => !ictOpen_(x) && x.closed && Date.parse(x.closed) > week).length,
    total: items.length,
  };
}

function iktList_(filter) {
  const all = ictReadAll_();
  const items = ictFilter_(all, filter).slice(0, ICT.listLimit).map((x) => Object.assign({}, x, { photo: undefined, hasPhoto: Boolean(x.photo) }));
  return { ok: true, items, stats: ictStats_(all, new Date()), devices: ICT.devices, topics: ICT.topics, staffPinSet: Boolean(PropertiesService.getScriptProperties().getProperty('STAFF_PIN')) };
}

const ICT_STATUS_RU = Object.freeze({ new: 'новая', in_work: 'в работе', done: 'сделано', not_done: 'не сделано', cannot_fix: 'нет возможности', postponed: 'перенесено', transferred: 'передана', answered: 'дан ответ' });
const ICT_EXECUTOR_RU = Object.freeze({ engineer: 'инженеру', ikt: 'заму по ИКТ' });
const ICT_URGENCY_RU = Object.freeze({ red: '🔴 урок сорвётся', yellow: '🟡 на этой неделе', white: '⚪ не срочно' });

// One change from ikt.html: status, answer/comment, executor, urgency, «перенесено на».
// Each change is written to the request's history.
function ictApplyUpdate_(item, body, now, by) {
  const changes = [];
  const next = Object.assign({}, item);
  if (body.status != null && body.status !== item.status) {
    if (!ICT.statuses.includes(body.status)) throw new Error('Неизвестный статус');
    next.status = body.status;
    changes.push('статус: ' + ICT_STATUS_RU[body.status]);
  }
  if (body.executor != null && body.executor !== item.executor) {
    if (!ICT.executors.includes(body.executor)) throw new Error('Неизвестный исполнитель');
    next.executor = body.executor;
    changes.push('передана ' + ICT_EXECUTOR_RU[body.executor]);
  }
  if (body.urgency != null && body.urgency !== item.urgency) {
    if (!ICT.urgencies.includes(body.urgency)) throw new Error('Неизвестная срочность');
    next.urgency = body.urgency;
    changes.push('срочность: ' + ICT_URGENCY_RU[body.urgency]);
  }
  if (body.comment != null) {
    const comment = String(body.comment).trim();
    if (comment.length > ICT.maxText) throw new Error('Ответ длиннее ' + ICT.maxText + ' символов');
    if (comment !== item.comment) { next.comment = comment; changes.push(comment ? 'ответ: ' + (comment.length > 120 ? comment.slice(0, 119) + '…' : comment) : 'ответ удалён'); }
  }
  if (body.postponedTo != null) {
    const d = normalizeDate_(body.postponedTo);
    if (body.postponedTo && !d) throw new Error('Некорректная дата переноса');
    if (d !== item.postponedTo) { next.postponedTo = d; if (d) changes.push('перенесено на ' + formatRuDate_(d)); }
  }
  if (!changes.length) return null;
  const wasOpen = ictOpen_(item), isOpen = ictOpen_(next);
  if (wasOpen && !isOpen) next.closed = now.toISOString();
  if (!wasOpen && isOpen) next.closed = '';
  next.updated = now.toISOString();
  next.history = (Array.isArray(item.history) ? item.history : []).concat([{ at: now.toISOString(), by: by || 'зам по ИКТ', what: changes.join('; ') }]).slice(-ICT.historyLimit);
  return next;
}

function iktUpdate_(body) {
  const r = ictWriteUpdate_(ictId_(body.id), body, 'зам по ИКТ');
  if (r.ok && r.changed) ictPingBot_();
  // The counters come with the answer: no separate «iktStats» call after each button.
  if (r.ok) { try { r.stats = ictStats_(ictReadAll_(), new Date()); } catch (_) {} }
  return r;
}

function ictWriteUpdate_(id, body, by) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ensureIctSheet_(), values = perfRows_(sheet.getDataRange().getValues());
    const index = values.findIndex((r, i) => i > 0 && ictId_(r[0]) === id);
    if (index < 1) return { ok: false, error: 'Заявка №' + id + ' не найдена' };
    const item = ictRow_(values[index]), now = new Date();
    const next = ictApplyUpdate_(item, body, now, by);
    if (!next) return { ok: true, item: Object.assign({}, item, { photo: undefined, hasPhoto: Boolean(item.photo) }) };
    const row = values[index].slice();
    const set = (h, v) => { row[ICT_COL[h]] = v; };
    set('ID', "'" + id); set('Статус', next.status); set('Исполнитель', next.executor); set('Срочность', next.urgency);
    set('Комментарий исполнителя', next.comment); set('Перенесено_на', next.postponedTo ? formatRuDate_(next.postponedTo) : '');
    set('Обновлена', now); set('Закрыта', next.closed ? new Date(next.closed) : ''); set('История', JSON.stringify(next.history));
    sheet.getRange(index + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, changed: true, item: Object.assign({}, next, { photo: undefined, hasPhoto: Boolean(item.photo) }) };
  } finally {
    lock.releaseLock();
  }
}

function iktPhoto_(rawId) {
  const id = ictId_(rawId);
  const item = ictReadAll_().find((x) => x.id === id);
  const m = item && item.photo.match(/\/d\/([\w-]+)/);
  if (!m) return { ok: false, error: 'Фото нет' };
  const blob = DriveApp.getFileById(m[1]).getBlob();
  return { ok: true, type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// The deputy sets the teachers' PIN. It must differ from the panel, duty and deputy PINs.
function iktSetStaffPin_(pin) {
  const value = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(value)) return { ok: false, error: 'PIN сотрудников — от 4 до 8 цифр' };
  const props = PropertiesService.getScriptProperties();
  const taken = ['ADMIN_PIN', 'LATE_PIN', 'IKT_PIN'].some((k) => value === String(props.getProperty(k) || ''));
  if (taken) return { ok: false, error: 'Этот PIN уже используется для другого входа. Выберите другой.' };
  props.setProperty('STAFF_PIN', value);
  return { ok: true, staffPinSet: true };
}

/* The MAX bot ---------------------------------------------------------------- */

function ictBotSecretOk_(secret) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('ICT_SECRET') || '');
  return expected.length >= 16 && ictSafeEqual_(String(secret || ''), expected);
}

// Tell the bot that something changed; it fetches the feed itself. Never fails the caller.
function ictPingBot_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('ICT_SECRET');
    if (!secret || typeof UrlFetchApp === 'undefined') return;
    const base = String(props.getProperty('BOT_URL') || BOT_URL_DEFAULT).replace(/\/+$/, '');
    UrlFetchApp.fetch(base + '/ict-ping', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ secret }), muteHttpExceptions: true });
  } catch (_) {}
}

// Holidays of the public sheet «Календарь» (Дата начала | Дата окончания | Название), as the site reads them.
function ictHolidays_() {
  const sheet = getSpreadsheet_().getSheetByName('Календарь');
  if (!sheet) return [];
  return perfRows_(sheet.getDataRange().getValues()).slice(1).map((r) => {
    const from = normalizeDate_(r[0]), to = normalizeDate_(r[1]) || from;
    return from ? { from: from < to ? from : to, to: from < to ? to : from, title: String(r[2] || 'Выходной день') } : null;
  }).filter(Boolean);
}

// Everything the bot decides on: open requests and those closed in the last three weeks.
function ictBotFeed_() {
  const since = Date.now() - ICT.feedDays * 86400000;
  const items = ictReadAll_().filter((x) => ictOpen_(x) || Date.parse(x.updated || x.created) > since)
    .map((x) => Object.assign({}, x, { photo: undefined, code: undefined, hasPhoto: Boolean(x.photo) }));
  return { ok: true, now: new Date().toISOString(), items, holidays: ictHolidays_() };
}

// The engineer's buttons: ✅ сделано, ❌ не сделано, 🚫 нет возможности (goes to the deputy),
// ➡️ перенёс на дату. Several ids when one message held duplicates of one room and device.
function ictBotMark_(body) {
  const result = String(body.result || '');
  if (!ICT.engineerResults.includes(result)) return { ok: false, error: 'Неизвестная отметка' };
  const ids = (Array.isArray(body.ids) ? body.ids : [body.ids]).map(ictId_).filter(Boolean).slice(0, 20);
  if (!ids.length) return { ok: false, error: 'Нет заявки' };
  const change = { status: result, comment: String(body.comment || '').trim() || undefined };
  if (result === 'cannot_fix') change.executor = 'ikt';
  if (result === 'postponed') {
    change.postponedTo = normalizeDate_(body.postponedTo);
    if (!change.postponedTo) return { ok: false, error: 'Укажите дату переноса' };
  }
  const items = [];
  ids.forEach((id) => {
    const r = ictWriteUpdate_(id, change, 'инженер');
    if (r.ok) items.push(r.item);
  });
  if (!items.length) return { ok: false, error: 'Заявка не найдена' };
  return { ok: true, items };
}

// A teacher sends the code from the form to the bot: the bot learns whose MAX profile it is.
function ictBotLink_(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(value)) return { ok: false, error: 'Неверный код' };
  const item = ictReadAll_().find((x) => x.code === value);
  return item ? { ok: true, teacher: item.teacher } : { ok: false, error: 'Код не найден' };
}

// «Учитель_уведомлён»: да — the bot delivered the result or the answer; нет — the teacher has no bound MAX.
function ictBotNotified_(ids, value) {
  const list = (Array.isArray(ids) ? ids : []).map(ictId_);
  const mark = value === 'да' ? 'да' : 'нет';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = ensureIctSheet_(), values = perfRows_(sheet.getDataRange().getValues());
    let count = 0;
    values.forEach((r, i) => {
      if (i < 1 || !list.includes(ictId_(r[0]))) return;
      sheet.getRange(i + 1, ICT_COL['Учитель_уведомлён'] + 1).setValue(mark);
      count += 1;
    });
    return { ok: true, count };
  } finally {
    lock.releaseLock();
  }
}
