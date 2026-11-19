from datetime import date

import pytest

from achievements import config
from achievements.validation import (ValidationError, parse_event_date, school_year_start, split_form,
                                     student_name_error)
from conftest import form

TODAY = date(2026, 11, 19)
STAFF = {'t1', 't2'}
CLASSES = config.DEFAULT_CLASSES


@pytest.mark.parametrize('name', ['Иванов Пётр', 'Иванов Пётр Сергеевич', 'Римская-Корсакова Алёна', 'ёлкин ёж'])
def test_good_student_names(name):
    assert student_name_error(name) is None


@pytest.mark.parametrize('name', ['', 'Иванов', 'Ivanov Petr', 'Иванов Пётр Сергеевич Младший', 'Иванов П.',
                                  'Иванов 2', 'А' * 30 + ' ' + 'Б' * 30])
def test_bad_student_names(name):
    assert student_name_error(name)


def test_name_of_exactly_60_chars_is_allowed():
    assert student_name_error('А' * 29 + ' ' + 'Б' * 30) is None


def test_school_year_starts_on_first_of_september():
    assert school_year_start(date(2026, 8, 31)) == 2025
    assert school_year_start(date(2026, 9, 1)) == 2026
    assert school_year_start(date(2027, 3, 15)) == 2026


def test_event_date_within_school_year_plus_minus_one():
    assert parse_event_date('2025-09-01', TODAY)[0] == '2025-09-01'
    assert parse_event_date('2028-08-31', TODAY)[0] == '2028-08-31'
    assert parse_event_date('2025-08-31', TODAY)[1]
    assert parse_event_date('2028-09-01', TODAY)[1]
    assert parse_event_date('10.11.2026', TODAY)[1]
    assert parse_event_date('2026-02-30', TODAY)[1]


def test_form_splits_into_one_row_per_student():
    event, rows = split_form(form(), TODAY, STAFF, CLASSES)
    assert event['event_name'] == 'Олимпиада по математике'
    assert event['supervisor_id'] is None
    assert [r['class_name'] for r in rows] == ['8Б', '8Б']
    assert [r['consent'] for r in rows] == [True, False]


def test_form_rejects_more_than_40_students():
    students = [{'student_name': 'Иванов Пётр', 'class_name': '5А', 'result': 'Участник', 'consent': False}] * 41
    with pytest.raises(ValidationError) as e:
        split_form(form(students), TODAY, STAFF, CLASSES)
    assert e.value.errors[0]['field'] == 'students'


def test_form_reports_bad_rows_with_index():
    students = [
        {'student_name': 'Иванов Пётр', 'class_name': '5А', 'result': 'Участник', 'consent': False},
        {'student_name': 'Ivanov', 'class_name': '12А', 'result': 'Чемпион', 'consent': 'да'},
    ]
    with pytest.raises(ValidationError) as e:
        split_form(form(students, level='Галактический', supervisor_id='nobody'), TODAY, STAFF, CLASSES)
    fields = {(x.get('row'), x['field']) for x in e.value.errors}
    assert {(1, 'student_name'), (1, 'class_name'), (1, 'result'), (1, 'consent'), (None, 'level'), (None, 'supervisor_id')} <= fields
    assert not any(x.get('row') == 0 for x in e.value.errors)


def test_form_requires_students_and_required_fields():
    with pytest.raises(ValidationError) as e:
        split_form({'students': []}, TODAY, STAFF, CLASSES)
    fields = {x['field'] for x in e.value.errors}
    assert {'event_name', 'direction', 'level', 'form', 'event_date', 'students'} <= fields


def test_primary_classes_are_in_config():
    assert '1А' in CLASSES and '4Г' in CLASSES and '11А' in CLASSES and '5Г' not in CLASSES
