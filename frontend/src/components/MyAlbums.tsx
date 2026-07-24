import { useEffect, useState } from "react";
import { Image } from "lucide-react";
import { getMyAlbumCoverUrls, getMyAlbums, type MyAlbum } from "../lib/api";
import {
  mergeMyAlbumCoverUrls,
  requestMyAlbumCovers,
  requestMyAlbumList,
} from "../lib/myAlbumsRequest";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function debugTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    console.debug(`[Momento] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

export default function MyAlbums() {
  const [albums, setAlbums] = useState<MyAlbum[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();

    void requestMyAlbumList(getMyAlbums)
      .then((items) => {
        if (!active) return;
        setAlbums(items);
        debugTiming("my albums list response", startedAt);
        window.requestAnimationFrame(() => debugTiming("my albums first card", startedAt));

        void requestMyAlbumCovers(items, getMyAlbumCoverUrls)
          .then((covers) => {
            if (!active) return;
            setAlbums((current) => current ? mergeMyAlbumCoverUrls(current, covers) : current);
            debugTiming("my albums cover URLs", startedAt);
          })
          // A failed thumbnail must not hide the list that is already usable.
          .catch(() => undefined);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "앨범을 불러오지 못했어요."));

    return () => { active = false; };
  }, []);

  if (error) return <p className="auth-panel__notice">{error}</p>;
  if (!albums) return <p className="auth-panel__notice">앨범을 불러오는 중이에요.</p>;

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
          {albums.map((album) => {
            const imageUrl = album.cover_image_url || album.image_url;
            const imageFailed = failedImageUrls.has(imageUrl);
            return (
              <a key={album.album_id} className="my-albums__card" href={`/album/${album.album_id}`}>
                <div className="my-albums__image-wrap">
                  {imageUrl && !imageFailed ? (
                    <img
                      className="my-albums__image"
                      src={imageUrl}
                      alt=""
                      loading="lazy"
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
            );
          })}
        </div>
      )}
    </section>
  );
}
