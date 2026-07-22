import assert from "node:assert/strict";
import test from "node:test";

import { appendPendingContributions, contributionPanelAction, sharePublicAlbum } from "../src/lib/publicShareFlow";
import type { PublicShareAlbum } from "../src/types";

const album: PublicShareAlbum = {
  album_id: "11111111-1111-1111-1111-111111111111",
  title: "테스트 앨범",
  narrative: "",
  image_url: "https://example.com/cover.jpg",
  photos: [],
  photo_count: 0,
  photo_limit: 30,
  media: [],
  og_title: "테스트 앨범",
  og_description: "",
};

test("new contribution is appended without replacing the album photo array", () => {
  const photos = album.photos;
  const updated = appendPendingContributions(album, [{
    id: "photo-1",
    type: "photo",
    actor_name: "민수",
    author_name: "민수",
  }]);

  assert.equal(updated.photos, photos);
  assert.equal(updated.photo_count, 1);
  assert.equal(updated.pending_items?.[0].author_name, "민수");
});

test("first contribution opens name input without starting an album request", () => {
  assert.deepEqual(contributionPanelAction(null, "photo"), {
    contributionAction: null,
    nameAction: "photo",
  });
  assert.deepEqual(contributionPanelAction({ albumId: "album", contributorId: "contributor", guestId: "guest", displayName: "민수" }, "memory"), {
    contributionAction: "memory",
    nameAction: null,
  });
});

test("Kakao share success does not run the copy fallback", async () => {
  let copied = false;
  const outcome = await sharePublicAlbum(() => undefined, async () => { copied = true; });
  assert.equal(outcome, "kakao");
  assert.equal(copied, false);
});

test("Kakao share failure uses the copy fallback", async () => {
  let copied = false;
  const originalWarn = console.warn;
  console.warn = () => undefined;
  let outcome: "kakao" | "copied" | "copy_failed" = "copy_failed";
  try {
    outcome = await sharePublicAlbum(() => { throw new Error("SDK failure"); }, async () => { copied = true; });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(outcome, "copied");
  assert.equal(copied, true);
});
