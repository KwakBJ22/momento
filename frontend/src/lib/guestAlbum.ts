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
const PENDING_BOOKMARK_KEY = "woorialbum-pending-bookmark";

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
 * **하려던 일을 기억하는 한 가지 방법** (K-9 · K-15).
 *
 * 로그인은 앱 밖으로 나갔다 돌아오는 길이다. 그 사이에 하려던 일을 잊으면 사용자는
 * 돌아와서 **아무 일도 안 일어난 화면**을 본다 — 게스트 저장이 그랬고(K-9),
 * 담아두기가 그랬다(K-15, BJ 가 두 번 눌렀다).
 *
 * ★ **localStorage 다.** 카카오 왕복 중에 웹뷰가 새로 뜨면 sessionStorage 는 통째로
 *   사라진다. 그러면 돌아와서 **할 일이 있었다는 사실 자체를 잊는다.**
 * ★ **읽어도 지우지 않는다.** 지우는 것은 **끝났을 때**(또는 다시 해도 소용없는 실패일
 *   때) 부르는 쪽이 한다. 읽으면서 지우면 중간에 한 번 끊기는 것만으로 영영 잃는다.
 *
 * 이 셋을 두 벌 만들지 않는다 — 규칙이 갈라지면 한쪽만 고쳐진다.
 * ★ 그래서 **밖에서도 쓴다.** 로그인 뒤 돌아갈 자리도 같은 장치를 쓴다(K-22 ·
 *   authService). 게스트 저장·담아두기·돌아갈 자리 셋이 같은 규칙 위에 있다.
 */
export function rememberIntent(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* no-op */ }
}

export function readIntent(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function forgetIntent(key: string): void {
  try { localStorage.removeItem(key); } catch { /* no-op */ }
  // 옛 자리에 남은 것도 함께 치운다(K-9 이전에는 sessionStorage 였다).
  try { sessionStorage.removeItem(key); } catch { /* no-op */ }
}

/** 게스트 앨범 `저장하기` — 로그인 뒤 이 앨범을 계정으로 가져온다 (K-9). */
export function setPendingGuestClaim(albumId: string): void {
  rememberIntent(PENDING_CLAIM_KEY, albumId);
}

export function readPendingGuestClaim(): string | null {
  return readIntent(PENDING_CLAIM_KEY);
}

export function clearPendingGuestClaim(): void {
  forgetIntent(PENDING_CLAIM_KEY);
}

/** 공유 앨범 `담아두기` — 로그인 뒤 **이 링크로** 담는다 (K-15). */
export function setPendingBookmark(shareToken: string): void {
  rememberIntent(PENDING_BOOKMARK_KEY, shareToken);
}

export function readPendingBookmark(): string | null {
  return readIntent(PENDING_BOOKMARK_KEY);
}

export function clearPendingBookmark(): void {
  forgetIntent(PENDING_BOOKMARK_KEY);
}
