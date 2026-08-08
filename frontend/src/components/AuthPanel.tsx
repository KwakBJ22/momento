import { useState } from "react";
import LegalConsent from "./LegalConsent";
import { isAuthenticationConfigured, signIn, type AuthProvider } from "../services/authService";

interface AuthPanelProps { returnTo?: string; titleId?: string; }

export default function AuthPanel({ returnTo, titleId }: AuthPanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ★ 매번 새로 받는다 — 저장하지 않는다(패널이 닫히면 이 상태도 함께 사라진다).
  const [agreed, setAgreed] = useState(false);

  const continueWith = async (provider: AuthProvider) => {
    setMessage(null);
    setIsSubmitting(true);
    try {
      await signIn(provider, returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인을 시작하지 못했어요.");
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticationConfigured) return <p className="auth-panel__notice">로그인 설정을 준비하고 있어요.</p>;

  return (
    <section className="auth-panel">
      <h2 id={titleId}>내 앨범 보관하기</h2>
      <p>로그인하면 언제든 내 앨범에서 다시 볼 수 있어요.</p>
      {message && <p className="auth-panel__notice" role="alert">{message}</p>}
      {/* 동의를 먼저 받고 그다음에 시작한다 — 순서가 화면에서도 그대로 보이게 위에 둔다. */}
      <LegalConsent checked={agreed} onChange={setAgreed} />
      <button className="auth-panel__kakao" type="button" disabled={isSubmitting || !agreed} onClick={() => void continueWith("kakao")}>카카오로 계속하기</button>
      {/* 네이버 로그인은 MVP 에서 노출하지 않는다. 주 채널이 카카오톡 웹뷰이고,
          로그인 선택지가 둘이면 사용자가 고민한다. 백엔드의 custom:naver 처리는
          그대로 살아 있으므로 이 한 줄을 되살리면 즉시 다시 쓸 수 있다.
      <button className="btn btn--secondary" type="button" disabled={isSubmitting} onClick={() => void continueWith("naver")}>네이버로 계속하기</button> */}
    </section>
  );
}
