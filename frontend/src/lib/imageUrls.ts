export type ImagePurpose = "thumbnail" | "screen" | "print";

type ImageSource = {
  original_url?: string | null;
  display_url?: string | null;
  thumbnail_url?: string | null;
};

/**
 * Selects a stable existing asset for each rendering purpose. Legacy photos do
 * not have display_url, so they continue to use their signed original URL.
 */
export function selectAlbumPhotoUrl(photo: ImageSource, purpose: ImagePurpose): string {
  if (purpose === "thumbnail") {
    return photo.thumbnail_url || photo.display_url || photo.original_url || "";
  }
  if (purpose === "print") {
    return photo.original_url || photo.display_url || photo.thumbnail_url || "";
  }
  return photo.display_url || photo.original_url || photo.thumbnail_url || "";
}
