export type GuestAlbumClaimInput = {
  guestToken: string | null;
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
  return {
    guestToken: localStorage.getItem(GUEST_ALBUM_TOKEN_KEY),
    albumId: localStorage.getItem(GUEST_ALBUM_ID_KEY) || fallbackAlbumId,
    shareToken: localStorage.getItem(GUEST_ALBUM_SHARE_TOKEN_KEY) || fallbackShareToken,
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
