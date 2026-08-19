/**
 * 지금 이 페이지가 **떠나는 중**인가 (2026-08-19).
 *
 * 이 앱은 화면을 옮길 때 `window.location.assign` 으로 페이지를 통째로 다시 연다.
 * 그 순간 날아가던 요청은 브라우저가 끊는다 — 서버는 200 을 적는데(Railway dev 08-19,
 * bootstrap 전부 200) 화면은 그 끊김을 실패로 읽어 `다시 시도` 를 띄웠다. 어차피
 * 사라질 화면의 오류라 사용자가 볼 이유가 없고, 로그인 직후에는 이것이 **약관 동의를
 * 몇 번씩 다시 시키는** 모양으로 나타났다.
 *
 * ★ 판정에만 쓴다. 떠나는 중이면 실패를 **말하지 않을** 뿐, 상태 갱신을 막지 않는다.
 * ★ pagehide 는 bfcache 복원(pageshow)에서 되돌린다 — iOS 사파리는 뒤로 가기에서
 *   페이지를 살려서 돌려준다.
 */

let leaving = false;

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { leaving = true; });
  window.addEventListener("beforeunload", () => { leaving = true; });
  window.addEventListener("pageshow", () => { leaving = false; });
}

export function pageIsLeaving(): boolean {
  return leaving;
}
