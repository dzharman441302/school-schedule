// help-qr.html: QR stickers «Не работает техника? Сканируйте» for the doors, 12 per A4 sheet.
// Each QR opens help.html?room=N on the public site. Rooms: the timetable and «Помещения».
(() => {
  'use strict';
  const site = window.SchoolSite, ict = window.IctCore, qr = window.QrCode, config = window.SCHOOL_CONFIG || {};
  if (!site || !ict || !qr) return;
  const $ = (s) => document.querySelector(s), esc = site.escapeHtml;
  const PER_SHEET = 12;
  // Printed stickers must lead to the public site even when the page is opened locally.
  const base = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:' ? 'https://sosh20tver.ru/' : new URL('./', location.href).href;
  let rooms = [];

  function sticker(room) {
    const url = `${base}help.html?room=${encodeURIComponent(room)}`;
    const title = /^\d/.test(room) ? `Каб. ${room}` : room;
    return `<div class="qr-sticker">${qr.svg(url, { label: `QR-код заявки, ${title}` })}<b>${esc(title)}</b><small>Не работает техника?<br>Сканируйте</small></div>`;
  }

  function render() {
    const wanted = $('#qr-rooms').value.split(',').map((x) => ict.roomKey(x)).filter(Boolean);
    const list = wanted.length ? wanted.map((k) => rooms.find((r) => ict.roomKey(r) === k) || null) : rooms;
    const unknown = wanted.filter((k, i) => !list[i]);
    const chosen = list.filter(Boolean);
    const sheets = [];
    for (let i = 0; i < chosen.length; i += PER_SHEET) sheets.push(`<div class="qr-sheet">${chosen.slice(i, i + PER_SHEET).map(sticker).join('')}</div>`);
    $('[data-sheets]').innerHTML = sheets.join('');
    $('[data-qr-count]').textContent = `${chosen.length} наклеек, листов A4: ${sheets.length}.${unknown.length ? ` Нет в списке кабинетов: ${unknown.join(', ')}.` : ''}`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('[data-print]').addEventListener('click', () => window.print());
    $('#qr-rooms').addEventListener('input', render);
    const [teachers, schedule, extra] = await Promise.all([
      site.loadSheet('Учителя', { optional: true }).catch(() => []),
      site.loadSheet(config.googleSheets?.sheets?.schedule || 'Расписание', { optional: true }).catch(() => []),
      site.loadSheet('Помещения', { optional: true }).catch(() => []),
    ]);
    rooms = ict.roomsFrom(teachers, schedule, extra);
    render();
  });
})();
