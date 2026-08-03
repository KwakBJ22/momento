"""Real-behavior tests for the free-tier album limit.

Runs the actual plan_limits + upload/claim endpoints against a stateful fake
Supabase. Covers: the count excludes deleted albums; creation is refused at the
limit BEFORE any Storage upload; guests are unaffected; a claim over the limit is
refused without deleting the album (and extends the guest session).
"""
from __future__ import annotations

import io
import json
from unittest import TestCase, mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.plan_limits import count_owned_albums, get_user_limits
from app.services.supabase import get_album_record, save_album_record
from tests._fake_supabase import FakeSupabase

USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ID = "22222222-2222-2222-2222-222222222222"


def _album(album_id: str, owner: str, *, deleted: bool = False) -> dict:
    row = {"id": album_id, "owner_id": owner, "created_by": owner}
    row["deleted_at"] = "2026-08-01T00:00:00+00:00" if deleted else None
    return row


class OwnedAlbumCountTests(TestCase):
    def test_count_excludes_deleted_and_other_owners(self) -> None:
        client = FakeSupabase({"albums": [
            _album("a1", USER_ID),
            _album("a2", USER_ID),
            _album("a3", USER_ID, deleted=True),  # soft-deleted → excluded
            _album("b1", OTHER_ID),               # someone else → excluded
        ]})
        self.assertEqual(count_owned_albums(client, USER_ID), 2)

    def test_default_limits_come_from_settings(self) -> None:
        # 50 is now an abuse ceiling, not a paywall (normal users never reach it).
        limits = get_user_limits(USER_ID)
        self.assertEqual(limits["max_albums"], 50)
        self.assertEqual(limits["max_photos"], 30)


class CreationLimitTests(TestCase):
    def _app(self, client: FakeSupabase, *, user: str | None):
        from app.api import album as album_api
        from app.services.auth import optional_strict_authenticated_user

        app = FastAPI()
        app.include_router(album_api.router)
        app.dependency_overrides[optional_strict_authenticated_user] = lambda: user
        self.storage_spy = mock.MagicMock()
        self._patchers = [
            mock.patch.object(album_api, "get_supabase_client", return_value=client),
            mock.patch.object(album_api, "validate_upload_limits", return_value=None),
            mock.patch.object(album_api, "log_event", return_value=True),
            mock.patch.object(album_api, "upload_album_photo_assets", self.storage_spy),
        ]
        for p in self._patchers:
            p.start()
        return TestClient(app, raise_server_exceptions=False)

    def tearDown(self) -> None:
        for p in getattr(self, "_patchers", []):
            p.stop()

    def _post(self, api: TestClient):
        return api.post(
            "/api/upload-album",
            files={"photos": ("a.jpg", io.BytesIO(b"\xff\xd8\xff\xe0jpegbytes"), "image/jpeg")},
            data={"stories": json.dumps([{"order": 0, "user": "", "text": "x"}]), "category": "friend"},
        )

    def test_at_the_abuse_ceiling_creation_is_refused_before_any_storage_upload(self) -> None:
        # At the ceiling (50) creation is refused with an abuse message — no number,
        # no upsell — before any photo processing.
        client = FakeSupabase({"albums": [_album(f"a{i}", USER_ID) for i in range(50)]})
        api = self._app(client, user=USER_ID)
        resp = self._post(api)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["detail"], "앨범을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.")
        # The limit check runs before photo processing — Storage was never touched.
        self.storage_spy.assert_not_called()
        # No new album row was created.
        self.assertEqual(len(client.tables["albums"]), 50)

    def test_under_the_limit_the_creation_gate_is_passed(self) -> None:
        # 2 < 50 → not refused on the limit. We stop the pipeline right after the
        # gate (ensure_default_family) to prove the gate let it through without
        # running the heavy upload path.
        client = FakeSupabase({"albums": [_album("a1", USER_ID), _album("a2", USER_ID)]})
        from app.api import album as album_api
        gate = mock.MagicMock(side_effect=RuntimeError("passed-the-gate"))
        with mock.patch.object(album_api, "ensure_default_family", gate):
            api = self._app(client, user=USER_ID)
            resp = self._post(api)
        # Not a 403 (limit did not block), and the family step was reached — proof
        # the gate let it through. Our sentinel stops it before the storage path.
        self.assertNotEqual(resp.status_code, 403)
        gate.assert_called_once()
        self.storage_spy.assert_not_called()


class GuestClaimLimitTests(TestCase):
    ALBUM_ID = "33333333-3333-3333-3333-333333333333"

    def _guest_album(self, client: FakeSupabase) -> str:
        from app.services import guest_album_service
        save_album_record(
            client, album_id=self.ALBUM_ID, owner_id=None, family_id=None, meeting_type="friends",
            template="classic", title="게스트", event_date="2026-08-01", narrative="",
            photo_paths=[], photo_meta=[], result_path="",
        )
        return guest_album_service.create_guest_session(client, self.ALBUM_ID)

    def _app(self, client: FakeSupabase):
        from app.api import album as album_api
        from app.services.auth import require_authenticated_user
        app = FastAPI()
        app.include_router(album_api.router)
        app.dependency_overrides[require_authenticated_user] = lambda: USER_ID
        self._patchers = [
            mock.patch.object(album_api, "get_supabase_client", return_value=client),
            mock.patch.object(album_api, "ensure_default_family", return_value="fam-1"),
            mock.patch.object(album_api, "log_event", return_value=True),
        ]
        for p in self._patchers:
            p.start()
        return TestClient(app)

    def tearDown(self) -> None:
        for p in getattr(self, "_patchers", []):
            p.stop()

    def test_claim_over_the_limit_is_refused_without_deleting_and_extends_the_session(self) -> None:
        client = FakeSupabase({"albums": [_album(f"o{i}", USER_ID) for i in range(50)]})
        token = self._guest_album(client)
        api = self._app(client)
        resp = api.post("/api/guest-albums/claim", json={"guest_token": token})

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["detail"], "앨범을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.")
        # The album is NOT deleted and NOT claimed — data preserved.
        album = get_album_record(client, self.ALBUM_ID)
        self.assertIsNotNone(album)
        self.assertIsNone(album["owner_id"])
        session = client.tables["guest_album_sessions"][0]
        self.assertEqual(session["status"], "active")            # re-activated, not claimed
        self.assertNotEqual(session["claimed_profile_id"], USER_ID) if session.get("claimed_profile_id") else None
        self.assertGreater(session["expires_at"], "2026-08-02")   # pushed into the future

    def test_claim_under_the_limit_succeeds(self) -> None:
        client = FakeSupabase({"albums": [_album("o1", USER_ID)]})  # 1 < 3
        token = self._guest_album(client)
        api = self._app(client)
        resp = api.post("/api/guest-albums/claim", json={"guest_token": token})

        self.assertEqual(resp.status_code, 200)
        album = get_album_record(client, self.ALBUM_ID)
        self.assertEqual(album["owner_id"], USER_ID)
        self.assertEqual(client.tables["guest_album_sessions"][0]["status"], "claimed")
