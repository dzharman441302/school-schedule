// «Заявки по ИКТ», shared by help.html (teacher's form), ikt.html (the ИКТ deputy) and
// help-qr.html (stickers): lists of the form, rooms of the school, labels, the Apps Script call.
// The server (apps-script/IctRequests.gs) checks the same device and topic lists.
(() => {
  'use strict';

  const DEVICES = [
    { value: 'Компьютер учителя', icon: '🖥' }, { value: 'Компьютер ученика', icon: '💻' }, { value: 'Принтер / МФУ', icon: '🖨' },
    { value: 'Проектор', icon: '📽' }, { value: 'Интерактивная панель / доска', icon: '🧑‍🏫' }, { value: 'Документ-камера', icon: '📷' },
    { value: 'Сеть / интернет', icon: '🌐' }, { value: 'Другое', icon: '🔧' },
  ];
  const TOPICS = [
    { value: 'Электронный журнал', icon: '📒' }, { value: 'Отчёты', icon: '📊' }, { value: 'Excel / Word', icon: '📄' },
    { value: 'Сферум', icon: '💬' }, { value: 'Почта', icon: '✉️' }, { value: 'Сайт', icon: '🌐' }, { value: 'Другое', icon: '❔' },
  ];
  const URGENCY = {
    red: { mark: '🔴', label: 'Урок сорвётся', hint: 'Нужна помощь сегодня, без неё не провести урок' },
    yellow: { mark: '🟡', label: 'Нужно на этой неделе', hint: 'Мешает работать, но урок можно провести' },
    white: { mark: '⚪', label: 'Не срочно', hint: 'Когда будет время' },
  };
  const STATUS = { new: 'Новая', in_work: 'В работе', done: 'Сделано', not_done: 'Не сделано', cannot_fix: 'Нет возможности', postponed: 'Перенесено', transferred: 'Передана', answered: 'Дан ответ' };
  const CLOSED = ['done', 'answered']; // «нет возможности» stays open until the deputy closes it
  const TYPE = { tech: 'Техника', question: 'Вопрос' };
  const EXECUTOR = { engineer: 'Инженер', ikt: 'Зам по ИКТ' };

  // «Каб. 211», «211» and « 211 » are one room; «зал» and «Зал» too.
  const roomKey = (v) => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/^каб(инет)?\.?\s*/, '').replace(/\s+/g, '');
  const roomLabel = (v) => { const s = String(v || '').trim().replace(/\s+/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
  const isNumberRoom = (r) => /^\d+[а-яa-z]?$/i.test(r);
  const floor = (room) => (isNumberRoom(room) && String(room).length >= 3 ? String(room)[0] : '');

  // Rooms of «Учителя» (cells «класс|предмет|кабинет»), «Расписание» («Предмет (каб)», «304/407»
  // = two rooms) and «Помещения» (first column). Numbers first, then named rooms.
  function roomsFrom(teacherRows = [], scheduleRows = [], extraRows = []) {
    const out = new Map();
    const add = (v) => String(v || '').split('/').forEach((x) => {
      const label = roomLabel(x), key = roomKey(label);
      if (key && !/^[-—–]+$/.test(key) && !out.has(key)) out.set(key, label);
    });
    teacherRows.slice(1).forEach((r) => r.slice(2).forEach((cell) => { const p = String(cell || '').split(/\r?\n|\s*\|\s*/); if (p.length >= 3) add(p[2]); }));
    scheduleRows.slice(1).forEach((r) => r.slice(2).forEach((cell) => { const m = String(cell || '').match(/\(([^)]*)\)\s*$/); if (m) add(m[1]); }));
    extraRows.slice(1).forEach((r) => add(String(r[0] || '').replace(/\//g, ' ')));
    return [...out.values()].sort((a, b) => {
      const na = isNumberRoom(a), nb = isNumberRoom(b);
      if (na !== nb) return na ? -1 : 1;
      return na ? parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b, 'ru') : a.localeCompare(b, 'ru');
    });
  }

  // Size of a photo after scaling its longer side down to `max` (never up).
  function fitBox(width, height, max) {
    const k = Math.min(1, max / Math.max(width, height));
    return { width: Math.round(width * k), height: Math.round(height * k) };
  }

  // «висит 2 ч»: how long ago an ISO time was.
  function age(iso, now = new Date()) {
    const min = (now.getTime() - Date.parse(iso)) / 60000;
    if (!(min >= 1)) return 'только что';
    if (min < 60) return `${Math.floor(min)} мин`;
    if (min < 48 * 60) return `${Math.floor(min / 60)} ч`;
    return `${Math.floor(min / 1440)} дн`;
  }

  const isOpen = (x) => !CLOSED.includes(x.status);

  // The Apps Script address is kept in «Настройки_сайта» (appsScriptUrl), as for late.html.
  async function findEndpoint(site, config) {
    const rows = await site.loadSheet(config.googleSheets?.sheets?.siteSettings || 'Настройки_сайта', { optional: true, ttl: 60 * 60 * 1000 });
    const r = rows?.slice(1).find((x) => String(x[0] || '') === 'appsScriptUrl');
    const url = String(r?.[1] || '');
    return /^https:\/\/script\.google\.com\//.test(url) ? url : '';
  }

  // The body goes as text/plain: no CORS preflight; Apps Script answers with JSON.
  async function post(endpoint, body, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  window.IctCore = Object.freeze({ DEVICES, TOPICS, URGENCY, STATUS, CLOSED, TYPE, EXECUTOR, roomKey, roomLabel, floor, roomsFrom, fitBox, age, isOpen, findEndpoint, post });
})();
