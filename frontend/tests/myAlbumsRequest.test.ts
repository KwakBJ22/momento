import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeMyAlbumCoverUrls,
  requestMyAlbumCovers,
  requestMyAlbumList,
  resetMyAlbumRequestsForTest,
} from "../src/lib/myAlbumsRequest";

test("the customer album list shares a StrictMode duplicate request", async () => {
  resetMyAlbumRequestsForTest();
  let calls = 0;
  const load = async () => {
    calls += 1;
    return [{ album_id: "album-1", title: "앨범" }];
  };

  const [first, second] = await Promise.all([requestMyAlbumList(load), requestMyAlbumList(load)]);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test("cover URLs load separately and do not replace the visible album metadata", async () => {
  resetMyAlbumRequestsForTest();
  const albums = [
    { album_id: "album-1", cover_photo_id: "photo-1", title: "첫 앨범", cover_image_url: null },
    { album_id: "album-2", cover_photo_id: null, title: "두 번째 앨범", cover_image_url: null },
  ];
  let calls = 0;

  const covers = await requestMyAlbumCovers(albums, async (targets) => {
    calls += 1;
    assert.deepEqual(targets.map((target) => target.album_id), ["album-1"]);
    return { "album-1": "https://cdn.example/cover.jpg" };
  });
  const merged = mergeMyAlbumCoverUrls(albums, covers);

  assert.equal(calls, 1);
  assert.equal(merged[0].title, "첫 앨범");
  assert.equal(merged[0].cover_image_url, "https://cdn.example/cover.jpg");
  assert.equal(merged[1].cover_image_url, null);
});

test("cover URL requests are also shared while they are in flight", async () => {
  resetMyAlbumRequestsForTest();
  let calls = 0;
  const albums = [{ album_id: "album-1", cover_photo_id: "photo-1" }];
  const load = async () => {
    calls += 1;
    return { "album-1": "https://cdn.example/cover.jpg" };
  };

  await Promise.all([requestMyAlbumCovers(albums, load), requestMyAlbumCovers(albums, load)]);

  assert.equal(calls, 1);
});
