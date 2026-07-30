"""Pronunciation unity, standalone integrity, and suffix-family analysis."""

from __future__ import annotations

import re

from app.brand.naturalness import vowel_skeleton
from app.brand.phonetics import VOWELS, count_vowels, to_cv_pattern

# Visible English fragments that should not appear intact in premium brands
_EXPOSED_WORDS: tuple[str, ...] = (
    "live", "echo", "tale", "photo", "story", "moment", "memory", "gather",
    "together", "home", "bond", "keep", "weave", "album", "frame", "share",
    "family", "friend", "warm", "love", "care", "cher", "nest", "legacy",
    "time", "photo", "snap", "save", "dear", "hearth", "mome", "taho", "tenor",
)

# Suffix rhythm families — max one per final result set
_SUFFIX_FAMILIES: tuple[tuple[str, ...], ...] = (
    ("una", "ona", "ena", "eena"),
    ("iva", "eva", "ova", "ava"),
    ("oto", "ato", "ito", "eto"),
    ("idu", "edu", "ado", "udo"),
    ("aon", "eon", "ion", "ian"),
)

_VOWEL_RUN_RE = re.compile(r"[aeiou]{3,}")
_SILENT_E_PATTERN = re.compile(r"[bcdfghjklmnpqrstvwxyz]e[^aeiou]", re.IGNORECASE)
_MULTI_PRON_CONSONANTS = frozenset({"c", "g", "ch", "th"})


def detect_ending_family(name: str) -> str | None:
    """Map name ending to a suffix rhythm family id."""
    lower = name.lower()
    for index, family in enumerate(_SUFFIX_FAMILIES):
        for suffix in family:
            if lower.endswith(suffix) and len(lower) >= len(suffix) + 2:
                return f"suffix_family_{index}"
    return None


def has_exposed_word_fragment(name: str) -> bool:
    """True when a recognizable dictionary word is visible in the spelling."""
    lower = name.lower()
    for word in _EXPOSED_WORDS:
        if len(word) >= 4 and word in lower:
            return True
        if len(word) == 3 and lower.startswith(word) and len(lower) <= 7:
            return True
    return False


def has_visible_seam(name: str) -> bool:
    """Detect obvious prefix+suffix glue (live+una, echo+una, tale+oto)."""
    lower = name.lower()
    if has_exposed_word_fragment(lower):
        return True

    for family in _SUFFIX_FAMILIES:
        for suffix in family:
            if not lower.endswith(suffix) or len(lower) <= len(suffix) + 2:
                continue
            stem = lower[: -len(suffix)]
            if len(stem) < 3:
                continue
            # Stem itself is a word or looks like clipped word
            if stem in _EXPOSED_WORDS or any(w.startswith(stem) and len(stem) >= 3 for w in _EXPOSED_WORDS):
                return True
            if stem.endswith(("ech", "liv", "mom", "tal", "pho", "bon", "sto", "gat")):
                return True
    return False


def pronunciation_unity_score(name: str) -> float:
    """
    How likely English speakers read the name one way (0–1).
    Penalizes silent-e ambiguity, multi-pronunciation letters, vowel runs.
    """
    lower = name.lower()
    score = 1.0

    if _VOWEL_RUN_RE.search(lower):
        score -= 0.35
    if _SILENT_E_PATTERN.search(lower):
        score -= 0.2

    for letter in lower:
        if letter in ("c", "g"):
            score -= 0.06
    if "ch" in lower and not lower.startswith("ch"):
        score -= 0.15
    if lower.startswith("live") or lower.startswith("echo"):
        score -= 0.4
    if lower[:4] == "live" or (lower[:3] == "liv" and "e" in lower[3:5]):
        score -= 0.25

    syllables = max(1, len(vowel_skeleton(lower)))
    if syllables > 3:
        score -= 0.15
    if syllables == 2 and 5 <= len(lower) <= 7:
        score += 0.08

    return max(0.0, min(1.0, score))


def standalone_integrity_score(name: str, *, segments: tuple[str, ...] | None = None) -> float:
    """
    Reads as one unified brand, not prefix+root+suffix (0–1).
    """
    lower = name.lower()
    if has_visible_seam(name):
        return 0.0
    if segments and len(segments) >= 2:
        return 0.25

    score = 0.72
    cv = to_cv_pattern(name)
    if cv in ("CVCV", "CVCVC", "CVCVCV"):
        score += 0.15
    if count_vowels(name) >= 2 and not _VOWEL_RUN_RE.search(lower):
        score += 0.08
    if has_formulaic_shape(name):
        score -= 0.35

    ending = detect_ending_family(name)
    if ending in ("suffix_family_0", "suffix_family_1", "suffix_family_2", "suffix_family_3"):
        score -= 0.22
    elif ending == "suffix_family_4":
        score -= 0.05

    islands = re.findall(r"[^aeiou]+", lower)
    if len(islands) >= 3 and len(lower) <= 7:
        score -= 0.2

    return max(0.0, min(1.0, score))


def korean_readability_score(name: str) -> float:
    """Korean transliteration should land in 2–4 syllables without harsh codas."""
    from app.brand.pronunciation import to_korean

    kr = to_korean(name)
    if not kr:
        return 0.0
    score = 0.7
    if 2 <= len(kr) <= 8:
        score += 0.15
    if len(kr) > 12:
        score -= 0.25
    harsh = sum(1 for ch in kr if ch in "ㄱㅋㅌㅍㅊ" and kr.count(ch) >= 2)
    score -= harsh * 0.08
    return max(0.0, min(1.0, score))


_GENERATION_HEADS = frozenset({
    "lan", "tar", "rov", "kor", "nor", "sol", "hor", "mor", "por", "tor", "vor", "wor",
    "bel", "rel", "ser", "vel", "mel", "nel", "har", "mar", "del", "fen", "ken", "sen",
    "bor", "dor", "for", "gor", "cal", "dal", "fal", "gal", "hal", "kal", "mal", "pal",
    "ral", "sal", "val", "wel", "nol", "pol", "tol", "vol", "col", "fol", "hol", "mol",
    "sul", "tul", "vul", "ril", "sil", "til", "vil", "wil",
})
_FORMULAIC_TAILS = frozenset({
    "luno", "lori", "duno", "nuno", "loro", "noro", "tori", "vori", "dori",
    "lira", "dira", "nira", "mira", "vira", "sira", "nian", "vian", "tian", "lian", "rian",
})

_ARO_RHYTHM_TAILS = frozenset({
    "faro", "saro", "daro", "naro", "laro", "maro", "varo", "taro", "karo",
})


def _curated_exempt() -> frozenset[str]:
    from app.brand.templates import CURATED_BRAND_NAMES

    return frozenset(name.lower() for name in CURATED_BRAND_NAMES)


def detect_aro_rhythm_family(name: str) -> str | None:
    """Group -faro/-saro/-daro endings to avoid suffix rhythm clustering."""
    lower = name.lower()
    for tail in _ARO_RHYTHM_TAILS:
        if lower.endswith(tail) and len(lower) >= len(tail) + 2:
            return f"tail_rhythm_{tail}"
    return None


def has_formulaic_shape(name: str) -> bool:
    """Programmatic head+tail glue (Lanluno, Tardori) vs unified names (Belaon)."""
    lower = name.lower()
    if lower in _curated_exempt():
        return False
    if len(lower) < 6:
        return False
    if lower[:3] not in _GENERATION_HEADS:
        return False
    return any(lower.endswith(tail) for tail in _FORMULAIC_TAILS)


def has_syllable_stutter(name: str) -> bool:
    """Detect repeated chunks like lanlano, relrel."""
    lower = name.lower()
    for size in range(3, len(lower) // 2 + 1):
        chunk = lower[:size]
        if lower.count(chunk) >= 2:
            return True
    return False


def has_harsh_alternation(name: str) -> bool:
    """Reject random-syllable feel (Cilul, Vomim, Dirur)."""
    lower = name.lower()
    harsh_fragments = ("lul", "rur", "rir", "lol", "nun", "mim", "vuv", "zuz", "cul", "dir", "vom")
    if any(frag in lower for frag in harsh_fragments):
        return True
    vowels = vowel_skeleton(lower)
    if vowels and max(vowels.count(v) for v in set(vowels)) >= 3:
        return True
    return False


def fails_premium_gate(name: str, *, segments: tuple[str, ...] | None = None) -> bool:
    """Reject names that need explanation to sound like a brand."""
    if has_visible_seam(name):
        return True
    if has_syllable_stutter(name):
        return True
    if has_harsh_alternation(name):
        return True
    if has_formulaic_shape(name):
        return True
    if pronunciation_unity_score(name) < 0.62:
        return True
    if standalone_integrity_score(name, segments=segments) < 0.58:
        return True
    if korean_readability_score(name) < 0.55:
        return True
    return False


def compare_to_momento(name: str) -> dict[str, str]:
    """One-line pros/cons vs Momento reference brand."""
    lower = name.lower()
    momento_len = 7
    pros: list[str] = []
    cons: list[str] = []

    if len(name) < momento_len:
        pros.append("Momento보다 짧음")
    elif len(name) == momento_len:
        pros.append("Momento와 비슷한 길이")
    else:
        cons.append("Momento보다 김")

    unity = pronunciation_unity_score(name)
    if unity >= 0.75:
        pros.append("발음이 더 단순할 수 있음")
    elif unity < 0.65:
        cons.append("발음이 Momento보다 애매함")

    if standalone_integrity_score(name) >= 0.7:
        pros.append("독립 브랜드명으로 읽힘")
    else:
        cons.append("합성/조합 흔적이 Momento보다 큼")

    unique = len(set(lower)) / len(lower)
    momento_unique = len(set("momento")) / 7
    if unique >= momento_unique:
        pros.append("철자 구분도가 비슷하거나 높음")
    else:
        cons.append("철자 반복으로 기억성 낮을 수 있음")

    return {
        "pro": pros[0] if pros else "서비스 연결 가능",
        "con": cons[0] if cons else "추가 검증 필요",
    }
