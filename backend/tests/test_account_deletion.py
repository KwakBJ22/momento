from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.services import account_service
from app.services.auth import require_authenticated_user
from tests._fake_supabase import FakeSupabase


_FAKE_SETTINGS = SimpleNamespace(
    supabase_private_storage_bucket="woorialbum-private",
    supabase_storage_bucket="albums",
    signed_url_ttl_seconds=3600,
)


def _table_client() -> tuple[MagicMock, dict[str, MagicMock]]:
    tables: dict[str, MagicMock] = {}
    client = MagicMock()

    def table(name: str) -> MagicMock:
        return tables.setdefault(name, MagicMock())

    client.table.side_effect = table
    return client, tables


def test_withdrawal_also_finds_albums_that_were_already_marked_deleted():
    client, tables = _table_client()
    query = tables.setdefault("albums", MagicMock()).select.return_value
    query.or_.return_value.execute.return_value = MagicMock(data=[{"id": "album-1"}])

    assert account_service.list_all_owned_album_ids(client, "user-1") == ["album-1"]
    # A `deleted_at is null` filter here would strand albums whose created_by
    # still references the profile with ON DELETE RESTRICT.
    query.or_.return_value.is_.assert_not_called()


def test_owned_albums_snapshot_assets_before_the_cascade_and_clean_storage_after():
    client = MagicMock()
    settings = MagicMock()
    calls: list[str] = []

    with (
        patch.object(account_service, "list_all_owned_album_ids", return_value=["album-1"]),
        patch.object(account_service, "get_album_record", return_value={"id": "album-1"}),
        patch.object(
            account_service, "get_album_photo_asset_records",
            side_effect=lambda *_: (calls.append("photos"), [{"storage_path": "a.jpg"}])[1],
        ),
        patch.object(
            account_service, "get_album_media_asset_records",
            side_effect=lambda *_: (calls.append("media"), [])[1],
        ),
        patch.object(
            account_service, "delete_album_cascade",
            side_effect=lambda *_: (calls.append("cascade"), True)[1],
        ),
        patch.object(
            account_service, "cleanup_album_files",
            side_effect=lambda *a, **k: (calls.append("cleanup"), {})[1],
        ) as cleanup,
    ):
        deleted = account_service.delete_owned_albums(client, settings, "user-1")

    assert deleted == 1
    # Storage paths must be read while the rows still exist, and removed only
    # after the database transaction succeeded.
    assert calls == ["photos", "media", "cascade", "cleanup"]
    assert cleanup.call_args.kwargs["dry_run"] is False
    assert cleanup.call_args.kwargs["photo_rows"] == [{"storage_path": "a.jpg"}]


def test_an_album_that_fails_the_authorized_cascade_keeps_its_storage_objects():
    client = MagicMock()
    settings = MagicMock()

    with (
        patch.object(account_service, "list_all_owned_album_ids", return_value=["album-1"]),
        patch.object(account_service, "get_album_record", return_value={"id": "album-1"}),
        patch.object(account_service, "get_album_photo_asset_records", return_value=[]),
        patch.object(account_service, "get_album_media_asset_records", return_value=[]),
        patch.object(account_service, "delete_album_cascade", return_value=False),
        patch.object(account_service, "cleanup_album_files") as cleanup,
    ):
        deleted = account_service.delete_owned_albums(client, settings, "user-1")

    assert deleted == 0
    cleanup.assert_not_called()


def test_an_album_removed_between_listing_and_deletion_does_not_fail_withdrawal():
    client = MagicMock()
    settings = MagicMock()

    with (
        patch.object(account_service, "list_all_owned_album_ids", return_value=["gone", "album-1"]),
        patch.object(account_service, "get_album_record", side_effect=[None, {"id": "album-1"}]),
        patch.object(account_service, "get_album_photo_asset_records", return_value=[]),
        patch.object(account_service, "get_album_media_asset_records", return_value=[]),
        patch.object(account_service, "delete_album_cascade", return_value=True),
        patch.object(account_service, "cleanup_album_files", return_value={}),
    ):
        assert account_service.delete_owned_albums(client, settings, "user-1") == 1


def test_names_copied_into_other_albums_are_cleared_without_removing_the_memory():
    client, tables = _table_client()

    account_service.anonymize_authored_names(client, "user-1")

    contributors = tables["album_contributors"]
    memories = tables["photo_memories"]
    contributors.delete.assert_not_called()
    memories.delete.assert_not_called()
    assert contributors.update.call_args.args[0]["display_name"] == account_service.WITHDRAWN_DISPLAY_NAME
    contributors.update.return_value.eq.assert_called_once_with("user_id", "user-1")
    assert memories.update.call_args.args[0]["author_name"] == account_service.WITHDRAWN_DISPLAY_NAME
    memories.update.return_value.eq.assert_called_once_with("author_id", "user-1")


def test_profile_removal_uses_the_authorized_cascade_rpc():
    client = MagicMock()
    client.rpc.return_value.execute.return_value = MagicMock(data=True)

    assert account_service.delete_profile_cascade(client, "user-1") is True
    client.rpc.assert_called_once_with("delete_profile_cascade", {"p_profile_id": "user-1"})


def test_withdrawal_hard_deletes_the_login_identity():
    client = MagicMock()

    account_service.delete_auth_user(client, "user-1")

    # A soft delete would leave the email address inside auth.users.
    client.auth.admin.delete_user.assert_called_once_with("user-1")
    assert "should_soft_delete" not in client.auth.admin.delete_user.call_args.kwargs


def test_withdrawal_removes_albums_and_names_before_it_removes_the_profile():
    client = MagicMock()
    settings = MagicMock()
    order: list[str] = []

    with (
        patch.object(account_service, "delete_owned_albums", side_effect=lambda *_: (order.append("albums"), 2)[1]),
        patch.object(account_service, "anonymize_authored_names", side_effect=lambda *_: order.append("names")),
        patch.object(account_service, "delete_profile_cascade", side_effect=lambda *_: (order.append("profile"), True)[1]),
        patch.object(account_service, "delete_auth_user", side_effect=lambda *_: order.append("auth")),
    ):
        result = account_service.delete_account(client, settings, "user-1")

    assert result == {"albums_deleted": 2}
    # Names must be cleared while the rows can still be found by profile id,
    # and the auth user can only go after the profile row is gone.
    assert order == ["albums", "names", "profile", "auth"]


def test_a_blocked_profile_deletion_keeps_the_login_identity():
    client = MagicMock()
    settings = MagicMock()

    with (
        patch.object(account_service, "delete_owned_albums", return_value=0),
        patch.object(account_service, "anonymize_authored_names"),
        patch.object(account_service, "delete_profile_cascade", return_value=False),
        patch.object(account_service, "delete_auth_user") as delete_auth,
    ):
        with pytest.raises(RuntimeError):
            account_service.delete_account(client, settings, "user-1")

    delete_auth.assert_not_called()


# --- Regression: a signed-in participant withdrawing (the 23514 crash) ---------------

def test_signed_in_participant_withdraws_and_leaves_contributions_behind():
    """The exact regression: a user who joined someone else's album while logged in has an
    album_contributors row with user_id set + guest_id NULL. Withdrawal must succeed, remove
    that roster row, and keep their photo/memory in the album with the author cleared."""
    user = "11111111-1111-1111-1111-111111111111"
    client = FakeSupabase({
        "profiles": [{"id": user, "display_name": "참여자"}],
        # Album owned by someone else — the user only participated.
        "albums": [{"id": "album-x", "owner_id": "owner-9", "created_by": "owner-9"}],
        "album_contributors": [
            {"id": "c1", "album_id": "album-x", "user_id": user, "guest_id": None, "status": "active", "display_name": "참여자"},
        ],
        "album_photos": [{"id": "p1", "album_id": "album-x", "contributor_profile_id": user}],
        "photo_memories": [{"id": "m1", "album_id": "album-x", "author_id": user, "author_name": "참여자"}],
    })

    result = account_service.delete_account(client, _FAKE_SETTINGS, user)

    assert result == {"albums_deleted": 0}
    # The roster row is gone (would otherwise violate the identity CHECK when user_id -> NULL).
    assert client.tables["album_contributors"] == []
    # The photo and memory stay in the album; only the author link is cleared.
    assert len(client.tables["album_photos"]) == 1
    assert client.tables["album_photos"][0]["contributor_profile_id"] is None
    assert len(client.tables["photo_memories"]) == 1
    assert client.tables["photo_memories"][0]["author_id"] is None
    # Profile and login identity are removed.
    assert client.tables["profiles"] == []
    assert user in client.deleted_auth_users


def test_user_with_no_participation_still_withdraws_normally():
    user = "22222222-2222-2222-2222-222222222222"
    client = FakeSupabase({"profiles": [{"id": user, "display_name": "홀로"}], "albums": []})
    result = account_service.delete_account(client, _FAKE_SETTINGS, user)
    assert result == {"albums_deleted": 0}
    assert client.tables["profiles"] == []
    assert user in client.deleted_auth_users


def test_withdrawal_endpoint_returns_409_not_500_on_unexpected_db_error():
    """Even an unanticipated DB error must reach the user as a clear, retryable 409 (so the
    modal can be closed) rather than a bare 500 the frontend can only re-open."""
    app = FastAPI()
    app.include_router(auth_router)
    app.dependency_overrides[require_authenticated_user] = lambda: "user-1"
    client = TestClient(app, raise_server_exceptions=False)
    with patch("app.api.auth.get_supabase_client"), patch(
        "app.api.auth.delete_account", side_effect=Exception('violates check constraint "album_contributors_identity_check"')
    ):
        response = client.delete("/api/auth/account")
    assert response.status_code == 409
    assert "다시 시도" in response.json()["detail"]
