// Pure A4 page-break math for the PDF export, kept free of React/CSS imports so it
// is unit-testable. See exportPdf.tsx `alignBlocksToPrintPages` for how it is used.

export const PRINT_PAGE_EPS = 2; // px tolerance so a block sitting exactly on the line is not falsely pushed

/**
 * If a block at `top` with `height` (px, relative to the page-0 origin) straddles an
 * A4 page boundary, return the margin needed to push it onto the next page; else null.
 * Blocks taller than a page cannot avoid a split, so they return null.
 */
export function printPageStraddleGap(
  top: number,
  height: number,
  pageHeightPx: number,
  eps = PRINT_PAGE_EPS,
): number | null {
  if (!(pageHeightPx > 0) || height >= pageHeightPx - eps) return null;
  const startPage = Math.floor((top + eps) / pageHeightPx);
  const endPage = Math.floor((top + height - eps) / pageHeightPx);
  return endPage > startPage ? (startPage + 1) * pageHeightPx - top : null;
}
