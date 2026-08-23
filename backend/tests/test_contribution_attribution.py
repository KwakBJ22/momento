"""Real-behaviour tests for attributing pre-login guest contributions to an account."""
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router
from app.services.auth import require_authenticated_user
from app.services.collaboration_service import attribute_contributions
from tests._fake_supabase import FakeSupabase

USER = "22222222-2222-2222-2222-222222222222"
OTHER = "99999999-9999-9999-9999-999999999999"
FAMILY = "33333333-3333-3333-3333-333333333333"


class AttributeContributionsTests(TestCase):
    def test_fills_user_id_on_unclaimed_guest_rows(self) -> None:
        client = FakeSupabase({"album_contributors": [
            {"id": "c1", "album_id": "A1", "guest_id": "G1", "user_id": None, "status": "active"},
            {"id": "c2", "album_id": "A2", "guest_id": "G1", "user_id": None, "status": "active"},
        ]})
        claimed, albums = attribute_contributions(client, USER, ["G1"])
        self.assertEqual(claimed, ["G1"])
        self.assertEqual(albums, 2)
        self.assertTrue(all(row["user_id"] == USER for row in client.tables["album_contributors"]))

    def test_never_overwrites_a_row_already_owned_by_another_user(self) -> None:
        client = FakeSupabase({"album_contributors": [
            {"id": "c1", "album_id": "A1", "guest_id": "G2", "user_id": OTHER, "status": "active"},
        ]})
        claimed, albums = attribute_contributions(client, USER, ["G2"])
        # ★ 2026-08-19 — 예전에는 [] 였다. 이 목록은 화면이 `다시 안 보내도 된다` 표시를
        #   하는 데 쓰는데, 남의 것이라 영영 못 붙는 id 를 빼면 화면을 옮길 때마다 다시
        #   실려 온다(bootstrap 반복). 끝난 id 이므로 목록에는 오르되, **행은 안 건드린다**
        #   (아래 검사 그대로) — 지키려던 것은 그쪽이다.
        self.assertEqual(claimed, ["G2"])
        self.assertEqual(albums, 0)
        self.assertEqual(client.tables["album_contributors"][0]["user_id"], OTHER)  # untouched

    def test_skips_unique_conflict_when_user_already_contributes_to_that_album(self) -> None:
        client = FakeSupabase({"album_contributors": [
            {"id": "guest", "album_id": "A1", "guest_id": "G3", "user_id": None, "status": "active"},
            {"id": "mine", "album_id": "A1", "guest_id": None, "user_id": USER, "status": "active"},
        ]})
        claimed, albums = attribute_contributions(client, USER, ["G3"])
        # ★ 2026-08-19 — 위와 같은 이유로 [] → ["G3"]. 충돌로 건너뛴 것도 끝난 id 다.
        self.assertEqual(claimed, ["G3"])
        self.assertEqual(albums, 0)
        guest_row = next(r for r in client.tables["album_contributors"] if r["id"] == "guest")
        self.assertIsNone(guest_row["user_id"])  # skipped, not overwritten


class BootstrapAttributionEndpointTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: USER
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app)

    def _post(self, fake: FakeSupabase, body: dict):
        with patch("app.api.auth.get_supabase_client", return_value=fake), patch(
            "app.api.auth.ensure_default_family", return_value=FAMILY
        ), patch("app.api.auth.get_user_limits", return_value={"max_albums": 50}), patch(
            "app.api.auth.count_owned_albums", return_value=0
        ):
            return self.client.post("/api/auth/bootstrap", json=body)

    def test_bootstrap_attributes_and_logs_contribution_claimed(self) -> None:
        fake = FakeSupabase({"album_contributors": [
            {"id": "c1", "album_id": "A1", "guest_id": "G1", "user_id": None, "status": "active"},
        ]})
        response = self._post(fake, {"contributor_guest_ids": ["G1"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["claimed_guest_ids"], ["G1"])
        self.assertEqual(fake.tables["album_contributors"][0]["user_id"], USER)
        events = fake.tables.get("analytics_events", [])
        self.assertTrue(
            any(e["event_name"] == "contribution_claimed" and e["metadata"].get("album_count") == 1 for e in events),
            f"expected contribution_claimed event, got {events}",
        )

    def test_login_survives_an_attribution_failure(self) -> None:
        fake = FakeSupabase({})
        with patch("app.api.auth.attribute_contributions", side_effect=RuntimeError("boom")):
            response = self._post(fake, {"contributor_guest_ids": ["G1"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["claimed_guest_ids"], [])

    def test_bootstrap_without_guest_ids_is_unchanged(self) -> None:
        fake = FakeSupabase({})
        response = self._post(fake, {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["claimed_guest_ids"], [])
        self.assertEqual(fake.tables.get("analytics_events", []), [])
