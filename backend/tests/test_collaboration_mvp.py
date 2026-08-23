from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.services.collaboration_service import (
    MAX_BATCH_UPLOAD,
    LIVING_APPEND_MEMORY_THRESHOLD,
    LIVING_APPEND_PHOTO_THRESHOLD,
    apply_selected_contributions,
    build_album_document_from_records,
    rebuild_album,
    sanitize_memory_comment,
)
from app.models.schemas import CollaborationJoinRequest


class _Query:
    def __init__(self, responses: list[list[dict]] | None = None) -> None:
        self.responses = list(responses or [])
        self.updates: list[dict] = []

    def update(self, value: dict):
        self.updates.append(value)
        return self

    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def is_(self, *_args):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self.responses.pop(0) if self.responses else [{}])


class _RebuildClient:
    def __init__(self, lock_rows: list[dict]) -> None:
        self.albums = _Query([lock_rows, [{}], [{}]])
        self.photos = _Query([[]])

    def table(self, name: str):
        return self.albums if name == "albums" else self.photos


class CollaborationServiceTests(unittest.TestCase):
    def test_join_relationships_match_the_invitation_chips(self) -> None:
        for relationship in ("가족", "친구", "연인", "지인", "기타"):
            request = CollaborationJoinRequest(display_name="테스트", relationship=relationship)
            self.assertEqual(request.relationship, relationship)

    def test_batch_limit(self) -> None:
        self.assertEqual(MAX_BATCH_UPLOAD, 30)

    def test_rebuild_uses_current_database_photos_when_no_document_is_supplied(self) -> None:
        source = (__import__("pathlib").Path(__file__).resolve().parents[1] / "app" / "api" / "collaboration.py").read_text(encoding="utf-8")
        self.assertIn("result = rebuild_album(client, album, album_json=None, force=body.force)", source)
        self.assertIn("사진을 추가한 뒤 앨범을 만들어주세요.", source)

    def test_rebuild_has_no_quota_and_preserves_the_previous_document(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        album = {
            "id": "a1",
            "dirty": True,
            "album_version": 2,
            "album_json": {"title": "이전 앨범"},
            "album_version_history": {"1": {"title": "첫 앨범"}},
            "collaboration_status": "collecting",
        }
        with patch("app.services.collaboration_service.list_photo_memories", return_value=[]):
            result = rebuild_album(client, album, album_json={"title": "새 앨범"}, force=True)
            second = rebuild_album(
                client,
                {
                    **album,
                    "album_version": result["album_version"],
                    "album_json": result["album_json"],
                    "album_version_history": {"1": {"title": "첫 앨범"}, "2": {"title": "이전 앨범"}},
                    "dirty": True,
                },
                album_json={"title": "두 번째 새 앨범"},
                force=True,
            )

        self.assertEqual(result["album_version"], 3)
        self.assertEqual(second["album_version"], 4)
        document_updates = [update for update in client.albums.updates if "album_json" in update]
        document_update = document_updates[-1]
        self.assertEqual(document_update["album_version_history"], {
            "1": {"title": "첫 앨범"},
            "2": {"title": "이전 앨범"},
            "3": {"title": "새 앨범"},
        })
        self.assertIsNone(client.albums.updates[-1]["last_rebuild_started_at"])

    def test_rebuild_rejects_only_an_in_progress_duplicate(self) -> None:
        client = _RebuildClient(lock_rows=[])
        with self.assertRaises(HTTPException) as raised:
            rebuild_album(client, {"id": "a1", "dirty": True}, album_json={"title": "새 앨범"}, force=True)

        self.assertEqual(raised.exception.status_code, 409)

    def test_selected_contributions_cannot_exceed_thirty_photos(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        existing = [
            {
                "id": f"owner-{index}",
                "uploaded_by_contributor_id": "owner",
                "created_at": "2026-07-01T00:00:00+00:00",
                "status": "ready",
            }
            for index in range(28)
        ]
        incoming = [
            {
                "id": f"guest-{index}",
                "uploaded_by_contributor_id": "guest",
                "created_at": "2026-07-02T00:00:00+00:00",
                "status": "ready",
            }
            for index in range(3)
        ]
        client.photos = _Query([existing + incoming])
        album = {"id": "a1", "created_at": "2026-07-01T00:00:00+00:00", "photo_limit": 30}
        with patch("app.services.collaboration_service.list_contributors", return_value=[{"id": "owner", "role": "owner"}]), patch(
            "app.services.collaboration_service.list_photo_memories", return_value=[]
        ), patch("app.services.collaboration_service.rebuild_album") as rebuild:
            with self.assertRaises(HTTPException) as raised:
                apply_selected_contributions(
                    client,
                    album,
                    photo_ids={"guest-0", "guest-1", "guest-2"},
                    memory_ids=set(),
                )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("사진 30장", raised.exception.detail)
        rebuild.assert_not_called()

    def test_build_document_groups_by_date_and_keeps_undated_last(self) -> None:
        """★ 2026-08-19 — 이름이 `merges_undated` 였다. 이제 **섞지 않는다.**

        날짜 없는 사진을 마지막 날짜 묶음에 섞어 넣으면 남의 날짜와 장소를 뒤집어쓰고,
        날짜 없는 묶음이 사라져 화면이 `날짜를 넣어 주세요` 를 그릴 자리도 없어진다.
        화면 엔진(chapterGroup.ts)이 하는 것과 **같은 규칙**으로 맞춘다.
        ★ 사진은 한 장도 빠지지 않는다 — 그것이 이 검사의 본래 목적이다.
        """
        album = {"id": "a1", "title": "여행", "narrative": "우리 이야기"}
        photos = [
            {"id": "p1", "status": "ready", "taken_at": "2026-07-12T10:00:00+00:00", "sort_order": 0},
            {"id": "p2", "status": "ready", "taken_at": "2026-07-12T12:00:00+00:00", "sort_order": 1},
            {"id": "p3", "status": "ready", "taken_at": None, "sort_order": 2},
        ]
        memories = [
            {
                "id": "m1",
                "photo_id": "p1",
                "author_name": "아빠",
                "comment": "출발 전이라 설렜다.",
                "contributor_id": "c1",
                "created_at": "2026-07-12T11:00:00+00:00",
            },
            {
                "id": "m2",
                "photo_id": "p1",
                "author_name": "엄마",
                "comment": "아이들이 들떴다.",
                "contributor_id": "c2",
                "created_at": "2026-07-12T11:05:00+00:00",
            },
        ]
        document = build_album_document_from_records(album, photos, memories)
        # 날짜 있는 묶음 하나 + 날짜 없는 묶음 하나.
        self.assertEqual(len(document["chapters"]), 2)
        # ★ 사진은 한 장도 빠지지 않는다(3장 그대로).
        self.assertEqual(sum(len(c["photos"]) for c in document["chapters"]), 3)
        self.assertEqual([p["id"] for p in document["chapters"][0]["photos"]], ["p1", "p2"])
        # 날짜 없는 것은 **맨 뒤 제 묶음**이다.
        self.assertIsNone(document["chapters"][-1]["date"])
        self.assertEqual([p["id"] for p in document["chapters"][-1]["photos"]], ["p3"])
        self.assertEqual(document["chapters"][0]["kind"], "event")
        self.assertNotEqual(document["chapters"][0]["title"], "Day 1")
        self.assertEqual(document["epilogue"], "우리 이야기")
        self.assertEqual(document["narrative"], "우리 이야기")
        self.assertEqual(document["chapters"][0]["photos"][0]["memories"][0]["author_name"], "아빠")
        kinds = [block["kind"] for block in document["chapters"][0]["blocks"]]
        self.assertIn("MemoryBlock", kinds)
        self.assertNotIn("Story", kinds)
        self.assertNotIn("Hero", kinds)
        self.assertNotIn("Polaroid3", kinds)
        self.assertEqual(kinds[0], "Grid6")

    def test_chapter_stories_field_ignored(self) -> None:
        album = {
            "id": "a1",
            "title": "여행",
            "epilogue": "전체 마무리",
            "chapter_stories": {"2026-07-12": "그날의 출발이 설렜다."},
        }
        photos = [
            {"id": "p1", "status": "ready", "taken_at": "2026-07-12T10:00:00+00:00", "sort_order": 0},
        ]
        document = build_album_document_from_records(album, photos, [])
        kinds = [block["kind"] for block in document["chapters"][0]["blocks"]]
        self.assertNotIn("Story", kinds)
        self.assertIsNone(document["chapters"][0]["storyBody"])
        self.assertEqual(document["epilogue"], "전체 마무리")
        self.assertNotIn("chapterStories", document)

    def test_consecutive_trip_uses_day_labels(self) -> None:
        album = {"id": "a1", "title": "다낭", "narrative": "여행 이야기"}
        photos = [
            {"id": "p1", "status": "ready", "taken_at": "2018-07-12T10:00:00+00:00", "sort_order": 0},
            {"id": "p2", "status": "ready", "taken_at": "2018-07-13T10:00:00+00:00", "sort_order": 1},
            {"id": "p3", "status": "ready", "taken_at": "2018-07-14T10:00:00+00:00", "sort_order": 2},
            {"id": "p4", "status": "ready", "taken_at": "2018-07-15T10:00:00+00:00", "sort_order": 3},
        ]
        document = build_album_document_from_records(album, photos, [])
        self.assertEqual(len(document["chapters"]), 4)
        self.assertEqual([c["title"] for c in document["chapters"]], ["Day 1", "Day 2", "Day 3", "Day 4"])
        story_chapters = [c for c in document["chapters"] if any(b["kind"] == "Story" for b in c["blocks"])]
        self.assertEqual(len(story_chapters), 0)  # epilogue/narrative no longer injected as Story

    def test_distant_dates_are_separate_events(self) -> None:
        album = {"id": "a1", "title": "모음", "narrative": "추억"}
        photos = [
            {
                "id": "p1",
                "status": "ready",
                "taken_at": "2018-07-12T10:00:00+00:00",
                "sort_order": 0,
                "location_name": "다낭",
                "location_source": "user",
            },
            {
                "id": "p2",
                "status": "ready",
                "taken_at": "2019-01-05T10:00:00+00:00",
                "sort_order": 1,
                "location_name": "서울",
                "location_source": "user",
            },
        ]
        document = build_album_document_from_records(album, photos, [])
        self.assertEqual(len(document["chapters"]), 2)
        self.assertEqual(document["chapters"][0]["title"], "2018년 7월 · 다낭")
        self.assertEqual(document["chapters"][1]["title"], "2019년 1월 · 서울")
        self.assertEqual(document["chapters"][0]["place"], "다낭")

    def test_sanitize_rejects_html(self) -> None:
        with self.assertRaises(HTTPException):
            sanitize_memory_comment("<script>alert(1)</script>")

    def test_sanitize_accepts_plain(self) -> None:
        self.assertEqual(sanitize_memory_comment("  정말 즐거웠다.  "), "정말 즐거웠다.")

    def test_multi_author_memory_block_segments(self) -> None:
        album = {"id": "a1", "title": "여행", "narrative": ""}
        photos = [
            {"id": "p1", "status": "ready", "taken_at": "2026-07-12T10:00:00+00:00", "sort_order": 0},
        ]
        memories = [
            {
                "id": "m1",
                "photo_id": "p1",
                "author_name": "아빠",
                "comment": "정말 즐거웠다.",
                "contributor_id": "c1",
                "created_at": "2026-07-12T11:00:00+00:00",
            },
            {
                "id": "m2",
                "photo_id": "p1",
                "author_name": "엄마",
                "comment": "아이들이 행복해했다.",
                "contributor_id": "c2",
                "created_at": "2026-07-12T11:01:00+00:00",
            },
            {
                "id": "m3",
                "photo_id": "p1",
                "author_name": "지민",
                "comment": "공항 핫도그가 기억난다.",
                "contributor_id": "c3",
                "created_at": "2026-07-12T11:02:00+00:00",
            },
        ]
        document = build_album_document_from_records(album, photos, memories)
        memory_blocks = [b for b in document["chapters"][0]["blocks"] if b["kind"] == "MemoryBlock"]
        self.assertEqual(len(memory_blocks), 1)
        self.assertEqual(len(memory_blocks[0]["segments"]), 3)
        self.assertEqual(memory_blocks[0]["segments"][0]["author"], "아빠")

    def test_small_contributions_append_a_final_living_page(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        owner_photo = {
            "id": "owner-1", "uploaded_by_contributor_id": "owner",
            "created_at": "2026-07-01T00:00:00+00:00", "status": "ready", "sort_order": 0,
        }
        guest_photos = [
            {
                "id": f"guest-{index}", "uploaded_by_contributor_id": "guest",
                "created_at": "2026-07-02T00:00:00+00:00", "status": "ready", "sort_order": index + 1,
            }
            for index in range(2)
        ]
        client.photos = _Query([[owner_photo, *guest_photos]])
        album = {"id": "a1", "created_at": "2026-07-01T00:00:00+00:00", "photo_limit": 30, "album_version": 1}
        with patch("app.services.collaboration_service.list_contributors", return_value=[{"id": "owner", "role": "owner"}]), patch(
            "app.services.collaboration_service.list_photo_memories", return_value=[]
        ), patch("app.services.collaboration_service.rebuild_album", return_value={"album_version": 2, "album_json": {}}):
            result = apply_selected_contributions(client, album, photo_ids={"guest-0", "guest-1"}, memory_ids=set())

        self.assertEqual(result["mode"], "append_page")
        self.assertIsNotNone(result["append_page_id"])
        living_update = next(update for update in client.albums.updates if "living_append_pages" in update)
        self.assertEqual(len(living_update["living_append_pages"]), 1)
        self.assertEqual(set(living_update["living_append_pages"][0]["photo_ids"]), {"guest-0", "guest-1"})

    def test_living_pages_accumulate_across_multiple_small_updates(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        owner = {"id": "owner", "uploaded_by_contributor_id": "owner", "created_at": "2026-07-01T00:00:00+00:00", "status": "ready", "sort_order": 0}
        first = {"id": "guest-1", "uploaded_by_contributor_id": "guest", "created_at": "2026-07-02T00:00:00+00:00", "status": "ready", "sort_order": 1}
        second = {"id": "guest-2", "uploaded_by_contributor_id": "guest", "created_at": "2026-07-03T00:00:00+00:00", "status": "ready", "sort_order": 2}
        album = {"id": "a1", "created_at": "2026-07-01T00:00:00+00:00", "photo_limit": 30, "album_version": 1}
        with patch("app.services.collaboration_service.list_contributors", return_value=[{"id": "owner", "role": "owner"}]), patch(
            "app.services.collaboration_service.list_photo_memories", return_value=[]
        ), patch("app.services.collaboration_service.rebuild_album", return_value={"album_version": 2, "album_json": {}}):
            client.photos = _Query([[owner, first]])
            first_result = apply_selected_contributions(client, album, photo_ids={"guest-1"}, memory_ids=set())
            first_pages = next(update for update in client.albums.updates if "living_append_pages" in update)["living_append_pages"]
            client.photos = _Query([[owner, first, second]])
            apply_selected_contributions(
                client,
                {
                    **album,
                    "album_version": 2,
                    "album_json": {},
                    "living_append_pages": first_pages,
                    "applied_contribution_photo_ids": ["guest-1"],
                },
                photo_ids={"guest-2"},
                memory_ids=set(),
            )

        # ★ 뒤집힌 항목 (2026-08-13 · PO 결정). 예전에는 부를 때마다 페이지를 한 장씩
        #   더해서 여기서 **2장**을 기대했다. 이제 올라올 때마다 서버가 자동으로 부르므로
        #   그대로 두면 한마디 3개에 페이지가 3장이 되어 앨범이 한 줄짜리 페이지로 덮인다.
        #   쌓이는 것은 그대로다 — 다만 **한 장 안에** 쌓인다.
        updates = [update for update in client.albums.updates if "living_append_pages" in update]
        pages = updates[-1]["living_append_pages"]
        self.assertEqual(len(pages), 1, "두 번째 반영이 새 페이지를 만들었다")
        self.assertEqual(pages[0]["id"], first_result["append_page_id"], "페이지 id 가 바뀌었다")
        self.assertEqual(pages[0]["photo_ids"], ["guest-1", "guest-2"], "먼저 올라온 것이 먼저 서야 한다")

    def test_many_contributions_default_to_a_new_edition(self) -> None:
        self.assertEqual(LIVING_APPEND_PHOTO_THRESHOLD, 5)
        self.assertEqual(LIVING_APPEND_MEMORY_THRESHOLD, 5)
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        owner_photo = {
            "id": "owner-1", "uploaded_by_contributor_id": "owner",
            "created_at": "2026-07-01T00:00:00+00:00", "status": "ready", "sort_order": 0,
        }
        guest_photos = [
            {
                "id": f"guest-{index}", "uploaded_by_contributor_id": "guest",
                "created_at": "2026-07-02T00:00:00+00:00", "status": "ready", "sort_order": index + 1,
            }
            for index in range(20)
        ]
        client.photos = _Query([[owner_photo, *guest_photos]])
        album = {
            "id": "a1", "created_at": "2026-07-01T00:00:00+00:00", "photo_limit": 30,
            "album_version": 4, "cover_photo_id": "owner-1",
        }
        with patch("app.services.collaboration_service.list_contributors", return_value=[{"id": "owner", "role": "owner"}]), patch(
            "app.services.collaboration_service.list_photo_memories", return_value=[]
        ), patch("app.services.collaboration_service.rebuild_album", return_value={"album_version": 5, "album_json": {}}):
            result = apply_selected_contributions(
                client, album, photo_ids={photo["id"] for photo in guest_photos}, memory_ids=set()
            )

        self.assertEqual(result["mode"], "edition")
        self.assertEqual(result["previous_edition"], 4)
        living_update = next(update for update in client.albums.updates if "living_append_pages" in update)
        self.assertEqual(living_update["living_append_pages"], [])
        self.assertEqual(living_update["cover_photo_id"], "owner-1")

    def test_explicit_append_mode_can_be_selected_for_many_items(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        owner_photo = {
            "id": "owner-1", "uploaded_by_contributor_id": "owner",
            "created_at": "2026-07-01T00:00:00+00:00", "status": "ready", "sort_order": 0,
        }
        guests = [
            {
                "id": f"guest-{index}", "uploaded_by_contributor_id": "guest",
                "created_at": "2026-07-02T00:00:00+00:00", "status": "ready", "sort_order": index + 1,
            }
            for index in range(6)
        ]
        client.photos = _Query([[owner_photo, *guests]])
        album = {"id": "a1", "created_at": "2026-07-01T00:00:00+00:00", "photo_limit": 30, "album_version": 1}
        with patch("app.services.collaboration_service.list_contributors", return_value=[{"id": "owner", "role": "owner"}]), patch(
            "app.services.collaboration_service.list_photo_memories", return_value=[]
        ), patch("app.services.collaboration_service.rebuild_album", return_value={"album_version": 2, "album_json": {}}):
            result = apply_selected_contributions(
                client, album, photo_ids={guest["id"] for guest in guests}, memory_ids=set(), mode="append_page"
            )

        self.assertEqual(result["mode"], "append_page")

    def test_explicit_edition_mode_can_be_selected_for_small_items(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        owner = {"id": "owner", "uploaded_by_contributor_id": "owner", "created_at": "2026-07-01T00:00:00+00:00", "status": "ready", "sort_order": 0}
        guest = {"id": "guest", "uploaded_by_contributor_id": "guest", "created_at": "2026-07-02T00:00:00+00:00", "status": "ready", "sort_order": 1}
        client.photos = _Query([[owner, guest]])
        album = {"id": "a1", "created_at": "2026-07-01T00:00:00+00:00", "photo_limit": 30, "album_version": 3}
        with patch("app.services.collaboration_service.list_contributors", return_value=[{"id": "owner", "role": "owner"}]), patch(
            "app.services.collaboration_service.list_photo_memories", return_value=[]
        ), patch("app.services.collaboration_service.rebuild_album", return_value={"album_version": 4, "album_json": {}}):
            result = apply_selected_contributions(client, album, photo_ids={"guest"}, memory_ids=set(), mode="edition")

        self.assertEqual(result["mode"], "edition")
        self.assertEqual(result["previous_edition"], 3)

    def test_new_edition_snapshot_keeps_the_previous_document_and_append_page(self) -> None:
        client = _RebuildClient(lock_rows=[{"id": "a1"}])
        album = {
            "id": "a1", "dirty": True, "album_version": 2,
            "album_json": {"chapters": [{"photos": [{"id": "old-photo"}]}]},
            "living_append_pages": [{"id": "page-1", "photo_ids": ["guest-photo"], "memory_ids": []}],
            "album_version_history": {},
        }
        with patch("app.services.collaboration_service.list_photo_memories", return_value=[]):
            rebuild_album(
                client,
                album,
                album_json={"chapters": [{"photos": [{"id": "old-photo"}, {"id": "guest-photo"}]}]},
                force=True,
                history_append_pages=album["living_append_pages"],
            )

        update = next(item for item in client.albums.updates if "album_version_history" in item)
        self.assertEqual(update["album_version_history"]["2"], {
            "document": album["album_json"],
            "append_pages": album["living_append_pages"],
        })


class JoinPreviewViewerMembershipTests(unittest.TestCase):
    """The join preview tells the client whether the signed-in viewer already
    owns/belongs to the album, so an owner opening their own invite link is sent to
    the album instead of the participant join form (server-side permission, §10)."""

    ALBUM_ID = "11111111-1111-1111-1111-111111111111"
    OWNER_ID = "22222222-2222-2222-2222-222222222222"

    def _client(self, *, viewer_id, can_read_private: bool):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.api import collaboration as collab
        from app.services.auth import optional_authenticated_user

        app = FastAPI()
        app.include_router(collab.router)
        app.dependency_overrides[optional_authenticated_user] = lambda: viewer_id

        album = {"id": self.ALBUM_ID, "title": "우리 앨범", "cover_photo_id": None,
                 "photo_limit": 30, "collaboration_status": "collecting"}
        access = SimpleNamespace(can_read_private=can_read_private)
        self._patchers = [
            patch.object(collab, "get_supabase_client", return_value=object()),
            patch.object(collab, "get_album_for_invite", return_value=(album, {})),
            patch.object(collab, "log_event", return_value=True),
            patch.object(collab, "get_album_photo_records", return_value=[]),
            patch.object(collab, "_owner_name", return_value="주인"),
            patch.object(collab, "count_active_contributors", return_value=0),
            patch.object(collab, "count_ready_photos", return_value=0),
            patch.object(collab, "get_album_access", return_value=access),
        ]
        for p in self._patchers:
            p.start()
        return TestClient(app)

    def tearDown(self) -> None:
        for p in getattr(self, "_patchers", []):
            p.stop()

    def test_owner_or_member_is_flagged(self) -> None:
        api = self._client(viewer_id=self.OWNER_ID, can_read_private=True)
        resp = api.get("/api/join/some-token")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["viewer_is_member"])

    def test_signed_in_non_member_is_not_flagged(self) -> None:
        api = self._client(viewer_id=self.OWNER_ID, can_read_private=False)
        resp = api.get("/api/join/some-token")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["viewer_is_member"])

    def test_anonymous_viewer_is_not_flagged(self) -> None:
        api = self._client(viewer_id=None, can_read_private=True)
        resp = api.get("/api/join/some-token")
        self.assertEqual(resp.status_code, 200)
        # Anonymous: membership is never claimed even if the album would allow reads.
        self.assertFalse(resp.json()["viewer_is_member"])


if __name__ == "__main__":
    unittest.main()
