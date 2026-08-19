"""끊긴 연결을 **한 번만** 다시 시도한다 (2026-08-19).

🔴 운영 로그(Railway dev 08-19 08:31):

    GET /api/albums/8ca43293.../living-append-pages  →  500
    httpx.RemoteProtocolError: <ConnectionTerminated error_code:1, last_stream_id:31>

Supabase 로 가는 연결은 **하나를 만들어 계속 쓴다**(services/supabase.py 의 lru_cache).
빠르지만, 저쪽이 조용히 닫아 둔 연결을 우리가 모르고 다시 쓰면 그 요청은 그대로
터진다. 재시도가 없어서 **500 이 사용자에게 그대로 갔다** — 하필 사진을 더하던
순간이었다. 24시간에 1건이라도, 그 사람에게는 이유 없는 실패다.

★ 자리마다 붙이지 않는다. 연결을 만드는 **한 곳**에 끼워 두면 그 연결로 나가는
  모든 요청(PostgREST · Storage)이 함께 보호받는다.
★ **한 번만** 다시 시도한다. 무한 재시도는 느린 장애를 더 느리게 만들 뿐이다.
★ 다시 시도해도 안 되면 그대로 올려보낸다 — 부르는 쪽이 우리 말로 알린다(§11).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

#: 연결이 끊겼을 때 나는 것들. 응답 내용이 잘못된 것과는 다르다.
RETRYABLE_ERRORS = (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError)

#: 몇 번을 보내도 결과가 같은 요청 — 다시 보내도 안전하다.
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _body_can_be_resent(request: httpx.Request) -> bool:
    """몸을 이미 흘려보냈으면 다시 못 보낸다 — 그때는 재시도하지 않는다."""
    try:
        request.content  # noqa: B018 - 읽을 수 있는지 보는 것이 목적이다
    except httpx.RequestNotRead:
        return False
    return True


def may_retry(request: httpx.Request, error: Exception) -> bool:
    """이 요청을 다시 보내도 되는가.

    ★ **사용자 데이터를 두 번 만들지 않는 것이 먼저다**(CLAUDE.md §9). 사진을 넣는
      `POST` 가 서버에 닿은 뒤 응답만 끊겼는데 다시 보내면 사진이 두 장이 된다.
      그래서 안전한 쪽으로만 다시 보낸다:

        · GET · HEAD · OPTIONS  — 몇 번을 보내도 결과가 같다. 늘 다시 보낸다.
        · 그 밖(POST · PATCH …) — **연결 자체가 안 맺어졌을 때만**(ConnectError)
          다시 보낸다. 그때는 서버가 그 요청을 본 적이 없다.
    """
    if not _body_can_be_resent(request):
        return False
    if request.method.upper() in _SAFE_METHODS:
        return True
    return isinstance(error, httpx.ConnectError)


class RetryOnceTransport(httpx.BaseTransport):
    """감싼 전송기가 연결 문제로 실패하면 **한 번** 더 보낸다.

    ★ 끊긴 연결을 우리가 치우지 않는다. httpx 가 실패한 그 연결을 이미 버리므로,
      다시 보내면 새 연결로 나간다.
    """

    def __init__(self, inner: httpx.BaseTransport) -> None:
        self._inner = inner

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        try:
            return self._inner.handle_request(request)
        except RETRYABLE_ERRORS as error:
            if not may_retry(request, error):
                raise
            logger.warning(
                "supabase_connection_retry method=%s path=%s error_type=%s",
                request.method, request.url.path, type(error).__name__,
            )
            return self._inner.handle_request(request)

    def close(self) -> None:
        self._inner.close()


def install_retry(session: Any) -> bool:
    """httpx 를 쓰는 세션 하나에 재시도를 끼운다. 이미 끼워져 있으면 그대로 둔다."""
    transport = getattr(session, "_transport", None)
    if transport is None or isinstance(transport, RetryOnceTransport):
        return False
    session._transport = RetryOnceTransport(transport)
    return True


def install_retry_on_supabase(client: Any) -> int:
    """Supabase 클라이언트가 쓰는 세션 **전부**에 재시도를 끼운다.

    ★ 실패해도 터지지 않는다. supabase-py 속 모양이 바뀌어도 서버는 떠야 한다 —
      재시도가 없을 뿐 예전과 같이 돈다.
    """
    installed = 0
    for owner in (getattr(client, "postgrest", None), getattr(client, "storage", None)):
        session = getattr(owner, "session", None)
        try:
            if session is not None and install_retry(session):
                installed += 1
        except Exception as exc:  # noqa: BLE001 - 재시도 하나 때문에 서버가 안 뜨면 안 된다
            logger.warning("supabase_retry_install_failed error_type=%s", type(exc).__name__)
    return installed
