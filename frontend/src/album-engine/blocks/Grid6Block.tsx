import type { EnginePhoto } from "../types";
import type { MemoryFlowPlan } from "../engine/memoryFlow";
import PhotoWithMemories from "../components/PhotoWithMemories";
import "./Grid6Block.css";

interface Grid6BlockProps {
  photos: EnginePhoto[];
  flowPlan?: MemoryFlowPlan;
  albumKey: string;
  startIndex?: number;
}

export default function Grid6Block({
  photos,
  flowPlan,
  albumKey,
  startIndex = 1,
}: Grid6BlockProps) {
  const items = photos.slice(0, 6);

  return (
    <section className="grid6-block-wrap" aria-label="사진 그리드">
      <div className="grid6-block">
        {items.map((photo, index) => (
          <div key={photo.id} className="grid6-block__cell">
            <PhotoWithMemories
              photo={photo}
              flowPlan={flowPlan}
              albumKey={albumKey}
              index={startIndex + index}
              frameClassName="grid6-block__frame"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
