from pathlib import Path
from unittest import TestCase

from app.models.schemas import AlbumGenerationPreviewItem, AlbumGenerationPreviewResponse, AlbumGenerationStatusResponse
from app.services.album_generation_service import _generation_photos, has_current_generation_photos
from app.services.supabase import soft_delete_album_photo_with_references


class AlbumGenerationJobContractTests(TestCase):
    def test_generation_uses_only_current_photo_rows_after_legacy_media_deletion(self) -> None:
        class Query:
            def __init__(self, rows): self.rows = rows
            def select(self, *_args): return self
            def eq(self, *_args): return self
            def is_(self, *_args): return self
            def order(self, *_args): return self
            def execute(self):
                from types import SimpleNamespace
                return SimpleNamespace(data=self.rows)

        class Client:
            def table(self, name):
                if name == "album_photos":
                    return Query([
                        *[{"id": f"deleted-{index}", "status": "ready", "deleted_at": None} for index in range(5)],
                        *[{"id": f"new-{index}", "status": "ready", "deleted_at": None} for index in range(5)],
                    ])
                return Query([{"id": f"deleted-{index}", "deleted_at": "2026-07-29T00:00:00+00:00"} for index in range(5)])

        photos = _generation_photos(Client(), "album-1")
        self.assertEqual([photo["id"] for photo in photos], [f"new-{index}" for index in range(5)])
        self.assertTrue(has_current_generation_photos(Client(), "album-1"))

    def test_empty_current_photo_set_is_not_a_generation_input(self) -> None:
        class Query:
            def select(self, *_args): return self
            def eq(self, *_args): return self
            def is_(self, *_args): return self
            def order(self, *_args): return self
            def execute(self):
                from types import SimpleNamespace
                return SimpleNamespace(data=[])

        class Client:
            def table(self, _name): return Query()

        self.assertFalse(has_current_generation_photos(Client(), "album-empty"))

    def test_photo_delete_uses_the_atomic_reference_cleanup_rpc(self) -> None:
        class Rpc:
            def execute(self):
                from types import SimpleNamespace
                return SimpleNamespace(data=True)

        class Client:
            def __init__(self): self.calls = []
            def rpc(self, name, payload):
                self.calls.append((name, payload))
                return Rpc()

        client = Client()
        self.assertTrue(soft_delete_album_photo_with_references(client, "album-1", "photo-1"))
        self.assertEqual(client.calls, [("soft_delete_album_photo", {"p_album_id": "album-1", "p_photo_id": "photo-1"})])

    def test_photo_delete_migration_clears_current_cover_and_derived_album_state(self) -> None:
        migration = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "20260729130000_photo_delete_generation_integrity.sql"
        source = migration.read_text(encoding="utf-8")
        self.assertIn("soft_delete_album_photo", source)
        self.assertIn("id = v_current_cover", source)
        self.assertIn("cover_photo_id = v_next_cover", source)
        self.assertIn("album_json = NULL", source)
        self.assertIn("living_append_pages = '[]'::jsonb", source)
        self.assertIn("applied_contribution_photo_ids", source)
        self.assertIn("applied_contribution_memory_ids", source)
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

    def test_generation_preview_contract_limits_the_response_to_safe_urls(self) -> None:
        payload = AlbumGenerationPreviewResponse(previews=[
            AlbumGenerationPreviewItem(photo_id="00000000-0000-0000-0000-000000000003", url="https://signed.example/image"),
        ]).model_dump()
        self.assertEqual(len(payload["previews"]), 1)
        self.assertNotIn("storage_path", payload["previews"][0])

    def test_generation_service_uses_aggregated_safe_timing_events(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "app" / "services" / "album_generation_service.py").read_text(encoding="utf-8")
        for event in (
            "event=album_generation_background_started",
            "event=image_processing_started",
            "event=image_processing_completed",
            "event=story_generation_started",
            "event=album_build_completed",
            "event=album_generation_completed",
        ):
            self.assertIn(event, source)
        self.assertIn("_short(album_id)", source)
        self.assertNotIn("logger.info(\"event=image_processing_photo", source)

    def test_retry_rejects_an_album_without_current_generation_photos(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        self.assertIn("if not has_current_generation_photos(client, album_id):", source)
        self.assertIn("사진을 추가한 뒤 앨범을 만들어주세요.", source)
        self.assertIn('error_code = "no_current_photos"', (Path(__file__).resolve().parents[1] / "app" / "services" / "album_generation_service.py").read_text(encoding="utf-8"))

    def test_initial_upload_persists_an_original_thumbnail_fallback(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "app" / "api" / "album.py").read_text(encoding="utf-8")
        self.assertIn('"thumbnail_bucket": settings.supabase_private_storage_bucket, "thumbnail_path": original_path', source)
