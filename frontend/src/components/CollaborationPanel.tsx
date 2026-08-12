import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  applyContributions,
  closeCollaborationAlbum,
  getCollaborationStatus,
  getPendingContributions,
  createAlbumShareLink,
  isPublicShareUrl,
  updateAlbumCoverPhoto,
  type PendingContributionItem,
} from "../lib/api";
import AlbumShareSheet from "./AlbumShareSheet";
import { forgetInviteUrl, storeInviteUrl } from "../lib/albumInvite";
import { authDebug } from "../lib/authDebug";
import { updatePublicShareCoverCache } from "../lib/publicShareFlow";
import { isRequestAborted } from "../lib/requestAbort";
import type { AlbumPhoto } from "../types";
import "./CollaborationPanel.css";

type CollaborationStatus = {
  can_edit_settings: boolean;
  collaboration_enabled: boolean;
  collaboration_status: string;
  photo_count: number;
  photo_limit: number;
  contributor_count: number;
  memory_count: number;
  visitor_count?: number;
};

type Participation = NonNullable<Awaited<ReturnType<typeof getCollaborationStatus>>["participation"]>;
type LivingMode = "append_page" | "edition";

interface CollaborationPanelProps {
  albumId: string;
  shareUrl?: string | null;
  imageUrl?: string | null;
  photos?: AlbumPhoto[];
  coverPhotoId?: string | null;
  onAlbumUpdated?: () => void;
  onCoverUpdated?: (coverPhotoId: string | null, coverImageUrl: string | null) => void;
  onOpenParticipants?: () => void;
  /** 0보다 큰 값으로 바뀔 때마다 기존 대표사진 픽커를 연다(헤더 더보기 시트의
   *  "표지 사진 바꾸기"). 픽커 소유는 이 패널 그대로 — 구조 변경 없음. */
  coverPickerRequest?: number;
  /** 목업 2a 화면에서는 초대·링크 복사·대표사진 변경이 공유하기/더보기 시트로
   *  옮겨졌다 — 중복 노출을 막기 위해 그 컨트롤만 숨긴다(새로운 추억 반영·
   *  참여 중단·참여 현황·픽커 모달은 유지). */
  hideDuplicatedActions?: boolean;
}

const shareUrlStorageKey = (albumId: string) => `woorialbum-collaboration-share-url:${albumId}`;
function readStoredShareUrl(albumId: string): string | null {
  try {
    const key = shareUrlStorageKey(albumId);
    const durable = localStorage.getItem(key);
    if (isPublicShareUrl(durable)) return durable;
    const temporary = sessionStorage.getItem(key);
    return isPublicShareUrl(temporary) ? temporary : null;
  } catch {
    return null;
  }
}

function shareToken(url: string | null): string | null {
  try {
    const parts = new URL(url || "", window.location.origin).pathname.split("/");
    const index = parts.lastIndexOf("s");
    return index >= 0 ? parts[index + 1] || null : null;
  } catch {
    return null;
  }
}

export default function CollaborationPanel({
  albumId, shareUrl: initialShareUrl, imageUrl, photos = [], coverPhotoId,
  onAlbumUpdated, onCoverUpdated, onOpenParticipants, coverPickerRequest = 0, hideDuplicatedActions = false,
}: CollaborationPanelProps) {
  const [status, setStatus] = useState<CollaborationStatus | null>(null);
  const [participation, setParticipation] = useState<Participation | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(() => (
    isPublicShareUrl(initialShareUrl) ? initialShareUrl || null : readStoredShareUrl(albumId)
  ));
  const [statusLoading, setStatusLoading] = useState(true);
  const [busy, setBusy] = useState<"apply" | "stop" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof getPendingContributions>> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [livingMode, setLivingMode] = useState<LivingMode>("append_page");
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // 헤더 더보기 시트의 "표지 사진 바꾸기": 신호가 올 때마다 픽커를 연다.
  useEffect(() => {
    if (coverPickerRequest > 0 && photos.length) setCoverPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverPickerRequest]);
  const [selectedCoverId, setSelectedCoverId] = useState<string | null>(coverPhotoId || null);
  const [savingCover, setSavingCover] = useState(false);
  const refreshRequestId = useRef(0);
  const retryControllerRef = useRef<AbortController | null>(null);
  const coverReturnFocusRef = useRef<HTMLElement | null>(null);

  const rememberShareUrl = useCallback((url: string | null) => {
    setShareUrl(url);
    try {
      const key = shareUrlStorageKey(albumId);
      if (url) {
        sessionStorage.setItem(key, url);
        localStorage.setItem(key, url);
      } else {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      }
    } catch { /* private WebViews can reject storage */ }
  }, [albumId]);

  /** 초대 링크 발급은 공유 시트가 한다(lib/albumInvite). 여기서는 참여를 중단할 때
   *  저장된 링크를 지우는 일만 남는다 — 같은 저장 키를 쓴다. */
  const rememberInviteUrl = useCallback((url: string | null) => {
    if (url) storeInviteUrl(albumId, url); else forgetInviteUrl(albumId);
  }, [albumId]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!albumId) return;
    const requestId = ++refreshRequestId.current;
    setStatusLoading(true);
    try {
      const payload = await getCollaborationStatus(albumId, signal);
      if (signal?.aborted || requestId !== refreshRequestId.current) return;
      setStatus(payload);
      setParticipation(payload.participation ?? null);
      // ★ 참여가 끝난 앨범이면 이 기기에 남아 있는 초대 링크도 버린다(J-8).
      // 중단은 서버에서 초대를 죽이지만(deactivate_invites) 이 기기의 사본은 남는다.
      // 다른 기기에서 중단했다면 여기 저장본이 **죽은 링크**로 남아, `함께 만들자고
      // 보내기` 가 그 링크를 그대로 내보내고 앨범은 닫힌 채로 남는다.
      // 버려 두면 다음에 보낼 때 새로 발급되고, 발급이 곧 다시 여는 일이다.
      if (payload.collaboration_status === "closed") forgetInviteUrl(albumId);
      setError(null);
    } catch (cause) {
      if (isRequestAborted(cause, signal) || requestId !== refreshRequestId.current) return;
      setError("참여 현황을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      if (!signal?.aborted && requestId === refreshRequestId.current) setStatusLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      controller.abort();
      retryControllerRef.current?.abort();
      retryControllerRef.current = null;
    };
  }, [refresh]);
  const retryRefresh = useCallback(() => {
    retryControllerRef.current?.abort();
    const controller = new AbortController();
    retryControllerRef.current = controller;
    void refresh(controller.signal);
  }, [refresh]);
  useEffect(() => {
    if (isPublicShareUrl(initialShareUrl)) rememberShareUrl(initialShareUrl || null);
  }, [initialShareUrl, rememberShareUrl]);
  /**
   * 픽커를 **열 때** 지금 대표사진으로 맞춘다 (그때 한 번뿐이다).
   *
   * ★ 예전에는 `[coverPhotoId, photos]` 를 보고 맞췄다. `photos` 는 배열이라 앨범을 다시
   *   받을 때마다(사진 새로고침·캡션 저장·서명 URL 갱신) **내용이 같아도 새 배열**이 되고,
   *   그때마다 이 효과가 다시 돌아 **사용자가 방금 고른 사진을 지금 대표사진으로 되돌렸다.**
   *   그래서 저장을 눌러도 바뀐 적이 없는 값이 나갔다(개발 DB cover_photo_changed 0건).
   *   고른 뒤 저장까지 사이에 앨범이 한 번만 다시 그려져도 그렇게 된다.
   * ★ 여는 순간에 읽으므로 앨범이 늦게 도착해도 그때의 최신 값이 들어온다.
   *   열려 있는 동안에는 다시 건드리지 않는다 — 고른 것을 지켜야 한다.
   */
  useEffect(() => {
    if (!coverPickerOpen) return;
    setSelectedCoverId(coverPhotoId || photos[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverPickerOpen]);
  useEffect(() => {
    if (!coverPickerOpen) return;
    coverReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCoverPickerOpen(false);
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".collab-panel__cover-grid .is-selected")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => coverReturnFocusRef.current?.focus());
    };
  }, [coverPickerOpen]);

  /** 구경용(/s/) 링크 — 공유 시트가 쓴다. 이미 가진 값이 있으면 그대로 쓴다. */
  const ensurePublicShareUrl = useCallback(async () => {
    if (isPublicShareUrl(shareUrl)) return shareUrl || "";
    const created = await createAlbumShareLink(albumId, "view");
    rememberShareUrl(created.share_url);
    return created.share_url;
  }, [albumId, shareUrl, rememberShareUrl]);

  const stop = async () => {
    setBusy("stop"); setMessage(null); setError(null);
    try {
      await closeCollaborationAlbum(albumId);
      rememberInviteUrl(null);
      // ★ 사실대로 말한다(J-8 · §11). 링크 문제가 아니다 — 이미 참여 중인 사람까지
      // 전부 막힌다. 되돌릴 수 있는지 확인하고 적었다: 새 초대를 발급하면
      // `start_collaboration` 이 다시 `collecting` 으로 돌린다.
      setMessage("참여를 마쳤어요. 이제 아무도 사진과 한마디를 더할 수 없어요. 다시 받고 싶으면 `함께 만들자고 보내기`로 새로 초대하면 돼요.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "참여 중단에 실패했어요. 다시 시도해 주세요.");
    } finally { setBusy(null); }
  };

  const openLivingPicker = async () => {
    setBusy("apply"); setError(null);
    try {
      const next = await getPendingContributions(albumId);
      if (!next.items.length) {
        setMessage("새로 더해진 사진과 한마디가 없어요.");
        await refresh();
        return;
      }
      setPending(next);
      setSelectedIds(new Set(next.items.map((item) => item.id)));
      setLivingMode(next.recommended_mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "새로 더해진 사진과 한마디을 불러오지 못했습니다.");
    } finally { setBusy(null); }
  };

  const applySelected = async () => {
    if (!pending) return;
    const selected = pending.items.filter((item) => selectedIds.has(item.id));
    const photoIds = selected.filter((item) => item.type === "photo").map((item) => item.id);
    const memoryIds = selected.filter((item) => item.type === "memory").map((item) => item.id);
    if (!photoIds.length && !memoryIds.length) return;
    setBusy("apply"); setError(null);
    try {
      const result = await applyContributions(albumId, photoIds, memoryIds, livingMode);
      if (result.mode === "append_page" && result.append_page_id) {
        try { sessionStorage.setItem(`woorialbum-living-focus:${albumId}`, result.append_page_id); } catch { /* noop */ }
        setMessage("새로 더해진 사진과 한마디를 담았어요.");
      } else {
        setMessage("새로 더해진 것까지 담은 앨범입니다.");
      }
      setPending(null); setSelectedIds(new Set());
      await refresh();
      onAlbumUpdated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "앨범에 담지 못했어요. 다시 시도해 주세요.");
    } finally { setBusy(null); }
  };

  const saveCover = async () => {
    // ★ 고를 것이 없으면 **말한다.** 예전에는 여기서 조용히 끝나서, 저장을 눌러도
    //   시트가 그대로 있고 아무 말도 없었다(§11 — 못 끝낸 일을 조용히 두지 않는다).
    if (!selectedCoverId) {
      setError("대표사진으로 쓸 사진을 먼저 골라 주세요.");
      return;
    }
    setSavingCover(true); setError(null);
    try {
      const updated = await updateAlbumCoverPhoto(albumId, selectedCoverId);
      const token = shareToken(shareUrl);
      if (token) updatePublicShareCoverCache(token, updated.cover_photo_id, updated.cover_image_url);
      onCoverUpdated?.(updated.cover_photo_id, updated.cover_image_url);
      setCoverPickerOpen(false);
      setMessage("대표사진을 변경했습니다.");
    } catch (cause) {
      // ★ 화면 문구는 우리 말 그대로 두고(26차 — 서버 문구를 그대로 내지 않는다),
      //   **왜 실패했는지는 버리지 않는다.** 예전에는 catch 가 이유를 통째로 삼켜서
      //   무엇이 막았는지 나중에 알 길이 없었다.
      authDebug("COVER_PHOTO_SAVE_FAILED", {
        albumId,
        endpoint: `/api/albums/${albumId}/cover-photo`,
        errorName: cause instanceof Error ? cause.name : typeof cause,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      setError("대표사진을 변경하지 못했습니다. 다시 시도해 주세요.");
    } finally { setSavingCover(false); }
  };

  const started = status ? status.collaboration_enabled && !["draft", "closed"].includes(status.collaboration_status) : false;
  const canManage = status?.can_edit_settings ?? false;
  const newPhotos = participation?.new_photo_count ?? 0;
  const newMemories = participation?.new_memory_count ?? 0;
  const hasNew = newPhotos + newMemories > 0;
  const recommendsEdition = participation?.recommended_mode === "edition";

  return <section className="collab-panel">
    {/* ★ 이름은 `참여 현황` 이다(§5). 예전 이름 `함께 만들기` 는 초대 패널의 이름인데
        초대 버튼은 하단 `공유하기` 로 옮겼다 — 이름과 내용이 맞지 않았다.
        초대를 여기로 되살리지 않는다. 진입점이 한 곳이어야 중복이 안 생긴다. */}
    <div><h3 className="collab-panel__title">참여 현황</h3><p className="collab-panel__copy">이 앨범에 함께 더해진 것들이에요.</p></div>

    {statusLoading ? (
      <div className="collab-panel__loading" aria-busy="true">
        <p className="collab-panel__loading-hint">새로 더해진 사진과 한마디를 확인하고 있어요.</p>
        <div className="collab-panel__skeleton-lines">
          <span className="loading-shimmer" /><span className="loading-shimmer" /><span className="loading-shimmer" />
        </div>
      </div>
    ) : !status ? (
      <div className="collab-panel__error-block">
        <p className="notice notice--error collab-panel__error" role="alert">{error || "참여 현황을 불러오지 못했습니다."}</p>
        <button type="button" onClick={retryRefresh}>다시 시도</button>
      </div>
    ) : (
      <>
        {/* ★ 여기서 카카오를 바로 열지 않는다(I-2 · §5). 무엇을 보내는지 고르지 않고
            나가면 되돌릴 수 없다 — 다른 자리와 **같은 공유 시트**를 연다. */}
        {canManage && !hideDuplicatedActions ? <><div className="collab-panel__share-actions"><button type="button" className="collab-panel__invite-primary" disabled={busy !== null} onClick={() => setShareOpen(true)}>공유하기</button></div><p className="collab-panel__invite-hint">함께 만들자고 · 구경하라고 · 링크 복사 중에서 고를 수 있어요</p></> : null}
        {started && canManage ? <>
          <div className="collab-panel__new-summary"><strong>새로 더해진 것</strong><p>{hasNew ? `새로운 사진 ${newPhotos}장과 한마디 ${newMemories}개가 도착했습니다.` : "새로 더해진 사진과 한마디가 없어요."}</p></div>
          {hasNew ? <button type="button" className="collab-panel__primary" disabled={busy !== null} onClick={() => void openLivingPicker()}>{busy === "apply" ? "사진을 앨범에 담는 중..." : recommendsEdition ? "새로운 에디션 만들기" : "마지막 페이지에 추가하기"}</button> : null}
          <button type="button" className="collab-panel__stop" disabled={busy !== null} onClick={() => void stop()}>{busy === "stop" ? "중단하는 중..." : "참여 중단"}</button>
        </> : null}
        {canManage && (status.visitor_count ?? 0) > 0 ? <p className="collab-panel__visitors">✨ 지금까지 <strong>{status.visitor_count}</strong>명이 다녀갔어요.</p> : null}
        <div className="collab-panel__status" aria-label="참여 현황"><strong>참여 현황</strong><button type="button" className="collab-panel__participant-link" onClick={onOpenParticipants} disabled={!onOpenParticipants}>참여자 {participation?.participants.length ?? status.contributor_count}명</button><span>사진 {status.photo_count}장</span><span>한마디 {status.memory_count}개</span></div>
        {canManage && !hideDuplicatedActions && photos.length ? <button type="button" className="collab-panel__cover-button" disabled={busy !== null} onClick={() => setCoverPickerOpen(true)}>대표사진 변경</button> : null}
      </>
    )}

    {message ? <p className="notice notice--info collab-panel__message">{message}</p> : null}
    {error && status ? <p className="notice notice--error collab-panel__error" role="alert">{error}</p> : null}

    {pending ? <LivingPicker pending={pending} selectedIds={selectedIds} setSelectedIds={setSelectedIds} mode={livingMode} setMode={setLivingMode} busy={busy === "apply"} onCancel={() => setPending(null)} onApply={() => void applySelected()} /> : null}
    {coverPickerOpen ? <div className="collab-panel__cover-modal" role="dialog" aria-modal="true" aria-labelledby="cover-picker-title"><section>
      <header className="collab-panel__cover-modal-header"><h4 id="cover-picker-title">대표사진 바꾸기</h4><button type="button" className="collab-panel__cover-close" aria-label="대표사진 변경 닫기" disabled={savingCover} onClick={() => setCoverPickerOpen(false)}><X size={18} aria-hidden="true" /></button></header>
      <div className="collab-panel__cover-grid">{photos.map((photo) => <button type="button" key={photo.id} className={selectedCoverId === photo.id ? "is-selected" : ""} onClick={() => setSelectedCoverId(photo.id)} aria-pressed={selectedCoverId === photo.id}><img src={photo.thumbnail_url || photo.original_url} alt="대표사진 후보" loading="lazy" /></button>)}</div>
      <div className="collab-panel__cover-actions"><button type="button" disabled={savingCover} onClick={() => setCoverPickerOpen(false)}>취소</button><button type="button" className="collab-panel__primary" disabled={savingCover || !selectedCoverId} onClick={() => void saveCover()}>{savingCover ? "저장 중..." : "저장"}</button></div>
    </section></div> : null}
    {/* 다른 자리와 같은 공유 시트 하나(I-2). 구경용 링크는 이 패널이 이미 가진 값으로. */}
    {shareOpen ? <AlbumShareSheet albumId={albumId} imageUrl={imageUrl || ""} resolveViewUrl={ensurePublicShareUrl} onInviteIssued={() => { void refresh(); }} onClose={() => setShareOpen(false)} /> : null}
  </section>;
}

function LivingPicker({ pending, selectedIds, setSelectedIds, mode, setMode, busy, onCancel, onApply }: {
  pending: { items: PendingContributionItem[]; recommended_mode: LivingMode; append_photo_threshold: number; append_memory_threshold: number };
  selectedIds: Set<string>; setSelectedIds: (ids: Set<string>) => void;
  mode: LivingMode; setMode: (mode: LivingMode) => void; busy: boolean; onCancel: () => void; onApply: () => void;
}) {
  const selected = pending.items.filter((item) => selectedIds.has(item.id));
  const photoCount = selected.filter((item) => item.type === "photo").length;
  const memoryCount = selected.filter((item) => item.type === "memory").length;
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };
  return <div className="collab-panel__cover-modal" role="dialog" aria-modal="true" aria-label="새로 더해진 사진과 한마디">
    <section>
      <h4>새로 더해진 사진과 한마디가 있어요.</h4>
      {pending.recommended_mode === "edition" ? <p className="collab-panel__picker-copy">새로 더해진 것이 많아요. 새로운 에디션을 만들어 보세요.</p> : <p className="collab-panel__picker-copy">현재 앨범에 이어 담거나, 새롭게 구성할 수 있어요.</p>}
      <div className="collab-panel__living-modes">
        <label className={mode === "append_page" ? "is-selected" : ""}><input type="radio" name="living-mode" checked={mode === "append_page"} onChange={() => setMode("append_page")} /><span><strong>마지막 페이지에 추가하기</strong><small>빠르게 현재 앨범에 이어집니다.</small></span></label>
        <label className={mode === "edition" ? "is-selected" : ""}><input type="radio" name="living-mode" checked={mode === "edition"} onChange={() => setMode("edition")} /><span><strong>새로운 에디션 만들기</strong><small>사진 배치와 이야기를 새롭게 구성합니다.</small></span></label>
      </div>
      <label className="collab-panel__select-all"><input type="checkbox" checked={selectedIds.size === pending.items.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(pending.items.map((item) => item.id)) : new Set())} /> 전체 선택</label>
      <ul className="collab-panel__pending-list">{pending.items.map((item) => <li key={item.id}><label><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} /><span>{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : null}</span><span><strong>{item.actor_name}님이 {item.type === "photo" ? "사진을 추가했습니다." : "한마디를 남겼어요."}</strong><small>{item.comment || item.content || "새로 더해진 것"}</small></span></label></li>)}</ul>
      <p className="collab-panel__picker-copy">선택한 사진 {photoCount}장 · 한마디 {memoryCount}개</p>
      <div className="collab-panel__cover-actions"><button type="button" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="collab-panel__primary" disabled={busy || selectedIds.size === 0} onClick={onApply}>{busy ? "사진을 앨범에 담는 중..." : mode === "append_page" ? "마지막 페이지에 추가하기" : "새로운 에디션 만들기"}</button></div>
    </section>
  </div>;
}
