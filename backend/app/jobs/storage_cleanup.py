"""Railway Cron entry point for temporary-upload cleanup.

Set ``CLEANUP_EXECUTE=true`` only on the dedicated cron service.  Otherwise
the same job remains a safe dry-run.
"""
from __future__ import annotations

import sys

from app.operations_cli import main


if __name__ == "__main__":
    sys.argv.insert(1, "scheduled_cleanup")
    raise SystemExit(main())
