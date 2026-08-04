from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from gotrue.errors import (
    AuthApiError,
    AuthInvalidCredentialsError,
    AuthInvalidJwtError,
    AuthSessionMissingError,
)

from app.config import Settings, get_settings
from app.models.current_user import CurrentUser
from app.services.membership import get_user_email
from app.services.supabase import get_supabase_client


_bearer_scheme = HTTPBearer(auto_error=False)


def require_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser:
    """Verify the bearer token once and return a provider-neutral identity."""
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

    metadata = getattr(user, "app_metadata", None) or {}
    return CurrentUser(
        id=str(user.id),
        provider=str(metadata.get("provider") or "") or None,
        email=str(getattr(user, "email", "") or "") or None,
        phone=str(getattr(user, "phone", "") or "") or None,
    )


def require_authenticated_user(
    current_user: CurrentUser = Depends(require_current_user),
) -> str:
    """Compatibility dependency for album services that only require user_id."""
    return current_user.id


def optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser | None:
    """Return a verified identity when present; public routes remain anonymous."""
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
    metadata = getattr(user, "app_metadata", None) or {}
    return CurrentUser(
        id=str(user.id),
        provider=str(metadata.get("provider") or "") or None,
        email=str(getattr(user, "email", "") or "") or None,
        phone=str(getattr(user, "phone", "") or "") or None,
    )


def optional_authenticated_user(
    current_user: CurrentUser | None = Depends(optional_current_user),
) -> str | None:
    """Compatibility dependency for public business routes that only need an id."""
    return current_user.id if current_user else None


def optional_strict_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser | None:
    """Anonymous when no bearer is sent, but a *present* bearer must be valid.

    This is the dependency for routes that also accept a guest-album token. It
    differs from ``optional_current_user`` in one crucial way: when a bearer IS
    provided but is expired/invalid it still raises 401 (rather than silently
    downgrading to anonymous), so a logged-in caller keeps the frontend's
    401→refresh→retry behaviour instead of being mistaken for a guest.
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    return require_current_user(credentials)


def optional_strict_authenticated_user(
    current_user: CurrentUser | None = Depends(optional_strict_current_user),
) -> str | None:
    """Id-only variant of ``optional_strict_current_user`` (None when anonymous)."""
    return current_user.id if current_user else None


def _optional_user_email(client, user_id: str) -> str | None:
    """Email for the admin allowlist check, or None if the account has none. Unlike
    get_user_email (used by family invites) this never raises for a missing email."""
    try:
        response = client.auth.admin.get_user_by_id(user_id)
    except Exception:
        return None
    user = response.user if response else None
    email = getattr(user, "email", None)
    return email.strip().lower() if email else None


def require_platform_admin(
    user_id: str = Depends(require_authenticated_user),
    settings: Settings = Depends(get_settings),
) -> str:
    """Platform operator (env allowlist), not family admin role.

    Matches by user id first (works without an email, now that Kakao login provides none),
    then by email only when the account actually has one (backward compatible). A missing
    email is never itself a 403 — the id allowlist is the path for emailless operators.
    """
    allowed_ids = settings.platform_admin_user_id_set
    allowed_emails = settings.platform_admin_email_set
    if not allowed_ids and not allowed_emails:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin console is not configured.",
        )
    if user_id in allowed_ids:
        return user_id
    if allowed_emails:
        # Only consult the email allowlist for accounts that have an email; never turn a
        # missing email into an error (the whole point of dropping the email consent).
        client = get_supabase_client(settings)
        email = _optional_user_email(client, user_id)
        if email and email in allowed_emails:
            return user_id
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access required.",
    )
