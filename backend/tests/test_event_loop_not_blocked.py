"""이벤트 루프를 막지 않는다.

Supabase 파이썬 클라이언트는 **동기**다. ``async def`` 핸들러 안에서 그것을 그냥
부르면 그 요청이 끝날 때까지 이벤트 루프가 멈추고, 같은 워커에 붙은 **다른 사람의
요청까지** 그 뒤에 줄을 선다. 관리자 대시보드가 10초를 먹은 기록(2026-08-13
운영 로그: dashboard 10154ms · viral-funnel 10148ms)이 그 모양이다.

규칙은 둘 중 하나다:
  · 안에 ``await`` 가 하나도 없으면 → ``def`` 로 둔다. FastAPI 가 스레드풀에서 돌린다.
  · ``await`` 가 있으면 → 동기 덩어리를 ``asyncio.to_thread(...)`` 로 감싼다.

새 엔드포인트를 ``async def`` 로 쓰면서 안에서 그냥 DB 를 부르면 이 검사가 잡는다.
"""

import ast
import pathlib
import unittest

API_DIR = pathlib.Path(__file__).resolve().parents[1] / "app" / "api"
ROUTE_METHODS = {"get", "post", "patch", "put", "delete"}
DB_MARKERS = ("client.", "get_supabase_client", "supabase")


def _endpoints(tree: ast.AST) -> list[ast.AsyncFunctionDef | ast.FunctionDef]:
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        if any(
            isinstance(deco, ast.Call)
            and isinstance(deco.func, ast.Attribute)
            and deco.func.attr in ROUTE_METHODS
            for deco in node.decorator_list
        ):
            found.append(node)
    return found


class EventLoopNotBlockedTest(unittest.TestCase):
    def test_await_가_없는_핸들러는_async_가_아니다(self) -> None:
        offenders: list[str] = []
        for path in sorted(API_DIR.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            for node in _endpoints(ast.parse(source)):
                if not isinstance(node, ast.AsyncFunctionDef):
                    continue
                if any(isinstance(child, ast.Await) for child in ast.walk(node)):
                    continue
                body = ast.get_source_segment(source, node) or ""
                if any(marker in body for marker in DB_MARKERS):
                    offenders.append(f"{path.name}:{node.lineno} {node.name}")
        self.assertEqual(
            offenders,
            [],
            "async 인데 await 가 없고 DB 를 부른다 — `def` 로 두면 스레드풀에서 돈다: "
            + ", ".join(offenders),
        )

    def test_await_가_있는_핸들러는_동기_덩어리를_to_thread_로_감싼다(self) -> None:
        """await 가 있으면 async 로 남아야 하니, 동기 부분을 스레드로 넘겼는지 본다."""
        checked = 0
        offenders: list[str] = []
        for path in sorted(API_DIR.glob("*.py")):
            source = path.read_text(encoding="utf-8")
            for node in _endpoints(ast.parse(source)):
                if not isinstance(node, ast.AsyncFunctionDef):
                    continue
                body = ast.get_source_segment(source, node) or ""
                if not any(marker in body for marker in DB_MARKERS):
                    continue
                checked += 1
                if "to_thread" not in body:
                    offenders.append(f"{path.name}:{node.lineno} {node.name}")
        self.assertGreater(checked, 0, "검사할 async 핸들러를 하나도 못 찾았다")
        # ★ 남은 것들은 무거운 생성·업로드 흐름이라 이번 범위 밖이다. 목록을 고정해
        #   두고, 늘어나면 알아채게 한다. 줄이는 것은 다음 차례다.
        self.assertEqual(
            sorted(offenders),
            [
                "album.py:2267 generate_epilogue",
                "album.py:2426 upload_album_pdf",
                "album.py:444 upload_album",
                "memory.py:110 generate_memory_questions",
                "memory.py:148 regenerate_memory_questions",
                "memory.py:180 analyze_media",
            ],
            "to_thread 없이 동기 호출을 하는 async 핸들러가 달라졌다",
        )

    def test_핸들러를_줄줄이_async_로_되돌리지_않았다(self) -> None:
        """세어 둔다 — async 핸들러가 다시 늘면 원인을 알고 늘려야 한다."""
        async_count = 0
        sync_count = 0
        for path in sorted(API_DIR.glob("*.py")):
            for node in _endpoints(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.AsyncFunctionDef):
                    async_count += 1
                else:
                    sync_count += 1
        self.assertGreater(sync_count, async_count, "동기 핸들러보다 async 핸들러가 많아졌다")


if __name__ == "__main__":
    unittest.main()
