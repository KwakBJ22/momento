import { useEffect, useState } from "react";
import { completeOAuthCallback, consumeReturnTo, getCurrentUser } from "../services/authService";
import { authDebug } from "../lib/authDebug";

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void completeOAuthCallback().then(getCurrentUser).then((user) => {
      if (!user) throw new Error("로그인 세션을 저장하지 못했어요.");
      const returnPath = consumeReturnTo();
      authDebug("RETURN_PATH_CONFIRMED", { source: "callback", endpoint: returnPath });
      authDebug("CALLBACK_SUCCESS", { source: "callback" });
      if (active) window.location.replace(returnPath);
    }).catch((cause) => {
      authDebug("CALLBACK_FAILED", { source: "callback", errorName: cause instanceof Error ? cause.name : "Error" });
      if (active) setError(cause instanceof Error ? cause.message : "로그인을 완료하지 못했어요.");
    });
    return () => { active = false; };
  }, []);

  return <section className="auth-panel"><h2>로그인을 마무리하고 있어요</h2><p className="auth-panel__notice">{error || "잠시만 기다려 주세요."}</p>{error ? <a className="btn btn--secondary" href={consumeReturnTo()}>돌아가기</a> : null}</section>;
}
