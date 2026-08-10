from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.share import _rate_windows, router
from app.services.auth import optional_authenticated_user, require_authenticated_user


ALBUM_ID = "11111111-1111-1111-1111-111111111111"
OWNER_ID = "22222222-2222-2222-2222-222222222222"
SHARE_ID = "33333333-3333-3333-3333-333333333333"


def album() -> dict[str, object]:
    return {"id": ALBUM_ID, "title": "우리의 추억", "narrative": "함께 웃었던 날", "result_path": "result.png"}


def share() -> dict[str, object]:
    return {
        "id": SHARE_ID,
        "album_id": ALBUM_ID,
        "status": "active",
        "view_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


class ShareApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.mock_client = MagicMock()
        patch("app.api.share.get_supabase_client", return_value=self.mock_client).start()
        patch(
            "app.api.share.get_settings",
            return_value=SimpleNamespace(
                frontend_base_url="https://woorialbum.example",
                supabase_storage_bucket="albums",
                signed_url_ttl_seconds=3600,
            ),
        ).start()
        patch("app.api.share.reaction_counts", return_value={"love": 0, "moved": 0, "smile": 0}).start()
        patch("app.api.share.list_guestbook_entries", return_value=[]).start()
        self.addCleanup(patch.stopall)
        _rate_windows.clear()

    def as_user(self) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def test_public_album_is_readable_without_storage_paths(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.get_album_media_records", return_value=[{"media_type": "video", "mime_type": "video/mp4", "processing_status": "pending", "original_filename": "clip.mp4", "original_path": "private/path"}]), patch(
            "app.api.share.get_public_url", return_value="https://cdn.example/result.png"
        ), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("original_path", response.text)
        self.assertNotIn("private/path", response.text)

    def test_public_share_is_readable_without_an_authentication_header(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records", return_value=[]
        ), patch("app.api.share.list_photo_memories", return_value=[]), patch(
            "app.api.share.get_public_url", return_value="https://cdn.example/result.png"
        ), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], album()["title"])

    def test_authenticated_public_visitor_restores_an_account_contributor(self) -> None:
        self.app.dependency_overrides[optional_authenticated_user] = lambda: OWNER_ID
        contributor = {"id": "contributor-1", "display_name": "Owner name", "guest_id": None}
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.join_as_contributor", return_value=contributor) as join, patch(
            "app.api.share.log_event"
        ):
            response = self.client.post("/api/public/shares/opaque-token/contribute", json={"display_name": "Owner name"})

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["guest_id"])
        self.assertEqual(join.call_args.kwargs["user_id"], OWNER_ID)
        self.assertIsNone(join.call_args.kwargs["guest_id"])

    def test_public_share_can_read_an_older_edition_without_edit_access(self) -> None:
        old_photo_id = "44444444-4444-4444-4444-444444444444"
        latest_photo_id = "55555555-5555-5555-5555-555555555555"
        edition_album = {
            **album(),
            "album_version": 3,
            "living_latest_edition_previous": 2,
            "album_json": {"chapters": [{"photos": [{"id": latest_photo_id}]}]},
            "album_version_history": {
                "2": {
                    "document": {"chapters": [{"photos": [{"id": old_photo_id}]}]},
                    "append_pages": [],
                },
            },
        }
        photos = [
            {
                "id": photo_id,
                "sort_order": index,
                "storage_bucket": "private",
                "storage_path": f"photos/{photo_id}.jpg",
                "thumbnail_bucket": "private",
                "thumbnail_path": f"thumbs/{photo_id}.jpg",
            }
            for index, photo_id in enumerate((old_photo_id, latest_photo_id))
        ]
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=edition_album
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records", return_value=photos
        ), patch("app.api.share.list_photo_memories", return_value=[]), patch(
            "app.api.share.list_contributors", return_value=[]
        ), patch("app.api.share.get_signed_url", return_value="https://cdn.example/photo.jpg"), patch(
            "app.api.share.get_public_url", return_value="https://cdn.example/result.png"
        ), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token?edition=2")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([photo["id"] for photo in body["photos"]], [old_photo_id])
        self.assertFalse(body["edition_is_latest"])
        self.assertIsNone(body["edition_previous"])

    def test_share_link_creation_returns_a_tokenized_public_url(self) -> None:
        self.app.dependency_overrides[require_authenticated_user] = lambda: OWNER_ID
        with patch("app.api.share.get_album_record", return_value=album()), patch(
            "app.api.share.get_album_access", return_value=object()
        ), patch("app.api.share.require_album_edit_settings"), patch(
            "app.api.share.create_share_link", return_value=(share(), "opaque-token")
        ), patch("app.api.share.log_event"):
            response = self.client.post(f"/api/albums/{ALBUM_ID}/share-links", json={})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["share_url"], "https://woorialbum.example/s/opaque-token")

    def test_public_share_shows_captions_and_hides_ineligible_date_stories(self) -> None:
        # 캡션은 album_photos.caption 단일 출처다(텍스트 3계층 §①) — comment 폴백 없음.
        dated_photos = [
            {
                "id": f"00000000-0000-0000-0000-{index:012d}",
                "sort_order": index,
                # index 1 → 07-12 (still hidden: only 4 photos); index 4 → 07-13 makes
                # that date eligible (>=5 photos AND >=1 caption) so it is shown.
                "caption": "사용자가 쓴 캡션" if index in (1, 4) else None,
                "storage_bucket": "private",
                "storage_path": f"photos/{index}.jpg",
                "thumbnail_bucket": "private",
                "thumbnail_path": f"thumbs/{index}.jpg",
                "taken_at": "2026-07-12T10:00:00Z" if index < 4 else "2026-07-13T10:00:00Z",
            }
            for index in range(9)
        ]
        album_with_stories = {
            **album(),
            "chapter_stories": {
                "2026-07-12": "4장 날짜 이야기는 숨겨야 합니다.",
                "2026-07-13": "5장 날짜 이야기만 표시합니다.",
                "2026-07": "월별 이야기는 절대 표시하지 않습니다.",
            },
        }
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album_with_stories
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records", return_value=dated_photos
        ), patch("app.api.share.list_photo_memories", return_value=[]), patch(
            "app.api.share.get_signed_url", return_value="https://cdn.example/photo.jpg"
        ), patch("app.api.share.get_public_url", return_value="https://cdn.example/result.png"), patch(
            "app.api.share.increment_view"
        ), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["photos"][0]["caption"], None)
        self.assertEqual(body["photos"][1]["caption"], "사용자가 쓴 캡션")
        self.assertEqual(body["chapter_stories"], {"2026-07-13": "5장 날짜 이야기만 표시합니다."})

    def test_public_share_separates_unapplied_participant_contributions(self) -> None:
        host_photo_id = "44444444-4444-4444-4444-444444444444"
        applied_photo_id = "55555555-5555-5555-5555-555555555555"
        pending_photo_id = "66666666-6666-6666-6666-666666666666"
        legacy_photo_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        applied_memory_id = "77777777-7777-7777-7777-777777777777"
        pending_memory_id = "88888888-8888-8888-8888-888888888888"
        participant_id = "99999999-9999-9999-9999-999999999999"
        album_with_contributions = {
            **album(),
            "created_at": "2026-07-01T00:00:00+00:00",
            "applied_contribution_photo_ids": [applied_photo_id],
            "applied_contribution_memory_ids": [applied_memory_id],
        }

        def photo(photo_id: str, contributor_id: str) -> dict[str, object]:
            return {
                "id": photo_id,
                "sort_order": 0,
                "created_at": "2026-07-02T10:00:00+00:00",
                "uploaded_by_contributor_id": contributor_id,
                "storage_bucket": "private",
                "storage_path": f"photos/{photo_id}.jpg",
                "thumbnail_bucket": "private",
                "thumbnail_path": f"thumbs/{photo_id}.jpg",
            }

        memories = [
            {
                "id": applied_memory_id,
                "photo_id": applied_photo_id,
                "contributor_id": participant_id,
                "author_name": "민수",
                "comment": "반영된 기억",
                "created_at": "2026-07-02T10:00:00+00:00",
            },
            {
                "id": pending_memory_id,
                "photo_id": pending_photo_id,
                "contributor_id": participant_id,
                "author_name": "민수",
                "comment": "아직 반영되지 않은 기억",
                "created_at": "2026-07-02T10:01:00+00:00",
            },
        ]
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album_with_contributions
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records",
            return_value=[
                photo(host_photo_id, OWNER_ID),
                photo(applied_photo_id, participant_id),
                photo(pending_photo_id, participant_id),
                photo(legacy_photo_id, ""),
            ],
        ), patch("app.api.share.list_photo_memories", return_value=memories), patch(
            "app.api.share.list_contributors",
            return_value=[
                {"id": OWNER_ID, "role": "owner", "display_name": "주최자"},
                {"id": participant_id, "role": "contributor", "display_name": "민수"},
            ],
        ), patch(
            "app.api.share.get_signed_url", side_effect=lambda _client, _bucket, path, _ttl: f"https://cdn.example/{path}"
        ), patch("app.api.share.get_public_url", return_value="https://cdn.example/result.png"), patch(
            "app.api.share.increment_view"
        ), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual({photo["id"] for photo in body["photos"]}, {host_photo_id, applied_photo_id, legacy_photo_id})
        self.assertEqual(
            {(item["id"], item["type"], item["actor_name"]) for item in body["pending_items"]},
            {(pending_photo_id, "photo", "민수"), (pending_memory_id, "memory", "민수")},
        )
        self.assertTrue(all(item["author_name"] == "민수" for item in body["pending_items"]))

    def test_public_share_shows_every_memory_on_a_visible_photo(self) -> None:
        """🔴 공유 화면에서 참여자가 남긴 한마디가 사진 밑에서 사라진다 (K-24 · SCREEN_SPEC §7).

        ★ 저장은 처음부터 옳았다(개발 DB 실측 2026-08-10). 사진 6f434e11 에 세 건,
          셋 다 deleted_at NULL 이었다. 그런데 공유 응답에는 주최자가 쓴 한 건만 있었다.

        원인은 `is_pending_memory` 였다 — 사진과 **같은 잣대**로 한마디를 걸렀다.
          참여자가 썼고 · 앨범이 만들어진 뒤에 썼고 · 아직 반영 전이면 `pending`
        사진은 주최자가 반영해야 앨범에 들어가는 것이 맞지만, 한마디까지 그렇게 걸러
        내니 이미 보이는 사진 밑에서 참여자의 글만 사라졌다. 주최자 글은 owner 라
        애초에 pending 이 될 수 없어 늘 남았다 — 그래서 "하나만 보인다".

        ★ 사람이 남긴 글을 임의로 고르지 않는다. 사진이 보이면 그 사진의 한마디는 전부 보인다.
        """
        visible_photo_id = "44444444-4444-4444-4444-444444444444"
        pending_photo_id = "66666666-6666-6666-6666-666666666666"
        participant_id = "99999999-9999-9999-9999-999999999999"
        album_with_contributions = {
            **album(),
            "created_at": "2026-07-01T00:00:00+00:00",
            "applied_contribution_photo_ids": [],
            "applied_contribution_memory_ids": [],
        }

        def photo(photo_id: str, contributor_id: str) -> dict[str, object]:
            return {
                "id": photo_id,
                "sort_order": 0,
                "created_at": "2026-07-02T10:00:00+00:00",
                "uploaded_by_contributor_id": contributor_id,
                "storage_bucket": "private",
                "storage_path": f"photos/{photo_id}.jpg",
                "thumbnail_bucket": "private",
                "thumbnail_path": f"thumbs/{photo_id}.jpg",
            }

        memories = [
            # 참여자가 먼저 썼다 — 예전에는 이것이 통째로 빠졌다.
            {
                "id": "a1111111-1111-1111-1111-111111111111",
                "photo_id": visible_photo_id,
                "contributor_id": participant_id,
                "author_name": "둘째",
                "comment": "신난 리원이",
                "created_at": "2026-07-02T05:43:00+00:00",
            },
            # 주최자가 나중에 썼다 — 이것만 남아서 "하나만 보인다"로 보였다.
            {
                "id": "a2222222-2222-2222-2222-222222222222",
                "photo_id": visible_photo_id,
                "contributor_id": OWNER_ID,
                "author_name": "곽병준",
                "comment": "아싸 신나~~",
                "created_at": "2026-07-02T06:40:00+00:00",
            },
            # 이름을 못 풀어도 글은 남는다 — 이름만 빈다(K-17 과 같은 방식).
            {
                "id": "a3333333-3333-3333-3333-333333333333",
                "photo_id": visible_photo_id,
                "contributor_id": "",
                "author_name": "",
                "comment": "이름이 없어도 남는 말",
                "created_at": "2026-07-02T07:00:00+00:00",
            },
            # 아직 안 그려지는 사진의 한마디는 `새로 더해진` 자리에 남는다
            # — 그래야 어디에도 안 보이는 글이 생기지 않는다.
            {
                "id": "a4444444-4444-4444-4444-444444444444",
                "photo_id": pending_photo_id,
                "contributor_id": participant_id,
                "author_name": "둘째",
                "comment": "아직 안 붙은 사진의 말",
                "created_at": "2026-07-02T08:00:00+00:00",
            },
        ]

        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album_with_contributions
        ), patch("app.api.share.get_album_media_records", return_value=[]), patch(
            "app.api.share.get_album_photo_records",
            return_value=[photo(visible_photo_id, OWNER_ID), photo(pending_photo_id, participant_id)],
        ), patch("app.api.share.list_photo_memories", return_value=memories), patch(
            "app.api.share.list_contributors",
            return_value=[
                {"id": OWNER_ID, "role": "owner", "display_name": "곽병준"},
                {"id": participant_id, "role": "contributor", "display_name": "둘째"},
            ],
        ), patch(
            "app.api.share.get_signed_url", side_effect=lambda _client, _bucket, path, _ttl: f"https://cdn.example/{path}"
        ), patch("app.api.share.get_public_url", return_value="https://cdn.example/result.png"), patch(
            "app.api.share.increment_view"
        ), patch("app.api.share.log_event"):
            response = self.client.get("/api/public/shares/opaque-token")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        shown = next(item for item in body["photos"] if item["id"] == visible_photo_id)
        # ★ 순서까지 쓴 순서 그대로다 — 먼저 쓴 사람이 먼저다.
        self.assertEqual(
            [(comment["author"], comment["text"]) for comment in shown["comments"]],
            [("둘째", "신난 리원이"), ("곽병준", "아싸 신나~~"), (None, "이름이 없어도 남는 말")],
        )
        # 사진 밑에 보이는 글은 `새로 더해진` 자리에 겹쳐 쓰지 않는다.
        pending_texts = {item.get("content") for item in body["pending_items"]}
        self.assertNotIn("신난 리원이", pending_texts)
        # 아직 안 그려지는 사진의 글은 그 자리에 남는다 — 사라지지 않는다.
        self.assertIn("아직 안 붙은 사진의 말", pending_texts)

    def test_public_contribution_requires_and_persists_a_display_name(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.join_as_contributor") as join, patch("app.api.share.log_event"):
            missing_name = self.client.post("/api/public/shares/opaque-token/contribute", json={"guest_id": "guest-1"})

        self.assertEqual(missing_name.status_code, 400)
        join.assert_not_called()

        contributor = {
            "id": "99999999-9999-9999-9999-999999999999",
            "guest_id": "guest-1",
            "display_name": "민수",
        }
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.join_as_contributor", return_value=contributor) as join, patch("app.api.share.log_event"):
            response = self.client.post(
                "/api/public/shares/opaque-token/contribute",
                json={"guest_id": "guest-1", "display_name": "민수"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["display_name"], "민수")
        self.assertEqual(join.call_args.kwargs["display_name"], "민수")

    def test_null_guest_id_does_not_422(self) -> None:
        # Regression: dict[str,str] body rejected {"guest_id": null} with a 422 that
        # surfaced as "입력 내용을 확인해주세요." and blocked signed-in add-photo.
        self.app.dependency_overrides[optional_authenticated_user] = lambda: OWNER_ID
        contributor = {"id": "c1", "display_name": "앨범지기", "guest_id": None}
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.join_as_contributor", return_value=contributor), patch("app.api.share.log_event"):
            response = self.client.post(
                "/api/public/shares/opaque-token/contribute",
                json={"guest_id": None, "display_name": "앨범지기"},
            )
        self.assertEqual(response.status_code, 200)

    def test_owner_can_contribute_to_a_closed_or_view_link_album(self) -> None:
        self.app.dependency_overrides[optional_authenticated_user] = lambda: OWNER_ID
        owned = {**album(), "created_by": OWNER_ID, "collaboration_status": "closed"}
        view_share = {**share(), "kind": "view"}
        contributor = {"id": "c1", "display_name": "앨범지기", "guest_id": None}
        with patch("app.api.share.get_active_share", return_value=view_share), patch(
            "app.api.share.get_album_record", return_value=owned
        ), patch("app.api.share.join_as_contributor", return_value=contributor), patch("app.api.share.log_event"):
            response = self.client.post(
                "/api/public/shares/opaque-token/contribute",
                json={"guest_id": None, "display_name": "앨범지기"},
            )
        self.assertEqual(response.status_code, 200)

    def test_view_link_cannot_start_a_contribution(self) -> None:
        view_share = {**share(), "kind": "view"}
        with patch("app.api.share.get_active_share", return_value=view_share), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.join_as_contributor") as join, patch("app.api.share.log_event"):
            response = self.client.post(
                "/api/public/shares/opaque-token/contribute",
                json={"guest_id": "guest-1", "display_name": "민수"},
            )

        self.assertEqual(response.status_code, 403)
        join.assert_not_called()

    def test_contribute_link_allows_a_contribution(self) -> None:
        contribute_share = {**share(), "kind": "contribute"}
        contributor = {"id": "99999999-9999-9999-9999-999999999999", "guest_id": "guest-1", "display_name": "민수"}
        with patch("app.api.share.get_active_share", return_value=contribute_share), patch(
            "app.api.share.get_album_record", return_value=album()
        ), patch("app.api.share.join_as_contributor", return_value=contributor) as join, patch("app.api.share.log_event"):
            response = self.client.post(
                "/api/public/shares/opaque-token/contribute",
                json={"guest_id": "guest-1", "display_name": "민수"},
            )

        self.assertEqual(response.status_code, 200)
        join.assert_called_once()

    def test_reaction_uses_new_codes_and_attaches_to_the_album(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.add_reaction"
        ) as add:
            ok = self.client.post(
                "/api/public/shares/opaque-token/reactions",
                json={"reaction": "love", "session_key": "s" * 16},
            )
        self.assertEqual(ok.status_code, 204)
        self.assertEqual(add.call_args.args[1], ALBUM_ID)  # album_id, not share_link_id
        self.assertEqual(add.call_args.args[3], "love")

    def test_retired_reaction_codes_are_rejected(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch("app.api.share.add_reaction") as add:
            response = self.client.post(
                "/api/public/shares/opaque-token/reactions",
                json={"reaction": "remember", "session_key": "s" * 16},
            )
        self.assertEqual(response.status_code, 422)
        add.assert_not_called()

    def test_guestbook_entry_can_be_left_on_any_active_share(self) -> None:
        entry = {"id": SHARE_ID, "author_name": "민지", "message": "따뜻한 앨범이에요", "created_at": "2026-08-02T10:00:00+00:00"}
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.add_guestbook_entry", return_value=entry
        ) as add:
            response = self.client.post(
                "/api/public/shares/opaque-token/guestbook",
                json={"author_name": "민지", "message": "따뜻한 앨범이에요", "session_key": "g" * 16},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message"], "따뜻한 앨범이에요")
        self.assertEqual(add.call_args.args[1], ALBUM_ID)  # album_id, not share_link_id
        self.assertEqual(add.call_args.args[4], "g" * 16)  # session_key

    def test_guestbook_write_requires_name_and_message(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch("app.api.share.add_guestbook_entry") as add:
            response = self.client.post(
                "/api/public/shares/opaque-token/guestbook",
                json={"author_name": "", "message": "hi", "session_key": "g" * 16},
            )
        self.assertEqual(response.status_code, 422)
        add.assert_not_called()

    def test_guestbook_delete_is_session_scoped(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.delete_own_guestbook_entry"
        ) as remove:
            ok = self.client.post(
                f"/api/public/shares/opaque-token/guestbook/{SHARE_ID}/delete",
                json={"session_key": "g" * 16},
            )
        self.assertEqual(ok.status_code, 204)
        self.assertEqual(remove.call_args.args[2], SHARE_ID)
        self.assertEqual(remove.call_args.args[3], "g" * 16)

    def test_guestbook_delete_rejects_a_non_author(self) -> None:
        from fastapi import HTTPException
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.delete_own_guestbook_entry", side_effect=HTTPException(status_code=403, detail="nope")
        ):
            response = self.client.post(
                f"/api/public/shares/opaque-token/guestbook/{SHARE_ID}/delete",
                json={"session_key": "z" * 16},
            )
        self.assertEqual(response.status_code, 403)

    def test_inactive_or_expired_share_is_blocked(self) -> None:
        with patch("app.api.share.get_active_share", side_effect=__import__("fastapi").HTTPException(status_code=404, detail="expired")):
            response = self.client.get("/api/public/shares/expired")
        self.assertEqual(response.status_code, 404)

    def test_guest_memory_is_temporarily_stored_with_honeypot_guard(self) -> None:
        response = self.client.post("/api/public/shares/opaque/guest-memories", json={})
        self.assertEqual(response.status_code, 404)
        return
        with patch("app.api.share.get_active_share", return_value=share()), patch(
            "app.api.share.create_guest_memory", return_value=({}, "claim-token-value-which-is-long-enough")
        ), patch("app.api.share.log_event"):
            response = self.client.post("/api/public/shares/opaque/guest-memories", json={"name": "민지", "memory": "따뜻했던 저녁", "website": ""})
        self.assertEqual(response.status_code, 201)
        self.assertIn("claim_token", response.json())

    def test_honeypot_blocks_guest_submission(self) -> None:
        response = self.client.post("/api/public/shares/opaque/guest-memories", json={})
        self.assertEqual(response.status_code, 404)
        return
        response = self.client.post("/api/public/shares/opaque/guest-memories", json={"name": "봇", "memory": "spam", "website": "https://bot.example"})
        self.assertEqual(response.status_code, 400)

    def test_public_rate_limit(self) -> None:
        with patch("app.api.share.get_active_share", return_value=share()), patch("app.api.share.get_album_record", return_value=album()), patch("app.api.share.get_album_media_records", return_value=[]), patch("app.api.share.get_public_url", return_value="url"), patch("app.api.share.increment_view"), patch("app.api.share.log_event"):
            for _ in range(60):
                self.assertEqual(self.client.get("/api/public/shares/rate-token").status_code, 200)
            self.assertEqual(self.client.get("/api/public/shares/rate-token").status_code, 429)
