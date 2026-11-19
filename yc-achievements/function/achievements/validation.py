"""Проверка формы «Внести достижение» и разбиение её на записи (по строке на ученика)."""
from __future__ import annotations

import re
from datetime import date

from . import config

NAME_WORD = re.compile(r'^[А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)?$')
ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


class ValidationError(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__('validation')
        self.errors = errors


def school_year_start(d: date) -> int:
    """Учебный год начинается 1 сентября: 15.10.2026 → 2026, 15.03.2027 → 2026."""
    return d.year if d.month >= 9 else d.year - 1


def school_year_range(start_year: int) -> tuple[str, str]:
    return f'{start_year}-09-01', f'{start_year + 1}-08-31'


def clean_text(value, max_len: int) -> str:
    return ' '.join(str(value if value is not None else '').split())[:max_len + 1]


def normalize_student_name(value) -> str:
    return ' '.join(str(value or '').replace(' ', ' ').split())


def student_name_error(name: str) -> str | None:
    if not name:
        return 'Укажите ФИО ученика'
    if len(name) > 60:
        return 'ФИО длиннее 60 символов'
    words = name.split(' ')
    if not 2 <= len(words) <= 3:
        return 'ФИО: 2–3 слова (фамилия, имя, отчество)'
    if not all(NAME_WORD.match(w) for w in words):
        return 'ФИО пишется кириллицей'
    return None


def parse_event_date(value, today: date) -> tuple[str | None, str | None]:
    s = str(value or '').strip()
    if not ISO_DATE.match(s):
        return None, 'Укажите дату'
    try:
        d = date.fromisoformat(s)
    except ValueError:
        return None, 'Неверная дата'
    y = school_year_start(today)
    if not date(y - 1, 9, 1) <= d <= date(y + 2, 8, 31):
        return None, 'Дата вне прошлого, текущего и следующего учебного года'
    return s, None


def validate_event(data: dict, today: date, staff_ids: set[str]) -> dict:
    """Общие поля мероприятия. Возвращает очищенный словарь или бросает ValidationError."""
    errors: list[dict] = []
    out: dict = {}

    def err(field: str, message: str):
        errors.append({'field': field, 'message': message})

    name = clean_text(data.get('event_name'), 200)
    if not name:
        err('event_name', 'Укажите мероприятие')
    elif len(name) > 200:
        err('event_name', 'Название длиннее 200 символов')
    out['event_name'] = name[:200]

    contest_id = clean_text(data.get('contest_id'), 64)
    out['contest_id'] = contest_id[:64] or None

    for key, allowed, label in (('direction', config.DIRECTIONS, 'направление'),
                                ('level', config.LEVELS, 'уровень'),
                                ('form', config.FORMS, 'форму')):
        v = clean_text(data.get(key), 60)
        if v not in allowed:
            err(key, f'Выберите {label} из списка')
        out[key] = v

    subject = clean_text(data.get('subject'), 120)
    if len(subject) > 120:
        err('subject', 'Предмет / номинация длиннее 120 символов')
    out['subject'] = subject[:120]

    d, message = parse_event_date(data.get('event_date'), today)
    if message:
        err('event_date', message)
    out['event_date'] = d

    supervisor = str(data.get('supervisor_id') or '').strip()
    if supervisor and supervisor not in staff_ids:
        err('supervisor_id', 'Руководитель не найден')
    out['supervisor_id'] = supervisor or None

    if errors:
        raise ValidationError(errors)
    return out


def validate_student(row: dict, index: int, classes: list[str]) -> tuple[dict, list[dict]]:
    errors = []
    name = normalize_student_name(row.get('student_name'))
    message = student_name_error(name)
    if message:
        errors.append({'row': index, 'field': 'student_name', 'message': message})
    class_name = str(row.get('class_name') or '').strip().upper()
    if class_name not in classes:
        errors.append({'row': index, 'field': 'class_name', 'message': 'Выберите класс из списка'})
    result = str(row.get('result') or '').strip()
    if result not in config.RESULTS:
        errors.append({'row': index, 'field': 'result', 'message': 'Выберите результат из списка'})
    consent = row.get('consent')
    if not isinstance(consent, bool):
        errors.append({'row': index, 'field': 'consent', 'message': 'Отметьте согласие (да или нет)'})
    return {'student_name': name, 'class_name': class_name, 'result': result, 'consent': consent is True}, errors


def split_form(data: dict, today: date, staff_ids: set[str], classes: list[str]) -> tuple[dict, list[dict]]:
    """Форма = одно мероприятие + список учеников → общие поля и строки учеников."""
    errors: list[dict] = []
    try:
        event = validate_event(data, today, staff_ids)
    except ValidationError as e:
        event, errors = {}, list(e.errors)
    students = data.get('students')
    if not isinstance(students, list) or not students:
        errors.append({'field': 'students', 'message': 'Добавьте хотя бы одного ученика'})
        students = []
    elif len(students) > config.MAX_STUDENTS_PER_FORM:
        errors.append({'field': 'students', 'message': f'Не больше {config.MAX_STUDENTS_PER_FORM} учеников за раз'})
        students = []
    rows = []
    for i, row in enumerate(students):
        if not isinstance(row, dict):
            errors.append({'row': i, 'field': 'students', 'message': 'Неверная строка'})
            continue
        clean, row_errors = validate_student(row, i, classes)
        errors.extend(row_errors)
        rows.append(clean)
    if errors:
        raise ValidationError(errors)
    return event, rows
