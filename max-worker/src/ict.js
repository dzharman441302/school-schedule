// «Заявки по ИКТ» in the MAX bot (stage 2).
//
// Who gets what:
//  • the engineer (role engineer, /role <ENGINEER_CODE>) — only computer equipment, works on
//    Saturdays and only in MAX: on Friday 17:00 (or the last school day of the week) «Заявки на
//    субботу», grouped by floor and room, duplicates of one room and device in one message; new
//    ones that come after the list and until the end of Saturday; buttons ✅ ❌ 🚫 ➡️ under each,
//    a short comment after ❌ 🚫 ➡️; /requests — the open queue; Saturday 18:00 — what is left.
//  • the ИКТ deputy (role ikt, /role <IKT_CODE>) — a notification for every request:
//    «🔴 · Техника · от … · каб. 211 · Проектор · текст»; 🔴 at once 07:00–20:00, the rest at once
//    in working time (school days 08:00–17:00), otherwise next school morning; /ikt_mode digest —
//    the non-urgent ones together at 10:00 and 14:00. Reminders: a question without an answer for
//    a school day; on the first school day of the week 08:30 the engineer's results, 09:00 what he
//    left without a mark.
//  • a teacher — the deputy's answers at once; on the first school day of the week at 08:00 one
//    message with what the engineer did with their requests. A teacher is found by binding, not by
//    a schedule subscription (anyone may follow any teacher): the form shows a link
//    max.ru/<bot>?start=ikt-<code> and the code for /link <code>. Without a binding the request
//    gets «Учитель_уведомлён = нет», and the deputy sees it on ikt.html.
//
// Data: the requests live in Apps Script (IctRequests.gs). The bot reads them with
// {action:'ictBotFeed', secret: ICT_SECRET}; the script pings POST /ict-ping after a new request or
// an answer, and the cron polls every 5 minutes in the day (15 at night). Every message has a key in
// bot_state («ict:…»), so nothing is sent twice. One run sends at most the budget it is given.

const MAX_API = 'https://platform-api.max.ru';
const MSK = '+03:00'; // Moscow has no daylight saving time
const DEFAULT_WORKER_URL = 'https://school-schedule.mark441302.workers.dev';
const DEFAULT_SITE = 'https://sosh20tver.ru';
const DAY = 86400000;
// The time used by buttons and commands; tests set it.
export const clock = { now: () => Date.now() };
const LOCK_MS = 120000;
const AWAIT_MS = 30 * 60000;
const KEEP_KEYS_DAYS = 60;

/* Time (Moscow) ------------------------------------------------------------ */

export function msk(ms) {
  const d = new Date(ms + 3 * 3600000);
  return { iso: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}
export const atMsk = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00${MSK}`);
export function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function mondayOf(iso) { const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); return addDays(iso, dow === 0 ? -6 : 1 - dow); }
const isHoliday = (iso, holidays) => (holidays || []).some((h) => iso >= h.from && iso <= (h.to || h.from));
export function isWorkingDay(iso, holidays) { const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); return dow >= 1 && dow <= 5 && !isHoliday(iso, holidays); }
export function nextWorkingDay(iso, holidays) { let d = addDays(iso, 1); for (let i = 0; i < 60 && !isWorkingDay(d, holidays); i += 1) d = addDays(d, 1); return d; }
// Friday 17:00, or the last school day of that week when Friday is a holiday; null for a week off.
export function fridayListAt(monday, holidays) {
  for (let i = 4; i >= 0; i -= 1) { const d = addDays(monday, i); if (isWorkingDay(d, holidays)) return atMsk(d, '17:00'); }
  return null;
}
export function firstWorkingDay(monday, holidays) {
  for (let i = 0; i < 5; i += 1) { const d = addDays(monday, i); if (isWorkingDay(d, holidays)) return d; }
  return null;
}
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const ruDate = (iso) => iso.split('-').reverse().join('.');
const ruShort = (iso) => ruDate(iso).slice(0, 5);

// When the deputy should hear about a request. 🔴: at once between 07:00 and 20:00, any day.
// Others: at once in working time, else the next school day 08:00; digest: the next 10:00 or 14:00.
export function iktDueAt(item, mode, holidays) {
  const created = Date.parse(item.created), t = msk(created);
  if (item.urgency === 'red') {
    if (t.min >= 420 && t.min < 1200) return created;
    return atMsk(t.min < 420 ? t.iso : addDays(t.iso, 1), '07:00');
  }
  if (mode === 'digest') {
    let day = t.iso;
    for (let i = 0; i < 60; i += 1, day = addDays(day, 1)) {
      if (!isWorkingDay(day, holidays)) continue;
      for (const slot of ['10:00', '14:00']) { const at = atMsk(day, slot); if (at >= created) return at; }
    }
    return created;
  }
  if (isWorkingDay(t.iso, holidays) && t.min >= 480 && t.min < 1020) return created;
  const day = isWorkingDay(t.iso, holidays) && t.min < 480 ? t.iso : nextWorkingDay(t.iso, holidays);
  return atMsk(day, '08:00');
}

// A question waits more than one school day: the next school day, at the same time of day
// (kept inside 08:00–16:00).
export function questionRemindAt(item, holidays) {
  const t = msk(Date.parse(item.created));
  return atMsk(nextWorkingDay(t.iso, holidays), hhmm(Math.min(960, Math.max(480, t.min))));
}

/* Requests ----------------------------------------------------------------- */

const CLOSED = ['done', 'answered'];
export const isOpen = (x) => !CLOSED.includes(x.status);
const URGENCY = { red: '🔴', yellow: '🟡', white: '⚪' };
const TYPE = { tech: 'Техника', question: 'Вопрос' };
const RESULT = { d: 'done', n: 'not_done', x: 'cannot_fix', p: 'postponed' };
const RESULT_TEXT = { done: '✅ Сделано', not_done: '❌ Не сделано', cannot_fix: '🚫 Нет возможности', postponed: '➡️ Перенесено' };
export const engineerMarks = (x, from = 0, to = Infinity) => (x.history || []).filter((h) => h.by === 'инженер' && Date.parse(h.at) >= from && Date.parse(h.at) < to);
const isNumberRoom = (r) => /^\d+[а-яa-z]?$/i.test(String(r || ''));
export const floorOf = (room) => (isNumberRoom(room) && String(room).length >= 3 ? String(room)[0] : '');
const roomTitle = (room) => (isNumberRoom(room) ? `Каб. ${room}` : String(room || 'Без кабинета'));
const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);
export function safeText(v) { return String(v ?? '').replace(/([*_`[\]])/g, '\\$1'); }
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// The engineer's queue for the Saturday `sat`: open requests that are his, except those
// postponed to a later day.
export function engineerQueue(items, sat) {
  return items.filter((x) => isOpen(x) && x.executor === 'engineer' && x.status !== 'cannot_fix' && !(x.status === 'postponed' && x.postponedTo && x.postponedTo > sat));
}

// Floors (first digit of the room), rooms inside a floor; one group per room and device.
export function groupQueue(queue) {
  const groups = new Map();
  queue.forEach((x) => {
    const key = `${String(x.room).toLowerCase()}|${x.device}`;
    if (!groups.has(key)) groups.set(key, { floor: floorOf(x.room), room: x.room, device: x.device, items: [] });
    groups.get(key).items.push(x);
  });
  const rank = (g) => [g.floor ? Number(g.floor) : 99, isNumberRoom(g.room) ? parseInt(g.room, 10) : 100000, String(g.room)];
  return [...groups.values()].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2], 'ru') || a.device.localeCompare(b.device, 'ru');
  }).map((g) => ({ ...g, items: g.items.sort((a, b) => a.id.localeCompare(b.id)) }));
}
export const floorTitle = (floor) => (floor ? `Этаж ${floor}` : 'Другие помещения');

export function queueHeader(groups, title) {
  const n = groups.reduce((s, g) => s + g.items.length, 0);
  if (!n) return `**${title}: 0**\nЗаявок нет — хорошей субботы!`;
  const floors = new Map();
  groups.forEach((g) => floors.set(g.floor, (floors.get(g.floor) || 0) + g.items.length));
  return `**${title}: ${n}**\n${[...floors].map(([f, c]) => `${floorTitle(f)}: ${c}`).join(' · ')}\n\nНиже — по одной заявке на кабинет и устройство. Отметьте результат кнопками.`;
}

export function groupText(g, prefix = '') {
  const lines = g.items.map((x) => `${URGENCY[x.urgency] || '⚪'} №${x.id} · ${safeText(x.teacher)} · ${ruShort(x.created.slice(0, 10))}${x.status === 'postponed' && x.postponedTo ? ` · был перенос на ${ruShort(x.postponedTo)}` : ''}\n${safeText(clip(x.text, 600))}${x.comment ? `\n_Комментарий: ${safeText(clip(x.comment, 200))}_` : ''}`);
  return `${prefix}**${floorTitle(g.floor)} · ${safeText(roomTitle(g.room))} · ${safeText(g.device)}**${g.items.length > 1 ? ` · ${g.items.length} заявки` : ''}\n\n${lines.join('\n\n')}`;
}

export function markButtons(ids) {
  const list = ids.join(',');
  return [[cb('✅ Сделано', `ie:d:${list}`), cb('❌ Не сделано', `ie:n:${list}`)], [cb('🚫 Нет возможности', `ie:x:${list}`), cb('➡️ Перенёс', `ie:p:${list}`)]];
}

export function iktLine(x) {
  const place = x.type === 'tech' ? `${lower(roomTitle(x.room))} · ${x.device}` : `${x.device}${x.room ? ` · ${lower(roomTitle(x.room))}` : ''}`;
  return `${URGENCY[x.urgency] || '⚪'} · ${TYPE[x.type] || 'Заявка'} · от ${safeText(x.teacher)} · ${safeText(place)} · ${safeText(clip(x.text, 200))}`;
}

// What the engineer did, in the words a teacher reads.
export function teacherLine(x) {
  const what = `${roomTitle(x.room)}, ${lower(x.device)}`;
  const c = x.comment ? `: ${clip(x.comment, 200)}` : '';
  if (x.status === 'done') return `${what} — ✅ исправлено${c}`;
  if (x.status === 'not_done') return `${what} — ❌ не получилось${c}`;
  if (x.status === 'cannot_fix') return `${what} — 🚫 нужна закупка или ремонт${c}, передано заму по ИКТ`;
  if (x.status === 'postponed') return `${what} — ➡️ перенесено на ${x.postponedTo ? ruDate(x.postponedTo) : 'другой день'}${c}`;
  return `${what} — ${x.status}`;
}

// One message per teacher with every request the engineer marked between from and to.
export function teacherReports(items, from, to) {
  const out = new Map();
  items.filter((x) => x.type === 'tech' && engineerMarks(x, from, to).length).forEach((x) => {
    if (!out.has(x.teacher)) out.set(x.teacher, []);
    out.get(x.teacher).push(x);
  });
  return [...out].map(([teacher, list]) => ({
    teacher,
    ids: list.map((x) => x.id),
    text: `**Заявки по ИКТ: результат работы инженера**\n\n${list.sort((a, b) => a.id.localeCompare(b.id)).map((x) => `№${x.id} · ${safeText(teacherLine(x))}`).join('\n')}`,
  }));
}

// The deputy's Monday report: what the engineer did on Saturday, with comments; 🚫 is the shopping list.
export function engineerReport(items, from, to) {
  const marked = items.filter((x) => engineerMarks(x, from, to).length);
  if (!marked.length) return '';
  const part = (status, title) => {
    const list = marked.filter((x) => x.status === status);
    return list.length ? `**${title}: ${list.length}**\n${list.map((x) => `• №${x.id} ${safeText(roomTitle(x.room))}, ${safeText(lower(x.device))}${x.status === 'postponed' && x.postponedTo ? ` → ${ruShort(x.postponedTo)}` : ''}${x.comment ? ` — ${safeText(clip(x.comment, 200))}` : ''}`).join('\n')}` : '';
  };
  return ['**Отчёт инженера за выходные**', part('done', '✅ Сделано'), part('not_done', '❌ Не сделано'), part('cannot_fix', '🚫 Нет возможности — что купить или отдать в ремонт'), part('postponed', '➡️ Перенесено')].filter(Boolean).join('\n\n');
}

/* MAX ------------------------------------------------------------------------- */

const cb = (text, payload) => ({ type: 'callback', text, payload });
const link = (text, url) => ({ type: 'link', text, url });
const keyboard = (rows) => [{ type: 'inline_keyboard', payload: { buttons: rows } }];
async function maxCall(env, method, endpoint, body) {
  const r = await fetch(MAX_API + endpoint, { method, headers: { Authorization: String(env.BOT_TOKEN || ''), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`MAX ${r.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return { text }; }
}
function send(env, userId, text, buttons = [], notify = true) {
  const body = { text: String(text).slice(0, 4000), format: 'markdown', notify };
  if (buttons.length) body.attachments = keyboard(buttons);
  return maxCall(env, 'POST', `/messages?user_id=${encodeURIComponent(userId)}`, body);
}
function answer(env, callbackId, text, buttons = []) {
  const message = { text: String(text).slice(0, 4000), format: 'markdown' };
  if (buttons.length) message.attachments = keyboard(buttons); else message.attachments = [];
  return maxCall(env, 'POST', `/answers?callback_id=${encodeURIComponent(callbackId)}`, { message });
}

/* Apps Script ------------------------------------------------------------------- */

async function script(env, body) {
  const r = await fetch(env.APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ ...body, secret: env.ICT_SECRET }), redirect: 'follow' });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Apps Script ${r.status}: не JSON`); }
  if (!data.ok) throw new Error(data.error || 'Apps Script: ошибка');
  return data;
}

export function safeEqual(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const photoUrl = async (env, id) => `${String(env.WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, '')}/ict-photo/${id}?s=${await hmac(env.ICT_SECRET, `photo:${id}`)}`;
const strHash = (s) => { let h = 5381; for (const ch of String(s)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); };
const ready = (env) => Boolean(env.APPS_SCRIPT_URL && env.ICT_SECRET && String(env.ICT_SECRET).length >= 16);

/* Roles and bindings (D1) ------------------------------------------------------- */

async function roleOf(env, userId) { return env.DB.prepare('SELECT role,mode FROM ict_roles WHERE user_id=?').bind(String(userId)).first(); }
async function state(env, key) { const r = await env.DB.prepare('SELECT value,updated_at FROM bot_state WHERE key=?').bind(key).first(); return r || null; }
const setState = (env, key, value) => env.DB.prepare('INSERT OR REPLACE INTO bot_state(key,value,updated_at) VALUES(?,?,?)').bind(key, String(value), new Date().toISOString()).run();
const dropState = (env, key) => env.DB.prepare('DELETE FROM bot_state WHERE key=?').bind(key).run();

// A few wrong codes per hour per person: /role and /link cannot be guessed by trying.
async function tooManyTries(env, userId, kind) {
  const key = `ict-tries:${kind}:${userId}`, r = await state(env, key), hour = Date.now() - 3600000;
  const n = r && Date.parse(r.updated_at) > hour ? Number(r.value) || 0 : 0;
  return { blocked: n >= 5, fail: () => setState(env, key, n + 1) };
}

async function setRole(env, userId, code) {
  const value = String(code || '').trim();
  if (/^(off|выкл|снять)$/i.test(value)) { await env.DB.prepare('DELETE FROM ict_roles WHERE user_id=?').bind(String(userId)).run(); return 'Роль снята. Подписки на расписание остались.'; }
  const tries = await tooManyTries(env, userId, 'role');
  if (tries.blocked) return 'Слишком много неверных кодов. Попробуйте через час.';
  const role = env.ENGINEER_CODE && value.length >= 6 && safeEqual(value, env.ENGINEER_CODE) ? 'engineer' : env.IKT_CODE && value.length >= 6 && safeEqual(value, env.IKT_CODE) ? 'ikt' : '';
  if (!role) { await tries.fail(); return 'Неверный код. Для снятия роли: /role off'; }
  await env.DB.prepare("INSERT INTO ict_roles(user_id,role,mode,updated_at) VALUES(?,?,'instant',?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at").bind(String(userId), role, new Date().toISOString()).run();
  return role === 'engineer'
    ? '**Роль: инженер.**\nЗаявки на субботу придут в пятницу в 17:00 (если пятница выходная — в последний учебный день недели). Под каждой заявкой — кнопки для отметки.\n\n/requests — ваша открытая очередь сейчас.\n/role off — снять роль.'
    : '**Роль: зам по ИКТ.**\nСюда будут приходить уведомления о заявках: 🔴 сразу с 07:00 до 20:00, остальные — в рабочее время.\n\n/ikt\\_mode digest — несрочные пачкой в 10:00 и 14:00\n/ikt\\_mode instant — сразу (сейчас)\n/role off — снять роль.';
}

async function bindTeacher(env, userId, code) {
  const tries = await tooManyTries(env, userId, 'link');
  if (tries.blocked) return 'Слишком много неверных кодов. Попробуйте через час.';
  if (!ready(env)) return 'Заявки по ИКТ ещё не подключены к боту.';
  let r;
  try { r = await script(env, { action: 'ictBotLink', code }); } catch (e) { if (/Код|код/.test(e.message)) { await tries.fail(); return 'Код не найден. Проверьте его на экране после отправки заявки.'; } return 'Не удалось связаться с сервером, попробуйте позже.'; }
  await env.DB.prepare('INSERT INTO ict_links(user_id,teacher,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET teacher=excluded.teacher,created_at=excluded.created_at').bind(String(userId), r.teacher, new Date().toISOString()).run();
  return `**Готово.** Ответы и результаты по заявкам ИКТ для «${safeText(r.teacher)}» будут приходить сюда.`;
}

/* Updates from MAX: commands, buttons, comments ------------------------------- */

const CODE_RE = /^ikt[-_]([A-Za-z2-9]{6})$/;

export async function ictUpdate(update, env, userId) {
  const type = String(update?.update_type || '');
  if (type === 'bot_started') {
    const m = String(update.payload || '').trim().match(CODE_RE);
    if (!m) return false;
    await send(env, userId, await bindTeacher(env, userId, m[1].toUpperCase()));
    return true;
  }
  if (type === 'message_created') {
    const text = String(update?.message?.body?.text || '').trim();
    let m;
    if ((m = text.match(/^\/start\s+ikt[-_]([A-Za-z2-9]{6})$/i)) || (m = text.match(/^\/link\s+([A-Za-z2-9]{6})$/i))) { await send(env, userId, await bindTeacher(env, userId, m[1].toUpperCase())); return true; }
    if ((m = text.match(/^\/role(?:\s+(\S+))?$/i))) { await send(env, userId, m[1] ? await setRole(env, userId, m[1]) : 'Напишите: /role <код>. Код выдаёт администратор.'); return true; }
    const role = await roleOf(env, userId);
    if (/^\/requests$/i.test(text)) { if (role?.role !== 'engineer') return false; await showQueue(env, userId); return true; }
    if ((m = text.match(/^\/ikt_mode(?:\s+(instant|digest))?$/i))) {
      if (role?.role !== 'ikt') return false;
      if (!m[1]) { await send(env, userId, `Режим уведомлений: ${role.mode === 'digest' ? 'пачкой в 10:00 и 14:00' : 'сразу'}.\n/ikt\\_mode instant или /ikt\\_mode digest`); return true; }
      await env.DB.prepare('UPDATE ict_roles SET mode=?,updated_at=? WHERE user_id=?').bind(m[1].toLowerCase(), new Date().toISOString(), String(userId)).run();
      await send(env, userId, m[1].toLowerCase() === 'digest' ? 'Готово: несрочные заявки — пачкой в 10:00 и 14:00. 🔴 по-прежнему сразу.' : 'Готово: уведомления сразу.');
      return true;
    }
    if (role?.role === 'engineer' && !text.startsWith('/')) {
      const wait = await state(env, `ict-await:${userId}`);
      if (wait && Date.now() - Date.parse(wait.updated_at) < AWAIT_MS) { await onEngineerText(env, userId, JSON.parse(wait.value), text); return true; }
    }
    return false;
  }
  if (type === 'message_callback') {
    const payload = String(update?.callback?.payload || '');
    if (!/^ie[-:]/.test(payload)) return false;
    const callbackId = String(update.callback.callback_id || '');
    const role = await roleOf(env, userId);
    if (role?.role !== 'engineer') { await answer(env, callbackId, 'Отмечать заявки может только инженер.'); return true; }
    await onEngineerButton(env, userId, callbackId, payload, String(update?.message?.body?.text || ''));
    return true;
  }
  return false;
}

const SEP = '\n\n· · ·\n';
const baseText = (text) => String(text || '').split(SEP)[0];
const nextSaturday = (now) => { const today = msk(now).iso; let d = addDays(today, 1); while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1); return d; };

async function onEngineerButton(env, userId, callbackId, payload, messageText) {
  const base = baseText(messageText);
  let m = payload.match(/^ie:([dnxp]):([\d,]{1,200})$/);
  if (m) {
    const ids = m[2].split(','), result = RESULT[m[1]];
    if (result === 'done') return applyMark(env, userId, { ids, result }, { callbackId, base });
    if (result === 'postponed') {
      const sat = nextSaturday(clock.now());
      await answer(env, callbackId, `${base}${SEP}➡️ **На когда перенести?**`, [[cb(`Следующая суббота, ${ruShort(sat)}`, `ie-p:${sat}:${m[2]}`)], [cb('Другая дата', `ie-pd:${m[2]}`)], [cb('Назад', `ie-e:${m[2]}`)]]);
      return;
    }
    await setState(env, `ict-await:${userId}`, JSON.stringify({ ids, result, base }));
    await answer(env, callbackId, `${base}${SEP}${RESULT_TEXT[result]} — **напишите коротко, в чём дело**${result === 'cannot_fix' ? ' (что купить или куда отдать)' : ''}, или нажмите «Без комментария».`, [[cb('Без комментария', 'ie-s')], [cb('Назад', `ie-e:${m[2]}`)]]);
    return;
  }
  if ((m = payload.match(/^ie-p:(\d{4}-\d{2}-\d{2}):([\d,]{1,200})$/))) {
    await setState(env, `ict-await:${userId}`, JSON.stringify({ ids: m[2].split(','), result: 'postponed', postponedTo: m[1], base }));
    await answer(env, callbackId, `${base}${SEP}➡️ Перенос на ${ruDate(m[1])} — напишите коротко причину или нажмите «Без комментария».`, [[cb('Без комментария', 'ie-s')], [cb('Назад', `ie-e:${m[2]}`)]]);
    return;
  }
  if ((m = payload.match(/^ie-pd:([\d,]{1,200})$/))) {
    await setState(env, `ict-await:${userId}`, JSON.stringify({ ids: m[1].split(','), result: 'postponed', needDate: true, base }));
    await answer(env, callbackId, `${base}${SEP}➡️ Напишите дату переноса, например ${ruShort(addDays(nextSaturday(clock.now()), 7))}.`, [[cb('Назад', `ie-e:${m[1]}`)]]);
    return;
  }
  if (payload === 'ie-s') {
    const wait = await state(env, `ict-await:${userId}`);
    if (!wait) { await answer(env, callbackId, `${base}${SEP}Отметка уже сохранена или устарела. /requests — открытая очередь.`); return; }
    const w = JSON.parse(wait.value);
    if (w.needDate) { await answer(env, callbackId, `${w.base}${SEP}Сначала напишите дату переноса.`, [[cb('Назад', `ie-e:${w.ids.join(',')}`)]]); return; }
    return applyMark(env, userId, w, { callbackId, base: w.base || base });
  }
  if ((m = payload.match(/^ie-e:([\d,]{1,200})$/))) {
    await dropState(env, `ict-await:${userId}`);
    await answer(env, callbackId, base, markButtons(m[1].split(',')));
  }
}

// A date from the engineer: «05.12», «5.12.2026», «2026-12-05». The year is guessed forward.
export function parseDay(text, now = Date.now()) {
  const s = String(text || '').trim(), today = msk(now).iso;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0');
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  let yyyy = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : today.slice(0, 4);
  let iso = `${yyyy}-${mm}-${dd}`;
  if (!m[3] && iso < today) iso = `${Number(yyyy) + 1}-${mm}-${dd}`;
  return iso;
}

async function onEngineerText(env, userId, wait, text) {
  if (wait.needDate) {
    const iso = parseDay(text, clock.now());
    if (!iso || iso < msk(clock.now()).iso) { await send(env, userId, 'Не понял дату. Напишите, например, 05.12'); return; }
    await setState(env, `ict-await:${userId}`, JSON.stringify({ ...wait, needDate: false, postponedTo: iso }));
    await send(env, userId, `➡️ Перенос на ${ruDate(iso)}. Напишите коротко причину или нажмите «Без комментария».`, [[cb('Без комментария', 'ie-s')]]);
    return;
  }
  await applyMark(env, userId, { ...wait, comment: text.slice(0, 500) }, {});
}

async function applyMark(env, userId, mark, { callbackId, base }) {
  const reply = (text, buttons = []) => (callbackId ? answer(env, callbackId, text, buttons) : send(env, userId, text, buttons));
  try {
    await script(env, { action: 'ictBotMark', ids: mark.ids, result: mark.result, comment: mark.comment || '', postponedTo: mark.postponedTo || '' });
  } catch (e) {
    await reply(`${base || ''}${SEP}Не сохранилось: ${safeText(e.message)}. Попробуйте ещё раз.`, markButtons(mark.ids));
    return;
  }
  await dropState(env, `ict-await:${userId}`);
  const what = `${RESULT_TEXT[mark.result]}${mark.result === 'postponed' && mark.postponedTo ? ` на ${ruDate(mark.postponedTo)}` : ''}${mark.comment ? `: ${safeText(clip(mark.comment, 200))}` : ''}`;
  const title = mark.base || base || `№${mark.ids.join(', №')}`;
  await reply(`${title}${SEP}**${what}**`, [[cb('Изменить отметку', `ie-e:${mark.ids.join(',')}`)]]);
}

// /requests: the engineer's open queue now, the same messages with buttons.
async function showQueue(env, userId) {
  if (!ready(env)) { await send(env, userId, 'Заявки по ИКТ ещё не подключены к боту.'); return; }
  let feed;
  try { feed = await script(env, { action: 'ictBotFeed' }); } catch (e) { await send(env, userId, 'Не удалось получить заявки, попробуйте позже.'); return; }
  const groups = groupQueue(engineerQueue(feed.items, nextSaturday(clock.now()))).slice(0, 25);
  await send(env, userId, queueHeader(groups, 'Открытые заявки'));
  for (const g of groups) await send(env, userId, groupText(g), await groupButtons(env, g), false);
}
async function groupButtons(env, g) {
  const rows = markButtons(g.items.map((x) => x.id));
  for (const x of g.items.filter((i) => i.hasPhoto).slice(0, 3)) rows.push([link(`📷 Фото №${x.id}`, await photoUrl(env, x.id))]);
  return rows;
}

/* The schedule: what is due now ------------------------------------------------ */

// Every message the bot owes at `now`, given the feed, roles, bindings and keys already sent.
// Pure apart from photo links: each item is {key, to:[userIds], text, buttons, notify?}.
export async function plan(env, { now, items, holidays, roles, links, keys }) {
  const out = [], site = String(env.SCHOOL_SITE_URL || DEFAULT_SITE).replace(/\/$/, '');
  const t = msk(now), today = t.iso, monday = mondayOf(today), sat = addDays(monday, 5), sunday = addDays(monday, 6);
  const engineers = roles.filter((r) => r.role === 'engineer').map((r) => String(r.user_id));
  const deputies = roles.filter((r) => r.role === 'ikt');
  const byTeacher = new Map();
  links.forEach((l) => { if (!byTeacher.has(l.teacher)) byTeacher.set(l.teacher, []); byTeacher.get(l.teacher).push(String(l.user_id)); });
  const has = (k) => keys.has(k);
  const openLink = (x) => [[link('Открыть заявку', `${site}/ikt.html#${x.id}`)]];
  const recent = (x) => now - Date.parse(x.created) < 7 * DAY;

  // 1. The deputy's answers go to the teacher at once.
  items.forEach((x) => {
    const answered = (x.history || []).filter((h) => h.by === 'зам по ИКТ' && /ответ:/.test(h.what));
    if (!x.comment || !answered.length || now - Date.parse(answered[answered.length - 1].at) > 7 * DAY) return;
    const key = `ict:ans:${x.id}:${strHash(x.comment)}`;
    if (has(key)) return;
    const to = byTeacher.get(x.teacher) || [];
    out.push({ key, to, notify: { ids: [x.id], value: to.length ? 'да' : 'нет' }, text: `**Ответ по заявке №${x.id}**\n_${safeText(x.type === 'tech' ? `${roomTitle(x.room)} · ${x.device}` : x.device)}: ${safeText(clip(x.text, 120))}_\n\n${safeText(x.comment)}` });
  });

  // 2. The deputy hears about new requests.
  deputies.forEach((d) => {
    const uid = String(d.user_id), digest = [];
    items.filter(recent).sort((a, b) => a.created.localeCompare(b.created)).forEach((x) => {
      const key = `ict:ikt:${uid}:${x.id}`;
      if (has(key) || iktDueAt(x, d.mode, holidays) > now) return;
      if (!isOpen(x)) { out.push({ key, to: [], text: '' }); return; }
      if (d.mode === 'digest' && x.urgency !== 'red') digest.push({ key, x });
      else out.push({ key, to: [uid], text: iktLine(x), buttons: openLink(x) });
    });
    if (digest.length) out.push({ keys: digest.map((e) => e.key), to: [uid], text: `**Новые заявки: ${digest.length}**\n\n${digest.map((e) => `№${e.x.id} ${iktLine(e.x)}`).join('\n\n')}`, buttons: [[link('Открыть все заявки', `${site}/ikt.html`)]] });
  });

  // 3. A question without an answer for a school day: a reminder, once.
  if (isWorkingDay(today, holidays) && t.min >= 480 && t.min < 1020) {
    items.filter((x) => x.type === 'question' && x.executor === 'ikt' && isOpen(x) && questionRemindAt(x, holidays) <= now).forEach((x) => {
      deputies.forEach((d) => { const key = `ict:rq:${x.id}:${d.user_id}`; if (!has(key)) out.push({ key, to: [String(d.user_id)], text: `⏰ **Вопрос ждёт ответа больше учебного дня**\n${iktLine(x)}`, buttons: openLink(x) }); });
    });
  }

  // 4. The engineer: the Friday list, then new ones until the end of Saturday.
  const friAt = fridayListAt(monday, holidays), endSat = atMsk(sunday, '00:00');
  if (engineers.length && friAt && now >= friAt && now < endSat) {
    const friKey = `ict:fri:${monday}`, listed = has(friKey);
    const queue = engineerQueue(items, sat).filter((x) => !has(`ict:eng:${monday}:${x.id}`));
    const groups = groupQueue(queue);
    if (!listed) out.push({ key: friKey, to: engineers, text: queueHeader(groups, `Заявки на субботу ${ruShort(sat)}`) });
    for (const g of groups) out.push({ keys: g.items.map((x) => `ict:eng:${monday}:${x.id}`), to: engineers, text: groupText(g, listed ? '🆕 **Новая заявка на субботу**\n' : ''), buttons: await groupButtons(env, g), quiet: !listed });
  }
  // Saturday 18:00: what is still without a mark.
  const satAt = atMsk(sat, '18:00');
  if (engineers.length && now >= satAt && now < endSat && !has(`ict:left:${monday}`)) {
    const since = friAt || atMsk(addDays(monday, 4), '00:00');
    const left = engineerQueue(items, sat).filter((x) => !engineerMarks(x, since).length);
    if (left.length) {
      const groups = groupQueue(left);
      out.push({ key: `ict:left:${monday}`, to: engineers, text: `**Осталось без отметки: ${left.length}**\nОтметьте, пожалуйста, результат — в понедельник учителя получат отчёт.` });
      for (const g of groups) out.push({ key: `ict:left:${monday}:${g.items.map((x) => x.id).join(',')}`, to: engineers, text: groupText(g), buttons: await groupButtons(env, g), quiet: true });
    } else out.push({ key: `ict:left:${monday}`, to: [], text: '' });
  }

  // 5. The first school day of the week: 08:00 teachers, 08:30 the deputy's report, 09:00 the reminder.
  const first = firstWorkingDay(monday, holidays);
  if (first === today) {
    const from = atMsk(addDays(monday, -3), '00:00'); // from the previous Friday
    if (t.min >= 480) {
      teacherReports(items, from, atMsk(today, '08:00')).forEach((r) => {
        const key = `ict:trep:${monday}:${strHash(r.teacher)}`, to = byTeacher.get(r.teacher) || [];
        if (has(key)) return;
        out.push({ key, to, notify: { ids: r.ids, value: to.length ? 'да' : 'нет' }, text: r.text });
      });
    }
    if (t.min >= 510 && deputies.length && !has(`ict:erep:${monday}`)) {
      const report = engineerReport(items, from, atMsk(today, '08:30'));
      out.push({ key: `ict:erep:${monday}`, to: report ? deputies.map((d) => String(d.user_id)) : [], text: report, buttons: [[link('Открыть заявки', `${site}/ikt.html`)]] });
    }
    if (t.min >= 540 && deputies.length && !has(`ict:rtech:${monday}`)) {
      const prevSat = atMsk(addDays(monday, -2), '00:00');
      const missed = items.filter((x) => isOpen(x) && x.type === 'tech' && x.executor === 'engineer' && x.status !== 'postponed' && Date.parse(x.created) < prevSat && !engineerMarks(x, from).length);
      out.push({ key: `ict:rtech:${monday}`, to: missed.length ? deputies.map((d) => String(d.user_id)) : [], text: `⏰ **Инженер не отметил заявки: ${missed.length}**\n\n${missed.map((x) => iktLine(x)).join('\n\n')}`, buttons: [[link('Открыть заявки', `${site}/ikt.html`)]] });
    }
  }
  return out;
}

/* Running ------------------------------------------------------------------------- */

const keysOf = (m) => (m.keys || [m.key]).filter(Boolean);

// One pass: feed → plan → send within the budget → keys and «учитель уведомлён» saved.
// Returns the subrequests used.
export async function runIct(env, { now = Date.now(), budget = 40, reason = 'cron' } = {}) {
  if (!ready(env) || budget < 3) return 0;
  const t = msk(now);
  if (reason === 'cron') {
    const step = t.min >= 420 && t.min < 1260 ? 5 : 15;
    if (t.min % step !== 0) return 0;
  }
  const lock = await env.DB.prepare('INSERT OR IGNORE INTO bot_state(key,value,updated_at) VALUES(?,?,?)').bind('ict-lock', String(now), new Date(now).toISOString()).run();
  if (!(lock?.meta?.changes ?? lock?.changes)) {
    const held = await state(env, 'ict-lock');
    if (held && now - Number(held.value) < LOCK_MS) return 0;
    await setState(env, 'ict-lock', String(now));
  }
  let used = 2; // the feed (POST and its redirect)
  try {
    const [feed, roles, links, sent] = await Promise.all([
      script(env, { action: 'ictBotFeed' }),
      env.DB.prepare('SELECT user_id,role,mode FROM ict_roles').all(),
      env.DB.prepare('SELECT user_id,teacher FROM ict_links').all(),
      env.DB.prepare("SELECT key FROM bot_state WHERE key LIKE 'ict:%'").all(),
    ]);
    const keys = new Set((sent.results || []).map((r) => r.key));
    const messages = await plan(env, { now, items: feed.items || [], holidays: feed.holidays || [], roles: roles.results || [], links: links.results || [], keys });
    const stamp = new Date(now).toISOString(), writes = [], notified = { да: [], нет: [] };
    for (const m of messages) {
      if (used + m.to.length > budget - 2) break; // keep two for «учитель уведомлён»
      let ok = true;
      for (const uid of m.to) {
        used += 1;
        try { await send(env, uid, m.text, m.buttons || [], !m.quiet); }
        catch (e) { console.error('ict send', uid, e?.message || e); if (!/^MAX 4\d\d/.test(String(e?.message))) ok = false; }
      }
      if (!ok) continue;
      keysOf(m).forEach((k) => { keys.add(k); writes.push(env.DB.prepare('INSERT OR REPLACE INTO bot_state(key,value,updated_at) VALUES(?,?,?)').bind(k, stamp, stamp)); });
      if (m.notify) notified[m.notify.value].push(...m.notify.ids);
    }
    writes.push(env.DB.prepare("DELETE FROM bot_state WHERE key LIKE 'ict:%' AND updated_at < ?").bind(new Date(now - KEEP_KEYS_DAYS * DAY).toISOString()));
    await env.DB.batch(writes);
    for (const value of ['да', 'нет']) {
      if (!notified[value].length) continue;
      used += 2;
      try { await script(env, { action: 'ictBotNotified', ids: [...new Set(notified[value])], value }); } catch (e) { console.error('ict notified', e?.message || e); }
    }
    const count = messages.filter((m) => m.to.length).length;
    if (count) console.log('ict', reason, 'messages', count, 'subrequests', used);
  } catch (e) {
    console.error('ict run', e?.message || e);
  } finally {
    await dropState(env, 'ict-lock');
  }
  return used;
}

/* HTTP: the ping from Apps Script and photo links for the engineer --------------- */

export async function ictFetch(request, env, ctx, url) {
  if (request.method === 'POST' && url.pathname === '/ict-ping') {
    let body = {};
    try { body = await request.json(); } catch { /* empty */ }
    if (!ready(env) || !safeEqual(body.secret, env.ICT_SECRET)) return new Response('forbidden', { status: 403 });
    ctx.waitUntil(runIct(env, { reason: 'ping', budget: 45 }).catch((e) => console.error('ict ping', e?.message || e)));
    return new Response('ok');
  }
  const m = url.pathname.match(/^\/ict-photo\/(\d{4,6})$/);
  if (request.method === 'GET' && m) {
    if (!ready(env) || !safeEqual(url.searchParams.get('s'), await hmac(env.ICT_SECRET, `photo:${m[1]}`))) return new Response('forbidden', { status: 403 });
    try {
      const r = await script(env, { action: 'ictBotPhoto', id: m[1] });
      const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'content-type': r.type || 'image/jpeg', 'cache-control': 'private, max-age=3600', 'x-robots-tag': 'noindex' } });
    } catch (e) {
      return new Response('Фото не найдено', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }
  return null;
}
