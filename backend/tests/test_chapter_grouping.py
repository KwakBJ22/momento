from __future__ import annotations

import unittest
from datetime import date, timedelta


def days_between(a: str, b: str) -> int:
    ya, ma, da = map(int, a.split("-"))
    yb, mb, db = map(int, b.split("-"))
    return (date(yb, mb, db) - date(ya, ma, da)).days


def format_month_event(date_key: str | None, place: str | None) -> str:
    if not date_key:
        return place or "함께한 순간"
    year, month, _ = date_key.split("-")
    label = f"{int(year)}년 {int(month)}월"
    return f"{label} · {place}" if place else label


def group_events(dates: list[str], gap_split: int = 3) -> list[list[str]]:
    keys = sorted(set(dates))
    if not keys:
        return []
    trips: list[list[str]] = [[keys[0]]]
    for key in keys[1:]:
        prev = trips[-1][-1]
        if 0 <= days_between(prev, key) < gap_split:
            trips[-1].append(key)
        else:
            trips.append([key])
    return trips


def titles_for_trips(trips: list[list[str]], places: dict[str, str] | None = None) -> list[str]:
    places = places or {}
    out: list[str] = []
    for trip in trips:
        if len(trip) >= 2:
            for i, _ in enumerate(trip, start=1):
                out.append(f"Day {i}")
        else:
            key = trip[0]
            out.append(format_month_event(key, places.get(key)))
    return out


def normalize(text: str) -> str:
    return " ".join(text.split())


def stories_overlap(a: str, b: str, ratio: float = 0.6) -> bool:
    left, right = normalize(a), normalize(b)
    if not left or not right:
        return False
    if left == right:
        return True
    if left in right or right in left:
        shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
        if len(shorter) / len(longer) >= 0.7:
            return True
    left_s = [s.strip() for s in left.replace("!", ".").replace("?", ".").split(".") if s.strip()]
    right_s = [s.strip() for s in right.replace("!", ".").replace("?", ".").split(".") if s.strip()]
    if not left_s or not right_s:
        return False
    right_set = set(right_s)
    shared = sum(1 for s in left_s if s in right_set)
    return shared / min(len(left_s), len(right_s)) >= ratio


class ChapterGroupingTests(unittest.TestCase):
    def test_three_nights_four_days_trip(self) -> None:
        start = date(2018, 7, 12)
        dates = [(start + timedelta(days=i)).isoformat() for i in range(4)]
        trips = group_events(dates)
        self.assertEqual(len(trips), 1)
        self.assertEqual(titles_for_trips(trips), ["Day 1", "Day 2", "Day 3", "Day 4"])

    def test_months_apart_are_separate_events(self) -> None:
        trips = group_events(["2018-07-12", "2019-01-05"])
        titles = titles_for_trips(trips, {"2018-07-12": "다낭", "2019-01-05": "서울"})
        self.assertEqual(titles, ["2018년 7월 · 다낭", "2019년 1월 · 서울"])

    def test_gap_of_three_days_splits(self) -> None:
        trips = group_events(["2018-07-12", "2018-07-15"])
        self.assertEqual(len(trips), 2)

    def test_gap_of_two_days_stays_trip(self) -> None:
        trips = group_events(["2018-07-12", "2018-07-14"])
        self.assertEqual(len(trips), 1)
        self.assertEqual(titles_for_trips(trips), ["Day 1", "Day 2"])

    def test_unknown_place_uses_month_only(self) -> None:
        self.assertEqual(format_month_event("2018-07-12", None), "2018년 7월")
        self.assertEqual(format_month_event(None, None), "함께한 순간")


class StoryOverlapTests(unittest.TestCase):
    def test_identical_stories_overlap(self) -> None:
        text = "그날의 웃음이 아직도 선명하다."
        self.assertTrue(stories_overlap(text, text))

    def test_mostly_shared_sentences_overlap(self) -> None:
        a = "바다를 걸었다. 파도가 높았다. 저녁이 예뻤다."
        b = "바다를 걸었다. 파도가 높았다. 밤하늘이 맑았다."
        self.assertTrue(stories_overlap(a, b))

    def test_distinct_stories_do_not_overlap(self) -> None:
        a = "공항에서 출발하며 설렜다."
        b = "마지막 날 일출을 보았다."
        self.assertFalse(stories_overlap(a, b))


if __name__ == "__main__":
    unittest.main()
