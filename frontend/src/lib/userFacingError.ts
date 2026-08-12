/**
 * 화면에 낼 오류 문구를 고른다 (SCREEN_SPEC §11 26차 · 2026-08-12).
 *
 * ★ **서버·SDK 가 준 말을 화면에 그대로 내지 않는다.**
 *   실기기에서 이렇게 보였다:
 *     `앨범을 찾을 수 없어요` 아래에 `You do not have permission to view this album.`
 *     공유가 막히면 `Kakao SDK is not ready.`
 *   둘 다 사용자가 읽을 말이 아니다.
 *
 * ★ 그렇다고 원인을 통째로 버리지도 않는다. 우리 백엔드는 대부분 우리말로 답하고
 *   (`앨범에 포함된 사진만 대표사진으로 선택할 수 있습니다.`), 그 말은 우리가 쓴
 *   말이라 화면에 그대로 내는 것이 맞다. **가름은 한글이 들어 있는가 하나다.**
 *
 * ★ 어느 쪽이든 **진짜 이유는 콘솔에 남긴다.** 지난번 대표사진 저장이 안 될 때
 *   catch 가 이유를 통째로 버려서 원인을 찾는 데 오래 걸렸다.
 */
const HANGUL = /[가-힣]/;

export function userFacingError(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message.trim() : "";
  if (raw) console.warn("[우리앨범] error:", raw, cause);
  // 우리말이 들어 있으면 우리가 쓴 말이다 — 그대로 낸다.
  if (raw && HANGUL.test(raw)) return raw;
  // 아니면 영어(또는 빈 값)다 — 우리 말로 바꾼다.
  return fallback;
}
