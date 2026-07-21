import type { MemorySegmentData } from "../types";
import {
  buildPhotoMemoryDisplayLines,
  photoMemoryHasAuthors,
  photoMemoryLayoutTier,
} from "./photoMemoryLineUtils";
import "./PhotoMemoryLines.css";

interface PhotoMemoryLinesProps {
  segments?: MemorySegmentData[];
  text?: string | null;
  /** block: 사진 블록 직후 긴 메모, caption: 사진 바로 아래 짧은/중간 메모 */
  variant?: "block" | "caption";
  className?: string;
}

/**
 * 사진 아래 메모 — 카드/말풍선 없이 캡션처럼 자연스럽게 이어진다.
 */
export default function PhotoMemoryLines({
  segments,
  text,
  variant = "block",
  className = "",
}: PhotoMemoryLinesProps) {
  const lines = buildPhotoMemoryDisplayLines(segments, text).slice(0, 2);
  if (!lines.length) return null;

  const tier = photoMemoryLayoutTier(lines);
  const multiAuthor = photoMemoryHasAuthors(lines);

  const classes = [
    "photo-memory-lines",
    `photo-memory-lines--${tier}`,
    `photo-memory-lines--${variant}`,
    multiAuthor ? "photo-memory-lines--multi" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-photo-memory-lines="" data-memory-block="">
      {lines.map((line, index) => (
        <p key={`photo-memory-${index}`} className="photo-memory-lines__line">
          {multiAuthor ? (
            line.showAuthor && line.author ? (
              <span className="photo-memory-lines__author">{line.author}</span>
            ) : (
              <span className="photo-memory-lines__author photo-memory-lines__author--spacer" aria-hidden="true" />
            )
          ) : null}
          <span className="photo-memory-lines__text">{line.text}</span>
        </p>
      ))}
    </div>
  );
}
