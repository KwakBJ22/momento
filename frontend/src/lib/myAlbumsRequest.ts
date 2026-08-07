export type AlbumCoverTarget = {
  album_id: string;
  cover_photo_id?: string | null;
};

let albumListRequest: Promise<unknown> | null = null;
/** 진행 중인 목록 요청이 **누구 것인지**. 이 키가 없으면 계정이 바뀌는 동안 다음 계정이
 *  이전 계정의 목록을 그대로 받는다(내 앨범에 남의 앨범이 보인다). */
let albumListOwner: string | null = null;
const coverRequests = new Map<string, Promise<Record<string, string>>>();

/**
 * Share an in-flight request between StrictMode's development remounts.
 *
 * ★ 사용자별로만 공유한다. 로그인한 사람이 다르면 절대 재사용하지 않는다 —
 * 비로그인은 "guest" 로 구분한다(로그인 전후도 서로 다른 요청이다).
 */
export function requestMyAlbumList<T>(load: () => Promise<T>, userId?: string | null): Promise<T> {
  const owner = userId || "guest";
  if (albumListRequest && albumListOwner === owner) return albumListRequest as Promise<T>;
  const request = load().finally(() => {
    if (albumListRequest === request) {
      albumListRequest = null;
      albumListOwner = null;
    }
  });
  albumListRequest = request;
  albumListOwner = owner;
  return request;
}

/** 로그아웃·계정 전환 시 진행 중인 요청을 버린다. 결과가 도착해도 쓰지 않는다. */
export function discardMyAlbumRequests(): void {
  albumListRequest = null;
  albumListOwner = null;
  coverRequests.clear();
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
