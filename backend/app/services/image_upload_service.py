from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings

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
}
_FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "HEIF": "image/heic",
}


@dataclass(frozen=True)
class ProcessedPhoto:
    original_bytes: bytes
    original_extension: str
    original_mime_type: str
    thumbnail_bytes: bytes
    display_bytes: bytes
    checksum_sha256: str


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


def process_upload(file: UploadFile, settings: Settings) -> ProcessedPhoto:
    """Decode, validate and sanitize a user upload before it reaches Storage."""
    filename_extension = Path(file.filename or "").suffix.lower()
    expected_format = _EXTENSION_TO_FORMAT.get(filename_extension)
    if expected_format is None:
        raise _http_unsupported("JPG, JPEG, PNG, WEBP, GIF, HEIC 파일만 업로드할 수 있습니다.")
    if file.content_type and file.content_type.lower() not in settings.allowed_image_types:
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
    if detected_format not in _FORMAT_TO_MIME or detected_format != expected_format:
        raise _http_unsupported("파일 확장자와 실제 이미지 형식이 일치하지 않습니다.")
    if image.width * image.height > settings.max_image_pixels:
        raise _http_unsupported("이미지 해상도가 허용 범위를 초과합니다.")

    try:
        if detected_format == "GIF":
            # Preserve the uploaded GIF (including animation) as the original;
            # GIF does not carry EXIF. Thumbnail uses its representative frame.
            original_bytes, extension, mime_type = content, "gif", "image/gif"
        else:
            original_bytes, extension, mime_type = _encode_without_exif(image, detected_format)
        thumbnail_bytes = _thumbnail_bytes(image, settings.thumbnail_max_side)
        display_bytes = original_bytes if mime_type != "image/gif" else content
    finally:
        image.close()

    return ProcessedPhoto(
        original_bytes=original_bytes,
        original_extension=extension,
        original_mime_type=mime_type,
        thumbnail_bytes=thumbnail_bytes,
        display_bytes=display_bytes,
        checksum_sha256=hashlib.sha256(original_bytes).hexdigest(),
    )
