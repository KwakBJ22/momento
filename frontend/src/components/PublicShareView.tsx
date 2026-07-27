import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlbumRenderer } from "../album-engine";
import ContributeWorkspace, { type WorkspaceState } from "./ContributeWorkspace";
import AlbumScreen from "./AlbumScreen";
import { useKakaoSdk } from "../hooks/useKakaoSdk";
import { getPublicShare, loadCollabSession, saveCollabSession, startPublicContribution, type CollabSession } from "../lib/api";
import { createId } from "../lib/id";
import type { AppUser } from "../services/authService";
import {
  appendPendingContributions,
  clearPublicShareCache,
  contributionPanelAction,
  readPublicShareCache,
  reconcilePublicShareAlbum,
  savePublicShareCache,
  sharePublicAlbum,
} from "../lib/publicShareFlow";
import type { AlbumPhoto, PublicContributionItem, PublicShareAlbum } from "../types";
import "./AlbumResult.css";

interface PublicShareViewProps {
  token: string;
  /** The entry router already verified this public token. */
  initialAlbum?: PublicShareAlbum;
  authenticatedUser?: AppUser | null;
}

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

function hasParticipantName(value: string | null | undefined): boolean {
  const name = (value || "").trim();
  return Boolean(name && name !== "함께한 사람" && name !== "함께 참여한 사람" && name !== "참여자");
}

function debugTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    console.debug(`[Momento] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

async function copyPublicLink(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard is unavailable.");
}

export default function PublicShareView({ token, initialAlbum, authenticatedUser = null }: PublicShareViewProps) {
  const editionValue = new URLSearchParams(window.location.search).get("edition");
  const requestedEdition = editionValue && /^\d+$/.test(editionValue) ? Number(editionValue) : null;
  const contributionValue = new URLSearchParams(window.location.search).get("contribute");
  const requestedContribution = contributionValue === "photo" || contributionValue === "memory" ? contributionValue : null;
  const initialCache = requestedEdition === null ? readPublicShareCache(token) : null;
  // Cache is only used after the link has been authorized by the server.
  const [album, setAlbum] = useState<PublicShareAlbum | null>(() => initialAlbum ?? null);
  const [albumLoading, setAlbumLoading] = useState(() => !initialAlbum);
  const [error, setError] = useState<string | null>(null);
  const [loadedToken, setLoadedToken] = useState<string | null>(() => initialAlbum ? token : null);
  const [retryKey, setRetryKey] = useState(0);
  const [contributionAction, setContributionAction] = useState<"photo" | "memory" | null>(() => initialCache?.contributionAction ?? null);
  const [contributionAlbumId, setContributionAlbumId] = useState<string | null>(null);
  const [contributionSession, setContributionSession] = useState<CollabSession | null>(null);
  const [nameAction, setNameAction] = useState<"photo" | "memory" | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [isStartingContribution, setIsStartingContribution] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const contributionPanelRef = useRef<HTMLElement | null>(null);
  const rendererStartedAtRef = useRef<number | null>(null);
  const authenticatedContributionKeyRef = useRef<string | null>(null);
  const photos = useMemo(() => mapSharePhotos(album?.photos), [album?.photos]);
  const { shareAlbum } = useKakaoSdk();

  useEffect(() => {
    const startedAt = performance.now();
    let active = true;
    const cached = requestedEdition === null ? readPublicShareCache(token) : null;
    const seed = retryKey === 0 ? initialAlbum : undefined;
    setAlbumLoading(true);
    setAlbum(seed ?? null);
    setLoadedToken(null);
    setError(null);
    const cachedSession = !authenticatedUser && cached ? loadCollabSession(cached.album.album_id) : null;
    const canRestoreContribution = Boolean(cachedSession && hasParticipantName(cachedSession.displayName));
    setContributionAction(canRestoreContribution ? cached?.contributionAction ?? null : null);
    setContributionAlbumId(seed?.album_id ?? cached?.album.album_id ?? null);
    setContributionSession(cachedSession && hasParticipantName(cachedSession.displayName) ? cachedSession : null);
    setNameAction(canRestoreContribution ? null : cached?.nameAction ?? null);
    setParticipantName(authenticatedUser?.displayName || cachedSession?.displayName || "");
    setContributionError(null);
    if (seed) {
      setAlbumLoading(false);
      setLoadedToken(token);
      document.title = `${seed.og_title} | Momento`;
      document.querySelector('meta[name="description"]')?.setAttribute("content", seed.og_description);
      return () => { active = false; };
    }
    void getPublicShare(token, requestedEdition).then((data) => {
      if (!active) return;
      debugTiming("public album API response", startedAt);
      setAlbum((current) => reconcilePublicShareAlbum(current ?? cached?.album ?? null, data));
      setLoadedToken(token);
      setContributionAlbumId(data.album_id);
      const savedSession = authenticatedUser ? null : loadCollabSession(data.album_id);
      setContributionSession(savedSession && hasParticipantName(savedSession.displayName) ? savedSession : null);
      setParticipantName(authenticatedUser?.displayName || savedSession?.displayName || "");
      setAlbumLoading(false);
      document.title = `${data.og_title} | Momento`;
      document.querySelector('meta[name="description"]')?.setAttribute("content", data.og_description);
    }).catch((cause) => {
      if (!active) return;
      console.warn("[Momento] Public album request failed.", cause);
      const status = (cause as { status?: number } | null)?.status;
      if (status && [401, 403, 404, 410].includes(status)) clearPublicShareCache(token);
      setAlbum(null);
      setError(cause instanceof Error ? cause.message : "공유 앨범을 불러오지 못했어요.");
      setAlbumLoading(false);
    });
    return () => { active = false; };
  }, [token, retryKey, requestedEdition, initialAlbum, authenticatedUser]);

  useEffect(() => {
    if (!album || loadedToken !== token) return;
    if (requestedEdition === null) savePublicShareCache(token, album, contributionAction, nameAction);
  }, [album, contributionAction, loadedToken, nameAction, token, requestedEdition]);

  useEffect(() => {
    if ((!contributionAction && !nameAction) || !contributionAlbumId) return;
    window.requestAnimationFrame(() => contributionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [contributionAction, contributionAlbumId, nameAction]);

  const openContribution = (action: "photo" | "memory") => {
    if (authenticatedUser && !contributionSession) return;
    setContributionError(null);
    const next = contributionPanelAction(contributionSession, action);
    setContributionAction(next.contributionAction);
    setNameAction(next.nameAction);
  };

  useEffect(() => {
    if (!requestedContribution || !album || loadedToken !== token) return;
    if (authenticatedUser && !contributionSession) return;
    const next = contributionPanelAction(contributionSession, requestedContribution);
    setContributionAction(next.contributionAction);
    setNameAction(next.nameAction);
  }, [album, contributionSession, loadedToken, requestedContribution, token, authenticatedUser]);

  useEffect(() => {
    if (!authenticatedUser || !album || loadedToken !== token || contributionSession || isStartingContribution) return;
    const key = `${token}:${authenticatedUser.id}`;
    if (authenticatedContributionKeyRef.current === key) return;
    authenticatedContributionKeyRef.current = key;
    setIsStartingContribution(true);
    setContributionError(null);
    void startPublicContribution(token, null, authenticatedUser.displayName)
      .then((result) => {
        const session = {
          albumId: result.album_id,
          contributorId: result.contributor_id,
          guestId: result.guest_id,
          displayName: result.display_name,
        };
        saveCollabSession(session);
        setContributionAlbumId(result.album_id);
        setContributionSession(session);
        setParticipantName(result.display_name);
        setContributionAction(requestedContribution);
        setNameAction(null);
      })
      .catch((cause) => {
        console.warn("[Momento] Authenticated contribution session start failed.", cause);
        setContributionError(cause instanceof Error ? cause.message : "참여를 시작하지 못했어요.");
      })
      .finally(() => setIsStartingContribution(false));
  }, [album, authenticatedUser, contributionSession, isStartingContribution, loadedToken, requestedContribution, token]);

  const scrollToAlbumStart = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const startContribution = async () => {
    const displayName = (authenticatedUser?.displayName || participantName).trim();
    if ((!nameAction && !authenticatedUser) || !displayName) {
      setContributionError("추억을 남긴 분의 이름을 입력해 주세요.");
      return;
    }
    setIsStartingContribution(true);
    try {
      const result = await startPublicContribution(token, authenticatedUser ? null : contributionGuestId(), displayName);
      const session = { albumId: result.album_id, contributorId: result.contributor_id, guestId: result.guest_id, displayName: result.display_name };
      saveCollabSession(session);
      setContributionAlbumId(result.album_id);
      setContributionSession(session);
      setContributionAction(nameAction ?? requestedContribution);
      setNameAction(null);
    } catch (cause) {
      console.warn("[Momento] Public contribution session start failed.", cause);
      setContributionError(cause instanceof Error ? cause.message : "참여를 시작하지 못했어요.");
    } finally {
      setIsStartingContribution(false);
    }
  };

  const addPendingItems = useCallback((items: PublicContributionItem[]) => {
    setAlbum((current) => current ? appendPendingContributions(current, items) : current);
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
    if (!album || shareLoading) return;
    setShareLoading(true);
    const url = window.location.href;
    try {
      await sharePublicAlbum(
        () => shareAlbum({ imageUrl: album.image_url, linkUrl: url, description: album.og_description, title: album.title }),
        () => copyPublicLink(url),
      );
    } finally {
      setShareLoading(false);
    }
  };

  useEffect(() => {
    if (album?.photos?.length) rendererStartedAtRef.current = performance.now();
  }, [album?.photos]);

  const onAlbumRendererReady = useCallback(() => {
    if (rendererStartedAtRef.current !== null) {
      debugTiming("AlbumRenderer render", rendererStartedAtRef.current);
      rendererStartedAtRef.current = null;
    }
  }, []);

  const initialWorkspace = useMemo<WorkspaceState | undefined>(() => {
    if (!album) return undefined;
    return {
      title: album.title,
      photo_count: album.photo_count ?? album.photos?.length ?? 0,
      photo_limit: album.photo_limit ?? 30,
      photos: (album.photos || []).map((photo) => ({
        id: photo.id,
        thumbnail_url: photo.thumbnail_url,
        original_url: photo.original_url,
        memories: [],
        mine: false,
      })),
    };
  }, [album]);

  if (error) return <div className="album-result"><h2 className="album-result__title">공유 앨범을 불러오지 못했어요.</h2><p>{error}</p><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;
  if (albumLoading || !album || loadedToken !== token) return <p className="auth-panel__notice">앨범을 불러오는 중...</p>;
  // Empty legacy albums and memory-only Living Albums are valid responses.
  if (!Array.isArray(album.photos)) return <div className="album-result"><h2 className="album-result__title">앨범 사진을 불러오지 못했습니다.</h2><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;
  const epilogue = (album.epilogue ?? album.narrative ?? "").trim();

  const publicBody = (
    <>
      <div className="album-result__stage"><AlbumRenderer photos={photos} title={album.title} epilogue={epilogue} coverDateLabel={album.date} chapterStories={album.chapter_stories} category={album.category} templateType={album.template_type} albumId={album.album_id} coverPhotoId={album.cover_photo_id} livingAppendPages={album.living_append_pages} mode="screen" onReady={onAlbumRendererReady} /></div>
      {(album.pending_items || []).length ? <section className="public-share__pending" aria-label="새로 더해진 추억"><h3>새로 더해진 추억</h3><div className="public-share__pending-list">{(album.pending_items || []).map((item) => <article key={`${item.type}-${item.id}`} className="public-share__pending-item">{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="참여자가 추가한 사진" loading="lazy" decoding="async" /> : null}<div><p className="public-share__pending-meta">{item.author_name || item.actor_name || "익명"}<span aria-hidden="true"> · </span>{formatContributionTime(item.created_at)}</p>{item.type === "photo" && item.comment ? <p className="public-share__pending-copy">{item.comment}</p> : null}{item.type === "memory" && item.content ? <p className="public-share__pending-copy">{item.content}</p> : null}</div></article>)}</div></section> : null}
      <section className="public-share__join" aria-label="앨범 참여"><p><strong>함께 추억을 더해보세요</strong></p><div className="public-share__join-actions"><button type="button" className="upload-form__submit" disabled={isStartingContribution} onClick={() => openContribution("photo")}>사진 추가</button><button type="button" className="btn btn--secondary" disabled={isStartingContribution} onClick={() => openContribution("memory")}>기억 남기기</button></div>{contributionError ? <p className="public-share__join-error" role="alert">{contributionError}</p> : null}</section>
      {nameAction ? <form ref={(node) => { contributionPanelRef.current = node; }} className="public-share__name" onSubmit={(event) => { event.preventDefault(); void startContribution(); }}><label htmlFor="public-contribution-name">추억을 남긴 분의 이름을 알려주세요</label><input id="public-contribution-name" value={participantName} maxLength={40} autoComplete="name" onChange={(event) => setParticipantName(event.target.value)} /><div className="public-share__name-actions"><button type="submit" className="upload-form__submit" disabled={isStartingContribution}>{isStartingContribution ? "준비 중..." : "계속하기"}</button><button type="button" className="btn btn--ghost" disabled={isStartingContribution} onClick={() => setNameAction(null)}>취소</button></div></form> : null}
      {contributionAction && contributionAlbumId && contributionSession ? <div ref={(node) => { contributionPanelRef.current = node; }} className="public-share__contribute"><ContributeWorkspace albumId={contributionAlbumId} embedded requestedAction={contributionAction} initialWorkspace={initialWorkspace} onContributionAdded={addPendingItems} onContributionUpdated={updatePendingItem} onContributionRemoved={removePendingItem} /></div> : null}
    </>
  );
  const isParticipantMode = Boolean(contributionSession);
  const publicNav = isParticipantMode ? {
    variant: "participant" as const,
    activeItem: contributionAction === "photo" ? "photo" as const : contributionAction === "memory" ? "memory" as const : "album" as const,
    onTop: scrollToAlbumStart,
    onAddPhoto: () => openContribution("photo"),
    onAddMemory: () => openContribution("memory"),
    onShare: () => undefined,
    canAddPhoto: !isStartingContribution,
    canAddMemory: !isStartingContribution,
  } : {
    onTop: scrollToAlbumStart,
    onAddPhoto: () => openContribution("photo"),
    onAddMemory: () => openContribution("memory"),
    onShare: () => { void share(); },
    onCreateAlbum: () => window.location.assign("/"),
  };
  const publicActions = (
    <div className="album-result__actions">
      <button type="button" className="btn btn--secondary" disabled={shareLoading} onClick={() => void share()}>앨범 공유하기</button>
      <a className="btn btn--ghost" href="/">새 앨범 만들기</a>
    </div>
  );
  const editionLink = album.edition_is_latest === false ? <p className="album-result__edition-notice"><a href={`/s/${token}`}>최신 앨범 보기</a></p> : album.edition_previous ? <p className="album-result__edition-notice"><a href={`/s/${token}?edition=${album.edition_previous}`}>이전 앨범 보기</a></p> : null;
  return <AlbumScreen title={album.title} subtitle="함께 만든 추억 앨범" headerSupplement={editionLink} body={publicBody} actionPanel={isParticipantMode ? undefined : publicActions} bottomNavigation={publicNav} className="public-share" />;

  /* Legacy shell intentionally disabled: AlbumScreen above owns screen UI. */
  /*
  return <div className="album-page public-share">
    <article className="album-page__book album-result">
      <header className="album-result__intro">
        <AlbumScreenHeader title={album.title} subtitle="함께 만든 추억 앨범" />
        <h2 className="album-result__title">{album.title}</h2>
        <p className="album-result__subtitle">함께 만든 추억 앨범</p>
      </header>
      {album.edition_is_latest === false ? (
        <p className="album-result__edition-notice"><a href={`/s/${token}`}>최신 앨범 보기</a></p>
      ) : album.edition_previous ? (
        <p className="album-result__edition-notice"><a href={`/s/${token}?edition=${album.edition_previous}`}>이전 앨범 보기</a></p>
      ) : null}
      <div className="album-result__stage">
        <AlbumRenderer photos={photos} title={album.title} epilogue={epilogue} coverDateLabel={album.date} chapterStories={album.chapter_stories} category={album.category} templateType={album.template_type} albumId={album.album_id} coverPhotoId={album.cover_photo_id} livingAppendPages={album.living_append_pages} mode="screen" onReady={onAlbumRendererReady} />
      </div>
      {(album.pending_items || []).length ? (
        <section className="public-share__pending" aria-label="새로 더해진 추억">
          <h3>새로 더해진 추억</h3>
          <div className="public-share__pending-list">
            {(album.pending_items || []).map((item) => (
              <article key={`${item.type}-${item.id}`} className="public-share__pending-item">
                {item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="참여자가 추가한 사진" loading="lazy" decoding="async" /> : null}
                <div>
                  <p className="public-share__pending-meta">{item.author_name || item.actor_name || "익명"}<span aria-hidden="true"> · </span>{formatContributionTime(item.created_at)}</p>
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
          <button type="button" className="upload-form__submit" disabled={isStartingContribution} onClick={() => openContribution("photo")}>사진 추가</button>
          <button type="button" className="btn btn--secondary" disabled={isStartingContribution} onClick={() => openContribution("memory")}>기억 남기기</button>
          <button type="button" className="btn btn--ghost" disabled={shareLoading} onClick={() => void share()}>{shareLoading ? "공유 준비 중..." : "카카오톡으로 공유"}</button>
        </div>
        {contributionError ? <p className="public-share__join-error" role="alert">{contributionError}</p> : null}
        {shareMessage ? <p className="public-share__join-status" role="status">{shareMessage}</p> : null}
      </section>
      {nameAction ? <form ref={(node) => { contributionPanelRef.current = node; }} className="public-share__name" onSubmit={(event) => { event.preventDefault(); void startContribution(); }}>
        <label htmlFor="public-contribution-name">추억을 남긴 분의 이름을 알려주세요</label>
        <input id="public-contribution-name" value={participantName} maxLength={40} autoComplete="name" onChange={(event) => setParticipantName(event.target.value)} />
        <div className="public-share__name-actions">
          <button type="submit" className="upload-form__submit" disabled={isStartingContribution}>{isStartingContribution ? "준비 중..." : "계속하기"}</button>
          <button type="button" className="btn btn--ghost" disabled={isStartingContribution} onClick={() => setNameAction(null)}>취소</button>
        </div>
      </form> : null}
      {contributionAction && contributionAlbumId && contributionSession ? <div ref={(node) => { contributionPanelRef.current = node; }} className="public-share__contribute">
        <ContributeWorkspace
          albumId={contributionAlbumId}
          embedded
          requestedAction={contributionAction}
          initialWorkspace={initialWorkspace}
          onContributionAdded={addPendingItems}
          onContributionUpdated={updatePendingItem}
          onContributionRemoved={removePendingItem}
        />
      </div> : null}
    </article>
    <AlbumBottomNavigation
      onTop={scrollToAlbumStart}
      onAddPhoto={() => openContribution("photo")}
      onAddMemory={() => openContribution("memory")}
      onShare={() => { void share(); }}
    />
  </div>;
  */
}
