import { useState } from "react";

import { readDeviceConsent, showsConsentCheckbox } from "../lib/legalConsent";
import LegalConsent from "./LegalConsent";
import { isAuthenticationConfigured, signIn, type AuthProvider } from "../services/authService";

interface AuthPanelProps { returnTo?: string; titleId?: string; }

export default function AuthPanel({ returnTo, titleId }: AuthPanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * ★ **미리 체크된 상태로 시작하지 않는다** — 켜져 있는 동의는 동의가 아니다(K-14).
   *   이 기기가 이미 이 버전에 동의했으면 체크칸을 **아예 안 보인다**(비어 있는 채로
   *   보여주고 다시 누르게 하지 않는다). 그때는 이 값이 처음부터 true 다.
   * ★ 기기에 남은 값은 **힌트일 뿐**이다. 진짜 판정은 로그인 뒤 서버가 한다 —
   *   기록이 없거나 버전이 낮으면 그 자리에서 시트로 다시 받는다(§10).
   */
  const [needsConsent] = useState(() => showsConsentCheckbox(readDeviceConsent()));
  const [agreed, setAgreed] = useState(false);
  const canContinue = !needsConsent || agreed;

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

  if (!isAuthenticationConfigured) return <p className="notice notice--progress auth-panel__notice" role="status">로그인 설정을 준비하고 있어요.</p>;

  return (
    <section className="auth-panel">
      <h2 id={titleId}>내 앨범 보관하기</h2>
      <p>로그인하면 언제든 내 앨범에서 다시 볼 수 있어요.</p>
      {message && <p className="notice notice--error auth-panel__notice" role="alert">{message}</p>}
      {/* 동의를 먼저 받고 그다음에 시작한다 — 순서가 화면에서도 그대로 보이게 위에 둔다.
          ★ 이 순서를 뒤집지 않는다(K-14). 개인정보를 받기 전에 동의를 받는 순서가 안전하다. */}
      {needsConsent ? <LegalConsent checked={agreed} onChange={setAgreed} /> : null}
      <button className="auth-panel__kakao" type="button" disabled={isSubmitting || !canContinue} onClick={() => void continueWith("kakao")}>카카오로 계속하기</button>
      {/* 네이버 로그인은 MVP 에서 노출하지 않는다. 주 채널이 카카오톡 웹뷰이고,
          로그인 선택지가 둘이면 사용자가 고민한다. 백엔드의 custom:naver 처리는
          그대로 살아 있으므로 이 한 줄을 되살리면 즉시 다시 쓸 수 있다.
      <button className="btn btn--secondary" type="button" disabled={isSubmitting} onClick={() => void continueWith("naver")}>네이버로 계속하기</button> */}
    </section>
  );
}
