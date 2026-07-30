"""In-memory domain availability cache."""

from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock


@dataclass(frozen=True, slots=True)
class CacheEntry:
    available: bool
    checked_at: float


class DomainCache:
    """Thread-safe TTL cache for RDAP lookup results."""

    def __init__(self, ttl_seconds: int = 86_400) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, CacheEntry] = {}
        self._lock = Lock()

    def get(self, domain: str) -> bool | None:
        key = domain.lower()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.monotonic() - entry.checked_at > self._ttl:
                del self._store[key]
                return None
            return entry.available

    def set(self, domain: str, available: bool) -> None:
        key = domain.lower()
        with self._lock:
            self._store[key] = CacheEntry(available=available, checked_at=time.monotonic())

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)


_cache: DomainCache | None = None


def get_domain_cache() -> DomainCache:
    global _cache
    if _cache is None:
        _cache = DomainCache()
    return _cache
