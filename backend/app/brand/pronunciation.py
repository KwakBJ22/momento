"""Rule-based English brand name to Korean pronunciation."""

from __future__ import annotations

# Consonant/vowel romanization chunks (longest match first)
_CONSONANT_MAP: dict[str, str] = {
    "sch": "슈",
    "sh": "시",
    "ch": "치",
    "th": "스",
    "ph": "프",
    "wh": "휘",
    "ck": "크",
    "ng": "응",
    "qu": "쿠",
    "x": "엑스",
    "z": "즈",
    "j": "제",
    "c": "크",
    "k": "크",
    "q": "크",
    "b": "브",
    "d": "드",
    "f": "프",
    "g": "그",
    "h": "흐",
    "l": "ㄹ",
    "m": "므",
    "n": "느",
    "p": "프",
    "r": "르",
    "s": "스",
    "t": "트",
    "v": "브",
    "w": "우",
    "y": "이",
}

_VOWEL_MAP: dict[str, str] = {
    "a": "아",
    "e": "에",
    "i": "이",
    "o": "오",
    "u": "우",
}

# Simplified syllable building for brand names
_ONSET: dict[str, str] = {
    "b": "브", "c": "크", "d": "드", "f": "프", "g": "그",
    "h": "흐", "j": "즈", "k": "크", "l": "ㄹ", "m": "므",
    "n": "느", "p": "프", "q": "크", "r": "르", "s": "스",
    "t": "트", "v": "브", "w": "우", "x": "엑스", "z": "즈",
    "ch": "치", "sh": "시", "th": "스", "ph": "프", "ck": "크",
    "qu": "쿠", "ng": "응",
}

_NUCLEUS: dict[str, str] = {
    "a": "아", "e": "에", "i": "이", "o": "오", "u": "우",
    "ia": "이아", "io": "이오", "ea": "이아", "ee": "이",
    "oo": "우", "ou": "아우", "ai": "아이", "ei": "에이",
    "au": "아우", "ue": "우에", "ie": "이에",
}


def _match_chunk(text: str, pos: int, mapping: dict[str, str]) -> tuple[str, int] | None:
    for size in range(min(3, len(text) - pos), 0, -1):
        chunk = text[pos : pos + size]
        if chunk in mapping:
            return mapping[chunk], size
    return None


def to_korean(name: str) -> str:
    """Approximate Korean pronunciation for a Latin brand name."""
    lower = name.lower()
    result: list[str] = []
    pos = 0

    while pos < len(lower):
        # Try consonant cluster first
        matched = _match_chunk(lower, pos, _ONSET)
        if matched:
            consonant, size = matched
            pos += size
            # Try vowel
            vowel_match = _match_chunk(lower, pos, _NUCLEUS)
            if vowel_match:
                vowel, vsize = vowel_match
                pos += vsize
                # Simplify: combine onset + nucleus
                if consonant == "ㄹ":
                    result.append("르" if vowel == "아" else f"리{vowel[1:]}" if len(vowel) > 1 else f"리{vowel}")
                elif consonant in ("므", "느", "브", "프", "트", "스", "크", "드", "그"):
                    # Drop trailing '으' style for readability
                    onset_short = consonant[0] if len(consonant) > 1 else consonant
                    syllable_map = {
                        ("크", "아"): "카", ("크", "에"): "케", ("크", "이"): "키", ("크", "오"): "코", ("크", "우"): "쿠",
                        ("브", "아"): "바", ("브", "에"): "베", ("브", "이"): "비", ("브", "오"): "보", ("브", "우"): "부",
                        ("프", "아"): "파", ("프", "에"): "페", ("프", "이"): "피", ("프", "오"): "포", ("프", "우"): "푸",
                        ("트", "아"): "타", ("트", "에"): "테", ("트", "이"): "티", ("트", "오"): "토", ("트", "우"): "투",
                        ("스", "아"): "사", ("스", "에"): "세", ("스", "이"): "시", ("스", "오"): "소", ("스", "우"): "수",
                        ("므", "아"): "마", ("므", "에"): "메", ("므", "이"): "미", ("므", "오"): "모", ("므", "우"): "무",
                        ("느", "아"): "나", ("느", "에"): "네", ("느", "이"): "니", ("느", "오"): "노", ("느", "우"): "누",
                        ("드", "아"): "다", ("드", "에"): "데", ("드", "이"): "디", ("드", "오"): "도", ("드", "우"): "두",
                        ("그", "아"): "가", ("그", "에"): "게", ("그", "이"): "기", ("그", "오"): "고", ("그", "우"): "구",
                        ("르", "아"): "라", ("르", "에"): "레", ("르", "이"): "리", ("르", "오"): "로", ("르", "우"): "루",
                    }
                    result.append(syllable_map.get((consonant, vowel), consonant + vowel))
                else:
                    result.append(consonant + vowel)
            else:
                result.append(consonant)
            continue

        # Standalone vowel
        vowel_match = _match_chunk(lower, pos, _NUCLEUS)
        if vowel_match:
            vowel, vsize = vowel_match
            result.append(vowel)
            pos += vsize
            continue

        pos += 1

    pronunciation = "".join(result)
    if not pronunciation:
        return name
    return pronunciation
