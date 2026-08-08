import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 캡션에는 작성자 이름을 넣지 않는다 (CLAUDE.md §6).
 *
 * 예전 규칙: "작성자 1명 → 숨김 / 2명 이상 → 표시". 없앴다 — 캡션은 그 사진을 올린
 * 사람의 말이라 이름이 없어도 자연스럽고, 사진마다 이름이 붙으면 인쇄물이 지저분해진다.
 * 누가 썼는지는 프레임 **밖** 한마디에서 보인다. 웹·공유·PDF 모두 같다.
 */

registerCssStub();
setupDom("https://test.local/");

const SEGMENTS = [
  { author: "곽병준", text: "그날 바람이 좋았다." },
  { author: "영희", text: "다 같이 웃었지." },
  { author: "준3", text: "또 가고 싶다." },
];

test("작성자가 여러 명이어도 이름 줄이 만들어지지 않는다", async () => {
  const { buildPhotoMemoryDisplayLines, photoMemoryHasAuthors } =
    await import("../src/album-engine/components/photoMemoryLineUtils");

  const lines = buildPhotoMemoryDisplayLines(SEGMENTS);
  assert.equal(lines.length, 3, "글은 그대로 3줄이다");
  assert.deepEqual(lines.map((line) => line.showAuthor), [false, false, false]);
  assert.equal(photoMemoryHasAuthors(lines), false);
  // 데이터는 남는다 — 보여주지 않을 뿐이다(캡션 고치기 확인 문구가 이 이름을 쓴다).
  assert.deepEqual(lines.map((line) => line.author), ["곽병준", "영희", "준3"]);
});

test("실제로 그려도 이름이 화면에 없다 (웹·공유·PDF 같은 렌더러다)", async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: PhotoMemoryLines } = await import("../src/album-engine/components/PhotoMemoryLines");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PhotoMemoryLines, { segments: SEGMENTS } as never));
  });

  const text = container.textContent || "";
  assert.match(text, /그날 바람이 좋았다\./, "글은 보인다");
  for (const name of ["곽병준", "영희", "준3"]) {
    assert.equal(text.includes(name), false, `캡션에 이름이 없어야 한다: ${name}`);
  }
  // 이름 자리를 비워 두는 여백(spacer)도 만들지 않는다 — 들여쓰기만 남으면 어색하다.
  assert.equal(container.querySelectorAll(".photo-memory-lines__author").length, 0);
  await React.act(async () => { root.unmount(); });
});

test("이름을 보여주던 옛 규칙이 코드에 남아 있지 않다", () => {
  const source = readFileSync(new URL("../src/album-engine/components/photoMemoryLineUtils.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /contributors\.size >= 2/);
  assert.doesNotMatch(code, /showAuthor: displayAuthor/);
  assert.match(code, /showAuthor: false/);
});
