import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 보관함 — **지우지 않고 감춰 두는 길** (2026-08-17 · 시안 delete-sheet 1b ②단계).
 *
 * 대부분의 사람이 실제로 원하는 것은 지우는 것이 아니라 `치우는 것`이다.
 * 삭제를 막지 않되, 되돌릴 수 있는 쪽을 먼저 권한다.
 *
 * ★ 보관은 **아무것도 지우지 않는다** — 사진·한마디 수가 그대로다. 그래야
 *   `언제든 다시 꺼낼 수 있어요` 가 참말이 된다.
 * ★ 새 페이지를 만들지 않는다(§7) — 목록 맨 아래에서 그 자리에 펼친다.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/my-albums");

const album = (id: string, title: string, photos = 9) => ({
  album_id: id, title, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
  image_url: "", cover_image_url: null, photo_count: photos, new_memory_count: 0, status: "active",
});

async function renderList(data: Record<string, unknown>) {
  const stub = await import("./support/apiStub");
  stub.setMyAlbums(data);
  stub.archiveCalls.length = 0;
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { default: MyAlbums } = await import("../src/components/MyAlbums");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(MyAlbums as never, { userId: "u1" } as never)); });
  await React.act(async () => { await Promise.resolve(); });

  const view = {
    root,
    container,
    React,
    /** 카드 제목들 — 어느 목록에 무엇이 있는지 본다. */
    titles: () => [...container.querySelectorAll("h3")].map((node) => node.textContent || ""),
    toggleLabel: () => container.querySelector(".my-albums__archive-toggle")?.textContent?.trim() ?? null,
    unarchiveCount: () => [...container.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("다시 꺼내기")).length,
    calls: stub.archiveCalls,
    async click(label: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((node) => (node.textContent || "").includes(label));
      assert.equal(Boolean(button), true, `누를 것이 없다: ${label}`);
      await React.act(async () => { button!.click(); });
      await React.act(async () => { await Promise.resolve(); });
    },
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
  return view;
}

test("★ 보관함이 비어 있으면 줄 자체가 없다", async () => {
  const view = await renderList({ albums: [album("a1", "우리의 추억")], participating: [], bookmarked: [], archived: [] });
  assert.equal(view.toggleLabel(), null);
  await view.unmount();
});

test("★ 보관함은 **목록 맨 아래 접힌 줄**이다 — 눌러야 그 자리에서 펼쳐진다", async () => {
  const view = await renderList({
    albums: [album("a1", "우리의 추억")], participating: [], bookmarked: [],
    archived: [album("a2", "작년 여행"), album("a3", "겨울")],
  });
  assert.equal(view.toggleLabel(), "보관함 2개");
  // 접혀 있을 때는 보관한 앨범이 안 보인다.
  assert.equal(view.titles().includes("작년 여행"), false);
  await view.click("보관함 2개");
  assert.equal(view.titles().includes("작년 여행"), true, "펼쳐도 안 나온다");
  // 보관한 카드에는 `다시 꺼내기` 하나뿐이다.
  assert.equal(view.unarchiveCount(), 2);
  await view.unmount();
});

test("★ 보관하면 내 앨범에서 빠지고 보관함에 들어간다 — **사진 수는 그대로다**", async () => {
  const view = await renderList({ albums: [album("a1", "우리의 추억", 9)], participating: [], bookmarked: [], archived: [] });
  await view.click("삭제");            // 지우기 시트를 연다
  await view.click("보관함에 넣기");    // 그 안에서 되돌릴 길을 고른다
  assert.deepEqual(view.calls, [{ action: "archive", albumId: "a1" }]);
  // 내 앨범 목록에서는 빠졌다.
  assert.equal(view.container.querySelectorAll(".my-albums__list .my-albums__card").length, 0);
  // 보관함에 들어갔고, **사진 9장이 그대로다**(지운 것이 아니다).
  assert.equal(view.toggleLabel(), "보관함 1개");
  await view.click("보관함 1개");
  assert.match(view.container.textContent || "", /사진 9장/);
  await view.unmount();
});

test("★ 넣자마자 되돌릴 길을 준다 — `되돌리기` 가 꺼내기를 부른다", async () => {
  const view = await renderList({ albums: [album("a1", "우리의 추억")], participating: [], bookmarked: [], archived: [] });
  await view.click("삭제");
  await view.click("보관함에 넣기");
  assert.match(view.container.textContent || "", /보관함에 넣었어요/);
  await view.click("되돌리기");
  assert.deepEqual(view.calls, [
    { action: "archive", albumId: "a1" },
    { action: "unarchive", albumId: "a1" },
  ]);
  // 다시 내 앨범으로 돌아왔다.
  assert.equal(view.titles().includes("우리의 추억"), true);
  await view.unmount();
});

test("★ 보관함에서 꺼내면 목록으로 돌아온다", async () => {
  const view = await renderList({ albums: [], participating: [], bookmarked: [], archived: [album("a2", "작년 여행")] });
  await view.click("보관함 1개");
  await view.click("다시 꺼내기");
  assert.deepEqual(view.calls, [{ action: "unarchive", albumId: "a2" }]);
  assert.equal(view.toggleLabel(), null, "보관함이 비었는데 줄이 남았다");
  assert.equal(view.titles().includes("작년 여행"), true);
  await view.unmount();
});

test("★ 되돌릴 길은 지우기 **전에** 온다 — 위험 버튼보다 위다", () => {
  const sheet = readFileSync(new URL("../src/components/AlbumDeleteSheet.tsx", import.meta.url), "utf8");
  const keep = sheet.indexOf("album-delete-sheet__keep");
  const actions = sheet.indexOf("album-delete-sheet__actions");
  assert.ok(keep > -1 && keep < actions, "보관 블록이 버튼보다 아래에 있다");
  // 보관 길이 없으면 반쪽 버튼을 그리지 않는다.
  assert.match(sheet, /\{onArchive \? \(/);
});
