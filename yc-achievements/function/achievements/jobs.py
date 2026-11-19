"""Фоновые задачи: выгрузка реестра на Яндекс Диск и публичный achievements.json.

В логи — только коды ошибок и количества.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime
from urllib.parse import quote

from . import config
from .export import build_registry, is_prize
from .validation import school_year_range, school_year_start

DISK_API = 'https://cloud-api.yandex.net/v1/disk/resources'
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
HIGHLIGHTS = 30
REGIONAL_HIGHLIGHTS = 5


class JobError(Exception):
    """Ошибка задачи: в тексте только этап и HTTP-код."""


def urllib_http(method: str, url: str, headers: dict | None = None, body: bytes | None = None, timeout: int = 30) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except Exception as exc:  # сеть, таймаут
        raise JobError(f'network {type(exc).__name__}')


# --- Яндекс Диск -------------------------------------------------------------------

class YandexDisk:
    """REST API Диска с OAuth-токеном приложения (права: запись на Диск)."""

    def __init__(self, token: str, http=urllib_http):
        self.token, self.http = token, http

    def _headers(self) -> dict:
        return {'Authorization': f'OAuth {self.token}'}

    def ensure_folder(self, folder: str) -> None:
        parts = [p for p in folder.strip('/').split('/') if p]
        for i in range(1, len(parts) + 1):
            path = '/' + '/'.join(parts[:i])
            status, _ = self.http('PUT', f'{DISK_API}?path={quote(path, safe="")}', self._headers())
            if status not in (201, 409):  # 409 — папка уже есть
                raise JobError(f'mkdir {status}')

    def upload(self, path: str, data: bytes) -> None:
        if not self.token or self.token == 'not-set':
            raise JobError('no-token')
        folder = path.rsplit('/', 1)[0]
        if folder:
            self.ensure_folder(folder)
        status, body = self.http('GET', f'{DISK_API}/upload?path={quote(path, safe="")}&overwrite=true', self._headers())
        if status != 200:  # 423 — файл занят (открыт на редактирование), повторим в следующий раз
            raise JobError(f'upload-link {status}')
        href = json.loads(body.decode('utf-8'))['href']
        status, _ = self.http('PUT', href, {'Content-Type': XLSX}, data)
        if status not in (200, 201, 202):
            raise JobError(f'upload {status}')


def disk_path(template: str, school_year: int) -> str:
    return template.replace('{year}', f'{school_year}-{school_year + 1}')


def export_to_disk(repo, settings: config.Settings, disk: YandexDisk, now: float) -> dict:
    today = datetime.fromtimestamp(now, config.MSK)
    year = school_year_start(today.date())
    records = repo.list_records(*school_year_range(year))
    names = {s['id']: s['short_name'] for s in repo.list_staff()}
    data = build_registry(records, names, school_year=year, updated_at=today)
    disk.upload(disk_path(settings.yadisk_path, year), data)
    return {'records': len(records), 'bytes': len(data)}


# --- Публичный achievements.json ----------------------------------------------------

def public_name(full_name: str) -> str:
    """«Фамилия Имя Отчество» → «Фамилия Имя»."""
    return ' '.join(str(full_name or '').split()[:2])


def parallel_of(class_name: str) -> str:
    digits = ''.join(c for c in str(class_name or '') if c.isdigit())
    return digits or '—'


def _count(items: list[dict]) -> dict:
    return {'records': len(items), 'prizes': sum(is_prize(r['result']) for r in items)}


def highlight(r: dict, names: dict[str, str]) -> dict:
    item = {'date': r['event_date'], 'event': r['event_name'], 'level': r['level'], 'direction': r['direction'],
            'result': r['result'], 'class': r['class_name'], 'supervisor': names.get(r['supervisor_id'] or '', '')}
    if r.get('consent') is True:  # без согласия родителей имени в файле нет вовсе
        item['student'] = public_name(r['student_name'])
    return item


def build_public(records: list[dict], names: dict[str, str], school_year: int, now: float) -> dict:
    """records — записи текущего и прошлого учебного года. В файл попадают только проверенные;
    без ссылок на дипломы, комментариев и отчеств."""
    checked = [r for r in records if r['status'] == 'checked' and not r.get('deleted')]
    start, end = school_year_range(school_year)
    year = [r for r in checked if start <= (r['event_date'] or '') <= end]
    by = lambda key, keys: [{key: k, **_count([r for r in year if (parallel_of(r['class_name']) if key == 'parallel' else r[key]) == k])} for k in keys]
    parallels = sorted({parallel_of(r['class_name']) for r in year}, key=lambda p: (not p.isdigit(), int(p) if p.isdigit() else 0))
    order = lambda r: (r['event_date'] or '', r.get('checked_at') or 0)
    prizes = sorted((r for r in checked if is_prize(r['result'])), key=order, reverse=True)
    regional_rank = config.LEVELS.index('Региональный')
    contests: dict[str, dict] = {}
    for r in year:
        if r.get('contest_id'):
            c = contests.setdefault(r['contest_id'], {'participants': 0, 'prizes': 0})
            c['participants'] += 1
            c['prizes'] += int(is_prize(r['result']))
    return {
        'updated_at': datetime.fromtimestamp(now, config.MSK).isoformat(timespec='minutes'),
        'school_year': school_year,
        'prize_results': config.PRIZE_RESULTS,
        'levels': config.LEVELS,
        'totals': {
            **_count(year),
            'municipal_plus_prizes': sum(is_prize(r['result']) and config.LEVELS.index(r['level']) >= 1 for r in year if r['level'] in config.LEVELS),
            'by_level': by('level', config.LEVELS),
            'by_direction': [x for x in by('direction', config.DIRECTIONS) if x['records']],
            'by_parallel': by('parallel', parallels),
        },
        'highlights': [highlight(r, names) for r in prizes[:HIGHLIGHTS]],
        'highlights_regional': [highlight(r, names) for r in prizes
                                if r['level'] in config.LEVELS and config.LEVELS.index(r['level']) >= regional_rank][:REGIONAL_HIGHLIGHTS],
        'contests': contests,
    }


def publish_public(repo, settings: config.Settings, storage, now: float) -> dict:
    year = school_year_start(datetime.fromtimestamp(now, config.MSK).date())
    records = repo.list_records(school_year_range(year - 1)[0], school_year_range(year)[1])
    names = {s['id']: s['short_name'] for s in repo.list_staff()}
    payload = build_public(records, names, year, now)
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    storage.put_public(settings.public_bucket, settings.public_key, body, 'application/json; charset=utf-8', 'public, max-age=600', now)
    return {'highlights': len(payload['highlights']), 'records': payload['totals']['records']}
