import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 캡션 연필이 사진 위로 솟는다 (PO 실측 2026-08-16).
 *
 * 8월 15일에 **날짜 줄 연필**에서 고친 것과 같은 자리인데 캡션 연필만 안 고쳤다:
 * 보이는 원은 32px 인데 버튼 자리가 `min-height: 44px` 이라 줄 높이를 밀어 올렸다.
 *
 * ★ 보이는 크기(32px)가 곧 자리 크기여야 줄에 맞는다. 누르는 44px 은 `::after` 가
 *   지킨다 — 자리를 차지하지 않으므로 캡션 줄이 그대로다(40대 이후 타깃은 양보 못 한다).
 * ★ 줄 정렬은 **화면에서만**이다. 인쇄에는 연필이 없다(§11).
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const css = read("album-engine/components/PhotoMemoryLines.css");

test("★ 보이는 크기가 곧 자리 크기다 — 32px 이 줄을 밀지 않는다", () => {
  const rule = css.slice(css.indexOf(".photo-memory-lines__edit-btn {"), css.indexOf("}", css.indexOf(".photo-memory-lines__edit-btn {")));
  assert.match(rule, /width: 32px/);
  assert.match(rule, /height: 32px/);
  // 자리를 밀던 옛 값이 남아 있지 않다.
  assert.equal(rule.includes("min-width: var(--tap-min)"), false, "자리가 다시 44px 이 됐다");
  assert.equal(rule.includes("min-height: var(--tap-min)"), false, "자리가 다시 44px 이 됐다");
  assert.equal(rule.includes("vertical-align"), false);
});

test("★ 누르는 자리는 여전히 44px 이다 — ::after 가 지킨다", () => {
  const after = css.slice(css.indexOf(".photo-memory-lines__edit-btn::after {"), css.indexOf("}", css.indexOf(".photo-memory-lines__edit-btn::after {")));
  assert.match(after, /position: absolute/);
  assert.match(after, /width: var\(--tap-min\)/);
  assert.match(after, /height: var\(--tap-min\)/);
  assert.match(after, /transform: translate\(-50%, -50%\)/);
  // 32px 동그라미(::before)와 box-sizing 은 그대로다.
  const before = css.slice(css.indexOf(".photo-memory-lines__edit-btn::before {"), css.indexOf("}", css.indexOf(".photo-memory-lines__edit-btn::before {")));
  assert.match(before, /box-sizing: border-box/);
  assert.match(before, /width: 32px/);
  assert.match(before, /border-radius: 50%/);
});

test("★ 캡션 글자와 연필이 같은 높이다 — 그려서 잰다", async () => {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { PhotoCommentEditProvider } = await import("../src/album-engine/components/PhotoCommentEditContext");
  const PhotoMemoryLines = (await import("../src/album-engine/components/PhotoMemoryLines")).default;

  const container = document.createElement("div");
  container.className = "album-renderer album-renderer--screen";
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PhotoCommentEditProvider as never, {
      value: {
        canEditPhoto: () => true, editingPhotoId: null, savingPhotoId: null, draft: "",
        startEdit: () => {}, cancelEdit: () => {}, setDraft: () => {}, saveEdit: () => {},
      },
    } as never, React.createElement(PhotoMemoryLines as never, {
      segments: [{ text: "바다가 좋았다" }], variant: "caption", photoId: "p1", editableText: "바다가 좋았다",
    } as never)));
  });

  // 줄과 연필이 **한 줄**에 있다(둘 다 그려졌다).
  assert.equal(container.querySelectorAll(".photo-memory-lines__row").length, 1);
  assert.equal(container.querySelectorAll(".photo-memory-lines__edit-btn").length, 1);
  // 줄이 가운데로 맞춰진다 — 화면 렌더에서만 거는 규칙이다.
  assert.match(css, /\.album-renderer--screen \.photo-memory-lines__row \{[\s\S]*?align-items: center;/);
  await React.act(async () => { root.unmount(); });
  container.remove();
});

test("★ 인쇄에는 연필도 정렬 규칙도 안 샌다 (§11)", () => {
  // 줄 정렬은 `--screen` 안에서만 건다.
  const at = css.indexOf(".photo-memory-lines__row {");
  const base = css.slice(at, css.indexOf("}", at));
  assert.equal(base.includes("align-items: center"), false, "정렬 규칙이 인쇄에도 걸린다");
  assert.match(css, /\.album-renderer--screen \.photo-memory-lines__row \{/);
  // 연필 자체가 화면에서만 그려진다 — 부르는 쪽이 그렇게 정한다.
  const block = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(block, /const isScreen = useAlbumRenderMode\(\) === "screen";/);
});

test("★ 연필을 줄 밖으로 띄우지 않는다 — 덮어쓰는 규칙이 없다 (2026-08-17)", () => {
  // 줄 안에서 `align-items: center` 로 맞추는데, 화면 규칙에서 연필만 절대 배치로
  // 빼놓으면 정렬이 통째로 무시된다(실측: 글자 cy 330 / 연필 cy 322 — 8px 위로 떴다).
  const renderer = read("album-engine/AlbumRenderer.css");
  const blocks = renderer.split("}")
    .filter((b) => b.includes(".photo-memory-lines__edit-btn") && b.includes("{"));
  const floated = blocks.some((b) => /position:\s*absolute|position:\s*fixed/.test(b));
  assert.equal(floated, false, "캡션 연필이 다시 줄 밖으로 떴다");
});

test("★ 날짜 줄 연필과 같은 방식이다 — 두 자리가 갈리지 않는다", () => {
  // 날짜 줄은 8월 15일에 이미 이 방식이다(::before 32px 원 + 누름 영역 분리).
  const chapter = read("album-engine/blocks/ChapterHeader.css");
  assert.match(chapter, /\.chapter-header__edit-btn::before/);
  assert.match(css, /\.photo-memory-lines__edit-btn::before/);
});
