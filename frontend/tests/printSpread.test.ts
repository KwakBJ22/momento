import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 펼침면 — 사진 한 쪽, 이야기 한 쪽 (시안 `print-layout-v3` §5).
 *
 * 레이플랫 제본이라 두 쪽이 한 번에 보인다. 사진이 **한 장뿐인 날**은 그 한 장에 쪽
 * 하나를 주고, 맞은편에 날짜 머리와 이야기를 둔다. 한 쪽에 몰아 넣으면 사진이 이야기
 * 자리(50mm)만큼 눌린다.
 *
 * ★ 두 갈래가 같은 `print-page--story` 쪽을 쓰되 **자리와 단 수가 다르다.**
 *     긴 이야기(§3)  두 단 · 사진 **앞**
 *     펼침면(§5)     한 단 · 사진 **뒤**
 * ★ 이야기가 제 쪽을 가져가면 날짜 머리는 **그 쪽**에 선다. 예전에는 이야기 쪽과
 *   사진 쪽에 머리가 잇달아 두 번 나왔다.
 *
 * ── 크롬 실측 (206mm 지면) ──
 *     사진 쪽    머리 없음 · 사진 128mm · 프레임이 세로 가운데(위 30.6 · 아래 30.6mm)
 *     이야기 쪽  머리 `11.3 / 2018년 · 사진 1장` · 한 단 · 글줄 131.3mm (시안과 같다)
 *     세 갈래(펼침·긴 이야기·이야기 없는 한 장) 모두 넘침 0
 *
 * ★ **못 만든 것: 2:1 사진을 두 쪽에 걸치는 펼침(시안 §5 앞쪽).** 지금 PDF 는
 *   `한 쪽 = 정사각 한 장`이라 한 사진을 두 쪽에 나누려면 왼쪽이 **짝수 쪽**이라는
 *   보장이 있어야 한다(아니면 사진이 종이 한 장의 앞뒤로 갈라진다). 그 보장을
 *   만들려면 빈 쪽을 끼우는 규칙이 필요하고, 그건 PO 가 정할 일이다.
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const printCss = read("album-engine/components/PrintPages.css");
const declarations = printCss.replace(/\/\*[\s\S]*?\*\//g, " ");

const photo = (id: string, at: string) => ({
  id, sort_order: 1,
  original_url: "https://cdn.test/1.webp", display_url: "https://cdn.test/1.webp", thumbnail_url: "https://cdn.test/1.webp",
  caption: "짧은 말", taken_at: at, width: 1600, height: 1200,
});

/** 그 앨범의 인쇄 쪽들을 `{ 종류, 머리 있음, 사진 수, 단 수 }` 로 훑는다. */
async function printPages(photos: unknown[], stories: Record<string, string>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos, title: "표본", epilogue: "끝", albumId: "a", mode: "print",
      coverDateLabel: "2018.11.03", contributorNames: ["가"], chapterStories: stories,
    } as never));
  });
  const pages = Array.from(container.querySelectorAll("[data-print-page]")).map((page) => ({
    story: page.classList.contains("print-page--story"),
    spreadPhoto: page.hasAttribute("data-spread-photo"),
    head: page.querySelector(".chapter-header") !== null,
    photos: page.querySelectorAll(".print-frame").length,
    columns: page.querySelector(".print-story__columns") ? 2 : page.querySelector(".print-story__single") ? 1 : 0,
  }));
  await React.act(async () => { root.unmount(); });
  return pages;
}

test("★ 사진 한 장짜리 날에만 펼침면을 만든다", async () => {
  const { storyMakesSpread, SPREAD_MAX_PHOTOS } = await import("../src/album-engine/components/PrintPages");
  assert.equal(SPREAD_MAX_PHOTOS, 1, "올리면 그만큼 종이가 늘어난다 — 올릴 때는 시안을 다시 본다");
  assert.equal(storyMakesSpread(1, "짧은 이야기"), true);
  assert.equal(storyMakesSpread(2, "짧은 이야기"), false);
  // 이야기가 없으면 나눌 것이 없다 — 사진 쪽 하나로 끝난다.
  assert.equal(storyMakesSpread(1, ""), false);
  assert.equal(storyMakesSpread(1, null), false);
  // 사진이 없는 묶음에 빈 사진 쪽을 만들지 않는다.
  assert.equal(storyMakesSpread(0, "짧은 이야기"), false);
});

test("★ 사진 쪽이 먼저, 이야기 쪽이 뒤 — 머리는 이야기 쪽에 한 번만 (시안 §5)", async () => {
  const pages = await printPages(
    [photo("p1", "2018-11-03T09:00:00Z")],
    { "2018-11-03": "눈이 온다는 말에 다들 창가로 갔다. 이 사진 한 장으로 그날은 충분했다." },
  );
  assert.deepEqual(pages, [
    { story: false, spreadPhoto: true, head: false, photos: 1, columns: 0 },
    { story: true, spreadPhoto: false, head: true, photos: 0, columns: 1 },
  ]);
});

test("★ 긴 이야기는 반대다 — 글이 먼저 서고 사진이 뒤따른다 (시안 §3)", async () => {
  const pages = await printPages(
    [photo("q1", "2019-03-22T09:00:00Z"), photo("q2", "2019-03-22T10:00:00Z"), photo("q3", "2019-03-22T11:00:00Z")],
    { "2019-03-22": "긴 이야기다. ".repeat(40) },
  );
  assert.deepEqual(pages, [
    { story: true, spreadPhoto: false, head: true, photos: 0, columns: 2 },
    { story: false, spreadPhoto: false, head: false, photos: 3, columns: 0 },
  ]);
});

test("★ 같은 날 머리가 잇달아 두 번 나오지 않는다", async () => {
  for (const pages of [
    await printPages([photo("p1", "2018-11-03T09:00:00Z")], { "2018-11-03": "짧은 이야기." }),
    await printPages(
      [photo("q1", "2019-03-22T09:00:00Z"), photo("q2", "2019-03-22T10:00:00Z")],
      { "2019-03-22": "긴 이야기다. ".repeat(40) },
    ),
  ]) {
    assert.equal(pages.filter((page) => page.head).length, 1, "같은 날에 머리가 둘이다");
  }
});

test("이야기가 없는 한 장짜리 날은 예전 그대로다 (회귀)", async () => {
  const pages = await printPages([photo("r1", "2020-01-01T09:00:00Z")], {});
  assert.deepEqual(pages, [{ story: false, spreadPhoto: false, head: true, photos: 1, columns: 0 }]);
});

test("★ 사진 쪽은 세로 가운데다 — 머리가 없는 쪽이라 위만 비면 기울어 보인다", () => {
  const at = declarations.indexOf(".print-page[data-spread-photo]");
  assert.notEqual(at, -1, "규칙이 없다");
  const body = declarations.slice(declarations.indexOf("{", at) + 1, declarations.indexOf("}", at));
  assert.match(body, /justify-content: center/);
});

test("★ 자리가 남아도 사진을 키우지 않는다 — 1장 상한은 그대로 128mm (시안 §4)", () => {
  // 머리가 빠져 20mm 가 남지만, 상한을 올리는 규칙을 두지 않는다.
  assert.equal(/\[data-spread-photo\][^{]*img[^{]*\{[^}]*max-height/.test(declarations), false);
});

test("★ 펼침 이야기 쪽은 한 단이다 — 시안 실측 글줄 131.3mm", () => {
  const at = declarations.indexOf('.print-page--story[data-story-spread] .print-story__single');
  assert.notEqual(at, -1, "규칙이 없다");
  const body = declarations.slice(declarations.indexOf("{", at) + 1, declarations.indexOf("}", at));
  assert.match(body, /max-width: 131\.3mm/);
  assert.equal(/columns:/.test(body), false, "펼침 쪽까지 두 단으로 나눴다");
});

test("★ 화면은 건드리지 않았다 — 이 커밋의 규칙이 전부 인쇄 아래에 있다", () => {
  for (const fragment of ["[data-spread-photo]", "[data-story-spread]"]) {
    const at = declarations.indexOf(fragment);
    const lineStart = declarations.lastIndexOf("\n", at) + 1;
    assert.match(declarations.slice(lineStart, at + fragment.length), /\.album-renderer--print/, fragment);
  }
});
