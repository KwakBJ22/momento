/**
 * 전화번호 하이픈 — **화면에서만** 붙인다. 서버에는 숫자만 보낸다.
 *
 * 하이픈은 그룹 **사이**에만 들어가고 끝에 붙지 않는다(`010-` 같은 값이 안 나온다).
 * 그래서 지울 때도 자연스럽다: `010-1` 에서 한 칸 지우면 `010-` 이 아니라 `010` 이 된다
 * — 하이픈이 남아 다시 지워야 하는 일이 없다.
 */

const MAX_DIGITS = 11;

/** 숫자만 남긴다. 서버로 보낼 때 쓴다. */
export function phoneDigits(value: string): string {
  return value.replace(/\D+/g, "").slice(0, MAX_DIGITS);
}

/** 입력하는 동안 보여줄 모양. 0107 → 010-7 */
export function formatPhoneInput(value: string): string {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/**
 * 평소 표시용으로 가린다 — 010-****-5678 / ab***@example.com.
 *
 * ★ 가리는 일은 **화면이** 한다. 서버는 본인에게 원본을 준다(H-2): 자기 계정 시트에서
 * 자기 번호를 자기가 보는 화면이라, 가려서 얻는 것보다 뒷자리 하나 고치려고 11자리를
 * 다시 치는 손해가 크다. `수정` 을 누르면 원본이 칸에 들어간다.
 */
export function maskPhone(value: string | null | undefined): string | null {
  const digits = phoneDigits(value || "");
  if (!digits) return null;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

/**
 * @deprecated 연락처 이메일은 **가리지 않는다**(J-5-2 · SCREEN_SPEC §5).
 * 자기 계정 시트에서 자기 이메일을 자기가 보는 화면이고, 바로 위 계정 행의
 * 로그인 이메일은 원래 가려지지 않는다. 지우지 않고 남겨 둔 이유는 이 함수가
 * 무엇이었는지와 왜 안 쓰는지가 같이 남아야 다시 붙지 않기 때문이다.
 */
export function maskEmail(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed.includes("@")) return null;
  const [local, domain] = trimmed.split("@");
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}***@${domain}`;
}
