"""앨범 PDF 를 **서버에서 그린다** — 굽지 않는다 (PO 승인 2026-08-22 · 구조 변경).

왜: 전에는 폰이 원본 30장(≈90MB)을 전부 내려받아 한 캔버스에 구운 뒤 192 DPI JPEG 한 장을
쪽마다 넣었다. 받은 것을 다 버리는 셈이고, 그 90MB 를 폰 메모리에 올리는 것이 아이폰이
멈추던 뿌리였다. **원본은 서버에 있다. 원본을 쓰려면 원본이 있는 곳에서 만들어야 한다.**

이 모듈이 하는 것
  · ReportLab 으로 **사진은 한 장씩 놓고, 글자는 벡터로** 넣는다(pdftotext 로 뽑힌다).
  · 사진을 한 장씩 열고 닫는다 — 전부 메모리에 올리지 않는다(Railway 워커가 4개다).
  · 원본이 300 DPI 에 필요한 크기보다 크면 줄여서 넣는다(파일이 무한정 커지지 않는다).
  · 원본을 못 읽으면 display → thumbnail 순으로 내려간다. **그 사진만** 낮아진다.

이번에 하는 것 / 안 하는 것
  한다    한 쪽 1장(A) 하나 — 임시가 아니다(Artifact Uprising Everyday · Apple Monograph).
  안 한다 행 기반 배치 · 2장·3장 쪽(다음 프롬프트) · 화면 렌더링 · OpenAI.

지면 규격 — 업체가 아니라 일반 표준에 맞춘다 (mm)
  재단 200×200 · 여분 3 사방 → 지면 206×206 (재단 표시는 넣지 않는다)
  안전선 재단선 안 5 → 내용은 190×190 안 · 300 DPI · sRGB
  여백(재단 기준) 위 14 · 좌우 14 · 아래 22 → 사진 영역 172×164
  ★ 아래를 위보다 무겁게 — 책 판면의 고전 규칙(Tschichold 2:3:4:6). 숫자를 바꾸지 말 것.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

from PIL import Image, ImageOps
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Paragraph

try:  # HEIC 원본이 남아 있는 옛 앨범을 위해 — 없으면 그냥 지나간다.
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:  # noqa: BLE001
    pass

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────
# 지면 (mm). 값은 여기 한 곳이다.
# ─────────────────────────────────────────────────────────────────────────
TRIM_MM = 200.0
BLEED_MM = 3.0
PAGE_MM = TRIM_MM + BLEED_MM * 2          # 206
SAFE_MM = 5.0                              # 재단선 안 5mm — 글자는 이 안
MARGIN_TOP_MM = 14.0
MARGIN_SIDE_MM = 14.0
MARGIN_BOTTOM_MM = 22.0                    # 아래가 무겁다 — 캡션이 여기 산다
PHOTO_AREA_W_MM = TRIM_MM - MARGIN_SIDE_MM * 2      # 172
PHOTO_AREA_H_MM = TRIM_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM  # 164
DATE_HEAD_MM = 14.0                        # 날짜 머리대 높이(첫 쪽에만) — 화면 인쇄와 같다
DATE_HEAD_GAP_MM = 4.0
PRINT_DPI = 300
# 172mm 에 300 DPI 면 2031.5px. 원본이 이보다 크면 줄여 넣는다 — 올림이라 300 을 밑돌지 않는다.
MAX_PHOTO_LONG_PX = int(PHOTO_AREA_W_MM / 25.4 * PRINT_DPI + 0.999)   # 2032
# 표지는 지면 전체(206mm)를 덮으므로 상한이 더 크다 — 같은 2032 로 두면 251 DPI 가 된다(실측).
MAX_COVER_LONG_PX = int(PAGE_MM / 25.4 * PRINT_DPI + 0.999)          # 2434
JPEG_QUALITY = 90

# 색 — frontend/src/styles/tokens.css 와 같은 값이다(여기서 새 색을 만들지 않는다).
TEXT = HexColor("#2d2d2d")
TEXT_SOFT = HexColor("#5c5250")
TEXT_MUTED = HexColor("#7d716f")
PLACEHOLDER = HexColor("#f4efee")
#: 표지 배경 기본값 — PO 가 본 표지(#1F6B6B · 잡지형)다. 앨범 모양이 있으면 그 강조색을 쓴다.
DEFAULT_ACCENT = "#1f6b6b"
#: 앨범 모양별 강조색 — frontend tokens.css 의 --c-accent 와 같다.
SKIN_ACCENT = {
    "basic": "#3f5b7a", "scrapbook": "#8a2c2c", "airy": "#9a3d63",
    "grid": "#7a5a1f", "magazine": "#1f6b6b", "single": "#6b4a2f",
}
#: 모양을 고르지 않았을 때 분류별 기본 모양 — frontend lib/albumSkin.ts CATEGORY_DEFAULT_SKIN 과 같다.
CATEGORY_DEFAULT_SKIN = {
    "colleague": "basic", "friend": "scrapbook", "couple": "airy", "gathering": "grid",
    "travel": "magazine", "family": "single", "pet": "basic", "other": "basic",
}

# 글자 크기(pt) — frontend PrintPages.css 의 --print-* 와 같은 값이다.
PT_COVER_TITLE = 28
PT_COVER_PERIOD = 12
PT_DATE_NUMBER = 40.7
PT_DATE_HEADING = 11
PT_DATE_META = 10.2
PT_CAPTION = 9
PT_STORY_TITLE = 12
PT_STORY_BODY = 9.5
PT_EPILOGUE_TITLE = 15
PT_EPILOGUE_BODY = 9.5
PT_CONTRIBUTORS = 10.5
PT_COUNT_VALUE = 26.6
PT_COUNT_LABEL = 10.2
PT_LAST_ASK = 16.8
PT_LAST_BODY = 11.1
PT_BRAND_ID = 9
LEADING_BODY = 1.6
LEADING_TITLE = 1.3
LEADING_STORY = 1.75
MEASURE_MM = 122.0                         # 이야기 글줄 폭(3열) — 그보다 넓으면 안 읽힌다

# 브랜드 문구 — frontend/src/lib/brand.ts 와 **같은 글자**다. 두 곳에 있지만 한쪽만
# 바뀌면 검사(test_album_pdf_service)가 잡는다. 없는 것을 약속하지 않는다(§10).
BRAND_NAME_KO = "우리앨범"
BRAND_NAME_EN = "woorialbum"
BRAND_SITE_URL = "woorialbum.com"
BRAND_LAST_PAGE_ASK = "우리도 만들어볼까?"
BRAND_LAST_PAGE_BODY = f"{BRAND_NAME_KO}은 여러 사람이 사진을 함께 모아 한 권으로 묶는 서비스입니다."

FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"
FONT_REGULAR = "NotoSansKR"
FONT_BOLD = "NotoSansKR-Bold"


@dataclass
class PdfPhoto:
    id: str
    caption: str | None
    taken_at: str | None            # ISO 문자열. 없으면 None
    location_name: str | None
    sort_order: int
    #: 읽을 순서대로 (bucket, path). 앞이 원본, 못 읽으면 다음으로.
    sources: list[tuple[str, str]] = field(default_factory=list)

    @property
    def date_key(self) -> str | None:
        value = str(self.taken_at or "")
        return value[:10] if len(value) >= 10 else None


@dataclass
class PdfAlbum:
    title: str
    epilogue: str
    chapter_stories: dict[str, str]
    photos: list[PdfPhoto]
    contributor_names: list[str]
    accent_hex: str = DEFAULT_ACCENT
    cover_photo_id: str | None = None


@dataclass
class PdfBuildReport:
    """검사와 로그가 읽는 것 — 무엇을 어느 크기로 놓았는가."""

    pages: list[dict[str, Any]] = field(default_factory=list)
    failed_photo_ids: list[str] = field(default_factory=list)
    seconds: float = 0.0


ImageLoader = Callable[[str, str], bytes]  # (bucket, path) -> bytes · 못 읽으면 예외


# ─────────────────────────────────────────────────────────────────────────
# 글꼴
# ─────────────────────────────────────────────────────────────────────────
def ensure_fonts() -> None:
    """Noto Sans KR(OFL) 둘 — 본문·굵게. 셋 이상 넣지 않는다(파일만 커진다).

    ★ 화면은 기기 글꼴(Apple SD Gothic Neo · Malgun Gothic)을 쓴다 — 종이에는 기기가
      없으니 하나를 골라 심어야 한다. Pretendard 는 TrueType 정적 판을 배포하지 않아
      (OTF/CFF 는 ReportLab 이 못 심는다) Noto Sans KR 로 골랐다. 가변 글꼴에서
      정적 두 판을 뽑았다(assets/fonts/README.md).
    """
    if FONT_REGULAR in pdfmetrics.getRegisteredFontNames():
        return
    regular = FONT_DIR / "NotoSansKR-Regular.ttf"
    bold = FONT_DIR / "NotoSansKR-Bold.ttf"
    if not regular.exists() or not bold.exists():
        raise RuntimeError(f"한글 글꼴이 없습니다: {FONT_DIR}")
    pdfmetrics.registerFont(TTFont(FONT_REGULAR, str(regular)))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold)))


def _style(size: float, *, bold: bool = False, leading: float = LEADING_BODY, color=TEXT, align=TA_LEFT) -> ParagraphStyle:
    return ParagraphStyle(
        name=f"s{size}{'b' if bold else ''}{align}",
        fontName=FONT_BOLD if bold else FONT_REGULAR,
        fontSize=size,
        leading=size * leading,
        textColor=color,
        alignment=align,
        wordWrap="CJK",   # 한글은 글자 단위로 접는다
    )


def _escape(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _draw_paragraph(c: pdf_canvas.Canvas, text: str, style: ParagraphStyle, x_mm: float, top_mm: float, w_mm: float, max_h_mm: float) -> float:
    """왼쪽 x · **위쪽** y 기준으로 문단을 그린다. 그린 높이(mm)를 돌려준다.
    상한을 넘는 글은 그 자리에서 멈춘다(다음 쪽으로 흘리지 않는다 — 한 쪽 규칙)."""
    para = Paragraph(_escape(text), style)
    _w, h = para.wrap(w_mm * mm, max_h_mm * mm)
    if h > max_h_mm * mm:
        # 넘치면 줄여서라도 한 쪽에 둔다 — 잘라 버리는 것보다 낫다.
        para = Paragraph(_escape(text), ParagraphStyle(name=style.name + "s", parent=style, fontSize=style.fontSize * 0.9, leading=style.leading * 0.9))
        _w, h = para.wrap(w_mm * mm, max_h_mm * mm)
    para.drawOn(c, x_mm * mm, (top_mm * mm) - h)
    return h / mm


# ─────────────────────────────────────────────────────────────────────────
# 사진
# ─────────────────────────────────────────────────────────────────────────
def _prepare_image(data: bytes, max_long_px: int) -> tuple[ImageReader, int, int]:
    """바이트를 열어 EXIF 방향을 펴고, 필요하면 줄여서 JPEG 로 다시 싼다.
    ★ with 로 열고 바로 닫는다 — 한 장 끝나면 메모리에 남는 것은 작은 JPEG 바이트뿐이다."""
    with Image.open(BytesIO(data)) as opened:
        image = ImageOps.exif_transpose(opened) or opened
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        width, height = image.size
        scale = min(1.0, max_long_px / max(width, height))
        if scale < 1.0:
            image = image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        out_w, out_h = image.size
    buffer.seek(0)
    return ImageReader(buffer), out_w, out_h


def _load_photo(photo: PdfPhoto, loader: ImageLoader, max_long_px: int) -> tuple[ImageReader, int, int, str] | None:
    """원본 → display → thumbnail 순으로 읽는다. 전부 실패하면 None — 그 사진만 빈 자리다."""
    for bucket, path in photo.sources:
        if not bucket or not path:
            continue
        try:
            reader, w, h = _prepare_image(loader(bucket, path), max_long_px)
            return reader, w, h, path
        except Exception as exc:  # noqa: BLE001 - 다음 후보로 내려간다
            logger.warning("album_pdf_photo_unreadable photo=%s path=%s error=%s", photo.id, path, type(exc).__name__)
    return None


def _fit_contain(img_w: int, img_h: int, box_w_mm: float, box_h_mm: float) -> tuple[float, float]:
    scale = min(box_w_mm / img_w, box_h_mm / img_h)
    return img_w * scale, img_h * scale


# ─────────────────────────────────────────────────────────────────────────
# 쪽
# ─────────────────────────────────────────────────────────────────────────
def _date_number(date_key: str) -> str:
    _y, m, d = date_key.split("-")
    return f"{int(m)}.{int(d)}"


def _date_meta(date_key: str, count: int) -> str:
    parts = [f"{int(date_key[:4])}년"]
    if count > 0:
        parts.append(f"사진 {count}장")
    return " · ".join(parts)


def _dot_date(date_key: str) -> str:
    return date_key.replace("-", ".")


def _group_by_date(photos: list[PdfPhoto]) -> list[tuple[str | None, list[PdfPhoto]]]:
    """촬영일로 묶는다 — 날짜 없는 사진은 맨 뒤 한 묶음. 순서는 sort_order 다."""
    ordered = sorted(photos, key=lambda p: (p.date_key is None, p.date_key or "", p.sort_order))
    groups: list[tuple[str | None, list[PdfPhoto]]] = []
    for photo in ordered:
        if groups and groups[-1][0] == photo.date_key:
            groups[-1][1].append(photo)
        else:
            groups.append((photo.date_key, [photo]))
    return groups


def _draw_cover(c: pdf_canvas.Canvas, album: PdfAlbum, loader: ImageLoader, report: PdfBuildReport) -> None:
    """표지 — 사진 하나가 재단선 바깥 3mm 까지 덮는다(여기만 자른다). 배경 강조색 · 제목 · 날짜."""
    accent = HexColor(album.accent_hex or DEFAULT_ACCENT)
    c.setFillColor(accent)
    c.rect(0, 0, PAGE_MM * mm, PAGE_MM * mm, stroke=0, fill=1)

    cover = next((p for p in album.photos if p.id == album.cover_photo_id), None) or (album.photos[0] if album.photos else None)
    photo_top_mm = PAGE_MM
    photo_bottom_mm = 80.0
    if cover:
        loaded = _load_photo(cover, loader, MAX_COVER_LONG_PX)
        if loaded:
            reader, w, h, _path = loaded
            box_w, box_h = PAGE_MM, photo_top_mm - photo_bottom_mm
            # cover: 짧은 쪽을 맞추고 넘치는 쪽을 자른다 — 재단선 밖 3mm 까지 덮는다.
            scale = max(box_w / w, box_h / h)
            draw_w, draw_h = w * scale, h * scale
            c.saveState()
            path = c.beginPath()
            path.rect(0, photo_bottom_mm * mm, box_w * mm, box_h * mm)
            c.clipPath(path, stroke=0)
            c.drawImage(reader, ((box_w - draw_w) / 2) * mm, (photo_bottom_mm + (box_h - draw_h) / 2) * mm,
                        draw_w * mm, draw_h * mm, preserveAspectRatio=False, mask="auto")
            c.restoreState()
            report.pages.append({"kind": "cover", "photo_id": cover.id, "image_px": (w, h), "drawn_mm": (round(draw_w, 1), round(draw_h, 1))})
            del reader
        else:
            report.failed_photo_ids.append(cover.id)
            report.pages.append({"kind": "cover", "photo_id": cover.id, "image_px": None})
    else:
        report.pages.append({"kind": "cover", "photo_id": None, "image_px": None})

    # 제목 · 기간 · 함께한 사람 — 흰 글자, 아래 띠.
    inner_x = BLEED_MM + MARGIN_SIDE_MM
    inner_w = PHOTO_AREA_W_MM
    _draw_paragraph(c, album.title or BRAND_NAME_KO, _style(PT_COVER_TITLE, bold=True, leading=LEADING_TITLE, color=white), inner_x, 62, inner_w, 30)
    dates = sorted({p.date_key for p in album.photos if p.date_key})
    if dates:
        period = _dot_date(dates[0]) if len(dates) == 1 else f"{_dot_date(dates[0])} – {_dot_date(dates[-1])}"
        _draw_paragraph(c, period, _style(PT_COVER_PERIOD, color=white), inner_x, 40, inner_w, 10)
    if album.contributor_names:
        _draw_paragraph(c, " · ".join(album.contributor_names), _style(PT_CONTRIBUTORS, color=white), inner_x, 31, inner_w, 10)
    c.showPage()


def _draw_date_head(c: pdf_canvas.Canvas, date_key: str | None, photos: list[PdfPhoto], top_mm: float) -> None:
    """날짜 머리 **B안** — 큰 날짜 숫자 + 장소 제목 + 아래 한 줄 (PO 가 좋다고 한 모양 그대로).
         7.8
         속초, 비 오는 바다
         2018년 · 사진 2장
    ★ 화면 인쇄는 큰 숫자에 라틴 세리프(EB Garamond)를 썼다. 서버에는 글꼴을 둘만 심으므로
      Noto Sans KR 로 그린다 — 크기·자리는 같다. (달라진 점으로 보고한다.)"""
    x = BLEED_MM + MARGIN_SIDE_MM
    if not date_key:
        c.setFont(FONT_REGULAR, PT_DATE_HEADING)
        c.setFillColor(TEXT)
        c.drawString(x * mm, (top_mm - 6) * mm, "날짜를 모르는 사진")
        return
    c.setFillColor(TEXT)
    c.setFont(FONT_REGULAR, PT_DATE_NUMBER)
    number = _date_number(date_key)
    baseline = top_mm - DATE_HEAD_MM + 1.5
    c.drawString(x * mm, baseline * mm, number)
    number_w = pdfmetrics.stringWidth(number, FONT_REGULAR, PT_DATE_NUMBER) / mm
    text_x = x + number_w + 4
    place = next((p.location_name for p in photos if p.location_name), None)
    if place:
        c.setFont(FONT_REGULAR, PT_DATE_HEADING)
        c.drawString(text_x * mm, (baseline + 5.2) * mm, place)
    c.setFont(FONT_REGULAR, PT_DATE_META)
    c.setFillColor(TEXT_SOFT)
    c.drawString(text_x * mm, baseline * mm, _date_meta(date_key, len(photos)))


def _draw_photo_page(c: pdf_canvas.Canvas, photo: PdfPhoto, loader: ImageLoader, report: PdfBuildReport, *,
                     head: tuple[str | None, list[PdfPhoto]] | None) -> None:
    """한 쪽 1장 + 캡션. 첫 쪽이면 위에 날짜 머리가 선다."""
    area_x = BLEED_MM + MARGIN_SIDE_MM
    area_top = PAGE_MM - BLEED_MM - MARGIN_TOP_MM          # 189
    area_bottom = BLEED_MM + MARGIN_BOTTOM_MM                # 25
    if head is not None:
        _draw_date_head(c, head[0], head[1], area_top)
        area_top -= DATE_HEAD_MM + DATE_HEAD_GAP_MM
    box_w = PHOTO_AREA_W_MM
    box_h = area_top - area_bottom

    loaded = _load_photo(photo, loader, MAX_PHOTO_LONG_PX)
    if loaded:
        reader, w, h, _path = loaded
        draw_w, draw_h = _fit_contain(w, h, box_w, box_h)
        x = area_x + (box_w - draw_w) / 2
        y = area_top - draw_h                                # 위에서부터 채운다(I-4c)
        c.drawImage(reader, x * mm, y * mm, draw_w * mm, draw_h * mm, preserveAspectRatio=False, mask="auto")
        report.pages.append({"kind": "photo", "photo_id": photo.id, "image_px": (w, h), "drawn_mm": (round(draw_w, 1), round(draw_h, 1))})
        del reader
    else:
        # 한 장 때문에 전체가 실패하지 않는다 — 조용한 면 하나에 캡션은 그대로 둔다.
        report.failed_photo_ids.append(photo.id)
        c.setFillColor(PLACEHOLDER)
        c.rect(area_x * mm, area_bottom * mm, box_w * mm, box_h * mm, stroke=0, fill=1)
        report.pages.append({"kind": "photo", "photo_id": photo.id, "image_px": None, "drawn_mm": (box_w, box_h)})

    caption = (photo.caption or "").strip()
    if caption:
        # 캡션은 아래 여백(22mm)에 산다 — 그래서 아래가 무겁다.
        _draw_paragraph(c, caption, _style(PT_CAPTION, bold=True, leading=LEADING_TITLE, color=TEXT),
                        area_x, area_bottom - 4, box_w, MARGIN_BOTTOM_MM - SAFE_MM - 4)
    c.showPage()


def _draw_story_page(c: pdf_canvas.Canvas, date_key: str, body: str, report: PdfBuildReport) -> None:
    x = BLEED_MM + MARGIN_SIDE_MM + (PHOTO_AREA_W_MM - MEASURE_MM) / 2
    top = PAGE_MM - BLEED_MM - MARGIN_TOP_MM
    used = _draw_paragraph(c, f"{_dot_date(date_key)}의 이야기", _style(PT_STORY_TITLE, bold=True, leading=LEADING_TITLE), x, top, MEASURE_MM, 12)
    _draw_paragraph(c, body, _style(PT_STORY_BODY, leading=LEADING_STORY, color=TEXT), x, top - used - 4, MEASURE_MM, PHOTO_AREA_H_MM - used - 4)
    report.pages.append({"kind": "story", "date_key": date_key})
    c.showPage()


def _draw_closing_page(c: pdf_canvas.Canvas, album: PdfAlbum, dated_days: int, report: PdfBuildReport) -> None:
    """우리의 이야기 + 숫자 요약(만난 날 · 실린 사진 · 함께한 사람) + 함께 만든 사람 한 줄."""
    area_x = BLEED_MM + MARGIN_SIDE_MM
    x = area_x + (PHOTO_AREA_W_MM - MEASURE_MM) / 2
    top = PAGE_MM - BLEED_MM - MARGIN_TOP_MM
    used = _draw_paragraph(c, "우리의 이야기", _style(PT_EPILOGUE_TITLE, bold=True, leading=LEADING_TITLE, align=TA_CENTER), x, top, MEASURE_MM, 12)
    y = top - used - 6
    if album.epilogue.strip():
        used = _draw_paragraph(c, album.epilogue.strip(), _style(PT_EPILOGUE_BODY, leading=LEADING_STORY, align=TA_CENTER), x, y, MEASURE_MM, 90)
        y -= used + 12
    counts = [("만난 날", dated_days), ("실린 사진", len(album.photos)), ("함께한 사람", len(album.contributor_names))]
    col_w = MEASURE_MM / len(counts)
    for index, (label, value) in enumerate(counts):
        cx = x + col_w * index
        _draw_paragraph(c, str(value), _style(PT_COUNT_VALUE, bold=True, leading=LEADING_TITLE, align=TA_CENTER), cx, y, col_w, 14)
        _draw_paragraph(c, label, _style(PT_COUNT_LABEL, color=TEXT_MUTED, align=TA_CENTER), cx, y - 12, col_w, 8)
    y -= 26
    if album.contributor_names:
        _draw_paragraph(c, "함께 만든 사람 — " + " · ".join(album.contributor_names),
                        _style(PT_CONTRIBUTORS, color=TEXT_SOFT, align=TA_CENTER), area_x, y, PHOTO_AREA_W_MM, 20)
    report.pages.append({"kind": "closing"})
    c.showPage()


def _draw_last_page(c: pdf_canvas.Canvas, report: PdfBuildReport) -> None:
    """맺음 — **무게를 아래에**. 위는 비운다. 로고 대신 활자 한 줄 · 주소. 광고가 아니라 조용한 안내다."""
    area_x = BLEED_MM + MARGIN_SIDE_MM
    bottom = BLEED_MM + MARGIN_BOTTOM_MM
    _draw_paragraph(c, BRAND_LAST_PAGE_ASK, _style(PT_LAST_ASK, bold=True, leading=LEADING_TITLE), area_x, bottom + 44, PHOTO_AREA_W_MM, 12)
    _draw_paragraph(c, BRAND_LAST_PAGE_BODY, _style(PT_LAST_BODY, color=TEXT_SOFT), area_x, bottom + 33, PHOTO_AREA_W_MM, 20)
    _draw_paragraph(c, BRAND_NAME_EN, _style(PT_BRAND_ID, color=TEXT_MUTED), area_x, bottom + 10, PHOTO_AREA_W_MM, 6)
    _draw_paragraph(c, BRAND_SITE_URL, _style(PT_BRAND_ID, color=TEXT_MUTED), area_x, bottom + 5, PHOTO_AREA_W_MM, 6)
    report.pages.append({"kind": "last"})
    c.showPage()


# ─────────────────────────────────────────────────────────────────────────
# 조립
# ─────────────────────────────────────────────────────────────────────────
def build_album_pdf(album: PdfAlbum, loader: ImageLoader) -> tuple[bytes, PdfBuildReport]:
    """쪽 차례: 표지 → (날짜 머리 → 사진 쪽들 → 그 날짜의 이야기)… → 우리의 이야기 → 맺음."""
    ensure_fonts()
    started = time.perf_counter()
    report = PdfBuildReport()
    buffer = BytesIO()
    # initialFontName — 안 주면 ReportLab 이 쪽마다 Helvetica(심기지 않는 표준 글꼴)를 적어
    # 둔다. 쓰지도 않는 글꼴이 인쇄소 검사에 `미포함` 으로 걸린다(실측 · pypdf).
    c = pdf_canvas.Canvas(buffer, pagesize=(PAGE_MM * mm, PAGE_MM * mm), initialFontName=FONT_REGULAR)
    c.setTitle(album.title or BRAND_NAME_KO)
    c.setAuthor(BRAND_NAME_KO)

    _draw_cover(c, album, loader, report)
    groups = _group_by_date(album.photos)
    for date_key, photos in groups:
        for index, photo in enumerate(photos):
            _draw_photo_page(c, photo, loader, report, head=(date_key, photos) if index == 0 else None)
        story = album.chapter_stories.get(date_key or "", "").strip() if date_key else ""
        if story:
            _draw_story_page(c, date_key, story, report)
    dated_days = sum(1 for date_key, _ in groups if date_key)
    _draw_closing_page(c, album, dated_days, report)
    _draw_last_page(c, report)
    c.save()

    report.seconds = round(time.perf_counter() - started, 2)
    content = buffer.getvalue()
    logger.info(
        "album_pdf_built photos=%s pages=%s failed=%s seconds=%s bytes=%s",
        len(album.photos), len(report.pages), len(report.failed_photo_ids), report.seconds, len(content),
    )
    return content, report


# ─────────────────────────────────────────────────────────────────────────
# DB 행 → PdfAlbum (API 가 부른다)
# ─────────────────────────────────────────────────────────────────────────
def accent_for(record: dict[str, Any]) -> str:
    skin = str(record.get("skin") or "").strip().lower()
    if not skin:
        skin = CATEGORY_DEFAULT_SKIN.get(str(record.get("category") or "").strip().lower(), "")
    return SKIN_ACCENT.get(skin, DEFAULT_ACCENT)


def album_from_records(record: dict[str, Any], photo_rows: list[dict[str, Any]],
                       contributor_names: list[str], stories: dict[str, str]) -> PdfAlbum:
    photos = [
        PdfPhoto(
            id=str(row.get("id")),
            caption=(str(row.get("caption") or "").strip() or None),
            taken_at=(str(row.get("taken_at")) if row.get("taken_at") else None),
            location_name=(str(row.get("location_name") or "").strip() or None),
            sort_order=int(row.get("sort_order") or 0),
            sources=[
                (str(row.get("storage_bucket") or ""), str(row.get("storage_path") or "")),
                (str(row.get("display_bucket") or ""), str(row.get("display_path") or "")),
                (str(row.get("thumbnail_bucket") or ""), str(row.get("thumbnail_path") or "")),
            ],
        )
        for row in photo_rows
    ]
    return PdfAlbum(
        title=str(record.get("title") or "").strip() or BRAND_NAME_KO,
        epilogue=str(record.get("epilogue") or record.get("narrative") or "").strip(),
        chapter_stories={str(k): str(v) for k, v in (stories or {}).items()},
        photos=photos,
        contributor_names=[name for name in contributor_names if str(name).strip()],
        accent_hex=accent_for(record),
        cover_photo_id=(str(record.get("cover_photo_id")) if record.get("cover_photo_id") else None),
    )
