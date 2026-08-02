// Pure decisions for the free-tier album limit, kept free of React so the
// gating is unit-testable. App and Landing use these exact functions, so testing
// them is testing what actually happens (not a regex of the JSX). The backend is
// always the real enforcer — this only decides whether to warn before the flow.

import type { AlbumCategory } from "../types";

export interface AlbumLimit { count: number; max: number }

/** Only logged-in users are capped; guests and an unknown limit are never blocked. */
export function isAlbumLimitReached(hasUser: boolean, limit: AlbumLimit | null): boolean {
  return Boolean(hasUser && limit && limit.max > 0 && limit.count >= limit.max);
}

/** What the "앨범 만들기" CTA should do, given the selection and the limit state. */
export function createActionFor(category: AlbumCategory | null, albumLimitReached: boolean): "none" | "blocked" | "start" {
  if (!category) return "none";
  return albumLimitReached ? "blocked" : "start";
}
