import { useState } from "react";
import { isAuthenticationConfigured, signIn, type AuthProvider } from "../services/authService";
import EmailAuthForm from "./EmailAuthForm";
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
  /** 이메일 칸은 **눌러야** 열린다. 카카오가 주 경로라 처음에는 한 줄만 보인다. */
  const [showsEmail, setShowsEmail] = useState(false);

  const continueWith = async (provider: AuthProvider) => {
    setMessage(null);
    setIsSubmitting(true);
    try {
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
      {/* ★ 여기서 동의를 받지 않는다 (PO 판단 2026-08-13).
          동의는 **처음 가입할 때 한 번**이면 되고, 서버가 그 사실을 계정에 남긴다
          (profiles.legal_agreed_at). 그런데 이 화면이 매번 체크를 요구해서,
          **로그인만 하려는 사람에게도 가입 절차가 보였다.** 게다가 체크 전에는
          카카오 버튼이 disabled 라 회색이었다 — 카카오 노란색이 나오지 않았다.
          동의가 필요한 사람(기록이 없는 사람)에게는 **로그인한 뒤 한 번** 받는다. */}
      <button className="auth-panel__kakao" type="button" disabled={isSubmitting} onClick={() => void continueWith("kakao")}>카카오로 시작하기</button>
      {/* ★ 이메일은 **둘째 길**이다 (PO 2026-08-19). 카톡을 안 쓰는 사람을 위한 것이고,
          주 경로는 그대로 카카오라 늘 카카오가 위에 선다.
          ★ 누르면 **같은 자리에서** 입력칸이 열린다. 새 페이지를 만들지 않는다(§7). */}
      {showsEmail ? (
        <EmailAuthForm
          returnTo={returnTo}
          onSignedIn={() => window.location.reload()}
          onUseKakao={() => void continueWith("kakao")}
        />
      ) : (
        <>
          <p className="auth-panel__or">또는</p>
          <button className="auth-panel__email-open" type="button" onClick={() => setShowsEmail(true)}>
            이메일로 시작하기
          </button>
        </>
      )}
      {/* 네이버 로그인은 MVP 에서 노출하지 않는다. 주 채널이 카카오톡 웹뷰이고,
          로그인 선택지가 둘이면 사용자가 고민한다. 백엔드의 custom:naver 처리는
          그대로 살아 있으므로 이 한 줄을 되살리면 즉시 다시 쓸 수 있다.
      <button className="btn btn--secondary" type="button" disabled={isSubmitting} onClick={() => void continueWith("naver")}>네이버로 계속하기</button> */}
    </section>
  );
}
