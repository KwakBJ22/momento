"""Brand-name mutation engine — vowel/suffix swaps, compression, expansion."""

from __future__ import annotations

from app.brand.naturalness import is_quality_candidate
from app.brand.phonetics import pronunciation_quality

_VOWELS = "aeiou"
_VOWEL_ALTERNATES: dict[str, tuple[str, ...]] = {
    "a": ("o", "e", "i"),
    "e": ("a", "i", "o"),
    "i": ("e", "a", "o"),
    "o": ("a", "e", "u"),
    "u": ("o", "a", "e"),
}

_SUFFIX_SWAPS: tuple[str, ...] = (
    "a", "o", "e", "ia", "io", "or", "an", "in", "on", "en", "is", "us",
    "ax", "ex", "ix", "ra", "ro", "ri", "ly", "ty", "ora", "era", "ium",
)

_INSERT_VOWELS: tuple[str, ...] = ("i", "o", "a", "e")


def _capitalize(name: str) -> str:
    return name[0].upper() + name[1:].lower()


def _vowel_mutations(lower: str) -> list[str]:
    results: list[str] = []
    for index, ch in enumerate(lower):
        if ch not in _VOWELS:
            continue
        for alt in _VOWEL_ALTERNATES.get(ch, ()):
            mutated = lower[:index] + alt + lower[index + 1 :]
            if mutated != lower and is_quality_candidate(mutated):
                results.append(mutated)
    return results


def _suffix_mutations(lower: str) -> list[str]:
    results: list[str] = []
    for suffix_len in (1, 2, 3):
        if len(lower) - suffix_len < 4:
            continue
        stem = lower[:-suffix_len]
        for suffix in _SUFFIX_SWAPS:
            if len(stem) + len(suffix) < 5 or len(stem) + len(suffix) > 9:
                continue
            mutated = stem + suffix
            if mutated != lower and is_quality_candidate(mutated):
                results.append(mutated)
    return results


def _compress_mutations(lower: str) -> list[str]:
    results: list[str] = []
    for index in range(len(lower) - 1):
        if lower[index] == lower[index + 1]:
            mutated = lower[:index] + lower[index + 1 :]
            if len(mutated) >= 5 and is_quality_candidate(mutated):
                results.append(mutated)
    return results


def _expand_mutations(lower: str) -> list[str]:
    results: list[str] = []
    for index in range(len(lower) - 1):
        left, right = lower[index], lower[index + 1]
        if left not in _VOWELS and right not in _VOWELS:
            for vowel in _INSERT_VOWELS:
                mutated = lower[: index + 1] + vowel + lower[index + 1 :]
                if len(mutated) <= 9 and is_quality_candidate(mutated):
                    results.append(mutated)
    return results


def _transpose_mutations(lower: str) -> list[str]:
    results: list[str] = []
    for index in range(len(lower) - 1):
        if lower[index] == lower[index + 1]:
            continue
        swapped = lower[:index] + lower[index + 1] + lower[index] + lower[index + 2 :]
        if swapped != lower and is_quality_candidate(swapped):
            results.append(swapped)
    return results


def _double_consonant_mutations(lower: str) -> list[str]:
    results: list[str] = []
    for index, ch in enumerate(lower):
        if ch in _VOWELS or index == 0:
            continue
        mutated = lower[:index] + ch + lower[index:]
        if len(mutated) <= 9 and mutated != lower and is_quality_candidate(mutated):
            results.append(mutated)
    return results


def mutate(brand: str) -> list[str]:
    """Return unique valid mutations for a brand name."""
    lower = brand.lower()
    if not is_quality_candidate(lower):
        return []

    seen: set[str] = {lower}
    mutations: list[str] = []

    for producer in (
        _vowel_mutations,
        _suffix_mutations,
        _compress_mutations,
        _expand_mutations,
        _transpose_mutations,
        _double_consonant_mutations,
    ):
        for candidate in producer(lower):
            if candidate in seen:
                continue
            seen.add(candidate)
            mutations.append(_capitalize(candidate))

    return mutations


def mutation_quality(original: str, mutated: str) -> float:
    """Score how natural a mutation feels relative to the original (0.0–1.0)."""
    orig_lower = original.lower()
    mut_lower = mutated.lower()

    if not is_quality_candidate(mut_lower):
        return 0.0

    # Reward small edits
    length_delta = abs(len(orig_lower) - len(mut_lower))
    edit_penalty = length_delta * 0.15

    # Shared prefix/suffix
    prefix_len = 0
    for a, b in zip(orig_lower, mut_lower, strict=False):
        if a == b:
            prefix_len += 1
        else:
            break
    prefix_bonus = min(0.4, prefix_len / max(len(orig_lower), 1) * 0.4)

    pronunciation = pronunciation_quality(mut_lower)
    return max(0.0, min(1.0, pronunciation * 0.6 + prefix_bonus - edit_penalty))


def expand_candidates(brands: list[str], *, per_brand_limit: int = 8) -> list[str]:
    """Generate mutations for a list of seed brands, deduplicated."""
    seen: set[str] = {b.lower() for b in brands}
    expanded: list[str] = list(brands)

    for brand in brands:
        count = 0
        for mutation in mutate(brand):
            key = mutation.lower()
            if key in seen:
                continue
            seen.add(key)
            expanded.append(mutation)
            count += 1
            if count >= per_brand_limit:
                break

    return expanded
