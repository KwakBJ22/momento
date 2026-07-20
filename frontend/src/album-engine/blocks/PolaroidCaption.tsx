import { preparePolaroidCaption } from "../memoryCaption";
import type { MemorySegmentData } from "../types";
import PhotoMemoryLines from "../components/PhotoMemoryLines";

interface PolaroidCaptionProps {
  text: string | null | undefined;
  segments?: MemorySegmentData[];
  suppressTexts?: string[];
  className?: string;
}

/** 20자 이하 메모 — 사진 아래 짧은 캡션 */
export default function PolaroidCaption({
  text,
  segments,
  suppressTexts,
  className = "",
}: PolaroidCaptionProps) {
  const prepared = preparePolaroidCaption(text, { suppressTexts });
  const filteredSegments =
    segments?.filter((segment) => preparePolaroidCaption(segment.text, { suppressTexts })) ??
    undefined;

  if (!prepared && !filteredSegments?.length) return null;

  return (
    <PhotoMemoryLines
      segments={filteredSegments}
      text={prepared}
      variant="caption"
      className={className}
    />
  );
}
