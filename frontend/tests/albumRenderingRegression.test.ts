import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPhotoCaptionSegments } from "../src/album-engine/components/photoCaptionSegments";
import { myAlbumCardImageUrl } from "../src/lib/myAlbumCardImage";
import { selectAlbumPhotoUrl } from "../src/lib/imageUrls";

test("saved photo comments and participant memories survive renderer normalization", () => {
  const segments = buildPhotoCaptionSegments({
    id: "photo-1",
    comment: "  사용자가 남긴 코멘트  ",
    authorLabel: "주최자",
    comments: [
      { text: "" },
      { author: "참여자", text: "함께 남긴 기억" },
      { author: "다른 이름", text: "사용자가 남긴 코멘트" },
    ],
  });
  assert.deepEqual(segments, [
    { photoId: "photo-1", author: "주최자", text: "사용자가 남긴 코멘트" },
    { photoId: "photo-1", author: "참여자", text: "함께 남긴 기억" },
  ]);
});

test("my album cards never use the generated PDF/result image as a fallback", () => {
  assert.equal(myAlbumCardImageUrl({ cover_image_url: null }), "");
  assert.equal(myAlbumCardImageUrl({ cover_image_url: " https://cdn.example/cover.jpg " }), "https://cdn.example/cover.jpg");
});

test("screen albums use a bounded display image while print keeps the original", () => {
  const photo = {
    original_url: "https://assets.example/original.jpg",
    display_url: "https://assets.example/display.webp",
    thumbnail_url: "https://assets.example/thumbnail.webp",
  };
  assert.equal(selectAlbumPhotoUrl(photo, "screen"), photo.display_url);
  assert.equal(selectAlbumPhotoUrl(photo, "thumbnail"), photo.thumbnail_url);
  assert.equal(selectAlbumPhotoUrl(photo, "print"), photo.original_url);
});

test("legacy photos without a display derivative remain visible through their original URL", () => {
  assert.equal(
    selectAlbumPhotoUrl({ original_url: "https://assets.example/legacy.jpg", thumbnail_url: "https://assets.example/legacy-thumb.webp" }, "screen"),
    "https://assets.example/legacy.jpg",
  );
});

test("an empty album uses a safe screen state instead of attempting to render deleted photos", () => {
  const source = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  assert.match(source, /사진을 추가해 새 앨범을 만들어보세요/);
  assert.match(source, /mode === "screen"/);
});
