import { usePhotoCommentEdit } from "./PhotoCommentEditContext";
import { Pencil } from "lucide-react";
import type { MemorySegmentData } from "../types";
import {
  buildPhotoMemoryDisplayLines,
  photoMemoryHasAuthors,
  photoMemoryLayoutTier,
} from "./photoMemoryLineUtils";
import { CAPTION_HINT_REMAINING, CAPTION_MAX_LENGTH } from "../../lib/albumLimits";
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
/**
 * 캡션 길이 안내 — 할 말이 없으면 null 이다(평소에는 아무것도 안 띄운다).
 *
 * ★ 상한을 넘는 경우가 있다: 상한을 낮추기 **전에** 길게 쓴 캡션이다. maxLength 는
 *   이미 있는 글을 자르지 않으므로, 그 사람에게 얼마나 줄여야 하는지 말해 준다.
 */
export function captionLengthNotice(draft: string): string | null {
  const over = draft.length - CAPTION_MAX_LENGTH;
  if (over > 0) return `종이에는 두 줄까지 나와요. ${over}자 줄여 주세요.`;
  if (over >= -CAPTION_HINT_REMAINING) return `${draft.length} / ${CAPTION_MAX_LENGTH}자`;
  return null;
}

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
    edit && photoId && edit.canEditPhoto(photoId)
      && (hasExplicitEditableText || (!photoMemoryHasAuthors(lines) && lines.length <= 1)),
  );
  // 남의 사진 캡션을 열 때는 한 번 묻는다(§7). 경고색을 쓰지 않는다 — 잘못을 지적하는
  // 말이 아니다. 내 사진이면 authorName 이 없어 확인 단계가 아예 뜨지 않는다.
  const captionAuthor = photoId ? edit?.authorNameOf?.(photoId) ?? null : null;
  const isConfirming = canInlineEdit && photoId != null && edit?.confirmingPhotoId === photoId;
  const openEditor = (text: string) => {
    if (!photoId || !edit) return;
    if (edit.requestEdit) edit.requestEdit(photoId, text);
    else edit.startEdit(photoId, text);
  };
  const isEditing = canInlineEdit && edit?.editingPhotoId === photoId;
  const isSaving = canInlineEdit && edit?.savingPhotoId === photoId;

  if (!lines.length && !(showEditWhenEmpty && canInlineEdit)) return null;

  const tier = photoMemoryLayoutTier(lines);
  // ★ **캡션에는 이름을 붙이지 않는다** (CLAUDE.md §6 · 화면_기준 §7).
  //   캡션은 그 사진을 올린 사람의 말이라 이름이 없어도 누구 말인지 자연스럽고,
  //   사진마다 이름이 붙으면 인쇄물이 지저분해진다. 누가 썼는지는 마운트 **밖**
  //   한마디에서 보인다. (시안 v1 에 이름 붙은 판이 있었으나 v2 에서 잡았다.)
  const multiAuthor = variant !== "caption" && photoMemoryHasAuthors(lines);
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

  if (isConfirming && edit && photoId) {
    return (
      <div className={classes} data-photo-memory-lines="" data-memory-block="">
        <div className="photo-memory-lines__confirm">
          <p className="photo-memory-lines__confirm-text">{captionAuthor ? `${captionAuthor}님이 쓴 글이에요. 고칠까요?` : "이 글을 고칠까요?"}</p>
          <div className="photo-memory-lines__edit-actions">
            <button type="button" className="photo-memory-lines__action photo-memory-lines__action--save" onClick={() => edit.confirmEdit?.(photoId)}>고치기</button>
            <button type="button" className="photo-memory-lines__action photo-memory-lines__action--cancel" onClick={() => edit.cancelConfirm?.()}>그만두기</button>
          </div>
        </div>
      </div>
    );
  }

  if (isEditing && edit && photoId) {
    return (
      <div className={classes} data-photo-memory-lines="" data-memory-block="">
        <div className="photo-memory-lines__editor-wrap">
          <textarea
            className="photo-memory-lines__input"
            value={edit.draft}
            onChange={(event) => edit.setDraft(event.target.value)}
            maxLength={CAPTION_MAX_LENGTH}
            rows={2}
            aria-label="한 줄 고치기"
            autoFocus
          />
          {/* ★ 조용히 막지 않는다(§11). 상한에 가까워질 때만 남은 수를 말하고,
              **예전에 길게 쓴 캡션**이면 얼마나 줄여야 하는지 알려 준다. */}
          {captionLengthNotice(edit.draft) ? (
            <p className={`photo-memory-lines__count${edit.draft.length > CAPTION_MAX_LENGTH ? " photo-memory-lines__count--over" : ""}`} aria-live="polite">
              {captionLengthNotice(edit.draft)}
            </p>
          ) : null}
          <div className="photo-memory-lines__edit-actions">
            <button
              type="button"
              className="photo-memory-lines__action photo-memory-lines__action--save"
              onClick={() => edit.saveEdit(photoId)}
              disabled={isSaving || edit.draft.length > CAPTION_MAX_LENGTH}
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
          {edit.error ? <p className="notice notice--error photo-memory-lines__error" role="alert">{edit.error}</p> : null}
          {/* ★ 이 사진을 앨범에서 뺀다 — **맨 아래**다. 되돌릴 수 없는 것이 아래다(§5).
              빨간 **글자만** 쓴다. 배경을 채우지 않는다.
              누구에게 보일지는 서버가 내려준 값이 정한다(주최자는 전부, 참여자는 자기 것만,
              구경꾼에게는 이 함수 자체가 오지 않는다). 묻는 것은 부르는 쪽이 한다. */}
          {edit.canRemovePhoto?.(photoId) && edit.requestRemove ? (
            <button
              type="button"
              className="photo-memory-lines__remove"
              onClick={() => edit.requestRemove?.(photoId)}
              disabled={isSaving}
            >
              이 사진 빼기
            </button>
          ) : null}
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
            onClick={() => openEditor("")}
            aria-label="한 줄 고치기"
          >
            <Pencil size={15} aria-hidden="true" />
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
              onClick={() => openEditor(displayText)}
              aria-label="한 줄 고치기"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
