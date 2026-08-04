"""Admin access without an email (Kakao no longer provides one)."""
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services import auth


def _settings(ids=(), emails=()):
    # require_platform_admin only reads these two properties + get_supabase_client.
    return SimpleNamespace(
        platform_admin_user_id_set=frozenset(ids),
        platform_admin_email_set=frozenset(emails),
    )


class PlatformAdminAuthTests(TestCase):
    def test_user_id_allowlist_grants_without_any_email_lookup(self):
        with patch.object(auth, "get_supabase_client") as get_client:
            result = auth.require_platform_admin(user_id="admin-1", settings=_settings(ids=["admin-1"]))
        self.assertEqual(result, "admin-1")
        get_client.assert_not_called()  # no email needed at all

    def test_missing_email_denies_with_403_not_400(self):
        # An emailless account not on the id allowlist is denied — but never with the old
        # 400 "does not have an email address" that broke every admin login.
        client = MagicMock()
        client.auth.admin.get_user_by_id.return_value = SimpleNamespace(user=SimpleNamespace(email=None))
        with patch.object(auth, "get_supabase_client", return_value=client):
            with self.assertRaises(HTTPException) as ctx:
                auth.require_platform_admin(user_id="nobody", settings=_settings(emails=["you@example.com"]))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_email_allowlist_still_works_when_the_account_has_an_email(self):
        client = MagicMock()
        client.auth.admin.get_user_by_id.return_value = SimpleNamespace(user=SimpleNamespace(email="You@Example.com"))
        with patch.object(auth, "get_supabase_client", return_value=client):
            result = auth.require_platform_admin(user_id="someone", settings=_settings(emails=["you@example.com"]))
        self.assertEqual(result, "someone")  # case-insensitive match

    def test_unconfigured_console_denies(self):
        with self.assertRaises(HTTPException) as ctx:
            auth.require_platform_admin(user_id="x", settings=_settings())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_optional_user_email_returns_none_instead_of_raising(self):
        client = MagicMock()
        client.auth.admin.get_user_by_id.return_value = SimpleNamespace(user=SimpleNamespace(email=None))
        self.assertIsNone(auth._optional_user_email(client, "u"))
        client.auth.admin.get_user_by_id.side_effect = Exception("boom")
        self.assertIsNone(auth._optional_user_email(client, "u"))
