"""🔴 Supabase 연결이 끊긴 채로 요청을 보내 500 이 사용자에게 그대로 갔다 (2026-08-19).

    GET /api/albums/8ca43293.../living-append-pages  →  500
    httpx.RemoteProtocolError: <ConnectionTerminated error_code:1, last_stream_id:31>

연결 하나를 만들어 계속 쓰는데(services/supabase.py 의 lru_cache) 저쪽이 조용히 닫아 둔
연결을 다시 쓰면 그 요청이 터진다. 재시도가 없어서 그대로 나갔다 — 하필 사진을 더하던
순간이었다.

★ 자리마다 붙이지 않는다. 연결을 만드는 **한 곳**에 끼운다.
★ **한 번만** 다시 시도한다.
★ 사용자 데이터를 두 번 만들지 않는다(§9) — `POST` 는 연결이 안 맺어졌을 때만 다시 보낸다.
"""

from unittest import TestCase
from unittest.mock import patch

import httpx

from app.services.http_retry import (
    RetryOnceTransport,
    install_retry,
    install_retry_on_supabase,
    may_retry,
)


class FlakyTransport(httpx.BaseTransport):
    """처음 N 번은 끊기고 그 뒤에는 정상으로 답하는 전송기."""

    def __init__(self, error: Exception, fail_times: int = 1) -> None:
        self.error = error
        self.left = fail_times
        self.calls: list[str] = []
        self.closed = False

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(f"{request.method} {request.url.path}")
        if self.left > 0:
            self.left -= 1
            raise self.error
        return httpx.Response(200, json={"ok": True}, request=request)

    def close(self) -> None:
        self.closed = True


def send(transport: httpx.BaseTransport, method: str = "GET", content: bytes | None = None) -> httpx.Response:
    with httpx.Client(transport=transport, base_url="https://db.example") as client:
        return client.request(method, "/rest/v1/album_photos", content=content)


class RetryOnceTests(TestCase):
    def test_끊긴_연결은_한_번_다시_시도해서_정상_응답을_준다(self) -> None:
        """★ 이것이 500 으로 나가던 그 오류다."""
        inner = FlakyTransport(httpx.RemoteProtocolError("<ConnectionTerminated error_code:1>"))
        response = send(RetryOnceTransport(inner))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(inner.calls), 2, "다시 시도하지 않았다")

    def test_연결_실패와_읽기_실패도_같이_다시_시도한다(self) -> None:
        for error in (
            httpx.ConnectError("connection refused"),
            httpx.ReadError("read failed"),
            httpx.RemoteProtocolError("server disconnected"),
        ):
            inner = FlakyTransport(error)
            self.assertEqual(send(RetryOnceTransport(inner)).status_code, 200, type(error).__name__)
            self.assertEqual(len(inner.calls), 2, type(error).__name__)

    def test_두_번째도_실패하면_그대로_올려보낸다(self) -> None:
        """무한 재시도를 두지 않는다. 부르는 쪽이 우리 말로 알린다(§11)."""
        inner = FlakyTransport(httpx.RemoteProtocolError("still down"), fail_times=5)
        with self.assertRaises(httpx.RemoteProtocolError):
            send(RetryOnceTransport(inner))
        self.assertEqual(len(inner.calls), 2, "한 번만 다시 시도해야 한다")

    def test_연결_문제가_아니면_다시_시도하지_않는다(self) -> None:
        """느린 것·타임아웃은 다시 보낸다고 나아지지 않는다."""
        inner = FlakyTransport(httpx.ReadTimeout("too slow"), fail_times=5)
        with self.assertRaises(httpx.ReadTimeout):
            send(RetryOnceTransport(inner))
        self.assertEqual(len(inner.calls), 1)

    def test_정상일_때는_한_번만_보낸다(self) -> None:
        inner = FlakyTransport(httpx.ConnectError("x"), fail_times=0)
        self.assertEqual(send(RetryOnceTransport(inner)).status_code, 200)
        self.assertEqual(len(inner.calls), 1)


class NeverDuplicateUserDataTests(TestCase):
    """★ CLAUDE.md §9 — 다시 보내다가 사진이 두 장이 되면 안 된다."""

    def _request(self, method: str) -> httpx.Request:
        return httpx.Request(method, "https://db.example/rest/v1/album_photos", content=b"{}")

    def test_읽기만_하는_요청은_늘_다시_보낸다(self) -> None:
        for method in ("GET", "HEAD", "OPTIONS"):
            self.assertTrue(may_retry(self._request(method), httpx.RemoteProtocolError("x")), method)

    def test_쓰는_요청은_연결이_안_맺어졌을_때만_다시_보낸다(self) -> None:
        # 서버가 요청을 본 적이 없다 → 다시 보내도 안전하다.
        self.assertTrue(may_retry(self._request("POST"), httpx.ConnectError("refused")))
        # 서버에 닿은 뒤 끊긴 것일 수 있다 → 다시 보내면 두 번 만들어질 수 있다.
        for error in (httpx.RemoteProtocolError("terminated"), httpx.ReadError("read")):
            for method in ("POST", "PATCH", "PUT", "DELETE"):
                self.assertFalse(may_retry(self._request(method), error), f"{method} {type(error).__name__}")

    def test_쓰는_요청은_실제로도_한_번만_나간다(self) -> None:
        inner = FlakyTransport(httpx.RemoteProtocolError("terminated"))
        with self.assertRaises(httpx.RemoteProtocolError):
            send(RetryOnceTransport(inner), method="POST", content=b'{"id":1}')
        self.assertEqual(len(inner.calls), 1, "사진이 두 장 만들어질 수 있다")


class InstalledInOnePlaceTests(TestCase):
    """★ 자리마다 붙이지 않는다 — 연결을 만드는 한 곳에서 건다."""

    class FakeSession:
        def __init__(self) -> None:
            self._transport = httpx.HTTPTransport()

    def test_세션에_한_번만_끼운다(self) -> None:
        session = self.FakeSession()
        self.assertTrue(install_retry(session))
        self.assertIsInstance(session._transport, RetryOnceTransport)
        # 두 번 부르면 겹쳐 감싸지 않는다.
        self.assertFalse(install_retry(session))
        self.assertNotIsInstance(session._transport._inner, RetryOnceTransport)

    def test_postgrest_와_storage_둘_다_보호한다(self) -> None:
        class FakeClient:
            def __init__(self) -> None:
                self.postgrest = type("P", (), {"session": InstalledInOnePlaceTests.FakeSession()})()
                self.storage = type("S", (), {"session": InstalledInOnePlaceTests.FakeSession()})()

        client = FakeClient()
        self.assertEqual(install_retry_on_supabase(client), 2)
        self.assertIsInstance(client.postgrest.session._transport, RetryOnceTransport)
        self.assertIsInstance(client.storage.session._transport, RetryOnceTransport)

    def test_모양이_달라져도_서버는_뜬다(self) -> None:
        """supabase-py 속이 바뀌어도 터지지 않는다 — 재시도가 없을 뿐이다."""
        self.assertEqual(install_retry_on_supabase(object()), 0)

    def test_클라이언트를_만들_때_실제로_끼운다(self) -> None:
        with patch("app.services.supabase.create_client", return_value=object()) as create, \
             patch("app.services.supabase.install_retry_on_supabase") as install:
            from app.services.supabase import _cached_supabase_client

            _cached_supabase_client.cache_clear()
            _cached_supabase_client("https://db.example", "service-role-key")
            create.assert_called_once()
            install.assert_called_once()
        _cached_supabase_client.cache_clear()
