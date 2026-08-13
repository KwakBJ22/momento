import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 폴라로이드 한 장이 통째로 기운다 (I-1b · SCREEN_SPEC §9 12차).
 *
 * I-1 에서는 흰 카드를 **사진만** 감싸게 옮기고 캡션을 카드 밖으로 뺐다. 그 방향이
 * 틀렸다 — 캡션이 프레임 밖으로 나가면 **어느 사진에 붙은 말인지 눈으로 안 보인다.**
 * 12차가 되돌렸다: 프레임 하나가 사진과 캡션을 함께 담고, 그 프레임이 통째로 기운다.
 * ±3° 는 읽기에 지장이 없다.
 *
 * 원래 I-1 이 고치려던 것은 하나뿐이었다 — 흰 카드는 `.photo-block` 인데 회전은 안쪽
 * `figure` 에 걸려 있어 **사진만 돌고 카드는 서 있었다.** 회전을 카드로 옮기면 끝난다.
 * CSS 구조를 바꿀 일이 아니었다.
 *
 * ★ `CLAUDE.md` §6 의 "카드/테두리/그림자/배경색 금지" 는 **캡션** 규칙이다.
 *   사진 프레임을 금지하는 말이 아니다(§9 12차가 그렇게 못박았다).
 */

registerCssStub();
setupDom("https://test.local/");

const css = readFileSync(new URL("../src/album-engine/AlbumRenderer.css", import.meta.url), "utf8");
const block = readFileSync(new URL("../src/album-engine/components/PhotoWithMemories.tsx", import.meta.url), "utf8");

/** 화면 모드의 한 규칙 본문을 뽑는다. */
function screenRule(selector: string): string {
  const head = `.album-renderer--screen ${selector} {`;
  const start = css.indexOf(head);
  assert.notEqual(start, -1, `규칙이 없다: ${head}`);
  return css.slice(start + head.length, css.indexOf("}", start));
}

// ★ K-23 2차에서 프레임이 한 겹 안으로 들어갔다. `.photo-block` 은 격자 한 칸일 뿐이고,
//   폴라로이드(흰 여백·테두리·그림자·회전)는 `.photo-block__frame` 이다.
//   한마디를 프레임 **밖**에 두려면 프레임이 블록보다 작아야 했기 때문이다(§7).
//   아래 규칙은 그대로다 — 무엇이 프레임인지만 바뀌었다.
const FRAME = ".album-screen-photo-grid > .photo-block > .photo-block__frame";
const CELL = ".album-screen-photo-grid > .photo-block";
const PHOTO = ".album-screen-photo-card__frame";

async function renderAlbum(mode: "screen" | "print") {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const photos = [1, 2, 3].map((n) => ({
    id: `p${n}`, sort_order: n,
    original_url: `https://cdn.test/${n}.jpg`, display_url: `https://cdn.test/${n}.webp`,
    thumbnail_url: `https://cdn.test/${n}-t.webp`, caption: `${n}번째 사진에 남긴 한마디`,
    taken_at: `2026-08-01T09:0${n}:00Z`, width: 1200, height: 900,
  }));
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos, title: "우리 여행", epilogue: "좋았다.", albumId: "album-1", mode,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  return { React, root, container };
}

test("★ 흰 카드와 회전이 같은 요소다 — 프레임이 통째로 기운다", () => {
  const frame = screenRule(FRAME);
  // ★ 뒤집힌 항목 (2026-08-13 · PO: "디자인에는 없어"). 흰 상자를 없앴다 —
  //   여백 12px · 테두리 · 흰 배경 · 그림자를 전부 빼고 8px 라운드만 남겼다.
  //   시안 album-detail-owner.html 의 `.photo` 도 border-radius·overflow·width 뿐이다.
  //   ★ 이 검사가 지키는 규칙은 "**도는 것과 모양이 같은 요소**"이지 상자가 있느냐가
  //     아니었다(K-23). 기울기는 그대로 남겼으므로 그 규칙은 아래에서 계속 본다.
  assert.match(frame, /padding: 0;/);
  assert.match(frame, /border: 0;/);
  assert.match(frame, /border-radius: var\(--r-sm\)/);
  assert.match(frame, /background: transparent/);
  assert.match(frame, /box-shadow: none/);
  // 도는 것도 이 요소다.
  assert.match(frame, /transform-origin: center center/);
  assert.match(block, /const frameStyle: CSSProperties \| undefined = tilt !== 0 \? \{ transform: `rotate\(\$\{tilt\}deg\)` \}/);
  assert.match(block, /<div className="photo-block__frame" style=\{frameStyle\}>/);
  // 격자 한 칸에는 모양이 없다 — 겹침(자리)만 갖는다.
  const cell = screenRule(CELL);
  assert.match(cell, /padding: 0;/);
  assert.equal(/border:|box-shadow:|background:/.test(cell), false, "칸이 다시 카드가 됐다");
  assert.match(block, /const blockStyle: CSSProperties \| undefined = overlap > 0/);
});

test("★ 안쪽 사진 요소는 회전을 갖지 않는다 (사진만 따로 돌지 않는다)", () => {
  // figure 는 투명한 사진 자리일 뿐이다 — 카드가 아니고, 돌지도 않는다.
  const photo = screenRule(PHOTO);
  assert.match(photo, /border: 0/);
  assert.match(photo, /box-shadow: none/);
  assert.match(photo, /background: transparent/);
  // 회전을 figure 에 걸던 예전 코드가 돌아오면 다시 따로 논다 —
  // AlbumPhotoFrame 에는 style 을 넘기지 않는다(회전은 바깥 `.photo-block__frame` 하나뿐이다).
  const call = block.slice(block.indexOf("<AlbumPhotoFrame"), block.indexOf("/>", block.indexOf("<AlbumPhotoFrame")));
  assert.equal(call.includes("style="), false, "사진 요소에 style 이 붙었다");
  assert.equal(call.includes("tilt"), false, "사진 요소가 기울기를 받는다");
  assert.match(block, /<AlbumPhotoFrame\s+src=\{photo\.src\}/);
});

test("★ 캡션이 프레임 안이다 — 함께 기운다 (I-1b 로 뒤집힌 항목)", async () => {
  const view = await renderAlbum("screen");
  const frame = view.container.querySelector(".album-screen-photo-grid > .photo-block > .photo-block__frame") as HTMLElement;
  const caption = frame.querySelector(".photo-memory-lines--caption");
  // 캡션이 프레임의 **자손**이다(형제가 아니다).
  assert.ok(caption, "캡션이 프레임 안에 있어야 한다");
  // 회전은 프레임에 붙고, 캡션은 그 안에 있으므로 함께 기운다.
  assert.match(frame.getAttribute("style") || "", /rotate\(/, "프레임이 기운다");
  assert.equal(/rotate\(/.test(caption!.getAttribute("style") || ""), false, "캡션에 따로 회전을 주지 않는다");
  const photoFigure = frame.querySelector(".album-photo-frame") as HTMLElement;
  assert.equal(/rotate\(/.test(photoFigure.getAttribute("style") || ""), false, "사진만 따로 돌지 않는다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("캡션에 프레임을 하나 더 씌우지 않는다 (§6 — 그 규칙은 캡션 것이다)", () => {
  const caption = readFileSync(new URL("../src/album-engine/components/PhotoMemoryLines.css", import.meta.url), "utf8");
  const rule = caption.slice(caption.indexOf(".photo-memory-lines--caption {"), caption.indexOf("}", caption.indexOf(".photo-memory-lines--caption {")));
  for (const forbidden of ["box-shadow", "border:", "background:"]) {
    assert.equal(rule.includes(forbidden), false, `캡션에 ${forbidden} 가 있다`);
  }
});

test("겹침·좁은 화면 여백이 그대로다", () => {
  // 음수 여백은 **칸**에 걸린다 — 자리를 옮기는 일은 격자가 하는 일이다.
  const start = css.indexOf("@media (min-width: 641px)");
  const rule = css.slice(start, css.indexOf("}", css.indexOf("margin-inline-start: calc(var(--photo-overlap")));
  assert.match(rule, /\.photo-block\[data-overlap\]/);
  assert.match(rule, /margin-inline-start: calc\(var\(--photo-overlap, 0\) \* -100%\)/);
  assert.match(screenRule(CELL), /width: 100%/);
  // ★ 뒤집힌 항목 (2026-08-13). 좁은 화면의 프레임 여백(0.6rem)도 상자와 함께
  //   없앴다 — 상자가 없으니 그 안쪽 여백도 있을 자리가 없다.
  const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
  assert.equal(narrow.includes(".photo-block__frame {"), false, "없앤 상자 여백이 되살아났다");
  assert.equal(narrow.includes(`${PHOTO} {\n    padding`), false);
  // 겹침은 칸의 style, 회전은 프레임의 style — 서로 다른 요소라 한쪽이 다른 쪽을 지우지 않는다.
  assert.match(block, /"--photo-overlap": overlap, zIndex: photoStackOrder\(overlap\)/);
});

test("★ 인쇄 렌더에 기울기가 0건이다", async () => {
  const view = await renderAlbum("print");
  for (const node of view.container.querySelectorAll("[style]")) {
    assert.equal((node.getAttribute("style") || "").includes("rotate("), false, `인쇄에 기울기: ${node.className}`);
  }
  assert.equal(view.container.querySelectorAll("[data-tilt]").length, 0);
  await view.React.act(async () => { view.root.unmount(); });
  // 인쇄 컴포넌트는 이 규칙을 모른다(기존 계약 유지).
  const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
  assert.doesNotMatch(printCss, /rotate\(/);
});
