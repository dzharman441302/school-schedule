// Замер скорости панели и кабинетов (задание «Ускорение», шаг 1).
//
// Каждый вызов doGet / doPost и каждой функции панели (google.script.run, триггеры) даёт одну
// строку в скрытом листе «Замеры»: когда, действие, мс на сервере, сколько строк прочитано,
// чем кончилось. Только время и количества — без данных.
// Выключить: свойство скрипта PERF_LOG = 0 (включить — удалить свойство или поставить 1).
//
// Чтобы запись не добавляла к каждому вызову ещё одно обращение к таблице, строка сначала
// кладётся в свойства скрипта (perf|…), а триггер perfFlush раз в 5 минут переносит их
// в лист пачкой. Триггер создаётся сам при первом замере.
//
// ВАЖНО: этот файл должен идти в проекте ПОСЛЕДНИМ — он оборачивает функции, уже объявленные
// в остальных файлах. Новый файл в редакторе и так встаёт в конец; clasp сортирует по имени,
// «Скорость» идёт после «Код». Проверка: выполнить perfStatus() в редакторе.

var PERF = Object.freeze({
  sheet: 'Замеры',
  head: ['Когда', 'Действие', 'мс', 'Строк прочитано', 'Итог', 'Шаги'],
  prefix: 'perf|',
  skip: { perfFlush: 1, perfStatus: 1 },
  flushMinutes: 5,
  flushMax: 400,
});

var PERF_DEPTH_ = 0; // var: файл можно выполнить повторно (тесты), уже обёрнутое не трогается
var PERF_ROWS_ = 0;
var PERF_STEPS_ = []; // «сетка 1200; запись 3400; …» — where the time of a long call goes
var PERF_LAST_ = 0;

// A mark inside a long function (publication): the time since the previous mark.
function perfStep_(name) {
  if (!PERF_DEPTH_) return;
  const now = Date.now();
  PERF_STEPS_.push(name + ' ' + (now - PERF_LAST_));
  PERF_LAST_ = now;
}

// Счётчик строк: perfRows_(sheet.getDataRange().getValues()) возвращает те же значения.
function perfRows_(values) {
  if (values && values.length) PERF_ROWS_ += values.length;
  return values;
}

function perfEnabled_() {
  try { return PropertiesService.getScriptProperties().getProperty('PERF_LOG') !== '0'; } catch (_) { return false; }
}

// doPost: действие берём из параметра или из начала тела, не разбирая весь JSON (там бывают фото).
function perfAction_(name, args) {
  if (name !== 'doPost' && name !== 'doGet') return name;
  const e = args && args[0];
  const p = (e && e.parameter) || {};
  if (p.action) return name + ':' + String(p.action).slice(0, 40);
  const head = String((e && e.postData && e.postData.contents) || '').slice(0, 400);
  const m = head.match(/"action"\s*:\s*"([\w-]{1,40})"/);
  if (m) return name + ':' + m[1];
  if (/"update_type"/.test(head)) return name + ':max';
  return name;
}

function perfRun_(name, self, args, fn) {
  if (PERF_DEPTH_ > 0) return fn.apply(self, args); // вложенный вызов — считается во внешнем
  PERF_DEPTH_++;
  PERF_ROWS_ = 0;
  PERF_STEPS_ = [];
  const start = Date.now();
  PERF_LAST_ = start;
  let result = 'ок';
  try {
    return fn.apply(self, args);
  } catch (err) {
    result = 'ошибка';
    throw err;
  } finally {
    PERF_DEPTH_--;
    perfLog_(perfAction_(name, args), Date.now() - start, PERF_ROWS_, result, PERF_STEPS_.join('; '));
  }
}

function perfLog_(action, ms, rows, result, steps) {
  try {
    if (!perfEnabled_()) return;
    const when = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd HH:mm:ss');
    const key = PERF.prefix + Date.now() + '|' + Math.random().toString(36).slice(2, 7);
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify([when, action, ms, rows, result, steps || '']));
    perfEnsureTrigger_();
  } catch (_) {}
}

function perfEnsureTrigger_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('perf:trigger')) return;
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'perfFlush');
  if (!has) ScriptApp.newTrigger('perfFlush').timeBased().everyMinutes(PERF.flushMinutes).create();
  cache.put('perf:trigger', '1', 6 * 3600);
}

// Триггер: перенести накопленные замеры в лист «Замеры» одной записью.
function perfFlush() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const keys = Object.keys(all).filter((k) => k.indexOf(PERF.prefix) === 0).sort().slice(0, PERF.flushMax);
    if (!keys.length) return 0;
    const rows = [];
    keys.forEach((k) => {
      try {
        const r = JSON.parse(all[k]);
        if (Array.isArray(r) && r.length >= 5) { while (r.length < PERF.head.length) r.push(''); rows.push(r.slice(0, PERF.head.length)); }
      } catch (_) {}
    });
    const ss = getSpreadsheet_();
    let sh = ss.getSheetByName(PERF.sheet);
    if (!sh) {
      sh = ss.insertSheet(PERF.sheet);
      sh.getRange(1, 1, 1, PERF.head.length).setValues([PERF.head]);
      sh.setFrozenRows(1);
      sh.hideSheet();
    } else if (sh.getRange(1, PERF.head.length).getValue() !== PERF.head[PERF.head.length - 1]) {
      sh.getRange(1, 1, 1, PERF.head.length).setValues([PERF.head]); // the column «Шаги» was added later
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, PERF.head.length).setValues(rows);
    keys.forEach((k) => props.deleteProperty(k));
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

// Запустить в редакторе: сколько функций под замером и включён ли он.
function perfStatus() {
  const wrapped = Object.keys(globalThis).filter((n) => typeof globalThis[n] === 'function' && globalThis[n].__perf);
  const status = { enabled: perfEnabled_(), wrapped: wrapped.length, hasDoGet: wrapped.indexOf('doGet') !== -1, hasDoPost: wrapped.indexOf('doPost') !== -1 };
  Logger.log(JSON.stringify(status));
  return status;
}

// Обернуть все публичные функции (без «_» на конце), объявленные в файлах выше.
(function perfInstall_() {
  const g = globalThis;
  Object.keys(g).forEach((name) => {
    const fn = g[name];
    // Только свои функции: без «_» на конце, не конструкторы (Date, Object…), не встроенные.
    if (typeof fn !== 'function' || fn.__perf || /_$|^[A-Z]/.test(name) || PERF.skip[name]) return;
    if (/\[native code\]/.test(Function.prototype.toString.call(fn))) return;
    const wrapped = function () { return perfRun_(name, this, arguments, fn); };
    wrapped.__perf = true;
    g[name] = wrapped;
  });
})();
