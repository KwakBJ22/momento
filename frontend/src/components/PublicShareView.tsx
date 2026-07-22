import { useEffect, useState } from "react";
import { AlbumRenderer } from "../album-engine";
import { getPublicShare, saveCollabSession, startPublicContribution } from "../lib/api";
import { createId } from "../lib/id";
import type { AlbumPhoto, PublicShareAlbum } from "../types";
import "./AlbumResult.css";

interface PublicShareViewProps { token: string }

function contributionGuestId(): string {
  const key = "momento-public-contribution-guest-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = createId();
  localStorage.setItem(key, created);
  return created;
}

function mapSharePhotos(album: PublicShareAlbum): AlbumPhoto[] {
  return (album.photos ?? []).map((photo) => ({
    id: String(photo.id), sort_order: photo.sort_order, comment: photo.comment,
    comments: photo.comments ?? undefined, author_label: null, original_url: photo.original_url,
    thumbnail_url: photo.thumbnail_url, width: photo.width, height: photo.height, taken_at: photo.taken_at,
    latitude: photo.latitude, longitude: photo.longitude, location_name: photo.location_name,
    location_source: photo.location_source, orientation: photo.orientation,
  }));
}

export default function PublicShareView({ token }: PublicShareViewProps) {
  const [album, setAlbum] = useState<PublicShareAlbum | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoadedToken(null);
    setError(null);
    void getPublicShare(token).then((data) => {
      setAlbum(data);
      setLoadedToken(token);
      document.title = `${data.og_title} | Momento`;
      document.querySelector('meta[name="description"]')?.setAttribute("content", data.og_description);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "공유 앨범을 불러오지 못했어요."));
  }, [token, retryKey]);

  const startContribution = async () => {
    try {
      const result = await startPublicContribution(token, contributionGuestId());
      saveCollabSession({ albumId: result.album_id, contributorId: result.contributor_id, guestId: result.guest_id, displayName: result.display_name });
      window.location.assign(`/album/${result.album_id}/contribute`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "참여를 시작하지 못했어요.");
    }
  };

  const share = async () => {
    if (!album) return;
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: album.title, text: album.og_description, url });
    else await navigator.clipboard.writeText(url);
  };

  if (error) return <div className="album-result"><h2 className="album-result__title">공유 앨범을 불러오지 못했어요.</h2><p>{error}</p><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;

  if (error) return <div className="album-result"><h2 className="album-result__title">공유 앨범을 열 수 없어요</h2><p>{error}</p></div>;
  if (!album) return <p className="auth-panel__notice">앨범을 불러오는 중...</p>;
  if (!album || loadedToken !== token) return <p className="auth-panel__notice">앨범을 불러오는 중...</p>;
  const photos = mapSharePhotos(album);
  if (!photos.length) return <div className="album-result"><h2 className="album-result__title">앨범 사진을 불러오지 못했습니다.</h2><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;
  const epilogue = (album.epilogue ?? album.narrative ?? "").trim();

  return <div className="album-page public-share">
    <article className="album-page__book album-result">
      <header className="album-result__intro">
        <h2 className="album-result__title">{album.title}</h2>
        <p className="album-result__subtitle">함께 만든 추억 앨범</p>
      </header>
      <section className="public-share__join" aria-label="앨범 참여">
        <p><strong>함께 추억을 만들고 있습니다.</strong></p>
        <p>사진도 올리고 한 줄도 남겨보세요.</p>
        <div className="public-share__join-actions">
          <button type="button" className="upload-form__submit" onClick={() => void startContribution()}>사진 추가</button>
          <button type="button" className="btn btn--secondary" onClick={() => void startContribution()}>한 줄 남기기</button>
          <button type="button" className="btn btn--ghost" onClick={() => void share()}>카카오톡으로 공유</button>
        </div>
      </section>
      <div className="album-result__stage">
        <AlbumRenderer photos={photos} title={album.title} epilogue={epilogue} coverDateLabel={album.date} chapterStories={album.chapter_stories} category={album.category} templateType={album.template_type} mode="screen" />
      </div>
    </article>
  </div>;
}
