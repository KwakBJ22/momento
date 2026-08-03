import { useEffect, type RefObject } from "react";
import { getAlbumPhotos } from "./api";
import type { AlbumPhoto } from "../types";
import { createSignedUrlRefresher } from "./signedUrlRefresh";

/**
 * Attaches the once-per-album signed-URL recovery to a container. Uses a
 * capture-phase listener because <img> error events do not bubble. The pure
 * logic lives in signedUrlRefresh.ts (createSignedUrlRefresher) so it is testable
 * without React or the API client.
 */
export function useSignedUrlRefresh(
  albumId: string,
  edition: number | null,
  setPhotos: (updater: (current: AlbumPhoto[]) => AlbumPhoto[]) => void,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const refresher = createSignedUrlRefresher({
      fetchPhotos: () => getAlbumPhotos(albumId, edition),
      applyPhotos: setPhotos,
    });
    const onError = (event: Event) => refresher.handleImageError(event.target);
    container.addEventListener("error", onError, true); // capture: img errors don't bubble
    return () => container.removeEventListener("error", onError, true);
  }, [albumId, edition, setPhotos, containerRef]);
}
