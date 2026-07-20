import type { CSSProperties } from "react";
import PhotoMemoryLines from "./PhotoMemoryLines";
import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import { getCaptionAction, type MemoryFlowPlan } from "../engine/memoryFlow";
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
      {captionSegments?.length ? <PhotoMemoryLines segments={captionSegments} variant="caption" /> : null}
    </div>
  );
}
