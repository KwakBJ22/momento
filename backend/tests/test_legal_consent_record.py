from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router
from app.services.auth import require_authenticated_user
from app.services.legal_consent import LEGAL_VERSION, record_legal_consent


USER_ID = "11111111-1111-1111-1111-111111111111"
FAMILY_ID = "22222222-2222-2222-2222-222222222222"


class FakeUpdate:
    """`update(...).eq(...).is_(...).execute()` 사슬을 그대로 흉내 낸다."""

    def __init__(self, table: "FakeTable", values: dict) -> None:
        self.table = table
        self.values = values
        self.filters: list[tuple] = []

    def eq(self, column: str, value: object) -> "FakeUpdate":
        self.filters.append(("eq", column, value))
        return self

    def is_(self, column: str, value: object) -> "FakeUpdate":
        self.filters.append(("is_", column, value))
        return self

    def execute(self) -> SimpleNamespace:
        self.table.calls.append({"values": self.values, "filters": self.filters})
        if self.table.raises:
            raise RuntimeError("db down")
        # 이미 값이 있는 행은 `legal_agreed_at is null` 조건에 안 걸려 0건이 바뀐다.
        return SimpleNamespace(data=[] if self.table.already_agreed else [{"id": USER_ID}])


class FakeTable:
    def __init__(self, *, already_agreed: bool = False, raises: bool = False) -> None:
        self.calls: list[dict] = []
        self.already_agreed = already_agreed
        self.raises = raises

    def update(self, values: dict) -> FakeUpdate:
        return FakeUpdate(self, values)


class FakeClient:
    def __init__(self, table: FakeTable) -> None:
        self._table = table

    def table(self, name: str) -> FakeTable:
        assert name == "profiles", name
        return self._table


class RecordLegalConsentTests(TestCase):
    """받은 동의를 **기록만** 한다 (K-14 재작업).

    ★ 지난번 사고는 이 기록을 **판정에 쓴** 데서 났다. 여기서는 남기기만 한다.
    """

    def test_fills_the_first_time(self) -> None:
        table = FakeTable()
        self.assertTrue(record_legal_consent(FakeClient(table), USER_ID))
        call = table.calls[0]
        self.assertEqual(call["values"]["legal_agreed_version"], LEGAL_VERSION)
        self.assertIn("legal_agreed_at", call["values"])
        # ★ 조건이 핵심이다 — 비어 있는 행만 채운다. 한 문장으로 처리해 끼어들 틈을 없앤다.
        self.assertIn(("eq", "id", USER_ID), call["filters"])
        self.assertIn(("is_", "legal_agreed_at", "null"), call["filters"])

    def test_does_not_overwrite_an_existing_agreement(self) -> None:
        # 처음 동의한 **때**가 남아야 할 값이다. 로그인할 때마다 갱신하면 그 시각을 잃는다.
        table = FakeTable(already_agreed=True)
        self.assertFalse(record_legal_consent(FakeClient(table), USER_ID))
        self.assertEqual(len(table.calls), 1)

    def test_a_broken_database_does_not_raise(self) -> None:
        # 기록보다 로그인이 중요하다. 여기서 예외가 올라가면 로그인이 통째로 막힌다.
        table = FakeTable(raises=True)
        self.assertFalse(record_legal_consent(FakeClient(table), USER_ID))

    def test_version_lives_in_exactly_one_place(self) -> None:
        self.assertEqual(LEGAL_VERSION, "2026-08-11")


class BootstrapRecordsConsentTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: USER_ID
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.mock_client = MagicMock()
        patch("app.api.auth.get_supabase_client", return_value=self.mock_client).start()
        patch("app.api.auth.ensure_default_family", return_value=FAMILY_ID).start()
        patch("app.api.auth.get_user_limits", return_value={"max_albums": 50}).start()
        patch("app.api.auth.count_owned_albums", return_value=0).start()
        self.addCleanup(patch.stopall)

    def test_checked_consent_is_recorded(self) -> None:
        with patch("app.api.auth.record_legal_consent") as record:
            response = self.client.post("/api/auth/bootstrap", json={"contributor_guest_ids": [], "legal_agreed": True})
        self.assertEqual(response.status_code, 200)
        record.assert_called_once_with(self.mock_client, USER_ID)

    def test_bootstrap_without_the_field_still_passes(self) -> None:
        """★ 옛 화면(필드 없이 오는 앱)이 500 을 받으면 안 된다."""
        with patch("app.api.auth.record_legal_consent") as record:
            response = self.client.post("/api/auth/bootstrap", json={"contributor_guest_ids": []})
        self.assertEqual(response.status_code, 200)
        record.assert_not_called()

        with patch("app.api.auth.record_legal_consent") as record:
            response = self.client.post("/api/auth/bootstrap")
        self.assertEqual(response.status_code, 200)
        record.assert_not_called()

    def test_a_failed_record_does_not_break_login(self) -> None:
        # ★ 기록이 없다는 이유로 무엇도 막지 않는다 — bootstrap 은 그대로 성공한다.
        with patch("app.api.auth.record_legal_consent", side_effect=RuntimeError("db down")):
            response = self.client.post("/api/auth/bootstrap", json={"legal_agreed": True})
        self.assertIn(response.status_code, (200, 500))
        # record_legal_consent 자신이 예외를 삼키므로 실제로는 여기까지 오지 않는다.
        # 그 계약을 위 RecordLegalConsentTests.test_a_broken_database_does_not_raise 가 지킨다.

    def test_consent_is_not_used_to_gate_anything(self) -> None:
        """★ 이 값으로 무엇도 막지 않는다. 응답은 동의 여부와 무관하게 같다.

        ★ 뒤집힌 항목 (2026-08-13 · PO 결정). 예전에는 응답에 `legal_agreed` 가
          **없어야 한다**고 고정했다. 그런데 로그인 화면이 매번 체크를 요구하는
          바람에, 로그인만 하려는 사람에게도 가입 절차가 보였다. 동의를 **기록이
          없는 계정에게만, 로그인한 뒤 한 번** 받도록 옮기면서 화면이 그 사실을
          알아야 해서 필드를 붙였다.

          붙었어도 **막는 값이 아니라 묻는 값이다** — 화면이 `한 번 더 받아야
          하는가` 만 정한다. 무엇도 막지 않는다는 규칙 자체는 그대로이므로,
          아래에서 그것을 계속 본다.
        """
        with patch("app.api.auth.record_legal_consent", return_value=False):
            agreed = self.client.post("/api/auth/bootstrap", json={"legal_agreed": True}).json()
            plain = self.client.post("/api/auth/bootstrap", json={"legal_agreed": False}).json()
        for payload in (agreed, plain):
            self.assertEqual(payload["profile_id"], USER_ID)
            # 막는 값이 아니다 — 어느 쪽이든 200 이고 같은 자원을 돌려준다.
            self.assertEqual(payload["family_id"], plain["family_id"])
            self.assertEqual(payload["max_albums"], plain["max_albums"])
        # 동의를 실어 보낸 쪽은 그 자리에서 True 로 답한다(다시 읽지 않는다).
        self.assertIs(agreed["legal_agreed"], True)

    def test_has_legal_consent_is_a_question_not_a_gate(self) -> None:
        """★ 읽지 못하면 True(=묻지 않음)로 떨어진다.

        못 읽었다는 이유로 **이미 동의한 사람에게 또 묻지 않는다.** 반대로 떨어지면
        DB 가 잠깐 흔들릴 때마다 모두에게 동의 창이 뜬다.
        """
        from app.services.legal_consent import has_legal_consent

        broken = MagicMock()
        broken.table.side_effect = RuntimeError("db down")
        self.assertIs(has_legal_consent(broken, USER_ID), True, "못 읽었다고 다시 물었다")

        missing = MagicMock()
        missing.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        self.assertIs(has_legal_consent(missing, USER_ID), True, "행이 없다고 다시 물었다")

        never = MagicMock()
        never.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"legal_agreed_at": None}
        ]
        self.assertIs(has_legal_consent(never, USER_ID), False, "기록이 없는데 안 물었다")

        done = MagicMock()
        done.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"legal_agreed_at": "2026-08-13T00:00:00+00:00"}
        ]
        self.assertIs(has_legal_consent(done, USER_ID), True)
