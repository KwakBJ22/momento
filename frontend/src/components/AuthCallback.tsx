import { useEffect, useState } from "react";
import { completeOAuthCallback, consumeReturnTo } from "../services/authService";
import { authDebug } from "../lib/authDebug";
import { BRAND_NAME_KO_PARTS } from "../lib/brand";
import { userFacingError } from "../lib/userFacingError";

/**
 * 로그인 마무리 화면 — **없앨 수 없는 실제 단계**다(카카오가 준 토큰을 받아 저장한다).
 *
 * 0.5~2초 스쳐 가는데 헤더도 브랜드도 없는 맨 화면이라 `뭔가 잘못됐나` 로 읽혔다.
 * 화면을 새로 만들지 않고 이 자리를 다듬는다:
 *
 * ★ 헤더는 다른 화면과 **같은 것**을 쓴다(§3 — 헤더 마크업은 AppHeader 하나다).
 *   App 이 이 화면에도 그것을 그린다. 화면이 갈리는 느낌은 헤더가 없어서 났다.
 * ★ 로딩 표시는 **이미 있는 것**을 쓴다(§9 · styles/loading.css 의 loading-shimmer).
 *   0.3초 지연이 걸려 있어 빨리 끝나면 아무것도 안 보인다 — 깜빡임이 기다림보다 나쁘다.
 * ★ 문구는 한 줄이다: `로그인하고 있어요`.
 *   `잠시만 기다려 주세요` 를 지웠다 — 0.5초짜리에 기다리라고 하면 더 길게 느껴진다.
 * ★ 배경은 --c-bg 다(App 이 .app--auth-callback 으로 맞춘다). 흰 화면이라 번쩍였다.
 * ★ **실패했을 때 화면은 그대로 둔다** — 오류 문구와 돌아가기. 고칠 것이 없다.
 */
export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void completeOAuthCallback().then(() => {
      const returnPath = consumeReturnTo();
      authDebug("RETURN_PATH_CONFIRMED", { source: "callback", endpoint: returnPath });
      authDebug("CALLBACK_SUCCESS", { source: "callback" });
      if (active) window.location.replace(returnPath);
    }).catch((cause) => {
      authDebug("CALLBACK_FAILED", { source: "callback", errorName: cause instanceof Error ? cause.name : "Error" });
      if (active) setError(userFacingError(cause, "로그인을 완료하지 못했어요."));
    });
    return () => { active = false; };
  }, []);

  // 실패 화면은 예전 그대로다(오류 문구 + 돌아가기).
  if (error) {
    return (
      <section className="auth-panel">
        <h2>로그인을 마무리하고 있어요</h2>
        <p className="notice notice--error auth-panel__notice" role="alert">{error}</p>
        <a className="btn btn--secondary" href={consumeReturnTo()}>돌아가기</a>
      </section>
    );
  }

  return (
    <section className="auth-callback" aria-busy="true">
      {/* 이름은 로고 조합으로 쓴다(§9) — `우리`(글자색) + `앨범`(브랜드색). */}
      <span className="auth-callback__brand" aria-hidden="true">
        <b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i>
      </span>
      <p className="auth-callback__text" role="status">로그인하고 있어요</p>
      {/* 0.3초 안에 끝나면 이 줄은 보이지도 않는다(styles/loading.css). */}
      <span className="auth-callback__bar loading-shimmer" aria-hidden="true" />
    </section>
  );
}
