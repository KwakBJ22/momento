"""Momento 앨범 이미지 생성.

3가지 감성 템플릿(A: 타임라인, B: 콜라주, C: 스토리북)을 제공한다.
공통적으로 EXIF 회전 보정, 비율 유지 커버-핏, 한글 자동 줄바꿈, 배경 대비
텍스트 색 자동 조정, 일관성 필터를 적용해 사진들이 균등하고 감성적으로 보이게 한다.
"""

from __future__ import annotations

import io
import math
from typing import Any, Sequence

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

FontType = ImageFont.FreeTypeFont | ImageFont.ImageFont

# ---------------------------------------------------------------------------
# 폰트
# ---------------------------------------------------------------------------

_REGULAR_FONTS = [
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "C:/Windows/Fonts/malgun.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
_BOLD_FONTS = [
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "C:/Windows/Fonts/malgunbd.ttf",
    "C:/Windows/Fonts/malgun.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
]


def _load_font(size: int, bold: bool = False) -> FontType:
    for path in _BOLD_FONTS if bold else _REGULAR_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# 이미지 헬퍼
# ---------------------------------------------------------------------------


def _normalize(img: Image.Image, apply_filter: bool = True) -> Image.Image:
    """EXIF 회전 보정 + 색공간 통일 + (옵션) 일관성 필터."""
    img = ImageOps.exif_transpose(img).convert("RGB")
    if apply_filter:
        img = ImageOps.autocontrast(img, cutoff=1)
        img = ImageEnhance.Color(img).enhance(1.07)
        img = ImageEnhance.Contrast(img).enhance(1.03)
        img = ImageEnhance.Brightness(img).enhance(1.02)
    return img


def _fit_cover(img: Image.Image, width: int, height: int) -> Image.Image:
    """비율을 유지하며 대상 영역을 꽉 채우도록 중앙 크롭 후 리사이즈(왜곡 없음)."""
    if width <= 0 or height <= 0:
        return Image.new("RGB", (max(width, 1), max(height, 1)), (238, 232, 226))
    target = width / height
    src = img.width / img.height
    if src > target:
        new_w = int(img.height * target)
        left = (img.width - new_w) // 2
        img = img.crop((left, 0, left + new_w, img.height))
    elif src < target:
        new_h = int(img.width / target)
        top = (img.height - new_h) // 2
        img = img.crop((0, top, img.width, top + new_h))
    return img.resize((width, height), Image.Resampling.LANCZOS)


def _placeholder(width: int, height: int, label: str = "사진 없음") -> Image.Image:
    img = Image.new("RGB", (width, height), (236, 230, 223))
    draw = ImageDraw.Draw(img)
    font = _load_font(max(min(width, height) // 10, 18))
    tw = draw.textlength(label, font=font)
    ascent, descent = font.getmetrics()
    draw.text(
        ((width - tw) / 2, (height - (ascent + descent)) / 2),
        label,
        fill=(176, 166, 156),
        font=font,
    )
    return img


def _vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    gradient = Image.new("RGB", (1, h))
    for y in range(h):
        ratio = y / max(h - 1, 1)
        gradient.putpixel(
            (0, y),
            (
                int(top[0] + (bottom[0] - top[0]) * ratio),
                int(top[1] + (bottom[1] - top[1]) * ratio),
                int(top[2] + (bottom[2] - top[2]) * ratio),
            ),
        )
    return gradient.resize(size)


def _circle_crop(img: Image.Image, diameter: int) -> Image.Image:
    src = _fit_cover(img, diameter, diameter)
    mask = Image.new("L", (diameter, diameter), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, diameter - 1, diameter - 1), fill=255)
    out = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    out.paste(src, (0, 0), mask)
    return out


def _draw_heart(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int, color: tuple[int, int, int]) -> None:
    """폰트 의존 없이 하트 장식을 직접 그린다(이모지 두부 방지)."""
    r = size / 4
    draw.ellipse((cx - size / 2, cy - size / 4, cx - size / 2 + 2 * r, cy - size / 4 + 2 * r), fill=color)
    draw.ellipse((cx + size / 2 - 2 * r, cy - size / 4, cx + size / 2, cy - size / 4 + 2 * r), fill=color)
    draw.polygon([(cx - size / 2 + 1, cy + r / 2), (cx + size / 2 - 1, cy + r / 2), (cx, cy + size / 2)], fill=color)


def _ideal_text_color(bg: tuple[int, int, int]) -> tuple[int, int, int]:
    """배경 밝기에 따라 어두운/밝은 글자색 자동 선택."""
    luminance = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
    return (58, 52, 47) if luminance > 150 else (250, 246, 240)


# ---------------------------------------------------------------------------
# 텍스트 헬퍼
# ---------------------------------------------------------------------------


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: FontType, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for char in paragraph:
            trial = current + char
            if draw.textlength(trial, font=font) <= max_width or not current:
                current = trial
            else:
                lines.append(current)
                current = char
        if current:
            lines.append(current)
    return lines


def _truncate(lines: list[str], max_lines: int) -> list[str]:
    if len(lines) <= max_lines:
        return lines
    trimmed = lines[:max_lines]
    trimmed[-1] = trimmed[-1][: max(len(trimmed[-1]) - 1, 0)].rstrip() + "…"
    return trimmed


def _line_advance(font: FontType, spacing: int) -> int:
    ascent, descent = font.getmetrics()
    return ascent + descent + spacing


def _draw_block(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: FontType,
    x: int,
    y: int,
    fill: tuple[int, int, int],
    spacing: int = 8,
    align: str = "left",
    max_width: int | None = None,
) -> int:
    advance = _line_advance(font, spacing)
    for line in lines:
        draw_x = x
        if align in ("center", "right") and max_width is not None:
            lw = draw.textlength(line, font=font)
            draw_x = x + (max_width - lw) / 2 if align == "center" else x + (max_width - lw)
        draw.text((draw_x, y), line, fill=fill, font=font)
        y += advance
    return y


def _fit_font_block(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    max_height: int,
    max_size: int,
    min_size: int,
    bold: bool = False,
) -> tuple[FontType, list[str], int]:
    """가용 영역에 맞게 폰트 크기/줄바꿈을 자동 계산."""
    for size in range(max_size, min_size - 1, -2):
        font = _load_font(size, bold=bold)
        spacing = max(int(size * 0.4), 4)
        lines = _wrap(draw, text, font, max_width)
        if _line_advance(font, spacing) * len(lines) <= max_height:
            return font, lines, spacing
    font = _load_font(min_size, bold=bold)
    spacing = max(int(min_size * 0.4), 4)
    lines = _truncate(_wrap(draw, text, font, max_width), max(max_height // _line_advance(font, spacing), 1))
    return font, lines, spacing


def _photo_cell(
    img: Image.Image | None,
    width: int,
    height: int,
    caption: str = "",
    border: int = 0,
    border_color: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """사진을 커버-핏하고 하단에 반투명 스토리 캡션을 얹은 셀을 만든다."""
    inner_w, inner_h = width - border * 2, height - border * 2
    photo = _fit_cover(img, inner_w, inner_h) if img is not None else _placeholder(inner_w, inner_h)
    cell = Image.new("RGB", (width, height), border_color)
    cell.paste(photo, (border, border))

    if caption.strip():
        overlay = Image.new("RGBA", cell.size, (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        pad = max(int(width * 0.05), 12)
        font = _load_font(max(int(height * 0.062), 18))
        lines = _truncate(_wrap(odraw, caption.strip(), font, inner_w - pad * 2), 2)
        advance = _line_advance(font, 4)
        band_h = advance * len(lines) + pad
        odraw.rectangle([0, height - band_h, width, height], fill=(0, 0, 0, 130))
        _draw_block(odraw, lines, font, pad, height - band_h + pad // 2, (250, 250, 250), spacing=4)
        cell = Image.alpha_composite(cell.convert("RGBA"), overlay).convert("RGB")
    return cell


def _prep(photos: Sequence[Image.Image] | None, apply_filter: bool) -> list[Image.Image]:
    return [_normalize(p, apply_filter) for p in (photos or [])]


def _story_text(stories: Sequence[dict[str, Any]] | None, index: int) -> tuple[str, str]:
    if not stories or index >= len(stories):
        return "", ""
    item = stories[index] or {}
    return str(item.get("user", "")).strip(), str(item.get("text", "")).strip()


# ---------------------------------------------------------------------------
# 템플릿 A: 타임라인 (1080x1350)
# ---------------------------------------------------------------------------


def generate_album_template_A(
    photos: Sequence[Image.Image],
    stories: Sequence[dict[str, Any]],
    title: str = "우리의 모임",
    date: str = "",
    narrative: str | None = None,
    apply_filter: bool = True,
) -> Image.Image:
    W, H = 1080, 1350
    canvas = _vertical_gradient((W, H), (255, 244, 233), (250, 224, 205))
    draw = ImageDraw.Draw(canvas)
    ink = _ideal_text_color((252, 234, 219))
    accent = (183, 138, 110)

    imgs = _prep(photos, apply_filter) or [_placeholder(220, 220)]
    n = min(len(imgs), 6)

    title_font = _load_font(58, bold=True)
    draw.text((W / 2 - draw.textlength(title, font=title_font) / 2, 56), title, fill=ink, font=title_font)
    if date:
        date_font = _load_font(30)
        draw.text((W / 2 - draw.textlength(date, font=date_font) / 2, 128), date, fill=accent, font=date_font)

    top, bottom = 210, H - 50
    row_h = (bottom - top) / n
    diameter = int(min(row_h * 0.62, 210))
    center_x = W // 2

    draw.line([(center_x, top), (center_x, bottom)], fill=(accent[0], accent[1], accent[2]), width=3)

    for i in range(n):
        row_center = int(top + row_h * (i + 0.5))
        left_side = i % 2 == 0
        region_cx = center_x - 250 if left_side else center_x + 250

        circle = _circle_crop(imgs[i], diameter)
        cx = region_cx - diameter // 2
        cy = row_center - diameter // 2
        ring = Image.new("RGBA", (diameter + 10, diameter + 10), (0, 0, 0, 0))
        ImageDraw.Draw(ring).ellipse((0, 0, diameter + 9, diameter + 9), fill=(255, 255, 255, 235))
        canvas.paste(ring, (cx - 5, cy - 5), ring)
        canvas.paste(circle, (cx, cy), circle)

        draw.line([(center_x, row_center), (region_cx, row_center)], fill=accent, width=3)
        draw.ellipse((center_x - 8, row_center - 8, center_x + 8, row_center + 8), fill=accent)

        user, text = _story_text(stories, i)
        caption = f"{user} · {text}" if user and text else (text or user)
        if caption:
            cap_font = _load_font(26)
            lines = _truncate(_wrap(draw, caption, cap_font, 420), 3)
            _draw_block(draw, lines, cap_font, region_cx - 210, cy + diameter + 12, ink, spacing=6, align="center", max_width=420)

    return canvas


# ---------------------------------------------------------------------------
# 템플릿 B: 콜라주 (1200x1600)
# ---------------------------------------------------------------------------


def generate_album_template_B(
    photos: Sequence[Image.Image],
    stories: Sequence[dict[str, Any]],
    title: str = "우리의 모임",
    date: str = "",
    narrative: str | None = None,
    apply_filter: bool = True,
) -> Image.Image:
    W, H = 1200, 1600
    bg = (245, 244, 242)
    canvas = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(canvas)

    imgs = _prep(photos, apply_filter)
    count = max(len(imgs), 1)

    pad = 40
    gap = 8
    info_h = 150
    cols = 2 if count <= 6 else 3
    rows = max(math.ceil(count / cols), 1)

    grid_w = W - pad * 2
    grid_h = H - pad * 2 - info_h
    cell_w = (grid_w - gap * (cols - 1)) // cols
    cell_h = (grid_h - gap * (rows - 1)) // rows

    for idx in range(cols * rows):
        r, c = divmod(idx, cols)
        x = pad + c * (cell_w + gap)
        y = pad + r * (cell_h + gap)
        img = imgs[idx] if idx < len(imgs) else None
        _, text = _story_text(stories, idx)
        cell = _photo_cell(img, cell_w, cell_h, caption=text, border=1, border_color=(255, 255, 255))
        canvas.paste(cell, (x, y))

    info_top = H - info_h
    draw.line([(pad, info_top), (W - pad, info_top)], fill=(220, 214, 208), width=2)
    title_font = _load_font(48, bold=True)
    draw.text((pad, info_top + 26), title, fill=(58, 52, 47), font=title_font)
    meta = f"멤버 {len(stories) or count}명"
    if date:
        meta += f"  ·  {date}"
    meta_font = _load_font(30)
    draw.text((pad, info_top + 90), meta, fill=(150, 140, 132), font=meta_font)

    return canvas


# ---------------------------------------------------------------------------
# 템플릿 C: 스토리북 (1080x1350)
# ---------------------------------------------------------------------------


def generate_album_template_C(
    photos: Sequence[Image.Image],
    stories: Sequence[dict[str, Any]],
    title: str = "우리의 모임",
    date: str = "",
    narrative: str | None = None,
    apply_filter: bool = True,
) -> Image.Image:
    W, H = 1080, 1350
    canvas = _vertical_gradient((W, H), (251, 244, 232), (240, 226, 205))
    draw = ImageDraw.Draw(canvas)
    ink = (74, 62, 52)
    accent = (176, 132, 104)

    imgs = _prep(photos, apply_filter)
    if not imgs:
        imgs = [_placeholder(560, 560)]

    pad = 44
    title_font = _load_font(52, bold=True)
    _draw_heart(draw, pad + 18, 72, 38, accent)
    draw.text((pad + 52, 44), title, fill=ink, font=title_font)
    if date:
        date_font = _load_font(28)
        draw.text((pad + 52, 108), date, fill=accent, font=date_font)

    content_top = 170
    main_w = 600
    main_h = 700
    main = _photo_cell(imgs[0], main_w, main_h, border=6, border_color=(255, 255, 255))
    canvas.paste(main, (pad, content_top))

    # 좌측 대표 사진 아래: 긴 스토리(내러티브 우선, 없으면 첫 사진 스토리)
    _, first_text = _story_text(stories, 0)
    long_story = (narrative or first_text or "").strip()
    if long_story:
        story_top = content_top + main_h + 24
        font, lines, spacing = _fit_font_block(
            draw, long_story, main_w, H - story_top - pad, max_size=30, min_size=20
        )
        _draw_block(draw, lines, font, pad, story_top, ink, spacing=spacing)

    # 우측: 나머지 사진 3~4개 세로 배치 + 각자의 한마디 오버레이
    right_x = pad + main_w + 24
    right_w = W - right_x - pad
    side_imgs = imgs[1:5]
    slots = max(len(side_imgs), 1)
    slot_gap = 16
    slot_h = (main_h - slot_gap * (slots - 1)) // slots

    for i in range(slots):
        y = content_top + i * (slot_h + slot_gap)
        img = side_imgs[i] if i < len(side_imgs) else None
        _, text = _story_text(stories, i + 1)
        cell = _photo_cell(img, right_w, slot_h, caption=text, border=4, border_color=(255, 255, 255))
        canvas.paste(cell, (right_x, y))

    return canvas


# ---------------------------------------------------------------------------
# 디스패처 & 저장
# ---------------------------------------------------------------------------

_TEMPLATES = {
    "A": generate_album_template_A,
    "B": generate_album_template_B,
    "C": generate_album_template_C,
}


def generate_album(
    template: str,
    photos: Sequence[Image.Image],
    stories: Sequence[dict[str, Any]],
    title: str = "우리의 모임",
    date: str = "",
    narrative: str | None = None,
    apply_filter: bool = True,
) -> Image.Image:
    fn = _TEMPLATES.get((template or "B").upper(), generate_album_template_B)
    return fn(photos, stories, title=title, date=date, narrative=narrative, apply_filter=apply_filter)


def bytes_to_images(image_bytes_list: Sequence[bytes]) -> list[Image.Image]:
    images: list[Image.Image] = []
    for raw in image_bytes_list:
        try:
            # Album layouts render at roughly 1080px. Keeping full-resolution
            # camera frames alive for every photo can exhaust a Railway worker.
            with Image.open(io.BytesIO(raw)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                images.append(image.copy())
        except Exception:  # noqa: BLE001 - 손상 파일은 건너뜀
            continue
    return images


def image_to_png_bytes(img: Image.Image) -> bytes:
    buffer = io.BytesIO()
    img.convert("RGB").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
