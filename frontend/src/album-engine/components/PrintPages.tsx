import { Fragment, type CSSProperties, type ReactNode } from "react";

import ChapterHeader from "../blocks/ChapterHeader";
import StoryBlock from "../blocks/StoryBlock";
import PhotoMemoryLines from "./PhotoMemoryLines";
import { buildPhotoCaptionSegments } from "./photoCaptionSegments";
// ★ 캡션 높이 계산(printCaptionExtraMm)은 정사각 판형에서 쓰지 않는다 — 캡션대가
//   14mm 고정이라 늘어날 것이 없다. 그 계산은 printCaptionFit.ts 에 그대로 둔다.
import { printCaptionNeedsOwnPage } from "./printCaptionFit";
import { formatKoreanMonth } from "../engine/chapterGroup";
import type { BuiltAlbum } from "../buildAlbum";
import type { EnginePhoto } from "../types";
import "./PrintPages.css";

/**
 * 열람용 PDF 의 본문 — **A4 한 장 = 여기 한 덩어리** (SCREEN_SPEC §9).
 *
 *   날짜 머리글 + 그 날의 사진들 (한 장에 최대 4장)
 *   사진마다 프레임, 프레임 안에 캡션
 *   "YYYY.MM.DD의 이야기"
 *
 * ★ 화면과 **같은 chapter 데이터**로 짠다. 순서·글자·계층이 화면과 같아야 하고
 *   (§9 "내용이 달라지면 안 된다"), 다른 것은 레이아웃뿐이다.
 * ★ A4 한 장에 사진을 4장 넘게 넣지 않는다. 많이 넣으면 한 장 한 장이 작아져
 *   무엇을 찍었는지 안 보인다(§6 — 사진이 가장 중요하다).
 * ★ 날짜 머리글은 그 날 **첫 장**에만 붙는다. 머리글만 앞 장에 남는 일이 없다.
 * ★ 날짜 이야기는 그 날 **마지막 장**에 붙는다.
 *
 * 페이지 경계: 각 덩어리가 CSS 로 정확히 A4 한 장 높이(aspect-ratio 210/297)라서
 * 잘릴 자리가 생기지 않는다. 프레임이 페이지에 걸치는 일 자체가 없다.
 */

/** A4 한 장에 담는 사진 수 상한 — 이 값을 올리지 않는다(§9). */
/* 한 쪽에 담는 사진 수 — 시안 §4 의 배치가 **6장까지** 있다(3단).
   ★ 4 → 6 (2026-08-19). 배치가 1·2·3·4·6장으로 늘면서 한 쪽이 담을 수 있는 양도
     늘었다. 쪽수가 줄어 종이값이 내려가고, 6장 쪽은 3단이라 사진이 작아진다 —
     그 균형은 시안이 정한 것이다. */
export const PRINT_PHOTOS_PER_PAGE = 6;

/** ★ 사진의 짧은 변은 이보다 작아지지 않는다 (I-4b-5). 38mm 는 엄지손톱만 하다. */
export const PRINT_MIN_PHOTO_SHORT_SIDE_MM = 60;

/**
 * 날짜 이야기가 함께 들어가는 쪽에 담는 사진 수 상한 (I-4c-3 · I-4d-3).
 *
 * ★ **먼저 한 쪽에 넣어 본다.** 두 칸 격자(2×2)로 돌아오면서 4장 + 이야기가 한 쪽에
 * 들어가고, 그 크기에서도 짧은 변 60mm 하한을 지킨다(세로 상한 80mm → 3:4 폭 60mm).
 * 그래서 지금은 4장까지 그대로 둔다 — 나누면 종이만 두 장 쓰고 사진이 작아진다.
 *
 * 이 값을 낮춰야 할 때(사진이 더 작아지는 배치로 바뀔 때)를 위해 나누는 길은 남겨 둔다.
 */
export const STORY_PAGE_MAX_PHOTOS = 4;

/** 나눠야 할 때 **앞 쪽**에 남기는 사진 수 (4c: 4장 → 2/2 · 3장 → 2/1). */
export const STORY_SPLIT_FRONT_PHOTOS = 2;

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
  return pages;
}

/**
 * 캡션이 아주 긴 사진을 **제 묶음**으로 떼어낸다 (I-4g).
 *
 * 그런 사진이 다른 사진과 한 쪽을 쓰면 그 쪽 사진이 전부 같이 작아진다.
 * 혼자 두면 그 사진만 작아지고 나머지는 그대로다. 순서는 지킨다.
 */
function splitLongCaptions<T>(photos: T[], needsOwnPage?: (photo: T) => boolean): T[][] {
  if (!needsOwnPage) return [photos];
  const runs: T[][] = [];
  let run: T[] = [];
  for (const photo of photos) {
    if (!needsOwnPage(photo)) {
      run.push(photo);
      continue;
    }
    if (run.length) runs.push(run);
    runs.push([photo]);
    run = [];
  }
  if (run.length) runs.push(run);
  return runs.length ? runs : [photos];
}

/**
 * 그 날의 사진을 쪽으로 나눈다 (I-4c-3).
 *
 * ★ **글만 있는 쪽을 만들지 않는다.** 날짜 이야기는 그 날의 **마지막 사진과 같은
 * 쪽**에 둔다. 자리가 모자라면 이야기를 넘기지 말고 **사진을 나눈다.**
 *
 * 나눌 때의 모양(4c 규칙):
 *   4장 + 이야기  →  2장 / 2장 + 이야기
 *   3장 + 이야기  →  2장 / 1장 + 이야기
 *
 * 예전에는 이야기를 다음 쪽으로 넘겼는데(4b-5), 글 세 줄만 있는 쪽이 생겨 더 나빴다.
 * ★ 지금은 두 칸 격자라 4장 + 이야기가 한 쪽에 들어가므로 나눌 일이 없다(I-4d-3).
 */
export function paginateChapterPhotos<T>(
  photos: T[],
  hasStory: boolean,
  maxWithStory: number = STORY_PAGE_MAX_PHOTOS,
  /** ★ 캡션이 아주 긴 사진은 **혼자** 한 쪽을 쓴다(I-4g). 주지 않으면 지금 그대로다. */
  needsOwnPage?: (photo: T) => boolean,
): T[][] {
  const pages = splitLongCaptions(photos, needsOwnPage).flatMap((run) => chunk(run, PRINT_PHOTOS_PER_PAGE));
  if (!hasStory || !pages.length) return pages;
  const last = pages[pages.length - 1];
  if (last.length <= maxWithStory) return pages;
  // 나눌 때는 앞 쪽에 2장, 이야기가 붙는 쪽에 나머지(4c 규칙 그대로).
  const keep = Math.min(last.length - 1, STORY_SPLIT_FRONT_PHOTOS);
  return [...pages.slice(0, -1), last.slice(0, keep), last.slice(keep)];
}

/**
 * 그 쪽의 사진 상한에서 뺄 높이 (I-4g).
 *
 * ★ **2026-08-16 부터 늘 0이다.** 정사각 판형은 캡션대 높이가 14mm 로 고정이고
 *   캡션이 두 줄에서 잘리므로(PrintPages.css) 늘어날 높이가 없다. A4 시절 계산
 *   (printCaptionFit.ts)은 **지우지 않고 둔다** — 정사각이 제대로 나오는 것을 본 뒤에
 *   정리한다(PO 결정: A4 코드를 먼저 지우지 않는다).
 */
function printCaptionExtraStyle(photos: EnginePhoto[]): CSSProperties | undefined {
  void photos;
  return undefined;
}


function PhotoFrame({ photo }: { photo: EnginePhoto }) {
  const segments = buildPhotoCaptionSegments(photo);
  return (
    // ★ 프레임은 **인쇄물에서만** 만든다. 화면의 "카드·테두리 금지"(CLAUDE.md §6)는
    // 화면 규칙이고, 여기서는 캡션이 그 사진에 딸린 말임을 보이기 위한 레이아웃이다.
    <figure className="print-frame" data-photo-id={photo.id}>
      <div className="print-frame__photo">
        <img src={photo.src} alt={photo.alt || ""} loading="eager" decoding="sync" />
      </div>
      {segments?.length ? (
        <figcaption className="print-frame__caption">
          <PhotoMemoryLines segments={segments} variant="caption" photoId={photo.id} />
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * 연도를 붙일 챕터 = **그 해의 첫 날짜**. 한 해 안에서 끝나는 앨범이면 비어 있다
 * (표지에 연도가 이미 있으므로 본문에서는 한 번도 쓰지 않는다 — §9 · I-4-3).
 */
export function yearFirstChapterIndexes(dates: Array<string | null>): Set<number> {
  const seen = new Set<string>();
  const first: Array<[number, string]> = [];
  dates.forEach((date, index) => {
    const year = date?.slice(0, 4);
    if (!year || seen.has(year)) return;
    seen.add(year);
    first.push([index, year]);
  });
  // 해가 하나뿐이면 연도를 아예 쓰지 않는다.
  return seen.size <= 1 ? new Set() : new Set(first.map(([index]) => index));
}

/**
 * 달이 바뀌는 자리 — 그 앞에 **월 시작 쪽**을 한 장 세운다 (시안 §3).
 *
 * ★ 달이 하나뿐인 앨범에는 세우지 않는다. 한 장을 통째로 쓰는 쪽이라, 나눌 것이
 *   없는데 세우면 종이만 늘어난다.
 * ★ 날짜가 없는 묶음은 달을 알 수 없으므로 세지 않는다(맨 뒤에 서는 그 묶음이다).
 */
export function monthFirstChapterIndexes(dates: Array<string | null>): Set<number> {
  const seen = new Set<string>();
  const first: Array<[number, string]> = [];
  dates.forEach((date, index) => {
    const month = date?.slice(0, 7);
    if (!month || seen.has(month)) return;
    seen.add(month);
    first.push([index, month]);
  });
  return seen.size <= 1 ? new Set() : new Set(first.map(([index]) => index));
}

/** 그 달에 든 날 수와 사진 수 — `여섯 날 · 사진 21장` 을 만드는 값이다. */
export function monthSummary(
  chapters: Array<{ date: string | null; photos: unknown[] }>,
  fromIndex: number,
): { days: number; photos: number } {
  const month = chapters[fromIndex]?.date?.slice(0, 7);
  let days = 0;
  let photos = 0;
  for (let index = fromIndex; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (chapter.date?.slice(0, 7) !== month) break;
    days += 1;
    photos += chapter.photos.length;
  }
  return { days, photos };
}

/**
 * 이야기가 길어 **지면 하나를 글에 내줄** 때인가 (시안 §3 `글만 있는 쪽`).
 *
 * 쪽 안에 붙는 이야기 자리는 `--pr-story: 50mm` 다. 크롬에서 그 자리에 실제로 몇 글자가
 * 들어가는지 재 봤더니 **282자**였다(제목 포함 · 글줄 폭 129mm). 그보다 길면 글이
 * 잘리거나 사진을 밀어내므로, 그 날은 글에 한 쪽을 주고 사진을 다음 쪽으로 넘긴다.
 *
 * ★ 날짜 이야기는 원래 3~6줄이다(CLAUDE.md §6). 이 갈래는 **드물게** 걸린다 —
 *   흔하게 걸리면 앨범이 글 모음이 된다.
 * ★ 값을 여기 하나에 둔다. 화면은 이 판정을 쓰지 않는다(인쇄만이다).
 */
export const STORY_OWN_PAGE_MIN_CHARS = 280;

export function storyNeedsOwnPage(body: string | null | undefined): boolean {
  return (body ?? "").trim().length > STORY_OWN_PAGE_MIN_CHARS;
}

export default function PrintPages({ album }: { album: BuiltAlbum }): ReactNode {
  const yearFirstChapters = yearFirstChapterIndexes(album.chapters.map((chapter) => chapter.date ?? null));
  const monthFirstChapters = monthFirstChapterIndexes(album.chapters.map((chapter) => chapter.date ?? null));
  return (
    <>
      {album.chapters.map((chapter, chapterIndex) => {
        // 글이 제 쪽을 가져가면 사진 쪽은 이야기 자리를 비워 둘 필요가 없다.
        const storyOwnPage = storyNeedsOwnPage(chapter.storyBody);
        const inlineStory = Boolean(chapter.storyBody) && !storyOwnPage;
        const pages = paginateChapterPhotos(
          chapter.photos,
          inlineStory,
          STORY_PAGE_MAX_PHOTOS,
          printCaptionNeedsOwnPage,
        );
        const storyTitle = chapter.dateRangeLabel ? `${chapter.dateRangeLabel}의 이야기` : "그날의 이야기";
        const month = monthFirstChapters.has(chapterIndex) && chapter.date
          ? monthSummary(album.chapters, chapterIndex)
          : null;
        return (
          <Fragment key={`print-chapter-${chapter.date ?? chapterIndex}`}>
            {/* 월 시작 쪽 — 큰 숫자 하나로 달이 바뀐 것을 알린다(시안 §3).
                사진을 넣지 않는 쪽이라 아래쪽에 무게를 모으고 위를 크게 비운다. */}
            {month && chapter.date ? (
              <section className="print-page print-page--month" data-print-page="" key={`print-month-${chapter.date}`}>
                <p className="print-month__number">{chapter.date.slice(5, 7)}</p>
                <div className="print-month__line">
                  <h2 className="print-month__title">{formatKoreanMonth(chapter.date)}</h2>
                  <span className="print-month__rule" aria-hidden="true" />
                  <span className="print-month__meta">{`${month.days}일 · 사진 ${month.photos}장`}</span>
                </div>
              </section>
            ) : null}
            {/* 글만 있는 쪽 — 이야기가 길면 지면 하나를 글에 내주고 사진은 다음 쪽으로
                넘긴다(시안 §3). 두 단으로 나눠 한 줄이 너무 길어지지 않게 한다. */}
            {storyOwnPage && chapter.storyBody ? (
              <section
                className="print-page print-page--story"
                data-print-page=""
                key={`print-story-${chapter.date ?? chapterIndex}`}
              >
                <ChapterHeader
                  dayIndex={chapter.dayIndex}
                  date={chapter.date}
                  dateLabel={chapter.dateLabel}
                  dateRangeLabel={chapter.dateRangeLabel}
                  title={chapter.title}
                  place={chapter.place}
                  locationSource={chapter.locationSource}
                  kind={chapter.kind}
                  variant="print-date"
                  photoCount={chapter.photos.length}
                />
                <div className="print-story__columns">
                  <StoryBlock title={storyTitle} body={chapter.storyBody} storyKey={chapter.date ?? String(chapterIndex)} />
                </div>
              </section>
            ) : null}
            {pages.map((photos, pageIndex) => (
              <section
                className="print-page"
                data-print-page=""
                data-photo-count={photos.length}
                /* ★ 캡션이 두 줄을 넘으면 넘은 만큼 사진 상한을 낮춘다(I-4g).
                   프레임 높이가 그대로라 쪽을 넘지 않는다. */
                style={printCaptionExtraStyle(photos)}
                /* 날짜 이야기가 같이 들어가는 쪽은 사진 자리가 좁다 — 사진 상한이 달라진다(I-4-4). */
                data-has-story={pageIndex === pages.length - 1 && inlineStory ? "" : undefined}
                key={`print-page-${chapter.date ?? chapterIndex}-${pageIndex}`}
              >
                {/* 머리글은 그 날 첫 장에만 — 머리글만 앞 장에 남으면 안 된다(§9). */}
                {pageIndex === 0 ? (
                  <ChapterHeader
                    dayIndex={chapter.dayIndex}
                    date={chapter.date}
                    dateLabel={chapter.dateLabel}
                    dateRangeLabel={chapter.dateRangeLabel}
                    title={chapter.title}
                    place={chapter.place}
                    locationSource={chapter.locationSource}
                    kind={chapter.kind}
                    variant="print-date"
                    photoCount={chapter.photos.length}
                    showYear={yearFirstChapters.has(chapterIndex)}
                  />
                ) : null}
                <div className="print-page__photos">
                  {photos.map((photo) => <PhotoFrame key={photo.id} photo={photo} />)}
                </div>
                {/* 날짜 이야기는 그 날 마지막 장에 붙는다 — 다만 사진이 많은 쪽에서는
                    사진이 60mm 아래로 작아지므로 다음 쪽으로 넘긴다(I-4b-5). */}
                {pageIndex === pages.length - 1 && inlineStory && chapter.storyBody ? (
                  <StoryBlock title={storyTitle} body={chapter.storyBody} storyKey={chapter.date ?? String(chapterIndex)} />
                ) : null}
              </section>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}
