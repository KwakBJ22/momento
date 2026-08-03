import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string): string =>
  readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8");

test("StoryBlock edits inline via the date-story context (like the title/epilogue)", () => {
  const tsx = read("album-engine/blocks/StoryBlock.tsx");
  assert.match(tsx, /useDateStoryEdit/);
  assert.match(tsx, /storyKey\?: string/);
  // Editing this key renders an inline textarea with save/cancel, not a new page/modal.
  assert.match(tsx, /story-block__input/);
  assert.match(tsx, /edit\.saveEdit\(storyKey\)/);
  assert.match(tsx, /edit\.cancelEdit\(\)/);
  // Empty eligible date gets a warm add entry (no "자동 생성"/"인공지능"/"GPT" copy — §8).
  assert.match(tsx, /story-block__empty-hint/);
  assert.match(tsx, /이 날의 이야기를 남겨보세요/);
  assert.doesNotMatch(tsx, /자동 생성|인공지능|GPT/);
});

test("AlbumRenderer wires the storyKey + provider and gates the empty entry on eligibility", () => {
  const tsx = read("album-engine/AlbumRenderer.tsx");
  assert.match(tsx, /DateStoryEditProvider/);
  assert.match(tsx, /storyKey=\{storyKey\}/);
  assert.match(tsx, /isDateStoryEligible\(chapter\.photos\)/);
  // Only owners see the empty add entry; readers/print never do.
  assert.match(tsx, /dateStoryEdit\?\.canEdit && isDateStoryEligible/);
});

test("AlbumView saves a date story with a partial merge (no AlbumRenderer remount)", () => {
  const tsx = read("components/AlbumView.tsx");
  assert.match(tsx, /patchChapterStory/);
  // Partial setAlbum merge, exactly like the epilogue save; never bumps retryKey.
  assert.match(tsx, /setAlbum\(\(current\) => current \? \{ \.\.\.current, chapter_stories: updated\.chapter_stories \}/);
  assert.doesNotMatch(read("components/AlbumView.tsx").match(/handleSaveStory[\s\S]*?\n  \};/)?.[0] ?? "", /setRetryKey/);
  // dateStoryEdit is owner-gated.
  assert.match(tsx, /dateStoryEdit=\{canEdit \?/);
});
