import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/abc");

/**
 * 🔴 대표사진을 바꿔도 저장되지 않는다.
 *
 * PO 가 잰 것(2026-08-12): 개발 DB `cover_photo_changed` **0건** — 한 번도 성공한 적이
 * 없다. `albums.cover_photo_id` 도 그대로다.
 *
 * ★ 원인은 선택값을 맞추는 효과의 **의존 목록**이었다:
 *     useEffect(() => setSelectedCoverId(coverPhotoId || photos[0]?.id || null),
 *               [coverPhotoId, photos]);
 *   `photos` 는 배열이라 앨범을 다시 받을 때마다(사진 새로고침·캡션 저장·서명 URL 갱신)
 *   **내용이 같아도 새 배열**이 된다. 그때마다 효과가 다시 돌아 사용자가 방금 고른 사진을
 *   **지금 대표사진으로 되돌렸다.** 그래서 저장을 눌러도 바뀐 적 없는 값이 나가고,
 *   서버는 바꿀 것이 없어 이벤트도 남지 않았다.
 *
 * 고른 뒤 저장까지 사이에 앨범이 **한 번만** 다시 그려져도 그렇게 된다.
 */

const PHOTOS = () => [
  { id: "photo-1", thumbnail_url: "a.jpg", original_url: "a.jpg" },
  { id: "photo-2", thumbnail_url: "b.jpg", original_url: "b.jpg" },
  { id: "photo-3", thumbnail_url: "c.jpg", original_url: "c.jpg" },
];

async function mountPanel(initial: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { updateAlbumCoverPhotoCalls } = await import("./support/apiStub");
  const { default: Panel } = await import("../src/components/CollaborationPanel");
  updateAlbumCoverPhotoCalls.length = 0;

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  const render = (props: Record<string, unknown>) => React.act(async () => {
    root.render(React.createElement(Panel as never, {
      albumId: "album-1", imageUrl: "", hideDuplicatedActions: true, ...initial, ...props,
    } as never));
  });
  const settle = () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

  const tiles = () => Array.from(container.querySelectorAll(".collab-panel__cover-grid button")) as HTMLButtonElement[];
  const click = (el: Element) => React.act(async () => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  return {
    React, root, container, render, settle, tiles, click, calls: updateAlbumCoverPhotoCalls,
    selectedIndex: () => tiles().findIndex((tile) => tile.className.includes("is-selected")),
    saveButton: () => Array.from(container.querySelectorAll("button"))
      .find((button) => /^저장/.test((button.textContent || "").trim())) as HTMLButtonElement | undefined,
    pickerOpen: () => Boolean(container.querySelector(".collab-panel__cover-modal")),
    error: () => (container.querySelector(".notice--error")?.textContent || "").trim(),
    cleanup: () => React.act(async () => { root.unmount(); }),
  };
}

test("★ 고른 사진이 앨범 새로고침에 지워지지 않는다 — 이것이 결함이었다", async () => {
  const view = await mountPanel({ coverPhotoId: "photo-2", photos: PHOTOS() });
  await view.render({ coverPickerRequest: 1 });
  await view.settle();

  assert.equal(view.selectedIndex(), 1, "열었을 때 지금 대표사진이 골라져 있어야 한다");
  await view.click(view.tiles()[2]);
  assert.equal(view.selectedIndex(), 2, "누른 사진이 골라져야 한다");

  // 내용이 같은 **새 배열**을 넘긴다 — 실제 앱에서 늘 일어나는 일이다.
  await view.render({ coverPickerRequest: 1, photos: PHOTOS() });
  assert.equal(view.selectedIndex(), 2, "새로고침이 고른 사진을 되돌렸다");

  await view.click(view.saveButton()!);
  await view.settle();
  assert.deepEqual(view.calls, [{ albumId: "album-1", photoId: "photo-3" }], "고른 사진이 아니라 옛 대표사진이 나갔다");
  await view.cleanup();
});

test("★ 앨범이 늦게 도착해도 픽커를 열면 지금 대표사진이 골라져 있다", async () => {
  // AlbumView 는 앨범을 나중에 받는다 — 패널이 먼저 마운트되면 coverPhotoId 가 아직 없다.
  const view = await mountPanel({ coverPhotoId: undefined, photos: [] });
  await view.render({ coverPhotoId: undefined, photos: [] });
  // 앨범과 사진이 도착한다.
  await view.render({ coverPhotoId: "photo-3", photos: PHOTOS() });
  // 그리고 나서 연다.
  await view.render({ coverPhotoId: "photo-3", photos: PHOTOS(), coverPickerRequest: 1 });
  await view.settle();

  assert.equal(view.selectedIndex(), 2, "늦게 온 대표사진이 반영되지 않았다");
  assert.equal(view.saveButton()?.disabled, false, "저장이 막혀 있다");
  await view.cleanup();
});

test("성공하면 시트가 닫힌다", async () => {
  const view = await mountPanel({ coverPhotoId: "photo-1", photos: PHOTOS() });
  await view.render({ coverPickerRequest: 1 });
  await view.settle();
  await view.click(view.tiles()[1]);
  await view.click(view.saveButton()!);
  await view.settle();

  assert.equal(view.calls.length, 1);
  assert.equal(view.pickerOpen(), false, "성공했는데 시트가 열려 있다");
  await view.cleanup();
});

test("★ 고를 것이 없으면 조용히 끝나지 않는다 (§11)", async () => {
  // 사진이 없으면 선택값이 null 이다. 예전에는 `if (!selectedCoverId) return;` 이
  // 아무 말 없이 끝나서, 저장을 눌러도 시트가 그대로고 아무 일도 안 일어났다.
  const view = await mountPanel({ coverPhotoId: undefined, photos: [] });
  await view.render({ coverPickerRequest: 1 });
  await view.settle();

  const panel = await import("../src/components/CollaborationPanel");
  assert.ok(panel.default, "패널이 마운트되지 않았다");
  const source = (await import("node:fs")).readFileSync(
    new URL("../src/components/CollaborationPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!selectedCoverId\) \{\s*\n\s*setError\("대표사진으로 쓸 사진을 먼저 골라 주세요\."\);\s*\n\s*return;/);
  assert.equal(/if \(!selectedCoverId\) return;/.test(source), false, "조용히 끝나는 자리가 남았다");
  await view.cleanup();
});

test("★ 실패 이유를 버리지 않는다 — 화면 문구는 그대로", async () => {
  const source = (await import("node:fs")).readFileSync(
    new URL("../src/components/CollaborationPanel.tsx", import.meta.url), "utf8");
  const save = source.slice(source.indexOf("const saveCover = async"), source.indexOf("const started ="));
  // 콘솔에는 진짜 이유가 남는다(기존 장치를 쓴다 — 새로 만들지 않는다).
  assert.match(save, /authDebug\("COVER_PHOTO_SAVE_FAILED", \{/);
  assert.match(save, /reason: cause instanceof Error \? cause\.message : String\(cause\)/);
  // 화면에는 우리 말 그대로다(26차 — 서버 문구를 그대로 내지 않는다).
  assert.match(save, /setError\("대표사진을 변경하지 못했습니다\. 다시 시도해 주세요\."\)/);
  assert.equal(save.includes("setError(cause"), false, "서버 문구가 화면으로 샌다");
});

test("선택값은 하나다 — 두 벌로 만들지 않았다", () => {
  const source = readFileSync(new URL("../src/components/CollaborationPanel.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/useState<string \| null>\(coverPhotoId/g) || []).length, 1);
  assert.equal((source.match(/setSelectedCoverId\(/g) || []).length, 2, "맞추는 자리(열 때) + 누를 때, 둘이어야 한다");
  // 픽커를 열 때 한 번만 맞춘다 — 열려 있는 동안에는 건드리지 않는다.
  assert.match(source, /if \(!coverPickerOpen\) return;\s*\n\s*setSelectedCoverId\(coverPhotoId \|\| photos\[0\]\?\.id \|\| null\);/);
});
