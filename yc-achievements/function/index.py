"""Точка входа Yandex Cloud Function: index.handler."""
import os

from achievements.api import App
from achievements.config import Settings
from achievements.s3 import Storage

_app = None


def _build_app() -> App:
    from achievements.ydb_repo import YdbRepo

    settings = Settings.from_env()
    repo = YdbRepo.connect(os.environ['YDB_ENDPOINT'], os.environ['YDB_DATABASE'])
    storage = Storage(settings.bucket, settings.s3_access_key, settings.s3_secret_key, settings.s3_host)
    return App(repo, settings, storage=storage)


def handler(event, context):
    global _app
    if _app is None:  # соединение с YDB живёт между вызовами одного экземпляра функции
        _app = _build_app()
    return _app.handle_event(event)
