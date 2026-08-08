import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveShareImageUrl } from "../src/lib/shareImage";

// Real behaviour: Kakao's feed template takes ONE image, so every share path sends the
// cover photo (a readable thumbnail). It NEVER falls back to image_url — that is the
// result grid, illegible as a thumbnail. No cover → share with no image (Kakao's default
// card beats an unrecognizable grid).
test("resolveShareImageUrl uses the cover photo", () => {
  assert.equal(
    resolveShareImageUrl({ cover_image_url: "https://cdn/cover.jpg", image_url: "https://cdn/grid.png" }),
    "https://cdn/cover.jpg",
  );
});

test("never falls back to the result grid image", () => {
  // image_url present but no cover → empty, so Kakao does not show the 9-grid.
  assert.equal(resolveShareImageUrl({ cover_image_url: null, image_url: "https://cdn/grid.png" }), "");
  assert.equal(resolveShareImageUrl({ image_url: "https://cdn/grid.png" }), "");
});

test("returns empty string when there is no cover", () => {
  assert.equal(resolveShareImageUrl({ cover_image_url: null, image_url: null }), "");
  assert.equal(resolveShareImageUrl(null), "");
  assert.equal(resolveShareImageUrl(undefined), "");
});

// Every share path binds the single helper — so a new path can't silently diverge back
// to the raw result grid (the bug: AlbumView shared album.image_url).
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("all album share paths route the image through resolveShareImageUrl", () => {
  // 공유하기는 공용 시트 하나가 한다(I-2) — 시트를 여는 자리마다 같은 helper 로 대표
  // 사진을 넘긴다. 공유 화면(/s/)에는 주최자가 없어 공유 진입점 자체가 없다.
  for (const file of ["components/AlbumView.tsx", "components/AlbumResult.tsx", "App.tsx"]) {
    const source = read(file);
    assert.match(source, /resolveShareImageUrl/, `${file} imports/uses the helper`);
  }
  for (const file of ["components/AlbumView.tsx", "components/AlbumResult.tsx", "components/CollaborationPanel.tsx"]) {
    assert.match(read(file), /<AlbumShareSheet[\s\S]{0,400}imageUrl=/, `${file} passes imageUrl to the shared sheet`);
  }
  const albumView = read("components/AlbumView.tsx");
  // The Kakao share call no longer sends the raw grid image.
  assert.doesNotMatch(albumView, /imageUrl:\s*album\.image_url\b/);
  const app = read("App.tsx");
  assert.doesNotMatch(app, /imageUrl:\s*result\.image_url\b/);
});
