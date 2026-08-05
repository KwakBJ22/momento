"""참여자 초대 문구 앞칸 판정: 소유자 display_name 을 노출해도 되는가.

한글 포함 여부로 판정하지 않는다 — Jenny 같은 영문 실명이 걸린다.
진짜 원인은 이름이 계정 이메일의 @ 앞부분(kbjkwak)이라는 것."""
from __future__ import annotations

import unittest

from app.services.membership import usable_owner_display_name


class UsableOwnerDisplayNameTests(unittest.TestCase):
    def test_email_local_part_is_rejected(self) -> None:
        # 실측: display_name=kbjkwak, email=kbjkwak@gmail.com → "kbjkwak님이" 노출 금지.
        self.assertIsNone(usable_owner_display_name("kbjkwak", "kbjkwak@gmail.com"))
        self.assertIsNone(usable_owner_display_name("KBJKWAK", "kbjkwak@gmail.com"))  # 대소문자 무시

    def test_english_real_name_is_allowed(self) -> None:
        # 한글 없음 ≠ 아이디: 이메일 앞부분과 다르면 실명으로 취급한다.
        self.assertEqual(usable_owner_display_name("Jenny", "jkim@example.com"), "Jenny")

    def test_korean_name_is_allowed(self) -> None:
        self.assertEqual(usable_owner_display_name("영희", "kbjkwak@gmail.com"), "영희")

    def test_empty_at_sign_and_digits_are_rejected(self) -> None:
        self.assertIsNone(usable_owner_display_name("", "a@b.com"))
        self.assertIsNone(usable_owner_display_name("   ", "a@b.com"))
        self.assertIsNone(usable_owner_display_name(None, "a@b.com"))
        self.assertIsNone(usable_owner_display_name("kbjkwak@gmail.com", "kbjkwak@gmail.com"))
        self.assertIsNone(usable_owner_display_name("12345", "a@b.com"))

    def test_missing_email_still_applies_secondary_rules(self) -> None:
        # 이메일을 못 가져와도 보조 조건은 그대로; 정상 이름은 통과한다.
        self.assertEqual(usable_owner_display_name("영희", None), "영희")
        self.assertIsNone(usable_owner_display_name("777", None))


if __name__ == "__main__":
    unittest.main()
