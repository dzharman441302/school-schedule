"""HTTP API «Достижений учащихся»: роутинг, роли, аудит.

В логи пишутся только метод, маршрут, код ответа, id и количества — никаких ФИО.
"""
from __future__ import annotations

import base64
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import urlsplit

from . import auth, config, jobs, registration
from .contests import ContestsCache
from .export import REPORT_COLUMNS, build_competition_export, build_registry, build_supervisors_report, supervisors_report
from .repo import Repo
from .validation import (ValidationError, clean_text, school_year_range, school_year_start, split_form,
                         validate_event, validate_student)

ALL = ('teacher', 'checker', 'admin')
CHECKERS = ('checker', 'admin')
ADMIN = ('admin',)
MAX_BODY = 256 * 1024
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
EVENT_FIELDS = ('event_name', 'contest_id', 'direction', 'level', 'form', 'subject', 'event_date', 'supervisor_id')
STUDENT_FIELDS = ('student_name', 'class_name', 'result', 'consent')


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, errors: list | None = None):
        super().__init__(code)
        self.status, self.code, self.message, self.errors = status, code, message, errors


@dataclass
class Request:
    method: str
    path: str
    headers: dict
    query: dict
    body: object
    ip: str
    params: dict = field(default_factory=dict)
    user: dict | None = None


@dataclass
class Response:
    status: int
    body: object = None
    content_type: str = 'application/json; charset=utf-8'
    filename: str | None = None


def _new_id() -> str:
    return uuid.uuid4().hex


class App:
    def __init__(self, repo: Repo, settings: config.Settings, *, clock=time.time,
                 contests: ContestsCache | None = None, storage=None, disk=None):
        self.repo, self.settings, self.clock = repo, settings, clock
        self.contests = contests or ContestsCache(settings.sheet_id, settings.contests_sheet, clock=clock)
        self.storage = storage
        self.disk = disk or jobs.YandexDisk(settings.yadisk_token)
        self._audit: list[dict] = []
        r = re.compile
        I = r'(?P<id>[0-9a-zA-Z_-]{1,64})'
        A = r'(?P<author_id>[0-9a-zA-Z_-]{1,64})'
        self.routes = [
            ('POST', r(r'^/login$'), self.login, None),
            ('GET', r(r'^/staff$'), self.staff_public, None),
            ('GET', r(r'^/me$'), self.me, ALL),
            ('GET', r(r'^/dictionaries$'), self.dictionaries, ALL),
            ('GET', r(r'^/public/upcoming-olympiads$'), self.upcoming_olympiads, None),
            ('GET', r(r'^/contests$'), self.list_competitions, ALL),
            ('POST', r(r'^/contests$'), self.create_competition, CHECKERS),
            ('GET', r(rf'^/contests/{I}$'), self.get_competition, ALL),
            ('PUT', r(rf'^/contests/{I}$'), self.update_competition, CHECKERS),
            ('PUT', r(rf'^/contests/{I}/application$'), self.submit_application, ALL),
            ('GET', r(rf'^/contests/{I}/applications$'), self.list_applications, CHECKERS),
            ('POST', r(rf'^/contests/{I}/applications/{A}$'), self.review_application, CHECKERS),
            ('GET', r(rf'^/contests/{I}/applications\.xlsx$'), self.export_applications, CHECKERS),
            ('POST', r(r'^/records$'), self.create_records, ALL),
            ('GET', r(r'^/records/mine$'), self.my_records, ALL),
            ('PUT', r(rf'^/records/{I}$'), self.update_record, ALL),
            ('DELETE', r(rf'^/records/{I}$'), self.delete_record, ALL),
            ('GET', r(rf'^/records/{I}/diploma$'), self.diploma_get, ALL),
            ('POST', r(r'^/diploma-upload-url$'), self.diploma_upload, ALL),
            ('GET', r(r'^/review$'), self.review_list, CHECKERS),
            ('POST', r(r'^/review$'), self.review_bulk, CHECKERS),
            ('POST', r(rf'^/review/{I}$'), self.review_one, CHECKERS),
            ('GET', r(r'^/export\.xlsx$'), self.export, CHECKERS),
            ('GET', r(r'^/admin/staff$'), self.admin_staff, ADMIN),
            ('PUT', r(rf'^/admin/staff/{I}$'), self.admin_staff_update, ADMIN),
            ('POST', r(rf'^/admin/staff/{I}/pin$'), self.admin_pin, ADMIN),
            ('POST', r(r'^/admin/export-disk$'), self.admin_export_disk, CHECKERS),
            ('POST', r(r'^/admin/publish$'), self.admin_publish, CHECKERS),
            ('GET', r(r'^/report/supervisors$'), self.report_supervisors, ADMIN),
        ]

    # ------------------------------------------------------------------ entry

    def handle_event(self, event: dict) -> dict:
        """Событие Yandex API Gateway → ответ Cloud Functions. Событие таймера — фоновая задача."""
        if isinstance(event.get('messages'), list):
            return self.handle_timer(event)
        headers = {str(k).lower(): str(v) for k, v in (event.get('headers') or {}).items()}
        raw_url = event.get('url') or event.get('path') or '/'
        path = urlsplit(raw_url).path or '/'
        if '{' in path:  # шаблон маршрута шлюза вместо настоящего пути — берём жадный параметр
            params = event.get('pathParams') or event.get('params') or {}
            path = '/' + str(params.get('path') or '').lstrip('/')
        method = str(event.get('httpMethod') or 'GET').upper()
        origin = headers.get('origin', '')
        ip = ((event.get('requestContext') or {}).get('identity') or {}).get('sourceIp') or 'unknown'
        if method == 'OPTIONS':
            return self._to_yc(Response(204), origin)
        body = event.get('body') or ''
        if event.get('isBase64Encoded') and body:
            try:
                body = base64.b64decode(body).decode('utf-8')
            except (ValueError, UnicodeDecodeError):
                body = '\x00'
        resp = self.handle(method, path, headers, event.get('queryStringParameters') or {}, body, ip)
        return self._to_yc(resp, origin)

    # ------------------------------------------------------------------ timers

    TASKS = ('export_disk', 'publish')

    def run_task(self, task: str) -> dict:
        """Выгрузка и публикация. Ошибку пишем в лог кодом; следующий запуск таймера повторит."""
        now = self.now()
        try:
            if task == 'export_disk':
                result = jobs.export_to_disk(self.repo, self.settings, self.disk, now)
            elif task == 'publish':
                result = jobs.publish_public(self.repo, self.settings, self.storage, now)
            else:
                return {'task': task, 'ok': False, 'error': 'unknown'}
        except Exception as exc:
            code = str(exc) if isinstance(exc, (jobs.JobError, RuntimeError)) else type(exc).__name__
            print(f'task {task} failed: {code[:60]}')
            return {'task': task, 'ok': False, 'error': code[:60]}
        print(f'task {task} ok: {result}')
        return {'task': task, 'ok': True, **result}

    def handle_timer(self, event: dict) -> dict:
        results = []
        for message in event['messages']:
            payload = str(((message or {}).get('details') or {}).get('payload') or '').strip()
            results.append(self.run_task(payload))
        return {'statusCode': 200, 'body': json.dumps(results, ensure_ascii=False)}

    def handle(self, method: str, path: str, headers: dict, query: dict, body: str, ip: str) -> Response:
        self._audit = []
        name, status, staff_id = '-', 500, '-'
        try:
            if len(body or '') > MAX_BODY:
                raise ApiError(413, 'too_large', 'Слишком большой запрос')
            parsed = None
            if body:
                try:
                    parsed = json.loads(body)
                except json.JSONDecodeError:
                    raise ApiError(400, 'bad_json', 'Неверный формат запроса')
            req = Request(method, path.rstrip('/') or '/', headers, query, parsed, ip)
            handler, roles = self._route(req)
            name = handler.__name__
            if roles is not None:
                req.user = self._authenticate(req)
                staff_id = req.user['id']
                if req.user['role'] not in roles:
                    raise ApiError(403, 'forbidden', 'Недостаточно прав')
            resp = handler(req)
        except ValidationError as e:
            resp = Response(400, {'error': 'validation', 'message': 'Проверьте поля формы', 'errors': e.errors})
        except ApiError as e:
            payload = {'error': e.code, 'message': e.message}
            if e.errors:
                payload['errors'] = e.errors
            resp = Response(e.status, payload)
        except Exception as exc:  # текст исключения может содержать данные — в лог только тип
            print(f'error: {name} {type(exc).__name__}')
            resp = Response(500, {'error': 'internal', 'message': 'Ошибка сервера, попробуйте позже'})
        status = resp.status
        if self._audit:
            try:
                self.repo.add_audit(self._audit)
            except Exception as exc:
                print(f'error: audit {type(exc).__name__}')
        print(f'{method} {name} {status} staff={staff_id}')
        return resp

    def _route(self, req: Request):
        allowed = False
        for method, pattern, handler, roles in self.routes:
            m = pattern.match(req.path)
            if not m:
                continue
            allowed = True
            if method == req.method:
                req.params = m.groupdict()
                return handler, roles
        if allowed:
            raise ApiError(405, 'method', 'Метод не поддерживается')
        raise ApiError(404, 'not_found', 'Нет такого адреса')

    def _to_yc(self, resp: Response, origin: str) -> dict:
        headers = {'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin'}
        if origin and origin in self.settings.allowed_origins:
            headers.update({
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Expose-Headers': 'Content-Disposition',
                'Access-Control-Max-Age': '600',
            })
        elif self.settings.allowed_origins:
            # Без своего заголовка API Gateway подставляет «*». Явный адрес школы: браузер
            # на чужом сайте ответ не отдаст.
            headers['Access-Control-Allow-Origin'] = self.settings.allowed_origins[0]
        if resp.body is None:
            return {'statusCode': resp.status, 'headers': headers, 'body': '', 'isBase64Encoded': False}
        headers['Content-Type'] = resp.content_type
        if isinstance(resp.body, bytes):
            if resp.filename:
                headers['Content-Disposition'] = f"attachment; filename*=UTF-8''{_quote(resp.filename)}"
            return {'statusCode': resp.status, 'headers': headers,
                    'body': base64.b64encode(resp.body).decode('ascii'), 'isBase64Encoded': True}
        return {'statusCode': resp.status, 'headers': headers,
                'body': json.dumps(resp.body, ensure_ascii=False), 'isBase64Encoded': False}

    # ----------------------------------------------------------------- helpers

    def now(self) -> float:
        return float(self.clock())

    def today(self):
        return datetime.fromtimestamp(self.now(), config.MSK).date()

    def audit(self, user: dict | None, action: str, record_id: str | None = None, details: str = '', staff_id: str | None = None):
        self._audit.append({'id': _new_id(), 'at': self.now(), 'staff_id': staff_id or (user or {}).get('id'),
                            'action': action, 'record_id': record_id, 'details': details})

    def _body(self, req: Request) -> dict:
        if not isinstance(req.body, dict):
            raise ApiError(400, 'bad_json', 'Ожидался объект JSON')
        return req.body

    @staticmethod
    def _pin_version(staff: dict) -> int:
        return int(round(float(staff.get('pin_set_at') or 0) * 1000))

    def _authenticate(self, req: Request) -> dict:
        header = req.headers.get('authorization', '')
        token = header[7:].strip() if header.lower().startswith('bearer ') else ''
        payload = auth.read_token(self.settings.token_secret, token, self.now())
        if not payload:
            raise ApiError(401, 'auth', 'Войдите заново')
        staff = self.repo.get_staff(str(payload.get('sid', '')))
        if not staff or not staff.get('active') or not staff.get('pin_hash') or payload.get('pv') != self._pin_version(staff):
            raise ApiError(401, 'auth', 'Войдите заново')
        return staff

    def _staff_names(self) -> dict[str, str]:
        return {s['id']: s['short_name'] for s in self.repo.list_staff()}

    def _year(self, req: Request) -> int:
        raw = str(req.query.get('year') or '').strip()
        if not raw:
            return school_year_start(self.today())
        if not re.fullmatch(r'20\d\d', raw):
            raise ApiError(400, 'bad_year', 'Неверный учебный год')
        return int(raw)

    def _record(self, record_id: str) -> dict:
        rec = self.repo.get_record(record_id)
        if not rec or rec.get('deleted'):
            raise ApiError(404, 'not_found', 'Запись не найдена')
        return rec

    def _view(self, r: dict, names: dict[str, str], user: dict) -> dict:
        return {
            'id': r['id'], 'event_name': r['event_name'], 'contest_id': r['contest_id'], 'direction': r['direction'],
            'level': r['level'], 'form': r['form'], 'subject': r['subject'] or '', 'event_date': r['event_date'],
            'class_name': r['class_name'], 'student_name': r['student_name'], 'result': r['result'],
            'consent': bool(r['consent']), 'author_id': r['author_id'], 'author_name': names.get(r['author_id'] or '', ''),
            'supervisor_id': r['supervisor_id'], 'supervisor_name': names.get(r['supervisor_id'] or '', ''),
            'status': r['status'], 'return_comment': r['return_comment'] or '', 'has_diploma': bool(r['diploma_key']),
            'created_at': r['created_at'], 'updated_at': r['updated_at'], 'checked_at': r['checked_at'],
            'can_edit': r['author_id'] == user['id'] and r['status'] in ('new', 'returned'),
        }

    def _limit(self, key: str) -> dict:
        return self.repo.get_limit(key) or {'key': key, 'count': 0, 'window_start': 0.0, 'locked_until': 0.0}

    # ------------------------------------------------------------------ login

    def login(self, req: Request) -> Response:
        now = self.now()
        ip_limit = self._limit(f'ip:{req.ip}')
        if now - float(ip_limit['window_start'] or 0) > config.IP_WINDOW_SECONDS:
            ip_limit.update(count=0, window_start=now)
        ip_limit['count'] = int(ip_limit['count'] or 0) + 1
        self.repo.put_limit(ip_limit)
        if ip_limit['count'] > config.IP_MAX_LOGINS:
            raise ApiError(429, 'rate_limited', 'Слишком много попыток входа. Подождите 10 минут.')

        data = self._body(req)
        staff_id, pin = str(data.get('staff_id') or '')[:64], str(data.get('pin') or '')
        staff = self.repo.get_staff(staff_id) if staff_id else None
        if staff and not staff.get('active'):
            staff = None
        lock = self._limit(f'staff:{staff_id}') if staff else None
        if lock and float(lock['locked_until'] or 0) > now:
            minutes = max(1, int((float(lock['locked_until']) - now + 59) // 60))
            raise ApiError(423, 'locked', f'Вход заблокирован после 5 неверных PIN. Попробуйте через {minutes} мин.')

        ok = auth.is_valid_pin_format(pin) and auth.verify_pin(pin, staff.get('pin_hash') if staff else None)
        if not ok:
            if staff:
                lock['count'] = int(lock['count'] or 0) + 1
                left = config.PIN_FAIL_LIMIT - lock['count']
                if left <= 0:
                    lock.update(count=0, locked_until=now + config.PIN_LOCK_SECONDS)
                self.repo.put_limit(lock)
                self.audit(None, 'login_fail', staff_id=staff['id'])
                if left <= 0:
                    raise ApiError(423, 'locked', 'Вход заблокирован на 15 минут после 5 неверных PIN.')
                raise ApiError(401, 'bad_pin', f'Неверный PIN. Осталось попыток: {left}')
            raise ApiError(401, 'bad_pin', 'Неверный PIN')

        lock.update(count=0, locked_until=0.0)
        self.repo.put_limit(lock)
        exp = now + config.TOKEN_TTL
        token = auth.make_token(self.settings.token_secret, {'sid': staff['id'], 'pv': self._pin_version(staff), 'exp': exp})
        self.audit(staff, 'login')
        return Response(200, {'token': token, 'expires_at': exp,
                              'staff': {'id': staff['id'], 'short_name': staff['short_name'], 'role': staff['role']}})

    def staff_public(self, req: Request) -> Response:
        items = sorted((s for s in self.repo.list_staff() if s.get('active')), key=lambda s: s['short_name'])
        return Response(200, {'staff': [{'id': s['id'], 'short_name': s['short_name']} for s in items]})

    def me(self, req: Request) -> Response:
        u = req.user
        return Response(200, {'staff': {'id': u['id'], 'short_name': u['short_name'], 'role': u['role']}})

    def dictionaries(self, req: Request) -> Response:
        year = school_year_start(self.today())
        managed_contests = [
            {**{key: c[key] for key in ('id', 'name', 'direction', 'level', 'subject', 'form')}, 'date': c['event_date']}
            for contest_year in (year, year - 1) for c in self.repo.list_competitions(contest_year)
            if c['status'] != 'draft' and c['audience'] == 'students'
        ]
        return Response(200, {
            'directions': config.DIRECTIONS, 'levels': config.LEVELS, 'forms': config.FORMS,
            'results': config.RESULTS, 'classes': self.settings.classes, 'contests': managed_contests + self.contests.get(),
            'school_year': year,
            'limits': {'students_per_form': config.MAX_STUDENTS_PER_FORM, 'diploma_bytes': config.DIPLOMA_MAX_BYTES,
                       'diploma_types': list(config.DIPLOMA_TYPES)},
        })

    # ---------------------------------------------------- competitions and applications

    def upcoming_olympiads(self, req):
        """ТВ в учительской: только опубликованные карточки, без заявок и служебных полей."""
        today = self.today()
        iso = today.isoformat()
        year = school_year_start(today)
        fields = ('name', 'subject', 'event_date', 'deadline', 'audience', 'classes', 'status')
        items = []
        for contest_year in (year, year + 1):
            for c in self.repo.list_competitions(contest_year):
                if c['direction'] != 'Предметная олимпиада' or c['status'] not in ('published', 'closed'):
                    continue
                # Закрытый приём не отменяет предстоящее мероприятие. Без даты проведения
                # ориентируемся на срок подачи заявок, пока приём ещё открыт.
                if c['event_date']:
                    if c['event_date'] < iso:
                        continue
                elif not registration.registration_open(c, today):
                    continue
                items.append({key: c[key] for key in fields})
        items.sort(key=lambda c: (c['event_date'] or c['deadline'], c['name'].casefold()))
        return Response(200, {'olympiads': items})

    def _competition(self, req):
        contest = self.repo.get_competition(req.params['id'])
        if not contest or (contest['status'] == 'draft' and req.user['role'] not in CHECKERS):
            raise ApiError(404, 'not_found', 'Конкурс не найден')
        return contest

    def _competition_view(self, contest, mine=None):
        return {**contest, 'registration_open': registration.registration_open(contest, self.today()), 'mine': mine}

    @staticmethod
    def _check_revision(saved):
        if not saved:
            raise ApiError(409, 'changed', 'Данные изменились. Обновите список и повторите действие')

    def list_competitions(self, req):
        year = self._year(req)
        own = {a['contest_id']: a for a in self.repo.author_applications(req.user['id'])}
        items = [self._competition_view(c, own.get(c['id'])) for c in self.repo.list_competitions(year)
                 if c['status'] != 'draft' or req.user['role'] in CHECKERS]
        items.sort(key=lambda c: (not c['registration_open'], c['deadline'], c['name'].casefold()))
        return Response(200, {'school_year': year, 'current_year': school_year_start(self.today()),
                              'classes': self.settings.classes, 'directions': config.DIRECTIONS,
                              'levels': config.LEVELS, 'forms': config.FORMS, 'contests': items})

    def get_competition(self, req):
        contest = self._competition(req)
        mine = self.repo.get_application(contest['id'], req.user['id'])
        return Response(200, {'contest': self._competition_view(contest, mine)})

    def create_competition(self, req):
        contest = registration.validate_competition(self._body(req), self.today(), self.settings.classes)
        contest.update(id=_new_id(), revision=_new_id())
        self._check_revision(self.repo.save_competition(contest, None))
        self.audit(req.user, 'contest_create', contest['id'], details=contest['status'])
        return Response(201, {'contest': self._competition_view(contest)})

    def update_competition(self, req):
        previous = self._competition(req)
        data = self._body(req)
        self._check_revision(data.get('revision') == previous['revision'])
        contest = registration.validate_competition(data, self.today(), self.settings.classes)
        if previous['status'] != 'draft' and contest['status'] == 'draft':
            raise ApiError(409, 'status', 'Опубликованный конкурс можно закрыть или открыть снова')
        if registration.scope_changes(previous, contest):
            apps = self.repo.competition_applications(previous['id'])
            if not registration.applications_fit(previous, contest, apps):
                raise ApiError(409, 'participants', 'Новые условия не подходят существующим заявкам')
        contest.update(id=previous['id'], revision=_new_id())
        self._check_revision(self.repo.save_competition(contest, previous))
        self.audit(req.user, 'contest_update', contest['id'], details=contest['status'])
        mine = self.repo.get_application(contest['id'], req.user['id'])
        return Response(200, {'contest': self._competition_view(contest, mine)})

    def submit_application(self, req):
        contest, user = self._competition(req), req.user
        if not registration.registration_open(contest, self.today()):
            raise ApiError(409, 'registration_closed', 'Приём заявок завершён или ещё не открыт')
        data = self._body(req)
        previous = self.repo.get_application(contest['id'], user['id'])
        revision = previous['revision'] if previous else None
        self._check_revision(data.get('revision') == revision)
        if previous and previous['status'] == 'accepted':
            raise ApiError(409, 'accepted', 'Заявка принята. Для правки обратитесь к ответственному')
        students = registration.validate_participants(data.get('students'), contest, user)
        app = {'contest_id': contest['id'], 'author_id': user['id'], 'students': students, 'status': 'submitted',
               'return_comment': '', 'updated_at': self.now(), 'revision': _new_id()}
        self._check_revision(self.repo.save_application(app, revision, contest['revision']))
        self.audit(user, 'contest_submit', contest['id'], details=f'count={len(students)}')
        return Response(200, {'application': app})

    def list_applications(self, req):
        contest = self._competition(req)
        apps = self.repo.competition_applications(contest['id'])
        names = self._staff_names()
        duplicates = registration.possible_duplicates(apps)
        covered = {s['class_name'] for a in apps if a['status'] != 'returned' for s in a['students']}
        for app in apps:
            app['author_name'] = names.get(app['author_id'], 'Педагог')
            app['duplicate_students'] = [s for s in app['students'] if app['status'] != 'returned'
                                         and registration.participant_key(s) in duplicates]
        apps.sort(key=lambda a: (a['status'] != 'submitted', a['author_name'], a['author_id']))
        missing = [c for c in contest['classes'] if c not in covered] if contest['required'] else []
        self.audit(req.user, 'contest_list_applications', contest['id'], details=f'count={len(apps)}')
        return Response(200, {'applications': apps, 'missing_classes': missing})

    def review_application(self, req):
        contest = self._competition(req)
        app = self.repo.get_application(contest['id'], req.params['author_id'])
        if not app:
            raise ApiError(404, 'not_found', 'Заявка не найдена')
        data = self._body(req)
        revision = app['revision']
        self._check_revision(data.get('revision') == revision)
        action = data.get('action')
        comment = clean_text(data.get('comment'), 500)
        if action == 'accept' and app['status'] == 'submitted':
            if contest['audience'] == 'students' and any(s['class_name'] not in contest['classes'] for s in app['students']):
                raise ApiError(409, 'classes', 'В заявке есть классы, которых больше нет в условиях конкурса')
            app.update(status='accepted', return_comment='')
        elif action == 'return' and app['status'] in ('submitted', 'accepted'):
            if not comment or len(comment) > 500:
                raise ApiError(400, 'comment', 'Укажите комментарий до 500 символов')
            app.update(status='returned', return_comment=comment)
        elif action in ('accept', 'return'):
            raise ApiError(409, 'status', 'Действие недоступно для текущего статуса заявки')
        else:
            raise ApiError(400, 'action', 'Неизвестное действие с заявкой')
        app.update(updated_at=self.now(), revision=_new_id())
        self._check_revision(self.repo.save_application(app, revision, contest['revision']))
        self.audit(req.user, f'contest_{action}', contest['id'], details=app['author_id'])
        return Response(200, {'application': app})

    def export_applications(self, req):
        contest = self._competition(req)
        apps = self.repo.competition_applications(contest['id'])
        names = {s['id']: s['full_name'] or s['short_name'] for s in self.repo.list_staff()}
        data = build_competition_export(contest, apps, names)
        count = sum(len(a['students']) for a in apps if a['status'] == 'accepted')
        self.audit(req.user, 'contest_export', contest['id'], details=f'count={count}')
        return Response(200, data, content_type=XLSX, filename='Участники конкурса.xlsx')

    # ---------------------------------------------------------------- records

    def _active_staff_ids(self) -> set[str]:
        return {s['id'] for s in self.repo.list_staff() if s.get('active')}

    def create_records(self, req: Request) -> Response:
        user, now = req.user, self.now()
        event, rows = split_form(self._body(req), self.today(), self._active_staff_ids(), self.settings.classes)
        day_start = datetime.combine(self.today(), datetime.min.time(), config.MSK).timestamp()
        if self.repo.count_created_since(user['id'], day_start) + len(rows) > config.MAX_RECORDS_PER_DAY:
            raise ApiError(429, 'daily_limit', f'Не больше {config.MAX_RECORDS_PER_DAY} записей в день с одного аккаунта')
        records = [{
            'id': _new_id(), 'created_at': now, 'updated_at': now, 'author_id': user['id'],
            **event, 'supervisor_id': event['supervisor_id'] or user['id'], **row,
            'diploma_key': None, 'status': 'new', 'checker_id': None, 'checked_at': None,
            'return_comment': None, 'deleted': False,
        } for row in rows]
        self.repo.insert_records(records)
        for r in records:
            self.audit(user, 'create', r['id'])
        return Response(201, {'created': len(records), 'ids': [r['id'] for r in records]})

    def my_records(self, req: Request) -> Response:
        user, year = req.user, self._year(req)
        uid = user['id']
        recs = [r for r in self.repo.list_records(*school_year_range(year))
                if r['author_id'] == uid or r['supervisor_id'] == uid]
        recs.sort(key=lambda r: (r['created_at'] or 0), reverse=True)
        recs.sort(key=lambda r: r['event_date'] or '', reverse=True)
        recs.sort(key=lambda r: r['status'] != 'returned')
        names = self._staff_names()
        self.audit(user, 'list_mine', details=f'year={year} count={len(recs)}')
        return Response(200, {'school_year': year, 'records': [self._view(r, names, user) for r in recs]})

    def update_record(self, req: Request) -> Response:
        user, rec = req.user, self._record(req.params['id'])
        if rec['author_id'] != user['id']:
            raise ApiError(403, 'forbidden', 'Править запись может только автор')
        if rec['status'] not in ('new', 'returned'):
            raise ApiError(409, 'checked', 'Запись уже проверена — правка недоступна')
        data = self._body(req)
        merged = {k: (data[k] if k in data else rec[k]) for k in EVENT_FIELDS + STUDENT_FIELDS}
        event = validate_event(merged, self.today(), self._active_staff_ids() | {rec['supervisor_id']})
        student, errors = validate_student(merged, 0, self.settings.classes)
        if errors:
            raise ValidationError([{k: v for k, v in e.items() if k != 'row'} for e in errors])
        was = rec['status']
        rec.update(event)
        rec.update(student)
        rec['supervisor_id'] = event['supervisor_id'] or rec['supervisor_id'] or user['id']
        rec.update(updated_at=self.now(), status='new', return_comment=None)
        self.repo.update_record(rec)
        self.audit(user, 'update', rec['id'], details=f'from={was}')
        return Response(200, {'record': self._view(rec, self._staff_names(), user)})

    def delete_record(self, req: Request) -> Response:
        user, rec = req.user, self._record(req.params['id'])
        if rec['author_id'] != user['id']:
            raise ApiError(403, 'forbidden', 'Удалить запись может только автор')
        if rec['status'] == 'checked':
            raise ApiError(409, 'checked', 'Запись уже проверена — удаление недоступно')
        rec.update(deleted=True, updated_at=self.now())
        self.repo.update_record(rec)
        self.audit(user, 'delete', rec['id'])
        return Response(200, {'deleted': rec['id']})

    # --------------------------------------------------------------- diplomas

    def _require_storage(self):
        if not self.storage or not self.storage.configured:
            raise ApiError(503, 'storage', 'Хранилище дипломов не настроено')

    def diploma_upload(self, req: Request) -> Response:
        user, data = req.user, self._body(req)
        rec = self._record(str(data.get('record_id') or ''))
        is_admin = user['role'] == 'admin'
        if not (is_admin or user['id'] in (rec['author_id'], rec['supervisor_id'])):
            raise ApiError(403, 'forbidden', 'Диплом загружает автор или руководитель')
        if rec['status'] == 'checked' and not is_admin:
            raise ApiError(409, 'checked', 'Запись уже проверена')
        content_type = str(data.get('content_type') or '').lower()
        ext = config.DIPLOMA_TYPES.get(content_type)
        if not ext:
            raise ApiError(400, 'bad_type', 'Диплом: только JPG, PNG или PDF')
        size = data.get('size')
        if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= config.DIPLOMA_MAX_BYTES:
            raise ApiError(400, 'bad_size', 'Файл диплома — не больше 10 МБ')
        self._require_storage()
        now = self.now()
        old_key = rec['diploma_key']
        key = f"diplomas/{rec['id']}/{_new_id()}.{ext}"
        url = self.storage.upload_url(key, content_type, size, config.DIPLOMA_PUT_TTL, now)
        rec.update(diploma_key=key, updated_at=now)
        self.repo.update_record(rec)
        if old_key:
            self.storage.delete(old_key, now)
        self.audit(user, 'diploma_upload', rec['id'], details=f'{ext} {size}')
        return Response(200, {'upload_url': url, 'method': 'PUT', 'headers': {'Content-Type': content_type},
                              'expires_in': config.DIPLOMA_PUT_TTL, 'record_id': rec['id']})

    def _diploma_url(self, rec: dict) -> str | None:
        if not rec.get('diploma_key') or not self.storage or not self.storage.configured:
            return None
        return self.storage.download_url(rec['diploma_key'], config.DIPLOMA_GET_TTL, self.now())

    def diploma_get(self, req: Request) -> Response:
        user, rec = req.user, self._record(req.params['id'])
        if not (user['role'] in CHECKERS or user['id'] in (rec['author_id'], rec['supervisor_id'])):
            raise ApiError(403, 'forbidden', 'Нет доступа к диплому')
        if not rec['diploma_key']:
            raise ApiError(404, 'no_diploma', 'Диплом не загружен')
        self._require_storage()
        self.audit(user, 'diploma_view', rec['id'])
        return Response(200, {'url': self._diploma_url(rec), 'expires_in': config.DIPLOMA_GET_TTL})

    # ----------------------------------------------------------------- review

    def review_list(self, req: Request) -> Response:
        user, q = req.user, req.query
        status = str(q.get('status') or 'new')
        if status not in config.STATUSES:
            raise ApiError(400, 'bad_status', 'Неверный статус')
        year = self._year(req)
        all_recs = self.repo.list_records(*school_year_range(year))
        recs = [r for r in all_recs if r['status'] == status]
        if q.get('level'):
            recs = [r for r in recs if r['level'] == q['level']]
        if q.get('class_name'):
            recs = [r for r in recs if r['class_name'] == str(q['class_name']).upper()]
        if q.get('supervisor_id'):
            recs = [r for r in recs if r['supervisor_id'] == q['supervisor_id']]
        if q.get('event'):
            needle = str(q['event']).casefold()
            recs = [r for r in recs if needle in (r['event_name'] or '').casefold()]
        if str(q.get('no_diploma') or '') in ('1', 'true'):
            recs = [r for r in recs if not r['diploma_key']]
        recs.sort(key=lambda r: r['created_at'] or 0, reverse=status != 'new')
        names = self._staff_names()
        items = []
        for r in recs:
            v = self._view(r, names, user)
            v['diploma_url'] = self._diploma_url(r)
            items.append(v)
        counts = {s: sum(1 for r in all_recs if r['status'] == s) for s in config.STATUSES}
        self.audit(user, 'review_list', details=f'status={status} count={len(items)}')
        return Response(200, {'school_year': year, 'status': status, 'counts': counts, 'records': items})

    def _apply_review(self, user: dict, rec: dict, action: str, comment: str) -> None:
        now = self.now()
        if action == 'check':
            if rec['status'] not in ('new', 'returned'):
                raise ApiError(409, 'state', 'Запись уже проверена')
            rec.update(status='checked', checker_id=user['id'], checked_at=now, return_comment=None)
        else:
            if rec['status'] not in ('new', 'checked'):
                raise ApiError(409, 'state', 'Запись уже возвращена')
            rec.update(status='returned', checker_id=user['id'], checked_at=now, return_comment=comment)
        rec['updated_at'] = now
        self.repo.update_record(rec)
        self.audit(user, action, rec['id'])

    def review_one(self, req: Request) -> Response:
        user, data = req.user, self._body(req)
        rec = self._record(req.params['id'])
        action = data.get('action')
        if action not in ('check', 'return'):
            raise ApiError(400, 'bad_action', 'Действие: check или return')
        comment = clean_text(data.get('comment'), 500)[:500]
        if action == 'return' and not comment:
            raise ApiError(400, 'comment', 'Напишите, что исправить')
        self._apply_review(user, rec, action, comment)
        return Response(200, {'record': self._view(rec, self._staff_names(), user)})

    def review_bulk(self, req: Request) -> Response:
        user, data = req.user, self._body(req)
        ids = data.get('ids')
        if data.get('action') != 'check':
            raise ApiError(400, 'bad_action', 'Массово можно только отметить «Проверено»')
        if not isinstance(ids, list) or not ids or len(ids) > 200 or not all(isinstance(i, str) for i in ids):
            raise ApiError(400, 'bad_ids', 'Выберите от 1 до 200 записей')
        done, skipped = [], []
        for record_id in dict.fromkeys(ids):
            rec = self.repo.get_record(record_id)
            if not rec or rec.get('deleted') or rec['status'] == 'checked':
                skipped.append(record_id)
                continue
            self._apply_review(user, rec, 'check', '')
            done.append(record_id)
        return Response(200, {'checked': len(done), 'skipped': len(skipped), 'ids': done})

    def export(self, req: Request) -> Response:
        user, year = req.user, self._year(req)
        recs = self.repo.list_records(*school_year_range(year))
        data = build_registry(recs, self._staff_names(), school_year=year, updated_at=datetime.fromtimestamp(self.now(), config.MSK))
        self.audit(user, 'export', details=f'year={year} count={len(recs)}')
        return Response(200, data, content_type=XLSX, filename=f'Реестр достижений {year}-{year + 1}.xlsx')

    # ------------------------------------------------------------------ admin

    def admin_staff(self, req: Request) -> Response:
        items = sorted(self.repo.list_staff(), key=lambda s: s['short_name'])
        return Response(200, {'staff': [{
            'id': s['id'], 'short_name': s['short_name'], 'full_name': s['full_name'], 'position': s['position'] or '',
            'role': s['role'], 'active': bool(s['active']), 'has_pin': bool(s['pin_hash']), 'pin_set_at': s['pin_set_at'],
        } for s in items]})

    def admin_staff_update(self, req: Request) -> Response:
        user, data = req.user, self._body(req)
        staff = self.repo.get_staff(req.params['id'])
        if not staff:
            raise ApiError(404, 'not_found', 'Педагог не найден')
        changes = []
        if 'role' in data:
            if data['role'] not in config.ROLES:
                raise ApiError(400, 'bad_role', 'Роль: teacher, checker или admin')
            if staff['id'] == user['id'] and data['role'] != 'admin':
                raise ApiError(409, 'self', 'Нельзя снять роль администратора с себя')
            staff['role'] = data['role']
            changes.append(f"role={data['role']}")
        if 'active' in data:
            if not isinstance(data['active'], bool):
                raise ApiError(400, 'bad_active', 'active: true или false')
            if staff['id'] == user['id'] and not data['active']:
                raise ApiError(409, 'self', 'Нельзя отключить себя')
            staff['active'] = data['active']
            changes.append(f"active={data['active']}")
        self.repo.upsert_staff(staff)
        self.audit(user, 'staff_update', details=f"staff={staff['id']} {' '.join(changes)}")
        return Response(200, {'staff': {'id': staff['id'], 'role': staff['role'], 'active': staff['active']}})

    def admin_export_disk(self, req: Request) -> Response:
        result = self.run_task('export_disk')
        self.audit(req.user, 'export_disk', details=f"ok={result['ok']}")
        if not result['ok']:
            raise ApiError(502, 'disk', f"Не удалось выгрузить на Яндекс Диск ({result['error']}). Повторится автоматически в течение часа.")
        return Response(200, result)

    def admin_publish(self, req: Request) -> Response:
        result = self.run_task('publish')
        self.audit(req.user, 'publish', details=f"ok={result['ok']}")
        if not result['ok']:
            raise ApiError(502, 'publish', f"Не удалось обновить страницу «Наши достижения» ({result['error']}).")
        return Response(200, result)

    def report_supervisors(self, req: Request) -> Response:
        date_from, date_to = _report_period(req.query, self.today())
        recs = self.repo.list_records(date_from, date_to)
        rows = supervisors_report(recs, self._staff_names())
        self.audit(req.user, 'report', details=f'{date_from}..{date_to} count={len(recs)}')
        if str(req.query.get('format') or '') == 'xlsx':
            data = build_supervisors_report(rows, date_from, date_to)
            return Response(200, data, content_type=XLSX, filename=f'Достижения по руководителям {date_from}—{date_to}.xlsx')
        return Response(200, {'from': date_from, 'to': date_to, 'columns': REPORT_COLUMNS, 'rows': rows})

    def admin_pin(self, req: Request) -> Response:
        user = req.user
        staff = self.repo.get_staff(req.params['id'])
        if not staff:
            raise ApiError(404, 'not_found', 'Педагог не найден')
        pin = auth.generate_pin()
        staff.update(pin_hash=auth.hash_pin(pin), pin_set_at=self.now())
        self.repo.upsert_staff(staff)
        self.repo.put_limit({'key': f"staff:{staff['id']}", 'count': 0, 'window_start': 0.0, 'locked_until': 0.0})
        self.audit(user, 'pin_reset', details=f"staff={staff['id']}")
        # PIN возвращается один раз и нигде не сохраняется в открытом виде.
        return Response(200, {'staff_id': staff['id'], 'short_name': staff['short_name'], 'pin': pin})


def _report_period(q: dict, today) -> tuple[str, str]:
    start = school_year_range(school_year_start(today))[0]
    date_from = str(q.get('from') or start)
    date_to = str(q.get('to') or today.isoformat())
    if not (re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_from) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_to)) or date_from > date_to:
        raise ApiError(400, 'bad_period', 'Неверный период')
    return date_from, date_to


def _quote(text: str) -> str:
    from urllib.parse import quote
    return quote(text, safe='')
