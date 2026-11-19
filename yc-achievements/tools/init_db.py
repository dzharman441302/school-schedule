"""Создаёт таблицы YDB по schema/schema.yql. Повторный запуск безопасен.

    python tools/init_db.py
"""
import re

from _common import ROOT, connect


def statements(text: str) -> list[str]:
    text = re.sub(r'--[^\n]*', '', text)
    return [s.strip() for s in text.split(';') if s.strip()]


def main():
    repo = connect()
    for sql in statements((ROOT / 'schema' / 'schema.yql').read_text(encoding='utf-8')):
        repo.pool.execute_with_retries(sql + ';')
        print('OK:', sql.splitlines()[0])


if __name__ == '__main__':
    main()
