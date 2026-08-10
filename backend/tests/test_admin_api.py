from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.admin import router
from app.services.auth import require_platform_admin


ADMIN_ID = "11111111-1111-1111-1111-111111111111"


class AdminApiTests(TestCase):
    def setUp(self) -> None:
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_platform_admin] = lambda: ADMIN_ID
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def test_admin_me_requires_override(self) -> None:
        bare_app = FastAPI()
        bare_app.include_router(router)
        client = TestClient(bare_app, raise_server_exceptions=False)
        response = client.get("/api/admin/me")
        self.assertEqual(response.status_code, 401)

    def test_admin_me_ok(self) -> None:
        response = self.client.get("/api/admin/me")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user_id"], ADMIN_ID)

    def test_admin_me_says_which_data_it_is_looking_at(self) -> None:
        """★ /admin 에는 앨범 삭제 버튼이 있고, 개발과 운영 화면이 똑같이 생겼다.

        헷갈려서 운영 앨범을 지우면 되돌릴 수 없다. 그래서 **서버가** 어디인지 말해 준다.
        화면이 주소로 짐작하지 않는다 — 주소는 바뀌고, 판정 근거는 하나여야 한다(§10).
        """
        with patch("app.api.admin.get_settings", return_value=SimpleNamespace(deployment_environment="development")):
            response = self.client.get("/api/admin/me")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["environment"], "development")

        with patch("app.api.admin.get_settings", return_value=SimpleNamespace(deployment_environment="production")):
            response = self.client.get("/api/admin/me")
        self.assertEqual(response.json()["environment"], "production")

    def test_admin_dashboard_returns_payload(self) -> None:
        payload = {
            "today": {"new_users": 1, "new_albums": 2, "new_pages": 0, "new_editions": 0, "share_count": 0, "pdf_generated": 0, "new_memories": 0},
            "totals": {"users": 10, "albums": 5, "photos": 20, "memories": 3, "shares": 4, "pdf_generated": 1},
            "trends": {"new_albums": [{"date": "2026-07-24", "value": 1}], "share_views": [], "new_memories": []},
        }
        with patch("app.api.admin.get_settings", return_value=SimpleNamespace()), patch(
            "app.api.admin.get_supabase_client", return_value=MagicMock()
        ), patch("app.api.admin.build_ops_dashboard", return_value=payload):
            response = self.client.get("/api/admin/dashboard")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["totals"]["albums"], 5)

    def test_missing_display_photo_count_compares_paths(self) -> None:
        # KPI: display_path = storage_path means the screen serves the ~1MB original.
        from app.services.admin_kpi_service import count_missing_display_photos

        client = MagicMock()
        client.table.return_value.select.return_value.is_.return_value.limit.return_value.execute.return_value.data = [
            {"storage_path": "a/original.jpg", "display_path": "a/original.jpg"},   # fallback
            {"storage_path": "b/original.jpg", "display_path": "b/display.webp"},  # healthy
            {"storage_path": "c/original.jpg", "display_path": None},              # no display yet
        ]
        self.assertEqual(count_missing_display_photos(client), 1)

    def test_admin_growth_ok(self) -> None:
        payload = {
            "living_album": {"living_album_ratio": 50.0, "avg_album_lifetime_days": 10.0, "avg_page_append_count": 1.0, "avg_edition_count": 0.5},
            "collaboration": {"avg_participants_per_album": 2.0, "avg_added_photos": 1.0, "avg_added_memories": 0.5, "participation_rate": 40.0},
            "viral": {"share_count": 3, "share_to_new_users": 1, "share_to_new_albums": 2, "viral_conversion_rate": 5.0},
            "retention": {"return_visit_7d_rate": 10.0, "return_visit_30d_rate": 5.0, "reopened_album_ratio": 20.0},
            "content": {"total_photos": 9, "total_memories": 4, "total_pages": 2, "total_editions": 1},
        }
        with patch("app.api.admin.get_settings", return_value=SimpleNamespace()), patch(
            "app.api.admin.get_supabase_client", return_value=MagicMock()
        ), patch("app.api.admin.build_growth_dashboard", return_value=payload):
            response = self.client.get("/api/admin/growth")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["living_album"]["living_album_ratio"], 50.0)
