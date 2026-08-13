"""관리자 대시보드는 저장소를 **한 번만** 훑는다.

원래는 `count_orphan_files` 와 `storage_usage` 가 각각 `list_recursive` 를 돌아
버킷을 두 번 훑었다. `list_recursive` 는 폴더마다 LIST 를 한 번 보내는데 경로가
`albums/<앨범>/photos/<사진>/` 이라 **사진 하나가 폴더 하나**다. 운영(사진 53장)에서
약 150회 순차 왕복이 되어 10.1초를 먹었다.

★ 남는 한계: 한 번으로 줄여도 **LIST 횟수는 여전히 사진 수에 비례한다.**
  이 검사는 "두 번 훑지 않는다"까지만 지킨다.
"""

import unittest
from unittest.mock import MagicMock, patch

from app.services.admin_service import build_ops_dashboard
from app.services.operations_service import count_orphan_files, storage_usage

BUCKET = "album-private"


def bucket_listing() -> list[dict]:
    """버킷 전체 목록 — albums 밑과 그 바깥이 섞여 있다."""
    return [
        {"path": "albums/a1/photos/p1/original.jpg", "metadata": {"size": 100}},
        {"path": "albums/a1/photos/p1/display.webp", "metadata": {"size": 10}},
        {"path": "albums/a1/photos/p2/original.jpg", "metadata": {"size": 200}},
        {"path": "albums/a1/result.pdf", "metadata": {"size": 50}},
        {"path": "albums/a2/photos/p3/original.jpg", "metadata": {"size": 300}},
        # albums 바깥 — 고아 계산에는 들어가지 않지만 용량에는 들어간다.
        {"path": "temp/scratch.bin", "metadata": {"size": 7}},
    ]


class CountingStorage:
    """`list_recursive` 가 몇 번 불렸는지 센다."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def list_recursive(self, bucket: str, prefix: str = "") -> list[dict]:
        self.calls.append(prefix)
        if prefix:
            return [f for f in bucket_listing() if f["path"].startswith(f"{prefix.strip('/')}/")]
        return bucket_listing()


def db_client() -> MagicMock:
    """album_photos 두 줄만 아는 DB — 나머지 저장소 파일은 고아다."""
    client = MagicMock()

    def table(name: str):
        result = MagicMock()
        if name == "album_photos":
            rows = [
                {"storage_path": "albums/a1/photos/p1/original.jpg",
                 "thumbnail_path": "", "display_path": "albums/a1/photos/p1/display.webp"},
                {"storage_path": "albums/a1/photos/p2/original.jpg",
                 "thumbnail_path": "", "display_path": ""},
            ]
        elif name == "albums":
            rows = [{"result_path": "albums/a1/result.pdf"}]
        else:
            rows = []
        result.select.return_value.limit.return_value.execute.return_value.data = rows
        return result

    client.table.side_effect = table
    return client


def settings() -> MagicMock:
    return MagicMock(supabase_private_storage_bucket=BUCKET)


class SharedListingKeepsSameNumbersTest(unittest.TestCase):
    """★ 같은 목록을 나눠 쓰는 것이므로 값이 달라지면 거른 조건이 틀린 것이다."""

    def test_고아_수가_스스로_훑을_때와_같다(self) -> None:
        storage = CountingStorage()
        with patch("app.services.operations_service.StorageService.for_supabase", return_value=storage):
            alone = count_orphan_files(db_client(), settings())
            shared = count_orphan_files(db_client(), settings(), files=bucket_listing())
        for key in ("stored_count", "known_count", "orphan_count", "orphan_sample", "bucket"):
            self.assertEqual(alone[key], shared[key], f"{key} 가 달라졌다")
        # 실제로 세고 있는지 — 값이 0 이면 검사가 아무것도 안 지킨다.
        self.assertEqual(alone["stored_count"], 5, "albums 밑 파일만 세야 한다")
        self.assertEqual(alone["orphan_count"], 1, "a2 의 사진 하나가 고아다")

    def test_albums_바깥_파일은_고아로_세지_않는다(self) -> None:
        """버킷 전체를 넘겨도 `albums/` 밑만 본다 — prefix 로 훑던 것과 같은 집합이다."""
        shared = count_orphan_files(db_client(), settings(), files=bucket_listing())
        self.assertNotIn("temp/scratch.bin", shared["orphan_sample"])
        self.assertEqual(shared["stored_count"], 5)

    def test_용량과_파일수가_스스로_훑을_때와_같다(self) -> None:
        storage = CountingStorage()
        with patch("app.services.operations_service.StorageService.for_supabase", return_value=storage):
            alone = storage_usage(db_client(), settings())
            shared = storage_usage(db_client(), settings(), files=bucket_listing())
        self.assertEqual(alone, shared)
        self.assertEqual(alone["file_count"], 6, "용량은 버킷 전체를 센다")
        self.assertEqual(alone["bytes"], 667)

    def test_인자를_안_주면_지금까지처럼_스스로_훑는다(self) -> None:
        """운영 CLI 는 인자 없이 부른다 — 그 길이 살아 있어야 한다."""
        storage = CountingStorage()
        with patch("app.services.operations_service.StorageService.for_supabase", return_value=storage):
            count_orphan_files(db_client(), settings())
            storage_usage(db_client(), settings())
        self.assertEqual(storage.calls, ["albums", ""], "스스로 훑는 길이 끊겼다")


class DashboardScansStorageOnceTest(unittest.TestCase):
    def test_대시보드를_한_번_그릴_때_저장소를_한_번만_훑는다(self) -> None:
        """★ 이 검사가 없으면 나중에 또 두 번이 된다."""
        storage = CountingStorage()
        with patch("app.services.admin_service.StorageService.for_supabase", return_value=storage), \
             patch("app.services.operations_service.StorageService.for_supabase", return_value=storage):
            build_ops_dashboard(db_client(), settings())
        self.assertEqual(len(storage.calls), 1, f"저장소를 {len(storage.calls)}번 훑었다: {storage.calls}")
        self.assertEqual(storage.calls, [""], "버킷 전체를 한 번 받아 나눠 써야 한다")

    def test_저장소가_막혀도_대시보드는_뜬다(self) -> None:
        broken = MagicMock()
        broken.list_recursive.side_effect = RuntimeError("storage down")
        with patch("app.services.admin_service.StorageService.for_supabase", return_value=broken):
            payload = build_ops_dashboard(db_client(), settings())
        self.assertEqual(payload["data_health"]["orphan_files"], 0)
        self.assertEqual(payload["data_health"]["storage_bytes"], 0)


if __name__ == "__main__":
    unittest.main()
