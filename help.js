// help.html: a teacher's request to the ИКТ service. help.html?room=211 (QR sticker on the
// door) opens «Техника не работает» with the room filled in. The surname is remembered on the
// device (the same key as on staff.html), the PIN is not. Photos are scaled down to 1600 px
// in the browser (this also drops the camera's EXIF data, location included).
(() => {
  'use strict';
  const site = window.SchoolSite, ict = window.IctCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !ict) return;

  const STORE_TEACHER = 'school20:myTeacher';
  const PHOTO_MAX_SIDE = 1600;
  const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
  const $ = (s) => document.querySelector(s), esc = site.escapeHtml;
  const form = $('[data-form]');
  const state = { endpoint: '', photo: null, sending: false, rooms: [] };

  const value = (name) => (form.querySelector(`[name="${name}"]:checked`) || form.elements[name] || {}).value || '';

  function chipsMarkup(list, name) {
    return list.map((x) => `<label class="help-chip"><input type="radio" name="${name}" value="${esc(x.value)}"><span aria-hidden="true">${x.icon}</span>${esc(x.value)}</label>`).join('');
  }
  function urgencyMarkup() {
    return Object.entries(ict.URGENCY).map(([key, u]) => `<label class="help-urgency__item help-urgency__item--${key}"><input type="radio" name="urgency" value="${key}"><span class="help-urgency__mark" aria-hidden="true">${u.mark}</span><b>${esc(u.label)}</b><small>${esc(u.hint)}</small></label>`).join('');
  }

  function showError(text) {
    const el = $('[data-error]');
    el.textContent = text;
    el.hidden = !text;
    if (text) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Which parts of the form are shown for «техника» and «вопрос».
  function syncType() {
    const type = value('type');
    $('[data-body]').hidden = !type;
    form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== type; el.disabled = el.dataset.for !== type; });
    $('[data-text-title]').textContent = type === 'question' ? 'Ваш вопрос' : 'Опишите проблему';
    $('#help-text').placeholder = type === 'question' ? 'Например: не получается выгрузить отчёт об успеваемости за триместр' : 'Например: проектор включается, но нет изображения с ноутбука';
    $('[data-photo-title]').textContent = type === 'question' ? 'Скриншот (по желанию)' : 'Фото (по желанию)';
    $('[data-photo-label]').textContent = type === 'question' ? 'Прикрепить скриншот' : 'Сфотографировать или выбрать фото';
    $('[data-question-note]').hidden = type !== 'question';
    syncUrgency();
  }
  function syncUrgency() {
    $('[data-red-note]').hidden = !(value('type') === 'tech' && value('urgency') === 'red');
  }

  /* Photo ---------------------------------------------------------------- */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото. Попробуйте другой снимок.')); };
      img.src = url;
    });
  }
  async function compress(file) {
    const img = await loadImage(file);
    const box = ict.fitBox(img.naturalWidth, img.naturalHeight, PHOTO_MAX_SIDE);
    const canvas = document.createElement('canvas');
    canvas.width = box.width; canvas.height = box.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, box.width, box.height);
    ctx.drawImage(img, 0, 0, box.width, box.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length * 0.75 <= PHOTO_MAX_BYTES) return { dataUrl, type: 'image/jpeg' };
    }
    throw new Error('Фото слишком большое. Попробуйте сделать снимок ещё раз.');
  }
  async function onPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    showError('');
    const label = $('[data-photo-label]'), old = label.textContent;
    label.textContent = 'Обрабатываем фото…';
    try {
      state.photo = await compress(file);
      $('[data-photo-img]').src = state.photo.dataUrl;
      $('[data-photo-preview]').hidden = false;
      $('[data-photo-pick]').hidden = true;
    } catch (err) {
      showError(err.message);
    } finally {
      label.textContent = old;
    }
  }
  function removePhoto() {
    state.photo = null;
    $('[data-photo-preview]').hidden = true;
    $('[data-photo-pick]').hidden = false;
  }

  /* Sending ------------------------------------------------------------------ */

  function check(body) {
    if (!body.type) return 'Выберите: техника или вопрос';
    if (body.type === 'tech' && !body.room) return 'Выберите кабинет';
    if (!body.device) return body.type === 'tech' ? 'Выберите устройство' : 'Выберите тему';
    if (body.text.trim().length < 3) return 'Опишите, что случилось';
    if (!body.urgency) return 'Выберите срочность';
    if (!body.teacher) return 'Выберите свою фамилию';
    if (!/^\d{4,8}$/.test(body.pin)) return 'Введите PIN сотрудников (4–8 цифр)';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    if (state.sending) return;
    const type = value('type');
    const body = {
      action: 'ictRequest', type, room: type === 'tech' ? value('room') : '', device: value(type === 'tech' ? 'device' : 'topic'),
      text: $('#help-text').value, urgency: value('urgency'), teacher: value('teacher'), pin: $('#help-pin').value.trim(),
    };
    const problem = check(body);
    if (problem) { showError(problem); return; }
    if (state.photo) body.photo = { data: state.photo.dataUrl, type: state.photo.type };
    showError('');
    state.sending = true;
    const button = $('[data-send]');
    button.disabled = true;
    button.textContent = 'Отправляем…';
    try {
      const r = await ict.post(state.endpoint, body);
      if (!r.ok) {
        if (r.pin) { $('#help-pin').value = ''; $('#help-pin').focus(); }
        throw new Error(r.error || 'Не удалось отправить заявку');
      }
      site.storageSet(STORE_TEACHER, body.teacher);
      done(r);
    } catch (err) {
      showError(err.name === 'AbortError' || /Failed to fetch|NetworkError|HTTP/.test(err.message) ? 'Нет связи с сервером. Проверьте интернет и нажмите «Отправить» ещё раз — заявка не потеряется.' : err.message);
    } finally {
      state.sending = false;
      button.disabled = false;
      button.textContent = 'Отправить заявку';
    }
  }

  function done(r) {
    $('[data-done-id]').textContent = `№ ${r.id}`;
    let next;
    if (r.type === 'question') next = 'Заместитель директора по ИКТ ответит в рабочее время, ответ придёт в MAX.';
    else if (r.urgency === 'red') next = 'Заявку сразу увидит заместитель директора по ИКТ и постарается помочь сегодня. Инженер работает по субботам — результат его работы придёт в MAX в понедельник.';
    else next = 'Инженер работает по субботам, результат придёт в MAX в понедельник.';
    $('[data-done-next]').textContent = next;
    // Binding MAX: the bot learns who the teacher is from this code (not from a schedule subscription).
    const bot = String(config.links?.maxBot || '');
    const code = /^[A-Z2-9]{6}$/.test(String(r.code || '')) ? r.code : '';
    $('[data-max]').hidden = !(bot && code);
    if (bot && code) {
      $('[data-max-link]').href = `${bot}?start=ikt-${code}`;
      $('[data-max-cmd]').textContent = `/link ${code}`;
    }
    form.hidden = true;
    const box = $('[data-done]');
    box.hidden = false;
    box.focus();
    window.scrollTo({ top: 0 });
  }

  function again() {
    const teacher = value('teacher');
    form.reset();
    removePhoto();
    $('#help-teacher').value = teacher;
    $('[data-counter]').textContent = '0 / 1000';
    syncType();
    form.hidden = false;
    $('[data-done]').hidden = true;
    window.scrollTo({ top: 0 });
  }

  /* Start --------------------------------------------------------------------- */

  async function start() {
    $('[data-devices]').innerHTML = chipsMarkup(ict.DEVICES, 'device');
    $('[data-topics]').innerHTML = chipsMarkup(ict.TOPICS, 'topic');
    $('[data-urgency]').innerHTML = urgencyMarkup();
    form.addEventListener('change', (e) => { if (e.target.name === 'type') syncType(); if (e.target.name === 'urgency') syncUrgency(); });
    form.addEventListener('submit', submit);
    $('#help-text').addEventListener('input', (e) => { $('[data-counter]').textContent = `${e.target.value.length} / 1000`; });
    $('[data-photo]').addEventListener('change', onPhoto);
    $('[data-photo-remove]').addEventListener('click', removePhoto);
    $('[data-again]').addEventListener('click', again);

    const params = new URLSearchParams(location.search);
    const wantedRoom = params.get('room') || '';
    if (wantedRoom) { form.querySelector('[name="type"][value="tech"]').checked = true; }
    syncType();

    const [teachers, schedule, extra, endpoint] = await Promise.all([
      site.loadSheet('Учителя', { optional: true }).catch(() => []),
      site.loadSheet(config.googleSheets?.sheets?.schedule || 'Расписание', { optional: true }).catch(() => []),
      site.loadSheet('Помещения', { optional: true }).catch(() => []),
      ict.findEndpoint(site, config).catch(() => ''),
    ]);
    state.endpoint = endpoint;
    if (!endpoint) { $('[data-broken]').hidden = false; $('[data-send]').disabled = true; }

    state.rooms = ict.roomsFrom(teachers, schedule, extra);
    const room = $('#help-room');
    room.innerHTML = '<option value="">Выберите кабинет</option>' + state.rooms.map((r) => `<option value="${esc(r)}">${/^\d/.test(r) ? `Каб. ${esc(r)}` : esc(r)}</option>`).join('');
    const match = state.rooms.find((r) => ict.roomKey(r) === ict.roomKey(wantedRoom));
    if (match) room.value = match;

    const names = [...new Set(teachers.slice(1).map((r) => String(r[0] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const teacher = $('#help-teacher');
    teacher.innerHTML = '<option value="">Выберите себя</option>' + names.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const saved = site.storageGet(STORE_TEACHER);
    if (saved && names.includes(saved)) teacher.value = saved;
  }

  document.addEventListener('DOMContentLoaded', () => { start().catch((err) => showError(err.message)); });
})();
