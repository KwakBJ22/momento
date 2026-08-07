import type { CSSProperties } from "react";
import PhotoMemoryLines from "./PhotoMemoryLines";
import { usePhotoCommentEdit } from "./PhotoCommentEditContext";
import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import { buildPhotoCaptionSegments } from "./photoCaptionSegments";
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
  priority?: boolean;
}

/** 사진 + 바로 아래 코멘트/기억 (페이지 분할 시 함께 이동) */
export default function PhotoWithMemories({
  photo,
  flowPlan,
  albumKey,
  index,
  isHero = false,
  frameClassName = "",
  priority = false,
}: PhotoWithMemoriesProps) {
  const edit = usePhotoCommentEdit();
  void flowPlan;
  const captionSegments = buildPhotoCaptionSegments(photo);

  const rotation = deterministicPhotoRotation(albumKey, photo.id, index, { isHero });
  const cardStyle: CSSProperties | undefined =
    rotation !== 0 ? { transform: `rotate(${rotation}deg)` } : undefined;

  // 캡션 자리는 이 사진을 내가 쓸 수 있을 때만 비워 둔다(사진마다 다르다 — §7).
  const canEditThisCaption = Boolean(edit?.canEditPhoto(photo.id));
  const showCaption = Boolean(captionSegments?.length) || canEditThisCaption;

  return (
    <div className="photo-block album-photo-card" data-photo-id={photo.id} style={cardStyle}>
      <AlbumPhotoFrame
        src={photo.src}
        alt={photo.alt || ""}
        className={frameClassName}
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
      />
      {showCaption ? (
        <PhotoMemoryLines
          segments={captionSegments}
          variant="caption"
          photoId={photo.id}
          editableText={photo.comment}
          showEditWhenEmpty={canEditThisCaption && !captionSegments?.length}
        />
      ) : null}
    </div>
  );
}
