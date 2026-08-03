// Progress bar for album creation. The bar is driven by ELAPSED TIME, not by the
// server's job.progress — because the server cannot report intermediate progress for
// the story-generation step (a single call that runs ~1 minute with no updates), so
// waiting on the server value made the bar freeze there. Time-based advance keeps it
// moving; the server value is only a correction that pulls the bar UP if it lags.
// The function is pure (all inputs passed in) so its behaviour is unit-testable.

export const CREATION_PROGRESS_TICK_MS = 100;

// Total-time estimate from photo count: total = BASE_MS + PER_PHOTO_MS * count.
// Calibrated to a measured baseline (~30 photos over Wi-Fi ≈ 90s → 20000 + 2500*30).
const BASE_MS = 20_000;
const PER_PHOTO_MS = 2_500;
const DEFAULT_PHOTO_COUNT = 30; // when the count is unknown

const START_FLOOR = 3;       // small non-empty start so the bar reads as "alive" at once
const TIME_CAP = 95;         // time-based fill never exceeds this; only server/completion may
const CEILING = 99;          // crawl target once the estimate is exceeded; 100 = completion only
const CREEP_PER_SEC = 0.05;  // very slow 95→99 crawl after the estimate is exceeded (spec)
// Guaranteed motion while still within the estimate. Covers the case where the server
// pulled the bar ahead of the time curve and then went silent (story generation): the
// bar keeps inching up instead of freezing at the last server value. ~0.3%/s.
const LIVE_STEP_PER_TICK = 0.03;
const COMPLETE_RATE = 0.25;  // fraction of the remaining gap eased per tick when finishing
const COMPLETE_MIN_STEP = 1; // guarantees a fast, visible finish to 100

export function estimateTotalMs(photoCount?: number | null): number {
  const count = photoCount && photoCount > 0 ? Math.floor(photoCount) : DEFAULT_PHOTO_COUNT;
  return BASE_MS + PER_PHOTO_MS * count;
}

export function initialCreationProgress(): number {
  return START_FLOOR;
}

// Smoothstep (easeInOut): gentle at the start so the early seconds don't inflate (the
// bug was the bar shooting past half in ~30s), steepest through the middle — exactly
// the window where the single story-generation call reports nothing — then gentle
// again as it approaches the cap.
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export interface CreationProgressInput {
  /** Current on-screen value (kept for monotonicity). */
  display: number;
  /** Milliseconds since creation started. */
  elapsedMs: number;
  /** Estimated total duration (see estimateTotalMs). */
  totalMs: number;
  /** Latest server job.progress (0–100), or null if unknown. */
  serverProgress: number | null;
  /** True once the album is ready/completed. */
  complete: boolean;
}

/**
 * Next displayed progress (0–100). Monotonic (never below `display`). Advances on
 * elapsed time regardless of the server; the server value only pulls it up. Caps below
 * 100 until completion, then eases quickly to exactly 100.
 */
export function nextCreationProgress(input: CreationProgressInput): number {
  const { display, elapsedMs, totalMs, serverProgress, complete } = input;

  if (complete) {
    const eased = display + Math.max((100 - display) * COMPLETE_RATE, COMPLETE_MIN_STEP);
    return Math.min(100, Math.max(display, eased));
  }

  const frac = totalMs > 0 ? elapsedMs / totalMs : 1;
  let value: number;
  if (frac <= 1) {
    value = START_FLOOR + (TIME_CAP - START_FLOOR) * smoothstep(frac);
    // Never frozen: even if the server pulled us ahead of this curve and then stalled,
    // guarantee a small upward step so the bar keeps living during story generation.
    value = Math.max(value, Math.min(CEILING, display + LIVE_STEP_PER_TICK));
  } else {
    // Past the estimate: crawl very slowly toward the ceiling until completion arrives.
    const overSec = (elapsedMs - totalMs) / 1000;
    value = Math.min(CEILING, TIME_CAP + overSec * CREEP_PER_SEC);
  }

  // The server value only ever pulls the bar UP (prevents lag), never back, and never
  // to 100 (completion does that). A server value below the current display is ignored.
  if (serverProgress !== null && serverProgress > value) {
    value = Math.min(CEILING, serverProgress);
  }

  return Math.max(display, value);
}
