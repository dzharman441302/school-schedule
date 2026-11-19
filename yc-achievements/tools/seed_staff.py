"""Загружает педагогов из CSV (short_name,full_name,position,role) в таблицу staff.

    python tools/seed_staff.py seed/staff.csv [--dry-run] [--update-roles]

Существующие педагоги находятся по краткому ФИО: у них обновляются полное ФИО и должность,
роль — только с --update-roles, PIN не трогается. Новые получают id и роль из файла, без PIN.
Педагоги, которых нет в файле, не удаляются (отключить — в кабинете администратора).
"""
import argparse
import csv
import sys
import uuid
from pathlib import Path

import _common  # noqa: F401  (добавляет путь к коду функции)
from achievements.config import ROLES


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    need = {'short_name', 'full_name', 'position', 'role'}
    if not rows or not need <= set(rows[0]):
        sys.exit(f'В файле нужны столбцы: {", ".join(sorted(need))}')
    out, seen = [], set()
    for n, r in enumerate(rows, 2):
        short = ' '.join((r['short_name'] or '').split())
        role = (r['role'] or 'teacher').strip() or 'teacher'
        if not short:
            sys.exit(f'Строка {n}: пустое краткое ФИО')
        if short in seen:
            sys.exit(f'Строка {n}: повтор краткого ФИО')
        if role not in ROLES:
            sys.exit(f'Строка {n}: роль должна быть одной из {", ".join(ROLES)}')
        seen.add(short)
        out.append({'short_name': short, 'full_name': ' '.join((r['full_name'] or '').split()),
                    'position': (r['position'] or '').strip(), 'role': role})
    return out


def merge(existing: list[dict], rows: list[dict], update_roles: bool) -> tuple[list[dict], int, int]:
    by_short = {s['short_name']: s for s in existing}
    result, added, updated = [], 0, 0
    for r in rows:
        s = by_short.get(r['short_name'])
        if s:
            s = dict(s, full_name=r['full_name'], position=r['position'])
            if update_roles:
                s['role'] = r['role']
            updated += 1
        else:
            s = {'id': uuid.uuid4().hex[:12], **r, 'pin_hash': None, 'pin_set_at': None, 'active': True}
            added += 1
        result.append(s)
    return result, added, updated


def main():
    p = argparse.ArgumentParser()
    p.add_argument('csv', type=Path)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--update-roles', action='store_true')
    a = p.parse_args()
    rows = read_csv(a.csv)
    repo = _common.connect()
    items, added, updated = merge(repo.list_staff(), rows, a.update_roles)
    no_position = sum(1 for r in rows if not r['position'])
    print(f'В файле: {len(rows)}; новых: {added}; обновить: {updated}; без должности: {no_position}')
    if a.dry_run:
        print('Пробный запуск — в базу ничего не записано.')
        return
    for s in items:
        repo.upsert_staff(s)
    print('Готово.')


if __name__ == '__main__':
    main()
