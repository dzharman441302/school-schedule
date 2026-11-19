from achievements import auth, config
from conftest import PINS


def test_pin_hash_roundtrip_and_no_plain_pin():
    h = auth.hash_pin('274915')
    assert '274915' not in h and h.startswith('scrypt$')
    assert auth.verify_pin('274915', h)
    assert not auth.verify_pin('274916', h)
    assert not auth.verify_pin('274915', None)


def test_generated_pins_are_six_digits_and_not_trivial():
    for _ in range(200):
        pin = auth.generate_pin()
        assert auth.is_valid_pin_format(pin)
        assert pin not in ('000000', '111111', '123456', '654321')


def test_token_tamper_and_expiry():
    t = auth.make_token('k', {'sid': 't1', 'exp': 100})
    assert auth.read_token('k', t, 99)['sid'] == 't1'
    assert auth.read_token('k', t, 100) is None
    assert auth.read_token('other', t, 99) is None
    body, sig = t.split('.')
    assert auth.read_token('k', body + 'x.' + sig, 99) is None


def test_login_returns_token_and_role(client):
    status, data, _ = client.call('POST', '/login', {'staff_id': 'chk', 'pin': PINS['chk']})
    assert status == 200
    assert data['staff']['role'] == 'checker'
    status, me, _ = client.call('GET', '/me', who='chk')
    assert me['staff']['id'] == 'chk'


def test_five_wrong_pins_lock_for_15_minutes(client, clock):
    for i in range(4):
        status, data, _ = client.call('POST', '/login', {'staff_id': 't1', 'pin': '000001'})
        assert status == 401
        assert f'Осталось попыток: {4 - i}' in data['message']
    status, _, _ = client.call('POST', '/login', {'staff_id': 't1', 'pin': '000001'})
    assert status == 423
    status, _, _ = client.call('POST', '/login', {'staff_id': 't1', 'pin': PINS['t1']})
    assert status == 423, 'даже верный PIN не принимается во время блокировки'
    clock.t += config.PIN_LOCK_SECONDS + 1
    status, _, _ = client.call('POST', '/login', {'staff_id': 't1', 'pin': PINS['t1']})
    assert status == 200


def test_successful_login_resets_failures(client):
    for _ in range(4):
        client.call('POST', '/login', {'staff_id': 't1', 'pin': '000001'})
    assert client.call('POST', '/login', {'staff_id': 't1', 'pin': PINS['t1']})[0] == 200
    for _ in range(4):
        assert client.call('POST', '/login', {'staff_id': 't1', 'pin': '000001'})[0] == 401


def test_lock_is_per_teacher(client):
    for _ in range(5):
        client.call('POST', '/login', {'staff_id': 't1', 'pin': '000001'})
    assert client.call('POST', '/login', {'staff_id': 't2', 'pin': PINS['t2']})[0] == 200


def test_ip_rate_limit(client, clock):
    for _ in range(config.IP_MAX_LOGINS):
        assert client.call('POST', '/login', {'staff_id': 'zzz', 'pin': '000001'}, ip='9.9.9.9')[0] == 401
    assert client.call('POST', '/login', {'staff_id': 't1', 'pin': PINS['t1']}, ip='9.9.9.9')[0] == 429
    assert client.call('POST', '/login', {'staff_id': 't1', 'pin': PINS['t1']}, ip='9.9.9.8')[0] == 200
    clock.t += config.IP_WINDOW_SECONDS + 1
    assert client.call('POST', '/login', {'staff_id': 't1', 'pin': PINS['t1']}, ip='9.9.9.9')[0] == 200


def test_no_pin_or_inactive_cannot_login(client, repo):
    assert client.call('POST', '/login', {'staff_id': 'nopin', 'pin': '000000'})[0] == 401
    s = repo.get_staff('t2'); s['active'] = False; repo.upsert_staff(s)
    assert client.call('POST', '/login', {'staff_id': 't2', 'pin': PINS['t2']})[0] == 401


def test_token_expires_after_12_hours(client, clock):
    client.token('t1')
    clock.t += config.TOKEN_TTL - 1
    assert client.call('GET', '/me', who='t1')[0] == 200
    clock.t += 2
    assert client.call('GET', '/me', who='t1')[0] == 401


def test_pin_reset_invalidates_old_tokens(client, clock):
    client.token('t1')
    clock.t += 5
    status, data, _ = client.call('POST', '/admin/staff/t1/pin', who='adm')
    assert status == 200 and auth.is_valid_pin_format(data['pin'])
    assert client.call('GET', '/me', who='t1')[0] == 401
    assert client.call('POST', '/login', {'staff_id': 't1', 'pin': data['pin']})[0] == 200


def test_pin_reset_admin_only_and_not_in_audit(client, repo):
    assert client.call('POST', '/admin/staff/t2/pin', who='chk')[0] == 403
    assert client.call('POST', '/admin/staff/t2/pin', who='t1')[0] == 403
    status, data, _ = client.call('POST', '/admin/staff/t2/pin', who='adm')
    assert status == 200
    assert all(data['pin'] not in str(a) for a in repo.audit)


def test_staff_list_is_public_without_pins(client):
    status, data, _ = client.call('GET', '/staff')
    assert status == 200
    assert {'id', 'short_name'} == set(data['staff'][0])


def test_requests_without_token_are_rejected(client):
    for method, path in [('GET', '/dictionaries'), ('POST', '/records'), ('GET', '/records/mine'),
                         ('GET', '/review'), ('GET', '/export.xlsx'), ('GET', '/admin/staff')]:
        assert client.call(method, path)[0] == 401, path
