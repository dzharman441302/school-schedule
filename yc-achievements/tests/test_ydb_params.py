"""YdbRepo без сервера: параметры запросов должны превращаться в protobuf так же, как в настоящем SDK."""
from contextlib import contextmanager
from types import SimpleNamespace

from ydb import convert

from achievements.ydb_repo import TS, D, YdbRepo, _from_db, _to_db


class FakePool:
    def __init__(self):
        self.calls = []

    def execute_with_retries(self, query, parameters=None):
        convert.query_parameters_to_pb(parameters)  # упадёт, если тип и значение не сходятся
        self.calls.append((query, parameters))
        return []


def record(**over):
    r = {'id': 'r1', 'created_at': 1763540000.5, 'updated_at': 1763540000.5, 'author_id': 't1', 'event_name': 'Олимпиада',
         'contest_id': None, 'direction': 'Конкурс', 'level': 'Школьный', 'form': 'Очно', 'subject': '',
         'event_date': '2026-11-10', 'class_name': '8Б', 'student_name': 'Иванов Пётр', 'result': 'Призёр',
         'supervisor_id': 't1', 'diploma_key': None, 'consent': True, 'status': 'new', 'checker_id': None,
         'checked_at': None, 'return_comment': None, 'deleted': False}
    r.update(over)
    return r


def test_all_repo_writes_build_valid_parameters():
    pool = FakePool()
    repo = YdbRepo(pool)
    repo.insert_records([record(), record(id='r2', contest_id='c1')])
    repo.upsert_staff({'id': 't1', 'short_name': 'А', 'full_name': 'А', 'position': '', 'role': 'teacher',
                       'pin_hash': 'scrypt$x', 'pin_set_at': 1763540000.0, 'active': True})
    repo.put_limit({'key': 'ip:1', 'count': 3, 'window_start': 1763540000.0, 'locked_until': 0.0})
    repo.add_audit([{'id': 'a1', 'at': 1763540000.0, 'staff_id': 't1', 'action': 'create', 'record_id': 'r1', 'details': ''}])
    repo.list_records('2026-09-01', '2027-08-31')
    repo.count_created_since('t1', 1763540000.0)
    repo.records_before('2020-09-01')
    repo.delete_records(['r1', 'r2'])
    repo.get_record('r1'); repo.get_staff('t1'); repo.get_limit('ip:1')
    assert len(pool.calls) == 11
    assert pool.calls[0][0].startswith('UPSERT INTO records')


def test_value_conversions_roundtrip():
    from datetime import date, datetime, timezone
    assert _from_db(TS, _to_db(TS, 1763540000.25)) == 1763540000.25
    assert _from_db(TS, datetime(2026, 1, 1, tzinfo=timezone.utc)) == 1767225600.0
    assert _from_db(D, _to_db(D, '2026-11-10')) == '2026-11-10'
    assert _from_db(D, 20402) == '2025-11-10'
    assert _from_db(D, date(2026, 11, 10)) == '2026-11-10'


class TransactionPool(FakePool):
    def __init__(self, rows):
        super().__init__()
        self.rows = iter(rows)

    def retry_operation_sync(self, operation):
        return operation(self)

    @contextmanager
    def transaction(self, _mode):
        yield self

    @contextmanager
    def execute(self, query, parameters, commit_tx=False):
        convert.query_parameters_to_pb(parameters)
        self.calls.append((query, parameters, commit_tx))
        yield [] if commit_tx else [SimpleNamespace(rows=next(self.rows))]


def test_application_write_requires_current_contest_and_application_in_one_transaction():
    student = {'student_name': 'Иванов Пётр', 'class_name': '8Б'}
    application = {'contest_id': 'c1', 'author_id': 't1', 'students': [student], 'status': 'submitted',
                   'return_comment': '', 'updated_at': 1763540000.5, 'revision': 'app_v2'}
    pool = TransactionPool([[{'revision': 'contest_v1'}], [{'revision': 'app_v1'}]])
    assert YdbRepo(pool).save_application(application, 'app_v1', 'contest_v1')
    assert [commit for _, _, commit in pool.calls] == [False, False, True]
    assert 'Иванов Пётр' in pool.calls[-1][1]['$rows'][0][0]['students']

    closed = TransactionPool([[{'revision': 'contest_v2'}]])
    assert not YdbRepo(closed).save_application(application, 'app_v1', 'contest_v1')
    assert len(closed.calls) == 1 and not closed.calls[0][2]
