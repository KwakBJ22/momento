import io
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock

from fastapi import HTTPException, UploadFile

from app.services.media_upload_service import process_media_upload
from app.services.media_upload_service import ProcessedMedia
from app.services.supabase import upload_album_media_assets


def settings() -> SimpleNamespace:
    return SimpleNamespace(
        max_file_size_mb=10,
        max_image_pixels=40_000_000,
        thumbnail_max_side=640,
        max_video_file_size_mb=500,
        max_audio_file_size_mb=100,
        max_document_file_size_mb=50,
        allowed_image_types=("image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"),
    )


def upload_file(name: str, mime: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(content), headers={"content-type": mime})


class MediaUploadServiceTests(TestCase):
    def test_mp4_and_mov_container_validation(self) -> None:
        mp4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 24
        mov = b"\x00\x00\x00\x18ftypqt  " + b"\x00" * 24

        self.assertEqual(process_media_upload(upload_file("clip.mp4", "video/mp4", mp4), settings()).media_type, "video")
        self.assertEqual(process_media_upload(upload_file("clip.mov", "video/quicktime", mov), settings()).mime_type, "video/quicktime")

    def test_audio_signatures_and_wav_duration(self) -> None:
        mp3 = b"ID3\x04\x00\x00" + b"\x00" * 16
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
        m4a = b"\x00\x00\x00\x18ftypM4A " + b"\x00" * 24

        self.assertEqual(process_media_upload(upload_file("sound.mp3", "audio/mpeg", mp3), settings()).media_type, "audio")
        self.assertEqual(process_media_upload(upload_file("sound.wav", "audio/wav", wav), settings()).duration_seconds, 0.0)
        self.assertEqual(process_media_upload(upload_file("sound.m4a", "audio/mp4", m4a), settings()).mime_type, "audio/mp4")

    def test_pdf_and_disallowed_mime_validation(self) -> None:
        pdf = b"%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n"
        processed = process_media_upload(upload_file("letter.pdf", "application/pdf", pdf), settings())
        self.assertEqual(processed.media_type, "document")
        self.assertEqual(processed.page_count, 1)

        with self.assertRaises(HTTPException) as raised:
            process_media_upload(upload_file("script.exe", "application/octet-stream", b"MZ"), settings())
        self.assertEqual(raised.exception.status_code, 400)

    def test_media_asset_rollback_removes_original_and_thumbnail(self) -> None:
        client = MagicMock()
        bucket = client.storage.from_.return_value
        bucket.upload.side_effect = [None, RuntimeError("thumbnail failed")]
        media = ProcessedMedia("image", "image/jpeg", b"original", None, None, b"thumbnail")

        with self.assertRaisesRegex(RuntimeError, "thumbnail failed"):
            upload_album_media_assets(
                client,
                "family",
                "album",
                "media",
                media,
                SimpleNamespace(supabase_private_storage_bucket="private"),
            )

        bucket.remove.assert_called_once()
