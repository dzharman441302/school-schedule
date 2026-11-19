import io
from urllib.parse import parse_qs, urlsplit

from openpyxl import load_workbook

from achievements import config
from achievements.contests import parse_contests
from achievements.s3 import presign
from conftest import ORIGIN, form

STUDENT = 'Иванов Пётр Сергеевич'


def create(client, who='t1', **over):
    status, data, _ = client.call('POST', '/records', form(**over), who=who)
    assert status == 201, data
    return data['ids']


def test_create_splits_form_and_defaults_supervisor(client, repo):
    ids = create(client)
    assert len(ids) == 2
    recs = [repo.get_record(i) for i in ids]
    assert {r['supervisor_id'] for r in recs} == {'t1'}
    assert {r['status'] for r in recs} == {'new'}
    assert sorted(r['student_name'] for r in recs) == ['Иванов Пётр Сергеевич', 'Петрова Анна']


def test_create_with_other_supervisor(client, repo):
    ids = create(client, supervisor_id='t2')
    assert repo.get_record(ids[0])['supervisor_id'] == 't2'


def test_validation_errors_are_returned(client):
    status, data, _ = client.call('POST', '/records', form(level='Галактический'), who='t1')
    assert status == 400 and data['errors'][0]['field'] == 'level'


def test_daily_limit_200(client):
    students = [{'student_name': 'Иванов Пётр', 'class_name': '5А', 'result': 'Участник', 'consent': False}] * 40
    for _ in range(5):
        assert client.call('POST', '/records', form(students), who='t1')[0] == 201
    status, data, _ = client.call('POST', '/records', form(students[:1]), who='t1')
    assert status == 429
    assert client.call('POST', '/records', form(students[:1]), who='t2')[0] == 201


def test_teacher_sees_only_own_or_supervised(client):
    create(client, who='t1')
    create(client, who='t2', supervisor_id='t1')
    create(client, who='t2')
    _, mine1, _ = client.call('GET', '/records/mine', who='t1')
    _, mine2, _ = client.call('GET', '/records/mine', who='t2')
    assert len(mine1['records']) == 4  # 2 свои + 2 как руководитель
    assert len(mine2['records']) == 4  # 2 своих с руководителем t1 + 2 своих
    assert all(r['author_id'] == 't1' or r['supervisor_id'] == 't1' for r in mine1['records'])
    _, mine_chk, _ = client.call('GET', '/records/mine', who='chk')
    assert mine_chk['records'] == []


def test_teacher_cannot_review(client):
    rid = create(client)[0]
    assert client.call('GET', '/review', who='t1')[0] == 403
    assert client.call('POST', f'/review/{rid}', {'action': 'check'}, who='t1')[0] == 403
    assert client.call('POST', '/review', {'action': 'check', 'ids': [rid]}, who='t1')[0] == 403
    assert client.call('GET', '/export.xlsx', who='t1')[0] == 403


def test_only_author_edits_and_deletes(client):
    rid = create(client)[0]
    assert client.call('PUT', f'/records/{rid}', {'result': 'Победитель'}, who='t2')[0] == 403
    assert client.call('DELETE', f'/records/{rid}', who='t2')[0] == 403
    status, data, _ = client.call('PUT', f'/records/{rid}', {'result': 'Победитель'}, who='t1')
    assert status == 200 and data['record']['result'] == 'Победитель'


def test_returned_record_goes_back_to_new_after_edit(client, repo):
    rid = create(client)[0]
    assert client.call('POST', f'/review/{rid}', {'action': 'return'}, who='chk')[0] == 400  # без комментария
    status, data, _ = client.call('POST', f'/review/{rid}', {'action': 'return', 'comment': 'Нет диплома'}, who='chk')
    assert status == 200 and data['record']['status'] == 'returned'
    _, mine, _ = client.call('GET', '/records/mine', who='t1')
    assert mine['records'][0]['id'] == rid and mine['records'][0]['return_comment'] == 'Нет диплома'
    client.call('PUT', f'/records/{rid}', {'class_name': '8В'}, who='t1')
    rec = repo.get_record(rid)
    assert rec['status'] == 'new' and rec['class_name'] == '8В' and rec['return_comment'] is None


def test_checked_record_is_locked_for_author(client, repo):
    rid = create(client)[0]
    assert client.call('POST', f'/review/{rid}', {'action': 'check'}, who='chk')[0] == 200
    assert repo.get_record(rid)['checker_id'] == 'chk'
    assert client.call('PUT', f'/records/{rid}', {'result': 'Победитель'}, who='t1')[0] == 409
    assert client.call('DELETE', f'/records/{rid}', who='t1')[0] == 409


def test_soft_delete(client, repo):
    rid = create(client)[0]
    assert client.call('DELETE', f'/records/{rid}', who='t1')[0] == 200
    assert repo.get_record(rid)['deleted'] is True
    _, mine, _ = client.call('GET', '/records/mine', who='t1')
    assert rid not in [r['id'] for r in mine['records']]


def test_review_queue_filters_and_bulk_check(client):
    ids = create(client)
    create(client, who='t2', level='Региональный')
    _, data, _ = client.call('GET', '/review', who='chk')
    assert data['counts']['new'] == 4 and len(data['records']) == 4
    _, data, _ = client.call('GET', '/review', who='chk', query={'level': 'Региональный'})
    assert len(data['records']) == 2
    _, data, _ = client.call('GET', '/review', who='chk', query={'supervisor_id': 't1', 'no_diploma': '1'})
    assert len(data['records']) == 2
    status, data, _ = client.call('POST', '/review', {'action': 'check', 'ids': ids + ['missing']}, who='chk')
    assert data == {'checked': 2, 'skipped': 1, 'ids': ids}
    _, data, _ = client.call('GET', '/review', who='adm', query={'status': 'checked'})
    assert len(data['records']) == 2


def test_diploma_upload_and_download_permissions(client, repo, storage):
    rid = create(client, supervisor_id='t2')[0]
    body = {'record_id': rid, 'content_type': 'image/jpeg', 'size': 500_000}
    status, other, _ = client.call('POST', '/diploma-upload-url', body, who='chk')
    assert status == 403
    status, up, _ = client.call('POST', '/diploma-upload-url', body, who='t1')
    assert status == 200
    q = parse_qs(urlsplit(up['upload_url']).query)
    assert q['X-Amz-SignedHeaders'] == ['content-length;content-type;host']
    assert repo.get_record(rid)['diploma_key'].startswith(f'diplomas/{rid}/')
    # повторная загрузка заменяет старый файл
    old_key = repo.get_record(rid)['diploma_key']
    assert client.call('POST', '/diploma-upload-url', body, who='t2')[0] == 200
    assert storage.deleted == [old_key]

    rid_other = create(client, who='adm')[0]
    for who, expected in [('t1', 200), ('t2', 200), ('chk', 200), ('adm', 200)]:
        assert client.call('GET', f'/records/{rid}/diploma', who=who)[0] == expected, who
    client.call('POST', '/diploma-upload-url', {**body, 'record_id': rid_other}, who='adm')
    assert client.call('GET', f'/records/{rid_other}/diploma', who='t1')[0] == 403
    status, dl, _ = client.call('GET', f'/records/{rid}/diploma', who='chk')
    assert parse_qs(urlsplit(dl['url']).query)['X-Amz-Expires'] == ['300']


def test_diploma_type_and_size_limits(client):
    rid = create(client)[0]
    for ct, size in [('image/gif', 100), ('image/jpeg', config.DIPLOMA_MAX_BYTES + 1), ('image/jpeg', 0), ('application/pdf', '1')]:
        body = {'record_id': rid, 'content_type': ct, 'size': size}
        assert client.call('POST', '/diploma-upload-url', body, who='t1')[0] == 400, (ct, size)


def test_no_diploma_returns_404(client):
    rid = create(client)[0]
    assert client.call('GET', f'/records/{rid}/diploma', who='t1')[0] == 404


def test_sigv4_matches_aws_reference_example():
    # Пример из документации AWS «Authenticating Requests: Using Query Parameters».
    url = presign('GET', host='examplebucket.s3.amazonaws.com', path='/test.txt', access_key='AKIAIOSFODNN7EXAMPLE',
                  secret_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', expires=86400, now=1369353600, region='us-east-1')
    assert url.endswith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')


def test_audit_and_logs_have_no_student_names(client, repo, capsys):
    rid = create(client)[0]
    client.call('GET', '/records/mine', who='t1')
    client.call('PUT', f'/records/{rid}', {'student_name': 'Сидоров Иван'}, who='t1')
    client.call('GET', '/review', who='chk')
    client.call('POST', '/records', form([{'student_name': 'Ошибкин Ivan', 'class_name': '5А', 'result': 'Участник', 'consent': True}]), who='t1')
    out = capsys.readouterr().out
    for name in (STUDENT, 'Петрова', 'Сидоров', 'Ошибкин'):
        assert name not in out
        assert all(name not in str(a) for a in repo.audit)
    actions = [a['action'] for a in repo.audit]
    assert {'create', 'list_mine', 'update', 'review_list'} <= set(actions)


def test_cors_and_no_store(client):
    _, _, headers = client.call('GET', '/staff')
    assert headers['Access-Control-Allow-Origin'] == ORIGIN
    assert headers['Cache-Control'] == 'no-store'
    _, _, headers = client.call('GET', '/staff', origin='https://evil.example')
    assert 'Access-Control-Allow-Origin' not in headers
    _, _, headers = client.call('GET', '/staff', origin='https://dzharman441302.github.io')
    assert headers['Access-Control-Allow-Origin'] == 'https://dzharman441302.github.io'
    resp = client.app.handle_event({'httpMethod': 'OPTIONS', 'url': '/records', 'headers': {'Origin': ORIGIN}})
    assert resp['statusCode'] == 204 and 'Authorization' in resp['headers']['Access-Control-Allow-Headers']


def test_dictionaries_include_contests(client):
    status, data, _ = client.call('GET', '/dictionaries', who='t1')
    assert status == 200
    assert data['contests'][0] == {'id': 'c1', 'name': 'Олимпиада по математике', 'direction': 'Предметная олимпиада',
                                   'level': 'Муниципальный', 'subject': 'Математика', 'date': ''}
    assert '1А' in data['classes'] and data['school_year'] == 2026


def test_contests_parser_tolerates_missing_columns():
    assert parse_contests('') == []
    assert parse_contests('Что-то\nабв\n') == []
    items = parse_contests('Мероприятие,Уровень\n«Кенгуру»,Какой-то\n,Школьный\n')
    assert items == [{'id': None, 'name': '«Кенгуру»', 'direction': '', 'level': '', 'subject': '', 'date': ''}]


def test_export_xlsx(client):
    rid = create(client)[0]
    client.call('POST', f'/review/{rid}', {'action': 'check'}, who='chk')
    status, body, headers = client.call('GET', '/export.xlsx', who='chk')
    assert status == 200 and 'attachment' in headers['Content-Disposition']
    import base64
    ws = load_workbook(io.BytesIO(base64.b64decode(body)))['Достижения']
    rows = list(ws.values)
    assert rows[0][:3] == ('№', 'Дата', 'Мероприятие') and rows[0][-1] == 'Комментарий проверяющего'
    assert len(rows) == 3
    assert {r[13] for r in rows[1:]} == {'Да', 'Нет'}
    assert rows[1][1] == '10.11.2026' and rows[1][10] == 'Учителева А.А.'


def test_admin_staff_management(client, repo):
    assert client.call('GET', '/admin/staff', who='chk')[0] == 403
    status, data, _ = client.call('GET', '/admin/staff', who='adm')
    assert status == 200 and 'pin_hash' not in data['staff'][0]
    assert client.call('PUT', '/admin/staff/t2', {'role': 'checker'}, who='adm')[0] == 200
    assert repo.get_staff('t2')['role'] == 'checker'
    assert client.call('GET', '/review', who='t2')[0] == 200
    assert client.call('PUT', '/admin/staff/adm', {'role': 'teacher'}, who='adm')[0] == 409


def test_unknown_route_and_bad_json(client):
    assert client.call('GET', '/nope')[0] == 404
    resp = client.app.handle_event({'httpMethod': 'POST', 'url': '/login', 'headers': {}, 'body': '{bad'})
    assert resp['statusCode'] == 400


def test_gateway_template_path_falls_back_to_greedy_param(app):
    resp = app.handle_event({'httpMethod': 'GET', 'path': '/{path+}', 'pathParams': {'path': 'staff'}, 'headers': {}})
    assert resp['statusCode'] == 200
