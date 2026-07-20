export type PhotoOrientation = "landscape" | "portrait" | "square";

export type LocationSource = "exif" | "user" | "ai_estimated" | "unknown";

export type AlbumLayoutKind =
  | "Hero"
  | "Polaroid3"
  | "Grid6"
  | "Story"
  | "MemoryBlock"
  | "Ending";

export const LAYOUT_ENGINE_VERSION = "v1" as const;

/** 같은 사진에 여러 명이 남긴 메모 */
export interface MemoryCommentEntry {
  author?: string | null;
  text: string;
}

export interface EnginePhoto {
  id: string;
  src: string;
  alt?: string;
  width: number | null;
  height: number | null;
  orientation: PhotoOrientation;
  comment?: string | null;
  /** 다중 작성자 메모 (없으면 comment / authorLabel 사용) */
  comments?: MemoryCommentEntry[];
  authorLabel?: string | null;
  sortOrder: number;
  takenAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationName?: string | null;
  locationSource?: LocationSource | null;
}

/** Memory Flow 입력 노드 */
export interface MemoryNode {
  photoId: string;
  takenAt: string | null;
  comment: string | null;
  comments: MemoryCommentEntry[];
  story: string | null;
  position: number;
}

export interface MemorySegmentData {
  author?: string | null;
  text: string;
  photoId?: string;
}

export interface LayoutBlock {
  kind: AlbumLayoutKind;
  photos: EnginePhoto[];
  /** MemoryBlock 본문 (plain) */
  text?: string;
  /** MemoryBlock 문단/작성자 구조 */
  segments?: MemorySegmentData[];
  /** MemoryBlock 출처 사진 */
  sourcePhotoId?: string;
}

export interface LayoutSelection {
  kind: AlbumLayoutKind;
  photos: EnginePhoto[];
  blocks: LayoutBlock[];
  dominantOrientation: PhotoOrientation;
  templateType: "warm" | "joyful" | "special";
  layoutEngineVersion: typeof LAYOUT_ENGINE_VERSION;
}

/** taken_at / 장소 기준 챕터. EXIF 없는 사진은 마지막 챕터에 합친다. */
export interface AlbumChapter {
  /** YYYY-MM-DD — 전부 undated면 null */
  date: string | null;
  endDate?: string | null;
  /** Day N / 이벤트 제목 */
  title: string;
  /** 2026년 7월 12일 또는 범위 라벨 */
  dateLabel: string | null;
  /** 헤더용 점 표기 날짜 범위 */
  dateRangeLabel?: string | null;
  place?: string | null;
  locationSource?: LocationSource | null;
  kind?: "day" | "event" | "neutral";
  dayIndex: number;
  tripDay?: number | null;
  photos: EnginePhoto[];
  blocks: LayoutBlock[];
  layout: LayoutSelection;
  /** 챕터 범위 story (없으면 album body 중 일부/전체) */
  storyBody?: string | null;
}

export interface LayoutSelectorContext {
  /** 향후 테마/문체 확장용. V1 레이아웃 규칙에는 사용하지 않는다. */
  category?: string | null;
}

export interface BuildAlbumContext extends LayoutSelectorContext {
  title: string;
  /** @deprecated unused */
  body?: string;
  /** album-level epilogue (우리의 이야기) — Stage 밖 렌더 */
  epilogue?: string | null;
  /** deterministic layout seed */
  albumId?: string | null;
  /** @deprecated use epilogue */
  endingStory?: string | null;
  coverDateLabel?: string | null;
  /** Date-keyed AI episode summaries. Keys use YYYY-MM-DD. */
  chapterStories?: Record<string, string> | null;
  groups?: Array<{
    dateKey?: string | null;
    date?: string | null;
    label?: string | null;
    title?: string | null;
    place?: string | null;
    locationSource?: LocationSource | null;
    photos: EnginePhoto[];
  }> | null;
}
