"""Similarity-based deduplication and recommendation history."""

from __future__ import annotations

from collections import deque
from threading import Lock

SIMILARITY_THRESHOLD = 0.85
_HISTORY_MAX = 500


def jaro_winkler(s1: str, s2: str, prefix_scale: float = 0.1) -> float:
    """Jaro-Winkler similarity in [0.0, 1.0]."""
    a = s1.lower()
    b = s2.lower()
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0

    len_a, len_b = len(a), len(b)
    match_distance = max(len_a, len_b) // 2 - 1

    a_matches = [False] * len_a
    b_matches = [False] * len_b
    matches = 0
    transpositions = 0

    for i in range(len_a):
        start = max(0, i - match_distance)
        end = min(i + match_distance + 1, len_b)
        for j in range(start, end):
            if b_matches[j] or a[i] != b[j]:
                continue
            a_matches[i] = True
            b_matches[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    k = 0
    for i in range(len_a):
        if not a_matches[i]:
            continue
        while not b_matches[k]:
            k += 1
        if a[i] != b[k]:
            transpositions += 1
        k += 1

    jaro = (
        matches / len_a
        + matches / len_b
        + (matches - transpositions / 2) / matches
    ) / 3.0

    prefix = 0
    for i in range(min(4, len_a, len_b)):
        if a[i] == b[i]:
            prefix += 1
        else:
            break

    return min(1.0, jaro + prefix * prefix_scale * (1.0 - jaro))


def is_too_similar(a: str, b: str, threshold: float = SIMILARITY_THRESHOLD) -> bool:
    return jaro_winkler(a, b) >= threshold


def deduplicate_similar(
    names: list[str],
    *,
    threshold: float = SIMILARITY_THRESHOLD,
) -> list[str]:
    """Keep highest-priority name when candidates are ≥ threshold similar."""
    kept: list[str] = []
    for name in names:
        if any(is_too_similar(name, existing, threshold) for existing in kept):
            continue
        kept.append(name)
    return kept


class RecommendationHistory:
    """In-memory store of recently recommended brand names (no DB)."""

    def __init__(self, max_size: int = _HISTORY_MAX) -> None:
        self._max_size = max_size
        self._recent: deque[str] = deque()
        self._seen: set[str] = set()
        self._lock = Lock()

    def add(self, names: list[str]) -> None:
        with self._lock:
            for name in names:
                key = name.lower()
                if key in self._seen:
                    continue
                self._recent.append(key)
                self._seen.add(key)
                while len(self._recent) > self._max_size:
                    evicted = self._recent.popleft()
                    self._seen.discard(evicted)

    def filter_new(self, names: list[str]) -> list[str]:
        """Remove names that were recently recommended."""
        with self._lock:
            seen = self._seen
            return [name for name in names if name.lower() not in seen]

    def clear(self) -> None:
        with self._lock:
            self._recent.clear()
            self._seen.clear()


_history: RecommendationHistory | None = None


def get_recommendation_history() -> RecommendationHistory:
    global _history
    if _history is None:
        _history = RecommendationHistory()
    return _history
