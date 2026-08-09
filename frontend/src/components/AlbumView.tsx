import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AlbumRenderer } from "../album-engine";

import { createAlbumShareLink, deleteAlbum, getAlbum, getAlbumLivingAppendPages, getAlbumPhotos, getCollaborationStatus, isPublicShareUrl, loadCollabSession, patchAlbumTitle, patchChapterStory, patchEpilogue, saveAlbumPhotoCaption, saveCollabSession, startPublicContribution, type CollabSession } from "../lib/api";

import { ALBUM_PHOTO_CAPACITY, PDF_BLOCKED_MESSAGE, PDF_PHOTO_SAFE_LIMIT } from "../lib/albumLimits";
import { navVariantForRole, resolveAlbumRole } from "../lib/albumRole";
import { downloadAlbumPdf } from "../lib/exportPdf";
import { pdfFailureMessage, pdfSuccessMessage } from "../lib/pdfNotice";

import { useSignedUrlRefresh } from "../lib/useSignedUrlRefresh";


import CollaborationPanel from "./CollaborationPanel";
import AlbumShareSheet from "./AlbumShareSheet";
import AlbumPdfStatus from "./AlbumPdfStatus";
import ContributeWorkspace, { type WorkspaceState } from "./ContributeWorkspace";
import AlbumScreen from "./AlbumScreen";
import AlbumGuestbook from "./AlbumGuestbook";
import AlbumMoreSheet from "./AlbumMoreSheet";
import { useContactCloseGuard } from "../lib/useContactCloseGuard";
import ConfirmSheet from "./ConfirmSheet";

import type { AlbumPhoto, AlbumResult } from "../types";

import { visibleChapterStories } from "../lib/storyRules";
import { resolveShareImageUrl } from "../lib/shareImage";
import { roParticle } from "../lib/participantBanner";

import "./AlbumResult.css";



interface AlbumViewProps {

  albumId: string;
  /** True when viewed by the guest that created it (not yet claimed/logged in). */
  guestOwner?: boolean;
  /** Start the save→login→claim flow. */
  onGuestSave?: () => void;
  /** ⋯ 시트 최상단 계정 행(App 이 만든 노드). 헤더 우측은 [내 앨범]+[⋯] 둘로 줄이고
   *  계정 진입점은 시트 안으로 들어간다 — 동작은 App 의 기존 것을 그대로 쓴다. */
  accountSheet?: ReactNode;
  /** ⋯ 시트의 로그아웃·회원 탈퇴(§5 순서상 아래쪽). 비로그인이면 넘기지 않는다. */
  onLogout?: () => void;
  onWithdraw?: () => void;

}
export default function AlbumView({ albumId, guestOwner = false, onGuestSave, accountSheet, onLogout, onWithdraw }: AlbumViewProps) {

  const editionValue = new URLSearchParams(window.location.search).get("edition");
  const requestedEdition = editionValue && /^\d+$/.test(editionValue) ? Number(editionValue) : null;
  const loadedKey = `${albumId}:${requestedEdition ?? "latest"}`;

  const [album, setAlbum] = useState<AlbumResult | null>(null);

  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [livingAppendPages, setLivingAppendPages] = useState<import("../types").LivingAppendPage[]>([]);
  // Recover expired signed URLs: on the first album-photo load error, refetch the
  // list once and swap in fresh URLs (no AlbumRenderer remount). See signedUrlRefresh.
  const stageRef = useRef<HTMLDivElement | null>(null);
  useSignedUrlRefresh(albumId, requestedEdition, setPhotos, stageRef);

  const [error, setError] = useState<string | null>(null);
  // 403 gets its own screen: Korean copy, and NO "다시 시도" (retrying cannot help).
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [photosReady, setPhotosReady] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [loadedAlbumId, setLoadedAlbumId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Bumped when the contribution sheet closes: remounts CollaborationPanel only, so
  // its mount-time status fetch ("새로운 추억 N개") reflects what was just added.
  const [collabRefreshKey, setCollabRefreshKey] = useState(0);
  // 헤더 "더보기" 시트 + 표지 사진 바꾸기 신호(CollaborationPanel 의 기존 픽커를 연다).
  const [moreOpen, setMoreOpen] = useState(false);
  const { requestClose: requestCloseMore, guard: contactGuard } = useContactCloseGuard(() => setMoreOpen(false));
  const [coverPickerRequest, setCoverPickerRequest] = useState(0);
  // 공유하기 시트(목업 화면 2): 하단 네비 공유하기가 바로 카카오를 부르지 않고 이 시트를 연다.
  const [shareOpen, setShareOpen] = useState(false);
  // ③ 방명록: 앨범 본문 밖 별도 구역. 공유 화면의 기존 구현·API(/s/<token>)를 그대로
  // 재사용하므로 토큰이 필요하다 — 하단 네비 "한마디 쓰기"가 이 구역을 연다.
  const [guestbookToken, setGuestbookToken] = useState<string | null>(null);
  // 제목 아래 메타 "사진 N장 · 함께 만든 사람 M명"과 공유 시트의 참여 인원.
  const [contributorCount, setContributorCount] = useState<number | null>(null);
  const [publicShareUrl, setPublicShareUrl] = useState("");
  const [activeAction, setActiveAction] = useState<"photo" | "memory" | null>(null);
  const [contributionSession, setContributionSession] = useState<CollabSession | null>(() => loadCollabSession(albumId));
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // PDF 결과 안내 — 성공도 실패도 여기 한 곳에 뜬다(조용히 끝나지 않는다).
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [isEditingEpilogue, setIsEditingEpilogue] = useState(false);
  const [epilogueDraft, setEpilogueDraft] = useState("");
  const [isSavingEpilogue, setIsSavingEpilogue] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [photoCommentDraft, setPhotoCommentDraft] = useState("");
  const [isSavingPhotoComment, setIsSavingPhotoComment] = useState(false);
  const [photoCommentSaveError, setPhotoCommentSaveError] = useState<string | null>(null);
  // 남의 사진 캡션을 열기 전 확인 단계(§7). window.confirm 을 쓰지 않는다 — 웹뷰에서 막힌다.
  // 게스트 주최자의 저장 안내(§1). 앨범이 막 만들어진 직후 한 번 크게 보여주고, 닫아도
  // 하단 CTA 로 언제든 다시 찾을 수 있다 — 이 진입점을 잃으면 사용자가 앨범을 잃는다.
  const [guestSaveHidden, setGuestSaveHidden] = useState(() => {
    try { return sessionStorage.getItem(`momento-guest-save-dismissed:${albumId}`) === "1"; } catch { return false; }
  });
  const dismissGuestSave = () => {
    setGuestSaveHidden(true);
    try { sessionStorage.setItem(`momento-guest-save-dismissed:${albumId}`, "1"); } catch { /* 저장 실패해도 화면은 닫힌다 */ }
  };
  // 앨범 지우기 확인 — window.confirm 을 쓰지 않는다(§11). 시트로 묻는다.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [confirmingCaptionPhotoId, setConfirmingCaptionPhotoId] = useState<string | null>(null);
  const [confirmingCaptionText, setConfirmingCaptionText] = useState("");
  const [editingStoryKey, setEditingStoryKey] = useState<string | null>(null);
  const [storyDraft, setStoryDraft] = useState("");
  const [isSavingStory, setIsSavingStory] = useState(false);
  const [storySaveError, setStorySaveError] = useState<string | null>(null);


  // 방명록 토큰 확보(1회). 실패해도 앨범 열람에는 영향이 없다 — 구역만 렌더링되지 않는다.
  useEffect(() => {
    if (!album || requestedEdition !== null) return;
    let active = true;
    void resolvePublicShareUrl()
      .then((url) => {
        const token = new URL(url, window.location.origin).pathname.match(/^\/s\/([^/]+)$/)?.[1];
        if (active && token) setGuestbookToken(token);
      })
      .catch(() => undefined);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album?.album_id, requestedEdition]);

  // 함께 만든 사람 수: 소유자만 조회(참여자는 상태 API 권한이 없을 수 있음). 실패해도 조용히 생략.
  useEffect(() => {
    if (!album?.can_edit) return;
    let active = true;
    void getCollaborationStatus(albumId)
      .then((status) => { if (active) setContributorCount(status?.contributor_count ?? null); })
      .catch(() => { if (active) setContributorCount(null); });
    return () => { active = false; };
  }, [album?.can_edit, albumId, collabRefreshKey]);

  useEffect(() => {
    // Keep a shared in-flight request alive across React StrictMode's
    // development remount. Aborting it would make the second subscriber reuse
    // the same rejected request and falsely show an album loading error.
    let active = true;
    setPhotosReady(false);
    setLivingAppendPages([]);
    setError(null);
    setErrorStatus(null);
    setLoadedAlbumId(null);
    setPublicShareUrl("");

    void Promise.all([
      getAlbum(albumId, requestedEdition),
      getAlbumPhotos(albumId, requestedEdition),
    ])
      .then(([albumData, photoData]) => {
        if (!active) return;
        if (!Array.isArray(photoData)) {
          setError("앨범 사진을 불러오지 못했습니다.");
          return;
        }
        setAlbum(albumData);
        setPhotos(photoData);
        setLoadedAlbumId(loadedKey);
        setPhotosReady(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "앨범을 불러오지 못했어요.");
        setErrorStatus(err instanceof Error ? ((err as Error & { status?: number }).status ?? null) : null);
      });

    return () => { active = false; };
  }, [albumId, loadedKey, requestedEdition, retryKey]);

  useEffect(() => {
    if (!photosReady || !album) return;
    const pageCount =
      album.current_edition?.living_append_page_count ??
      album.living_append_pages?.length ??
      0;
    if (pageCount <= 0) {
      setLivingAppendPages([]);
      return;
    }
    let active = true;
    void getAlbumLivingAppendPages(albumId, requestedEdition)
      .then((pages) => {
        if (active) setLivingAppendPages(pages);
      })
      .catch(() => {
        if (active) setLivingAppendPages([]);
      });
    return () => { active = false; };
  }, [album, albumId, photosReady, requestedEdition]);

  const chapterStories = useMemo(
    () => visibleChapterStories(album?.chapter_stories, photos),
    [album?.chapter_stories, photos],
  );

  const epilogueText = (album?.epilogue ?? album?.narrative ?? "").trim();
  const hasEpilogue = Boolean(epilogueText);

  const handleStartPhotoCommentEdit = (photoId: string, comment: string) => {
    setPhotoCommentSaveError(null);
    setEditingPhotoId(photoId);
    setPhotoCommentDraft(comment);
  };

  const handleCancelPhotoCommentEdit = () => {
    setPhotoCommentSaveError(null);
    setEditingPhotoId(null);
    setPhotoCommentDraft("");
  };

  const handleSavePhotoComment = async () => {
    const photo = photos.find((item) => item.id === editingPhotoId);
    if (!photo || !editingPhotoId) return;
    setIsSavingPhotoComment(true);
    setPhotoCommentSaveError(null);
    try {
      const saved = await saveAlbumPhotoCaption(albumId, editingPhotoId, photoCommentDraft);
      // ★ 화면이 읽는 필드는 caption 이다. 예전에는 comment 에 넣어서, 저장이 됐더라도
      // 방금 적은 글이 화면에 나타나지 않았다(같은 결함의 두 번째 얼굴).
      setPhotos((current) =>
        current.map((item) =>
          item.id === saved.id ? { ...item, caption: saved.caption } : item,
        ),
      );
      handleCancelPhotoCommentEdit();
    } catch (cause) {
      setPhotoCommentSaveError(cause instanceof Error ? cause.message : "사진에 남긴 한 줄을 고치지 못했어요.");
    } finally {
      setIsSavingPhotoComment(false);
    }
  };

  const handleSaveEpilogue = async () => {
    setIsSavingEpilogue(true);
    try {
      const updated = await patchEpilogue(albumId, epilogueDraft);
      setAlbum((current) => current ? {
        ...current,
        epilogue: updated.epilogue ?? updated.narrative,
        narrative: updated.narrative,
      } : current);
      setIsEditingEpilogue(false);
    } finally {
      setIsSavingEpilogue(false);
    }
  };

  const handleSaveStory = async (storyKey: string) => {
    setIsSavingStory(true);
    setStorySaveError(null);
    try {
      // Partial merge only (no AlbumRenderer remount): visibleChapterStories recomputes
      // from the new chapter_stories, exactly like the epilogue save path.
      const updated = await patchChapterStory(albumId, storyKey, storyDraft);
      setAlbum((current) => current ? { ...current, chapter_stories: updated.chapter_stories } : current);
      setEditingStoryKey(null);
      setStoryDraft("");
    } catch (cause) {
      setStorySaveError(cause instanceof Error ? cause.message : "이야기를 저장하지 못했어요.");
    } finally {
      setIsSavingStory(false);
    }
  };

  const handleSaveTitle = async (next: string): Promise<string> => {
    if (!album) throw new Error("앨범을 불러오지 못했어요.");
    const updated = await patchAlbumTitle(albumId, next.trim());
    setAlbum((current) => current ? { ...current, title: updated.title } : current);
    return updated.title;
  };

  const handlePdf = async () => {

    if (!album) return;
    const source = album;

    setIsExportingPdf(true);
    setPdfNotice(null);

    try {

      const delivery = await downloadAlbumPdf({

        albumId: source.album_id,

        albumVersion: source.album_version ?? 0,
        contributorNames: source.contributor_names ?? [],

        title: source.title,

        photos,

        epilogue: source.epilogue ?? source.narrative ?? "",

        coverDateLabel: source.date,

        category: source.category,

        templateType: source.template_type,
        chapterStories: visibleChapterStories(source.chapter_stories, photos),
        coverPhotoId: source.cover_photo_id,
        livingAppendPages,

      });
      setPdfNotice(pdfSuccessMessage(delivery));

    } catch (error) {

      // 실패를 삼키지 않는다 — 이유를 그대로 화면에 띄운다(AlbumResult 와 같은 문구).
      setPdfNotice(pdfFailureMessage(error));

    } finally {

      setIsExportingPdf(false);

    }

  };



  const handleDeleteAlbum = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    try {
      await deleteAlbum(albumId);
      window.location.assign("/my-albums");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "앨범을 삭제하지 못했어요.");
      setIsDeleting(false);
      deletingRef.current = false;
    }
  };



  const resolvePublicShareUrl = async (): Promise<string> => {

    if (!album) throw new Error("앨범을 불러오는 중입니다.");

    if (isPublicShareUrl(publicShareUrl)) return publicShareUrl;

    if (isPublicShareUrl(album.share_url)) {

      setPublicShareUrl(album.share_url);

      return album.share_url;

    }

    // 이 화면의 공유 링크는 "구경하라고 보내기"다 — 감상 전용으로 발급한다.
    // 함께 만들기는 별도 초대 링크(/join/…, ensureAlbumInviteUrl)를 쓴다.
    const share = await createAlbumShareLink(album.album_id, "view");

    setPublicShareUrl(share.share_url);

    return share.share_url;

  };


  const activateContribution = (action: "photo" | "memory") => {
    setActiveAction(action);
    const next = new URL(window.location.href);
    next.searchParams.set("action", action);
    window.history.pushState({}, "", next);
    // Bring the just-opened participation panel into view (it renders inline below).
    requestAnimationFrame(() => document.querySelector(".album-inline-action")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openContribution = async (action: "photo" | "memory") => {
    if (actionLoading) return;
    setActionError(null);
    // Second+ open: a stored session needs no share token, so this path stays fully
    // synchronous (no await) — the user gesture survives and the photo sheet's
    // auto file-picker open actually fires (iOS Safari drops clicks after an async gap).
    const existingSession = contributionSession ?? loadCollabSession(albumId);
    if (existingSession) {
      if (!contributionSession) setContributionSession(existingSession);
      activateContribution(action);
      return;
    }
    setActionLoading(true);
    try {
      const shareUrl = await resolvePublicShareUrl();
      const token = new URL(shareUrl, window.location.origin).pathname.match(/^\/s\/([^/]+)$/)?.[1];
      if (!token) throw new Error("공유 링크를 준비하지 못했습니다.");
      const started = await startPublicContribution(token, null, "앨범지기");
      const session = { albumId: started.album_id, contributorId: started.contributor_id, guestId: started.guest_id, displayName: started.display_name };
      saveCollabSession(session);
      setContributionSession(session);
      activateContribution(action);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "참여 화면을 열지 못했습니다.");
    } finally {
      setActionLoading(false);
    }
  };
  const closeContribution = () => {
    setActiveAction(null);
    setActionError(null);
    const next = new URL(window.location.href);
    next.searchParams.delete("action");
    window.history.replaceState({}, "", next);
    // Partial refresh so what was just contributed shows up behind the sheet.
    // setPhotos/setAlbum flow through props (no photosReady toggle, no retryKey), so
    // AlbumRenderer reconciles in place — it is NOT remounted (CLAUDE.md §9).
    void getAlbumPhotos(albumId, requestedEdition)
      .then((photoData) => { if (Array.isArray(photoData)) setPhotos(photoData); })
      .catch(() => {});
    void getAlbum(albumId, requestedEdition).then(setAlbum).catch(() => {});
    // The "새로운 추억 N개" summary lives inside CollaborationPanel, which fetches on
    // mount only — remount just the panel (cheap; §9 only protects AlbumRenderer).
    setCollabRefreshKey((value) => value + 1);
  };

  // While the contribution sheet is open, the album behind it must not scroll.
  // iOS Safari ignores body overflow:hidden for touch scrolling, so pin the body
  // with position:fixed at the current offset and restore that exact offset on
  // unlock — a jumped scroll position would be worse than the leak.
  const sheetOpen = Boolean(activeAction && contributionSession) || moreOpen || shareOpen;
  useEffect(() => {
    if (!sheetOpen) return;
    const scrollY = window.scrollY;
    const { style } = document.body;
    const previous = { position: style.position, top: style.top, width: style.width };
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.width = "100%";
    return () => {
      style.position = previous.position;
      style.top = previous.top;
      style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, [sheetOpen]);

  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "photo" || action === "memory") void openContribution(action);
      // ★ 딥링크도 예외가 아니다(I-2) — 카카오로 바로 가지 않고 같은 시트를 연다.
      if (action === "share") setShareOpen(true);
      if (action === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const onPopState = () => {
      const action = new URLSearchParams(window.location.search).get("action");
      setActiveAction(action === "photo" || action === "memory" ? action : null);
    };
    window.addEventListener("momento:album-action", onAction);
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("momento:album-action", onAction); window.removeEventListener("popstate", onPopState); };
  });

  // ★ 다른 화면에서 `한마디 쓰기` 로 넘어온 경우(`?action=memory`)에도 같은 것이 열린다.
  // 예전에는 popstate 때만 읽어서, 주소로 처음 들어오면 아무 일도 일어나지 않았다(J-7).
  useEffect(() => {
    const action = new URLSearchParams(window.location.search).get("action");
    if (action === "photo" || action === "memory") void openContribution(action);
    // 앨범이 바뀔 때만 다시 본다. openContribution 은 매 렌더 새로 만들어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  if (error) {

    return (

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result">

            <h2 className="album-result__title">{errorStatus === 403 ? "이 앨범을 볼 수 없어요" : "앨범을 찾을 수 없어요"}</h2>

            <p className="album-result__subtitle">{errorStatus === 403 ? "앨범을 볼 수 있는 권한이 없어요. 앨범 주인이 보내 준 링크로 다시 열어 주세요." : error}</p>

            {errorStatus === 403 ? null : <button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>

              다시 시도

            </button>}

            <a className="btn btn--secondary" href="/">

              새 앨범 만들기

            </a>

          </article>

        </div>

      </div>

    );

  }



  if (!photosReady || loadedAlbumId !== loadedKey) {

    return (

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result album-result--skeleton">

            <p className="album-result__subtitle">앨범을 불러오는 중...</p>

            <div className="album-result__skeleton-stage loading-shimmer" aria-hidden="true" />

          </article>

        </div>

      </div>

    );

  }



  const displayAlbum = album;
  const displayTitle = displayAlbum?.title ?? "우리의 추억";
  const epilogue = (displayAlbum?.epilogue ?? displayAlbum?.narrative ?? "").trim();
  const templateType = displayAlbum?.template_type;
  const category = displayAlbum?.category;
  const canEdit = requestedEdition === null && displayAlbum?.can_edit === true;
  // 참여자 여부(목업 3a): viewer_participation 은 서버가 참여자에게만 내려준다.
  // 더보기 시트·네비·메타·whoami 띠가 모두 이 값으로 분기한다.
  const participation = displayAlbum?.viewer_participation ?? null;
  // ★ 역할은 여기 한 곳에서 정한다(§1 · H-1). 화면마다 다시 추측하지 않는다.
  // viewer_participation 은 역할의 근거가 아니다 — `내가 더한 것` 숫자와 이름 띠의 재료다.
  const role = resolveAlbumRole(displayAlbum);

  const contributionWorkspace: WorkspaceState = {
    title: displayTitle,
    photo_count: photos.length,
    photo_limit: ALBUM_PHOTO_CAPACITY,
    photos: photos.map((photo) => ({ id: photo.id, thumbnail_url: photo.thumbnail_url, original_url: photo.original_url, memories: [] })),
  };
  // 캡션 권한은 사진마다 백엔드가 내려준다(can_edit_caption). 화면은 그것만 본다 —
  // 주최자는 모든 사진, 참여자는 자기가 올린 사진(SCREEN_SPEC §7).
  //
  // ★ 훅(useMemo)을 쓰지 않는다. 이 자리는 위쪽 early return(로딩·오류 화면) 뒤라서
  // 훅을 두면 렌더마다 훅 개수가 달라진다 — React #310("Rendered more hooks than during
  // the previous render")로 앨범이 흰 화면이 된다. 실제로 그렇게 깨졌다.
  // Map 생성은 사진 수십~백 장 규모에서 무시할 수 있는 비용이라 매 렌더 만든다.
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const captionEdit = {
    canEditPhoto: (photoId: string) => photoById.get(photoId)?.can_edit_caption === true,
    authorNameOf: (photoId: string) => photoById.get(photoId)?.caption_author_name ?? null,
    requestEdit: (photoId: string, text: string) => {
      // 남이 올린 사진이면 한 번 묻고, 내 사진이면 바로 연다.
      if (photoById.get(photoId)?.caption_author_name) {
        setConfirmingCaptionPhotoId(photoId);
        setConfirmingCaptionText(text);
        return;
      }
      handleStartPhotoCommentEdit(photoId, text);
    },
    confirmingPhotoId: confirmingCaptionPhotoId,
    confirmEdit: (photoId: string) => {
      setConfirmingCaptionPhotoId(null);
      handleStartPhotoCommentEdit(photoId, confirmingCaptionText);
    },
    cancelConfirm: () => { setConfirmingCaptionPhotoId(null); setConfirmingCaptionText(""); },
  };

  const albumBody = (
    <>
      {activeAction && contributionSession ? <section className="album-inline-action" aria-label={activeAction === "photo" ? "사진 추가" : "한마디 쓰기"}><div className="album-inline-action__header"><h2>{activeAction === "photo" ? "사진 추가" : "한마디 쓰기"}</h2><button type="button" onClick={closeContribution}>닫기</button></div><div className="album-inline-action__body"><ContributeWorkspace albumId={albumId} embedded requestedAction={activeAction} initialWorkspace={contributionWorkspace} /></div></section> : null}
      {actionError ? <p className="notice notice--error album-inline-action__error" role="alert">{actionError}</p> : null}
      {/* ★ 시트를 닫아도 남는다(I-3). 진행 표시가 시트 안 버튼 라벨뿐이라, 누르는 순간
          시트와 함께 사라졌다 — 완료까지 화면에 아무 변화가 없었다. */}
      <AlbumPdfStatus working={isExportingPdf} notice={pdfNotice} onDismiss={() => setPdfNotice(null)} />
      {deleteConfirmOpen ? (
        <ConfirmSheet
          title="이 앨범을 지울까요?"
          description="지운 앨범과 그 안의 사진·글은 되돌릴 수 없어요. 함께 만든 사람들이 남긴 것도 함께 사라져요."
          confirmLabel="앨범 지우기"
          danger
          busy={isDeleting}
          onConfirm={() => { setDeleteConfirmOpen(false); void handleDeleteAlbum(); }}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      ) : null}
      {moreOpen ? <div className="album-sheet-dim" aria-hidden="true" onClick={requestCloseMore} /> : null}
      {/* 적다 만 연락처가 있으면 묻는다 — 조용히 버리지 않는다(§5). */}
      {contactGuard}
      {moreOpen ? (
        <AlbumMoreSheet
          onClose={requestCloseMore}
          accountSheet={accountSheet}
          canEdit={role === "owner"}
          canDelete={role === "owner" && Boolean(displayAlbum?.can_delete)}
          photoCount={photos.length}
          contributorCount={role === "owner" ? contributorCount : role === "contributor" ? participation?.contributor_count ?? null : null}
          albumId={albumId}
          onChangeCover={() => setCoverPickerRequest((value) => value + 1)}
          onExportPdf={() => { void handlePdf(); }}
          isExportingPdf={isExportingPdf}
          onDeleteAlbum={() => setDeleteConfirmOpen(true)}
          isDeleting={isDeleting}
          showAbsentNotice={role === "contributor"}
          onLogout={onLogout}
          onWithdraw={onWithdraw}
        />
      ) : null}
      {/* 진입점이 몇 개든 열리는 것은 공용 시트 하나다(I-2 · §5).
          ★ 주최자에게만 — 역할 판정은 resolveAlbumRole 한 곳이다(H-1). */}
      {shareOpen && role === "owner" ? (
        <AlbumShareSheet
          albumId={albumId}
          imageUrl={resolveShareImageUrl(displayAlbum)}
          resolveViewUrl={resolvePublicShareUrl}
          viewDescription={epilogueText}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      <div className="album-result__stage album-result__stage--web" ref={stageRef}>
        <AlbumRenderer contributorNames={displayAlbum?.contributor_names ?? []} photos={photos} title={displayTitle} epilogue={isEditingEpilogue ? "" : epilogue} coverDateLabel={displayAlbum?.date} chapterStories={chapterStories} category={category} templateType={templateType} albumId={displayAlbum?.album_id ?? albumId} coverPhotoId={displayAlbum?.cover_photo_id} livingAppendPages={livingAppendPages} mode="screen" onEditEpilogue={canEdit && hasEpilogue ? () => { setEpilogueDraft(epilogueText); setIsEditingEpilogue(true); } : undefined} photoCommentEdit={{ ...captionEdit, editingPhotoId, savingPhotoId: isSavingPhotoComment ? editingPhotoId : null, error: photoCommentSaveError, draft: photoCommentDraft, startEdit: handleStartPhotoCommentEdit, cancelEdit: handleCancelPhotoCommentEdit, setDraft: setPhotoCommentDraft, saveEdit: (photoId: string) => { if (editingPhotoId === photoId) void handleSavePhotoComment(); } }} dateStoryEdit={canEdit ? { canEdit: true, editingKey: editingStoryKey, savingKey: isSavingStory ? editingStoryKey : null, error: storySaveError, draft: storyDraft, startEdit: (key: string, text: string) => { setStorySaveError(null); setEditingStoryKey(key); setStoryDraft(text); }, cancelEdit: () => { setStorySaveError(null); setEditingStoryKey(null); setStoryDraft(""); }, setDraft: setStoryDraft, saveEdit: (key: string) => { if (editingStoryKey === key) void handleSaveStory(key); } } : null} />
      </div>
      {isEditingEpilogue ? <section className="album-result__narrative album-result__epilogue"><div className="album-result__narrative-head"><h3>우리의 이야기</h3><button type="button" className="link-btn" onClick={() => void handleSaveEpilogue()} disabled={isSavingEpilogue}>{isSavingEpilogue ? "저장 중..." : "완료"}</button></div><textarea className="album-result__editor" value={epilogueDraft} onChange={(event) => setEpilogueDraft(event.target.value)} rows={6} maxLength={800} autoFocus /></section> : null}
      {!isEditingEpilogue && canEdit && !hasEpilogue ? <div className="album-result__epilogue-actions album-result__epilogue-actions--alone"><button type="button" className="link-btn" onClick={() => { setEpilogueDraft(""); setIsEditingEpilogue(true); }}>우리의 이야기 쓰기</button></div> : null}
      {/* ③ 방명록 — 앨범 본문(AlbumRenderer) 밖의 별도 구역이다. 웹/공유 화면에만
          나오고 PDF·인쇄에는 들어가지 않는다(§6 본문 구조 불변). */}
      {guestbookToken ? <div><AlbumGuestbook token={guestbookToken} albumId={albumId} defaultAuthorName={displayAlbum?.viewer_participation?.display_name || ""} /></div> : null}
    </>
  );
  // A guest owner sees a save-first bar: sharing/deleting/collaboration all imply an
  // account, so we lead them to "저장하기" (login → claim). PDF stays (client-side).
  const albumActions = guestOwner ? (
    <div className="album-result__actions">
      {/* 닫아도 남는 진입점(§1) — 큰 안내를 닫은 뒤에도 여기서 저장할 수 있다. */}
      <button type="button" className="btn btn--primary" onClick={() => onGuestSave?.()}>내 앨범으로 저장하기</button>
      <div className="album-result__hinted-action"><button type="button" className="btn btn--ghost" onClick={() => void handlePdf()} disabled={isExportingPdf || !album || photos.length > PDF_PHOTO_SAFE_LIMIT}>{isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}</button>{photos.length > PDF_PHOTO_SAFE_LIMIT ? <p className="album-result__action-hint">{PDF_BLOCKED_MESSAGE}</p> : null}</div>
    </div>
  ) : (
    // 목업 2a: 앨범 하단에 버튼 열을 두지 않는다 — 공유·PDF·삭제는 공유하기/더보기
    // 시트가 담당(중복 제거). CollaborationPanel 은 시트에 없는 고유 기능
    // (새로운 추억 반영·참여 중단·참여 현황)과 대표사진 픽커 모달만 남긴다.
    <>{requestedEdition === null && displayAlbum?.can_edit ? <CollaborationPanel key={`collab-${collabRefreshKey}`} coverPickerRequest={coverPickerRequest} hideDuplicatedActions albumId={albumId} imageUrl={resolveShareImageUrl(displayAlbum)} title={displayTitle} photos={photos} coverPhotoId={displayAlbum?.cover_photo_id} onOpenParticipants={() => { window.location.assign(`/album/${albumId}/participants`); }} onAlbumUpdated={() => setRetryKey((value) => value + 1)} onCoverUpdated={(coverPhotoId, coverImageUrl) => { setAlbum((current) => current ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current); }} /> : null}</>
  );
  // ★ 더할 수 없게 됐으면 **왜 그런지 한 줄** 알려준다 (J-8 · §11).
  // 아무 설명 없이 버튼만 사라지면 고장으로 보인다. 이유는 백엔드가 판정해 내려준다 —
  // 프런트가 따로 추측하지 않는다. 이미 남긴 사진과 한마디는 그대로 보인다.
  const contributionClosedNotice = displayAlbum && !displayAlbum.can_contribute && displayAlbum.contribution_block_reason
    ? <p className="notice notice--info album-contribution-closed">{displayAlbum.contribution_block_reason}</p>
    : null;
  const editionLinks = requestedEdition !== null ? <p className="album-result__subtitle"><a href={`/album/${albumId}`}>최신 앨범 보기</a>{displayAlbum?.edition_previous !== null && displayAlbum?.edition_previous !== undefined ? <> · <a href={`/album/${albumId}?edition=${displayAlbum.edition_previous}`}>이전 앨범 보기</a></> : null}</p> : null;
  // 미완성 안내(목업 docs/mockups/album-detail-owner.html): 한마디(캡션) 없는 사진 수.
  // 0장이면 렌더링하지 않고, "채우러 가기"는 기존 한마디 쓰기 시트(한마디 남기기)를 연다.
  // 시트를 못 여는 상황(게스트 소유자·과거 에디션)에서는 안내도 띄우지 않는다.
  // ★ **내가 올린 사진 중** 캡션이 빈 것만 센다(§9). 캡션은 자기가 올린 사진에만 쓰는
  // 것이라(§7), 남의 사진까지 세면 채울 수 없는 것을 채우라고 하는 셈이다.
  // (주최자는 남의 캡션도 고칠 수 있지만 그건 인쇄물을 다듬는 일이지 "내가 적을 말" 이 아니다.)
  const myEmptyCaptionPhotos = photos.filter((photo) => photo.is_mine && !(photo.caption || "").trim());
  // `채우러 가기` 는 내가 올린 빈 사진 중 첫 장으로 가서 그 자리에서 캡션을 연다.
  const goToFirstEmptyCaption = () => {
    const target = myEmptyCaptionPhotos[0];
    if (!target) return;
    document.querySelector(`[data-photo-id="${target.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    handleStartPhotoCommentEdit(target.id, "");
  };
  const captionNotice = myEmptyCaptionPhotos.length > 0 && !guestOwner && requestedEdition === null ? (
    <div className="album-caption-notice">
      <span className="album-caption-notice__dot" aria-hidden="true" />
      <div className="album-caption-notice__body">
        {/* `한마디`·`캡션` 이라는 말을 쓰지 않는다 — 앞은 다른 계층의 이름이고,
            뒤는 외래어라 한 번 더 생각하게 만든다(§7·§9). */}
        <p>아직 아무 말도 적지 않은 사진이 {myEmptyCaptionPhotos.length}장 있어요.</p>
        <p className="album-caption-notice__sub">한 줄만 적어도 앨범이 훨씬 풍성해져요.</p>
        <button type="button" className="album-caption-notice__link" onClick={goToFirstEmptyCaption}>채우러 가기</button>
      </div>
    </div>
  ) : null;
  // §1 저장 안내 — 명령이 아니라 물음이다. "로그인하세요"·"가입하세요"라고 쓰지 않는다:
  // 사용자는 로그인을 하고 싶은 게 아니라 앨범을 잃고 싶지 않은 것이다. 얻는 것을 말한다.
  const guestSaveCard = guestOwner && !guestSaveHidden ? (
    <div className="album-guest-save">
      <p className="album-guest-save__title">이 앨범을 내 앨범으로 저장할까요?</p>
      <p className="album-guest-save__copy">저장해 두면 다음에도 이 앨범을 찾을 수 있어요.</p>
      <div className="album-guest-save__actions">
        <button type="button" className="btn btn--primary" onClick={() => onGuestSave?.()}>저장하기</button>
        <button type="button" className="album-guest-save__close" onClick={dismissGuestSave}>나중에</button>
      </div>
    </div>
  ) : null;

  const whoamiBand = participation ? (
    <div className="album-whoami">
      <span className="album-whoami__face" aria-hidden="true">{((participation.display_name || "함")[0])}</span>
      <p>
        <span className="album-whoami__lead">
          {displayAlbum?.owner_display_name
            ? <><b>{displayAlbum.owner_display_name}</b>님이 만든 앨범에</>
            : <>‘<b>{displayTitle}</b>’에</>}
        </span>
        {(() => {
          const name = (participation.display_name || "").trim();
          if (!name) return <>함께하고 있어요</>;
          const relationship = (participation.relationship || "").trim();
          return <>{relationship ? `${relationship} ` : ""}<b>{name}</b>{roParticle(name)} 함께하고 있어요</>;
        })()}
      </p>
    </div>
  ) : null;
  const mineCard = participation ? (
    <div className="album-mine">
      <div>
        <p className="album-mine__title">내가 더한 것</p>
        {/* 모아보기 화면이 없으므로 버튼을 두지 않는다 — 숫자만. */}
        <p className="album-mine__count">사진 {participation.photo_count}장 · 한마디 {participation.memory_count}개</p>
        {/* 아직 아무것도 안 한 사람에게만 한 줄(§9). `남겨주세요` 가 아니라 `남겨도 좋아요` —
            부탁이 아니라 권유다. 하나라도 남기면 사라진다. */}
        {participation.photo_count === 0 && participation.memory_count === 0 ? (
          <p className="album-mine__nudge">마음에 드는 사진에 한마디만 남겨도 좋아요.</p>
        ) : null}
      </div>
    </div>
  ) : null;
  const headerExtras = editionLinks || contributionClosedNotice || captionNotice || mineCard ? <>{editionLinks}{contributionClosedNotice}{captionNotice}{mineCard}</> : undefined;
  return <AlbumScreen title={displayTitle} subtitle={participation ? `사진 ${photos.length}장 · 함께한 사람 ${participation.contributor_count}명` : `사진 ${photos.length}장${contributorCount !== null ? ` · 함께 만든 사람 ${contributorCount}명` : ""}`} canEditTitle={canEdit} onSaveTitle={canEdit ? handleSaveTitle : undefined} headerSupplement={headerExtras} preHeader={whoamiBand ?? guestSaveCard} onMore={() => setMoreOpen(true)} body={albumBody} actionPanel={albumActions} bottomNavigation={{ variant: navVariantForRole(role), onTop: () => window.scrollTo({ top: 0, behavior: "smooth" }), onAddPhoto: () => { void openContribution("photo"); }, onAddMemory: () => void openContribution("memory"), onShare: () => setShareOpen(true), onCreateAlbum: () => window.location.assign("/"), canAddPhoto: !guestOwner && requestedEdition === null, canAddMemory: !guestOwner && requestedEdition === null }} backHref={guestOwner ? "/" : "/my-albums"} backLabel={guestOwner ? "처음으로" : "내 앨범"} />;

  /* Legacy shell intentionally disabled: AlbumScreen above owns screen UI. */

}
