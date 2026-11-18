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
    vkCommunity: 'https://vk.ru/school_20_tver',
    maxBot: 'https://max.ru/se14285144_bot'
  },
  // Слайд «Сегодня» на ТВ: координаты для погоды (Тверь).
  today: { latitude: 56.86, longitude: 35.9 },
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
      calendar: 'Календарь',
      menuReplacements: 'Меню_замены',
      duty: 'Дежурство',
      dayEvents: 'События_сайт',
      dailyTask: 'Задача_дня',
      dailyTaskResults: 'Задача_дня_итоги',
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
  // Опоздания: classes of these grades study in the second shift; the rest in the first.
  // duty: the duty administrator of each shift, Monday to Friday (график дежурства администрации);
  // late.html signs the marks with the name of today's duty administrator of the shift.
  lateness: {
    secondShiftGrades: ['7', '8'],
    duty: {
      1: ['Козлова В. И.', 'Чуркина Т. Н.', 'Дятлов В. С.', 'Воронков М. Е.', 'Нагаева Е. С.'],
      2: ['Науменко Е. В.', 'Цветкова Н. Н.', 'Фатьянова Е. А.', 'Федотова И. А.', 'Новик Е. А.']
    }
  },
  vector20: { coordinator: '', contactEmail: '', applicationUrl: '' }
});
