import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 열람용 PDF 의 구성 (SCREEN_SPEC §9).
 *
 *   1쪽  표지 — 로고 · 제목 · 기간 · 대표 사진        ← 독립 페이지
 *   본문  날짜 머리글 + 그 날의 사진들 (한 장에 최대 4장)
 *         사진마다 프레임, 프레임 안에 캡션
 *         "YYYY.MM.DD의 이야기"
 *   끝    "우리의 이야기" + "함께 만든 사람 — …"
 *   끝쪽  브랜드 페이지                                ← 독립 페이지
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function photo(id: string, day: string, caption?: string) {
  return {
    id,
    sort_order: Number(id.replace(/\D/g, "")),
    original_url: `https://cdn.test/${id}-original.jpg`,
    display_url: `https://cdn.test/${id}-display.webp`,
    thumbnail_url: `https://cdn.test/${id}-thumb.webp`,
    caption: caption ?? null,
    taken_at: `${day}T09:0${id.replace(/\D/g, "").slice(-1)}:00Z`,
    width: 1200,
    height: 900,
  };
}

async function renderPrint(photos: unknown[], extra: Record<string, unknown> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos, title: "우리 여행", epilogue: "좋은 날이었다.", albumId: "album-1",
      contributorNames: ["곽병준", "영희"], mode: "print", ...extra,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  return { React, root, container };
}

test("표지와 브랜드 페이지가 각각 독립 페이지다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01")]);
  const cover = view.container.querySelector(".album-cover");
  const brand = view.container.querySelector(".album-renderer__brand-page");
  assert.equal(cover !== null, true, "표지가 있어야 한다");
  assert.equal(brand !== null, true, "브랜드 페이지가 있어야 한다");
  // 예전에는 본문 끝에 작게 붙는 footer 였다 — 독립 section 으로 바꿨다.
  assert.equal(view.container.querySelector(".album-renderer__brand-footer") === null, true);

  const css = read("album-engine/components/PrintPages.css");
  // 한 덩어리가 정확히 A4 한 장이라, 표지 아래에 본문이 붙을 자리가 없다.
  for (const selector of [".album-cover", ".album-renderer__brand-page", ".print-page", ".print-closing"]) {
    assert.ok(css.includes(selector), `${selector} 가 페이지 규칙에 있어야 한다`);
  }
  assert.equal((css.match(/aspect-ratio: 210 \/ 297/g) || []).length, 3, "표지·브랜드 / 본문 / 끝 글");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ A4 한 장에 사진을 4장 넘게 넣지 않는다", async () => {
  // 같은 날 8장 → 두 장에 나눠 담는다(§9).
  const photos = Array.from({ length: 8 }, (_, index) => photo(`p${index + 1}`, "2026-08-01"));
  const view = await renderPrint(photos);
  const pages = Array.from(view.container.querySelectorAll(".print-page"));
  assert.equal(pages.length, 2, "8장이면 두 장이다");
  for (const page of pages) {
    const count = page.querySelectorAll(".print-frame").length;
    assert.ok(count <= 4, `한 장에 ${count}장 — 4장을 넘으면 안 된다`);
  }
  assert.equal(view.container.querySelectorAll(".print-frame").length, 8, "빠진 사진이 없다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 날짜 머리글과 그 날 첫 사진이 같은 페이지에 있다", async () => {
  const photos = Array.from({ length: 6 }, (_, index) => photo(`p${index + 1}`, "2026-08-01"));
  const view = await renderPrint(photos);
  const pages = Array.from(view.container.querySelectorAll(".print-page"));
  const first = pages[0];
  assert.equal(first.querySelector(".chapter-header") !== null, true, "첫 장에 머리글이 있다");
  assert.equal(first.querySelector(".print-frame") !== null, true, "머리글만 앞 장에 남지 않는다");
  // 이어지는 장에는 머리글을 다시 붙이지 않는다.
  assert.equal(pages[1].querySelector(".chapter-header") === null, true);
  await view.React.act(async () => { view.root.unmount(); });
});

test("사진과 캡션이 하나의 프레임 안에 있다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01", "그날 바람이 좋았다.")]);
  const frame = view.container.querySelector(".print-frame")!;
  assert.equal(frame.querySelector("img") !== null, true, "프레임 안에 사진");
  assert.match(frame.textContent || "", /그날 바람이 좋았다\./, "프레임 안에 캡션");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 화면(웹·공유)에는 사진 프레임이 없다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01", "캡션")], { mode: "screen" });
  assert.equal(view.container.querySelectorAll(".print-frame").length, 0);
  assert.equal(view.container.querySelectorAll(".print-page").length, 0);
  assert.equal(view.container.querySelector(".album-cover") === null, true, "화면에는 표지가 없다");
  // 프레임 CSS 도 인쇄 모드에서만 걸린다.
  const css = read("album-engine/components/PrintPages.css");
  for (const line of css.split("\n").filter((l) => l.includes(".print-frame") && l.includes("{"))) {
    assert.match(line, /album-renderer--print/, `화면에도 걸리는 규칙: ${line.trim()}`);
  }
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 열람용은 display(WebP) 를 쓴다 — 원본이 아니다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01")]);
  const src = view.container.querySelector(".print-frame img")!.getAttribute("src") || "";
  assert.match(src, /-display\.webp$/, "display 를 써야 한다");
  assert.equal(src.includes("-original"), false, "원본은 인쇄용(200×200mm)의 몫이다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 인쇄는 사진을 기울이지 않는다 (화면은 §9 10차에서 다시 기운다)", () => {
  // E-5 때는 화면·인쇄 모두 반듯하게 뒀지만, §9 10차에서 **화면만** 스크랩북으로 돌아갔다.
  // 인쇄는 그대로 정돈이다 — 기울기 계산이 화면 모드에서만 걸리는지 본다.
  const source = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(source, /const isScreen = useAlbumRenderMode\(\) === "screen";/);
  assert.match(source, /const tilt = isScreen \? photoTiltDeg\(/);
  // 인쇄 본문(PrintPages)은 이 규칙을 아예 모른다.
  assert.doesNotMatch(read("album-engine/components/PrintPages.tsx"), /rotate\(|photoTiltDeg/);
  assert.doesNotMatch(read("album-engine/components/PrintPages.css"), /rotate\(/);
});

test("★ PDF 안의 브랜드는 로고 조합이다 (검은 글자 단독 표기 0건)", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01")]);
  const brand = view.container.querySelector(".album-renderer__brand-page")!;
  // 로고 조합: `우리`(진한 글자색) + `앨범`(브랜드색) — BrandMark 가 두 조각으로 그린다.
  const mark = brand.querySelector(".brand-mark");
  assert.equal(mark !== null, true, "브랜드 페이지에 로고가 있어야 한다");
  assert.equal(mark!.querySelector("b") !== null && mark!.querySelector("i") !== null, true, "두 색 조각으로 그린다");
  // 서비스 이름을 글자로만 적은 자리가 없다.
  const renderer = read("album-engine/AlbumRenderer.tsx");
  const code = renderer.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, />우리앨범</);
  await view.React.act(async () => { view.root.unmount(); });
});

test("페이지 나눔이 새 단위를 본다", () => {
  const pdf = read("lib/exportPdf.tsx");
  assert.match(pdf, /const selector = "\.album-cover, \.print-page, \.print-closing, \.album-living-page, \.album-renderer__brand-page"/);
});
