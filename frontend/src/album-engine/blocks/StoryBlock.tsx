import { Pencil } from "lucide-react";
import { useDateStoryEdit } from "../components/DateStoryEditContext";
import "./StoryBlock.css";

interface StoryBlockProps {
  body: string;
  title?: string;
  /** AI 생성 요약 — MemoryBlock(사용자 기억)과 구분 */
  variant?: "ai-summary" | "default";
  /** 날짜 이야기 인라인 수정 키 (YYYY-MM-DD). 없으면 수정 불가. */
  storyKey?: string;
}

/** Chapter 끝 날짜 이야기. 소유자는 제목/에필로그처럼 인라인 수정한다. */
export default function StoryBlock({
  body,
  title = "이 날의 이야기",
  variant = "ai-summary",
  storyKey,
}: StoryBlockProps) {
  const edit = useDateStoryEdit();
  const canEdit = Boolean(edit?.canEdit && storyKey);
  const hasBody = body.trim().length > 0;

  // Print/share-without-owner and non-eligible empty dates render nothing.
  if (!hasBody && !canEdit) return null;

  const isEditing = canEdit && edit?.editingKey === storyKey;
  const isSaving = canEdit && edit?.savingKey === storyKey;

  if (isEditing && edit && storyKey) {
    return (
      <section className={`story-block story-block--${variant} story-block--editing`} aria-label={title}>
        <h3 className="story-block__title">{title}</h3>
        <textarea
          className="story-block__input"
          value={edit.draft}
          onChange={(event) => edit.setDraft(event.target.value)}
          maxLength={800}
          rows={4}
          aria-label={`${title} 수정`}
          autoFocus
        />
        <div className="story-block__edit-actions">
          <button
            type="button"
            className="story-block__action story-block__action--save"
            onClick={() => edit.saveEdit(storyKey)}
            disabled={isSaving}
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
          <button
            type="button"
            className="story-block__action story-block__action--cancel"
            onClick={() => edit.cancelEdit()}
            disabled={isSaving}
          >
            취소
          </button>
        </div>
        {edit.error ? <p className="story-block__error" role="alert">{edit.error}</p> : null}
      </section>
    );
  }

  if (!hasBody && canEdit && edit && storyKey) {
    return (
      <section className={`story-block story-block--${variant} story-block--empty`} aria-label={title}>
        <h3 className="story-block__title">{title}</h3>
        <button
          type="button"
          className="story-block__empty-hint"
          onClick={() => edit.startEdit(storyKey, "")}
        >
          <Pencil size={16} aria-hidden="true" />
          <span>이 날의 이야기를 남겨보세요</span>
        </button>
      </section>
    );
  }

  return (
    <section
      className={`story-block story-block--${variant}`}
      aria-label={title}
      data-story-variant={variant}
    >
      <div className="story-block__head">
        <h3 className="story-block__title">{title}</h3>
        {canEdit && edit && storyKey ? (
          <button
            type="button"
            className="story-block__edit-btn"
            onClick={() => edit.startEdit(storyKey, body)}
            aria-label={`${title} 수정`}
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="story-block__body">{body}</p>
    </section>
  );
}
