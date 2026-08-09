"""Operational maintenance commands; safe dry-run is the default.

Examples:
  python -m app.operations_cli check_storage
  python -m app.operations_cli check_integrity --limit 20
  python -m app.operations_cli cleanup_temp --album-id <id> --execute
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from app.config import get_settings
from app.services.operations import operation_context
from app.services.operations_service import check_integrity, check_storage, cleanup_storage, cleanup_temp
from app.services.supabase import get_supabase_client


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="우리앨범 operational maintenance")
    parser.add_argument("command", choices=("check_storage", "cleanup_storage", "cleanup_temp", "check_integrity", "scheduled_cleanup"))
    parser.add_argument("--album-id")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--execute", action="store_true", help="Perform deletion. Omit for dry-run output.")
    return parser


def run_command(args: argparse.Namespace, *, client: Any | None = None) -> tuple[dict[str, Any], int]:
    settings = get_settings()
    client = client or get_supabase_client(settings)
    execute = bool(args.execute)
    if args.command == "scheduled_cleanup":
        # Railway Cron must opt in to destructive work through its environment.
        execute = os.getenv("CLEANUP_EXECUTE", "false").strip().lower() == "true"
    with operation_context(f"maintenance.{args.command}"):
        if args.command == "check_storage":
            report = check_storage(client, settings)
        elif args.command == "check_integrity":
            report = check_integrity(client, settings, album_id=args.album_id, limit=args.limit)
        elif args.command == "cleanup_temp":
            report = cleanup_temp(client, settings, album_id=args.album_id, execute=execute, limit=args.limit)
        elif args.command == "scheduled_cleanup":
            temp_report = cleanup_temp(client, settings, album_id=args.album_id, execute=execute, limit=args.limit)
            storage_report = cleanup_storage(client, settings, album_id=args.album_id, execute=execute, limit=args.limit)
            report = {
                "status": "ok",
                "scheduled": True,
                "executed": execute,
                "temp": temp_report,
                "storage": storage_report,
            }
        else:
            report = cleanup_storage(client, settings, album_id=args.album_id, execute=execute, limit=args.limit)
    status = 0 if report.get("status") == "ok" else 2
    return report, status


def main() -> int:
    args = _parser().parse_args()
    try:
        report, status = run_command(args)
    except Exception as exc:
        print(json.dumps({"status": "error", "error_type": type(exc).__name__, "message": str(exc)[:240]}))
        return 1
    print(json.dumps(report, ensure_ascii=False, default=str))
    return status


if __name__ == "__main__":
    sys.exit(main())
