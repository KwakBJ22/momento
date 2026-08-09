/**
 * 앨범 버전을 화면에 옮겨 두는 **한 곳** (K-6 · SCREEN_SPEC §11).
 *
 * 서버는 앨범을 고칠 때마다 `album_version` 을 올린다. 올리는 자리가 **넷**이다:
 *
 *     제목            update_album_title
 *     날짜 이야기      update_album_chapter_stories
 *     캡션(한 줄)      update_album_photo_comment
 *     우리의 이야기    update_album_epilogue
 *
 * PDF 를 올릴 때는 그 버전을 함께 보내고, 서버는 다르면 **409** 로 거절한다.
 * 그 검사는 옳다 — 사이에 앨범이 바뀌었으면 다시 만들어야 한다.
 *
 * 결함은 화면 쪽이었다: 저장 뒤 **바뀐 값만** 넣고 버전은 그대로 뒀다.
 * 프로덕션 실측(2026-08-09) — 한 줄 저장 · 이야기 저장으로 서버는 2가 됐는데
 * 화면은 0을 보냈고 `PUT /albums/{id}/pdf` 가 409 로 끊겼다.
 *
 * ★ 저장 응답을 화면에 옮길 때는 **반드시 이 함수를 지난다.** 네 자리가 각자
 *   기억하게 두면 다음에 하나가 또 빠진다 — 그때도 조용히 409 만 난다.
 */

export interface AlbumVersionCarrier {
  album_version?: number | null;
}

/**
 * 저장 응답에 실려 온 새 버전을 화면 상태에 얹는다.
 * 응답에 버전이 없으면(옛 서버 · 다른 응답 모양) 지금 값을 그대로 둔다 —
 * 없는 값을 0으로 덮으면 오히려 409 를 만든다.
 */
export function withAlbumVersion<T extends AlbumVersionCarrier>(
  current: T,
  saved: AlbumVersionCarrier | null | undefined,
): T {
  const next = saved?.album_version;
  if (typeof next !== "number" || !Number.isFinite(next)) return current;
  return { ...current, album_version: next };
}
