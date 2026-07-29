from pathlib import Path
from unittest import TestCase

from app.models.schemas import AlbumGenerationStatusResponse


class AlbumGenerationJobContractTests(TestCase):
    def test_generation_status_exposes_only_safe_progress_fields(self) -> None:
        payload = AlbumGenerationStatusResponse(
            album_id="00000000-0000-0000-0000-000000000001",
            generation_job_id="00000000-0000-0000-0000-000000000002",
            status="processing", progress=55, current_step="processing_images", ready=False,
        ).model_dump()
        self.assertEqual(payload["progress"], 55)
        self.assertNotIn("storage_path", payload)
        self.assertNotIn("error_detail", payload)

    def test_migration_keeps_one_active_job_per_album_and_nullable_derivatives(self) -> None:
        migration = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20260729110000_album_generation_jobs.sql"
        source = migration.read_text(encoding="utf-8")
        self.assertIn("album_generation_jobs", source)
        self.assertIn("WHERE status IN ('pending', 'processing')", source)
        self.assertIn("ALTER COLUMN thumbnail_path DROP NOT NULL", source)
