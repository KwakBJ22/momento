from collections import Counter
from typing import Any


# Existing MVP agreement: a date story needs at least five photos from that date.
MIN_DATE_STORY_PHOTO_COUNT = 5


def photo_date_key(photo: dict[str, Any]) -> str:
    taken_at = str(photo.get("taken_at") or "")
    return taken_at[:10] if len(taken_at) >= 10 else "0"


def eligible_date_story_keys(photos: list[dict[str, Any]]) -> set[str]:
    counts = Counter(photo_date_key(photo) for photo in photos)
    return {
        key
        for key, count in counts.items()
        if key != "0" and count >= MIN_DATE_STORY_PHOTO_COUNT
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
