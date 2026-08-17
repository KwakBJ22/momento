import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 앨범을 지우기 전에 **사라질 것을 보여준다** (시안 delete-sheet 1b · 2026-08-17).
 *
 * 지금까지는 `제목 · 한 줄 · 버튼 둘`이라 무엇이 사라지는지 보이지 않았다.
 * 되돌릴 수 없는 일이므로 잃는 것을 눈(사진)과 숫자로 보여 준다.
 *
 * ★ 지우는 길을 막지 않는다 — 숫자를 못 받아와도 시트는 뜨고 `앨범 지우기` 가 있다.
 * ★ 0을 말하지 않는다. 있는 것만 센다.
 * ★ `그만두기` 가 왼쪽이다(K-20).
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙 — 불리언·숫자로 넘긴다).
 */

registerCssStub({ realApi: true });
setupDom("https://test.local/my-albums");

/** 서버 대역 — delete-preview 응답을 테스트가 정한다. `fail` 이면 500 을 준다. */
function server(body: unknown | "fail") {
  (globalThis as unknown as Record<string, unknown>).fetch = async () => ({
    ok: body !== "fail",
    status: body === "fail" ? 500 : 200,
    headers: { get: () => "application/json" },
    json: async () => (body === "fail" ? { detail: "no" } : body),
    text: async () => "",
  } as unknown as Response);
}

async function renderSheet(preview: unknown | "fail") {
  server(preview);
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumDeleteSheet } = await import("../src/components/AlbumDeleteSheet");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumDeleteSheet as never, {
      albumId: "album-1", title: "우리의 추억", onConfirm: () => {}, onCancel: () => {},
    } as never));
  });
  // 미리보기를 받아 다시 그릴 틈을 준다.
  await React.act(async () => { await Promise.resolve(); });
  const text = container.textContent || "";
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(".album-delete-sheet__actions button")]
    .map((button) => button.textContent || "");
  const view = {
    text,
    tiles: container.querySelectorAll(".album-delete-sheet__tile").length,
    moreLabel: container.querySelector(".album-delete-sheet__more")?.textContent ?? null,
    summary: container.querySelector(".album-delete-sheet__summary")?.textContent ?? null,
    strips: container.querySelectorAll(".album-delete-sheet__strip").length,
    buttons,
    hasDelete: buttons.some((label) => label.includes("앨범 지우기")),
  };
  await React.act(async () => { root.unmount(); });
  container.remove();
  return view;
}

const preview = (photo: number, memory: number, contributor: number) => ({
  photo_count: photo,
  memory_count: memory,
  contributor_count: contributor,
  preview_photo_urls: Array.from({ length: Math.min(3, photo) }, (_, index) => `https://cdn.test/p${index}.webp`),
});

test("★ 사진 9장이면 세 장을 세우고 남은 수를 `+6` 으로 적는다", async () => {
  const view = await renderSheet(preview(9, 4, 3));
  assert.equal(view.tiles, 3);
  assert.equal(view.moreLabel, "+6");
});

test("★ 사진 3장이면 `+N` 칸이 없다 — 남은 것이 없다", async () => {
  const view = await renderSheet(preview(3, 0, 1));
  assert.equal(view.tiles, 3);
  assert.equal(view.moreLabel, null);
});

test("★ 사진 0장이면 띠 자체를 그리지 않는다", async () => {
  const view = await renderSheet(preview(0, 2, 1));
  assert.equal(view.strips, 0);
  assert.equal(view.tiles, 0);
});

test("★ 0을 말하지 않는다 — 한마디가 없으면 문장에 `한마디` 가 없다", async () => {
  const view = await renderSheet(preview(9, 0, 3));
  assert.equal(view.summary, "사진 9장이 함께 사라지고, 함께한 3명의 화면에서도 없어져요.");
  assert.equal((view.summary || "").includes("한마디"), false);
  // 있는 것은 그대로 센다.
  const both = await renderSheet(preview(9, 4, 3));
  assert.equal(both.summary, "사진 9장과 한마디 4개가 함께 사라지고, 함께한 3명의 화면에서도 없어져요.");
});

test("★ 나 혼자 만든 앨범이면 `함께한 사람` 이야기를 하지 않는다", async () => {
  const view = await renderSheet(preview(9, 4, 1));
  assert.equal(view.summary, "사진 9장과 한마디 4개가 함께 사라져요.");
});

test("★ `그만두기` 가 `앨범 지우기` 보다 **앞에** 그려진다 (K-20)", async () => {
  const view = await renderSheet(preview(9, 4, 3));
  assert.deepEqual(view.buttons, ["그만두기", "앨범 지우기"]);
});

test("★ 사라질 것을 못 받아와도 시트는 뜨고 지울 수 있다 (§11)", async () => {
  const view = await renderSheet("fail");
  assert.equal(view.hasDelete, true, "지우는 길이 막혔다");
  assert.equal(view.strips, 0, "받지도 못한 띠를 그렸다");
  assert.equal(view.summary, null, "받지도 못한 숫자를 말했다");
  assert.match(view.text, /지울까요\?/);
});

test("★ 세는 규칙은 한 곳이다 — 순수 함수로 따로 본다", async () => {
  const { deleteSummarySentence } = await import("../src/components/AlbumDeleteSheet");
  // 아무것도 없으면 그 줄을 그리지 않는다(빈 문장을 만들지 않는다).
  assert.equal(deleteSummarySentence(preview(0, 0, 1)), null);
  // 함께한 사람만 있는 경우.
  assert.equal(deleteSummarySentence(preview(0, 0, 3)), "함께한 3명의 화면에서도 없어져요.");
  // 조사는 앞말 받침을 따른다 — `9장이` · `4개가`.
  assert.match(deleteSummarySentence(preview(9, 0, 1)) || "", /9장이 함께/);
  assert.match(deleteSummarySentence(preview(9, 4, 1)) || "", /4개가 함께/);
});
