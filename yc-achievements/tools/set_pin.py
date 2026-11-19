"""Выдаёт PIN педагогу напрямую в базе — для первого администратора (дальше PIN выдаются в кабинете).

    python tools/set_pin.py "Фамилия И.О." [--role admin]

PIN печатается один раз; в базе хранится только хэш.
"""
import argparse
import sys
import time

from _common import connect
from achievements import auth
from achievements.config import ROLES


def main():
    p = argparse.ArgumentParser()
    p.add_argument('short_name')
    p.add_argument('--role', choices=ROLES)
    a = p.parse_args()
    repo = connect()
    matches = [s for s in repo.list_staff() if s['short_name'] == ' '.join(a.short_name.split())]
    if len(matches) != 1:
        sys.exit('Педагог не найден — проверьте краткое ФИО как в staff.csv (например «Иванова А.В.»).')
    staff = matches[0]
    pin = auth.generate_pin()
    staff.update(pin_hash=auth.hash_pin(pin), pin_set_at=time.time(), active=True)
    if a.role:
        staff['role'] = a.role
    repo.upsert_staff(staff)
    repo.put_limit({'key': f"staff:{staff['id']}", 'count': 0, 'window_start': 0.0, 'locked_until': 0.0})
    print(f"{staff['short_name']} ({staff['role']}): PIN {pin}")
    print('Запишите PIN и передайте лично. Повторно его не показать — только выдать новый.')


if __name__ == '__main__':
    main()
