import assert from "node:assert/strict";
import test from "node:test";

// Minimal HTMLImageElement stub so isAlbumPhotoImageError's `instanceof` works in node.
class FakeImg {
  private _classes = new Set<string>();
  classList = {
    add: (c: string) => this._classes.add(c),
    contains: (c: string) => this._classes.has(c),
  };
}
(globalThis as unknown as { HTMLImageElement: unknown }).HTMLImageElement = FakeImg;

const {
  mergeRefreshedPhotoUrls, isAlbumPhotoImageError, createSignedUrlRefresher,
} = await import("../src/lib/signedUrlRefresh");
type AnyPhoto = import("../src/types").AlbumPhoto;

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

const photo = (id: string, tag: string): AnyPhoto => ({
  id, sort_order: 0, comment: `c-${id}`,
  original_url: `orig-${tag}-${id}`, display_url: `disp-${tag}-${id}`, thumbnail_url: `thumb-${tag}-${id}`,
} as AnyPhoto);

const albumImg = () => { const i = new FakeImg(); i.classList.add("album-photo-frame__img"); return i as unknown as EventTarget; };

test("mergeRefreshedPhotoUrls replaces only URL fields, preserving id/order/other fields (no remount)", () => {
  const current = [photo("a", "old"), photo("b", "old"), photo("c", "old")];
  const refreshed = [photo("b", "new"), photo("a", "new")]; // order differs, "c" missing
  const merged = mergeRefreshedPhotoUrls(current, refreshed);

  assert.deepEqual(merged.map((p) => p.id), ["a", "b", "c"]); // order preserved → stable React keys
  assert.equal(merged[0].original_url, "orig-new-a");         // fresh URL swapped in
  assert.equal(merged[0].display_url, "disp-new-a");
  assert.equal(merged[0].thumbnail_url, "thumb-new-a");
  assert.equal(merged[0].comment, "c-a");                     // non-URL field kept
  assert.equal(merged[2].original_url, "orig-old-c");         // "c" not in refreshed → untouched
});

test("isAlbumPhotoImageError only fires for an album photo <img>", () => {
  assert.equal(isAlbumPhotoImageError(albumImg()), true);
  assert.equal(isAlbumPhotoImageError(new FakeImg() as unknown as EventTarget), false); // some other image
  assert.equal(isAlbumPhotoImageError(null), false);
  assert.equal(isAlbumPhotoImageError({} as EventTarget), false);
});

test("an expired-URL error refetches the photo list exactly once; the second error does not", async () => {
  let fetchCount = 0;
  const applied: AnyPhoto[][] = [];
  const current = [photo("a", "old")];
  const refresher = createSignedUrlRefresher({
    fetchPhotos: async () => { fetchCount += 1; return [photo("a", "new")]; },
    applyPhotos: (updater) => applied.push(updater(current)),
  });

  assert.equal(refresher.handleImageError(albumImg()), true);  // first error triggers refetch
  assert.equal(refresher.handleImageError(albumImg()), false); // second error: ignored (no stampede/loop)
  await wait();
  assert.equal(fetchCount, 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0].original_url, "orig-new-a");      // URLs swapped in place
});

test("a non-album image error never triggers a refetch", async () => {
  let fetchCount = 0;
  const refresher = createSignedUrlRefresher({
    fetchPhotos: async () => { fetchCount += 1; return []; },
    applyPhotos: () => {},
  });
  assert.equal(refresher.handleImageError(new FakeImg() as unknown as EventTarget), false);
  await wait();
  assert.equal(fetchCount, 0);
});
