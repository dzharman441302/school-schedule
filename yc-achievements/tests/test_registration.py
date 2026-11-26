import base64
import io

from openpyxl import load_workbook


def competition(**changes):
    return {
        'name': 'К вершинам знаний', 'direction': 'Предметная олимпиада',
        'level': 'Муниципальный', 'form': 'Очно', 'subject': 'Математика',
        'event_date': '2026-11-25', 'deadline': '2026-11-19',
        'regulation_url': 'https://disk.yandex.ru/i/example', 'audience': 'students',
        'classes': ['8А', '8Б'], 'required': True, 'status': 'published', **changes,
    }


def create(client, **changes):
    status, data, _ = client.call('POST', '/contests', competition(**changes), who='chk')
    assert status == 201, data
    return data['contest']


def submit(client, contest, who='t1', students=None, revision=None):
    if students is None:
        students = [{'student_name': 'Иванов Пётр', 'class_name': '8б'}]
    return client.call('PUT', f"/contests/{contest['id']}/application",
                       {'students': students, 'revision': revision}, who=who)


def review(client, contest, application, action, comment=''):
    return client.call('POST', f"/contests/{contest['id']}/applications/{application['author_id']}",
                       {'action': action, 'revision': application['revision'], 'comment': comment}, who='chk')


def test_catalogue_access_draft_publication_and_eligible_classes(client):
    assert client.call('GET', '/contests')[0] == 401
    assert client.call('POST', '/contests', competition(), who='t1')[0] == 403
    assert client.call('POST', '/contests', competition(regulation_url='javascript:alert(1)'), who='chk')[0] == 400
    assert client.call('POST', '/contests', competition(classes=['15А']), who='chk')[0] == 400
    contest = create(client, status='draft')
    url = '/contests/' + contest['id']
    assert client.call('GET', '/contests', who='t1')[1]['contests'] == []
    assert client.call('GET', url, who='t1')[0] == 404
    assert submit(client, contest)[0] == 404
    status, data, _ = client.call('PUT', url, competition(revision=contest['revision']), who='chk')
    assert status == 200
    assert data['contest']['registration_open'] is True
    assert client.call('PUT', url, competition(revision=contest['revision']), who='chk')[0] == 409
    assert submit(client, contest, students=[{'student_name': 'Иванов Пётр', 'class_name': '9А'}])[0] == 400
    assert submit(client, contest)[0] == 200


def test_application_review_duplicates_and_accepted_only_export(client):
    contest = create(client)
    url = '/contests/' + contest['id']
    assert submit(client, contest, students=[{'student_name': 'Иванов Пётр', 'class_name': '8Б'}] * 2)[0] == 400
    _, data, _ = submit(client, contest)
    first = data['application']
    assert first['students'][0]['class_name'] == '8Б'
    assert submit(client, contest)[0] == 409
    assert client.call('GET', url, who='t2')[1]['contest']['mine'] is None
    assert client.call('GET', url + '/applications', who='t2')[0] == 403
    assert client.call('GET', url + '/applications.xlsx', who='t2')[0] == 403
    _, other, _ = submit(client, contest, who='t2')
    second = other['application']
    _, listing, _ = client.call('GET', url + '/applications', who='chk')
    assert listing['missing_classes'] == ['8А']
    assert all(app['duplicate_students'] for app in listing['applications'])
    assert review(client, contest, first, 'return')[0] == 400
    _, returned, _ = review(client, contest, first, 'return', 'Исправьте ФИО')
    assert client.call('GET', url, who='t1')[1]['contest']['mine']['return_comment'] == 'Исправьте ФИО'
    assert review(client, contest, first, 'accept')[0] == 409
    _, resubmitted, _ = submit(client, contest, revision=returned['application']['revision'],
                               students=[{'student_name': 'Петрова Анна', 'class_name': '8А'}])
    assert review(client, contest, resubmitted['application'], 'accept')[0] == 200
    assert review(client, contest, second, 'return', 'Нужно уточнение')[0] == 200
    status, xlsx, headers = client.call('GET', url + '/applications.xlsx', who='chk')
    assert status == 200 and headers['Cache-Control'] == 'no-store'
    sheet = load_workbook(io.BytesIO(base64.b64decode(xlsx))).active
    assert [row[1:3] for row in list(sheet.values)[1:]] == [('Петрова Анна', '8А')]


def test_deadline_is_inclusive_in_moscow_and_staff_submit_themselves(client, clock):
    from datetime import datetime
    from achievements.config import MSK

    staff = create(client, audience='staff', classes=[], required=False)
    clock.t = datetime(2026, 11, 19, 23, 59, 59, tzinfo=MSK).timestamp()
    status, data, _ = submit(client, staff, students=[])
    assert status == 200
    assert data['application']['students'] == [{'student_name': 'Учителева А.А.', 'class_name': ''}]
    clock.t += 1
    assert submit(client, staff, who='t2', students=[])[0] == 409
    url = '/contests/' + staff['id']
    assert client.call('GET', url, who='t1')[1]['contest']['registration_open'] is False


def test_closing_registration_does_not_remove_existing_applications(client):
    contest = create(client)
    url = '/contests/' + contest['id']
    assert submit(client, contest)[0] == 200
    assert client.call('PUT', url, competition(status='closed', revision=contest['revision']), who='chk')[0] == 200
    status, data, _ = client.call('GET', url, who='t1')
    assert status == 200 and not data['contest']['registration_open'] and data['contest']['mine']
    assert submit(client, contest, who='t2')[0] == 409


def test_changing_eligible_classes_requires_resolving_affected_application(client):
    contest = create(client, event_date='')
    url = '/contests/' + contest['id']
    assert contest['event_date'] is None
    _, body, _ = submit(client, contest)
    change = competition(classes=['8А'], event_date='', revision=contest['revision'])
    assert client.call('PUT', url, change, who='chk')[0] == 409
    assert review(client, contest, body['application'], 'return', 'Уточните класс')[0] == 200
    assert client.call('PUT', url, change, who='chk')[0] == 200
    assert client.call('GET', url, who='t1')[1]['contest']['mine']['status'] == 'returned'


def test_catalogue_integrates_with_achievement_suggestions_without_pupil_data(client):
    contest = create(client)
    create(client, status='draft')
    assert submit(client, contest)[0] == 200
    status, response, _ = client.call('GET', '/dictionaries', who='t1')
    assert status == 200
    assert [c['id'] for c in response['contests']] == [contest['id'], 'c1']
    assert 'Иванов Пётр' not in str(response)
