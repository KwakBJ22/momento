"""Rebuild missing display/thumbnail derivatives. DRY-RUN by default.

Some photos ended up with display_path = storage_path (the ~1MB original is served to
every screen) because the generation worker's per-photo fallback swallowed transient
failures (observed: RemoteProtocolError against Supabase Storage). This backfill re-runs
the exact same derivative pipeline (_process_single_photo) for those rows only.

Needs Supabase env (run via `railway run` or a local .env).

Usage:
  # Report the affected photos and the estimated bytes saved, change nothing:
  python -m scripts.backfill_photo_derivatives

  # Actually rebuild derivatives:
  python -m scripts.backfill_photo_derivatives --apply

Options:
  --apply     Rebuild derivatives (default: dry-run, report only).
  --album ID  Restrict to one album.
"""
from __future__ import annotations

import argparse
import logging
import sys

from app.config import get_settings
from app.services.album_generation_service import _process_single_photo
from app.services.supabase import get_supabase_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_photo_derivatives")

# The worker's display target is ~0.3MB webp vs ~1MB original; used only for the
# dry-run "estimated recovered bytes" report, not for any decision.
_ESTIMATED_DISPLAY_RATIO = 0.3


def find_fallback_photos(client, album_id: str | None) -> list[dict]:
    query = (
        client.table("album_photos")
        .select("id,album_id,storage_bucket,storage_path,display_path,mime_type,width,height")
        .is_("deleted_at", "null")
    )
    if album_id:
        query = query.eq("album_id", album_id)
    rows = query.execute().data or []
    # display_path = storage_path is the fallback signature (PostgREST cannot compare
    # two columns server-side, so filter here).
    return [row for row in rows if row.get("display_path") and row.get("display_path") == row.get("storage_path")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="rebuild derivatives (default: dry-run)")
    parser.add_argument("--album", default=None, help="restrict to one album id")
    args = parser.parse_args()

    settings = get_settings()
    client = get_supabase_client(settings)

    targets = find_fallback_photos(client, args.album)
    if not targets:
        logger.info("no photos with display_path = storage_path — nothing to do")
        return 0

    by_album: dict[str, int] = {}
    for row in targets:
        by_album[str(row["album_id"])] = by_album.get(str(row["album_id"]), 0) + 1
    logger.info("targets: %s photos across %s albums", len(targets), len(by_album))
    for album, count in sorted(by_album.items()):
        logger.info("  album=%s photos=%s", album, count)

    if not args.apply:
        logger.info(
            "DRY-RUN: no changes made. Estimated per-view savings ~%.0f%% of original size "
            "(display webp vs original). Re-run with --apply to rebuild.",
            (1 - _ESTIMATED_DISPLAY_RATIO) * 100,
        )
        return 0

    rebuilt = 0
    failures: list[tuple[str, str, str]] = []
    for row in targets:
        photo_id = str(row["id"])
        album_id = str(row["album_id"])
        try:
            # Reuse the worker's pipeline verbatim: download original -> build display
            # webp + thumbnail -> upload -> update album_photos/album_media rows.
            result = _process_single_photo(client, settings, album_id, row)
            if result.fallback_used:
                # The pipeline fell back again — the row is unchanged (still original).
                failures.append((album_id, photo_id, "fallback_again"))
                logger.warning("photo %s fell back again (see derivative_fallback log above)", photo_id)
            else:
                rebuilt += 1
                logger.info(
                    "rebuilt photo=%s album=%s original=%sB display=%sB",
                    photo_id, album_id, result.original_bytes, result.display_bytes,
                )
        except Exception as exc:  # keep going: one broken photo must not stop the rest
            failures.append((album_id, photo_id, f"{type(exc).__name__}: {exc}"))
            logger.exception("photo %s failed", photo_id)

    logger.info("done: rebuilt=%s failed=%s", rebuilt, len(failures))
    if failures:
        logger.warning("failed photos:")
        for album_id, photo_id, reason in failures:
            logger.warning("  album=%s photo=%s reason=%s", album_id, photo_id, reason)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
