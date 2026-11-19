"""Реестр достижений в xlsx: лист «Достижения» (листы «Сводка» и «Обновлено» — этап 3)."""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

COLUMNS = [
    ('№', 6), ('Дата', 12), ('Мероприятие', 40), ('Направление', 22), ('Уровень', 16), ('Форма', 14),
    ('Предмет/номинация', 22), ('Класс', 8), ('ФИО ученика', 30), ('Результат', 14), ('Руководитель', 20),
    ('Диплом', 10), ('Согласие', 10), ('Проверено', 13), ('Комментарий проверяющего', 36),
]
STATUS_LABEL = {'checked': 'Да', 'new': 'Нет', 'returned': 'Возвращено'}


def ru_date(iso: str | None) -> str:
    if not iso:
        return ''
    y, m, d = iso.split('-')
    return f'{d}.{m}.{y}'


def registry_rows(records: list[dict], staff_names: dict[str, str]) -> list[list]:
    ordered = sorted(records, key=lambda r: (r['event_date'] or '', r['event_name'] or '', r['class_name'] or '', r['student_name'] or ''))
    return [[
        i, ru_date(r['event_date']), r['event_name'], r['direction'], r['level'], r['form'], r['subject'] or '',
        r['class_name'], r['student_name'], r['result'], staff_names.get(r['supervisor_id'] or '', ''),
        'есть' if r.get('diploma_key') else 'нет', 'да' if r.get('consent') else 'нет',
        STATUS_LABEL.get(r['status'], ''), r.get('return_comment') or '',
    ] for i, r in enumerate(ordered, 1)]


def build_registry(records: list[dict], staff_names: dict[str, str]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = 'Достижения'
    ws.append([c for c, _ in COLUMNS])
    for row in registry_rows(records, staff_names):
        ws.append(row)
    head_fill = PatternFill('solid', fgColor='DCE6F1')
    for i, (_, width) in enumerate(COLUMNS, 1):
        cell = ws.cell(row=1, column=i)
        cell.font = Font(bold=True)
        cell.fill = head_fill
        cell.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[cell.column_letter].width = width
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
