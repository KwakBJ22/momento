from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from gotrue.errors import (
    AuthApiError,
    AuthInvalidCredentialsError,
    AuthInvalidJwtError,
    AuthSessionMissingError,
)

from app.config import Settings, get_settings
from app.services.membership import get_user_email
from app.services.supabase import get_supabase_client


_bearer_scheme = HTTPBearer(auto_error=False)


def require_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """Return the authenticated Supabase user id from a verified Bearer token."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        response = get_supabase_client(get_settings()).auth.get_user(credentials.credentials)
        user = response.user if response else None
    except (
        AuthApiError,
        AuthInvalidCredentialsError,
        AuthInvalidJwtError,
        AuthSessionMissingError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    if user is None or not user.id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return str(user.id)


def optional_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str | None:
    """Return user id when Bearer token is valid; otherwise None (guest allowed)."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    try:
        response = get_supabase_client(get_settings()).auth.get_user(credentials.credentials)
        user = response.user if response else None
    except (
        AuthApiError,
        AuthInvalidCredentialsError,
        AuthInvalidJwtError,
        AuthSessionMissingError,
    ):
        return None
    if user is None or not user.id:
        return None
    return str(user.id)


def require_platform_admin(
    user_id: str = Depends(require_authenticated_user),
    settings: Settings = Depends(get_settings),
) -> str:
    """Platform operator (env allowlist), not family admin role."""
    allowed = settings.platform_admin_email_set
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin console is not configured.",
        )
    client = get_supabase_client(settings)
    email = get_user_email(client, user_id)
    if email not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user_id
