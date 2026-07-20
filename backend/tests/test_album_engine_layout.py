from __future__ import annotations

import unittest


class ChapterGroupMirrorTests(unittest.TestCase):
    @staticmethod
    def days_between(a: str, b: str) -> int:
        from datetime import date

        ya, ma, da = map(int, a.split("-"))
        yb, mb, db = map(int, b.split("-"))
        return (date(yb, mb, db) - date(ya, ma, da)).days

    @staticmethod
    def group(dates: list[str | None]) -> list[tuple[str | None, int]]:
        dated: dict[str, int] = {}
        undated = 0
        for value in dates:
            if value is None:
                undated += 1
            else:
                dated[value] = dated.get(value, 0) + 1
        keys = sorted(dated.keys())
        if not keys:
            return [(None, undated)]
        buckets = [(key, dated[key]) for key in keys]
        if undated:
            last_key, last_count = buckets[-1]
            buckets[-1] = (last_key, last_count + undated)
        return buckets

    def test_undated_merges_into_last_chapter(self) -> None:
        self.assertEqual(
            self.group(["2026-07-12", "2026-07-12", "2026-07-13", None, None]),
            [("2026-07-12", 2), ("2026-07-13", 3)],
        )

    def test_consecutive_dates_form_trip(self) -> None:
        dates = ["2018-07-12", "2018-07-13", "2018-07-14", "2018-07-15"]
        trips: list[list[str]] = []
        for key in dates:
            if not trips or self.days_between(trips[-1][-1], key) >= 3:
                trips.append([key])
            else:
                trips[-1].append(key)
        self.assertEqual(len(trips), 1)
        self.assertEqual(len(trips[0]), 4)


class MemoryFlowMirrorTests(unittest.TestCase):
    CONNECTORS = ["그리고", "그 후", "잠시 뒤"]

    @staticmethod
    def resolve(text: str) -> str | None:
        value = " ".join(text.split())
        if not value:
            return None
        n = len(value)
        if n <= 20:
            return "polaroidCaption"
        if n <= 80:
            return "memoryCaption"
        return "memoryBlock"

    def editorial_merge(self, parts: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for part in parts:
            text = " ".join(part.split())
            if not text or text in seen:
                continue
            seen.add(text)
            out.append(text)
        if len(out) <= 1:
            return out
        merged = [out[0]]
        for index, text in enumerate(out[1:], start=0):
            connector = self.CONNECTORS[index % len(self.CONNECTORS)]
            merged.append(f"{connector} {text}")
        return merged

    def plan_runs(self, has_comment: list[bool]) -> list[str]:
        """Return action kinds per photo: none|caption|block|merged."""
        actions: list[str] = ["none"] * len(has_comment)
        i = 0
        while i < len(has_comment):
            if not has_comment[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(has_comment) and has_comment[j + 1]:
                j += 1
            run_len = j - i + 1
            if run_len >= 3:
                for k in range(i, j):
                    actions[k] = "merged"
                actions[j] = "block"
            else:
                for k in range(i, j + 1):
                    actions[k] = "caption_or_block"
            i = j + 1
        return actions

    def collapse_memory(self, kinds: list[str]) -> list[str]:
        out: list[str] = []
        for kind in kinds:
            if kind == "MemoryBlock" and out and out[-1] == "MemoryBlock":
                continue
            out.append(kind)
        return out

    def test_length_bands(self) -> None:
        self.assertEqual(self.resolve("짧은 메모"), "polaroidCaption")
        self.assertEqual(self.resolve("가" * 21), "memoryCaption")
        self.assertEqual(self.resolve("가" * 81), "memoryBlock")

    def test_consecutive_three_merge(self) -> None:
        self.assertEqual(
            self.plan_runs([True, True, True, False, True]),
            ["merged", "merged", "block", "none", "caption_or_block"],
        )

    def test_editorial_connectors(self) -> None:
        merged = self.editorial_merge(["첫 기억", "둘째 기억", "셋째 기억"])
        self.assertEqual(merged[0], "첫 기억")
        self.assertTrue(merged[1].startswith("그리고 "))
        self.assertTrue(merged[2].startswith("그 후 "))

    def test_no_consecutive_memory_blocks(self) -> None:
        self.assertEqual(
            self.collapse_memory(["Hero", "MemoryBlock", "MemoryBlock", "Grid6"]),
            ["Hero", "MemoryBlock", "Grid6"],
        )

    def test_author_merge_keeps_labels(self) -> None:
        entries = [("아빠", "정말 즐거웠다."), ("엄마", "아이들이 행복해했다.")]
        rendered = [f"{author}\n{text}" for author, text in entries]
        self.assertIn("아빠", rendered[0])
        self.assertIn("엄마", rendered[1])


if __name__ == "__main__":
    unittest.main()
