import { useState } from "react";

import { MIN_PASSWORD_LENGTH } from "../lib/emailAuth";
import { linkEmailPassword } from "../services/authService";
import { providerLabel } from "./AccountMergeSheet";

import "./AlbumScreen.css";
import "./AccountMergeSheet.css";

/**
 * `다른 방법으로도 로그인하기` — 지금 계정에 **로그인 방법을 하나 더 붙인다**
 * (2026-08-19 · 2단계 ②).
 *
 * PO 결정: 이메일이 **다르면** 사용자가 직접 합치게 한다. 그런데 이메일이 다른 두 계정을
 * 서버가 합치면 위험하다 — 그래서 합치지 않고 **잇는다.** 지금 쓰는 계정에 비밀번호를
 * 하나 정해 두면 그다음부터 두 방법 다 된다. 옮기는 것이 없으니 잃을 것도 없다.
 *
 * ★ 새 페이지를 만들지 않는다 — `더보기` 안에서 끝난다(§7).
 * ★ 계정을 새로 만들지 않는다. 앨범도 참여도 그대로다.
 * ★ 비밀번호 규칙은 가입과 **같은 값**을 쓴다(lib/emailAuth 한 곳).
 */

interface LinkMethodSheetProps {
  /** 지금 로그인해 있는 길("kakao" …)과 이메일 — 무엇을 잇는지 그대로 보여준다. */
  provider?: string | null;
  email?: string | null;
  onClose: () => void;
}

export default function LinkMethodSheet({ provider, email, onClose }: LinkMethodSheetProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = password.trim().length >= MIN_PASSWORD_LENGTH;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await linkEmailPassword({ password, email: email || undefined });
      setDone(result.needsConfirmation
        ? "메일의 링크를 눌러 인증을 마쳐 주세요."
        : "이제 이메일과 비밀번호로도 로그인할 수 있어요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="album-sheet-dim" aria-hidden="true" onClick={busy ? undefined : onClose} />
      <section className="album-inline-action account-merge-sheet" role="dialog" aria-modal="true" aria-label="다른 방법으로도 로그인하기">
        <div className="album-inline-action__header account-merge-sheet__header">
          <button type="button" onClick={onClose} disabled={busy}>닫기</button>
        </div>
        <div className="album-inline-action__body account-merge-sheet__body">
          <h2 className="account-merge-sheet__title">다른 방법으로도 로그인하기</h2>
          <p className="account-merge-sheet__text">
            지금 {providerLabel(provider)}로 로그인 중{email ? ` · ${email}` : ""}
          </p>
          {done ? (
            <p className="notice notice--success account-merge-sheet__done" role="status">{done}</p>
          ) : (
            <>
              <label className="account-merge-sheet__label" htmlFor="link-password">쓸 비밀번호</label>
              <input
                id="link-password"
                className="account-merge-sheet__input"
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
              />
              {error ? <p className="notice notice--error account-merge-sheet__error" role="alert">{error}</p> : null}
            </>
          )}
          <div className="account-merge-sheet__actions">
            <button type="button" className="account-merge-sheet__cancel" onClick={onClose} disabled={busy}>
              {done ? "닫기" : "그만두기"}
            </button>
            {done ? null : (
              <button type="button" className="account-merge-sheet__confirm" onClick={() => void submit()} disabled={!ready || busy}>
                {busy ? "연결하는 중..." : "이메일 · 비밀번호 연결하기"}
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
