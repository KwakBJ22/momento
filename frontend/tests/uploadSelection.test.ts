import assert from "node:assert/strict";
import test from "node:test";

import { dedupeSelectedPhotos, filterImageFiles, limitSelectedPhotos, snapshotSelectedFiles } from "../src/lib/imageFile";
import { MAX_ORIGINAL_IMAGE_BYTES } from "../src/lib/optimizeImageFile";

test("album picker matches the 10MB private Storage object limit", () => {
  assert.equal(MAX_ORIGINAL_IMAGE_BYTES, 10 * 1024 * 1024);
});

function image(name: string): File {
  return { name, type: "image/jpeg" } as File;
}

test("mobile picker snapshots and processes every selected photo", () => {
  const selected = [image("first.jpg"), image("second.jpg")];
  const snapshot = snapshotSelectedFiles(selected as unknown as FileList);
  const filtered = filterImageFiles(snapshot);

  assert.equal(snapshot.length, 2);
  assert.equal(filtered.accepted.length, 2);
  assert.deepEqual(filtered.accepted.map((file) => file.name), ["first.jpg", "second.jpg"]);
});

for (const count of [2, 10, 20, 30]) {
  test(`album selection preserves all ${count} photos within the 30-photo limit`, () => {
    const selected = Array.from({ length: count }, (_, index) => image(`${index}.jpg`));
    const limited = limitSelectedPhotos(selected, 30);
    assert.equal(limited.accepted.length, count);
    assert.equal(limited.skipped, 0);
    assert.deepEqual(limited.accepted.map((file) => file.name), selected.map((file) => file.name));
  });
}

test("album selection keeps the first 30 photos and reports one skipped photo", () => {
  const selected = Array.from({ length: 31 }, (_, index) => image(`${index}.jpg`));
  const limited = limitSelectedPhotos(selected, 30);
  assert.equal(limited.accepted.length, 30);
  assert.equal(limited.skipped, 1);
  assert.equal(limited.accepted[29]?.name, "29.jpg");
});

test("reselecting mobile gallery files accumulates new files without duplicates", () => {
  const first = image("first.jpg");
  Object.assign(first, { size: 10, lastModified: 1 });
  const second = image("second.jpg");
  Object.assign(second, { size: 20, lastModified: 2 });
  const repeated = image("first.jpg");
  Object.assign(repeated, { size: 10, lastModified: 1 });

  const next = dedupeSelectedPhotos([repeated, second], [first]);
  assert.deepEqual(next.accepted.map((file) => file.name), ["second.jpg"]);
  assert.equal(next.duplicates, 1);
});
