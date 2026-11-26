"""Реестр достижений в xlsx: «Достижения», «Сводка», «Обновлено»; отчёт «По руководителям»."""
from __future__ import annotations

import io
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

from . import config
from .registration import participant_key, possible_duplicates

COLUMNS = [
    ('№', 6), ('Дата', 12), ('Мероприятие', 40), ('Направление', 22), ('Уровень', 16), ('Форма', 14),
    ('Предмет/номинация', 22), ('Класс', 8), ('ФИО ученика', 30), ('Результат', 14), ('Руководитель', 20),
    ('Диплом (есть/нет)', 10), ('Согласие', 10), ('Проверено (Да/Нет/Возвращено)', 15), ('Комментарий проверяющего', 36),
]
STATUS_LABEL = {'checked': 'Да', 'new': 'Нет', 'returned': 'Возвращено'}
AUTO_NOTE = 'Файл формируется автоматически, правки будут перезаписаны'
HEAD_FILL = PatternFill('solid', fgColor='DCE6F1')


def ru_date(iso: str | None) -> str:
    if not iso:
        return ''
    y, m, d = iso.split('-')
    return f'{d}.{m}.{y}'


def is_prize(result: str | None) -> bool:
    return result in config.PRIZE_RESULTS


def is_municipal_plus(level: str | None) -> bool:
    return level in config.LEVELS[config.LEVELS.index('Муниципальный'):]


def registry_rows(records: list[dict], staff_names: dict[str, str]) -> list[list]:
    ordered = sorted(records, key=lambda r: (r['event_date'] or '', r['event_name'] or '', r['class_name'] or '', r['student_name'] or ''))
    return [[
        i, ru_date(r['event_date']), r['event_name'], r['direction'], r['level'], r['form'], r['subject'] or '',
        r['class_name'], r['student_name'], r['result'], staff_names.get(r['supervisor_id'] or '', ''),
        'есть' if r.get('diploma_key') else 'нет', 'да' if r.get('consent') else 'нет',
        STATUS_LABEL.get(r['status'], ''), r.get('return_comment') or '',
    ] for i, r in enumerate(ordered, 1)]


def summary_by_level(records: list[dict]) -> list[list]:
    """Уровень | Записей | Победителей и призёров | Проверено — по всем записям года (кроме удалённых)."""
    rows = []
    for level in config.LEVELS:
        items = [r for r in records if r['level'] == level]
        rows.append([level, len(items), sum(is_prize(r['result']) for r in items), sum(r['status'] == 'checked' for r in items)])
    rows.append(['Итого', len(records), sum(is_prize(r['result']) for r in records), sum(r['status'] == 'checked' for r in records)])
    return rows


def summary_by_supervisor(records: list[dict], staff_names: dict[str, str]) -> list[list]:
    """Руководитель | Записей | Победителей и призёров | из них муниципального уровня и выше."""
    by: dict[str, list[dict]] = {}
    for r in records:
        by.setdefault(staff_names.get(r['supervisor_id'] or '', '') or '—', []).append(r)
    rows = []
    for name in sorted(by):
        items = by[name]
        prizes = [r for r in items if is_prize(r['result'])]
        rows.append([name, len(items), len(prizes), sum(is_municipal_plus(r['level']) for r in prizes)])
    return rows


def _head(ws, columns: list[tuple[str, int]], row: int = 1) -> None:
    for i, (title, width) in enumerate(columns, 1):
        cell = ws.cell(row=row, column=i, value=title)
        cell.font = Font(bold=True)
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(wrap_text=True, vertical='center')
        if width:
            ws.column_dimensions[cell.column_letter].width = width


def _bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_competition_export(contest, applications, names):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Участники'
    _head(ws, [('№', 6), ('ФИО участника', 34), ('Класс', 10), ('Педагог', 34), ('Возможный дубль', 20)])
    accepted = [app for app in applications if app['status'] == 'accepted']
    duplicates = possible_duplicates(accepted)
    entries = [(student, names.get(app['author_id'], '')) for app in accepted for student in app['students']]
    entries.sort(key=lambda entry: (entry[0]['class_name'], entry[0]['student_name'].casefold(), entry[1]))
    for i, (student, teacher) in enumerate(entries, 1):
        duplicate = 'Да' if participant_key(student) in duplicates else ''
        ws.append([i, student['student_name'], student['class_name'], teacher, duplicate])
        for cell in ws[ws.max_row][1:]:
            cell.data_type = 's'
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions

    info = wb.create_sheet('Конкурс')
    _head(info, [('Поле', 24), ('Значение', 62)])
    for label, value in [('Название', contest['name']), ('Дата проведения', ru_date(contest['event_date'])),
                         ('Приём заявок до', ru_date(contest['deadline'])), ('Положение', contest['regulation_url'])]:
        info.append([label, value])
        info.cell(info.max_row, 2).data_type = 's'
    return _bytes(wb)


def build_registry(records: list[dict], staff_names: dict[str, str], *, school_year: int | None = None,
                   updated_at: datetime | None = None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = 'Достижения'
    _head(ws, COLUMNS)
    for row in registry_rows(records, staff_names):
        ws.append(row)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions

    s = wb.create_sheet('Сводка')
    title = f'Учебный год {school_year}/{school_year + 1}' if school_year else 'Учебный год'
    s.append([title])
    s['A1'].font = Font(bold=True, size=13)
    s.append([])
    s.append(['По уровням'])
    s['A3'].font = Font(bold=True)
    _head(s, [('Уровень', 22), ('Записей', 12), ('Победителей и призёров', 16), ('Проверено', 14)], row=4)
    for row in summary_by_level(records):
        s.append(row)
    s.cell(row=s.max_row, column=1).font = Font(bold=True)
    s.append([])
    s.append(['По руководителям'])
    s.cell(row=s.max_row, column=1).font = Font(bold=True)
    _head(s, [('Руководитель', 22), ('Записей', 12), ('Победителей и призёров', 16), ('из них муниципального уровня и выше', 20)], row=s.max_row + 1)
    for row in summary_by_supervisor(records, staff_names):
        s.append(row)
    s.append([])
    s.append([f'Победители и призёры: {", ".join(config.PRIZE_RESULTS)}.'])

    u = wb.create_sheet('Обновлено')
    stamp = (updated_at or datetime.now(config.MSK)).astimezone(config.MSK)
    u.append(['Выгрузка', stamp.strftime('%d.%m.%Y %H:%M')])
    u.append([AUTO_NOTE])
    u['A2'].font = Font(bold=True, color='B91C1C')
    u.column_dimensions['A'].width = 60
    u.column_dimensions['B'].width = 20
    return _bytes(wb)


REPORT_COLUMNS = ['Руководитель', 'Записей', *[f'Призёров: {lvl.lower()}' for lvl in config.LEVELS], 'Призёров всего', 'Не проверено']


def supervisors_report(records: list[dict], staff_names: dict[str, str]) -> list[list]:
    """Для стимулирующих: призёры считаются только по проверенным записям; «Не проверено» — для сведения."""
    by: dict[str, list[dict]] = {}
    for r in records:
        by.setdefault(r['supervisor_id'] or '', []).append(r)
    rows = []
    for sid, items in by.items():
        checked = [r for r in items if r['status'] == 'checked']
        prizes = [r for r in checked if is_prize(r['result'])]
        rows.append([staff_names.get(sid, '') or '—', len(checked),
                     *[sum(r['level'] == lvl for r in prizes) for lvl in config.LEVELS],
                     len(prizes), len(items) - len(checked)])
    rows.sort(key=lambda x: (-x[-2], x[0]))
    return rows


def build_supervisors_report(rows: list[list], date_from: str, date_to: str) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = 'По руководителям'
    ws.append([f'Достижения учащихся по руководителям, {ru_date(date_from)} — {ru_date(date_to)} (только проверенные записи)'])
    ws['A1'].font = Font(bold=True, size=12)
    _head(ws, [(c, 24 if i == 0 else 13) for i, c in enumerate(REPORT_COLUMNS)], row=2)
    for row in rows:
        ws.append(row)
    ws.freeze_panes = 'B3'
    return _bytes(wb)
