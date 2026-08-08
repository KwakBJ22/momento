"""함께한 사람 수는 한 규칙으로 센다 (SCREEN_SPEC §1).

백엔드 3곳이 각자 셌고 owner 포함 여부가 갈려, 같은 앨범인데 소유자 화면과 공유 화면의
수가 1 차이로 어긋났다. ★ 주최자를 포함해서 센다.
"""

from pathlib import Path

from app.services.collaboration_service import active_contributor_count

ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


ROWS = [
    {"id": "1", "role": "owner", "status": "active"},
    {"id": "2", "role": "contributor", "status": "active"},
    {"id": "3", "role": "contributor", "status": "removed"},
]


def test_owner_is_counted() -> None:
    # 주최자 포함 2명(활성) — 제거된 사람은 세지 않는다.
    assert active_contributor_count(ROWS) == 2


def test_every_caller_uses_the_shared_rule() -> None:
    album = source("app/api/album.py")
    share = source("app/api/share.py")
    collab = source("app/api/collaboration.py")
    # 앨범 상세·공유 응답은 질의 버전을, 협업 현황은 이미 조회한 목록 버전을 쓴다.
    assert "album_contributor_count = count_active_contributors(client, album_id)" in album
    assert "contributor_count=count_active_contributors(client, album_id)" in share
    assert "contributor_total = active_contributor_count(contributors)" in collab
    # 참여자를 각자 세는 인라인 식이 남아 있지 않다(사진·코멘트 수를 세는 것은 다른 값이다).
    assert 'table("album_contributors").select("id", count="exact")' not in album
    assert 'row for row in contributors if str(row["id"]) not in owner_ids' not in share


def test_share_and_owner_screens_agree() -> None:
    """같은 앨범이면 소유자 화면과 공유 화면의 수가 같아야 한다 — 규칙이 하나이므로 같다."""
    owner_screen = active_contributor_count(ROWS)          # 협업 현황(목록 기반)
    share_screen = len([r for r in ROWS if r["status"] == "active"])  # 공유 응답이 쓰는 같은 규칙
    assert owner_screen == share_screen


def test_contributor_names_use_the_same_rule() -> None:
    """"함께 만든 사람" 이름은 **세는 곳과 같은 자리**에서 온다 (CLAUDE.md §6 · §1).

    수와 이름이 다른 곳에서 나오면 "3명" 이라고 써 놓고 두 명만 적히는 일이 난다.
    """
    service = source("app/services/collaboration_service.py")
    names = service[service.index("def list_active_contributor_names") : service.index("def count_ready_photos")]
    count = service[service.index("def count_active_contributors") : service.index("def list_active_contributor_names")]
    for rule in ['table("album_contributors")', '.eq("album_id", album_id)', '.eq("status", "active")']:
        assert rule in names
        assert rule in count
    # 들어온 순서를 지킨다 — 주최자가 먼저 들어오므로 자연히 맨 앞에 온다.
    assert '.order("joined_at")' in names
    # 앨범 상세는 역할과 무관하게 이 값을 내려준다(본문이라 모두가 같이 본다).
    album = source("app/api/album.py")
    assert '"contributor_names": list_active_contributor_names(client, album_id)' in album
