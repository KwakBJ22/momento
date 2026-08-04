// Single source of truth for the image used in ALL album share paths (Kakao feed,
// collaboration panel, …). Kakao's feed template shows ONE image, so a 30-photo result
// grid is unreadable as a thumbnail — the cover photo is the right single image.
// Falls back to the result image only when no cover has been chosen yet.

export interface ShareImageSource {
  cover_image_url?: string | null;
  image_url?: string | null;
}

export function resolveShareImageUrl(album: ShareImageSource | null | undefined): string {
  if (!album) return "";
  return album.cover_image_url || album.image_url || "";
}
