"""Этап 3: выгрузка на Диск (формат реестра, сводка), achievements.json, отчёт по руководителям.
Все ФИО — вымышленные."""
import io
import json
from datetime import datetime

import pytest
from openpyxl import load_workbook

from achievements import config, jobs
from achievements.export import build_registry, supervisors_report
from conftest import START

NAMES = {'t1': 'Учителева А.А.', 't2': 'Педагогов Б.Б.'}


def rec(i, **over):
    r = {'id': f'r{i}', 'created_at': START, 'updated_at': START, 'author_id': 't1', 'event_name': 'Олимпиада по математике',
         'contest_id': 'c1', 'direction': 'Предметная олимпиада', 'level': 'Муниципальный', 'form': 'Очно', 'subject': 'Математика',
         'event_date': '2026-11-10', 'class_name': '8Б', 'student_name': 'Тестов Пётр Иванович', 'result': 'Призёр',
         'supervisor_id': 't1', 'diploma_key': 'diplomas/x.jpg', 'consent': True, 'status': 'checked', 'checker_id': 'chk',
         'checked_at': START, 'return_comment': None, 'deleted': False}
    r.update(over)
    return r


RECORDS = [
    rec(1),
    rec(2, student_name='Примерова Анна Сергеевна', consent=False, level='Региональный', result='Победитель', class_name='10А', event_date='2026-11-12'),
    rec(3, student_name='Сидорова Ольга', result='Участник', supervisor_id='t2', level='Школьный', diploma_key=None),
    rec(4, status='new', result='1 место', level='Всероссийский', return_comment=None),
    rec(5, status='returned', return_comment='Нет диплома', supervisor_id='t2'),
]


# --- реестр ------------------------------------------------------------------------

def test_registry_has_three_sheets_with_headers_and_note():
    wb = load_workbook(io.BytesIO(build_registry(RECORDS, NAMES, school_year=2026, updated_at=datetime(2026, 11, 19, 9, 5, tzinfo=config.MSK))))
    assert wb.sheetnames == ['Достижения', 'Сводка', 'Обновлено']
    head = [c.value for c in wb['Достижения'][1]]
    assert head == ['№', 'Дата', 'Мероприятие', 'Направление', 'Уровень', 'Форма', 'Предмет/номинация', 'Класс', 'ФИО ученика',
                    'Результат', 'Руководитель', 'Диплом (есть/нет)', 'Согласие', 'Проверено (Да/Нет/Возвращено)', 'Комментарий проверяющего']
    rows = list(wb['Достижения'].values)[1:]
    assert [r[13] for r in rows].count('Возвращено') == 1 and [r[13] for r in rows].count('Нет') == 1
    assert {r[11] for r in rows} == {'есть', 'нет'}
    upd = list(wb['Обновлено'].values)
    assert upd[0] == ('Выгрузка', '19.11.2026 09:05')
    assert upd[1][0] == 'Файл формируется автоматически, правки будут перезаписаны'


def test_summary_by_level_and_supervisor():
    wb = load_workbook(io.BytesIO(build_registry(RECORDS, NAMES, school_year=2026)))
    values = [r for r in wb['Сводка'].values]
    assert values[0][0] == 'Учебный год 2026/2027'
    level = {r[0]: r[1:] for r in values if r and r[0] in config.LEVELS + ['Итого']}
    assert level['Муниципальный'] == (2, 2, 1)       # 2 записи, обе призёры, проверена одна
    assert level['Региональный'] == (1, 1, 1)
    assert level['Всероссийский'] == (1, 1, 0)
    assert level['Школьный'] == (1, 0, 1)
    assert level['Итого'] == (5, 4, 3)
    sup = {r[0]: r[1:] for r in values if r and r[0] in NAMES.values()}
    assert sup['Учителева А.А.'] == (3, 3, 3)       # записи, призёры, из них муниципальный+
    assert sup['Педагогов Б.Б.'] == (2, 1, 1)


# --- achievements.json -------------------------------------------------------------

def test_public_json_only_checked_and_names_only_with_consent():
    data = jobs.build_public(RECORDS, NAMES, 2026, START)
    text = json.dumps(data, ensure_ascii=False)
    assert data['totals']['records'] == 3 and data['totals']['prizes'] == 2
    assert 'Примерова' not in text, 'нет согласия — ФИО нет нигде'
    assert 'Иванович' not in text, 'отчества нет'
    assert 'Сидорова' not in text, 'участник не попадает в ленту'
    first = data['highlights'][0]
    assert first == {'date': '2026-11-12', 'event': 'Олимпиада по математике', 'level': 'Региональный', 'direction': 'Предметная олимпиада',
                     'result': 'Победитель', 'class': '10А', 'supervisor': 'Учителева А.А.'}
    assert 'student' not in first
    assert data['highlights'][1]['student'] == 'Тестов Пётр'
    for bad in ('diplomas/', 'Нет диплома', 'diploma', 'comment'):
        assert bad not in text
    assert len(data['highlights']) == 2
    assert data['highlights_regional'] == [first]


def test_public_totals_by_parallel_level_direction_and_contests():
    data = jobs.build_public(RECORDS, NAMES, 2026, START)
    par = {x['parallel']: (x['records'], x['prizes']) for x in data['totals']['by_parallel']}
    assert par == {'8': (2, 1), '10': (1, 1)}
    assert [x['parallel'] for x in data['totals']['by_parallel']] == ['8', '10']
    lvl = {x['level']: x['records'] for x in data['totals']['by_level']}
    assert lvl['Школьный'] == 1 and lvl['Международный'] == 0
    assert data['totals']['by_direction'] == [{'direction': 'Предметная олимпиада', 'records': 3, 'prizes': 2}]
    assert data['contests'] == {'c1': {'participants': 3, 'prizes': 2}}
    assert data['totals']['municipal_plus_prizes'] == 2


def test_school_year_boundary_is_first_of_september():
    recs = [rec(1, event_date='2026-08-31'), rec(2, event_date='2026-09-01')]
    data = jobs.build_public(recs, NAMES, 2026, START)
    assert data['totals']['records'] == 1
    assert len(data['highlights']) == 2, 'в ленте — и прошлый учебный год, чтобы в сентябре она не была пустой'


def test_highlights_limited_to_30_newest():
    recs = [rec(i, event_date=f'2026-10-{1 + i % 28:02d}', checked_at=START + i) for i in range(40)]
    data = jobs.build_public(recs, NAMES, 2026, START)
    assert len(data['highlights']) == 30
    dates = [h['date'] for h in data['highlights']]
    assert dates == sorted(dates, reverse=True)


def test_publish_task_puts_public_object_with_cache(app, repo, storage, client):
    repo.insert_records(RECORDS)
    result = app.handle_event({'messages': [{'details': {'trigger_id': 'x', 'payload': 'publish'}}]})
    assert json.loads(result['body'])[0]['ok'] is True
    obj = storage.public[('pub-test', 'achievements.json')]
    assert obj['cache_control'] == 'public, max-age=600'
    assert json.loads(obj['data'])['totals']['records'] == 3
    assert client.call('POST', '/admin/publish', who='t1')[0] == 403
    assert client.call('POST', '/admin/publish', who='chk')[0] == 200


# --- Яндекс Диск ----------------------------------------------------------------------

class FakeHttp:
    def __init__(self, link_status=200):
        self.calls, self.link_status, self.folders = [], link_status, set()

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append((method, url, headers, body))
        if url.startswith(jobs.DISK_API + '?path='):
            folder = url.split('=', 1)[1]
            status = 409 if folder in self.folders else 201
            self.folders.add(folder)
            return status, b''
        if '/upload?' in url:
            return self.link_status, json.dumps({'href': 'https://uploader.example/put/1', 'method': 'PUT'}).encode()
        if url.startswith('https://uploader.example'):
            return 201, b''
        return 404, b''


def test_disk_upload_creates_folders_and_overwrites():
    http = FakeHttp()
    disk = jobs.YandexDisk('tok', http=http)
    disk.upload('/Школа/Достижения/Реестр достижений (выгрузка).xlsx', b'xlsx')
    disk.upload('/Школа/Достижения/Реестр достижений (выгрузка).xlsx', b'xlsx')  # папки уже есть — 409 не ошибка
    link = [c for c in http.calls if '/upload?' in c[1]][0]
    assert 'overwrite=true' in link[1] and link[2]['Authorization'] == 'OAuth tok'
    put = [c for c in http.calls if c[0] == 'PUT' and c[1].startswith('https://uploader')][0]
    assert put[3] == b'xlsx' and 'Authorization' not in put[2]


def test_disk_busy_file_is_an_error_with_code_only(app, repo, capsys):
    repo.insert_records(RECORDS)
    app.disk = jobs.YandexDisk('tok', http=FakeHttp(link_status=423))
    result = app.run_task('export_disk')
    assert result == {'task': 'export_disk', 'ok': False, 'error': 'upload-link 423'}
    out = capsys.readouterr().out
    assert 'upload-link 423' in out and 'Тестов' not in out


def test_export_disk_task_and_button(app, repo, client):
    repo.insert_records(RECORDS)
    http = FakeHttp()
    app.disk = jobs.YandexDisk('tok', http=http)
    result = app.handle_event({'messages': [{'details': {'payload': 'export_disk'}}]})
    assert json.loads(result['body'])[0]['records'] == 5
    sent = [c for c in http.calls if c[1].startswith('https://uploader')][0][3]
    assert load_workbook(io.BytesIO(sent)).sheetnames == ['Достижения', 'Сводка', 'Обновлено']
    assert client.call('POST', '/admin/export-disk', who='t1')[0] == 403
    status, data, _ = client.call('POST', '/admin/export-disk', who='chk')
    assert status == 200 and data['ok']
    app.disk = jobs.YandexDisk('', http=http)
    status, data, _ = client.call('POST', '/admin/export-disk', who='adm')
    assert status == 502 and 'no-token' in data['message']


def test_disk_path_year_placeholder():
    assert jobs.disk_path('/Школа/Реестр {year}.xlsx', 2026) == '/Школа/Реестр 2026-2027.xlsx'
    assert jobs.disk_path('/Школа/Реестр.xlsx', 2026) == '/Школа/Реестр.xlsx'


# --- отчёт по руководителям ---------------------------------------------------------

def test_supervisors_report_counts_only_checked():
    rows = {r[0]: r[1:] for r in supervisors_report(RECORDS, NAMES)}
    # колонки: записей(проверенных), призёров по 6 уровням, призёров всего, не проверено
    assert rows['Учителева А.А.'] == [2, 0, 1, 1, 0, 0, 0, 2, 1]
    assert rows['Педагогов Б.Б.'] == [1, 0, 0, 0, 0, 0, 0, 0, 1]


def test_report_endpoint_admin_only_with_period_and_xlsx(client, repo):
    repo.insert_records(RECORDS)
    assert client.call('GET', '/report/supervisors', who='chk')[0] == 403
    status, data, _ = client.call('GET', '/report/supervisors', who='adm', query={'from': '2026-11-11', 'to': '2026-11-30'})
    assert status == 200 and data['rows'] == [['Учителева А.А.', 1, 0, 0, 1, 0, 0, 0, 1, 0]]
    status, body, headers = client.call('GET', '/report/supervisors', who='adm', query={'format': 'xlsx'})
    assert status == 200 and 'attachment' in headers['Content-Disposition']
    assert client.call('GET', '/report/supervisors', who='adm', query={'from': '2026-12-01', 'to': '2026-11-01'})[0] == 400


def test_unknown_timer_payload_is_ignored(app):
    result = json.loads(app.handle_event({'messages': [{'details': {'payload': 'oops'}}]})['body'])
    assert result == [{'task': 'oops', 'ok': False, 'error': 'unknown'}]
