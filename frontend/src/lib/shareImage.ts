// Single source of truth for the image used in ALL album share paths (Kakao feed,
// collaboration panel, …). Kakao's feed template shows ONE image, so a 30-photo result
// grid is unreadable as a thumbnail — the cover photo is the right single image.

export interface ShareImageSource {
  cover_image_url?: string | null;
  image_url?: string | null;
}

export function resolveShareImageUrl(album: ShareImageSource | null | undefined): string {
  // Only the single cover photo. We deliberately do NOT fall back to image_url: that is
  // the 9/30-photo result grid, which is illegible as a Kakao thumbnail (and the top row
  // gets cropped). If there is no cover, share with no image — Kakao renders its default
  // card, which reads better than an unrecognizable grid. The backend now always fills
  // cover_image_url (see _detail_from_record), so this empty case should be rare.
  if (!album) return "";
  return album.cover_image_url || "";
}
