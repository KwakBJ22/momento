import { Pencil } from "lucide-react";

import "./ChapterHeader.css";
import type { LocationSource } from "../types";
import { formatDotDate, formatKoreanMonth, formatPrintDateHeading } from "../engine/chapterGroup";
import { usePlaceEdit } from "../components/PlaceEditContext";

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
  /** 바로 앞 묶음과 **날짜가 같은가**. 같으면 날짜를 다시 쓰지 않는다 —
   *  한 날에 장소가 둘이면 `2018.07.08 · 제주 서귀포시` 다음은 `제주 성산읍` 만 쓴다.
   *  같은 날짜를 두 번 읽게 하지 않는다(PO 2026-08-13). */
  repeatsDate?: boolean;
  /** 장소를 고칠 때 쓰는 키(날짜 묶음 키) — 없으면 연필을 그리지 않는다. */
  placeKey?: string | null;
  /** 이 날짜 묶음의 사진들. 저장은 **전부**에 같은 장소를 넣는다. */
  placePhotoIds?: string[];
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
  repeatsDate = false,
  placeKey = null,
  placePhotoIds = [],
}: ChapterHeaderProps) {
  const showPlace = Boolean(place?.trim()) && locationSource !== "unknown";
  const estimated = locationSource === "ai_estimated";
  // 장소 고치기 — 주최자에게만 온다(부르는 쪽이 null 을 넘긴다). 인쇄에는 오지 않는다.
  const placeEdit = usePlaceEdit();
  const canEditPlace = Boolean(placeEdit?.canEdit && placeKey);
  const isEditingPlace = canEditPlace && placeEdit?.editingKey === placeKey;
  const isSavingPlace = canEditPlace && placeEdit?.savingKey === placeKey;

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
    // ★ 날짜 · 장소 (사진 N장) — 이 순서다 (PO 2026-08-13).
    //   앞 묶음과 날짜가 같으면 날짜를 빼고 장소부터 쓴다: `제주 성산읍 (사진 2장)`.
    //   같은 날짜를 두 번 읽게 하지 않는다.
    //   ★ 장소는 시·군까지만이다 — 서버가 그렇게 줄여서 저장한다(집 주소가 드러나면 안 된다).
    const placeText = showPlace ? (place || "").trim() : "";
    const headParts = [repeatsDate ? "" : dotRange || "", placeText].filter(Boolean);
    const dateLine = headParts.length ? `${headParts.join(" · ")}${countSuffix}` : null;
    // 날짜를 생략한 줄에는 월 표시도 다시 쓰지 않는다 — 바로 위에 이미 있다.
    const showMonth = Boolean(monthLine) && !repeatsDate;

    if (!showMonth && !dateLine && !canEditPlace) return null;

    // ★ 그 자리에서 고친다 — 새 시트를 열지 않는다(§7). 이야기 편집과 같은 모양이다.
    if (isEditingPlace && placeEdit && placeKey) {
      return (
        <header className="chapter-header chapter-header--date-only date-header" aria-label="날짜">
          {showMonth ? <p className="chapter-header__month">{monthLine}</p> : null}
          <div className="chapter-header__place-edit">
            <input
              className="chapter-header__place-input"
              value={placeEdit.draft}
              onChange={(event) => placeEdit.setDraft(event.target.value)}
              maxLength={40}
              // 시·군까지만 쓴다 — 서버가 저장할 때도 그렇게 줄인다(집 주소가 드러나면 안 된다).
              placeholder="어디였나요? (예: 제주 서귀포시)"
              aria-label="장소 수정"
              autoFocus
            />
            <div className="chapter-header__place-actions">
              <button
                type="button"
                className="chapter-header__place-action chapter-header__place-action--save"
                onClick={() => placeEdit.saveEdit(placeKey, placePhotoIds)}
                disabled={isSavingPlace}
              >
                {isSavingPlace ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                className="chapter-header__place-action"
                onClick={() => placeEdit.cancelEdit()}
                disabled={isSavingPlace}
              >
                취소
              </button>
            </div>
            {/* 비우고 저장하면 장소가 지워진다 — 지우는 길을 따로 만들지 않는다. */}
            <p className="chapter-header__place-hint">비워 두고 저장하면 장소가 지워져요.</p>
            {placeEdit.error ? (
              <p className="notice notice--error chapter-header__place-error" role="alert">{placeEdit.error}</p>
            ) : null}
          </div>
        </header>
      );
    }

    return (
      <header className="chapter-header chapter-header--date-only date-header" aria-label="날짜">
        {showMonth ? <p className="chapter-header__month">{monthLine}</p> : null}
        {dateLine || canEditPlace ? (
          <p className="chapter-header__dayline">
            {dateLine}
            {estimated ? <span className="chapter-header__badge">추정</span> : null}
            {canEditPlace && placeEdit && placeKey ? (
              <button
                type="button"
                className="chapter-header__edit-btn"
                onClick={() => placeEdit.startEdit(placeKey, showPlace ? (place || "").trim() : "")}
                aria-label={showPlace ? "장소 수정" : "장소 넣기"}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            ) : null}
          </p>
        ) : null}
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
