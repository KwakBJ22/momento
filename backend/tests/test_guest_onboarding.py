from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.guest import _GUEST_UPLOADS, router
from app.services.auth import require_authenticated_user


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
        ) as claim, patch("app.api.guest.save_album_member"), patch("app.api.guest.log_event"):
            response = self.client.post("/api/guest-albums/claim", json={"guest_token": "x" * 32, "owner_id": "attacker"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.call_args.args[2], "22222222-2222-2222-2222-222222222222")

    def test_guest_upload_rate_limit(self) -> None:
        with patch("app.api.guest.process_upload"):
            for _ in range(3):
                response = self.client.post("/api/guest/upload-album", data={"website": ""}, files=[("photos", ("x.jpg", b"not-reached", "image/jpeg"))])
                self.assertNotEqual(response.status_code, 429)
            response = self.client.post("/api/guest/upload-album", data={"website": ""}, files=[("photos", ("x.jpg", b"not-reached", "image/jpeg"))])
        self.assertEqual(response.status_code, 429)
