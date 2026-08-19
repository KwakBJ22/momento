"""🔴 지운 적 없는 사진이 앨범에서 사라졌다 (2026-08-19 · dev 실측).

`CLAUDE.md §9` — 사용자 데이터는 절대 잃어버리면 안 된다.

사진이 화면에 나오는 길은 **둘뿐**이다:
    ① 앨범 본문(`album_json`)          — `album_photos` 응답이 이 목록으로 거른다
    ② 새로 더해진 페이지(`living_append_pages`)

둘 다 아니면 **어디에도 안 나온다.** 그 사이를 메우는 그물이 `_pending_append_ids` 인데,
예전에는 거기에 `is_pending_photo`(= 새로 들어온 **참여**인가)를 걸고 있었다.
그 자는 **주최자가 올린 사진을 일부러 뺀다.** 그래서 앨범이 만들어진 뒤 주최자가 더한
사진은 본문에도 없고 페이지에도 없어 사라졌다.

★ 이 자리가 묻는 것은 `새 참여인가`가 아니라 **`이 사진이 어디든 그려지는가`** 다.
★ 촬영일이 없다는 이유로는 어디서도 버리지 않는다.
"""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.album import router
from app.services.auth import optional_strict_authenticated_user, require_authenticated_user
from app.services.authorization import AlbumAccess
from app.services.collaboration_service import (
    album_document_photo_ids,
    build_album_document_from_records,
)

ALBUM_ID = "982da82e-0497-45a7-95c7-78cd6bb27649"
OWNER = "9bd0e647-8802-4922-932c-7880bb9b819e"
GUEST = "6088ed26-43c2-4253-a6f2-11c43a1fbb7c"
DATED = "11111111-1111-1111-1111-111111111111"
ON_PAGE = "c17ac763-307a-4720-bd1a-3aed30f4a00e"
OWNER_LATE = "aaaaaaaa-0000-0000-0000-000000000001"


def photo(pid: str, taken: str | None, order: int, uploader: str | None) -> dict:
    return {
        "id": pid, "original_filename": f"{pid}.jpg", "status": "ready", "deleted_at": None,
        "taken_at": taken, "sort_order": order, "created_at": "2026-08-18T12:06:57+00:00",
        "uploaded_by_contributor_id": uploader,
        "storage_bucket": "private", "storage_path": f"{pid}.jpg",
        "display_bucket": "private", "display_path": f"{pid}.webp",
        "thumbnail_bucket": "private", "thumbnail_path": f"{pid}-t.webp",
        "caption": None, "comment": None, "latitude": None, "longitude": None,
        "location_name": None, "location_source": "unknown",
        "orientation": "landscape", "width": 1000, "height": 800,
    }


class UndatedPhotoIsKeptInTheDocumentTests(TestCase):
    """① 앨범 문서를 만들 때 촬영일 없는 사진을 버리지 않는다."""

    def _album(self) -> dict:
        return {"id": ALBUM_ID, "created_at": "2026-08-18T03:00:17+00:00", "title": "", "epilogue": ""}

    def test_촬영일이_없어도_반드시_담긴다(self) -> None:
        photos = [
            photo("p1", "2026-07-06T11:30:01+00:00", 0, OWNER),
            photo("p2", "2026-07-06T12:07:08+00:00", 1, OWNER),
            photo("no-date", None, 2, GUEST),
        ]
        document = build_album_document_from_records(self._album(), photos, [])
        self.assertEqual(len(album_document_photo_ids(document)), 3)
        self.assertIn("no-date", album_document_photo_ids(document))

    def test_날짜_없는_사진은_맨_뒤_제_묶음에_선다(self) -> None:
        """남의 날짜 아래로 섞어 넣지 않는다 — 그 날짜와 장소를 뒤집어쓴다."""
        photos = [
            photo("p1", "2026-07-06T11:30:01+00:00", 0, OWNER),
            photo("no-1", None, 1, OWNER),
            photo("p2", "2026-07-09T12:07:08+00:00", 2, OWNER),
            photo("no-2", None, 3, OWNER),
        ]
        chapters = build_album_document_from_records(self._album(), photos, [])["chapters"]
        self.assertIsNone(chapters[-1]["date"], "날짜 없는 묶음이 맨 뒤가 아니다")
        self.assertEqual([p["id"] for p in chapters[-1]["photos"]], ["no-1", "no-2"])
        # 앞부분은 시간순 그대로다.
        self.assertEqual([c["date"] for c in chapters[:-1]], ["2026-07-06", "2026-07-09"])

    def test_전부_날짜가_없어도_한_묶음으로_담긴다(self) -> None:
        photos = [photo("a", None, 0, OWNER), photo("b", None, 1, OWNER)]
        chapters = build_album_document_from_records(self._album(), photos, [])["chapters"]
        self.assertEqual(len(chapters), 1)
        self.assertIsNone(chapters[0]["date"])
        self.assertEqual([p["id"] for p in chapters[0]["photos"]], ["a", "b"])


class EveryReadyPhotoIsReachableTests(TestCase):
    """② 본문에도 페이지에도 없는 사진은 **누가 올렸든** 페이지로 건진다."""

    PAGE = {
        "id": "0c02a5bb-131c-44a3-b0ad-59d0769dd8f1", "type": "append_page",
        "photo_ids": [ON_PAGE], "memory_ids": [],
        "created_at": "2026-08-18T12:05:34+00:00",
    }

    def setUp(self) -> None:
        self.photos = [
            photo(DATED, "2026-07-06T11:30:01+00:00", 0, OWNER),   # 본문에 있다
            photo(ON_PAGE, None, 1, GUEST),                        # 페이지에 있다
            photo(OWNER_LATE, None, 2, OWNER),                     # ★ 어디에도 없다
        ]
        album_json = {
            "album_id": ALBUM_ID,
            "chapters": [{
                "date": "2026-07-06", "endDate": "2026-07-06", "title": "2026년 7월",
                "dayIndex": 1, "tripDay": None, "kind": "event", "place": None,
                "locationSource": "unknown", "photos": [{"id": DATED}],
                "blocks": [], "storyBody": None,
            }],
        }
        self.record = {
            "id": ALBUM_ID, "created_at": "2026-08-18T03:00:17+00:00",
            "title": "테스트", "epilogue": "", "narrative": "", "chapter_stories": {},
            "meeting_type": "family", "category": "family", "template": "A",
            "template_type": "warm", "event_date": "2026-07-06", "result_path": "",
            "cover_photo_id": DATED, "album_version": 2,
            "living_latest_edition_previous": None, "living_append_pages": [self.PAGE],
            "skin": None, "paper": None, "album_json": album_json,
            # ★ 이미 페이지에 적힌 것으로 표시돼 있다 — 예전 그물은 이것 때문에도 걸렀다.
            "applied_contribution_photo_ids": [ON_PAGE],
            "applied_contribution_memory_ids": [],
        }

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_authenticated_user] = lambda: OWNER
        app.dependency_overrides[optional_strict_authenticated_user] = lambda: OWNER
        self.client = TestClient(app)

        for item in (
            patch("app.api.album.get_supabase_client", return_value=MagicMock()),
            patch("app.api.album.get_settings", return_value=SimpleNamespace(
                supabase_private_storage_bucket="private", signed_url_ttl_seconds=3600)),
            patch("app.api.album.get_album_record", return_value=self.record),
            patch("app.api.album.get_album_detail_light_record", return_value=self.record),
            patch("app.api.album.get_album_photo_records", return_value=self.photos),
            patch("app.api.album.get_album_photo_records_by_ids",
                  side_effect=lambda _c, _a, ids: [p for p in self.photos if p["id"] in set(map(str, ids))]),
            patch("app.api.album.list_photo_memories", return_value=[]),
            patch("app.api.album.list_contributors",
                  return_value=[{"id": OWNER, "role": "owner"}, {"id": GUEST, "role": "contributor"}]),
            patch("app.api.album.count_ready_album_photos", return_value=len(self.photos)),
            patch("app.api.album.count_album_photo_memories", return_value=0),
            patch("app.api.album.get_album_access", return_value=AlbumAccess(
                family_role="owner", album_role="owner", is_legacy_owner=True)),
            patch("app.api.album._batch_signed_urls_for_photos", return_value={}),
            patch("app.api.album.get_signed_url", side_effect=lambda *a, **k: "https://cdn/x.jpg"),
            patch("app.api.album.get_result_signed_url", return_value=""),
        ):
            item.start()
            self.addCleanup(item.stop)

    def page_photo_ids(self) -> list[str]:
        response = self.client.get(f"/api/albums/{ALBUM_ID}/living-append-pages")
        self.assertEqual(response.status_code, 200)
        return [
            photo_row["id"]
            for page in response.json()["living_append_pages"]
            for photo_row in page["photos"]
        ]

    def test_주최자가_나중에_더한_사진도_나온다(self) -> None:
        """★ 이것이 사라지던 사진이다. 예전에는 이 목록에 없었다."""
        self.assertIn(OWNER_LATE, self.page_photo_ids())

    def test_참여자가_더한_사진은_그대로_나온다(self) -> None:
        self.assertIn(ON_PAGE, self.page_photo_ids())

    def test_본문에_있는_사진은_페이지에_겹쳐_나오지_않는다(self) -> None:
        self.assertNotIn(DATED, self.page_photo_ids())

    def test_ready_사진은_한_장도_빠지지_않는다(self) -> None:
        """세는 수와 실제로 볼 수 있는 수가 같아야 한다.

        예전에는 photo_count 가 3인데 볼 수 있는 것은 2장이었다 — 숫자와 내용이 어긋났다.
        """
        detail = self.client.get(f"/api/albums/{ALBUM_ID}")
        self.assertEqual(detail.status_code, 200)
        counted = detail.json()["current_edition"]["photo_count"]
        in_body = album_document_photo_ids(self.record["album_json"])
        reachable = in_body | set(self.page_photo_ids())
        self.assertEqual(len(reachable), counted, f"세는 수({counted})와 보이는 수({len(reachable)})가 다르다")
        for row in self.photos:
            self.assertIn(row["id"], reachable, f"{row['id']} 가 어디에도 없다")

    def test_화면이_페이지를_받으러_간다(self) -> None:
        """상세 응답의 living_append_pages 는 비어 있는 것이 정상이다 — 수를 보고 따로 받는다."""
        body = self.client.get(f"/api/albums/{ALBUM_ID}").json()
        self.assertEqual(body["living_append_pages"], [])
        self.assertGreater(body["current_edition"]["living_append_page_count"], 0)

    def test_앨범을_다시_만들지_않아도_돌아온다(self) -> None:
        """읽을 때마다 도는 판정이라, 이미 만들어진 앨범도 다음에 열면 사진이 보인다.

        ★ album_json 을 건드리지 않았는지 함께 확인한다 — 사진을 되살리려고 저장된
          문서를 다시 쓰지 않는다(그건 주최자가 `앨범 다시 구성`으로 할 일이다).
        """
        before = dict(self.record["album_json"])
        self.assertIn(OWNER_LATE, self.page_photo_ids())
        self.assertEqual(self.record["album_json"], before, "읽기만 했는데 문서가 바뀌었다")
