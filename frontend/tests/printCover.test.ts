import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 열람용 PDF 1쪽 — 표지 (I-4-2 · SCREEN_SPEC §9).
 *
 * 실물에서 본 것 네 가지:
 *   · 사진이 아래에서 잘린다 — 상자에 max-height + overflow:hidden 이라 세로 사진이
 *     잘려 나갔다. §9 는 "사진은 자르지 않는다" 다.
 *   · 표지 사진에만 프레임이 없다 — 다른 쪽과 따로 논다.
 *   · 위쪽 절반이 비어 있다 — grid 의 남는 높이가 행마다 늘어났다.
 *   · 로고가 작고 어둡다 — 보통 글자였다. §9 는 **색이 들어간 로고 조합**이다.
 */

registerCssStub();
setupDom("https://test.local/");

const css = readFileSync(new URL("../src/album-engine/components/AlbumCover.css", import.meta.url), "utf8");
const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/album-engine/components/AlbumCover.tsx", import.meta.url), "utf8");

function rule(text: string, selector: string): string {
  const start = text.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `규칙이 없다: ${selector}`);
  return text.slice(start + selector.length + 2, text.indexOf("}", start));
}

// --- 기간 표시: 년·월을 두 번 쓰지 않는다 ---

const period = async () => (await import("../src/album-engine/buildAlbum")).formatCoverPeriodLabel;

test("★ 2018.11.18 ~ 2018.11.20 → 2018년 11월 18일 ~ 20일", async () => {
  const formatCoverPeriodLabel = await period();
  assert.equal(formatCoverPeriodLabel("2018.11.18 ~ 2018.11.20"), "2018년 11월 18일 ~ 20일");
  assert.equal(formatCoverPeriodLabel("2018.11.18 – 2018.11.20"), "2018년 11월 18일 ~ 20일");
  assert.equal(formatCoverPeriodLabel("2018.11.18"), "2018년 11월 18일");
});

test("달·해가 바뀌면 그만큼만 더 쓴다", async () => {
  const formatCoverPeriodLabel = await period();
  assert.equal(formatCoverPeriodLabel("2018.11.28 ~ 2018.12.02"), "2018년 11월 28일 ~ 12월 2일");
  assert.equal(formatCoverPeriodLabel("2018.12.30 ~ 2019.01.02"), "2018년 12월 30일 ~ 2019년 1월 2일");
});

test("아는 모양이 아니면 손대지 않는다 (지어내지 않는다)", async () => {
  const formatCoverPeriodLabel = await period();
  assert.equal(formatCoverPeriodLabel("제주에서 보낸 사흘"), "제주에서 보낸 사흘");
  assert.equal(formatCoverPeriodLabel(""), "");
  assert.equal(formatCoverPeriodLabel(null), "");
});

// --- 표지가 실제로 그리는 것 ---

test("★ 이름을 로고 조합으로 쓴다 — 보통 글자가 아니다", async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumCover } = await import("../src/album-engine/components/AlbumCover");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumCover, {
      title: "제주에서 보낸 사흘", coverDateLabel: "2018.11.18 ~ 2018.11.20",
      heroSrc: "https://cdn.test/hero.webp", participants: ["곽병준", "영희"],
    } as never));
  });
  // 로고 조합: 우리(진한 글자색) + 앨범(브랜드색). 두 조각이 따로 있어야 색을 나눌 수 있다.
  const word = container.querySelector(".album-brand-mark__word");
  assert.equal(word !== null, true, "로고 조합이 없다(보통 글자로 적었다)");
  assert.equal(word!.querySelector("b")?.textContent, "우리");
  assert.equal(word!.querySelector("i")?.textContent, "앨범");
  // 기간은 다듬어진 형태로 들어간다.
  assert.match(container.textContent || "", /2018년 11월 18일 ~ 20일/);
  assert.equal((container.textContent || "").includes("2018.11.18"), false);
  await React.act(async () => { root.unmount(); });
});

test("★ 표지 로고를 인쇄에서 크게 준다 (rem 고정값이라 물려받지 못한다)", () => {
  // album-brand-mark 의 글자 크기는 화면 기준 rem 고정이라 부모 font-size 를 안 받는다.
  const shared = readFileSync(new URL("../src/album-engine/AlbumRenderer.css", import.meta.url), "utf8");
  assert.match(shared, /\.album-brand-mark__word \{[\s\S]{0,80}font-size: 0\.78rem/);
  // 그래서 인쇄에서만 다시 준다. 값은 큐 4-5 표의 변수를 읽는다(I-4-5).
  assert.match(printCss, /\.album-cover__brand \.album-brand-mark__word \{ font-size: var\(--print-cover-logo\); \}/);
  assert.match(printCss, /\.album-cover__brand \.album-brand-mark__icon \{ width: var\(--print-cover-logo\); height: var\(--print-cover-logo\); \}/);
});

test("★ 표지 사진을 자르지 않는다 — 상자가 아니라 사진에 상한을 준다", () => {
  const hero = rule(css, ".album-cover__hero");
  // 잘라 내던 두 줄이 사라졌다.
  assert.equal(hero.includes("overflow: hidden"), false, "상자가 사진을 자른다");
  assert.equal(/max-height:\s*\d+px/.test(hero), false, "상자에 px 상한이 남아 있다");
  // 프레임은 사진 크기에 맞춰 줄어든다 — 늘리면 프레임 안이 텅 빈다(I-4-4 와 같은 구조).
  assert.match(hero, /flex: 0 1 auto/);
  // 상한은 사진에, mm 로. 백분율은 부모 높이가 확정되지 않아 통하지 않는다.
  const img = rule(css, ".album-cover__hero-img");
  // ★ 2026-08-16 — 지면이 A4 297mm 에서 정사각 200mm 로 바뀌어 상한도 함께 내려왔다
  //   (175 → 100mm). 자르지 않고 **사진에 상한을 준다**는 규칙은 그대로다.
  assert.match(img, /max-height: 100mm/);
  assert.match(img, /max-width: 100%/);
  assert.equal(/object-fit/.test(img), false, "html2canvas 는 object-fit 을 무시한다");
});

test("★ 뒤집힘 — 인쇄에는 사진 프레임(카드)이 없다 (2026-08-16 · 정사각 판형)", () => {
  // ★ 예전에는 표지와 본문이 **같은 카드**(테두리 1px · 둥근 모서리 2mm · 흰 바탕 ·
  //   여백 4mm)를 썼다. 종이에서는 그 선과 면이 그대로 잉크로 찍힌다 —
  //   시안 §1 "사진 둥근 모서리·테두리·그림자 → 인쇄에서는 직각·선 없음".
  //   표지에서 예외인 것은 **배경색**뿐이다(표지 6종은 다음 건).
  //   두 자리가 **같아야 한다**는 규칙은 그대로다 — 이제 둘 다 카드가 없다.
  const hero = rule(css, ".album-cover__hero");
  const frame = rule(printCss, ".album-renderer--print .print-frame");
  for (const [name, block] of [["표지", hero], ["본문", frame]] as const) {
    assert.match(block, /border: 0/, `${name} 프레임에 테두리가 남았다`);
    assert.match(block, /border-radius: 0/, `${name} 프레임이 둥글다`);
    assert.equal(/background: var\(--c-surface\)/.test(block), false, `${name} 프레임에 면이 남았다`);
    assert.match(block, /padding: 0/, `${name} 프레임에 카드 여백이 남았다`);
  }
});

test("★ 페이지에 고르게 앉힌다 — 위쪽 절반만 비지 않는다", () => {
  const cover = rule(css, ".album-cover");
  assert.match(cover, /display: flex/);
  assert.match(cover, /flex-direction: column/);
  assert.match(cover, /justify-content: center/);
  // grid 로 두면 남는 높이가 행마다 늘어난다(예전 방식).
  assert.equal(cover.includes("display: grid"), false);
});

test("표지는 인쇄에서만 그린다 (화면에는 표지가 없다 — §9)", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  assert.match(renderer, /\{mode === "print" \? \(\s*<AlbumCover/);
  void source;
});
