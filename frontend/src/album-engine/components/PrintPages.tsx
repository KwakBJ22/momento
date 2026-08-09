import { Fragment, type ReactNode } from "react";

import ChapterHeader from "../blocks/ChapterHeader";
import StoryBlock from "../blocks/StoryBlock";
import PhotoMemoryLines from "./PhotoMemoryLines";
import { buildPhotoCaptionSegments } from "./photoCaptionSegments";
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
export const PRINT_PHOTOS_PER_PAGE = 4;

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
  return pages;
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

export default function PrintPages({ album }: { album: BuiltAlbum }): ReactNode {
  const yearFirstChapters = yearFirstChapterIndexes(album.chapters.map((chapter) => chapter.date ?? null));
  return (
    <>
      {album.chapters.map((chapter, chapterIndex) => {
        const pages = chunk(chapter.photos, PRINT_PHOTOS_PER_PAGE);
        const storyTitle = chapter.dateRangeLabel ? `${chapter.dateRangeLabel}의 이야기` : "그날의 이야기";
        return (
          <Fragment key={`print-chapter-${chapter.date ?? chapterIndex}`}>
            {pages.map((photos, pageIndex) => (
              <section
                className="print-page"
                data-print-page=""
                data-photo-count={photos.length}
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
                    showYear={yearFirstChapters.has(chapterIndex)}
                  />
                ) : null}
                <div className="print-page__photos">
                  {photos.map((photo) => <PhotoFrame key={photo.id} photo={photo} />)}
                </div>
                {/* 날짜 이야기는 그 날 마지막 장에 붙는다. */}
                {pageIndex === pages.length - 1 && chapter.storyBody ? (
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
