import type { EnginePhoto } from "./types";

/** taken_at ASC (missing last), then sortOrder ASC */
export function sortEnginePhotos(photos: EnginePhoto[]): EnginePhoto[] {
  return [...photos].sort((a, b) => {
    const aMissing = !a.takenAt;
    const bMissing = !b.takenAt;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (a.takenAt && b.takenAt && a.takenAt !== b.takenAt) {
      return a.takenAt < b.takenAt ? -1 : 1;
    }
    return a.sortOrder - b.sortOrder;
  });
}
