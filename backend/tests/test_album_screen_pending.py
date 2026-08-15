"""🔴 앨범 문서가 만들어진 뒤에 더해진 사진·한마디가 **앨범 화면에서** 사라진다.

OPEN_ITEMS §2-1. 제목이 `올린 사람에게만 보인다` 로 잘못 적혀 있었다 — 누가 올렸는지와
무관하고, **올린 본인에게도 안 보인다.**

dev 실측(2026-08-15): 한마디를 남긴 순간 `새로 더해진` 페이지가 하나 생겼는데
`photo_ids` 가 비어 있었다. 앨범 본문은 문서에 적힌 사진만 그리므로(album.py 의
`visible_photos`), 문서 뒤에 올라온 사진은 본문에도 없고 그 페이지에도 없어
**어디에도** 안 보였다.

까닭은 같은 일을 두 곳이 다르게 했다는 것이다:
  · 공유 화면  매 요청마다 `아직 반영 안 된 참여` 를 다시 센다
  · 앨범 화면  저장된 `living_append_pages` 만 읽는다
그래서 앨범 화면이 **공유 화면과 같은 자**(pending_contribution_rules)를 쓰게 했다.
"""

import unittest
from unittest.mock import MagicMock, patch

from app.api.album import _signed_living_append_pages

ALBUM = "album-1"
OWNER = "owner-1"
GUEST = "guest-1"
BASELINE = "2026-01-01T00:00:00+00:00"
LATER = "2026-06-01T00:00:00+00:00"

# 사진 id 는 응답 모델이 UUID 로 받는다 — 실제 형태를 그대로 쓴다.
BODY_PHOTO = "11111111-1111-4111-8111-111111111111"
NEW_PHOTO = "22222222-2222-4222-8222-222222222222"
OLD_PHOTO = "33333333-3333-4333-8333-333333333333"
OWNER_PHOTO = "44444444-4444-4444-8444-444444444444"
GONE_PHOTO = "55555555-5555-4555-8555-555555555555"


def photo(pid: str, *, by=GUEST, created=LATER, caption=""):
    return {
        "id": pid, "album_id": ALBUM, "uploaded_by_contributor_id": by, "created_at": created,
        "sort_order": 0, "caption": caption, "taken_at": None, "width": 1200, "height": 900,
        "orientation": "landscape", "latitude": None, "longitude": None,
        "location_name": None, "location_source": None,
        "storage_bucket": "originals", "storage_path": f"{pid}.jpg",
        "display_bucket": "display", "display_path": f"{pid}.webp",
        "thumbnail_bucket": "thumbs", "thumbnail_path": f"{pid}-t.webp",
    }


def memory(mid: str, *, photo_id=BODY_PHOTO, by=GUEST, created=LATER, comment="말"):
    return {
        "id": mid, "album_id": ALBUM, "photo_id": photo_id, "contributor_id": by,
        "created_at": created, "comment": comment, "author_name": "둘째",
    }


def album_row(**overrides):
    base = {
        "id": ALBUM,
        "created_at": BASELINE,
        # 문서에는 본문 사진 한 장만 적혀 있다 — 그 뒤에 올라온 것은 여기에 없다.
        "album_json": {"chapters": [{"photos": [{"id": BODY_PHOTO}]}]},
        "living_append_pages": [],
        "applied_contribution_photo_ids": [],
        "applied_contribution_memory_ids": [],
    }
    base.update(overrides)
    return base


def run(record, *, photos, memories, edition=None):
    """`_signed_living_append_pages` 를 바깥 것들만 대신하고 그대로 돌린다."""
    with patch("app.api.album.get_album_record", return_value=record), \
         patch("app.api.album.list_contributors",
               return_value=[{"id": OWNER, "role": "owner"}, {"id": GUEST, "role": "contributor"}]), \
         patch("app.api.album.get_album_photo_records", return_value=photos), \
         patch("app.api.album.list_photo_memories", return_value=memories), \
         patch("app.api.album.get_album_photo_records_by_ids",
               side_effect=lambda client, album_id, ids: [p for p in photos if str(p["id"]) in set(ids)]), \
         patch("app.api.album._batch_signed_urls_for_photos", return_value={}):
        return _signed_living_append_pages(MagicMock(), MagicMock(), record, ALBUM, edition)


class NewPhotoShowsOnAlbumScreenTest(unittest.TestCase):
    def test_문서_뒤에_올라온_사진이_사진으로_들어_있다(self) -> None:
        """★ 이것이 §2-1 그 자체다 — 예전에는 어디에도 없었다."""
        pages = run(album_row(), photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(NEW_PHOTO)], memories=[])
        self.assertEqual(len(pages), 1, "`새로 더해진` 자리가 없다")
        self.assertEqual([p["id"] for p in pages[0]["photos"]], [NEW_PHOTO])

    def test_한마디만_올라와도_그_사진이_같이_보인다(self) -> None:
        """dev 실측 그대로 — 저장된 페이지의 photo_ids 가 비어 있는 상태다."""
        record = album_row(living_append_pages=[
            {"id": "page-1", "type": "append_page", "photo_ids": [], "memory_ids": ["mem-1"]},
        ])
        pages = run(
            record,
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(NEW_PHOTO)],
            memories=[memory("mem-1")],
        )
        self.assertEqual(len(pages), 1, "페이지가 두 장이 됐다")
        self.assertEqual([p["id"] for p in pages[0]["photos"]], [NEW_PHOTO], "글만 뜨고 사진이 없다")
        self.assertEqual([m["id"] for m in pages[0]["memories"]], ["mem-1"])

    def test_새_사진에_달린_한마디는_그_사진_밑에_붙는다(self) -> None:
        """★ K-24 — 한마디를 사진과 같은 잣대로 거르지 않는다.

        사진이 그려지면 한마디는 그 사진 밑이다. `새로 더해진` 목록에 또 올리지 않는다.
        """
        pages = run(
            album_row(),
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(NEW_PHOTO)],
            memories=[memory("mem-1", photo_id=NEW_PHOTO, comment="신난 리원이")],
        )
        page = pages[0]
        self.assertEqual([c["text"] for c in page["photos"][0]["comments"]], ["신난 리원이"])
        self.assertEqual(page["memories"], [], "같은 글이 두 곳에 겹친다")

    def test_본문에_그려지는_사진의_한마디는_이_자리로_오지_않는다(self) -> None:
        """본문 사진 밑에 이미 나온다 — 여기로 오면 같은 글이 두 번 보인다."""
        pages = run(
            album_row(),
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE)],
            memories=[memory("mem-1", photo_id=BODY_PHOTO)],
        )
        self.assertEqual(pages, [], "본문에 이미 있는 글로 페이지를 만들었다")

    def test_사진이_안_그려지는_한마디만_이_자리에_남는다(self) -> None:
        """사진이 지워졌거나 아직 없는 글 — 여기가 아니면 어디에도 안 보인다."""
        pages = run(
            album_row(),
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE)],
            memories=[memory("mem-1", photo_id=GONE_PHOTO)],
        )
        self.assertEqual([m["id"] for m in pages[0]["memories"]], ["mem-1"])


class RulesWeMustNotBreakTest(unittest.TestCase):
    def test_이미_반영된_사진은_다시_붙지_않는다(self) -> None:
        record = album_row(applied_contribution_photo_ids=[NEW_PHOTO])
        pages = run(record, photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(NEW_PHOTO)], memories=[])
        self.assertEqual(pages, [], "반영이 끝난 사진을 또 `새로 더해진` 으로 그린다")

    def test_주최자가_올린_사진은_이_자리로_오지_않는다(self) -> None:
        pages = run(
            album_row(),
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(OWNER_PHOTO, by=OWNER)],
            memories=[],
        )
        self.assertEqual(pages, [], "주최자 사진이 `새로 더해진` 으로 갔다")

    def test_이전_판을_볼_때는_다시_세지_않는다(self) -> None:
        """★ 공유 화면이 `edition is None` 일 때만 세는 것과 같은 조건이다."""
        record = album_row(album_version_history={
            "2": {"document": {"pages": []}, "append_pages": []},
        })
        pages = run(record, photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(NEW_PHOTO)],
                    memories=[], edition=2)
        self.assertEqual(pages, [], "이전 판에 새 사진이 끼어들었다")

    def test_저장된_페이지가_있으면_맨_뒤_그_장에_쌓는다(self) -> None:
        """★ 페이지를 새로 만들지 않는다 — `새로 더해진` 이 두 덩어리로 서면 안 된다."""
        record = album_row(living_append_pages=[
            {"id": "page-1", "type": "append_page", "photo_ids": [OLD_PHOTO], "memory_ids": []},
        ])
        pages = run(
            record,
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(OLD_PHOTO), photo(NEW_PHOTO)],
            memories=[],
        )
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["id"], "page-1", "저장된 페이지 id 가 바뀌었다")
        self.assertEqual([p["id"] for p in pages[0]["photos"]], [OLD_PHOTO, NEW_PHOTO], "새 사진이 앞으로 갔다")

    def test_더할_것이_없으면_저장된_페이지_그대로다(self) -> None:
        record = album_row(living_append_pages=[
            {"id": "page-1", "type": "append_page", "photo_ids": [OLD_PHOTO], "memory_ids": []},
        ])
        pages = run(
            record,
            photos=[photo(BODY_PHOTO, by=OWNER, created=BASELINE), photo(OLD_PHOTO)],
            memories=[],
        )
        self.assertEqual([p["id"] for p in pages[0]["photos"]], [OLD_PHOTO])


if __name__ == "__main__":
    unittest.main()
