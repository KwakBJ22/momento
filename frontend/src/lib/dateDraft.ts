/**
 * 날짜를 **8자리 숫자로** 받는다 — `20260507` → `2026.05.07` (2026-08-18 PO).
 *
 * 🔴 아이폰에서 날짜를 넣을 수 없었다. 입력칸이 `inputMode="numeric"` 이라 숫자 키패드가
 *    뜨는데 **그 키패드에는 점(.)이 없다.** 그래서 칠 수 있는 것은 `20260507` 뿐인데
 *    파서는 `2026.05.07` 만 받아 null 을 돌려줬고, 저장은 요청을 보내기도 전에 멈췄다.
 *    화면에는 `날짜 넣기` 만 남고 아무것도 안 찍히던 것이 이것이다.
 *
 * ★ 점은 **우리가 찍는다.** 사용자에게 점을 요구하지 않는다.
 * ★ 안드로이드에서 하던 대로 `2026.05.07` 을 쳐도 그대로 된다 — 숫자만 남기기 때문이다.
 * ★ 날짜 판정을 여기 하나에 둔다. 화면과 저장이 각자 세면 갈린다.
 */

/** 8자리까지의 숫자만 남긴다. 사용자가 점을 찍든 안 찍든 같은 값이 된다. */
export function dateDraftDigits(value: string): string {
  return (value || "").replace(/\D/g, "").slice(0, 8);
}

/** 치는 동안에도 보기 좋게 끊어 보여 준다 — `2026` · `2026.05` · `2026.05.07`. */
export function formatDateDraft(value: string): string {
  const digits = dateDraftDigits(value);
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean);
  return parts.join(".");
}

/** 여덟 자리가 다 찼는가. 차기 전에는 저장을 누를 수 없다. */
export function isCompleteDateDraft(value: string): boolean {
  return dateDraftDigits(value).length === 8;
}

/** 아무것도 안 적었는가 — 날짜를 안 건드리는 것과 지우는 것은 다르다(지우는 길은 없다). */
export function isEmptyDateDraft(value: string): boolean {
  return dateDraftDigits(value).length === 0;
}

/**
 * `YYYY-MM-DD` 로 바꾼다. 달력에 없는 날이면 null 이다.
 *
 * ★ 2월 30일처럼 **자리 수는 맞는데 없는 날**도 걸러야 한다 — 자릿수만 보면 통과한다.
 */
export function parseDateDraft(value: string): string | null {
  const digits = dateDraftDigits(value);
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const made = new Date(Date.UTC(year, month - 1, day));
  // 2월 30일은 3월 2일이 된다 — 되돌려 보고 그대로가 아니면 없는 날이다.
  if (made.getUTCFullYear() !== year || made.getUTCMonth() !== month - 1 || made.getUTCDate() !== day) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** 1900년보다 앞은 서버도 막는다(§10). 같은 값을 화면에서도 쓴다. */
const EARLIEST_YEAR = 1900;

/**
 * 무엇이 잘못됐는지 **우리 말로 한 줄**(§11). 문제가 없으면 null 이다.
 *
 * ★ `유효하지 않은 형식` 같은 말을 쓰지 않는다. 무엇을 하면 되는지 말한다(§8).
 * ★ 아직 다 안 친 것은 잘못이 아니다 — 치는 중에 빨간 줄을 띄우지 않는다.
 */
export function dateDraftProblem(value: string, now: Date = new Date()): string | null {
  if (isEmptyDateDraft(value) || !isCompleteDateDraft(value)) return null;
  const digits = dateDraftDigits(value);
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (month < 1 || month > 12) return "월은 1부터 12까지 넣어 주세요.";
  if (day < 1 || day > 31) return "일은 1부터 31까지 넣어 주세요.";
  const parsed = parseDateDraft(value);
  if (!parsed) return `${year}년 ${month}월에는 ${day}일이 없어요.`;
  if (year < EARLIEST_YEAR) return `${EARLIEST_YEAR}년 이후 날짜만 넣을 수 있어요.`;
  // 앞날은 사진이 찍힌 날일 수 없다. 막지 않고 **알려만 준다**면 그대로 저장돼 버리므로
  // 여기서 막는다 — 기기 시계가 틀린 사진은 사용자가 바른 날로 고쳐 넣으면 된다.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (parsed > today) return "아직 오지 않은 날짜예요.";
  return null;
}

/** 저장을 누를 수 있는가 — 비었거나(장소만 고침), 여덟 자리가 다 차고 말이 되는 날짜다. */
export function canSaveDateDraft(value: string, now: Date = new Date()): boolean {
  if (isEmptyDateDraft(value)) return true;
  return isCompleteDateDraft(value) && dateDraftProblem(value, now) === null;
}
