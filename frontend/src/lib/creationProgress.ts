// Pure easing for the album-creation progress bar. The server reports a target
// (job.progress) that jumps between steps; the on-screen bar eases toward that
// target and, once caught up, crawls slowly so a long step never looks frozen —
// while never exceeding a ceiling (100 is reached only on completion) and never
// moving backward (monotonic), even if the server reports a lower value.

export const CREATION_PROGRESS_TICK_MS = 100;

const FLOOR = 20;            // matches the server's starting progress
const CEILING = 99;          // auto-progress never fills the last %; completion does
const APPROACH_RATE = 0.12;  // fraction of the remaining gap eased per tick when catching up
const APPROACH_MIN_STEP = 0.4; // guarantees visible motion while catching up
const CREEP_MARGIN = 6;      // how far past the server target the bar may crawl
const CREEP_STEP = 0.12;     // slow crawl per tick once caught up

export function initialCreationProgress(): number {
  return FLOOR;
}

/**
 * Next displayed progress (0–100) given the current display value and the server
 * target. Monotonic (never returns less than `display`); caps below 100 until the
 * server target itself reaches 100 (completion), then eases smoothly to 100.
 */
export function nextCreationProgress(display: number, serverTarget: number): number {
  const target = Math.max(FLOOR, Math.min(100, serverTarget));

  if (target >= 100) {
    // Completion: fill smoothly all the way to 100.
    const eased = display + Math.max((100 - display) * APPROACH_RATE, APPROACH_MIN_STEP);
    return Math.min(100, Math.max(display, eased));
  }

  if (display < target) {
    // Behind the server: ease up to it with a guaranteed minimum step (don't overshoot).
    const eased = display + Math.max((target - display) * APPROACH_RATE, APPROACH_MIN_STEP);
    return Math.min(target, eased);
  }

  // Caught up: crawl a little past the target so a long step keeps moving, but never
  // reach the ceiling until the server reports completion. max(display, …) keeps it
  // monotonic if the server ever reports a lower target than the current display.
  const creepCap = Math.min(CEILING, target + CREEP_MARGIN);
  return Math.max(display, Math.min(creepCap, display + CREEP_STEP));
}
