from unittest.mock import MagicMock, patch
from pathlib import Path
from fastapi.security import HTTPAuthorizationCredentials

from app.models.current_user import CurrentUser
from app.services.auth import require_authenticated_user, require_current_user


def test_current_user_maps_verified_supabase_identity_to_application_contract() -> None:
    client = MagicMock()
    client.auth.get_user.return_value.user = MagicMock(
        id="4d642045-92f1-4d1a-bd9a-53be41bb234e",
        email="family@example.com",
        phone=None,
        app_metadata={"provider": "kakao"},
    )
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="verified-token")

    with patch("app.services.auth.get_supabase_client", return_value=client):
        current_user = require_current_user(credentials)

    assert current_user == CurrentUser(
        id="4d642045-92f1-4d1a-bd9a-53be41bb234e",
        provider="kakao",
        email="family@example.com",
        phone=None,
    )


def test_album_services_receive_only_the_verified_user_id() -> None:
    current_user = CurrentUser(id="owner-id", provider="naver", email=None, phone=None)

    assert require_authenticated_user(current_user) == "owner-id"


def test_social_profile_migration_never_overwrites_user_selected_profile_values() -> None:
    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "20260727090000_social_auth_profiles.sql"
    ).read_text(encoding="utf-8")

    assert "ON CONFLICT (id) DO NOTHING" in migration
    assert "avatar_url = COALESCE(" in migration
    assert "display_name =" not in migration.split("UPDATE public.profiles AS profile", 1)[1]
