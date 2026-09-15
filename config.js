window.SCHOOL_CONFIG = Object.freeze({
  school: {
    shortName: 'МОУ СОШ № 20',
    fullName: 'МОУ СОШ № 20 г. Твери',
    city: 'Тверь'
  },
  timeZone: 'Europe/Moscow',
  changesUpdateTime: '15:00',
  links: {
    contactUrl: 'https://vk.me/school_20_tver',
    officialSite: 'https://school.tver.ru/school/20',
    vkCommunity: 'https://vk.ru/school_20_tver'
  },
  googleSheets: {
    spreadsheetId: '1Va5atMLtrqb9JEXE7d9eytoTUFgN-lwT0xlYOevm4S4',
    apiKey: 'AIzaSyDGhaQXvcEv-QvHRDHP_8Q9gVEvzd6fuFI',
    sheets: {
      schedule: 'Расписание',
      changes: 'Изменения',
      teachersPublic: 'Учителя_сайт',
      publicationStatus: 'Статус_публикации',
      notices: 'Оповещения',
      siteSettings: 'Настройки_сайта',
      news: 'Новости',
      announcements: 'Объявления',
      important: 'Важное',
      documents: 'Документы',
      opportunities: 'Возможности'
    }
  },
  classes: [
    '5А', '5Б', '5В', '5И',
    '6А', '6Б', '6И', '6К',
    '7А', '7Б', '7В',
    '8А', '8Б', '8В', '8Г',
    '9А', '9Б', '9В', '9Г',
    '10А', '11А'
  ],
  vector20: { coordinator: '', contactEmail: '', applicationUrl: '' }
});

// Общий оперативный слой публичного сайта. Панель администратора и ТВ-режим
// используют собственный интерфейс и сюда не подключаются.
if (!/\/(?:tv|admin-changes)\.html$/i.test(location.pathname)) {
  window.addEventListener('load', () => {
    const css = [
      ['school-ui-refresh.css?v=ui-20260914b','school-ui-refresh'],
      ['school-ui-polish.css?v=ui-20260914b','school-ui-polish'],
      ['mobile-ui.css?v=ui-20260915','mobile-ui'],
      ['mobile-shell.css?v=17','mobile-shell'],
      ['ui-fixes.css?v=ui-20260915','ui-fixes']
    ];
    css.forEach(([href,key])=>{
      if (document.querySelector(`link[data-dynamic-ui="${key}"]`)) return;
      const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.dynamicUi=key;document.head.appendChild(link);
    });
    const scripts = [
      ['site-enhancements.js?v=ui-20260914b','school-enhancements'],
      ['site-polish.js?v=ui-20260914b','school-polish'],
      ['mobile-ui.js?v=ui-20260915','mobile-ui'],
      ['mobile-shell.js?v=17','mobile-shell']
    ];
    scripts.forEach(([src,key])=>{
      if (document.querySelector(`script[data-dynamic-ui="${key}"]`)) return;
      const script=document.createElement('script');script.src=src;script.dataset.dynamicUi=key;document.body.appendChild(script);
    });
  });
}
