"""좌표를 **시·군 이름까지만** 바꾼다 (PO 판단 2026-08-13).

★ 왜 이름까지만인가: 위치는 집 주소가 그대로 드러나는 값이고, 앨범은 여럿이 본다.
  `제주 서귀포시` · `서울시` · `용인시` 면 "어디쯤이었지" 를 떠올리기에 충분하고,
  그 이상은 우리가 가질 이유가 없다. **좌표 자체는 저장하지 않는다** —
  부르는 쪽이 이름만 받아 넣고 좌표는 버린다.

★ 이 파일은 무엇도 막지 않는다. 키가 없거나 카카오가 안 되거나 좌표가 이상하면
  None 을 돌려주고 끝이다. **사진 업로드가 지명 하나 때문에 실패하면 안 된다.**
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_KAKAO_COORD2REGION_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"
# 사진 한 장마다 부르는 자리다. 오래 붙잡고 있으면 업로드가 그만큼 늦어진다.
_TIMEOUT_SECONDS = 3.0

# 시·도 앞말을 줄인다. 화면에 `제주특별자치도` 를 그대로 쓰지 않는다.
#   ★ 광역시·특별시는 **구를 버리고 시까지만** 쓴다 — `서울 강남구` 는 사는 동네를
#     너무 좁힌다. PO 가 준 예시(`서울시`)가 그 뜻이다.
_METROPOLITAN = {
    "서울특별시": "서울시",
    "부산광역시": "부산시",
    "대구광역시": "대구시",
    "인천광역시": "인천시",
    "광주광역시": "광주시",
    "대전광역시": "대전시",
    "울산광역시": "울산시",
    "세종특별자치시": "세종시",
}
# 도 이름은 버리고 시·군만 쓴다(`경기도 용인시` → `용인시`).
#   ★ 제주만 예외다 — PO 예시가 `제주 서귀포시` 다. 섬 이름이 붙어야 어디인지 안다.
_ISLAND_PREFIX = {"제주특별자치도": "제주", "제주도": "제주"}


def shorten_region(region_1depth: str, region_2depth: str) -> str | None:
    """카카오가 준 시·도 + 시·군·구를 화면에 쓸 한 마디로 줄인다."""
    first = (region_1depth or "").strip()
    second = (region_2depth or "").strip()
    if not first:
        return second or None
    if first in _METROPOLITAN:
        return _METROPOLITAN[first]
    if first in _ISLAND_PREFIX:
        return f"{_ISLAND_PREFIX[first]} {second}".strip() if second else _ISLAND_PREFIX[first]
    # 도(경기도·강원특별자치도 …)는 앞말을 버린다. 시·군 이름만으로 충분히 안다.
    return second or first


def _pick_document(documents: list[dict[str, Any]]) -> dict[str, Any] | None:
    """행정동(H)보다 법정동(B)을 먼저 쓴다 — 시·군 이름이 더 안정적이다."""
    for wanted in ("B", "H"):
        for doc in documents:
            if isinstance(doc, dict) and doc.get("region_type") == wanted:
                return doc
    return documents[0] if documents and isinstance(documents[0], dict) else None


def resolve_city_name(latitude: float | None, longitude: float | None, api_key: str | None) -> str | None:
    """좌표 → `제주 서귀포시` 같은 한 마디. 실패하면 조용히 None."""
    if latitude is None or longitude is None or not api_key:
        return None
    # 있을 수 없는 값은 부르지도 않는다.
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        return None
    try:
        response = httpx.get(
            _KAKAO_COORD2REGION_URL,
            params={"x": longitude, "y": latitude},
            headers={"Authorization": f"KakaoAK {api_key}"},
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - 업로드를 막지 않는다
        logger.warning("place_name_lookup_failed reason=%s", type(exc).__name__)
        return None
    if response.status_code != 200:
        # 401 이면 키가 틀렸거나 그 앱에 `로컬` 사용 설정이 꺼져 있다는 뜻이다.
        logger.warning("place_name_lookup_rejected status=%s", response.status_code)
        return None
    try:
        documents = (response.json() or {}).get("documents") or []
    except Exception:  # noqa: BLE001
        return None
    document = _pick_document(documents)
    if not document:
        return None
    return shorten_region(str(document.get("region_1depth_name") or ""), str(document.get("region_2depth_name") or ""))


# 한 앨범에 같은 장소 사진이 여러 장인 것이 보통이다. 사진마다 부르면 그만큼
# 업로드가 늦어지므로, **약 100m 격자로 반올림해** 같은 자리면 한 번만 묻는다.
# 캐시는 워커 프로세스 안에만 산다 — 배포하면 비워진다. 그거면 충분하다.
_GRID_DECIMALS = 3


@lru_cache(maxsize=512)
def _resolve_cached(lat_key: float, lng_key: float, api_key: str) -> str | None:
    return resolve_city_name(lat_key, lng_key, api_key)


def resolve_city_name_cached(latitude: float | None, longitude: float | None, api_key: str | None) -> str | None:
    """같은 자리 사진이 여러 장이면 한 번만 묻는다."""
    if latitude is None or longitude is None or not api_key:
        return None
    return _resolve_cached(round(latitude, _GRID_DECIMALS), round(longitude, _GRID_DECIMALS), api_key)
