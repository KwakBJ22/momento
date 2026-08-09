import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PDF_CANVAS_SCALE, wholePagesCaptureHeightPx } from "../src/lib/pdfPageBreak";

/**
 * 🔴 열람용 PDF 마지막에 **완전히 빈 페이지**가 한 장 더 붙는다 (I-4-1 · SCREEN_SPEC §9).
 *
 * 원인은 반올림이다. html2pdf 는 한 장 높이를 **내림**으로 쓴다(`dist/html2pdf.js`):
 *
 *   pxPageHeight = Math.floor(canvas.width * ratio)
 *   nPages       = Math.ceil(canvas.height / pxPageHeight)
 *
 * A4 210mm 폭(794px) · scale 2 면 참값은 2245.885px 인데 2245px 을 쓴다.
 * 장마다 0.885px 씩 모자라고 장수가 늘면 쌓인다 — 7장짜리에서 캔버스가 15716px,
 * 7장이 15715px 이라 1px 이 남고 그 1px 을 위해 8번째 페이지가 만들어진다.
 * 6장에서는 우연히 딱 맞아 안 보였다. 그래서 앨범마다 나왔다 안 나왔다 했다.
 */

/** html2pdf 가 실제로 하는 계산 그대로. */
function html2pdfPageCount(contentHeightPx: number, widthPx: number, scale = PDF_CANVAS_SCALE): number {
  const canvasWidth = widthPx * scale;
  const canvasHeight = Math.round(contentHeightPx) * scale;
  const pxPageHeight = Math.floor(canvasWidth * (297 / 210));
  return Math.ceil(canvasHeight / pxPageHeight);
}

/** A4 210mm 를 96dpi 로 그린 폭(exportPdf 의 host 가 width:210mm 다). */
const A4_WIDTH_PX = 793.7007874;
const TRUE_PAGE_PX = A4_WIDTH_PX * (297 / 210);

test("★ 결함 재현 — 고치기 전에는 7장짜리가 8장으로 나온다", () => {
  const sevenPages = 7 * TRUE_PAGE_PX; // 7857.5…
  assert.equal(html2pdfPageCount(sevenPages, A4_WIDTH_PX), 8, "1px 때문에 한 장이 더 붙는다");
  // 6장에서는 우연히 맞는다 — 그래서 재현이 들쭉날쭉했다.
  assert.equal(html2pdfPageCount(6 * TRUE_PAGE_PX, A4_WIDTH_PX), 6);
});

test("★ 맞춰서 깎으면 어떤 장수에서도 빈 장이 안 생긴다", () => {
  for (let pages = 1; pages <= 30; pages += 1) {
    const content = pages * TRUE_PAGE_PX;
    const fit = wholePagesCaptureHeightPx(content, A4_WIDTH_PX);
    assert.ok(fit, `${pages}장: 값이 나와야 한다`);
    assert.equal(fit!.pages, pages, `${pages}장으로 세어야 한다`);
    assert.equal(html2pdfPageCount(fit!.heightPx, A4_WIDTH_PX), pages, `${pages}장인데 다른 장수가 나온다`);
  }
});

test("깎이는 양은 장당 1px 미만이다 — 아래 여백(12mm) 안이라 아무것도 잘리지 않는다", () => {
  for (const pages of [1, 7, 20]) {
    const content = pages * TRUE_PAGE_PX;
    const fit = wholePagesCaptureHeightPx(content, A4_WIDTH_PX)!;
    const trimmed = content - fit.heightPx;
    assert.ok(trimmed >= 0, `${pages}장: 늘리지 않는다`);
    assert.ok(trimmed < pages, `${pages}장: ${trimmed.toFixed(2)}px — 장당 1px 을 넘는다`);
  }
});

test("내용이 반 장 넘게 남으면 그 장은 진짜 장이다 (지우지 않는다)", () => {
  const fit = wholePagesCaptureHeightPx(6 * TRUE_PAGE_PX + TRUE_PAGE_PX * 0.6, A4_WIDTH_PX)!;
  assert.equal(fit.pages, 7);
});

test("값이 이상하면 아무것도 하지 않는다 (조용히 0 을 만들지 않는다)", () => {
  assert.equal(wholePagesCaptureHeightPx(0, A4_WIDTH_PX), null);
  assert.equal(wholePagesCaptureHeightPx(1000, 0), null);
  assert.equal(wholePagesCaptureHeightPx(1000, A4_WIDTH_PX, 0), null);
});

test("내보내기가 이 보정을 실제로 건다 (계산만 하고 안 쓰면 그대로다)", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(exportPdf, /wholePagesCaptureHeightPx\(contentHeight, element\.getBoundingClientRect\(\)\.width, CANVAS_SCALE\)/);
  assert.match(exportPdf, /element\.style\.height = `\$\{fit\.heightPx\}px`/);
  assert.match(exportPdf, /element\.style\.overflow = "hidden"/);
  // 배율이 갈라지면 계산이 어긋난다 — 한 곳에서만 정한다.
  assert.match(exportPdf, /const CANVAS_SCALE = PDF_CANVAS_SCALE;/);
  assert.match(exportPdf, /html2canvas: \{\s*scale: CANVAS_SCALE/);
  // 몇 장으로 잘랐는지 남긴다(다음에 이상하면 이 줄로 찾는다).
  assert.match(exportPdf, /logPdf\("pdf_pages_fitted"/);
});
