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
import { ALBUM_PHOTO_CAPACITY } from "../lib/albumLimits";
import { FILE_INPUT_CLASS, filterImageFiles, imageAcceptFor, limitSelectedPhotos, snapshotSelectedFiles } from "../lib/imageFile";
import { currentUserAgent } from "../lib/webview";
import type { PublicContributionItem } from "../types";
import AlbumScreen from "./AlbumScreen";
import "./ContributeWorkspace.css";
import ConfirmSheet from "./ConfirmSheet";

// 파일 선택창의 accept — 환경에 따라 한 번만 정한다(imageFile.ts 주석 참고).
const PHOTO_ACCEPT = imageAcceptFor(currentUserAgent());
/** label htmlFor 가 가리킬 파일 input. 화면에 하나만 존재한다. */
const PHOTO_INPUT_ID = "contribute-photo-input";


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
  // 수정 중인 한마디. 새 대화상자를 띄우지 않고 **글이 있던 자리**에서 같은 편집기를
  // 연다(§11: window.prompt 금지 — 디자인이 없고 웹뷰에서 막힐 수 있다).
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  // 지우기 전 물음 — window.confirm 을 쓰지 않는다(§11).
  const [pendingMemoryDelete, setPendingMemoryDelete] = useState<PhotoMemory | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);
  const [newItemIds, setNewItemIds] = useState<string[]>([]);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(-1);
  const [preview, setPreview] = useState<PreviewSnapshot | null>(null);
  const [latestPhotoId, setLatestPhotoId] = useState<string | null>(null);
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

  // 남긴 뒤 안내 상자를 띄우지 않는다(§11 "한 단계 적게"). 사용자는 자기가 쓴 한마디가
  // 화면에 나타나는 것을 이미 본다 — 한 번 더 알리고 다음 행동을 고르라고 묻지 않는다.
  // 남긴 자리에 그대로 머문다.

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
    workspace && (workspace.photo_count ?? 0) + pendingUploads.length >= (workspace.photo_limit ?? ALBUM_PHOTO_CAPACITY),
  );
  useEffect(() => {
    if (requestedAction) setTab("photos");
    // 파일 선택창을 여기서 자동으로 열지 않는다(SCREEN_SPEC §11). 효과(effect)는 사용자
    // 클릭과 다른 tick 이라 iOS 사파리·카카오 웹뷰에서 조용히 실패한다 — 데스크톱에서만
    // 되므로 자동 테스트로도 잡히지 않는다. 시트 최상단의 "사진 추가하기" 라벨이
    // 유일하고 확실한 경로다(라벨 클릭 = 브라우저가 여는 것, JS 호출 없음).
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
  }, [markFresh, onContributionAdded, session?.displayName, showToast]);

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
    const { accepted, rejected } = filterImageFiles(files);
    if (!accepted.length) {
      setError(rejected ? "선택한 파일을 사진으로 읽지 못했어요. JPG, PNG, WEBP, HEIC를 골라 주세요." : "사진을 선택해 주세요.");
      return;
    }
    setError(rejected > 0 ? `${rejected}개 파일은 지원하지 않아 제외했어요.` : null);
    const existingCount = workspace?.photo_count ?? 0;
    const pendingCount = pendingUploadsRef.current.length;
    const photoLimit = workspace?.photo_limit ?? ALBUM_PHOTO_CAPACITY;
    const { accepted: limited, skipped } = limitSelectedPhotos(accepted, photoLimit, existingCount + pendingCount);
    if (!limited.length) {
      setError(`앨범에는 사진을 최대 ${photoLimit}장까지 담을 수 있어요.`);
      return;
    }
    if (skipped > 0) {
      setError(`사진 ${skipped}장은 추가되지 않았습니다. 앨범에는 최대 ${photoLimit}장까지 담을 수 있어요.`);
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
      showToast("한마디를 남겼어요.");
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
      setError("한마디를 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSavingPhotoId(null);
    }
  };

  /** 고칠 글이 있던 자리에서 편집기를 연다 — 무엇을 고치는지 보이게. */
  const startEditMemory = (memory: PhotoMemory) => {
    setError(null);
    setDraftPhotoId(null);
    setEditingMemoryId(memory.id);
    setDraftText(memory.comment || "");
    window.requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const cancelEditMemory = () => {
    setEditingMemoryId(null);
    setDraftText("");
  };

  const saveEditedMemory = async (memory: PhotoMemory) => {
    if (!session || !draftText.trim() || savingPhotoId) return;
    setSavingPhotoId(memory.id);
    try {
      const updated = await updatePhotoMemory(albumId, memory.id, session, draftText.trim()) as PhotoMemory;
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
      setEditingMemoryId(null);
      setDraftText("");
      onContributionUpdated?.({
        id: updated.id,
        type: "memory",
        actor_name: updated.author_name || session.displayName || "참여자",
        author_name: updated.author_name || session.displayName || "익명",
        content: updated.comment,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "한마디를 수정하지 못했습니다.");
    } finally {
      setSavingPhotoId(null);
    }
  };

  const removeMemory = async (memory: PhotoMemory) => {
    if (!session) return;
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
      setError(err instanceof Error ? err.message : "한마디를 지우지 못했어요.");
    }
  };

  const openTab = (nextTab: Tab) => {
    if (nextTab === "preview" && workspace && previewRevision !== workspaceRevision) {
      setPreview({ albumJson: workspace.album_json, photos: workspace.photos || [] });
      setPreviewRevision(workspaceRevision);
    }
    setTab(nextTab);
  };

  /** 파일 선택창을 열기 전에 화면 상태만 정리한다(선택창 자체는 label 이 연다). */
  const prepareForPhotoPick = () => {
    setTab("photos");
  };

  /** 하단 네비처럼 label 로 만들 수 없는 자리에서만 쓴다. rAF·setTimeout·await 를 거치지
   *  않고 사용자 클릭과 같은 tick 에서 호출해야 웹뷰에서 열린다(SCREEN_SPEC §11). */
  const openPhotoPicker = () => {
    prepareForPhotoPick();
    uploadInputRef.current?.click();
  };

  const openMemoryEditor = (targetPhotoId?: string) => {
    setTab("photos");
    const photoId = targetPhotoId || latestPhotoId || workspace?.photos?.[0]?.id || null;
    if (!photoId) {
      setError("한마디를 남길 사진을 먼저 추가해 주세요.");
      return;
    }
    setDraftPhotoId(photoId);
    setDraftText("");
    window.requestAnimationFrame(() => draftInputRef.current?.focus());
  };

  const viewParticipantAlbum = () => {
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

      {/* 파일 input 은 탭·완료 화면과 무관하게 항상 한 번만 둔다. label htmlFor 로 여는
          방식이라 JS .click() 이 필요 없고, 사용자 제스처가 그대로 브라우저에 전달된다. */}
      <input
        id={PHOTO_INPUT_ID}
        ref={uploadInputRef}
        className={FILE_INPUT_CLASS}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        disabled={isUploading || photoLimitReached}
        onChange={(event) => {
          const selected = snapshotSelectedFiles(event.currentTarget.files);
          void onUpload(selected);
          event.target.value = "";
        }}
      />
      {tab === "photos" ? (
        <div className="contribute__panel">
          {requestedAction === "memory" ? <p className="contribute__notice">한마디를 남길 사진을 골라 주세요.</p> : null}
          {requestedAction !== "memory"
            ? <label className="contribute__upload" htmlFor={PHOTO_INPUT_ID}>사진 추가하기</label>
            : null}
          {requestedAction !== "memory" ? (photoLimitReached
            ? <p className="contribute__error" role="status">앨범이 가득 찼어요. 사진은 한 앨범에 최대 {workspace.photo_limit}장까지 담을 수 있어요.</p>
            : <p className="contribute__limit">앨범에는 사진을 최대 {workspace.photo_limit}장까지 담을 수 있어요. 지금 {workspace.photo_count}장이 담겨 있어요.</p>) : null}
          {/* 빈 시트 금지: 파일창은 자동으로 열지 않으므로(§11) 무엇을 누르면 되는지 적는다. */}
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
                      {editingMemoryId === memory.id ? (
                        // 글이 있던 자리에서 그대로 고친다(새로 남길 때와 같은 편집기).
                        <div className="contribute__draft">
                          <textarea ref={draftInputRef} disabled={savingPhotoId === memory.id} maxLength={500} value={draftText} onChange={(event) => setDraftText(event.target.value)} aria-label="한마디 수정" />
                          <p className="contribute__count">{draftText.length}/500</p>
                          <div className="contribute__draft-actions">
                            <button type="button" disabled={savingPhotoId === memory.id || !draftText.trim()} onClick={() => void saveEditedMemory(memory)}>
                              {savingPhotoId === memory.id ? "저장 중..." : "저장"}
                            </button>
                            <button type="button" disabled={savingPhotoId === memory.id} onClick={cancelEditMemory}>취소</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="contribute__memory-text">{memory.comment}</p>
                          {memory.pending ? <p className="contribute__memory-pending" role="status">저장 중...</p> : null}
                          {newItemIds.includes(memory.id) ? <span className="contribute__fresh">방금 추가됨</span> : null}
                          {memory.mine && !memory.pending ? (
                            <div className="contribute__memory-actions">
                              <button type="button" onClick={() => startEditMemory(memory)}>수정</button>
                              <button type="button" onClick={() => setPendingMemoryDelete(memory)}>삭제</button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" className="contribute__memory-btn" onClick={() => openMemoryEditor(photo.id)}>
                  이 사진에 한마디 남기기
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
          )) : <p className="contribute__empty">사진에 남긴 한마디는 사진 탭에서 바로 볼 수 있어요.</p>}
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

      {pendingMemoryDelete ? (
        <ConfirmSheet
          title="이 한마디를 지울까요?"
          description="지운 글은 되돌릴 수 없어요."
          confirmLabel="한마디 지우기"
          danger
          onConfirm={() => { const target = pendingMemoryDelete; setPendingMemoryDelete(null); void removeMemory(target); }}
          onCancel={() => setPendingMemoryDelete(null)}
        />
      ) : null}
    </section>
  );

  if (embedded) return workspaceBody;

  return (
    <AlbumScreen
      title={workspace.title}
      subtitle="사진과 한마디를 더할 수 있어요."
      body={workspaceBody}
      bottomNavigation={{
        // §4 참여자 3칸. "앨범"(스크롤로 되는 것)에는 칸을 쓰지 않는다.
        variant: "contributor",
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
