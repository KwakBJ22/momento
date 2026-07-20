from __future__ import annotations

import unittest

from app.models.album_styles import (
    cover_line_for_category,
    layout_for_template_type,
    normalize_template_type,
    recommended_template_type,
    style_context,
)


class AlbumStylesTests(unittest.TestCase):
    def test_recommended_by_category(self) -> None:
        self.assertEqual(recommended_template_type("family"), "warm")
        self.assertEqual(recommended_template_type("friend"), "joyful")
        self.assertEqual(recommended_template_type("couple"), "special")
        self.assertEqual(recommended_template_type("colleague"), "joyful")
        self.assertEqual(recommended_template_type("pet"), "warm")
        self.assertEqual(recommended_template_type("travel"), "joyful")
        self.assertEqual(recommended_template_type("other"), "warm")
        self.assertEqual(recommended_template_type("friends"), "joyful")
        self.assertEqual(recommended_template_type("unknown"), "warm")

    def test_normalize_defaults_to_warm(self) -> None:
        self.assertEqual(normalize_template_type(None), "warm")
        self.assertEqual(normalize_template_type(""), "warm")
        self.assertEqual(normalize_template_type("JOYFUL"), "joyful")

    def test_layout_mapping(self) -> None:
        self.assertEqual(layout_for_template_type("warm"), "A")
        self.assertEqual(layout_for_template_type("joyful"), "B")
        self.assertEqual(layout_for_template_type("special"), "C")

    def test_context_helpers(self) -> None:
        self.assertIn("차분", style_context("warm"))
        self.assertIn("가족", cover_line_for_category("family"))


if __name__ == "__main__":
    unittest.main()
