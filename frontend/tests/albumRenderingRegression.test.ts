import assert from "node:assert/strict";
import test from "node:test";

import { buildPhotoCaptionSegments } from "../src/album-engine/components/photoCaptionSegments";
import { myAlbumCardImageUrl } from "../src/lib/myAlbumCardImage";

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
