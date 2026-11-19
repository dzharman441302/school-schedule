"""Хранилище в Managed YDB (serverless). Схема — schema/schema.yql."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import ydb

from .repo import AUDIT_FIELDS, LIMIT_FIELDS, RECORD_FIELDS, STAFF_FIELDS, Repo

U, TS, D, B, I32 = (ydb.PrimitiveType.Utf8, ydb.PrimitiveType.Timestamp, ydb.PrimitiveType.Date,
                    ydb.PrimitiveType.Bool, ydb.PrimitiveType.Int32)

TYPES = {
    'staff': {**{f: U for f in STAFF_FIELDS}, 'pin_set_at': TS, 'active': B},
    'records': {**{f: U for f in RECORD_FIELDS}, 'created_at': TS, 'updated_at': TS, 'checked_at': TS,
                'event_date': D, 'consent': B, 'deleted': B},
    'audit': {**{f: U for f in AUDIT_FIELDS}, 'at': TS},
    'login_limits': {**{f: U for f in LIMIT_FIELDS}, 'count': I32, 'window_start': TS, 'locked_until': TS},
}
FIELDS = {'staff': STAFF_FIELDS, 'records': RECORD_FIELDS, 'audit': AUDIT_FIELDS, 'login_limits': LIMIT_FIELDS}
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
        for rs in result:
            for row in rs.rows:
                out.append({f: _from_db(types[f], row[f]) for f in FIELDS[table]})
        return out

    def _upsert(self, table: str, items: list[dict]) -> None:
        if not items:
            return
        types = TYPES[table]
        struct = ydb.StructType()
        for f in FIELDS[table]:
            struct.add_member(f, ydb.OptionalType(types[f]))
        rows = [{f: _to_db(types[f], item.get(f)) for f in FIELDS[table]} for item in items]
        self.pool.execute_with_retries(f'UPSERT INTO {table} SELECT * FROM AS_TABLE($rows);',
                                       {'$rows': (rows, ydb.ListType(struct))})

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

    # audit ---------------------------------------------------------------

    def add_audit(self, entries):
        self._upsert('audit', entries)
