"""Одноразовый перенос старого «Реестра достижений учащихся.xlsx» в базу.

    python tools/import_registry.py "C:\\...\\Реестр достижений учащихся.xlsx"          # проверка, ничего не пишет
    python tools/import_registry.py "C:\\...\\Реестр достижений учащихся.xlsx" --yes    # перенести

Файл скачивается вручную из Яндекс Документов и передаётся путём; в репозиторий его не кладём
(*.xlsx в .gitignore). Лист «Достижения», столбцы: №, Дата, Мероприятие, Направление, Уровень,
Форма, Предмет / номинация, Класс, ФИО ученика, Результат, Руководитель, Подтверждение,
Согласие на публикацию, Проверено, Комментарий.

Руководитель сопоставляется со staff по краткому ФИО («Иванова А.В.», пробелы и «ё» не важны).
«Проверено = Да» → проверено, остальное → на проверке. Файлы дипломов не переносятся
(ссылки из «Подтверждения» — только отметка в отчёте). Повторный запуск не создаёт дублей:
запись с тем же мероприятием, датой, учеником и классом пропускается.
Отчёт — только номера строк и причины, без ФИО.
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from collections import Counter
from datetime import date, datetime
from pathlib import Path

import _common  # noqa: F401  (путь к коду функции)
from achievements import config
from achievements.validation import normalize_student_name, student_name_error

HEADERS = {
    'date': ('дата',), 'event': ('мероприятие',), 'direction': ('направление',), 'level': ('уровень',),
    'form': ('форма',), 'subject': ('предмет / номинация', 'предмет/номинация', 'предмет'), 'class': ('класс',),
    'student': ('фио ученика', 'фио'), 'result': ('результат',), 'supervisor': ('руководитель',),
    'proof': ('подтверждение',), 'consent': ('согласие на публикацию', 'согласие'), 'checked': ('проверено',),
    'comment': ('комментарий', 'комментарий проверяющего'),
}
REQUIRED = ('date', 'event', 'direction', 'level', 'form', 'class', 'student', 'result', 'supervisor')


def norm_short(name: str) -> str:
    return ''.join(str(name or '').lower().replace('ё', 'е').split())


def yes(value) -> bool:
    return str(value or '').strip().lower() in ('да', 'yes', 'true', '1', '+', 'есть')


def parse_date(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value or '').strip()
    for fmt in ('%d.%m.%Y', '%d.%m.%y', '%Y-%m-%d'):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def header_map(row) -> dict[str, int]:
    names = [str(c or '').strip().lower() for c in row]
    found = {}
    for key, variants in HEADERS.items():
        for i, n in enumerate(names):
            if n in variants:
                found[key] = i
                break
    return found


def convert(rows: list[tuple], staff: list[dict], classes: list[str], *, author_id: str, now: float,
            existing: set[tuple] = frozenset()) -> tuple[list[dict], list[tuple[int, str]], Counter]:
    """Строки листа (первая — заголовок) → записи и пропуски [(номер строки Excel, причина)]."""
    if not rows:
        return [], [(1, 'пустой лист')], Counter()
    idx = header_map(rows[0])
    missing = [k for k in REQUIRED if k not in idx]
    if missing:
        return [], [(1, f'нет столбцов: {", ".join(missing)}')], Counter()
    by_short = {norm_short(s['short_name']): s['id'] for s in staff}
    today = date.fromtimestamp(now)
    records, skipped, stats, seen = [], [], Counter(), set(existing)
    for n, row in enumerate(rows[1:], start=2):
        cell = lambda k: (row[idx[k]] if k in idx and idx[k] < len(row) else None)
        text = lambda k, size=200: ' '.join(str(cell(k) or '').split())[:size]
        if not any(str(c or '').strip() for c in row):
            continue
        reasons = []
        d = parse_date(cell('date'))
        if not d:
            reasons.append('дата не распознана')
        elif not '2000-01-01' <= d <= date(today.year + 1, 12, 31).isoformat():
            reasons.append('дата вне допустимого диапазона')
        event = text('event')
        if not event:
            reasons.append('нет мероприятия')
        direction, level, form, result = text('direction'), text('level'), text('form'), text('result')
        if direction not in config.DIRECTIONS:
            reasons.append('направление не из справочника')
        if level not in config.LEVELS:
            reasons.append('уровень не из справочника')
        if form not in config.FORMS:
            reasons.append('форма не из справочника')
        if result not in config.RESULTS:
            reasons.append('результат не из справочника')
        class_name = text('class', 10).upper().replace(' ', '')
        if class_name not in classes:
            reasons.append('класс не из списка')
        student = normalize_student_name(cell('student'))
        if student_name_error(student):
            reasons.append('ФИО ученика: ' + student_name_error(student).lower())
        supervisor = by_short.get(norm_short(cell('supervisor')))
        if not supervisor:
            reasons.append('руководитель не найден в staff')
        if reasons:
            skipped.append((n, '; '.join(reasons)))
            continue
        key = (event.lower(), d, student.lower(), class_name)
        if key in seen:
            skipped.append((n, 'уже есть в базе или повтор в файле'))
            continue
        seen.add(key)
        checked = yes(cell('checked'))
        if str(cell('proof') or '').strip():
            stats['proof'] += 1
        stats['checked' if checked else 'new'] += 1
        records.append({
            'id': uuid.uuid4().hex, 'created_at': now, 'updated_at': now, 'author_id': author_id or supervisor,
            'event_name': event, 'contest_id': None, 'direction': direction, 'level': level, 'form': form,
            'subject': text('subject', 120), 'event_date': d, 'class_name': class_name, 'student_name': student,
            'result': result, 'supervisor_id': supervisor, 'diploma_key': None, 'consent': yes(cell('consent')),
            'status': 'checked' if checked else 'new', 'checker_id': (author_id or None) if checked else None,
            'checked_at': now if checked else None, 'return_comment': None, 'deleted': False,
        })
    return records, skipped, stats


def existing_keys(repo) -> set[tuple]:
    rows = repo.list_records('2000-01-01', '2100-12-31', include_deleted=True)
    return {((r['event_name'] or '').lower(), r['event_date'], (r['student_name'] or '').lower(), r['class_name']) for r in rows}


def read_sheet(path: Path) -> list[tuple]:
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    if 'Достижения' not in wb.sheetnames:
        sys.exit(f'В файле нет листа «Достижения» (есть: {", ".join(wb.sheetnames)})')
    return [tuple(r) for r in wb['Достижения'].iter_rows(values_only=True)]


def report(records: list[dict], skipped: list[tuple[int, str]], stats: Counter) -> str:
    lines = [f'Можно перенести: {len(records)} (проверено: {stats["checked"]}, на проверку: {stats["new"]})',
             f'Пропущено: {len(skipped)}']
    lines += [f'  строка {n}: {why}' for n, why in skipped]
    if stats['proof']:
        lines.append(f'В «Подтверждении» указано у {stats["proof"]} записей — файлы дипломов не переносятся, их можно добавить в «Моих записях».')
    return '\n'.join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('xlsx', type=Path)
    p.add_argument('--yes', action='store_true', help='записать в базу')
    p.add_argument('--author', default='', help='краткое ФИО того, кто переносит (по умолчанию автор = руководитель)')
    a = p.parse_args()
    rows = read_sheet(a.xlsx)
    repo = _common.connect()
    staff = repo.list_staff()
    author_id = ''
    if a.author:
        match = [s['id'] for s in staff if norm_short(s['short_name']) == norm_short(a.author)]
        if not match:
            sys.exit('--author не найден в staff')
        author_id = match[0]
    classes = config.Settings.from_env().classes
    records, skipped, stats = convert(rows, staff, classes, author_id=author_id, now=time.time(), existing=existing_keys(repo))
    print(report(records, skipped, stats))
    if not a.yes:
        print('Проверка — в базу ничего не записано. Чтобы перенести, добавьте --yes.')
        return
    for start in range(0, len(records), 200):
        repo.insert_records(records[start:start + 200])
    print(f'Перенесено: {len(records)}.')


if __name__ == '__main__':
    main()
