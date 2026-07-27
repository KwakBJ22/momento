import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { authenticatedFetch } from "../lib/api";
import { createId } from "../lib/id";
import { dedupeSelectedPhotos, FILE_INPUT_CLASS, filterImageFiles, IMAGE_ACCEPT, limitSelectedPhotos, snapshotSelectedFiles } from "../lib/imageFile";
import { formatUploadSize, MAX_ORIGINAL_IMAGE_BYTES, MAX_TOTAL_UPLOAD_BYTES, optimizeImageFile } from "../lib/optimizeImageFile";
import { extractOriginalCaptureDate } from "../lib/exifCaptureDate";
import type { AlbumCategory, AlbumResult, PhotoItem, StoryPayload } from "../types";
import { recommendedTemplateType, TEMPLATE_TYPE_TO_LAYOUT } from "../types";
import PhotoCommentList from "./PhotoCommentList";
import "./UploadForm.css";

const MAX_PHOTOS = 30;
const UPLOAD_TIMEOUT_MS = 600_000;

interface UploadFormProps {
  category: AlbumCategory;
  onSuccess: (result: AlbumResult) => void;
  onCancel?: () => void;
}

function createPhotoItem(file: File, capturedAt: string | null): PhotoItem {
  return { id: createId(), file, previewUrl: URL.createObjectURL(file), story: "", capturedAt };
}

export default function UploadForm({ category, onSuccess }: UploadFormProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [coverPhotoId, setCoverPhotoId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationIdRef = useRef<string | null>(null);

  useEffect(() => {
    setCoverPhotoId((current) => (
      current && photos.some((photo) => photo.id === current)
        ? current
        : photos[0]?.id || null
    ));
  }, [photos]);
  const uploadInFlightRef = useRef(false);
  const templateType = recommendedTemplateType(category);
  const totalUploadBytes = photos.reduce((total, photo) => total + photo.file.size, 0);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (isPreparing) return;
    const { accepted, rejected } = filterImageFiles(files);
    if (!accepted.length) {
      setError(rejected ? "사진 파일을 선택해주세요." : "사진을 선택해주세요.");
      return;
    }
    const { accepted: unique, duplicates } = dedupeSelectedPhotos(accepted, photos.map((photo) => photo.file));
    const { accepted: limited, skipped } = limitSelectedPhotos(unique, MAX_PHOTOS, photos.length);
    if (!limited.length) {
      setError("사진은 한 앨범에 최대 30장까지 올릴 수 있습니다.");
      return;
    }

    setIsPreparing(true);
    setError(null);
    const added: PhotoItem[] = [];
    const failures: string[] = [];
    let nextTotal = totalUploadBytes;
    try {
      for (const file of limited) {
        if (file.size > MAX_ORIGINAL_IMAGE_BYTES) {
          failures.push(`${file.name}: 이 사진은 용량이 너무 큽니다. 25MB 이하의 사진을 선택해주세요.`);
          continue;
        }
        try {
          const capturedAt = await extractOriginalCaptureDate(file);
          const optimized = await optimizeImageFile(file);
          if (nextTotal + optimized.size > MAX_TOTAL_UPLOAD_BYTES) {
            failures.push("선택한 사진의 전체 용량이 너무 큽니다. 용량이 큰 사진을 제외하거나 사진 수를 줄여주세요.");
            continue;
          }
          added.push(createPhotoItem(optimized, capturedAt));
          nextTotal += optimized.size;
        } catch (cause) {
          console.error("Photo preparation failed", { cause, fileName: file.name });
          failures.push(`${file.name}: 이 사진을 준비하지 못했습니다. 다른 사진을 선택해주세요.`);
        }
      }
      if (duplicates > 0) failures.push(`사진 ${duplicates}장은 이미 선택되어 추가하지 않았습니다.`);
      if (skipped > 0) failures.push(`사진 ${skipped}장은 추가되지 않았습니다. 한 앨범에는 최대 30장까지 올릴 수 있습니다.`);
      if (rejected > 0) failures.push("선택한 파일 중 사진이 아닌 항목은 제외했습니다.");
      setPhotos((previous) => [...previous, ...added]);
      setCoverPhotoId((current) => current || added[0]?.id || null);
      setError(failures.length ? failures.join(" ") : null);
    } finally {
      setIsPreparing(false);
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
      setError("사진을 한 장 이상 선택해주세요.");
      return;
    }
    uploadInFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);
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
      const operationId = operationIdRef.current || crypto.randomUUID();
      operationIdRef.current = operationId;
      const headers = { "X-Momento-Operation-Id": operationId };
      const response = await authenticatedFetch("/api/upload-album", { method: "POST", body: formData, signal: controller.signal, headers });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : "앨범을 만들지 못했습니다. 다시 시도해주세요.");
      }
      const created = (await response.json()) as AlbumResult;
      operationIdRef.current = null;
      onSuccess(created);
    } catch (cause: unknown) {
      console.error("Album upload failed", { cause, photoCount: photos.length });
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

  return (
    <div className="upload-form story-first-upload">
      <section className="upload-form__picker" aria-label="사진 선택">
        <label className="gallery-btn">
          사진 고르기
          <input className={FILE_INPUT_CLASS} type="file" accept={IMAGE_ACCEPT} multiple onChange={handlePickerChange} />
        </label>
        <label className="gallery-btn gallery-btn--camera">
          바로 촬영하기
          <input className={FILE_INPUT_CLASS} type="file" accept="image/*" capture="environment" multiple onChange={handlePickerChange} />
        </label>
        <div className="drop-zone" role="button" tabIndex={0} onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("drop-zone--active"); }} onDragLeave={(event) => event.currentTarget.classList.remove("drop-zone--active")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("drop-zone--active"); void addFiles(event.dataTransfer.files); }}>
          <p className="drop-zone__title">여기에 사진을 놓아도 좋아요</p>
          <p className="drop-zone__hint">사진을 최대 {MAX_PHOTOS}장까지 선택할 수 있습니다.</p>
        </div>
        <p className="upload-form__count" aria-live="polite">30장 중 {photos.length}장을 선택했습니다.{photos.length ? ` ${formatUploadSize(totalUploadBytes)}` : ""}</p>
        {isPreparing ? <p className="upload-form__count" aria-live="polite">사진을 업로드하기 좋게 준비하고 있습니다.</p> : null}
      </section>
      <PhotoCommentList photos={photos} onCommentChange={updatePhotoComment} onRemove={removePhoto} coverPhotoId={coverPhotoId} onCoverChange={setCoverPhotoId} />
      <button type="button" className="upload-form__submit" disabled={isSubmitting || isPreparing || !photos.length} onClick={() => void createAlbum()}>
        {isSubmitting ? "앨범 생성 중..." : "앨범 생성하기"}
      </button>
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
