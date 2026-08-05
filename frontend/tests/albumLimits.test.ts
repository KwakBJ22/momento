import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ALBUM_PHOTO_CAPACITY, PDF_BLOCKED_MESSAGE, PDF_PHOTO_SAFE_LIMIT } from "../src/lib/albumLimits";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("album total capacity is 100 and the PDF guard sits at today's proven maximum", () => {
  // Capacity mirrors backend DEFAULT_ALBUM_PHOTO_CAPACITY + DB DEFAULT (migration
  // 20260805190000). The PDF guard is 30: html2canvas rasterizes the whole album into
  // ONE canvas (scale 2, Chrome max 65,535px → ~29 A4 pages of source); 30 photos
  // (~32 pages) is the largest size proven to render in production — anything larger
  // is mathematically over the limit and must be blocked BEFORE the click.
  assert.equal(ALBUM_PHOTO_CAPACITY, 100);
  assert.equal(PDF_PHOTO_SAFE_LIMIT, 30);
  // §8: facts only — the message must not promise upcoming features.
  assert.doesNotMatch(PDF_BLOCKED_MESSAGE, /곧|준비하고|예정/);
});

test("PDF buttons are blocked up front (never a blank PDF download)", () => {
  for (const name of ["components/AlbumView.tsx", "components/AlbumResult.tsx"]) {
    const source = read(name);
    assert.match(source, /PDF_PHOTO_SAFE_LIMIT/, `${name} guards the PDF button`);
    assert.match(source, /PDF_BLOCKED_MESSAGE/, `${name} shows the reason`);
  }
  // disabled + hint, not a post-failure alert.
  assert.match(read("components/AlbumView.tsx"), /disabled=\{isExportingPdf \|\| !album \|\| photos\.length > PDF_PHOTO_SAFE_LIMIT\}/);
});

test("contribution sheet talks about the TOTAL capacity, not a per-pick cap", () => {
  const source = read("components/ContributeWorkspace.tsx");
  assert.match(source, /앨범에는 사진을 최대 \{workspace\.photo_limit\}장까지 담을 수 있어요/);
  assert.doesNotMatch(source, /한 번에 최대 \{workspace\.photo_limit\}장/);
  assert.match(source, /workspace\.photo_limit \?\? ALBUM_PHOTO_CAPACITY/);
  // The creation screen's "한 번에 30장" (MAX_PHOTOS) wording stays per-upload.
  assert.match(read("components/UploadForm.tsx"), /한 번에 최대 \$\{MAX_PHOTOS\}장/);
});
