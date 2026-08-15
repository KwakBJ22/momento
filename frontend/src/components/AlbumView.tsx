import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AlbumRenderer } from "../album-engine";

/** 계정으로 가져오는 중이라 아직 못 여는 것을 얼마나 기다리는가 (아래 catch 참고). */
const CLAIM_WAIT_MS = 800;
const CLAIM_WAIT_LIMIT = 5;

import { applyContributions, createAlbumShareLink, updateAlbumPhotoLocation, deleteAlbum, getAlbum, getAlbumLivingAppendPages, getAlbumPhotos, getPendingContributions, isPublicShareUrl, loadCollabSession, patchAlbumTitle, patchChapterStory, patchEpilogue, saveAlbumPhotoCaption, saveCollabSession, startPublicContribution, type CollabSession } from "../lib/api";

import { ALBUM_PHOTO_CAPACITY, PDF_BLOCKED_MESSAGE, PDF_PHOTO_SAFE_LIMIT } from "../lib/albumLimits";
import { navVariantForRole, resolveAlbumRole } from "../lib/albumRole";
import { albumTroubleCopy, type AlbumViewTrouble } from "../lib/albumTrouble";
import { withAlbumVersion } from "../lib/albumVersion";
import { readPendingGuestClaim } from "../lib/guestAlbum";
import { downloadAlbumPdf } from "../lib/exportPdf";
import { pdfFailureMessage, pdfSuccessMessage } from "../lib/pdfNotice";

import { useSignedUrlRefresh } from "../lib/useSignedUrlRefresh";
import { useRefreshOnReturn } from "../lib/useRefreshOnReturn";


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
import { userFacingError } from "../lib/userFacingError";



interface AlbumViewProps {

  albumId: string;
  /** True when viewed by the guest that created it (not yet claimed/logged in). */
  guestOwner?: boolean;
  /** Start the save→login→claim flow. */
  onGuestSave?: () => void;
  /** ⋯ 시트 최상단 계정 행(App 이 만든 노드). 헤더 우측은 [내 앨범]+[⋯] 둘로 줄이고
   *  계정 진입점은 시트 안으로 들어간다 — 동작은 App 의 기존 것을 그대로 쓴다. */
  accountSheet?: ReactNode;
  /** 앨범을 못 열었다 — 하단 네비를 감춘다(K-11). 열지도 못하는 앨범에
   *  `사진 추가`·`한마디 쓰기`·`공유하기` 를 권하지 않는다. */
  onUnavailable?: (unavailable: boolean) => void;
  /** ⋯ 시트의 로그아웃·회원 탈퇴(§5 순서상 아래쪽). 비로그인이면 넘기지 않는다. */
  onLogout?: () => void;
  onWithdraw?: () => void;

}
/**
 * 앨범을 지우기 전 확인 문구 (§5).
 *
 * ★ 둘째 줄은 J-9 에서 더했다 — **이미 보낸 링크도 함께 사라진다.**
 *   카카오톡 메시지는 지울 수 없으므로 **지우기 전에 아는 것**이 유일한 방법이다.
 *   지우는 동작 자체는 바꾸지 않는다. 한 줄 알려줄 뿐이다.
 */
export const DELETE_ALBUM_WARNING = [
  "지운 앨범과 그 안의 사진·글은 되돌릴 수 없어요. 함께 만든 사람들이 남긴 것도 함께 사라져요.",
  "이미 보낸 링크도 함께 사라져요. 받은 분들은 더 이상 앨범을 볼 수 없어요.",
].join("\n");

export default function AlbumView({ albumId, guestOwner = false, onGuestSave, accountSheet, onUnavailable, onLogout, onWithdraw }: AlbumViewProps) {

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

  // ★ 서버가 보낸 말을 담지 않는다(K-11 · §8). **무엇이 안 됐는지**만 담고,
  //   화면에 낼 말은 아래 오류 화면이 우리 말로 고른다.
  const [error, setError] = useState<AlbumViewTrouble | null>(null);
  // 403 gets its own screen: Korean copy, and NO "다시 시도" (retrying cannot help).
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [photosReady, setPhotosReady] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [loadedAlbumId, setLoadedAlbumId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  /** 계정으로 가져오는 중이라 아직 못 여는 것을 **몇 번까지** 기다렸는가. */
  const claimWaitRef = useRef(0);
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
    try { return sessionStorage.getItem(`woorialbum-guest-save-dismissed:${albumId}`) === "1"; } catch { return false; }
  });
  const dismissGuestSave = () => {
    setGuestSaveHidden(true);
    try { sessionStorage.setItem(`woorialbum-guest-save-dismissed:${albumId}`, "1"); } catch { /* 저장 실패해도 화면은 닫힌다 */ }
  };
  // 앨범 지우기 확인 — window.confirm 을 쓰지 않는다(§11). 시트로 묻는다.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [confirmingCaptionPhotoId, setConfirmingCaptionPhotoId] = useState<string | null>(null);
  const [confirmingCaptionText, setConfirmingCaptionText] = useState("");
  const [editingStoryKey, setEditingStoryKey] = useState<string | null>(null);
  const [storyDraft, setStoryDraft] = useState("");
  const [isSavingStory, setIsSavingStory] = useState(false);
  const [storySaveError, setStorySaveError] = useState<string | null>(null);
  // 날짜 줄의 장소 — 이야기 편집과 같은 모양이다(키도 같은 날짜 키를 쓴다).
  const [editingPlaceKey, setEditingPlaceKey] = useState<string | null>(null);
  const [placeDraft, setPlaceDraft] = useState("");
  const [isSavingPlace, setIsSavingPlace] = useState(false);
  const [placeSaveError, setPlaceSaveError] = useState<string | null>(null);

  // 되살린 화면이 낡은 상태로 뜨지 않게 한다 — 그 사이 바뀐 사진·대표사진을 모른 채
  // 예전 화면이 그대로 떠 있었다. 이미 있는 새로고침 경로(retryKey)를 그대로 쓴다.
  // ★ 쓰던 글이 날아가면 안 된다. 캡션·이야기·한마디를 쓰는 중이거나 참여 시트가
  //   열려 있으면 다시 읽지 않는다 — 이 작업에서 가장 위험한 자리다.
  useRefreshOnReturn(
    () => setRetryKey((value) => value + 1),
    Boolean(editingPhotoId) || isEditingEpilogue || Boolean(editingStoryKey)
      || Boolean(activeAction) || deleteConfirmOpen || Boolean(confirmingCaptionPhotoId),
  );


  // 앨범을 못 열면 하단 네비를 감춘다(K-11). 매 렌더 새로 만들어지는 콜백이라
  // ref 로 들고 있는다 — 이것 때문에 아래 효과가 다시 돌지 않게 한다.
  const notifyUnavailableRef = useRef(onUnavailable);
  notifyUnavailableRef.current = onUnavailable;
  useEffect(() => {
    notifyUnavailableRef.current?.(error === "load");
    return () => notifyUnavailableRef.current?.(false);
  }, [error]);

  // 방명록 토큰 확보(1회). 실패해도 앨범 열람에는 영향이 없다 — 구역만 렌더링되지 않는다.
  useEffect(() => {
    if (!album || requestedEdition !== null) return;
    // ★ 여기서 공유 링크를 **새로 만들지 않는다.** 예전에는 resolvePublicShareUrl 이
    //   링크가 없으면 POST /share-links 로 하나 발급했다 — 앨범을 여는 것만으로
    //   서버에 쓰기가 일어났다. 방명록은 이미 공유한 앨범에서만 의미가 있으므로,
    //   앨범 응답에 실려 온 주소가 있을 때만 토큰을 뽑는다. 없으면 그냥 두고,
    //   `구경하라고 보내기` 를 누르는 순간 발급된다(resolvePublicShareUrl 는 그대로다).
    const shared = album.share_url;
    if (!isPublicShareUrl(shared)) return;
    const token = new URL(shared, window.location.origin).pathname.match(/^\/s\/([^/]+)$/)?.[1];
    if (token) setGuestbookToken(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album?.album_id, requestedEdition]);

  // 함께 만든 사람 수 — ★ **요청을 따로 보내지 않는다.**
  //
  // 예전에는 이 숫자 하나 때문에 `/collaboration` 을 또 불렀다. 그런데 같은 화면의
  // 참여 패널이 그것을 이미 부르고 있어서, 앨범을 열 때마다 **같은 요청이 두 번**
  // 나갔다(운영 로그 08-13 07:04:28 에 258ms · 370ms 두 줄). 하나는 신호를 달고
  // 하나는 안 달아서 중복 제거에도 걸리지 않았다.
  //
  // 이 숫자는 앨범 응답의 `contributor_names` 로 이미 와 있다. 백엔드가 그 이름들을
  // **세는 규칙과 같은 자리**에서 모으므로(collaboration_service.list_active_contributor_names)
  // 길이가 곧 사람 수다 — 오히려 "3명이라 써 놓고 두 명만 적히는" 어긋남이 없어진다.
  useEffect(() => {
    if (!album?.can_edit) { setContributorCount(null); return; }
    const names = album.contributor_names;
    setContributorCount(Array.isArray(names) ? names.length : null);
  }, [album?.can_edit, album?.contributor_names]);

  useEffect(() => {
    // Keep a shared in-flight request alive across React StrictMode's
    // development remount. Aborting it would make the second subscriber reuse
    // the same rejected request and falsely show an album loading error.
    let active = true;
    // ★ **이미 보여준 앨범은 지우지 않는다** (PO 2026-08-13).
    //   화면으로 돌아오면 60초 규칙에 따라 다시 읽는데(useRefreshOnReturn), 예전에는
    //   읽기를 시작하면서 보고 있던 것을 먼저 비웠다. 돌아오는 순간은 하필 토큰이
    //   갱신되는 중이거나 웹뷰가 네트워크를 막 되살린 참이라 그 한 번이 실패하기
    //   쉽고, 그러면 멀쩡히 보던 앨범이 `이 앨범을 열 수 없어요` 로 바뀌었다.
    //   `다시 시도` 를 누르면 그때는 성공한다 — 즉 **실패가 아니라 잠깐 어긋난 것**이다.
    //   그래서 다시 읽기는 뒤에서 조용히 하고, 화면은 그대로 둔다.
    const refreshingSameAlbum = loadedAlbumId === loadedKey;
    if (!refreshingSameAlbum) {
      setPhotosReady(false);
      setLivingAppendPages([]);
      setLoadedAlbumId(null);
      setPublicShareUrl("");
    }
    setError(null);
    setErrorStatus(null);

    void Promise.all([
      getAlbum(albumId, requestedEdition),
      getAlbumPhotos(albumId, requestedEdition),
    ])
      .then(([albumData, photoData]) => {
        if (!active) return;
        if (!Array.isArray(photoData)) {
          setError("load");
          return;
        }
        setAlbum(albumData);
        setPhotos(photoData);
        setLoadedAlbumId(loadedKey);
        setPhotosReady(true);
      })
      .catch((err) => {
        if (!active) return;
        // ★ 서버가 보낸 말은 **기록에만** 남긴다(K-11 · §8). 화면에는 우리 말을 낸다 —
        //   실기기에서 `You do not have permission to view this album.` 이 그대로 보였다.
        console.error("Album load failed", { albumId, cause: err });
        const status = err instanceof Error ? ((err as Error & { status?: number }).status ?? null) : null;

        // 🔴 게스트가 `저장하기` 로 로그인하고 돌아온 **바로 그 순간**은 아직 앨범이
        //   내 것이 아니다. 계정으로 가져오는 일(claim, K-9)이 이 화면과 나란히 도는데
        //   먼저 도착한 앨범 요청이 403 을 받는다 — 사용자에게는 `이 앨범을 열 수 없어요`
        //   가 뜨고, `다시 시도` 를 누르면 그 사이 claim 이 끝나 있어서 그냥 열린다.
        //   **실패가 아니라 아직 안 끝난 것이다. 그러니 실패라고 말하지 않는다.**
        //   기다림의 끝은 `대기 중인 claim` 이 사라지는 것이고, 그것이 성공의 표시다.
        //   ★ 무한히 기다리지 않는다 — 진짜 권한 없음이 영영 안 보이면 안 된다.
        // ★ 이미 보여주고 있던 앨범이면 **오류 화면으로 바꾸지 않는다.** 사용자는
        //   보던 것을 계속 본다. 다음에 돌아올 때 다시 읽는다.
        if (refreshingSameAlbum) return;

        const claiming = readPendingGuestClaim() === albumId;
        if (claiming && (status === 403 || status === 404) && claimWaitRef.current < CLAIM_WAIT_LIMIT) {
          claimWaitRef.current += 1;
          window.setTimeout(() => { if (active) setRetryKey((key) => key + 1); }, CLAIM_WAIT_MS);
          return;
        }
        setError("load");
        setErrorStatus(status);
      });

    return () => { active = false; };
  }, [albumId, loadedKey, requestedEdition, retryKey]);

  useEffect(() => {
    // ★ 사진을 기다리지 않는다. 이 요청에 필요한 것은 `album` 뿐인데 예전에는
    //   photosReady 까지 기다려서, 사진 요청이 끝난 **뒤에야** 출발했다 —
    //   두 요청이 줄을 서느라 화면이 그만큼 늦게 찼다. 이제 나란히 나간다.
    if (!album) return;
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
  }, [album, albumId, requestedEdition]);

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
      // ★ 저장하면 앨범 버전이 올라간다 — 안 옮기면 PDF 가 409 를 맞는다(K-6).
      setAlbum((current) => current ? withAlbumVersion(current, saved) : current);
      handleCancelPhotoCommentEdit();
    } catch (cause) {
      setPhotoCommentSaveError(userFacingError(cause, "사진에 남긴 한 줄을 고치지 못했어요."));
    } finally {
      setIsSavingPhotoComment(false);
    }
  };

  const handleSaveEpilogue = async () => {
    setIsSavingEpilogue(true);
    try {
      const updated = await patchEpilogue(albumId, epilogueDraft);
      setAlbum((current) => current ? withAlbumVersion({
        ...current,
        epilogue: updated.epilogue ?? updated.narrative,
        narrative: updated.narrative,
      }, updated) : current);
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
      setAlbum((current) => current ? withAlbumVersion({ ...current, chapter_stories: updated.chapter_stories }, updated) : current);
      setEditingStoryKey(null);
      setStoryDraft("");
    } catch (cause) {
      setStorySaveError(userFacingError(cause, "이야기를 저장하지 못했어요."));
    } finally {
      setIsSavingStory(false);
    }
  };

  /**
   * 그 날짜 묶음의 **사진 전부**에 같은 장소를 넣는다.
   *
   * ★ 사진 한 장씩 고치게 하면 같은 날 같은 곳인데 사진마다 다른 이름이 붙는다.
   * ★ location_source 는 "user" 다 — 사람이 고친 것을 다음 업로드가 덮어쓰지 않는다.
   * ★ 비우고 저장하면 지워진다. 서버가 빈 이름을 받으면 source 를 "unknown" 으로
   *   두므로(album.py) 화면에서도 장소 줄이 사라진다. 지우는 길을 따로 만들지 않는다.
   */
  const handleSavePlace = async (photoIds: string[]) => {
    setIsSavingPlace(true);
    setPlaceSaveError(null);
    const name = placeDraft.trim();
    try {
      const updated = await Promise.all(
        photoIds.map((photoId) => updateAlbumPhotoLocation(albumId, photoId, {
          location_name: name || null,
          location_source: name ? "user" : "unknown",
        })),
      );
      const byId = new Map(updated.map((photo) => [photo.id, photo]));
      setPhotos((current) => current.map((photo) => {
        const next = byId.get(photo.id);
        return next ? { ...photo, location_name: next.location_name, location_source: next.location_source } : photo;
      }));
      setEditingPlaceKey(null);
      setPlaceDraft("");
    } catch (cause) {
      // ★ 서버·SDK 가 준 말을 그대로 내지 않는다(§11).
      setPlaceSaveError(userFacingError(cause, "장소를 저장하지 못했어요. 다시 시도해 주세요."));
    } finally {
      setIsSavingPlace(false);
    }
  };

  const handleSaveTitle = async (next: string): Promise<string> => {
    if (!album) throw new Error("앨범을 불러오지 못했어요.");
    const updated = await patchAlbumTitle(albumId, next.trim());
    setAlbum((current) => current ? withAlbumVersion({ ...current, title: updated.title }, updated) : current);
    return updated.title;
  };

  /**
   * `앨범 다시 구성하기` — 사진 배치와 이야기를 새로 짠다 (주최자만 · 더보기 시트).
   *
   * ★ 새 API 를 만들지 않는다. 없어진 시트가 쓰던 apply-contributions 를
   *   mode="edition" 으로 그대로 부른다. 고르는 화면이 없으므로 **아직 안 붙은 것
   *   전부**를 넘긴다 — 이미 붙은 것은 서버가 base 로 들고 있다.
   */
  const rebuildEdition = async () => {
    setIsRebuilding(true);
    setPdfNotice(null);
    try {
      const pending = await getPendingContributions(albumId);
      await applyContributions(
        albumId,
        pending.items.filter((item) => item.type === "photo").map((item) => item.id),
        pending.items.filter((item) => item.type === "memory").map((item) => item.id),
        "edition",
      );
      setRetryKey((value) => value + 1);
    } catch (cause) {
      setPdfNotice(userFacingError(cause, "앨범을 다시 구성하지 못했어요. 잠시 후 다시 시도해 주세요."));
    } finally {
      setIsRebuilding(false);
    }
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
      console.error("Album delete failed", { albumId, cause });
      setError("delete");
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
      setActionError(userFacingError(cause, "참여 화면을 열지 못했습니다."));
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
    window.addEventListener("woorialbum:album-action", onAction);
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("woorialbum:album-action", onAction); window.removeEventListener("popstate", onPopState); };
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
    const { title, description, canRetry } = albumTroubleCopy(error, errorStatus);
    return (
      <div className="album-page">
        <div className="album-page__layout">
          <article className="album-page__book album-result">
            <h2 className="album-result__title">{title}</h2>
            <p className="album-result__subtitle">{description}</p>
            {canRetry ? (
              <button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>
                다시 시도
              </button>
            ) : null}
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
          description={DELETE_ALBUM_WARNING}
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
          onRebuildEdition={() => { void rebuildEdition(); }}
          isRebuilding={isRebuilding}
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
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      <div className="album-result__stage album-result__stage--web" ref={stageRef}>
        <AlbumRenderer contributorNames={displayAlbum?.contributor_names ?? []} photos={photos} title={displayTitle} epilogue={isEditingEpilogue ? "" : epilogue} coverDateLabel={displayAlbum?.date} chapterStories={chapterStories} category={category} templateType={templateType} albumId={displayAlbum?.album_id ?? albumId} coverPhotoId={displayAlbum?.cover_photo_id} livingAppendPages={livingAppendPages} mode="screen" onEditEpilogue={canEdit && hasEpilogue ? () => { setEpilogueDraft(epilogueText); setIsEditingEpilogue(true); } : undefined} photoCommentEdit={{ ...captionEdit, editingPhotoId, savingPhotoId: isSavingPhotoComment ? editingPhotoId : null, error: photoCommentSaveError, draft: photoCommentDraft, startEdit: handleStartPhotoCommentEdit, cancelEdit: handleCancelPhotoCommentEdit, setDraft: setPhotoCommentDraft, saveEdit: (photoId: string) => { if (editingPhotoId === photoId) void handleSavePhotoComment(); } }} dateStoryEdit={canEdit ? { canEdit: true, editingKey: editingStoryKey, savingKey: isSavingStory ? editingStoryKey : null, error: storySaveError, draft: storyDraft, startEdit: (key: string, text: string) => { setStorySaveError(null); setEditingStoryKey(key); setStoryDraft(text); }, cancelEdit: () => { setStorySaveError(null); setEditingStoryKey(null); setStoryDraft(""); }, setDraft: setStoryDraft, saveEdit: (key: string) => { if (editingStoryKey === key) void handleSaveStory(key); } } : null} placeEdit={canEdit ? { canEdit: true, editingKey: editingPlaceKey, savingKey: isSavingPlace ? editingPlaceKey : null, error: placeSaveError, draft: placeDraft, startEdit: (key: string, text: string) => { setPlaceSaveError(null); setEditingPlaceKey(key); setPlaceDraft(text); }, cancelEdit: () => { setPlaceSaveError(null); setEditingPlaceKey(null); setPlaceDraft(""); }, setDraft: setPlaceDraft, saveEdit: (key: string, photoIds: string[]) => { if (editingPlaceKey === key) void handleSavePlace(photoIds); } } : null} />
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
    // ★ J-11: 넘길 것이 없으면 **null 을 넘긴다.** 빈 조각(<></>)은 값이 있는 것으로
    //   쳐서, 참여자 화면에서 속이 빈 테두리 상자만 그려졌다(실측 44.8px · 자식 0).
    //   이 패널은 주최자 기능이라 참여자에게는 보여줄 것 자체가 없다 — 자리도 만들지 않는다.
    requestedEdition === null && displayAlbum?.can_edit ? <CollaborationPanel key={`collab-${collabRefreshKey}`} coverPickerRequest={coverPickerRequest} hideDuplicatedActions albumId={albumId} imageUrl={resolveShareImageUrl(displayAlbum)} photos={photos} coverPhotoId={displayAlbum?.cover_photo_id} onOpenParticipants={() => { window.location.assign(`/album/${albumId}/participants`); }} onAlbumUpdated={() => setRetryKey((value) => value + 1)} onCoverUpdated={(coverPhotoId, coverImageUrl) => { setAlbum((current) => current ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current); }} /> : null
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
        <p>설명이 없는 사진이 {myEmptyCaptionPhotos.length}장 있어요.</p>
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
  return <AlbumScreen title={displayTitle} subtitle={participation ? `사진 ${photos.length}장 · 함께한 사람 ${participation.contributor_count}명` : `사진 ${photos.length}장${contributorCount !== null ? ` · 함께 만든 사람 ${contributorCount}명` : ""}`} canEditTitle={canEdit} onSaveTitle={canEdit ? handleSaveTitle : undefined} headerSupplement={headerExtras} preHeader={whoamiBand ?? guestSaveCard} onMore={() => setMoreOpen(true)} body={albumBody} actionPanel={albumActions} bottomNavigation={{ variant: navVariantForRole(role), onAddPhoto: () => { void openContribution("photo"); }, onAddMemory: () => void openContribution("memory"), onShare: () => setShareOpen(true), onCreateAlbum: () => window.location.assign("/"), canAddPhoto: !guestOwner && requestedEdition === null, canAddMemory: !guestOwner && requestedEdition === null }} backHref={guestOwner ? "/" : "/my-albums"} backLabel={guestOwner ? "처음으로" : "내 앨범"} />;

  /* Legacy shell intentionally disabled: AlbumScreen above owns screen UI. */

}
