import "./ChapterHeader.css";
import type { LocationSource } from "../types";
import { formatDotDate, formatKoreanMonth, formatPrintDateHeading } from "../engine/chapterGroup";

interface ChapterHeaderProps {
  dayIndex: number;
  date: string | null;
  dateLabel: string | null;
  dateRangeLabel?: string | null;
  title?: string;
  place?: string | null;
  locationSource?: LocationSource | null;
  description?: string | null;
  photoCount?: number | null;
  participantCount?: number | null;
  kind?: "day" | "event" | "neutral";
  /** `print-date` 는 열람용 PDF 전용이다 — 날짜 한 줄만(§9 · I-4-3). */
  variant?: "default" | "date-only" | "print-date";
  /** print-date 에서 연도를 함께 쓸지. 해가 바뀌는 앨범의 그 해 첫 날짜에만 참이다. */
  showYear?: boolean;
}

/** Chapter 구분 헤더 — 날짜 그룹 상단 중앙 */
export default function ChapterHeader({
  dayIndex,
  date,
  dateRangeLabel,
  title,
  place,
  locationSource,
  photoCount,
  kind = "event",
  variant = "date-only",
  showYear = false,
}: ChapterHeaderProps) {
  const showPlace = Boolean(place?.trim()) && locationSource !== "unknown";
  const estimated = locationSource === "ai_estimated";

  // 열람용 PDF — 남는 것은 **날짜 하나**다(§9 · I-4-3).
  // `2018년 11월` 줄은 매 쪽 같은 값이라 없앴다(표지에 이미 있다).
  // `(사진 N장)` 도 없앴다 — 세는 것은 앨범이 할 일이 아니다.
  if (variant === "print-date") {
    const line = date ? formatPrintDateHeading(date, showYear) : dateRangeLabel || null;
    if (!line) return null;
    return (
      <header className="chapter-header chapter-header--print-date date-header" aria-label="날짜">
        <p className="chapter-header__dayline">{line}</p>
      </header>
    );
  }

  if (variant === "date-only") {
    const monthLine = date ? formatKoreanMonth(date) : null;
    const dotRange = dateRangeLabel || (date ? formatDotDate(date) : null);
    const countSuffix =
      typeof photoCount === "number" && photoCount > 0 ? ` (사진 ${photoCount}장)` : "";
    const dateLine = dotRange ? `${dotRange}${countSuffix}` : null;

    if (!monthLine && !dateLine) return null;

    return (
      <header className="chapter-header chapter-header--date-only date-header" aria-label="날짜">
        {monthLine ? <p className="chapter-header__month">{monthLine}</p> : null}
        {dateLine ? <p className="chapter-header__dayline">{dateLine}</p> : null}
      </header>
    );
  }

  const eventTitle = title || (kind === "day" ? `Day ${dayIndex}` : "함께한 순간");

  return (
    <header className="chapter-header" aria-label={eventTitle}>
      <div className="chapter-header__panel">
        <h3 className="chapter-header__title">{eventTitle}</h3>
        <div className="chapter-header__meta">
          {dateRangeLabel ? <span className="chapter-header__date">{dateRangeLabel}</span> : null}
          {showPlace ? (
            <span className="chapter-header__place">
              {place}
              {estimated ? <span className="chapter-header__badge">추정</span> : null}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
