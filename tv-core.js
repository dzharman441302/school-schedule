// Shared by the TV screens (tv.html, tv-students.html): a fixed 1920×1080 stage
// scaled to fit any screen, the school clock checked against the site server,
// the bell state in the header, the footer pager and shrink-to-fit text.
(() => {
  'use strict';
  const site = window.SchoolSite, core = window.ScheduleCore;
  if (!site || !core) return;

  const W = 1920, H = 1080;
  const ZONE = window.SCHOOL_CONFIG?.timeZone || 'Europe/Moscow';
  const esc = site.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const minutesWord = (n) => core.plural(n, 'минута', 'минуты', 'минут');
  let offset = 0; // site server time minus this screen's clock, in ms

  const now = () => Date.now() + offset;

  // Moscow wall time for a moment: the school date (UTC noon, as SchoolSite uses) and minutes since midnight.
  function moment(ms = now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return { date, minutes, time: `${parts.hour}:${parts.minute}`, schoolDay: site.isSchoolDay(date) };
  }

  // School-wide bell state; a day off counts as 'off'.
  function bellState(m) {
    if (!m.schoolDay) return { type: 'off' };
    const s = core.bellMoment(m.minutes, m.date);
    if (s.type !== 'lesson') return s;
    const start = core.toMin(core.bellStart(s.lesson, m.date)), end = core.toMin(core.bellEnd(s.lesson, m.date));
    return { ...s, progress: Math.round(((m.minutes - start) / (end - start)) * 100) };
  }

  const stateKey = (m, s) => `${site.dateKey(m.date)}:${s.type}:${s.lesson || s.next || 0}`;

  // A lesson is still on screen until its bell rings.
  function lessonVisible(lesson, s, m) {
    if (s.type === 'before') return true;
    if (s.type === 'after' || s.type === 'off') return false;
    return core.toMin(core.bellEnd(lesson, m.date) || '23:59') > m.minutes;
  }

  function dayLabel(date) {
    return site.formatSchoolDate(date, { weekday: true, year: false });
  }

  function renderHeader(m, s) {
    $('time').textContent = m.time;
    $('date').textContent = dayLabel(m.date);
    let label = '', value = '', progress = -1;
    if (s.type === 'lesson') {
      label = `Идёт ${s.lesson}-й урок · ${core.bellRange(s.lesson, m.date)}`;
      value = `До звонка ${s.remaining} ${minutesWord(s.remaining)}`;
      progress = s.progress;
    } else if (s.type === 'break') {
      label = `Перемена · ${s.next}-й урок в ${core.bellStart(s.next, m.date)}`;
      value = `Урок через ${s.remaining} ${minutesWord(s.remaining)}`;
    } else if (s.type === 'before') {
      label = s.remaining <= 90 ? `До начала уроков ${s.remaining} ${minutesWord(s.remaining)}` : 'Доброе утро';
      value = `Первый урок в ${core.bellStart(1, m.date)}`;
    } else if (s.type === 'after') {
      label = 'Учебный день завершён';
      value = 'Уроки закончились';
    } else {
      label = 'Сегодня выходной · следующий учебный день';
      value = site.capitalize(dayLabel(site.nextSchoolDay(m.date)));
    }
    if (m.schoolDay && core.bellVariant(m.date) !== core.BELL_BASE && s.type !== 'after') label = `Сокращённые уроки · ${label}`;
    $('status-label').textContent = label;
    $('status-value').textContent = value;
    const bar = $('status-bar');
    bar.hidden = progress < 0;
    bar.firstElementChild?.style.setProperty('width', `${Math.max(0, progress)}%`);
  }

  // The visible area in CSS px: the smallest of what the browser reports. A window
  // larger than the screen (restored at an old size after the TV or Windows scaling
  // changed) is capped at the screen; a size of 0 (window not shown yet) means «unknown».
  function viewport() {
    const known = (list) => { const v = Math.min(...list.filter((x) => Number(x) > 0)); return Number.isFinite(v) ? v : 0; };
    const root = document.documentElement, vv = window.visualViewport, scr = window.screen;
    return {
      w: known([innerWidth, root?.clientWidth, vv?.width, scr?.width]),
      h: known([innerHeight, root?.clientHeight, vv?.height, scr?.height])
    };
  }

  const debug = /(?:^|[?&])debug(?:=|&|$)/.test(location.search);
  let fitted = '';

  // The stage is drawn at 1920×1080 and scaled as one picture, so every TV and
  // browser (720p, 1080p, 4K, with or without browser bars) shows the same layout.
  // Browsers on TV boxes do not always report their size or fire «resize», so the
  // fit is checked again every few seconds; an unknown size is retried, never drawn at 100%.
  function fitStage() {
    const stage = $('stage'), { w, h } = viewport();
    if (!w || !h) { setTimeout(fitStage, 300); return; }
    const scale = Math.min(w / W, h / H);
    const x = Math.max(0, Math.round((w - W * scale) / 2)), y = Math.max(0, Math.round((h - H * scale) / 2));
    const value = `translate(${x}px, ${y}px) scale(${scale})`;
    if (debug) showSizes(w, h, scale);
    if (value === fitted) return;
    fitted = value;
    stage.style.webkitTransformOrigin = '0 0';
    stage.style.webkitTransform = value;
    stage.style.transform = value;
  }

  // tv.html?debug=1: the sizes the browser reports, to see on the TV what it thinks the screen is.
  function showSizes(w, h, scale) {
    let box = $('tv-debug');
    if (!box) { box = document.createElement('div'); box.id = 'tv-debug'; document.body.appendChild(box); }
    const vv = window.visualViewport, scr = window.screen, r = (v) => Math.round(Number(v) || 0);
    box.textContent = `окно ${r(innerWidth)}×${r(innerHeight)} · страница ${r(document.documentElement.clientWidth)}×${r(document.documentElement.clientHeight)} · видимая ${r(vv?.width)}×${r(vv?.height)} · экран ${r(scr?.width)}×${r(scr?.height)} · плотность ${devicePixelRatio} · масштаб ${scale.toFixed(3)} (${r(w)}×${r(h)})`;
  }

  function initStage() {
    fitStage();
    ['resize', 'load', 'pageshow', 'orientationchange'].forEach((name) => addEventListener(name, fitStage));
    ['visibilitychange', 'fullscreenchange', 'webkitfullscreenchange'].forEach((name) => document.addEventListener(name, fitStage));
    window.visualViewport?.addEventListener('resize', fitStage);
    setInterval(fitStage, 3000);
  }

  // TV clocks drift or are set to the wrong zone. The site's own server answers
  // with a Date header (HEAD requests skip the service worker cache), so a screen
  // that is off by more than half a minute follows the server instead.
  async function syncClock() {
    if (typeof fetch !== 'function') return;
    try {
      const sent = Date.now();
      const response = await fetch(`${location.pathname}?clock=${sent}`, { method: 'HEAD', cache: 'no-store' });
      const server = Date.parse(response.headers.get('date') || '');
      if (!Number.isFinite(server)) return;
      const received = Date.now();
      const value = server + 500 + (received - sent) / 2 - received; // the header has whole seconds
      if (Math.abs(value) < 12 * 3600 * 1000) offset = Math.abs(value) > 30000 ? value : 0;
    } catch (_) {}
  }

  // Shrinks text marked data-fit="<min px>" until it fits its box. The stage is
  // never resized, so one pass after each render (and after fonts load) is enough.
  // One-line text is checked by width only: Unbounded's glyphs are taller than its
  // line height, so a height check would shrink text that already fits. Wrapping
  // text (two-line subjects) counts as overflowing when a third line starts.
  function fit(root) {
    if (!root?.querySelectorAll) return;
    const els = [...root.querySelectorAll('[data-fit]')];
    els.forEach((el) => { el.style.fontSize = ''; });
    const over = (el, size, oneLine) => el.scrollWidth > el.clientWidth || (!oneLine && el.scrollHeight - el.clientHeight > size * 0.5);
    els.map((el) => {
      const cs = getComputedStyle(el);
      return { el, size: parseFloat(cs.fontSize) || 0, oneLine: /nowrap|pre/.test(cs.whiteSpace) };
    }).filter((x) => over(x.el, x.size, x.oneLine)).forEach(({ el, size, oneLine }) => {
      const min = Number(el.dataset.fit) || 16;
      while (size > min && over(el, size, oneLine)) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
    });
  }

  function fitWhenReady(root) {
    fit(root);
    document.fonts?.ready?.then(() => fit(root)).catch(() => {});
  }

  // Pages of keys (teachers or parallels) that turn on a timer. A data refresh
  // keeps the page that is on screen and never restarts the timer; the timer only
  // runs while there is more than one page.
  function createRotation({ size, period, onTurn }) {
    let keys = [], page = 0, timer = null;
    const pages = () => Math.max(1, Math.ceil(keys.length / size));
    function setKeys(next) {
      const remaining = keys.slice(page * size);
      keys = next.slice();
      const anchor = remaining.find((key) => keys.includes(key));
      page = anchor === undefined ? 0 : Math.floor(keys.indexOf(anchor) / size);
      if (page >= pages()) page = 0;
    }
    function sync() {
      if (pages() <= 1) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        return false;
      }
      if (timer !== null) return false;
      timer = setInterval(() => { page = (page + 1) % pages(); onTurn(); }, period);
      return true;
    }
    return {
      setKeys, sync, pages,
      page: () => page,
      current: () => keys.slice(page * size, page * size + size),
      keys: () => keys.slice()
    };
  }

  function renderPager(labels, index, text) {
    $('pager').innerHTML = labels.length > 1
      ? labels.map((label, i) => `<span class="tv-chip${i === index ? ' is-on' : i < index ? ' is-done' : ''}">${esc(label)}</span>`).join('')
      : '';
    $('next-text').textContent = text;
  }

  // The bar under «дальше через …» fills over one page period.
  function restartBar(period, running) {
    const box = $('next-bar'), bar = box.firstElementChild;
    box.hidden = !running;
    if (!running || !bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth;
    bar.style.transition = `width ${period}ms linear`;
    bar.style.width = '100%';
  }

  // «Данные на 09:19», or a warning once the network has been gone for a while.
  function renderFreshness(sheetNames) {
    const metas = sheetNames.map((name) => site.getSheetMeta(name)).filter(Boolean);
    const el = $('fresh');
    if (!metas.length) return;
    const savedAt = Math.min(...metas.map((x) => x.savedAt || 0));
    const stale = metas.some((x) => x.source === 'stale' || x.source === 'error');
    const at = savedAt ? moment(savedAt + offset) : null;
    const today = moment();
    const when = !at ? '' : site.dateKey(at.date) === site.dateKey(today.date) ? at.time : `${site.dateKey(at.date).slice(0, 5)} ${at.time}`;
    el.classList.toggle('is-stale', stale);
    el.textContent = stale
      ? (when ? `Нет связи · данные от ${when}` : 'Нет связи с таблицей')
      : `Данные на ${when} · обновляются каждую минуту`;
  }

  // Long subject names, shortened for a TV cell.
  const SHORT = {
    'Физическая культура': 'Физкультура',
    'Изобразительное искусство': 'ИЗО',
    'Основы безопасности и защиты Родины': 'ОБЗР',
    'Духовно-нравственная культура России': 'ДНКР',
    'Функциональная грамотность': 'Функц. грамотность',
    'Функциональная грамотность + Духовно-нравственная культура России': 'Функц. грамотность + ДНКР',
    'Труд (технология)': 'Труд',
    'Внеурочная деятельность': 'Внеурочная деят.',
    'Искусственный интеллект': 'Искусств. интеллект',
    'Обществознание': 'Общество­знание',
    'Программирование': 'Программи­рование',
    'Профориентация': 'Проф­ориентация',
    'Робототехника': 'Робото­техника'
  };
  const shortSubject = (value) => String(value || '').split(' / ').map((part) => SHORT[part.trim()] || part.trim()).join(' / ');

  window.TvCore = Object.freeze({
    W, H, now, moment, bellState, stateKey, lessonVisible, dayLabel, renderHeader,
    initStage, syncClock, fit, fitWhenReady, createRotation, renderPager, restartBar, renderFreshness, shortSubject
  });
})();
