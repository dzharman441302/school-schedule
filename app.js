(() => {
  'use strict';

  const config = window.SCHOOL_CONFIG || {};
  const content = window.SITE_CONTENT || { important: [], fallbackNews: [], documents: [] };

  const memoryCache = new Map();
  const sheetMeta = new Map();
  const CACHE_TTL = 10 * 60 * 1000;
  const CACHE_MAX_STALE = 7 * 24 * 60 * 60 * 1000;
  const CACHE_PREFIX = 'school20:sheet:v3:';

  const classCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const normalize = (value) => String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s_\-–—.():№]+/g, '');

  const normalizeClass = (value) => String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/Ё/g, 'Е')
    .replace(/\s+/g, '');

  const safeUrl = (value) => {
    const url = String(value ?? '').trim();
    if (!url) return '';
    if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) return url;
    if (/^(?!\/\/)[\p{L}\p{N}_.\-~/#?&=%+]+$/u.test(url)) return url;
    return '';
  };

  const cell = (row, index) => index >= 0 ? String(row[index] ?? '').trim() : '';

  function storageGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function getZonedDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone || 'Europe/Moscow',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
  }

  function getSchoolToday(date = new Date()) {
    const { year, month, day } = getZonedDateParts(date);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  function formatSchoolDate(date, options = {}) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'UTC',
      day: 'numeric',
      month: options.shortMonth ? 'short' : 'long',
      year: options.year === false ? undefined : 'numeric',
      weekday: options.weekday ? 'long' : undefined
    }).format(date).replace(' г.', '');
  }

  function formatMoscowDateTime() {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: config.timeZone || 'Europe/Moscow',
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date());
  }

  function formatCacheTime(timestamp) {
    if (!timestamp) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: config.timeZone || 'Europe/Moscow',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(timestamp));
  }

  function initMenu() {
    const button = document.querySelector('[data-menu-button]');
    const nav = document.querySelector('[data-nav]');
    if (!button || !nav) return;

    const close = () => {
      nav.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('menu-open');
    };

    button.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(isOpen));
      document.body.classList.toggle('menu-open', isOpen);
    });

    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });

    document.addEventListener('click', (event) => {
      if (!nav.classList.contains('is-open')) return;
      if (!event.target.closest('[data-nav]') && !event.target.closest('[data-menu-button]')) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) close();
    });
  }

  function setDateLabels() {
    const dateTime = formatMoscowDateTime();
    document.querySelectorAll('[data-current-datetime]').forEach((element) => {
      element.textContent = dateTime;
    });

    const today = getSchoolToday();
    document.querySelectorAll('[data-current-date]').forEach((element) => {
      element.textContent = formatSchoolDate(today, { weekday: true });
    });

    document.querySelectorAll('[data-current-year]').forEach((element) => {
      element.textContent = String(today.getUTCFullYear());
    });
  }

  function applyExternalLink(element, href) {
    if (!element || !href) return;
    element.href = href;
    if (/^https?:\/\//i.test(href)) {
      element.target = '_blank';
      element.rel = 'noopener noreferrer';
    }
  }

  function initConfiguredLinks() {
    const links = config.links || {};
    document.querySelectorAll('[data-contact-link]').forEach((element) => applyExternalLink(element, safeUrl(links.contactUrl)));
    document.querySelectorAll('[data-official-link]').forEach((element) => applyExternalLink(element, safeUrl(links.officialSite)));
    document.querySelectorAll('[data-vk-link]').forEach((element) => applyExternalLink(element, safeUrl(links.vkCommunity)));

    document.querySelectorAll('[data-school-name]').forEach((element) => {
      element.textContent = config.school?.fullName || 'МОУ СОШ № 20 г. Твери';
    });
  }

  function sheetUrl(sheetName) {
    const sheets = config.googleSheets || {};
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheets.spreadsheetId || '')}/values/${encodeURIComponent(sheetName)}?key=${encodeURIComponent(sheets.apiKey || '')}`;
  }

  function readStoredCache(cacheKey) {
    let cached = memoryCache.get(cacheKey) || null;
    if (cached) return cached;
    try {
      cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Array.isArray(cached.rows) && Number.isFinite(cached.savedAt)) {
        memoryCache.set(cacheKey, cached);
        return cached;
      }
    } catch (_) {}
    return null;
  }

  function writeStoredCache(cacheKey, entry) {
    memoryCache.set(cacheKey, entry);
    try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch (_) {}
  }

  async function loadSheet(sheetName, { force = false, optional = false } = {}) {
    if (!sheetName) {
      if (optional) return [];
      throw new Error('Не задано название листа Google Таблицы');
    }

    const cacheKey = `${CACHE_PREFIX}${sheetName}`;
    const now = Date.now();
    const cached = readStoredCache(cacheKey);

    if (!force && cached && now - cached.savedAt < CACHE_TTL) {
      sheetMeta.set(sheetName, { source: 'cache', savedAt: cached.savedAt, stale: false });
      return cached.rows;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(sheetUrl(sheetName), {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Google Sheets: ${response.status}`);
      const data = await response.json();
      const rows = Array.isArray(data.values) ? data.values : [];
      const cacheEntry = { savedAt: Date.now(), rows };
      writeStoredCache(cacheKey, cacheEntry);
      sheetMeta.set(sheetName, { source: 'network', savedAt: cacheEntry.savedAt, stale: false });
      return rows;
    } catch (error) {
      if (cached && now - cached.savedAt < CACHE_MAX_STALE) {
        sheetMeta.set(sheetName, { source: 'stale', savedAt: cached.savedAt, stale: true, error: String(error) });
        return cached.rows;
      }
      sheetMeta.set(sheetName, { source: 'error', savedAt: 0, stale: false, error: String(error) });
      if (optional) return [];
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getSheetMeta(sheetName) {
    return sheetMeta.get(sheetName) || null;
  }

  function findHeaderIndex(headers, aliases, fallback = -1) {
    const normalizedHeaders = headers.map(normalize);
    for (const alias of aliases) {
      const index = normalizedHeaders.indexOf(normalize(alias));
      if (index !== -1) return index;
    }
    return fallback;
  }

  function looksLikeHeader(row, keywords) {
    const normalized = row.map(normalize);
    return keywords.some((keyword) => normalized.includes(normalize(keyword)));
  }

  function parseBoolean(value) {
    const normalized = normalize(value);
    return ['1', 'да', 'true', 'yes', 'закрепить', 'закреплено', 'важно'].includes(normalized);
  }

  function isHiddenStatus(value) {
    const status = normalize(value);
    return ['черновик', 'draft', 'архив', 'archive', 'скрыто', 'скрыть', 'непубликовать', 'закрыто', 'неактуально'].includes(status);
  }

  function parseDateValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return { timestamp: 0, display: '' };

    let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (match) {
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      const month = Number(match[2]);
      const day = Number(match[1]);
      const date = new Date(Date.UTC(year, month - 1, day, 12));
      if (!Number.isNaN(date.getTime())) {
        return {
          timestamp: date.getTime(),
          display: new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace(' г.', '')
        };
      }
    }

    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
      return {
        timestamp: date.getTime(),
        display: new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace(' г.', '')
      };
    }

    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      return {
        timestamp: parsed,
        display: new Intl.DateTimeFormat('ru-RU', { timeZone: config.timeZone || 'Europe/Moscow', day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace(' г.', '')
      };
    }

    return { timestamp: 0, display: text };
  }

  function truncateText(value, length = 180) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= length) return text;
    return `${text.slice(0, length).replace(/\s+\S*$/, '').trim()}…`;
  }

  function driveFileId(value) {
    const url = String(value ?? '').trim();
    if (!url) return '';
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
      /[?&]id=([a-zA-Z0-9_-]{10,})/,
      /\/d\/([a-zA-Z0-9_-]{10,})/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return '';
  }

  function resolveImageUrl(value) {
    const url = safeUrl(value);
    if (!url) return '';
    if (/drive\.google\.com|docs\.google\.com/i.test(url)) {
      const id = driveFileId(url);
      if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
    }
    return url;
  }

  function splitImages(value) {
    return String(value ?? '')
      .split(/[;\n]+/)
      .map((item) => resolveImageUrl(item))
      .filter(Boolean)
      .filter((item, index, array) => array.indexOf(item) === index);
  }

  function formatPlainText(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';

    const blocks = text.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block) => {
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length && lines.every((line) => /^[-–—•]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-–—•]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  /* News ------------------------------------------------------- */

  function parseNewsRows(rows, sourceName = 'Новости') {
    if (!Array.isArray(rows) || !rows.length) return [];

    const hasHeader = looksLikeHeader(rows[0], ['заголовок', 'название', 'новость', 'текст', 'дата']);
    const headers = hasHeader ? rows[0] : [];
    const data = hasHeader ? rows.slice(1) : rows;

    const index = hasHeader ? {
      id: findHeaderIndex(headers, ['id', 'идентификатор', 'код'], -1),
      date: findHeaderIndex(headers, ['дата', 'опубликовано', 'датапубликации'], -1),
      category: findHeaderIndex(headers, ['категория', 'тип', 'метка', 'раздел'], -1),
      title: findHeaderIndex(headers, ['заголовок', 'название', 'тема', 'новость'], 0),
      excerpt: findHeaderIndex(headers, ['анонс', 'краткийтекст', 'краткоеописание', 'описание'], -1),
      body: findHeaderIndex(headers, ['текст', 'полныйтекст', 'содержание', 'материал'], -1),
      images: findHeaderIndex(headers, ['фото', 'фотографии', 'изображение', 'изображения', 'картинка'], -1),
      imageAlt: findHeaderIndex(headers, ['подписьфото', 'описаниефото', 'alt'], -1),
      link: findHeaderIndex(headers, ['ссылка', 'url', 'подробнее'], -1),
      linkText: findHeaderIndex(headers, ['текстссылки', 'кнопка', 'действие'], -1),
      pinned: findHeaderIndex(headers, ['закрепить', 'закреплено', 'важно', 'наглавную'], -1),
      status: findHeaderIndex(headers, ['статус', 'публикация'], -1)
    } : {
      id: -1, date: 2, category: -1, title: 0, excerpt: 1, body: 1,
      images: -1, imageAlt: -1, link: -1, linkText: -1, pinned: -1, status: -1
    };

    return data
      .map((row, rowIndex) => {
        if (!row.some((value) => String(value ?? '').trim())) return null;

        let category = cell(row, index.category);
        let link = safeUrl(cell(row, index.link));

        if (!hasHeader) {
          const fourth = String(row[3] ?? '').trim();
          const fifth = String(row[4] ?? '').trim();
          if (safeUrl(fourth)) {
            link = safeUrl(fourth);
            category = fifth;
          } else if (safeUrl(fifth)) {
            category = fourth;
            link = safeUrl(fifth);
          } else {
            category = fourth || fifth;
          }
        }

        const title = cell(row, index.title) || 'Информация школы';
        const body = cell(row, index.body) || cell(row, index.excerpt);
        const excerpt = cell(row, index.excerpt) || truncateText(body, 190);
        const rawDate = cell(row, index.date);
        const parsedDate = parseDateValue(rawDate);
        const explicitId = cell(row, index.id);
        const id = explicitId || `${normalize(sourceName) || 'news'}-${rowIndex + 1}`;
        const status = cell(row, index.status);

        return {
          id,
          source: 'sheet',
          sourceName,
          sourceIndex: rowIndex,
          title,
          excerpt,
          body,
          category: category || (sourceName === 'Объявления' ? 'Объявление' : 'Новости'),
          date: parsedDate.display,
          dateTimestamp: parsedDate.timestamp,
          images: splitImages(cell(row, index.images)),
          imageAlt: cell(row, index.imageAlt),
          link,
          linkText: cell(row, index.linkText) || 'Открыть ссылку',
          pinned: parseBoolean(cell(row, index.pinned)),
          status
        };
      })
      .filter(Boolean)
      .filter((item) => !isHiddenStatus(item.status))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.dateTimestamp - a.dateTimestamp || a.sourceIndex - b.sourceIndex);
  }

  let newsPromise = null;

  async function loadNews({ force = false } = {}) {
    if (!force && newsPromise) return newsPromise;

    newsPromise = (async () => {
      const sheets = config.googleSheets?.sheets || {};
      const newsSheet = sheets.news || 'Новости';
      const announcementsSheet = sheets.announcements || 'Объявления';

      let rows = await loadSheet(newsSheet, { force, optional: true });
      let items = parseNewsRows(rows, newsSheet);

      if (!items.length && announcementsSheet && announcementsSheet !== newsSheet) {
        rows = await loadSheet(announcementsSheet, { force, optional: true });
        items = parseNewsRows(rows, announcementsSheet);
      }

      if (!items.length) {
        items = (Array.isArray(content.fallbackNews) ? content.fallbackNews : []).map((item, index) => ({
          id: item.id || `fallback-${index + 1}`,
          source: 'fallback',
          sourceIndex: index,
          title: String(item.title || 'Информация школы'),
          excerpt: String(item.excerpt || item.body || ''),
          body: String(item.body || item.excerpt || ''),
          category: String(item.category || 'Информация'),
          date: String(item.date || ''),
          dateTimestamp: 0,
          images: Array.isArray(item.images) ? item.images.map(resolveImageUrl).filter(Boolean) : [],
          imageAlt: String(item.imageAlt || ''),
          link: safeUrl(item.link),
          linkText: String(item.linkText || 'Подробнее'),
          pinned: Boolean(item.pinned),
          status: ''
        }));
      }

      return items;
    })();

    return newsPromise;
  }

  function newsHref(item) {
    if (item.source === 'fallback' && item.link) return item.link;
    return `post.html?id=${encodeURIComponent(item.id)}`;
  }

  function externalAttributes(href) {
    return /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  }

  function bindImageFallbacks(root = document) {
    root.querySelectorAll('[data-news-image]').forEach((image) => {
      if (image.dataset.fallbackBound === 'true') return;
      image.dataset.fallbackBound = 'true';
      image.addEventListener('error', () => {
        if (image.dataset.fallbackApplied === 'true') return;
        image.dataset.fallbackApplied = 'true';
        image.src = 'assets/illustrations/news-placeholder.svg';
        image.closest('.news-card__media, .article-cover, figure')?.classList.add('is-placeholder');
      });
    });
  }

  function homeNewsMarkup(item) {
    const href = newsHref(item);
    return `
      <article class="home-news-card">
        <div class="home-news-card__meta">
          <span class="home-news-card__tag">${escapeHtml(item.category)}</span>
          ${item.date ? `<time>${escapeHtml(item.date)}</time>` : ''}
        </div>
        <h4>${escapeHtml(item.title)}</h4>
        ${item.excerpt ? `<p>${escapeHtml(truncateText(item.excerpt, 145))}</p>` : ''}
        <a class="text-link" href="${escapeHtml(href)}"${externalAttributes(href)}>Подробнее <span aria-hidden="true">→</span></a>
      </article>`;
  }

  async function initHomeNews() {
    const targets = [...document.querySelectorAll('[data-home-news]')];
    if (!targets.length) return;

    const items = await loadNews();
    targets.forEach((target) => {
      const limit = Math.max(1, Number(target.dataset.limit || 3));
      target.innerHTML = items.slice(0, limit).map(homeNewsMarkup).join('') || '<div class="empty-state"><strong>Новостей пока нет.</strong></div>';
    });
  }

  function newsCardMarkup(item, featured = false) {
    const href = newsHref(item);
    const image = item.images[0] || 'assets/illustrations/news-placeholder.svg';
    return `
      <article class="news-card${featured ? ' news-card--featured' : ''}">
        <a class="news-card__media${item.images.length ? '' : ' is-placeholder'}" href="${escapeHtml(href)}"${externalAttributes(href)} tabindex="-1" aria-hidden="true">
          <img src="${escapeHtml(image)}" alt="" loading="${featured ? 'eager' : 'lazy'}" decoding="async" data-news-image>
        </a>
        <div class="news-card__body">
          <div class="news-card__meta">
            <span class="news-card__category">${escapeHtml(item.category)}</span>
            ${item.date ? `<time>${escapeHtml(item.date)}</time>` : ''}
            ${item.pinned ? '<span>Закреплено</span>' : ''}
          </div>
          <h3><a href="${escapeHtml(href)}"${externalAttributes(href)}>${escapeHtml(item.title)}</a></h3>
          ${item.excerpt ? `<p>${escapeHtml(truncateText(item.excerpt, featured ? 250 : 175))}</p>` : ''}
          <a class="text-link" href="${escapeHtml(href)}"${externalAttributes(href)}>Читать <span aria-hidden="true">→</span></a>
        </div>
      </article>`;
  }

  async function initNewsPage() {
    const grid = document.querySelector('[data-news-grid]');
    if (!grid) return;

    const filterContainer = document.querySelector('[data-news-filters]');
    const search = document.querySelector('[data-news-search]');
    const count = document.querySelector('[data-news-count]');
    const items = await loadNews();
    let activeCategory = 'Все';
    let query = '';

    const categories = ['Все', ...new Set(items.map((item) => item.category).filter(Boolean))];

    const render = () => {
      const normalizedQuery = normalize(query);
      const visible = items.filter((item) => {
        const categoryMatches = activeCategory === 'Все' || item.category === activeCategory;
        const searchMatches = !normalizedQuery || normalize(`${item.title} ${item.excerpt} ${item.body} ${item.category}`).includes(normalizedQuery);
        return categoryMatches && searchMatches;
      });

      grid.innerHTML = visible.length
        ? visible.map((item, index) => newsCardMarkup(item, index === 0)).join('')
        : '<div class="empty-state empty-state--large"><strong>По выбранным условиям ничего не найдено.</strong><span>Измените категорию или поисковый запрос.</span></div>';
      if (count) count.textContent = String(visible.length);
      bindImageFallbacks(grid);
    };

    if (filterContainer) {
      filterContainer.innerHTML = categories.map((category, index) => `
        <button class="filter-chip${index === 0 ? ' is-active' : ''}" type="button" data-news-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
      filterContainer.addEventListener('click', (event) => {
        const button = event.target.closest('[data-news-category]');
        if (!button) return;
        activeCategory = button.dataset.newsCategory;
        filterContainer.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item === button));
        render();
      });
    }

    if (search) {
      search.addEventListener('input', () => {
        query = search.value;
        render();
      });
    }

    render();
  }

  async function initNewsPost() {
    const target = document.querySelector('[data-news-post]');
    if (!target) return;

    const id = new URLSearchParams(location.search).get('id') || '';
    const items = await loadNews();
    const item = items.find((candidate) => candidate.id === id && candidate.source !== 'fallback');

    if (!item) {
      document.querySelector('[data-post-kicker]')?.replaceChildren(document.createTextNode('Новости'));
      document.querySelector('[data-post-title]')?.replaceChildren(document.createTextNode('Материал не найден'));
      document.querySelector('[data-post-excerpt]')?.replaceChildren(document.createTextNode('Запись могла быть удалена, перемещена или переведена в архив.'));
      target.innerHTML = '<div class="empty-state empty-state--large"><strong>Новость недоступна.</strong><span>Вернитесь в общий раздел новостей и выберите другой материал.</span><a class="button" href="news.html">К новостям</a></div>';
      return;
    }

    document.title = `${item.title} — МОУ СОШ № 20`;
    const kicker = document.querySelector('[data-post-kicker]');
    const title = document.querySelector('[data-post-title]');
    const excerpt = document.querySelector('[data-post-excerpt]');
    const meta = document.querySelector('[data-post-meta]');
    if (kicker) kicker.textContent = item.category;
    if (title) title.textContent = item.title;
    if (excerpt) excerpt.textContent = item.excerpt || '';
    if (meta) meta.innerHTML = `${item.date ? `<span>${escapeHtml(item.date)}</span>` : ''}<span>${escapeHtml(config.school?.shortName || 'МОУ СОШ № 20')}</span>`;

    const cover = item.images[0]
      ? `<div class="article-cover"><img src="${escapeHtml(item.images[0])}" alt="${escapeHtml(item.imageAlt || item.title)}" decoding="async" data-news-image></div>`
      : '';
    const gallery = item.images.length > 1
      ? `<div class="article-gallery">${item.images.slice(1).map((image, index) => `<figure><img src="${escapeHtml(image)}" alt="${escapeHtml(item.imageAlt || `${item.title}, фотография ${index + 2}`)}" loading="lazy" decoding="async" data-news-image></figure>`).join('')}</div>`
      : '';
    const externalLink = item.link
      ? `<div class="article-actions"><a class="button" href="${escapeHtml(item.link)}"${externalAttributes(item.link)}>${escapeHtml(item.linkText || 'Открыть ссылку')}</a><a class="button button--secondary" href="news.html">Все новости</a></div>`
      : '<div class="article-actions"><a class="button button--secondary" href="news.html">Все новости</a></div>';

    target.innerHTML = `
      ${cover}
      <div class="article-body">${formatPlainText(item.body || item.excerpt)}</div>
      ${gallery}
      ${externalLink}`;
    bindImageFallbacks(target);
  }

  /* Important cards ------------------------------------------- */

  function parseImportant(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const hasHeader = looksLikeHeader(rows[0], ['заголовок', 'название', 'текст', 'описание', 'метка']);
    const headers = hasHeader ? rows[0] : [];
    const data = hasHeader ? rows.slice(1) : rows;
    const index = hasHeader ? {
      label: findHeaderIndex(headers, ['метка', 'категория', 'раздел'], 0),
      title: findHeaderIndex(headers, ['заголовок', 'название', 'тема'], 1),
      text: findHeaderIndex(headers, ['текст', 'описание', 'сообщение'], 2),
      href: findHeaderIndex(headers, ['ссылка', 'url', 'адрес'], 3),
      linkText: findHeaderIndex(headers, ['текстссылки', 'кнопка', 'действие'], 4),
      status: findHeaderIndex(headers, ['статус', 'публикация'], -1),
      order: findHeaderIndex(headers, ['порядок', 'сортировка'], -1)
    } : { label: 0, title: 1, text: 2, href: 3, linkText: 4, status: -1, order: -1 };

    return data
      .map((row, rowIndex) => ({
        label: cell(row, index.label) || 'Важно',
        title: cell(row, index.title),
        text: cell(row, index.text),
        href: safeUrl(cell(row, index.href)),
        linkText: cell(row, index.linkText) || 'Подробнее',
        status: cell(row, index.status),
        order: Number(cell(row, index.order)) || rowIndex + 1
      }))
      .filter((item) => item.title || item.text)
      .filter((item) => !isHiddenStatus(item.status))
      .sort((a, b) => a.order - b.order);
  }

  function importantMarkup(item) {
    const link = item.href
      ? `<a href="${escapeHtml(item.href)}"${externalAttributes(item.href)}>${escapeHtml(item.linkText)} <span aria-hidden="true">→</span></a>`
      : '';
    return `
      <article class="today-card">
        <span class="today-card__label">${escapeHtml(item.label || 'Важно')}</span>
        <h3>${escapeHtml(item.title)}</h3>
        ${item.text ? `<p>${escapeHtml(item.text)}</p>` : ''}
        ${link}
      </article>`;
  }

  async function initImportantCards() {
    const targets = [...document.querySelectorAll('[data-important-cards]')];
    if (!targets.length) return;

    const sheetName = config.googleSheets?.sheets?.important || 'Важное';
    let items = [];
    try {
      const rows = await loadSheet(sheetName, { optional: true });
      items = parseImportant(rows);
    } catch (_) {}

    if (!items.length) items = Array.isArray(content.important) ? content.important : [];

    targets.forEach((target) => {
      const limit = Math.max(1, Number(target.dataset.limit || 3));
      target.innerHTML = items.slice(0, limit).map(importantMarkup).join('');
    });
  }

  /* Documents ------------------------------------------------- */

  function fileTypeFromLink(link, explicitType = '') {
    const type = String(explicitType || '').trim().toUpperCase();
    if (type) return type;
    const match = String(link || '').match(/\.([a-z0-9]{2,6})(?:[?#]|$)/i);
    return match ? match[1].toUpperCase() : 'LINK';
  }

  function documentMarkup(documentItem) {
    const href = safeUrl(documentItem.href);
    if (!href) return '';
    const external = /^https?:\/\//i.test(href);
    const downloadName = String(documentItem.download || '').trim();
    const attributes = external
      ? ' target="_blank" rel="noopener noreferrer"'
      : ` download${downloadName ? `="${escapeHtml(downloadName)}"` : ''}`;

    return `
      <a class="document-card" href="${escapeHtml(href)}"${attributes}>
        <span class="document-type">${escapeHtml(documentItem.type || 'FILE')}</span>
        <span class="document-card__body">
          <span class="document-category">${escapeHtml(documentItem.category || 'Документы')}</span>
          <strong>${escapeHtml(documentItem.title)}</strong>
          <span>${escapeHtml(documentItem.description || '')}</span>
        </span>
        <span class="document-arrow" aria-hidden="true">↘</span>
      </a>`;
  }

  function parseSchoolDocuments(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const hasHeader = looksLikeHeader(rows[0], ['категория', 'название', 'документ', 'ссылка', 'тип']);
    const headers = hasHeader ? rows[0] : [];
    const data = hasHeader ? rows.slice(1) : rows;
    const index = hasHeader ? {
      category: findHeaderIndex(headers, ['категория', 'раздел', 'группа'], 0),
      title: findHeaderIndex(headers, ['название', 'заголовок', 'документ'], 1),
      description: findHeaderIndex(headers, ['описание', 'аннотация', 'комментарий'], 2),
      href: findHeaderIndex(headers, ['ссылка', 'url', 'файл', 'адрес'], 3),
      type: findHeaderIndex(headers, ['тип', 'формат'], 4),
      download: findHeaderIndex(headers, ['имяфайла', 'скачатькак'], 5),
      status: findHeaderIndex(headers, ['статус', 'публикация'], -1),
      order: findHeaderIndex(headers, ['порядок', 'сортировка'], -1)
    } : { category: 0, title: 1, description: 2, href: 3, type: 4, download: 5, status: -1, order: -1 };

    return data
      .map((row, rowIndex) => {
        const href = safeUrl(cell(row, index.href));
        return {
          category: cell(row, index.category) || 'Документы школы',
          title: cell(row, index.title),
          description: cell(row, index.description),
          href,
          type: fileTypeFromLink(href, cell(row, index.type)),
          download: cell(row, index.download),
          status: cell(row, index.status),
          order: Number(cell(row, index.order)) || rowIndex + 1
        };
      })
      .filter((item) => item.title && item.href)
      .filter((item) => !isHiddenStatus(item.status))
      .sort((a, b) => a.order - b.order);
  }

  function initStaticDocuments() {
    const allDocuments = Array.isArray(content.documents) ? content.documents : [];

    document.querySelectorAll('[data-documents]').forEach((target) => {
      const mode = target.dataset.mode || 'all';
      const limit = Number(target.dataset.limit || 0);
      let documents = [...allDocuments];
      if (mode === 'featured') documents = documents.filter((item) => item.featured);
      if (limit) documents = documents.slice(0, limit);
      target.innerHTML = documents.map(documentMarkup).join('');
    });

    const filters = document.querySelector('[data-document-filters]');
    const grid = document.querySelector('[data-documents-filterable]');
    const search = document.querySelector('[data-vector-document-search]');
    if (!filters || !grid) return;

    const categories = ['Все документы', ...new Set(allDocuments.map((item) => item.category))];
    let activeCategory = 'Все документы';
    let query = '';

    const render = () => {
      const normalizedQuery = normalize(query);
      const items = allDocuments.filter((item) => {
        const categoryMatches = activeCategory === 'Все документы' || item.category === activeCategory;
        const searchMatches = !normalizedQuery || normalize(`${item.title} ${item.description} ${item.category} ${item.type}`).includes(normalizedQuery);
        return categoryMatches && searchMatches;
      });
      grid.innerHTML = items.map(documentMarkup).join('') || '<div class="empty-state empty-state--large"><strong>Документы не найдены.</strong><span>Измените фильтр или поисковый запрос.</span></div>';
    };

    filters.innerHTML = categories.map((category, index) => `
      <button class="filter-chip${index === 0 ? ' is-active' : ''}" type="button" data-document-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
    filters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-document-category]');
      if (!button) return;
      activeCategory = button.dataset.documentCategory;
      filters.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item === button));
      render();
    });

    if (search) {
      search.addEventListener('input', () => {
        query = search.value;
        render();
      });
    }

    render();
  }

  async function initSchoolDocuments() {
    const grid = document.querySelector('[data-school-documents]');
    if (!grid) return;

    const filters = document.querySelector('[data-school-document-filters]');
    const search = document.querySelector('[data-school-document-search]');
    const sheetName = config.googleSheets?.sheets?.documents || 'Документы';
    let documents = [];

    try {
      const rows = await loadSheet(sheetName, { optional: true });
      documents = parseSchoolDocuments(rows);
    } catch (_) {}

    if (!documents.length) {
      grid.innerHTML = '<div class="empty-state empty-state--large"><strong>Каталог школьных документов пока не заполнен.</strong><span>Добавьте лист «Документы» в Google Таблицу. Материалы «Вектора 20» доступны ниже.</span></div>';
      if (filters) filters.innerHTML = '';
      if (search) search.hidden = true;
      return;
    }

    const categories = ['Все документы', ...new Set(documents.map((item) => item.category))];
    let activeCategory = 'Все документы';
    let query = '';

    const render = () => {
      const normalizedQuery = normalize(query);
      const visible = documents.filter((item) => {
        const categoryMatches = activeCategory === 'Все документы' || item.category === activeCategory;
        const searchMatches = !normalizedQuery || normalize(`${item.title} ${item.description} ${item.category} ${item.type}`).includes(normalizedQuery);
        return categoryMatches && searchMatches;
      });
      grid.innerHTML = visible.map(documentMarkup).join('') || '<div class="empty-state empty-state--large"><strong>Документы не найдены.</strong><span>Измените фильтр или поисковый запрос.</span></div>';
    };

    if (filters) {
      filters.innerHTML = categories.map((category, index) => `
        <button class="filter-chip${index === 0 ? ' is-active' : ''}" type="button" data-school-document-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
      filters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-school-document-category]');
        if (!button) return;
        activeCategory = button.dataset.schoolDocumentCategory;
        filters.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item === button));
        render();
      });
    }

    if (search) {
      search.addEventListener('input', () => {
        query = search.value;
        render();
      });
    }

    render();
  }

  /* Home schedule preview ------------------------------------- */

  const DAY_ORDER = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const DAY_NAMES = { ПН: 'понедельник', ВТ: 'вторник', СР: 'среда', ЧТ: 'четверг', ПТ: 'пятница', СБ: 'суббота', ВС: 'воскресенье' };
  const DAY_ALIASES = {
    пн: 'ПН', понедельник: 'ПН', вт: 'ВТ', вторник: 'ВТ', ср: 'СР', среда: 'СР',
    чт: 'ЧТ', четверг: 'ЧТ', пт: 'ПТ', пятница: 'ПТ', сб: 'СБ', суббота: 'СБ',
    вс: 'ВС', воскресенье: 'ВС'
  };

  const addUtcDays = (date, days) => new Date(date.getTime() + days * 86400000);

  function dateKey(date) {
    return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
  }

  function normalizeDateValue(value) {
    const parsed = parseDateValue(value);
    if (!parsed.timestamp) return String(value ?? '').trim();
    return dateKey(new Date(parsed.timestamp));
  }

  function nextSchoolDay(date) {
    let candidate = addUtcDays(date, 1);
    while ([0, 6].includes(candidate.getUTCDay())) candidate = addUtcDays(candidate, 1);
    return candidate;
  }

  function schoolChangeWindow(baseDate = getSchoolToday()) {
    let first = new Date(baseDate.getTime());
    const originalDay = first.getUTCDay();
    if (originalDay === 6) first = addUtcDays(first, 2);
    if (originalDay === 0) first = addUtcDays(first, 1);
    return { first, second: nextSchoolDay(first) };
  }

  function scheduleParts(rows) {
    if (!rows.length) return { headers: ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'], data: [] };
    const hasHeader = looksLikeHeader(rows[0], ['класс', 'урок', 'пн', 'понедельник']);
    return hasHeader ? { headers: rows[0], data: rows.slice(1) } : { headers: ['Класс', 'Урок', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ'], data: rows };
  }

  function deriveScheduleMeta(rows) {
    const { headers, data } = scheduleParts(rows);
    const classIndex = findHeaderIndex(headers, ['класс', 'классы'], 0);
    const lessonIndex = findHeaderIndex(headers, ['урок', 'номерурока', '№урока'], 1);
    const dayColumns = [];
    headers.forEach((header, index) => {
      const code = DAY_ALIASES[normalize(header)];
      if (code && code !== 'ВС' && !dayColumns.some((item) => item.code === code)) dayColumns.push({ code, index });
    });
    dayColumns.sort((a, b) => DAY_ORDER.indexOf(a.code) - DAY_ORDER.indexOf(b.code));
    const classes = [...new Set(data.map((row) => normalizeClass(row[classIndex])).filter(Boolean))].sort(classCollator.compare);
    return { headers, data, classIndex, lessonIndex, dayColumns, classes };
  }

  function targetScheduleDay() {
    const today = getSchoolToday();
    const day = today.getUTCDay();
    if (day === 6 || day === 0) return { code: 'ПН', label: 'Ближайший учебный день, понедельник' };
    const code = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][day];
    return { code, label: `Сегодня, ${DAY_NAMES[code]}` };
  }

  function lessonNumber(value) {
    const match = String(value ?? '').match(/\d+/);
    return match ? Number(match[0]) : 999;
  }

  function countHomeChanges(rows, selectedClass) {
    if (!Array.isArray(rows) || !rows.length || !selectedClass) return 0;
    const hasHeader = looksLikeHeader(rows[0], ['дата', 'класс', 'урок', 'изменения']);
    const headers = hasHeader ? rows[0] : ['Дата', 'Класс', 'Урок', 'Изменения', 'Примечание'];
    const data = hasHeader ? rows.slice(1) : rows;
    const dateIndex = findHeaderIndex(headers, ['дата'], 0);
    const classIndex = findHeaderIndex(headers, ['класс', 'классы'], 1);
    const dates = schoolChangeWindow();
    const keys = new Set([dateKey(dates.first), dateKey(dates.second)]);
    return data.filter((row) => normalizeClass(row[classIndex]) === selectedClass && keys.has(normalizeDateValue(row[dateIndex]))).length;
  }

  async function initHomeSchedulePreview() {
    const select = document.querySelector('[data-home-class-select]');
    const link = document.querySelector('[data-home-schedule-link]');
    const preview = document.querySelector('[data-home-schedule-preview]');
    if (!select || !link || !preview) return;

    const dayLabel = document.querySelector('[data-home-preview-day]');
    const classLabel = document.querySelector('[data-home-preview-class]');
    const notice = document.querySelector('[data-home-preview-notice]');
    const scheduleSheet = config.googleSheets?.sheets?.schedule || 'Расписание';
    const changesSheet = config.googleSheets?.sheets?.changes || 'Изменения';

    let rows = [];
    let changesRows = [];
    let meta = deriveScheduleMeta([]);
    let classes = [...new Set((Array.isArray(config.classes) ? config.classes : []).map(normalizeClass).filter(Boolean))].sort(classCollator.compare);

    const buildOptions = (selected = '') => {
      select.innerHTML = '<option value="">Выберите класс</option>' + classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
      if (classes.includes(selected)) select.value = selected;
    };

    const render = () => {
      const selectedClass = normalizeClass(select.value);
      const targetDay = targetScheduleDay();
      if (dayLabel) dayLabel.textContent = targetDay.label;
      if (classLabel) classLabel.textContent = selectedClass || 'Класс';

      link.href = selectedClass ? `classes.html?class=${encodeURIComponent(selectedClass)}` : 'classes.html';
      link.textContent = selectedClass ? `Открыть расписание ${selectedClass}` : 'Открыть расписание';
      if (selectedClass) storageSet('school:selectedClass', selectedClass);

      if (!selectedClass) {
        preview.innerHTML = '<div class="mini-schedule__empty"><span>Выберите класс — здесь появятся уроки ближайшего учебного дня.</span></div>';
        if (notice) notice.textContent = 'Изменения публикуются в отдельной вкладке расписания.';
        return;
      }

      const dayColumn = meta.dayColumns.find((item) => item.code === targetDay.code);
      const lessons = dayColumn ? meta.data
        .filter((row) => normalizeClass(row[meta.classIndex]) === selectedClass && String(row[dayColumn.index] ?? '').trim())
        .sort((a, b) => lessonNumber(a[meta.lessonIndex]) - lessonNumber(b[meta.lessonIndex]))
        .slice(0, 7)
        .map((row) => ({ number: row[meta.lessonIndex], name: row[dayColumn.index] })) : [];

      preview.innerHTML = lessons.length
        ? lessons.map((lesson) => `<div class="mini-lesson"><span class="mini-lesson__number">${escapeHtml(lesson.number)}</span><span class="mini-lesson__name">${escapeHtml(lesson.name)}</span></div>`).join('')
        : '<div class="mini-schedule__empty"><span>Для выбранного класса уроки на этот день не найдены.</span></div>';

      const changesCount = countHomeChanges(changesRows, selectedClass);
      if (notice) notice.textContent = changesCount
        ? `Для ${selectedClass} найдено изменений: ${changesCount}. Откройте раздел перед занятиями.`
        : 'Перед занятиями проверьте вкладку «Изменения».';
    };

    const stored = normalizeClass(storageGet('school:selectedClass'));
    buildOptions(stored);
    select.addEventListener('change', render);
    render();

    const [scheduleResult, changesResult] = await Promise.allSettled([
      loadSheet(scheduleSheet, { optional: true }),
      loadSheet(changesSheet, { optional: true })
    ]);

    if (scheduleResult.status === 'fulfilled') rows = scheduleResult.value;
    if (changesResult.status === 'fulfilled') changesRows = changesResult.value;
    meta = deriveScheduleMeta(rows);
    if (meta.classes.length) classes = meta.classes;
    buildOptions(classes.includes(stored) ? stored : '');
    render();
  }

  function initVectorContact() {
    const buttons = [...document.querySelectorAll('[data-vector-application]')];
    if (!buttons.length) return;
    const vectorConfig = config.vector20 || {};
    const { applicationUrl, contactEmail } = vectorConfig;
    const fallback = safeUrl(config.links?.contactUrl) || '#join';

    buttons.forEach((button) => {
      const href = applicationUrl || (contactEmail ? `mailto:${contactEmail}?subject=${encodeURIComponent('Хочу присоединиться к «Вектору 20»')}` : fallback);
      applyExternalLink(button, href);
    });
  }

  window.SchoolSite = Object.freeze({
    escapeHtml,
    normalize,
    normalizeClass,
    safeUrl,
    storageGet,
    storageSet,
    storageRemove,
    getSchoolToday,
    formatSchoolDate,
    formatCacheTime,
    loadSheet,
    getSheetMeta,
    findHeaderIndex,
    looksLikeHeader,
    parseDateValue,
    resolveImageUrl,
    formatPlainText,
    loadNews,
    nextSchoolDay,
    schoolChangeWindow,
    normalizeDateValue,
    dateKey
  });

  document.addEventListener('DOMContentLoaded', () => {
    initMenu();
    setDateLabels();
    window.setInterval(setDateLabels, 60000);
    initConfiguredLinks();
    initHomeNews();
    initNewsPage();
    initNewsPost();
    initImportantCards();
    initStaticDocuments();
    initSchoolDocuments();
    initHomeSchedulePreview();
    initVectorContact();
  });
})();
