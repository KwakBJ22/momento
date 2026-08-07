import { useEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import { deleteAlbum, getMyAlbums, type MyAlbum } from "../lib/api";
import { requestMyAlbumList } from "../lib/myAlbumsRequest";
import ConfirmSheet from "./ConfirmSheet";
import { myAlbumCardImageUrl } from "../lib/myAlbumCardImage";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function debugTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    console.debug(`[Momento] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

function MyAlbumsSkeleton() {
  return (
    <div className="my-albums__list" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <div key={key} className="my-albums__card my-albums__card--skeleton">
          <div className="my-albums__image-wrap my-albums__skeleton-block" />
          <div className="my-albums__card-body">
            <div className="my-albums__skeleton-line my-albums__skeleton-line--title" />
            <div className="my-albums__skeleton-line" />
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
  const [error, setError] = useState<string | null>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(() => new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingIdsRef = useRef<Set<string>>(new Set());
  // 지우기 전 물음 — window.confirm 을 쓰지 않는다(§11). 확인 대상 앨범을 담아 둔다.
  const [pendingDelete, setPendingDelete] = useState<MyAlbum | null>(null);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();

    void requestMyAlbumList(getMyAlbums, userId)
      .then((data) => {
        if (!active) return;
        setAlbums(data.albums);
        setParticipating(data.participating);
        debugTiming("my albums list response", startedAt);
        window.requestAnimationFrame(() => debugTiming("my albums first card", startedAt));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "앨범을 불러오지 못했어요."));

    return () => { active = false; };
  }, []);

  const handleDelete = async (album: MyAlbum) => {
    if (deletingIdsRef.current.has(album.album_id)) return;
    deletingIdsRef.current.add(album.album_id);
    setDeletingId(album.album_id);
    try {
      await deleteAlbum(album.album_id);
      setAlbums((current) => current?.filter((item) => item.album_id !== album.album_id) ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "앨범을 삭제하지 못했어요.");
    } finally {
      deletingIdsRef.current.delete(album.album_id);
      setDeletingId(null);
    }
  };

  // One card shape for both sections (no duplicate markup). Participating albums pass
  // canDelete=false — a non-owner can't delete, so no delete control (section title,
  // not a badge, distinguishes owner vs participant).
  const renderCard = (album: MyAlbum, index: number, canDelete: boolean) => {
    const imageUrl = myAlbumCardImageUrl(album);
    const imageFailed = imageUrl ? failedImageUrls.has(imageUrl) : false;
    return (
      <div key={album.album_id} className="my-albums__card">
        <a className="my-albums__card-link" href={album.status === "processing" || album.status === "failed" ? `/album/${album.album_id}/creating` : `/album/${album.album_id}`}>
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
      </div>
    );
  };

  if (error) return <p className="auth-panel__notice">{error}</p>;
  if (!albums) {
    return (
      <section className="my-albums" aria-labelledby="my-albums-title">
        <header className="my-albums__header">
          <div><h2 id="my-albums-title">내 앨범</h2></div>
        </header>
        <p className="auth-panel__notice">앨범을 불러오는 중이에요.</p>
        <MyAlbumsSkeleton />
      </section>
    );
  }

  return (
    <section className="my-albums" aria-labelledby="my-albums-title">
      <header className="my-albums__header">
        <div><h2 id="my-albums-title">내 앨범</h2></div>
        <a className="my-albums__create" href="/">앨범 만들기</a>
      </header>
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
