"""Naturalness scoring and boundary validation for brand names."""

from __future__ import annotations

import re

from app.brand.phonetics import (
    VOWELS,
    count_vowels,
    cv_pattern_score,
    has_forbidden_pattern,
    to_cv_pattern,
)

MIN_NATURALNESS = 0.52

_UNNATURAL_BIGRAMS = frozenset({
    "mn", "nm", "mr", "rm", "lm", "ml", "nr", "rn", "lr", "rl", "vr", "rv",
    "memn", "mimn", "memm", "mimm", "mnm", "nmn", "mrm", "lmn", "nml",
    "frn", "frm", "mfr", "mfl", "kmm", "knm", "lmm", "nmm", "pmm",
    "imi", "memi", "mimo", "mimi", "imem", "emem", "meme",
})

_MEM_GLUE_RE = re.compile(r"[^aeiou]mem[aeiou]", re.IGNORECASE)
_SHORT_MEM_RE = re.compile(r"^.{0,2}mem", re.IGNORECASE)
_MEM_FAMILY_RE = re.compile(r"(mi{1,2}|mem|mim|memo|mimo|memi|mimi)", re.IGNORECASE)
_VOWEL_RUN_RE = re.compile(r"[aeiou]{3,}")
_CONSONANT_RUN_RE = re.compile(r"[^aeiou]{3,}")

GLUE_RISK_ROOTS = frozenset({"mem", "memo", "mim", "mimo", "memi", "mimi", "fram", "frame"})

_MECHANICAL_ENDING_RE = re.compile(
    r"(rira|urira|ousra|urilo|ousro|urira|rir[ao]|ousr[ae]|vrir[ao]|mousr[ae]|tousr[ae])$",
    re.IGNORECASE,
)
_MECHANICAL_RHYTHM_RE = re.compile(
    r"(?:[bcdfghjklmnpqrstvwxyz]ousr[ae]|[bcdfghjklmnpqrstvwxyz]urir[ao]|[bcdfghjklmnpqrstvwxyz]uril[oa])$",
    re.IGNORECASE,
)

_AWKWARD_CLUSTERS: tuple[str, ...] = (
    "uor", "eor", "ior", "aor", "hor", "hro", "chr", "cuor", "picu",
    "echorr", "omech", "xx", "zz", "qq", "phth", "bund", "cheho", "hibun", "uix", "nopi", "oher",
)
_AWKWARD_ENDING_RE = re.compile(
    r"(hor|hro|uor|eor|ior|chr|sch|ax|iny|aix|oiny)$",
    re.IGNORECASE,
)
_BRAND_LIKE_PATTERNS = frozenset({
    "CVCV", "CVCVC", "CVCVCV", "CVCCV", "VCVCV", "CVC",
})


def has_awkward_cluster(name: str) -> bool:
    lower = name.lower()
    if _AWKWARD_ENDING_RE.search(lower):
        return True
    if any(cluster in lower for cluster in _AWKWARD_CLUSTERS):
        return True
    for index in range(len(lower) - 1):
        if lower[index] == lower[index + 1] and lower[index] not in "aeiouls":
            return True
    return False


def has_mechanical_ending(name: str) -> bool:
    """Detect random-neologism endings like Lurira, Kousra, Vousra."""
    lower = name.lower()
    if _MECHANICAL_ENDING_RE.search(lower):
        return True
    if _MECHANICAL_RHYTHM_RE.search(lower):
        return True
    if lower.endswith(("rilo", "riro", "sra", "sro")) and len(lower) <= 7:
        vowels = vowel_skeleton(lower)
        if vowels.count("i") >= 2 or vowels.count("u") >= 2:
            return True
    return False


def vowel_skeleton(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch in VOWELS)


def count_mem_family(name: str) -> int:
    return len(_MEM_FAMILY_RE.findall(name.lower()))


def has_mem_glue(name: str) -> bool:
    """Detect unnatural prefix+mem glue (Lomema, Nomema, Kemimro)."""
    lower = name.lower()
    if _MEM_GLUE_RE.search(lower):
        return True
    if _SHORT_MEM_RE.match(lower) and len(lower) <= 7:
        return True
    if "cher" in lower and len(lower) <= 8:
        return True
    if "memn" in lower or "mimn" in lower or "memm" in lower:
        return True
    return False


def has_unnatural_bigrams(name: str) -> bool:
    lower = name.lower()
    for bigram in _UNNATURAL_BIGRAMS:
        if bigram in lower:
            return True
    return False


def junction_score(left: str, right: str) -> float:
    if not left or not right:
        return 1.0
    boundary = (left[-1] + right[0]).lower()
    if boundary in _UNNATURAL_BIGRAMS:
        return 0.0
    if left[-1] in VOWELS and right[0] in VOWELS:
        return 0.35
    if left[-1] not in VOWELS and right[0] not in VOWELS:
        natural_clusters = frozenset({
            "st", "sp", "sk", "sl", "sm", "sn", "sw", "tr", "dr", "br", "cr",
            "fr", "gr", "pr", "pl", "cl", "bl",
        })
        if boundary not in natural_clusters:
            return 0.25
    return 1.0


def evaluate_segment_boundaries(name: str, segments: tuple[str, ...]) -> float:
    if len(segments) < 2:
        return 1.0
    scores = [junction_score(segments[i], segments[i + 1]) for i in range(len(segments) - 1)]
    return sum(scores) / len(scores)


def repetition_penalty(name: str) -> float:
    lower = name.lower()
    penalty = 0.0

    mem_hits = count_mem_family(name)
    if mem_hits >= 2:
        penalty += 0.5
    elif mem_hits == 1 and len(lower) <= 7:
        penalty += 0.25

    vowels = vowel_skeleton(name)
    if vowels:
        most_common = max(vowels.count(v) for v in set(vowels))
        if most_common >= 3:
            penalty += 0.35
        elif most_common >= 2 and len(vowels) <= 4:
            penalty += 0.15

    for i in range(len(lower) - 3):
        chunk = lower[i : i + 2]
        if lower.count(chunk) >= 2 and chunk not in ("ra", "ro", "lo", "la", "ve", "no"):
            penalty += 0.2
            break

    if _VOWEL_RUN_RE.search(lower):
        penalty += 0.4
    if _CONSONANT_RUN_RE.search(lower):
        penalty += 0.5

    return min(1.0, penalty)


def looks_mechanical(name: str) -> bool:
    lower = name.lower()
    if has_mem_glue(name):
        return True
    if has_mechanical_ending(name):
        return True
    if has_awkward_cluster(name):
        return True
    if has_unnatural_bigrams(lower):
        return True
    if count_mem_family(name) >= 2:
        return True
    if repetition_penalty(name) >= 0.45:
        return True

    cv = to_cv_pattern(name)
    if cv not in _BRAND_LIKE_PATTERNS and cv_pattern_score(name) < 0.55:
        return True

    islands = re.findall(r"[^aeiou]+", lower)
    if len(islands) >= 4 and len(lower) <= 8:
        return True

    return False


def naturalness_score(name: str, *, segments: tuple[str, ...] | None = None) -> float:
    lower = name.lower()
    if not lower.isalpha() or len(lower) < 5 or len(lower) > 9:
        return 0.0
    if has_forbidden_pattern(lower):
        return 0.0
    if has_mem_glue(name):
        return 0.0
    if has_unnatural_bigrams(lower):
        return 0.0
    if looks_mechanical(name):
        return 0.0

    score = 0.55
    score += cv_pattern_score(name) * 0.2
    score -= repetition_penalty(name) * 0.35

    if segments:
        score *= 0.5 + 0.5 * evaluate_segment_boundaries(name, segments)

    vowel_count = count_vowels(name)
    if 2 <= vowel_count <= 4:
        score += 0.08
    if 5 <= len(name) <= 7:
        score += 0.07

    for ch in "xzq":
        if ch in lower:
            score -= 0.12

    return max(0.0, min(1.0, score))


def passes_naturalness_gate(name: str, *, segments: tuple[str, ...] | None = None) -> bool:
    return naturalness_score(name, segments=segments) >= MIN_NATURALNESS


def is_quality_candidate(name: str, *, segments: tuple[str, ...] | None = None) -> bool:
    from app.brand.brand_quality import fails_premium_gate
    from app.brand.phonetics import is_valid_candidate

    if not is_valid_candidate(name):
        return False
    if has_mem_glue(name):
        return False
    if looks_mechanical(name):
        return False
    if fails_premium_gate(name, segments=segments):
        return False
    if not passes_naturalness_gate(name, segments=segments):
        return False
    return True
