from __future__ import annotations

import unittest

from app.services.story_overlap import (
    epilogue_conflicts_with_chapters,
    normalize_story_text,
    stories_are_overlapping,
)


class StoryOverlapServiceTests(unittest.TestCase):
    def test_identical_conflicts(self) -> None:
        text = "그날의 웃음이 아직도 선명하다."
        self.assertTrue(stories_are_overlapping(text, text))
        self.assertTrue(epilogue_conflicts_with_chapters(text, {"0": text}))

    def test_empty_epilogue_never_conflicts(self) -> None:
        self.assertFalse(epilogue_conflicts_with_chapters("", {"0": "월별 이야기"}))
        self.assertFalse(epilogue_conflicts_with_chapters(None, {"0": "월별 이야기"}))

    def test_distinct_ok(self) -> None:
        self.assertFalse(
            epilogue_conflicts_with_chapters(
                "함께 만든 앨범에 고마운 마음을 남긴다.",
                {"0": "공항에서 출발하며 설렜다.", "1": "바다를 걸었다."},
            )
        )

    def test_normalize(self) -> None:
        self.assertEqual(normalize_story_text("  a   b\n"), "a b")


if __name__ == "__main__":
    unittest.main()
