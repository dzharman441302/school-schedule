// task.html: «Задача дня» — сюда ведёт QR со слайда «Сегодня». Ученик выбирает класс, пишет
// ответ, сервер говорит «верно/неверно» (сам ответ не раскрывает). Без ФИО; один ответ с
// устройства в день — устройство помнится в localStorage, сервер хранит только его хэш.
(() => {
  'use strict';
  const site = window.SchoolSite, today = window.TodayCore, ict = window.IctCore, config = window.SCHOOL_CONFIG || {};
  if (!site || !today || !ict) return;
  const $ = (s) => document.querySelector(s), esc = site.escapeHtml;
  const STORE_CLASS = 'school20:taskClass', STORE_DEVICE = 'school20:device';
  const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timeZone || 'Europe/Moscow' }).format(new Date());
  const doneKey = `school20:task:${iso}`;
  let endpoint = '';

  function device() {
    let id = site.storageGet(STORE_DEVICE);
    if (!/^[\w-]{8,64}$/.test(id || '')) { id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; site.storageSet(STORE_DEVICE, id); }
    return id;
  }
  function showError(text) { const e = $('[data-error]'); e.textContent = text; e.hidden = !text; }
  function showResult(correct, already) {
    const box = $('[data-result]');
    box.innerHTML = correct
      ? `<span class="task-result__mark" aria-hidden="true">🎉</span><b>Верно!</b><span>${already ? 'Ты уже решил задачу сегодня.' : 'Отличная работа — твой ответ засчитан классу.'}</span>`
      : `<span class="task-result__mark" aria-hidden="true">🤔</span><b>Пока неверно</b><span>${already ? 'Сегодня ответ уже отправлен.' : 'Ответ засчитан. Правильный появится завтра на экране в холле.'}</span>`;
    box.classList.toggle('is-right', Boolean(correct));
    box.hidden = false;
    $('[data-form]').hidden = true;
    box.focus();
  }

  async function submit(e) {
    e.preventDefault();
    const cls = $('#task-class').value, answer = $('#task-answer').value.trim();
    if (!cls) return showError('Выбери свой класс');
    if (!answer) return showError('Напиши ответ');
    if (!endpoint) return showError('Проверка ответов пока не подключена');
    showError('');
    const btn = $('[data-send]');
    btn.disabled = true; btn.textContent = 'Проверяем…';
    try {
      const r = await ict.post(endpoint, { action: 'dailyTask', cls, answer, device: device() });
      if (!r.ok) throw new Error(r.error || 'Не получилось проверить');
      site.storageSet(STORE_CLASS, cls);
      site.storageSet(doneKey, JSON.stringify({ correct: r.correct }));
      showResult(r.correct, r.already);
    } catch (err) {
      showError(/Failed to fetch|NetworkError|HTTP|abort/i.test(err.message) ? 'Нет связи — проверь интернет и нажми ещё раз' : err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Проверить';
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('[data-form]').addEventListener('submit', submit);
    $('[data-task-date]').textContent = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`));
    const [{ tasks, results }, url] = await Promise.all([today.loadTask({ force: true }), ict.findEndpoint(site, config).catch(() => '')]);
    endpoint = url;
    const task = today.taskFor(tasks, iso), past = today.taskResultBefore(results, iso);
    if (past?.text) { $('[data-yesterday]').textContent = past.text; $('[data-yesterday]').hidden = false; }
    $('[data-none]').hidden = Boolean(task);
    if (!task) return;
    $('[data-task-text]').textContent = task.task;
    if (task.explain) { $('[data-task-explain]').textContent = task.explain; $('[data-task-explain]').hidden = false; }
    const classes = (config.classes || []).filter((c) => !task.parallels.length || task.parallels.includes(String(parseInt(c, 10))));
    $('#task-class').innerHTML = '<option value="">Выбери класс</option>' + classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const saved = site.storageGet(STORE_CLASS);
    if (saved && classes.includes(saved)) $('#task-class').value = saved;
    $('[data-task]').hidden = false;
    try { const done = JSON.parse(site.storageGet(doneKey) || 'null'); if (done) showResult(done.correct, true); } catch (_) {}
  });
})();
