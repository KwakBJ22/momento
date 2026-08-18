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

test("총 용량 판정은 **변환한 뒤**다 — 넘치면 그 자리에서 우리 말로 알린다", () => {
  // ★ 2026-08-16 — 자리가 옮겨 갔다. 고를 때는 아직 변환 전이라 잴 것이 원본 크기뿐이고,
  //   그것으로 막으면 실제로는 담기는 사진을 막는다(원본 9MB 가 2560 으로는 1MB 다).
  //   막는다는 사실 자체는 그대로다 — 조용히 실패하지 않는다(§11).
  assert.match(src, /const totalBytes = uploadFiles\.reduce\(/);
  assert.match(src, /if \(!fitsWithinUploadTotal\(0, totalBytes\)\) \{[\s\S]{0,120}?return;/);
  assert.match(src, /setNotice\(TOTAL_OVER_NOTICE\)/);
  // 문구는 한 곳에만 있다(화면이 아니라 uploadFormView).
  const view = readFileSync(new URL("../src/lib/uploadFormView.ts", import.meta.url), "utf8");
  assert.match(view, /20장 정도로 나눠서 앨범을 만들어 보세요\./);
  // 고른 사진을 지우지 않는다 — 사용자가 몇 장 빼면 그대로 만들 수 있다.
  assert.doesNotMatch(src, /fitsWithinUploadTotal[\s\S]{0,200}?setPhotos\(\[\]\)/);
});
