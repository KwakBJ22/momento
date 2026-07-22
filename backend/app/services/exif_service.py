"""EXIF metadata helpers using Pillow only (no Vision API)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

# Common EXIF tags
_TAG_DATETIME_ORIGINAL = 36867  # DateTimeOriginal
_TAG_DATETIME_DIGITIZED = 36868  # CreateDate / DateTimeDigitized
_TAG_DATETIME = 306  # DateTime
_TAG_GPS_INFO = 34853
_TAG_ORIENTATION = 274

_DATETIME_FORMATS = (
    "%Y:%m:%d %H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y:%m:%d %H:%M:%S%z",
    "%Y:%m:%d",
    "%Y-%m-%d",
)


def parse_exif_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    text = str(value).strip().rstrip("\x00")
    if not text:
        return None
    # Some phones append subseconds: "2026:07:12 10:11:12.123"
    if "." in text and len(text) > 19:
        text = text.split(".", 1)[0]
    for fmt in _DATETIME_FORMATS:
        try:
            parsed = datetime.strptime(text[:26], fmt) if "%z" in fmt else datetime.strptime(text[:19], fmt)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _ratio_to_float(value: Any) -> float | None:
    try:
        if hasattr(value, "numerator") and hasattr(value, "denominator"):
            den = float(value.denominator)
            return float(value.numerator) / den if den else None
        if isinstance(value, tuple) and len(value) == 2:
            den = float(value[1])
            return float(value[0]) / den if den else None
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _gps_coord_to_decimal(coord: Any, ref: Any) -> float | None:
    if not coord or len(coord) < 3:
        return None
    degrees = _ratio_to_float(coord[0])
    minutes = _ratio_to_float(coord[1])
    seconds = _ratio_to_float(coord[2])
    if degrees is None or minutes is None or seconds is None:
        return None
    decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
    ref_text = ref.decode("ascii", errors="ignore") if isinstance(ref, bytes) else str(ref or "")
    if ref_text.upper() in {"S", "W"}:
        decimal = -decimal
    return decimal


def extract_gps(exif: Image.Exif) -> tuple[float | None, float | None]:
    try:
        gps_ifd = exif.get_ifd(_TAG_GPS_INFO)
    except Exception:
        gps_ifd = None
    if not gps_ifd:
        raw = exif.get(_TAG_GPS_INFO)
        if isinstance(raw, dict):
            gps_ifd = raw
        else:
            return None, None

    named: dict[str, Any] = {}
    for key, value in gps_ifd.items():
        name = GPSTAGS.get(key, str(key))
        named[name] = value

    lat = _gps_coord_to_decimal(named.get("GPSLatitude"), named.get("GPSLatitudeRef"))
    lng = _gps_coord_to_decimal(named.get("GPSLongitude"), named.get("GPSLongitudeRef"))
    return lat, lng


def read_exif_dict(image: Image.Image) -> dict[str, Any]:
    """Return a flat, human-readable EXIF map when available."""
    try:
        exif = image.getexif()
    except Exception:
        return {}
    if not exif:
        return {}
    result: dict[str, Any] = {}
    for tag_id, value in exif.items():
        name = TAGS.get(tag_id, str(tag_id))
        result[name] = value
        result[str(tag_id)] = value
    return result


def resolve_taken_at(
    *,
    datetime_original: Any = None,
    create_date: Any = None,
    file_created_at: datetime | None = None,
) -> datetime | None:
    """Priority: DateTimeOriginal → DateTimeDigitized → DateTime → None."""
    for candidate in (datetime_original, create_date):
        parsed = parse_exif_datetime(candidate)
        if parsed:
            return parsed
    return None


def orientation_from_size(width: int, height: int) -> str:
    if not width or not height:
        return "square"
    ratio = width / height
    if ratio >= 1.2:
        return "landscape"
    if ratio <= 0.8:
        return "portrait"
    return "square"


def format_cover_date(taken_ats: list[datetime]) -> str:
    """Single day → 2026.07.12 / multi-day → 2026.07.12 ~ 2026.07.14."""
    if not taken_ats:
        return datetime.now(timezone.utc).strftime("%Y.%m.%d")
    days = sorted({value.astimezone(timezone.utc).date() for value in taken_ats})
    start = days[0].strftime("%Y.%m.%d")
    if len(days) == 1:
        return start
    return f"{start} ~ {days[-1].strftime('%Y.%m.%d')}"


def extract_image_exif_meta(
    image: Image.Image,
    *,
    width: int,
    height: int,
    file_created_at: datetime | None = None,
) -> dict[str, Any]:
    """Collect EXIF fields used by Album Engine (Vision unused)."""
    datetime_original = None
    create_date = None
    latitude = None
    longitude = None
    try:
        exif = image.getexif()
    except Exception:
        exif = None

    if exif:
        datetime_original = exif.get(_TAG_DATETIME_ORIGINAL) or exif.get("DateTimeOriginal")
        create_date = exif.get(_TAG_DATETIME_DIGITIZED) or exif.get("DateTimeDigitized")
        if create_date is None:
            create_date = exif.get(_TAG_DATETIME) or exif.get("DateTime")
        latitude, longitude = extract_gps(exif)

        # HEIC / some Android builds expose named IFD values more reliably via flattened map.
        if datetime_original is None or create_date is None:
            flat = read_exif_dict(image)
            datetime_original = datetime_original or flat.get("DateTimeOriginal")
            create_date = create_date or flat.get("DateTimeDigitized") or flat.get("DateTime")

    taken_at = resolve_taken_at(
        datetime_original=datetime_original,
        create_date=create_date,
        file_created_at=file_created_at,
    )
    return {
        "datetime_original": str(datetime_original) if datetime_original is not None else None,
        "create_date": str(create_date) if create_date is not None else None,
        "taken_at": taken_at,
        "width": width,
        "height": height,
        "orientation": orientation_from_size(width, height),
        "latitude": latitude,
        "longitude": longitude,
    }
