"""Pronunciation validation and CV-pattern analysis (no AI)."""

from __future__ import annotations

import re

VOWELS = frozenset("aeiou")
VOWEL_CHARS = "aeiou"

# Explicit forbidden substrings from product spec
FORBIDDEN_SUBSTRINGS: tuple[str, ...] = (
    "kkk", "vvv", "iii", "ooo", "uuu", "yy", "qq", "zx", "xq", "jq", "hjq",
)

# Rare / awkward English bigrams
_RARE_BIGRAMS = frozenset({
    "bk", "bp", "bt", "bv", "bx", "bz", "ck", "cp", "ct", "cv", "cx", "cz",
    "dk", "dp", "dt", "dv", "dx", "dz", "fk", "fp", "ft", "fv", "fx", "fz",
    "gk", "gp", "gt", "gv", "gx", "gz", "hk", "hp", "ht", "hv", "hx", "hz",
    "jk", "jp", "jt", "jv", "jx", "jz", "kk", "kp", "kt", "kv", "kx", "kz",
    "lk", "lp", "lt", "lv", "lx", "lz", "mk", "mp", "mt", "mv", "mx", "mz",
    "nk", "np", "nt", "nv", "nx", "nz", "pk", "pp", "pt", "pv", "px", "pz",
    "qk", "qp", "qt", "qv", "qx", "qz", "rk", "rp", "rt", "rv", "rx", "rz",
    "sk", "sp", "st", "sv", "sx", "sz", "tk", "tp", "tt", "tv", "tx", "tz",
    "vk", "vp", "vt", "vv", "vx", "vz", "wk", "wp", "wt", "wv", "wx", "wz",
    "xk", "xp", "xt", "xv", "xx", "xz", "zk", "zp", "zt", "zv", "zx", "zz",
    "qj", "qx", "zq", "jx", "wx", "cx", "pq", "vq", "jq", "hq", "fq", "gq",
    "bh", "dh", "gh", "jh", "kh", "ph", "qh", "rh", "th", "vh", "wh", "xh", "zh",
})

_ALLOWED_DIGRAPHS = frozenset({"th", "sh", "ch", "ph", "wh", "ck", "ng", "st", "tr", "dr", "br", "cr", "fr", "gr", "pr", "pl", "cl", "bl", "sk", "sp", "sl", "sm", "sn", "sw"})
_TRIPLE_CONSONANT_RE = re.compile(r"[^aeiou]{3,}")
_REPEAT_CHAR_RE = re.compile(r"(.)\1{2,}")

# Readable CV templates (regex on C/V skeleton)
_READABLE_PATTERNS: tuple[tuple[re.Pattern[str], float], ...] = (
    (re.compile(r"^CVCV$"), 1.0),
    (re.compile(r"^CVCVC$"), 1.0),
    (re.compile(r"^CVCVCV$"), 0.95),
    (re.compile(r"^CVCCV$"), 0.85),
    (re.compile(r"^CVVCV$"), 0.8),
    (re.compile(r"^CCVCV$"), 0.75),
    (re.compile(r"^CVCCVC$"), 0.7),
    (re.compile(r"^CVC$"), 0.65),
    (re.compile(r"^VCVCV$"), 0.6),
)

_HARD_PATTERNS: tuple[tuple[re.Pattern[str], float], ...] = (
    (re.compile(r"C{3,}"), 0.4),
    (re.compile(r"V{3,}"), 0.3),
    (re.compile(r"CCCC"), 0.2),
    (re.compile(r"^CC[^V]"), 0.5),
)


def count_vowels(name: str) -> int:
    return sum(1 for ch in name.lower() if ch in VOWELS)


def to_cv_pattern(name: str) -> str:
    """Convert a name to a consonant/vowel skeleton, e.g. Kevora -> CVCVCV."""
    parts: list[str] = []
    for ch in name.lower():
        if not ch.isalpha():
            continue
        parts.append("V" if ch in VOWELS else "C")
    # Collapse consecutive identical symbols for pattern matching
    collapsed: list[str] = []
    for symbol in parts:
        if not collapsed or collapsed[-1] != symbol:
            collapsed.append(symbol)
    return "".join(collapsed)


def consonant_vowel_ratio(name: str) -> float:
    lower = name.lower()
    vowels = sum(1 for ch in lower if ch in VOWELS)
    consonants = sum(1 for ch in lower if ch.isalpha() and ch not in VOWELS)
    total = vowels + consonants
    if total == 0:
        return 0.0
    return consonants / total


def ratio_score(name: str) -> float:
    """Score consonant/vowel balance (0.0–1.0). Ideal ratio ~0.45–0.65."""
    ratio = consonant_vowel_ratio(name)
    if 0.42 <= ratio <= 0.68:
        return 1.0
    if 0.35 <= ratio <= 0.75:
        return 0.75
    if 0.28 <= ratio <= 0.82:
        return 0.5
    return 0.2


def cv_pattern_score(name: str) -> float:
    """Score how readable the CV skeleton is (0.0–1.0)."""
    pattern = to_cv_pattern(name)
    best = 0.35
    for regex, weight in _READABLE_PATTERNS:
        if regex.fullmatch(pattern):
            best = max(best, weight)
    for regex, penalty in _HARD_PATTERNS:
        if regex.search(pattern):
            best *= penalty
    return min(1.0, best)


def has_forbidden_pattern(name: str) -> bool:
    lower = name.lower()
    for forbidden in FORBIDDEN_SUBSTRINGS:
        if forbidden in lower:
            return True
    for i in range(len(lower) - 1):
        bigram = lower[i : i + 2]
        if bigram in _RARE_BIGRAMS and bigram not in _ALLOWED_DIGRAPHS:
            return True
    if _TRIPLE_CONSONANT_RE.search(lower):
        return True
    if _REPEAT_CHAR_RE.search(lower):
        return True
    for i, ch in enumerate(lower):
        if ch == "q" and (i + 1 >= len(lower) or lower[i + 1] != "u"):
            return True
        if ch == "y" and i > 0 and lower[i - 1] not in VOWEL_CHARS:
            # y as vowel only when not after consonant cluster
            if i + 1 < len(lower) and lower[i + 1] not in VOWEL_CHARS:
                return True
    return False


def is_valid_candidate(name: str) -> bool:
    """Structural + pronunciation filters for brand names."""
    if not name or not name.isalpha():
        return False
    length = len(name)
    if length < 5 or length > 9:
        return False
    if count_vowels(name) < 2:
        return False
    if has_forbidden_pattern(name):
        return False
    if cv_pattern_score(name) < 0.3:
        return False
    return True


def pronunciation_quality(name: str) -> float:
    """Combined pronunciation quality metric (0.0–1.0) for scoring."""
    if not is_valid_candidate(name):
        return 0.0
    return min(1.0, ratio_score(name) * 0.4 + cv_pattern_score(name) * 0.6)
