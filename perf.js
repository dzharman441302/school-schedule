/* Замер скорости страницы (задание «Ускорение», шаг 1). Работает только при ?debug=1 в адресе.
   Внизу страницы — панель: когда показаны данные, список запросов (лист Google / вызов Apps Script /
   файл), откуда (сеть или кэш), сколько мс, сколько КБ и строк. Ничего не меняет в работе страницы.
   Подключается первым скриптом после config.js. */
(() => {
  'use strict';
  if (!/[?&]debug=1(?:&|$)/.test(location.search)) return;

  const now = () => Math.round(performance.now());
  const entries = [];
  const state = { firstData: 0, allData: 0, pending: 0, everStarted: false, userActed: false, seq: 0, dataReady: 0 };
  ['pointerdown', 'keydown'].forEach((t) => addEventListener(t, () => { state.userActed = true; }, { capture: true, once: true }));
  let panel = null, body = null, head = null, timer = 0;

  function sheetName(url) {
    const m = url.pathname.match(/\/values\/([^/:]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (url.pathname.includes(':batchGet')) return url.searchParams.getAll('ranges').map((r) => r.replace(/^'|'$/g, '')).join(', ');
    if (url.searchParams.get('fields')) return 'список листов';
    return url.searchParams.get('sheet') || '';
  }

  function describe(input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    let url;
    try { url = new URL(raw, location.href); } catch (_) { return { kind: 'запрос', name: raw.slice(0, 80) }; }
    if (url.hostname === 'sheets.googleapis.com') return { kind: 'лист', name: sheetName(url) };
    if (url.hostname === 'docs.google.com' && url.pathname.includes('/gviz/')) return { kind: 'лист (gviz)', name: sheetName(url) };
    if (url.hostname === 'script.google.com' || url.hostname.endsWith('googleusercontent.com')) {
      let action = url.searchParams.get('action') || '';
      const b = init && typeof init.body === 'string' ? init.body.slice(0, 400) : '';
      const m = b.match(/"action"\s*:\s*"([\w-]{1,40})"/);
      if (m) action = m[1];
      return { kind: 'Apps Script', name: action || url.pathname.split('/').slice(-1)[0] };
    }
    if (url.origin === location.origin) return { kind: 'файл', name: url.pathname.replace(/^\//, '') + url.search };
    return { kind: 'запрос', name: url.hostname + url.pathname };
  }

  function add(entry) { entries.push(entry); schedule(); return entry; }

  // Сеть: обёртка над fetch. Размер — по длине ответа (читается копия, только в режиме замера).
  const origFetch = window.fetch && window.fetch.bind(window);
  if (origFetch) {
    window.fetch = function (input, init) {
      const d = describe(input, init);
      const e = add({ kind: d.kind, name: d.name, source: 'сеть', start: now(), ms: null, kb: null, rows: null, status: '' });
      return origFetch(input, init).then((response) => {
        e.status = String(response.status);
        response.clone().text().then((text) => {
          e.ms = now() - e.start;
          e.kb = Math.round(new Blob([text]).size / 102.4) / 10;
          schedule();
        }).catch(() => { e.ms = now() - e.start; schedule(); });
        return response;
      }, (error) => {
        e.ms = now() - e.start; e.status = error && error.name === 'AbortError' ? 'таймаут' : 'ошибка'; schedule();
        throw error;
      });
    };
  }

  // Встроенные окна (панель завуча на admin-changes.html): от назначения адреса до загрузки.
  const frames = new WeakMap();
  new MutationObserver((list) => list.forEach((m) => {
    const f = m.target;
    if (f.tagName !== 'IFRAME' || !f.src || f.src === 'about:blank') return;
    frames.set(f, add({ kind: 'окно', name: f.src.replace(/^https:\/\/script\.google\.com\/macros\/s\/([^/]{6})[^/]*/, 'Apps Script $1…'), source: 'сеть', start: now(), ms: null, kb: null, rows: null, status: '' }));
  })).observe(document.documentElement, { subtree: true, attributeFilter: ['src'] });
  document.addEventListener('load', (event) => {
    const e = frames.get(event.target);
    if (e && e.ms == null) { e.ms = now() - e.start; schedule(); }
  }, true);

  // app.js сообщает о листах: взят ли из кэша, сколько строк, когда страница получила все данные.
  const api = {
    entries, state,
    cache(name, rows, ageMs, source) {
      add({ kind: 'лист', name, source: source || 'кэш', start: now(), ms: 0, kb: null, rows, status: ageMs != null ? `возраст ${Math.round(ageMs / 1000)} с` : '' });
    },
    rows(name, rows) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === 'лист' && e.source === 'сеть' && e.name.split(', ').includes(name)) { e.rows = (e.rows || 0) + rows; schedule(); return; }
      }
    },
    begin() { state.pending += 1; state.everStarted = true; },
    end() {
      state.pending = Math.max(0, state.pending - 1);
      if (!state.firstData) state.firstData = now();
      // Данные на экране — следующий кадр после того, как пришёл последний лист начальной загрузки
      // (все волны запросов в первые 20 с, до первого нажатия; периодические обновления не в счёт).
      if (state.pending === 0 && !state.userActed && now() < 20000) {
        // Отрисовка идёт сразу после получения данных; кадр — когда браузер её покажет.
        // Запасной таймер — для вкладок в фоне, где кадры не рисуются.
        state.dataReady = now();
        const seq = ++state.seq;
        let done = false;
        const mark = () => { if (done || seq !== state.seq || state.pending) return; done = true; state.allData = now(); schedule(); };
        requestAnimationFrame(() => setTimeout(mark, 0));
        setTimeout(mark, 100);
      }
    },
    summary() {
      const done = entries.filter((e) => e.ms != null);
      const net = entries.filter((e) => e.source === 'сеть');
      const slow = done.reduce((a, e) => (!a || e.ms > a.ms ? e : a), null);
      return {
        page: location.pathname.replace(/^\//, '') || 'index.html',
        dataReadyMs: state.dataReady || null,
        dataShownMs: state.allData || null,
        firstDataMs: state.firstData || null,
        requests: entries.length,
        network: net.length,
        cache: entries.length - net.length,
        kb: Math.round(net.reduce((s, e) => s + (e.kb || 0), 0)),
        slowest: slow ? `${slow.kind} «${slow.name}» ${slow.ms} мс` : '',
        entries: entries.map((e) => ({ ...e }))
      };
    }
  };
  window.S20Perf = api;

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; render(); }, 150);
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function build() {
    panel = document.createElement('div');
    panel.setAttribute('data-perf-panel', '');
    panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483000;max-height:45vh;overflow:auto;'
      + 'padding:8px 10px;border-radius:12px;background:rgba(15,23,42,.94);color:#E2E8F0;'
      + 'font:12px/1.45 ui-monospace,Consolas,monospace;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    panel.innerHTML = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span data-perf-head style="flex:1 1 auto"></span>'
      + '<button type="button" data-perf-copy style="font:inherit;padding:2px 8px">Копировать</button>'
      + '<button type="button" data-perf-fold style="font:inherit;padding:2px 8px">Свернуть</button></div>'
      + '<div data-perf-body style="margin-top:6px;overflow-x:auto"></div>';
    document.body.appendChild(panel);
    head = panel.querySelector('[data-perf-head]');
    body = panel.querySelector('[data-perf-body]');
    panel.querySelector('[data-perf-fold]').addEventListener('click', (ev) => {
      body.hidden = !body.hidden; ev.target.textContent = body.hidden ? 'Развернуть' : 'Свернуть';
    });
    panel.querySelector('[data-perf-copy]').addEventListener('click', () => {
      const text = JSON.stringify(api.summary(), null, 1);
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).catch(() => window.prompt('Замер:', text));
    });
  }

  function render() {
    if (!document.body) return;
    if (!panel) build();
    const s = api.summary();
    head.textContent = `Замер · данные получены: ${s.dataReadyMs != null ? `${s.dataReadyMs} мс` : '…'}`
      + `, на экране: ${s.dataShownMs != null ? `${s.dataShownMs} мс` : '…'}`
      + ` · запросов ${s.requests} (сеть ${s.network}, кэш ${s.cache}) · ${s.kb} КБ`
      + (s.slowest ? ` · самый долгий: ${s.slowest}` : '');
    const td = 'style="padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top"';
    body.innerHTML = '<table style="border-collapse:collapse;color:inherit;font:inherit"><tr style="color:#94A3B8">'
      + ['старт', 'мс', 'что', 'название', 'откуда', 'КБ', 'строк', ''].map((h) => `<td ${td}>${h}</td>`).join('') + '</tr>'
      + entries.map((e) => `<tr><td ${td}>${e.start}</td><td ${td}>${e.ms == null ? '…' : e.ms}</td><td ${td}>${esc(e.kind)}</td>`
        + `<td style="padding:1px 8px 1px 0;word-break:break-all">${esc(e.name)}</td><td ${td}>${esc(e.source)}</td>`
        + `<td ${td}>${e.kb == null ? '' : e.kb}</td><td ${td}>${e.rows == null ? '' : e.rows}</td><td ${td}>${esc(e.status)}</td></tr>`).join('')
      + '</table>';
  }

  document.addEventListener('DOMContentLoaded', schedule);
})();
