"""Удаляет записи (и файлы дипломов) старше N учебных лет — по решению школы.

    python tools/purge_old.py --years 3            # только показать, сколько будет удалено
    python tools/purge_old.py --years 3 --yes      # удалить

Граница: 1 сентября учебного года, начавшегося N лет назад. При --years 3 в ноябре 2026
удаляются записи с датой мероприятия раньше 01.09.2023. Удаление необратимо.
Для удаления дипломов нужны S3_ACCESS_KEY, S3_SECRET_KEY, DIPLOMA_BUCKET (ключ сервисного аккаунта).
"""
import argparse
import os
import sys
from datetime import date

from _common import connect
from achievements.s3 import Storage
from achievements.validation import school_year_start


def cutoff(years: int, today: date) -> str:
    return f'{school_year_start(today) - years}-09-01'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--years', type=int, required=True)
    p.add_argument('--yes', action='store_true')
    a = p.parse_args()
    if a.years < 1:
        sys.exit('--years должно быть не меньше 1')
    border = cutoff(a.years, date.today())
    repo = connect()
    old = repo.records_before(border)
    diplomas = [r['diploma_key'] for r in old if r['diploma_key']]
    print(f'Мероприятия до {border}: записей {len(old)}, дипломов {len(diplomas)}')
    if not a.yes:
        print('Пробный запуск. Чтобы удалить, добавьте --yes.')
        return
    if diplomas:
        storage = Storage(os.environ.get('DIPLOMA_BUCKET', ''), os.environ.get('S3_ACCESS_KEY', ''),
                          os.environ.get('S3_SECRET_KEY', ''))
        if not storage.configured:
            sys.exit('Нет ключей S3 — дипломы не удалить, записи не тронуты.')
        failed = sum(1 for key in diplomas if not storage.delete(key))
        if failed:
            sys.exit(f'Не удалось удалить файлов: {failed}. Записи не тронуты, повторите позже.')
    repo.delete_records([r['id'] for r in old])
    print('Удалено.')


if __name__ == '__main__':
    main()
