import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fitsWithinUploadTotal, MAX_TOTAL_UPLOAD_BYTES } from "../src/lib/optimizeImageFile";

const MB = 1024 * 1024;

test("the total upload cap is a realistic 40MB (not the old unreachable 100MB)", () => {
  assert.equal(MAX_TOTAL_UPLOAD_BYTES, 40 * MB);
});

test("a photo within the cap is allowed; one that would exceed it is blocked", () => {
  assert.equal(fitsWithinUploadTotal(30 * MB, 5 * MB), true);   // 35 ≤ 40 → add
  assert.equal(fitsWithinUploadTotal(39 * MB, 2 * MB), false);  // 41 > 40 → block
  assert.equal(fitsWithinUploadTotal(40 * MB, 0), true);        // exactly at the cap
  assert.equal(fitsWithinUploadTotal(40 * MB, 1), false);       // one byte over
});

// Binding: UploadForm gates each newly added photo on fitsWithinUploadTotal and,
// when over the cap, blocks ONLY that photo (continue) with the friendly copy —
// the already-chosen photos are never cleared.
const src = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");

test("UploadForm blocks only the over-cap photo, keeping the existing selection", () => {
  // Over-cap path skips just this photo (returns from the per-photo ready callback),
  // then keeps delivering the rest.
  assert.match(src, /if \(!fitsWithinUploadTotal\(nextTotal, prepared\.size\)\) \{[\s\S]*?return;/);
  assert.match(src, /20장 정도로 나눠서 앨범을 만들어 보세요\./);
  // No reset of the photo list on the over-cap path (only a skip).
  assert.doesNotMatch(src, /fitsWithinUploadTotal[\s\S]*?setPhotos\(\[\]\)/);
});
