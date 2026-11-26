"""Хранилище в Managed YDB (serverless). Схема — schema/schema.yql."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import ydb

from .repo import APPLICATION_FIELDS, AUDIT_FIELDS, COMPETITION_FIELDS, LIMIT_FIELDS, RECORD_FIELDS, STAFF_FIELDS, Repo
from .registration import applications_fit, scope_changes

U, TS, D, B, I32 = (ydb.PrimitiveType.Utf8, ydb.PrimitiveType.Timestamp, ydb.PrimitiveType.Date,
                    ydb.PrimitiveType.Bool, ydb.PrimitiveType.Int32)

TYPES = {
    'staff': {**{f: U for f in STAFF_FIELDS}, 'pin_set_at': TS, 'active': B},
    'records': {**{f: U for f in RECORD_FIELDS}, 'created_at': TS, 'updated_at': TS, 'checked_at': TS,
                'event_date': D, 'consent': B, 'deleted': B},
    'audit': {**{f: U for f in AUDIT_FIELDS}, 'at': TS},
    'login_limits': {**{f: U for f in LIMIT_FIELDS}, 'count': I32, 'window_start': TS, 'locked_until': TS},
    'competitions': {**{f: U for f in COMPETITION_FIELDS}, 'school_year': I32, 'event_date': D,
                     'deadline': D, 'required': B},
    'competition_applications': {**{f: U for f in APPLICATION_FIELDS}, 'updated_at': TS},
}
FIELDS = {
    'staff': STAFF_FIELDS, 'records': RECORD_FIELDS, 'audit': AUDIT_FIELDS, 'login_limits': LIMIT_FIELDS,
    'competitions': COMPETITION_FIELDS, 'competition_applications': APPLICATION_FIELDS,
}
JSON_FIELD = {'competitions': 'classes', 'competition_applications': 'students'}
EPOCH = date(1970, 1, 1)


def _to_db(kind, value):
    if value is None:
        return None
    if kind is TS:
        return int(float(value) * 1_000_000)
    if kind is D:
        return date.fromisoformat(value)
    if kind is I32:
        return int(value)
    return value


def _from_db(kind, value):
    if value is None:
        return None
    if kind is TS:
        if isinstance(value, datetime):
            return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()
        return int(value) / 1_000_000
    if kind is D:
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        return (EPOCH + timedelta(days=int(value))).isoformat()
    return value


class YdbRepo(Repo):
    def __init__(self, pool: 'ydb.QuerySessionPool'):
        self.pool = pool

    @classmethod
    def connect(cls, endpoint: str, database: str, credentials=None) -> 'YdbRepo':
        driver = ydb.Driver(endpoint=endpoint, database=database,
                            credentials=credentials or ydb.iam.MetadataUrlCredentials())
        driver.wait(timeout=10, fail_fast=True)
        return cls(ydb.QuerySessionPool(driver))

    # helpers -------------------------------------------------------------

    def _rows(self, table: str, query: str, params: dict | None = None) -> list[dict]:
        result = self.pool.execute_with_retries(query, params or {})
        types = TYPES[table]
        out = []
        json_field = JSON_FIELD.get(table)
        for rs in result:
            for row in rs.rows:
                item = {f: _from_db(types[f], row[f]) for f in FIELDS[table]}
                if json_field:
                    item[json_field] = json.loads(item[json_field])
                out.append(item)
        return out

    @staticmethod
    def _upsert_command(table: str, items: list[dict]):
        types = TYPES[table]
        struct = ydb.StructType()
        for f in FIELDS[table]:
            struct.add_member(f, ydb.OptionalType(types[f]))
        rows = [{f: _to_db(types[f], item.get(f)) for f in FIELDS[table]} for item in items]
        json_field = JSON_FIELD.get(table)
        if json_field:
            for row in rows:
                row[json_field] = json.dumps(row[json_field], ensure_ascii=False, separators=(',', ':'))
        return f'UPSERT INTO {table} SELECT * FROM AS_TABLE($rows);', {'$rows': (rows, ydb.ListType(struct))}

    def _upsert(self, table: str, items: list[dict]) -> None:
        if items:
            self.pool.execute_with_retries(*self._upsert_command(table, items))

    def _save_if_current(self, table, item, checks, previous_contest=None):
        query, params = self._upsert_command(table, [item])

        def write(session):
            with session.transaction(ydb.QuerySerializableReadWrite()) as tx:
                for read, keys, expected in checks:
                    with tx.execute(read, keys) as results:
                        revision = next((row['revision'] for rs in results for row in rs.rows), None)
                    if revision != expected:
                        return False
                if scope_changes(previous_contest, item):
                    with tx.execute('SELECT status, students FROM competition_applications WHERE contest_id = $id;',
                                    {'$id': (item['id'], U)}) as results:
                        apps = [{'status': row['status'], 'students': json.loads(row['students'])}
                                for rs in results for row in rs.rows]
                    if not applications_fit(previous_contest, item, apps):
                        return False
                with tx.execute(query, params, commit_tx=True) as results:
                    for _ in results:
                        pass
                return True

        return self.pool.retry_operation_sync(write)

    # staff ---------------------------------------------------------------

    def list_staff(self):
        return self._rows('staff', 'SELECT * FROM staff;')

    def get_staff(self, staff_id):
        rows = self._rows('staff', 'SELECT * FROM staff WHERE id = $id;', {'$id': (staff_id, U)})
        return rows[0] if rows else None

    def upsert_staff(self, staff):
        self._upsert('staff', [staff])

    # login limits ----------------------------------------------------------

    def get_limit(self, key):
        rows = self._rows('login_limits', 'SELECT * FROM login_limits WHERE key = $k;', {'$k': (key, U)})
        return rows[0] if rows else None

    def put_limit(self, limit):
        self._upsert('login_limits', [limit])

    # records -------------------------------------------------------------

    def insert_records(self, records):
        self._upsert('records', records)

    def get_record(self, record_id):
        rows = self._rows('records', 'SELECT * FROM records WHERE id = $id;', {'$id': (record_id, U)})
        return rows[0] if rows else None

    def update_record(self, record):
        self._upsert('records', [record])

    def list_records(self, date_from, date_to, include_deleted=False):
        rows = self._rows('records',
                          'SELECT * FROM records VIEW idx_event_date WHERE event_date >= $f AND event_date <= $t;',
                          {'$f': (date.fromisoformat(date_from), D), '$t': (date.fromisoformat(date_to), D)})
        return rows if include_deleted else [r for r in rows if not r['deleted']]

    def count_created_since(self, author_id, since):
        result = self.pool.execute_with_retries(
            'SELECT COUNT(*) AS n FROM records VIEW idx_author WHERE author_id = $a AND created_at >= $s;',
            {'$a': (author_id, U), '$s': (_to_db(TS, since), TS)})
        return int(result[0].rows[0]['n']) if result and result[0].rows else 0

    def records_before(self, date_to):
        return self._rows('records', 'SELECT * FROM records VIEW idx_event_date WHERE event_date < $t;',
                          {'$t': (date.fromisoformat(date_to), D)})

    def delete_records(self, ids):
        for start in range(0, len(ids), 500):
            self.pool.execute_with_retries('DELETE FROM records WHERE id IN $ids;',
                                           {'$ids': (ids[start:start + 500], ydb.ListType(U))})

    # competition registration --------------------------------------------

    def list_competitions(self, year):
        return self._rows('competitions', 'SELECT * FROM competitions VIEW idx_competitions_year WHERE school_year = $y;',
                          {'$y': (year, I32)})

    def get_competition(self, contest_id):
        rows = self._rows('competitions', 'SELECT * FROM competitions WHERE id = $id;', {'$id': (contest_id, U)})
        return rows[0] if rows else None

    def save_competition(self, contest, previous):
        return self._save_if_current('competitions', contest, [
            ('SELECT revision FROM competitions WHERE id = $id;', {'$id': (contest['id'], U)},
             (previous or {}).get('revision')),
        ], previous_contest=previous)

    def get_application(self, contest_id, author_id):
        rows = self._rows('competition_applications',
                          'SELECT * FROM competition_applications WHERE contest_id = $id AND author_id = $author;',
                          {'$id': (contest_id, U), '$author': (author_id, U)})
        return rows[0] if rows else None

    def competition_applications(self, contest_id):
        return self._rows('competition_applications', 'SELECT * FROM competition_applications WHERE contest_id = $id;',
                          {'$id': (contest_id, U)})

    def author_applications(self, author_id):
        return self._rows('competition_applications',
                          'SELECT * FROM competition_applications VIEW idx_application_author WHERE author_id = $author;',
                          {'$author': (author_id, U)})

    def save_application(self, application, expected, contest_revision):
        contest = {'$id': (application['contest_id'], U)}
        return self._save_if_current('competition_applications', application, [
            ('SELECT revision FROM competitions WHERE id = $id;', contest, contest_revision),
            ('SELECT revision FROM competition_applications WHERE contest_id = $id AND author_id = $author;',
             {**contest, '$author': (application['author_id'], U)}, expected),
        ])

    # audit ---------------------------------------------------------------

    def add_audit(self, entries):
        self._upsert('audit', entries)
