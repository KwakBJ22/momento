import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 한마디를 **사진 밑에서 바로** 쓴다 (2026-08-15).
 *
 * 지금까지는 하단 네비 `한마디 쓰기` → 사진 목록 → 그 사진 찾기 였다. 초대받아 처음 온
 * 사람이 그 길을 끝까지 가는 비율이 낮을 수밖에 없다 — 시범운영 지표 셋 중 둘이
 * 참여율이다(§8).
 *
 * C1 에서 이미 둔 `한마디 남기기` 한 줄을 **누르면 그 자리가 입력칸**이 된다.
 * 캡션 고치기와 같은 모양이고, 새 시트를 열지 않는다(§7·§11).
 *
 * ★ 캡션과 갈려 있다: 캡션은 그 사진을 올린 사람만, 한마디는 **구경꾼까지 셋 다**.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");

const PHOTO_ID = "6f434e11";

async function renderList(value: Record<string, unknown> | null, entries: Array<{ author: string | null; text: string }> = []) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { PhotoMemoryWriteProvider } = await import("../src/album-engine/components/PhotoMemoryWriteContext");
  const PhotoMemoryList = (await import("../src/album-engine/components/PhotoMemoryList")).default;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PhotoMemoryWriteProvider as never, { value } as never,
      React.createElement(PhotoMemoryList as never, { entries, photoId: PHOTO_ID } as never)));
  });
  return {
    React, container,
    inputs: () => container.querySelectorAll(".photo-memory-list__input").length,
    items: () => container.querySelectorAll(".photo-memory-list__item").length,
    click: async (text: string) => {
      const target = Array.from(container.querySelectorAll("button"))
        .find((button) => (button.textContent || "").includes(text));
      assert.equal(target != null, true, `누를 것을 못 찾았다: ${text}`);
      await React.act(async () => { target!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    },
    cleanup: async () => {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

const WRITE = {
  canWrite: () => true, writingPhotoId: null, savingPhotoId: null, error: null, draft: "",
  start: () => {}, cancel: () => {}, setDraft: () => {}, save: () => {},
};

test("★ `한마디 남기기` 를 누르면 그 자리가 입력칸이 된다 — 새 시트를 열지 않는다", async () => {
  const started: string[] = [];
  const closed = await renderList({ ...WRITE, start: (photoId: string) => { started.push(photoId); } });
  assert.equal(closed.inputs(), 0, "누르기도 전에 입력칸이 있다");
  await closed.click("한마디 남기기");
  assert.deepEqual(started, [PHOTO_ID]);
  await closed.cleanup();

  // 열린 상태 — 입력칸과 [남기기][취소] 가 그 자리에 있다.
  const open = await renderList({ ...WRITE, writingPhotoId: PHOTO_ID, draft: "좋았어요" });
  assert.equal(open.inputs(), 1);
  assert.match(open.container.textContent || "", /남기기/);
  assert.match(open.container.textContent || "", /취소/);
  await open.cleanup();
});

test("★ 이미 한마디가 있으면 목록 **아래**에 붙는다 — 목록을 밀어내지 않는다", async () => {
  const entries = [{ author: "엄마", text: "우산 하나로 버텼지" }];
  const open = await renderList({ ...WRITE, writingPhotoId: PHOTO_ID, draft: "나도" }, entries);
  assert.equal(open.items(), 1, "있던 한마디가 사라졌다");
  assert.equal(open.inputs(), 1);
  // 순서: 목록 → 입력칸.
  const html = open.container.innerHTML;
  assert.equal(html.indexOf("photo-memory-list__items") < html.indexOf("photo-memory-list__editor"), true);
  await open.cleanup();
});

test("★ 쓸 수 없으면 예전 그대로다 — 하단 네비 흐름으로 간다", async () => {
  const events: string[] = [];
  const listener = (event: Event) => { events.push((event as CustomEvent<{ action?: string }>).detail?.action || ""); };
  window.addEventListener("woorialbum:album-action", listener);
  // 값이 아예 안 오는 경우(공유 화면 밖·예전 화면)와, 못 쓴다고 온 경우 둘 다.
  for (const value of [null, { ...WRITE, canWrite: () => false }]) {
    const dom = await renderList(value);
    await dom.click("한마디 남기기");
    assert.equal(dom.inputs(), 0, "못 쓰는데 입력칸이 열렸다");
    await dom.cleanup();
  }
  window.removeEventListener("woorialbum:album-action", listener);
  assert.deepEqual(events, ["memory", "memory"], "하단 네비 흐름을 부르지 않았다");
});

test("★ 구경꾼도 한마디를 쓴다 — 캡션과 갈려 있다 (회귀 ①)", () => {
  // 한마디: 백엔드의 can_contribute 하나로 가른다(역할을 추측하지 않는다).
  assert.match(view, /canWrite: \(\) => requestedEdition === null && displayAlbum\?\.can_contribute === true/);
  // 캡션: 그 사진의 can_edit_caption 이다. 둘이 **다른 값**을 본다.
  assert.match(view, /canEditPhoto: \(photoId: string\) => photoById\.get\(photoId\)\?\.can_edit_caption === true/);
});

test("★ 저장하면 그 사진 밑에만 붙는다 — 재마운트가 없다 (회귀 ②)", () => {
  const handler = view.slice(view.indexOf("const saveMemoryHere ="), view.indexOf("사진 한 장을 앨범에서 뺀다"));
  // 새 API 를 만들지 않았다 — 지금 쓰는 그 함수를 부른다.
  assert.match(handler, /await createPhotoMemory\(albumId, photoId, session, text\);/);
  // 그 사진의 comments 에만 더한다. 다시 읽지도(setRetryKey) 화면을 다시 열지도 않는다.
  assert.match(handler, /photo\.id === photoId[\s\S]*?\{ \.\.\.photo, comments: \[\.\.\.\(photo\.comments \?\? \[\]\), \{ author: session\.displayName \|\| null, text \}\] \}/);
  assert.equal(handler.includes("setRetryKey"), false, "앨범을 통째로 다시 읽는다");
  assert.equal(handler.includes("window.location"), false, "화면을 다시 연다");
});

test("★ 실패해도 쓴 글이 남는다 (회귀 ③)", () => {
  const handler = view.slice(view.indexOf("const saveMemoryHere ="), view.indexOf("사진 한 장을 앨범에서 뺀다"));
  // catch 는 문구만 세운다 — 초안(draft)도 열린 사진도 건드리지 않는다.
  const caught = handler.slice(handler.indexOf("} catch {"));
  assert.match(caught, /setMemoryWriteError\("한마디를 남기지 못했어요\. 다시 시도해 주세요\."\);/);
  assert.equal(caught.includes("setMemoryDraft"), false, "실패했는데 쓴 글을 지운다");
  assert.equal(caught.includes("setMemoryPhotoId"), false, "실패했는데 입력칸을 닫는다");
  // 서버가 준 말을 그대로 내지 않는다(§11).
  assert.equal(/userFacingError\(/.test(handler), false);
});

test("★ 이름을 새로 묻지 않는다 — 이미 있는 흐름이 받는다", () => {
  const start = view.slice(view.indexOf("const startMemoryHere ="), view.indexOf("const saveMemoryHere ="));
  assert.match(start, /const session = contributionSession \?\? loadCollabSession\(albumId\);/);
  assert.match(start, /if \(!session\) \{[\s\S]*?void openContribution\("memory"\);/);
  // 이름을 받는 입력칸을 여기서 만들지 않는다.
  assert.equal(start.includes("displayName"), false, "이름을 묻는 자리가 둘이 됐다");
});

test("★ 인쇄에는 한마디가 없다 (회귀 ④ — C1 그대로)", async () => {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer as never, {
      photos: [{
        id: PHOTO_ID, sort_order: 1, original_url: "https://cdn.test/1.jpg",
        display_url: "https://cdn.test/1.webp", thumbnail_url: "https://cdn.test/1-t.webp",
        caption: "바다", taken_at: "2026-08-01T09:00:00Z", width: 1200, height: 900,
        comments: [{ author: "둘째", text: "신난 리원이" }],
      }],
      title: "우리 여행", epilogue: "좋았다.", albumId: "album-1", mode: "print",
      photoMemoryWrite: WRITE,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  assert.equal(container.querySelectorAll(".photo-memory-list").length, 0, "인쇄에 한마디가 따라갔다");
  assert.equal(container.querySelectorAll(".photo-memory-list__input").length, 0, "인쇄에 입력칸이 갔다");
  assert.equal((container.textContent || "").includes("신난 리원이"), false);
  await React.act(async () => { root.unmount(); });
});

test("★ 300자 상한은 지금 쓰는 값과 같다", () => {
  const list = read("album-engine/components/PhotoMemoryList.tsx");
  assert.match(list, /const MEMORY_MAX_LENGTH = 300;/);
  assert.match(list, /maxLength=\{MEMORY_MAX_LENGTH\}/);
});

test("★ 하단 네비 `한마디 쓰기` 를 없애지 않았다 — 두 길이 다 있다", () => {
  assert.match(read("components/AlbumBottomNavigation.tsx"), /한마디/);
  assert.match(view, /openContribution\("memory"\)/);
});
