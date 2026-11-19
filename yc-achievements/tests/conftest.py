import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'function'))

from achievements import auth, config  # noqa: E402
from achievements.api import App  # noqa: E402
from achievements.contests import ContestsCache  # noqa: E402
from achievements.repo import MemoryRepo  # noqa: E402
from achievements.s3 import Storage  # noqa: E402

ORIGIN = 'https://sosh20tver.ru'
# 19.11.2026 12:00 МСК
START = datetime(2026, 11, 19, 12, 0, tzinfo=config.MSK).timestamp()
PINS = {'t1': '274915', 't2': '583016', 'chk': '719342', 'adm': '846203'}
ROLES = {'t1': 'teacher', 't2': 'teacher', 'chk': 'checker', 'adm': 'admin'}
NAMES = {'t1': 'Учителева А.А.', 't2': 'Педагогов Б.Б.', 'chk': 'Проверкина В.В.', 'adm': 'Админов Г.Г.'}


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


class FakeStorage(Storage):
    def __init__(self):
        super().__init__('diplomas-test', 'AKTESTKEY', 'secret-test')
        self.deleted = []
        self.public = {}

    def put_public(self, bucket, key, data, content_type, cache_control, now):
        self.public[(bucket, key)] = {'data': data, 'content_type': content_type, 'cache_control': cache_control}

    def delete(self, key, now=None):
        self.deleted.append(key)
        return True


@pytest.fixture
def clock():
    return Clock(START)


@pytest.fixture
def repo():
    r = MemoryRepo()
    for sid, pin in PINS.items():
        r.upsert_staff({'id': sid, 'short_name': NAMES[sid], 'full_name': NAMES[sid], 'position': '',
                        'role': ROLES[sid], 'pin_hash': auth.hash_pin(pin), 'pin_set_at': START - 86400, 'active': True})
    r.upsert_staff({'id': 'nopin', 'short_name': 'Безпинова Д.Д.', 'full_name': '', 'position': '', 'role': 'teacher',
                    'pin_hash': None, 'pin_set_at': None, 'active': True})
    return r


@pytest.fixture
def storage():
    return FakeStorage()


@pytest.fixture
def app(repo, clock, storage):
    settings = config.Settings(token_secret='test-secret', public_bucket='pub-test', yadisk_token='disk-token')
    contests = ContestsCache('sheet', 'Конкурсы_сайт', clock=clock,
                             fetch=lambda *_: 'ID,Название,Направление,Уровень,Предмет\nc1,Олимпиада по математике,Предметная олимпиада,Муниципальный,Математика\n')
    return App(repo, settings, clock=clock, contests=contests, storage=storage)


class Client:
    def __init__(self, app):
        self.app = app
        self.tokens = {}

    def call(self, method, path, body=None, who=None, query=None, origin=ORIGIN, ip='10.0.0.1'):
        headers = {'Origin': origin}
        if who:
            headers['Authorization'] = f'Bearer {self.token(who)}'
        event = {'httpMethod': method, 'url': path, 'headers': headers, 'queryStringParameters': query or {},
                 'body': json.dumps(body, ensure_ascii=False) if body is not None else '',
                 'requestContext': {'identity': {'sourceIp': ip}}}
        resp = self.app.handle_event(event)
        if resp['isBase64Encoded']:
            return resp['statusCode'], resp['body'], resp['headers']
        return resp['statusCode'], json.loads(resp['body']) if resp['body'] else None, resp['headers']

    def token(self, who):
        if who not in self.tokens:
            status, data, _ = self.call('POST', '/login', {'staff_id': who, 'pin': PINS[who]}, ip=f'10.1.{len(self.tokens)}.1')
            assert status == 200, data
            self.tokens[who] = data['token']
        return self.tokens[who]


@pytest.fixture
def client(app):
    return Client(app)


def form(students=None, **over):
    data = {'event_name': 'Олимпиада по математике', 'contest_id': 'c1', 'direction': 'Предметная олимпиада',
            'level': 'Муниципальный', 'form': 'Очно', 'subject': 'Математика', 'event_date': '2026-11-10',
            'students': students if students is not None else [
                {'student_name': 'Иванов Пётр Сергеевич', 'class_name': '8Б', 'result': 'Призёр', 'consent': True},
                {'student_name': 'Петрова Анна', 'class_name': '8б', 'result': 'Участник', 'consent': False},
            ]}
    data.update(over)
    return data
