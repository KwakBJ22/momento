import type { MemorySegmentData } from "../../types";
import PhotoMemoryLines from "../PhotoMemoryLines";

interface MemoryBlockProps {
  text?: string;
  segments?: MemorySegmentData[];
  className?: string;
}

/** 사용자 기억 — 사진 아래 자연스러운 줄 나열 */
export default function MemoryBlock({ text, segments, className = "" }: MemoryBlockProps) {
  return (
    <PhotoMemoryLines
      segments={segments}
      text={text}
      variant="block"
      className={className}
    />
  );
}
