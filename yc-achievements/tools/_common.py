"""Общее для скриптов: путь к коду функции и подключение к YDB с компьютера администратора.

Нужны переменные окружения:
  YDB_ENDPOINT   — grpcs://ydb.serverless.yandexcloud.net:2135
  YDB_DATABASE   — /ru-central1/<cloud>/<db>
  YDB_ACCESS_TOKEN_CREDENTIALS — IAM-токен: `yc iam create-token`
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'function'))


def connect():
    import ydb
    from achievements.ydb_repo import YdbRepo

    missing = [k for k in ('YDB_ENDPOINT', 'YDB_DATABASE') if not os.environ.get(k)]
    if missing:
        sys.exit(f'Не заданы переменные окружения: {", ".join(missing)} (см. README, раздел «Развёртывание»)')
    return YdbRepo.connect(os.environ['YDB_ENDPOINT'], os.environ['YDB_DATABASE'],
                           credentials=ydb.credentials_from_env_variables())
