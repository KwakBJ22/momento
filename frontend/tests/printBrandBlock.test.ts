import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 브랜드 블록을 `우리의 이야기` 쪽 아래로 · 로고에 영문과 주소 (I-4f · SCREEN_SPEC §9).
 *
 * 브랜드가 로고와 두 줄뿐인데 종이 한 장을 통째로 쓰고 있었다.
 * ★ 먼저 끝 글 쪽 아래에 넣어 보고, 자리가 모자랄 때만 제 쪽에 남긴다.
 *   판정 기준은 **자리가 있느냐 하나**다.
 * ★ 되돌린 모양은 지금 그대로다(쪽 가운데 · 한 장 크기).
 */

registerCssStub();
setupDom("https://test.local/");

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("../src/lib/brand.ts", import.meta.url), "utf8");

function rule(selector: string): string {
  const at = printCss.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
  return printCss.slice(at, printCss.indexOf("}", at));
}

// --- 4f-2 로고 아래 영문과 주소 ---

test("★ 문자열은 lib/brand.ts 한 곳에서 나온다", () => {
  assert.match(brand, /export const BRAND_NAME_EN = "woorialbum";/);
  assert.match(brand, /export const BRAND_SITE_URL = "www\.woorialbum\.com";/);
  // 화면 코드에 문자열을 직접 적지 않는다 — 주소가 바뀔 때 고칠 자리가 하나여야 한다(§3).
  assert.match(renderer, /\{BRAND_NAME_EN\}/);
  assert.match(renderer, /\{BRAND_SITE_URL\}/);
  assert.equal(renderer.includes("woorialbum"), false, "컴포넌트에 문자열을 직접 적었다");
});

test("★ 순서는 로고 → 영문 → 주소다", async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos: [{ id: "p1", sort_order: 1, original_url: "https://cdn.test/1.webp", display_url: "https://cdn.test/1.webp", thumbnail_url: "https://cdn.test/1.webp", caption: "캡션", taken_at: "2018-11-18T09:00:00Z", width: 1600, height: 1200 }],
      title: "표본", epilogue: "끝", albumId: "a", mode: "print",
      coverDateLabel: "2018.11.18", contributorNames: ["가"],
    } as never));
  });
  const page = container.querySelector(".album-renderer__brand-page")!;
  const order = Array.from(page.querySelectorAll(".album-brand-mark, .album-renderer__brand-en, .album-renderer__brand-url"))
    .map((node) => node.className.split(" ")[0]);
  assert.deepEqual(order, ["album-brand-mark", "album-renderer__brand-en", "album-renderer__brand-url"]);
  assert.equal(page.querySelector(".album-renderer__brand-en")?.textContent, "woorialbum");
  assert.equal(page.querySelector(".album-renderer__brand-url")?.textContent, "www.woorialbum.com");
  // ★ 주소는 글자로만 쓴다 — 인쇄물이라 링크로 만들지 않는다.
  assert.equal(page.querySelector("a"), null);
  await React.act(async () => { root.unmount(); });
});

test("★ 화면 렌더는 건드리지 않는다 — 두 줄은 인쇄에만 넣는다", async () => {
  assert.match(renderer, /\{mode === "print" \? \(\s*<p className="album-renderer__brand-id">/);
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos: [{ id: "p1", sort_order: 1, original_url: "https://cdn.test/1.webp", display_url: "https://cdn.test/1.webp", thumbnail_url: "https://cdn.test/1.webp", caption: "캡션", taken_at: "2018-11-18T09:00:00Z", width: 1600, height: 1200 }],
      title: "표본", epilogue: "끝", albumId: "a", mode: "screen", contributorNames: ["가"],
    } as never));
  });
  assert.equal(container.querySelector(".album-renderer__brand-id"), null, "화면에 새 두 줄이 생겼다");
  await React.act(async () => { root.unmount(); });
});

test("영문·주소는 12px · 본문 보조색 · 줄간격 1.5 · 가운데", () => {
  assert.match(printCss, /--print-brand-id: 12px;/);
  const line = rule(".album-renderer--print .album-renderer__brand-url");
  assert.match(line, /font-size: var\(--print-brand-id\)/);
  assert.match(line, /color: var\(--c-text-soft\)/);
  assert.match(line, /line-height: 1\.5/);
  assert.match(rule(".album-renderer--print .album-renderer__brand-id"), /text-align: center/);
  // 로고(29px)보다 작다 — 로고가 주인공이다.
  const logo = Number(printCss.match(/--print-brand-logo:\s*(\d+)px/)![1]);
  assert.ok(12 < logo);
});

// --- 4f-1 자리가 있으면 같은 쪽 ---

test("★ 자리가 있으면 끝 글 쪽 **아래**에 붙고, 없으면 제 쪽으로 되돌아간다", async () => {
  const { placeBrandOnClosingPage } = await import("../src/lib/pdfPageBreak");

  /** jsdom 에는 레이아웃이 없다 — 높이를 직접 정해 두 갈래를 다 본다. */
  const build = (fits: boolean) => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="album-renderer__body">
      <section class="print-closing"><div class="album-epilogue"></div></section>
      <section class="album-renderer__brand-page"></section>
    </div>`;
    const closing = root.querySelector<HTMLElement>(".print-closing")!;
    Object.defineProperty(closing, "clientHeight", { value: 1000, configurable: true });
    Object.defineProperty(closing, "scrollHeight", { value: fits ? 900 : 1400, configurable: true });
    return root;
  };

  const roomy = build(true);
  assert.equal(placeBrandOnClosingPage(roomy), "closing");
  assert.ok(roomy.querySelector(".print-closing > .album-renderer__brand-page"), "끝 글 쪽 안에 들어가야 한다");
  assert.equal(roomy.querySelector<HTMLElement>(".album-renderer__brand-page")!.dataset.printBrandInline, "1");

  const tight = build(false);
  assert.equal(placeBrandOnClosingPage(tight), "own-page");
  assert.equal(tight.querySelector(".print-closing > .album-renderer__brand-page"), null, "제 쪽으로 되돌아가야 한다");
  const returned = tight.querySelector<HTMLElement>(".album-renderer__brand-page")!;
  assert.equal(returned.dataset.printBrandInline, undefined, "되돌릴 때 표시도 지운다");
  assert.equal(returned.parentElement?.className, "album-renderer__body");
});

test("같은 쪽에 올 때는 쪽 **아래**에 붙는다 (본문 바로 뒤가 아니다)", () => {
  const inline = rule(".album-renderer--print .print-closing > .album-renderer__brand-page[data-print-brand-inline]");
  assert.match(inline, /margin-top: auto/);
  // 자기 쪽일 때의 한 장 크기·여백은 벗는다.
  assert.match(inline, /aspect-ratio: auto/);
  assert.match(inline, /padding: 0/);
});

test("★ 제 쪽으로 갈 때의 모양은 지금 그대로다 (쪽 가운데 · 한 장)", () => {
  // 한 장 크기 규칙과 가운데 정렬이 그대로 남아 있다.
  assert.match(printCss, /\.album-renderer--print \.album-cover,\s*\r?\n\.album-renderer--print \.album-renderer__brand-page \{[\s\S]{0,120}aspect-ratio: 210 \/ 297/);
  const blocks = printCss.split(".album-renderer--print .album-renderer__brand-page {").slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("}")));
  assert.ok(blocks.some((block) => /justify-content: center/.test(block) && /align-items: center/.test(block)));
});

test("내보내기가 이 배치를 실제로 건다", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(exportPdf, /placeBrandOnClosingPage\(element\)/);
  // 어디에 놓였는지 남긴다(다음에 이상하면 이 줄로 찾는다).
  assert.match(exportPdf, /logPdf\("pdf_brand_placed"/);
  // 페이지 정렬보다 **먼저** 옮긴다 — 옮기면 높이가 바뀐다.
  assert.ok(exportPdf.indexOf("placeBrandOnClosingPage") < exportPdf.indexOf("alignBlocksToPrintPages(element)"));
});
