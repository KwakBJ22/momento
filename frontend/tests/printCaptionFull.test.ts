import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 인쇄에서 캡션이 두 줄에서 잘린다 (I-4g · SCREEN_SPEC §9).
 *
 * 화면의 두 줄 제한(`-webkit-line-clamp: 2`, 작성자가 둘 이상이면 1)이 인쇄까지
 * 따라왔다. 화면은 사진을 크게 보이려고 자르는 것이 맞지만(§6) 인쇄는 자를 이유가 없다.
 * 캡션은 인쇄까지 가는 유일한 사용자 글이다.
 *
 * ★ 4e 와 같은 방식으로 본다 — 요소가 아니라 **글자가 원문과 같은지**.
 *   (요소만 세면 잘린 캡션도 통과한다.)
 */

registerCssStub();
setupDom("https://test.local/");

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const linesCss = readFileSync(new URL("../src/album-engine/components/PhotoMemoryLines.css", import.meta.url), "utf8");
const sample = readFileSync(new URL("../scripts/pdfSample.tsx", import.meta.url), "utf8");

/** 표본에 넣은 그 문장이다. 두 줄로는 절대 안 끝난다. */
const LONG = "숙소 앞 돌담. 여기서 한참 서 있었다. 아무도 먼저 들어가자는 말을 안 했다. 바람이 차가웠는데도 셋 다 그냥 서서 바다 쪽만 봤다.";

function photo(id: string, caption: string) {
  const url = `https://cdn.test/${id}.webp`;
  return {
    id, sort_order: Number(id.slice(1)),
    original_url: url, display_url: url, thumbnail_url: url,
    caption, taken_at: "2018-11-18T09:00:00Z", width: 1600, height: 1200,
  };
}

async function renderPrint(photos: unknown[]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos, title: "표본", epilogue: "끝 글", albumId: "a", mode: "print",
      coverDateLabel: "2018.11.18", contributorNames: ["가"],
    } as never));
  });
  const captions = Array.from(container.querySelectorAll(".print-frame__caption")).map((node) => node.textContent || "");
  const pages = Array.from(container.querySelectorAll<HTMLElement>(".print-page"));
  await React.act(async () => { root.unmount(); });
  return { captions, pages };
}

test("★ 인쇄 렌더의 캡션이 **원문 그대로**다 (잘린 문자열이 아니다)", async () => {
  const view = await renderPrint([photo("p1", LONG)]);
  assert.equal(view.captions.length, 1);
  assert.equal(view.captions[0], LONG, "캡션이 원문과 다르다 — 어디선가 잘렸다");
});

test("★ 인쇄 CSS 에 줄 수 제한이 없다", () => {
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  // 자르는 쪽 값이 인쇄에 남아 있으면 안 된다.
  assert.equal(/-webkit-line-clamp:\s*\d/.test(rules), false, "인쇄에 줄 수 제한이 있다");
  // 캡션 글에 높이 상한을 걸어 자르는 것도 같은 일이다.
  assert.equal(/photo-memory-lines__text[^{]*\{[^}]*max-height/.test(rules), false, "캡션에 높이 상한이 있다");
  // 자르는 규칙을 **끄는** 자리는 있어야 한다.
  const at = rules.indexOf(".album-renderer--print .print-frame__caption .photo-memory-lines--caption .photo-memory-lines__text {");
  assert.notEqual(at, -1, "인쇄에서 줄 수 제한을 끄는 규칙이 없다");
  const rule = rules.slice(at, rules.indexOf("}", at));
  assert.match(rule, /display: block/);
  assert.match(rule, /overflow: visible/);
});

test("★ 화면은 그대로 두 줄 + `…` 다", () => {
  // 화면 규칙을 지우는 것이 아니다 — 인쇄에서만 끈다(§6 은 화면 규칙이다).
  assert.match(linesCss, /\.photo-memory-lines--caption \.photo-memory-lines__text \{[^}]*-webkit-line-clamp: 2;/);
  assert.match(linesCss, /--multi \.photo-memory-lines__text \{\s*\r?\n?\s*-webkit-line-clamp: 1;/);
});

test("★ 화면 렌더에는 이 인쇄 규칙이 닿지 않는다", () => {
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = rules.split("}").map((chunk) => chunk.split("{")[0].trim()).filter(Boolean);
  for (const selector of selectors) {
    for (const one of selector.split(",").map((value) => value.trim()).filter(Boolean)) {
      assert.ok(one.startsWith(".album-renderer--print"), `인쇄 밖으로 새는 규칙: ${one}`);
    }
  }
});

// --- 길어진 만큼 사진을 낮춘다 (넘치게 두지 않는다) ---

test("★ 캡션이 두 줄을 넘으면 그만큼 사진 상한을 낮춘다", async () => {
  const short = await renderPrint([photo("p1", "짧다")]);
  assert.equal(short.pages[0].style.getPropertyValue("--print-caption-extra"), "", "짧은 캡션 쪽은 지금 그대로여야 한다");

  const long = await renderPrint([photo("p1", LONG)]);
  const extra = long.pages[0].style.getPropertyValue("--print-caption-extra");
  assert.match(extra, /^\d+(\.\d+)?mm$/, `쪽에 낮출 높이가 없다: ${extra}`);
  assert.ok(Number.parseFloat(extra) > 0);
});

test("★ 낮추는 높이는 늘어난 캡션 높이와 같다 — 프레임 높이가 그대로라 쪽을 넘지 않는다", async () => {
  const { printCaptionExtraMm, printCaptionLines, PRINT_CAPTION_LINE_MM, PRINT_CAPTION_BUDGET_LINES } =
    await import("../src/album-engine/components/printCaptionFit");
  const one = { id: "p1", comment: LONG };
  const lines = printCaptionLines(one);
  assert.ok(lines > PRINT_CAPTION_BUDGET_LINES, "두 줄 안에 드는 문장으로는 확인이 안 된다");
  assert.equal(
    printCaptionExtraMm([one]),
    (lines - PRINT_CAPTION_BUDGET_LINES) * PRINT_CAPTION_LINE_MM,
  );
});

test("★ 줄 수를 **적게 보지 않는다** — 폭을 가장 좁게 잡는다", async () => {
  const fit = await import("../src/album-engine/components/printCaptionFit");
  // 사진의 짧은 변 하한(60mm)이 프레임 폭 하한이다(I-4b-5).
  const { PRINT_MIN_PHOTO_SHORT_SIDE_MM } = await import("../src/album-engine/components/PrintPages");
  assert.equal(fit.PRINT_CAPTION_WIDTH_MM, PRINT_MIN_PHOTO_SHORT_SIDE_MM);
  // 폭이 좁을수록 줄이 많다 — 적게 보면 넘치고, 많이 보면 사진이 조금 작아질 뿐이다.
  assert.ok(fit.printCaptionCharsPerLine(60) < fit.printCaptionCharsPerLine(120));
});

test("한 쪽의 낮춤은 그 쪽에서 캡션이 가장 긴 사진이 정한다", async () => {
  const { printCaptionExtraMm } = await import("../src/album-engine/components/printCaptionFit");
  const short = { id: "p1", comment: "짧다" };
  const long = { id: "p2", comment: LONG };
  assert.equal(printCaptionExtraMm([short, long]), printCaptionExtraMm([long]));
  assert.equal(printCaptionExtraMm([short]), 0);
  assert.equal(printCaptionExtraMm([{ id: "p3" }]), 0);
});

test("★ 아주 긴 캡션은 **그 사진만** 다음 쪽으로 간다", async () => {
  const { paginateChapterPhotos, PRINT_PHOTOS_PER_PAGE } = await import("../src/album-engine/components/PrintPages");
  const { printCaptionNeedsOwnPage, PRINT_CAPTION_OWN_PAGE_LINES, printCaptionLines } =
    await import("../src/album-engine/components/printCaptionFit");

  const huge = { id: "p3", comment: "가".repeat(300) };
  assert.ok(printCaptionLines(huge) > PRINT_CAPTION_OWN_PAGE_LINES);
  assert.equal(printCaptionNeedsOwnPage(huge), true);
  assert.equal(printCaptionNeedsOwnPage({ id: "p1", comment: LONG }), false, "보통 긴 캡션까지 혼자 두면 종이만 는다");

  const photos = [{ id: "p1" }, { id: "p2" }, huge, { id: "p4" }, { id: "p5" }];
  const pages = paginateChapterPhotos(photos, false, PRINT_PHOTOS_PER_PAGE, printCaptionNeedsOwnPage);
  assert.deepEqual(pages.map((page) => page.map((item) => item.id)), [["p1", "p2"], ["p3"], ["p4", "p5"]]);
});

test("판정을 주지 않으면 쪽 나눔은 지금 그대로다 (4c·4d 유지)", async () => {
  const { paginateChapterPhotos } = await import("../src/album-engine/components/PrintPages");
  const photos = [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}` }));
  assert.deepEqual(
    paginateChapterPhotos(photos, false).map((page) => page.map((item) => item.id)),
    [["p1", "p2", "p3", "p4"], ["p5"]],
  );
});

test("사진이 사라질 만큼은 빼지 않는다", async () => {
  const { printCaptionExtraMm, PRINT_CAPTION_EXTRA_MAX_MM } = await import("../src/album-engine/components/printCaptionFit");
  // 한 쪽 한 장 + 이야기일 때의 상한이 165mm 다 — 그보다 적게 뺀다.
  assert.ok(PRINT_CAPTION_EXTRA_MAX_MM < 165);
  assert.equal(printCaptionExtraMm([{ id: "p1", comment: "가".repeat(5000) }]), PRINT_CAPTION_EXTRA_MAX_MM);
});

test("표본에 긴 캡션이 들어 있다 — 잘리지 않는 것을 눈으로 볼 수 있어야 한다", () => {
  assert.ok(sample.includes(LONG), "표본 데이터에 그 문장이 없다");
});
