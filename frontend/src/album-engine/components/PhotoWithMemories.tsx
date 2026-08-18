import type { CSSProperties } from "react";

import PhotoMemoryLines from "./PhotoMemoryLines";
import { useAlbumRenderMode } from "./AlbumRenderModeContext";
import { photoOverlapRatio, photoStackOrder, photoTiltDeg } from "../engine/scrapbookLayout";
import { usePhotoCommentEdit } from "./PhotoCommentEditContext";
import AlbumPhotoFrame from "./album/AlbumPhotoFrame";
import PhotoMemoryList from "./PhotoMemoryList";
import { buildPhotoCaptionSegments, buildPhotoMemoryEntries } from "./photoCaptionSegments";
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
  // 한마디는 캡션과 **다른 계층**이다 — 프레임 밖에서 이름과 함께 그린다(K-23 · §7).
  const memoryEntries = buildPhotoMemoryEntries(photo);

  // ★ 인쇄는 정돈, 화면은 리듬(§9 10차). 기울기·겹침은 **화면에서만** 준다 —
  // 인쇄에 새면 결함이다. 값은 사진 ID 로 정해져 새로고침해도 바뀌지 않는다.
  const isScreen = useAlbumRenderMode() === "screen";
  const tilt = isScreen ? photoTiltDeg(photo.id, index, { isHero }) : 0;
  const overlap = isScreen && !isHero ? photoOverlapRatio(dateKey, photo.id, index) : 0;
  void albumKey;
  // ★ 기우는 것은 **프레임 하나**다 — 사진과 캡션이 함께 기운다(§9 12차).
  // 폴라로이드 한 장이 비스듬히 놓인 모양이다. 사진만 돌고 프레임이 서 있으면 따로 놀고(I-1),
  // 캡션을 프레임 밖으로 빼면 어느 사진의 말인지 눈으로 안 보인다(I-1b).
  // ★ K-23 재수정: 흰 여백·테두리·그림자를 가진 요소는 이제 안쪽 `.photo-block__frame` 이다.
  //   바깥 블록은 격자 한 칸일 뿐이라, 한마디를 프레임 형제로 두면 테두리가 그 글을 감싸지 않고
  //   회전도 따라가지 않는다. 그래서 회전은 **프레임에** 붙인다(블록이 아니라).
  // 겹침은 앞 사진 위로 끌어당기는 음수 여백이다. 위로 오는 순서는 고정값이다.
  // ★ 겹침 값만 넘기고 **적용 여부는 CSS 가 정한다** — 격자가 한 칸으로 접히는 좁은 화면에서는
  // 옆 사진이 없어, 그대로 당기면 사진이 화면 밖으로 밀려난다(실측 -37px).
  // 겹침은 칸(블록)이 하는 일이므로 블록에 남는다.
  const blockStyle: CSSProperties | undefined = overlap > 0
    ? ({ "--photo-overlap": overlap, zIndex: photoStackOrder(overlap) } as CSSProperties)
    : undefined;
  const frameStyle: CSSProperties | undefined = tilt !== 0 ? { transform: `rotate(${tilt}deg)` } : undefined;

  // 캡션 자리는 이 사진을 내가 쓸 수 있을 때만 비워 둔다(사진마다 다르다 — §7).
  const canEditThisCaption = Boolean(edit?.canEditPhoto(photo.id));
  const showCaption = Boolean(captionSegments?.length) || canEditThisCaption;

  return (
    <div className="photo-block album-photo-card" data-photo-id={photo.id} data-tilt={tilt || undefined} data-overlap={overlap || undefined} style={blockStyle}>
      {/* 폴라로이드 한 장 — **사진과 캡션만** 담는다(§9). 테두리·그림자·기울기가 여기 있다. */}
      <div className="photo-block__frame" style={frameStyle}>
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
      {/* ★ 한마디는 프레임 **밖**이고 **인쇄되지 않는다**(§7). 그래서 화면일 때만 그린다.
          기울기와 같은 자리에서 화면/인쇄를 가른다 — 판단 근거를 둘로 만들지 않는다. */}
      {isScreen ? <PhotoMemoryList entries={memoryEntries} photoId={photo.id} /> : null}
    </div>
  );
}
