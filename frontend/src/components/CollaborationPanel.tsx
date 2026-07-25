import { useCallback, useEffect, useState } from "react";
import {
  applyContributions,
  createAlbumShareLink,
  getCollaborationStatus,
  getPendingContributions,
  isPublicShareUrl,
  startCollaboration,
  updateAlbumCoverPhoto,
  type PendingContributionItem,
} from "../lib/api";
import { useKakaoSdk } from "../hooks/useKakaoSdk";
import { updatePublicShareCoverCache } from "../lib/publicShareFlow";
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
};

type Participation = NonNullable<Awaited<ReturnType<typeof getCollaborationStatus>>["participation"]>;
type LivingMode = "append_page" | "edition";

interface CollaborationPanelProps {
  albumId: string;
  shareUrl?: string | null;
  imageUrl?: string | null;
  title?: string;
  photos?: AlbumPhoto[];
  coverPhotoId?: string | null;
  onAlbumUpdated?: () => void;
  onCoverUpdated?: (coverPhotoId: string | null, coverImageUrl: string | null) => void;
  onOpenParticipants?: () => void;
}

const shareUrlStorageKey = (albumId: string) => `momento-collaboration-share-url:${albumId}`;

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
  albumId, shareUrl: initialShareUrl, imageUrl, title, photos = [], coverPhotoId,
  onAlbumUpdated, onCoverUpdated, onOpenParticipants,
}: CollaborationPanelProps) {
  const [status, setStatus] = useState<CollaborationStatus | null>(null);
  const [participation, setParticipation] = useState<Participation | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(() => (
    isPublicShareUrl(initialShareUrl) ? initialShareUrl || null : readStoredShareUrl(albumId)
  ));
  const [statusLoading, setStatusLoading] = useState(true);
  const [busy, setBusy] = useState<"start" | "apply" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof getPendingContributions>> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [livingMode, setLivingMode] = useState<LivingMode>("append_page");
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [selectedCoverId, setSelectedCoverId] = useState<string | null>(coverPhotoId || null);
  const [savingCover, setSavingCover] = useState(false);
  const { shareAlbum } = useKakaoSdk();

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

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!albumId) return;
    setStatusLoading(true);
    try {
      const payload = await getCollaborationStatus(albumId, signal);
      setStatus(payload);
      setParticipation(payload.participation ?? null);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "함께 만들기 정보를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setStatusLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (isPublicShareUrl(initialShareUrl)) rememberShareUrl(initialShareUrl || null);
  }, [initialShareUrl, rememberShareUrl]);
  useEffect(() => setSelectedCoverId(coverPhotoId || photos[0]?.id || null), [coverPhotoId, photos]);

  const ensureShareUrl = useCallback(async () => {
    if (isPublicShareUrl(shareUrl)) return shareUrl || "";
    const created = await createAlbumShareLink(albumId);
    rememberShareUrl(created.share_url);
    return created.share_url;
  }, [albumId, rememberShareUrl, shareUrl]);

  const start = async () => {
    setBusy("start"); setMessage(null); setError(null);
    try {
      await startCollaboration(albumId);
      await ensureShareUrl();
      setMessage("함께 사진과 기억을 모을 준비가 되었습니다.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "함께 만들기를 시작하지 못했습니다.");
    } finally { setBusy(null); }
  };

  const copyLink = async () => {
    try {
      // Copy an already-issued public link before waiting on any network work.
      // Creating a link is only necessary for legacy albums with no cached URL.
      const readyUrl = isPublicShareUrl(shareUrl) ? shareUrl : readStoredShareUrl(albumId);
      await navigator.clipboard.writeText(readyUrl || await ensureShareUrl());
      setMessage("링크를 복사했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "링크를 복사하지 못했습니다.");
    }
  };

  const shareKakao = async () => {
    try {
      shareAlbum({
        imageUrl: imageUrl || "",
        linkUrl: await ensureShareUrl(),
        title: title || "Momento 앨범",
        description: "사진과 기억을 함께 모아보세요.",
      });
    } catch (cause) {
      try {
        await navigator.clipboard.writeText(await ensureShareUrl());
        setMessage("링크를 복사했습니다.");
      } catch {
        setError(cause instanceof Error ? cause.message : "카카오로 초대하지 못했습니다.");
      }
    }
  };

  const openLivingPicker = async () => {
    setBusy("apply"); setError(null);
    try {
      const next = await getPendingContributions(albumId);
      if (!next.items.length) {
        setMessage("새로 추가된 추억이 없습니다.");
        await refresh();
        return;
      }
      setPending(next);
      setSelectedIds(new Set(next.items.map((item) => item.id)));
      setLivingMode(next.recommended_mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "새로 모인 추억을 불러오지 못했습니다.");
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
        try { sessionStorage.setItem(`momento-living-focus:${albumId}`, result.append_page_id); } catch { /* noop */ }
        setMessage("새로운 추억이 추가되었습니다.");
      } else {
        setMessage("새로운 추억을 반영한 최신 앨범입니다.");
      }
      setPending(null); setSelectedIds(new Set());
      await refresh();
      onAlbumUpdated?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "앨범에 추억을 담지 못했습니다. 다시 시도해 주세요.");
    } finally { setBusy(null); }
  };

  const saveCover = async () => {
    if (!selectedCoverId) return;
    setSavingCover(true); setError(null);
    try {
      const updated = await updateAlbumCoverPhoto(albumId, selectedCoverId);
      const token = shareToken(shareUrl);
      if (token) updatePublicShareCoverCache(token, updated.cover_photo_id, updated.cover_image_url);
      onCoverUpdated?.(updated.cover_photo_id, updated.cover_image_url);
      setCoverPickerOpen(false);
      setMessage("대표사진을 변경했습니다.");
    } catch {
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
    <div><h3 className="collab-panel__title">함께 만들기</h3><p className="collab-panel__copy">가족과 친구를 초대해 사진과 추억을 함께 모아보세요.</p></div>

    {statusLoading ? (
      <div className="collab-panel__loading" aria-busy="true">
        <p className="collab-panel__loading-hint">함께 만든 추억을 확인하고 있어요.</p>
        <div className="collab-panel__skeleton-lines">
          <span /><span /><span />
        </div>
      </div>
    ) : !status ? (
      <div className="collab-panel__error-block">
        <p className="collab-panel__error">{error || "함께 만들기 정보를 불러오지 못했습니다."}</p>
        <button type="button" onClick={() => void refresh()}>다시 시도</button>
      </div>
    ) : (
      <>
        {!started && canManage ? <button type="button" className="collab-panel__primary" disabled={busy !== null} onClick={() => void start()}>{busy === "start" ? "시작하는 중..." : "함께 만들기 시작"}</button> : null}
        {started && canManage ? <>
          <div className="collab-panel__share-actions"><button type="button" disabled={busy !== null} onClick={() => void copyLink()}>링크 복사</button><button type="button" disabled={busy !== null} onClick={() => void shareKakao()}>카카오로 초대</button></div>
          <div className="collab-panel__new-summary"><strong>새로운 추억</strong><p>{hasNew ? `새로운 사진 ${newPhotos}장과 기억 ${newMemories}개가 도착했습니다.` : "새롭게 추가된 추억이 없습니다."}</p></div>
          {hasNew ? <button type="button" className="collab-panel__primary" disabled={busy !== null} onClick={() => void openLivingPicker()}>{busy === "apply" ? "추억을 앨범에 담는 중..." : recommendsEdition ? "새로운 에디션 만들기" : "마지막 페이지에 추가하기"}</button> : null}
        </> : null}
        <div className="collab-panel__status" aria-label="참여 현황"><strong>참여 현황</strong><button type="button" className="collab-panel__participant-link" onClick={onOpenParticipants} disabled={!onOpenParticipants}>참여자 {participation?.participants.length ?? status.contributor_count}명</button><span>사진 {status.photo_count}장</span><span>기억 {status.memory_count}개</span></div>
        {canManage && photos.length ? <button type="button" className="collab-panel__cover-button" disabled={busy !== null} onClick={() => setCoverPickerOpen(true)}>대표사진 변경</button> : null}
      </>
    )}

    {message ? <p className="collab-panel__message">{message}</p> : null}
    {error && status ? <p className="collab-panel__error">{error}</p> : null}

    {pending ? <LivingPicker pending={pending} selectedIds={selectedIds} setSelectedIds={setSelectedIds} mode={livingMode} setMode={setLivingMode} busy={busy === "apply"} onCancel={() => setPending(null)} onApply={() => void applySelected()} /> : null}
    {coverPickerOpen ? <div className="collab-panel__cover-modal" role="dialog" aria-modal="true" aria-label="대표사진 변경"><section><h4>대표사진 바꾸기</h4><div className="collab-panel__cover-grid">{photos.map((photo) => <button type="button" key={photo.id} className={selectedCoverId === photo.id ? "is-selected" : ""} onClick={() => setSelectedCoverId(photo.id)}><img src={photo.thumbnail_url || photo.original_url} alt="대표사진 후보" loading="lazy" /></button>)}</div><div className="collab-panel__cover-actions"><button type="button" disabled={savingCover} onClick={() => setCoverPickerOpen(false)}>취소</button><button type="button" className="collab-panel__primary" disabled={savingCover || !selectedCoverId} onClick={() => void saveCover()}>{savingCover ? "저장 중..." : "저장"}</button></div></section></div> : null}
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
  return <div className="collab-panel__cover-modal" role="dialog" aria-modal="true" aria-label="새로 모인 추억">
    <section>
      <h4>새로운 추억이 도착했습니다.</h4>
      {pending.recommended_mode === "edition" ? <p className="collab-panel__picker-copy">새로운 추억이 많이 모였습니다. 새로운 에디션을 만들어보세요.</p> : <p className="collab-panel__picker-copy">현재 앨범에 이어 담거나, 새롭게 구성할 수 있어요.</p>}
      <div className="collab-panel__living-modes">
        <label className={mode === "append_page" ? "is-selected" : ""}><input type="radio" name="living-mode" checked={mode === "append_page"} onChange={() => setMode("append_page")} /><span><strong>마지막 페이지에 추가하기</strong><small>빠르게 현재 앨범에 이어집니다.</small></span></label>
        <label className={mode === "edition" ? "is-selected" : ""}><input type="radio" name="living-mode" checked={mode === "edition"} onChange={() => setMode("edition")} /><span><strong>새로운 에디션 만들기</strong><small>사진 배치와 이야기를 새롭게 구성합니다.</small></span></label>
      </div>
      <label className="collab-panel__select-all"><input type="checkbox" checked={selectedIds.size === pending.items.length} onChange={(event) => setSelectedIds(event.target.checked ? new Set(pending.items.map((item) => item.id)) : new Set())} /> 전체 선택</label>
      <ul className="collab-panel__pending-list">{pending.items.map((item) => <li key={item.id}><label><input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggle(item.id)} /><span>{item.type === "photo" && item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : null}</span><span><strong>{item.actor_name}님이 {item.type === "photo" ? "사진을 추가했습니다." : "기억을 남겼습니다."}</strong><small>{item.comment || item.content || "새로 도착한 추억"}</small></span></label></li>)}</ul>
      <p className="collab-panel__picker-copy">선택한 사진 {photoCount}장 · 기억 {memoryCount}개</p>
      <div className="collab-panel__cover-actions"><button type="button" disabled={busy} onClick={onCancel}>취소</button><button type="button" className="collab-panel__primary" disabled={busy || selectedIds.size === 0} onClick={onApply}>{busy ? "추억을 앨범에 담는 중..." : mode === "append_page" ? "마지막 페이지에 추가하기" : "새로운 에디션 만들기"}</button></div>
    </section>
  </div>;
}
