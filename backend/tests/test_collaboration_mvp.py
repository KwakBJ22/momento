from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.services.collaboration_service import (
    MAX_BATCH_UPLOAD,
    build_album_document_from_records,
    sanitize_memory_comment,
)


class CollaborationServiceTests(unittest.TestCase):
    def test_batch_limit(self) -> None:
        self.assertEqual(MAX_BATCH_UPLOAD, 10)

    def test_build_document_groups_by_date_and_merges_undated(self) -> None:
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
        self.assertEqual(len(document["chapters"]), 1)
        self.assertEqual(len(document["chapters"][0]["photos"]), 3)
        self.assertEqual(document["chapters"][0]["kind"], "event")
        self.assertNotEqual(document["chapters"][0]["title"], "Day 1")
        self.assertEqual(document["epilogue"], "우리 이야기")
        self.assertEqual(document["narrative"], "우리 이야기")
        self.assertEqual(document["chapters"][0]["photos"][0]["memories"][0]["author_name"], "아빠")
        kinds = [block["kind"] for block in document["chapters"][0]["blocks"]]
        self.assertIn("MemoryBlock", kinds)
        self.assertNotIn("Story", kinds)

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


if __name__ == "__main__":
    unittest.main()
