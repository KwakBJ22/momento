"""버킷 이름은 한 곳에서 나오고, 옛 이름이 남아 있지 않다 (K-1-c).

사진이 한 장이라도 쌓이면 버킷은 못 바꾼다 — `album_photos.storage_bucket` 과
`albums.result_bucket` 이 **행마다** 버킷 이름을 들고 있기 때문이다.
데이터가 0건인 지금만 할 수 있는 일이라, 다시 갈라지지 않게 잠가 둔다.
"""

from __future__ import annotations

import inspect
from pathlib import Path

from app.config import Settings
from app.services import guest_album_cleanup, operations_service, supabase

BUCKET = "woorialbum-private"
APP = Path(__file__).resolve().parents[1] / "app"


def test_defaults_point_at_the_new_bucket() -> None:
    fields = Settings.model_fields
    assert fields["supabase_private_storage_bucket"].default == BUCKET
    # ★ 버킷은 하나다. 옛 `albums` 자리도 같은 값을 가리킨다 — 그래야 옛 버킷을
    #   지워도 버킷 목록을 훑는 코드가 없는 버킷을 list 하지 않는다.
    assert fields["supabase_storage_bucket"].default == BUCKET


def test_bucket_scans_collapse_to_one() -> None:
    """두 설정이 같은 값이면 훑는 목록도 하나가 된다."""
    for source in (
        inspect.getsource(operations_service.check_storage),
        inspect.getsource(guest_album_cleanup.find_orphan_storage_albums),
    ):
        assert "supabase_private_storage_bucket" in source
        # 중복을 지우는 장치가 있어야 같은 버킷을 두 번 훑지 않는다.
        assert "not in buckets" in source or "set(" in source or "or [" in source


def test_no_old_bucket_name_in_app_code() -> None:
    offenders = []
    for path in sorted(APP.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        # 배포 호스트(momento-ashen-rho)는 도메인을 붙일 때 없앤다 — 버킷과 무관하다.
        cleaned = text.replace("momento-ashen-rho", "")
        if "momento" in cleaned.lower():
            offenders.append(str(path.relative_to(APP)))
    assert offenders == []


def test_signed_url_fallbacks_use_the_new_name() -> None:
    source = inspect.getsource(supabase.get_result_signed_url)
    assert BUCKET in source
    assert "momento" not in source
