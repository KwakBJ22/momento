from unittest import TestCase

from app.services.story_rules import (
    MIN_DATE_STORY_PHOTO_COUNT,
    visible_date_stories,
)


def _photos(date: str, count: int, commented: int = 0) -> list[dict]:
    photos: list[dict] = []
    for index in range(count):
        photo = {"taken_at": f"{date}T10:00:00Z"}
        if index < commented:
            photo["caption"] = "한마디"
        photos.append(photo)
    return photos


class AlbumRenderingRulesTests(TestCase):
    def test_only_date_groups_at_the_existing_minimum_show_stories(self) -> None:
        photos = _photos("2026-07-12", MIN_DATE_STORY_PHOTO_COUNT - 1, commented=1) + _photos(
            "2026-07-13", MIN_DATE_STORY_PHOTO_COUNT, commented=1
        )

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

    def test_date_without_any_comment_shows_no_story_even_with_many_photos(self) -> None:
        # No material (no comment/caption on any photo) → no story, even with 10 photos.
        photos = _photos("2026-07-13", 10, commented=0)
        visible = visible_date_stories({"2026-07-13": "재료 없는 이야기"}, photos)
        self.assertEqual(visible, {})

    def test_date_with_one_comment_and_enough_photos_shows_story(self) -> None:
        photos = _photos("2026-07-13", MIN_DATE_STORY_PHOTO_COUNT, commented=1)
        visible = visible_date_stories({"2026-07-13": "이야기"}, photos)
        self.assertEqual(visible, {"2026-07-13": "이야기"})

    def test_caption_counts_as_material(self) -> None:
        photos = _photos("2026-07-13", MIN_DATE_STORY_PHOTO_COUNT)
        photos[0].pop("caption", None)
        photos[0]["caption"] = "캡션만 있어도 재료다"
        visible = visible_date_stories({"2026-07-13": "이야기"}, photos)
        self.assertEqual(visible, {"2026-07-13": "이야기"})

    def test_few_photos_with_comment_still_hidden(self) -> None:
        # Existing "≥5 photos" rule is kept: a commented but small date is not shown.
        photos = _photos("2026-07-13", MIN_DATE_STORY_PHOTO_COUNT - 1, commented=2)
        visible = visible_date_stories({"2026-07-13": "이야기"}, photos)
        self.assertEqual(visible, {})
