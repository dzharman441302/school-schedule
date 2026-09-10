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

// QR-коды удалены. Общий модуль добавляет только полезный оперативный слой:
// московское время, обратный отсчёт до звонка, свежесть публикации,
// оповещения и отметку просмотра учительской страницы.
if (!/\/tv\.html$/i.test(location.pathname)) {
  window.addEventListener('load', () => {
    if (document.querySelector('script[data-school-enhancements]')) return;
    const script = document.createElement('script');
    script.src = 'site-enhancements.js?v=mgmt-47';
    script.dataset.schoolEnhancements = '1';
    document.body.appendChild(script);
  });
}
