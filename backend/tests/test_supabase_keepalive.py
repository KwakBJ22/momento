"""놀 때만 연결을 깨운다 — 바쁠 때는 한 번도 안 보낸다.

부팅 때 한 번 깨우는 것으로는 부족했다. 운영 로그(2026-08-13)에서
`POST /api/auth/bootstrap` 첫 호출 **1259ms**, 이어지는 호출 180ms — 7배다.
질의가 무거워서가 아니라 놀던 TCP 연결이 끊겨 DNS·TLS 를 다시 맺기 때문이다.

★ 시간을 실제로 흘려보내지 않는다. 45초 기다리는 검사를 만들지 않는다 —
  단조 시계와 sleep 을 갈아 끼워 고정한다.
"""

import asyncio
import unittest
from unittest.mock import patch

from app import main as app_main


class FakeClock:
    """단조 시계와 sleep 을 대신한다. sleep 하면 시계가 그만큼 흐른다.

    ``busy=True`` 면 자는 동안에도 요청이 계속 들어온 것으로 친다 — 즉
    ``_last_request_at`` 이 시계를 따라온다. 그것이 "바쁜 서버"다.
    """

    def __init__(self, start: float = 1000.0, *, busy: bool = False) -> None:
        self.now = start
        self.busy = busy
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds
        if self.busy:
            app_main._last_request_at = self.now
        # 검사가 끝없이 돌지 않도록, 몇 번 재운 뒤 반복을 끊는다.
        if len(self.slept) >= 3:
            raise asyncio.CancelledError


def run_keepalive(clock: FakeClock, last_request_at: float, warm_result=True):
    """keepalive 를 몇 바퀴만 돌리고, warm 이 몇 번 불렸는지 돌려준다."""
    saved = app_main._last_request_at
    app_main._last_request_at = last_request_at
    try:
        with patch.object(app_main.time, "monotonic", clock.monotonic), \
             patch.object(app_main.asyncio, "sleep", clock.sleep), \
             patch.object(app_main, "warm_supabase_client") as warm:
            if isinstance(warm_result, Exception):
                warm.side_effect = warm_result
            else:
                warm.return_value = warm_result
            with self_cancelled():
                asyncio.run(app_main._keep_supabase_warm())
            return warm
    finally:
        app_main._last_request_at = saved


class self_cancelled:
    """FakeClock 이 반복을 끊으려고 던지는 CancelledError 를 삼킨다."""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return exc_type is asyncio.CancelledError


class KeepAliveTest(unittest.TestCase):
    def test_유휴가_짧으면_깨우지_않는다(self) -> None:
        """★ 바쁠 때는 **한 번도** 안 보낸다 — 지나간 요청이 이미 연결을 살려 뒀다."""
        clock = FakeClock(start=1000.0, busy=True)
        # 마지막 요청이 5초 전이고, 자는 동안에도 요청이 계속 들어온다.
        warm = run_keepalive(clock, last_request_at=995.0)
        warm.assert_not_called()
        # 식을 때까지 남은 만큼만 잔다(45 - 5 = 40초).
        self.assertEqual(clock.slept[0], app_main.SUPABASE_KEEPALIVE_SECONDS - 5.0)

    def test_한동안_아무도_안_쓰면_깨우기_시작한다(self) -> None:
        """짧은 유휴로 시작해도, 그 뒤로 아무도 안 쓰면 깨운다 — 그게 이 작업의 목적이다."""
        clock = FakeClock(start=1000.0)  # busy=False: 자는 동안 요청이 없다
        warm = run_keepalive(clock, last_request_at=995.0)
        self.assertEqual(clock.slept[0], app_main.SUPABASE_KEEPALIVE_SECONDS - 5.0, "먼저 식을 때까지 기다린다")
        self.assertGreaterEqual(warm.call_count, 1, "식은 뒤에도 깨우지 않았다")

    def test_유휴가_길면_깨운다(self) -> None:
        clock = FakeClock(start=1000.0)
        # 마지막 요청이 120초 전 = 식었다.
        warm = run_keepalive(clock, last_request_at=880.0)
        self.assertGreaterEqual(warm.call_count, 1, "식었는데 깨우지 않았다")

    def test_경계에서_깨운다(self) -> None:
        """45초를 딱 채우면 보낸다(그 미만이면 안 보낸다)."""
        clock = FakeClock(start=1000.0)
        warm = run_keepalive(clock, last_request_at=1000.0 - app_main.SUPABASE_KEEPALIVE_SECONDS)
        self.assertGreaterEqual(warm.call_count, 1)

        # 0.5초 모자라면 보내지 않고 그만큼 더 잔다(계속 쓰이는 서버로 둔다).
        clock2 = FakeClock(start=1000.0, busy=True)
        warm2 = run_keepalive(clock2, last_request_at=1000.0 - app_main.SUPABASE_KEEPALIVE_SECONDS + 0.5)
        warm2.assert_not_called()
        self.assertEqual(clock2.slept[0], 0.5)

    def test_깨우기가_실패해도_예외가_밖으로_안_나간다(self) -> None:
        """★ 대비책이지 기능이 아니다. 여기서 터지면 워커가 죽는다."""
        clock = FakeClock(start=1000.0)
        # run_keepalive 안에서 CancelledError 로만 끝나야 한다 — 다른 예외가 새면 실패한다.
        run_keepalive(clock, last_request_at=0.0, warm_result=False)

    def test_상태가_바뀔_때만_로그를_남긴다(self) -> None:
        """분당 한 줄로 로그를 채우지 않는다."""
        clock = FakeClock(start=1000.0)
        with patch.object(app_main.logger, "warning") as log:
            run_keepalive(clock, last_request_at=0.0, warm_result=True)
        log.assert_not_called()

        clock2 = FakeClock(start=1000.0)
        with patch.object(app_main.logger, "warning") as log2:
            run_keepalive(clock2, last_request_at=0.0, warm_result=False)
        self.assertEqual(log2.call_count, 1, "실패가 이어지는데 매번 남겼다")


class WiringTest(unittest.TestCase):
    def test_미들웨어가_마지막_요청_시각을_찍는다(self) -> None:
        import pathlib
        source = (pathlib.Path(app_main.__file__)).read_text(encoding="utf-8")
        middleware = source[source.index('@fastapi_app.middleware("http")'):source.index("with operation_context")]
        self.assertIn("global _last_request_at", middleware)
        self.assertIn("_last_request_at = time.monotonic()", middleware)

    def test_종료할_때_작업을_취소한다(self) -> None:
        import pathlib
        source = (pathlib.Path(app_main.__file__)).read_text(encoding="utf-8")
        lifespan = source[source.index("async def lifespan("):source.index("fastapi_app = FastAPI(")]
        self.assertIn("keepalive.cancel()", lifespan)
        self.assertIn("suppress(asyncio.CancelledError)", lifespan)


if __name__ == "__main__":
    unittest.main()
