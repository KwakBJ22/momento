import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import get_settings
from app.models.schemas import (
    AuthBootstrapRequest,
    AuthBootstrapResponse,
    ProfileContactRequest,
    ProfileContactResponse,
    WithdrawalSummaryResponse,
)
from app.services.account_service import count_withdrawal_impact, delete_account
from app.services.profile_contact_service import get_contact, save_contact
from app.services.auth import require_authenticated_user
from app.services.collaboration_service import attribute_contributions
from app.services.event_logger import EventLogger
from app.services.plan_limits import count_owned_albums, get_user_limits
from app.services.legal_consent import has_legal_consent, record_legal_consent
from app.services.supabase import ensure_default_family, get_supabase_client


router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post("/bootstrap", response_model=AuthBootstrapResponse)
def bootstrap_auth_user(
    body: AuthBootstrapRequest | None = None,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AuthBootstrapResponse:
    """Ensure an authenticated user has a profile and default family, and attribute any
    guest contributions made before login to this account (best-effort)."""
    client = get_supabase_client()
    family_id = ensure_default_family(client, authenticated_user_id)
    limits = get_user_limits(authenticated_user_id)

    # 로그인 창에서 체크한 동의를 **기록만** 한다 (K-14). 새 엔드포인트를 만들지 않는다.
    # 처음 한 번만 채우고 덮어쓰지 않는다. 실패해도 로그인을 막지 않는다 —
    # 기록이 없다는 이유로 아무것도 못 하게 되는 일은 없어야 한다.
    if body and body.legal_agreed:
        record_legal_consent(client, authenticated_user_id)

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
        # 이번에 동의를 실어 보냈으면 위에서 기록했으므로 다시 읽지 않는다.
        legal_agreed=True if (body and body.legal_agreed) else has_legal_consent(client, authenticated_user_id),
    )


@router.get("/contact", response_model=ProfileContactResponse)
def read_profile_contact(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> ProfileContactResponse:
    """이용자가 직접 넣어 둔 연락처를 **본인에게 원본 그대로** 돌려준다
    (계정 분실 시 본인 확인용).

    ★ 가리는 일은 **화면이** 한다. 평소 표시는 여전히 010-****-5678 이고,
    `수정` 을 누를 때만 그 원본이 칸에 들어간다.
    예전에는 여기서 가린 값만 내려보내고 "고칠 때는 새로 입력하게 한다" 고 했는데,
    자기 계정 시트에서 자기 번호를 자기가 보는 화면이라 가려서 얻는 것(어깨너머
    훔쳐보기 방지)보다 뒷자리 하나 고치려고 11자리를 다시 치는 손해가 컸다.
    다른 사람에게 내려가는 경로가 아니다 — 로그인한 본인의 행 하나만 읽는다."""
    return ProfileContactResponse(**get_contact(get_supabase_client(), authenticated_user_id))


@router.put("/contact", response_model=ProfileContactResponse)
def update_profile_contact(
    body: ProfileContactRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> ProfileContactResponse:
    """연락처를 넣거나 고치거나 지운다. 둘 다 선택이며 빈 값이면 그 항목을 지운다.

    ★ 보낸 항목만 바뀐다 — 전화만 보내면 이메일은 그대로다. 이유는 화면이 원본을
    모르기 때문이 아니라(이제는 안다), **손대지 않은 항목은 건드리지 않는다**는
    규칙 자체다. 화면은 고치는 줄만 보낸다.
    ★ 값을 로그에 남기지 않는다. 형식이 아니면 값이 아니라 사실만 알린다."""
    provided = body.model_fields_set
    saved = save_contact(
        get_supabase_client(),
        authenticated_user_id,
        **{field: getattr(body, field) for field in ("phone", "email") if field in provided},
    )
    return ProfileContactResponse(**saved)


@router.get("/account/summary", response_model=WithdrawalSummaryResponse)
def get_withdrawal_summary(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> WithdrawalSummaryResponse:
    """탈퇴 확인 화면이 보여줄 숫자 (K-17 · §5 27차).

    ★ 세는 곳은 하나다(`count_withdrawal_impact`). 지우는 쪽도 같은 목록을 쓰므로
      보여준 수와 실제로 지워지는 것이 어긋나지 않는다.
    ★ `000개` 같은 빈칸을 두지 않으려고 만든 자리다 — 무엇이 사라지는지 모르는 채로
      되돌릴 수 없는 일을 누르게 하지 않는다.
    """
    settings = get_settings()
    counts = count_withdrawal_impact(get_supabase_client(settings), authenticated_user_id)
    return WithdrawalSummaryResponse(**counts)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_auth_account(
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
