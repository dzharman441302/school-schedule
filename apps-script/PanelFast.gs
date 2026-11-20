// Ускорение кабинетов (задание «Ускорение», шаг 4).
//
// 1. Таблицы, которые меняются редко («Расписание», «Учителя», звонки), читаются из листа один раз
//    за вызов и хранятся в CacheService 10 минут. Сброс: при входе в панель (после ручного импорта
//    расписания достаточно войти заново) и при сохранении звонков.
// 2. Открытие панели — один вызов: login (или getAdminBootstrap для сохранённой сессии) сразу
//    возвращает данные панели и ответы для первого дня (день, отметка публикации, журнал замен).
//    Страница берёт их вместо отдельных вызовов (prefetch в Admin.html).

var TABLE_MEMO_ = {};
// Writing calls (publication, server draft) read the sheets afresh and refresh the cache:
// a publication never builds the grid from a copy older than the sheet.
var TABLE_FRESH_ = false;
function tableFresh_() { TABLE_FRESH_ = true; TABLE_MEMO_ = {}; }
var TABLE_CACHE = Object.freeze({ prefix: 'tbl:', seconds: 600, chunk: 40000, maxChunks: 20 });

// Value in CacheService is limited (100 КБ); a table is stored in parts of 40 000 characters.
function tableCache_(key, read) {
  if (TABLE_MEMO_[key]) return TABLE_MEMO_[key];
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (_) {}
  if (cache && !TABLE_FRESH_) {
    try {
      const n = Number(cache.get(TABLE_CACHE.prefix + key + ':n') || 0);
      if (n > 0 && n <= TABLE_CACHE.maxChunks) {
        let text = '';
        for (let i = 0; i < n; i += 1) {
          const part = cache.get(TABLE_CACHE.prefix + key + ':' + i);
          if (part == null) { text = null; break; }
          text += part;
        }
        if (text) return (TABLE_MEMO_[key] = JSON.parse(text));
      }
    } catch (_) {}
  }
  const value = read();
  TABLE_MEMO_[key] = value;
  if (cache) {
    try {
      const text = JSON.stringify(value), n = Math.ceil(text.length / TABLE_CACHE.chunk);
      if (n > 0 && n <= TABLE_CACHE.maxChunks) {
        for (let i = 0; i < n; i += 1) cache.put(TABLE_CACHE.prefix + key + ':' + i, text.slice(i * TABLE_CACHE.chunk, (i + 1) * TABLE_CACHE.chunk), TABLE_CACHE.seconds);
        cache.put(TABLE_CACHE.prefix + key + ':n', String(n), TABLE_CACHE.seconds);
      }
    } catch (_) {}
  }
  return value;
}

function tableCacheClear_(keys) {
  (keys || ['schedule', 'teachers', 'bells']).forEach((key) => {
    delete TABLE_MEMO_[key];
    try { CacheService.getScriptCache().remove(TABLE_CACHE.prefix + key + ':n'); } catch (_) {}
  });
}

// Everything the panel asks for when it opens, in one answer.
function adminBootstrapData_(token) {
  const initial = getInitialData(token), date = initial.today, prefetch = {};
  const add = (name, args, fn) => {
    try { prefetch[name + '|' + JSON.stringify(args)] = fn(); } catch (_) { /* the page will ask for it itself */ }
  };
  add('getAdminDay', [date], () => getAdminDay(token, date));
  add('getPublicationMeta', [date], () => getPublicationMeta(token, date));
  add('getReplacementWeeklyStatus', [date], () => getReplacementWeeklyStatus(token, date));
  return { initial, prefetch };
}

function getAdminBootstrap(token) {
  assertSession_(token);
  return adminBootstrapData_(token);
}
