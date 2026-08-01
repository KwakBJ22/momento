import assert from "node:assert/strict";
import test from "node:test";

import { printPageStraddleGap } from "../src/lib/pdfPageBreak";

const PAGE = 1000;

test("a block fully within a page is not pushed", () => {
  assert.equal(printPageStraddleGap(0, 500, PAGE), null);
  assert.equal(printPageStraddleGap(1000, 300, PAGE), null); // fully on page 2
});

test("a block straddling a page boundary returns the gap to the next page top", () => {
  // top 900, height 200 → bottom 1100 crosses 1000. Push 100 → new top 1000.
  assert.equal(printPageStraddleGap(900, 200, PAGE), 100);
  // top 1800 on page 2, height 400 → bottom 2200 crosses 2000. Push 200.
  assert.equal(printPageStraddleGap(1800, 400, PAGE), 200);
});

test("pushing by the gap lands the block exactly on the next page (no residual straddle)", () => {
  const top = 870, height = 250;
  const gap = printPageStraddleGap(top, height, PAGE);
  assert.ok(gap !== null);
  assert.equal(printPageStraddleGap(top + (gap as number), height, PAGE), null);
});

test("a block taller than a page cannot be avoided (returns null)", () => {
  assert.equal(printPageStraddleGap(100, 1200, PAGE), null);
});

test("a hairline crossing within the tolerance is ignored", () => {
  // top 999 (1px into page 0), height 100 → treated as page-1 start, not a real cut.
  assert.equal(printPageStraddleGap(999, 100, PAGE), null);
});
