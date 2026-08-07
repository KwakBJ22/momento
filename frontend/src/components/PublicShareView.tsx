import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND_TITLE_SUFFIX } from "../lib/brand";
import { AlbumRenderer } from "../album-engine";
import ContributeWorkspace, { type WorkspaceState } from "./ContributeWorkspace";
import AlbumScreen from "./AlbumScreen";
import AlbumGuestbook from "./AlbumGuestbook";
import { useKakaoSdk } from "../hooks/useKakaoSdk";
import { getPublicShare, loadCollabSession, saveCollabSession, startPublicContribution, submitShareReaction, type CollabSession } from "../lib/api";
import { REACTIONS, getReactionSessionKey, markReactionPressed, readPressedReactions, type ReactionCode } from "../lib/shareReactions";
import type { GuestbookItem } from "../types";
import { createId } from "../lib/id";
import { authDebug } from "../lib/authDebug";
import { resolveShareImageUrl } from "../lib/shareImage";
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
  /** 헤더 우측 `로그인`(비로그인 구경꾼 — SCREEN_SPEC §3). App 의 로그인 모달을 연다. */
  onLogin?: () => void;
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
    id: String(photo.id), sort_order: photo.sort_order, caption: photo.caption,
    comments: photo.comments ?? undefined, author_label: null, original_url: photo.original_url, display_url: photo.display_url,
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

export default function PublicShareView({ token, initialAlbum, authenticatedUser = null, onLogin }: PublicShareViewProps) {
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
  // 역할은 링크의 종류가 정한다 — 백엔드가 내려준 능력만 본다(SCREEN_SPEC §1).
  // 값이 없으면(구버전 응답) 보수적으로 구경꾼으로 본다: 할 수 없는 것을 보여주는 쪽이 더 나쁘다.
  const canContribute = album?.can_contribute === true;

  const [nameAction, setNameAction] = useState<"photo" | "memory" | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [isStartingContribution, setIsStartingContribution] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const contributionPanelRef = useRef<HTMLElement | null>(null);
  const rendererStartedAtRef = useRef<number | null>(null);
  const authenticatedContributionKeyRef = useRef<string | null>(null);
  // Which action the user asked for while the account session was still starting,
  // read by the async start handler so the click is never lost.
  const pendingContributionActionRef = useRef<"photo" | "memory" | null>(null);
  const [contributionRetry, setContributionRetry] = useState(0);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [pressedReactions, setPressedReactions] = useState<Set<ReactionCode>>(new Set());
  const reactionSessionRef = useRef<string>("");
  const [guestbook, setGuestbook] = useState<GuestbookItem[]>([]);
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
      document.title = `${seed.og_title} | ${BRAND_TITLE_SUFFIX}`;
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
      document.title = `${data.og_title} | ${BRAND_TITLE_SUFFIX}`;
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
    // 백엔드가 막는 것을 화면에서도 열지 않는다(2중 방어 — 판정은 백엔드가 한 것).
    if (!canContribute) return;
    setContributionError(null);
    if (authenticatedUser && !contributionSession) {
      // Account session isn't ready yet. Remember the intent and (re)start the
      // session instead of silently ignoring the click. The start effect opens
      // the panel for this action once the session is ready.
      pendingContributionActionRef.current = action;
      if (!isStartingContribution) {
        authenticatedContributionKeyRef.current = null;
        setContributionRetry((value) => value + 1);
      }
      return;
    }
    const next = contributionPanelAction(contributionSession, action);
    setContributionAction(next.contributionAction);
    setNameAction(next.nameAction);
  };

  const retryContribution = () => {
    setContributionError(null);
    authenticatedContributionKeyRef.current = null;
    setContributionRetry((value) => value + 1);
  };

  useEffect(() => {
    if (!requestedContribution || !album || loadedToken !== token) return;
    if (authenticatedUser && !contributionSession) return;
    const next = contributionPanelAction(contributionSession, requestedContribution);
    setContributionAction(next.contributionAction);
    setNameAction(next.nameAction);
  }, [album, contributionSession, loadedToken, requestedContribution, token, authenticatedUser]);

  useEffect(() => {
    // 감상 링크에서는 자동 참여를 시작하지 않는다 — 구경꾼을 말없이 참여자로 만들지 않는다.
    if (!canContribute) return;
    if (!authenticatedUser || !album || loadedToken !== token || contributionSession || isStartingContribution) return;
    // contributionRetry lets a failed start be retried: a new key clears the guard.
    const key = `${token}:${authenticatedUser.id}:${contributionRetry}`;
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
        // Open whatever the user clicked while the session was starting; fall
        // back to the URL-requested action when there was no explicit click.
        const pending = pendingContributionActionRef.current;
        pendingContributionActionRef.current = null;
        setContributionAction(pending ?? requestedContribution);
        setNameAction(null);
        authDebug("ROUTE_CONTRIBUTOR", { source: "publicShare", routeRole: "participant", reason: "account_contributor_ready", albumId: result.album_id, userId: authenticatedUser.id });
      })
      .catch((cause) => {
        console.warn("[Momento] Authenticated contribution session start failed.", cause);
        // Keep the current key so this failed attempt does not auto-loop; a
        // click or explicit retry bumps contributionRetry to try again.
        setContributionError(cause instanceof Error ? cause.message : "참여를 시작하지 못했어요.");
      })
      .finally(() => setIsStartingContribution(false));
  }, [album, authenticatedUser, canContribute, contributionSession, contributionRetry, isStartingContribution, loadedToken, requestedContribution, token]);

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
      if (authenticatedUser) authDebug("ROUTE_CONTRIBUTOR", { source: "publicShare", routeRole: "participant", reason: "account_contributor_ready", albumId: result.album_id, userId: authenticatedUser.id });
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

  const albumId = album?.album_id;
  useEffect(() => {
    if (!albumId) return;
    setReactionCounts({ ...(album?.reaction_counts ?? {}) });
    setPressedReactions(readPressedReactions(albumId));
    reactionSessionRef.current = getReactionSessionKey();
    setGuestbook(album?.guestbook ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);



  const react = async (code: ReactionCode) => {
    if (!albumId || pressedReactions.has(code)) return;
    // Optimistic: mark pressed + bump the anonymous count.
    setPressedReactions((prev) => new Set(prev).add(code));
    setReactionCounts((prev) => ({ ...prev, [code]: (prev[code] ?? 0) + 1 }));
    try {
      await submitShareReaction(token, code, reactionSessionRef.current || getReactionSessionKey());
      markReactionPressed(albumId, code);
    } catch {
      setPressedReactions((prev) => { const next = new Set(prev); next.delete(code); return next; });
      setReactionCounts((prev) => ({ ...prev, [code]: Math.max(0, (prev[code] ?? 1) - 1) }));
    }
  };

  const share = async () => {
    if (!album || shareLoading) return;
    setShareLoading(true);
    const url = window.location.href;
    try {
      await sharePublicAlbum(
        () => shareAlbum({ imageUrl: resolveShareImageUrl(album), linkUrl: url, description: album.og_description, title: album.title }),
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
      <section className="public-share__reactions" aria-label="이 앨범에 마음 남기기">
        {REACTIONS.map((r) => {
          const isPressed = pressedReactions.has(r.code);
          const count = reactionCounts[r.code] ?? 0;
          return (
            <button key={r.code} type="button" className={`public-share__reaction${isPressed ? " is-pressed" : ""}`} aria-pressed={isPressed} disabled={isPressed} onClick={() => void react(r.code)}>
              <span className="public-share__reaction-emoji" aria-hidden="true">{r.emoji}</span>
              <span className="public-share__reaction-label">{r.label}</span>
              {count > 0 ? <span className="public-share__reaction-count">{count}</span> : null}
            </button>
          );
        })}
      </section>
      {/* ③ 방명록 — 공용 컴포넌트(AlbumGuestbook). 앨범 상세와 같은 구현을 쓴다. */}
      <AlbumGuestbook token={token} albumId={albumId || ""} initialEntries={guestbook} defaultAuthorName={participantName} />
      {(album.pending_items || []).length ? <section className="public-share__pending" aria-label="새로 더해진 추억"><h3>새로 더해진 추억</h3><div className="public-share__pending-list">{(album.pending_items || []).map((item) => <article key={`${item.type}-${item.id}`} className="public-share__pending-item">{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="참여자가 추가한 사진" loading="lazy" decoding="async" /> : null}<div><p className="public-share__pending-meta">{item.author_name || item.actor_name || "익명"}<span aria-hidden="true"> · </span>{formatContributionTime(item.created_at)}</p>{item.type === "photo" && item.comment ? <p className="public-share__pending-copy">{item.comment}</p> : null}{item.type === "memory" && item.content ? <p className="public-share__pending-copy">{item.content}</p> : null}</div></article>)}</div></section> : null}
      {/* 참여 블록은 함께 만들기 링크에서만. 구경꾼에게 할 수 없는 행동을 보여주지 않는다(§1). */}
      {canContribute ? <section className="public-share__join" aria-label="앨범 참여"><p><strong>함께 추억을 더해보세요</strong></p><div className="public-share__join-actions"><button type="button" className="upload-form__submit" disabled={isStartingContribution} onClick={() => openContribution("photo")}>사진 추가</button><button type="button" className="btn btn--secondary" disabled={isStartingContribution} onClick={() => openContribution("memory")}>기억 남기기</button></div>{isStartingContribution ? <p className="public-share__join-status" role="status">참여를 준비하고 있어요...</p> : null}{contributionError ? <p className="public-share__join-error" role="alert">{contributionError}{authenticatedUser && !contributionSession ? <button type="button" className="btn btn--ghost public-share__join-retry" onClick={retryContribution}>다시 시도</button> : null}</p> : null}</section> : null}
      {nameAction ? <form ref={(node) => { contributionPanelRef.current = node; }} className="public-share__name" onSubmit={(event) => { event.preventDefault(); void startContribution(); }}><label htmlFor="public-contribution-name">추억을 남긴 분의 이름을 알려주세요</label><input id="public-contribution-name" value={participantName} maxLength={40} autoComplete="name" onChange={(event) => setParticipantName(event.target.value)} /><div className="public-share__name-actions"><button type="submit" className="upload-form__submit" disabled={isStartingContribution}>{isStartingContribution ? "준비 중..." : "계속하기"}</button><button type="button" className="btn btn--ghost" disabled={isStartingContribution} onClick={() => setNameAction(null)}>취소</button></div></form> : null}
      {contributionAction && contributionAlbumId && contributionSession ? <div ref={(node) => { contributionPanelRef.current = node; }} className="public-share__contribute"><ContributeWorkspace albumId={contributionAlbumId} embedded requestedAction={contributionAction} initialWorkspace={initialWorkspace} onContributionAdded={addPendingItems} onContributionUpdated={updatePendingItem} onContributionRemoved={removePendingItem} /></div> : null}
    </>
  );
  const isParticipantMode = canContribute && Boolean(contributionSession);
  const publicNav = isParticipantMode ? {
    variant: "participant" as const,
    activeItem: contributionAction === "photo" ? "photo" as const : contributionAction === "memory" ? "memory" as const : "album" as const,
    onTop: scrollToAlbumStart,
    onAddPhoto: () => openContribution("photo"),
    onAddMemory: () => openContribution("memory"),
    onShare: () => undefined,
    onCreateAlbum: () => window.location.assign("/"),
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
      <div className="album-result__hinted-action">
        <button type="button" className="btn btn--secondary" disabled={shareLoading} onClick={() => void share()}>구경하라고 보내기</button>
        <p className="album-result__action-hint">보기만 할 수 있어요</p>
      </div>
      <a className="btn btn--ghost" href="/">새 앨범 만들기</a>
    </div>
  );
  const editionLink = album.edition_is_latest === false ? <p className="album-result__edition-notice"><a href={`/s/${token}`}>최신 앨범 보기</a></p> : album.edition_previous ? <p className="album-result__edition-notice"><a href={`/s/${token}?edition=${album.edition_previous}`}>이전 앨범 보기</a></p> : null;
  // 비로그인 구경꾼에게는 헤더 우측에 `로그인`(§3). 이 화면이 서비스의 첫인상이다.
  const headerRight = !authenticatedUser && onLogin
    ? <button type="button" className="app__account-login" onClick={onLogin}>로그인</button>
    : undefined;
  return <AlbumScreen title={album.title} subtitle="함께 만든 추억 앨범" headerSupplement={editionLink} headerRight={headerRight} body={publicBody} actionPanel={isParticipantMode ? undefined : publicActions} bottomNavigation={publicNav} className="public-share" />;

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
