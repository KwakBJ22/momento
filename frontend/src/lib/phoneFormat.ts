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
