/**
 * 이메일 + 비밀번호로 가입·로그인한다 (PO 결정 2026-08-19).
 *
 * > `카톡을 안 쓰는 사람도 있으니 이메일로 가입·로그인하게 하자.`
 *
 * ★ 카카오가 주 경로다. 이것은 **둘째 길**이고, 화면에서도 카카오 아래에 선다.
 * ★ 전화번호(SMS)는 만들지 않는다.
 * ★ 판정과 문구를 여기 하나에 둔다 — 화면 둘(AuthPanel · JoinPage)이 같은 것을 쓴다.
 *   각자 적으면 한쪽만 고쳐진다.
 */

/** 무엇을 하는 중인가. 한 자리에서 갈린다 — 새 페이지를 만들지 않는다(§7). */
export type EmailAuthMode = "signIn" | "signUp" | "reset";

/**
 * 비밀번호는 **8자 이상**만 요구한다 (PO).
 *
 * ★ 특수문자·대문자를 강요하지 않는다. 40대 이후가 주 사용자고, 복잡한 규칙은
 *   결국 종이에 적게 만든다 — 그게 더 위험하다.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** 로그인 실패는 **한 문구**다 — 어느 쪽이 틀렸는지 말하지 않는다. */
export const SIGN_IN_FAILED = "이메일이나 비밀번호가 맞지 않아요.";

/**
 * 가입·재설정 메일을 보낸 뒤. **계정이 없어도 같은 말로 끝낸다** —
 * 갈라 쓰면 그 이메일로 가입된 계정이 있는지가 새어 나간다.
 */
export const MAIL_SENT = "메일을 보냈어요. 링크를 눌러 주세요.";

/** 인증 전에는 로그인되지 않는다. 그 사실을 그대로 말한다. */
export const NEEDS_CONFIRMATION = "메일의 링크를 눌러 인증을 마쳐 주세요.";

/** 이미 카카오로 쓰던 이메일 — **막지 않고 길을 알려 준다**(계정을 합치지 않는다 · 2단계). */
export const ALREADY_KAKAO = "이 이메일은 카카오로 가입되어 있어요.";

/** 이미 이메일로 가입한 사람 — 가입이 아니라 로그인할 자리다. */
export const ALREADY_EMAIL = "이미 가입된 이메일이에요. 로그인해 주세요.";

/** 골뱅이와 점 하나. 더 깐깐하게 보지 않는다 — 진짜 판정은 메일이 가는지다. */
export function isEmailShaped(value: string): boolean {
  const trimmed = (value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function normalizeEmail(value: string): string {
  return (value || "").trim().toLowerCase();
}

/**
 * 지금 누를 수 있는가 — 누르고 나서 혼나지 않게 **미리** 막는다(§11).
 *
 * ★ 무엇이 모자란지는 `emailAuthProblem` 이 말한다. 치는 중에는 아무 말도 하지 않는다.
 */
export function canSubmitEmailAuth(
  mode: EmailAuthMode,
  fields: { email: string; password: string; name: string },
): boolean {
  if (!isEmailShaped(fields.email)) return false;
  if (mode === "reset") return true;
  if (fields.password.length < MIN_PASSWORD_LENGTH) return false;
  if (mode === "signUp" && !fields.name.trim()) return false;
  return true;
}

/**
 * 아직 못 누르는 까닭을 **우리 말로 한 줄**(§11). 없으면 null 이다.
 *
 * ★ 아무것도 안 적은 칸은 잘못이 아니다 — 치기도 전에 빨간 줄을 띄우지 않는다.
 */
export function emailAuthProblem(
  mode: EmailAuthMode,
  fields: { email: string; password: string; name: string },
): string | null {
  const email = (fields.email || "").trim();
  if (email && !isEmailShaped(email)) return "이메일 주소를 다시 확인해 주세요.";
  if (mode === "reset") return null;
  if (fields.password && fields.password.length < MIN_PASSWORD_LENGTH) {
    return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상으로 정해 주세요.`;
  }
  return null;
}

/** 화면에 쓰는 말 — 무엇을 하는 자리인지 한 벌로 갖고 있는다. */
export function emailAuthCopy(mode: EmailAuthMode): {
  submitLabel: string;
  busyLabel: string;
  switchLabel: string;
  switchTo: EmailAuthMode;
} {
  if (mode === "signUp") {
    return { submitLabel: "가입하기", busyLabel: "가입하는 중…", switchLabel: "이미 계정이 있어요", switchTo: "signIn" };
  }
  if (mode === "reset") {
    return { submitLabel: "재설정 메일 받기", busyLabel: "보내는 중…", switchLabel: "로그인으로 돌아가기", switchTo: "signIn" };
  }
  return { submitLabel: "로그인", busyLabel: "로그인하는 중…", switchLabel: "이메일로 가입하기", switchTo: "signUp" };
}

/**
 * 그 이메일이 이미 쓰이고 있을 때 무슨 말을 할지.
 *
 * ★ **가입을 시도할 때만** 부른다. 로그인 실패는 `SIGN_IN_FAILED` 하나다 —
 *   거기서 갈라 쓰면 계정이 있는지 없는지가 새어 나간다.
 */
export function existingAccountMessage(provider: string | null): string {
  return provider === "kakao" ? ALREADY_KAKAO : ALREADY_EMAIL;
}
