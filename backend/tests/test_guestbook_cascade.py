"""Guard against §3's explicit warning: if delete_album_cascade forgets the
guestbook, deleting an album (and withdrawing an account that owns it) fails."""
from pathlib import Path
from unittest import TestCase

REPO = Path(__file__).resolve().parents[2]
GUESTBOOK_MIGRATION = REPO / "supabase" / "migrations" / "20260802100000_album_guestbook.sql"


class GuestbookCascadeTests(TestCase):
    def test_delete_album_cascade_removes_guestbook_entries(self) -> None:
        sql = GUESTBOOK_MIGRATION.read_text(encoding="utf-8")
        self.assertIn("CREATE OR REPLACE FUNCTION public.delete_album_cascade", sql)
        self.assertIn("DELETE FROM public.album_guestbook_entries WHERE album_id = p_album_id", sql)

    def test_album_fk_cascades_and_contributor_fk_sets_null(self) -> None:
        sql = GUESTBOOK_MIGRATION.read_text(encoding="utf-8")
        # album_id cascade: album deletion (and account withdrawal) can never be blocked.
        self.assertRegex(sql, r"album_id[^\n]*REFERENCES public\.albums\(id\) ON DELETE CASCADE")
        # contributor_id set null: a deleted contributor never blocks or drops the entry.
        self.assertRegex(sql, r"contributor_id[^\n]*REFERENCES public\.album_contributors\(id\) ON DELETE SET NULL")
