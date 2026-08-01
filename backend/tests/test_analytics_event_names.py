"""Guard against the §9 bug: an event name logged in code but not allowed by the
analytics_events CHECK constraint (it would be silently dropped)."""
import re
from pathlib import Path
from unittest import TestCase

REPO = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parents[1] / "app"
CHECK_MIGRATION = REPO / "supabase" / "migrations" / "20260801120000_analytics_metric_events.sql"


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
