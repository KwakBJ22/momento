import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_DATE_STORY_PHOTO_COUNT,
  isDateStoryEligible,
  visibleChapterStories,
} from "../src/lib/storyRules";
import type { AlbumPhoto } from "../src/types";

function photo(date: string, comment?: string): AlbumPhoto {
  return {
    id: `${date}-${Math.random()}`,
    sort_order: 0,
    caption: comment ?? null,
    original_url: "",
    thumbnail_url: "",
    taken_at: `${date}T10:00:00Z`,
  } as AlbumPhoto;
}

test("a date with no comments shows no story even with 10 photos", () => {
  const photos = Array.from({ length: 10 }, () => photo("2026-07-13"));
  const visible = visibleChapterStories({ "2026-07-13": "재료 없는 이야기" }, photos);
  assert.deepEqual(visible, {});
});

test("a date with >=5 photos and >=1 comment shows its story", () => {
  const photos = [
    photo("2026-07-13", "한마디"),
    ...Array.from({ length: MIN_DATE_STORY_PHOTO_COUNT - 1 }, () => photo("2026-07-13")),
  ];
  const visible = visibleChapterStories({ "2026-07-13": "이야기" }, photos);
  assert.deepEqual(visible, { "2026-07-13": "이야기" });
});

test("a commented date with too few photos stays hidden (existing rule kept)", () => {
  const photos = Array.from({ length: MIN_DATE_STORY_PHOTO_COUNT - 1 }, () => photo("2026-07-13", "한마디"));
  const visible = visibleChapterStories({ "2026-07-13": "이야기" }, photos);
  assert.deepEqual(visible, {});
});

test("participant memories count as material", () => {
  const photos = Array.from({ length: MIN_DATE_STORY_PHOTO_COUNT }, () => photo("2026-07-13"));
  (photos[0] as AlbumPhoto).comments = [{ author: "참여자", text: "함께 남긴 기억" }];
  const visible = visibleChapterStories({ "2026-07-13": "이야기" }, photos);
  assert.deepEqual(visible, { "2026-07-13": "이야기" });
});

test("isDateStoryEligible mirrors the chapter-level gate", () => {
  const engineLike = (caption?: string) => ({ caption: caption ?? null });
  const enough = [
    engineLike("한마디"),
    ...Array.from({ length: MIN_DATE_STORY_PHOTO_COUNT - 1 }, () => engineLike()),
  ];
  assert.equal(isDateStoryEligible(enough), true);
  assert.equal(isDateStoryEligible(Array.from({ length: 10 }, () => engineLike())), false);
  assert.equal(isDateStoryEligible([engineLike("한마디")]), false);
});
