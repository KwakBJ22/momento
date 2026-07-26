export type GuestAlbumClaimInput = {
  guestToken: string | null;
  albumId: string | null;
  shareToken: string | null;
};

export type GuestAlbumClaimQuery = {
  albumId: string | null;
  shareToken: string | null;
};

const GUEST_ALBUM_TOKEN_KEY = "momento-guest-album-token";
const GUEST_ALBUM_CLAIM_PENDING_KEY = "momento-guest-album-claim-pending";
const GUEST_ALBUM_ID_KEY = "momento-guest-album-id";
const GUEST_ALBUM_SHARE_TOKEN_KEY = "momento-guest-album-share-token";

export function migrateLegacyGuestAlbumToken(): void {
  const legacyToken = sessionStorage.getItem(GUEST_ALBUM_TOKEN_KEY);
  if (legacyToken && !localStorage.getItem(GUEST_ALBUM_TOKEN_KEY)) {
    localStorage.setItem(GUEST_ALBUM_TOKEN_KEY, legacyToken);
  }
  if (legacyToken) sessionStorage.removeItem(GUEST_ALBUM_TOKEN_KEY);
}

export function saveGuestAlbumContext(albumId: string, shareUrl: string): void {
  localStorage.setItem(GUEST_ALBUM_ID_KEY, albumId);
  const shareToken = shareUrl.match(/\/s\/([^/?#]+)/)?.[1];
  if (shareToken) localStorage.setItem(GUEST_ALBUM_SHARE_TOKEN_KEY, shareToken);
}

/** Keep recoverable guest album context through a Magic Link browser handoff. */
export function buildGuestAlbumClaimRedirect(origin: string, albumId: string, shareUrl: string): string {
  // Ownership is preserved only in the creation browser's private storage.
  // Never put a public album identifier or share token into a Magic Link.
  void albumId;
  void shareUrl;
  return new URL("/", origin).toString();
}

export function getGuestAlbumClaimQuery(search: string): GuestAlbumClaimQuery {
  const params = new URLSearchParams(search);
  const albumId = params.get("claim_album_id");
  const shareToken = params.get("claim_share_token");
  return {
    albumId: albumId && /^[0-9a-fA-F-]{36}$/.test(albumId) ? albumId : null,
    shareToken: shareToken?.trim() || null,
  };
}

export function saveGuestAlbumToken(guestToken: string): void {
  localStorage.setItem(GUEST_ALBUM_TOKEN_KEY, guestToken);
}

export function markGuestAlbumClaimPending(): void {
  localStorage.setItem(GUEST_ALBUM_CLAIM_PENDING_KEY, "1");
}

export function hasPendingGuestAlbumClaim(): boolean {
  return localStorage.getItem(GUEST_ALBUM_CLAIM_PENDING_KEY) === "1";
}

export function getGuestAlbumClaimInput(fallbackAlbumId: string | null, fallbackShareToken: string | null): GuestAlbumClaimInput {
  void fallbackAlbumId;
  void fallbackShareToken;
  return {
    guestToken: localStorage.getItem(GUEST_ALBUM_TOKEN_KEY),
    albumId: null,
    shareToken: null,
  };
}

export function getStoredGuestAlbumId(): string | null {
  return localStorage.getItem(GUEST_ALBUM_ID_KEY);
}

export function clearGuestAlbumClaim(): void {
  localStorage.removeItem(GUEST_ALBUM_TOKEN_KEY);
  localStorage.removeItem(GUEST_ALBUM_ID_KEY);
  localStorage.removeItem(GUEST_ALBUM_SHARE_TOKEN_KEY);
  localStorage.removeItem(GUEST_ALBUM_CLAIM_PENDING_KEY);
}
