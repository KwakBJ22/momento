import type { EnginePhoto } from "../types";
import type { MemoryFlowPlan } from "../engine/memoryFlow";
import PhotoWithMemories from "../components/PhotoWithMemories";
import "./HeroBlock.css";

interface HeroBlockProps {
  photo: EnginePhoto;
  title: string;
  body?: string;
  flowPlan?: MemoryFlowPlan;
  albumKey: string;
}

/** 대표사진 → Caption → 제목. 긴 메모는 PhotoWithMemories 내부. */
export default function HeroBlock({ photo, title, body = "", flowPlan, albumKey }: HeroBlockProps) {
  return (
    <section className="hero-block" aria-label="대표 사진">
      <PhotoWithMemories
        photo={photo}
        flowPlan={flowPlan}
        albumKey={albumKey}
        index={0}
        isHero
        frameClassName="hero-block__frame"
      />
      <div className="hero-block__copy">
        {title.trim() ? <h3 className="hero-block__title">{title}</h3> : null}
        {body.trim() ? <p className="hero-block__body">{body}</p> : null}
      </div>
    </section>
  );
}

