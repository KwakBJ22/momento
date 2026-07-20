import io
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock

from fastapi import HTTPException, UploadFile
from PIL import Image

from app.services.image_upload_service import ProcessedPhoto, process_upload
from app.services.supabase import upload_album_photo_assets


def settings() -> SimpleNamespace:
    return SimpleNamespace(
        max_file_size_mb=10,
        max_image_pixels=40_000_000,
        thumbnail_max_side=640,
        allowed_image_types=("image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"),
    )


def upload_file(name: str, content_type: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(content), headers={"content-type": content_type})


class ImageUploadServiceTests(TestCase):
    def test_jpeg_is_reencoded_without_exif_and_gets_webp_thumbnail(self) -> None:
        source = Image.new("RGB", (20, 10), "red")
        exif = Image.Exif()
        exif[0x010E] = "private metadata"
        raw = io.BytesIO()
        source.save(raw, format="JPEG", exif=exif)
        self.assertIn(b"Exif", raw.getvalue())

        processed = process_upload(upload_file("photo.jpg", "image/jpeg", raw.getvalue()), settings())

        self.assertEqual(processed.original_mime_type, "image/jpeg")
        self.assertEqual(processed.original_extension, "jpg")
        self.assertEqual(processed.width, 20)
        self.assertEqual(processed.height, 10)
        self.assertNotIn(b"Exif", processed.original_bytes)
        self.assertTrue(processed.thumbnail_bytes.startswith(b"RIFF"))

    def test_gif_original_is_preserved_and_thumbnail_is_webp(self) -> None:
        raw = io.BytesIO()
        Image.new("P", (12, 12), 1).save(raw, format="GIF")

        processed = process_upload(upload_file("motion.gif", "image/gif", raw.getvalue()), settings())

        self.assertEqual(processed.original_bytes, raw.getvalue())
        self.assertEqual(processed.original_mime_type, "image/gif")
        self.assertTrue(processed.thumbnail_bytes.startswith(b"RIFF"))

    def test_extension_and_real_content_mismatch_is_rejected(self) -> None:
        raw = io.BytesIO()
        Image.new("RGB", (4, 4), "blue").save(raw, format="PNG")

        with self.assertRaises(HTTPException) as raised:
            process_upload(upload_file("pretend.jpg", "image/jpeg", raw.getvalue()), settings())

        self.assertEqual(raised.exception.status_code, 400)

    def test_mobile_image_jpg_mime_alias_is_accepted(self) -> None:
        raw = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(raw, format="JPEG")

        processed = process_upload(upload_file("camera.jpg", "image/jpg", raw.getvalue()), settings())

        self.assertEqual(processed.original_mime_type, "image/jpeg")

    def test_mobile_empty_mime_and_missing_extension_uses_decoded_format(self) -> None:
        raw = io.BytesIO()
        Image.new("RGB", (8, 8), "navy").save(raw, format="JPEG")

        processed = process_upload(upload_file("IMG_0001", "", raw.getvalue()), settings())

        self.assertEqual(processed.original_mime_type, "image/jpeg")
        self.assertEqual(processed.original_extension, "jpg")

    def test_octet_stream_with_jpeg_extension_is_accepted(self) -> None:
        raw = io.BytesIO()
        Image.new("RGB", (6, 6), "yellow").save(raw, format="JPEG")

        processed = process_upload(
            upload_file("android.jpg", "application/octet-stream", raw.getvalue()),
            settings(),
        )

        self.assertEqual(processed.original_mime_type, "image/jpeg")

    def test_heic_is_decoded_and_reencoded_as_browser_compatible_jpeg(self) -> None:
        raw = io.BytesIO()
        Image.new("RGB", (10, 10), "green").save(raw, format="HEIF")

        processed = process_upload(upload_file("portrait.heic", "image/heic", raw.getvalue()), settings())

        self.assertEqual(processed.original_mime_type, "image/jpeg")
        self.assertEqual(processed.original_extension, "jpg")
        self.assertTrue(processed.original_bytes.startswith(b"\xff\xd8"))
        self.assertTrue(processed.thumbnail_bytes.startswith(b"RIFF"))

    def test_asset_upload_failure_removes_any_partial_private_objects(self) -> None:
        client = MagicMock()
        bucket = client.storage.from_.return_value
        bucket.upload.side_effect = [None, RuntimeError("thumbnail failed")]
        photo = ProcessedPhoto(b"original", "jpg", "image/jpeg", b"thumbnail", b"original", "checksum")

        with self.assertRaisesRegex(RuntimeError, "thumbnail failed"):
            upload_album_photo_assets(client, "family", "album", "photo", photo, SimpleNamespace(supabase_private_storage_bucket="private"))

        bucket.remove.assert_called_once()
