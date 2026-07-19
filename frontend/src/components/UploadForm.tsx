import { useCallback, useRef, useState } from "react";
import { API_BASE, authenticatedFetch } from "../lib/api";
import type { AlbumResult, GuestAlbumResult, MeetingType, PhotoItem, StoryPayload } from "../types";
import PhotoCommentList from "./PhotoCommentList";
import "./UploadForm.css";

const MAX_PHOTOS = 10;
// Album composition includes Storage and AI calls. Do not abort a healthy long-running request at two minutes.
const UPLOAD_TIMEOUT_MS = 600_000;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

const ENRICHMENT_QUESTIONS = [
  { key: "memory_hint", title: "한 줄만 알려주시면 더 좋은 이야기를 만들 수 있어요", placeholder: "예: 오랜만에 모두 모인 날이에요" },
  { key: "people", title: "사진 속 사람을 알려주세요", placeholder: "예: 할머니, 엄마, 지우" },
  { key: "highlight", title: "가장 기억나는 순간은 무엇인가요?", placeholder: "예: 모두 함께 웃었던 저녁" },
] as const;

interface UploadFormProps {
  onSuccess: (result: AlbumResult) => void;
  guestMode?: boolean;
  onGuestCreated?: (token: string) => void;
  onCancel?: () => void;
}

function createPhotoItem(file: File): PhotoItem {
  return { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), story: "" };
}

export default function UploadForm({ onSuccess, guestMode = false, onGuestCreated, onCancel: _onCancel }: UploadFormProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [mode, setMode] = useState<"quick" | "special">("quick");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number | null>(null);
  const [isBackgroundProcessing, setIsBackgroundProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter((file) => ALLOWED_TYPES.includes(file.type));
    if (!incoming.length) {
      setError("JPG, PNG, WEBP, GIF, HEIC 사진만 올릴 수 있어요.");
      return;
    }
    setPhotos((previous) => [...previous, ...incoming.slice(0, MAX_PHOTOS - previous.length).map(createPhotoItem)]);
    setError(null);
  }, []);

  const removePhoto = (id: string) => setPhotos((previous) => {
    const photo = previous.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    return previous.filter((item) => item.id !== id);
  });

  const updatePhotoComment = (id: string, story: string) => {
    setPhotos((previous) => previous.map((photo) => (photo.id === id ? { ...photo, story } : photo)));
  };

  const movePhoto = (id: string, direction: -1 | 1) => {
    setPhotos((previous) => {
      const currentIndex = previous.findIndex((photo) => photo.id === id);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= previous.length) return previous;
      const next = [...previous];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return next;
    });
  };

  const createAlbum = async () => {
    if (!photos.length) {
      setError("사진을 한 장 이상 골라주세요.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setProgressStep(0);
    setIsBackgroundProcessing(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const progressTimers = [window.setTimeout(() => setProgressStep(1), 2500), window.setTimeout(() => setProgressStep(2), 6500)];
    const backgroundTimer = window.setTimeout(() => setIsBackgroundProcessing(true), 30_000);
    const timeoutTimer = window.setTimeout(() => controller.abort("timeout"), UPLOAD_TIMEOUT_MS);
    try {
      const formData = new FormData();
      photos.forEach((photo) => formData.append("photos", photo.file));
      const stories: StoryPayload[] = photos.map((photo, order) => ({ order, user: "", text: photo.story.trim() }));
      formData.append("stories", JSON.stringify(stories));
      formData.append("meeting_type", "family" satisfies MeetingType);
      formData.append("template", "B");
      formData.append("title", "우리의 추억");
      formData.append("description", ENRICHMENT_QUESTIONS.map((question) => answers[question.key]?.trim()).filter(Boolean).join("\n"));
      const response = guestMode
        ? await fetch(`${API_BASE}/api/guest/upload-album`, { method: "POST", body: formData, signal: controller.signal })
        : await authenticatedFetch("/api/upload-album", { method: "POST", body: formData, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : `서버가 요청을 처리하지 못했어요. (오류 코드 ${response.status})`);
      }
      const created = (await response.json()) as AlbumResult | GuestAlbumResult;
      if ("guest_token" in created) onGuestCreated?.(created.guest_token);
      onSuccess(created);
    } catch (cause: any) {
      console.error("Album upload failed", { cause, guestMode, photoCount: photos.length });
      const reason = cause instanceof DOMException && cause.name === "AbortError"
        ? "요청 시간이 너무 오래 걸렸어요. 네트워크를 확인한 뒤 다시 시도해주세요."
        : cause instanceof TypeError
          ? "네트워크 연결을 확인해주세요. 연결이 복구되면 다시 시도할 수 있어요."
          : cause instanceof Error ? cause.message : "알 수 없는 오류가 발생했어요.";
      setError(`업로드에 실패했습니다. ${reason}`);
    } finally {
      progressTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(backgroundTimer);
      window.clearTimeout(timeoutTimer);
      abortRef.current = null;
      setIsSubmitting(false);
      setProgressStep(null);
    }
  };

  const cancelUpload = () => abortRef.current?.abort();

  const currentQuestion = ENRICHMENT_QUESTIONS[step];
  const advance = () => {
    if (step < ENRICHMENT_QUESTIONS.length - 1) setStep((value) => value + 1);
    else void createAlbum();
  };

  return (
    <div className="upload-form story-first-upload">
      {mode === "quick" ? (
        <>
          <section className="story-first-upload__hero">
            <h2>사진만 올리면 앨범이 완성돼요</h2>
            <p>제목과 이야기는 Momento가 자연스럽게 준비할게요.</p>
          </section>
          <PhotoCommentList photos={photos} onCommentChange={updatePhotoComment} onMove={movePhoto} onRemove={removePhoto} />
          <section>
            <button type="button" className="gallery-btn" onClick={() => inputRef.current?.click()}>🖼️ 사진 고르기</button>
            <button type="button" className="gallery-btn gallery-btn--camera" onClick={() => cameraRef.current?.click()}>📷 바로 촬영하기</button>
            <div className="drop-zone" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()}>
              <p className="drop-zone__title">사진을 끌어다 놓아도 돼요</p>
              <p className="drop-zone__hint">최대 {MAX_PHOTOS}장 · 사진만으로 바로 만들기</p>
            </div>
          </section>
          {photos.length > 0 && <ul className="photo-list">{photos.map((photo, index) => <li key={photo.id} className="photo-card"><div className="photo-card__top"><img src={photo.previewUrl} alt={`선택한 사진 ${index + 1}`} className="photo-card__preview" /><button type="button" className="photo-card__remove" onClick={() => removePhoto(photo.id)} aria-label="사진 삭제">✕</button><span className="photo-card__badge">사진 {index + 1}</span></div></li>)}</ul>}
          <button type="button" className="upload-form__submit" disabled={isSubmitting || !photos.length} onClick={() => void createAlbum()}>{isSubmitting ? "앨범 만드는 중..." : "사진으로 바로 만들기"}</button>
          <button type="button" className="story-first-upload__secondary" onClick={() => setMode("special")}>더 특별하게 만들기</button>
        </>
      ) : (
        <section className="story-first-upload__question">
          <p className="story-first-upload__eyebrow">선택형 보강</p>
          <h2>{currentQuestion.title}</h2>
          <textarea className="field__input field__textarea" rows={3} value={answers[currentQuestion.key] || ""} placeholder={currentQuestion.placeholder} onChange={(event) => setAnswers((previous) => ({ ...previous, [currentQuestion.key]: event.target.value }))} />
          <p className="upload-form__hint">비워두고 넘어가도 앨범은 충분히 완성돼요.</p>
          <button type="button" className="upload-form__submit" disabled={isSubmitting} onClick={advance}>{isSubmitting ? "앨범 만드는 중..." : step === ENRICHMENT_QUESTIONS.length - 1 ? "이야기와 함께 만들기" : "다음"}</button>
          <button type="button" className="story-first-upload__secondary" disabled={isSubmitting} onClick={advance}>건너뛰기</button>
          <button type="button" className="link-btn" onClick={() => setMode("quick")}>빠른 만들기로 돌아가기</button>
        </section>
      )}
      {error && <p className="upload-form__error">{error}</p>}
      {error && <button type="button" className="upload-form__retry" onClick={() => void createAlbum()}>다시 시도</button>}
      {progressStep !== null && (
        <div className="upload-progress" role="dialog" aria-modal="true" aria-live="assertive" aria-label="앨범 생성 진행 상황">
          <section className="upload-progress__card">
            <div className="upload-progress__spinner" aria-hidden="true" />
            <h2>{isBackgroundProcessing ? "백그라운드에서 앨범을 마무리하고 있어요" : ["사진을 업로드하고 있어요...", "AI가 추억을 정리하고 있어요...", "이야기의 흐름을 만들고 있어요..."][progressStep]}</h2>
            <p>{isBackgroundProcessing ? "처리가 길어지고 있지만 계속 진행 중이에요. 완료되면 바로 앨범을 보여드릴게요." : "잠시만 기다려주세요."}</p>
            <ol className="upload-progress__steps">
              {["사진 업로드", "AI 분석", "스토리 생성", "완료"].map((label, index) => <li key={label} className={index <= progressStep ? "is-active" : ""}>{label}</li>)}
            </ol>
            <button type="button" className="upload-progress__cancel" onClick={cancelUpload}>업로드 취소</button>
          </section>
        </div>
      )}
      <input ref={inputRef} type="file" accept={ALLOWED_TYPES.join(",")} multiple hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
    </div>
  );
}
