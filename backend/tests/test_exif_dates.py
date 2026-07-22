from __future__ import annotations

import io
import unittest
from datetime import datetime, timezone

from PIL import Image
from PIL.ExifTags import Base

from app.services.exif_service import (
    format_cover_date,
    parse_exif_datetime,
    resolve_taken_at,
)
from app.services.image_upload_service import parse_file_created_at, process_upload
from app.services.photo_timeline import cover_date_from_processed, sort_photo_entries
from tests.test_image_upload_service import settings, upload_file


class ExifDateTests(unittest.TestCase):
    def test_parse_exif_datetime_formats(self) -> None:
        parsed = parse_exif_datetime("2026:07:12 10:11:12")
        assert parsed is not None
        self.assertEqual(parsed.year, 2026)
        self.assertEqual(parsed.month, 7)
        self.assertEqual(parsed.day, 12)

    def test_priority_datetime_original_over_create_date(self) -> None:
        taken = resolve_taken_at(
            datetime_original="2026:07:10 09:00:00",
            create_date="2026:07:11 09:00:00",
            file_created_at=datetime(2026, 7, 12, tzinfo=timezone.utc),
        )
        assert taken is not None
        self.assertEqual(taken.day, 10)

    def test_file_timestamp_is_not_a_capture_date_fallback(self) -> None:
        taken = resolve_taken_at(
            datetime_original=None,
            create_date=None,
            file_created_at=datetime(2026, 7, 15, 8, 0, tzinfo=timezone.utc),
        )
        self.assertIsNone(taken)

    def test_missing_exif_returns_none(self) -> None:
        self.assertIsNone(resolve_taken_at())

    def test_cover_date_single_and_range(self) -> None:
        one = [datetime(2026, 7, 12, tzinfo=timezone.utc)]
        many = [
            datetime(2026, 7, 12, tzinfo=timezone.utc),
            datetime(2026, 7, 14, 15, tzinfo=timezone.utc),
        ]
        self.assertEqual(format_cover_date(one), "2026.07.12")
        self.assertEqual(format_cover_date(many), "2026.07.12 ~ 2026.07.14")

    def test_sort_photo_entries_by_taken_at(self) -> None:
        later = process_upload(upload_file("a.jpg", "image/jpeg", self._jpeg_bytes()), settings())
        earlier_meta = parse_file_created_at(1_720_000_000_000)
        earlier = process_upload(
            upload_file("b.jpg", "image/jpeg", self._jpeg_bytes()),
            settings(),
            file_created_at=earlier_meta,
        )
        # Force taken_at for deterministic order without relying on EXIF write support.
        from dataclasses import replace

        later = replace(later, taken_at=datetime(2026, 7, 14, tzinfo=timezone.utc))
        earlier = replace(earlier, taken_at=datetime(2026, 7, 12, tzinfo=timezone.utc))
        missing = replace(later, taken_at=None)

        ordered = sort_photo_entries(
            [
                {"processed": later, "upload_order": 0, "story": {"order": 0, "text": "later"}},
                {"processed": missing, "upload_order": 2, "story": {"order": 2, "text": "missing"}},
                {"processed": earlier, "upload_order": 1, "story": {"order": 1, "text": "earlier"}},
            ]
        )
        self.assertEqual([item["story"]["text"] for item in ordered], ["earlier", "later", "missing"])
        self.assertEqual([item["sort_order"] for item in ordered], [0, 1, 2])
        self.assertEqual(cover_date_from_processed([earlier, later]), "2026.07.12 ~ 2026.07.14")

    def test_process_upload_reads_datetime_original(self) -> None:
        raw = self._jpeg_with_datetime_original("2026:07:12 08:30:00")
        processed = process_upload(upload_file("shot.jpg", "image/jpeg", raw), settings())
        assert processed.taken_at is not None
        self.assertEqual(processed.taken_at.day, 12)
        self.assertEqual(processed.orientation, "landscape")
        self.assertEqual(processed.width, 20)
        self.assertEqual(processed.height, 10)

    def test_explicit_capture_date_survives_exif_stripped_upload(self) -> None:
        processed = process_upload(
            upload_file("optimized.jpg", "image/jpeg", self._jpeg_bytes()),
            settings(),
            captured_at=datetime(2017, 5, 4, 12, 30),
        )
        self.assertEqual(processed.taken_at, datetime(2017, 5, 4, 12, 30))

    def test_missing_exif_never_uses_browser_last_modified(self) -> None:
        processed = process_upload(
            upload_file("plain.jpg", "image/jpeg", self._jpeg_bytes()),
            settings(),
            file_created_at=parse_file_created_at(1_720_000_000_000),
        )
        self.assertIsNone(processed.taken_at)

    def _jpeg_bytes(self) -> bytes:
        buffer = io.BytesIO()
        Image.new("RGB", (20, 10), "red").save(buffer, format="JPEG")
        return buffer.getvalue()

    def _jpeg_with_datetime_original(self, value: str) -> bytes:
        image = Image.new("RGB", (20, 10), "blue")
        exif = image.getexif()
        exif[Base.DateTimeOriginal] = value
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", exif=exif)
        return buffer.getvalue()


if __name__ == "__main__":
    unittest.main()
