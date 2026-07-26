from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.guest import _GUEST_UPLOADS, router
from app.services.auth import require_authenticated_user
from app.services.guest_service import _claim_session, claim_guest_album
from app.services.supabase import list_owned_album_records


class GuestOnboardingTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: "22222222-2222-2222-2222-222222222222"
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.mock_db = MagicMock()
        patch("app.api.guest.get_settings", return_value=SimpleNamespace(max_photos=10, supabase_private_storage_bucket="album-media", supabase_storage_bucket="albums")).start()
        patch("app.api.guest.get_supabase_client", return_value=self.mock_db).start()
        self.addCleanup(patch.stopall)
        _GUEST_UPLOADS.clear()

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_claim_uses_verified_session_not_client_owner_id(self) -> None:
        with patch("app.api.guest.ensure_default_family", return_value="33333333-3333-3333-3333-333333333333"), patch(
            "app.api.guest.claim_guest_album", return_value="11111111-1111-1111-1111-111111111111"
        ) as claim, patch("app.api.guest.save_album_member") as save_member, patch("app.api.guest.log_event"):
            response = self.client.post("/api/guest-albums/claim", json={"guest_token": "x" * 32, "owner_id": "attacker"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.call_args.args[2], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(save_member.call_args.kwargs["album_id"], "11111111-1111-1111-1111-111111111111")
        self.assertEqual(save_member.call_args.kwargs["profile_id"], "22222222-2222-2222-2222-222222222222")

    def test_claim_recovers_from_magic_link_album_id_and_saves_owner_membership(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        profile_id = "22222222-2222-2222-2222-222222222222"
        with patch("app.api.guest.ensure_default_family", return_value="33333333-3333-3333-3333-333333333333"), patch(
            "app.api.guest.claim_guest_album_by_id", return_value=album_id
        ) as claim_by_id, patch("app.api.guest.save_album_member") as save_member, patch("app.api.guest.log_event"):
            response = self.client.post("/api/guest-albums/claim", json={"album_id": album_id})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["album_id"], album_id)
        self.assertEqual(claim_by_id.call_args.args[1], album_id)
        self.assertEqual(claim_by_id.call_args.args[2], profile_id)
        self.assertEqual(save_member.call_args.kwargs, {
            "album_id": album_id,
            "profile_id": profile_id,
            "role": "owner",
            "invited_by": profile_id,
        })

    def test_active_claim_updates_album_owner_before_marking_session_claimed(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        profile_id = "22222222-2222-2222-2222-222222222222"
        family_id = "33333333-3333-3333-3333-333333333333"
        albums = MagicMock()
        sessions = MagicMock()
        client = MagicMock()
        client.table.side_effect = lambda name: albums if name == "albums" else sessions

        claimed = _claim_session(client, {
            "id": "session-1",
            "album_id": album_id,
            "status": "active",
            "expires_at": "2099-01-01T00:00:00+00:00",
        }, profile_id, family_id)

        self.assertEqual(claimed, album_id)
        albums.update.assert_called_once()
        album_update = albums.update.call_args.args[0]
        self.assertEqual(album_update["owner_id"], profile_id)
        self.assertEqual(album_update["created_by"], profile_id)
        self.assertEqual(album_update["family_id"], family_id)
        self.assertTrue(album_update["updated_at"])
        sessions.update.assert_called_once()
        self.assertEqual(sessions.update.call_args.args[0]["status"], "claimed")
        self.assertEqual(sessions.update.call_args.args[0]["claimed_profile_id"], profile_id)

    def test_my_albums_query_orders_claimed_owner_albums_newest_first(self) -> None:
        profile_id = "22222222-2222-2222-2222-222222222222"
        query = self.mock_db.table.return_value.select.return_value.or_.return_value.is_.return_value.order.return_value
        query.execute.return_value = SimpleNamespace(data=[
            {"id": "new", "created_at": "2026-07-23T12:00:00+00:00"},
            {"id": "old", "created_at": "2026-07-22T12:00:00+00:00"},
        ])

        records = list_owned_album_records(self.mock_db, profile_id)

        self.assertEqual([record["id"] for record in records], ["new", "old"])
        query.execute.assert_called_once()
        self.mock_db.table.return_value.select.return_value.or_.return_value.is_.return_value.order.assert_called_once_with("created_at", desc=True)

    def test_repeated_claim_by_same_user_returns_the_existing_album(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        profile_id = "22222222-2222-2222-2222-222222222222"
        query = self.mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
        query.execute.return_value = SimpleNamespace(data=[{
            "album_id": album_id,
            "status": "claimed",
            "claimed_profile_id": profile_id,
        }])

        claimed_album_id = claim_guest_album(self.mock_db, "x" * 32, profile_id, "33333333-3333-3333-3333-333333333333")

        self.assertEqual(claimed_album_id, album_id)
        self.assertEqual(self.mock_db.table.call_count, 1)

    def test_repeated_claim_by_different_user_is_rejected(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        original_owner_id = "22222222-2222-2222-2222-222222222222"
        other_profile_id = "44444444-4444-4444-4444-444444444444"
        query = self.mock_db.table.return_value.select.return_value.eq.return_value.limit.return_value
        query.execute.return_value = SimpleNamespace(data=[{
            "album_id": album_id,
            "status": "claimed",
            "claimed_profile_id": original_owner_id,
        }])

        with self.assertRaises(HTTPException) as raised:
            claim_guest_album(self.mock_db, "x" * 32, other_profile_id, "33333333-3333-3333-3333-333333333333")

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(self.mock_db.table.call_count, 1)

    def test_guest_upload_rate_limit(self) -> None:
        with patch("app.api.guest.process_upload"):
            for _ in range(3):
                response = self.client.post("/api/guest/upload-album", data={"website": ""}, files=[("photos", ("x.jpg", b"not-reached", "image/jpeg"))])
                self.assertNotEqual(response.status_code, 429)
            response = self.client.post("/api/guest/upload-album", data={"website": ""}, files=[("photos", ("x.jpg", b"not-reached", "image/jpeg"))])
        self.assertEqual(response.status_code, 429)
