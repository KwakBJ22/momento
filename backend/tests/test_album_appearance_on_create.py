"""만들 때 고른 앨범 **모양**·**종이 색**을 받아 저장한다 (2026-08-18).

★ 목록 밖의 값은 **400 이 아니라 빈 값**이다. 겉모습 때문에 앨범을 못 만들면 안 된다.
  빈 값이면 칸을 비워 두고, 화면은 지금처럼 카테고리 추천을 건다.
★ 고치는 길(PATCH /albums/{id})은 그대로 400 이다 — 거기는 이미 만든 앨범을 바꾸는
  자리라 못 고쳤다는 사실을 알려야 한다(test_album_appearance.py).
★ migration 이 없다. albums.skin · albums.paper 는 이미 있는 칸이다.
"""

import inspect
from unittest import TestCase

from app.api.album import upload_album
from app.models.schemas import normalize_album_paper, normalize_album_skin
from app.services.supabase import save_album_record


class AlbumAppearanceOnCreateTests(TestCase):
    def test_unknown_values_become_empty_instead_of_400(self) -> None:
        for bad in ["", "   ", "polaroid", "BASIC", "1", "; drop table albums"]:
            self.assertIsNone(normalize_album_skin(bad), f"모양 {bad!r}")
        for bad in ["", "beige", "WHITE", "0"]:
            self.assertIsNone(normalize_album_paper(bad), f"종이 {bad!r}")
        self.assertIsNone(normalize_album_skin(None))
        self.assertIsNone(normalize_album_paper(None))

    def test_known_values_pass_through(self) -> None:
        for good in ["basic", "scrapbook", "airy", "grid", "magazine", "single"]:
            self.assertEqual(normalize_album_skin(good), good)
        for good in ["white", "cream", "gray"]:
            self.assertEqual(normalize_album_paper(good), good)
        # 앞뒤 공백은 값이 아니다 — 잘라서 본다.
        self.assertEqual(normalize_album_skin(" airy "), "airy")

    def test_upload_album_takes_both_fields_and_defaults_to_empty(self) -> None:
        params = inspect.signature(upload_album).parameters
        for name in ("skin", "paper"):
            self.assertIn(name, params, f"upload-album 이 {name} 을 받지 않는다")
            self.assertEqual(params[name].default.default, "", f"{name} 기본값이 빈 값이 아니다")

    def test_save_album_record_carries_them(self) -> None:
        params = inspect.signature(save_album_record).parameters
        for name in ("skin", "paper"):
            self.assertIn(name, params, f"save_album_record 가 {name} 을 받지 않는다")
            self.assertIsNone(params[name].default, f"{name} 기본값이 None 이 아니다")

    def test_empty_choice_inserts_exactly_what_it_used_to(self) -> None:
        """안 골랐으면 칸을 아예 쓰지 않는다 — 예전과 똑같은 insert 다."""
        source = inspect.getsource(save_album_record)
        self.assertIn('record["skin"] = skin', source)
        self.assertIn('record["paper"] = paper', source)
        self.assertIn("if skin:", source)
        self.assertIn("if paper:", source)
