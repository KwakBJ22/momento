"""Normalize and compare chapter stories vs album epilogue."""

from __future__ import annotations

import re


def normalize_story_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def split_sentences(text: str) -> list[str]:
    normalized = normalize_story_text(text)
    if not normalized:
        return []
    parts = re.split(r"[.!?\n]+|(?<=다)\s+|(?<=요)\s+", normalized)
    return [normalize_story_text(part) for part in parts if normalize_story_text(part)]


def stories_are_overlapping(
    a: str | None,
    b: str | None,
    *,
    overlap_ratio: float = 0.6,
) -> bool:
    left = normalize_story_text(a)
    right = normalize_story_text(b)
    if not left or not right:
        return False
    if left == right:
        return True
    if left in right or right in left:
        shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
        if len(shorter) / max(len(longer), 1) >= 0.7:
            return True

    left_s = split_sentences(left)
    right_s = split_sentences(right)
    if not left_s or not right_s:
        return False
    right_set = set(right_s)
    shared = 0
    for sentence in left_s:
        if sentence in right_set:
            shared += 1
            continue
        for other in right_set:
            shorter, longer = (
                (sentence, other) if len(sentence) <= len(other) else (other, sentence)
            )
            if shorter in longer and len(shorter) / max(len(longer), 1) >= 0.75:
                shared += 1
                break
    return shared / min(len(left_s), len(right_s)) >= overlap_ratio


def epilogue_conflicts_with_chapters(
    epilogue: str | None,
    chapter_stories: list[str] | dict[str, str] | None,
) -> bool:
    ending = normalize_story_text(epilogue)
    if not ending:
        return False
    values: list[str]
    if isinstance(chapter_stories, dict):
        values = list(chapter_stories.values())
    else:
        values = list(chapter_stories or [])
    combined = " ".join(normalize_story_text(item) for item in values if item)
    if stories_are_overlapping(ending, combined):
        return True
    return any(stories_are_overlapping(ending, item) for item in values)
