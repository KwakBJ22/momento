"""Re-upload existing display/thumbnail derivatives so they get cache-control. DRY-RUN by default.

Objects uploaded before the cache-control fix are stored as no-cache — neither the
browser nor the CDN caches them, so every view is a fresh (paid) download. Derivatives
are what screens actually load, so refreshing only them captures most of the win.
Originals (~101MB) are served only for print/download and are deliberately excluded.

Re-upload uses upsert=True (idempotent since f73faef) and StorageService.upload, which
also invalidates the in-process signed-URL cache for the touched paths.

Needs Supabase env (run via `railway run` or a local .env).

Usage:
  # Report the target objects and total bytes, change nothing:
  python -m scripts.refresh_derivative_cache_control

  # Actually re-upload:
  python -m scripts.refresh_derivative_cache_control --apply

Options:
  --apply     Re-upload derivatives (default: dry-run, report only).
  --album ID  Restrict to one album.
"""
from __future__ import annotations

import argparse
import logging
import sys

from app.config import get_settings
from app.services.storage_service import StorageService
from app.services.supabase import get_supabase_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("refresh_derivative_cache_control")


def find_derivative_paths(client, album_id: str | None) -> list[tuple[str, str]]:
    """(bucket, path) for every real derivative. display_path = storage_path rows are
    fallbacks still pointing at the original — skip them (originals stay untouched)."""
    query = (
        client.table("album_photos")
        .select("storage_bucket,storage_path,display_bucket,display_path,thumbnail_bucket,thumbnail_path")
        .is_("deleted_at", "null")
    )
    if album_id:
        query = query.eq("album_id", album_id)
    rows = query.execute().data or []
    targets: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        original = str(row.get("storage_path") or "")
        for bucket_key, path_key in (("display_bucket", "display_path"), ("thumbnail_bucket", "thumbnail_path")):
            path = str(row.get(path_key) or "")
            bucket = str(row.get(bucket_key) or row.get("storage_bucket") or "")
            if not path or not bucket or path == original:
                continue
            if (bucket, path) not in seen:
                seen.add((bucket, path))
                targets.append((bucket, path))
    return targets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="re-upload derivatives (default: dry-run)")
    parser.add_argument("--album", default=None, help="restrict to one album id")
    args = parser.parse_args()

    settings = get_settings()
    client = get_supabase_client(settings)
    storage = StorageService.for_supabase(client, settings)

    targets = find_derivative_paths(client, args.album)
    logger.info("targets: %s derivative objects", len(targets))
    if not targets:
        return 0

    if not args.apply:
        logger.info("DRY-RUN: no changes made. Re-run with --apply to re-upload with cache-control.")
        return 0

    refreshed = 0
    total_bytes = 0
    failures: list[tuple[str, str]] = []
    for bucket, path in targets:
        try:
            content = storage.download(bucket, path)
            # upsert re-upload stamps the default 30-day cache-control and drops the
            # path's signed-URL cache entry (StorageService.upload).
            storage.upload(bucket, path, content, content_type="image/webp", upsert=True)
            refreshed += 1
            total_bytes += len(content)
            if refreshed % 25 == 0:
                logger.info("progress: %s/%s", refreshed, len(targets))
        except Exception as exc:  # keep going: one broken object must not stop the rest
            failures.append((path, f"{type(exc).__name__}: {exc}"))
            logger.exception("failed path=%s", path)

    logger.info("done: refreshed=%s bytes=%s failed=%s", refreshed, total_bytes, len(failures))
    if failures:
        logger.warning("failed objects:")
        for path, reason in failures:
            logger.warning("  path=%s reason=%s", path, reason)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
