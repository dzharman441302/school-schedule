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

// Мобильные адаптивные правки подключаем отдельным слоем, чтобы не ломать десктоп.
if (!document.querySelector('link[data-mobile-ui]')) {
  const mobileCss = document.createElement('link');
  mobileCss.rel = 'stylesheet';
  mobileCss.href = 'mobile-ui.css?v=mobile-20260915';
  mobileCss.dataset.mobileUi = '1';
  document.head.appendChild(mobileCss);
}

// Оперативный слой сайта: официальная шапка, московское время,
// обратный отсчёт до звонка, свежесть публикации, оповещения и отметка просмотра.
if (!/\/tv\.html$/i.test(location.pathname)) {
  window.addEventListener('load', () => {
    if (!document.querySelector('script[data-school-enhancements]')) {
      const script = document.createElement('script');
      script.src = 'site-enhancements.js?v=ui-20260914b';
      script.dataset.schoolEnhancements = '1';
      document.body.appendChild(script);
    }
    if (!document.querySelector('script[data-school-polish]')) {
      const polish = document.createElement('script');
      polish.src = 'site-polish.js?v=ui-20260914b';
      polish.dataset.schoolPolish = '1';
      document.body.appendChild(polish);
    }
    if (/\/staff\.html$/i.test(location.pathname) && !document.querySelector('script[data-mobile-ui]')) {
      const mobile = document.createElement('script');
      mobile.src = 'mobile-ui.js?v=mobile-20260915';
      mobile.dataset.mobileUi = '1';
      document.body.appendChild(mobile);
    }
  });
}
