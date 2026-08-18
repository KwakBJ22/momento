"""🔴 좌표는 읽히는데 **이름으로 바꾸는 자리가 없었다** (dev 실측 2026-08-15).

4019.jpg 에 위도 37.316389 · 경도 127.071389 이 들어와 있는데 location_name 은 null 이고
location_source 는 "exif" 였다 — 화면은 "장소를 안다"고 읽는데 보여 줄 이름이 없다.

까닭: 사진을 저장하는 자리가 **셋**인데 그중 하나만 고쳤다.
    app/api/album.py         앨범 만들 때        ← 됐다
    app/api/album.py         그 밖의 업로드       ← 빠졌다 (좌표를 그대로 저장까지 했다)
    app/api/collaboration.py 참여자가 사진 추가   ← 빠졌다 (같음)

그래서 판정을 `place_name_service.resolve_place_for_upload` 한 곳으로 묶고,
세 자리가 그것을 부르게 했다. 여기서 잠그는 것은 **셋이 같은가**다.
"""

import pathlib
import re
from unittest import TestCase
from unittest.mock import patch

from app.services.place_name_service import resolve_place_for_upload

APP = pathlib.Path(__file__).resolve().parents[1] / "app"


class Settings:
    def __init__(self, key: str = "kakao-key") -> None:
        self.kakao_rest_api_key = key


class NoKeySettings:
    """설정 값 자체가 없는 환경 — 예전에 AttributeError 로 500 이 났다."""


class ResolvePlaceForUploadTests(TestCase):
    def test_이름을_얻으면_exif_다(self) -> None:
        with patch("app.services.place_name_service.resolve_city_name_cached", return_value="용인시"):
            self.assertEqual(resolve_place_for_upload(37.31, 127.07, Settings()), ("용인시", "exif"))

    def test_이름을_못_얻으면_unknown_이다(self) -> None:
        """★ 출처는 **이름을 얻었는지**로 정한다. 좌표가 있는지로 정하면, 이름이 없는데도
        `exif` 라고 적혀 화면이 "장소를 안다"고 잘못 읽는다 — 그것이 이번 결함의 모양이었다."""
        with patch("app.services.place_name_service.resolve_city_name_cached", return_value=None):
            self.assertEqual(resolve_place_for_upload(37.31, 127.07, Settings()), (None, "unknown"))

    def test_좌표가_없으면_조용히_지나간다(self) -> None:
        self.assertEqual(resolve_place_for_upload(None, None, Settings()), (None, "unknown"))

    def test_키_설정이_아예_없어도_터지지_않는다(self) -> None:
        """★ 회귀 ③ — 사진 업로드가 지명 하나 때문에 실패하면 안 된다."""
        self.assertEqual(resolve_place_for_upload(37.31, 127.07, NoKeySettings()), (None, "unknown"))

    def test_카카오가_실패해도_예외가_밖으로_나오지_않는다(self) -> None:
        """★ 회귀 ② — 조회가 죽어도 업로드는 성공해야 한다."""
        with patch("app.services.place_name_service.httpx.get", side_effect=RuntimeError("kakao down")):
            self.assertEqual(resolve_place_for_upload(37.31, 127.07, Settings()), (None, "unknown"))


class EveryWriteSiteLooksTheSameTests(TestCase):
    """★ 회귀 ① — 세 자리 모두 지명을 채우고 **좌표를 버린다**."""

    def setUp(self) -> None:
        self.album = (APP / "api" / "album.py").read_text(encoding="utf-8")
        self.collab = (APP / "api" / "collaboration.py").read_text(encoding="utf-8")

    def test_세_자리가_같은_함수를_부른다(self) -> None:
        calls = len(re.findall(r"resolve_place_for_upload\(processed\.latitude, processed\.longitude, settings\)", self.album))
        self.assertEqual(calls, 2, f"album.py 의 저장 자리가 둘이 아니다({calls})")
        self.assertIn(
            "resolve_place_for_upload(processed.latitude, processed.longitude, settings)",
            self.collab,
            "참여자가 사진을 더하는 자리가 아직 다른 방식이다",
        )

    def test_어느_자리도_좌표를_저장하지_않는다(self) -> None:
        """집 주소가 드러나는 값이다(§9). 이름으로 바꾼 뒤 버린다."""
        for name, source in (("album.py", self.album), ("collaboration.py", self.collab)):
            self.assertNotIn('"latitude": processed.latitude', source, f"{name} 가 좌표를 저장한다")
            self.assertNotIn('"longitude": processed.longitude', source, f"{name} 가 좌표를 저장한다")

    def test_옛_방식이_남아_있지_않다(self) -> None:
        """좌표가 있는지로 출처를 정하던 자리 — 그것이 `이름 없는 exif` 를 만들었다."""
        old = '"exif"\n                if processed.latitude is not None'
        for name, source in (("album.py", self.album), ("collaboration.py", self.collab)):
            self.assertNotIn(old, source, f"{name} 에 옛 판정이 남았다")
        self.assertNotIn('"location_name": None', self.collab)


class BackfillScriptTests(TestCase):
    """이미 쌓인 행을 맞추는 스크립트 — 무엇을 하지 **않는지**가 중요하다."""

    def setUp(self) -> None:
        self.source = (APP.parent / "scripts" / "backfill_place_names.py").read_text(encoding="utf-8")

    def test_기본이_dry_run_이다(self) -> None:
        self.assertIn('"--apply", action="store_true"', self.source)
        self.assertIn("if not args.apply:", self.source)

    def test_이름을_못_얻은_행은_건드리지_않는다(self) -> None:
        """좌표를 지워 버리면 다음에 다시 시도할 수 없다."""
        self.assertIn("unresolved", self.source)
        apply_block = self.source[self.source.index("    written = 0"):]
        self.assertIn("for photo_id, name in resolved:", apply_block)
        self.assertNotIn("unresolved:", apply_block)

    def test_채운_뒤에는_좌표를_지운다(self) -> None:
        self.assertIn('"latitude": None, "longitude": None,', self.source)

    def test_이미_이름이_있는_행은_대상이_아니다(self) -> None:
        self.assertIn('if not str(row.get("location_name") or "").strip()', self.source)
