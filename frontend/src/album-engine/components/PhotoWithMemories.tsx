import { createContext, useContext, type CSSProperties } from "react";
import PhotoMemoryLines from "./PhotoMemoryLines";
import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import { getCaptionAction, type MemoryFlowPlan } from "../engine/memoryFlow";
import { deterministicPhotoRotation } from "../engine/deterministicLayout";
import type { EnginePhoto } from "../types";
import "./PhotoWithMemories.css";

export interface PhotoCommentEditor {
  editingPhotoId: string | null;
  draft: string;
  isSaving: boolean;
  onStart: (photoId: string, comment: string) => void;
  onChange: (comment: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const PhotoCommentEditorContext = createContext<PhotoCommentEditor | null>(null);

interface PhotoWithMemoriesProps {
  photo: EnginePhoto;
  flowPlan?: MemoryFlowPlan;
  albumKey: string;
  index: number;
  isHero?: boolean;
  frameClassName?: string;
}

/** 사진 + 바로 아래 코멘트/기억 (페이지 분할 시 함께 이동) */
export default function PhotoWithMemories({
  photo,
  flowPlan,
  albumKey,
  index,
  isHero = false,
  frameClassName = "",
}: PhotoWithMemoriesProps) {
  const editor = useContext(PhotoCommentEditorContext);
  const caption = flowPlan ? getCaptionAction(flowPlan, photo.id) : null;
  const captionSegments = photo.comments?.length
    ? photo.comments.map((entry) => ({ author: entry.author, text: entry.text, photoId: photo.id }))
    : photo.comment?.trim()
      ? [{ author: photo.authorLabel, text: photo.comment, photoId: photo.id }]
      : caption?.segments;

  const rotation = deterministicPhotoRotation(albumKey, photo.id, index, { isHero });
  const frameStyle: CSSProperties | undefined =
    rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : undefined;

  return (
    <div className="photo-block" data-photo-id={photo.id}>
      <AlbumPhotoFrame
        src={photo.src}
        alt={photo.alt || ""}
        className={frameClassName}
        style={frameStyle}
      />
      {captionSegments?.length ? (
        editor && photo.comment?.trim() ? (
          <div className="photo-comment-editor">
            <div className="photo-comment-editor__heading">
              <span>함께한 순간</span>
              {editor.editingPhotoId === photo.id ? null : (
                <button type="button" onClick={() => editor.onStart(photo.id, photo.comment ?? "")}>
                  수정
                </button>
              )}
            </div>
            {editor.editingPhotoId === photo.id ? (
              <div className="photo-comment-editor__form">
                <textarea
                  value={editor.draft}
                  onChange={(event) => editor.onChange(event.target.value)}
                  rows={3}
                  maxLength={300}
                  aria-label="사진 코멘트 수정"
                  autoFocus
                />
                <div className="photo-comment-editor__actions">
                  <button type="button" onClick={editor.onCancel} disabled={editor.isSaving}>취소</button>
                  <button type="button" onClick={editor.onSave} disabled={editor.isSaving}>
                    {editor.isSaving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            ) : (
              <PhotoMemoryLines segments={captionSegments} variant="caption" />
            )}
          </div>
        ) : <PhotoMemoryLines segments={captionSegments} variant="caption" />
      ) : null}
    </div>
  );
}
