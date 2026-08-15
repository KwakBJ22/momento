"""좌표 → 화면에 쓸 한 마디. **구(區)까지** 보여준다 (PO 결정 2026-08-15 · A안).

★ 2026-08-13 에는 `시·군까지만` 이었다. 그때 규칙은 지역 종류마다 결과가 갈렸다:
      경기도 용인시 수지구  →  용인시 수지구   구가 남는다
      서울특별시 강남구     →  서울시          ★ 구가 사라진다
  광역시는 표로 1depth 를 바꿔치기하면서 2depth(구)를 통째로 버렸다. 그래서 서울에서
  찍은 사진이 강남이든 종로든 전부 `서울시` 하나로 뭉쳤다.

★ 왜 넓혔나: **사용자가 연필로 고칠 수 있다.** 좁아서 생기는 문제보다 어디였는지
  안 떠오르는 쪽이 손해가 크다. 구 단위는 수십만 명이 사는 범위라 집이 좁혀지지 않는다.

여기까지다 — 동(洞)·번지로는 내려가지 않는다.
"""

from unittest import TestCase

from app.services.place_name_service import shorten_region


class ShortenRegionTests(TestCase):
    def test_값으로_고정한다(self) -> None:
        cases = [
            # 도 — 도 이름을 버리고 2depth 를 그대로 쓴다
            (("경기도", "용인시 수지구"), "용인시 수지구"),
            (("경기도", "광주시"), "광주시"),
            (("경기도", "양평군"), "양평군"),
            (("강원특별자치도", "삼척시"), "삼척시"),
            # 광역시·특별시 — `시` 를 떼고 구를 붙인다
            (("서울특별시", "강남구"), "서울 강남구"),
            (("서울특별시", "종로구"), "서울 종로구"),
            (("부산광역시", "해운대구"), "부산 해운대구"),
            (("부산광역시", "기장군"), "부산 기장군"),
            # 2depth 가 없으면 줄인 이름 그대로
            (("세종특별자치시", ""), "세종시"),
            # 제주 — 섬 이름이 붙어야 어디인지 안다
            (("제주특별자치도", "서귀포시"), "제주 서귀포시"),
        ]
        for (first, second), expected in cases:
            self.assertEqual(shorten_region(first, second), expected, f"{first} {second}")

    def test_구만_남기지_않는다(self) -> None:
        """★ 어느 도시의 강남구인지 모르는 사람이 있다."""
        for first in ("서울특별시", "부산광역시"):
            result = shorten_region(first, "강남구")
            self.assertTrue(result and " " in result, f"{first}: {result}")
            self.assertNotEqual(result, "강남구")

    def test_동으로는_내려가지_않는다(self) -> None:
        """세종처럼 2depth 가 동(洞)으로 오는 곳 — 그건 집 주소에 가깝다."""
        self.assertEqual(shorten_region("세종특별자치시", "고운동"), "세종시")

    def test_비어_있으면_있는_것을_쓴다(self) -> None:
        self.assertEqual(shorten_region("", "용인시 수지구"), "용인시 수지구")
        self.assertEqual(shorten_region("경기도", ""), "경기도")
        self.assertIsNone(shorten_region("", ""))

    def test_옛_규칙으로_돌아가지_않았다(self) -> None:
        """`서울시` 하나로 뭉치던 그 모양이다 — 되살아나면 여기서 잡힌다."""
        self.assertNotEqual(shorten_region("서울특별시", "강남구"), "서울시")
