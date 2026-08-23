"""PDF 를 **서버에서 그린다** — 굽지 않는다 (PO 승인 2026-08-22 · 구조 변경).

★ 눈으로 보고 넘기지 않는다. **숫자로 잰다.** 실제로 PDF 를 만들어 pypdf 로 열어 본다:
  · 지면이 206×206mm 인가
  · 심긴 사진이 300 DPI 이상인가 (원본이 그만큼 클 때)
  · 캡션·이야기·맺음 글자가 **벡터**인가 (글자로 뽑히는가 — 그림이면 안 뽑힌다)
  · 쪽 차례가 표지 → (날짜 머리 → 사진 쪽들 → 이야기) → 우리의 이야기 → 맺음 인가
  · 사진 한 장이 깨져도 **나머지가 다 나오는가**
  · 브랜드 문구가 프런트 brand.ts 와 같은 글자인가 (없는 것을 약속하지 않는다)
"""

from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader

from app.services import album_pdf_service as svc
from app.services.album_pdf_service import PdfAlbum, PdfPhoto, album_from_records, build_album_pdf

PT_PER_MM = 72 / 25.4
FRONTEND_BRAND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "brand.ts"
FRONTEND_LAYOUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "pdfPageBreak.ts"

# 프런트 검사(printCaptionFull)가 잘리지 않는지 보던 그 문장 — 서버에서도 통째로 나와야 한다.
LONG_CAPTION = "숙소 앞 돌담. 여기서 한참 서 있었다. 아무도 먼저 들어가자는 말을 안 했다. 바람이 차가웠는데도 셋 다 그냥 서서 바다 쪽만 봤다."
STORY_1 = "첫날은 돌담 앞에서 오래 서 있었다. 바람이 찼고, 셋 다 바다를 봤다."
STORY_2 = "둘째 날 아침엔 해가 먼저 떴다. 숙소 마당에서 커피를 나눠 마셨다."
EPILOGUE = "이 여행은 셋이서 처음 간 것이었고, 아마 마지막은 아닐 것이다."


def _jpeg(width: int, height: int, color=(120, 90, 60)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


# 원본 크기 — 172mm 에 300 DPI 는 2032px 이다. 그보다 **큰** 원본이어야 300 이 나온다.
IMAGES = {
    "orig/p1.jpg": _jpeg(3000, 2000),      # 가로 · 크다 → 줄여 넣는다
    "orig/p2.jpg": _jpeg(2100, 2800),      # 세로 · 크다
    "orig/p3.jpg": _jpeg(2600, 2600),      # 정사각
    "disp/p4.webp": _jpeg(1600, 1200),     # p4 는 원본이 깨졌다 → display 로 내려간다
}


def loader(bucket: str, path: str) -> bytes:
    if path.startswith("broken/"):
        raise RuntimeError("storage 404")
    if path not in IMAGES:
        raise RuntimeError(f"no such object {path}")
    return IMAGES[path]


def sample_album() -> PdfAlbum:
    return PdfAlbum(
        title="제주 셋이서",
        epilogue=EPILOGUE,
        chapter_stories={"2018-11-18": STORY_1, "2018-11-19": STORY_2},
        photos=[
            PdfPhoto("p1", LONG_CAPTION, "2018-11-18T09:00:00+09:00", "제주 구좌", 1, [("originals", "orig/p1.jpg")]),
            PdfPhoto("p2", "돌담 위 고양이", "2018-11-18T11:00:00+09:00", None, 2, [("originals", "orig/p2.jpg")]),
            PdfPhoto("p3", None, "2018-11-19T08:00:00+09:00", None, 3, [("originals", "orig/p3.jpg")]),
            # 원본은 깨졌고 display 는 있다 — 그 사진만 화질이 낮아진다.
            PdfPhoto("p4", "아침 커피", "2018-11-19T09:00:00+09:00", None, 4, [("originals", "broken/p4.jpg"), ("display", "disp/p4.webp")]),
            # 전부 깨졌다 — 자리만 남고 나머지는 다 나와야 한다.
            PdfPhoto("p5", "없는 사진", "2018-11-19T10:00:00+09:00", None, 5, [("originals", "broken/p5.jpg"), ("display", "broken/p5.webp")]),
        ],
        contributor_names=["곽병준", "영희", "준3"],
        cover_photo_id="p1",
    )


def _dpi(page: dict) -> float:
    (px_w, _px_h), (mm_w, _mm_h) = page["image_px"], page["drawn_mm"]
    return px_w / (mm_w / 25.4)


class AlbumPdfBuildTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.content, cls.report = build_album_pdf(sample_album(), loader)
        cls.reader = PdfReader(BytesIO(cls.content))
        cls.texts = [page.extract_text() or "" for page in cls.reader.pages]

    def test_지면은_206x206mm_다_재단_200_여분_3(self) -> None:
        self.assertEqual(svc.PAGE_MM, 206)
        self.assertEqual((svc.TRIM_MM, svc.BLEED_MM, svc.SAFE_MM), (200, 3, 5))
        # ★ 숫자를 바꾸지 말 것 — Tschichold. 위 14 · 좌우 14 · 아래 22 → 사진 영역 172×164.
        self.assertEqual((svc.MARGIN_TOP_MM, svc.MARGIN_SIDE_MM, svc.MARGIN_BOTTOM_MM), (14, 14, 22))
        self.assertEqual((svc.PHOTO_AREA_W_MM, svc.PHOTO_AREA_H_MM), (172, 164))
        for page in self.reader.pages:
            box = page.mediabox
            self.assertAlmostEqual(float(box.width) / PT_PER_MM, 206.0, places=1)
            self.assertAlmostEqual(float(box.height) / PT_PER_MM, 206.0, places=1)

    def test_쪽_차례(self) -> None:
        kinds = [page["kind"] for page in self.report.pages]
        self.assertEqual(kinds, [
            "cover",
            "photo", "photo", "story",            # 11.18 — 머리(첫 사진 쪽) · 사진 · 이야기
            "photo", "photo", "photo", "story",   # 11.19
            "closing", "last",
        ])
        self.assertEqual(len(self.reader.pages), len(kinds))
        # 첫 쪽은 표지이고, 마지막 둘은 우리의 이야기와 맺음이다.
        self.assertIn("제주 셋이서", self.texts[0])
        self.assertIn("우리의 이야기", self.texts[-2])
        self.assertIn(svc.BRAND_SITE_URL, self.texts[-1])

    def test_심긴_사진은_300_DPI_이상이다_원본이_그만큼_클_때(self) -> None:
        photo_pages = {page["photo_id"]: page for page in self.report.pages if page["kind"] == "photo" and page["image_px"]}
        for photo_id in ("p1", "p2", "p3"):
            self.assertGreaterEqual(_dpi(photo_pages[photo_id]), 300, photo_id)
            # 무한정 크게 넣지도 않는다 — 필요한 만큼만(상한 2032px).
            self.assertLessEqual(max(photo_pages[photo_id]["image_px"]), svc.MAX_PHOTO_LONG_PX)
        # 표지도 300 이다 — 지면 전체를 덮으므로 상한이 다르다(2434px).
        cover = self.report.pages[0]
        self.assertEqual(cover["kind"], "cover")
        self.assertGreaterEqual(_dpi(cover), 300)
        # p4 는 display(1600px)로 내려갔다 — **그 사진만** 낮다. 키우지 않는다(가짜 화질).
        self.assertLess(_dpi(photo_pages["p4"]), 300)
        self.assertEqual(photo_pages["p4"]["image_px"][0], 1600)

    def test_글자는_벡터다_뽑힌다(self) -> None:
        joined = "\n".join(self.texts)
        # 캡션 — 긴 것도 **통째로**(프런트 printCaptionFull 이 지키던 그 문장).
        self.assertIn(LONG_CAPTION, joined.replace("\n", ""))
        self.assertIn("돌담 위 고양이", joined)
        # 날짜 이야기 — 제목과 본문.
        self.assertIn("2018.11.18의 이야기", joined)
        self.assertIn(STORY_1, joined.replace("\n", ""))
        # 우리의 이야기 · 함께 만든 사람 한 줄 (§6 — 인쇄물에 남는 자리).
        self.assertIn(EPILOGUE, joined.replace("\n", ""))
        self.assertIn("함께 만든 사람 — 곽병준 · 영희 · 준3", joined)
        # 맺음.
        self.assertIn(svc.BRAND_LAST_PAGE_ASK, joined)
        self.assertIn(svc.BRAND_NAME_EN, joined)

    def test_한_장이_깨져도_나머지는_다_나온다(self) -> None:
        self.assertEqual(self.report.failed_photo_ids, ["p5"])
        broken = [page for page in self.report.pages if page.get("photo_id") == "p5"]
        self.assertEqual(len(broken), 1)
        self.assertIsNone(broken[0]["image_px"])          # 자리만 남았다
        self.assertIn("없는 사진", "\n".join(self.texts))  # 캡션은 그대로 나온다
        self.assertEqual(len(self.reader.pages), 10)

    def test_걸린_초와_사진_수를_잰다(self) -> None:
        self.assertGreater(self.report.seconds, 0)
        # 다섯 장에 몇 초가 걸리면 안 된다 — 30장이 1분을 넘기면 화면 시간 제한에 걸린다.
        self.assertLess(self.report.seconds, 20)

    def test_글꼴은_둘뿐이고_심겨_있다(self) -> None:
        fonts = set()
        for page in self.reader.pages:
            resources = page.get("/Resources") or {}
            for _name, font in (resources.get("/Font") or {}).items():
                fonts.add(str(font.get_object().get("/BaseFont")))
        # 둘뿐이고 이름이 바르다(가변 글꼴에서 뽑은 판이라 이름표가 Thin 으로 남아 있었다 — 고쳤다).
        # Helvetica 같은 표준 글꼴이 끼어 있으면 안 된다 — 심기지 않아 인쇄소 검사에 걸린다.
        self.assertEqual({name.split("+")[-1] for name in fonts}, {"NotoSansKR-Regular", "NotoSansKR-Bold"}, fonts)


class BrandAndLayoutContractTests(TestCase):
    """두 곳에 있는 글자·숫자가 **같은가** — 한쪽만 바뀌면 여기서 잡는다."""

    def test_브랜드_문구는_프런트_brand_ts_와_같은_글자다(self) -> None:
        source = FRONTEND_BRAND.read_text(encoding="utf-8")
        def front(name: str) -> str:
            match = re.search(rf'export const {name} = (?:"([^"]*)"|`([^`]*)`);', source)
            assert match, name
            return (match.group(1) if match.group(1) is not None else match.group(2)).replace("${BRAND_NAME_KO}", svc.BRAND_NAME_KO)
        self.assertEqual(svc.BRAND_NAME_KO, front("BRAND_NAME_KO"))
        self.assertEqual(svc.BRAND_NAME_EN, front("BRAND_NAME_EN"))
        self.assertEqual(svc.BRAND_SITE_URL, front("BRAND_SITE_URL"))
        self.assertEqual(svc.BRAND_LAST_PAGE_ASK, front("BRAND_LAST_PAGE_ASK"))
        self.assertEqual(svc.BRAND_LAST_PAGE_BODY, front("BRAND_LAST_PAGE_BODY"))

    def test_판형_판은_프런트와_같다_서버가_그리는_첫_판이_3이다(self) -> None:
        from app.api.album import SERVER_PDF_LAYOUT
        source = FRONTEND_LAYOUT.read_text(encoding="utf-8")
        front = int(re.search(r"export const PRINT_LAYOUT_VERSION = (\d+);", source).group(1))
        self.assertEqual(front, SERVER_PDF_LAYOUT)
        self.assertEqual(SERVER_PDF_LAYOUT, 3)
        self.assertIn("3 = 서버에서 그린다", source)


class AlbumFromRecordsTests(TestCase):
    def test_행을_그대로_옮긴다_원본_display_thumbnail_차례(self) -> None:
        album = album_from_records(
            {"title": " 우리 ", "epilogue": "끝", "skin": "magazine", "cover_photo_id": "p1"},
            [{"id": "p1", "caption": " 캡션 ", "taken_at": "2024-01-02T03:04:05+00:00", "sort_order": 2,
              "storage_bucket": "o", "storage_path": "a.jpg", "display_bucket": "d", "display_path": "a.webp",
              "thumbnail_bucket": "t", "thumbnail_path": "a_t.webp"}],
            ["가", " ", "나"], {"2024-01-02": "이야기"},
        )
        self.assertEqual(album.title, "우리")
        self.assertEqual(album.accent_hex, "#1f6b6b")
        self.assertEqual(album.contributor_names, ["가", "나"])
        self.assertEqual(album.photos[0].caption, "캡션")
        self.assertEqual(album.photos[0].date_key, "2024-01-02")
        self.assertEqual(album.photos[0].sources, [("o", "a.jpg"), ("d", "a.webp"), ("t", "a_t.webp")])

    def test_제목이_없으면_브랜드_이름이다_빈_표지를_만들지_않는다(self) -> None:
        album = album_from_records({"title": ""}, [], [], {})
        self.assertEqual(album.title, svc.BRAND_NAME_KO)


class PdfEndpointBuildsOnMissTests(TestCase):
    """GET /albums/{id}/pdf — 캐시가 없으면 **서버가 만들어** PUT 과 같은 자리에 넣고 url 을 준다."""

    ALBUM_ID = "11111111-1111-1111-1111-111111111111"

    def setUp(self) -> None:
        from app.api.album import router
        from app.services.auth import require_authenticated_user
        from app.services.authorization import AlbumAccess

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_authenticated_user] = lambda: "owner-1"
        self.addCleanup(self.app.dependency_overrides.clear)
        self.client = TestClient(self.app)
        self.record = {"id": self.ALBUM_ID, "album_version": 7, "title": "제주", "pdf_cache": {},
                       "chapter_stories": {"2018-11-18": STORY_1}}
        self.rows = [{"id": "p1", "caption": "돌담", "taken_at": "2018-11-18T09:00:00+09:00", "sort_order": 1,
                      "storage_bucket": "originals", "storage_path": "orig/p1.jpg",
                      "display_bucket": "d", "display_path": "disp/p1.webp", "thumbnail_bucket": "t", "thumbnail_path": "t/p1.webp"}]
        self.uploaded: dict[str, bytes] = {}
        self.saved: dict[str, str] = {}
        storage = MagicMock()
        storage.download.side_effect = loader
        storage.upload.side_effect = lambda bucket, path, content, content_type=None: self.uploaded.__setitem__(path, content)

        def set_cached(_client, _record, key, path, _bucket=None):
            self.saved[key] = path
            self.record["pdf_cache"][key] = {"path": path, "bucket": "private"}

        patch("app.api.album.get_supabase_client", return_value=MagicMock()).start()
        patch("app.api.album.get_album_record", side_effect=lambda *_: self.record).start()
        patch("app.api.album.get_album_access", return_value=AlbumAccess(family_role=None, album_role="owner", is_legacy_owner=False)).start()
        patch("app.api.album.get_album_photo_records", return_value=self.rows).start()
        patch("app.api.album.list_active_contributor_names", return_value=["곽병준"]).start()
        patch("app.api.album.StorageService.for_supabase", return_value=storage).start()
        patch("app.api.album.set_cached_pdf_path", side_effect=set_cached).start()
        self.log_event = patch("app.api.album.log_event").start()
        patch("app.api.album.get_signed_url", side_effect=lambda _c, _b, path, _t: f"https://cdn.test/{path}").start()
        self.addCleanup(patch.stopall)

    def test_캐시가_없으면_서버가_만들어_같은_자리에_넣고_url_을_준다(self) -> None:
        body = self.client.get(f"/api/albums/{self.ALBUM_ID}/pdf?version=7&layout=3").json()
        self.assertEqual(body["cached"], True)
        self.assertIn("/l3-", body["url"])
        # PUT 과 같은 열쇠·같은 파일 이름 규칙이다.
        self.assertEqual(list(self.saved), ["7:r3:l3"])
        (path, content), = self.uploaded.items()
        self.assertIn("/l3-", path)
        self.assertTrue(content.startswith(b"%PDF"))
        reader = PdfReader(BytesIO(content))
        # 표지 · 사진 · 우리의 이야기 · 맺음 — 사진 한 장인 날은 이야기 쪽이 없다(story_rules: 5장부터).
        self.assertEqual(len(reader.pages), 4)
        self.assertIn("돌담", "".join(p.extract_text() for p in reader.pages))
        # 걸린 초와 사진 수가 기록에 남는다.
        _args, kwargs = self.log_event.call_args
        self.assertEqual(kwargs["metadata"]["built_by"], "server")
        self.assertEqual(kwargs["metadata"]["photos"], 1)
        self.assertIn("seconds", kwargs["metadata"])
        # 다음 조회는 만들지 않고 그 파일을 준다.
        again = self.client.get(f"/api/albums/{self.ALBUM_ID}/pdf?version=7&layout=3").json()
        self.assertEqual(again["url"], body["url"])
        self.assertEqual(len(self.uploaded), 1)

    def test_반영하지_않은_사진은_종이에_가지_않는다_A안(self) -> None:
        """화면과 같은 문턱 — 본문(album_json)에 실린 사진만. `새로 더해진` 사진은 빠진다."""
        self.rows.append({"id": "p-appended", "caption": "나중에 올린 사진", "taken_at": "2018-11-19T09:00:00+09:00", "sort_order": 2,
                          "storage_bucket": "originals", "storage_path": "orig/p2.jpg",
                          "display_bucket": "d", "display_path": "x", "thumbnail_bucket": "t", "thumbnail_path": "x"})
        self.record["album_json"] = {"chapters": [{"photos": [{"id": "p1"}]}]}
        self.record["living_append_pages"] = [{"id": "page-1", "photo_ids": ["p-appended"]}]
        self.client.get(f"/api/albums/{self.ALBUM_ID}/pdf?version=7&layout=3").json()
        (_path, content), = self.uploaded.items()
        text = "".join(p.extract_text() for p in PdfReader(BytesIO(content)).pages)
        self.assertIn("돌담", text)
        self.assertNotIn("나중에 올린 사진", text)
        _args, kwargs = self.log_event.call_args
        self.assertEqual(kwargs["metadata"]["photos"], 1)

    def test_옛_판을_물으면_만들지_않는다(self) -> None:
        # 지난 판(version 6) — 지금 앨범과 다르다.
        body = self.client.get(f"/api/albums/{self.ALBUM_ID}/pdf?version=6&layout=3").json()
        self.assertEqual((body["cached"], body["url"]), (False, None))
        # 옛 판형(2) — 화면이 굽던 시절의 열쇠. 옛 화면은 제 길(PUT)로 간다.
        body = self.client.get(f"/api/albums/{self.ALBUM_ID}/pdf?version=7&layout=2").json()
        self.assertEqual((body["cached"], body["url"]), (False, None))
        self.assertEqual(self.uploaded, {})
