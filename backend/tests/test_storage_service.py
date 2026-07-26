from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock

from app.services.storage_service import StorageService, album_pdf_path, album_photo_paths, album_result_path
from app.services.supabase import cleanup_album_files


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
        original, thumbnail = album_photo_paths("unused", "album", "photo", "jpg")
        self.assertEqual(original, "albums/album/photos/photo/original.jpg")
        self.assertEqual(thumbnail, "albums/album/photos/photo/thumbnail.webp")
        self.assertEqual(album_result_path("album", "asset"), "albums/album/results/asset.png")
        self.assertEqual(album_pdf_path("album", "asset"), "albums/album/pdf/asset.pdf")

    def test_signed_urls_are_issued_by_the_service(self) -> None:
        provider = FakeProvider()
        service = StorageService(provider, 300)
        self.assertEqual(service.create_signed_url("private", "albums/a/results/r.png"), "signed://private/albums/a/results/r.png?ttl=300")

    def test_cleanup_album_files_is_dry_run_then_idempotently_deletes(self) -> None:
        client = MagicMock()
        settings = SimpleNamespace(supabase_private_storage_bucket="private", supabase_storage_bucket="legacy", signed_url_ttl_seconds=300)
        album = {"id": "album", "result_path": "albums/album/results/result.png", "result_bucket": "private", "pdf_cache": {"1": {"path": "albums/album/pdf/one.pdf"}}}
        photos = [{"storage_bucket": "private", "storage_path": "albums/album/photos/p/original.jpg", "thumbnail_bucket": "private", "thumbnail_path": "albums/album/photos/p/thumbnail.webp"}]
        media = [{"original_path": "albums/album/media/m/original", "preview_path": None, "thumbnail_path": "albums/album/media/m/thumbnail.webp"}]

        plan = cleanup_album_files(client, settings, album, photo_rows=photos, media_rows=media, dry_run=True)
        self.assertEqual(len(plan["private"]), 6)
        cleanup_album_files(client, settings, album, photo_rows=photos, media_rows=media, dry_run=False)
        client.storage.from_.return_value.remove.assert_called()

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
