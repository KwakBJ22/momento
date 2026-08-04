"""Guard against the §9 bug: an event name logged in code but not allowed by the
analytics_events CHECK constraint (it would be silently dropped)."""
import re
from pathlib import Path
from unittest import TestCase

REPO = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parents[1] / "app"
# The latest migration that (re)defines the analytics_events CHECK is the source of truth.
CHECK_MIGRATION = REPO / "supabase" / "migrations" / "20260803150000_analytics_contribution_claimed.sql"


def allowed_names() -> set[str]:
    text = CHECK_MIGRATION.read_text(encoding="utf-8")
    body = text.split("event_name IN (", 1)[1].split(")", 1)[0]
    return set(re.findall(r"'([a-z_]+)'", body))


def logged_literal_names() -> set[str]:
    names: set[str] = set()
    pattern = re.compile(r"(?:log_event|EventLogger\.record|insert_analytics_event)\(\s*[A-Za-z_]+\s*,\s*\"([a-z_]+)\"")
    for path in APP.rglob("*.py"):
        for match in pattern.finditer(path.read_text(encoding="utf-8")):
            names.add(match.group(1))
    return names


class AnalyticsEventNameTests(TestCase):
    def test_every_logged_event_name_is_allowed_by_the_check_constraint(self) -> None:
        allowed = allowed_names()
        used = logged_literal_names()
        self.assertTrue(used, "expected to find at least one literal event name in app/")
        missing = sorted(used - allowed)
        self.assertEqual(missing, [], f"event names logged but not allowed by CHECK: {missing}")

    def test_the_launch_metric_events_are_allowed(self) -> None:
        allowed = allowed_names()
        for name in (
            "upload_started", "album_created", "share_link_created",
            "invitation_opened", "invitation_accepted", "photo_added",
            "memory_added", "album_revisited",
        ):
            self.assertIn(name, allowed)

    def test_the_dedicated_limit_events_are_allowed(self) -> None:
        # Split out of the upload_failed + error_code workaround (PO-approved).
        allowed = allowed_names()
        for name in ("album_limit_reached", "photo_limit_reached", "video_dropped"):
            self.assertIn(name, allowed)

    def test_contribution_claimed_is_allowed(self) -> None:
        # invite→participation conversion metric.
        self.assertIn("contribution_claimed", allowed_names())

    def test_limit_rejections_no_longer_masquerade_as_upload_failures(self) -> None:
        # The old workaround logged limit rejections as upload_failed + error_code; that
        # must be gone so the upload-failure metric is not polluted.
        album_api = (APP / "api" / "album.py").read_text(encoding="utf-8")
        self.assertNotIn('"error_code": "album_limit_reached"', album_api)
        self.assertNotIn('"error_code": "photo_limit_reached"', album_api)
        self.assertIn('log_event(client, "album_limit_reached"', album_api)
        self.assertIn('"photo_limit_reached"', album_api)
