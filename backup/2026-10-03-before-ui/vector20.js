(() => {
  'use strict';

  const config = window.SCHOOL_CONFIG || {};
  const site = window.SchoolSite;
  if (!site) return;

  let opportunities = [];
  let activeDirection = 'Все';

  function normalizeCategory(value) {
    const text = String(value ?? '').trim().toUpperCase();
    const symbol = (text.match(/[ABCАВС]/u) || [])[0] || '';
    return ({ А: 'A', В: 'B', С: 'C' }[symbol] || symbol);
  }

  function normalizePriority(value) {
    const match = String(value ?? '').trim().toUpperCase().match(/P\s*([1-4])/);
    return match ? `P${match[1]}` : '';
  }

  function parseOpportunities(rows) {
    if (!rows.length) return [];
    const hasHeader = site.looksLikeHeader(rows[0], ['название', 'направление', 'срок', 'классы', 'категория']);
    const headers = hasHeader ? rows[0] : [];
    const data = hasHeader ? rows.slice(1) : rows;
    const index = hasHeader ? {
      title: site.findHeaderIndex(headers, ['название', 'мероприятие', 'событие'], 0),
      direction: site.findHeaderIndex(headers, ['направление'], 1),
      grades: site.findHeaderIndex(headers, ['классы', 'возраст', 'класс'], 2),
      deadline: site.findHeaderIndex(headers, ['срок', 'дедлайн', 'датадо'], 3),
      format: site.findHeaderIndex(headers, ['формат'], 4),
      category: site.findHeaderIndex(headers, ['категория', 'оценка'], 5),
      priority: site.findHeaderIndex(headers, ['приоритет'], -1),
      description: site.findHeaderIndex(headers, ['описание', 'комментарий'], 6),
      link: site.findHeaderIndex(headers, ['ссылка', 'url'], 7),
      status: site.findHeaderIndex(headers, ['статус'], 8)
    } : {
      title: 0, direction: 1, grades: 2, deadline: 3, format: 4,
      category: 5, priority: -1, description: 6, link: 7, status: 8
    };

    return data
      .filter((row) => row.some((cell) => String(cell ?? '').trim()))
      .map((row) => ({
        title: String(row[index.title] ?? '').trim(),
        direction: String(row[index.direction] ?? '').trim() || 'Другое',
        grades: String(row[index.grades] ?? '').trim(),
        deadline: String(row[index.deadline] ?? '').trim(),
        format: String(row[index.format] ?? '').trim(),
        category: normalizeCategory(row[index.category]),
        priority: index.priority >= 0 ? normalizePriority(row[index.priority]) : '',
        description: String(row[index.description] ?? '').trim(),
        link: site.safeUrl(row[index.link]),
        status: String(row[index.status] ?? '').trim().toLowerCase()
      }))
      .filter((item) => item.title)
      .filter((item) => !['архив', 'закрыто', 'неактуально'].includes(item.status))
      .filter((item) => item.category !== 'C');
  }

  function opportunityMarkup(item) {
    const categoryClass = item.category === 'A' ? ' opportunity-category--a' : item.category === 'B' ? ' opportunity-category--b' : '';
    const link = item.link
      ? `<a class="text-link" href="${site.escapeHtml(item.link)}" target="_blank" rel="noopener">Открыть условия<span aria-hidden="true"> →</span></a>`
      : '';
    return `
      <article class="opportunity-card">
        <div class="opportunity-card__meta">
          <span>${site.escapeHtml(item.direction)}</span>
          ${item.category ? `<span class="opportunity-category${categoryClass}">Категория ${site.escapeHtml(item.category)}</span>` : ''}
          ${item.priority ? `<span class="opportunity-priority">${site.escapeHtml(item.priority)}</span>` : ''}
        </div>
        <h3>${site.escapeHtml(item.title)}</h3>
        ${item.description ? `<p>${site.escapeHtml(item.description)}</p>` : ''}
        <dl class="opportunity-facts">
          ${item.grades ? `<div><dt>Для кого</dt><dd>${site.escapeHtml(item.grades)}</dd></div>` : ''}
          ${item.deadline ? `<div><dt>Срок</dt><dd>${site.escapeHtml(item.deadline)}</dd></div>` : ''}
          ${item.format ? `<div><dt>Формат</dt><dd>${site.escapeHtml(item.format)}</dd></div>` : ''}
        </dl>
        ${link}
      </article>`;
  }

  function renderOpportunities() {
    const target = document.querySelector('[data-opportunities]');
    if (!target) return;
    const visible = activeDirection === 'Все'
      ? opportunities
      : opportunities.filter((item) => item.direction === activeDirection);

    target.innerHTML = visible.length
      ? visible.map(opportunityMarkup).join('')
      : `<div class="empty-state empty-state--large">
          <strong>${opportunities.length ? 'В этом направлении пока нет открытых возможностей.' : 'Банк возможностей готов к подключению.'}</strong>
          <span>Добавьте лист «${site.escapeHtml(config.googleSheets?.sheets?.opportunities || 'Возможности')}» в школьную Google Таблицу — записи категорий A и B появятся здесь автоматически.</span>
        </div>`;
  }

  function buildFilters() {
    const target = document.querySelector('[data-opportunity-filters]');
    if (!target) return;
    const directions = ['Все', ...new Set(opportunities.map((item) => item.direction))];
    target.innerHTML = directions.map((direction) => `
      <button type="button" class="filter-chip${direction === activeDirection ? ' is-active' : ''}" data-direction="${site.escapeHtml(direction)}">${site.escapeHtml(direction)}</button>`).join('');
    target.addEventListener('click', (event) => {
      const button = event.target.closest('[data-direction]');
      if (!button) return;
      activeDirection = button.dataset.direction;
      target.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('is-active', item === button));
      renderOpportunities();
    });
  }

  async function initOpportunities() {
    const target = document.querySelector('[data-opportunities]');
    if (!target) return;
    try {
      const rows = await site.loadSheet(config.googleSheets?.sheets?.opportunities || 'Возможности', { optional: true });
      opportunities = parseOpportunities(rows);
    } catch (_) {
      opportunities = [];
    }
    buildFilters();
    renderOpportunities();
  }

  function initSectionNav() {
    const links = [...document.querySelectorAll('[data-vector-nav] a')];
    const sections = links
      .map((link) => document.querySelector(link.getAttribute('href')))
      .filter(Boolean);
    if (!links.length || !sections.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`));
    }, { rootMargin: '-25% 0px -60% 0px', threshold: [0.1, 0.4, 0.8] });

    sections.forEach((section) => observer.observe(section));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initOpportunities();
    initSectionNav();
  });
})();
