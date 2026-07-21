import { prepareMemoryCaption } from "../memoryCaption";
import type { MemorySegmentData } from "../types";
import PhotoMemoryLines from "../components/PhotoMemoryLines";

interface MemoryCaptionProps {
  text: string | null | undefined;
  segments?: MemorySegmentData[];
  /** @deprecated Polaroid Caption은 PolaroidCaption 컴포넌트 사용 */
  mode?: "default" | "short";
  suppressTexts?: string[];
  storyBody?: string | null;
  className?: string;
}

/** 21~80자 메모 — 사진 아래 캡션 */
export default function MemoryCaption({
  text,
  segments,
  mode = "default",
  suppressTexts,
  storyBody,
  className = "",
}: MemoryCaptionProps) {
  const prepared = prepareMemoryCaption(text, { mode, suppressTexts, storyBody });
  const filteredSegments =
    segments?.filter((segment) =>
      prepareMemoryCaption(segment.text, { mode, suppressTexts, storyBody }),
    ) ?? undefined;

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
