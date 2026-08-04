"""[6] The light album-detail response must fill cover_image_url from a single signed
cover photo, so share paths never fall back to the illegible result-grid image."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.api import album as album_api

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
COVER_ID = "22222222-2222-2222-2222-222222222222"
FIRST_ID = "33333333-3333-3333-3333-333333333333"


def _photo(pid: str) -> dict:
    return {"id": pid, "thumbnail_bucket": "albums", "thumbnail_path": f"p/{pid}.jpg",
            "storage_bucket": "albums", "storage_path": f"p/{pid}.jpg"}


def _record(**over) -> dict:
    record = {"id": ALBUM_ID, "created_at": datetime.now(timezone.utc)}
    record.update(over)
    return record


class CoverShareImageTests(unittest.TestCase):
    def _detail(self, *, photos, cover_photo_id=None):
        record = _record(cover_photo_id=cover_photo_id)
        with patch.object(album_api, "get_album_photo_records", return_value=photos), \
             patch.object(album_api, "get_result_signed_url", return_value="https://cdn/grid.png"), \
             patch.object(album_api, "get_signed_url", return_value="https://cdn/cover.jpg") as signed:
            detail = album_api._record_to_detail_light(
                record, MagicMock(), MagicMock(), edition=None, photo_count=len(photos), memory_count=0,
            )
        return detail, signed

    def test_cover_image_url_uses_the_selected_cover(self) -> None:
        detail, signed = self._detail(photos=[_photo(FIRST_ID), _photo(COVER_ID)], cover_photo_id=COVER_ID)
        self.assertEqual(detail.cover_image_url, "https://cdn/cover.jpg")
        # Exactly one photo is signed — the light path must not sign the whole album.
        self.assertEqual(signed.call_count, 1)

    def test_cover_image_url_falls_back_to_the_first_photo(self) -> None:
        detail, signed = self._detail(photos=[_photo(FIRST_ID), _photo(COVER_ID)], cover_photo_id=None)
        self.assertEqual(detail.cover_image_url, "https://cdn/cover.jpg")
        self.assertEqual(signed.call_count, 1)

    def test_cover_image_url_is_none_when_there_are_no_photos(self) -> None:
        detail, signed = self._detail(photos=[], cover_photo_id=None)
        self.assertIsNone(detail.cover_image_url)
        self.assertEqual(signed.call_count, 0)

    def test_cover_image_url_is_never_the_result_grid(self) -> None:
        detail, _ = self._detail(photos=[_photo(FIRST_ID)], cover_photo_id=None)
        self.assertEqual(detail.image_url, "https://cdn/grid.png")
        self.assertNotEqual(detail.cover_image_url, detail.image_url)


if __name__ == "__main__":
    unittest.main()
