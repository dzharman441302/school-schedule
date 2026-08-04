window.SCHOOL_CONFIG = Object.freeze({
  school: {
    shortName: 'МОУ СОШ № 20',
    fullName: 'МОУ СОШ № 20 г. Твери',
    city: 'Тверь'
  },

  timeZone: 'Europe/Moscow',
  changesUpdateTime: '15:00',

  links: {
    // Кнопка «Связаться со школой». Замените адрес на личную ссылку ответственного сотрудника.
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

      // Новый расширенный лист. Если его нет, сайт автоматически использует «Объявления».
      news: 'Новости',
      announcements: 'Объявления',

      important: 'Важное',
      documents: 'Документы',
      opportunities: 'Возможности'
    }
  },

  classes: [
    '5А', '5Б', '5И', '5К',
    '6А', '6Б', '6В',
    '7А', '7Б', '7В', '7Г',
    '8А', '8Б', '8В', '8Г',
    '9А', '9Б', '9В',
    '10А', '11А'
  ],

  vector20: {
    coordinator: '',
    contactEmail: '',
    applicationUrl: ''
  }
});
