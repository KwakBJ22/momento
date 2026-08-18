"""좌표를 **구(區)까지의 이름**으로 바꾼다 (PO 결정 2026-08-15 · A안).

★ 2026-08-13 에는 `시·군까지만` 이었다. 2026-08-15 에 **구까지**로 넓혔다.
  까닭: 지역 종류마다 결과가 달랐다 — `용인시 수지구` 는 구가 남는데
  `서울특별시 강남구` 는 `서울시` 하나로 뭉쳤다(광역시는 구를 통째로 버렸다).
  서울에서 찍은 사진이 강남이든 종로든 전부 같은 한 마디가 됐다.
  그리고 **사용자가 연필로 고칠 수 있으므로**, 좁아서 생기는 문제보다
  어디였는지 안 떠오르는 쪽이 손해가 크다. 구 단위는 수십만 명이 사는 범위라
  집이 좁혀지지 않는다.

★ 여기까지다. 동(洞)·번지로 내려가지 않는다 — 그것은 집 주소다.
  **좌표 자체는 저장하지 않는다** — 부르는 쪽이 이름만 받아 넣고 좌표는 버린다.

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

# 시·도 앞말을 줄인다. 화면에 `서울특별시` `제주특별자치도` 를 그대로 쓰지 않는다.
#   ★ 2026-08-15 PO — 광역시·특별시도 **구까지** 쓴다(`서울 강남구`). 예전에는 이 표로
#     1depth 를 바꿔치기하면서 2depth(구)를 통째로 버렸고, 그래서 서울 사진이 전부
#     `서울시` 하나로 뭉쳤다. 값은 그대로 두고 **쓰는 방법**만 바꿨다 —
#     `서울시` 에서 `시` 를 떼고 구를 붙인다.
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
# 도 이름은 버리고 2depth 를 그대로 쓴다(`경기도 용인시 수지구` → `용인시 수지구`).
#   ★ 제주만 예외다 — PO 예시가 `제주 서귀포시` 다. 섬 이름이 붙어야 어디인지 안다.
_ISLAND_PREFIX = {"제주특별자치도": "제주", "제주도": "제주"}


def shorten_region(region_1depth: str, region_2depth: str) -> str | None:
    """카카오가 준 시·도 + 시·군·구를 화면에 쓸 한 마디로 줄인다.

    광역시·특별시   `서울특별시 강남구` → `서울 강남구` (`시` 를 떼고 구를 붙인다)
                   2depth 가 없으면 줄인 이름 그대로 → `세종시`
    제주            `제주특별자치도 서귀포시` → `제주 서귀포시`
    그 밖의 도      도 이름을 버리고 2depth 를 그대로 → `용인시 수지구` · `양평군`

    ★ `강남구` 처럼 **구만 남기지 않는다.** 어느 도시의 강남구인지 모르는 사람이 있다.
    """
    first = (region_1depth or "").strip()
    second = (region_2depth or "").strip()
    if not first:
        return second or None
    if first in _METROPOLITAN:
        short = _METROPOLITAN[first]
        # ★ 붙이는 것은 **구·군까지**다. 세종처럼 2depth 가 동(洞)으로 오는 곳이 있는데,
        #   그건 집 주소에 가깝다 — 그럴 때는 시 이름만 쓴다.
        if second.endswith(("구", "군")):
            return f"{short.removesuffix('시')} {second}"
        return short
    if first in _ISLAND_PREFIX:
        return f"{_ISLAND_PREFIX[first]} {second}".strip() if second else _ISLAND_PREFIX[first]
    # 도(경기도·강원특별자치도 …)는 앞말을 버린다. 2depth 에 이미 시·군·구가 들어 있다.
    return second or first


def _pick_document(documents: list[dict[str, Any]]) -> dict[str, Any] | None:
    """행정동(H)보다 법정동(B)을 먼저 쓴다 — 시·군·구 이름이 더 안정적이다."""
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


def resolve_place_for_upload(latitude: float | None, longitude: float | None, settings: Any) -> tuple[str | None, str]:
    """사진 한 장을 저장할 때 쓸 `(장소 이름, 출처)` — **좌표는 부르는 쪽이 버린다.**

    ★ 부르는 자리가 셋이다: 앨범 만들 때 · 그 밖의 업로드 · 참여자가 사진을 더할 때.
      셋이 각자 적으면 갈린다 — 실제로 갈렸다(2026-08-15 dev 실측: 셋 중 **하나만**
      이름을 채웠고, 나머지 둘은 이름을 null 로 박은 채 **좌표를 그대로 저장**했다).
      그래서 세 자리가 이 함수 하나를 부른다.

    ★ 출처는 **이름을 얻었는지**로 정한다. 좌표가 있는지로 정하면, 이름이 없는데도
      `exif` 라고 적혀 화면이 "장소를 안다"고 잘못 읽는다.

    ★ `getattr` 이다. 이 설정 값이 없어도 **업로드는 통과해야 한다** —
      place_name_service 가 약속한 것이 그것이다.
    """
    place_name = resolve_city_name_cached(latitude, longitude, getattr(settings, "kakao_rest_api_key", ""))
    return place_name, ("exif" if place_name else "unknown")
