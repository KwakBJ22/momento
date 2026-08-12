import { useEffect, useState } from "react";

import { getProfileContact, saveProfileContact, type ProfileContact } from "../lib/api";
import { formatPhoneInput, maskPhone, phoneDigits } from "../lib/phoneFormat";
import { setContactUnsaved } from "../lib/unsavedContact";
import "./AppChrome.css";
import { userFacingError } from "../lib/userFacingError";

/**
 * ⋯ 시트 계정 행의 연락처(선택) — SCREEN_SPEC §5.
 *
 *   연락처 (선택)
 *   계정을 잃어버렸을 때 본인 확인에 씁니다. 다른 곳에는 쓰지 않아요.
 *   전화번호
 *   [ 010-1234-5678            ]   ← 전폭
 *   이메일
 *   [ abc@example.com          ]   ← 전폭
 *           [    저장    ]         ← 구역에 하나
 *
 * ★ 저장 버튼은 **구역에 하나**다. 칸마다 붙어 있던 탓에 실기기에서 세 가지가 걸렸다:
 *   버튼이 우측으로 넘치고, 저장을 누르지 않고 다음 칸으로 넘어가면 앞 칸이 사라졌다.
 *   이제 칸을 옮겨도 입력값이 남고, 저장 전에는 아무것도 버리지 않는다.
 * ★ 서버는 **본인에게 원본을 준다**(H-2). 가리는 일은 화면이 한다 — 평소에는
 *   010-****-5678 로 보여주고, `수정` 을 누르면 **원본이 칸에 들어간다**.
 *   예전에는 서버가 가린 값만 줘서 뒷자리 하나 고치려고 11자리를 다시 쳐야 했다.
 *   손대지 않은 칸은 아예 보내지 않으므로 서버 값이 그대로 남는다.
 * ★ 별도 프로필 화면을 만들지 않는다(§11). 가입 흐름에서도 받지 않는다.
 */

type Field = "phone" | "email";

const FIELDS: Field[] = ["phone", "email"];
const LABEL: Record<Field, string> = { phone: "전화번호", email: "이메일" };
const EXAMPLE: Record<Field, string> = { phone: "010-1234-5678", email: "abc@example.com" };

export default function AccountContact() {
  const [contact, setContact] = useState<ProfileContact | null>(null);
  const [draft, setDraft] = useState<Record<Field, string>>({ phone: "", email: "" });
  // ★ `수정` 을 누른 줄만 입력칸이 된다(§5). 값이 있는 줄은 평소에 가려진 값 + `수정` 뿐이다.
  const [editing, setEditing] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getProfileContact()
      .then((loaded) => { if (alive) setContact(loaded); })
      // 못 불러와도 시트의 나머지는 멀쩡해야 한다. 빈 상태로 둔다.
      .catch(() => { if (alive) setContact({ phone: null, email: null }); });
    return () => { alive = false; };
  }, []);

  // 손댄 칸이 하나라도 있으면 "아직 저장 안 함"이다 — 시트를 닫으려 할 때 이 값을 묻는다.
  const dirty = FIELDS.some((field) => draft[field].trim() !== "");
  useEffect(() => {
    setContactUnsaved(dirty);
    return () => setContactUnsaved(false);
  }, [dirty]);

  const change = (field: Field, value: string) => {
    setSaved(false);
    // 전화는 입력하는 동안 하이픈을 붙인다(0107 → 010-7). 서버에는 숫자만 보낸다.
    setDraft((current) => ({ ...current, [field]: field === "phone" ? formatPhoneInput(value) : value }));
  };

  /** 값이 없거나 `수정` 을 누른 줄만 입력칸이다. */
  const isOpen = (field: Field) => editing.includes(field) || !contact?.[field];

  /** 손댄 항목만 보낸다 — PUT 은 보낸 항목만 바꾼다(안 보낸 칸은 서버 값 그대로).
   *  ★ `수정` 중인 줄은 비운 채 저장하면 **지운다**. 별도 지우기 버튼을 두지 않는다(§5). */
  const save = async () => {
    const payload: Partial<ProfileContact> = {};
    for (const field of FIELDS) {
      const value = draft[field].trim();
      if (editing.includes(field)) {
        payload[field] = value ? (field === "phone" ? phoneDigits(value) : value) : null;
      } else if (!contact?.[field] && value) {
        payload[field] = field === "phone" ? phoneDigits(value) : value;
      }
    }
    if (!Object.keys(payload).length) return;
    setBusy(true);
    setError(null);
    try {
      setContact(await saveProfileContact(payload as ProfileContact));
      setDraft({ phone: "", email: "" });
      setEditing([]);
      setSaved(true);
    } catch (cause) {
      setError(userFacingError(cause, "저장하지 못했어요."));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setEditing([]);
    setDraft({ phone: "", email: "" });
    setError(null);
  };

  if (!contact) return null;

  // 비어 있는 줄이 하나라도 있으면 그 줄은 늘 입력칸이라 `저장` 이 필요하다.
  const canSave = FIELDS.some((field) => draft[field].trim() !== "" || editing.includes(field));

  return (
    <div className="account-contact">
      <p className="account-contact__title">연락처 (선택)</p>
      {/* ★ 이 약속을 코드로도 지킨다 — 이 값은 알림·마케팅 발송 경로에서 읽지 않는다
          (backend/app/services/profile_contact_service.py 주석 참고). */}
      <p className="account-contact__help">계정을 잃어버렸을 때 본인 확인에 씁니다. 다른 곳에는 쓰지 않아요.</p>
      {FIELDS.map((field) => (
        <div className="account-contact__field" key={field}>
          <div className="account-contact__label">
            <label htmlFor={`account-contact-${field}`}>{LABEL[field]}</label>
            {/* 값이 있고 지금 고치는 중이 아니면 — 가려진 값 + `수정` 뿐이다.
                입력칸도, 저장·지우기 버튼도 띄우지 않는다(§5). */}
            {/* ★ 이메일은 가리지 않는다(J-5-2). 바로 위 계정 행에 로그인 이메일이
                가려지지 않고 그대로 나온다 — 한 화면에서 같은 종류를 한쪽만 가리는 것은
                규칙이 없는 것이다. 자기 계정 시트에서 자기 이메일을 자기가 보는 화면이다.
                전화번호는 지금처럼 가린다. */}
            {!isOpen(field) ? (
              <span className="account-contact__value">{field === "phone" ? maskPhone(contact[field]) : contact[field]}</span>
            ) : null}
            {!isOpen(field) ? (
              <button type="button" className="account-contact__edit" disabled={busy}
                onClick={() => {
                  // ★ 기존 값을 칸에 채워 넣는다. 전화는 하이픈을 붙여 넣는다.
                  const current = contact[field] ?? "";
                  setDraft((draftValue) => ({
                    ...draftValue,
                    [field]: field === "phone" ? formatPhoneInput(current) : current,
                  }));
                  setEditing((rows) => [...rows, field]);
                }}>수정</button>
            ) : null}
          </div>
          {isOpen(field) ? (
            <input
              id={`account-contact-${field}`}
              className="account-contact__input"
              type={field === "phone" ? "tel" : "email"}
              inputMode={field === "phone" ? "tel" : "email"}
              autoComplete={field === "phone" ? "tel" : "email"}
              placeholder={EXAMPLE[field]}
              value={draft[field]}
              disabled={busy}
              onChange={(event) => change(field, event.target.value)}
            />
          ) : null}
        </div>
      ))}
      {canSave ? (
        <div className="account-contact__actions">
          <button type="button" className="account-contact__save" disabled={busy} onClick={() => void save()}>
            {busy ? "저장하는 중..." : "저장"}
          </button>
          {/* 비우고 저장하면 지워진다 — 그래서 지우기 버튼이 따로 없다. */}
          {editing.length ? (
            <button type="button" className="account-contact__cancel" disabled={busy} onClick={cancel}>취소</button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="notice notice--error account-contact__error" role="alert">{error}</p> : null}
      {saved && !error ? <p className="notice notice--success account-contact__saved" role="status">저장했어요.</p> : null}
    </div>
  );
}
