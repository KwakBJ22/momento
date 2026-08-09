// Guest (no-login) album ownership on the client.
//
// A guest album is created without an account and bound to a one-time session
// token returned by the backend. The browser stores that raw token and sends it
// as `X-Woorialbum-Guest-Album-Token` to view/edit the album, and to claim it after
// login. This is a DIFFERENT concept from a share-link contributor's guest id
// (see PublicShareView) — that identifies someone adding to *someone else's*
// album; this identifies the *owner* of an unclaimed album.

const tokenKey = (albumId: string) => `woorialbum-guest-album-token:${albumId}`;
const PENDING_CLAIM_KEY = "woorialbum-guest-pending-claim";

export function saveGuestAlbumToken(albumId: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(albumId), token);
  } catch {
    /* private mode / storage disabled — guest album simply won't persist */
  }
}

export function getGuestAlbumToken(albumId: string): string | null {
  try {
    return localStorage.getItem(tokenKey(albumId));
  } catch {
    return null;
  }
}

export function clearGuestAlbumToken(albumId: string): void {
  try {
    localStorage.removeItem(tokenKey(albumId));
  } catch {
    /* no-op */
  }
}

export function hasGuestAlbumToken(albumId: string): boolean {
  return Boolean(getGuestAlbumToken(albumId));
}

// The album a guest asked to save, remembered across the login round-trip so the
// claim can run once the user comes back authenticated.
/**
 * `저장하기` 를 눌렀다는 **의도**를 남긴다 (K-9).
 *
 * ★ **localStorage 다.** 예전에는 sessionStorage 였는데, 카카오 로그인은 앱 밖으로
 *   나갔다 돌아오는 길이라 그 사이에 웹뷰가 새로 뜨면 sessionStorage 가 통째로
 *   사라진다. 그러면 돌아와서 **가져올 것이 있다는 사실 자체를 잊는다.**
 *   게스트 토큰은 이미 localStorage 에 있다 — 의도도 같은 수명이어야 짝이 맞는다.
 */
export function setPendingGuestClaim(albumId: string): void {
  try {
    localStorage.setItem(PENDING_CLAIM_KEY, albumId);
  } catch {
    /* no-op */
  }
}

/**
 * 가져올 앨범이 있는지 **본다. 지우지 않는다** (K-9).
 *
 * ★ 예전에는 읽으면서 바로 지웠다(`take`). 그래서 가져오기가 끝나기 전에 화면이
 *   한 번 다시 뜨면 — 프로덕션 로그가 정확히 그랬다 — 의도가 이미 사라져 있어서
 *   **다시 시도할 방법이 없었다.** 지우는 것은 성공했을 때(또는 다시 해도 소용없는
 *   실패일 때) `clearPendingGuestClaim` 이 한다.
 */
export function readPendingGuestClaim(): string | null {
  try {
    return localStorage.getItem(PENDING_CLAIM_KEY);
  } catch {
    return null;
  }
}

export function clearPendingGuestClaim(): void {
  try { localStorage.removeItem(PENDING_CLAIM_KEY); } catch { /* no-op */ }
  try { sessionStorage.removeItem(PENDING_CLAIM_KEY); } catch { /* no-op */ }
}
