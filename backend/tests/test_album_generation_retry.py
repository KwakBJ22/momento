from unittest.mock import MagicMock

from app.models.album_photo_status import (
    ALBUM_PHOTO_FAILED,
    ALBUM_PHOTO_READY,
    ALBUM_PHOTO_UPLOADING,
    is_ready_album_photo,
)
from app.services.album_generation_service import has_current_generation_photos


def _generation_photo_client(*, status: str) -> tuple[MagicMock, MagicMock, MagicMock]:
    client = MagicMock()
    photos_table = MagicMock()
    media_table = MagicMock()
    photos_query = MagicMock()
    media_query = MagicMock()
    photos_table.select.return_value = photos_query
    media_table.select.return_value = media_query
    client.table.side_effect = lambda name: photos_table if name == "album_photos" else media_table

    for query in (photos_query, media_query):
        query.eq.return_value = query
        query.in_.return_value = query
        query.is_.return_value = query
        query.order.return_value = query
    photos_query.execute.return_value.data = [{"id": "photo-1", "status": status}]
    media_query.execute.return_value.data = []
    return client, photos_table, photos_query


def test_retry_accepts_existing_original_saved_with_legacy_uploading_status() -> None:
    """A failed job must retry from its persisted original photo, not return 422."""
    client, photos_table, photos_query = _generation_photo_client(status="uploading")

    assert has_current_generation_photos(client, "album-1") is True
    photos_query.eq.assert_any_call("status", ALBUM_PHOTO_READY)
    photos_table.update.assert_called_once_with({"status": ALBUM_PHOTO_READY})


def test_retry_accepts_ready_photo() -> None:
    client, _, _ = _generation_photo_client(status="ready")

    assert has_current_generation_photos(client, "album-1") is True


def test_only_ready_photos_are_generation_and_rebuild_inputs() -> None:
    assert not is_ready_album_photo({"status": ALBUM_PHOTO_UPLOADING})
    assert is_ready_album_photo({"status": ALBUM_PHOTO_READY})
    assert not is_ready_album_photo({"status": ALBUM_PHOTO_FAILED})
    assert not is_ready_album_photo({"status": ALBUM_PHOTO_READY, "deleted_at": "2026-07-30T00:00:00Z"})
