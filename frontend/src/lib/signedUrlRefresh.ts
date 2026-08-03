import type { AlbumPhoto } from "../types";

// Recovery for expired signed URLs. Private-bucket photos are served via signed
// URLs that expire; a photo whose URL expired loads as an empty frame. When that
// happens we refetch the album's photo list ONCE and swap in fresh URLs. The URL
// fields are replaced in place (by id, order preserved), so AlbumRenderer
// re-renders rather than remounting (CLAUDE.md §9).

/**
 * Replace only the signed-URL fields of the current photos with fresh ones (matched
 * by id). Keeps id / sort_order / comments / everything else, so React reconciles
 * the same nodes (no remount) and only the <img src> changes.
 */
export function mergeRefreshedPhotoUrls(current: AlbumPhoto[], refreshed: AlbumPhoto[]): AlbumPhoto[] {
  const byId = new Map(refreshed.map((photo) => [photo.id, photo]));
  return current.map((photo) => {
    const fresh = byId.get(photo.id);
    if (!fresh) return photo;
    return {
      ...photo,
      original_url: fresh.original_url,
      display_url: fresh.display_url,
      thumbnail_url: fresh.thumbnail_url,
    };
  });
}

/** True only when the error came from an album photo <img> (not some other image). */
export function isAlbumPhotoImageError(target: EventTarget | null): boolean {
  return target instanceof HTMLImageElement && target.classList.contains("album-photo-frame__img");
}

interface RefresherOptions {
  fetchPhotos: () => Promise<AlbumPhoto[]>;
  applyPhotos: (updater: (current: AlbumPhoto[]) => AlbumPhoto[]) => void;
}

/**
 * Once-per-album controller (pure, dependency-injected so it is unit-testable).
 * The first album-photo error triggers exactly one refetch; later errors are
 * ignored so 30 failing images never stampede the API and it never loops.
 */
export function createSignedUrlRefresher({ fetchPhotos, applyPhotos }: RefresherOptions) {
  let attempted = false;
  return {
    /** Returns true if this error triggered the (single) refetch. */
    handleImageError(target: EventTarget | null): boolean {
      if (attempted || !isAlbumPhotoImageError(target)) return false;
      attempted = true;
      void fetchPhotos()
        .then((fresh) => applyPhotos((current) => mergeRefreshedPhotoUrls(current, fresh)))
        .catch(() => { /* keep the frame; never loop */ });
      return true;
    },
    reset() {
      attempted = false;
    },
  };
}
