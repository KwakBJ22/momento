from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app.api.guest import router
from app.services.analytics_service import insert_analytics_event


class AnalyticsServiceTests(TestCase):
    def test_insert_omits_null_foreign_keys(self) -> None:
        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table
        table.insert.return_value.execute.return_value = None

        ok = insert_analytics_event(client, "landing_viewed", metadata={"source": "guest_onboarding", "ignored": "x"})
        self.assertTrue(ok)
        row = table.insert.call_args.args[0]
        self.assertEqual(row["event_name"], "landing_viewed")
        self.assertEqual(row["metadata"], {"source": "guest_onboarding"})
        self.assertNotIn("album_id", row)
        self.assertNotIn("share_link_id", row)

    def test_insert_logs_api_error_without_raising(self) -> None:
        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table
        table.insert.return_value.execute.side_effect = APIError(
            {"message": "new row violates check constraint", "code": "23514", "details": "event_name", "hint": None}
        )

        ok = insert_analytics_event(client, "landing_viewed")
        self.assertFalse(ok)


class GuestAnalyticsEndpointTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.mock_db = MagicMock()

    def test_guest_analytics_returns_202_on_insert_failure(self) -> None:
        with patch("app.api.guest.get_settings", return_value=SimpleNamespace()), patch(
            "app.api.guest.get_supabase_client", return_value=self.mock_db
        ), patch("app.api.guest.log_event", return_value=False):
            response = self.client.post("/api/guest-analytics", json={"event_name": "landing_viewed"})

        self.assertEqual(response.status_code, 202)

    def test_guest_analytics_returns_202_on_success(self) -> None:
        with patch("app.api.guest.get_settings", return_value=SimpleNamespace()), patch(
            "app.api.guest.get_supabase_client", return_value=self.mock_db
        ), patch("app.api.guest.log_event", return_value=True):
            response = self.client.post("/api/guest-analytics", json={"event_name": "preview_viewed"})

        self.assertEqual(response.status_code, 202)

    def test_guest_analytics_rejects_unknown_event(self) -> None:
        response = self.client.post("/api/guest-analytics", json={"event_name": "unknown_event"})
        self.assertEqual(response.status_code, 422)
