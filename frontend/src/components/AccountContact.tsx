import { useEffect, useState } from "react";

import { getProfileContact, saveProfileContact, type ProfileContact } from "../lib/api";
import { formatPhoneInput, phoneDigits } from "../lib/phoneFormat";
import { setContactUnsaved } from "../lib/unsavedContact";
import "./AppChrome.css";

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
 * ★ 저장된 값은 서버가 가려서 준다(010-****-5678). 그 값을 **빈칸의 안내글**로 보여준다
 *   — 가려진 문자열을 칸 안에 넣으면 그걸 고치는 것처럼 보이지만 실제로는 못 고친다.
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

  /** 손댄 항목만 보낸다 — PUT 은 보낸 항목만 바꾼다(안 보낸 칸은 서버 값 그대로). */
  const save = async () => {
    const payload: Partial<ProfileContact> = {};
    for (const field of FIELDS) {
      const value = draft[field].trim();
      if (value) payload[field] = field === "phone" ? phoneDigits(value) : value;
    }
    if (!Object.keys(payload).length) return;
    setBusy(true);
    setError(null);
    try {
      setContact(await saveProfileContact(payload as ProfileContact));
      setDraft({ phone: "", email: "" });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async (field: Field) => {
    setBusy(true);
    setError(null);
    try {
      setContact(await saveProfileContact({ [field]: null } as unknown as ProfileContact));
      setDraft((current) => ({ ...current, [field]: "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "지우지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (!contact) return null;

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
            {contact[field] ? (
              <button type="button" className="account-contact__clear" disabled={busy} onClick={() => void clear(field)}>지우기</button>
            ) : null}
          </div>
          <input
            id={`account-contact-${field}`}
            className="account-contact__input"
            type={field === "phone" ? "tel" : "email"}
            inputMode={field === "phone" ? "tel" : "email"}
            autoComplete={field === "phone" ? "tel" : "email"}
            // 저장된 값이 있으면 그 가려진 값을 안내글로 보여준다(없으면 예시).
            placeholder={contact[field] ?? EXAMPLE[field]}
            value={draft[field]}
            disabled={busy}
            onChange={(event) => change(field, event.target.value)}
          />
        </div>
      ))}
      <div className="account-contact__actions">
        <button type="button" className="account-contact__save" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "저장하는 중..." : "저장"}
        </button>
      </div>
      {error ? <p className="account-contact__error" role="alert">{error}</p> : null}
      {saved && !error ? <p className="account-contact__saved" role="status">저장했어요.</p> : null}
    </div>
  );
}
