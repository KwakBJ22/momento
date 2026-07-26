from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.guest import _GUEST_UPLOADS, router
from app.services.auth import require_authenticated_user
from app.services.guest_service import claim_guest_album
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
        ) as claim, patch("app.api.guest.log_event"):
            response = self.client.post("/api/guest-albums/claim", json={"guest_token": "x" * 32, "owner_id": "attacker"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.call_args.args[2], "22222222-2222-2222-2222-222222222222")
        # The database RPC owns album_members atomically with the claim.

    def test_claim_rejects_album_id_without_ownership_token(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        profile_id = "22222222-2222-2222-2222-222222222222"
        with patch("app.api.guest.log_event"):
            response = self.client.post("/api/guest-albums/claim", json={"album_id": album_id})

        self.assertEqual(response.status_code, 400)

    def test_claim_uses_atomic_rpc_with_hashed_ownership_token(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        profile_id = "22222222-2222-2222-2222-222222222222"
        family_id = "33333333-3333-3333-3333-333333333333"
        client = MagicMock()
        client.rpc.return_value.execute.return_value = SimpleNamespace(data=album_id)
        claimed = claim_guest_album(client, "x" * 32, profile_id, family_id)

        self.assertEqual(claimed, album_id)
        client.rpc.assert_called_once()
        self.assertEqual(client.rpc.call_args.args[0], "claim_guest_album_ownership")

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
        self.mock_db.rpc.return_value.execute.return_value = SimpleNamespace(data=album_id)

        claimed_album_id = claim_guest_album(self.mock_db, "x" * 32, profile_id, "33333333-3333-3333-3333-333333333333")

        self.assertEqual(claimed_album_id, album_id)
        self.mock_db.rpc.assert_called_once()

    def test_repeated_claim_by_different_user_is_rejected(self) -> None:
        album_id = "11111111-1111-1111-1111-111111111111"
        original_owner_id = "22222222-2222-2222-2222-222222222222"
        other_profile_id = "44444444-4444-4444-4444-444444444444"
        self.mock_db.rpc.return_value.execute.side_effect = RuntimeError("guest album already claimed by another user")

        with self.assertRaises(HTTPException) as raised:
            claim_guest_album(self.mock_db, "x" * 32, other_profile_id, "33333333-3333-3333-3333-333333333333")

        self.assertEqual(raised.exception.status_code, 403)
        self.mock_db.rpc.assert_called_once()

    def test_guest_upload_rate_limit(self) -> None:
        with patch("app.api.guest.process_upload"):
            for _ in range(3):
                response = self.client.post("/api/guest/upload-album", data={"website": ""}, files=[("photos", ("x.jpg", b"not-reached", "image/jpeg"))])
                self.assertNotEqual(response.status_code, 429)
            response = self.client.post("/api/guest/upload-album", data={"website": ""}, files=[("photos", ("x.jpg", b"not-reached", "image/jpeg"))])
        self.assertEqual(response.status_code, 429)
