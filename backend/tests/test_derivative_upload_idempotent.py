"""Derivative uploads must be idempotent (upsert), so a retry after a partial failure
never hits 409 Duplicate. Observed in production: display.webp uploaded, thumbnail
failed, cleanup also failed → orphan display.webp blocked every backfill retry.

The original upload stays upsert=False — the original must never be overwritten."""
from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import MagicMock, patch

from app.services import supabase as supabase_service
from app.services.storage_service import StorageService, clear_signed_url_cache


class DuplicateAwareProvider:
    """Simulates Supabase Storage: non-upsert upload of an existing path raises 409."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.uploads: list[tuple[str, bool]] = []
        self.cache_controls: dict[str, str] = {}

    def upload(self, bucket: str, path: str, content: bytes, *, content_type: str, upsert: bool = False, cache_control: str = "") -> None:
        self.uploads.append((path, upsert))
        self.cache_controls[path] = cache_control
        if not upsert and (bucket, path) in self.objects:
            raise RuntimeError("StorageApiError 409 Duplicate")
        self.objects[(bucket, path)] = content

    def delete(self, bucket: str, paths: list[str]) -> None:
        for path in paths:
            self.objects.pop((bucket, path), None)

    def signed_url(self, bucket: str, path: str, expires_in: int) -> str:
        return f"https://cdn/{path}"

    def signed_urls(self, bucket: str, paths: list[str], expires_in: int) -> list[dict[str, Any]]:
        return [{"path": path, "signedURL": f"https://cdn/{path}", "error": None} for path in paths]


class DerivativeUploadIdempotencyTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_signed_url_cache()
        self.provider = DuplicateAwareProvider()
        self.settings = MagicMock(supabase_private_storage_bucket="woorialbum-private", signed_url_ttl_seconds=3600)
        self.service = StorageService(self.provider, 3600)  # type: ignore[arg-type]

    def tearDown(self) -> None:
        clear_signed_url_cache()

    def _upload_derivatives(self) -> tuple[str, str]:
        with patch.object(supabase_service.StorageService, "for_supabase", return_value=self.service):
            return supabase_service.upload_album_photo_derivatives(
                MagicMock(),
                album_id="album-1",
                photo_id="photo-1",
                original_extension="jpg",
                original_mime_type="image/jpeg",
                display_bytes=b"display-v1",
                thumbnail_bytes=b"thumb-v1",
                settings=self.settings,
            )

    def test_second_upload_of_the_same_paths_does_not_409(self) -> None:
        display_path, thumbnail_path = self._upload_derivatives()
        # The production incident: display already exists from a partial first run.
        # A retry must overwrite, not raise 409 Duplicate.
        second = self._upload_derivatives()
        self.assertEqual(second, (display_path, thumbnail_path))
        self.assertTrue(all(upsert for _path, upsert in self.provider.uploads))

    def test_retry_after_orphan_display_succeeds(self) -> None:
        # Seed the exact orphan state: display.webp exists, thumbnail missing.
        self.provider.objects[("woorialbum-private", "albums/album-1/photos/photo-1/display.webp")] = b"orphan"
        display_path, thumbnail_path = self._upload_derivatives()
        self.assertEqual(self.provider.objects[("woorialbum-private", display_path)], b"display-v1")
        self.assertIn(("woorialbum-private", thumbnail_path), self.provider.objects)

    def test_uploads_carry_the_default_cache_control(self) -> None:
        # Objects stored without cache-control end up no-cache: neither the browser nor
        # the CDN caches them and every view is a fresh download. Default = 30 days,
        # passed as SECONDS (storage3 renders "max-age={n}" itself).
        self._upload_derivatives()
        for path, value in self.provider.cache_controls.items():
            self.assertEqual(value, str(30 * 24 * 3600), path)

    def test_supabase_provider_sends_cache_control_file_option(self) -> None:
        from app.services.storage_service import SupabaseStorageProvider

        client = MagicMock()
        SupabaseStorageProvider(client).upload("albums", "a/display.webp", b"x", content_type="image/webp", upsert=True)
        options = client.storage.from_.return_value.upload.call_args.kwargs["file_options"]
        self.assertEqual(options["cache-control"], "2592000")
        self.assertEqual(options["upsert"], "true")

    def test_original_upload_still_refuses_to_overwrite(self) -> None:
        # ★ The durable original keeps upsert=False: a duplicate stays an error.
        self.provider.objects[("woorialbum-private", "a/original.jpg")] = b"original"
        with self.assertRaises(RuntimeError):
            self.service.upload("woorialbum-private", "a/original.jpg", b"new", content_type="image/jpeg")
        self.assertEqual(self.provider.objects[("woorialbum-private", "a/original.jpg")], b"original")


if __name__ == "__main__":
    unittest.main()
