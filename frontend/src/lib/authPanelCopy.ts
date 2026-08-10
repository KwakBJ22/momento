/**
 * 로그인 창의 제목·설명을 **한 곳에서** 고른다 (K-21 · SCREEN_SPEC §8).
 *
 * 첫 화면의 `로그인` 을 눌렀는데 `내 앨범 보관하기` 라는 제목이 떴다. 로그인 창이
 * 하나뿐이라, 담아두기 때 쓰던 말이 그대로 나온 것이다. 누른 것과 뜨는 말이 다르면
 * 사람은 자기가 잘못 눌렀나 한다.
 *
 * ★ **창을 두 벌로 만들지 않는다.** `LegalConsent` 처럼 컴포넌트는 하나 그대로 두고
 *   **값만** 넣는다. 약관 체크와 `카카오로 계속하기` 는 모든 경우에 그대로 있다.
 * ★ 문구를 화면마다 흩지 않는다 — 부르는 쪽은 `이유` 만 넘기고 말은 여기서 나온다.
 */

export type AuthPanelReason = "signin" | "bookmark" | "guest-save";

export interface AuthPanelCopy {
  title: string;
  description: string | null;
}

const COPY: Record<AuthPanelReason, AuthPanelCopy> = {
  // 첫 화면·헤더의 `로그인` — 이미 계정이 있는 사람이 이어서 보려는 것이다.
  signin: { title: "로그인", description: "쓰던 계정으로 이어서 볼 수 있어요." },
  // 구경꾼이 남의 앨범을 담아둘 때. 담을 곳이 계정이라 로그인이 필요하다(§1).
  bookmark: { title: "이 앨범을 담아둘까요?", description: "담아두면 다음에도 이 앨범을 찾을 수 있어요." },
  // 게스트 주최자가 자기 앨범을 계정에 붙일 때.
  "guest-save": { title: "이 앨범을 내 앨범으로 저장할까요?", description: "저장해 두면 다음에도 이 앨범을 찾을 수 있어요." },
};

/** 이유를 모르면 `로그인` 하나만 말한다 — 없는 맥락을 지어내지 않는다. */
export function authPanelCopy(reason?: AuthPanelReason | null): AuthPanelCopy {
  return (reason && COPY[reason]) || { title: "로그인", description: null };
}
