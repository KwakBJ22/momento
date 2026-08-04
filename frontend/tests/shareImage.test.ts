import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveShareImageUrl } from "../src/lib/shareImage";

// Real behaviour: Kakao's feed template takes ONE image, so every share path must send
// the cover photo (readable thumbnail), falling back to the result image only when no
// cover exists yet.
test("resolveShareImageUrl prefers the cover photo", () => {
  assert.equal(
    resolveShareImageUrl({ cover_image_url: "https://cdn/cover.jpg", image_url: "https://cdn/grid.png" }),
    "https://cdn/cover.jpg",
  );
});

test("falls back to the result image when there is no cover", () => {
  assert.equal(resolveShareImageUrl({ cover_image_url: null, image_url: "https://cdn/grid.png" }), "https://cdn/grid.png");
  assert.equal(resolveShareImageUrl({ image_url: "https://cdn/grid.png" }), "https://cdn/grid.png");
});

test("returns empty string when nothing is available", () => {
  assert.equal(resolveShareImageUrl({ cover_image_url: null, image_url: null }), "");
  assert.equal(resolveShareImageUrl(null), "");
  assert.equal(resolveShareImageUrl(undefined), "");
});

// Every share path binds the single helper — so a new path can't silently diverge back
// to the raw result grid (the bug: AlbumView shared album.image_url).
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("all album share paths route the image through resolveShareImageUrl", () => {
  for (const file of ["components/AlbumView.tsx", "App.tsx", "components/PublicShareView.tsx"]) {
    const source = read(file);
    assert.match(source, /resolveShareImageUrl/, `${file} imports/uses the helper`);
  }
  const albumView = read("components/AlbumView.tsx");
  // The Kakao share call no longer sends the raw grid image.
  assert.doesNotMatch(albumView, /imageUrl:\s*album\.image_url\b/);
  const app = read("App.tsx");
  assert.doesNotMatch(app, /imageUrl:\s*result\.image_url\b/);
});
