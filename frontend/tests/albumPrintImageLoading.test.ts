import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveImageFetchPriority,
  resolveImageLoading,
} from "../src/album-engine/components/album/imageLoadingMode";

test("print mode forces images to load eagerly so off-screen PDF capture is not blank", () => {
  assert.equal(resolveImageLoading("print", "lazy"), "eager");
  assert.equal(resolveImageLoading("print", "eager"), "eager");
  assert.equal(resolveImageFetchPriority("print", "auto"), "high");
});

test("screen mode preserves the requested lazy loading (performance principle)", () => {
  assert.equal(resolveImageLoading("screen", "lazy"), "lazy");
  assert.equal(resolveImageLoading("screen", "eager"), "eager");
  assert.equal(resolveImageFetchPriority("screen", "auto"), "auto");
  assert.equal(resolveImageFetchPriority("screen", "high"), "high");
});

test("AlbumPhotoFrame applies the render-mode loading policy instead of the raw prop", () => {
  const source = readFileSync(
    new URL("../src/album-engine/components/album/AlbumPhotoFrame.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /useAlbumRenderMode\(\)/);
  assert.match(source, /loading=\{effectiveLoading\}/);
  assert.match(source, /resolveImageLoading\(mode, loading\)/);
});

test("print keeps the living-album images at their natural ratio so object-fit cannot distort them", () => {
  const css = readFileSync(
    new URL("../src/album-engine/AlbumRenderer.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.album-renderer--print \.album-living-page__photos img\s*\{[^}]*object-fit:\s*contain/);
});
