import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MAX_ORIGINAL_IMAGE_BYTES, prepareForUpload } from "../src/lib/optimizeImageFile";

const throwingOptimizer = async (): Promise<File> => {
  throw new Error("decode failed (HEIC / canvas limit / null blob)");
};

test("a photo survives when optimization throws — it falls back to the original file", async () => {
  // Regression for '이 사진을 준비하지 못했습니다': an Android gallery JPEG that the
  // in-browser optimizer cannot decode must still be uploaded (backend re-encodes).
  const original = { size: 5 * 1024 * 1024, name: "1000002684.jpg" } as unknown as File;
  const result = await prepareForUpload(original, throwingOptimizer);
  assert.equal(result, original);
});

test("prepareForUpload rethrows only when the original itself is over the per-object limit", async () => {
  const tooBig = { size: MAX_ORIGINAL_IMAGE_BYTES + 1, name: "huge.png" } as unknown as File;
  await assert.rejects(() => prepareForUpload(tooBig, throwingOptimizer));
});

test("prepareForUpload returns the optimized file when optimization succeeds", async () => {
  const original = { size: 9 * 1024 * 1024, name: "photo.jpg" } as unknown as File;
  const optimized = { size: 1 * 1024 * 1024, name: "photo.jpg" } as unknown as File;
  const result = await prepareForUpload(original, async () => optimized);
  assert.equal(result, optimized);
});

test("the upload form reflects the count immediately by adding photos one at a time", () => {
  const src = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
  // No batch add that leaves the count at 0 until every image finishes resizing.
  assert.doesNotMatch(src, /\.\.\.added\]/);
  // Each prepared photo is appended inside the loop.
  assert.match(src, /setPhotos\(\(previous\) => \[\.\.\.previous, item\]\)/);
  // Preparation uses the loss-safe fallback path (now also returning a preview).
  assert.match(src, /prepareUploadAndPreview\(file\)/);
});
