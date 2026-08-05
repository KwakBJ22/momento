"""Signed-URL in-process cache: reuse while fresh (>50% TTL left), re-issue near expiry,
batch requests only fetch misses, and the cache size stays bounded.

Why: Supabase stamps `iat` into every signed URL, so URLs issued in different seconds
differ and the CDN never gets a cache hit (100% uncached traffic at 3x the price).
"""
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

from app.services import storage_service
from app.services.storage_service import StorageService, clear_signed_url_cache

TTL = 3600


class CountingProvider:
    """Fake provider that returns a unique URL per call, like real Supabase does."""

    def __init__(self) -> None:
        self.single_calls: list[str] = []
        self.batch_calls: list[list[str]] = []
        self._counter = 0

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False) -> None:
        pass

    def delete(self, bucket: str, paths: list[str]) -> None:
        pass

    def signed_url(self, bucket: str, path: str, expires_in: int) -> str:
        self._counter += 1
        self.single_calls.append(path)
        return f"https://cdn/{path}?token=t{self._counter}"

    def signed_urls(self, bucket: str, paths: list[str], expires_in: int) -> list[dict[str, Any]]:
        self.batch_calls.append(list(paths))
        rows = []
        for path in paths:
            self._counter += 1
            rows.append({"path": path, "signedURL": f"https://cdn/{path}?token=t{self._counter}", "error": None})
        return rows


class SignedUrlCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_signed_url_cache()
        self.provider = CountingProvider()
        self.service = StorageService(self.provider, TTL)  # type: ignore[arg-type]

    def tearDown(self) -> None:
        clear_signed_url_cache()

    def test_second_call_is_a_cache_hit(self) -> None:
        first = self.service.create_signed_url("albums", "a/photo.jpg")
        second = self.service.create_signed_url("albums", "a/photo.jpg")
        self.assertEqual(first, second)
        self.assertEqual(len(self.provider.single_calls), 1)

    def test_cache_is_shared_across_service_instances(self) -> None:
        # get_signed_url / get_signed_urls_batch build a fresh StorageService per call;
        # the cache must survive that or it caches nothing in production.
        first = self.service.create_signed_url("albums", "a/photo.jpg")
        other = StorageService(self.provider, TTL)  # type: ignore[arg-type]
        self.assertEqual(other.create_signed_url("albums", "a/photo.jpg"), first)
        self.assertEqual(len(self.provider.single_calls), 1)

    def test_near_expiry_reissues_instead_of_serving_stale(self) -> None:
        # ★ regression guard: a URL below 50% remaining TTL must NOT be served — users
        # who receive a nearly-expired URL get broken photos (happened in production).
        base = 1_000_000.0
        with patch.object(storage_service.time, "time", return_value=base):
            first = self.service.create_signed_url("albums", "a/photo.jpg")
        # 51% of TTL elapsed → 49% remaining → below the reuse bar → fresh URL.
        with patch.object(storage_service.time, "time", return_value=base + TTL * 0.51):
            second = self.service.create_signed_url("albums", "a/photo.jpg")
        self.assertNotEqual(first, second)
        self.assertEqual(len(self.provider.single_calls), 2)

    def test_just_above_half_ttl_still_reuses(self) -> None:
        base = 1_000_000.0
        with patch.object(storage_service.time, "time", return_value=base):
            first = self.service.create_signed_url("albums", "a/photo.jpg")
        with patch.object(storage_service.time, "time", return_value=base + TTL * 0.49):
            second = self.service.create_signed_url("albums", "a/photo.jpg")
        self.assertEqual(first, second)
        self.assertEqual(len(self.provider.single_calls), 1)

    def test_batch_requests_only_the_misses(self) -> None:
        self.service.create_signed_url("albums", "a/1.jpg")  # warm one entry
        rows = self.service.create_signed_urls("albums", ["a/1.jpg", "a/2.jpg", "a/3.jpg"])
        # Only the two misses hit Supabase.
        self.assertEqual(self.provider.batch_calls, [["a/2.jpg", "a/3.jpg"]])
        by_path = {row["path"]: row for row in rows}
        self.assertEqual(set(by_path), {"a/1.jpg", "a/2.jpg", "a/3.jpg"})
        for row in rows:
            self.assertTrue(str(row.get("signedURL") or "").startswith("https://cdn/"))

    def test_batch_results_are_cached_for_later_singles(self) -> None:
        rows = self.service.create_signed_urls("albums", ["a/1.jpg"])
        single = self.service.create_signed_url("albums", "a/1.jpg")
        self.assertEqual(single, rows[0]["signedURL"])
        self.assertEqual(len(self.provider.single_calls), 0)

    def test_cache_size_is_bounded(self) -> None:
        with patch.object(storage_service, "_SIGNED_URL_CACHE_MAX", 10):
            for index in range(25):
                self.service.create_signed_url("albums", f"a/{index}.jpg")
            self.assertLessEqual(len(storage_service._SIGNED_URL_CACHE), 10)

    def test_expired_entries_are_evicted_before_live_ones(self) -> None:
        base = 1_000_000.0
        with patch.object(storage_service, "_SIGNED_URL_CACHE_MAX", 3):
            with patch.object(storage_service.time, "time", return_value=base):
                self.service.create_signed_url("albums", "a/old1.jpg")
                self.service.create_signed_url("albums", "a/old2.jpg")
            # Far past the old entries' expiry: inserting evicts the dead ones first.
            with patch.object(storage_service.time, "time", return_value=base + TTL * 3):
                self.service.create_signed_url("albums", "a/new1.jpg")
                self.service.create_signed_url("albums", "a/new2.jpg")
                self.assertIn(("albums", "a/new1.jpg"), storage_service._SIGNED_URL_CACHE)
                self.assertIn(("albums", "a/new2.jpg"), storage_service._SIGNED_URL_CACHE)
                self.assertNotIn(("albums", "a/old1.jpg"), storage_service._SIGNED_URL_CACHE)

    def test_upsert_upload_invalidates_the_cached_url(self) -> None:
        # upsert replaces content under the SAME path; a cached signed URL would keep
        # serving the old image via the CDN for up to TTL/2 — the entry must go.
        url = self.service.create_signed_url("albums", "a/display.webp")
        self.service.upload("albums", "a/display.webp", b"new-bytes", content_type="image/webp", upsert=True)
        self.assertNotIn(("albums", "a/display.webp"), storage_service._SIGNED_URL_CACHE)
        refreshed = self.service.create_signed_url("albums", "a/display.webp")
        self.assertNotEqual(url, refreshed)

    def test_plain_upload_keeps_the_cache(self) -> None:
        # A non-upsert upload can only create a NEW object (409 on duplicates), so
        # existing cached URLs still point at unchanged content.
        url = self.service.create_signed_url("albums", "a/display.webp")
        self.service.upload("albums", "a/other.webp", b"bytes", content_type="image/webp")
        self.assertEqual(self.service.create_signed_url("albums", "a/display.webp"), url)

    def test_delete_invalidates_the_cached_url(self) -> None:
        self.service.create_signed_url("albums", "a/1.jpg")
        self.service.create_signed_url("albums", "a/2.jpg")
        self.service.delete("albums", ["a/1.jpg"])
        self.assertNotIn(("albums", "a/1.jpg"), storage_service._SIGNED_URL_CACHE)
        self.assertIn(("albums", "a/2.jpg"), storage_service._SIGNED_URL_CACHE)

    def test_empty_urls_are_not_cached(self) -> None:
        class EmptyProvider(CountingProvider):
            def signed_url(self, bucket: str, path: str, expires_in: int) -> str:
                self.single_calls.append(path)
                return ""

        provider = EmptyProvider()
        service = StorageService(provider, TTL)  # type: ignore[arg-type]
        service.create_signed_url("albums", "a/fail.jpg")
        service.create_signed_url("albums", "a/fail.jpg")
        # No caching of failures: both calls reached the provider.
        self.assertEqual(len(provider.single_calls), 2)


if __name__ == "__main__":
    unittest.main()
