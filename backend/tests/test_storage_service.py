from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.services.storage_service import StorageService, album_pdf_path, album_photo_paths, album_result_path
from app.services.supabase import cleanup_album_files, get_signed_urls_batch


class FakeProvider:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str]] = []
        self.deletes: list[tuple[str, list[str]]] = []

    def upload(self, bucket, path, content, *, content_type, upsert=False):
        self.uploads.append((bucket, path))

    def delete(self, bucket, paths):
        self.deletes.append((bucket, paths))

    def download(self, bucket, path): return b"asset"
    def signed_url(self, bucket, path, expires_in): return f"signed://{bucket}/{path}?ttl={expires_in}"
    def signed_urls(self, bucket, paths, expires_in): return [{"path": path, "signedURL": f"signed://{bucket}/{path}"} for path in paths]
    def list(self, bucket, prefix): return []
    def move(self, bucket, source, destination): return None
    def copy(self, bucket, source, destination): return None


class StorageServiceTests(TestCase):
    def test_provider_neutral_paths_use_a_single_album_root(self) -> None:
        original, display, thumbnail = album_photo_paths("unused", "album", "photo", "jpg")
        self.assertEqual(original, "albums/album/photos/photo/original.jpg")
        self.assertEqual(display, "albums/album/photos/photo/display.webp")
        self.assertEqual(thumbnail, "albums/album/photos/photo/thumbnail.webp")
        self.assertEqual(album_result_path("album", "asset"), "albums/album/results/asset.png")
        self.assertEqual(album_pdf_path("album", "asset"), "albums/album/pdf/asset.pdf")

    def test_signed_urls_are_issued_by_the_service(self) -> None:
        provider = FakeProvider()
        service = StorageService(provider, 300)
        self.assertEqual(service.create_signed_url("private", "albums/a/results/r.png"), "signed://private/albums/a/results/r.png?ttl=300")

    def test_batch_signed_urls_deduplicates_identical_storage_paths(self) -> None:
        service = MagicMock()
        service.create_signed_urls.side_effect = lambda bucket, paths, _ttl: [
            {"path": path, "signedURL": f"signed://{bucket}/{path}"} for path in paths
        ]
        assets = [
            {"bucket": "private", "path": "albums/a/photos/p/display.webp"},
            {"bucket": "private", "path": "albums/a/photos/p/display.webp"},
        ]

        with patch("app.services.supabase.StorageService.for_supabase", return_value=service):
            urls = get_signed_urls_batch(MagicMock(), assets, 300)

        service.create_signed_urls.assert_called_once_with(
            "private", ["albums/a/photos/p/display.webp"], 300
        )
        self.assertEqual(urls[("private", "albums/a/photos/p/display.webp")], "signed://private/albums/a/photos/p/display.webp")

    def test_cleanup_album_files_is_dry_run_then_idempotently_deletes(self) -> None:
        client = MagicMock()
        settings = SimpleNamespace(supabase_private_storage_bucket="private", supabase_storage_bucket="legacy", signed_url_ttl_seconds=300)
        album = {"id": "album", "result_path": "albums/album/results/result.png", "result_bucket": "private", "pdf_cache": {"1": {"path": "albums/album/pdf/one.pdf"}}}
        photos = [{"storage_bucket": "private", "storage_path": "albums/album/photos/p/original.jpg", "display_bucket": "private", "display_path": "albums/album/photos/p/display.webp", "thumbnail_bucket": "private", "thumbnail_path": "albums/album/photos/p/thumbnail.webp"}]
        media = [{"original_path": "albums/album/media/m/original", "preview_path": None, "thumbnail_path": "albums/album/media/m/thumbnail.webp"}]

        plan = cleanup_album_files(client, settings, album, photo_rows=photos, media_rows=media, dry_run=True)
        self.assertEqual(len(plan["private"]), 7)
        cleanup_album_files(client, settings, album, photo_rows=photos, media_rows=media, dry_run=False)
        client.storage.from_.return_value.remove.assert_called()

    def test_cleanup_skips_null_urls_and_deduplicates_gif_display_path(self) -> None:
        client = MagicMock()
        settings = SimpleNamespace(supabase_private_storage_bucket="private", supabase_storage_bucket="legacy", signed_url_ttl_seconds=300)
        album = {"id": "album"}
        photos = [{
            "storage_bucket": "private",
            "storage_path": "albums/album/photos/gif/original.gif",
            "display_bucket": "private",
            "display_path": "albums/album/photos/gif/original.gif",
            "thumbnail_bucket": "private",
            "thumbnail_path": "",
        }, {
            "storage_bucket": "private",
            "storage_path": "https://storage.example/should-not-delete?token=secret",
            "display_bucket": None,
            "display_path": None,
            "thumbnail_bucket": "private",
            "thumbnail_path": None,
        }]

        plan = cleanup_album_files(client, settings, album, photo_rows=photos, media_rows=[], dry_run=True)

        self.assertEqual(plan, {"private": ["albums/album/photos/gif/original.gif"]})

    def test_cleanup_storage_failure_does_not_abort_other_buckets(self) -> None:
        class FailingProvider(FakeProvider):
            def delete(self, bucket, paths):
                super().delete(bucket, paths)
                if bucket == "first":
                    raise RuntimeError("storage unavailable")

        provider = FailingProvider()
        service = StorageService(provider, 300)
        client = MagicMock()
        settings = SimpleNamespace(supabase_private_storage_bucket="private", supabase_storage_bucket="legacy", signed_url_ttl_seconds=300)
        photos = [
            {"storage_bucket": "first", "storage_path": "albums/a/one.jpg", "display_bucket": None, "display_path": None, "thumbnail_bucket": None, "thumbnail_path": None},
            {"storage_bucket": "second", "storage_path": "albums/a/two.jpg", "display_bucket": None, "display_path": None, "thumbnail_bucket": None, "thumbnail_path": None},
        ]

        with patch("app.services.supabase.StorageService.for_supabase", return_value=service):
            cleanup_album_files(client, settings, {"id": "album"}, photo_rows=photos, media_rows=[], dry_run=False)

        self.assertEqual([bucket for bucket, _paths in provider.deletes], ["first", "second"])

    def test_deleted_album_prefix_cleanup_removes_temp_and_superseded_assets(self) -> None:
        class PrefixProvider(FakeProvider):
            def list(self, bucket, prefix):
                if bucket == "private" and prefix == "albums/album":
                    return [
                        {"name": "temp", "id": None},
                        {"name": "old-result.png", "id": "old-result"},
                    ]
                if bucket == "private" and prefix == "albums/album/temp":
                    return [{"name": "upload.jpg", "id": "temp-file"}]
                return []

        provider = PrefixProvider()
        service = StorageService(provider, 300)
        settings = SimpleNamespace(supabase_private_storage_bucket="private", supabase_storage_bucket="legacy", signed_url_ttl_seconds=300)
        with patch("app.services.supabase.StorageService.for_supabase", return_value=service):
            cleanup_album_files(MagicMock(), settings, {"id": "album"}, photo_rows=[], media_rows=[], dry_run=False, remove_album_prefix=True)

        self.assertIn(
            ("private", ["albums/album/old-result.png", "albums/album/temp/upload.jpg"]),
            provider.deletes,
        )

    def test_recursive_listing_and_exists_do_not_treat_folders_as_files(self) -> None:
        class TreeProvider(FakeProvider):
            def list(self, bucket, prefix):
                if prefix == "albums/a":
                    return [{"name": "photos"}, {"name": "result.png", "id": "file"}]
                if prefix == "albums/a/photos":
                    return [{"name": "one.jpg", "id": "photo"}]
                return []

        service = StorageService(TreeProvider(), 300)
        self.assertEqual(
            [item["path"] for item in service.list_recursive("private", "albums/a")],
            ["albums/a/photos/one.jpg", "albums/a/result.png"],
        )
        self.assertTrue(service.file_exists("private", "albums/a/result.png"))
        self.assertFalse(service.file_exists("private", "albums/a/missing.png"))
