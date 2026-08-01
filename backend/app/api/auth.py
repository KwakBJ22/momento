from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import get_settings
from app.models.schemas import AuthBootstrapResponse
from app.services.account_service import delete_account
from app.services.auth import require_authenticated_user
from app.services.supabase import ensure_default_family, get_supabase_client


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/bootstrap", response_model=AuthBootstrapResponse)
async def bootstrap_auth_user(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AuthBootstrapResponse:
    """Ensure an authenticated user has a profile and default family."""
    family_id = ensure_default_family(get_supabase_client(), authenticated_user_id)
    return AuthBootstrapResponse(profile_id=UUID(authenticated_user_id), family_id=UUID(family_id))


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_auth_account(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> Response:
    """Withdraw the signed-in account and delete every album it owns."""
    settings = get_settings()
    try:
        delete_account(get_supabase_client(settings), settings, authenticated_user_id)
    except RuntimeError:
        # An album survived the first pass; nothing was destroyed beyond it and
        # the request is safe to repeat.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
