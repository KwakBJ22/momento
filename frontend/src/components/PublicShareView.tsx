import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlbumRenderer } from "../album-engine";
import ContributeWorkspace from "./ContributeWorkspace";
import { getPublicShare, saveCollabSession, startPublicContribution } from "../lib/api";
import { createId } from "../lib/id";
import type { AlbumPhoto, PublicContributionItem, PublicShareAlbum } from "../types";
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

function mapSharePhotos(photos: AlbumPhoto[] | undefined): AlbumPhoto[] {
  return (photos ?? []).map((photo) => ({
    id: String(photo.id), sort_order: photo.sort_order, comment: photo.comment,
    comments: photo.comments ?? undefined, author_label: null, original_url: photo.original_url,
    thumbnail_url: photo.thumbnail_url, width: photo.width, height: photo.height, taken_at: photo.taken_at,
    latitude: photo.latitude, longitude: photo.longitude, location_name: photo.location_name,
    location_source: photo.location_source, orientation: photo.orientation,
  }));
}

function formatContributionTime(value: string | null | undefined): string {
  if (!value) return "방금 전";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "방금 전";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function PublicShareView({ token }: PublicShareViewProps) {
  const [album, setAlbum] = useState<PublicShareAlbum | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [contributionAction, setContributionAction] = useState<"photo" | "memory" | null>(null);
  const [contributionAlbumId, setContributionAlbumId] = useState<string | null>(null);
  const [isStartingContribution, setIsStartingContribution] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const contributionPanelRef = useRef<HTMLDivElement | null>(null);
  const photos = useMemo(() => mapSharePhotos(album?.photos), [album?.photos]);

  useEffect(() => {
    setLoadedToken(null);
    setError(null);
    setContributionAction(null);
    setContributionAlbumId(null);
    setContributionError(null);
    void getPublicShare(token).then((data) => {
      setAlbum(data);
      setLoadedToken(token);
      document.title = `${data.og_title} | Momento`;
      document.querySelector('meta[name="description"]')?.setAttribute("content", data.og_description);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "공유 앨범을 불러오지 못했어요."));
  }, [token, retryKey]);

  useEffect(() => {
    if (!contributionAction || !contributionAlbumId) return;
    window.requestAnimationFrame(() => contributionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [contributionAction, contributionAlbumId]);

  const startContribution = async (action: "photo" | "memory") => {
    if (contributionAlbumId) {
      setContributionAction(action);
      return;
    }
    setContributionError(null);
    setIsStartingContribution(true);
    try {
      const result = await startPublicContribution(token, contributionGuestId());
      saveCollabSession({ albumId: result.album_id, contributorId: result.contributor_id, guestId: result.guest_id, displayName: result.display_name });
      setContributionAlbumId(result.album_id);
      setContributionAction(action);
    } catch (cause) {
      setContributionError(cause instanceof Error ? cause.message : "참여를 시작하지 못했어요.");
    } finally {
      setIsStartingContribution(false);
    }
  };

  const addPendingItems = useCallback((items: PublicContributionItem[]) => {
    setAlbum((current) => current ? {
      ...current,
      pending_items: [
        ...items,
        ...(current.pending_items || []).filter((existing) => !items.some((item) => item.id === existing.id)),
      ],
    } : current);
  }, []);

  const updatePendingItem = useCallback((item: PublicContributionItem) => {
    setAlbum((current) => current ? {
      ...current,
      pending_items: (current.pending_items || []).map((existing) => existing.id === item.id ? { ...existing, ...item } : existing),
    } : current);
  }, []);

  const removePendingItem = useCallback((id: string) => {
    setAlbum((current) => current ? {
      ...current,
      pending_items: (current.pending_items || []).filter((item) => item.id !== id),
    } : current);
  }, []);

  const share = async () => {
    if (!album) return;
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: album.title, text: album.og_description, url });
    else await navigator.clipboard.writeText(url);
  };

  if (error) return <div className="album-result"><h2 className="album-result__title">공유 앨범을 불러오지 못했어요.</h2><p>{error}</p><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;
  if (!album) return <p className="auth-panel__notice">앨범을 불러오는 중...</p>;
  if (!album || loadedToken !== token) return <p className="auth-panel__notice">앨범을 불러오는 중...</p>;
  if (!photos.length) return <div className="album-result"><h2 className="album-result__title">앨범 사진을 불러오지 못했습니다.</h2><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;
  const epilogue = (album.epilogue ?? album.narrative ?? "").trim();

  return <div className="album-page public-share">
    <article className="album-page__book album-result">
      <header className="album-result__intro">
        <h2 className="album-result__title">{album.title}</h2>
        <p className="album-result__subtitle">함께 만든 추억 앨범</p>
      </header>
      <div className="album-result__stage">
        <AlbumRenderer photos={photos} title={album.title} epilogue={epilogue} coverDateLabel={album.date} chapterStories={album.chapter_stories} category={album.category} templateType={album.template_type} mode="screen" />
      </div>
      {(album.pending_items || []).length ? (
        <section className="public-share__pending" aria-label="새로 더해진 추억">
          <h3>새로 더해진 추억</h3>
          <div className="public-share__pending-list">
            {(album.pending_items || []).map((item) => (
              <article key={`${item.type}-${item.id}`} className="public-share__pending-item">
                {item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="참여자가 추가한 사진" loading="lazy" decoding="async" /> : null}
                <div>
                  <p className="public-share__pending-meta">{item.actor_name || "참여자"}<span aria-hidden="true"> · </span>{formatContributionTime(item.created_at)}</p>
                  {item.type === "photo" && item.comment ? <p className="public-share__pending-copy">{item.comment}</p> : null}
                  {item.type === "memory" && item.content ? <p className="public-share__pending-copy">{item.content}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="public-share__join" aria-label="앨범 참여">
        <p><strong>함께 추억을 더해보세요</strong></p>
        <div className="public-share__join-actions">
          <button type="button" className="upload-form__submit" disabled={isStartingContribution} onClick={() => void startContribution("photo")}>사진 추가</button>
          <button type="button" className="btn btn--secondary" disabled={isStartingContribution} onClick={() => void startContribution("memory")}>기억 남기기</button>
          <button type="button" className="btn btn--ghost" onClick={() => void share()}>카카오톡으로 공유</button>
        </div>
        {contributionError ? <p className="public-share__join-error" role="alert">{contributionError}</p> : null}
      </section>
      {contributionAction && contributionAlbumId ? <div ref={contributionPanelRef} className="public-share__contribute">
        <ContributeWorkspace
          albumId={contributionAlbumId}
          embedded
          requestedAction={contributionAction}
          onContributionAdded={addPendingItems}
          onContributionUpdated={updatePendingItem}
          onContributionRemoved={removePendingItem}
        />
      </div> : null}
    </article>
  </div>;
}
