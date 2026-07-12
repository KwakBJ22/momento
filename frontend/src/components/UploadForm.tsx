import { useCallback, useRef, useState } from "react";
import { authenticatedFetch } from "../lib/api";
import type {
  AlbumResult,
  MeetingType,
  PhotoItem,
  StoryPayload,
  TemplateType,
} from "../types";
import "./UploadForm.css";

const MAX_PHOTOS = 10;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

const MEETING_TYPES: { value: MeetingType; label: string; emoji: string }[] = [
  { value: "family", label: "가족", emoji: "👨‍👩‍👧‍👦" },
  { value: "friend", label: "친구", emoji: "🧡" },
  { value: "work", label: "직장인", emoji: "💼" },
  { value: "university", label: "대학생", emoji: "🎓" },
];

const TEMPLATES: { value: TemplateType; label: string; desc: string }[] = [
  { value: "A", label: "타임라인", desc: "시간순 원형 배치" },
  { value: "B", label: "콜라주", desc: "격자 그리드" },
  { value: "C", label: "스토리북", desc: "대표사진 + 이야기" },
];

interface UploadFormProps {
  onSuccess: (result: AlbumResult) => void;
}

function createPhotoItem(file: File): PhotoItem {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    story: "",
  };
}

function todayString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function UploadForm({ onSuccess }: UploadFormProps) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayString());
  const [meetingType, setMeetingType] = useState<MeetingType>("family");
  const [template, setTemplate] = useState<TemplateType>("B");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => ALLOWED_TYPES.includes(f.type));
    if (incoming.length === 0) {
      setError("JPG, PNG, WEBP, GIF, HEIC 형식의 사진만 올릴 수 있어요.");
      return;
    }
    setPhotos((prev) => {
      const remaining = MAX_PHOTOS - prev.length;
      if (remaining <= 0) {
        setError(`사진은 최대 ${MAX_PHOTOS}장까지 담을 수 있어요.`);
        return prev;
      }
      setError(null);
      return [...prev, ...incoming.slice(0, remaining).map(createPhotoItem)];
    });
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (photos.length === 0) {
      setError("최소 1장의 사진을 올려주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      photos.forEach((p) => formData.append("photos", p.file));

      const stories: StoryPayload[] = photos.map((p, index) => ({
        order: index,
        user: "",
        text: p.story.trim() || "",
      }));
      formData.append("stories", JSON.stringify(stories));
      formData.append("meeting_type", meetingType);
      formData.append("template", template);
      formData.append("title", title.trim() || "우리의 모임");
      formData.append("date", date);

      const response = await authenticatedFetch("/api/upload-album", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = body?.detail;
        const message =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: { msg?: string }) => d.msg).join(", ")
              : "앨범 생성에 실패했어요.";
        throw new Error(message);
      }

      onSuccess((await response.json()) as AlbumResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <section>
        <h2 className="section-title">모임 정보</h2>
        <label className="field">
          <span className="field__label">모임 제목</span>
          <input
            type="text"
            className="field__input"
            placeholder="예: 제주도 여행"
            value={title}
            maxLength={40}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">날짜</span>
          <input
            type="date"
            className="field__input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </section>

      <section className="meeting-type">
        <h2 className="section-title">우리 모임은 어떤 모임인가요?</h2>
        <div className="chip-grid">
          {MEETING_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              className={`chip ${meetingType === type.value ? "is-active" : ""}`}
              onClick={() => setMeetingType(type.value)}
              aria-pressed={meetingType === type.value}
            >
              <span className="chip__emoji">{type.emoji}</span>
              <span className="chip__label">{type.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">앨범 스타일</h2>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`template-card ${template === t.value ? "is-active" : ""}`}
              onClick={() => setTemplate(t.value)}
              aria-pressed={template === t.value}
            >
              <img
                className="template-card__preview"
                src={`/templates/${t.value}.png`}
                alt={`${t.label} 템플릿 미리보기`}
                loading="lazy"
              />
              <span className="template-card__label">{t.label}</span>
              <span className="template-card__desc">{t.desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">사진을 담아주세요</h2>

        <button type="button" className="gallery-btn" onClick={() => inputRef.current?.click()}>
          <span className="gallery-btn__icon">🖼️</span>
          갤러리에서 사진 고르기
        </button>
        <button
          type="button"
          className="gallery-btn gallery-btn--camera"
          onClick={() => cameraRef.current?.click()}
        >
          <span className="gallery-btn__icon">📷</span>
          카메라로 촬영하기
        </button>

        <div
          className={`drop-zone ${isDragging ? "drop-zone--active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <p className="drop-zone__title">여기로 사진을 끌어다 놓아도 돼요</p>
          <p className="drop-zone__hint">최대 {MAX_PHOTOS}장 · JPG, PNG, WEBP, GIF, HEIC</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {photos.length > 0 && (
        <section>
          <p className="upload-form__hint">
            사진을 올리면 AI가 기억 질문을 만들어요. 답변은 다음 단계에서 함께 적을 수 있어요.
          </p>
          <ul className="photo-list">
            {photos.map((photo, index) => (
              <li key={photo.id} className="photo-card">
                <div className="photo-card__top">
                  <img
                    src={photo.previewUrl}
                    alt={`업로드 사진 ${index + 1}`}
                    className="photo-card__preview"
                  />
                  <button
                    type="button"
                    className="photo-card__remove"
                    onClick={() => removePhoto(photo.id)}
                    aria-label="사진 삭제"
                  >
                    ✕
                  </button>
                  <span className="photo-card__badge">사진 {index + 1}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="upload-form__error">{error}</p>}

      <button
        type="submit"
        className="upload-form__submit"
        disabled={isSubmitting || photos.length === 0}
      >
        {isSubmitting ? "앨범 만드는 중..." : "사진 올리고 질문 받기"}
      </button>
    </form>
  );
}
