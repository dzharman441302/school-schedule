"""Список мероприятий из публичного листа «Конкурсы_сайт» (тот же, что читает сайт). Кэш 30 минут."""
from __future__ import annotations

import csv
import io
import time
import urllib.request
from urllib.parse import quote

from . import config

ALIASES = {
    'id': ('id', 'код', 'ид'),
    'name': ('название', 'мероприятие', 'конкурс', 'олимпиада'),
    'direction': ('направление',),
    'level': ('уровень',),
    'subject': ('предмет', 'предмет / номинация', 'предмет/номинация', 'номинация'),
    'date': ('дата', 'дата проведения', 'дата начала'),
}


def _header_index(headers: list[str]) -> dict[str, int]:
    norm = [h.strip().lower() for h in headers]
    found = {}
    for key, names in ALIASES.items():
        for i, h in enumerate(norm):
            if h in names:
                found[key] = i
                break
    return found


def parse_contests(text: str) -> list[dict]:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    idx = _header_index(rows[0])
    if 'name' not in idx:
        return []
    cell = lambda r, k: (r[idx[k]].strip() if k in idx and idx[k] < len(r) else '')
    out = []
    for r in rows[1:]:
        name = cell(r, 'name')
        if not name:
            continue
        direction, level = cell(r, 'direction'), cell(r, 'level')
        out.append({
            'id': cell(r, 'id') or None,
            'name': name[:200],
            'direction': direction if direction in config.DIRECTIONS else '',
            'level': level if level in config.LEVELS else '',
            'subject': cell(r, 'subject')[:120],
            'date': cell(r, 'date'),
        })
    return out


def _fetch(sheet_id: str, sheet: str) -> str:
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={quote(sheet)}'
    with urllib.request.urlopen(url, timeout=5) as resp:
        return resp.read().decode('utf-8')


class ContestsCache:
    def __init__(self, sheet_id: str, sheet: str, clock=time.time, fetch=_fetch):
        self.sheet_id, self.sheet, self.clock, self.fetch = sheet_id, sheet, clock, fetch
        self.items: list[dict] = []
        self.loaded_at = 0.0

    def get(self) -> list[dict]:
        if not self.sheet_id:
            return []
        now = self.clock()
        if self.loaded_at and now - self.loaded_at < config.CONTESTS_CACHE_SECONDS:
            return self.items
        try:
            self.items = parse_contests(self.fetch(self.sheet_id, self.sheet))
        except Exception as exc:  # лист ещё не создан или Google недоступен — отдаём прошлый список
            print(f'contests: fetch failed ({type(exc).__name__})')
        self.loaded_at = now
        return self.items
