"""Real-behaviour tests for guest-album data hygiene (stateful fake, no source regex).

Every case builds real rows, runs the actual selection/deletion, and asserts on resulting
state — the deletion is destructive, so the safety conditions must be exercised for real.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase

from tests._fake_supabase import FakeSupabase

from app.services import guest_album_cleanup
from app.services.guest_album_cleanup import (
    delete_guest_album,
    find_abandoned_guest_albums,
    find_orphan_storage_albums,
)
from app.services.supabase import delete_abandoned_guest_album

NOW = datetime(2026, 8, 3, tzinfo=timezone.utc)
SETTINGS = SimpleNamespace(
    supabase_private_storage_bucket="momento-private",
    supabase_storage_bucket="albums",
    signed_url_ttl_seconds=3600,
)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def _session(album_id: str, *, expires: datetime | None = None, claimed: str | None = None) -> dict:
    return {
        "id": f"sess-{album_id}",
        "album_id": album_id,
        "token_hash": f"hash-{album_id}",
        "status": "active",
        "expires_at": iso(expires) if expires else iso(NOW - timedelta(days=30)),
        "claimed_profile_id": claimed,
    }


def make_client(albums, sessions, photos=None) -> FakeSupabase:
    return FakeSupabase({
        "albums": albums,
        "guest_album_sessions": sessions,
        "album_photos": photos or [],
    })


LONG_AGO = NOW - timedelta(days=30)  # expired well past the 7-day grace


class FindAbandonedGuestAlbumsTests(TestCase):
    def test_fully_abandoned_album_is_a_candidate_with_stats(self) -> None:
        client = make_client(
            [{"id": "aband-1", "owner_id": None, "created_by": None}],
            [_session("aband-1", expires=LONG_AGO)],
            [
                {"id": "p1", "album_id": "aband-1", "byte_size": 1000, "storage_bucket": "momento-private", "storage_path": "albums/aband-1/photos/p1/original.jpg"},
                {"id": "p2", "album_id": "aband-1", "byte_size": 2000, "storage_bucket": "momento-private", "storage_path": "albums/aband-1/photos/p2/original.jpg"},
            ],
        )
        candidates = find_abandoned_guest_albums(client, now=NOW)
        self.assertEqual([c.album_id for c in candidates], ["aband-1"])
        self.assertEqual(candidates[0].photo_count, 2)
        self.assertEqual(candidates[0].total_bytes, 3000)

    def test_claimed_album_is_excluded(self) -> None:
        client = make_client(
            [{"id": "claimed-1", "owner_id": None, "created_by": None}],
            [_session("claimed-1", expires=LONG_AGO, claimed="user-9")],
        )
        self.assertEqual(find_abandoned_guest_albums(client, now=NOW), [])

    def test_owned_album_is_excluded(self) -> None:
        client = make_client(
            [
                {"id": "owned-1", "owner_id": "user-1", "created_by": None},
                {"id": "created-1", "owner_id": None, "created_by": "user-2"},
            ],
            [_session("owned-1", expires=LONG_AGO), _session("created-1", expires=LONG_AGO)],
        )
        self.assertEqual(find_abandoned_guest_albums(client, now=NOW), [])

    def test_unexpired_session_is_excluded(self) -> None:
        client = make_client(
            [{"id": "live-1", "owner_id": None, "created_by": None}],
            [_session("live-1", expires=NOW + timedelta(hours=5))],
        )
        self.assertEqual(find_abandoned_guest_albums(client, now=NOW), [])

    def test_expired_but_within_grace_is_excluded(self) -> None:
        client = make_client(
            [{"id": "recent-1", "owner_id": None, "created_by": None}],
            [_session("recent-1", expires=NOW - timedelta(days=3))],  # expired, but < 7 days
        )
        self.assertEqual(find_abandoned_guest_albums(client, now=NOW), [])

    def test_album_with_no_sessions_is_excluded(self) -> None:
        client = make_client([{"id": "nosess-1", "owner_id": None, "created_by": None}], [])
        self.assertEqual(find_abandoned_guest_albums(client, now=NOW), [])

    def test_one_unexpired_session_among_many_keeps_the_album(self) -> None:
        client = make_client(
            [{"id": "mixed-1", "owner_id": None, "created_by": None}],
            [
                _session("mixed-1", expires=LONG_AGO),
                {**_session("mixed-1", expires=NOW + timedelta(days=1)), "id": "sess-mixed-1b"},
            ],
        )
        self.assertEqual(find_abandoned_guest_albums(client, now=NOW), [])

    def test_deletion_cap_limits_candidates(self) -> None:
        albums = [{"id": f"a{i}", "owner_id": None, "created_by": None} for i in range(5)]
        sessions = [_session(f"a{i}", expires=LONG_AGO) for i in range(5)]
        client = make_client(albums, sessions)
        self.assertEqual(len(find_abandoned_guest_albums(client, now=NOW, limit=3)), 3)


class DeleteGuestAlbumTests(TestCase):
    def _client(self) -> FakeSupabase:
        return make_client(
            [{"id": "aband-1", "owner_id": None, "created_by": None, "result_path": ""}],
            [_session("aband-1", expires=LONG_AGO)],
            [{"id": "p1", "album_id": "aband-1", "byte_size": 1000, "storage_bucket": "momento-private", "storage_path": "albums/aband-1/photos/p1/original.jpg"}],
        )

    def test_dry_run_deletes_nothing(self) -> None:
        client = self._client()
        calls = []
        originals = (guest_album_cleanup.delete_abandoned_guest_album, guest_album_cleanup.cleanup_album_files)
        # If dry-run wrongly proceeded, these would fire.
        guest_album_cleanup.delete_abandoned_guest_album = lambda c, a: calls.append(("rpc", a)) or True  # type: ignore
        guest_album_cleanup.cleanup_album_files = lambda *a, **k: calls.append(("cleanup",))  # type: ignore
        try:
            result = delete_guest_album(client, SETTINGS, "aband-1", dry_run=True)
        finally:
            guest_album_cleanup.delete_abandoned_guest_album, guest_album_cleanup.cleanup_album_files = originals  # type: ignore
        self.assertFalse(result)
        self.assertEqual(calls, [])
        # Album still present.
        self.assertTrue(any(a["id"] == "aband-1" for a in client.tables["albums"]))

    def test_apply_snapshots_paths_before_deleting(self) -> None:
        client = self._client()
        captured = {}

        def fake_cleanup(c, s, album, *, photo_rows, media_rows, dry_run, remove_album_prefix):
            captured["photo_rows"] = photo_rows
            captured["dry_run"] = dry_run
            captured["album_gone"] = not any(a["id"] == "aband-1" for a in client.tables["albums"])

        original = guest_album_cleanup.cleanup_album_files
        guest_album_cleanup.cleanup_album_files = fake_cleanup  # type: ignore
        try:
            result = delete_guest_album(client, SETTINGS, "aband-1", dry_run=False)
        finally:
            guest_album_cleanup.cleanup_album_files = original  # type: ignore

        self.assertTrue(result)
        # Paths were snapshotted (non-empty) and handed to cleanup with real deletion on.
        self.assertEqual(len(captured["photo_rows"]), 1)
        self.assertEqual(captured["photo_rows"][0]["storage_path"], "albums/aband-1/photos/p1/original.jpg")
        self.assertFalse(captured["dry_run"])
        # The DB rows were already gone by the time storage cleanup ran (snapshot-first).
        self.assertTrue(captured["album_gone"])

    def test_apply_refuses_an_owned_album_even_if_asked(self) -> None:
        client = make_client(
            [{"id": "owned-9", "owner_id": "user-1", "created_by": None, "result_path": ""}],
            [],
        )
        result = delete_guest_album(client, SETTINGS, "owned-9", dry_run=False)
        self.assertFalse(result)
        self.assertTrue(any(a["id"] == "owned-9" for a in client.tables["albums"]))


class RpcGuardTests(TestCase):
    def test_rpc_refuses_a_live_session_album_even_when_called_directly(self) -> None:
        # Assume a caller bypassed the Python selection guard and handed the RPC a guest
        # album that still has a live (unexpired) session. The SQL invariant must refuse.
        far_future = datetime(2999, 1, 1, tzinfo=timezone.utc)
        client = make_client(
            [{"id": "live-9", "owner_id": None, "created_by": None}],
            [_session("live-9", expires=far_future)],
        )
        result = delete_abandoned_guest_album(client, "live-9")
        self.assertFalse(result)
        self.assertTrue(any(a["id"] == "live-9" for a in client.tables["albums"]))
        self.assertTrue(any(s["album_id"] == "live-9" for s in client.tables["guest_album_sessions"]))


class _FakeStorage:
    def __init__(self, listing: dict[str, list[str]]):
        self._listing = listing
        self.deleted: list[tuple[str, list[str]]] = []

    def list_recursive(self, bucket: str, prefix: str):
        pfx = prefix.strip("/")
        return [{"path": p} for p in self._listing.get(bucket, []) if p.startswith(pfx)]

    def delete(self, bucket: str, paths):
        self.deleted.append((bucket, sorted(paths)))


class OrphanStorageTests(TestCase):
    def test_live_album_objects_are_not_flagged_as_orphans(self) -> None:
        client = make_client([{"id": "live-1", "owner_id": None, "created_by": None}], [])
        storage = _FakeStorage({
            "momento-private": [
                "albums/live-1/photos/p1/original.jpg",   # live album -> not orphan
                "albums/orphan-9/photos/p2/original.jpg",  # no album row -> orphan
                "albums/orphan-9/results/r.png",
            ],
        })
        orphans = find_orphan_storage_albums(client, SETTINGS, storage=storage, buckets=["momento-private"])
        self.assertEqual([(o.album_id, o.object_count) for o in orphans], [("orphan-9", 2)])


class CliModeBFlagTests(TestCase):
    """Mode B must never delete on --apply alone; it needs --delete-orphan-objects too."""

    def _run(self, argv):
        from app.services import guest_album_cleanup as svc
        client = make_client([{"id": "live-1", "owner_id": None, "created_by": None}], [])
        storage = _FakeStorage({
            "momento-private": ["albums/orphan-9/photos/p/original.jpg"],
            "albums": [],
        })
        stub = SimpleNamespace(for_supabase=lambda c, s: storage)
        import scripts.cleanup_guest_albums as cli
        originals = (cli.get_settings, cli.get_supabase_client, svc.StorageService)
        cli.get_settings = lambda: SETTINGS  # type: ignore
        cli.get_supabase_client = lambda settings=None: client  # type: ignore
        svc.StorageService = stub  # type: ignore
        try:
            cli.main(argv)
        finally:
            cli.get_settings, cli.get_supabase_client, svc.StorageService = originals  # type: ignore
        return storage

    def test_apply_without_extra_flag_does_not_delete_orphans(self) -> None:
        storage = self._run(["--apply"])
        self.assertEqual(storage.deleted, [])

    def test_apply_with_extra_flag_deletes_orphans(self) -> None:
        storage = self._run(["--apply", "--delete-orphan-objects"])
        self.assertEqual(len(storage.deleted), 1)
        self.assertEqual(storage.deleted[0][0], "momento-private")
