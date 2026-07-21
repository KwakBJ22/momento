import type { EnginePhoto } from "../types";
import type { MemoryFlowPlan } from "../engine/memoryFlow";
import PhotoWithMemories from "../components/PhotoWithMemories";
import "./Polaroid3Block.css";

interface Polaroid3BlockProps {
  photos: EnginePhoto[];
  flowPlan?: MemoryFlowPlan;
  albumKey: string;
  startIndex?: number;
}

/** 2~4장 균형 grid. 각 사진 아래 코멘트. */
export default function Polaroid3Block({
  photos,
  flowPlan,
  albumKey,
  startIndex = 1,
}: Polaroid3BlockProps) {
  const items = photos.slice(0, 4);

  return (
    <section className="polaroid3-block-wrap" aria-label="사진 묶음">
      <div className={`polaroid3-block polaroid3-block--n${items.length}`}>
        {items.map((photo, index) => (
          <div key={photo.id} className="polaroid3-block__item">
            <PhotoWithMemories
              photo={photo}
              flowPlan={flowPlan}
              albumKey={albumKey}
              index={startIndex + index}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
