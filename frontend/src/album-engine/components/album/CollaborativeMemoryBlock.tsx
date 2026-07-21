import type { MemorySegmentData } from "../../types";
import PhotoMemoryLines from "../PhotoMemoryLines";

interface CollaborativeMemoryBlockProps {
  segments: MemorySegmentData[];
  className?: string;
}

/** @deprecated PhotoMemoryLines로 통합 — 호환용 래퍼 */
export default function CollaborativeMemoryBlock({
  segments,
  className = "",
}: CollaborativeMemoryBlockProps) {
  return <PhotoMemoryLines segments={segments} variant="block" className={className} />;
}
