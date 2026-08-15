"""좌표만 있고 이름이 없는 사진에 지명을 채우고, 그 좌표를 지운다. DRY-RUN 이 기본.

왜 필요한가 (2026-08-15 dev 실측):
  사진을 저장하는 자리가 셋인데 그중 **하나만** 지명을 채우고 있었다. 나머지 둘은
  이름을 null 로 박은 채 좌표를 그대로 저장했다 — 정책(§9 · 좌표는 저장하지 않는다)과
  어긋난 상태다. 코드는 고쳤고, 이 스크립트는 **이미 쌓인 행**을 맞춘다.

무엇을 하는가:
  · latitude 가 있고 location_name 이 비어 있는 행만 본다
  · 카카오로 시·군 이름을 얻으면 그 이름을 쓰고 **좌표를 지운다**(정책과 맞춘다)
  · 이름을 못 얻으면 **그 행은 손대지 않는다** — 다음에 다시 시도할 수 있게 남긴다
    (좌표를 지워 버리면 영영 못 채운다)

Supabase 환경변수가 필요하다(`railway run` 이나 로컬 .env).

Usage:
  # 무엇이 바뀔지 보고만 한다(아무것도 안 쓴다). 키가 통하는지 여기서 먼저 본다:
  python -m scripts.backfill_place_names

  # 실제로 채운다:
  python -m scripts.backfill_place_names --apply

Options:
  --apply     실제로 쓴다 (기본: dry-run)
  --album ID  앨범 하나로 제한
  --limit N   최대 N 행 (기본 500) — 카카오 호출량을 손에 쥐고 늘린다

★ 운영에는 PO 승인 뒤에만 돌린다.
"""
from __future__ import annotations

import argparse
import logging

from app.config import get_settings
from app.services.place_name_service import resolve_city_name_cached
from app.services.supabase import get_supabase_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_place_names")


def find_photos_with_coords_only(client, album_id: str | None, limit: int) -> list[dict]:
    """좌표는 있는데 이름이 없는 행. 지워진 사진은 보지 않는다."""
    query = (
        client.table("album_photos")
        .select("id,album_id,latitude,longitude,location_name,location_source")
        .is_("deleted_at", "null")
        .not_.is_("latitude", "null")
        .limit(limit)
    )
    if album_id:
        query = query.eq("album_id", album_id)
    rows = query.execute().data or []
    # 이름이 이미 있으면 건드리지 않는다(사용자가 직접 고쳐 넣은 것일 수도 있다).
    return [row for row in rows if not str(row.get("location_name") or "").strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="실제로 쓴다 (기본: dry-run)")
    parser.add_argument("--album", default=None, help="앨범 하나로 제한")
    parser.add_argument("--limit", type=int, default=500, help="최대 행 수 (기본 500)")
    args = parser.parse_args()

    settings = get_settings()
    client = get_supabase_client(settings)
    api_key = getattr(settings, "kakao_rest_api_key", "")
    if not api_key:
        logger.warning("kakao_rest_api_key 가 비어 있다 — 이름을 하나도 못 얻는다. 설정부터 확인한다.")

    targets = find_photos_with_coords_only(client, args.album, args.limit)
    if not targets:
        logger.info("좌표만 있고 이름이 없는 사진이 없다 — 할 일이 없다")
        return 0
    logger.info("대상 %s장", len(targets))

    resolved: list[tuple[str, str]] = []
    unresolved: list[str] = []
    for row in targets:
        photo_id = str(row["id"])
        name = resolve_city_name_cached(row.get("latitude"), row.get("longitude"), api_key)
        if name:
            resolved.append((photo_id, name))
        else:
            unresolved.append(photo_id)

    logger.info("이름을 얻은 것 %s장 / 못 얻은 것 %s장", len(resolved), len(unresolved))
    for photo_id, name in resolved[:20]:
        logger.info("  photo=%s -> %s", photo_id[:8], name)
    if len(resolved) > 20:
        logger.info("  … 그 밖 %s장", len(resolved) - 20)

    if not args.apply:
        logger.info(
            "DRY-RUN: 아무것도 쓰지 않았다. 위에 이름이 하나도 없다면 카카오 키 문제다 "
            "(place_name_lookup_rejected status=401 이면 카카오 앱의 `카카오맵/로컬` 사용 설정이 꺼져 있다). "
            "--apply 로 다시 돌리면 이름을 쓰고 좌표를 지운다."
        )
        return 0

    written = 0
    for photo_id, name in resolved:
        try:
            # 이름을 넣고 **좌표를 지운다** — 저장하지 않기로 한 값이다(§9).
            client.table("album_photos").update({
                "location_name": name, "location_source": "exif",
                "latitude": None, "longitude": None,
            }).eq("id", photo_id).execute()
            written += 1
        except Exception:  # 한 장이 막혀도 나머지는 계속한다
            logger.exception("photo %s 쓰기 실패", photo_id)

    logger.info("끝: 채운 것 %s장 · 그대로 둔 것 %s장(다음에 다시 시도한다)", written, len(unresolved))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
