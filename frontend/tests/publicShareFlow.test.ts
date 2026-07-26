import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPendingContributions,
  clearPublicShareCache,
  contributionPanelAction,
  readPublicShareCache,
  reconcilePublicShareAlbum,
  savePublicShareCache,
  sharePublicAlbum,
  updatePublicShareCoverCache,
} from "../src/lib/publicShareFlow";
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

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  } as Storage;
}

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

test("cached public album is available immediately when the same share token is restored", () => {
  const storage = memoryStorage();
  savePublicShareCache("share-token", album, "memory", null, storage, 1_000);
  const cached = readPublicShareCache("share-token", storage, 1_500);

  assert.deepEqual(cached?.album, album);
  assert.equal(cached?.contributionAction, "memory");
});

test("an invalid public link can remove only its token-scoped cache", () => {
  const storage = memoryStorage();
  savePublicShareCache("active-token", album, null, null, storage);
  savePublicShareCache("invalid-token", album, null, null, storage);
  clearPublicShareCache("invalid-token", storage);
  assert.equal(readPublicShareCache("invalid-token", storage), null);
  assert.deepEqual(readPublicShareCache("active-token", storage)?.album, album);
});

test("cover change updates the cached public album without replacing its photos", () => {
  const storage = memoryStorage();
  const cachedAlbum = { ...album, photos: [{ id: "photo-1", sort_order: 0 }] };
  savePublicShareCache("share-token", cachedAlbum, null, null, storage);
  updatePublicShareCoverCache("share-token", "photo-1", "https://example.com/new-cover.jpg", storage);

  const cached = readPublicShareCache("share-token", storage);
  assert.equal(cached?.album.cover_photo_id, "photo-1");
  assert.equal(cached?.album.image_url, "https://example.com/new-cover.jpg");
  assert.deepEqual(cached?.album.photos, cachedAlbum.photos);
});

test("quiet public refresh preserves the photo array used by AlbumRenderer", () => {
  const photos = [{ id: "photo-1", sort_order: 1, comment: null }];
  const current = { ...album, photos, chapter_stories: { "2026-07-23": "함께한 하루" }, pending_items: [] };
  const refreshed = reconcilePublicShareAlbum(current, {
    ...album,
    photos: [{ id: "photo-1", sort_order: 1, comment: null, original_url: "https://cdn.example/new-signature.jpg" }],
    chapter_stories: { "2026-07-23": "함께한 하루" },
    pending_items: [{ id: "memory-1", type: "memory", actor_name: "민수", author_name: "민수" }],
  });

  assert.equal(refreshed.photos, photos);
  assert.equal(refreshed.chapter_stories, current.chapter_stories);
  assert.equal(refreshed.pending_items?.length, 1);
});

test("quiet refresh does not remove a contribution that was just added locally", () => {
  const current = appendPendingContributions(album, [{
    id: "photo-just-added",
    type: "photo",
    actor_name: "민수",
    author_name: "민수",
  }]);
  const refreshed = reconcilePublicShareAlbum(current, { ...album, pending_items: [] });

  assert.equal(refreshed.pending_items?.[0].id, "photo-just-added");
  assert.equal(refreshed.photo_count, 1);
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
