"""이용자가 직접 입력하는 연락처(선택) — 계정 분실 시 본인 확인 전용 (SCREEN_SPEC §5).

카카오 계정을 잃으면(휴대폰을 바꾸며 카톡을 다시 만드는 등) 회원번호가 달라져
우리 쪽에서는 완전히 다른 사람이 된다. 가입 때 받지 않고, 본인이 원할 때 넣어 두는
자리를 만들었다. ★ 이 값은 본인 확인 외에는 쓰지 않는다 — 그 약속을 여기서 잠근다.
"""

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.profile_contact_service import (
    UNSET,
    get_contact,
    mask_email,
    mask_phone,
    normalize_email,
    normalize_phone,
    save_contact,
)

ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


class _Table:
    """profiles 한 행만 흉내 낸다 — select / update / eq / limit / execute."""

    def __init__(self, store: dict[str, object], calls: list[str]) -> None:
        self._store = store
        self._calls = calls
        self._update: dict[str, object] | None = None

    def select(self, columns: str) -> "_Table":
        self._calls.append(f"select:{columns}")
        return self

    def update(self, payload: dict[str, object]) -> "_Table":
        self._update = payload
        return self

    def eq(self, _column: str, _value: str) -> "_Table":
        return self

    def limit(self, _count: int) -> "_Table":
        return self

    def execute(self) -> "_Table":
        if self._update is not None:
            self._store.update(self._update)
            self._update = None
        return self

    @property
    def data(self) -> list[dict[str, object]]:
        return [dict(self._store)]


class _Client:
    def __init__(self, store: dict[str, object] | None = None) -> None:
        self.store: dict[str, object] = store or {"contact_phone": None, "contact_email": None}
        self.calls: list[str] = []

    def table(self, name: str) -> _Table:
        assert name == "profiles"
        return _Table(self.store, self.calls)


# --- 형식 다듬기: 인증(문자·메일)은 하지 않는다 -------------------------------------


def test_phone_keeps_digits_only() -> None:
    assert normalize_phone("010-1234-5678") == "01012345678"
    assert normalize_phone(" 010 1234 5678 ") == "01012345678"


def test_blank_means_delete_not_error() -> None:
    # 빈 값은 잘못된 입력이 아니라 "지운다" 는 뜻이다. 둘 다 선택이므로 지울 수 있어야 한다.
    assert normalize_phone("") is None
    assert normalize_phone(None) is None
    assert normalize_email("   ") is None
    assert normalize_email(None) is None


def test_obviously_wrong_values_are_refused_without_echoing_them() -> None:
    for wrong in ["12", "0101234567890123"]:
        with pytest.raises(HTTPException) as raised:
            normalize_phone(wrong)
        assert raised.value.status_code == 400
        # ★ 되돌려주는 문구에 입력값이 섞이지 않는다(로그·오류에 번호가 남지 않게).
        assert wrong not in str(raised.value.detail)
    for wrong in ["abc", "a@b", "no-at-sign.com"]:
        with pytest.raises(HTTPException) as raised:
            normalize_email(wrong)
        assert wrong not in str(raised.value.detail)


def test_email_is_trimmed_and_lowercased() -> None:
    assert normalize_email("  ABC@Example.COM ") == "abc@example.com"


# --- 화면에는 가려서 보여준다 --------------------------------------------------------


def test_saved_values_are_masked() -> None:
    assert mask_phone("01012345678") == "010-****-5678"
    assert mask_email("abc@example.com") == "ab***@example.com"
    assert mask_phone(None) is None and mask_email(None) is None


def test_server_never_returns_the_raw_value() -> None:
    client = _Client({"contact_phone": "01012345678", "contact_email": "abc@example.com"})
    contact = get_contact(client, "user-1")
    assert contact == {"phone": "010-****-5678", "email": "ab***@example.com"}
    assert "01012345678" not in str(contact)
    assert "abc@example.com" not in str(contact)


# --- 넣고 · 고치고 · 지운다 ---------------------------------------------------------


def test_add_edit_and_delete_each_field() -> None:
    client = _Client()
    assert save_contact(client, "u", phone="010-1234-5678")["phone"] == "010-****-5678"
    assert client.store["contact_phone"] == "01012345678"

    assert save_contact(client, "u", phone="010-0000-9999")["phone"] == "010-****-9999"
    assert save_contact(client, "u", phone=None)["phone"] is None
    assert client.store["contact_phone"] is None


def test_editing_one_field_leaves_the_other_alone() -> None:
    """★ 화면은 가려진 값만 갖고 있어서 안 고친 항목을 되돌려보낼 수 없다.
    보내지 않은 항목은 그대로여야 한다 — 아니면 전화를 고칠 때 이메일이 사라진다."""
    client = _Client({"contact_phone": "01012345678", "contact_email": "abc@example.com"})
    result = save_contact(client, "u", phone="010-0000-9999")
    assert client.store["contact_email"] == "abc@example.com"
    assert result["email"] == "ab***@example.com"
    assert save_contact(client, "u", phone=UNSET, email=UNSET) == {
        "phone": "010-****-9999",
        "email": "ab***@example.com",
    }


def test_only_the_contact_columns_are_read() -> None:
    client = _Client()
    get_contact(client, "u")
    assert client.calls == ["select:contact_phone,contact_email"]


# --- 약속을 코드로 지킨다 -----------------------------------------------------------


def test_provider_columns_are_not_reused() -> None:
    """profiles.email / phone 은 트리거가 auth.users 에서 채우는 값(카카오가 준 값)이다.
    본인이 넣은 값과 섞이면 어느 쪽인지 구분할 수 없으므로 컬럼을 나눈다."""
    service = source("app/services/profile_contact_service.py")
    # 읽는 컬럼도, 쓰는 컬럼도 contact_* 뿐이다(응답 key 인 phone/email 과 다르다).
    assert '_CONTACT_COLUMNS = "contact_phone,contact_email"' in service
    assert 'payload["contact_phone"]' in service and 'payload["contact_email"]' in service
    assert 'payload["phone"]' not in service and 'payload["email"]' not in service
    # 마이그레이션도 기존 컬럼을 고치지 않고 새 컬럼을 더한다.
    migration = (ROOT.parent / "supabase/migrations/20260808100000_profile_contact.sql").read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS contact_phone" in migration
    assert "ALTER COLUMN email" not in migration and "ALTER COLUMN phone" not in migration


def test_the_value_is_never_logged() -> None:
    service = source("app/services/profile_contact_service.py")
    auth_api = source("app/api/auth.py")
    # 이 경로 어디에서도 값을 로깅하지 않는다(로그·오류 리포트에 전화번호가 찍히지 않게).
    assert "logger" not in service
    contact_routes = auth_api[auth_api.index('@router.get("/contact"') : auth_api.index('@router.delete("/account"')]
    assert "logger" not in contact_routes


def test_admin_console_does_not_select_the_contact_columns() -> None:
    admin = source("app/services/admin_service.py")
    assert "contact_phone" not in admin and "contact_email" not in admin
    # profiles 에서 전체 컬럼을 긁지 않는다 — 그러면 이 값도 딸려 나온다.
    assert 'table("profiles").select("*")' not in admin


def test_no_send_path_reads_these_columns() -> None:
    """"다른 곳에는 쓰지 않아요" 라고 적었으면 지킨다 — 알림·발송 경로에서 읽지 않는다.
    나중에 알림톡을 붙이더라도 이 컬럼을 쓰지 않는다."""
    readers = [
        path
        for path in (ROOT / "app").rglob("*.py")
        if "contact_phone" in path.read_text(encoding="utf-8")
        or "contact_email" in path.read_text(encoding="utf-8")
    ]
    assert [path.name for path in readers] == ["profile_contact_service.py"]


def test_signup_does_not_ask_for_contact() -> None:
    """가입 흐름을 건드리지 않는다 — 거기서는 받지 않는다."""
    bootstrap = source("app/api/auth.py")
    bootstrap = bootstrap[bootstrap.index("async def bootstrap_auth_user") : bootstrap.index("/contact")]
    assert "contact" not in bootstrap
