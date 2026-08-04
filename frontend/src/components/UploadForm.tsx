import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { uploadAlbum } from "../lib/api";
import { albumCreationTiming } from "../lib/albumCreation";
import { CREATION_PROGRESS_TICK_MS, easeTowardTarget } from "../lib/creationProgress";
import { createId } from "../lib/id";
import { dedupeSelectedPhotos, FILE_INPUT_CLASS, filterImageFiles, IMAGE_ACCEPT, limitSelectedPhotos, snapshotSelectedFiles } from "../lib/imageFile";
import { fitsWithinUploadTotal, formatUploadSize, MAX_ORIGINAL_IMAGE_BYTES, prepareUploadAndPreview } from "../lib/optimizeImageFile";
import { runOrderedPool } from "../lib/orderedPool";
import { extractOriginalCaptureDate } from "../lib/exifCaptureDate";
import type { AlbumCategory, PhotoItem, StoryPayload } from "../types";
import { recommendedTemplateType, TEMPLATE_TYPE_TO_LAYOUT } from "../types";
import PhotoCommentList from "./PhotoCommentList";
import { droppedFileNotices, noPhotosAddedNotice, pickButtonLabel, showsEmptyState, showsSelectionCount, showsSubmitButton } from "../lib/uploadFormView";
import "./UploadForm.css";

const MAX_PHOTOS = 30;
const UPLOAD_TIMEOUT_MS = 600_000;
// How many photos are decoded/encoded at once during preparation.
// ⚠️ MEMORY-REGRESSION DANGER ZONE (fbedc19: many concurrent decodes restarted the
// Android tab). 2 is safe because the preview is only 800px; DO NOT raise this.
const PREPARE_CONCURRENCY = 2;

// Yield to the browser between heavy decodes so a paint can happen. requestAnimationFrame
// guarantees the next frame is scheduled — so the prepare counter actually reaches the
// screen instead of being starved until a scroll forces a repaint. Falls back to
// setTimeout(0) where rAF is unavailable (older webviews / test env).
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

interface UploadFormProps {
  category: AlbumCategory;
  /** Set when the create step was restored after a tab restart: chosen files are
   *  gone, so prompt a re-pick through the existing error slot. */
  photosNeedReselect?: boolean;
  onSuccess: (result: { albumId: string; generationJobId: string | null; previewUrls: string[]; submittedAt: number; responseAt: number; photoCount: number }) => void;
  onCancel?: () => void;
}

function createPhotoItem(file: File, previewBlob: Blob | null, capturedAt: string | null): PhotoItem {
  // Prefer the small 800px preview; fall back to the upload file when it is null
  // (GIF / HEIC / decode failure), preserving the current behavior.
  return { id: createId(), file, previewUrl: URL.createObjectURL(previewBlob ?? file), story: "", capturedAt };
}

export default function UploadForm({ category, photosNeedReselect = false, onSuccess }: UploadFormProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  // Progress of the current preparation batch, shown in the existing count slot.
  const [preparingProgress, setPreparingProgress] = useState<{ done: number; total: number } | null>(null);
  // Eased 0–100 value for the thin prepare bar. The count text stays exact; the bar
  // glides between the coarse (2-at-a-time) completion counts so it doesn't jump.
  const [prepareDisplay, setPrepareDisplay] = useState(0);
  // Two distinct slots: `notice` is neutral information (동영상 제외·중복 제외·장수 초과·
  // 재선택 안내) — no "다시 시도". `error` is a genuine upload failure where retry is
  // meaningful. Keeping them separate stops an informational message from rendering the
  // retry button (which would (re)start an album upload the user never asked for).
  const [notice, setNotice] = useState<string | null>(photosNeedReselect ? "사진을 다시 골라주세요." : null);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationIdRef = useRef<string | null>(null);
  const photosRef = useRef<PhotoItem[]>([]);
  const previewsTransferredRef = useRef(false);
  // Records whether the tab was ever backgrounded — the suspected root of the
  // "네트워크 연결을 확인해주세요" TypeError (backgrounded tab kills the in-flight fetch).
  const wasHiddenRef = useRef(false);

  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") wasHiddenRef.current = true; };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  // Glide the prepare bar toward done/total (no server polling here — the target is just
  // the completion ratio). Reuses the album-creation easing so there's one implementation.
  useEffect(() => {
    if (!isPreparing) { setPrepareDisplay(0); return; }
    const target = preparingProgress && preparingProgress.total > 0
      ? (preparingProgress.done / preparingProgress.total) * 100
      : 0;
    const id = window.setInterval(() => {
      setPrepareDisplay((current) => easeTowardTarget(current, target));
    }, CREATION_PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [isPreparing, preparingProgress]);
  useEffect(() => () => {
    if (!previewsTransferredRef.current) {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    }
  }, []);

  useEffect(() => {
    setCoverPhotoId((current) => (
      current && photos.some((photo) => photo.id === current)
        ? current
        : photos[0]?.id || null
    ));
  }, [photos]);
  const uploadInFlightRef = useRef(false);
  // Videos are filtered out (not supported yet). Count how many the user tried to add
  // across all picks; the total rides along on the upload request as a demand signal
  // (there is no other frontend->backend event path). See createAlbum.
  const droppedVideoCountRef = useRef(0);
  const templateType = recommendedTemplateType(category);
  const totalUploadBytes = photos.reduce((total, photo) => total + photo.file.size, 0);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (isPreparing) return;
    const { accepted, rejectedVideos, rejectedOther } = filterImageFiles(files);
    if (!accepted.length) {
      droppedVideoCountRef.current += rejectedVideos;
      setNotice(noPhotosAddedNotice(rejectedVideos, rejectedOther > 0));
      return;
    }
    const { accepted: unique, duplicates } = dedupeSelectedPhotos(accepted, photos.map((photo) => photo.file));
    const { accepted: limited, skipped } = limitSelectedPhotos(unique, MAX_PHOTOS, photos.length);
    if (!limited.length) {
      setNotice("사진은 한 앨범에 최대 30장까지 올릴 수 있습니다.");
      return;
    }

    setIsPreparing(true);
    setError(null);
    setNotice(null);
    setPreparingProgress({ done: 0, total: limited.length });
    const failures: string[] = [];
    let nextTotal = totalUploadBytes;
    let settledCount = 0;
    try {
      // Prepare up to PREPARE_CONCURRENCY photos at once for speed, but deliver the
      // results in the user's selected order (runOrderedPool) so the album order is
      // preserved. A photo that fails preparation is delivered as a failure and does
      // NOT block the rest.
      await runOrderedPool(
        limited,
        PREPARE_CONCURRENCY,
        async (file) => {
          if (file.size > MAX_ORIGINAL_IMAGE_BYTES) {
            throw { tooBig: true, name: file.name };
          }
          // EXIF failure must not drop the photo — capture date is optional.
          let capturedAt: string | null = null;
          try {
            capturedAt = await extractOriginalCaptureDate(file);
          } catch (cause) {
            console.warn("Capture date extraction failed", { cause, fileName: file.name });
          }
          // One decode yields both the upload file and a small preview blob.
          // Optimization failure falls back to the original file so no photo is lost.
          const { file: prepared, previewBlob } = await prepareUploadAndPreview(file);
          // Yield a frame so decode/canvas buffers can be reclaimed AND the counter
          // paints before the next one starts — relieves the memory spike that
          // restarts the Android tab and keeps the progress visible without a scroll.
          await yieldToPaint();
          return { prepared, previewBlob, capturedAt };
        },
        (result) => {
          // Input order: append photos so the album keeps the user's selected order.
          if (!result.ok) {
            const error = result.error as { tooBig?: boolean; name?: string } | undefined;
            if (error?.tooBig) {
              failures.push(`${error.name}: 이 사진은 용량이 너무 큽니다. 10MB 이하의 사진을 선택해주세요.`);
            }
            return;
          }
          const { prepared, previewBlob, capturedAt } = result.value;
          // Over the total cap: block only this photo; keep everything already chosen.
          if (!fitsWithinUploadTotal(nextTotal, prepared.size)) {
            failures.push("사진이 많아 한 번에 담기 어려워요. 20장 정도로 나눠서 앨범을 만들어 보세요.");
            return;
          }
          const item = createPhotoItem(prepared, previewBlob, capturedAt);
          nextTotal += prepared.size;
          setPhotos((previous) => [...previous, item]);
          setCoverPhotoId((current) => current || item.id);
        },
        () => {
          // Completion order: advance the counter the instant a photo finishes, so it
          // climbs smoothly instead of jumping in chunks when an early photo is slow.
          settledCount += 1;
          setPreparingProgress({ done: settledCount, total: limited.length });
        },
      );
      if (duplicates > 0) failures.push(`사진 ${duplicates}장은 이미 선택되어 추가하지 않았습니다.`);
      if (skipped > 0) failures.push(`사진 ${skipped}장은 추가되지 않았습니다. 한 앨범에는 최대 30장까지 올릴 수 있습니다.`);
      droppedVideoCountRef.current += rejectedVideos;
      failures.push(...droppedFileNotices(rejectedVideos, rejectedOther));
      setNotice(failures.length ? failures.join(" ") : null);
    } finally {
      setIsPreparing(false);
      setPreparingProgress(null);
    }
  }, [isPreparing, photos.length, totalUploadBytes]);

  const removePhoto = (id: string) => {
    setPhotos((previous) => {
      const photo = previous.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return previous.filter((item) => item.id !== id);
    });
  };

  const updatePhotoComment = (id: string, story: string) => {
    setPhotos((previous) => previous.map((photo) => (photo.id === id ? { ...photo, story } : photo)));
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = snapshotSelectedFiles(event.currentTarget.files);
    if (import.meta.env.DEV) console.debug("[Momento] Album picker files selected", { count: selected.length });
    // Reset only after taking a stable copy so the same files can be selected again.
    event.currentTarget.value = "";
    void addFiles(selected);
  };

  const createAlbum = async () => {
    if (isPreparing || isSubmitting || uploadInFlightRef.current) return;
    if (!photos.length) {
      setNotice("사진을 한 장 이상 선택해주세요.");
      return;
    }
    uploadInFlightRef.current = true;
    const submittedAt = performance.now();
    albumCreationTiming("SUBMIT", { photo_count: photos.length });
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    setProgressStep(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutTimer = window.setTimeout(() => controller.abort("timeout"), UPLOAD_TIMEOUT_MS);
    try {
      const formData = new FormData();
      photos.forEach((photo) => formData.append("photos", photo.file, photo.file.name || "photo.jpg"));
      const stories: StoryPayload[] = photos.map((photo, order) => ({ order, user: "", text: photo.story.trim() }));
      formData.append("stories", JSON.stringify(stories));
      formData.append("category", category);
      formData.append("template_type", templateType);
      formData.append("template", TEMPLATE_TYPE_TO_LAYOUT[templateType]);
      formData.append("title", "우리의 추억");
      formData.append("description", "");
      formData.append("file_meta", JSON.stringify(photos.map((photo) => ({ captured_at: photo.capturedAt }))));
      formData.append("cover_photo_order", String(Math.max(0, photos.findIndex((photo) => photo.id === coverPhotoId))));
      // Demand signal only: how many videos the user tried to add (all filtered out).
      formData.append("dropped_video_count", String(droppedVideoCountRef.current));
      const operationId = operationIdRef.current || crypto.randomUUID();
      operationIdRef.current = operationId;
      albumCreationTiming("UPLOAD_REQUEST_STARTED", { photo_count: photos.length });
      // Works logged-in or as a guest; a guest response's token is persisted by uploadAlbum.
      const created = await uploadAlbum(formData, { operationId, signal: controller.signal });
      const responseAt = performance.now();
      operationIdRef.current = null;
      previewsTransferredRef.current = true;
      onSuccess({
        albumId: created.album_id,
        generationJobId: created.generation_job_id ?? null,
        previewUrls: photos.slice(0, 5).map((photo) => photo.previewUrl),
        submittedAt,
        responseAt,
        photoCount: photos.length,
      });
    } catch (cause: unknown) {
      // Visibility diagnostics: a TypeError here is likely a fetch killed by the
      // tab being backgrounded/restarted, not a real network fault. User copy unchanged.
      console.error("Album upload failed", {
        cause,
        photoCount: photos.length,
        visibilityState: document.visibilityState,
        wasHiddenDuringSession: wasHiddenRef.current,
      });
      const reason = cause instanceof DOMException && cause.name === "AbortError"
        ? "요청 시간이 오래 걸리고 있습니다. 네트워크를 확인한 뒤 다시 시도해주세요."
        : cause instanceof TypeError
          ? "네트워크 연결을 확인해주세요."
          : cause instanceof Error ? cause.message : "알 수 없는 오류가 발생했습니다.";
      setError(`업로드에 실패했습니다. ${reason}`);
    } finally {
      window.clearTimeout(timeoutTimer);
      abortRef.current = null;
      uploadInFlightRef.current = false;
      setIsSubmitting(false);
      setProgressStep(null);
    }
  };

  const cancelUpload = () => abortRef.current?.abort();

  const hasPhotos = photos.length > 0;

  return (
    <div className="upload-form story-first-upload">
      <header className="upload-form__intro">
        <h1 className="upload-form__title">어떤 사진을 담을까요?</h1>
        <p className="upload-form__subtitle">한 번에 {MAX_PHOTOS}장까지 담을 수 있어요. 다 담지 못했다면 앨범을 만든 뒤에 더 추가할 수 있어요.<br />고른 순서가 아니라 찍은 날짜로 정리돼요.</p>
      </header>
      <section className="upload-form__picker" aria-label="사진 선택">
        {/* Primary until photos exist; once chosen it steps down to secondary and the
            "앨범 만들기" below becomes the single primary (DESIGN_SYSTEM §7). */}
        <label className={hasPhotos ? "gallery-btn gallery-btn--secondary" : "gallery-btn"}>
          {pickButtonLabel(photos.length)}
          <input className={FILE_INPUT_CLASS} type="file" accept={IMAGE_ACCEPT} multiple onChange={handlePickerChange} />
        </label>
        <label className="upload-form__camera-link">
          바로 촬영하기
          <input className={FILE_INPUT_CLASS} type="file" accept="image/*" capture="environment" multiple onChange={handlePickerChange} />
        </label>
        {showsEmptyState(photos.length) ? (
          <div className="drop-zone" role="button" tabIndex={0} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-zone--active"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-zone--active")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drop-zone--active"); void addFiles(event.dataTransfer.files); }}>
            <p className="drop-zone__title">고른 사진이 여기에 모여요</p>
            <p className="drop-zone__hint">한 번에 {MAX_PHOTOS}장까지 담을 수 있어요. 앨범을 만든 뒤에 더 추가할 수 있어요.</p>
          </div>
        ) : null}
        {showsSelectionCount(photos.length) && !isPreparing ? (
          <p className="upload-form__count" aria-live="polite">{MAX_PHOTOS}장 중 <strong className="upload-form__count-strong">{photos.length}장</strong> · {formatUploadSize(totalUploadBytes)}</p>
        ) : null}
      </section>
      {/* Direct child of .upload-form (not the picker section) so position:sticky stays
          pinned while the user scrolls through the photo list below. */}
      {isPreparing ? (
        <div className="upload-form__preparing" aria-live="polite">
          <p className="upload-form__count upload-form__preparing-text">{preparingProgress && preparingProgress.total > 1 ? `사진을 준비하고 있어요 · ${preparingProgress.total}장 중 ${preparingProgress.done}장` : "사진을 준비하고 있어요"}</p>
          <div className="upload-form__preparing-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prepareDisplay)}>
            <span style={{ width: `${prepareDisplay.toFixed(1)}%` }} />
          </div>
        </div>
      ) : null}
      <PhotoCommentList photos={photos} onCommentChange={updatePhotoComment} onRemove={removePhoto} coverPhotoId={coverPhotoId} onCoverChange={setCoverPhotoId} />
      {showsSubmitButton(photos.length) ? (
        <button type="button" className="upload-form__submit" disabled={isSubmitting || isPreparing || !photos.length} onClick={() => void createAlbum()}>
          {isSubmitting ? "앨범 만드는 중..." : "앨범 만들기"}
        </button>
      ) : null}
      {notice && <p className="upload-form__notice" aria-live="polite">{notice}</p>}
      {error && <p className="upload-form__error">{error}</p>}
      {error && photos.length > 0 && <button type="button" className="upload-form__retry" onClick={() => void createAlbum()}>다시 시도</button>}
      {progressStep !== null && (
        <div className="upload-progress" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="upload-progress-title" aria-describedby="upload-progress-copy">
          <section className="upload-progress__card">
            <div className="upload-progress__character" aria-hidden="true"><span className="upload-progress__glow" /><span className="upload-progress__star" /><span className="upload-progress__spark upload-progress__spark--a" /><span className="upload-progress__spark upload-progress__spark--b" /><span className="upload-progress__spark upload-progress__spark--c" /></div>
            <h2 id="upload-progress-title">우리의 이야기를 만들고 있어요</h2>
            <p id="upload-progress-copy">사진 속 기억을 차곡차곡 모으는 중이에요.</p>
            <div className="upload-progress__bar" role="progressbar" aria-label="앨범 생성 중" aria-valuetext="진행 중"><span /></div>
            <button type="button" className="upload-progress__cancel" onClick={cancelUpload}>그만하기</button>
          </section>
        </div>
      )}
    </div>
  );
}
