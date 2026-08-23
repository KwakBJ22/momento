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
  // ★ J-13(2026-08-10): 도메인 이전이 끝나 **정본을 `www` 없는 쪽으로** 정했다.
  //   `www` 는 Vercel 이 apex 로 넘긴다. 종이에 찍히는 주소는 하나여야 한다.
  assert.match(brand, /export const BRAND_SITE_URL = "woorialbum\.com";/);
  // 화면 코드에 문자열을 직접 적지 않는다 — 주소가 바뀔 때 고칠 자리가 하나여야 한다(§3).
  assert.match(renderer, /\{BRAND_NAME_EN\}/);
  assert.match(renderer, /\{BRAND_SITE_URL\}/);
  // ★ 브랜드 **문자열**을 직접 적었는지만 본다. K-1-b 뒤로 저장 키가
  //   `woorialbum-living-focus:…` 처럼 같은 낱말을 갖는다 — 그건 이름이 아니라 키다.
  assert.equal(/["'`]woorialbum["'`]/.test(renderer), false, "컴포넌트에 문자열을 직접 적었다");
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
  // ★ 2026-08-19 — 인쇄 마지막 장에서 **그림 로고가 빠졌다**(시안 §6 — 활자 한 줄로
  //   대신한다). 남은 순서는 묻는 말 → 영문 → 주소다. 화면은 로고 그대로다(아래 검사).
  const order = Array.from(page.querySelectorAll(".album-brand-mark, .album-renderer__brand-ask-title, .album-renderer__brand-en, .album-renderer__brand-url"))
    .map((node) => node.className.split(" ")[0]);
  assert.deepEqual(order, ["album-renderer__brand-ask-title", "album-renderer__brand-en", "album-renderer__brand-url"]);
  assert.equal(page.querySelector(".album-renderer__brand-en")?.textContent, "woorialbum");
  assert.equal(page.querySelector(".album-renderer__brand-url")?.textContent, "woorialbum.com");
  // ★ 주소는 글자로만 쓴다 — 인쇄물이라 링크로 만들지 않는다.
  assert.equal(page.querySelector("a") === null, true);
  await React.act(async () => { root.unmount(); });
});

test("★ 화면 렌더는 건드리지 않는다 — 두 줄은 인쇄에만 넣는다", async () => {
  // ★ 2026-08-19 — 마지막 장이 시안대로 바뀌면서 마크업이 늘었다. 지키는 것은 그대로다:
  //   **인쇄 갈래에만** 그 두 줄이 있고 화면에는 없다.
  assert.match(renderer, /\{mode === "print" \? \([\s\S]{0,400}album-renderer__brand-id/);
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
  assert.equal(container.querySelector(".album-renderer__brand-id") === null, true, "화면에 새 두 줄이 생겼다");
  await React.act(async () => { root.unmount(); });
});

test("영문·주소는 9pt · 본문 보조색 · 줄간격 1.5 · 가운데", () => {
  // ★ 2026-08-16 — 인쇄 글자 크기를 pt 로 적는다(종이의 단위다). 12px = 9pt, 크기는 같다.
  assert.match(printCss, /--print-brand-id: 9pt;/);
  const line = rule(".album-renderer--print .album-renderer__brand-url");
  assert.match(line, /font-size: var\(--print-brand-id\)/);
  assert.match(line, /color: var\(--c-text-soft\)/);
  assert.match(line, /line-height: 1\.5/);
  assert.match(rule(".album-renderer--print .album-renderer__brand-id"), /text-align: center/);
  // 로고(22pt)보다 작다 — 로고가 주인공이다. (크기 단위는 pt 다 · 2026-08-16)
  const logo = Number(printCss.match(/--print-brand-logo:\s*([\d.]+)pt/)![1]);
  const id = Number(printCss.match(/--print-brand-id:\s*([\d.]+)pt/)![1]);
  assert.ok(id < logo);
  // ★ 8pt 아래로 내려가지 않는다 — 40대 이후 타깃이라 그 아래는 안 읽힌다.
  assert.ok(id >= 8, `가장 작은 글자가 8pt 아래다: ${id}pt`);
});

// --- 4f-1 자리가 있으면 같은 쪽 ---

// ★ 2026-08-22 — `placeBrandOnClosingPage`(끝 글 쪽에 자리가 있으면 브랜드를 거기 붙이던
//   계산)는 굽던 시절의 것이라 지웠다. 서버는 맺음을 **제 쪽 한 장**으로 그린다(무게 아래).
//   맺음 쪽이 있고 그 글자가 프런트 brand.ts 와 같은지는 backend/tests/test_album_pdf_service.py 가
//   실제 PDF 에서 글자를 뽑아 잰다.
test("★ 서버가 맺음을 제 쪽 한 장으로 그린다 — 무게는 아래", () => {
  const server = readFileSync(new URL("../../backend/app/services/album_pdf_service.py", import.meta.url), "utf8");
  assert.match(server, /def _draw_last_page\(/);
  assert.match(server, /무게를 아래에/);
  assert.match(server, /BRAND_LAST_PAGE_ASK = "우리도 만들어볼까\?"/);
  assert.match(server, /BRAND_SITE_URL = "woorialbum\.com"/);
  const pageBreak = readFileSync(new URL("../src/lib/pdfPageBreak.ts", import.meta.url), "utf8");
  assert.equal(pageBreak.includes("export function placeBrandOnClosingPage"), false, "끝 글 쪽에 끼우는 계산이 되살아났다");
});

test("같은 쪽에 올 때는 쪽 **아래**에 붙는다 (본문 바로 뒤가 아니다)", () => {
  const inline = rule(".album-renderer--print .print-closing > .album-renderer__brand-page[data-print-brand-inline]");
  assert.match(inline, /margin-top: auto/);
  // 자기 쪽일 때의 한 장 크기·여백은 벗는다.
  assert.match(inline, /aspect-ratio: auto/);
  assert.match(inline, /padding: 0/);
});

// ★ 2026-08-19 — 가운데 정렬이 **아래쪽 정렬**로 바뀌었다(시안 §6 — 마지막 장은
//   무게를 아래에만 두고 위를 비운다). `한 장짜리`라는 규칙은 그대로다.
test("★ 제 쪽으로 갈 때 — 한 장짜리이고 무게는 아래쪽이다", () => {
  assert.match(printCss, /\.album-renderer--print \.album-cover,\s*\r?\n\.album-renderer--print \.album-renderer__brand-page \{[\s\S]{0,160}aspect-ratio: 1 \/ 1/);
  const blocks = printCss.split(".album-renderer--print .album-renderer__brand-page {").slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("}")));
  assert.ok(blocks.some((block) => /justify-content: flex-end/.test(block) && /align-items: center/.test(block)));
});

test("내보내기는 화면을 굽지 않는다 — 배치는 서버가 한다", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  const code = exportPdf.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.equal(code.includes("placeBrandOnClosingPage"), false);
  assert.equal(code.includes("AlbumRenderer"), false, "화면 렌더러를 PDF 에 다시 마운트한다");
});
