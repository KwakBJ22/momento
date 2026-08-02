// Guest (no-login) album ownership on the client.
//
// A guest album is created without an account and bound to a one-time session
// token returned by the backend. The browser stores that raw token and sends it
// as `X-Momento-Guest-Album-Token` to view/edit the album, and to claim it after
// login. This is a DIFFERENT concept from a share-link contributor's guest id
// (see PublicShareView) — that identifies someone adding to *someone else's*
// album; this identifies the *owner* of an unclaimed album.

const tokenKey = (albumId: string) => `momento-guest-album-token:${albumId}`;
const PENDING_CLAIM_KEY = "momento-guest-pending-claim";

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
export function setPendingGuestClaim(albumId: string): void {
  try {
    sessionStorage.setItem(PENDING_CLAIM_KEY, albumId);
  } catch {
    /* no-op */
  }
}

export function takePendingGuestClaim(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_CLAIM_KEY);
    sessionStorage.removeItem(PENDING_CLAIM_KEY);
    return value;
  } catch {
    return null;
  }
}
