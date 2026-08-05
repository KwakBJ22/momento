"""Contract: album total capacity is 100 (PO decision B) and every fallback uses the
single constant — the per-upload cap (settings.max_photos=30) stays separate."""
from __future__ import annotations

import unittest

from app.config import Settings
from app.models.schemas import DEFAULT_ALBUM_PHOTO_CAPACITY, PublicShareAlbumResponse


class AlbumCapacityTests(unittest.TestCase):
    def test_capacity_constant_is_100(self) -> None:
        self.assertEqual(DEFAULT_ALBUM_PHOTO_CAPACITY, 100)

    def test_share_schema_default_uses_the_constant(self) -> None:
        self.assertEqual(PublicShareAlbumResponse.model_fields["photo_limit"].default, DEFAULT_ALBUM_PHOTO_CAPACITY)

    def test_per_upload_cap_stays_30(self) -> None:
        # 앨범 생성 1회 업로드 상한은 유지된다(업로드 성공률·40MB 가드).
        self.assertEqual(Settings.model_fields["max_photos"].default, 30)

    def test_no_stray_or_30_fallbacks_remain(self) -> None:
        from pathlib import Path
        root = Path(__file__).resolve().parents[1] / "app"
        offenders = [
            str(path)
            for path in root.rglob("*.py")
            if 'photo_limit") or 30)' in path.read_text(encoding="utf-8")
        ]
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
