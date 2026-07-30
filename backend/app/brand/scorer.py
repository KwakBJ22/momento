"""Rule-based brand scoring (0-100, no AI)."""

from __future__ import annotations

from dataclasses import dataclass

from app.brand.brand_quality import (
    korean_readability_score,
    pronunciation_unity_score,
    standalone_integrity_score,
)
from app.brand.naturalness import MIN_NATURALNESS, naturalness_score, repetition_penalty
from app.brand.phonetics import consonant_vowel_ratio, cv_pattern_score, ratio_score

_LETTER_RARITY: dict[str, float] = {
    "e": 0.05, "a": 0.05, "r": 0.05, "i": 0.05, "o": 0.05,
    "t": 0.04, "n": 0.04, "s": 0.04, "l": 0.03, "c": 0.03,
    "u": 0.03, "d": 0.03, "p": 0.03, "m": 0.03, "h": 0.03,
    "g": 0.02, "b": 0.02, "f": 0.02, "y": 0.02, "w": 0.02,
    "k": 0.015, "v": 0.015, "x": 0.01, "z": 0.01, "j": 0.01, "q": 0.005,
}

_HARD_GLOBAL = frozenset({"xq", "zx", "qj", "vw", "hw", "kh", "gh", "sch", "hjq", "jq"})

MIN_TOTAL_SCORE = 74

_TEMPLATE_BONUS: dict[str, float] = {
    "standalone": 5.0,
    "namelike": 4.0,
    "symbolic": 4.0,
    "compact_fusion": 3.0,
    "bilingual": 3.0,
    "evocative": 2.0,
    "neologism": 1.0,
    "root_fusion": 0.0,
    "root_variant": 0.0,
    "triple_combo": 0.0,
}


@dataclass(frozen=True, slots=True)
class ScoreBreakdown:
    naturalness: float
    memorability: float
    pronunciation_unity: float
    standalone_integrity: float
    spelling: float
    context_relevance: float
    sonic_diversity: float
    global_fit: float
    template: str = ""
    passes_gate: bool = True

    # Backward-compatible aliases
    @property
    def pronunciation_ease(self) -> float:
        return self.pronunciation_unity

    @property
    def rarity(self) -> float:
        return self.sonic_diversity

    @property
    def total(self) -> int:
        if not self.passes_gate:
            return 0
        raw = (
            self.naturalness
            + self.memorability
            + self.pronunciation_unity
            + self.standalone_integrity
            + self.spelling
            + self.context_relevance
            + self.sonic_diversity
            + self.global_fit
        )
        return max(0, min(100, round(raw)))


def _syllable_estimate(name: str) -> int:
    lower = name.lower()
    count = 0
    prev_vowel = False
    for ch in lower:
        is_vowel = ch in "aeiou"
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    return max(1, count)


def _naturalness_points(name: str, segments: tuple[str, ...] | None) -> float:
    score = naturalness_score(name, segments=segments)
    points = score * 20.0
    points += korean_readability_score(name) * 4.0
    return max(0.0, min(20.0, points))


def _memorability_score(name: str) -> float:
    lower = name.lower()
    points = 6.0

    if lower[0] in "klvnrsbhmt":
        points += 2.5
    if lower[-1] in "aeion":
        points += 2.0

    unique_ratio = len(set(lower)) / len(lower)
    points += unique_ratio * 4.0

    if 5 <= len(name) <= 7:
        points += 2.5
    elif len(name) == 8:
        points += 0.5

    syllables = _syllable_estimate(name)
    if 2 <= syllables <= 3:
        points += 1.5

    return max(0.0, min(15.0, points))


def _pronunciation_unity_points(name: str) -> float:
    return max(0.0, min(15.0, pronunciation_unity_score(name) * 15.0))


def _standalone_integrity_points(name: str, segments: tuple[str, ...] | None) -> float:
    return max(0.0, min(15.0, standalone_integrity_score(name, segments=segments) * 15.0))


def _spelling_score(name: str) -> float:
    lower = name.lower()
    points = 7.0

    for ch in lower:
        if _LETTER_RARITY.get(ch, 0.02) < 0.01:
            points -= 1.5

    for i in range(len(lower) - 1):
        if lower[i] == lower[i + 1] and lower[i] not in "elorsst":
            points -= 1.0

    vowel_count = sum(1 for ch in lower if ch in "aeiou")
    ratio = vowel_count / len(lower)
    if 0.32 <= ratio <= 0.55:
        points += 2.0

    points += cv_pattern_score(name) * 1.5
    return max(0.0, min(10.0, points))


def _context_relevance_score(name: str, root_weights: dict[str, float] | None) -> float:
    if not root_weights:
        return 2.0
    lower = name.lower()
    total = 0.0
    for root, weight in root_weights.items():
        if len(root) >= 4 and root in lower:
            total += weight * 0.5
        elif len(root) >= 3 and root[:3] in lower and len(lower) <= 7:
            total += weight * 0.25
    return min(10.0, total * 0.8)


def _sonic_diversity_default(name: str) -> float:
    # Neutral baseline; final selection adjusts for set diversity
    points = 6.0
    points += ratio_score(name) * 2.0
    points -= repetition_penalty(name) * 3.0
    return max(0.0, min(10.0, points))


def _global_fit_score(name: str) -> float:
    lower = name.lower()
    points = 4.5
    for cluster in _HARD_GLOBAL:
        if cluster in lower:
            points -= 1.5
    if "x" in lower or "z" in lower:
        points -= 0.5
    if consonant_vowel_ratio(name) > 0.78:
        points -= 0.5
    return max(0.0, min(5.0, points))


def score_brand(
    name: str,
    root_weights: dict[str, float] | None = None,
    *,
    segments: tuple[str, ...] | None = None,
    template: str = "",
) -> ScoreBreakdown:
    """Compute a 100-point brand score. Fails gate if quality bars not met."""
    nat_raw = naturalness_score(name, segments=segments)
    unity_raw = pronunciation_unity_score(name)
    integrity_raw = standalone_integrity_score(name, segments=segments)

    passes = (
        nat_raw >= MIN_NATURALNESS
        and unity_raw >= 0.62
        and integrity_raw >= 0.58
    )

    template_bonus = _TEMPLATE_BONUS.get(template, 0.0)
    context = min(10.0, _context_relevance_score(name, root_weights) + template_bonus)

    breakdown = ScoreBreakdown(
        naturalness=_naturalness_points(name, segments),
        memorability=_memorability_score(name),
        pronunciation_unity=_pronunciation_unity_points(name),
        standalone_integrity=_standalone_integrity_points(name, segments),
        spelling=_spelling_score(name),
        context_relevance=context,
        sonic_diversity=_sonic_diversity_default(name),
        global_fit=_global_fit_score(name),
        template=template,
        passes_gate=passes,
    )

    if breakdown.total < MIN_TOTAL_SCORE:
        return ScoreBreakdown(
            naturalness=breakdown.naturalness,
            memorability=breakdown.memorability,
            pronunciation_unity=breakdown.pronunciation_unity,
            standalone_integrity=breakdown.standalone_integrity,
            spelling=breakdown.spelling,
            context_relevance=breakdown.context_relevance,
            sonic_diversity=breakdown.sonic_diversity,
            global_fit=breakdown.global_fit,
            template=template,
            passes_gate=False,
        )

    return breakdown


def rank_candidates(
    candidates: list[tuple[str, str, tuple[str, ...]]],
    *,
    min_score: int = MIN_TOTAL_SCORE,
    root_weights: dict[str, float] | None = None,
    limit: int = 500,
) -> list[tuple[str, ScoreBreakdown, str, tuple[str, ...]]]:
    scored: list[tuple[str, ScoreBreakdown, str, tuple[str, ...]]] = []
    for name, template, tags in candidates:
        segments = tags if len(tags) >= 2 else None
        breakdown = score_brand(name, root_weights, segments=segments, template=template)
        if not breakdown.passes_gate:
            continue
        if breakdown.total >= min_score:
            scored.append((name, breakdown, template, tags))

    scored.sort(
        key=lambda item: (
            item[1].total,
            item[1].standalone_integrity,
            item[1].pronunciation_unity,
            item[1].context_relevance,
        ),
        reverse=True,
    )
    return scored[:limit]
