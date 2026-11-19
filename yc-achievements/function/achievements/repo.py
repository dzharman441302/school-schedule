"""Хранилище: общий интерфейс, реализация в памяти (тесты) — YDB в ydb_repo.py.

Время везде — секунды Unix (float), event_date — строка ГГГГ-ММ-ДД.
"""
from __future__ import annotations

import copy

STAFF_FIELDS = ['id', 'short_name', 'full_name', 'position', 'role', 'pin_hash', 'pin_set_at', 'active']
RECORD_FIELDS = [
    'id', 'created_at', 'updated_at', 'author_id', 'event_name', 'contest_id', 'direction', 'level', 'form',
    'subject', 'event_date', 'class_name', 'student_name', 'result', 'supervisor_id', 'diploma_key', 'consent',
    'status', 'checker_id', 'checked_at', 'return_comment', 'deleted',
]
AUDIT_FIELDS = ['id', 'at', 'staff_id', 'action', 'record_id', 'details']
LIMIT_FIELDS = ['key', 'count', 'window_start', 'locked_until']


class Repo:
    def list_staff(self) -> list[dict]: raise NotImplementedError
    def get_staff(self, staff_id: str) -> dict | None: raise NotImplementedError
    def upsert_staff(self, staff: dict) -> None: raise NotImplementedError
    def get_limit(self, key: str) -> dict | None: raise NotImplementedError
    def put_limit(self, limit: dict) -> None: raise NotImplementedError
    def insert_records(self, records: list[dict]) -> None: raise NotImplementedError
    def get_record(self, record_id: str) -> dict | None: raise NotImplementedError
    def update_record(self, record: dict) -> None: raise NotImplementedError
    def list_records(self, date_from: str, date_to: str, include_deleted: bool = False) -> list[dict]: raise NotImplementedError
    def count_created_since(self, author_id: str, since: float) -> int: raise NotImplementedError
    def add_audit(self, entries: list[dict]) -> None: raise NotImplementedError
    def records_before(self, date_to: str) -> list[dict]: raise NotImplementedError
    def delete_records(self, ids: list[str]) -> None: raise NotImplementedError


class MemoryRepo(Repo):
    def __init__(self):
        self.staff: dict[str, dict] = {}
        self.records: dict[str, dict] = {}
        self.audit: list[dict] = []
        self.limits: dict[str, dict] = {}

    def list_staff(self):
        return [copy.deepcopy(s) for s in self.staff.values()]

    def get_staff(self, staff_id):
        s = self.staff.get(staff_id)
        return copy.deepcopy(s) if s else None

    def upsert_staff(self, staff):
        self.staff[staff['id']] = {f: staff.get(f) for f in STAFF_FIELDS}

    def get_limit(self, key):
        v = self.limits.get(key)
        return dict(v) if v else None

    def put_limit(self, limit):
        self.limits[limit['key']] = {f: limit.get(f) for f in LIMIT_FIELDS}

    def insert_records(self, records):
        for r in records:
            self.records[r['id']] = {f: r.get(f) for f in RECORD_FIELDS}

    def get_record(self, record_id):
        r = self.records.get(record_id)
        return copy.deepcopy(r) if r else None

    def update_record(self, record):
        self.records[record['id']] = {f: record.get(f) for f in RECORD_FIELDS}

    def list_records(self, date_from, date_to, include_deleted=False):
        return [copy.deepcopy(r) for r in self.records.values()
                if date_from <= (r['event_date'] or '') <= date_to and (include_deleted or not r['deleted'])]

    def count_created_since(self, author_id, since):
        return sum(1 for r in self.records.values() if r['author_id'] == author_id and r['created_at'] >= since)

    def add_audit(self, entries):
        self.audit.extend({f: e.get(f) for f in AUDIT_FIELDS} for e in entries)

    def records_before(self, date_to):
        return [copy.deepcopy(r) for r in self.records.values() if (r['event_date'] or '') < date_to]

    def delete_records(self, ids):
        for i in ids:
            self.records.pop(i, None)
