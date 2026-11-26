"""Каталог конкурсов и участники заявок, отдельно от результатов достижений."""
from collections import Counter
from datetime import date
from urllib.parse import urlsplit

from . import config
from .validation import (ValidationError, normalize_student_name, parse_event_date, school_year_start,
                         student_name_error, validate_event)


def _https_url(url):
    if not url or len(url) > 1000 or any(ch.isspace() or ord(ch) < 32 for ch in url) or '\\' in url:
        return False
    try:
        parts = urlsplit(url)
        return parts.scheme == 'https' and bool(parts.hostname) and parts.username is None
    except ValueError:
        return False


def validate_competition(data, today, school_classes):
    errors = []
    deadline, message = parse_event_date(data.get('deadline'), today)
    if message:
        errors.append({'field': 'deadline', 'message': message})
    event_date = data.get('event_date') or None
    try:
        event = validate_event({**data, 'event_name': data.get('name'), 'event_date': event_date or today.isoformat(),
                                'supervisor_id': None}, today, set())
    except ValidationError as exc:
        errors.extend({**e, 'field': 'name' if e['field'] == 'event_name' else e['field']} for e in exc.errors)
        event = {}
    if event_date and deadline and event and deadline > event['event_date']:
        errors.append({'field': 'deadline', 'message': 'Приём заявок должен завершиться до даты проведения или в этот день'})

    regulation_url = data.get('regulation_url')
    regulation_url = regulation_url.strip() if isinstance(regulation_url, str) else ''
    if not _https_url(regulation_url):
        errors.append({'field': 'regulation_url', 'message': 'Укажите ссылку на положение, начинающуюся с https://'})
    audience, required, status = (data.get(key) for key in ('audience', 'required', 'status'))
    if audience not in ('students', 'staff'):
        errors.append({'field': 'audience', 'message': 'Выберите, кто может участвовать'})
    if not isinstance(required, bool):
        errors.append({'field': 'required', 'message': 'Укажите обязательность участия'})
    if status not in ('draft', 'published', 'closed'):
        errors.append({'field': 'status', 'message': 'Неверный статус конкурса'})

    classes = data.get('classes')
    if not isinstance(classes, list) or any(not isinstance(c, str) for c in classes):
        errors.append({'field': 'classes', 'message': 'Укажите классы из списка'})
        classes = []
    selected = {c.strip().upper() for c in classes}
    if audience == 'students' and (not selected or selected.difference(school_classes)):
        errors.append({'field': 'classes', 'message': 'Выберите хотя бы один класс из списка школы'})
    if errors:
        raise ValidationError(errors)

    event_date = event['event_date'] if event_date else None
    return {
        'name': event['event_name'], 'direction': event['direction'], 'level': event['level'], 'form': event['form'],
        'subject': event['subject'], 'event_date': event_date, 'deadline': deadline,
        'school_year': school_year_start(date.fromisoformat(event_date or deadline)),
        'regulation_url': regulation_url, 'audience': audience, 'required': required, 'status': status,
        'classes': [c for c in school_classes if c in selected] if audience == 'students' else [],
    }


def registration_open(contest, today):
    return contest['status'] == 'published' and today.isoformat() <= contest['deadline']


def scope_changes(previous, contest):
    return bool(previous and (previous['audience'] != contest['audience']
                              or set(previous['classes']).difference(contest['classes'])))


def applications_fit(previous, contest, applications):
    if previous['audience'] != contest['audience']:
        return not applications
    allowed = set(contest['classes'])
    return all(student['class_name'] in allowed for app in applications if app['status'] != 'returned'
               for student in app['students'])


def participant_key(student):
    return student['student_name'].casefold().replace('ё', 'е'), student['class_name']


def validate_participants(rows, contest, staff):
    if contest['audience'] == 'staff':
        return [{'student_name': staff['full_name'] or staff['short_name'], 'class_name': ''}]
    if not isinstance(rows, list) or not 1 <= len(rows) <= config.MAX_STUDENTS_PER_FORM:
        raise ValidationError([{'field': 'students', 'message': f'Укажите от 1 до {config.MAX_STUDENTS_PER_FORM} участников'}])
    allowed = set(contest['classes'])
    errors, clean, seen = [], [], set()
    for index, raw in enumerate(rows):
        row = raw if isinstance(raw, dict) else {}
        name = normalize_student_name(row.get('student_name'))
        class_name = str(row.get('class_name') or '').strip().upper()
        student = {'student_name': name, 'class_name': class_name}
        key = participant_key(student)
        message = student_name_error(name)
        if message or key in seen:
            errors.append({'row': index, 'field': 'student_name', 'message': message or 'Этот участник уже указан в заявке'})
        if class_name not in allowed:
            errors.append({'row': index, 'field': 'class_name', 'message': 'Этот класс не участвует в конкурсе'})
        seen.add(key)
        clean.append(student)
    if errors:
        raise ValidationError(errors)
    return clean


def possible_duplicates(applications):
    counts = Counter(participant_key(student) for app in applications if app['status'] != 'returned'
                     for student in app['students'])
    return {key for key, count in counts.items() if count > 1}
