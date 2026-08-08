import type { CSSProperties } from "react";

import PhotoMemoryLines from "./PhotoMemoryLines";
import { useAlbumRenderMode } from "./AlbumRenderModeContext";
import { photoOverlapRatio, photoStackOrder, photoTiltDeg } from "../engine/scrapbookLayout";
import { usePhotoCommentEdit } from "./PhotoCommentEditContext";
import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import { buildPhotoCaptionSegments } from "./photoCaptionSegments";
import type { MemoryFlowPlan } from "../engine/memoryFlow";
import type { EnginePhoto } from "../types";
import "./PhotoWithMemories.css";

interface PhotoWithMemoriesProps {
  photo: EnginePhoto;
  flowPlan?: MemoryFlowPlan;
  albumKey: string;
  index: number;
  isHero?: boolean;
  /** 겹침을 한 날짜 안에서만 하기 위한 키 — 날짜가 바뀌면 정돈된 자리에서 다시 시작한다. */
  dateKey?: string;
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
  dateKey = "",
  frameClassName = "",
  priority = false,
}: PhotoWithMemoriesProps) {
  const edit = usePhotoCommentEdit();
  void flowPlan;
  const captionSegments = buildPhotoCaptionSegments(photo);

  // ★ 인쇄는 정돈, 화면은 리듬(§9 10차). 기울기·겹침은 **화면에서만** 준다 —
  // 인쇄에 새면 결함이다. 값은 사진 ID 로 정해져 새로고침해도 바뀌지 않는다.
  const isScreen = useAlbumRenderMode() === "screen";
  const tilt = isScreen ? photoTiltDeg(photo.id, index, { isHero }) : 0;
  const overlap = isScreen && !isHero ? photoOverlapRatio(dateKey, photo.id, index) : 0;
  void albumKey;
  // ★ 기울기는 **사진에만** 준다. 캡션은 똑바로 서 있어야 읽힌다(글은 기울이지 않는다).
  const frameStyle: CSSProperties | undefined = tilt !== 0 ? { transform: `rotate(${tilt}deg)` } : undefined;
  // 겹침은 앞 사진 위로 끌어당기는 음수 여백이다. 위로 오는 순서는 고정값이다.
  // ★ 값만 넘기고 **적용 여부는 CSS 가 정한다** — 격자가 한 칸으로 접히는 좁은 화면에서는
  // 옆 사진이 없어, 그대로 당기면 사진이 화면 밖으로 밀려난다(실측 -37px).
  const blockStyle: CSSProperties | undefined = overlap > 0
    ? ({ "--photo-overlap": overlap, zIndex: photoStackOrder(overlap) } as CSSProperties)
    : undefined;

  // 캡션 자리는 이 사진을 내가 쓸 수 있을 때만 비워 둔다(사진마다 다르다 — §7).
  const canEditThisCaption = Boolean(edit?.canEditPhoto(photo.id));
  const showCaption = Boolean(captionSegments?.length) || canEditThisCaption;

  return (
    <div className="photo-block album-photo-card" data-photo-id={photo.id} data-tilt={tilt || undefined} data-overlap={overlap || undefined} style={blockStyle}>
      <AlbumPhotoFrame
        style={frameStyle}
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
