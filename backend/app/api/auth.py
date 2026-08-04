import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import get_settings
from app.models.schemas import AuthBootstrapRequest, AuthBootstrapResponse
from app.services.account_service import delete_account
from app.services.auth import require_authenticated_user
from app.services.collaboration_service import attribute_contributions
from app.services.event_logger import EventLogger
from app.services.plan_limits import count_owned_albums, get_user_limits
from app.services.supabase import ensure_default_family, get_supabase_client


router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post("/bootstrap", response_model=AuthBootstrapResponse)
async def bootstrap_auth_user(
    body: AuthBootstrapRequest | None = None,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AuthBootstrapResponse:
    """Ensure an authenticated user has a profile and default family, and attribute any
    guest contributions made before login to this account (best-effort)."""
    client = get_supabase_client()
    family_id = ensure_default_family(client, authenticated_user_id)
    limits = get_user_limits(authenticated_user_id)

    claimed_guest_ids: list[str] = []
    guest_ids = list(body.contributor_guest_ids) if body else []
    if guest_ids:
        # Best-effort: a failure here must never break login/session-restore.
        try:
            claimed_guest_ids, attributed_albums = attribute_contributions(
                client, authenticated_user_id, guest_ids
            )
            if attributed_albums:
                EventLogger.record(client, "contribution_claimed", metadata={"album_count": attributed_albums})
        except Exception as exc:  # noqa: BLE001 - keep login resilient
            logger.warning("contribution_attribution_failed error_type=%s", type(exc).__name__)
            claimed_guest_ids = []

    return AuthBootstrapResponse(
        profile_id=UUID(authenticated_user_id),
        family_id=UUID(family_id),
        album_count=count_owned_albums(client, authenticated_user_id),
        max_albums=limits["max_albums"],
        claimed_guest_ids=claimed_guest_ids,
    )


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_auth_account(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> Response:
    """Withdraw the signed-in account and delete every album it owns."""
    settings = get_settings()
    try:
        delete_account(get_supabase_client(settings), settings, authenticated_user_id)
    except HTTPException:
        raise
    except RuntimeError:
        # An album survived the first pass; nothing was destroyed beyond it and
        # the request is safe to repeat.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.")
    except Exception as exc:  # noqa: BLE001
        # An unexpected DB error (e.g. a constraint we did not anticipate) must reach the
        # user as a clear, retryable message and let them close the modal — not a bare 500
        # that the frontend can only re-open. The withdrawal is transactional, so a failed
        # attempt leaves the account intact and the request is safe to repeat.
        logger.exception("account_deletion_failed error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
