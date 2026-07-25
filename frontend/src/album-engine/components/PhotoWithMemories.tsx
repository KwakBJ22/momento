import type { CSSProperties } from "react";
import PhotoMemoryLines from "./PhotoMemoryLines";
import { usePhotoCommentEdit } from "./PhotoCommentEditContext";
import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import type { MemoryFlowPlan } from "../engine/memoryFlow";
import { deterministicPhotoRotation } from "../engine/deterministicLayout";
import type { EnginePhoto } from "../types";
import "./PhotoWithMemories.css";

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
  const edit = usePhotoCommentEdit();
  void flowPlan;
  const captionSegments = (() => {
    const fromComments = photo.comments?.length
      ? photo.comments.map((entry) => ({ author: entry.author, text: entry.text, photoId: photo.id }))
      : [];
    const ownerText = photo.comment?.trim();
    if (ownerText && !fromComments.some((entry) => entry.text === ownerText)) {
      fromComments.unshift({ author: photo.authorLabel, text: ownerText, photoId: photo.id });
    }
    if (fromComments.length) return fromComments;
    return undefined;
  })();

  const rotation = deterministicPhotoRotation(albumKey, photo.id, index, { isHero });
  const frameStyle: CSSProperties | undefined =
    rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : undefined;

  const showCaption = Boolean(captionSegments?.length) || Boolean(edit?.canEdit);

  return (
    <div className="photo-block" data-photo-id={photo.id}>
      <AlbumPhotoFrame
        src={photo.src}
        alt={photo.alt || ""}
        className={frameClassName}
        style={frameStyle}
      />
      {showCaption ? (
        <PhotoMemoryLines
          segments={captionSegments}
          variant="caption"
          photoId={photo.id}
          showEditWhenEmpty={Boolean(edit?.canEdit && !captionSegments?.length)}
        />
      ) : null}
    </div>
  );
}
