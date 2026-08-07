import { useEffect, useRef, useState } from "react";

import { getProfileContact, saveProfileContact, type ProfileContact } from "../lib/api";
import "./AppChrome.css";

/**
 * ⋯ 시트 계정 행의 연락처(선택) — SCREEN_SPEC §5.
 *
 *   연락처 (선택)
 *   계정을 잃어버렸을 때 본인 확인에 씁니다. 다른 곳에는 쓰지 않아요.
 *   [ 010-1234-5678 ]  [ abc@example.com ]
 *
 * ★ 별도 프로필 화면을 만들지 않는다(§11). 여기서 바로 넣고 고치고 지운다.
 * ★ 가입 흐름에서는 받지 않는다. 본인이 원할 때 여기서 넣는다.
 * ★ 저장한 값은 서버가 **가려서** 내려준다(010-****-5678). 고칠 때는 새로 입력한다 —
 *   원본을 화면으로 돌려보내지 않기 위해서다. 인증이 없으므로 다시 입력해도 잃는 게 없다.
 */

type Field = "phone" | "email";

const LABEL: Record<Field, string> = { phone: "전화번호", email: "이메일" };
const PLACEHOLDER: Record<Field, string> = { phone: "010-1234-5678", email: "abc@example.com" };

export default function AccountContact() {
  const [contact, setContact] = useState<ProfileContact | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    void getProfileContact()
      .then((loaded) => { if (alive) setContact(loaded); })
      // 못 불러와도 시트의 나머지는 멀쩡해야 한다. 빈 상태로 둔다.
      .catch(() => { if (alive) setContact({ phone: null, email: null }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = async (field: Field, value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      // 보낸 항목만 바뀐다 — 다른 쪽은 서버에 있는 값 그대로다.
      setContact(await saveProfileContact({ [field]: value } as unknown as ProfileContact));
      setEditing(null);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (!contact) return null;

  const row = (field: Field) => {
    const saved = contact[field];
    const isEditing = editing === field || !saved;
    return (
      <div className="account-contact__row" key={field}>
        {isEditing ? (
          <>
            <input
              ref={editing === field ? inputRef : undefined}
              className="account-contact__input"
              type={field === "phone" ? "tel" : "email"}
              inputMode={field === "phone" ? "tel" : "email"}
              autoComplete={field === "phone" ? "tel" : "email"}
              aria-label={LABEL[field]}
              placeholder={PLACEHOLDER[field]}
              /* 항상 제어 입력이다 — 비어 있는 항목도 value 를 준다(제어/비제어가 섞이면
                 첫 글자에서 React 가 경고하고 커서가 튄다). */
              value={editing === field ? draft : ""}
              disabled={busy}
              onChange={(event) => { setEditing(field); setDraft(event.target.value); }}
            />
            <button
              type="button"
              className="account-contact__action"
              disabled={busy || !draft.trim() || editing !== field}
              onClick={() => void commit(field, draft)}
            >저장</button>
          </>
        ) : (
          <>
            <span className="account-contact__value">{saved}</span>
            <button type="button" className="account-contact__action" disabled={busy}
              onClick={() => { setEditing(field); setDraft(""); }}>고치기</button>
            <button type="button" className="account-contact__action" disabled={busy}
              onClick={() => void commit(field, null)}>지우기</button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="account-contact">
      <p className="account-contact__title">연락처 (선택)</p>
      {/* ★ 이 약속을 코드로도 지킨다 — 이 값은 알림·마케팅 발송 경로에서 읽지 않는다
          (backend/app/services/profile_contact_service.py 주석 참고). */}
      <p className="account-contact__help">계정을 잃어버렸을 때 본인 확인에 씁니다. 다른 곳에는 쓰지 않아요.</p>
      {(["phone", "email"] as Field[]).map(row)}
      {error ? <p className="account-contact__error" role="alert">{error}</p> : null}
    </div>
  );
}
