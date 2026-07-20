from __future__ import annotations

from typing import Literal

AlbumCategory = Literal["family", "friend", "couple", "colleague", "pet", "travel", "other"]

ALBUM_CATEGORIES: tuple[AlbumCategory, ...] = (
    "family",
    "friend",
    "couple",
    "colleague",
    "pet",
    "travel",
    "other",
)

CATEGORY_LABELS: dict[str, str] = {
    "family": "가족",
    "friend": "친구",
    "couple": "연인",
    "colleague": "동료",
    "pet": "반려동물",
    "travel": "여행",
    "other": "기타",
}

# Includes legacy / alternate keys so missing DB values never break prompt rendering.
CATEGORY_CONTEXT: dict[str, str] = {
    "family": "가족과의 추억",
    "friend": "친구들과의 추억",
    "friends": "친구들과의 추억",
    "couple": "연인과의 추억",
    "colleague": "동료들과의 추억",
    "colleagues": "동료들과의 추억",
    "work": "동료들과의 추억",
    "university": "친구들과의 추억",
    "pet": "반려동물과의 추억",
    "travel": "여행의 추억",
    "other": "소중한 추억",
}

CATEGORY_TO_MEETING_TYPE: dict[str, str] = {
    "family": "family",
    "friend": "friend",
    "friends": "friend",
    "couple": "friend",
    "colleague": "work",
    "colleagues": "work",
    "pet": "friend",
    "travel": "friend",
    "other": "friend",
}

_DEFAULT_CATEGORY_CONTEXT = "소중한 추억"


def normalize_category(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in CATEGORY_LABELS:
        return raw
    if raw == "friends":
        return "friend"
    if raw == "colleagues":
        return "colleague"
    if raw in CATEGORY_CONTEXT:
        return raw
    return "other"


def meeting_type_for_category(category: str | None) -> str:
    return CATEGORY_TO_MEETING_TYPE.get(normalize_category(category), "friend")


def category_label(category: str | None) -> str:
    return CATEGORY_LABELS.get(normalize_category(category), "기타")


def category_context(category: str | None) -> str:
    """Safe prompt filler; never raises for None/unknown category."""
    raw = (category or "").strip().lower()
    if raw in CATEGORY_CONTEXT:
        return CATEGORY_CONTEXT[raw]
    normalized = normalize_category(category)
    return CATEGORY_CONTEXT.get(normalized, _DEFAULT_CATEGORY_CONTEXT)
