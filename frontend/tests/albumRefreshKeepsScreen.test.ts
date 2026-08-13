import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/00000000-0000-4000-8000-000000000001");

/**
 * 🔴 잠시 나갔다 돌아오면 보던 앨범이 `이 앨범을 열 수 없어요` 로 바뀌었다.
 *
 * 화면으로 돌아오면 60초 규칙(useRefreshOnReturn)에 따라 다시 읽는데, 예전에는
 * 읽기를 시작하면서 **보고 있던 것을 먼저 비웠다**(photosReady=false,
 * loadedAlbumId=null). 돌아오는 순간은 토큰이 갱신되는 중이거나 웹뷰가 네트워크를
 * 막 되살린 참이라 그 한 번이 401·403 을 받기 쉽다.
 * `다시 시도` 를 누르면 성공한다는 것이 곧 **실패가 아니라 잠깐 어긋난 것**이라는
 * 증거다. PO 가 5분도 안 되어 겪었다(2026-08-13).
 *
 * ★ 처음 여는 경우는 예전 그대로다 — 보여줄 것이 없을 때는 오류를 말해야 한다.
 * ★ 60초 규칙 자체는 그대로다. 바뀐 것은 **실패했을 때의 태도**뿐이다.
 */

const albumId = "00000000-0000-4000-8000-000000000001";

const album = {
  album_id: albumId, title: "우리 앨범", narrative: "", epilogue: "", image_url: "",
  date: "2026.08.13", chapter_stories: {}, photos: [], can_edit: true, can_delete: true,
  album_version: 1,
};
const photos = [{
  id: "photo-1", sort_order: 0, caption: "첫 사진", can_edit_caption: true, caption_author_name: null,
  original_url: "https://test.local/a.jpg", display_url: "https://test.local/a.webp",
  thumbnail_url: "https://test.local/a-t.webp",
}];

function setStub(ok: boolean, status = 403) {
  (globalThis as unknown as { __albumStub: unknown }).__albumStub = ok
    ? { album, photos }
    : { album, photos, albumError: { message: "no", status } };
}

async function mount() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumView } = await import("../src/components/AlbumView");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  const settle = () => React.act(async () => { await new Promise((r) => setTimeout(r, 40)); });

  await React.act(async () => { root.render(React.createElement(AlbumView, { albumId } as never)); });
  await settle();

  /**
   * 화면으로 **돌아온 것처럼** 만든다 — 60초 규칙을 넘기려 시계를 앞으로 돌리고
   * visibilitychange 를 보낸다. 실제로 60초를 기다리지 않는다.
   */
  const returnToScreen = async () => {
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    await React.act(async () => { document.dispatchEvent(new window.Event("visibilitychange")); });
    Date.now = realNow;
    await settle();
  };

  return {
    React, root, container, settle, returnToScreen,
    text: () => container.textContent || "",
    showsAlbum: () => /우리 앨범/.test(container.textContent || ""),
    showsError: () => /열 수 없어요|불러오지 못했/.test(container.textContent || ""),
    showsLoading: () => /불러오는 중|잠시만/.test(container.textContent || ""),
    cleanup: () => React.act(async () => { root.unmount(); }),
  };
}

test("★ 이미 보여준 앨범은 다시 읽기가 실패해도 오류로 바뀌지 않는다", async () => {
  setStub(true);
  const view = await mount();
  assert.equal(view.showsAlbum(), true, "먼저 앨범이 떠 있어야 한다");

  // 돌아왔다 — 다시 읽는데 이번엔 403 이다.
  setStub(false, 403);
  await view.returnToScreen();

  assert.equal(view.showsError(), false, "보던 앨범이 오류 화면으로 바뀌었다");
  assert.equal(view.showsAlbum(), true, "보던 것을 계속 봐야 한다");
  await view.cleanup();
});

test("★ 다시 읽는 동안에도 화면이 비워지지 않는다 — 로딩으로 깜빡이지 않는다", async () => {
  setStub(true);
  const view = await mount();
  setStub(false, 401);
  await view.returnToScreen();
  assert.equal(view.showsLoading(), false, "다시 읽으면서 화면을 비웠다");
  assert.equal(view.showsAlbum(), true);
  await view.cleanup();
});

test("★ 처음 열기가 실패하면 예전처럼 오류가 뜬다 — 보여줄 것이 없으면 말해야 한다", async () => {
  setStub(false, 403);
  const view = await mount();
  assert.equal(view.showsError(), true, "처음 열기 실패인데 오류가 안 보인다");
  assert.equal(view.showsAlbum(), false);
  await view.cleanup();
});

test("다시 읽기가 성공하면 새 내용으로 바뀐다 — 60초 규칙은 그대로다", async () => {
  setStub(true);
  const view = await mount();
  (globalThis as unknown as { __albumStub: { album: typeof album; photos: typeof photos } }).__albumStub = {
    album: { ...album, title: "새 제목" }, photos,
  };
  await view.returnToScreen();
  assert.match(view.text(), /새 제목/, "다시 읽기가 성공했는데 반영이 안 됐다");
  await view.cleanup();
});
