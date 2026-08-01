import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const frame = readFileSync(
  new URL("../src/album-engine/components/album/AlbumPhotoFrame.tsx", import.meta.url),
  "utf8",
);

test("print photos reserve box height from the real ratio so they never collapse in the PDF", () => {
  // Regression B: removing the square cell left height:auto, which html2canvas
  // resolves to 0 for a photo in a flex cell → blank page. Reserve height from DB w/h.
  assert.match(frame, /mode === "print" && width && height/);
  assert.match(frame, /aspectRatio: `\$\{width\} \/ \$\{height\}`/);
  assert.match(frame, /style=\{imgStyle\}/);
});

test("print still forces eager loading (so the reserved box actually gets an image)", () => {
  assert.match(frame, /resolveImageLoading\(mode, loading\)/);
  assert.match(frame, /loading=\{effectiveLoading\}/);
});
