from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.album import router as album_router
from app.api.auth import router as auth_router
from app.api.family import album_members_router, invitations_router, router as family_router
from app.services.auth import require_authenticated_user
from app.services.authorization import AlbumAccess


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
FAMILY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
ADMIN_ID = "33333333-3333-3333-3333-333333333333"
MEMBER_ID = "44444444-4444-4444-4444-444444444444"
VIEWER_ID = "55555555-5555-5555-5555-555555555555"
OTHER_FAMILY_USER = "66666666-6666-6666-6666-666666666666"
CONTRIBUTOR_ID = "77777777-7777-7777-7777-777777777777"


def album_record(
    *,
    owner_id: str = OWNER_ID,
    family_id: str | None = FAMILY_ID,
) -> dict[str, object]:
    return {
        "id": ALBUM_ID,
        "owner_id": owner_id,
        "created_by": owner_id,
        "family_id": family_id,
        "meeting_type": "family",
        "template": "B",
        "title": "Test album",
        "event_date": "2026-07-12",
        "narrative": "Original narrative",
        "result_path": "result.png",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def access(
    *,
    family_role: str | None = None,
    album_role: str | None = None,
    legacy_owner: bool = False,
) -> AlbumAccess:
    return AlbumAccess(family_role=family_role, album_role=album_role, is_legacy_owner=legacy_owner)


class MembershipApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(album_router)
        self.app.include_router(auth_router)
        self.app.include_router(family_router)
        self.app.include_router(invitations_router)
        self.app.include_router(album_members_router)
        self.client = TestClient(self.app)
        self.settings = SimpleNamespace(frontend_base_url="https://momento.example")

        self.get_settings = patch("app.api.family.get_settings", return_value=self.settings)
        self.get_settings_album = patch("app.api.album.get_settings", return_value=self.settings)
        self.mock_client = MagicMock()
        self.get_supabase_family = patch("app.api.family.get_supabase_client", return_value=self.mock_client)
        self.get_supabase_album = patch("app.api.album.get_supabase_client", return_value=self.mock_client)
        self.get_settings.start()
        self.get_settings_album.start()
        self.get_supabase_family.start()
        self.get_supabase_album.start()
        self.addCleanup(self.get_settings.stop)
        self.addCleanup(self.get_settings_album.stop)
        self.addCleanup(self.get_supabase_family.stop)
        self.addCleanup(self.get_supabase_album.stop)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def as_user(self, user_id: str) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: user_id

    def test_viewer_cannot_edit_album(self) -> None:
        self.as_user(VIEWER_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_access", return_value=access(family_role="viewer")
        ):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Nope"})

        self.assertEqual(response.status_code, 403)

    def test_contributor_cannot_edit_album_settings(self) -> None:
        self.as_user(CONTRIBUTOR_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_access", return_value=access(album_role="contributor")
        ):
            response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Nope"})

        self.assertEqual(response.status_code, 403)

    def test_contributor_can_autosave_optional_story_input(self) -> None:
        self.as_user(CONTRIBUTOR_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_access", return_value=access(album_role="contributor")
        ), patch("app.api.album.upsert_album_story_input", return_value={"value": "할머니와 함께"}):
            response = self.client.put(
                f"/api/albums/{ALBUM_ID}/story-inputs/people",
                json={"value": "할머니와 함께"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["value"], "할머니와 함께")

    def test_contributor_cannot_regenerate_album_story(self) -> None:
        self.as_user(CONTRIBUTOR_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_access", return_value=access(album_role="contributor")
        ):
            response = self.client.post(f"/api/albums/{ALBUM_ID}/story/regenerate")

        self.assertEqual(response.status_code, 403)

    def test_contributor_can_add_media(self) -> None:
        self.as_user(CONTRIBUTOR_ID)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_access", return_value=access(album_role="contributor")
        ), patch("app.api.album.process_media_upload") as process_media, patch(
            "app.api.album.upload_album_media_assets", return_value=("o", None, None)
        ), patch("app.api.album.save_album_media_records"):
            process_media.return_value = SimpleNamespace(
                media_type="video",
                mime_type="video/mp4",
                original_bytes=b"x",
                preview_bytes=None,
                preview_mime_type=None,
                thumbnail_bytes=None,
                width=None,
                height=None,
                duration_seconds=1.0,
                page_count=None,
            )
            response = self.client.post(
                f"/api/albums/{ALBUM_ID}/media",
                data={"sort_order": "0"},
                files={"file": ("clip.mp4", b"video", "video/mp4")},
            )

        self.assertEqual(response.status_code, 201)

    def test_other_family_user_blocked_from_private_read(self) -> None:
        self.as_user(OTHER_FAMILY_USER)
        with patch("app.api.album.get_album_record", return_value=album_record()), patch(
            "app.api.album.get_album_access", return_value=access()
        ):
            response = self.client.get(f"/api/albums/{ALBUM_ID}/photos")

        self.assertEqual(response.status_code, 403)

    def test_public_link_can_read_but_not_edit(self) -> None:
        with patch("app.api.album.get_album_detail_light_record", return_value=album_record()), patch(
            "app.api.album.get_public_url", return_value="https://cdn.example/album.png"
        ), patch("app.api.album.count_ready_album_photos", return_value=0), patch(
            "app.api.album.count_album_photo_memories", return_value=0
        ):
            get_response = self.client.get(f"/api/albums/{ALBUM_ID}")
            patch_response = self.client.patch(f"/api/albums/{ALBUM_ID}", json={"narrative": "Hack"})

        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(patch_response.status_code, 401)

    def test_create_invitation_returns_link(self) -> None:
        self.as_user(OWNER_ID)
        with patch(
            "app.api.family.get_family_membership",
            return_value={"role": "owner", "family_id": FAMILY_ID, "profile_id": OWNER_ID},
        ), patch(
            "app.api.family.create_family_invitation",
            return_value=(
                {
                    "id": "99999999-9999-9999-9999-999999999999",
                    "invitee_email": "guest@example.com",
                    "role": "member",
                    "status": "pending",
                    "expires_at": datetime.now(timezone.utc).isoformat(),
                    "accepted_at": None,
                    "revoked_at": None,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
                "plain-token-value",
            ),
        ):
            response = self.client.post(
                f"/api/families/{FAMILY_ID}/invitations",
                json={"invitee_email": "guest@example.com", "role": "member"},
            )

        self.assertEqual(response.status_code, 201)
        self.assertIn("/invite/plain-token-value", response.json()["invite_url"])

    def test_accept_invitation_requires_matching_session(self) -> None:
        self.as_user(MEMBER_ID)
        with patch("app.api.family.get_user_email", return_value="member@example.com"), patch(
            "app.api.family.accept_family_invitation",
            side_effect=HTTPException(status_code=403, detail="Invitation email does not match the signed-in user."),
        ):
            response = self.client.post(
                "/api/family-invitations/accept",
                json={"token": "bad-token-that-is-long-enough"},
            )

        self.assertIn(response.status_code, {400, 403})

    def test_owner_cannot_be_removed(self) -> None:
        self.as_user(ADMIN_ID)
        with patch(
            "app.api.family.get_family_membership",
            return_value={"role": "admin", "family_id": FAMILY_ID, "profile_id": ADMIN_ID},
        ), patch(
            "app.api.family.remove_family_member",
            side_effect=__import__("fastapi").HTTPException(status_code=403, detail="blocked"),
        ):
            response = self.client.delete(f"/api/families/{FAMILY_ID}/members/{OWNER_ID}")

        self.assertEqual(response.status_code, 403)

    def test_album_member_manage_blocked_for_viewer(self) -> None:
        self.as_user(VIEWER_ID)
        with patch("app.api.family.get_album_record", return_value=album_record()), patch(
            "app.api.family.get_album_access", return_value=access(family_role="viewer")
        ):
            response = self.client.get(f"/api/albums/{ALBUM_ID}/members")

        self.assertEqual(response.status_code, 403)


class MembershipServiceTests(TestCase):
    def test_token_hash_is_stable(self) -> None:
        from app.services.membership import hash_invitation_token

        self.assertEqual(hash_invitation_token("abc"), hash_invitation_token("abc"))
        self.assertNotEqual(hash_invitation_token("abc"), hash_invitation_token("def"))

    def test_legacy_owner_access(self) -> None:
        from app.services.authorization import resolve_album_access

        album = album_record(family_id=None)
        resolved = resolve_album_access(album, OWNER_ID, None, None)
        self.assertTrue(resolved.can_edit_settings)
        self.assertTrue(resolved.can_delete_album)

    def test_family_viewer_read_only(self) -> None:
        from app.services.authorization import resolve_album_access

        resolved = resolve_album_access(album_record(), VIEWER_ID, "viewer", None)
        self.assertTrue(resolved.can_read_private)
        self.assertFalse(resolved.can_edit_settings)
        self.assertFalse(resolved.can_contribute)

    def test_owner_removal_guard(self) -> None:
        from app.services.authorization import can_remove_family_member

        self.assertFalse(can_remove_family_member("owner", "owner", OWNER_ID, OWNER_ID))
        self.assertFalse(can_remove_family_member("admin", "owner", OWNER_ID, ADMIN_ID))
