(() => {
  'use strict';

  const isStaff = /staff\.html/i.test(location.pathname);
  if (!isStaff) return;

  function prepareStats() {
    const el = document.querySelector('[data-staff-stats]');
    if (!el || el.querySelector('.staff-metric')) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const nums = [...text.matchAll(/\d+/g)].map(m => m[0]);
    if (nums.length < 3) return;
    el.innerHTML = `
      <div class="staff-metric"><strong>${nums[0]}</strong><span>изменённых<br>клеток</span></div>
      <div class="staff-metric"><strong>${nums[1]}</strong><span>учителей<br>с изменениями</span></div>
      <div class="staff-metric"><strong>${nums[2]}</strong><span>окон между<br>уроками</span></div>`;
  }

  function prepareTeacherCards() {
    const root = document.querySelector('[data-teacher-cards]');
    if (!root) return;

    const cards = [...root.querySelectorAll('.teacher-card')];
    if (!cards.length) return;

    const info = cards.map(card => {
      const lesson = Number(card.querySelector('.teacher-card__lesson')?.textContent?.trim()) || 0;
      const h3 = card.querySelector('h3');
      const title = (h3?.textContent || '').trim();
      const isFree = /^Свободно(?:\s*·)?$/i.test(title) || /^Свободно/i.test(title);
      const isScheduled = !isFree || card.classList.contains('cancelled') || card.classList.contains('changed') || card.classList.contains('room') || card.classList.contains('added');
      card.classList.remove('mobile-outside-work','mobile-gap');
      return {card, lesson, h3, isFree, isScheduled};
    }).filter(x => x.lesson > 0);

    const scheduled = info.filter(x => x.isScheduled);
    const existingEmpty = root.querySelector('.mobile-no-lessons');

    if (!scheduled.length) {
      info.forEach(x => x.card.classList.add('mobile-outside-work'));
      if (!existingEmpty) {
        const empty = document.createElement('div');
        empty.className = 'mobile-no-lessons';
        empty.textContent = 'На этот день у выбранного учителя уроков нет.';
        root.appendChild(empty);
      }
      return;
    }

    existingEmpty?.remove();
    const first = Math.min(...scheduled.map(x => x.lesson));
    const last = Math.max(...scheduled.map(x => x.lesson));

    info.forEach(x => {
      if (x.lesson < first || x.lesson > last) {
        x.card.classList.add('mobile-outside-work');
        return;
      }
      if (x.isFree) {
        x.card.classList.add('mobile-gap');
        if (x.h3 && x.h3.textContent !== 'Свободно') x.h3.textContent = 'Свободно';
        const p = x.card.querySelector('p');
        if (p && p.textContent !== 'Перерыв между уроками') p.textContent = 'Перерыв между уроками';
      }
    });
  }

  function run() {
    prepareStats();
    prepareTeacherCards();
  }

  function observe() {
    const targets = [document.querySelector('[data-staff-stats]'), document.querySelector('[data-teacher-cards]')].filter(Boolean);
    if (!targets.length) return;
    const observer = new MutationObserver(() => requestAnimationFrame(run));
    targets.forEach(t => observer.observe(t, {childList:true}));
  }

  document.addEventListener('DOMContentLoaded', () => {
    run();
    observe();
    setTimeout(run, 300);
    setTimeout(run, 1200);
  });
})();
