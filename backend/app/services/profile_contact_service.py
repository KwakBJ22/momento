"""이용자가 직접 입력한 연락처(선택) — 계정 분실 시 본인 확인 전용.

★ 이 모듈이 다루는 profiles.contact_phone / contact_email 은 **본인 확인에만** 쓴다.
  화면에 "다른 곳에는 쓰지 않아요" 라고 적었고 개인정보처리방침 1.2 에도 그렇게 적었다.
  그러므로:
    - 알림·마케팅·안내 발송 경로에서 이 컬럼을 읽지 않는다. 나중에 알림톡을 붙이더라도
      이 컬럼을 쓰지 않는다. 발송이 필요하면 그때 목적에 맞는 동의를 따로 받고
      별도 컬럼을 만든다.
    - 관리자 콘솔에 노출하지 않는다(admin_service 는 profiles 에서 id·display_name·
      타임스탬프만 고른다).
    - 로그·오류 리포트에 값을 남기지 않는다. 이 파일 어디에서도 값을 로깅하지 않으며,
      잘못된 입력도 값이 아니라 "형식이 아니다" 라는 사실만 알린다.

  로그인 제공자에게 받은 profiles.email / phone 과는 다른 컬럼이다(섞지 않는다).
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status
from supabase import Client

# 인증(문자·메일)은 하지 않는다. 형식만 다듬고, 명백히 연락처가 아닌 값만 되돌려보낸다.
_PHONE_DIGITS = re.compile(r"\D+")
_EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

PHONE_MIN_DIGITS = 9
PHONE_MAX_DIGITS = 11
EMAIL_MAX_LENGTH = 254

_CONTACT_COLUMNS = "contact_phone,contact_email"

# "안 보냈다" 와 "지워 달라(None)" 를 구분하는 표식. 둘을 같게 다루면 한쪽만 고칠 때
# 다른 쪽이 조용히 지워진다.
UNSET: Any = object()


def normalize_phone(value: str | None) -> str | None:
    """숫자만 남긴다. 빈 값은 '지운다'는 뜻이다."""
    if value is None:
        return None
    digits = _PHONE_DIGITS.sub("", value)
    if not digits:
        return None
    if not (PHONE_MIN_DIGITS <= len(digits) <= PHONE_MAX_DIGITS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="전화번호를 다시 확인해 주세요.",
        )
    return digits


def normalize_email(value: str | None) -> str | None:
    """앞뒤 공백을 없애고 소문자로 맞춘다. 빈 값은 '지운다'는 뜻이다."""
    if value is None:
        return None
    trimmed = value.strip().lower()
    if not trimmed:
        return None
    if len(trimmed) > EMAIL_MAX_LENGTH or not _EMAIL_SHAPE.match(trimmed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이메일 주소를 다시 확인해 주세요.",
        )
    return trimmed


def mask_phone(digits: str | None) -> str | None:
    """010-****-5678 — 본인이 확인할 수 있을 만큼만 보여준다."""
    if not digits:
        return None
    head, tail = digits[:3], digits[-4:]
    return f"{head}-****-{tail}"


def mask_email(value: str | None) -> str | None:
    """ab***@example.com — 도메인은 남기고 계정 부분을 가린다."""
    if not value or "@" not in value:
        return None
    local, _, domain = value.partition("@")
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}***@{domain}"


def _masked(record: dict[str, Any] | None) -> dict[str, str | None]:
    record = record or {}
    return {
        "phone": mask_phone(record.get("contact_phone")),
        "email": mask_email(record.get("contact_email")),
    }


def get_contact(client: Client, profile_id: str) -> dict[str, str | None]:
    """★ 가려진 형태만 돌려준다. 원본은 서버 밖으로 내보내지 않는다 —
    고칠 때는 새로 입력하게 한다(인증이 없으므로 다시 입력해도 잃는 것이 없다)."""
    rows = (
        client.table("profiles")
        .select(_CONTACT_COLUMNS)
        .eq("id", profile_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return _masked(rows[0] if rows else None)


def save_contact(
    client: Client,
    profile_id: str,
    *,
    phone: str | None = UNSET,
    email: str | None = UNSET,
) -> dict[str, str | None]:
    """★ **보낸 항목만** 바꾼다. 전화만 고칠 때 이메일이 지워지면 안 된다
    (화면은 가려진 값만 갖고 있어서, 안 고친 항목을 되돌려보낼 수가 없다).
    보낸 항목이 None·빈 문자열이면 그 항목을 지운다는 뜻이다."""
    payload: dict[str, str | None] = {}
    if phone is not UNSET:
        payload["contact_phone"] = normalize_phone(phone)
    if email is not UNSET:
        payload["contact_email"] = normalize_email(email)
    if payload:
        client.table("profiles").update(payload).eq("id", profile_id).execute()
    return get_contact(client, profile_id)
