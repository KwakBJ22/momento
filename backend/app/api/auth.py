from uuid import UUID

from fastapi import APIRouter, Depends

from app.models.schemas import AuthBootstrapResponse
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
