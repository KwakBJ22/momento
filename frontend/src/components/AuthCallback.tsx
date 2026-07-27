import { useEffect } from "react";
import { completeOAuthCallback, consumeReturnTo, getCurrentUser } from "../services/authService";

export default function AuthCallback() {
  const error: string | null = null;
  useEffect(() => {
    let active = true;
    void completeOAuthCallback().then(getCurrentUser).then(() => {
      if (active) window.location.replace(consumeReturnTo());
    }).catch(() => { if (active) window.location.replace(consumeReturnTo()); });
    return () => { active = false; };
  }, []);
  return <section className="auth-panel"><h2>로그인 확인 중</h2><p className="auth-panel__notice">{error || "잠시만 기다려 주세요."}</p>{error ? <a className="btn btn--secondary" href="/">처음으로</a> : null}</section>;
}
