"""사진을 **더할 때도** 촬영일·좌표를 함께 받는다 (2026-08-18).

좌표를 보내는 통로(`file_meta`)가 앱 전체에서 앨범을 **만드는** 자리 하나뿐이었다.
사진을 더하는 자리(주최자 `사진 추가` · 참여자 더하기)는 둘 다 이 엔드포인트를
거치는데, 거기에는 그 통로가 없었다.

★ 모양은 앨범을 만들 때와 **같다**(`file_meta`). 서버가 두 가지 모양을 알게 하지 않는다.
★ 파서도 같은 것을 쓴다(`parse_captured_at` · `parse_coordinate`).
★ 좌표를 못 읽어도 **사진은 그대로 올라간다.** 지명이 안 붙을 뿐이다.
★ 좌표는 저장하지 않는다 — 이름으로 바꾼 뒤 버린다(2026-08-13 PO · 기존 규칙).
"""

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.collaboration import router

ALBUM_ID = "11111111-1111-1111-1111-111111111111"
CONTRIBUTOR_ID = "22222222-2222-2222-2222-222222222222"

SEOUL = {"captured_at": "2024-05-18T10:11:12.000Z", "latitude": 37.55, "longitude": 126.9667}


class AddPhotoFileMetaTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        settings = SimpleNamespace(
            supabase_private_storage_bucket="private", signed_url_ttl_seconds=3600, kakao_rest_api_key="key",
        )
        self.saved: list[dict] = []
        self.process_calls: list[dict] = []

        def fake_process(_photo, _settings, **kwargs):
            """진짜 process_upload 의 우선순위만 흉내낸다 — 화면이 보낸 값이 EXIF 보다 먼저다."""
            self.process_calls.append(kwargs)
            return SimpleNamespace(
                checksum_sha256=f"checksum-{len(self.process_calls)}", original_mime_type="image/jpeg",
                original_bytes=b"image", width=1200, height=800, orientation="landscape",
                taken_at=kwargs.get("captured_at"),
                latitude=kwargs.get("captured_latitude"), longitude=kwargs.get("captured_longitude"),
            )

        for item in (
            patch("app.api.collaboration.get_settings", return_value=settings),
            patch("app.api.collaboration.get_supabase_client", return_value=supabase),
            patch("app.api.collaboration.get_album_record",
                  return_value={"id": ALBUM_ID, "photo_limit": 30, "family_id": "family-1"}),
            patch("app.api.collaboration.require_contributor",
                  return_value={"id": CONTRIBUTOR_ID, "display_name": "민수"}),
            patch("app.api.collaboration.count_ready_photos", return_value=2),
            patch("app.api.collaboration.process_upload", side_effect=fake_process),
            patch("app.api.collaboration.upload_album_photo_assets",
                  return_value=("photos/new.jpg", "thumbnails/new.jpg")),
            patch("app.api.collaboration.save_album_photo_records",
                  side_effect=lambda _client, records: self.saved.extend(records)),
            patch("app.api.collaboration.get_signed_url",
                  side_effect=lambda _c, _b, path, _ttl: f"https://cdn.example/{path}"),
            patch("app.api.collaboration.mark_album_dirty"),
        ):
            item.start()
            self.addCleanup(item.stop)

    def _post(self, files, **data):
        return self.client.post(
            f"/api/albums/{ALBUM_ID}/contribute/photos",
            files=files, data=data,
            headers={"X-Woorialbum-Contributor-Id": CONTRIBUTOR_ID},
        )

    def test_촬영일과_좌표가_같은_모양으로_실려_온다(self) -> None:
        response = self._post(
            [("photos", ("a.jpg", b"image-a", "image/jpeg"))], file_meta=json.dumps([SEOUL]),
        )
        self.assertEqual(response.status_code, 200)
        sent = self.process_calls[0]
        self.assertEqual(sent["captured_latitude"], 37.55)
        self.assertEqual(sent["captured_longitude"], 126.9667)
        self.assertEqual(sent["captured_at"], datetime(2024, 5, 18, 10, 11, 12, tzinfo=timezone.utc))

    def test_좌표가_있으면_location_source_가_exif_다(self) -> None:
        with patch("app.services.place_name_service.resolve_city_name_cached", return_value="중구"):
            self._post([("photos", ("a.jpg", b"image-a", "image/jpeg"))], file_meta=json.dumps([SEOUL]))
        record = self.saved[0]
        self.assertEqual(record["location_name"], "중구")
        self.assertEqual(record["location_source"], "exif")
        # 좌표 자체는 저장하지 않는다 — 이름으로 바꾼 뒤 버린다(기존 규칙).
        self.assertIsNone(record["latitude"])
        self.assertIsNone(record["longitude"])
        self.assertEqual(record["taken_at"], "2024-05-18T10:11:12+00:00")

    def test_좌표가_없어도_사진은_정상으로_올라간다(self) -> None:
        """회귀 — 지명 하나 때문에 사진을 잃으면 안 된다."""
        empty = {"captured_at": None, "latitude": None, "longitude": None}
        response = self._post(
            [("photos", ("a.jpg", b"image-a", "image/jpeg"))], file_meta=json.dumps([empty]),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.saved), 1)
        self.assertIsNone(self.saved[0]["location_name"])
        self.assertEqual(self.saved[0]["location_source"], "unknown")
        self.assertIsNone(self.process_calls[0]["captured_latitude"])

    def test_file_meta_가_아예_없거나_깨져도_올라간다(self) -> None:
        """옛 화면과 이상한 몸 둘 다 — 사진을 버리지 않는다."""
        for data in ({}, {"file_meta": "그건-JSON-이-아니다"}, {"file_meta": json.dumps({"not": "a list"})}):
            self.saved.clear()
            self.process_calls.clear()
            response = self._post([("photos", ("a.jpg", b"image-a", "image/jpeg"))], **data)
            self.assertEqual(response.status_code, 200, data)
            self.assertEqual(len(self.saved), 1, data)
            self.assertIsNone(self.process_calls[0]["captured_latitude"], data)

    def test_사진이_여럿이면_순서대로_짝짓는다(self) -> None:
        seoul_only = [SEOUL, {"captured_at": None, "latitude": None, "longitude": None}]
        self._post(
            [("photos", ("a.jpg", b"image-a", "image/jpeg")), ("photos", ("b.jpg", b"image-b", "image/jpeg"))],
            file_meta=json.dumps(seoul_only),
        )
        self.assertEqual(self.process_calls[0]["captured_latitude"], 37.55)
        self.assertIsNone(self.process_calls[1]["captured_latitude"])

    def test_같은_파서를_쓴다(self) -> None:
        """새 파서를 만들지 않는다 — 앨범을 만들 때 쓰는 그 함수다."""
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "collaboration.py").read_text(encoding="utf-8")
        self.assertIn("parse_captured_at(raw_meta.get(\"captured_at\"))", source)
        self.assertIn("parse_coordinate(raw_meta.get(\"latitude\"), limit=90)", source)
        self.assertIn("parse_coordinate(raw_meta.get(\"longitude\"), limit=180)", source)
