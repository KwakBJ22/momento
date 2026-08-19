"""가입하려는 이메일이 **이미 쓰이고 있는지** 알려 준다 (2026-08-19 · ④).

★ 이 자리는 **가입할 때만** 부른다. 로그인 실패는 화면이 한 문구로 끝낸다 —
  거기서 갈라 쓰면 계정이 있는지 없는지가 새어 나간다.
★ 돌려주는 것은 **어느 길로 가입했는지 하나뿐**이다. 이름·사진·앨범은 주지 않는다.
★ 안내 하나 때문에 가입이 막히면 안 된다 — 모르면 조용히 None 이고 200 이다.
"""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router


class SignupProviderTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.rows: list[dict] = []
        self.queried: list[str] = []

        supabase = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "profiles":
                def eq(column, value):
                    self.queried.append(f"{column}={value}")
                    result = MagicMock()
                    result.limit.return_value.execute.return_value.data = self.rows
                    return result
                handle.select.return_value.eq.side_effect = eq
            return handle

        supabase.table.side_effect = table
        patcher = patch("app.api.auth.get_supabase_client", return_value=supabase)
        patcher.start()
        self.addCleanup(patcher.stop)

    def ask(self, email: str):
        return self.client.post("/api/auth/signup-provider", json={"email": email})

    def test_카카오로_가입한_이메일이면_kakao_다(self) -> None:
        self.rows = [{"primary_provider": "kakao"}]
        response = self.ask("kbj@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"provider": "kakao"})

    def test_이메일로_가입한_이메일이면_email_이다(self) -> None:
        """카카오로 보내면 안 된다 — 그 계정은 카카오가 아니다."""
        self.rows = [{"primary_provider": "email"}]
        self.assertEqual(self.ask("kbj@example.com").json(), {"provider": "email"})

    def test_없는_이메일이면_None_이다(self) -> None:
        self.rows = []
        self.assertEqual(self.ask("nobody@example.com").json(), {"provider": None})

    def test_대소문자와_공백을_지우고_찾는다(self) -> None:
        self.rows = [{"primary_provider": "kakao"}]
        self.ask("  KBJ@Example.COM  ")
        self.assertIn("email=kbj@example.com", self.queried)

    def test_로그인이_필요하지_않다(self) -> None:
        """가입하려는 사람은 아직 계정이 없다 — 토큰을 요구하면 쓸 수 없다."""
        self.rows = []
        self.assertNotIn(self.ask("a@b.co").status_code, (401, 403))

    def test_이메일_모양이_아니면_조용히_None_이다(self) -> None:
        for bad in ["", "   ", "골뱅이없음"]:
            self.assertEqual(self.ask(bad).json(), {"provider": None}, bad)

    def test_조회가_실패해도_가입을_막지_않는다(self) -> None:
        """★ 회귀 — 안내 하나 때문에 가입이 막히면 안 된다."""
        with patch("app.api.auth.get_supabase_client", side_effect=RuntimeError("db down")):
            response = self.ask("a@b.co")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"provider": None})

    def test_이름이나_다른_것을_주지_않는다(self) -> None:
        """알려 주는 것은 어느 길로 가입했는지 하나뿐이다."""
        self.rows = [{"primary_provider": "kakao", "display_name": "곽병준", "id": "u-1"}]
        self.assertEqual(set(self.ask("a@b.co").json().keys()), {"provider"})

    def test_읽는_칸이_primary_provider_하나다(self) -> None:
        """select 로 다른 칸을 끌어오지 않는다 — 실수로 새어 나갈 자리를 만들지 않는다."""
        import inspect

        from app.api.auth import read_signup_provider

        source = inspect.getsource(read_signup_provider)
        self.assertIn('.select("primary_provider")', source)


class SignupProviderContractTests(TestCase):
    def test_스키마가_이메일_길이를_제한한다(self) -> None:
        from app.models.schemas import SignupProviderRequest

        field = SignupProviderRequest.model_fields["email"]
        self.assertTrue(any(getattr(item, "max_length", None) == 320 for item in field.metadata))

    def test_응답은_provider_하나다(self) -> None:
        from app.models.schemas import SignupProviderResponse

        self.assertEqual(set(SignupProviderResponse.model_fields), {"provider"})
        self.assertIsNone(SignupProviderResponse().provider)

    def test_전화번호_가입을_만들지_않았다(self) -> None:
        """PO: 전화번호(SMS)는 하지 않는다."""
        import inspect

        from app.api import auth as auth_api

        source = inspect.getsource(auth_api)
        for banned in ("send_sms", "phone_signup", "verify_otp"):
            self.assertNotIn(banned, source)

    def test_계정_합치기를_만들지_않았다(self) -> None:
        """2단계다 — 1단계에서는 길만 알려 준다."""
        import inspect

        from app.api import auth as auth_api

        source = inspect.getsource(auth_api)
        for banned in ("link_identity", "merge_account", "unlink_identity"):
            self.assertNotIn(banned, source)


_ = SimpleNamespace  # 위 harness 와 같은 import 모양을 유지한다(다른 검사와 맞춘다).
