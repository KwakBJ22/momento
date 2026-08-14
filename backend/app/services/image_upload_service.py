from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings
from app.services.exif_service import extract_image_exif_meta

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover - deployment dependency check
    pass


_EXTENSION_TO_FORMAT = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
    ".gif": "GIF",
    ".heic": "HEIF",
    ".heif": "HEIF",
}
_FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "HEIF": "image/heic",
}

# Mobile browsers often send aliases / empty / octet-stream instead of the real MIME.
_MOBILE_MIME_ALIASES = frozenset(
    {
        "image/jpg",
        "image/pjpeg",
        "image/x-png",
        "application/octet-stream",
    }
)


def _is_allowed_upload_mime(content_type: str | None, settings: Settings) -> bool:
    mime = (content_type or "").lower().strip()
    if not mime:
        return True
    if mime in settings.allowed_image_types:
        return True
    if mime in _MOBILE_MIME_ALIASES:
        return True
    return mime.startswith("image/")


@dataclass(frozen=True)
class ProcessedPhoto:
    original_bytes: bytes
    original_extension: str
    original_mime_type: str
    thumbnail_bytes: bytes | None
    display_bytes: bytes | None
    checksum_sha256: str
    width: int = 0
    height: int = 0
    orientation: str = "square"
    taken_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    datetime_original: str | None = None
    create_date: str | None = None


def _http_unsupported(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _encode_without_exif(image: Image.Image, image_format: str) -> tuple[bytes, str, str]:
    output = io.BytesIO()
    normalized = ImageOps.exif_transpose(image)
    if image_format == "JPEG":
        normalized.convert("RGB").save(output, format="JPEG", quality=92, optimize=True)
        return output.getvalue(), "jpg", "image/jpeg"
    if image_format == "PNG":
        normalized.save(output, format="PNG", optimize=True)
        return output.getvalue(), "png", "image/png"
    if image_format == "WEBP":
        normalized.save(output, format="WEBP", quality=90, method=6)
        return output.getvalue(), "webp", "image/webp"

    # HEIC is decoded and re-encoded as browser-compatible JPEG. This strips
    # EXIF while retaining a private signed-URL original/master asset.
    normalized.convert("RGB").save(output, format="JPEG", quality=92, optimize=True)
    return output.getvalue(), "jpg", "image/jpeg"


def _thumbnail_bytes(image: Image.Image, max_side: int) -> bytes:
    frame = ImageOps.exif_transpose(image).convert("RGB")
    frame.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    frame.save(output, format="WEBP", quality=82, method=6)
    return output.getvalue()


def _display_bytes(image: Image.Image, max_side: int = 1280) -> bytes:
    frame = ImageOps.exif_transpose(image).convert("RGB")
    frame.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    frame.save(output, format="WEBP", quality=80, method=6)
    return output.getvalue()


def build_derived_image_bytes(
    original_bytes: bytes,
    *,
    original_mime_type: str,
    settings: Settings,
) -> tuple[bytes | None, bytes]:
    """Build bounded web assets from a stored original.

    This intentionally runs after the upload response. GIF display keeps the
    original animation; only its representative thumbnail is generated.
    """
    try:
        image = Image.open(io.BytesIO(original_bytes))
        image.load()
        thumbnail = _thumbnail_bytes(image, settings.thumbnail_max_side)
        display = None if original_mime_type == "image/gif" else _display_bytes(image)
        return display, thumbnail
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise _http_unsupported("사진을 화면용 크기로 준비하지 못했습니다.") from exc
    finally:
        try:
            image.close()
        except UnboundLocalError:
            pass


def parse_file_created_at(raw: Any) -> datetime | None:
    """Accept unix ms/seconds or ISO string from the client File.lastModified."""
    if raw is None or raw == "":
        return None
    try:
        if isinstance(raw, (int, float)) or (isinstance(raw, str) and str(raw).replace(".", "", 1).isdigit()):
            value = float(raw)
            if value > 1_000_000_000_000:  # ms
                value = value / 1000.0
            return datetime.fromtimestamp(value, tz=timezone.utc)
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError, OSError):
        return None


def parse_coordinate(raw: Any, *, limit: float) -> float | None:
    """화면이 보낸 위도·경도 한 개를 숫자로. 이상하면 None.

    ★ 믿고 그대로 쓰지 않는다 — 화면에서 오는 값이다. 범위를 벗어나거나 숫자가
      아니면 버린다. 정확히 0,0 도 버린다(기니만 앞바다다 — 실제로는 못 받은 값이다).
    """
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value != value or value in (float("inf"), float("-inf")):  # NaN·inf
        return None
    if abs(value) > limit:
        return None
    return value


def parse_captured_at(raw: Any) -> datetime | None:
    """Accept only an explicit ISO capture date, never a file timestamp."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return datetime.fromisoformat(raw.strip())
    except ValueError:
        return None


def validate_upload_limits(files: list[UploadFile], settings: Settings) -> None:
    """Reject oversized requests before decoding or storing any image bytes."""
    max_file_size_mb = int(getattr(settings, "max_file_size_mb", 10))
    max_file_bytes = max_file_size_mb * 1024 * 1024
    max_photos = int(getattr(settings, "max_photos", 30))
    max_total_bytes = max_photos * max_file_bytes
    total_bytes = 0
    for upload in files:
        try:
            position = upload.file.tell()
            upload.file.seek(0, 2)
            size = upload.file.tell()
            upload.file.seek(position)
        except (AttributeError, OSError) as exc:
            raise HTTPException(status_code=400, detail="사진 파일을 확인하지 못했습니다.") from exc
        if size > max_file_bytes:
            raise HTTPException(status_code=413, detail=f"이 사진은 용량이 너무 큽니다. {max_file_size_mb}MB 이하의 사진을 선택해주세요.")
        total_bytes += size
    if total_bytes > max_total_bytes:
        raise HTTPException(status_code=413, detail="선택한 사진의 전체 용량이 너무 큽니다. 용량이 큰 사진을 제외하거나 사진 수를 줄여주세요.")


def process_upload(
    file: UploadFile,
    settings: Settings,
    *,
    file_created_at: datetime | None = None,
    captured_at: datetime | None = None,
    # ★ 화면이 원본에서 읽어 보낸 좌표. EXIF 보다 **먼저** 쓴다 — 업로드 전에
    #   canvas 로 다시 그리면서 EXIF 가 사라지므로, 서버에는 읽을 것이 없다
    #   (운영 사진 67장 중 위치 0장이었던 이유다). 촬영일과 같은 통로다.
    captured_latitude: float | None = None,
    captured_longitude: float | None = None,
    generate_derivatives: bool = True,
) -> ProcessedPhoto:
    """Decode, validate and sanitize a user upload before it reaches Storage."""
    filename_extension = Path(file.filename or "").suffix.lower()
    expected_format = _EXTENSION_TO_FORMAT.get(filename_extension)
    if not _is_allowed_upload_mime(file.content_type, settings):
        raise _http_unsupported("지원하지 않는 이미지 MIME 타입입니다.")

    content = file.file.read()
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if not content:
        raise _http_unsupported("빈 이미지 파일입니다.")
    if len(content) > max_bytes:
        raise _http_unsupported(f"이미지 크기는 {settings.max_file_size_mb}MB 이하여야 합니다.")

    try:
        with Image.open(io.BytesIO(content)) as verifier:
            verifier.verify()
        image = Image.open(io.BytesIO(content))
        image.load()  # Force full decoding; verify() alone is insufficient.
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise _http_unsupported("손상되었거나 지원하지 않는 이미지 파일입니다.") from exc

    detected_format = (image.format or "").upper()
    if detected_format == "HEIC":
        detected_format = "HEIF"
    if detected_format not in _FORMAT_TO_MIME:
        raise _http_unsupported("JPG, JPEG, PNG, WEBP, GIF, HEIC 파일만 업로드할 수 있습니다.")
    # Mobile may omit extension; trust decoded image format in that case.
    if expected_format is None:
        expected_format = detected_format
    elif detected_format != expected_format:
        raise _http_unsupported("파일 확장자와 실제 이미지 형식이 일치하지 않습니다.")
    if image.width * image.height > settings.max_image_pixels:
        raise _http_unsupported("이미지 해상도가 허용 범위를 초과합니다.")

    try:
        # Read EXIF before re-encode strips metadata. Orientation uses transposed size.
        oriented = ImageOps.exif_transpose(image)
        width, height = oriented.size
        if detected_format == "GIF":
            # Preserve the uploaded GIF (including animation) as the original;
            # GIF does not carry EXIF. Thumbnail uses its representative frame.
            original_bytes, extension, mime_type = content, "gif", "image/gif"
            width, height = image.size
        else:
            original_bytes, extension, mime_type = _encode_without_exif(image, detected_format)
        exif_meta = extract_image_exif_meta(
            image,
            width=int(width),
            height=int(height),
            file_created_at=file_created_at,
        )
        if generate_derivatives:
            thumbnail_bytes = _thumbnail_bytes(image, settings.thumbnail_max_side)
            # The web album uses this bounded derivative. The original remains
            # for PDF/print and is never fetched by normal screen rendering.
            display_bytes = _display_bytes(image) if mime_type != "image/gif" else content
        else:
            thumbnail_bytes = None
            display_bytes = None
    finally:
        image.close()

    return ProcessedPhoto(
        original_bytes=original_bytes,
        original_extension=extension,
        original_mime_type=mime_type,
        thumbnail_bytes=thumbnail_bytes,
        display_bytes=display_bytes,
        checksum_sha256=hashlib.sha256(original_bytes).hexdigest(),
        width=int(exif_meta["width"] or width or 0),
        height=int(exif_meta["height"] or height or 0),
        orientation=str(exif_meta["orientation"] or "square"),
        taken_at=captured_at or exif_meta.get("taken_at"),
        latitude=captured_latitude if captured_latitude is not None else exif_meta.get("latitude"),
        longitude=captured_longitude if captured_longitude is not None else exif_meta.get("longitude"),
        datetime_original=exif_meta.get("datetime_original"),
        create_date=exif_meta.get("create_date"),
    )
