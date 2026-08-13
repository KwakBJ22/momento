import logging
import logging
from functools import wraps
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from app.config import get_settings
from app.models.schemas import (
    AcceptFamilyInvitationRequest,
    AcceptFamilyInvitationResponse,
    AlbumMemberResponse,
    AlbumMembersListResponse,
    CreateFamilyInvitationRequest,
    CreateFamilyInvitationResponse,
    FamilyInvitationResponse,
    FamilyInvitationsListResponse,
    FamilyMemberResponse,
    FamilyMembersListResponse,
    FamilySummaryResponse,
    UpdateAlbumMemberRoleRequest,
    UpdateFamilyMemberRoleRequest,
    UpsertAlbumMemberRequest,
)
from app.services.auth import require_authenticated_user
from app.services.authorization import require_album_member_manage, require_family_manager
from app.services.membership import (
    accept_family_invitation,
    create_family_invitation,
    get_album_access,
    get_family_membership,
    get_user_email,
    get_user_primary_family,
    list_album_members,
    list_family_invitations,
    list_family_members,
    remove_album_member,
    remove_family_member,
    revoke_family_invitation,
    save_album_member,
    update_album_member_role,
    update_family_member_role,
)
from app.services.supabase import get_album_record, get_supabase_client


router = APIRouter(prefix="/api/families", tags=["families"])
logger = logging.getLogger(__name__)


def _member_error_details(handler):
    @wraps(handler)
    async def wrapped(*args, **kwargs):
        try:
            return await handler(*args, **kwargs)
        except HTTPException:
            raise
        except APIError as exc:
            detail = str(getattr(exc, "message", None) or exc)
            logger.exception("album_members_supabase_failed detail=%s", detail)
            raise HTTPException(status_code=502, detail=f"Album members database error: {detail}") from exc
        except (KeyError, TypeError, ValueError) as exc:
            detail = str(exc)
            logger.exception("album_members_data_failed detail=%s", detail)
            raise HTTPException(status_code=500, detail=f"Album members data error: {detail}") from exc
    return wrapped


def _member_response(row: dict) -> FamilyMemberResponse:
    profile = row.get("profiles") or {}
    return FamilyMemberResponse(
        id=UUID(str(row["id"])),
        profile_id=UUID(str(row["profile_id"])),
        display_name=str(profile.get("display_name") or "가족 구성원"),
        role=row["role"],
        joined_at=row.get("joined_at"),
        invited_by=UUID(str(row["invited_by"])) if row.get("invited_by") else None,
    )


def _invitation_response(row: dict, invite_url: str | None = None) -> FamilyInvitationResponse:
    return FamilyInvitationResponse(
        id=UUID(str(row["id"])),
        invitee_email=row["invitee_email"],
        role=row["role"],
        status=row["status"],
        expires_at=row["expires_at"],
        accepted_at=row.get("accepted_at"),
        revoked_at=row.get("revoked_at"),
        created_at=row["created_at"],
        invite_url=invite_url,
    )


def _album_member_response(row: dict) -> AlbumMemberResponse:
    profile = row.get("profiles") or {}
    return AlbumMemberResponse(
        id=UUID(str(row["id"])),
        profile_id=UUID(str(row["profile_id"])),
        display_name=str(profile.get("display_name") or "참여자"),
        role=row["role"],
        invited_by=UUID(str(row["invited_by"])) if row.get("invited_by") else None,
        created_at=row["created_at"],
    )


@router.get("/me", response_model=FamilySummaryResponse)
def get_my_family(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> FamilySummaryResponse:
    client = get_supabase_client()
    primary = get_user_primary_family(client, authenticated_user_id)
    if not primary:
        raise HTTPException(status_code=404, detail="Family not found.")
    family = primary["family"]
    return FamilySummaryResponse(
        family_id=UUID(str(primary["family_id"])),
        name=str(family.get("name") or "우리 가족"),
        role=primary["role"],
    )


@router.get("/me/participants")
def get_participant_stats(authenticated_user_id: str = Depends(require_authenticated_user)) -> dict:
    client = get_supabase_client()
    primary = get_user_primary_family(client, authenticated_user_id)
    if not primary:
        raise HTTPException(status_code=404, detail="Family not found.")
    members = list_family_members(client, str(primary["family_id"]))
    participants = []
    for member in members:
        profile_id = str(member["profile_id"])
        contributors = client.table("album_contributors").select("id").eq("user_id", profile_id).eq("status", "active").execute().data or []
        contributor_ids = [str(row["id"]) for row in contributors]
        photo_count = 0
        memory_count = 0
        if contributor_ids:
            photo_count = len(client.table("album_photos").select("id").in_("uploaded_by_contributor_id", contributor_ids).execute().data or [])
            memory_count = len(client.table("photo_memories").select("id").in_("contributor_id", contributor_ids).execute().data or [])
        participants.append({
            "id": str(member["id"]),
            "display_name": str((member.get("profiles") or {}).get("display_name") or "참여자"),
            "photo_count": photo_count,
            "memory_count": memory_count,
        })
    return {"participants": participants}


@router.get("/{family_id}/members", response_model=FamilyMembersListResponse)
def get_family_members(
    family_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> FamilyMembersListResponse:
    client = get_supabase_client()
    membership = get_family_membership(client, family_id, authenticated_user_id)
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this family.")
    members = [_member_response(row) for row in list_family_members(client, family_id)]
    return FamilyMembersListResponse(members=members)


@router.post("/{family_id}/invitations", response_model=CreateFamilyInvitationResponse, status_code=status.HTTP_201_CREATED)
def create_invitation(
    family_id: str,
    body: CreateFamilyInvitationRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> CreateFamilyInvitationResponse:
    client = get_supabase_client()
    membership = get_family_membership(client, family_id, authenticated_user_id)
    require_family_manager(membership["role"] if membership else None)
    invitation, token = create_family_invitation(
        client,
        family_id=family_id,
        inviter_id=authenticated_user_id,
        invitee_email=body.invitee_email,
        role=body.role,
    )
    settings = get_settings()
    invite_url = f"{settings.frontend_base_url.rstrip('/')}/invite/{token}"
    response = _invitation_response(invitation, invite_url=invite_url)
    return CreateFamilyInvitationResponse(invitation=response, invite_url=invite_url, invite_token=token)


@router.get("/{family_id}/invitations", response_model=FamilyInvitationsListResponse)
def get_family_invitations(
    family_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> FamilyInvitationsListResponse:
    client = get_supabase_client()
    membership = get_family_membership(client, family_id, authenticated_user_id)
    require_family_manager(membership["role"] if membership else None)
    invitations = [_invitation_response(row) for row in list_family_invitations(client, family_id)]
    return FamilyInvitationsListResponse(invitations=invitations)


@router.delete("/{family_id}/invitations/{invitation_id}", response_model=FamilyInvitationResponse)
def cancel_invitation(
    family_id: str,
    invitation_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> FamilyInvitationResponse:
    client = get_supabase_client()
    membership = get_family_membership(client, family_id, authenticated_user_id)
    require_family_manager(membership["role"] if membership else None)
    invitation = revoke_family_invitation(client, family_id, invitation_id)
    return _invitation_response(invitation)


@router.patch("/{family_id}/members/{member_id}", response_model=FamilyMemberResponse)
def patch_family_member_role(
    family_id: str,
    member_id: str,
    body: UpdateFamilyMemberRoleRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> FamilyMemberResponse:
    client = get_supabase_client()
    membership = get_family_membership(client, family_id, authenticated_user_id)
    require_family_manager(membership["role"] if membership else None)
    updated = update_family_member_role(
        client,
        family_id=family_id,
        member_id=member_id,
        actor_id=authenticated_user_id,
        actor_role=membership["role"] if membership else None,
        new_role=body.role,
    )
    rows = list_family_members(client, family_id)
    for row in rows:
        if str(row["id"]) == member_id:
            return _member_response(row)
    return _member_response(updated)


@router.delete("/{family_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_family_member(
    family_id: str,
    member_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> None:
    client = get_supabase_client()
    membership = get_family_membership(client, family_id, authenticated_user_id)
    require_family_manager(membership["role"] if membership else None)
    remove_family_member(
        client,
        family_id=family_id,
        member_id=member_id,
        actor_id=authenticated_user_id,
        actor_role=membership["role"] if membership else None,
    )


invitations_router = APIRouter(prefix="/api/family-invitations", tags=["families"])


@invitations_router.post("/accept", response_model=AcceptFamilyInvitationResponse)
def accept_invitation(
    body: AcceptFamilyInvitationRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AcceptFamilyInvitationResponse:
    client = get_supabase_client()
    email = get_user_email(client, authenticated_user_id)
    family_id = accept_family_invitation(client, body.token, authenticated_user_id, email)
    return AcceptFamilyInvitationResponse(family_id=UUID(family_id))


album_members_router = APIRouter(prefix="/api/albums", tags=["album-members"])


@album_members_router.get("/{album_id}/members", response_model=AlbumMembersListResponse)
@_member_error_details
def get_album_members(
    album_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumMembersListResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_member_manage(access)
    members = [_album_member_response(row) for row in list_album_members(client, album_id)]
    return AlbumMembersListResponse(members=members)


@album_members_router.post("/{album_id}/members", response_model=AlbumMemberResponse, status_code=status.HTTP_201_CREATED)
def add_album_member(
    album_id: str,
    body: UpsertAlbumMemberRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumMemberResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_member_manage(access)
    family_id = album.get("family_id")
    if family_id:
        target_membership = get_family_membership(client, str(family_id), str(body.profile_id))
        if not target_membership:
            raise HTTPException(status_code=400, detail="Album participants must belong to the same family.")
    saved = save_album_member(
        client,
        album_id=album_id,
        profile_id=str(body.profile_id),
        role=body.role,
        invited_by=authenticated_user_id,
    )
    rows = list_album_members(client, album_id)
    for row in rows:
        if str(row["profile_id"]) == str(body.profile_id):
            return _album_member_response(row)
    return _album_member_response(saved)


@album_members_router.patch("/{album_id}/members/{member_id}", response_model=AlbumMemberResponse)
def patch_album_member(
    album_id: str,
    member_id: str,
    body: UpdateAlbumMemberRoleRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AlbumMemberResponse:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_member_manage(access)
    updated = update_album_member_role(
        client,
        album_id=album_id,
        member_id=member_id,
        new_role=body.role,
    )
    rows = list_album_members(client, album_id)
    for row in rows:
        if str(row["id"]) == member_id:
            return _album_member_response(row)
    return _album_member_response(updated)


@album_members_router.delete("/{album_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_album_member(
    album_id: str,
    member_id: str,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> None:
    client = get_supabase_client()
    album = get_album_record(client, album_id)
    if not album:
        raise HTTPException(status_code=404, detail="앨범을 찾을 수 없습니다.")
    access = get_album_access(client, album, authenticated_user_id)
    require_album_member_manage(access)
    remove_album_member(client, album_id=album_id, member_id=member_id)
