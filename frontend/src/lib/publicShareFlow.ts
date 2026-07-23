import type { PublicContributionItem, PublicShareAlbum } from "../types";
import type { CollabSession } from "./api";

type ContributionAction = "photo" | "memory";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type PublicShareCache = {
  album: PublicShareAlbum;
  contributionAction: ContributionAction | null;
  nameAction?: ContributionAction | null;
  cachedAt: number;
};

const PUBLIC_SHARE_CACHE_PREFIX = "momento-public-share:";
const PUBLIC_SHARE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

function cacheKey(token: string): string {
  return `${PUBLIC_SHARE_CACHE_PREFIX}${token}`;
}

function publicShareSessionStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPublicShareCache(
  token: string,
  storage: Pick<Storage, "getItem"> | null = publicShareSessionStorage(),
  now = Date.now(),
): PublicShareCache | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey(token));
    if (!raw) return null;
    const cached = JSON.parse(raw) as PublicShareCache;
    if (!cached?.album?.album_id || !cached.cachedAt || now - cached.cachedAt > PUBLIC_SHARE_CACHE_MAX_AGE_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

export function savePublicShareCache(
  token: string,
  album: PublicShareAlbum,
  contributionAction: ContributionAction | null,
  nameAction: ContributionAction | null,
  storage: StorageLike | null = publicShareSessionStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(cacheKey(token), JSON.stringify({ album, contributionAction, nameAction, cachedAt: now } satisfies PublicShareCache));
  } catch {
    // sessionStorage can be unavailable in private WebViews. The in-memory view still works.
  }
}

function hasSamePhotos(current: PublicShareAlbum["photos"], next: PublicShareAlbum["photos"]): boolean {
  const currentPhotos = current || [];
  const nextPhotos = next || [];
  if (currentPhotos.length !== nextPhotos.length) return false;
  return currentPhotos.every((photo, index) => {
    const other = nextPhotos[index];
    return photo.id === other?.id
      && photo.sort_order === other.sort_order
      && photo.comment === other.comment
      && photo.taken_at === other.taken_at
      && photo.width === other.width
      && photo.height === other.height
      && photo.orientation === other.orientation;
  });
}

function hasSameChapterStories(
  current: PublicShareAlbum["chapter_stories"],
  next: PublicShareAlbum["chapter_stories"],
): boolean {
  const currentEntries = Object.entries(current || {}).sort(([left], [right]) => left.localeCompare(right));
  const nextEntries = Object.entries(next || {}).sort(([left], [right]) => left.localeCompare(right));
  return currentEntries.length === nextEntries.length
    && currentEntries.every(([key, value], index) => key === nextEntries[index]?.[0] && value === nextEntries[index]?.[1]);
}

/** Preserve the rendered photo array when a quiet refresh only changes contribution metadata. */
export function reconcilePublicShareAlbum(current: PublicShareAlbum | null, next: PublicShareAlbum): PublicShareAlbum {
  if (!current) return next;
  const photos = hasSamePhotos(current.photos, next.photos) ? current.photos : next.photos;
  const chapterStories = hasSameChapterStories(current.chapter_stories, next.chapter_stories)
    ? current.chapter_stories
    : next.chapter_stories;
  const nextPendingIds = new Set((next.pending_items || []).map((item) => item.id));
  const localPending = (current.pending_items || []).filter((item) => !nextPendingIds.has(item.id));
  return {
    ...next,
    photos,
    chapter_stories: chapterStories,
    photo_count: Math.max(next.photo_count ?? 0, current.photo_count ?? 0),
    pending_items: [...localPending, ...(next.pending_items || [])],
  };
}

export function appendPendingContributions(
  album: PublicShareAlbum,
  items: PublicContributionItem[],
): PublicShareAlbum {
  return {
    ...album,
    photo_count: (album.photo_count ?? album.photos?.length ?? 0) + items.filter((item) => item.type === "photo").length,
    pending_items: [
      ...items,
      ...(album.pending_items || []).filter((existing) => !items.some((item) => item.id === existing.id)),
    ],
  };
}

export function contributionPanelAction(
  session: CollabSession | null,
  action: "photo" | "memory",
): { contributionAction: "photo" | "memory" | null; nameAction: "photo" | "memory" | null } {
  return session
    ? { contributionAction: action, nameAction: null }
    : { contributionAction: null, nameAction: action };
}

export async function sharePublicAlbum(
  invokeKakaoShare: () => void,
  copyPublicLink: () => Promise<void>,
): Promise<"kakao" | "copied" | "copy_failed"> {
  try {
    invokeKakaoShare();
    return "kakao";
  } catch (cause) {
    console.warn("[Momento] Kakao share unavailable; copying public link instead.", cause);
    try {
      await copyPublicLink();
      return "copied";
    } catch (copyCause) {
      console.warn("[Momento] Public link copy fallback failed.", copyCause);
      return "copy_failed";
    }
  }
}
