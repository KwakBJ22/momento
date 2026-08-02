"""Real-behavior tests for guest (no-login) album creation, access, and claim.

Runs the actual guest_album_service + authorization + claim endpoint against a
stateful fake Supabase (with the claim RPC emulated). Covers the required
regressions: guest create → read; a different session is refused; login → claim
sets ownership and marks the session claimed.
"""
from __future__ import annotations

from unittest import TestCase, mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import _actor_album_access
from app.services import guest_album_service
from app.services.share_service import hash_token
from app.services.supabase import get_album_record, save_album_record
from tests._fake_supabase import FakeSupabase

ALBUM_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ID = "99999999-9999-9999-9999-999999999999"


def _create_guest_album(client: FakeSupabase) -> str:
    """Mirror the upload_album guest branch: owner-less album + guest session."""
    save_album_record(
        client, album_id=ALBUM_ID, owner_id=None, family_id=None,
        meeting_type="friends", template="classic", title="비로그인 앨범",
        event_date="2026-08-01", narrative="", photo_paths=[], photo_meta=[], result_path="",
    )
    return guest_album_service.create_guest_session(client, ALBUM_ID)


class GuestSessionAccessTests(TestCase):
    def test_guest_album_is_created_owner_less_and_readable_with_its_token(self) -> None:
        client = FakeSupabase()
        token = _create_guest_album(client)

        album = get_album_record(client, ALBUM_ID)
        self.assertIsNone(album["owner_id"])   # unclaimed
        self.assertIsNone(album["family_id"])

        # The creating session's token grants owner-level access to this album.
        access = _actor_album_access(client, album, None, token)
        self.assertTrue(access.can_read_private)
        self.assertTrue(access.is_album_owner)
        self.assertTrue(access.can_contribute)

    def test_a_different_or_missing_session_is_refused(self) -> None:
        client = FakeSupabase()
        _create_guest_album(client)
        album = get_album_record(client, ALBUM_ID)

        # Wrong token, no token → no access.
        self.assertFalse(_actor_album_access(client, album, None, "some-other-token").can_read_private)
        self.assertFalse(_actor_album_access(client, album, None, None).can_read_private)
        self.assertFalse(guest_album_service.guest_session_matches(client, ALBUM_ID, "some-other-token"))

    def test_a_token_for_another_album_does_not_grant_access(self) -> None:
        client = FakeSupabase()
        token = _create_guest_album(client)
        # A second guest album with its own session.
        save_album_record(
            client, album_id=OTHER_ID, owner_id=None, family_id=None, meeting_type="friends",
            template="classic", title="다른 앨범", event_date="2026-08-02", narrative="",
            photo_paths=[], photo_meta=[], result_path="",
        )
        guest_album_service.create_guest_session(client, OTHER_ID)
        # album ALBUM_ID's token must not open OTHER_ID.
        self.assertFalse(guest_album_service.guest_session_matches(client, OTHER_ID, token))

    def test_an_expired_session_grants_no_access(self) -> None:
        client = FakeSupabase()
        token = _create_guest_album(client)
        client.tables["guest_album_sessions"][0]["expires_at"] = "2000-01-01T00:00:00+00:00"
        self.assertFalse(guest_album_service.guest_session_matches(client, ALBUM_ID, token))


class GuestClaimTests(TestCase):
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

    def test_login_claim_sets_ownership_and_marks_session_claimed(self) -> None:
        client = FakeSupabase()
        token = _create_guest_album(client)
        api = self._app(client)

        resp = api.post("/api/guest-albums/claim", json={"guest_token": token})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["album_id"], ALBUM_ID)

        album = get_album_record(client, ALBUM_ID)
        self.assertEqual(album["owner_id"], USER_ID)      # now owned
        self.assertEqual(album["created_by"], USER_ID)
        self.assertEqual(album["family_id"], "fam-1")
        session = client.tables["guest_album_sessions"][0]
        self.assertEqual(session["status"], "claimed")
        self.assertEqual(session["claimed_profile_id"], USER_ID)

        # After claim, the guest token no longer grants anonymous access.
        self.assertFalse(guest_album_service.guest_session_matches(client, ALBUM_ID, token))

    def test_claim_is_idempotent_for_the_same_owner(self) -> None:
        client = FakeSupabase()
        token = _create_guest_album(client)
        api = self._app(client)
        first = api.post("/api/guest-albums/claim", json={"guest_token": token})
        second = api.post("/api/guest-albums/claim", json={"guest_token": token})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["album_id"], ALBUM_ID)

    def test_claiming_an_already_claimed_album_by_another_user_is_refused(self) -> None:
        client = FakeSupabase()
        token = _create_guest_album(client)
        # First owner claims.
        self._app(client)
        api = self._app(client)
        api.post("/api/guest-albums/claim", json={"guest_token": token})
        # A different user tries the same token → 403.
        self.tearDown()
        from app.api import album as album_api
        from app.services.auth import require_authenticated_user
        app = FastAPI(); app.include_router(album_api.router)
        app.dependency_overrides[require_authenticated_user] = lambda: OTHER_ID
        self._patchers = [
            mock.patch.object(album_api, "get_supabase_client", return_value=client),
            mock.patch.object(album_api, "ensure_default_family", return_value="fam-2"),
            mock.patch.object(album_api, "log_event", return_value=True),
        ]
        for p in self._patchers:
            p.start()
        api2 = TestClient(app)
        resp = api2.post("/api/guest-albums/claim", json={"guest_token": token})
        self.assertEqual(resp.status_code, 403)
