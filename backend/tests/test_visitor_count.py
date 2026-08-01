from types import SimpleNamespace
from unittest import TestCase

from app.services.share_service import album_visitor_count


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _Client:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _Query(self._rows)


class VisitorCountTests(TestCase):
    def test_sums_view_count_across_all_links_of_the_album(self) -> None:
        client = _Client([{"view_count": 3}, {"view_count": 5}])
        self.assertEqual(album_visitor_count(client, "album-1"), 8)

    def test_treats_missing_or_null_view_count_as_zero(self) -> None:
        client = _Client([{"view_count": None}, {}, {"view_count": 2}])
        self.assertEqual(album_visitor_count(client, "album-1"), 2)

    def test_no_links_means_zero(self) -> None:
        self.assertEqual(album_visitor_count(_Client([]), "album-1"), 0)
