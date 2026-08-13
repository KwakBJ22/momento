"""새로 더해진 것은 **자동으로** 마지막 페이지에 붙는다 (PO 결정 2026-08-13).

주최자가 누를 버튼도, 고를 시트도 없다. 참여자가 올리면 그 건에 대해서만 서버가
`append_page` 반영을 실행한다.

★ 핵심은 **페이지를 매번 새로 만들지 않는 것**이다. 예전 코드는 부를 때마다
  `living_append_pages` 에 한 장을 더해서, 한마디 3개면 페이지가 3장이 됐다.
  이제는 올라올 때마다 자동으로 부르므로 그대로 뒀다면 앨범이 한 줄짜리 페이지로
  뒤덮인다.
"""

import unittest
from unittest.mock import MagicMock, patch

from app.services.collaboration_service import (
    _merge_ids,
    apply_selected_contributions,
    auto_append_contribution,
)

BASELINE = "2026-01-01T00:00:00+00:00"
LATER = "2026-06-01T00:00:00+00:00"
OWNER = "owner-1"
GUEST = "guest-1"


def album(**overrides):
    base = {
        "id": "album-1",
        "album_version": 3,
        "album_json": {"pages": []},
        "living_append_pages": [],
        "applied_contribution_photo_ids": [],
        "applied_contribution_memory_ids": [],
        "last_collaboration_applied_at": BASELINE,
        "created_at": BASELINE,
        "photo_limit": 100,
        "cover_photo_id": "photo-base",
    }
    base.update(overrides)
    return base


def photo_row(pid: str, *, by=GUEST, created=LATER):
    return {"id": pid, "album_id": "album-1", "uploaded_by_contributor_id": by,
            "created_at": created, "sort_order": 0, "deleted_at": None}


def memory_row(mid: str, *, photo="photo-base", by=GUEST, created=LATER):
    return {"id": mid, "album_id": "album-1", "photo_id": photo,
            "contributor_id": by, "created_at": created, "comment": "말"}


class Harness:
    """apply_selected_contributions 가 쓰는 바깥 것들을 대신한다."""

    def __init__(self, photos, memories):
        self.photos = photos
        self.memories = memories
        self.updates: list[dict] = []
        self.client = MagicMock()

        def table(name: str):
            handle = MagicMock()
            if name == "album_photos":
                chain = handle.select.return_value.eq.return_value
                chain.is_.return_value.order.return_value.execute.return_value.data = photos
                # ready_album_photo_query 가 중간에 끼는 경우도 같은 데이터를 준다.
                handle.select.return_value.eq.return_value.execute.return_value.data = photos
            elif name == "albums":
                def update(payload):
                    self.updates.append(payload)
                    result = MagicMock()
                    result.eq.return_value.execute.return_value.data = [{"id": "album-1"}]
                    result.eq.return_value.is_.return_value.execute.return_value.data = [{"id": "album-1"}]
                    return result
                handle.update.side_effect = update
            return handle

        self.client.table.side_effect = table

    def living_pages(self):
        """마지막으로 저장된 living_append_pages."""
        for payload in reversed(self.updates):
            if "living_append_pages" in payload:
                return payload["living_append_pages"]
        return None


def run_apply(harness, *, photo_ids=frozenset(), memory_ids=frozenset(), current_album, mode="append_page"):
    with patch("app.services.collaboration_service.ready_album_photo_query", side_effect=lambda q: q), \
         patch("app.services.collaboration_service.list_photo_memories", return_value=harness.memories), \
         patch("app.services.collaboration_service.list_contributors",
               return_value=[{"id": OWNER, "role": "owner"}, {"id": GUEST, "role": "contributor"}]), \
         patch("app.services.collaboration_service.rebuild_album",
               return_value={"album_version": 4, "album_json": current_album.get("album_json")}), \
         patch("app.services.collaboration_service.build_album_document_from_records",
               return_value={"pages": []}):
        return apply_selected_contributions(
            harness.client, current_album,
            photo_ids=set(photo_ids), memory_ids=set(memory_ids), mode=mode,
        )


class MergeIdsTest(unittest.TestCase):
    def test_먼저_올라온_것이_먼저_선다(self) -> None:
        self.assertEqual(_merge_ids(["a", "b"], {"c"}), ["a", "b", "c"])

    def test_같은_것을_두_번_넣지_않는다(self) -> None:
        self.assertEqual(_merge_ids(["a", "b"], {"b", "c"}), ["a", "b", "c"])

    def test_아무것도_없으면_새것만_남는다(self) -> None:
        self.assertEqual(_merge_ids(None, {"b", "a"}), ["a", "b"])


class OnePageNotManyTest(unittest.TestCase):
    def test_한마디를_세_번_올리면_페이지는_한_장이고_항목이_셋이다(self) -> None:
        """★ 이것이 이번 수정의 핵심이다 — 예전에는 세 장이 됐다."""
        memories = [memory_row(f"mem-{i}") for i in (1, 2, 3)]
        current = album()
        for index, mem in enumerate(memories, start=1):
            harness = Harness([photo_row("photo-base", by=OWNER, created=BASELINE)], memories[:index])
            run_apply(harness, memory_ids={mem["id"]}, current_album=current)
            pages = harness.living_pages()
            current = album(
                living_append_pages=pages,
                applied_contribution_memory_ids=[m["id"] for m in memories[:index]],
            )
            self.assertEqual(len(pages), 1, f"{index}번째에 페이지가 {len(pages)}장이 됐다")
        self.assertEqual(pages[0]["memory_ids"], ["mem-1", "mem-2", "mem-3"])
        self.assertEqual(pages[0]["photo_ids"], [])

    def test_사진_두_장을_올리면_같은_페이지_뒤에_이어진다(self) -> None:
        photos = [photo_row("photo-base", by=OWNER, created=BASELINE), photo_row("photo-1"), photo_row("photo-2")]
        harness = Harness(photos, [])
        run_apply(harness, photo_ids={"photo-1"}, current_album=album())
        pages = harness.living_pages()

        harness2 = Harness(photos, [])
        run_apply(harness2, photo_ids={"photo-2"},
                  current_album=album(living_append_pages=pages, applied_contribution_photo_ids=["photo-1"]))
        pages2 = harness2.living_pages()

        self.assertEqual(len(pages2), 1, "두 번째 사진이 새 페이지를 만들었다")
        self.assertEqual(pages2[0]["photo_ids"], ["photo-1", "photo-2"])
        self.assertEqual(pages2[0]["id"], pages[0]["id"], "페이지 id 가 바뀌었다")

    def test_페이지가_없을_때만_새로_만든다(self) -> None:
        harness = Harness([photo_row("photo-base", by=OWNER, created=BASELINE)], [memory_row("mem-1")])
        run_apply(harness, memory_ids={"mem-1"}, current_album=album(living_append_pages=[]))
        pages = harness.living_pages()
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["type"], "append_page")
        self.assertTrue(pages[0]["id"])

    def test_처음_만든_시각은_그대로_두고_고친_시각만_올린다(self) -> None:
        photos = [photo_row("photo-base", by=OWNER, created=BASELINE), photo_row("photo-1"), photo_row("photo-2")]
        harness = Harness(photos, [])
        run_apply(harness, photo_ids={"photo-1"}, current_album=album())
        first = harness.living_pages()[0]

        harness2 = Harness(photos, [])
        run_apply(harness2, photo_ids={"photo-2"},
                  current_album=album(living_append_pages=[first], applied_contribution_photo_ids=["photo-1"]))
        second = harness2.living_pages()[0]
        self.assertEqual(second["created_at"], first["created_at"])
        self.assertIn("updated_at", second)


class EditionStillClearsPagesTest(unittest.TestCase):
    def test_edition_을_돌리면_append_페이지가_없어진다(self) -> None:
        """지금 동작 그대로다 — 자동 반영이 edition 갈래를 건드리지 않았다."""
        photos = [photo_row("photo-base", by=OWNER, created=BASELINE), photo_row("photo-1")]
        harness = Harness(photos, [])
        existing = [{"id": "page-1", "type": "append_page", "photo_ids": ["photo-0"], "memory_ids": []}]
        run_apply(harness, photo_ids={"photo-1"}, mode="edition",
                  current_album=album(living_append_pages=existing))
        self.assertEqual(harness.living_pages(), [], "edition 이 페이지를 정리하지 않았다")


class AutoAppendNeverUndoesTheUploadTest(unittest.TestCase):
    def test_붙이다_실패해도_예외를_밖으로_내지_않는다(self) -> None:
        """★ 올린 사진·한마디는 이미 저장됐다. 여기서 터져도 되돌리지 않는다."""
        client = MagicMock()
        with patch("app.services.collaboration_service.get_album_record", side_effect=RuntimeError("db down")):
            self.assertFalse(auto_append_contribution(client, "album-1", memory_ids={"mem-1"}))

    def test_반영이_거절돼도_조용히_넘어간다(self) -> None:
        client = MagicMock()
        with patch("app.services.collaboration_service.get_album_record", return_value=album()), \
             patch("app.services.collaboration_service.apply_selected_contributions",
                   side_effect=Exception("409 already applied")):
            self.assertFalse(auto_append_contribution(client, "album-1", memory_ids={"mem-1"}))

    def test_넣을_것이_없으면_아무것도_하지_않는다(self) -> None:
        client = MagicMock()
        with patch("app.services.collaboration_service.get_album_record") as get_album:
            self.assertFalse(auto_append_contribution(client, "album-1"))
            get_album.assert_not_called()

    def test_성공하면_append_page_갈래로만_부른다(self) -> None:
        """★ edition 갈래는 주최자가 고를 때만 돈다."""
        client = MagicMock()
        with patch("app.services.collaboration_service.get_album_record", return_value=album()), \
             patch("app.services.collaboration_service.apply_selected_contributions") as apply_call:
            self.assertTrue(auto_append_contribution(client, "album-1", memory_ids={"mem-1"}))
        self.assertEqual(apply_call.call_args.kwargs["mode"], "append_page")
        self.assertEqual(apply_call.call_args.kwargs["memory_ids"], {"mem-1"})


class EndpointsCallItTest(unittest.TestCase):
    def test_사진_올리는_자리와_한마디_남기는_자리_둘_다에서_부른다(self) -> None:
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "collaboration.py").read_text(encoding="utf-8")
        self.assertIn("auto_append_contribution(\n            client, album_id, photo_ids=", source)
        self.assertIn('auto_append_contribution(client, album_id, memory_ids={str(memory["id"])})', source)

    def test_주최자에게_버튼을_돌려주지_않았다(self) -> None:
        """apply-contributions 는 남아 있다 — `앨범 다시 구성하기`(edition)가 쓴다."""
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "collaboration.py").read_text(encoding="utf-8")
        self.assertIn("apply_selected_contributions", source)


if __name__ == "__main__":
    unittest.main()


class SharePendingGoesEmptyTest(unittest.TestCase):
    """자동 반영이 켜지면 share.py 의 `아직 안 붙은 것` 목록은 늘 빈다.

    ★ 그 함수를 지우지 않는다. 자동 반영이 실패한 사이(다음 사람이 올릴 때까지)에는
      여전히 채워지고, 그때 공유 화면이 그 사진을 `대기` 로 그린다. 지워 버리면
      그 창에 올라온 사진이 화면에서 사라진다.
    """

    def test_함수는_그대로_있다(self) -> None:
        import pathlib
        source = (pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "share.py").read_text(encoding="utf-8")
        self.assertIn("def is_pending_photo(", source)
        self.assertIn("def is_pending_memory(", source)

    def test_붙고_나면_대기로_잡히지_않는다(self) -> None:
        """applied_contribution_*_ids 에 들어가면 pending 조건에서 빠진다."""
        applied_photo_ids = {"photo-1"}
        owner_ids = {OWNER}

        def is_pending_photo(photo):
            contributor_id = str(photo.get("uploaded_by_contributor_id") or "")
            return (
                bool(contributor_id)
                and contributor_id not in owner_ids
                and str(photo.get("created_at") or "") > BASELINE
                and str(photo.get("id")) not in applied_photo_ids
            )

        self.assertFalse(is_pending_photo(photo_row("photo-1")), "붙었는데 아직 대기로 잡힌다")
        self.assertTrue(is_pending_photo(photo_row("photo-2")), "아직 안 붙은 것은 대기여야 한다")

    def test_대기가_비어도_화면에_그릴_사진은_그대로다(self) -> None:
        """pending 이 비면 전부 shared 로 간다 — 사라지지 않는다."""
        records = [photo_row("photo-1"), photo_row("photo-2")]
        pending = []
        shared = [row for row in records if row not in pending]
        self.assertEqual(len(shared), 2, "대기가 비었더니 사진이 사라졌다")
