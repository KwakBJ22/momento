from unittest import TestCase

from app.services.story_rules import (
    MIN_DATE_STORY_PHOTO_COUNT,
    visible_date_stories,
)


class AlbumRenderingRulesTests(TestCase):
    def test_only_date_groups_at_the_existing_minimum_show_stories(self) -> None:
        photos = [
            {"taken_at": "2026-07-12T10:00:00Z"}
            for _ in range(MIN_DATE_STORY_PHOTO_COUNT - 1)
        ] + [
            {"taken_at": "2026-07-13T10:00:00Z"}
            for _ in range(MIN_DATE_STORY_PHOTO_COUNT)
        ]

        visible = visible_date_stories(
            {
                "2026-07-12": "기준 미달",
                "2026-07-13": "기준 충족",
                "2026-07": "월별 이야기는 숨김",
                "0": "날짜 없는 이야기는 숨김",
            },
            photos,
        )

        self.assertEqual(visible, {"2026-07-13": "기준 충족"})
