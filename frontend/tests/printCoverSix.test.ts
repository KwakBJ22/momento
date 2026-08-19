import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";
import { ALBUM_SKINS } from "../src/lib/albumSkin";

/**
 * 표지 6종 — 시안 `print-layout-v3` §2 `가. 색을 채운 판`.
 *
 * PO 가 정한 것: **색을 채운 판 하나만** 만든다(흰 종이 판은 만들지 않는다).
 * 재단 여유 3mm 까지 색이 넘어간다 — 흰 테가 생기면 안 된다. 본문 지면은 흰 종이 그대로다.
 *
 * ── 크롬 실측 (206mm 지면 · 가로 2:1 과 세로 3:4 두 벌로 6종 × 2 = 12가지) ──
 *     찌그러진 것 0 · 지면을 넘은 것 0 · 글이 넘친 것 0
 *     basic     174 x 87   /  96.07 x 128.09
 *     scrapbook 174 x 87   /  90.12 x 120.15
 *     airy      174 x 87   /  99.36 x 132.48
 *     grid       84 x 42   /  83.99 x 111.99   (반 폭)
 *     magazine  206 x 103  /  90 x 119.99      (가로는 재단 여유까지 · 세로는 120mm 에서 걸림)
 *     single    174 x 87   /  95.70 x 127.60
 *     여섯 다 표지가 지면 206 x 206 을 꽉 채운다(= 색이 bleed 까지 간다)
 *     여백형(airy)은 아래 띠가 지면 아래·좌·우 끝까지 닿는다
 *
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/a1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const css = read("album-engine/components/AlbumCover.css");
const tsx = read("album-engine/components/AlbumCover.tsx");
const printCss = read("album-engine/components/PrintPages.css");
const tokens = read("styles/tokens.css");

/**
 * 주석을 걷어낸 **선언만** 본다.
 *
 * ★ 왜 그렇게 했는지는 주석에 적는 것이 맞다 — `object-fit` 을 **쓰지 않는 이유**를
 *   적어 둔 설명이 검사에 걸리면, 설명을 지우게 만드는 검사가 된다. 찾는 것은 선언이다.
 */
const declarationsOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ");
const cssCode = declarationsOf(css);

async function renderCover(props: Record<string, unknown> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumCover } = await import("../src/album-engine/components/AlbumCover");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumCover as never, {
      title: "그날 우리는 다 웃고 있었다",
      coverDateLabel: "2018-07-08",
      heroSrc: "https://cdn/x.jpg",
      participants: ["김선호", "박도윤", "이재민"],
      ...props,
    } as never));
  });
  return {
    React, root, container,
    count: (selector: string) => container.querySelectorAll(selector).length,
    text: () => container.textContent || "",
    cleanup: async () => { await React.act(async () => { root.unmount(); }); },
  };
}

test("★ 마크업은 6종이 같다 — 무엇을 어디에 둘지는 CSS 가 정한다", async () => {
  const view = await renderCover();
  // 제목 · 기간 · 함께한 사람 · 사진 · 짧은 선 — 이 한 벌이 여섯 모양의 재료다.
  assert.equal(view.count(".album-cover__title"), 1);
  assert.equal(view.count(".album-cover__period"), 1);
  assert.equal(view.count(".album-cover__people"), 1);
  assert.equal(view.count(".album-cover__hero-img"), 1);
  assert.equal(view.count(".album-cover__rule"), 1);
  await view.cleanup();

  // 모양 이름을 아는 분기 코드를 컴포넌트에 만들지 않는다(§13 · AlbumSkins 와 같은 방식).
  for (const skin of ALBUM_SKINS) {
    assert.equal(tsx.includes(`"${skin}"`), false, `컴포넌트가 ${skin} 을 안다`);
  }
});

test("★ 여섯 모양이 각자 다른 배치를 갖는다", () => {
  for (const skin of ALBUM_SKINS) {
    assert.match(css, new RegExp(`\\.album-renderer--skin-${skin} \\.album-cover`), `${skin} 배치가 없다`);
  }
  // 제목 크기도 모양마다 다르다(시안 §2 — 색만 바꾼 같은 판이 아니다).
  const sizes = new Set(
    (printCss.match(/--print-cover-title: [\d.]+pt/g) ?? []).map((line) => line),
  );
  assert.ok(sizes.size >= 6, `제목 크기가 ${sizes.size}가지뿐이다`);
});

test("★ 색이 재단 여유까지 간다 — 흰 테가 생기면 안 된다", () => {
  // 표지는 지면 전체(--pr-page = 재단 200 + bleed 3 × 2)를 채운다. 실측 206 x 206.
  const cover = css.slice(css.indexOf(".album-cover {"), css.indexOf("}", css.indexOf(".album-cover {")));
  assert.match(cover, /background: var\(--c-accent\)/);
  assert.match(cover, /padding: var\(--pr-inset\)/);
  // 여백형은 아래 띠가 지면 끝까지 내려간다(표지 자체는 흰 종이다).
  assert.match(css, /\.album-renderer--skin-airy \.album-cover \{[\s\S]*?background: #fff;[\s\S]*?padding: 0;/);
  assert.match(css, /\.album-renderer--skin-airy \.album-cover__text \{[\s\S]*?background: var\(--c-accent\)/);
});

test("★ 모양별 색은 이미 있는 값을 그대로 쓴다 — 새로 정하지 않는다", () => {
  const expected: Record<string, string> = {
    basic: "#3f5b7a", scrapbook: "#8a2c2c", airy: "#9a3d63",
    grid: "#7a5a1f", magazine: "#1f6b6b", single: "#6b4a2f",
  };
  for (const [skin, hex] of Object.entries(expected)) {
    const at = tokens.indexOf(`.album-renderer--skin-${skin} {`);
    assert.notEqual(at, -1, `${skin} 토큰이 없다`);
    assert.match(tokens.slice(at, tokens.indexOf("}", at)), new RegExp(`--c-accent: ${hex};`), skin);
  }
  // 표지 CSS 는 색 이름을 다시 적지 않는다 — 토큰을 읽는다.
  for (const hex of Object.values(expected)) {
    assert.equal(css.includes(hex), false, `표지 CSS 가 ${hex} 를 직접 적었다`);
  }
});

test("★ 사진을 자르지 않는다 — 상한만 주고 비율은 브라우저가 지킨다", () => {
  const hero = css.slice(css.indexOf(".album-cover__hero-img {"), css.indexOf("}", css.indexOf(".album-cover__hero-img {")));
  assert.match(hero, /max-width: 100%/);
  assert.match(hero, /width: auto/);
  assert.match(hero, /height: auto/);
  // html2canvas 가 무시하는 object-fit 에 기대지 않는다. 잘라내는 상자도 만들지 않는다.
  assert.equal(cssCode.includes("object-fit"), false);
  assert.equal(/\.album-cover[^{]*\{[^}]*overflow: hidden/.test(cssCode), false);
  // 잡지형은 폭을 꽉 채우되 **세로 사진이 지면을 넘지 않게** 상한이 있다(실측에서 잡혔다).
  const at = cssCode.indexOf(".album-renderer--skin-magazine .album-cover__hero-img");
  assert.notEqual(at, -1, "잡지형 사진 규칙이 없다");
  const declared = Object.fromEntries(
    cssCode.slice(cssCode.indexOf("{", at) + 1, cssCode.indexOf("}", at))
      .split(";")
      .map((part) => part.split(":").map((piece) => piece.trim()))
      .filter((pair) => pair.length === 2),
  );
  assert.equal(declared["max-height"], "120mm");
  // ★ 폭을 100% 로 **고정**하면 상한에 걸린 세로 사진이 찌그러진다. auto 여야 한다.
  assert.equal(declared["width"], "auto", "폭을 고정하면 세로 사진이 찌그러진다");
  assert.equal(declared["height"], "auto");
});

test("★ 인쇄에 테두리·그림자·둥근 모서리를 넣지 않는다", () => {
  // 값을 하나씩 본다 — `border-radius: 0` 은 걷어냈다는 뜻이므로 통과다.
  const radii = (cssCode.match(/border-radius:\s*([^;]+);/g) ?? []).map((line) => line.split(":")[1].trim().replace(";", ""));
  assert.deepEqual([...new Set(radii)].filter((value) => value !== "0"), [], "둥근 모서리가 있다");
  const borders = (cssCode.match(/[^-]border:\s*([^;]+);/g) ?? []).map((line) => line.split(":")[1].trim().replace(";", ""));
  assert.deepEqual([...new Set(borders)].filter((value) => value !== "0"), [], "테두리가 있다");
  assert.equal(cssCode.includes("box-shadow"), false, "그림자가 있다");
});

test("★ 브랜드 로고는 표지에 두지 않는다 — 알리는 자리는 마지막 장이다 (시안)", async () => {
  assert.equal(tsx.includes("BrandMark"), false);
  const view = await renderCover();
  assert.equal(view.count(".album-brand-mark"), 0, "표지에 로고가 남아 있다");
  await view.cleanup();
});

test("★ 새 폰트를 싣지 않는다 — 인쇄 글꼴은 기기에 있는 것만 쓴다 (§9)", () => {
  // 웹폰트를 하나라도 걸면 카카오톡 웹뷰 첫 화면이 그만큼 늦어진다.
  assert.equal(/@font-face|fonts\.googleapis|fonts\.gstatic/.test(printCss + css), false, "웹폰트를 실었다");
  // 인쇄 글꼴 두 벌은 `--print` 안에만 있다 — 화면은 예전 그대로다.
  assert.match(printCss, /--print-mincho:/);
  assert.match(printCss, /--print-serif:/);
  const at = printCss.indexOf("--print-mincho:");
  assert.ok(printCss.lastIndexOf(".album-renderer--print", at) !== -1, "인쇄 밖에 글꼴을 뒀다");
});
