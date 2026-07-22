import type { ReactNode } from "react";
import ChapterHeader from "./blocks/ChapterHeader";
import EndingBlock from "./blocks/EndingBlock";
import Grid6Block from "./blocks/Grid6Block";
import HeroBlock from "./blocks/HeroBlock";
import Polaroid3Block from "./blocks/Polaroid3Block";
import StoryBlock from "./blocks/StoryBlock";
import MemoryBlock from "./components/album/MemoryBlock";
import {
  chapterBucketsFromGroups,
  formatDotDateRange,
  formatKoreanDate,
  groupPhotosIntoChapterBuckets,
  toDateKey,
} from "./engine/chapterGroup";
import { selectLayout } from "./engine/layoutSelector";
import { planMemoryFlow, type MemoryFlowPlan } from "./engine/memoryFlow";
import { normalizeMemoryText } from "./memoryCaption";
import { getOrientation } from "./orientation";
import { sortEnginePhotos } from "./photoOrder";
import type {
  AlbumChapter,
  BuildAlbumContext,
  EnginePhoto,
  LayoutBlock,
  LayoutSelection,
  LayoutSelectorContext,
  PhotoOrientation,
} from "./types";

/** @deprecated AlbumDayGroup — use AlbumChapter */
export interface AlbumDayGroup {
  dateKey: string | null;
  label: string | null;
  photos: EnginePhoto[];
}

export interface BuiltAlbum {
  coverDateLabel: string;
  chapters: AlbumChapter[];
  /** @deprecated use chapters */
  groups: AlbumDayGroup[];
  photos: EnginePhoto[];
  layout: LayoutSelection;
  elements: ReactNode[];
  memoryFlows: MemoryFlowPlan[];
  /** 앨범 하단 에필로그 (Stage 밖 렌더) */
  epilogue: string | null;
}

// Existing MVP agreement: a date story needs at least five photos from that date.
export const MIN_DATE_STORY_PHOTO_COUNT = 5;

export function formatCoverDateLabel(takenAts: Array<string | null | undefined>): string {
  const keys = [
    ...new Set(takenAts.map(toDateKey).filter((value): value is string => Boolean(value))),
  ].sort();
  if (!keys.length) {
    return new Date().toISOString().slice(0, 10).replaceAll("-", ".");
  }
  const start = keys[0].replaceAll("-", ".");
  if (keys.length === 1) return start;
  return `${start} ~ ${keys[keys.length - 1].replaceAll("-", ".")}`;
}

/** @deprecated use groupPhotosIntoChapterBuckets */
export function groupPhotosByTakenDate(photos: EnginePhoto[]): AlbumDayGroup[] {
  return groupPhotosIntoChapterBuckets(sortEnginePhotos(photos)).map((bucket) => ({
    dateKey: bucket.date,
    label: bucket.date ? bucket.date.replaceAll("-", ".") : null,
    photos: bucket.photos,
  }));
}

function renderBlock(
  item: LayoutBlock,
  index: number,
  chapter: AlbumChapter,
  context: BuildAlbumContext,
  options: {
    isFirstChapter: boolean;
    isLastChapter: boolean;
    coverDateLabel: string;
    flowPlan: MemoryFlowPlan;
    albumKey: string;
  },
): ReactNode {
  const { isLastChapter, coverDateLabel, flowPlan, albumKey } = options;
  switch (item.kind) {
    case "Hero": {
      const hero = item.photos[0];
      if (!hero) return null;
      return (
        <HeroBlock
          key={`${chapter.date ?? "ch"}-hero-${hero.id}-${index}`}
          photo={hero}
          title=""
          body=""
          flowPlan={flowPlan}
          albumKey={albumKey}
        />
      );
    }
    case "Polaroid3":
      return (
        <Polaroid3Block
          key={`${chapter.date ?? "ch"}-polaroid-${index}`}
          photos={item.photos}
          flowPlan={flowPlan}
          albumKey={albumKey}
        />
      );
    case "Grid6":
      return (
        <Grid6Block
          key={`${chapter.date ?? "ch"}-grid-${index}`}
          photos={item.photos}
          flowPlan={flowPlan}
          albumKey={albumKey}
        />
      );
    case "MemoryBlock": {
      if (!item.segments?.length && !item.text?.trim()) return null;
      const multiPhoto =
        (item.photos?.length ?? 0) > 1 ||
        (item.segments ?? []).some(
          (segment) => segment.photoId && segment.photoId !== item.sourcePhotoId,
        );
      if (!multiPhoto && item.sourcePhotoId) return null;
      return (
        <div key={`${chapter.date ?? "ch"}-memory-${item.sourcePhotoId ?? index}`} className="photo-block">
          <MemoryBlock text={item.text} segments={item.segments} />
        </div>
      );
    }
    case "Story":
      // chapter.story 제거 — 에필로그는 AlbumResult에서만 렌더
      return chapter.storyBody ? (
        <StoryBlock
          key={`${chapter.date ?? "chapter"}-story-${index}`}
          title={chapter.dateRangeLabel ? `${chapter.dateRangeLabel}의 이야기` : "이날의 이야기"}
          body={chapter.storyBody}
        />
      ) : null;
    case "Ending":
      if (!isLastChapter) return null;
      return (
        <EndingBlock
          key={`${chapter.date ?? "ch"}-ending-${index}`}
          title={context.title}
          dateLabel={context.coverDateLabel ?? coverDateLabel}
        />
      );
    default:
      return null;
  }
}

/**
 * Album → Chapter[] → Blocks
 * 월별 이야기 없음. 에필로그는 context.epilogue로만 반환(Stage 밖).
 */
export function buildAlbum(photos: EnginePhoto[], context: BuildAlbumContext): BuiltAlbum {
  const ordered = sortEnginePhotos(photos);
  const coverDateLabel =
    context.coverDateLabel || formatCoverDateLabel(ordered.map((photo) => photo.takenAt));

  const fromGroups = context.groups?.length
    ? chapterBucketsFromGroups(
        context.groups.map((group) => ({
          ...group,
          photos: group.photos?.length ? group.photos : ordered,
        })),
      )
    : null;
  const buckets = fromGroups ?? groupPhotosIntoChapterBuckets(ordered);
  const epilogue = normalizeMemoryText(context.epilogue ?? context.endingStory) || null;
  const albumKey = context.albumId || context.title || "album";

  const memoryFlows: MemoryFlowPlan[] = [];

  const chapters: AlbumChapter[] = buckets.map((bucket, index) => {
    const layout = selectLayout(bucket.photos, { category: context.category });
    const isLast = index === buckets.length - 1;

    const flowPlan = planMemoryFlow(bucket.photos, { storyBody: null });
    memoryFlows.push(flowPlan);

    let blocks: LayoutBlock[] = layout.blocks.filter(
      (item) => item.kind !== "MemoryBlock" && item.kind !== "Story",
    );
    const storyKey = bucket.date ?? String(index);
    const storyBody = normalizeMemoryText(context.chapterStories?.[storyKey]) || null;
    if (bucket.photos.length >= MIN_DATE_STORY_PHOTO_COUNT && storyBody) {
      const endingIndex = blocks.findIndex((item) => item.kind === "Ending");
      const storyBlock: LayoutBlock = { kind: "Story", photos: [] };
      if (endingIndex >= 0) blocks.splice(endingIndex, 0, storyBlock);
      else blocks.push(storyBlock);
    }
    // Story 블록 제거 (월별 이야기 미사용)
    const filteredBlocks = isLast
      ? blocks
      : blocks.filter((item) => item.kind !== "Ending");

    return {
      date: bucket.date,
      endDate: bucket.endDate ?? bucket.date,
      title: bucket.title,
      dateLabel: bucket.dateLabel ?? (bucket.date ? formatKoreanDate(bucket.date) : null),
      dateRangeLabel: formatDotDateRange(bucket.date, bucket.endDate ?? bucket.date),
      place: bucket.place,
      locationSource: bucket.locationSource,
      kind: bucket.kind,
      dayIndex: bucket.dayIndex,
      tripDay: bucket.tripDay,
      photos: bucket.photos,
      blocks: filteredBlocks,
      layout: { ...layout, blocks: filteredBlocks },
      storyBody,
    };
  });

  const elements: ReactNode[] = [];
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const isFirstChapter = chapterIndex === 0;
    const isLastChapter = chapterIndex === chapters.length - 1;
    const showHeader = chapters.length > 1 || Boolean(chapter.date) || chapter.kind === "event";
    const flowPlan = memoryFlows[chapterIndex];

    if (showHeader) {
      elements.push(
        <ChapterHeader
          key={`chapter-header-${chapter.dayIndex}`}
          dayIndex={chapter.dayIndex}
          date={chapter.date}
          dateLabel={chapter.dateLabel}
          dateRangeLabel={chapter.dateRangeLabel}
          title={chapter.title}
          place={chapter.place}
          locationSource={chapter.locationSource}
          kind={chapter.kind}
          photoCount={chapter.photos.length}
          variant="date-only"
        />,
      );
    }

    for (const [blockIndex, item] of chapter.blocks.entries()) {
      const node = renderBlock(item, blockIndex, chapter, context, {
        isFirstChapter,
        isLastChapter,
        coverDateLabel,
        flowPlan,
        albumKey,
      });
      if (node) elements.push(node);
    }
  }

  const groups: AlbumDayGroup[] = chapters.map((chapter) => ({
    dateKey: chapter.date,
    label: chapter.dateRangeLabel ?? (chapter.date ? chapter.date.replaceAll("-", ".") : null),
    photos: chapter.photos,
  }));

  return {
    coverDateLabel,
    chapters,
    groups,
    photos: ordered,
    layout: chapters[0]?.layout ?? selectLayout([], { category: context.category }),
    elements,
    memoryFlows,
    epilogue,
  };
}

export function ensureOrientation(
  width: number | null,
  height: number | null,
  fallback?: PhotoOrientation | string | null,
): PhotoOrientation {
  if (!width || !height) {
    if (fallback === "landscape" || fallback === "portrait" || fallback === "square") return fallback;
    return "square";
  }
  return getOrientation(width, height);
}

/** @deprecated use buildAlbum with BuildAlbumContext */
export function buildAlbumLayoutOnly(
  photos: EnginePhoto[],
  context: LayoutSelectorContext = {},
): LayoutSelection {
  return selectLayout(sortEnginePhotos(photos), context);
}
