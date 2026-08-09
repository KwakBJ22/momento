from __future__ import annotations

from typing import Literal

AlbumTemplateType = Literal["warm", "joyful", "special"]

TEMPLATE_TYPES: tuple[AlbumTemplateType, ...] = ("warm", "joyful", "special")

TEMPLATE_TYPE_LABELS: dict[str, str] = {
    "warm": "따뜻한 기록",
    "joyful": "즐거운 순간",
    "special": "특별한 이야기",
}

TEMPLATE_TYPE_FEATURES: dict[str, str] = {
    "warm": "큰 사진, 부드러운 여백, 차분한 이야기",
    "joyful": "여러 사진 중심, 경쾌한 구성, 생동감 있는 이야기",
    "special": "잡지형 여백, 강조 문장, 감성적인 이야기",
}

# Map style → legacy PIL layout (A timeline / B collage / C storybook).
TEMPLATE_TYPE_TO_LAYOUT: dict[str, str] = {
    "warm": "A",
    "joyful": "B",
    "special": "C",
}

CATEGORY_DEFAULT_TEMPLATE: dict[str, AlbumTemplateType] = {
    "family": "warm",
    "friend": "joyful",
    "friends": "joyful",
    "couple": "special",
    "colleague": "joyful",
    "colleagues": "joyful",
    "pet": "warm",
    "travel": "joyful",
    "other": "warm",
}

STYLE_CONTEXT: dict[str, str] = {
    "warm": "차분하고 따뜻한 문체로, 여운이 남는 짧은 문장을 우선해줘.",
    "joyful": "경쾌하고 생동감 있는 문체로, 함께한 순간의 활기를 살려줘.",
    "special": "감성적이고 시적인 문체로, 한 문장은 강조하듯 또렷하게 남겨줘.",
}

CATEGORY_COVER_LINES: dict[str, str] = {
    "family": "가족이 함께한 따뜻한 하루",
    "friend": "친구들과 웃었던 그 순간",
    "couple": "둘만의 특별한 한마디",
    "colleague": "함께 만든 소중한 시간",
    "pet": "곁에 있어 준 친구와의 시간",
    "travel": "다시 떠올리고 싶은 여행",
    "other": "나만의 특별한 추억",
}

_DEFAULT_TEMPLATE: AlbumTemplateType = "warm"


def normalize_template_type(value: str | None) -> AlbumTemplateType:
    raw = (value or "").strip().lower()
    if raw in TEMPLATE_TYPE_LABELS:
        return raw  # type: ignore[return-value]
    return _DEFAULT_TEMPLATE


def recommended_template_type(category: str | None) -> AlbumTemplateType:
    raw = (category or "").strip().lower()
    return CATEGORY_DEFAULT_TEMPLATE.get(raw, _DEFAULT_TEMPLATE)


def layout_for_template_type(template_type: str | None) -> str:
    return TEMPLATE_TYPE_TO_LAYOUT.get(normalize_template_type(template_type), "B")


def style_context(template_type: str | None) -> str:
    return STYLE_CONTEXT.get(normalize_template_type(template_type), STYLE_CONTEXT[_DEFAULT_TEMPLATE])


def cover_line_for_category(category: str | None) -> str:
    raw = (category or "").strip().lower()
    return CATEGORY_COVER_LINES.get(raw, CATEGORY_COVER_LINES["other"])
