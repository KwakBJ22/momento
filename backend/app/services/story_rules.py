from collections import Counter
from typing import Any


# Existing MVP agreement: a date story needs at least five photos from that date.
MIN_DATE_STORY_PHOTO_COUNT = 5
# A date whose photos carry no comment/caption has nothing to base a story on beyond
# the date itself, so it produces a bland line. Require at least one commented photo
# on the date — the story is written from photos + captions + date (CLAUDE.md §6).
MIN_DATE_STORY_COMMENT_COUNT = 1


def photo_date_key(photo: dict[str, Any]) -> str:
    taken_at = str(photo.get("taken_at") or "")
    return taken_at[:10] if len(taken_at) >= 10 else "0"


def _photo_has_comment(photo: dict[str, Any]) -> bool:
    return bool(str(photo.get("comment") or photo.get("caption") or "").strip())


def eligible_date_story_keys(photos: list[dict[str, Any]]) -> set[str]:
    counts = Counter(photo_date_key(photo) for photo in photos)
    comment_counts = Counter(photo_date_key(photo) for photo in photos if _photo_has_comment(photo))
    return {
        key
        for key, count in counts.items()
        if key != "0"
        and count >= MIN_DATE_STORY_PHOTO_COUNT
        and comment_counts.get(key, 0) >= MIN_DATE_STORY_COMMENT_COUNT
    }


def visible_date_stories(stories: object, photos: list[dict[str, Any]]) -> dict[str, str]:
    if not isinstance(stories, dict):
        return {}
    eligible = eligible_date_story_keys(photos)
    return {
        str(key): str(value).strip()
        for key, value in stories.items()
        if str(key) in eligible and str(value).strip()
    }
