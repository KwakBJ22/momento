import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 캡션이 PDF 에 **한 글자도 안 찍힌다** (I-4e · SCREEN_SPEC §11).
 *
 * 큐가 짚은 원인(표본은 `caption`, 엔진은 `photo.comment` — 이름이 어긋난다)은
 * **아니었다.** 그 자리는 이미 이어져 있다:
 *     AlbumRenderer.tsx  toEnginePhoto: comment: photo.caption
 *
 * 진짜 원인은 **보이지 않게 그려진 것**이었다.
 *     PhotoMemoryLines.css  animation: photo-memory-lines-in 220ms ease-out both;
 * `both` 라서 시작 프레임(opacity: 0)이 애니메이션 전에도 적용된다. PDF 는
 * html2canvas 가 문서를 복제해서 그리는데, 복제본은 애니메이션이 끝난 상태가 아니라
 * **opacity 0 인 시작 상태**로 잡힌다.
 *
 * 캡션 말고 다른 글(날짜 머리글·이야기·함께 만든 사람)에는 이 애니메이션이 없어서
 * 멀쩡히 찍혔다 — 그래서 "캡션만" 사라졌고, 아무 예외도 나지 않았다.
 *
 * 실측(브라우저에서 인쇄 렌더를 html2canvas 로 실제 래스터화해 어두운 화소를 셈):
 *     캡션 없음 22,136  ·  캡션 있음(고치기 전) 22,136  ·  캡션 있음(고친 뒤) 42,464
 *     → 고치기 전에는 캡션이 **잉크를 한 점도 남기지 않았다.**
 */

registerCssStub();
setupDom("https://test.local/");

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const linesCss = readFileSync(new URL("../src/album-engine/components/PhotoMemoryLines.css", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
const sample = readFileSync(new URL("../scripts/pdfSample.tsx", import.meta.url), "utf8");

const CAPTION = "공항에서 내리자마자 바람이 셌다.";

function photo(id: string, caption: string, landscape = true) {
  const [width, height] = landscape ? [1600, 1200] : [1200, 1600];
  const url = `https://cdn.test/${id}.webp`;
  return {
    id, sort_order: Number(id.slice(1)),
    original_url: url, display_url: url, thumbnail_url: url,
    caption, taken_at: "2018-11-18T09:00:00Z", width, height,
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
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  const text = container.textContent || "";
  const captions = container.querySelectorAll(".print-frame__caption").length;
  await React.act(async () => { root.unmount(); });
  return { text, captions };
}

test("★ 캡션이 있는 사진은 인쇄 렌더에 **그 글자가** 있다 (요소가 아니라 글자를 본다)", async () => {
  const view = await renderPrint([photo("p1", CAPTION)]);
  // G-1 이 안 잡혔던 이유가 이것이다 — 요소만 세면 빈 캡션도 통과한다.
  assert.ok(view.text.includes(CAPTION), `인쇄 렌더에 캡션 글자가 없다: ${view.text.slice(0, 80)}`);
  assert.equal(view.captions, 1);
});

test("캡션이 없는 사진에는 빈 자리가 생기지 않는다", async () => {
  const view = await renderPrint([photo("p1", "")]);
  assert.equal(view.captions, 0);
});

test("★ 인쇄에서는 등장 애니메이션을 끈다 — 복제본이 opacity 0 으로 잡힌다", () => {
  // 화면에는 애니메이션이 그대로 있다(이 규칙을 지우면 캡션이 다시 투명해진다).
  assert.match(linesCss, /animation: photo-memory-lines-in 220ms ease-out both;/);
  // 인쇄에서만 끈다.
  const at = printCss.indexOf(".album-renderer--print .photo-memory-lines {");
  assert.notEqual(at, -1, "인쇄에서 애니메이션을 끄는 규칙이 없다");
  const rule = printCss.slice(at, printCss.indexOf("}", at));
  assert.match(rule, /animation: none/);
  assert.match(rule, /opacity: 1/);
});

test("★ 인쇄 글에 투명해질 여지를 남기지 않는다", () => {
  // 인쇄 CSS 어디에도 글을 감추는 값이 없어야 한다.
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/opacity:\s*0(?!\.)/.test(rules), false, "인쇄에 opacity: 0 이 있다");
  // 애니메이션은 끄는 것 말고는 걸지 않는다.
  const animations = rules.match(/animation:[^;]+;/g) || [];
  assert.deepEqual(animations, ["animation: none;"]);
});

test("이름은 이미 이어져 있다 — caption 이 엔진의 comment 로 옮겨진다", () => {
  assert.match(renderer, /comment: photo\.caption,/);
  // 표본도 실제 경로와 같은 이름(AlbumPhoto.caption)을 쓴다.
  assert.match(sample, /caption, taken_at:/);
  assert.equal(sample.includes("comment:"), false, "표본이 엔진 내부 이름을 쓰면 실물과 달라진다");
});

test("긴 캡션이 프레임 폭을 늘리지 않는다 (4d 에서 잠근 것 유지)", () => {
  const at = printCss.indexOf(".album-renderer--print .print-frame__caption {");
  const rule = printCss.slice(at, printCss.indexOf("}", at));
  assert.match(rule, /width: 0/);
  assert.match(rule, /min-width: 100%/);
});
