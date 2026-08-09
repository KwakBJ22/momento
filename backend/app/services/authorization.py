"""Server-side authorization for family and album membership.

The API uses the Supabase service role, so every protected handler must call
these helpers instead of trusting client-supplied role or family identifiers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status

FAMILY_ROLE_RANK: dict[str, int] = {
    "viewer": 1,
    "member": 2,
    "admin": 3,
    "owner": 4,
}

ALBUM_ROLE_RANK: dict[str, int] = {
    "viewer": 1,
    "contributor": 2,
    "editor": 3,
    "owner": 4,
}

MANAGER_FAMILY_ROLES = frozenset({"owner", "admin"})
WRITE_FAMILY_ROLES = frozenset({"owner", "admin", "member"})
ALBUM_SETTINGS_ROLES = frozenset({"owner", "editor"})
ALBUM_CONTRIBUTE_ROLES = frozenset({"owner", "editor", "contributor"})
ALBUM_MANAGE_MEMBER_ROLES = frozenset({"owner", "editor"})


@dataclass(frozen=True)
class AlbumAccess:
    family_role: str | None
    album_role: str | None
    is_legacy_owner: bool
    #: 참여가 끝난 앨범인가(``albums.collaboration_status == "closed"``).
    #:
    #: ★ 역할과 별개다. 참여가 끝나면 **주최자를 포함해 아무도** 사진·한마디를 더할 수
    #: 없다(collaboration_service.require_contributor · api/collaboration.py 가 403 을 낸다).
    #: 그런데 ``can_contribute`` 는 역할만 보고 있어서 화면에는 버튼이 그대로 남았고,
    #: 누르면 403 이 났다 — 같은 사실을 두 곳에서 따로 계산한 결과다(J-8 · §1·§11).
    collaboration_closed: bool = False

    @property
    def can_read_private(self) -> bool:
        if self.is_legacy_owner:
            return True
        if self.family_role is not None:
            return True
        if self.album_role is not None:
            return True
        return False

    @property
    def is_album_owner(self) -> bool:
        if self.is_legacy_owner:
            return True
        if self.family_role == "owner":
            return True
        return self.album_role == "owner"

    @property
    def can_edit_settings(self) -> bool:
        if self.is_legacy_owner:
            return True
        if self.family_role in MANAGER_FAMILY_ROLES:
            return True
        return self.album_role in ALBUM_SETTINGS_ROLES

    @property
    def can_contribute(self) -> bool:
        """**자격**이 있는가 — 이 앨범에 손댈 수 있는 사람인가.

        앨범이 지금 참여를 받고 있는지는 보지 않는다. 주최자는 참여를 마친 뒤에도
        캡션을 고칠 수 있어야 한다(§7 — 인쇄되는 것만 주최자가 고친다).
        **더할 수 있는가**는 아래 ``can_add_contribution`` 이다.
        """
        if self.is_legacy_owner:
            return True
        if self.family_role in MANAGER_FAMILY_ROLES:
            return True
        return self.album_role in ALBUM_CONTRIBUTE_ROLES

    @property
    def can_add_contribution(self) -> bool:
        """**지금 사진·한마디를 더할 수 있는가** — 자격 + 앨범이 열려 있는가.

        ★ 화면이 읽는 것은 이 값이다(J-8 · §1·§11). 참여가 끝나면 백엔드는
        **주최자를 포함해 아무도** 더하지 못하게 막는데(collaboration_service
        .require_contributor · api/collaboration.py), ``can_contribute`` 는 역할만
        보고 있어서 화면에는 버튼이 그대로 남았다 — 누르면 403 이었다.
        같은 사실을 두 곳에서 따로 계산한 결과다.

        공유 링크 경로는 이미 ``share_service.contribution_block_reason`` 이 같은
        판정을 하고 있었다. 두 경로가 갈라져 있던 것을 여기서 맞춘다.
        """
        return self.can_contribute and not self.collaboration_closed

    @property
    def can_delete_album(self) -> bool:
        if self.is_legacy_owner:
            return True
        if self.family_role == "owner":
            return True
        if self.family_role == "admin":
            return True
        return self.album_role == "owner"

    @property
    def can_manage_album_members(self) -> bool:
        if self.is_legacy_owner:
            return True
        if self.family_role in MANAGER_FAMILY_ROLES:
            return True
        return self.album_role in ALBUM_MANAGE_MEMBER_ROLES

    @property
    def can_answer_questions(self) -> bool:
        return self.can_read_private

    @property
    def can_regenerate_questions(self) -> bool:
        return self.can_edit_settings


def _family_role_rank(role: str | None) -> int:
    if role is None:
        return 0
    return FAMILY_ROLE_RANK.get(role, 0)


def _album_role_rank(role: str | None) -> int:
    if role is None:
        return 0
    return ALBUM_ROLE_RANK.get(role, 0)


def resolve_album_access(
    album: dict[str, Any],
    user_id: str,
    family_role: str | None,
    album_role: str | None,
) -> AlbumAccess:
    legacy_owner = not album.get("family_id") and str(album.get("owner_id") or "") == user_id
    return AlbumAccess(
        family_role=family_role,
        album_role=album_role,
        is_legacy_owner=legacy_owner,
        collaboration_closed=album.get("collaboration_status") == "closed",
    )


# The absence of every role: a caller with no relationship to the album.
NO_ALBUM_ACCESS = AlbumAccess(family_role=None, album_role=None, is_legacy_owner=False)


def guest_album_owner_access() -> AlbumAccess:
    """Owner-level access granted to a valid guest-session token holder.

    A guest album is unclaimed (owner_id/family_id NULL) and belongs to whoever
    holds its session token until it is claimed at login. Modelled as an
    ``owner`` album role so every capability (read/edit/contribute) resolves the
    same way it does for a real owner — authorization stays in one place.
    """
    return AlbumAccess(family_role=None, album_role="owner", is_legacy_owner=False)


def require_album_read(access: AlbumAccess) -> None:
    if not access.can_read_private:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this album.",
        )


def require_album_edit_settings(access: AlbumAccess) -> None:
    if not access.can_edit_settings:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to edit this album.",
        )


def require_album_owner_story(access: AlbumAccess) -> None:
    """에필로그(우리의 이야기)는 owner만 수정."""
    if not access.is_album_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="앨범 주인의 이야기만 수정할 수 있어요.",
        )


def require_album_contribute(access: AlbumAccess) -> None:
    if not access.can_contribute:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to add content to this album.",
        )


def require_album_delete(access: AlbumAccess) -> None:
    if not access.can_delete_album:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this album.",
        )


def require_album_member_manage(access: AlbumAccess) -> None:
    if not access.can_manage_album_members:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage album participants.",
        )


def require_album_answer(access: AlbumAccess) -> None:
    if not access.can_answer_questions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to answer questions for this album.",
        )


def require_album_regenerate_questions(access: AlbumAccess) -> None:
    if not access.can_regenerate_questions:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to regenerate questions.",
        )


def require_family_manager(family_role: str | None) -> None:
    if family_role not in MANAGER_FAMILY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only family owners or admins can perform this action.",
        )


def require_family_owner(family_role: str | None) -> None:
    if family_role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the family owner can perform this action.",
        )


def can_assign_family_role(actor_role: str | None, target_role: str) -> bool:
    if actor_role == "owner":
        return target_role in {"admin", "member", "viewer"}
    if actor_role == "admin":
        return target_role in {"member", "viewer"}
    return False


def can_change_member_role(actor_role: str | None, current_role: str, new_role: str) -> bool:
    if current_role == "owner":
        return False
    if not can_assign_family_role(actor_role, new_role):
        return False
    if actor_role == "admin" and current_role == "admin":
        return False
    return True


def can_remove_family_member(actor_role: str | None, target_role: str, target_profile_id: str, actor_id: str) -> bool:
    if target_role == "owner":
        return False
    if target_profile_id == actor_id:
        return target_role != "owner"
    if actor_role == "owner":
        return True
    if actor_role == "admin":
        return target_role in {"member", "viewer"}
    return False
