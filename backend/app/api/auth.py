import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import get_settings
from app.models.schemas import (
    AccountMergeRequest,
    AccountMergeResponse,
    AuthBootstrapRequest,
    AuthBootstrapResponse,
    MergeCandidateResponse,
    ProfileContactRequest,
    ProfileContactResponse,
    SignupProviderRequest,
    SignupProviderResponse,
    WithdrawalSummaryResponse,
)
from app.services.account_service import count_withdrawal_impact, delete_account
from app.services.account_merge_service import (
    find_merge_candidate,
    find_merged_away,
    merge_profiles,
)
from app.services.profile_contact_service import get_contact, save_contact
from app.services.auth import require_authenticated_user, verify_access_token
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


@router.post("/signup-provider", response_model=SignupProviderResponse)
def read_signup_provider(body: SignupProviderRequest) -> SignupProviderResponse:
    """가입하려는 이메일이 **이미 쓰이고 있는지** 알려 준다 (2026-08-19 · ④).

    ★ 로그인이 필요 없다 — 가입하려는 사람은 아직 계정이 없다.
    ★ 돌려주는 것은 **어느 길로 가입했는지 하나뿐**이다. 이름·사진·앨범은 주지 않는다.
    ★ 이 자리는 그 이메일로 만든 계정이 있는지를 알려 주는 자리다. 그것이 목적이다 —
      카카오로 가입한 사람에게 `카카오로 로그인` 을 권하려면 어느 쪽인지 알아야 한다.
      **로그인 실패 문구는 이것과 무관하게 하나다**(화면이 그렇게 한다).
    ★ 조회가 실패해도 400/500 을 내지 않는다. 모르면 `None` 이고, 화면은 그냥
      가입을 이어 간다 — 안내 하나 때문에 가입이 막히면 안 된다.
    """
    email = body.email.strip().lower()
    if not email or "@" not in email:
        return SignupProviderResponse(provider=None)
    try:
        client = get_supabase_client()
        rows = (
            client.table("profiles")
            .select("primary_provider")
            .eq("email", email)
            .limit(1)
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001 - 안내 하나 때문에 가입을 막지 않는다
        logger.warning("signup_provider_lookup_failed error_type=%s", type(exc).__name__)
        return SignupProviderResponse(provider=None)
    if not rows:
        return SignupProviderResponse(provider=None)
    provider = (rows[0].get("primary_provider") or "").strip().lower()
    # 카카오가 아닌 소셜(네이버 등)도 `카카오로 로그인` 을 권하면 안 된다 — 아는 것만 말한다.
    return SignupProviderResponse(provider=provider or None)


@router.get("/merge-candidate", response_model=MergeCandidateResponse)
def read_merge_candidate(
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> MergeCandidateResponse:
    """같은 이메일로 만든 **다른 계정**이 있는지 알려 준다 (2026-08-19 · 2단계).

    ★ 이것만으로는 아무것도 합쳐지지 않는다. 합치려면 그 계정으로도 로그인해야 한다
      (아래 `/merge`). 이메일이 같다는 것만으로 자동으로 합치지 않는다 —
      그 이메일을 실제로 갖고 있지 않은 사람이 남의 계정에 들어갈 수 있다.
    ★ 알려 주는 것은 **있다는 사실과 어느 길로 만들었는지**뿐이다.
    ★ 조회가 실패해도 막지 않는다. 모르면 `없음`이고 화면은 그냥 지나간다 —
      안내 하나 때문에 로그인 뒤 화면이 서면 안 된다(§11).
    """
    client = get_supabase_client()
    try:
        merged = find_merged_away(client, authenticated_user_id)
        if merged:
            # 옛 방법으로 로그인했다 — 빈 계정을 보여 주지 않고 남은 계정으로 안내한다.
            return MergeCandidateResponse(
                found=False, merged_away=True, merged_into_provider=merged.get("provider")
            )
        candidate = find_merge_candidate(client, authenticated_user_id)
    except Exception as exc:  # noqa: BLE001 - 안내 하나 때문에 로그인을 막지 않는다
        logger.warning("merge_candidate_lookup_failed error_type=%s", type(exc).__name__)
        return MergeCandidateResponse(found=False)
    if not candidate:
        return MergeCandidateResponse(found=False)
    return MergeCandidateResponse(
        found=True,
        candidate_id=UUID(candidate["candidate_id"]),
        email=candidate["email"],
        provider=candidate["provider"],
        my_provider=candidate["my_provider"],
    )


@router.post("/merge", response_model=AccountMergeResponse)
def merge_accounts(
    body: AccountMergeRequest,
    authenticated_user_id: str = Depends(require_authenticated_user),
) -> AccountMergeResponse:
    """두 계정을 하나로 합친다 — **양쪽 다 로그인할 수 있어야** 성립한다.

    ★ 자격을 **둘 다** 증명한다: 지금 요청의 Bearer(남길 계정)와 본문에 실린 합칠 계정의
      토큰. 하나만으로는 합치지 않는다. 이메일이 같다는 것도 근거가 되지 못한다 —
      그것만으로 합치면 그 이메일을 갖고 있지 않은 사람이 남의 계정에 들어간다.
    ★ 남는 것은 **지금 로그인해 있는 계정**이다. 사용자가 이미 그 안에 있고, 우리가 가장
      확실하게 아는 자격도 그것이다. 옮겨 온 계정은 닫기만 하고 **지우지 않는다**.
    ★ 옮기는 일은 RPC 하나로 묶는다 — 중간에 실패하면 아무것도 바뀌지 않는다.
    ★ 이메일이 다른 계정끼리는 여기서 합치지 않는다. 그때는 사용자가 `더보기` 에서
      직접 로그인 방법을 잇는다(화면 몫 · 2단계 ②).
    """
    other = verify_access_token(body.other_access_token)
    if not other or not other.id:
        raise HTTPException(status_code=401, detail="합칠 계정으로 로그인하지 못했어요.")
    source_id = str(other.id)
    if source_id == authenticated_user_id:
        raise HTTPException(status_code=400, detail="같은 계정이에요.")

    client = get_supabase_client()
    candidate = find_merge_candidate(client, authenticated_user_id)
    if not candidate or candidate["candidate_id"] != source_id:
        # 후보가 아닌 계정을 합치지 않는다. 이메일이 다르면 여기서 끝난다(§10).
        raise HTTPException(status_code=400, detail="이 계정과는 합칠 수 없어요.")

    try:
        result = merge_profiles(client, source_id=source_id, target_id=authenticated_user_id)
    except Exception as exc:  # noqa: BLE001 - 실패하면 아무것도 바뀌지 않았다(RPC 트랜잭션)
        logger.warning("account_merge_failed error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="계정을 합치지 못했어요. 잠시 후 다시 시도해 주세요.") from exc

    # ★ 여기서 analytics 이벤트를 남기지 않는다. 새 이름은 CHECK 목록에 **먼저** 올려야
    #   하는데(§3③ — 없으면 조용히 버려진다) 이번 건은 migration 을 하나로 두기 위해서다.
    #   합친 사실은 위 account_merged 로그(서버 로그)에 남는다.
    return AccountMergeResponse(**result)


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
