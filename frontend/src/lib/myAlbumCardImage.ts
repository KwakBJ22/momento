export type MyAlbumCardImageSource = {
  cover_image_url?: string | null;
};

/** A list card never falls back to the generated PDF/result image. */
export function myAlbumCardImageUrl(album: MyAlbumCardImageSource): string {
  return (album.cover_image_url ?? "").trim();
}
