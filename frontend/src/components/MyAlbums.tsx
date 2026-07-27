import { useEffect, useRef, useState } from "react";
import { Image } from "lucide-react";
import { deleteAlbum, getMyAlbums, type MyAlbum } from "../lib/api";
import { requestMyAlbumList } from "../lib/myAlbumsRequest";
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

export default function MyAlbums() {
  const [albums, setAlbums] = useState<MyAlbum[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(() => new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();

    void requestMyAlbumList(getMyAlbums)
      .then((items) => {
        if (!active) return;
        setAlbums(items);
        debugTiming("my albums list response", startedAt);
        window.requestAnimationFrame(() => debugTiming("my albums first card", startedAt));
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "앨범을 불러오지 못했어요."));

    return () => { active = false; };
  }, []);

  const handleDelete = async (album: MyAlbum) => {
    if (deletingIdsRef.current.has(album.album_id)) return;
    if (!window.confirm(`"${album.title}" 앨범을 삭제할까요?`)) return;
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

  if (error) return <p className="auth-panel__notice">{error}</p>;
  if (!albums) {
    return (
      <section className="my-albums" aria-labelledby="my-albums-title">
        <header className="my-albums__header">
          <div><p className="my-albums__eyebrow">내 기록</p><h2 id="my-albums-title">내 앨범</h2></div>
        </header>
        <p className="auth-panel__notice">앨범을 불러오는 중이에요.</p>
        <MyAlbumsSkeleton />
      </section>
    );
  }

  return (
    <section className="my-albums" aria-labelledby="my-albums-title">
      <header className="my-albums__header">
        <div><p className="my-albums__eyebrow">내 기록</p><h2 id="my-albums-title">내 앨범</h2></div>
        <a className="my-albums__create" href="/">앨범 만들기</a>
      </header>
      {albums.length === 0 ? (
        <div className="my-albums__empty"><p>아직 만든 앨범이 없어요.</p><a className="landing__cta my-albums__empty-cta" href="/">첫 앨범 만들기</a></div>
      ) : (
        <div className="my-albums__list">
          {albums.map((album, index) => {
            const imageUrl = myAlbumCardImageUrl(album);
            const imageFailed = imageUrl ? failedImageUrls.has(imageUrl) : false;
            return (
              <div key={album.album_id} className="my-albums__card">
                <a className="my-albums__card-link" href={`/album/${album.album_id}`}>
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
                    <div className="my-albums__card-title-row"><h3>{album.title}</h3>{album.new_memory_count > 0 && <span className="my-albums__memory-badge">새로운 추억 {album.new_memory_count}개</span>}</div>
                    <p>{formatDate(album.created_at)} · 사진 {album.photo_count}장</p>
                  </div>
                </a>
                <button
                  type="button"
                  className="my-albums__delete"
                  disabled={deletingId === album.album_id}
                  onClick={() => void handleDelete(album)}
                >
                  {deletingId === album.album_id ? "삭제 중" : "삭제"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
