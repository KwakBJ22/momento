from unittest import TestCase

from app.services.admin_kpi_service import album_is_living, page_append_count


class AdminKpiServiceTests(TestCase):
    def test_album_is_living_when_append_pages_exist(self) -> None:
        album = {"living_append_pages": [{"id": "p1"}], "album_version": 0}
        self.assertTrue(album_is_living(album))

    def test_page_append_count(self) -> None:
        album = {"living_append_pages": [{}, {}]}
        self.assertEqual(page_append_count(album), 2)
