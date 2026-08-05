import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPhotoMemory,
  deletePhotoMemory,
  getContributeWorkspace,
  loadCollabSession,
  type CollabSession,
  updatePhotoMemory,
  uploadContributePhotos,
} from "../lib/api";
import { FILE_INPUT_CLASS, filterImageFiles, IMAGE_ACCEPT, limitSelectedPhotos, snapshotSelectedFiles } from "../lib/imageFile";
import type { PublicContributionItem } from "../types";
import AlbumScreen from "./AlbumScreen";
import "./ContributeWorkspace.css";

interface ContributeWorkspaceProps {
  albumId: string;
  embedded?: boolean;
  requestedAction?: "photo" | "memory";
  initialWorkspace?: WorkspaceState;
  onContributionAdded?: (items: PublicContributionItem[]) => void;
  onContributionUpdated?: (item: PublicContributionItem) => void;
  onContributionRemoved?: (id: string) => void;
}

type Tab = "photos" | "memories" | "preview";

type PhotoMemory = {
  id: string;
  author_name?: string | null;
  comment: string;
  created_at?: string | null;
  mine?: boolean;
  pending?: boolean;
};

type WorkspacePhoto = {
  id: string;
  thumbnail_url?: string | null;
  original_url?: string | null;
  author_name?: string | null;
  created_at?: string | null;
  mine?: boolean;
  memories?: PhotoMemory[];
};

export type WorkspaceState = {
  title: string;
  photo_count: number;
  photo_limit: number;
  contributors?: Array<{ id: string; display_name: string }>;
  photos?: WorkspacePhoto[];
  memories?: Array<{ id: string; author_name?: string | null; comment: string; mine?: boolean }>;
  album_json?: unknown;
};

type PendingUpload = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "failed";
};

type PreviewSnapshot = {
  albumJson?: unknown;
  photos: WorkspacePhoto[];
};

type CompletionState = {
  hasPhoto: boolean;
  hasMemory: boolean;
};

function debugTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV && typeof performance !== "undefined") {
    console.debug(`[Momento] ${label}: ${Math.round(performance.now() - startedAt)}ms`);
  }
}

function localUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function WorkspaceImage({ src, alt = "" }: { src: string; alt?: string }) {
  const startedAt = useRef(performance.now());

  useEffect(() => {
    startedAt.current = performance.now();
  }, [src]);

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => debugTiming("contribution signed thumbnail loaded", startedAt.current)}
    />
  );
}

export default function ContributeWorkspace({
  albumId,
  embedded = false,
  requestedAction,
  initialWorkspace,
  onContributionAdded,
  onContributionUpdated,
  onContributionRemoved,
}: ContributeWorkspaceProps) {
  const [session, setSession] = useState<CollabSession | null>(() => loadCollabSession(albumId));
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(() => initialWorkspace ?? null);
  const [tab, setTab] = useState<Tab>("photos");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draftPhotoId, setDraftPhotoId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);
  const [newItemIds, setNewItemIds] = useState<string[]>([]);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(-1);
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [latestPhotoId, setLatestPhotoId] = useState<string | null>(null);
  const [activeParticipantItem, setActiveParticipantItem] = useState<"album" | "photo" | "memory">("album");
  const latestPhotoRef = useRef<HTMLElement | null>(null);
  const participantRootRef = useRef<HTMLElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const freshTimerRef = useRef<number | null>(null);
  const pendingUploadsRef = useRef<PendingUpload[]>([]);

  useEffect(() => {
    pendingUploadsRef.current = pendingUploads;
  }, [pendingUploads]);

  useEffect(() => () => {
    pendingUploadsRef.current.forEach((pending) => URL.revokeObjectURL(pending.previewUrl));
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    if (freshTimerRef.current) window.clearTimeout(freshTimerRef.current);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const markFresh = useCallback((ids: string[]) => {
    setNewItemIds(ids);
    if (freshTimerRef.current) window.clearTimeout(freshTimerRef.current);
    freshTimerRef.current = window.setTimeout(() => setNewItemIds([]), 4500);
  }, []);

  const showCompletion = useCallback((next: CompletionState) => {
    setCompletion((current) => ({
      hasPhoto: Boolean(current?.hasPhoto || next.hasPhoto),
      hasMemory: Boolean(current?.hasMemory || next.hasMemory),
    }));
  }, []);

  const reload = useCallback(async () => {
    if (initialWorkspace) return;
    const current = loadCollabSession(albumId);
    if (!current) {
      setError("참여 세션이 없어요. 초대 링크로 다시 들어와 주세요.");
      return;
    }
    setSession(current);
    const startedAt = performance.now();
    const data = await getContributeWorkspace(albumId, current) as WorkspaceState;
    debugTiming("contribution workspace request", startedAt);
    setWorkspace(data);
    setWorkspaceRevision((revision) => revision + 1);
  }, [albumId, initialWorkspace]);

  useEffect(() => {
    if (initialWorkspace) return;
    void reload().catch((err: Error) => setError(err.message));
  }, [initialWorkspace, reload]);

  // Embedded "사진 추가" (owner sheet): jump straight into picking files — the sheet's
  // job is adding new photos, so the file dialog opens without an extra tap.
  // (embedded=false standalone participant flow keeps its explicit buttons.)
  const isEmbeddedPhotoAdd = embedded && requestedAction === "photo";
  // Full album (30/30): picking a file would be silently cut to zero by
  // limitSelectedPhotos and no request would ever leave the client — block the
  // picker up front and say WHY on screen instead of failing quietly.
  const photoLimitReached = Boolean(
    workspace && (workspace.photo_count ?? 0) + pendingUploads.length >= (workspace.photo_limit ?? 30),
  );
  useEffect(() => {
    if (requestedAction) setTab("photos");
    // Reads photoLimitReached from the mount render on purpose: the sheet mounts with
    // initialWorkspace already set, and re-running on workspace changes would re-open
    // the file dialog mid-session.
    if (embedded && requestedAction === "photo" && !photoLimitReached) {
      window.requestAnimationFrame(() => uploadInputRef.current?.click());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, requestedAction]);

  useEffect(() => {
    if (!newItemIds.length || tab !== "photos") return;
    const frame = window.requestAnimationFrame(() => {
      latestPhotoRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [newItemIds, tab]);

  useEffect(() => {
    if (tab !== "preview" || !workspace || previewRevision === workspaceRevision) return;
    setPreview({ albumJson: workspace.album_json, photos: workspace.photos || [] });
    setPreviewRevision(workspaceRevision);
  }, [previewRevision, tab, workspace, workspaceRevision]);

  const addUploadedPhotos = useCallback((photos: WorkspacePhoto[], photoCount: number) => {
    if (!photos.length) return;
    setWorkspace((current) => current
      ? {
          ...current,
          photo_count: photoCount,
          photos: [...photos, ...(current.photos || []).filter((photo) => !photos.some((added) => added.id === photo.id))],
        }
      : current);
    setWorkspaceRevision((revision) => revision + 1);
    setLatestPhotoId(photos[0]?.id || null);
    markFresh(photos.map((photo) => photo.id));
    showToast("사진이 추가되었습니다.");
    onContributionAdded?.(photos.map((photo) => ({
      id: photo.id,
      type: "photo",
      actor_name: photo.author_name || session?.displayName || "익명",
      author_name: photo.author_name || session?.displayName || "익명",
      created_at: photo.created_at || new Date().toISOString(),
      thumbnail_url: photo.thumbnail_url || photo.original_url || null,
    })));
    showCompletion({ hasPhoto: true, hasMemory: false });
  }, [markFresh, onContributionAdded, session?.displayName, showCompletion, showToast]);

  const uploadPending = useCallback(async (items: PendingUpload[]) => {
    if (!session || !items.length) return;
    setError(null);
    setIsUploading(true);
    setPendingUploads((current) => current.map((pending) => (
      items.some((item) => item.id === pending.id) ? { ...pending, status: "uploading" } : pending
    )));
    const startedAt = performance.now();
    try {
      const result = await uploadContributePhotos(albumId, session, items.map((item) => item.file)) as {
        photos?: WorkspacePhoto[];
        photo_count: number;
      };
      debugTiming("contribution photo upload request", startedAt);
      items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingUploads((current) => current.filter((pending) => !items.some((item) => item.id === pending.id)));
      addUploadedPhotos(result.photos || [], result.photo_count);
      window.requestAnimationFrame(() => debugTiming("contribution upload state applied", startedAt));
    } catch (err) {
      setPendingUploads((current) => current.map((pending) => (
        items.some((item) => item.id === pending.id) ? { ...pending, status: "failed" } : pending
      )));
      console.warn("[Momento] Contribution photo upload failed.", err);
      setError("사진을 추가하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }, [addUploadedPhotos, albumId, session]);

  const onUpload = async (files: File[] | FileList | null) => {
    setActiveParticipantItem("photo");
    const { accepted, rejected } = filterImageFiles(files);
    if (!accepted.length) {
      setError(rejected ? "선택한 파일을 사진으로 읽지 못했어요. JPG, PNG, WEBP, HEIC를 골라 주세요." : "사진을 선택해 주세요.");
      return;
    }
    setError(rejected > 0 ? `${rejected}개 파일은 지원하지 않아 제외했어요.` : null);
    const existingCount = workspace?.photo_count ?? 0;
    const pendingCount = pendingUploadsRef.current.length;
    const photoLimit = workspace?.photo_limit ?? 30;
    const { accepted: limited, skipped } = limitSelectedPhotos(accepted, photoLimit, existingCount + pendingCount);
    if (!limited.length) {
      setError("사진은 한 앨범에 최대 30장까지 올릴 수 있습니다.");
      return;
    }
    if (skipped > 0) {
      setError(`사진 ${skipped}장은 추가되지 않았습니다. 한 앨범에는 최대 30장까지 올릴 수 있습니다.`);
    }
    const items = limited.map((file) => ({
      id: `local-${localUploadId()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading" as const,
    }));
    setPendingUploads((current) => [...items, ...current]);
    await uploadPending(items);
  };

  const saveMemory = async (photoId: string) => {
    if (!session || !draftText.trim() || savingPhotoId) return;
    const comment = draftText.trim();
    const optimisticId = `local-memory-${localUploadId()}`;
    const optimisticMemory: PhotoMemory = {
      id: optimisticId,
      author_name: session.displayName || "익명",
      comment,
      created_at: new Date().toISOString(),
      mine: true,
      pending: true,
    };
    setError(null);
    setSavingPhotoId(photoId);
    const startedAt = performance.now();
    setWorkspace((current) => current
      ? {
          ...current,
          photos: (current.photos || []).map((photo) => (
            photo.id === photoId ? { ...photo, memories: [...(photo.memories || []), optimisticMemory] } : photo
          )),
        }
      : current);
    setWorkspaceRevision((revision) => revision + 1);
    try {
      const memory = await createPhotoMemory(albumId, photoId, session, comment) as PhotoMemory;
      debugTiming("contribution memory save request", startedAt);
      setWorkspace((current) => current
        ? {
            ...current,
            photos: (current.photos || []).map((photo) => (
              photo.id === photoId ? { ...photo, memories: (photo.memories || []).map((item) => item.id === optimisticId ? memory : item) } : photo
            )),
          }
        : current);
      setWorkspaceRevision((revision) => revision + 1);
      setDraftPhotoId(null);
      setDraftText("");
      setLatestPhotoId(photoId);
      markFresh([memory.id]);
      showToast("기억이 저장되었습니다.");
      showCompletion({ hasPhoto: false, hasMemory: true });
      onContributionAdded?.([{
        id: memory.id,
        type: "memory",
        actor_name: memory.author_name || session.displayName || "익명",
        author_name: memory.author_name || session.displayName || "익명",
        created_at: memory.created_at || new Date().toISOString(),
        content: memory.comment,
      }]);
    } catch (err) {
      console.warn("[Momento] Contribution memory save failed.", err);
      setWorkspace((current) => current
        ? {
            ...current,
            photos: (current.photos || []).map((photo) => (
              photo.id === photoId ? { ...photo, memories: (photo.memories || []).filter((item) => item.id !== optimisticId) } : photo
            )),
          }
        : current);
      setWorkspaceRevision((revision) => revision + 1);
      setError("기억을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSavingPhotoId(null);
    }
  };

  const editMemory = async (memory: PhotoMemory) => {
    if (!session) return;
    const next = window.prompt("기억 수정", memory.comment);
    if (!next?.trim()) return;
    try {
      const updated = await updatePhotoMemory(albumId, memory.id, session, next.trim()) as PhotoMemory;
      setWorkspace((current) => current
        ? {
            ...current,
            photos: (current.photos || []).map((photo) => ({
              ...photo,
              memories: (photo.memories || []).map((item) => item.id === updated.id ? updated : item),
            })),
          }
        : current);
      setWorkspaceRevision((revision) => revision + 1);
      onContributionUpdated?.({
        id: updated.id,
        type: "memory",
        actor_name: updated.author_name || session.displayName || "참여자",
        author_name: updated.author_name || session.displayName || "익명",
        content: updated.comment,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "기억을 수정하지 못했습니다.");
    }
  };

  const removeMemory = async (memory: PhotoMemory) => {
    if (!session || !window.confirm("이 기억을 삭제할까요?")) return;
    try {
      await deletePhotoMemory(albumId, memory.id, session);
      setWorkspace((current) => current
        ? {
            ...current,
            photos: (current.photos || []).map((photo) => ({
              ...photo,
              memories: (photo.memories || []).filter((item) => item.id !== memory.id),
            })),
          }
        : current);
      setWorkspaceRevision((revision) => revision + 1);
      onContributionRemoved?.(memory.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "기억을 삭제하지 못했습니다.");
    }
  };

  const openTab = (nextTab: Tab) => {
    if (nextTab === "preview" && workspace && previewRevision !== workspaceRevision) {
      setPreview({ albumJson: workspace.album_json, photos: workspace.photos || [] });
      setPreviewRevision(workspaceRevision);
    }
    setTab(nextTab);
  };

  const openPhotoPicker = () => {
    setCompletion(null);
    setTab("photos");
    setActiveParticipantItem("photo");
    window.requestAnimationFrame(() => uploadInputRef.current?.click());
  };

  const openMemoryEditor = (targetPhotoId?: string) => {
    setCompletion(null);
    setTab("photos");
    setActiveParticipantItem("memory");
    const photoId = targetPhotoId || latestPhotoId || workspace?.photos?.[0]?.id || null;
    if (!photoId) {
      setError("기억을 남길 사진을 먼저 추가해 주세요.");
      return;
    }
    setDraftPhotoId(photoId);
    setDraftText("");
    window.requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const viewAddedItems = () => {
    setCompletion(null);
    setActiveParticipantItem("album");
    if (embedded) {
      document.querySelector<HTMLElement>(".album-screen__book")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setTab("photos");
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".contribute__card--fresh")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const viewParticipantAlbum = () => {
    setCompletion(null);
    setActiveParticipantItem("album");
    participantRootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (error && !workspace) {
    return <section className="contribute"><p className="contribute__error">{error}</p></section>;
  }

  if (!workspace || !session) {
    return <section className="contribute"><p className="contribute__loading">앨범을 불러오는 중...</p></section>;
  }

  const confirmedPhotoCount = workspace.photo_count;
  const standaloneMemories = workspace.memories || [];

  const workspaceBody = (
    <section ref={participantRootRef} className={`contribute${embedded ? " contribute--embedded" : " contribute--participant"}`}>
      {!embedded ? <header className="contribute__header">
        <div>
          <p className="contribute__badge">함께 만드는 중</p>
          <h2 className="contribute__title">{workspace.title}</h2>
          <p className="contribute__meta">{session.displayName} · 사진 {confirmedPhotoCount}/{workspace.photo_limit}</p>
        </div>
      </header> : null}

      {toast ? <p className="contribute__toast" role="status">{toast}</p> : null}
      {error ? <p className="contribute__error">{error}</p> : null}

      {!embedded ? <div className="contribute__people">
        <p className="contribute__people-label">함께 만드는 사람 {workspace.contributors?.length || 0}명</p>
        <div className="contribute__avatars">
          {(workspace.contributors || []).map((person) => (
            <span key={person.id} className="contribute__avatar" title={person.display_name}>
              {(person.display_name || "?").slice(0, 1)}
            </span>
          ))}
        </div>
      </div> : null}

      {!embedded ? <nav className="contribute__tabs" aria-label="참여 내용">
        {(["photos", "memories", "preview"] as Tab[]).map((item) => (
          <button key={item} type="button" className={tab === item ? "is-active" : ""} onClick={() => openTab(item)}>
            {item === "photos" ? "사진" : item === "memories" ? "이야기" : "미리보기"}
          </button>
        ))}
      </nav> : null}

      {tab === "photos" ? (
        <div className="contribute__panel">
          {requestedAction === "memory" ? <p className="contribute__notice">기억을 남길 사진을 골라 주세요.</p> : null}
          {requestedAction !== "memory" ? <label className="contribute__upload">
            사진 추가하기
            <input
              ref={uploadInputRef}
              className={FILE_INPUT_CLASS}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              disabled={isUploading || photoLimitReached}
              onChange={(event) => {
                const selected = snapshotSelectedFiles(event.currentTarget.files);
                void onUpload(selected);
                event.target.value = "";
              }}
            />
          </label> : null}
          {requestedAction !== "memory" ? (photoLimitReached
            ? <p className="contribute__error" role="status">앨범이 가득 찼어요. 사진은 한 앨범에 최대 {workspace.photo_limit}장까지 담을 수 있어요.</p>
            : <p className="contribute__limit">사진은 한 번에 최대 {workspace.photo_limit}장까지 추가할 수 있어요.</p>) : null}
          {/* 빈 시트 금지: 자동 파일창이 차단되거나 닫혀도 비어 보이지 않게 안내 한 줄. */}
          {isEmbeddedPhotoAdd && !photoLimitReached && !pendingUploads.length && !(workspace.photos || []).some((photo) => newItemIds.includes(photo.id))
            ? <p className="contribute__empty">위의 ‘사진 추가하기’를 눌러 사진을 골라 주세요.</p>
            : null}
          <div className="contribute__grid">
            {pendingUploads.map((pending) => (
              <article key={pending.id} className="contribute__card contribute__card--pending">
                <div className="contribute__pending-media">
                  <WorkspaceImage src={pending.previewUrl} alt="선택한 사진" />
                  <div className={`contribute__upload-overlay${pending.status === "failed" ? " contribute__upload-overlay--failed" : ""}`}>
                    <p className="contribute__card-status" role="status">{pending.status === "uploading" ? "업로드 중..." : "업로드하지 못했습니다."}</p>
                    {pending.status === "failed" ? (
                      <button type="button" className="contribute__retry" disabled={isUploading} onClick={() => void uploadPending([pending])}>다시 시도</button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
            {(workspace.photos || [])
              // Embedded "사진 추가": show only what THIS session added (plus the
              // pending uploads above). The album's existing photos already live in
              // the album behind the sheet — repeating them here read as a "comment
              // on every photo" screen instead of an add-photos sheet.
              .filter((photo) => !isEmbeddedPhotoAdd || newItemIds.includes(photo.id))
              .map((photo) => (
              <article
                key={photo.id}
                className={`contribute__card${newItemIds.includes(photo.id) ? " contribute__card--fresh" : ""}`}
                ref={newItemIds.includes(photo.id) ? latestPhotoRef : undefined}
              >
                <WorkspaceImage src={photo.thumbnail_url || photo.original_url || ""} />
                {newItemIds.includes(photo.id) ? <p className="contribute__fresh">방금 추가됨</p> : null}
                <div className="contribute__photo-memories">
                  {(photo.memories || []).map((memory) => (
                    <div key={memory.id} className="contribute__photo-memory">
                      <p className="contribute__memory-text">{memory.comment}</p>
                      {memory.pending ? <p className="contribute__memory-pending" role="status">저장 중...</p> : null}
                      {newItemIds.includes(memory.id) ? <span className="contribute__fresh">방금 추가됨</span> : null}
                      {memory.mine && !memory.pending ? (
                        <div className="contribute__memory-actions">
                          <button type="button" onClick={() => void editMemory(memory)}>수정</button>
                          <button type="button" onClick={() => void removeMemory(memory)}>삭제</button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button type="button" className="contribute__memory-btn" onClick={() => openMemoryEditor(photo.id)}>
                  이 사진에 기억 남기기
                </button>
                {draftPhotoId === photo.id ? (
                  <div className="contribute__draft">
                    <textarea ref={draftPhotoId === photo.id ? draftInputRef : undefined} disabled={savingPhotoId === photo.id} maxLength={500} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="이 사진을 보며 떠오르는 순간을 적어 주세요." />
                    <p className="contribute__count">{draftText.length}/500</p>
                    <div className="contribute__draft-actions">
                      <button type="button" disabled={savingPhotoId === photo.id || !draftText.trim()} onClick={() => void saveMemory(photo.id)}>
                        {savingPhotoId === photo.id ? "저장 중..." : "저장"}
                      </button>
                      <button type="button" disabled={savingPhotoId === photo.id} onClick={() => setDraftPhotoId(null)}>취소</button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "memories" ? (
        <div className="contribute__panel">
          {standaloneMemories.length ? standaloneMemories.map((memory) => (
            <article key={memory.id} className="contribute__memory">
              <p className="contribute__memory-author">{memory.author_name || "참여자"}</p>
              <p className="contribute__memory-text">{memory.comment}</p>
            </article>
          )) : <p className="contribute__empty">사진에 남긴 기억은 사진 탭에서 바로 볼 수 있어요.</p>}
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="contribute__panel">
          {preview?.albumJson ? <pre className="contribute__json">{JSON.stringify(preview.albumJson, null, 2)}</pre> : (
            <div className="contribute__added">
              <h3>현재까지 추가한 사진</h3>
              <div className="contribute__grid">
                {(preview?.photos || []).filter((photo) => photo.mine).map((photo) => <WorkspaceImage key={photo.id} src={photo.thumbnail_url || photo.original_url || ""} />)}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {completion ? (
        <section className="contribute__completion" role="status" aria-live="polite">
          <button type="button" className="contribute__completion-close" aria-label="완료 안내 닫기" onClick={() => setCompletion(null)}>×</button>
          <p className="contribute__completion-title">
            {completion.hasPhoto && completion.hasMemory
              ? "사진과 기억이 추가되었습니다."
              : completion.hasPhoto
                ? "사진이 추가되었습니다."
                : "기억이 저장되었습니다."}
          </p>
          <p className="contribute__completion-copy">방금 남긴 추억을 앨범에서 확인해 보세요.</p>
          <div className="contribute__completion-actions">
            <button type="button" className="contribute__completion-primary" onClick={viewAddedItems}>앨범에서 확인하기</button>
            <button type="button" className="contribute__completion-secondary" onClick={completion.hasPhoto ? openPhotoPicker : () => openMemoryEditor()}>
              {completion.hasPhoto ? "사진 더 추가하기" : "기억 더 남기기"}
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );

  if (embedded) return workspaceBody;

  return (
    <AlbumScreen
      title={workspace.title}
      subtitle="함께 추억을 더해보세요."
      body={workspaceBody}
      bottomNavigation={{
        variant: "participant",
        activeItem: activeParticipantItem,
        onTop: viewParticipantAlbum,
        onAddPhoto: openPhotoPicker,
        onAddMemory: openMemoryEditor,
        onShare: () => undefined,
        canAddPhoto: !isUploading,
        canAddMemory: Boolean((workspace.photos || []).length),
      }}
      className="contribute-screen"
    />
  );
}
