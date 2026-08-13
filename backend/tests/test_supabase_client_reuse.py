"""Supabase 클라이언트를 재사용한다 — 첫 요청이 핸드셰이크 값을 내지 않게.

운영 Railway http 로그(2026-08-13)에서 잰 것:
    POST /api/auth/bootstrap  첫 호출 773~1276ms · 이어지는 호출 137~343ms
    GET  /api/albums/mine     첫 호출 1579ms      · 이어지는 호출 225~424ms
부를 때마다 ``create_client`` 가 새 커넥션 풀을 만들고 DNS·TLS 를 다시 맺어서 생긴 차이다.
자원 문제가 아니다 (CPU 0.001/8코어 · 메모리 0.09/8GB).
"""

import ast
import pathlib
import tokenize
import unittest
from unittest.mock import MagicMock, patch

from app.services.supabase import _cached_supabase_client, get_supabase_client, warm_supabase_client

APP_DIR = pathlib.Path(__file__).resolve().parents[1] / "app"


def _code_only(path: pathlib.Path) -> str:
    """주석과 문자열을 뺀 코드만 돌려준다 (설명 글이 검사에 걸리지 않도록)."""
    with tokenize.open(path) as handle:
        return "".join(
            token.string
            for token in tokenize.generate_tokens(handle.readline)
            if token.type not in (tokenize.COMMENT, tokenize.STRING)
        )


class SupabaseClientReuseTest(unittest.TestCase):
    def setUp(self) -> None:
        _cached_supabase_client.cache_clear()
        self.addCleanup(_cached_supabase_client.cache_clear)

    def test_같은_설정이면_클라이언트를_다시_만들지_않는다(self) -> None:
        with patch("app.services.supabase.create_client", return_value=MagicMock()) as create:
            first = _cached_supabase_client("https://a.supabase.co", "key-a")
            second = _cached_supabase_client("https://a.supabase.co", "key-a")
        self.assertIs(first, second)
        self.assertEqual(create.call_count, 1, "같은 설정인데 클라이언트를 두 번 만들었다")

    def test_개발과_운영이_섞이지_않는다(self) -> None:
        # 캐시 키가 url + key 라 프로젝트가 다르면 클라이언트도 다르다.
        with patch("app.services.supabase.create_client", side_effect=lambda *_: MagicMock()) as create:
            dev = _cached_supabase_client("https://dev.supabase.co", "key-dev")
            prod = _cached_supabase_client("https://prod.supabase.co", "key-prod")
            same_url_other_key = _cached_supabase_client("https://dev.supabase.co", "key-other")
        self.assertIsNot(dev, prod)
        self.assertIsNot(dev, same_url_other_key)
        self.assertEqual(create.call_count, 3)

    def test_get_supabase_client_가_캐시를_지나간다(self) -> None:
        settings = MagicMock(supabase_url="https://a.supabase.co", supabase_service_role_key="key-a")
        with patch("app.services.supabase.create_client", return_value=MagicMock()) as create:
            self.assertIs(get_supabase_client(settings), get_supabase_client(settings))
        self.assertEqual(create.call_count, 1)

    def test_공유해도_되는지_소스로_확인한다(self) -> None:
        """★ 어디에서도 client 에 사용자 세션을 심지 않는다 — 그래야 나눠 써도 된다.

        하나라도 생기면 한 사람의 토큰이 다른 사람 요청에 붙는다. 그때는 그 자리만
        자기 클라이언트를 따로 만들어야 한다.
        """
        offenders: list[str] = []
        create_client_sites: list[str] = []
        for path in APP_DIR.rglob("*.py"):
            # 주석·문자열을 걷어내고 **코드만** 본다. 이 규칙을 설명하는 주석이
            # 스스로 걸리면 안 된다.
            source = _code_only(path)
            for marker in ("set_session", ".postgrest.auth(", ".auth.sign_in", ".auth.set_"):
                if marker in source:
                    offenders.append(f"{path.name}: {marker}")
            if "create_client(" in source:
                create_client_sites.append(path.name)
        self.assertEqual(offenders, [], f"클라이언트에 세션을 심는 자리가 생겼다: {offenders}")
        self.assertEqual(create_client_sites, ["supabase.py"], "create_client 호출 자리가 늘었다")

    def test_service_role_키_하나로만_붙는다(self) -> None:
        source = (APP_DIR / "services" / "supabase.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Name) and n.func.id == "create_client"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(calls[0].args), 2, "익명 키 등 다른 인자가 붙었다")

    def test_깨우기가_실패해도_앱은_뜬다(self) -> None:
        """연결이 안 되면 느릴 뿐이다. 서버가 안 뜨는 것과는 다르다."""
        broken = MagicMock()
        broken.table.side_effect = RuntimeError("network down")
        with patch("app.services.supabase.get_supabase_client", return_value=broken):
            self.assertFalse(warm_supabase_client())

    def test_깨우기는_가벼운_질의_하나다(self) -> None:
        client = MagicMock()
        with patch("app.services.supabase.get_supabase_client", return_value=client):
            self.assertTrue(warm_supabase_client())
        client.table.assert_called_once_with("profiles")
        client.table.return_value.select.return_value.limit.assert_called_once_with(1)

    def test_시작할_때_한_번_깨운다(self) -> None:
        main_source = (APP_DIR / "main.py").read_text(encoding="utf-8")
        self.assertIn("lifespan=lifespan", main_source)
        self.assertIn("asyncio.to_thread(warm_supabase_client)", main_source)


if __name__ == "__main__":
    unittest.main()
