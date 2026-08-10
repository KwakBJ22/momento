import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPhotoCaptionSegments, buildPhotoMemoryEntries } from "../src/album-engine/components/photoCaptionSegments";
import { myAlbumCardImageUrl } from "../src/lib/myAlbumCardImage";
import { selectAlbumPhotoUrl } from "../src/lib/imageUrls";

/**
 * ★ 이 검사는 K-23 에서 **뒤집혔다.** 예전에는 캡션과 한마디가 **한 목록**으로 나오는
 *   것을 정상으로 잠그고 있었는데, 그것이 바로 결함이었다 — 그 목록이 캡션 자리에
 *   캡션 모양으로 그려져서 한마디가 캡션처럼 보였다(§7 은 둘을 자리로 가른다).
 *   이제 캡션은 캡션만, 한마디는 이름과 함께 따로 나온다.
 *   자세한 것은 photoMemoryLayer.test.ts.
 */
test("saved photo comments and participant memories stay in separate layers", () => {
  const photo = {
    id: "photo-1",
    comment: "  사용자가 남긴 코멘트  ",
    authorLabel: "주최자",
    comments: [
      { text: "" },
      { author: "참여자", text: "함께 남긴 기억" },
      { author: "다른 이름", text: "사용자가 남긴 코멘트" },
    ],
  };
  // 캡션은 그 사진의 한 줄 하나다(공백은 다듬는다).
  assert.deepEqual(buildPhotoCaptionSegments(photo), [
    { photoId: "photo-1", author: "주최자", text: "사용자가 남긴 코멘트" },
  ]);
  // 한마디는 따로, 이름과 함께. 빈 글만 버린다 —
  // ★ 캡션과 글자가 같아도 버리지 않는다. 다른 사람이 쓴 다른 계층의 말이다.
  assert.deepEqual(buildPhotoMemoryEntries(photo), [
    { author: "참여자", text: "함께 남긴 기억" },
    { author: "다른 이름", text: "사용자가 남긴 코멘트" },
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
