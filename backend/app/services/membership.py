from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from supabase import Client

from app.services.authorization import (
    AlbumAccess,
    WRITE_FAMILY_ROLES,
    can_change_member_role,
    can_remove_family_member,
    resolve_album_access,
)


INVITATION_TTL_DAYS = 7


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_invitation_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def get_user_email(client: Client, user_id: str) -> str:
    response = client.auth.admin.get_user_by_id(user_id)
    user = response.user if response else None
    if user is None or not user.email:
        raise HTTPException(status_code=400, detail="Signed-in user does not have an email address.")
    return _normalize_email(user.email)


def get_family_membership(client: Client, family_id: str, profile_id: str) -> dict[str, Any] | None:
    result = (
        client.table("family_members")
        .select("*")
        .eq("family_id", family_id)
        .eq("profile_id", profile_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def get_album_membership(client: Client, album_id: str, profile_id: str) -> dict[str, Any] | None:
    result = (
        client.table("album_members")
        .select("*")
        .eq("album_id", album_id)
        .eq("profile_id", profile_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def usable_owner_display_name(display_name: str | None, email: str | None) -> str | None:
    """참여자 화면 초대 문구의 앞칸 판정: 소유자 이름을 그대로 노출해도 되는가.

    한글 포함 여부로 판정하지 않는다 — Jenny 같은 영문 실명이 걸린다.
    주 조건: display_name 이 계정 이메일의 @ 앞부분과 같으면 아이디다(실측 kbjkwak).
    보조 조건: @ 포함 / 숫자만 / 빈 값. 확실치 않으면 None — 앞칸은 앨범 제목으로
    떨어지며, 소유자 이름을 잘못 노출하지 않는 쪽이 안전하다.
    """
    name = (display_name or "").strip()
    if not name:
        return None
    if "@" in name:
        return None
    if name.isdigit():
        return None
    local_part = (email or "").split("@")[0].strip().lower()
    if local_part and name.lower() == local_part:
        return None
    return name


def get_album_contributor_membership(client: Client, album_id: str, user_id: str) -> dict[str, Any] | None:
    result = (
        client.table("album_contributors")
        .select("id, status")
        .eq("album_id", album_id)
        .eq("user_id", user_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def get_album_access(client: Client, album: dict[str, Any], user_id: str) -> AlbumAccess:
    family_id = album.get("family_id")
    family_role = None
    album_role = None
    if family_id:
        membership = get_family_membership(client, str(family_id), user_id)
        family_role = membership["role"] if membership else None
    album_membership = get_album_membership(client, str(album["id"]), user_id)
    album_role = album_membership["role"] if album_membership else None
    if family_role is None and album_role is None:
        # Participants are recorded ONLY in album_contributors (the "함께 만드는 앨범"
        # list reads the same table) — without this fallback they can see the album in
        # their list but get 403 opening it. Fixed to "contributor" (read + own
        # contributions), NEVER the row's own role: a contributors-table row must not
        # grant settings/delete/member management. Guests (user_id NULL) never match,
        # and remove_contributor sets status="removed", which drops the row here —
        # revoking access.
        if get_album_contributor_membership(client, str(album["id"]), user_id):
            album_role = "contributor"
    return resolve_album_access(album, user_id, family_role, album_role)


def get_user_primary_family(client: Client, profile_id: str) -> dict[str, Any] | None:
    result = (
        client.table("family_members")
        .select("family_id, role, families(id, name, created_by, status, created_at)")
        .eq("profile_id", profile_id)
        .eq("status", "active")
        .order("joined_at")
        .limit(1)
        .execute()
    )
    data = result.data or []
    if not data:
        return None
    row = data[0]
    family = row.get("families") or {}
    return {
        "family_id": row["family_id"],
        "role": row["role"],
        "family": family,
    }


def list_family_members(client: Client, family_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("family_members")
        .select("id, family_id, profile_id, role, status, invited_by, joined_at, created_at, profiles(display_name)")
        .eq("family_id", family_id)
        .eq("status", "active")
        .order("joined_at")
        .execute()
    )
    return result.data or []


def list_family_invitations(client: Client, family_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("family_invitations")
        .select("id, family_id, inviter_id, invitee_email, role, status, expires_at, accepted_at, revoked_at, created_at")
        .eq("family_id", family_id)
        .in_("status", ["pending", "accepted", "revoked", "expired"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


def list_album_members(client: Client, album_id: str) -> list[dict[str, Any]]:
    result = (
        client.table("album_members")
        .select("id, album_id, profile_id, role, status, invited_by, created_at, profiles(display_name)")
        .eq("album_id", album_id)
        .eq("status", "active")
        .order("created_at")
        .execute()
    )
    return result.data or []


def ensure_not_active_family_member(client: Client, family_id: str, email: str) -> None:
    members = list_family_members(client, family_id)
    normalized = _normalize_email(email)
    for member in members:
        profile = member.get("profiles") or {}
        # Email is not on profiles; check invitations acceptance path separately.
        if member.get("profile_id"):
            try:
                user = client.auth.admin.get_user_by_id(str(member["profile_id"]))
                if user.user and user.user.email and _normalize_email(user.user.email) == normalized:
                    raise HTTPException(status_code=409, detail="This user is already a family member.")
            except HTTPException:
                raise
            except Exception:
                continue


def create_family_invitation(
    client: Client,
    *,
    family_id: str,
    inviter_id: str,
    invitee_email: str,
    role: str,
) -> tuple[dict[str, Any], str]:
    normalized_email = _normalize_email(invitee_email)
    if not normalized_email:
        raise HTTPException(status_code=400, detail="Invitee email is required.")

    ensure_not_active_family_member(client, family_id, normalized_email)

    pending = (
        client.table("family_invitations")
        .select("id")
        .eq("family_id", family_id)
        .eq("invitee_email", normalized_email)
        .eq("status", "pending")
        .limit(1)
        .execute()
    )
    if pending.data:
        raise HTTPException(status_code=409, detail="A pending invitation already exists for this email.")

    token = generate_invitation_token()
    token_hash = hash_invitation_token(token)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=INVITATION_TTL_DAYS)).isoformat()
    record = {
        "family_id": family_id,
        "inviter_id": inviter_id,
        "invitee_email": normalized_email,
        "token_hash": token_hash,
        "role": role,
        "status": "pending",
        "expires_at": expires_at,
    }
    result = client.table("family_invitations").insert(record).execute()
    data = result.data or []
    if not data:
        raise HTTPException(status_code=500, detail="Could not create invitation.")
    return data[0], token


def revoke_family_invitation(client: Client, family_id: str, invitation_id: str) -> dict[str, Any]:
    result = (
        client.table("family_invitations")
        .select("*")
        .eq("id", invitation_id)
        .eq("family_id", family_id)
        .limit(1)
        .execute()
    )
    data = result.data or []
    if not data:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    invitation = data[0]
    if invitation["status"] != "pending":
        raise HTTPException(status_code=409, detail="Only pending invitations can be revoked.")
    updated = (
        client.table("family_invitations")
        .update({"status": "revoked", "revoked_at": _now_iso()})
        .eq("id", invitation_id)
        .execute()
    )
    rows = updated.data or []
    return rows[0] if rows else invitation


def accept_family_invitation(client: Client, token: str, profile_id: str, profile_email: str) -> str:
    token_hash = hash_invitation_token(token.strip())
    try:
        result = client.rpc(
            "accept_family_invitation",
            {
                "p_token_hash": token_hash,
                "p_profile_id": profile_id,
                "p_profile_email": _normalize_email(profile_email),
            },
        ).execute()
    except Exception as exc:
        message = str(exc)
        if "already been accepted" in message:
            raise HTTPException(status_code=409, detail="Invitation has already been accepted.") from exc
        if "no longer valid" in message or "expired" in message:
            raise HTTPException(status_code=410, detail="Invitation is no longer valid.") from exc
        if "email does not match" in message:
            raise HTTPException(status_code=403, detail="Invitation email does not match the signed-in user.") from exc
        if "already an active family member" in message:
            raise HTTPException(status_code=409, detail="You are already a family member.") from exc
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail="Invitation not found.") from exc
        raise HTTPException(status_code=400, detail="Could not accept invitation.") from exc

    if not result.data:
        raise HTTPException(status_code=400, detail="Could not accept invitation.")
    return str(result.data)


def update_family_member_role(
    client: Client,
    *,
    family_id: str,
    member_id: str,
    actor_id: str,
    actor_role: str | None,
    new_role: str,
) -> dict[str, Any]:
    result = (
        client.table("family_members")
        .select("*")
        .eq("id", member_id)
        .eq("family_id", family_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    if not data:
        raise HTTPException(status_code=404, detail="Family member not found.")
    member = data[0]
    if not can_change_member_role(actor_role, member["role"], new_role):
        raise HTTPException(status_code=403, detail="You cannot assign this role.")
    updated = (
        client.table("family_members")
        .update({"role": new_role})
        .eq("id", member_id)
        .execute()
    )
    rows = updated.data or []
    return rows[0] if rows else member


def remove_family_member(
    client: Client,
    *,
    family_id: str,
    member_id: str,
    actor_id: str,
    actor_role: str | None,
) -> None:
    result = (
        client.table("family_members")
        .select("*")
        .eq("id", member_id)
        .eq("family_id", family_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    if not data:
        raise HTTPException(status_code=404, detail="Family member not found.")
    member = data[0]
    if not can_remove_family_member(actor_role, member["role"], str(member["profile_id"]), actor_id):
        raise HTTPException(status_code=403, detail="You cannot remove this family member.")
    client.table("family_members").update(
        {"status": "removed", "left_at": _now_iso()}
    ).eq("id", member_id).execute()


def save_album_member(
    client: Client,
    *,
    album_id: str,
    profile_id: str,
    role: str,
    invited_by: str,
) -> dict[str, Any]:
    record = {
        "album_id": album_id,
        "profile_id": profile_id,
        "role": role,
        "status": "active",
        "invited_by": invited_by,
    }
    result = (
        client.table("album_members")
        .upsert(record, on_conflict="album_id,profile_id")
        .execute()
    )
    data = result.data or []
    if data:
        return data[0]
    existing = get_album_membership(client, album_id, profile_id)
    if existing:
        updated = (
            client.table("album_members")
            .update({"role": role, "status": "active", "invited_by": invited_by, "removed_at": None})
            .eq("id", existing["id"])
            .execute()
        )
        rows = updated.data or []
        return rows[0] if rows else existing
    raise HTTPException(status_code=500, detail="Could not save album member.")


def update_album_member_role(
    client: Client,
    *,
    album_id: str,
    member_id: str,
    new_role: str,
) -> dict[str, Any]:
    result = (
        client.table("album_members")
        .select("*")
        .eq("id", member_id)
        .eq("album_id", album_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    if not data:
        raise HTTPException(status_code=404, detail="Album member not found.")
    member = data[0]
    if member["role"] == "owner" and new_role != "owner":
        owners = (
            client.table("album_members")
            .select("id")
            .eq("album_id", album_id)
            .eq("role", "owner")
            .eq("status", "active")
            .execute()
        )
        if len(owners.data or []) <= 1:
            raise HTTPException(
                status_code=409,
                detail="Transfer album ownership before removing the last owner.",
            )
    updated = (
        client.table("album_members")
        .update({"role": new_role})
        .eq("id", member_id)
        .execute()
    )
    rows = updated.data or []
    return rows[0] if rows else member


def remove_album_member(client: Client, *, album_id: str, member_id: str) -> None:
    result = (
        client.table("album_members")
        .select("*")
        .eq("id", member_id)
        .eq("album_id", album_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    data = result.data or []
    if not data:
        raise HTTPException(status_code=404, detail="Album member not found.")
    member = data[0]
    if member["role"] == "owner":
        owners = (
            client.table("album_members")
            .select("id")
            .eq("album_id", album_id)
            .eq("role", "owner")
            .eq("status", "active")
            .execute()
        )
        if len(owners.data or []) <= 1:
            raise HTTPException(
                status_code=409,
                detail="Transfer album ownership before removing the last owner.",
            )
    client.table("album_members").update(
        {"status": "removed", "removed_at": _now_iso()}
    ).eq("id", member_id).execute()


def require_family_write_role(family_role: str | None) -> None:
    if family_role not in WRITE_FAMILY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Family viewers cannot create or modify albums.",
        )
