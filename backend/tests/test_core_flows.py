"""Real-behavior tests for the core user flows.

These run the actual service/endpoint code against a *stateful* fake Supabase
(``tests/_fake_supabase.py``): each test creates state, calls the real code, and
reads the result back. This is the layer the source-regex tests miss — the class
of regression (dead invite link, 422 on contribute, photo save that never lands)
only shows up when the code is executed end to end.
"""
from __future__ import annotations

from unittest import TestCase, mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services import account_service, collaboration_service as cs
from app.services.share_service import (
    add_guestbook_entry,
    add_reaction,
    delete_own_guestbook_entry,
    hash_token,
    list_guestbook_entries,
    reaction_counts,
)
from app.services.supabase import (
    delete_album_cascade,
    get_album_detail_light_record,
    get_album_photo_asset_records,
    get_album_record,
    save_album_photo_records,
    save_album_record,
)
from tests._fake_supabase import FakeSupabase

OWNER_ID = "11111111-1111-1111-1111-111111111111"
ALBUM_ID = "22222222-2222-2222-2222-222222222222"
SESSION_A = "session-key-aaaaaaaaaaaaaaaa"
SESSION_B = "session-key-bbbbbbbbbbbbbbbb"


def _new_album_record(client: FakeSupabase) -> dict:
    return save_album_record(
        client,
        album_id=ALBUM_ID,
        owner_id=OWNER_ID,
        family_id=None,
        meeting_type="friends",
        template="classic",
        title="우리들의 여름",
        event_date="2026-08-01",
        narrative="함께한 하루",
        photo_paths=["albums/x/1.jpg"],
        photo_meta=[{"path": "albums/x/1.jpg"}],
        result_path="albums/x/result.json",
    )


# ── [a] 앨범 생성 → 조회 → 삭제 ────────────────────────────────────────────
class AlbumLifecycleTests(TestCase):
    def test_create_then_read_then_delete_removes_it_and_its_photos(self) -> None:
        client = FakeSupabase()
        _new_album_record(client)
        save_album_photo_records(
            client,
            [{"album_id": ALBUM_ID, "storage_bucket": "b", "storage_path": "albums/x/1.jpg"}],
        )

        # Read back: the created album resolves and its photo asset is stored.
        detail = get_album_detail_light_record(client, ALBUM_ID)
        self.assertIsNotNone(detail)
        self.assertEqual(detail["title"], "우리들의 여름")
        self.assertEqual(len(get_album_photo_asset_records(client, ALBUM_ID)), 1)

        # Delete (authorized cascade RPC) removes the album and its child photos.
        self.assertTrue(delete_album_cascade(client, ALBUM_ID, OWNER_ID))
        self.assertIsNone(get_album_detail_light_record(client, ALBUM_ID))
        self.assertIsNone(get_album_record(client, ALBUM_ID))
        self.assertEqual(get_album_photo_asset_records(client, ALBUM_ID), [])

    def test_delete_by_a_non_owner_is_refused_and_keeps_the_album(self) -> None:
        client = FakeSupabase()
        _new_album_record(client)
        self.assertFalse(delete_album_cascade(client, ALBUM_ID, "99999999-0000-0000-0000-000000000000"))
        self.assertIsNotNone(get_album_record(client, ALBUM_ID))


# ── [b] 초대 링크 생성 → 접근 → 참여자 사진 추가 ──────────────────────────
class InviteContributePhotoTests(TestCase):
    def _album_client(self) -> FakeSupabase:
        client = FakeSupabase()
        _new_album_record(client)
        return client

    def test_invited_contributor_can_join_and_their_photo_is_saved(self) -> None:
        client = self._album_client()
        album = get_album_record(client, ALBUM_ID)

        with mock.patch.object(cs, "ensure_owner_contributor"):
            _invite, token = cs.start_collaboration(client, album, OWNER_ID)

        # The freshly created link resolves to the album.
        record, invite = cs.get_album_for_invite(client, token)
        self.assertEqual(record["id"], ALBUM_ID)

        # A guest joins through that invite and becomes an active contributor.
        contributor = cs.join_as_contributor(
            client, record, invite,
            display_name="친구", relationship="친구", guest_id=None, user_id=None,
        )
        self.assertEqual(contributor["status"], "active")

        # Their photo is persisted and reads back on the album.
        save_album_photo_records(
            client,
            [{
                "album_id": ALBUM_ID,
                "uploaded_by_contributor_id": contributor["id"],
                "storage_bucket": "b",
                "storage_path": "albums/x/guest.jpg",
            }],
        )
        photos = get_album_photo_asset_records(client, ALBUM_ID)
        self.assertEqual(len(photos), 1)
        self.assertEqual(photos[0]["storage_path"], "albums/x/guest.jpg")

    def test_a_dead_invite_token_does_not_resolve(self) -> None:
        client = self._album_client()
        with self.assertRaises(Exception):
            cs.get_album_for_invite(client, "not-a-real-token")


# ── [c] 공유 링크(view)로 사진 추가 시도 → 거부 ───────────────────────────
class ViewShareRejectionTests(TestCase):
    """Exercises the real endpoint gating over the stateful fake."""

    TOKEN = "view-share-token-abcdefgh"

    def _app(self, client: FakeSupabase, *, viewer_id: str | None):
        from app.api import share as share_api
        from app.services.auth import optional_authenticated_user

        app = FastAPI()
        app.include_router(share_api.router)
        app.dependency_overrides[optional_authenticated_user] = lambda: viewer_id
        self._patchers = [
            mock.patch.object(share_api, "get_supabase_client", return_value=client),
            mock.patch.object(share_api, "log_event", return_value=True),
        ]
        for p in self._patchers:
            p.start()
        return TestClient(app)

    def tearDown(self) -> None:
        for p in getattr(self, "_patchers", []):
            p.stop()

    def _seed(self, kind: str) -> FakeSupabase:
        return FakeSupabase({
            "albums": [{"id": ALBUM_ID, "created_by": OWNER_ID, "owner_id": OWNER_ID,
                        "collaboration_status": "collecting", "contributor_limit": 10}],
            "share_links": [{"id": "s1", "album_id": ALBUM_ID, "token_hash": hash_token(self.TOKEN),
                             "status": "active", "kind": kind}],
        })

    def test_view_link_rejects_a_visitor_contribution(self) -> None:
        client = self._seed("view")
        api = self._app(client, viewer_id=None)
        resp = api.post(f"/api/public/shares/{self.TOKEN}/contribute", json={"display_name": "손님"})
        self.assertEqual(resp.status_code, 403)
        # No contributor row was created.
        self.assertEqual(client.tables.get("album_contributors", []), [])

    def test_contribute_link_lets_a_visitor_join(self) -> None:
        client = self._seed("contribute")
        api = self._app(client, viewer_id=None)
        resp = api.post(f"/api/public/shares/{self.TOKEN}/contribute", json={"display_name": "손님"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(client.tables["album_contributors"]), 1)


# ── [d] 회원 탈퇴 → 본인 앨범·프로필 제거, 타인 앨범 기여는 남는다 ─────────
class AccountWithdrawalTests(TestCase):
    OTHER_OWNER = "33333333-3333-3333-3333-333333333333"
    OTHER_ALBUM = "44444444-4444-4444-4444-444444444444"

    def _client(self) -> FakeSupabase:
        return FakeSupabase({
            "albums": [
                {"id": ALBUM_ID, "created_by": OWNER_ID, "owner_id": OWNER_ID, "title": "내 앨범"},
                {"id": self.OTHER_ALBUM, "created_by": self.OTHER_OWNER, "owner_id": self.OTHER_OWNER, "title": "친구 앨범"},
            ],
            "profiles": [{"id": OWNER_ID, "display_name": "나"}],
            # A contribution I left inside someone else's album.
            "album_contributors": [
                {"id": "c1", "album_id": self.OTHER_ALBUM, "user_id": OWNER_ID, "display_name": "나", "status": "active"},
            ],
            "photo_memories": [
                {"id": "m1", "album_id": self.OTHER_ALBUM, "author_id": OWNER_ID, "author_name": "나", "comment": "좋았어"},
            ],
        })

    def test_withdrawal_removes_my_album_and_profile_but_keeps_my_contribution_anonymized(self) -> None:
        client = self._client()
        settings = mock.MagicMock()
        # Storage cleanup is outside the DB transaction; not under test here.
        with mock.patch.object(account_service, "cleanup_album_files"):
            result = account_service.delete_account(client, settings, OWNER_ID)

        self.assertEqual(result["albums_deleted"], 1)
        # My album and profile are gone; the login identity is hard-deleted.
        self.assertIsNone(get_album_record(client, ALBUM_ID))
        self.assertEqual(client.tables["profiles"], [])
        self.assertIn(OWNER_ID, client.deleted_auth_users)
        # The other person's album survives untouched.
        self.assertIsNotNone(get_album_record(client, self.OTHER_ALBUM))
        # My roster row is removed — the withdrawn person leaves the participant list. Keeping
        # it with user_id -> NULL (guest_id already NULL) would violate the identity CHECK and
        # crash withdrawal with 23514 (the fixed regression).
        self.assertEqual(client.tables["album_contributors"], [])
        # But the memory I left stays inside that album, with my name anonymized and the
        # author link cleared — never delete other people's albums' contributions.
        memory = client.tables["photo_memories"][0]
        self.assertEqual(memory["author_name"], account_service.WITHDRAWN_DISPLAY_NAME)
        self.assertIsNone(memory["author_id"])


# ── [e] 반응·방명록 추가 → 조회 ───────────────────────────────────────────
class ReactionAndGuestbookTests(TestCase):
    def test_reactions_dedupe_per_session_and_count_per_album(self) -> None:
        client = FakeSupabase()
        add_reaction(client, ALBUM_ID, "s1", "love", SESSION_A)
        add_reaction(client, ALBUM_ID, "s1", "love", SESSION_A)  # same session → deduped
        add_reaction(client, ALBUM_ID, "s1", "love", SESSION_B)  # other session → counts
        add_reaction(client, ALBUM_ID, "s1", "moved", SESSION_A)

        counts = reaction_counts(client, ALBUM_ID)
        self.assertEqual(counts["love"], 2)
        self.assertEqual(counts["moved"], 1)
        self.assertEqual(counts["smile"], 0)

    def test_guestbook_entry_is_readable_then_only_the_author_can_delete_it(self) -> None:
        client = FakeSupabase()
        entry = add_guestbook_entry(client, ALBUM_ID, "이모", "예쁘다", SESSION_A)
        self.assertEqual(len(list_guestbook_entries(client, ALBUM_ID)), 1)

        # A different session cannot delete it.
        with self.assertRaises(Exception):
            delete_own_guestbook_entry(client, ALBUM_ID, entry["id"], SESSION_B)
        self.assertEqual(len(list_guestbook_entries(client, ALBUM_ID)), 1)

        # The author soft-deletes it; it disappears from the visible list.
        delete_own_guestbook_entry(client, ALBUM_ID, entry["id"], SESSION_A)
        self.assertEqual(list_guestbook_entries(client, ALBUM_ID), [])
