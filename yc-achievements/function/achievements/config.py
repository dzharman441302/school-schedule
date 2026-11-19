"""Справочники и настройки «Достижений учащихся».

Справочники совпадают с реестром на Яндекс Диске. Классы можно переопределить
переменной окружения ACHIEVEMENTS_CLASSES (через запятую).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import timedelta, timezone

MSK = timezone(timedelta(hours=3))  # Москва без перехода на летнее время

DIRECTIONS = [
    'Предметная олимпиада', 'Конкурс', 'НПК / проект', 'Творчество', 'Спорт',
    'Воспитательное мероприятие', 'Акция / волонтёрство', 'Другое',
]
LEVELS = ['Школьный', 'Муниципальный', 'Региональный', 'Межрегиональный', 'Всероссийский', 'Международный']
FORMS = ['Очно', 'Дистанционно']
RESULTS = ['Участник', 'Призёр', 'Победитель', '1 место', '2 место', '3 место', 'Лауреат', 'Дипломант', 'Финалист']
# «Призёр и выше» — для сводки, ленты побед на сайте и отчёта по руководителям.
PRIZE_RESULTS = ['Победитель', 'Призёр', '1 место', '2 место', '3 место', 'Лауреат', 'Дипломант']
ROLES = ['teacher', 'checker', 'admin']
STATUSES = ['new', 'checked', 'returned']

DEFAULT_CLASSES = [
    *(f'{g}{l}' for g in '1234' for l in 'АБВГ'),
    '5А', '5Б', '5В', '5И', '6А', '6Б', '6И', '6К', '7А', '7Б', '7В',
    '8А', '8Б', '8В', '8Г', '9А', '9Б', '9В', '9Г', '10А', '11А',
]

MAX_STUDENTS_PER_FORM = 40
MAX_RECORDS_PER_DAY = 200
TOKEN_TTL = 12 * 3600
PIN_FAIL_LIMIT = 5
PIN_LOCK_SECONDS = 15 * 60
IP_WINDOW_SECONDS = 10 * 60
IP_MAX_LOGINS = 30
DIPLOMA_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf'}
DIPLOMA_MAX_BYTES = 10 * 1024 * 1024
DIPLOMA_GET_TTL = 300
DIPLOMA_PUT_TTL = 900
CONTESTS_CACHE_SECONDS = 30 * 60


def _list_env(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, '').strip()
    return [x.strip() for x in raw.split(',') if x.strip()] if raw else list(default)


@dataclass
class Settings:
    token_secret: str = ''
    allowed_origins: list[str] = field(default_factory=lambda: ['https://sosh20tver.ru', 'https://dzharman441302.github.io'])
    classes: list[str] = field(default_factory=lambda: list(DEFAULT_CLASSES))
    bucket: str = ''
    s3_access_key: str = ''
    s3_secret_key: str = ''
    s3_host: str = 'storage.yandexcloud.net'
    sheet_id: str = ''
    contests_sheet: str = 'Конкурсы_сайт'
    public_bucket: str = ''
    public_key: str = 'achievements.json'
    yadisk_token: str = ''
    yadisk_path: str = '/Школа/Достижения/Реестр достижений (выгрузка).xlsx'

    @classmethod
    def from_env(cls) -> 'Settings':
        env = os.environ.get
        return cls(
            token_secret=env('TOKEN_SECRET', ''),
            allowed_origins=_list_env('ALLOWED_ORIGINS', cls().allowed_origins),
            classes=_list_env('ACHIEVEMENTS_CLASSES', DEFAULT_CLASSES),
            bucket=env('DIPLOMA_BUCKET', ''),
            s3_access_key=env('S3_ACCESS_KEY', ''),
            s3_secret_key=env('S3_SECRET_KEY', ''),
            s3_host=env('S3_HOST', 'storage.yandexcloud.net'),
            sheet_id=env('SHEET_ID', ''),
            contests_sheet=env('CONTESTS_SHEET', 'Конкурсы_сайт'),
            public_bucket=env('PUBLIC_BUCKET', ''),
            public_key=env('PUBLIC_KEY', 'achievements.json'),
            yadisk_token=env('YADISK_TOKEN', ''),
            yadisk_path=env('YADISK_PATH', cls.yadisk_path),
        )
