import { useState } from "react";
import LegalConsent from "./LegalConsent";
import { isAuthenticationConfigured, rememberLegalConsent, signIn, type AuthProvider } from "../services/authService";
import { authPanelCopy, type AuthPanelReason } from "../lib/authPanelCopy";
import { userFacingError } from "../lib/userFacingError";

interface AuthPanelProps {
  returnTo?: string;
  titleId?: string;
  /** 어디서 눌러 열렸는가 — 제목·설명이 여기서 갈린다(K-21). 문구는 lib 한 곳에 있다. */
  reason?: AuthPanelReason | null;
}

export default function AuthPanel({ returnTo, titleId, reason }: AuthPanelProps) {
  const copy = authPanelCopy(reason);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // ★ 매번 새로 받는다 — 저장하지 않는다(패널이 닫히면 이 상태도 함께 사라진다).
  const [agreed, setAgreed] = useState(false);

  const continueWith = async (provider: AuthProvider) => {
    setMessage(null);
    setIsSubmitting(true);
    try {
      // 체크한 사실을 왕복 너머로 남긴다 — 돌아온 뒤 bootstrap 이 실어 보낸다(K-14).
      // 버튼은 체크해야 눌리지만, 여기서 한 번 더 본다(누르는 길이 하나뿐이도록).
      if (agreed) rememberLegalConsent();
      await signIn(provider, returnTo);
    } catch (error) {
      setMessage(userFacingError(error, "로그인을 시작하지 못했어요."));
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticationConfigured) return <p className="notice notice--progress auth-panel__notice" role="status">로그인 설정을 준비하고 있어요.</p>;

  return (
    <section className="auth-panel">
      {/* ★ 창은 하나다. 제목·설명만 부르는 쪽이 정한다(K-21). 아래 동의·카카오 버튼은
          어느 경우에도 그대로다 — 로그인 절차 자체는 갈리지 않는다. */}
      <h2 id={titleId}>{copy.title}</h2>
      {copy.description ? <p>{copy.description}</p> : null}
      {message && <p className="notice notice--error auth-panel__notice" role="alert">{message}</p>}
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
