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

      // Старые разделы оставлены в конфигурации для совместимости,
      // но больше не выводятся в навигации сайта.
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

  vector20: {
    coordinator: '',
    contactEmail: '',
    applicationUrl: ''
  }
});
