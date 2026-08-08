import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// [2] My Albums must show a separate "함께 만드는 앨범" section for participated albums,
// reusing the existing card, and never render an empty section.
test("getMyAlbums returns both owned and participating lists (additive contract)", () => {
  const api = read("lib/api.ts");
  assert.match(api, /getMyAlbums\(\): Promise<\{ albums: MyAlbum\[\]; participating: MyAlbum\[\]; bookmarked: MyAlbum\[\] \}>/);
  // Backward compatible: tolerate a missing participating field from older backends.
  assert.match(api, /participating: data\.participating \?\? \[\]/);
  assert.match(api, /bookmarked: data\.bookmarked \?\? \[\]/);
});

test("MyAlbums renders the participating section only when non-empty, reusing the card", () => {
  const view = read("components/MyAlbums.tsx");
  // One shared card renderer (no duplicate markup).
  assert.match(view, /const renderCard = \(album: MyAlbum, index: number, canDelete: boolean\)/);
  assert.match(view, /albums\.map\(\(album, index\) => renderCard\(album, index, true\)\)/);
  // Participating section is gated on length > 0 (no empty section) and shows the title.
  assert.match(view, /participating\.length > 0 \?/);
  assert.match(view, /함께 만드는 앨범/);
  // Participating cards are not deletable (non-owner) — canDelete=false.
  assert.match(view, /participating\.map\(\(album, index\) => renderCard\(album, index, false\)\)/);
  // No extra badge on the card to distinguish owner vs participant — the section title does.
  assert.doesNotMatch(view, /participant-badge|참여자 배지/);
});
