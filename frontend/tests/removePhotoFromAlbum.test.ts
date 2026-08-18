import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 앨범에서 사진을 뺀다 (2026-08-15).
 *
 * ★ 서버에는 이미 있었다 — `DELETE /albums/{id}/media/{media_id}`.
 *   권한 검사도 Storage 파일 정리도 거기서 한다. **화면에 부르는 곳이 없었을 뿐**이다.
 *   새 주소를 만들지 않았다(§10).
 *
 * ★ 자리: 사진을 눌러 여는 **그 사진의 글 쓰는 자리**(캡션 인라인 편집기) **맨 아래**.
 *   되돌릴 수 없는 것이 맨 아래다(§5). 빨간 **글자만** 쓴다 — 배경을 채우지 않는다.
 *
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙) — 개수·불리언으로 잰다.
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");

const PHOTO = {
  id: "6f434e11", src: "x.jpg", alt: "", width: 1200, height: 900,
  orientation: "landscape", comment: "바다가 좋았다", sortOrder: 0, comments: [],
};

/** 캡션 편집기를 연 상태로 사진 한 장을 그린다 — 빼기 줄은 그 안에 있다. */
async function renderEditor(edit: Record<string, unknown>) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { PhotoCommentEditProvider } = await import("../src/album-engine/components/PhotoCommentEditContext");
  const PhotoWithMemories = (await import("../src/album-engine/components/PhotoWithMemories")).default;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PhotoCommentEditProvider as never, {
      value: {
        canEditPhoto: () => true, editingPhotoId: PHOTO.id, savingPhotoId: null, draft: "바다가 좋았다",
        startEdit: () => {}, cancelEdit: () => {}, setDraft: () => {}, saveEdit: () => {}, ...edit,
      },
    } as never, React.createElement(PhotoWithMemories as never, { photo: PHOTO, albumKey: "a", index: 1 } as never)));
  });
  return {
    React, container,
    removeCount: () => container.querySelectorAll(".photo-memory-lines__remove").length,
    click: async () => {
      const button = container.querySelector(".photo-memory-lines__remove") as HTMLButtonElement | null;
      assert.equal(button != null, true, "빼기 줄이 없다");
      await React.act(async () => { button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    },
    cleanup: async () => {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

test("★ 뺄 수 있는 사람에게는 글 쓰는 자리 맨 아래에 한 줄이 있다", async () => {
  const asked: string[] = [];
  const dom = await renderEditor({
    canRemovePhoto: () => true,
    requestRemove: (photoId: string) => { asked.push(photoId); },
  });
  assert.equal(dom.removeCount(), 1);
  assert.match(dom.container.textContent || "", /이 사진 빼기/);
  // 누르면 **묻는 것은 부르는 쪽**이다 — 여기서 바로 지우지 않는다.
  await dom.click();
  assert.deepEqual(asked, [PHOTO.id]);
  await dom.cleanup();
});

test("★ 뺄 수 없는 사람에게는 그 줄이 없다 (회귀 ① — 참여자는 남의 사진을 못 뺀다)", async () => {
  for (const edit of [
    { canRemovePhoto: () => false, requestRemove: () => {} },
    // 구경꾼: 부르는 쪽이 함수를 아예 넘기지 않는다.
    {},
  ]) {
    const dom = await renderEditor(edit);
    assert.equal(dom.removeCount(), 0);
    assert.equal((dom.container.textContent || "").includes("이 사진 빼기"), false);
    await dom.cleanup();
  }
});

test("★ 누가 뺄 수 있는지는 **서버가 내려준 값**으로 가른다", () => {
  const edit = view.slice(view.indexOf("canRemovePhoto:"), view.indexOf("requestRemove:"));
  // 주최자(can_edit → canEdit) 이거나, 내가 올린 사진(is_mine) 이다. 역할을 추측하지 않는다.
  assert.match(edit, /canEdit \|\| photoById\.get\(photoId\)\?\.is_mine === true/);
  // 이전 판을 보는 중에는 아무도 못 뺀다.
  assert.match(edit, /requestedEdition === null/);
});

test("★ 묻는 것은 시트다 — window.confirm 을 쓰지 않는다 (§11)", () => {
  // 부르는 자리를 본다 — 주석에는 "쓰지 않는다"고 적혀 있어 글자만 세면 스스로 걸린다.
  assert.equal(/window\.confirm\s*\(/.test(view), false);
  const sheet = view.slice(view.indexOf("{removingPhotoId ? ("), view.indexOf("{moreOpen ? <div className=\"album-sheet-dim\""));
  assert.match(sheet, /title="이 사진을 뺄까요\?"/);
  assert.match(sheet, /사진과 함께 달린 한마디도 같이 지워져요\. 되돌릴 수 없어요\./);
  assert.match(sheet, /confirmLabel="빼기"/);
  // `그만두기` 가 왼쪽이고 기본이다(§5). 빨간 글자만 — danger 는 배경을 채우지 않는다.
  assert.match(sheet, /cancelFirst/);
  assert.match(sheet, /danger/);
  // 되돌릴 수 없다는 말을 우리 말로 쓴다 — `영구 삭제`·`복구 불가능` 을 쓰지 않는다.
  assert.equal(/영구 삭제|복구 불가능/.test(sheet), false);
});

test("★ 뺀 뒤 앨범을 다시 그리지 않는다 (회귀 ③ — AlbumRenderer 재마운트 금지)", () => {
  const handler = view.slice(view.indexOf("const confirmRemovePhoto ="), view.indexOf("const handlePdf ="));
  // 그 한 장만 목록에서 뺀다. 다시 읽지도(setRetryKey) 다시 만들지도 않는다.
  assert.match(handler, /setPhotos\(\(current\) => current\.filter\(\(photo\) => photo\.id !== photoId\)\)/);
  assert.equal(handler.includes("setRetryKey"), false, "앨범을 통째로 다시 읽는다");
  assert.equal(handler.includes("applyContributions"), false, "앨범을 다시 만든다");
  assert.equal(handler.includes("window.location"), false, "화면을 다시 연다");
});

test("★ 표지 사진을 빼면 표지가 남은 첫 장으로 옮겨간다 (회귀 ④)", () => {
  const handler = view.slice(view.indexOf("const confirmRemovePhoto ="), view.indexOf("const handlePdf ="));
  assert.match(handler, /if \(!current \|\| current\.cover_photo_id !== photoId\) return current;/);
  assert.match(handler, /const next = photos\.find\(\(photo\) => photo\.id !== photoId\) \?\? null;/);
  // 남은 사진이 없으면 표지를 비운다 — 빈 자리로 두지 않는다.
  assert.match(handler, /cover_photo_id: next\?\.id \?\? null/);
});

test("★ 실패하면 화면에서도 지우지 않는다 — 지운 척하지 않는다 (§11)", () => {
  const handler = view.slice(view.indexOf("const confirmRemovePhoto ="), view.indexOf("const handlePdf ="));
  // setPhotos 는 await 뒤에만 있다(try 안). catch 는 우리 말만 세운다.
  assert.match(handler, /await removeAlbumPhoto\(albumId, photoId\);\s*\n\s*setPhotos\(/);
  assert.match(handler, /catch \{\s*\n\s*setRemovePhotoError\("사진을 빼지 못했어요\. 다시 시도해 주세요\."\);/);
  assert.equal(/userFacingError\(/.test(handler), false, "서버 문구가 새어 나올 자리가 생겼다");
});

test("★ 새 주소를 만들지 않았다 — 이미 있던 DELETE 를 부른다 (§10)", () => {
  const api = read("lib/api.ts");
  const fn = api.slice(api.indexOf("export async function removeAlbumPhoto"), api.indexOf("export async function removeAlbumPhoto") + 400);
  assert.match(fn, /`\/api\/albums\/\$\{albumId\}\/media\/\$\{photoId\}`/);
  assert.match(fn, /method: "DELETE"/);
});

test("★ 빨간 **글자만**이다 — 배경을 채우지 않는다 (§5)", () => {
  const css = read("album-engine/components/PhotoMemoryLines.css");
  const rule = css.slice(css.indexOf(".photo-memory-lines__remove {"), css.indexOf("}", css.indexOf(".photo-memory-lines__remove {")));
  assert.match(rule, /color: var\(--c-danger\)/);
  assert.match(rule, /background: transparent/);
  assert.match(rule, /border: 0/);
  // 누르는 자리는 44px 하한을 지킨다.
  assert.match(rule, /min-height: var\(--tap-min\)/);
});
