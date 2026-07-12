from __future__ import annotations

import io
import re
import wave
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException, UploadFile
from PIL import Image

from app.config import Settings
from app.services.image_upload_service import process_upload

MediaType = Literal["image", "gif", "video", "audio", "document"]

_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
_VIDEO_MIMES = {"video/mp4", "video/quicktime"}
_AUDIO_MIMES = {"audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"}
_DOCUMENT_MIMES = {"application/pdf"}


@dataclass(frozen=True)
class ProcessedMedia:
    media_type: MediaType
    mime_type: str
    original_bytes: bytes
    preview_bytes: bytes | None
    preview_mime_type: str | None
    thumbnail_bytes: bytes | None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    page_count: int | None = None


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _read_limited(file: UploadFile, max_size_mb: int) -> bytes:
    content = file.file.read()
    if not content:
        raise _invalid("빈 미디어 파일입니다.")
    if len(content) > max_size_mb * 1024 * 1024:
        raise _invalid(f"미디어 크기는 {max_size_mb}MB 이하여야 합니다.")
    return content


def _is_iso_bmff(content: bytes) -> bool:
    return len(content) >= 12 and content[4:8] == b"ftyp"


def _bmff_brand(content: bytes) -> bytes:
    return content[8:12] if _is_iso_bmff(content) else b""


def _wav_duration(content: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(content), "rb") as audio:
            return round(audio.getnframes() / audio.getframerate(), 3)
    except (wave.Error, EOFError, ZeroDivisionError):
        return None


def _pdf_page_count(content: bytes) -> int | None:
    count = len(re.findall(rb"/Type\s*/Page\b", content))
    return count or None


def process_media_upload(file: UploadFile, settings: Settings) -> ProcessedMedia:
    """Validate actual media container/signature before private Storage upload."""
    declared_mime = (file.content_type or "").lower()
    if declared_mime in _IMAGE_MIMES:
        image = process_upload(file, settings)
        with Image.open(io.BytesIO(image.display_bytes)) as decoded:
            width, height = decoded.size
        return ProcessedMedia(
            media_type="gif" if image.original_mime_type == "image/gif" else "image",
            mime_type=image.original_mime_type,
            original_bytes=image.original_bytes,
            preview_bytes=None,
            preview_mime_type=None,
            thumbnail_bytes=image.thumbnail_bytes,
            width=width,
            height=height,
        )

    if declared_mime in _VIDEO_MIMES:
        content = _read_limited(file, settings.max_video_file_size_mb)
        brand = _bmff_brand(content)
        if not brand:
            raise _invalid("손상되었거나 지원하지 않는 영상 파일입니다.")
        is_quicktime = brand == b"qt  "
        if (declared_mime == "video/quicktime") != is_quicktime:
            raise _invalid("영상 MIME 타입과 실제 컨테이너가 일치하지 않습니다.")
        return ProcessedMedia("video", declared_mime, content, None, None, None)

    if declared_mime in _AUDIO_MIMES:
        content = _read_limited(file, settings.max_audio_file_size_mb)
        if declared_mime == "audio/mpeg":
            if not (content.startswith(b"ID3") or (len(content) > 1 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0)):
                raise _invalid("손상되었거나 지원하지 않는 MP3 파일입니다.")
        elif declared_mime in {"audio/wav", "audio/x-wav"}:
            if not (content.startswith(b"RIFF") and content[8:12] == b"WAVE"):
                raise _invalid("손상되었거나 지원하지 않는 WAV 파일입니다.")
        elif not _is_iso_bmff(content):
            raise _invalid("손상되었거나 지원하지 않는 M4A 파일입니다.")
        return ProcessedMedia(
            "audio", declared_mime, content, None, None, None,
            duration_seconds=_wav_duration(content) if declared_mime in {"audio/wav", "audio/x-wav"} else None,
        )

    if declared_mime in _DOCUMENT_MIMES:
        content = _read_limited(file, settings.max_document_file_size_mb)
        if not content.startswith(b"%PDF-"):
            raise _invalid("손상되었거나 지원하지 않는 PDF 파일입니다.")
        return ProcessedMedia("document", declared_mime, content, None, None, None, page_count=_pdf_page_count(content))

    raise _invalid("지원하지 않는 미디어 MIME 타입입니다.")
