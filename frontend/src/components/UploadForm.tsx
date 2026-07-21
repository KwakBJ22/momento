import { useCallback, useRef, useState } from "react";
import { API_BASE, authenticatedFetch } from "../lib/api";
import { createId } from "../lib/id";
import { FILE_INPUT_CLASS, filterImageFiles, IMAGE_ACCEPT } from "../lib/imageFile";
import type {
  AlbumCategory,
  AlbumResult,
  GuestAlbumResult,
  PhotoItem,
  StoryPayload,
} from "../types";
import { recommendedTemplateType, TEMPLATE_TYPE_TO_LAYOUT } from "../types";
import PhotoCommentList from "./PhotoCommentList";
import "./UploadForm.css";

const MAX_PHOTOS = 10;
const UPLOAD_TIMEOUT_MS = 600_000;

interface UploadFormProps {
  category: AlbumCategory;
  onSuccess: (result: AlbumResult) => void;
  guestMode?: boolean;
  onGuestCreated?: (token: string) => void;
  onCancel?: () => void;
}

function createPhotoItem(file: File): PhotoItem {
  return { id: createId(), file, previewUrl: URL.createObjectURL(file), story: "" };
}

export default function UploadForm({
  category,
  onSuccess,
  guestMode = false,
  onGuestCreated,
}: UploadFormProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const templateType = recommendedTemplateType(category);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    try {
      const { accepted, rejected } = filterImageFiles(files);
      if (!accepted.length) {
        setError(
          rejected
            ? "선택한 파일을 사진으로 인식하지 못했어요. JPG, PNG, WEBP, HEIC를 골라주세요."
            : "JPG, PNG, WEBP, GIF, HEIC 사진만 올릴 수 있어요.",
        );
        return;
      }
      setPhotos((previous) => {
        const room = Math.max(0, MAX_PHOTOS - previous.length);
        if (!room) {
          setError(`사진은 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`);
          return previous;
        }
        const next = accepted.slice(0, room).map(createPhotoItem);
        if (accepted.length > room) {
          setError(`최대 ${MAX_PHOTOS}장까지만 추가됐어요.`);
        } else if (rejected > 0) {
          setError(`${rejected}개 파일은 지원하지 않아 제외했어요.`);
        } else {
          setError(null);
        }
        return [...previous, ...next];
      });
    } catch (cause) {
      console.error("addFiles failed", cause);
      setError("사진을 불러오지 못했어요. 다시 한번 골라주세요.");
    }
  }, []);

  const removePhoto = (id: string) =>
    setPhotos((previous) => {
      const photo = previous.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return previous.filter((item) => item.id !== id);
    });

  const updatePhotoComment = (id: string, story: string) => {
    setPhotos((previous) => previous.map((photo) => (photo.id === id ? { ...photo, story } : photo)));
  };

  const createAlbum = async () => {
    if (!photos.length) {
      setError("사진을 한 장 이상 골라주세요.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setProgressStep(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutTimer = window.setTimeout(() => controller.abort("timeout"), UPLOAD_TIMEOUT_MS);
    try {
      const formData = new FormData();
      photos.forEach((photo) => formData.append("photos", photo.file, photo.file.name || "photo.jpg"));
      const stories: StoryPayload[] = photos.map((photo, order) => ({
        order,
        user: "",
        text: photo.story.trim() || "함께한 순간",
      }));
      formData.append("stories", JSON.stringify(stories));
      formData.append("category", category);
      formData.append("template_type", templateType);
      formData.append("template", TEMPLATE_TYPE_TO_LAYOUT[templateType]);
      formData.append("title", "우리의 추억");
      formData.append("description", "");
      formData.append(
        "file_meta",
        JSON.stringify(photos.map((photo) => ({ last_modified: photo.file.lastModified }))),
      );
      const response = guestMode
        ? await fetch(`${API_BASE}/api/guest/upload-album`, {
            method: "POST",
            body: formData,
            signal: controller.signal,
          })
        : await authenticatedFetch("/api/upload-album", {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          typeof body?.detail === "string"
            ? body.detail
            : `서버가 요청을 처리하지 못했어요. (오류 코드 ${response.status})`,
        );
      }
      const created = (await response.json()) as AlbumResult | GuestAlbumResult;
      if ("guest_token" in created) onGuestCreated?.(created.guest_token);
      onSuccess(created);
    } catch (cause: unknown) {
      console.error("Album upload failed", { cause, guestMode, photoCount: photos.length });
      const reason =
        cause instanceof DOMException && cause.name === "AbortError"
          ? "요청 시간이 너무 오래 걸렸어요. 네트워크를 확인한 뒤 다시 시도해주세요."
          : cause instanceof TypeError
            ? "네트워크 연결을 확인해주세요. 연결이 복구되면 다시 시도할 수 있어요."
            : cause instanceof Error
              ? cause.message
              : "알 수 없는 오류가 발생했어요.";
      setError(`업로드에 실패했습니다. ${reason}`);
    } finally {
      window.clearTimeout(timeoutTimer);
      abortRef.current = null;
      setIsSubmitting(false);
      setProgressStep(null);
    }
  };

  const cancelUpload = () => abortRef.current?.abort();

  return (
    <div className="upload-form story-first-upload">
      <section className="upload-form__picker" aria-label="사진 선택">
        {/* label+input: iOS에서 button→input.click()보다 안정적 */}
        <label className="gallery-btn">
          사진 고르기
          <input
            className={FILE_INPUT_CLASS}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className="gallery-btn gallery-btn--camera">
          바로 촬영하기
          <input
            className={FILE_INPUT_CLASS}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <div
          className="drop-zone"
          role="button"
          tabIndex={0}
          onDragOver={(event) => {
            event.preventDefault();
            event.currentTarget.classList.add("drop-zone--active");
          }}
          onDragLeave={(event) => event.currentTarget.classList.remove("drop-zone--active")}
          onDrop={(event) => {
            event.preventDefault();
            event.currentTarget.classList.remove("drop-zone--active");
            addFiles(event.dataTransfer.files);
          }}
        >
          <p className="drop-zone__title">여기에 사진을 끌어다 놓거나</p>
          <p className="drop-zone__hint">위 버튼으로 선택 · 최대 {MAX_PHOTOS}장</p>
        </div>
        {photos.length ? (
          <p className="upload-form__count" aria-live="polite">
            선택됨 {photos.length}/{MAX_PHOTOS}
          </p>
        ) : null}
      </section>
      <PhotoCommentList photos={photos} onCommentChange={updatePhotoComment} onRemove={removePhoto} />
      <button
        type="button"
        className="upload-form__submit"
        disabled={isSubmitting || !photos.length}
        onClick={() => void createAlbum()}
      >
        {isSubmitting ? "앨범 생성 중..." : "앨범 생성하기"}
      </button>
      <button
        type="button"
        className="upload-form__submit"
        disabled={isSubmitting || !photos.length}
        onClick={() => void createAlbum()}
        hidden
      >
        {isSubmitting ? "앨범 만드는 중..." : "이야기 만들기"}
      </button>
      {error && <p className="upload-form__error">{error}</p>}
      {error && photos.length > 0 && (
        <button type="button" className="upload-form__retry" onClick={() => void createAlbum()}>
          다시 시도
        </button>
      )}
      {progressStep !== null && (
        <div
          className="upload-progress"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-labelledby="upload-progress-title"
          aria-describedby="upload-progress-copy"
        >
          <section className="upload-progress__card">
            <div className="upload-progress__character" aria-hidden="true">
              <span className="upload-progress__glow" />
              <span className="upload-progress__star" />
              <span className="upload-progress__spark upload-progress__spark--a" />
              <span className="upload-progress__spark upload-progress__spark--b" />
              <span className="upload-progress__spark upload-progress__spark--c" />
            </div>
            <h2 id="upload-progress-title">우리의 이야기를 만들고 있어요</h2>
            <p id="upload-progress-copy">사진 속 기억을 차곡차곡 모으는 중이에요.</p>
            <div
              className="upload-progress__bar"
              role="progressbar"
              aria-label="이야기 만드는 중"
              aria-valuetext="진행 중"
            >
              <span />
            </div>
            <button type="button" className="upload-progress__cancel" onClick={cancelUpload}>
              그만두기
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
