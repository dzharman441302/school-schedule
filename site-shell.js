(() => {
  'use strict';

  // Common chrome of the public pages: mobile bottom navigation with the
  // «Ещё» sheet, PWA install and service worker, the bell-state pill in the
  // header, publication freshness and school notices («Оповещения»).

  const site = window.SchoolSite;
  const core = window.ScheduleCore;
  const config = window.SCHOOL_CONFIG || {};
  if (!site) return;

  const esc = site.escapeHtml;
  const sheets = config.googleSheets?.sheets || {};
  const path = location.pathname.toLowerCase();
  const page = /staff\.html$/.test(path) ? 'staff' : /schedule\.html$/.test(path) ? 'schedule' : 'home';
  let deferredInstall = null;

  /* Bottom navigation -------------------------------------------- */

  const icons = {
    schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    changes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h11M4 12h8M4 17h6"/><path d="m15 16 2 2 4-5"/></svg>',
    staff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
  };

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const activeKey = () => (page === 'staff' ? 'staff' : page === 'schedule' ? (location.hash === '#changes' ? 'changes' : 'schedule') : '');

  function setActive() {
    const key = activeKey();
    document.querySelectorAll('.bottom-nav [data-nav-key]').forEach((el) => {
      const on = el.dataset.navKey === key;
      el.classList.toggle('is-active', on);
      if (el.tagName === 'A') { if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }
    });
  }

  function updateInstallButtons() {
    document.querySelectorAll('[data-install-app]').forEach((b) => {
      b.textContent = isStandalone() ? 'Приложение установлено' : (deferredInstall ? 'Установить приложение' : 'Как установить приложение');
      b.disabled = isStandalone();
    });
  }

  async function install() {
    if (isStandalone()) return;
    if (deferredInstall) {
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (_) {}
      deferredInstall = null; updateInstallButtons(); return;
    }
    alert(isIOS() ? 'На iPhone: нажмите «Поделиться» в Safari → «На экран Домой».' : 'Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».');
  }

  function openSheet(open) {
    document.querySelector('.sheet')?.classList.toggle('is-open', open);
    document.querySelector('.sheet-backdrop')?.classList.toggle('is-open', open);
    document.querySelector('[data-mobile-more]')?.setAttribute('aria-expanded', String(open));
    if (open) { updateInstallButtons(); document.querySelector('.sheet__close')?.focus(); }
  }

  function mountBottomNav() {
    if (document.querySelector('.bottom-nav')) return;
    const links = config.links || {};
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Разделы');
    nav.innerHTML = `<a href="schedule.html" data-nav-key="schedule">${icons.schedule}<span>Расписание</span></a><a href="schedule.html#changes" data-nav-key="changes">${icons.changes}<span>Изменения</span></a><a href="staff.html" data-nav-key="staff">${icons.staff}<span>Учителям</span></a><button type="button" data-mobile-more data-nav-key="more" aria-expanded="false" aria-controls="more-sheet">${icons.more}<span>Ещё</span></button>`;
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.addEventListener('click', () => openSheet(false));
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.id = 'more-sheet';
    sheet.setAttribute('aria-label', 'Дополнительное меню');
    const ext = (href) => (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '');
    const contact = site.safeUrl(links.contactUrl), official = site.safeUrl(links.officialSite), vk = site.safeUrl(links.vkCommunity);
    sheet.innerHTML = `<div class="sheet__head"><strong>Ещё</strong><button class="sheet__close" type="button" aria-label="Закрыть">×</button></div>
      <div class="sheet__links">
        <a href="index.html">Главная</a>
        <a href="schedule.html#bells">Расписание звонков</a>
        ${contact ? `<a href="${esc(contact)}"${ext(contact)}>Связаться со школой</a>` : ''}
        ${official ? `<a href="${esc(official)}"${ext(official)}>Официальная страница школы</a>` : ''}
        ${vk ? `<a href="${esc(vk)}"${ext(vk)}>Паблик ВКонтакте</a>` : ''}
        <button type="button" data-install-app>Установить приложение</button>
      </div>
      <p class="sheet__hint">Установленная версия открывается как отдельное приложение и запоминает выбранный класс или учителя.</p>`;
    document.body.append(backdrop, sheet, nav);
    nav.querySelector('[data-mobile-more]').addEventListener('click', () => openSheet(true));
    sheet.querySelector('.sheet__close').addEventListener('click', () => openSheet(false));
    sheet.querySelector('[data-install-app]').addEventListener('click', install);
    sheet.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => openSheet(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
    setActive();
    updateInstallButtons();
  }

  /* Header pill: where the school day stands ---------------------- */

  function updateLivePill() {
    const pill = document.querySelector('[data-live-pill]');
    if (!pill || !core) return;
    const today = site.getSchoolToday();
    let state = 'off', text = 'Сегодня выходной';
    const holiday = site.holidayFor(today);
    if (holiday && ![0, 6].includes(today.getUTCDay())) text = holiday.title;
    if (site.isSchoolDay(today)) {
      const m = core.bellMoment();
      state = m.type;
      if (m.type === 'lesson') text = `Идёт ${m.lesson}-й урок · ${m.remaining} мин`;
      else if (m.type === 'break') text = `Перемена · ${m.next}-й урок через ${m.remaining} мин`;
      else if (m.type === 'before') text = `1-й урок через ${m.remaining} мин`;
      else text = 'Уроки закончились';
    }
    pill.dataset.state = state;
    pill.textContent = text;
    pill.hidden = false;
  }

  /* Publication freshness ----------------------------------------- */

  async function loadFreshness() {
    const targets = [...document.querySelectorAll('[data-publish-status]')];
    if (!targets.length) return;
    let text = 'Публикаций на сегодня ещё нет';
    try {
      const rows = await site.loadSheet(sheets.publicationStatus || 'Статус_публикации', { optional: true, ttl: 60000 });
      const today = site.dateKey(site.getSchoolToday());
      const row = (rows || []).slice(1).reverse().find((r) => site.normalizeDateValue(r[0]) === today);
      if (row) text = `Изменения опубликованы в ${String(row[1] || '').trim().replace(/^.*\s/, '').slice(0, 5)}`;
    } catch (_) { text = 'Данные из школьной таблицы'; }
    targets.forEach((el) => { el.textContent = text; el.hidden = false; });
  }

  /* Notices («Оповещения») ---------------------------------------- */

  const isoDate = (v) => {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  };

  function parseNotice(r) {
    let files = [];
    try { files = JSON.parse(String(r[8] || '[]')); } catch (_) {}
    return {
      title: String(r[2] || '').trim(),
      text: String(r[3] || '').trim(),
      level: String(r[4] || 'info').trim().toLowerCase(),
      image: site.resolveImageUrl(r[7]),
      files: Array.isArray(files) ? files : [],
      button: String(r[9] || '').trim(),
      url: site.safeUrl(r[10])
    };
  }

  function noticeMarkup(n) {
    const level = n.level === 'urgent' ? 'urgent' : n.level === 'important' ? 'important' : '';
    const label = level === 'urgent' ? '<span class="badge badge--cancelled">Срочно</span>' : level === 'important' ? '<span class="badge badge--changed">Важно</span>' : '';
    const files = n.files.map((f) => ({ url: site.safeUrl(f.url || f.viewUrl), name: f.name || 'Файл' })).filter((f) => f.url);
    return `<article class="notice${level ? ` notice--${level}` : ''}"><div>
      <div class="notice__head">${label}<h3>${esc(n.title || 'Информация')}</h3></div>
      ${n.text ? `<p>${esc(n.text)}</p>` : ''}
      ${files.length ? `<div class="notice__files">${files.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`).join('')}</div>` : ''}
      ${n.button && n.url ? `<a class="notice__action" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.button)} →</a>` : ''}
    </div>${n.image ? `<img class="notice__media" src="${esc(n.image)}" alt="" loading="lazy">` : ''}</article>`;
  }

  async function loadNotices() {
    const targets = [...document.querySelectorAll('[data-notices]')];
    if (!targets.length) return;
    let rows = [];
    try { rows = await site.loadSheet(sheets.notices || 'Оповещения', { optional: true, ttl: 60000 }); } catch (_) {}
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timeZone || 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    targets.forEach((target) => {
      const audience = target.dataset.audience === 'teachers' ? ['all', 'teachers'] : ['all', 'students', 'children'];
      const items = (rows || []).slice(1).filter((r) => {
        const from = isoDate(r[5]), to = isoDate(r[6]), aud = String(r[11] || 'all').trim().toLowerCase(), active = String(r[12] || 'true').toLowerCase() !== 'false';
        return active && audience.includes(aud) && (!from || from <= today) && (!to || to >= today);
      }).reverse().map(parseNotice);
      const list = target.querySelector('[data-notices-list]') || target;
      const limit = Number(target.dataset.limit || 0);
      if (!items.length) {
        if (target.dataset.empty) { list.innerHTML = `<div class="empty-state"><span>${esc(target.dataset.empty)}</span></div>`; target.hidden = false; }
        else target.hidden = true;
        return;
      }
      const render = (all) => {
        const shown = !limit || all ? items : items.slice(0, limit);
        list.innerHTML = shown.map(noticeMarkup).join('') + (limit && items.length > limit ? `<button class="btn btn--ghost btn--sm" type="button" data-notices-toggle>${all ? 'Скрыть' : `Все объявления · ${items.length}`}</button>` : '');
        list.querySelector('[data-notices-toggle]')?.addEventListener('click', () => render(!all));
      };
      render(false);
      target.hidden = false;
    });
  }

  /* Boot ------------------------------------------------------------ */

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js?v=18').catch(() => {}));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; updateInstallButtons(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; updateInstallButtons(); });
  window.addEventListener('hashchange', setActive);

  const start = async () => {
    mountBottomNav();
    updateLivePill();
    setInterval(updateLivePill, 20000);
    loadNotices();
    loadFreshness();
    await site.loadCalendar();
    updateLivePill();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.SiteShell = Object.freeze({ refreshFreshness: loadFreshness, refreshNotices: loadNotices, updateLivePill });
})();
