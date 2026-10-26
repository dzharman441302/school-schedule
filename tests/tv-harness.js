'use strict';
// Runs a TV screen (tv.js or tv-students.js) with the real site scripts in a VM:
// fake clock and timers, sheets served from memory, no browser and no network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const SHARED = ['config.js', 'app.js', 'subject-names.js', 'schedule-core.js', 'tv-core.js'];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 20; i += 1) await flush(); };

function element(id) {
  const style = { setProperty(name, value) { this[name] = value; } };
  return {
    id, innerHTML: '', textContent: '', hidden: false, style, dataset: {}, offsetWidth: 0,
    classList: { toggle() {}, add() {}, remove() {} },
    firstElementChild: { style: { setProperty() {} }, offsetWidth: 0 },
    querySelectorAll: () => []
  };
}

async function startScreen(script, { sheets, epoch, search = '', width = 1920, height = 1080 }) {
  let now = 0, id = 0, gate = null, open = null;
  const timers = new Map(), elements = new Map(), events = {}, requests = [];
  const el = (key) => { if (!elements.has(key)) elements.set(key, element(key)); return elements.get(key); };
  const storage = new Map();
  const base = Date.parse(epoch);
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [base + now])); }
    static now() { return base + now; }
  }
  const context = {
    console, Intl, JSON, Math, URL, URLSearchParams, AbortController,
    Date: FakeDate,
    document: { getElementById: el, querySelector: el, querySelectorAll: () => [], addEventListener() {} },
    location: { search, pathname: `/${String(script || 'index.js').replace('.js', '.html')}` },
    innerWidth: width, innerHeight: height,
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    addEventListener: (name, fn) => { events[name] = fn; },
    getComputedStyle: () => ({ fontSize: '16px', whiteSpace: 'normal' }),
    setInterval: (fn, period) => { const key = ++id; timers.set(key, { fn, period, due: now + period }); return key; },
    clearInterval: (key) => { timers.delete(key); },
    setTimeout: (fn, delay = 0) => { const key = ++id; timers.set(key, { fn, period: 0, due: now + delay, once: true }); return key; },
    clearTimeout: (key) => { timers.delete(key); },
    fetch: async (url, options = {}) => {
      if (options.method === 'HEAD') return { headers: { get: () => null } };
      const name = decodeURIComponent(String(url).match(/\/values\/([^?]+)/)[1]);
      requests.push({ name, at: now });
      if (gate) await gate;
      const rows = sheets[name];
      if (rows === undefined) return { ok: false, status: 400, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ values: rows.map((r) => r.slice()) }) };
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of [...SHARED, ...(script ? [script] : [])]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  await settle();

  return {
    tv: context.TvCore,
    core: context.ScheduleCore,
    board: () => el('board').innerHTML,
    text: (key) => el(key).textContent,
    html: (key) => el(key).innerHTML,
    pageTimers: (period) => [...timers.values()].filter((t) => t.period === period).length,
    fetches: (name) => requests.filter((r) => r.name === name).length,
    hold() { gate = new Promise((resolve) => { open = resolve; }); },
    async release() { const go = open; gate = null; open = null; go(); await settle(); },
    async resize(w, h) { context.innerWidth = w; context.innerHeight = h; events.resize?.(); await settle(); },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        const [key, timer] = next;
        now = timer.due;
        if (timer.once) timers.delete(key); else timer.due += timer.period;
        timer.fn();
        await settle();
      }
      now = target;
      await settle();
    }
  };
}

function runTests(title, tests) {
  (async () => {
    for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
    console.log(`${tests.length} ${title} passed`);
  })().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { startScreen, runTests };
