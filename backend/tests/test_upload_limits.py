from io import BytesIO
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException, UploadFile

from app.services.image_upload_service import validate_upload_limits


def upload(size: int) -> UploadFile:
    return UploadFile(filename="photo.jpg", file=BytesIO(b"x" * size), headers={"content-type": "image/jpeg"})


class UploadLimitTests(TestCase):
    settings = SimpleNamespace(max_file_size_mb=10, max_photos=30)

    def test_accepts_files_within_individual_and_total_limits(self) -> None:
        validate_upload_limits([upload(10 * 1024 * 1024)] * 4, self.settings)

    def test_rejects_an_individual_file_over_10mb(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            validate_upload_limits([upload(10 * 1024 * 1024 + 1)], self.settings)
        self.assertEqual(raised.exception.status_code, 413)

    def test_rejects_a_total_over_album_photo_cap(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            validate_upload_limits([upload(10 * 1024 * 1024)] * 31, self.settings)
        self.assertEqual(raised.exception.status_code, 413)
