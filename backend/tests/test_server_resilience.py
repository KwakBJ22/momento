from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.supabase import get_result_signed_url, get_signed_url, save_album_record
from app.services.event_logger import EventLogger


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
            result_bucket="momento-private",
        )

        self.assertNotIn("result_bucket", saved)
        first_record = table.insert.call_args_list[0].args[0]
        second_record = table.insert.call_args_list[1].args[0]
        self.assertEqual(first_record["result_bucket"], "momento-private")
        self.assertNotIn("result_bucket", second_record)

    def test_signed_url_failure_returns_empty_value_instead_of_raising(self) -> None:
        with patch("app.services.supabase.StorageService.for_supabase", side_effect=RuntimeError("bucket unavailable")):
            self.assertEqual(get_signed_url(MagicMock(), "momento-private", "albums/a/photo.jpg", 300), "")

    def test_legacy_result_without_bucket_prefers_private_signed_url(self) -> None:
        settings = SimpleNamespace(
            supabase_private_storage_bucket="momento-private",
            supabase_storage_bucket="albums",
            signed_url_ttl_seconds=300,
        )
        with patch("app.services.supabase.get_signed_url", side_effect=["private-url"] ) as signed:
            url = get_result_signed_url(MagicMock(), {"result_path": "albums/a/results/r.png"}, settings)
        self.assertEqual(url, "private-url")
        self.assertEqual(signed.call_args.args[1], "momento-private")

    def test_event_logger_failure_is_best_effort(self) -> None:
        client = MagicMock()
        client.table.return_value.insert.return_value.execute.side_effect = RuntimeError("analytics unavailable")

        self.assertFalse(EventLogger.record(client, "album_created", album_id="album-1"))


class ApiOperationHeaderTests(TestCase):
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
