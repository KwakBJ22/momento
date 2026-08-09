import io
from types import SimpleNamespace
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.services.supabase import get_result_signed_url, get_signed_url, save_album_record
from app.services.event_logger import EventLogger
from app.services.auth import require_authenticated_user
from PIL import Image


class MissingResultBucketColumn(Exception):
    message = "Could not find the 'result_bucket' column of 'albums' in the schema cache"


class StorageAndMigrationResilienceTests(TestCase):
    def test_album_insert_retries_without_additive_result_bucket_column(self) -> None:
        client = MagicMock()
        table = client.table.return_value
        table.insert.return_value.execute.side_effect = [MissingResultBucketColumn(), None]

        saved = save_album_record(
            client,
            album_id="album-1",
            owner_id=None,
            family_id=None,
            meeting_type="family",
            template="classic",
            title="test",
            event_date="2026-01-01",
            narrative="",
            photo_paths=[],
            photo_meta=[],
            result_path="albums/album-1/results/result.png",
            result_bucket="woorialbum-private",
        )

        self.assertNotIn("result_bucket", saved)
        first_record = table.insert.call_args_list[0].args[0]
        second_record = table.insert.call_args_list[1].args[0]
        self.assertEqual(first_record["result_bucket"], "woorialbum-private")
        self.assertNotIn("result_bucket", second_record)

    def test_signed_url_failure_returns_empty_value_instead_of_raising(self) -> None:
        with patch("app.services.supabase.StorageService.for_supabase", side_effect=RuntimeError("bucket unavailable")):
            self.assertEqual(get_signed_url(MagicMock(), "woorialbum-private", "albums/a/photo.jpg", 300), "")

    def test_legacy_result_without_bucket_prefers_private_signed_url(self) -> None:
        settings = SimpleNamespace(
            supabase_private_storage_bucket="woorialbum-private",
            supabase_storage_bucket="albums",
            signed_url_ttl_seconds=300,
        )
        with patch("app.services.supabase.get_signed_url", side_effect=["private-url"] ) as signed:
            url = get_result_signed_url(MagicMock(), {"result_path": "albums/a/results/r.png"}, settings)
        self.assertEqual(url, "private-url")
        self.assertEqual(signed.call_args.args[1], "woorialbum-private")

    def test_event_logger_failure_is_best_effort(self) -> None:
        client = MagicMock()
        client.table.return_value.insert.return_value.execute.side_effect = RuntimeError("analytics unavailable")

        self.assertFalse(EventLogger.record(client, "album_created", album_id="album-1"))


class ApiOperationHeaderTests(TestCase):
    def test_request_validation_uses_a_safe_korean_message(self) -> None:
        from app.main import app, fastapi_app

        class _ValidationPayload(BaseModel):
            relationship: str

        @fastapi_app.post("/__test-safe-validation")
        async def _safe_validation(payload: _ValidationPayload) -> dict[str, str]:
            return {"relationship": payload.relationship}

        response = TestClient(app, raise_server_exceptions=False).post("/__test-safe-validation", json={})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "입력 내용을 확인해주세요.")
        self.assertNotIn("Field required", response.text)

    def test_health_is_available_with_an_operation_id(self) -> None:
        from app.main import app

        response = TestClient(app, raise_server_exceptions=False).get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers.get("x-operation-id"))

    def test_unhandled_request_keeps_operation_id_without_exposing_exception(self) -> None:
        from app.main import app, fastapi_app

        @fastapi_app.get("/__test-operation-error")
        async def _operation_error() -> None:
            raise RuntimeError("internal-only failure")

        response = TestClient(app, raise_server_exceptions=False).get("/__test-operation-error")
        self.assertEqual(response.status_code, 500)
        self.assertTrue(response.headers.get("x-operation-id"))
        self.assertNotIn("internal-only failure", response.text)

    def test_storage_health_returns_ok_when_provider_is_available(self) -> None:
        from app.main import app

        storage = MagicMock()
        with patch("app.main.get_supabase_client", return_value=MagicMock()), patch(
            "app.main.StorageService.for_supabase", return_value=storage
        ):
            response = TestClient(app, raise_server_exceptions=False).get("/health/storage")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["storage"], "ok")
        self.assertTrue(response.headers.get("x-operation-id"))

    def test_upload_album_accepts_one_and_many_files_with_phase_logging_boundaries(self) -> None:
        """Exercise the active upload route without a live Supabase project."""
        from app.main import app

        settings = SimpleNamespace(
            max_photos=30,
            max_file_size_mb=10,
            max_image_pixels=100_000_000,
            allowed_image_types=frozenset({"image/png"}),
            supabase_private_storage_bucket="woorialbum-private",
            frontend_base_url="https://woorialbum.test",
        )
        png_buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(png_buffer, format="PNG")
        png_bytes = png_buffer.getvalue()
        patches = [
            patch("app.api.album.get_settings", return_value=settings),
            patch("app.api.album.get_supabase_client", return_value=MagicMock()),
            patch("app.api.album.ensure_default_family", return_value="family-1"),
            patch("app.api.album.get_family_membership", return_value={"role": "owner"}),
            patch("app.api.album.get_album_record", return_value=None),
            patch("app.api.album.upload_album_photo_original", side_effect=lambda _client, album_id, photo_id, photo, settings: f"albums/{album_id}/photos/{photo_id}/original.jpg"),
            patch("app.api.album.save_album_record"),
            patch("app.api.album.save_album_photo_records"),
            patch("app.api.album.save_album_media_records"),
            patch("app.api.album.save_album_member"),
            patch("app.api.album.create_share_link", return_value=({}, "share-token")),
            patch("app.api.album.create_generation_job", return_value={"id": "00000000-0000-0000-0000-000000000123", "status": "pending", "progress": 20}),
            patch("app.api.album.run_initial_album_generation"),
        ]
        app.app.dependency_overrides[require_authenticated_user] = lambda: "00000000-0000-0000-0000-000000000111"
        try:
            with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7], patches[8], patches[9], patches[10], patches[11], patches[12]:
                for photo_count in (1, 3):
                    files = [("photos", (f"photo-{index}.png", png_bytes, "image/png")) for index in range(photo_count)]
                    response = TestClient(app, raise_server_exceptions=False).post(
                        "/api/upload-album",
                        files=files,
                        data={
                            "stories": "[" + ",".join(f'{{\"order\":{index},\"user\":\"\",\"text\":\"\"}}' for index in range(photo_count)) + "]",
                            "meeting_type": "friend",
                            "file_meta": "[]",
                        },
                    )
                    self.assertEqual(response.status_code, 202, response.text)
                    self.assertEqual(response.json()["generation_status"], "pending")
        finally:
            app.app.dependency_overrides.pop(require_authenticated_user, None)

        source = (Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        for stage in ("storage_original_upload", "photo_db_insert", "media_db_insert", "album_db_insert", "response_serialization"):
            self.assertIn(f'"{stage}"', source)
