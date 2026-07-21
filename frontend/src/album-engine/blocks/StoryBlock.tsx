import "./StoryBlock.css";

interface StoryBlockProps {
  body: string;
  title?: string;
  /** AI 생성 요약 — MemoryBlock(사용자 기억)과 구분 */
  variant?: "ai-summary" | "default";
}

/** Chapter 끝 AI 요약. MemoryBlock이 우선이다. */
export default function StoryBlock({
  body,
  title = "이 날의 이야기",
  variant = "ai-summary",
}: StoryBlockProps) {
  if (!body.trim()) return null;
  return (
    <section
      className={`story-block story-block--${variant}`}
      aria-label={title}
      data-story-variant={variant}
    >
      <h3 className="story-block__title">{title}</h3>
      <p className="story-block__body">{body}</p>
    </section>
  );
}
