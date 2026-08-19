import { useState } from "react";

import {
  canSubmitEmailAuth, emailAuthCopy, emailAuthProblem, existingAccountMessage,
  MAIL_SENT, MIN_PASSWORD_LENGTH, NEEDS_CONFIRMATION, SIGN_IN_FAILED,
  type EmailAuthMode,
} from "../lib/emailAuth";
import { getSignupProvider } from "../lib/api";
import {
  resendEmailConfirmation, sendPasswordReset, signInWithEmail, signUpWithEmail,
} from "../services/authService";

/**
 * 이메일 + 비밀번호로 가입·로그인하는 자리 (PO 결정 2026-08-19).
 *
 * ★ **같은 자리에서** 열린다. 새 페이지를 만들지 않는다(§7) — 부르는 쪽이 이 몸을
 *   자기 화면 안에 그린다(AuthPanel · JoinPage 가 같은 것을 쓴다).
 * ★ 카카오가 먼저다. 이 자리는 그 아래에 선다 — 주 경로는 그대로 카카오다.
 * ★ 판정과 문구는 `lib/emailAuth` 하나가 갖는다. 화면 둘이 각자 적지 않는다.
 * ★ 계정을 합치지 않는다 — 2단계다. 이미 카카오로 쓰던 이메일이면 **길만 알려 준다.**
 */
interface EmailAuthFormProps {
  /** 로그인 뒤 돌아갈 자리. 인증 메일의 링크도 여기로 돌아온다. */
  returnTo?: string;
  /** 로그인에 성공했을 때. 넘기지 않으면 그 자리에 머문다(부르는 쪽이 다시 그린다). */
  onSignedIn?: () => void;
  /** `카카오로 로그인` 을 눌렀을 때 — 카카오 흐름은 부르는 쪽이 이미 갖고 있다. */
  onUseKakao?: () => void;
}

export default function EmailAuthForm({ returnTo, onSignedIn, onUseKakao }: EmailAuthFormProps) {
  const [mode, setMode] = useState<EmailAuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 끝난 뒤 그 자리에 남는 말 — `메일을 보냈어요` 처럼 다음 할 일이 있는 안내다. */
  const [done, setDone] = useState<string | null>(null);
  /** 이미 카카오로 가입된 이메일 — 이때만 `카카오로 로그인` 을 함께 그린다. */
  const [useKakaoInstead, setUseKakaoInstead] = useState(false);

  const copy = emailAuthCopy(mode);
  const fields = { email, password, name };
  const problem = emailAuthProblem(mode, fields);
  const ready = canSubmitEmailAuth(mode, fields) && !problem;

  const switchMode = (next: EmailAuthMode) => {
    setMode(next);
    setError(null);
    setDone(null);
    setUseKakaoInstead(false);
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setUseKakaoInstead(false);
    try {
      if (mode === "reset") {
        await sendPasswordReset(email, returnTo);
        // ★ 계정이 없어도 **같은 말로 끝낸다** — 갈라 쓰면 계정이 있는지 새어 나간다.
        setDone(MAIL_SENT);
        return;
      }
      if (mode === "signUp") {
        // ★ 먼저 물어본다. 이미 카카오로 쓰던 이메일이면 **가입을 막지 않고 길을 알려 준다.**
        //   모르면(null) 그냥 가입을 이어 간다 — 안내 하나 때문에 가입이 막히면 안 된다.
        const provider = await getSignupProvider(email);
        if (provider) {
          setUseKakaoInstead(provider === "kakao");
          setError(existingAccountMessage(provider));
          return;
        }
        const result = await signUpWithEmail({ email, password, name, returnTo });
        if (result.alreadyRegistered) {
          // Supabase 는 이미 있는 이메일에 가짜 사용자를 준다(계정이 있는지 감추려고).
          // 위 물음이 놓친 경우가 여기로 온다 — 새 계정은 만들어지지 않았다.
          setError(existingAccountMessage(null));
          return;
        }
        // 인증 전에는 로그인되지 않는다. 화면은 여기서 끝나고, 다시 보내기가 그 자리에 있다.
        setDone(MAIL_SENT);
        return;
      }
      await signInWithEmail(email, password);
      onSignedIn?.();
    } catch (cause) {
      if (mode === "signIn") {
        // ★ 어느 쪽이 틀렸는지 알려 주지 않는다 — 계정이 있는지 없는지가 새어 나간다.
        //   인증을 안 마친 경우만 갈라 준다(그건 본인이 무엇을 해야 하는지의 문제다).
        const raw = cause instanceof Error ? cause.message.toLowerCase() : "";
        setError(raw.includes("not confirmed") || raw.includes("confirm") ? NEEDS_CONFIRMATION : SIGN_IN_FAILED);
        return;
      }
      setError("잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await resendEmailConfirmation(email, returnTo);
      setDone(MAIL_SENT);
    } catch {
      setError("메일을 다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  // 메일을 보낸 뒤 — 입력칸을 다시 보여 주지 않는다. 지금 할 일은 메일함을 여는 것뿐이다.
  if (done) {
    return (
      <div className="email-auth">
        <p className="notice notice--info email-auth__done" role="status">{done}</p>
        {mode === "signUp" ? (
          <button type="button" className="email-auth__link" disabled={busy} onClick={() => void resend()}>
            메일이 오지 않았어요 · 다시 보내기
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="email-auth">
      <label className="email-auth__label" htmlFor="email-auth-email">이메일</label>
      <input
        id="email-auth-email"
        className="email-auth__input"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        inputMode="email"
        maxLength={320}
        placeholder="you@example.com"
      />

      {mode !== "reset" ? (
        <>
          <label className="email-auth__label" htmlFor="email-auth-password">비밀번호</label>
          <input
            id="email-auth-password"
            className="email-auth__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            maxLength={72}
            placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
          />
        </>
      ) : null}

      {mode === "signUp" ? (
        <>
          <label className="email-auth__label" htmlFor="email-auth-name">이름</label>
          <input
            id="email-auth-name"
            className="email-auth__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={40}
            placeholder="앨범에서 이 이름으로 불려요"
          />
        </>
      ) : null}

      {problem ? <p className="notice notice--info email-auth__hint" role="status">{problem}</p> : null}
      {error ? <p className="notice notice--error email-auth__error" role="alert">{error}</p> : null}

      {/* ★ 이미 카카오로 쓰던 이메일 — 막지 않고 **길을 알려 준다**(계정을 합치지 않는다). */}
      {useKakaoInstead && onUseKakao ? (
        <button type="button" className="email-auth__kakao" onClick={onUseKakao}>카카오로 로그인</button>
      ) : null}

      <button type="button" className="email-auth__submit" disabled={!ready || busy} onClick={() => void submit()}>
        {busy ? copy.busyLabel : copy.submitLabel}
      </button>

      <div className="email-auth__links">
        <button type="button" className="email-auth__link" onClick={() => switchMode(copy.switchTo)}>
          {copy.switchLabel}
        </button>
        {mode === "signIn" ? (
          <button type="button" className="email-auth__link" onClick={() => switchMode("reset")}>
            비밀번호를 잊었어요
          </button>
        ) : null}
      </div>
    </div>
  );
}
