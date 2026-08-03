"""Data-hygiene CLI for guest albums. DRY-RUN by default — deletes nothing without --apply.

Needs Supabase env (run via `railway run`). Deletion order matches account withdrawal:
snapshot asset paths -> DB cascade (delete_abandoned_guest_album) -> Storage cleanup.

Usage:
  # Mode A (abandoned guest albums) + Mode B (orphan storage) report, delete nothing:
  python -m scripts.cleanup_guest_albums

  # Actually delete abandoned guest albums (up to --limit), Mode B still report-only:
  python -m scripts.cleanup_guest_albums --apply

  # Also delete orphan Storage objects (requires BOTH flags — irrecoverable):
  python -m scripts.cleanup_guest_albums --apply --delete-orphan-objects

Options:
  --apply                  Perform Mode A deletions (default: dry-run, report only).
  --limit N                Max albums deleted in one run (default: 100).
  --grace-days N           Days after last session expiry before deletable (default: 7).
  --delete-orphan-objects  With --apply, also delete Mode B orphan objects.
  --skip-orphan-scan       Skip Mode B entirely (it lists all album storage objects).
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone

from app.config import get_settings
from app.services.guest_album_cleanup import (
    ABANDON_GRACE_DAYS,
    DEFAULT_DELETE_LIMIT,
    delete_guest_album,
    delete_orphan_storage_prefix,
    find_abandoned_guest_albums,
    find_orphan_storage_albums,
)
from app.services.supabase import get_supabase_client

logger = logging.getLogger("cleanup_guest_albums")


def _human_bytes(total: int) -> str:
    value = float(total)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{value:.1f}GB"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Clean up abandoned guest albums and orphan storage.")
    parser.add_argument("--apply", action="store_true", help="Perform Mode A deletions (default: dry-run).")
    parser.add_argument("--limit", type=int, default=DEFAULT_DELETE_LIMIT, help="Max albums deleted per run.")
    parser.add_argument("--grace-days", type=int, default=ABANDON_GRACE_DAYS, help="Days after last expiry.")
    parser.add_argument("--delete-orphan-objects", action="store_true", help="With --apply, delete Mode B orphans.")
    parser.add_argument("--skip-orphan-scan", action="store_true", help="Skip Mode B orphan scan.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    client = get_supabase_client(settings)
    now = datetime.now(timezone.utc)
    dry_run = not args.apply

    print(f"== Guest album cleanup ({'DRY-RUN' if dry_run else 'APPLY'}) ==")
    print(f"limit={args.limit} grace_days={args.grace_days}\n")

    # --- Mode A: abandoned guest albums ---------------------------------------
    candidates = find_abandoned_guest_albums(client, now=now, grace_days=args.grace_days, limit=args.limit)
    print(f"[Mode A] abandoned guest albums: {len(candidates)} (cap {args.limit})")
    total_photos = sum(c.photo_count for c in candidates)
    total_bytes = sum(c.total_bytes for c in candidates)
    for candidate in candidates:
        print(
            f"  - {candidate.album_id[:6]}  photos={candidate.photo_count:>3}  "
            f"size={_human_bytes(candidate.total_bytes):>9}  last_expiry={candidate.last_expiry}"
        )
    print(f"  total: {total_photos} photos, {_human_bytes(total_bytes)}\n")

    deleted = 0
    if not dry_run:
        for candidate in candidates:
            if delete_guest_album(client, settings, candidate.album_id, dry_run=False):
                deleted += 1
        print(f"[Mode A] deleted {deleted} album(s).\n")
    else:
        print("[Mode A] dry-run — nothing deleted. Re-run with --apply to delete.\n")

    # --- Mode B: orphan storage objects (report-only unless both flags) -------
    if args.skip_orphan_scan:
        print("[Mode B] skipped (--skip-orphan-scan).")
        return 0

    orphans = find_orphan_storage_albums(client, settings)
    print(f"[Mode B] orphan storage prefixes (no matching album row): {len(orphans)}")
    for orphan in orphans:
        print(f"  - bucket={orphan.bucket}  {orphan.album_id[:6]}  objects={orphan.object_count}")

    if args.apply and args.delete_orphan_objects:
        removed = 0
        for orphan in orphans:
            removed += delete_orphan_storage_prefix(client, settings, orphan)
        print(f"[Mode B] deleted {removed} orphan object(s).")
    else:
        print("[Mode B] report-only. Deletion requires BOTH --apply and --delete-orphan-objects.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
