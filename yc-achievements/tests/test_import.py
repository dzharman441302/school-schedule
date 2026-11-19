"""Импорт старого реестра: строки с ошибками пропускаются с номером и причиной, без ФИО. ФИО вымышленные."""
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

import import_registry as imp  # noqa: E402
from achievements import config  # noqa: E402

HEAD = ['№', 'Дата', 'Мероприятие', 'Направление', 'Уровень', 'Форма', 'Предмет / номинация', 'Класс', 'ФИО ученика',
        'Результат', 'Руководитель', 'Подтверждение', 'Согласие на публикацию', 'Проверено', 'Комментарий']
STAFF = [{'id': 's1', 'short_name': 'Учителева А.А.'}, {'id': 's2', 'short_name': 'Пёстрова Б.Б.'}]
NOW = datetime(2026, 11, 19, 12).timestamp()


def row(n, **over):
    base = {'Дата': datetime(2026, 10, 5), 'Мероприятие': 'Школьный этап ВсОШ по физике', 'Направление': 'Предметная олимпиада',
            'Уровень': 'Школьный', 'Форма': 'Очно', 'Предмет / номинация': 'Физика', 'Класс': '9А', 'ФИО ученика': 'Тестов Пётр Иванович',
            'Результат': 'Победитель', 'Руководитель': 'Учителева А. А.', 'Подтверждение': '', 'Согласие на публикацию': 'Да',
            'Проверено': 'Да', 'Комментарий': ''}
    base.update(over)
    return tuple([n] + [base[h] for h in HEAD[1:]])


ROWS = [
    tuple(HEAD),
    row(1),
    row(2, **{'ФИО ученика': 'Примерова Анна', 'Проверено': 'Нет', 'Согласие на публикацию': 'нет', 'Дата': '12.10.2026',
              'Руководитель': 'Пестрова Б.Б.', 'Класс': '9а', 'Подтверждение': 'https://disk.example/diploma'}),
    row(3, **{'Руководитель': 'Неизвестный Х.Х.'}),
    row(4, **{'Дата': 'вчера', 'Уровень': 'Галактический', 'ФИО ученика': 'Ivanov'}),
    row(5),  # повтор строки 2 файла (строка 1 данных)
    tuple([None] * len(HEAD)),
    row(7, **{'Класс': '12Б', 'Результат': 'Чемпион'}),
]


def test_convert_maps_supervisors_status_and_skips_bad_rows():
    records, skipped, stats = imp.convert(ROWS, STAFF, config.DEFAULT_CLASSES, author_id='', now=NOW)
    assert len(records) == 2
    first, second = records
    assert first['status'] == 'checked' and first['checked_at'] == NOW and first['consent'] is True
    assert first['supervisor_id'] == 's1' and first['author_id'] == 's1' and first['event_date'] == '2026-10-05'
    assert second['status'] == 'new' and second['checker_id'] is None and second['consent'] is False
    assert second['supervisor_id'] == 's2', 'ё и пробелы в кратком ФИО не мешают'
    assert second['class_name'] == '9А' and second['event_date'] == '2026-10-12'
    assert stats['proof'] == 1
    reasons = dict(skipped)
    assert reasons[4] == 'руководитель не найден в staff'
    assert 'дата не распознана' in reasons[5] and 'уровень не из справочника' in reasons[5] and 'ФИО ученика' in reasons[5]
    assert reasons[6] == 'уже есть в базе или повтор в файле'
    assert 'класс не из списка' in reasons[8] and 'результат не из справочника' in reasons[8]
    assert 7 not in reasons, 'пустая строка просто пропускается'


def test_report_has_row_numbers_but_no_names():
    records, skipped, stats = imp.convert(ROWS, STAFF, config.DEFAULT_CLASSES, author_id='', now=NOW)
    text = imp.report(records, skipped, stats)
    assert 'строка 4: руководитель не найден' in text
    for name in ('Тестов', 'Примерова', 'Ivanov', 'Неизвестный'):
        assert name not in text


def test_rerun_does_not_duplicate():
    records, _, _ = imp.convert(ROWS, STAFF, config.DEFAULT_CLASSES, author_id='', now=NOW)
    existing = {(r['event_name'].lower(), r['event_date'], r['student_name'].lower(), r['class_name']) for r in records}
    again, skipped, _ = imp.convert(ROWS, STAFF, config.DEFAULT_CLASSES, author_id='', now=NOW, existing=existing)
    assert again == [] and dict(skipped)[2] == 'уже есть в базе или повтор в файле'


def test_author_and_checker_when_given():
    records, _, _ = imp.convert(ROWS, STAFF, config.DEFAULT_CLASSES, author_id='adm', now=NOW)
    assert records[0]['author_id'] == 'adm' and records[0]['checker_id'] == 'adm'
    assert records[1]['checker_id'] is None


def test_missing_columns_reported():
    records, skipped, _ = imp.convert([('Дата', 'Мероприятие')], STAFF, config.DEFAULT_CLASSES, author_id='', now=NOW)
    assert records == [] and 'нет столбцов' in skipped[0][1]


def test_read_sheet_from_real_xlsx(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Достижения'
    for r in ROWS:
        ws.append(list(r))
    path = tmp_path / 'Реестр достижений учащихся.xlsx'
    wb.save(path)
    rows = imp.read_sheet(path)
    records, skipped, _ = imp.convert(rows, STAFF, config.DEFAULT_CLASSES, author_id='', now=NOW)
    assert len(records) == 2 and len(skipped) == 4
