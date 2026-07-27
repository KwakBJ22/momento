import { useState } from "react";
import { isAuthenticationConfigured, signIn, type AuthProvider } from "../services/authService";

interface AuthPanelProps { returnTo?: string; }

export default function AuthPanel({ returnTo }: AuthPanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      <h2>내 앨범 보관하기</h2>
      <p>로그인하면 언제든 내 앨범에서 다시 볼 수 있어요.</p>
      {message && <p className="auth-panel__notice" role="alert">{message}</p>}
      <button className="upload-form__submit" type="button" disabled={isSubmitting} onClick={() => void continueWith("kakao")}>카카오로 계속하기</button>
      <button className="btn btn--secondary" type="button" disabled={isSubmitting} onClick={() => void continueWith("naver")}>네이버로 계속하기</button>
    </section>
  );
}
