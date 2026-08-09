// Persistence for the album-create step (which category, and whether the user
// reached photo selection), kept in one sessionStorage key so a tab/renderer
// restart mid-flow — the Android bug where decoding many photos restarts the
// tab — does not drop the user back to the home screen. The chosen File objects
// cannot be restored; the caller prompts a re-pick when a photo step is restored.
//
// Pure (no React) so the round-trip is unit-testable.

import type { AlbumCategory } from "../types";

export const PENDING_CATEGORY_KEY = "woorialbum-pending-album-category";

export interface PendingCreateStep {
  category: AlbumCategory | null;
  photoStep: boolean;
}

export function readCreateStep(): PendingCreateStep {
  try {
    const raw = sessionStorage.getItem(PENDING_CATEGORY_KEY);
    if (!raw) return { category: null, photoStep: false };
    const parsed = JSON.parse(raw) as Partial<PendingCreateStep>;
    return { category: (parsed.category as AlbumCategory) || null, photoStep: Boolean(parsed.photoStep) };
  } catch {
    // Missing, malformed, or a legacy plain-string value → treat as no step.
    return { category: null, photoStep: false };
  }
}

export function saveCreateStep(category: AlbumCategory | null, photoStep: boolean): void {
  try {
    if (category && photoStep) {
      sessionStorage.setItem(PENDING_CATEGORY_KEY, JSON.stringify({ category, photoStep: true }));
    } else {
      sessionStorage.removeItem(PENDING_CATEGORY_KEY);
    }
  } catch {
    /* storage unavailable — the step just won't survive a restart */
  }
}
