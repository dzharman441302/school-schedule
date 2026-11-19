"""Presigned-ссылки Object Storage (AWS Signature V4, query string) без внешних библиотек."""
from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import quote

REGION = 'ru-central1'


def _enc(value: str, safe: str = '-_.~') -> str:
    return quote(value, safe=safe)


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def presign(method: str, *, host: str, path: str, access_key: str, secret_key: str,
            expires: int, now: float | None = None, region: str = REGION,
            headers: dict | None = None, query: dict | None = None) -> str:
    """Возвращает https-ссылку. `path` — канонический путь объекта, например /bucket/key.
    `headers` (кроме host) входят в подпись: клиент обязан прислать их с теми же значениями."""
    t = time.gmtime(now if now is not None else time.time())
    amz_date = time.strftime('%Y%m%dT%H%M%SZ', t)
    day = amz_date[:8]
    scope = f'{day}/{region}/s3/aws4_request'
    signed = {'host': host, **{k.lower(): str(v).strip() for k, v in (headers or {}).items()}}
    signed_names = ';'.join(sorted(signed))
    params = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': f'{access_key}/{scope}',
        'X-Amz-Date': amz_date,
        'X-Amz-Expires': str(int(expires)),
        'X-Amz-SignedHeaders': signed_names,
        **(query or {}),
    }
    canonical_query = '&'.join(f'{_enc(k)}={_enc(str(v))}' for k, v in sorted(params.items()))
    canonical_uri = _enc(path, safe='-_.~/')
    canonical_headers = ''.join(f'{k}:{signed[k]}\n' for k in sorted(signed))
    canonical_request = '\n'.join([method, canonical_uri, canonical_query, canonical_headers, signed_names, 'UNSIGNED-PAYLOAD'])
    string_to_sign = '\n'.join(['AWS4-HMAC-SHA256', amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()])
    key = _hmac(_hmac(_hmac(_hmac(('AWS4' + secret_key).encode(), day), region), 's3'), 'aws4_request')
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    return f'https://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}'


class Storage:
    """Приватный бакет дипломов (path-style адреса storage.yandexcloud.net/<bucket>/<key>)."""

    def __init__(self, bucket: str, access_key: str, secret_key: str, host: str = 'storage.yandexcloud.net'):
        self.bucket, self.access_key, self.secret_key, self.host = bucket, access_key, secret_key, host

    @property
    def configured(self) -> bool:
        return bool(self.bucket and self.access_key and self.secret_key)

    def _url(self, method: str, key: str, expires: int, now: float, headers=None, query=None) -> str:
        return presign(method, host=self.host, path=f'/{self.bucket}/{key}', access_key=self.access_key,
                       secret_key=self.secret_key, expires=expires, now=now, headers=headers, query=query)

    def upload_url(self, key: str, content_type: str, size: int, expires: int, now: float) -> str:
        # Размер и тип входят в подпись: загрузить файл другого размера или типа не получится.
        return self._url('PUT', key, expires, now, headers={'content-type': content_type, 'content-length': str(size)})

    def download_url(self, key: str, expires: int, now: float) -> str:
        return self._url('GET', key, expires, now)

    def delete_url(self, key: str, now: float) -> str:
        return self._url('DELETE', key, 300, now)

    def put_public(self, bucket: str, key: str, data: bytes, content_type: str, cache_control: str, now: float) -> None:
        """Публичный объект (achievements.json) в отдельный бакет с анонимным чтением."""
        import urllib.error
        import urllib.request
        if not (bucket and self.access_key and self.secret_key):
            raise RuntimeError('public bucket not configured')
        headers = {'content-type': content_type, 'cache-control': cache_control}
        url = presign('PUT', host=self.host, path=f'/{bucket}/{key}', access_key=self.access_key,
                      secret_key=self.secret_key, expires=300, now=now, headers=headers)
        req = urllib.request.Request(url, data=data, method='PUT', headers={'Content-Type': content_type, 'Cache-Control': cache_control})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status not in (200, 201):
                    raise RuntimeError(f'put {resp.status}')
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'put {e.code}') from None

    def delete(self, key: str, now: float | None = None) -> bool:
        import urllib.request
        req = urllib.request.Request(self.delete_url(key, now if now is not None else time.time()), method='DELETE')
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status in (200, 204)
        except Exception as exc:
            print(f'storage: delete failed ({type(exc).__name__})')
            return False
