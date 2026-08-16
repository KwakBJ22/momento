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
  /** 바로 앞 묶음과 **연·월이 같은가**. 같으면 월을 다시 쓰지 않는다 —
   *  `2016년 11월` 이 그 달의 날짜 묶음마다 되풀이되던 것을 막는다(PO 2026-08-15).
   *  ★ 날짜가 같은가(`repeatsDate`)만으로는 모자란다. 날짜가 달라도 달은 같을 수 있다. */
  repeatsMonth?: boolean;
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
  repeatsMonth = false,
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
    //   ★ 장소는 **구(區)까지**다 — 서버가 그렇게 줄여서 저장한다(2026-08-15 PO).
    //     동·번지로는 내려가지 않는다(그건 집 주소다).
    const placeText = showPlace ? (place || "").trim() : "";
    // ★ 날짜를 빼는 것은 **대신 쓸 장소가 있을 때뿐**이다.
    //   갈음할 것이 없으면 줄이 비고, 연필만 남는다(PO 2026-08-14).
    const dropDate = repeatsDate && Boolean(placeText);
    const headParts = [dropDate ? "" : dotRange || "", placeText].filter(Boolean);
    const dateLine = headParts.length ? `${headParts.join(" · ")}${countSuffix}` : null;
    // ★ 날짜 줄을 **날짜 조각과 나머지**로 나눠 둔다(2026-08-16). 글자는 그대로다 —
    //   `여백형` 이 큰 숫자로 일(日)만 키우고 날짜 조각은 감추기 위해서다.
    //   마크업은 6종 공통이고, 무엇을 보일지는 CSS 가 정한다(AlbumSkins.css).
    const dateHead = dropDate ? "" : dotRange || "";
    const dateTail = `${dateHead && placeText ? " · " : ""}${placeText}${countSuffix}`;
    // 큰 숫자로 쓸 **일 두 자리**. 새 데이터가 아니라 날짜에서 잘라 쓴다.
    const dayNumber = date ? date.slice(8, 10) : null;
    // 날짜를 생략한 줄에는 월 표시도 다시 쓰지 않는다 — 바로 위에 이미 있다.
    // ★ 달이 바뀔 때만 쓴다 (PO 2026-08-15). 예전에는 날짜가 같은지만 봐서
    //   `2016년 11월` 이 그 달의 날짜 묶음마다 되풀이됐다. 월 아래 짧은 선은
    //   월과 한 몸이라 월이 없으면 선도 없다(CSS 가 이 요소에 붙어 있다).
    const showMonth = Boolean(monthLine) && !dropDate && !repeatsMonth;

    // ★ 쓸 글자가 없으면 그리지 않는다. 연필 때문에 빈 줄을 만들지 않는다(§11 J-11).
    //   ★ 다만 **주최자에게는** 한 줄을 둔다(2026-08-16). 촬영일이 없는 사진은
    //     (카톡·다운로드로 EXIF 가 지워진 사진이 그렇다) 날짜 줄 자체가 안 그려져
    //     넣을 자리가 없었다. 참여자·구경꾼에게는 그대로 아무것도 없다.
    if (!showMonth && !dateLine) {
      if (!canEditPlace || !placeEdit || !placeKey || isEditingPlace) {
        if (!isEditingPlace) return null;
      } else {
        return (
          <header className="chapter-header chapter-header--date-only date-header" aria-label="날짜">
            <button
              type="button"
              className="chapter-header__add-date"
              onClick={() => placeEdit.startEdit(placeKey, "")}
            >
              날짜 넣기
            </button>
          </header>
        );
      }
    }

    // ★ 그 자리에서 고친다 — 새 시트를 열지 않는다(§7). 이야기 편집과 같은 모양이다.
    if (isEditingPlace && placeEdit && placeKey) {
      return (
        <header className="chapter-header chapter-header--date-only date-header" aria-label="날짜와 장소 수정">
          {showMonth ? <p className="chapter-header__month">{monthLine}</p> : null}
          <div className="chapter-header__place-edit">
            {/* ★ 날짜도 **같은 자리**에서 고친다(2026-08-16). 연필을 하나 더 만들지 않는다.
                날짜가 없어 줄이 안 그려지던 묶음도 이 자리로 들어와 날짜를 넣는다. */}
            {placeEdit.setDateDraft ? (
              <input
                className="chapter-header__place-input chapter-header__date-input"
                value={placeEdit.dateDraft ?? ""}
                onChange={(event) => placeEdit.setDateDraft?.(event.target.value)}
                maxLength={10}
                inputMode="numeric"
                placeholder="언제였나요? (예: 2018.07.08)"
                aria-label="날짜 수정"
              />
            ) : null}
            <input
              className="chapter-header__place-input"
              value={placeEdit.draft}
              onChange={(event) => placeEdit.setDraft(event.target.value)}
              maxLength={40}
              // 구(區)까지 쓴다 — 서버가 저장할 때도 그렇게 줄인다(동·번지로는 안 내려간다).
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
        {/* 큰 숫자(일)는 `여백형` 에서만 보인다 — 다른 모양에서는 CSS 가 감춘다. */}
        {dayNumber && dateLine ? <p className="chapter-header__day" aria-hidden="true">{dayNumber}</p> : null}
        {showMonth ? <p className="chapter-header__month">{monthLine}</p> : null}
        {dateLine ? (
          <p className="chapter-header__dayline">
            <span className="chapter-header__dayline-date">{dateHead}</span>{dateTail}
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
