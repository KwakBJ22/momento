import { useEffect, useRef } from "react";

/**
 * 화면으로 **돌아왔을 때** 오래된 내용을 한 번 다시 읽는다.
 *
 * 카카오톡 인앱 브라우저를 최소화했다 되살리면 그 사이 바뀐 사진·대표사진을 모른 채
 * 낡은 화면이 그대로 뜬다. 최소화 버블 자체는 카카오톡 UI라 우리가 없앨 수 없다 —
 * **내용만 최신으로 만든다.**
 *
 * 규칙
 *   · `visibilitychange` 로 화면이 다시 보이는 순간에만 본다.
 *   · 마지막으로 읽은 지 60초가 넘었을 때만 다시 읽는다. 탭을 잠깐 오갈 때마다 다시
 *     읽으면 데이터도 배터리도 낭비고, 화면이 깜빡인다.
 *   · ★ `blocked` 가 참이면 아무것도 하지 않는다. **쓰던 글이 날아가면 안 된다** —
 *     캡션·이야기·한마디를 쓰는 중이거나 확인 시트가 떠 있을 때가 그렇다.
 *     이 훅에서 가장 위험한 자리다.
 *
 * 새 컴포넌트를 만들지 않는다. 부르는 쪽은 이미 있는 새로고침 경로를 넘긴다.
 */
export const REFRESH_ON_RETURN_STALE_MS = 60_000;

export function useRefreshOnReturn(refresh: () => void, blocked: boolean): void {
  // 매 렌더 새로 만들어지는 값들이라 ref 로 들고 본다 — 이것 때문에 구독이 다시 걸리지 않게.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const lastReadAtRef = useRef(Date.now());

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (blockedRef.current) return;
      if (Date.now() - lastReadAtRef.current <= REFRESH_ON_RETURN_STALE_MS) return;
      lastReadAtRef.current = Date.now();
      refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
