import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 촬영일을 **그 자리에서** 고친다 (2026-08-16).
 *
 * 장소는 연필로 고칠 수 있는데(2f21c6b) 날짜는 못 고쳤다. 그래서 카톡·다운로드를 거쳐
 * EXIF 가 지워진 사진은 날짜 줄이 통째로 안 나오고 손쓸 방법이 없었다(dev 실측 2026-08-14).
 * 스캔한 옛날 사진은 EXIF 에 **스캔한 날**이 들어가 시간순이 깨진다(제품_방향 §6-6).
 *
 * ★ 연필을 하나 더 만들지 않는다 — 장소와 **같은 자리, 같은 모양**이다(§7).
 * ★ 날짜는 앨범의 뼈대다. 바뀌면 묶음이 다시 갈리고 **이야기가 새 날짜를 따라간다.**
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");
const header = read("album-engine/blocks/ChapterHeader.tsx");
const savePlace = view.slice(view.indexOf("const handleSavePlace"), view.indexOf("const handleSaveTitle"));

async function renderHeader(placeEdit: Record<string, unknown> | null, props: Record<string, unknown> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ChapterHeader } = await import("../src/album-engine/blocks/ChapterHeader");
  const { PlaceEditProvider } = await import("../src/album-engine/components/PlaceEditContext");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PlaceEditProvider as never, { value: placeEdit } as never,
      React.createElement(ChapterHeader as never, {
        dayIndex: 1, date: "2018-07-08", dateLabel: null, place: "제주 서귀포시",
        locationSource: "exif", photoCount: 2, variant: "date-only",
        placeKey: "2018-07-08", placePhotoIds: ["p1", "p2"], ...props,
      } as never)));
  });
  return {
    React, container,
    dateInputs: () => container.querySelectorAll(".chapter-header__date-input").length,
    placeInputs: () => container.querySelectorAll(".chapter-header__place-input:not(.chapter-header__date-input)").length,
    addDate: () => container.querySelectorAll(".chapter-header__add-date").length,
    text: () => container.textContent || "",
    click: async (text: string) => {
      const target = Array.from(container.querySelectorAll("button"))
        .find((button) => (button.textContent || "").includes(text));
      assert.equal(target != null, true, `누를 것을 못 찾았다: ${text}`);
      await React.act(async () => { target!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    },
    cleanup: async () => { await React.act(async () => { root.unmount(); }); },
  };
}

const EDITING = {
  canEdit: true, editingKey: "2018-07-08", savingKey: null, draft: "제주 서귀포시",
  dateDraft: "2018.07.08", setDateDraft: () => {},
  startEdit: () => {}, cancelEdit: () => {}, setDraft: () => {}, saveEdit: () => {},
};

test("★ 날짜와 장소를 **한 자리에서** 고친다 — 연필은 하나다", async () => {
  const editing = await renderHeader(EDITING);
  assert.equal(editing.dateInputs(), 1, "날짜 칸이 없다");
  assert.equal(editing.placeInputs(), 1, "장소 칸이 없다");
  // 연필이 둘이 되지 않았다.
  assert.equal(editing.container.querySelectorAll(".chapter-header__edit-btn").length, 0, "고치는 중에 연필이 남았다");
  await editing.cleanup();

  // 연필은 여전히 하나다(고치기 전 상태).
  const idle = await renderHeader({ ...EDITING, editingKey: null });
  assert.equal(idle.container.querySelectorAll(".chapter-header__edit-btn").length, 1, "연필이 하나가 아니다");
  await idle.cleanup();
});

test("★ 날짜가 없는 묶음에는 주최자에게만 `날짜 넣기` 가 있다 (회귀 ⑥)", async () => {
  const noDate = { date: null, dateRangeLabel: null, place: null, photoCount: 0, placeKey: "0" };
  const owner = await renderHeader({ ...EDITING, editingKey: null }, noDate);
  assert.equal(owner.addDate(), 1, "주최자인데 넣을 자리가 없다");
  assert.match(owner.text(), /날짜 넣기/);
  await owner.cleanup();

  // 참여자·구경꾼에게는 아무것도 없다 — 빈 줄도 남기지 않는다.
  for (const value of [null, { ...EDITING, canEdit: false, editingKey: null }]) {
    const reader = await renderHeader(value, noDate);
    assert.equal(reader.addDate(), 0);
    assert.equal(reader.text(), "", "빈 줄이 남았다");
    await reader.cleanup();
  }
});

test("★ `날짜 넣기` 를 누르면 그 자리가 입력칸이 된다 — 새 시트가 아니다", async () => {
  const started: Array<[string, string]> = [];
  const owner = await renderHeader(
    { ...EDITING, editingKey: null, startEdit: (key: string, text: string) => { started.push([key, text]); } },
    { date: null, dateRangeLabel: null, place: null, photoCount: 0, placeKey: "0" },
  );
  await owner.click("날짜 넣기");
  assert.deepEqual(started, [["0", ""]]);
  assert.equal(owner.container.querySelectorAll(".album-inline-action").length, 0, "새 시트를 열었다");
  await owner.cleanup();
});

test("★ 그 묶음 사진 **전부**의 촬영일이 바뀐다 (회귀 ①)", () => {
  // 장소와 같은 길이다 — 사진마다 같은 값을 보낸다.
  assert.match(savePlace, /photoIds\.map\(\(photoId\) => updateAlbumPhotoLocation\(albumId, photoId, \{/);
  assert.match(savePlace, /\.\.\.\(nextDate \? \{ taken_at: `\$\{nextDate\}T00:00:00Z` \} : \{\}\)/);
  // 응답의 taken_at 을 화면에 다시 넣는다 — 이것이 없으면 묶음이 안 갈린다.
  assert.match(savePlace, /taken_at: next\.taken_at/);
});

test("★ 이야기가 새 날짜를 따라간다 · 덮어쓰지 않는다 (회귀 ③④)", () => {
  // 옮길 글이 없으면 아무것도 하지 않는다.
  assert.match(savePlace, /const moving = \(stories\[editingPlaceKey\] \|\| ""\)\.trim\(\);/);
  // 새 자리에 글이 있으면 **줄바꿈으로 잇는다**(덮어쓰지 않는다).
  assert.match(savePlace, /existing \? `\$\{existing\}\\n\$\{moving\}` : moving/);
  // 새 자리에 **먼저** 쓰고 옛 자리를 비운다 — 중간에 실패해도 글이 사라지지 않는다.
  const mergeAt = savePlace.indexOf("await patchChapterStory(albumId, nextDate");
  const clearAt = savePlace.indexOf('await patchChapterStory(albumId, editingPlaceKey, "")');
  assert.equal(mergeAt !== -1 && clearAt !== -1 && mergeAt < clearAt, true, "옛 글을 먼저 지운다");
  // 이야기를 새로 만들지 않는다(AI 를 부르지 않는다).
  assert.equal(savePlace.includes("generate"), false);
});

test("★ 날짜를 **바꿀 때만** 묻는다 — 장소만 고칠 때는 안 묻는다", () => {
  const request = view.slice(view.indexOf("const requestSavePlace ="), view.indexOf("const handleSaveTitle"));
  assert.match(request, /if \(parsed && parsed !== placeKey\) \{[\s\S]*?setPendingDateMove\(/);
  // 형식이 아니면 우리 말로 알리고 보내지 않는다.
  assert.match(request, /setPlaceSaveError\("날짜는 2018\.07\.08 처럼 적어 주세요\."\);/);
  // 묻는 것은 시트다 — window.confirm 을 쓰지 않는다.
  assert.equal(/window\.confirm\s*\(/.test(view), false);
  const sheet = view.slice(view.indexOf("{pendingDateMove ? ("), view.indexOf("{/* 사진 빼기"));
  assert.match(sheet, /장을 \$\{pendingDateMove\.date\.replace\(\/-\/g, "\."\)\} 로 옮길까요\?/);
  assert.match(sheet, /description="앨범에서 이 사진들의 자리가 바뀌어요\."/);
  assert.match(sheet, /confirmLabel="옮기기"/);
  assert.match(sheet, /cancelFirst/);
  // ★ 되돌릴 수 있다 — 그렇게 쓰지 않는다.
  assert.equal(sheet.includes("되돌릴 수 없"), false, "되돌릴 수 없다고 썼다");
  assert.equal(sheet.includes("danger"), false, "지우기처럼 빨갛게 물었다");
});

test("★ 주최자만 고친다 — 연필은 canEdit 하나로 갈린다 (회귀 ⑤)", () => {
  assert.match(header, /const canEditPlace = Boolean\(placeEdit\?\.canEdit && placeKey\);/);
  assert.match(view, /placeEdit=\{canEdit \? \{ canEdit: true/);
});

test("★ 새 주소를 만들지 않았다 — 장소를 고치던 그 PATCH 다 (§10)", () => {
  const api = read("lib/api.ts");
  assert.equal((api.match(/photos\/\$\{photoId\}\/location/g) || []).length, 1, "주소가 늘었다");
  assert.match(api, /taken_at\?: string;/);
  // 안 넣으면 아예 안 보낸다 — 서버가 `없으면 건드리지 않는다` 로 읽는다.
  assert.match(api, /\.\.\.\(payload\.taken_at \? \{ taken_at: payload\.taken_at \} : \{\}\)/);
});

test("★ 앨범을 다시 만들지 않는다 — 날짜만 바뀐다", () => {
  assert.equal(savePlace.includes("setRetryKey"), false, "앨범을 통째로 다시 읽는다");
  assert.equal(savePlace.includes("applyContributions"), false, "앨범을 다시 만든다");
  // 표지도 그대로다.
  assert.equal(savePlace.includes("cover_photo_id"), false, "표지를 건드린다");
});
