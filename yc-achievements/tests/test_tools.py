import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

import init_db  # noqa: E402
import purge_old  # noqa: E402
import seed_staff  # noqa: E402
from _common import ROOT  # noqa: E402

CSV = 'short_name,full_name,position,role\nТестова А.Б.,Тестова Анна Борисовна,учитель,teacher\nПримеров В.Г.,Примеров Виктор Глебович,,checker\n'


def test_seed_reads_csv_and_keeps_existing_ids_and_pins(tmp_path):
    p = tmp_path / 'staff.csv'
    p.write_text('﻿' + CSV, encoding='utf-8')
    rows = seed_staff.read_csv(p)
    assert [r['role'] for r in rows] == ['teacher', 'checker']
    existing = [{'id': 'old1', 'short_name': 'Тестова А.Б.', 'full_name': '', 'position': '', 'role': 'admin',
                 'pin_hash': 'scrypt$keep', 'pin_set_at': 1.0, 'active': True}]
    items, added, updated = seed_staff.merge(existing, rows, update_roles=False)
    assert (added, updated) == (1, 1)
    kept = items[0]
    assert kept['id'] == 'old1' and kept['pin_hash'] == 'scrypt$keep' and kept['role'] == 'admin'
    assert kept['position'] == 'учитель'
    assert items[1]['pin_hash'] is None and items[1]['active'] is True


def test_seed_rejects_bad_role_and_duplicates(tmp_path):
    p = tmp_path / 'staff.csv'
    p.write_text(CSV + 'Тестова А.Б.,Х,,teacher\n', encoding='utf-8')
    with pytest.raises(SystemExit):
        seed_staff.read_csv(p)
    p.write_text(CSV.replace('checker', 'boss'), encoding='utf-8')
    with pytest.raises(SystemExit):
        seed_staff.read_csv(p)


def test_schema_has_all_tables():
    sql = init_db.statements((ROOT / 'schema' / 'schema.yql').read_text(encoding='utf-8'))
    assert [s.split()[5] for s in sql] == ['staff', 'records', 'audit', 'login_limits']


def test_purge_cutoff_is_school_year_based():
    assert purge_old.cutoff(3, date(2026, 11, 19)) == '2023-09-01'
    assert purge_old.cutoff(3, date(2027, 6, 1)) == '2023-09-01'
    assert purge_old.cutoff(1, date(2027, 9, 1)) == '2026-09-01'
