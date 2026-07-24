export type AlbumCoverTarget = {
  album_id: string;
  cover_photo_id?: string | null;
};

let albumListRequest: Promise<unknown> | null = null;
const coverRequests = new Map<string, Promise<Record<string, string>>>();

/** Share an in-flight request between StrictMode's development remounts. */
export function requestMyAlbumList<T>(load: () => Promise<T>): Promise<T> {
  if (albumListRequest) return albumListRequest as Promise<T>;
  const request = load().finally(() => {
    if (albumListRequest === request) albumListRequest = null;
  });
  albumListRequest = request;
  return request;
}

/** Cover URLs are non-blocking and requested once for the visible cards only. */
export function requestMyAlbumCovers(
  albums: AlbumCoverTarget[],
  load: (albums: AlbumCoverTarget[]) => Promise<Record<string, string>>,
): Promise<Record<string, string>> {
  const targets = albums.filter((album) => Boolean(album.cover_photo_id));
  if (!targets.length) return Promise.resolve({});
  const key = targets
    .map((album) => `${album.album_id}:${album.cover_photo_id}`)
    .sort()
    .join(",");
  const existing = coverRequests.get(key);
  if (existing) return existing;
  const request = load(targets).finally(() => coverRequests.delete(key));
  coverRequests.set(key, request);
  return request;
}

export function mergeMyAlbumCoverUrls<T extends AlbumCoverTarget & { cover_image_url?: string | null }>(
  albums: T[],
  covers: Record<string, string>,
): T[] {
  return albums.map((album) => {
    const coverUrl = covers[album.album_id];
    return coverUrl ? { ...album, cover_image_url: coverUrl } : album;
  });
}

export function resetMyAlbumRequestsForTest(): void {
  albumListRequest = null;
  coverRequests.clear();
}
