import { usePhotoCommentEdit } from "./PhotoCommentEditContext";
import type { MemorySegmentData } from "../types";
import {
  buildPhotoMemoryDisplayLines,
  photoMemoryHasAuthors,
  photoMemoryLayoutTier,
} from "./photoMemoryLineUtils";
import "./PhotoMemoryLines.css";

interface PhotoMemoryLinesProps {
  segments?: MemorySegmentData[];
  text?: string | null;
  /** block: 사진 블록 직후 긴 메모, caption: 사진 바로 아래 짧은/중간 메모 */
  variant?: "block" | "caption";
  className?: string;
  photoId?: string;
  /** The album owner's saved photo comment, separate from participant memories. */
  editableText?: string | null;
  /** 코멘트가 없을 때도 수정 버튼만 표시 */
  showEditWhenEmpty?: boolean;
}

/**
 * 사진 아래 메모 — 카드/말풍선 없이 캡션처럼 자연스럽게 이어진다.
 */
export default function PhotoMemoryLines({
  segments,
  text,
  variant = "block",
  className = "",
  photoId,
  editableText,
  showEditWhenEmpty = false,
}: PhotoMemoryLinesProps) {
  const edit = usePhotoCommentEdit();
  const lines = buildPhotoMemoryDisplayLines(segments, text).slice(0, 2);
  const hasExplicitEditableText = editableText !== undefined;
  const canInlineEdit = Boolean(
    edit?.canEdit
      && photoId
      && (hasExplicitEditableText || (!photoMemoryHasAuthors(lines) && lines.length <= 1)),
  );
  const isEditing = canInlineEdit && edit?.editingPhotoId === photoId;
  const isSaving = canInlineEdit && edit?.savingPhotoId === photoId;

  if (!lines.length && !(showEditWhenEmpty && canInlineEdit)) return null;

  const tier = photoMemoryLayoutTier(lines);
  const multiAuthor = photoMemoryHasAuthors(lines);
  const displayText = hasExplicitEditableText ? (editableText ?? "").trim() : (lines[0]?.text ?? "");

  const classes = [
    "photo-memory-lines",
    `photo-memory-lines--${tier}`,
    `photo-memory-lines--${variant}`,
    multiAuthor ? "photo-memory-lines--multi" : "",
    isEditing ? "photo-memory-lines--editing" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (isEditing && edit && photoId) {
    return (
      <div className={classes} data-photo-memory-lines="" data-memory-block="">
        <div className="photo-memory-lines__editor-wrap">
          <textarea
            className="photo-memory-lines__input"
            value={edit.draft}
            onChange={(event) => edit.setDraft(event.target.value)}
            maxLength={300}
            rows={2}
            aria-label="사진 코멘트 수정"
            autoFocus
          />
          <div className="photo-memory-lines__edit-actions">
            <button
              type="button"
              className="photo-memory-lines__action photo-memory-lines__action--save"
              onClick={() => edit.saveEdit(photoId)}
              disabled={isSaving}
            >
              {isSaving ? "저장 중..." : "저장"}
            </button>
            <button
              type="button"
              className="photo-memory-lines__action photo-memory-lines__action--cancel"
              onClick={() => edit.cancelEdit()}
              disabled={isSaving}
            >
              취소
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!lines.length && showEditWhenEmpty && canInlineEdit && edit && photoId) {
    return (
      <div className={classes} data-photo-memory-lines="" data-memory-block="">
        <div className="photo-memory-lines__row photo-memory-lines__row--empty">
          <span className="photo-memory-lines__text photo-memory-lines__text--placeholder" aria-hidden="true">
            &nbsp;
          </span>
          <button
            type="button"
            className="photo-memory-lines__edit-btn"
            onClick={() => edit.startEdit(photoId, "")}
            aria-label="사진 코멘트 수정"
          >
            수정
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={classes} data-photo-memory-lines="" data-memory-block="">
      {lines.map((line, index) => (
        <div key={`photo-memory-${index}`} className="photo-memory-lines__row">
          <p className="photo-memory-lines__line">
            {multiAuthor ? (
              line.showAuthor && line.author ? (
                <span className="photo-memory-lines__author">{line.author}</span>
              ) : (
                <span className="photo-memory-lines__author photo-memory-lines__author--spacer" aria-hidden="true" />
              )
            ) : null}
            <span className="photo-memory-lines__text">{line.text}</span>
          </p>
          {canInlineEdit && index === 0 && edit && photoId ? (
            <button
              type="button"
              className="photo-memory-lines__edit-btn"
              onClick={() => edit.startEdit(photoId, displayText)}
              aria-label="사진 코멘트 수정"
            >
              수정
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
