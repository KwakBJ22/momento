import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import BrandValue from "./BrandValue";

import { BRAND_TITLE_SUFFIX } from "../lib/brand";
import { AlbumRenderer } from "../album-engine";
import ContributeWorkspace, { type WorkspaceState } from "./ContributeWorkspace";
import AlbumScreen from "./AlbumScreen";
import { downloadAlbumPdf } from "../lib/exportPdf";
import { pdfFailureMessage, pdfSuccessMessage } from "../lib/pdfNotice";
import AlbumPdfStatus from "./AlbumPdfStatus";
import AlbumGuestbook from "./AlbumGuestbook";
import AlbumMoreSheet from "./AlbumMoreSheet";
import PrintIntentCta from "./PrintIntentCta";
import { resolveAlbumRole } from "../lib/albumRole";
import { useContactCloseGuard } from "../lib/useContactCloseGuard";
import { bookmarkTroubleMessage, runAfterLogin } from "../lib/albumTrouble";
import { clearPendingBookmark, readPendingBookmark, setPendingBookmark } from "../lib/guestAlbum";
import { createPhotoMemory, getPublicShare, loadCollabSession, saveCollabSession, saveSharedAlbumBookmark, startPublicContribution, submitShareReaction, type CollabSession } from "../lib/api";
import { REACTIONS, getReactionSessionKey, markReactionPressed, readPressedReactions, type ReactionCode } from "../lib/shareReactions";
import type { GuestbookItem } from "../types";
import { createId } from "../lib/id";
import { authDebug } from "../lib/authDebug";
import type { AppUser } from "../services/authService";
import {
  appendPendingContributions,
  clearPublicShareCache,
  contributionPanelAction,
  readPublicShareCache,
  reconcilePublicShareAlbum,
  savePublicShareCache,
} from "../lib/publicShareFlow";
import type { AlbumPhoto, PublicContributionItem, PublicShareAlbum } from "../types";
import "./AlbumResult.css";
import { userFacingError } from "../lib/userFacingError";

interface PublicShareViewProps {
  token: string;
  /** The entry router already verified this public token. */
  initialAlbum?: PublicShareAlbum;
  authenticatedUser?: AppUser | null;
  /** 헤더 우측 `로그인`(비로그인 구경꾼 — SCREEN_SPEC §3). App 의 로그인 모달을 연다. */
  onLogin?: () => void;
  /** ⋯ 시트 최상단 계정 행(App 이 만든 것과 같은 노드 — §5). */
  accountSheet?: ReactNode;
  onLogout?: () => void;
  onWithdraw?: () => void;
}

function contributionGuestId(): string {
  const key = "woorialbum-public-contribution-guest-id";
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
    console.debug(`[우리앨범] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

export default function PublicShareView({ token, initialAlbum, authenticatedUser = null, onLogin, accountSheet, onLogout, onWithdraw }: PublicShareViewProps) {
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
  // 담아둔 앨범(§1 9차) — 구경꾼에게 흔적을 남기는 자리. ★ 권한은 바뀌지 않는다.
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  // 한 화면에서 두 번 시작하지 않는다(K-13 과 같은 규칙).
  const bookmarkRunningRef = useRef(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  // 구경꾼은 본문 맨 아래에서 이 구역을 만난다(§4 8차 — 네비 칸을 쓰지 않는다).
  const guestbookRef = useRef<HTMLDivElement | null>(null);
  // 헤더 ⋯ 시트 — 앨범 상세와 같은 컴포넌트를 쓴다(§5). 없으면 공유 링크로 들어온
  // 참여자가 PDF·함께한 사람에 아예 접근할 수 없다.
  const [moreOpen, setMoreOpen] = useState(false);
  // 로그인 여부 — 헤더(§3)와 ⋯ 시트(§5)가 **역할이 아니라 이 값**으로 갈린다(K-7c).
  const signedIn = Boolean(authenticatedUser);
  const { requestClose: requestCloseMore, guard: contactGuard } = useContactCloseGuard(() => setMoreOpen(false));
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // 역할은 링크의 종류가 정한다 — 백엔드가 내려준 능력만 본다(SCREEN_SPEC §1).
  // 값이 없으면(구버전 응답) 보수적으로 구경꾼으로 본다: 할 수 없는 것을 보여주는 쪽이 더 나쁘다.
  const canContribute = album?.can_contribute === true;
  // ★ 한마디는 **인쇄되지 않으므로** 잠기지 않는다(PO 2026-08-16 · `인쇄되는 것만 잠근다`).
  //   감상 링크로 온 구경꾼도, 확정된 앨범에서도 남길 수 있다. 판정은 서버가 한다.
  const canAddMemory = album?.can_add_memory === true;
  // ★ 역할 판정은 lib/albumRole 한 곳이다(§1 · H-1). 화면이 따로 추측하지 않는다 —
  // 링크 종류가 아니라 서버가 내려준 능력 플래그로 갈린다.
  const role = resolveAlbumRole(album);
  /**
   * 담아뒀는가 — **앨범 응답 하나**에서 읽는다 (K-12 · §1 25차).
   *
   * ★ 예전에는 이 값을 따로 든 state 에 베껴 뒀다. 그런데 앨범이 다시 그려질 때마다
   *   그 베낀 값이 **응답의 옛 값으로 덮였다** — 담아둔 직후에도 `담아둘까요?` 물음이
   *   그대로 돌아왔고, 사람은 안 담긴 줄 알고 또 눌렀다(실기기에서 그랬다).
   *   담고 나면 앨범 값 자체를 고친다(아래 `saveBookmark`). 근거가 하나면 어긋나지 않는다.
   *
   * 로그인했을 때만 의미가 있다 — 비로그인이면 서버가 늘 false 로 내려준다.
   */
  const bookmarked = Boolean(album?.viewer_bookmarked);

  const [nameAction, setNameAction] = useState<"photo" | "memory" | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [isStartingContribution, setIsStartingContribution] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const contributionPanelRef = useRef<HTMLElement | null>(null);
  const rendererStartedAtRef = useRef<number | null>(null);
  // Which action the user asked for while the account session was still starting,
  // read by the async start handler so the click is never lost.
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [pressedReactions, setPressedReactions] = useState<Set<ReactionCode>>(new Set());
  const reactionSessionRef = useRef<string>("");
  const [guestbook, setGuestbook] = useState<GuestbookItem[]>([]);
  // 사진 밑에서 바로 한마디 쓰기 — 앨범 화면(27fa413)과 **같은 통로**를 쓴다.
  // ★ 초대받아 처음 온 사람은 대개 이 화면으로 들어온다. 쓸 수 있는 사람에게
  //   길이 닿아야 한다(§7 권한표 · 구경꾼이 쓸 수 있는 글은 한마디와 `우리가 남긴 말`).
  const [memoryPhotoId, setMemoryPhotoId] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [savingMemoryPhotoId, setSavingMemoryPhotoId] = useState<string | null>(null);
  const [memoryWriteError, setMemoryWriteError] = useState<string | null>(null);
  /** 이름을 받고 나서 열어 줄 사진 — 이름 묻는 자리는 이 화면에 이미 있는 그것 하나다. */
  const photos = useMemo(() => mapSharePhotos(album?.photos), [album?.photos]);

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
      console.warn("[우리앨범] Public album request failed.", cause);
      const status = (cause as { status?: number } | null)?.status;
      if (status && [401, 403, 404, 410].includes(status)) clearPublicShareCache(token);
      setAlbum(null);
      setError(userFacingError(cause, "공유 앨범을 불러오지 못했어요."));
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
    // ★ 로그인했다고 바로 참여자로 만들지 않는다(§1). 아직 참여자가 아니면 로그인 여부와
    // 상관없이 **이름을 묻는 화면**으로 간다 — 아래 contributionPanelAction 이 그 자리다.
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
    // ★ 자동 참여를 하지 않는다 (SCREEN_SPEC §1). 로그인했다는 이유로 참여자를 만들지
    // 않는다 — view 링크든 contribute 링크든 같다. 참여는 언제나 사용자가 이름을 적고
    // 시작한다(/join). 묻지 않고 만들면 계정 아이디가 그대로 참여자 이름이 되고,
    // 그 이름이 참여 정체성 띠(§8)에 박힌다 — 실제로 그렇게 됐다(kbjkwak).
    //
    // 다만 **이미 참여자인 사람은 다시 묻지 않는다.** 서버가 기존 album_contributors 행을
    // viewer_contributor 로 내려주므로, 그것을 그대로 받아 참여자 화면을 연다.
    // ★ 여기서 아무것도 만들지 않는다 — 읽어서 쓰기만 한다.
    if (!album?.viewer_contributor || contributionSession || loadedToken !== token) return;
    const existing = album.viewer_contributor;
    const session = {
      albumId: album.album_id,
      contributorId: existing.contributor_id,
      guestId: existing.guest_id ?? null,
      displayName: existing.display_name,
    };
    saveCollabSession(session);
    setContributionAlbumId(session.albumId);
    setContributionSession(session);
    setParticipantName(existing.display_name);
    authDebug("ROUTE_CONTRIBUTOR", { source: "publicShare", routeRole: "participant", reason: "already_contributor", albumId: session.albumId });
  }, [album, contributionSession, loadedToken, token]);


  const startContribution = async () => {
    const displayName = (authenticatedUser?.displayName || participantName).trim();
    if ((!nameAction && !authenticatedUser) || !displayName) {
      setContributionError("참여자명을 입력해 주세요.");
      return;
    }
    setIsStartingContribution(true);
    try {
      // ★ 무엇을 하려고 이름을 적는지 함께 보낸다. 한마디면 감상 링크·확정된 앨범에서도
      //   받아 주고, 그 사람을 **참여자로 만들지 않는다**(이름만 받는다 · §1).
      const result = await startPublicContribution(
        token,
        authenticatedUser ? null : contributionGuestId(),
        displayName,
        nameAction === "memory" ? "memory" : "photo",
      );
      const session = { albumId: result.album_id, contributorId: result.contributor_id, guestId: result.guest_id, displayName: result.display_name };
      saveCollabSession(session);
      setContributionAlbumId(result.album_id);
      setContributionSession(session);
      // ★ 2026-08-16 — `사진 밑에서 시작한 한마디면 그 사진으로 돌아간다` 는 우회로를
      //   걷어냈다. 이제 사진 밑 한마디는 이 흐름으로 오지 않는다(그 자리에서 끝난다).
      //   이 자리는 하단 네비·딥링크로 들어온 길 하나만 맡는다.
      setContributionAction(nameAction ?? requestedContribution);
      setNameAction(null);
      if (authenticatedUser) authDebug("ROUTE_CONTRIBUTOR", { source: "publicShare", routeRole: "participant", reason: "account_contributor_ready", albumId: result.album_id, userId: authenticatedUser.id });
    } catch (cause) {
      console.warn("[우리앨범] Public contribution session start failed.", cause);
      setContributionError(userFacingError(cause, "참여를 시작하지 못했어요."));
    } finally {
      setIsStartingContribution(false);
    }
  };

  /**
   * 사진 밑에서 **바로** 한마디를 남긴다 — 앨범 화면과 같은 규칙이다(27fa413 · 2026-08-16 고침).
   *
   * ★ **이름을 몰라도 여기서 연다.** 예전에는 그때만 이름 묻는 자리(nameAction)로 빠져서,
   *   처음 누른 사람은 시트를 보고 그다음부터는 인라인이 됐다 — 같은 기능이 두 화면으로
   *   갈렸다. 이제 이름 칸이 **같은 자리**에 하나 더 설 뿐이다(§11).
   * ★ 이름을 받는 일 자체는 그대로다(§1 — 참여자가 되는 것은 사용자가 정한다).
   *   적지 않으면 남길 수 없고, 적어서 `남기기` 를 눌러야 시작된다.
   * ★ 새 API 를 만들지 않는다 — 지금 쓰는 startPublicContribution · createPhotoMemory 다.
   * ★ 실패해도 쓴 글을 지우지 않는다(§11).
   */
  const startMemoryHere = (photoId: string) => {
    setMemoryWriteError(null);
    setMemoryDraft("");
    setMemoryPhotoId(photoId);
  };

  const saveMemoryHere = async (photoId: string) => {
    const text = memoryDraft.trim();
    if (!text || !album) return;
    setSavingMemoryPhotoId(photoId);
    setMemoryWriteError(null);
    try {
      // 이름을 아직 모르면 여기서 받은 이름으로 시작한다 — 이 화면이 이미 쓰는 그 API 다.
      // ★ 무엇을 하려는지(`memory`)를 함께 보낸다. 한마디를 썼다고 참여자로 만들지
      //   않는다 — 이름만 받는다(48489b7 · §1).
      let session = contributionSession;
      if (!session) {
        const displayName = (authenticatedUser?.displayName || participantName).trim();
        if (!displayName) {
          setMemoryWriteError("이름을 적어 주세요.");
          setSavingMemoryPhotoId(null);
          return;
        }
        const result = await startPublicContribution(
          token,
          authenticatedUser ? null : contributionGuestId(),
          displayName,
          "memory",
        );
        session = { albumId: result.album_id, contributorId: result.contributor_id, guestId: result.guest_id, displayName: result.display_name };
        saveCollabSession(session);
        setContributionAlbumId(result.album_id);
        setContributionSession(session);
      }
      await createPhotoMemory(album.album_id, photoId, session, text);
      // 그 사진 밑 목록에만 더한다 — 앨범을 다시 읽지 않는다(§9).
      setAlbum((current) => current ? {
        ...current,
        photos: (current.photos || []).map((photo) => (
          photo.id === photoId
            ? { ...photo, comments: [...(photo.comments ?? []), { author: session.displayName || null, text }] }
            : photo
        )),
      } : current);
      setMemoryPhotoId(null);
      setMemoryDraft("");
    } catch {
      setMemoryWriteError("한마디를 남기지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSavingMemoryPhotoId(null);
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
  if (albumLoading || !album || loadedToken !== token) return <p className="notice notice--progress auth-panel__notice" role="status">앨범을 불러오는 중...</p>;
  // Empty legacy albums and memory-only Living Albums are valid responses.
  if (!Array.isArray(album.photos)) return <div className="album-result"><h2 className="album-result__title">앨범 사진을 불러오지 못했습니다.</h2><button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>다시 시도</button></div>;
  const epilogue = (album.epilogue ?? album.narrative ?? "").trim();

  // ★ 아래 publicBody 안에서 쓰므로 **먼저** 선언한다(UI 정리 4단계 A2 — 자리를 옮겼다).
  /**
   * 같은 자리가 **묻는 말**과 **담긴 상태** 둘을 겸한다 (K-12 · §1 25차).
   *
   * ★ 스스로 사라지는 알림으로 처리하지 않는다(§11). 담겼다는 사실은 화면에 남아 있어야
   *   한다 — 사라지고 나면 담겼는지 알 길이 다시 없어진다.
   * ★ `내 앨범에서 보기` 는 헤더의 `내 앨범` 과 같은 곳이다(K-7c 에서 쓴 그 주소).
   */
  const bookmarkCard = role !== "visitor" ? null : bookmarked ? (
    <div className="album-guest-save">
      <p className="album-guest-save__title">내 앨범에 담아뒀어요.</p>
      <div className="album-guest-save__actions">
        <a className="btn btn--primary" href="/my-albums">내 앨범에서 보기</a>
      </div>
    </div>
  ) : (
    <div className="album-guest-save">
      <p className="album-guest-save__title">이 앨범을 내 앨범에 담아둘까요?</p>
      <p className="album-guest-save__copy">다음에도 이 앨범을 찾을 수 있어요.</p>
      <div className="album-guest-save__actions">
        <button type="button" className="btn btn--primary" disabled={bookmarkBusy} onClick={() => void saveBookmark()}>담아두기</button>
      </div>
      {/* 끝날 때까지는 **하는 중이라고만** 말한다(§11 26차). */}
      {bookmarkBusy ? <p className="notice notice--progress" role="status">내 앨범에 담아두는 중이에요.</p> : null}
      {/* ★ 한 번 낸 말은 사용자가 없앨 때까지 남는다 — 저절로 사라지지 않는다. */}
      {bookmarkError ? (
        <p className="notice notice--error album-guest-save__error" role="alert">
          {bookmarkError}
          <button type="button" className="notice__close" onClick={() => setBookmarkError(null)} aria-label="안내 닫기">
            <X size={16} aria-hidden="true" />
          </button>
        </p>
      ) : null}
    </div>
  );
  const publicBody = (
    <>
      <div className="album-result__stage"><AlbumRenderer contributorNames={album.contributor_names ?? []} photos={photos} title={album.title} epilogue={epilogue} coverDateLabel={album.date} chapterStories={album.chapter_stories} category={album.category} templateType={album.template_type} albumId={album.album_id} coverPhotoId={album.cover_photo_id} skin={album.skin} paper={album.paper} livingAppendPages={album.living_append_pages} mode="screen" photoMemoryWrite={{ canWrite: () => requestedEdition === null && canAddMemory, writingPhotoId: memoryPhotoId, savingPhotoId: savingMemoryPhotoId, error: memoryWriteError, draft: memoryDraft, needsName: !contributionSession && !authenticatedUser, nameDraft: participantName, setNameDraft: setParticipantName, start: startMemoryHere, cancel: () => { setMemoryPhotoId(null); setMemoryWriteError(null); }, setDraft: setMemoryDraft, save: (photoId: string) => { void saveMemoryHere(photoId); } }} onReady={onAlbumRendererReady} /></div>
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
      {moreOpen ? <div className="album-sheet-dim" aria-hidden="true" onClick={requestCloseMore} /> : null}
      {/* 적다 만 연락처가 있으면 묻는다 — 조용히 버리지 않는다(§5). */}
      {contactGuard}
      {/* ★ 구경꾼 시트는 계정 행 하나뿐이다(§5 표 — 함께한 사람·PDF 모두 `—`).
          눌러서 막을 것이 아니라 처음부터 보이지 않아야 한다. 서버도 두 경로 모두
          인증 + require_album_read 를 요구한다(화면에서 감추는 것으로 끝내지 않는다). */}
      {moreOpen ? (
        <AlbumMoreSheet
          onClose={requestCloseMore}
          accountSheet={accountSheet}
          canEdit={false}
          canDelete={false}
          photoCount={(album.photos || []).length}
          contributorCount={role === "contributor" ? album.contributor_count ?? null : null}
          albumId={albumId || ""}
          onExportPdf={role === "contributor" ? () => { void handleSharePdf(); } : undefined}
          isExportingPdf={isExportingPdf}
          // 함께 만든 사람에게만 묻는다 — 구경꾼은 자기 앨범이 아니다.
          canAskPrintIntent={role !== "visitor" && Boolean(albumId)}
          showAbsentNotice={role === "contributor"}
          // ★ 로그인했으면 **자기 계정을 다루는 줄**은 역할과 무관하게 보인다
          // (K-7c · §5 22차). 예전에는 `role === "contributor"` 로 걸어서, 담아두기로
          // 로그인한 구경꾼에게 이메일 줄 아래로 아무것도 없었다 — 로그아웃할 길이
          // 없었다. 앨범 권한은 하나도 늘지 않는다: 표지·PDF·함께한 사람·새 앨범·
          // 앨범 지우기는 위 줄들에서 그대로 막혀 있다.
          onLogout={signedIn ? onLogout : undefined}
          onWithdraw={signedIn ? onWithdraw : undefined}
        />
      ) : null}
      {/* 앨범 상세와 같은 표시를 쓴다(I-3) — 시트를 닫아도 남는다. */}
      <AlbumPdfStatus
        working={isExportingPdf}
        notice={pdfNotice}
        printIntent={role !== "visitor" && albumId ? <PrintIntentCta albumId={albumId} variant="notice" /> : null}
        onDismiss={() => setPdfNotice(null)}
      />
      {/* ③ 방명록 — 공용 컴포넌트(AlbumGuestbook). 앨범 상세와 같은 구현을 쓴다.
          구역 안의 버튼은 `여기에 남기기` 다 — 사진에 다는 `이 사진에 한마디` 와
          성격이 달라 이름을 나눴다(§4·§7). */}
      <div ref={guestbookRef}>
      <AlbumGuestbook token={token} albumId={albumId || ""} initialEntries={guestbook} defaultAuthorName={participantName} />
      </div>
      {(album.pending_items || []).length ? <section className="public-share__pending" aria-label="새로 더해진 사진과 한마디"><h3>새로 더해진 사진과 한마디</h3><div className="public-share__pending-list">{(album.pending_items || []).map((item) => <article key={`${item.type}-${item.id}`} className="public-share__pending-item">{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="참여자가 추가한 사진" loading="lazy" decoding="async" /> : null}<div><p className="public-share__pending-meta">{item.author_name || item.actor_name || "익명"}<span aria-hidden="true"> · </span>{formatContributionTime(item.created_at)}</p>{item.type === "photo" && item.comment ? <p className="public-share__pending-copy">{item.comment}</p> : null}{item.type === "memory" && item.content ? <p className="public-share__pending-copy">{item.content}</p> : null}</div></article>)}</div></section> : null}
      {/* 참여 블록은 함께 만들기 링크에서만. 구경꾼에게 할 수 없는 행동을 보여주지 않는다(§1). */}
      {canContribute ? <section className="public-share__join" aria-label="앨범 참여"><p><strong>사진과 한마디를 더할 수 있어요</strong></p><div className="public-share__join-actions"><button type="button" className="upload-form__submit" disabled={isStartingContribution} onClick={() => openContribution("photo")}>사진 추가</button><button type="button" className="btn btn--secondary" disabled={isStartingContribution} onClick={() => openContribution("memory")}>한마디 쓰기</button></div>{isStartingContribution ? <p className="notice notice--progress public-share__join-status" role="status">참여를 준비하고 있어요...</p> : null}{contributionError ? <p className="notice notice--error public-share__join-error" role="alert">{contributionError}</p> : null}</section> : null}
      {nameAction ? <form ref={(node) => { contributionPanelRef.current = node; }} className="public-share__name" onSubmit={(event) => { event.preventDefault(); void startContribution(); }}><label htmlFor="public-contribution-name">참여자명을 알려주세요</label><input id="public-contribution-name" value={participantName} maxLength={40} autoComplete="name" onChange={(event) => setParticipantName(event.target.value)} /><div className="public-share__name-actions"><button type="submit" className="upload-form__submit" disabled={isStartingContribution}>{isStartingContribution ? "준비 중..." : "계속하기"}</button><button type="button" className="btn btn--ghost" disabled={isStartingContribution} onClick={() => setNameAction(null)}>취소</button></div></form> : null}
      {contributionAction && contributionAlbumId && contributionSession ? <div ref={(node) => { contributionPanelRef.current = node; }} className="public-share__contribute"><ContributeWorkspace albumId={contributionAlbumId} embedded requestedAction={contributionAction} initialWorkspace={initialWorkspace} onContributionAdded={addPendingItems} onContributionUpdated={updatePendingItem} onContributionRemoved={removePendingItem} /></div> : null}
      {/* ★ 담아두기는 **앨범이 끝난 뒤**다(UI 정리 4단계 A2). 예전에는 화면 맨 위라,
          아직 이게 뭔지도 모르는 사람에게 저장부터 권했다. 상자는 그대로고 자리만 옮겼다. */}
      {bookmarkCard}
      {/* ★ `우리앨범이란` 의 **진짜 자리다.** 초대 링크로 들어온 사람은 첫 화면도 메뉴도
          보지 않는다 — `인스타랑 뭐가 다르냐` 고 묻는 사람이 실제로 도착하는 곳이 여기다.
          앨범을 끝까지 본 뒤라 짧은 판으로 둔다. */}
      <BrandValue variant="short" />
    </>
  );
  const isParticipantMode = role === "contributor" && Boolean(contributionSession);
  const publicNav = role === "contributor" ? {
    // §4 참여자 3칸: 사진 추가 / 한마디 남기기 / 내 앨범 만들기.
    // ★ 참여 세션이 아직 없어도 **참여자는 참여자다**(H-1). 예전에는 세션 없는 갈래만
    // 변형을 주지 않아 주최자 네비(공유하기 포함)가 떴다 — 공유는 주최자만이다(§4·§5).
    // 세션 유무로 갈리는 것은 지금 눌린 칸 표시뿐이다.
    variant: "contributor" as const,
    activeItem: isParticipantMode && contributionAction === "photo" ? "photo" as const
      : isParticipantMode && contributionAction === "memory" ? "memory" as const : undefined,
    onAddPhoto: () => openContribution("photo"),
    onAddMemory: () => openContribution("memory"),
    onCreateAlbum: () => window.location.assign("/"),
    canAddPhoto: !isStartingContribution,
    canAddMemory: !isStartingContribution,
  } : {
    // 구경꾼 1칸(§4 8차): 내 앨범 만들기 하나뿐이다. `우리가 남긴 말` 은 본문 맨 아래에서
    // 스크롤로 만난다 — 앨범을 끝까지 읽고 남기는 말이라 그 자리가 자연스럽다.
    variant: "visitor" as const,
    onCreateAlbum: () => window.location.assign("/"),
  };
  /**
   * 이 앨범을 내 앨범에 담는다 (K-12 · §1).
   *
   * ★ 여기에 **빼기는 없다.** 빼는 자리는 `내 앨범` 의 담아둔 목록 하나다 —
   *   담자마자 뺄 일은 없고, 버튼이 둘이면 무엇을 누를지 생각해야 한다(§1 25차).
   */
  /**
   * 이 앨범을 내 앨범에 담는다 (K-12 · K-15 · §1).
   *
   * ★ 여기에 **빼기는 없다.** 빼는 자리는 `내 앨범` 의 담아둔 목록 하나다 —
   *   담자마자 뺄 일은 없고, 버튼이 둘이면 무엇을 누를지 생각해야 한다(§1 25차).
   * ★ 다시 해보는 방식·말할 때를 가르는 규칙은 **K-13 이 만든 한 곳**을 쓴다.
   *   게스트 저장과 같은 것이다 — 담아두기용으로 두 벌 만들지 않는다.
   */
  const runBookmark = async () => {
    if (!album) return;
    setBookmarkBusy(true);
    setBookmarkError(null);
    // ★ 담을 때는 **이 링크로** 담는다(K-7b). 서버가 링크를 함께 저장해 두고,
    // `담아둔 앨범` 에서 그 링크로 연다 — 구경꾼은 /album/{id} 로 못 연다.
    const result = await runAfterLogin(() => saveSharedAlbumBookmark(token));
    if (result.ok) {
      // 하려던 일은 **끝났을 때** 지운다(K-9 의 규칙 그대로).
      clearPendingBookmark();
      // 화면이 서버를 따라간다 — 다시 그려도 담긴 상태가 유지된다(K-12).
      setAlbum((current) => (current ? { ...current, viewer_bookmarked: true } : current));
      setBookmarkBusy(false);
      return;
    }
    // 링크가 죽었으면 다시 눌러도 소용없다 — 하려던 일을 지운다.
    if (result.status === 404 || result.status === 410) clearPendingBookmark();
    // ★ 더 해볼 것이 없을 때만 말한다(§11 26차). 끊긴 것은 실패가 아니라서
    //   위 runAfterLogin 이 이미 말없이 다시 해봤다.
    setBookmarkBusy(false);
    setBookmarkError(bookmarkTroubleMessage(result.status));
  };
  const saveBookmark = async () => {
    if (!authenticatedUser) {
      // ★ **하려던 일을 남기고** 로그인으로 보낸다(K-15 — K-9 의 장치를 그대로 쓴다).
      //   예전에는 로그인만 열려서, 돌아오면 물음이 그대로였고 한 번 더 눌러야 했다.
      setPendingBookmark(token);
      onLogin?.();
      return;
    }
    if (!album || bookmarked) return;
    await runBookmark();
  };
  /**
   * 로그인하고 돌아왔으면 **저절로 담는다** (K-15).
   *
   * 남겨 둔 것이 이 링크일 때만 이어서 한다 — 다른 앨범을 담으려던 것이면 그 화면에서
   * 이어진다. 이미 담겨 있으면 아무것도 하지 않는다.
   */
  useEffect(() => {
    if (!authenticatedUser || !album || bookmarked) return;
    if (readPendingBookmark() !== token) return;
    if (bookmarkRunningRef.current) return;
    bookmarkRunningRef.current = true;
    void runBookmark().finally(() => { bookmarkRunningRef.current = false; });
    // 앨범과 로그인 상태가 갖춰졌을 때 한 번 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticatedUser?.id, album?.album_id, bookmarked, token]);
  const publicActions = (
    <div className="album-result__actions">
      {/* ★ 여기에 `빼기` 를 두지 않는다(§1 25차). 빼는 자리는 `내 앨범` 의 담아둔 목록 하나다. */}
      <a className="btn btn--ghost" href="/">새 앨범 만들기</a>
    </div>
  );
  const editionLink = album.edition_is_latest === false ? <p className="notice notice--info album-result__edition-notice"><a href={`/s/${token}`}>최신 앨범 보기</a></p> : album.edition_previous ? <p className="notice notice--info album-result__edition-notice"><a href={`/s/${token}?edition=${album.edition_previous}`}>이전 앨범 보기</a></p> : null;
  // 공유 화면의 PDF 저장 — 앨범 상세와 같은 전달·문구 규칙을 쓴다(§11: 조용히 실패하지 않는다).
  const handleSharePdf = async () => {
    if (!album) return;
    setIsExportingPdf(true);
    setPdfNotice(null);
    try {
      const delivery = await downloadAlbumPdf({
        albumId: album.album_id,
        // ★ 0 을 보내면 서버가 409 로 막는다(버전이 앨범과 달라서). 저장이 막히면
        // 인앱 브라우저에 넘길 주소가 없어 "파일 저장이 막혀 있어요" 만 뜬다.
        albumVersion: album.album_version ?? 0,
        contributorNames: album.contributor_names ?? [],
        title: album.title,
        photos: (album.photos || []) as AlbumPhoto[],
        epilogue: album.epilogue ?? album.narrative ?? "",
        coverDateLabel: album.date,
        category: album.category,
        templateType: album.template_type,
        chapterStories: album.chapter_stories,
        coverPhotoId: album.cover_photo_id,
        livingAppendPages: album.living_append_pages,
      });
      setPdfNotice(pdfSuccessMessage(delivery));
    } catch (error) {
      setPdfNotice(pdfFailureMessage(error));
    } finally {
      setIsExportingPdf(false);
    }
  };

  // §3 — 공유 앨범의 우측: **비로그인 = `로그인` 하나 / 로그인 = `내 앨범` + `⋯`**.
  // 로그인하지 않은 사람에게 `⋯` 를 주면 시트 안에 `로그인` 하나만 있는 꼴이라(§5)
  // 두 번 누를 일이 된다. 그래서 비로그인은 `로그인` 하나다.
  //
  // ★ 로그인한 사람에게는 `내 앨범` 을 **함께** 둔다(K-7c · §3 22차). 이 화면의 하단
  //   네비는 구경꾼에게 1칸(`내 앨범 만들기`)뿐이라, 우측에 `내 앨범` 이 없으면
  //   **자기 앨범으로 돌아갈 길이 아예 없다.** F-1(담아두기)이 `로그인한 구경꾼` 을
  //   만들면서 "구경꾼 = 비로그인" 이라는 옛 전제가 깨졌는데 이 자리가 안 따라갔다.
  // ★ 판단 기준은 **역할이 아니라 로그인 여부**다. `내 앨범` 링크는 앨범 상세와 같은
  //   것(`AlbumScreen` 의 `backHref`)을 쓴다 — 새로 만들지 않는다(§13).
  const headerRight = !signedIn && onLogin
    ? <button type="button" className="app__account-login" onClick={onLogin}>로그인</button>
    : undefined;
  return <AlbumScreen title={album.title} subtitle="함께 만든 추억 앨범" headerSupplement={editionLink} headerRight={headerRight} backHref={signedIn ? "/my-albums" : undefined} onMore={signedIn ? () => setMoreOpen(true) : undefined} body={publicBody} actionPanel={isParticipantMode ? undefined : publicActions} bottomNavigation={publicNav} className="public-share" />;

  /* Legacy shell intentionally disabled: AlbumScreen above owns screen UI. */
}
