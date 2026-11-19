"""Личные PIN педагогов (scrypt) и подписанные токены (HMAC-SHA256)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def is_valid_pin_format(pin: str) -> bool:
    return isinstance(pin, str) and len(pin) == 6 and pin.isascii() and pin.isdigit()


def _too_simple(pin: str) -> bool:
    if len(set(pin)) <= 2:
        return True
    digits = [int(c) for c in pin]
    steps = {b - a for a, b in zip(digits, digits[1:])}
    return steps in ({1}, {-1})


def generate_pin() -> str:
    while True:
        pin = f'{secrets.randbelow(10 ** 6):06d}'
        if not _too_simple(pin):
            return pin


def hash_pin(pin: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f'scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}'


_DUMMY_HASH = None


def verify_pin(pin: str, stored: str | None) -> bool:
    """Сравнивает PIN с хэшем. Без хэша всё равно считает scrypt, чтобы время ответа не выдавало,
    задан ли PIN у педагога."""
    global _DUMMY_HASH
    if not stored:
        if _DUMMY_HASH is None:
            _DUMMY_HASH = hash_pin('000000')
        stored, ok_possible = _DUMMY_HASH, False
    else:
        ok_possible = True
    try:
        kind, n, r, p, salt, digest = stored.split('$')
        if kind != 'scrypt':
            return False
        calc = hashlib.scrypt(str(pin).encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return ok_possible and hmac.compare_digest(calc, _unb64(digest))


def make_token(secret: str, payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode())
    sig = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    return f'{body}.{sig}'


def read_token(secret: str, token: str, now: float) -> dict | None:
    if not secret or not token or token.count('.') != 1:
        return None
    body, sig = token.split('.')
    expected = _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or float(payload.get('exp', 0)) <= now:
        return None
    return payload
