"""텍스트 3계층(캡션 / 코멘트 / 방명록)의 저장소·권한·인쇄 여부를 고정한다.

  ① 캡션   album_photos.caption   올린 사람만        PDF에 인쇄된다
  ② 코멘트 photo_memories          주최자+참여자      인쇄되지 않는다
  ③ 방명록 album_guestbook_entries 전원(구경꾼 포함)  인쇄되지 않는다

읽기는 전원 동일하다 — 차이는 "쓸 수 있는가"에만 있다.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def source(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


class CaptionSingleSourceTests(unittest.TestCase):
    """①: caption 컬럼 하나만 읽고 쓴다. comment 폴백·이중 기록은 남기지 않는다."""

    def test_no_comment_fallback_remains(self) -> None:
        for rel in ("app/api/album.py", "app/api/share.py", "app/services/story_rules.py",
                    "app/services/album_generation_service.py"):
            text = source(rel)
            self.assertNotIn('photo.get("comment") or photo.get("caption")', text, rel)
            self.assertNotRegex(text, r'get\("comment"\)\s*or\s*.*get\("caption"\)', rel)

    def test_writes_do_not_mirror_into_comment(self) -> None:
        album = source("app/api/album.py")
        self.assertNotIn('"comment": story["text"]', album)
        self.assertIn('"caption": story["text"]', album)
        self.assertNotIn('.update({"comment": comment, "caption": comment})', source("app/services/supabase.py"))

    def test_api_response_field_is_caption(self) -> None:
        schemas = source("app/models/schemas.py")
        block = schemas.split("class AlbumPhotoUrlResponse")[1].split("class ")[0]
        self.assertIn("caption: str | None", block)
        # ② 코멘트는 comments 로 남는다 — 같은 이름의 두 필드가 정반대를 가리키지 않게.
        self.assertIn("comments: list[AlbumPhotoCommentItem]", block)
        self.assertNotRegex(block, r"^\s{4}comment: ", )


class WritePermissionTableTests(unittest.TestCase):
    """권한 표 9칸 — 캡션 / 코멘트 / 방명록 × 주최자 / 참여자 / 구경꾼."""

    def test_caption_is_uploader_only_even_for_the_owner(self) -> None:
        album = source("app/api/album.py")
        # 캡션 엔드포인트는 소유자 우회를 끈다.
        self.assertIn("owner_override=False", album)
        guard = album.split("def _require_photo_mutation_access")[1].split("\ndef ")[0]
        self.assertIn("if owner_override and access.can_edit_settings:", guard)
        self.assertIn("본인이 추가한 사진만 수정할 수 있습니다.", guard)
        # 구경꾼은 require_album_contribute 에서 먼저 막힌다(로그인·기여 권한 필요).
        self.assertIn("require_album_contribute(access)", guard)

    def test_comment_write_requires_a_contribution_session(self) -> None:
        # ② 코멘트(photo_memories): 주최자·참여자만 — 참여 세션(guest_id/contributor)이
        # 있어야 쓴다. 구경꾼은 세션이 없어 쓸 수 없다.
        collab = source("app/api/collaboration.py")
        marker = '@router.post("/api/albums/{album_id}/photos/{photo_id}/memories"'
        self.assertIn(marker, collab)
        memory_block = collab.split(marker)[1].split("\n@router")[0]
        # 참여 세션(require_contributor)이 있어야 쓴다 — 구경꾼은 세션이 없어 막힌다.
        self.assertIn("require_contributor", memory_block)

    def test_guestbook_write_is_open_to_everyone_including_visitors(self) -> None:
        # ③ 방명록: 공개 공유 라우트에 있고 로그인·기여 권한을 요구하지 않는다.
        share = source("app/api/share.py")
        block = share.split('@router.post("/public/shares/{token}/guestbook"')[1].split("\n@router")[0]
        self.assertNotIn("require_album_contribute", block)
        self.assertNotIn("require_authenticated_user", block)
        self.assertIn("add_guestbook_entry", block)

    def test_reading_is_the_same_for_everyone(self) -> None:
        # 구경꾼도 캡션·코멘트·방명록을 모두 본다 — 공개 응답이 셋을 모두 싣는다.
        share = source("app/api/share.py")
        self.assertIn("caption=", share)          # ① 캡션
        self.assertIn("list_photo_memories", share)  # ② 코멘트
        self.assertIn("list_guestbook_entries", share)  # ③ 방명록


class UploaderRecordTests(unittest.TestCase):
    """"올린 사람만 캡션"의 유일한 근거 — 모든 업로드 경로가 업로더를 기록한다."""

    def test_owner_upload_records_uploaded_by_contributor_id(self) -> None:
        album = source("app/api/album.py")
        block = album.split('_log_upload_stage("photo_db_insert", "started"')[1].split("save_album_photo_records")[0]
        self.assertIn("ensure_owner_contributor", block)
        self.assertIn('record["uploaded_by_contributor_id"] = owner_contributor_id', block)
        # 기록이 없으면 업로드를 성공시키지 않는다.
        self.assertIn("if not owner_contributor_id:", block)
        self.assertIn("raise HTTPException", block)

    def test_participant_upload_path_still_records_the_uploader(self) -> None:
        collab = source("app/api/collaboration.py")
        self.assertIn("uploaded_by_contributor_id", collab)


class PrintBoundaryTests(unittest.TestCase):
    """②③ 는 앨범 본문(AlbumRenderer) 밖 — PDF·인쇄에 들어가지 않는다."""

    def test_renderer_receives_captions_but_not_memories_or_guestbook(self) -> None:
        renderer = (BACKEND.parent / "frontend/src/album-engine/AlbumRenderer.tsx").read_text(encoding="utf-8")
        self.assertIn("photo.caption", renderer)
        self.assertNotIn("guestbook", renderer.lower())

    def test_pdf_export_never_mounts_the_guestbook(self) -> None:
        export = (BACKEND.parent / "frontend/src/lib/exportPdf.tsx").read_text(encoding="utf-8")
        self.assertNotIn("Guestbook", export)
        self.assertNotIn("AlbumScreen", export)


if __name__ == "__main__":
    unittest.main()
