import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/album-1");

/**
 * 날짜 줄의 **장소**를 그 자리에서 고친다 (2026-08-14).
 *
 * 화면은 `2018.07.08 · 제주 서귀포시 (사진 2장)` 까지 나오는데 고칠 길이 없었다.
 *
 * ★ 주최자에게만 보이는 연필이고, 누르면 **그 줄이 입력칸**이 된다 — 새 시트를
 *   열지 않는다(§7).
 * ★ 저장하면 그 날짜 묶음의 **사진 전부**에 같은 장소가 들어간다. 한 장씩 고치게
 *   하면 같은 날 같은 곳인데 사진마다 다른 이름이 붙는다.
 * ★ location_source 는 "user" — 사람이 고친 것을 다음에 덮어쓰지 않는다.
 * ★ 비우고 저장하면 지워진다("unknown").
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");
const header = read("album-engine/blocks/ChapterHeader.tsx");

const photo = (id: string, taken: string) => ({
  id, sort_order: 0, caption: "", can_edit_caption: true, caption_author_name: null,
  original_url: `https://cdn.test/${id}.jpg`, display_url: `https://cdn.test/${id}.webp`,
  thumbnail_url: `https://cdn.test/${id}-t.webp`, taken_at: taken,
  location_name: "제주 서귀포시", location_source: "exif",
});

async function renderHeader(placeEdit: Record<string, unknown> | null) {
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
        placeKey: "2018-07-08", placePhotoIds: ["p1", "p2"],
      } as never)));
  });
  return {
    React, root, container,
    pencil: () => container.querySelector(".chapter-header__edit-btn") as HTMLButtonElement | null,
    input: () => container.querySelector(".chapter-header__place-input") as HTMLInputElement | null,
    text: () => container.textContent || "",
    cleanup: () => React.act(async () => { root.unmount(); }),
  };
}

test("★ 참여자·구경꾼에게는 연필이 안 보인다", async () => {
  const none = await renderHeader(null);
  assert.equal(none.pencil() === null, true, "권한 없이 연필이 보인다");
  assert.match(none.text(), /제주 서귀포시/, "장소 자체는 보여야 한다");
  await none.cleanup();

  const reader = await renderHeader({ canEdit: false, editingKey: null, savingKey: null, draft: "",
    startEdit: () => {}, cancelEdit: () => {}, setDraft: () => {}, saveEdit: () => {} });
  assert.equal(reader.pencil() === null, true, "canEdit=false 인데 연필이 보인다");
  await reader.cleanup();
});

test("★ 주최자에게는 연필이 보이고, 누르면 그 자리가 입력칸이 된다 (새 시트 아님)", async () => {
  const started: Array<[string, string]> = [];
  const owner = await renderHeader({ canEdit: true, editingKey: null, savingKey: null, draft: "",
    startEdit: (key: string, text: string) => { started.push([key, text]); },
    cancelEdit: () => {}, setDraft: () => {}, saveEdit: () => {} });
  const pencil = owner.pencil();
  assert.equal(pencil != null, true, "주최자인데 연필이 없다");
  await owner.React.act(async () => { pencil!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(started, [["2018-07-08", "제주 서귀포시"]], "지금 값이 담긴 채로 열려야 한다");
  await owner.cleanup();

  // 고치는 중이면 같은 자리에 입력칸이 있다 — 시트를 새로 열지 않는다.
  const editing = await renderHeader({ canEdit: true, editingKey: "2018-07-08", savingKey: null,
    draft: "제주 서귀포시", startEdit: () => {}, cancelEdit: () => {}, setDraft: () => {}, saveEdit: () => {} });
  assert.equal(editing.input() != null, true, "그 자리에 입력칸이 없다");
  assert.equal(editing.container.querySelector(".album-inline-action") === null, true, "새 시트를 열었다");
  await editing.cleanup();
});

test("★ 저장은 그 날짜 묶음의 사진 전부에 간다", async () => {
  const saved: Array<[string, string[]]> = [];
  const editing = await renderHeader({ canEdit: true, editingKey: "2018-07-08", savingKey: null,
    draft: "제주 성산읍", startEdit: () => {}, cancelEdit: () => {}, setDraft: () => {},
    saveEdit: (key: string, ids: string[]) => { saved.push([key, ids]); } });
  const save = [...editing.container.querySelectorAll("button")]
    .find((b) => (b.textContent || "").includes("저장")) as HTMLButtonElement;
  await editing.React.act(async () => { save.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  assert.deepEqual(saved, [["2018-07-08", ["p1", "p2"]]], "한 장에만 갔거나 사진 목록이 빠졌다");
  await editing.cleanup();
});

test("★ 사람이 고친 것은 user 로 보내고, 비우면 지운다", () => {
  const fn = view.slice(view.indexOf("const handleSavePlace"), view.indexOf("const handleSaveTitle"));
  assert.match(fn, /const name = placeDraft\.trim\(\);/);
  assert.match(fn, /location_name: name \|\| null/);
  assert.match(fn, /location_source: name \? "user" : "unknown"/);
  // 사진마다 같은 값을 보낸다(그 날짜 묶음 전부).
  assert.match(fn, /photoIds\.map\(\(photoId\) => updateAlbumPhotoLocation\(albumId, photoId, \{/);
});

test("★ 새 API 를 만들지 않았다 — 이미 있던 PATCH 를 그대로 쓴다", () => {
  const api = read("lib/api.ts");
  assert.equal((api.match(/photos\/\$\{photoId\}\/location/g) || []).length, 1, "장소 API 가 늘었다");
  assert.match(view, /updateAlbumPhotoLocation/);
});

test("★ 실패하면 우리 말로 말한다 (§11)", () => {
  const fn = view.slice(view.indexOf("const handleSavePlace"), view.indexOf("const handleSaveTitle"));
  // ★ 2026-08-16 에 문구가 넓어졌다. 같은 자리에서 **날짜도** 고치므로
  //   `장소를 저장하지 못했어요` 로는 무엇이 안 됐는지 어긋난다.
  assert.match(fn, /userFacingError\(cause, "날짜와 장소를 저장하지 못했어요\. 다시 시도해 주세요\."\)/);
  assert.equal(fn.includes("setPlaceSaveError(cause"), false, "서버 문구가 화면으로 샌다");
});

test("연결 방식이 dateStoryEdit 과 같은 모양이다 — 새 방식을 만들지 않았다", () => {
  // AlbumView → AlbumRenderer → ChapterHeader 로 내려가는 같은 길.
  assert.match(view, /placeEdit=\{canEdit \? \{ canEdit: true, editingKey: editingPlaceKey/);
  const renderer = read("album-engine/AlbumRenderer.tsx");
  assert.match(renderer, /<PlaceEditProvider value=\{placeEdit \?\? null\}>/);
  assert.match(renderer, /placeKey=\{storyKey\}/, "이야기 편집과 같은 키를 써야 한다");
  assert.match(header, /const placeEdit = usePlaceEdit\(\);/);
  // 컨텍스트도 같은 모양이다.
  const ctx = read("album-engine/components/PlaceEditContext.tsx");
  for (const field of ["canEdit", "editingKey", "savingKey", "draft", "startEdit", "cancelEdit", "setDraft", "saveEdit"]) {
    assert.match(ctx, new RegExp(field), `${field} 가 없다`);
  }
});

test("인쇄에는 장소 연필이 오지 않는다", () => {
  // print-date 갈래는 날짜 한 줄만 그린다 — 그 위에서 일찍 돌아간다.
  const printBranch = header.slice(header.indexOf('if (variant === "print-date")'), header.indexOf('if (variant === "date-only")'));
  assert.equal(printBranch.includes("chapter-header__edit-btn"), false, "인쇄에 연필이 들어갔다");
});

void photo;

test("★ 날짜 줄은 글줄이다 — flex 로 만들지 않는다 (2026-08-17)", () => {
  // PO: `날짜와 옆의 지역이 줄이 안 맞아` · `지역이 2줄로 내려가면 더 이상해져`.
  // flex 로 만들면 ① 날짜 뒤 `" · 지역"` 앞 공백이 잘리고(익명 항목),
  // ② 두 줄이 될 때 날짜가 두 줄 덩어리 가운데로 내려간다(실측 9px 처짐).
  const css = readFileSync(new URL("../src/album-engine/blocks/ChapterHeader.css", import.meta.url), "utf8");
  const at = css.indexOf(".chapter-header--date-only .chapter-header__dayline {");
  const rule = css.slice(at, css.indexOf("}", at));
  assert.match(rule, /display: block/);
  assert.match(rule, /text-align: center/);
  assert.equal(rule.includes("display: flex"), false, "날짜 줄이 다시 flex 가 됐다");
  assert.equal(rule.includes("align-items"), false, "글줄에 배치 정렬이 다시 붙었다");
  assert.match(rule, /word-break: keep-all/);
});
