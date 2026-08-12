import { useEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import { deleteAlbum, getMyAlbums, removeAlbumBookmark, type MyAlbum } from "../lib/api";
import { bookmarkRemoveTroubleMessage } from "../lib/albumTrouble";
import { requestMyAlbumList } from "../lib/myAlbumsRequest";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";
import ConfirmSheet from "./ConfirmSheet";
import { myAlbumCardImageUrl } from "../lib/myAlbumCardImage";
import { userFacingError } from "../lib/userFacingError";

/**
 * 제목 바로 아래 한 줄 — **지금 여기서 할 수 있는 일** (SCREEN_SPEC §7).
 *
 * ★ 불러오는 중·앨범 없음 갈래에는 넣지 않는다. 그 화면들은 이미 제 말을 한다.
 * ★ 아래 `함께 만드는 앨범`·`담아둔 앨범` 제목에도 넣지 않는다. 한 화면에 한 줄이다.
 */
const SCREEN_LEAD = "내가 만든 앨범과 함께 만드는 앨범이 모여 있어요.";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function debugTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    console.debug(`[우리앨범] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

function MyAlbumsSkeleton() {
  return (
    <div className="my-albums__list" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <div key={key} className="my-albums__card my-albums__card--skeleton">
          <div className="my-albums__image-wrap my-albums__skeleton-block loading-shimmer" />
          <div className="my-albums__card-body">
            <div className="my-albums__skeleton-line my-albums__skeleton-line--title loading-shimmer" />
            <div className="my-albums__skeleton-line loading-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface MyAlbumsProps {
  /** 지금 로그인한 사람. 진행 중인 목록 요청을 사용자별로 가르는 키다(다른 계정의
   *  목록을 물려받지 않게 — myAlbumsRequest 참고). */
  userId?: string | null;
}

export default function MyAlbums({ userId }: MyAlbumsProps) {
  const [albums, setAlbums] = useState<MyAlbum[] | null>(null);
  const [participating, setParticipating] = useState<MyAlbum[]>([]);
  const [bookmarked, setBookmarked] = useState<MyAlbum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(() => new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingIdsRef = useRef<Set<string>>(new Set());
  // 지우기 전 물음 — window.confirm 을 쓰지 않는다(§11). 확인 대상 앨범을 담아 둔다.
  const [pendingDelete, setPendingDelete] = useState<MyAlbum | null>(null);
  // 담아둔 앨범을 목록에서 빼는 중 · 못 뺐을 때 (K-16).
  const [removingBookmarkId, setRemovingBookmarkId] = useState<string | null>(null);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  // 목록을 다시 읽는 열쇠 — 화면으로 돌아왔을 때 오래됐으면 올린다(아래 useRefreshOnReturn).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();

    void requestMyAlbumList(getMyAlbums, userId)
      .then((data) => {
        if (!active) return;
        setAlbums(data.albums);
        setParticipating(data.participating);
        setBookmarked(data.bookmarked);
        debugTiming("my albums list response", startedAt);
        window.requestAnimationFrame(() => debugTiming("my albums first card", startedAt));
      })
      .catch((reason) => active && setError(userFacingError(reason, "앨범을 불러오지 못했어요.")));

    return () => { active = false; };
  }, [reloadKey]);

  // 되살린 화면이 낡은 상태로 뜨지 않게 한다. 지우는 중이거나 확인 시트가 떠 있으면
  // 목록을 갈아 끼우지 않는다 — 누르려던 것이 발밑에서 바뀌면 안 된다.
  useRefreshOnReturn(
    () => setReloadKey((key) => key + 1),
    Boolean(pendingDelete) || Boolean(deletingId) || Boolean(removingBookmarkId),
  );

  const handleDelete = async (album: MyAlbum) => {
    if (deletingIdsRef.current.has(album.album_id)) return;
    deletingIdsRef.current.add(album.album_id);
    setDeletingId(album.album_id);
    try {
      await deleteAlbum(album.album_id);
      setAlbums((current) => current?.filter((item) => item.album_id !== album.album_id) ?? []);
    } catch (reason) {
      setError(userFacingError(reason, "앨범을 삭제하지 못했어요."));
    } finally {
      deletingIdsRef.current.delete(album.album_id);
      setDeletingId(null);
    }
  };

  // One card shape for both sections (no duplicate markup). Participating albums pass
  // canDelete=false — a non-owner can't delete, so no delete control (section title,
  // not a badge, distinguishes owner vs participant).
  /**
   * 카드를 눌렀을 때 갈 자리.
   *
   * ★ **담아둔 앨범은 담을 때 쓴 링크로 연다**(K-7b). 담아둔 사람은 구경꾼이라
   *   멤버가 아니다 — `/album/{id}` 로 열면 403 이다. 서버가 담을 때 그 링크를
   *   함께 저장해 두고 `share_token` 으로 내려준다.
   * ★ 담아둬도 권한은 바뀌지 않는다(§1). 링크로 여는 것이 그 사실 그대로다.
   */
  const myAlbumHref = (album: MyAlbum) => {
    if (album.share_token) return `/s/${album.share_token}`;
    if (album.status === "processing" || album.status === "failed") return `/album/${album.album_id}/creating`;
    return `/album/${album.album_id}`;
  };

  /**
   * 담아둔 앨범을 **내 목록에서만** 뺀다 (K-16 · SCREEN_SPEC §1).
   *
   * ★ 앨범을 지우는 것이 아니다. 남의 앨범이고, 링크가 있으면 언제든 다시 담을 수 있다.
   *   그래서 **다시 묻지 않는다** — 되돌릴 수 없는 일에만 묻는다(§11).
   * ★ 빼는 것은 **앨범 id 로** 한다(K-6). 담을 때 쓴 링크가 죽어도 뺄 수는 있어야 한다.
   */
  const handleRemoveBookmark = async (album: MyAlbum) => {
    if (removingBookmarkId) return;
    setRemovingBookmarkId(album.album_id);
    setBookmarkError(null);
    try {
      await removeAlbumBookmark(album.album_id);
      setBookmarked((current) => current.filter((item) => item.album_id !== album.album_id));
    } catch (cause) {
      // 조용히 끝내지 않는다(§11). 목록은 그대로 둔다 — 없어진 척하지 않는다.
      console.error("Bookmark removal failed", { albumId: album.album_id, cause });
      setBookmarkError(bookmarkRemoveTroubleMessage());
    } finally {
      setRemovingBookmarkId(null);
    }
  };
  const renderCard = (album: MyAlbum, index: number, canDelete: boolean, canRemoveBookmark = false) => {
    const imageUrl = myAlbumCardImageUrl(album);
    const imageFailed = imageUrl ? failedImageUrls.has(imageUrl) : false;
    return (
      <div key={album.album_id} className="my-albums__card">
        <a className="my-albums__card-link" href={myAlbumHref(album)}>
          <div className="my-albums__image-wrap">
            {imageUrl && !imageFailed ? (
              <img
                className="my-albums__image"
                src={imageUrl}
                alt=""
                loading={index < 2 ? "eager" : "lazy"}
                decoding="async"
                onError={() => setFailedImageUrls((current) => new Set(current).add(imageUrl))}
              />
            ) : <span className="my-albums__image-placeholder" aria-hidden="true"><Image size={24} /></span>}
          </div>
          <div className="my-albums__card-body">
            <div className="my-albums__card-title-row"><h3>{album.title}</h3>{album.status === "processing" ? <span className="my-albums__status-badge">생성 중</span> : album.status === "failed" ? <span className="my-albums__status-badge my-albums__status-badge--failed">생성 실패</span> : album.new_memory_count > 0 ? <span className="my-albums__memory-badge">새로 더해진 것 {album.new_memory_count}개</span> : null}</div>
            <p>{formatDate(album.created_at)} · 사진 {album.photo_count}장</p>
          </div>
        </a>
        {canDelete ? (
          <button
            type="button"
            className="my-albums__delete"
            disabled={deletingId === album.album_id}
            onClick={() => setPendingDelete(album)}
          >
            {deletingId === album.album_id ? "삭제 중" : "삭제"}
          </button>
        ) : null}
        {/* ★ `삭제` 라고 쓰지 않는다(K-16). 앨범이 없어지는 것이 아니라 **내 목록에서만**
            빠진다는 것이 말에서 읽혀야 한다. 이 자리가 유일한 빼기 자리다(§1 25차). */}
        {canRemoveBookmark ? (
          <button
            type="button"
            className="my-albums__unbookmark"
            disabled={removingBookmarkId === album.album_id}
            onClick={() => void handleRemoveBookmark(album)}
          >
            {removingBookmarkId === album.album_id ? "빼는 중" : "내 목록에서 빼기"}
          </button>
        ) : null}
      </div>
    );
  };

  if (error) return <p className="notice notice--error auth-panel__notice" role="alert">{error}</p>;
  if (!albums) {
    return (
      <section className="my-albums" aria-labelledby="my-albums-title">
        <header className="my-albums__header">
          <div><h2 id="my-albums-title">내 앨범</h2></div>
        </header>
        <p className="notice notice--progress auth-panel__notice" role="status">앨범을 불러오는 중이에요.</p>
        <MyAlbumsSkeleton />
      </section>
    );
  }

  return (
    <section className="my-albums" aria-labelledby="my-albums-title">
      {/* ★ 헤더는 제목과 링크 둘뿐이다. 안내 줄을 이 안에 넣었더니 왼쪽이 커져
          오른쪽 `앨범 만들기` 가 눌려 두 줄로 깨졌다(flex · space-between). */}
      <header className="my-albums__header">
        <h2 id="my-albums-title">내 앨범</h2>
        <a className="my-albums__create" href="/">앨범 만들기</a>
      </header>
      {albums.length > 0 ? <p className="my-albums__lead">{SCREEN_LEAD}</p> : null}
      {albums.length === 0 ? (
        <div className="my-albums__empty"><p>아직 만든 앨범이 없어요.</p><a className="landing__cta my-albums__empty-cta" href="/">첫 앨범 만들기</a></div>
      ) : (
        <div className="my-albums__list">
          {albums.map((album, index) => renderCard(album, index, true))}
        </div>
      )}
      {participating.length > 0 ? (
        <>
          <header className="my-albums__header my-albums__header--section">
            <div><h2>함께 만드는 앨범</h2></div>
          </header>
          <div className="my-albums__list">
            {participating.map((album, index) => renderCard(album, index, false))}
          </div>
        </>
      ) : null}
      {/* 담아둔 앨범(§1 9차) — 구경하다가 담아 둔 것. 권한이 아니라 목록일 뿐이다.
          같은 앨범이 두 칸에 뜨지 않는다 — 서버가 위 두 칸에 있는 것을 빼고 준다. */}
      {bookmarked.length > 0 ? (
        <>
          <header className="my-albums__header my-albums__header--section">
            <div><h2>담아둔 앨범</h2></div>
          </header>
          {bookmarkError ? <p className="notice notice--error" role="alert">{bookmarkError}</p> : null}
          <div className="my-albums__list">
            {bookmarked.map((album, index) => renderCard(album, index, false, true))}
          </div>
        </>
      ) : null}
      {pendingDelete ? (
        <ConfirmSheet
          title={`"${pendingDelete.title}" 앨범을 지울까요?`}
          description="지운 앨범과 그 안의 사진·글은 되돌릴 수 없어요."
          confirmLabel="앨범 지우기"
          danger
          busy={deletingId === pendingDelete.album_id}
          onConfirm={() => { const target = pendingDelete; setPendingDelete(null); void handleDelete(target); }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </section>
  );
}
