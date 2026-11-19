// «Достижения учащихся»: общее для achievements-form.html и achievements-review.html.
// Данные — только через achievementsApi (config.js), это API в Яндекс Облаке (yc-achievements/).
// ФИО учеников не попадают ни в localStorage, ни в sessionStorage: в sessionStorage лежит
// только токен и кто вошёл (id, краткое ФИО педагога, роль). Проверки формы повторяют серверные.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AchievementsCore = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const SESSION_KEY = 'school20:ach:session';
  const ME_KEY = 'school20:ach:me'; // id педагога для выбора в списке входа — не ФИО учеников
  const STATUS = { new: 'На проверке', checked: 'Проверено', returned: 'Возвращено' };
  const MAX_STUDENTS = 40;
  const PHOTO_MAX_SIDE = 1600;
  const DIPLOMA_MAX_BYTES = 10 * 1024 * 1024;
  const DIPLOMA_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
  const NAME_WORD = /^[А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)?$/;

  /* Проверки ----------------------------------------------------------------- */

  const normalizeName = (v) => String(v == null ? '' : v).replace(/ /g, ' ').trim().split(/\s+/).filter(Boolean).join(' ');

  function studentNameError(name) {
    if (!name) return 'Укажите ФИО ученика';
    if (name.length > 60) return 'ФИО длиннее 60 символов';
    const words = name.split(' ');
    if (words.length < 2 || words.length > 3) return 'ФИО: 2–3 слова (фамилия, имя, отчество)';
    if (!words.every((w) => NAME_WORD.test(w))) return 'ФИО пишется кириллицей';
    return '';
  }

  const isBlankRow = (r) => !normalizeName(r.student_name) && !r.class_name && !r.diploma;

  // Строки учеников формы → ошибки {row, field, message}. Пустые строки пропускаются.
  // sameResult: null — у каждого ученика свой результат; строка — «результат одинаковый для всех».
  function validateRows(rows, { classes = [], results = [], sameResult = null } = {}) {
    const errors = [];
    const filled = rows.map((r, i) => [r, i]).filter(([r]) => !isBlankRow(r));
    if (!filled.length) errors.push({ row: null, field: 'students', message: 'Добавьте хотя бы одного ученика' });
    if (filled.length > MAX_STUDENTS) errors.push({ row: null, field: 'students', message: `Не больше ${MAX_STUDENTS} учеников за раз` });
    if (sameResult !== null && !results.includes(sameResult)) errors.push({ row: null, field: 'result', message: 'Выберите результат для всех' });
    filled.forEach(([r, i]) => {
      const nameError = studentNameError(normalizeName(r.student_name));
      if (nameError) errors.push({ row: i, field: 'student_name', message: nameError });
      if (!classes.includes(r.class_name)) errors.push({ row: i, field: 'class_name', message: 'Выберите класс' });
      if (sameResult === null && !results.includes(r.result)) errors.push({ row: i, field: 'result', message: 'Выберите результат' });
    });
    return errors;
  }

  function validateEvent(ev, dict) {
    const errors = [];
    if (!String(ev.event_name || '').trim()) errors.push({ field: 'event_name', message: 'Укажите мероприятие' });
    if (!dict.directions.includes(ev.direction)) errors.push({ field: 'direction', message: 'Выберите направление' });
    if (!dict.levels.includes(ev.level)) errors.push({ field: 'level', message: 'Выберите уровень' });
    if (!dict.forms.includes(ev.form)) errors.push({ field: 'form', message: 'Выберите форму участия' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.event_date || '')) errors.push({ field: 'event_date', message: 'Укажите дату' });
    return errors;
  }

  // Форма → тело POST /records: одно мероприятие + ученики. Возвращает и номера строк формы,
  // чтобы после ответа сервера (ids в том же порядке) привязать дипломы к записям.
  function buildPayload(ev, rows, { sameResult = '', me = '' } = {}) {
    const used = rows.map((r, i) => [r, i]).filter(([r]) => !isBlankRow(r));
    const payload = {
      event_name: String(ev.event_name || '').trim().replace(/\s+/g, ' '),
      contest_id: ev.contest_id || null,
      direction: ev.direction, level: ev.level, form: ev.form,
      subject: String(ev.subject || '').trim(),
      event_date: ev.event_date,
      supervisor_id: ev.supervisor_id && ev.supervisor_id !== me ? ev.supervisor_id : null,
      students: used.map(([r]) => ({
        student_name: normalizeName(r.student_name), class_name: r.class_name,
        result: sameResult || r.result, consent: r.consent === true,
      })),
    };
    return { payload, rowIndexes: used.map(([, i]) => i) };
  }

  /* Справочники и списки -------------------------------------------------------- */

  const fold = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

  // Поиск мероприятия по словам: «олимп мат» найдёт «Олимпиада по математике».
  function matchContests(query, contests, limit = 8) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return contests.filter((c) => { const name = fold(`${c.name} ${c.subject || ''}`); return words.every((w) => name.includes(w)); }).slice(0, limit);
  }

  const schoolYearStart = (d = new Date()) => (d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1);

  // «Мои записи»: возвращённые сверху, затем по дате мероприятия (новые выше).
  function sortMine(records) {
    return records.slice().sort((a, b) => (a.status === 'returned' ? 0 : 1) - (b.status === 'returned' ? 0 : 1)
      || String(b.event_date).localeCompare(String(a.event_date)) || (b.created_at || 0) - (a.created_at || 0));
  }

  const ruDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };

  function fitBox(width, height, max) {
    const k = Math.min(1, max / Math.max(width, height || 1));
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
  }

  const isPdfUrl = (url) => /\.pdf(\?|$)/i.test(String(url || '').split('#')[0]);

  /* Сессия и запросы ---------------------------------------------------------- */

  function memoryStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
  function safeStore(getter) { try { const s = getter(); s.getItem('x'); return s; } catch (_) { return memoryStore(); } }

  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.message) || (status ? `Ошибка ${status}` : 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'));
      this.status = status; this.code = data && data.error; this.errors = (data && data.errors) || [];
    }
  }

  function createApi({ base, fetchImpl, session, now = () => Date.now() } = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    const store = session || safeStore(() => window.sessionStorage);
    const root = String(base || '').replace(/\/+$/, '');

    function current() {
      try {
        const s = JSON.parse(store.getItem(SESSION_KEY) || 'null');
        if (s && s.token && s.expires_at * 1000 > now()) return s;
      } catch (_) {}
      store.removeItem(SESSION_KEY);
      return null;
    }
    const save = (data) => store.setItem(SESSION_KEY, JSON.stringify({ token: data.token, expires_at: data.expires_at, staff: { id: data.staff.id, short_name: data.staff.short_name, role: data.staff.role } }));
    const logout = () => store.removeItem(SESSION_KEY);

    async function request(method, path, body, { raw = false, auth = true } = {}) {
      if (!root) throw new ApiError(0, { message: 'Сервис ещё не подключён (нет адреса achievementsApi в config.js).' });
      const headers = {};
      const s = current();
      if (auth && s) headers.Authorization = `Bearer ${s.token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let res;
      try {
        res = await doFetch(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit' });
      } catch (_) { throw new ApiError(0, null); }
      if (raw && res.ok) return res;
      let data = null;
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) {
        if (res.status === 401 && auth && path !== '/login') logout();
        throw new ApiError(res.status, data);
      }
      return data;
    }

    return {
      current, logout,
      async login(staffId, pin) { const data = await request('POST', '/login', { staff_id: staffId, pin }, { auth: false }); save(data); return data.staff; },
      staffList: () => request('GET', '/staff', undefined, { auth: false }),
      get: (path) => request('GET', path),
      post: (path, body) => request('POST', path, body || {}),
      put: (path, body) => request('PUT', path, body),
      del: (path) => request('DELETE', path),
      file: (path) => request('GET', path, undefined, { raw: true }),
      // Диплом: ссылка у API, файл — прямо в бакет по presigned PUT (тип и размер входят в подпись).
      async uploadDiploma(recordId, blob) {
        const type = blob.type;
        if (!DIPLOMA_TYPES.includes(type)) throw new ApiError(400, { message: 'Диплом: только JPG, PNG или PDF' });
        if (blob.size > DIPLOMA_MAX_BYTES) throw new ApiError(400, { message: 'Файл диплома — не больше 10 МБ' });
        const up = await request('POST', '/diploma-upload-url', { record_id: recordId, content_type: type, size: blob.size });
        let res;
        try { res = await doFetch(up.upload_url, { method: 'PUT', headers: { 'Content-Type': type }, body: blob, credentials: 'omit' }); } catch (_) { throw new ApiError(0, null); }
        if (!res.ok) throw new ApiError(res.status, { message: 'Не удалось загрузить диплом' });
        return true;
      },
    };
  }

  /* Браузер: сжатие фото диплома, вход ------------------------------------------ */

  // Фото → JPEG не больше 1600 px по длинной стороне (это же убирает EXIF с геолокацией). PDF — как есть.
  async function prepareDiploma(file) {
    if (file.type === 'application/pdf') {
      if (file.size > DIPLOMA_MAX_BYTES) throw new Error('PDF больше 10 МБ');
      return file;
    }
    if (!/^image\//.test(file.type)) throw new Error('Диплом: фото или PDF');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Не удалось открыть фото')); i.src = url; });
      const box = fitBox(img.naturalWidth, img.naturalHeight, PHOTO_MAX_SIDE);
      const canvas = document.createElement('canvas');
      canvas.width = box.width; canvas.height = box.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, box.width, box.height);
      ctx.drawImage(img, 0, 0, box.width, box.height);
      for (const q of [0.85, 0.72, 0.6]) {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size <= DIPLOMA_MAX_BYTES) return blob;
      }
      throw new Error('Фото слишком большое');
    } finally { URL.revokeObjectURL(url); }
  }

  // Вход: список педагогов + личный PIN. els: {section, form, select, pin, error, button}.
  async function mountLogin(api, els, { onReady, storage } = {}) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const local = storage || safeStore(() => window.localStorage);
    const showError = (t) => { els.error.textContent = t; els.error.hidden = !t; };
    els.section.hidden = false;
    try {
      const { staff } = await api.staffList();
      const remembered = local.getItem(ME_KEY) || '';
      els.select.innerHTML = '<option value="">Выберите себя</option>' + staff.map((s) => `<option value="${esc(s.id)}"${s.id === remembered ? ' selected' : ''}>${esc(s.short_name)}</option>`).join('');
      (remembered ? els.pin : els.select).focus();
    } catch (err) { showError(err.message); }
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const staffId = els.select.value, pin = els.pin.value.trim();
      if (!staffId) return showError('Выберите себя в списке');
      if (!/^\d{6}$/.test(pin)) return showError('PIN — 6 цифр');
      showError('');
      els.button.disabled = true;
      try {
        const me = await api.login(staffId, pin);
        local.setItem(ME_KEY, staffId);
        els.pin.value = '';
        els.section.hidden = true;
        onReady(me);
      } catch (err) {
        els.pin.value = '';
        showError(err.message);
        els.pin.focus();
      } finally { els.button.disabled = false; }
    });
  }

  return Object.freeze({
    SESSION_KEY, ME_KEY, STATUS, MAX_STUDENTS, DIPLOMA_TYPES, DIPLOMA_MAX_BYTES,
    normalizeName, studentNameError, isBlankRow, validateRows, validateEvent, buildPayload,
    matchContests, schoolYearStart, sortMine, ruDate, fitBox, isPdfUrl, memoryStore, ApiError, createApi,
    prepareDiploma, mountLogin,
  });
});
