import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 여백형 날짜 머리가 시안과 다르다 (PO 2026-08-17 —
 *    `앨범 제목 테스트 2장은 날짜를 사진 위에 크게 띄운거야? 좀 이상한 것 같은데`).
 *
 * 큰 숫자(일)는 여백형의 디자인이 맞다. **그 아래 줄이 깨져 있었다**:
 * 헤더가 grid 인데 열이 둘 생겨 `2017년 3월` 과 날짜 줄이 가로로 나란히 앉았고,
 * 날짜 조각은 이 모양에서 감춰져 있어 `2017년 3월(사진 1장)` 로 **붙어** 보였다.
 *
 * 시안(album-skins-v2 스킨3)은 큰 숫자 아래가 **한 줄**이다:
 *     2017년 3월 · 동대문구 · 사진 1장
 * 큰 숫자가 이미 `일` 을 말하므로 날짜를 다시 쓰지 않고, 괄호도 쓰지 않는다.
 *
 * ★ 마크업은 6종 공통이다 — 조각 셋을 한 글줄에 두고 **무엇을 보일지는 CSS**가 정한다.
 *   그래서 연필도 `추정` 표시도 한 벌뿐이다(§9 — 스킨마다 마크업을 늘리지 않는다).
 * ★ 빈 조각을 `·` 로 잇지 않는다 — 0을 말하지 않는다.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/a1");

const skins = readFileSync(new URL("../src/album-engine/AlbumSkins.css", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/album-engine/blocks/ChapterHeader.css", import.meta.url), "utf8");

async function renderHeader(props: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ChapterHeader } = await import("../src/album-engine/blocks/ChapterHeader");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(ChapterHeader, {
      dayIndex: 1, variant: "date-only", date: "2017-03-06", dateRangeLabel: "2017.03.06",
      photoCount: 1, ...props,
    } as never));
  });
  const text = (selector: string) => container.querySelector(selector)?.textContent ?? null;
  const view = {
    day: text(".chapter-header__day"),
    month: text(".chapter-header__month"),
    // 여백형이 쓰는 한 줄과, 다른 모양이 쓰는 두 조각.
    airy: text(".chapter-header__dayline-airy"),
    date: text(".chapter-header__dayline-date"),
    rest: text(".chapter-header__dayline-rest"),
    daylines: container.querySelectorAll(".chapter-header__dayline").length,
    pencils: container.querySelectorAll(".chapter-header__edit-btn").length,
  };
  await React.act(async () => { root.unmount(); });
  return view;
}

test("★ 여백형 줄은 `월 · 지역 · 사진 N장` 한 줄이다 — 날짜를 다시 쓰지 않는다", async () => {
  const view = await renderHeader({ place: "동대문구", locationSource: "exif" });
  assert.equal(view.airy, "2017년 3월 · 동대문구 · 사진 1장");
  // 큰 숫자는 그대로 일(日) 두 자리다.
  assert.equal(view.day, "06");
  // 글줄은 하나다 — 조각이 여럿이어도 줄을 나누지 않는다(연필이 한 벌인 이유).
  assert.equal(view.daylines, 1);
});

test("★ 지역이 없으면 `월 · 사진 N장` — 빈 자리에 `·` 가 남지 않는다", async () => {
  const view = await renderHeader({ place: null, locationSource: null });
  assert.equal(view.airy, "2017년 3월 · 사진 1장");
  assert.equal((view.airy || "").includes("·  ·"), false);
});

test("★ 사진 수가 없으면 그것도 말하지 않는다", async () => {
  const view = await renderHeader({ place: "동대문구", locationSource: "exif", photoCount: 0 });
  assert.equal(view.airy, "2017년 3월 · 동대문구");
});

test("★ 다른 모양의 날짜 줄은 예전 그대로다 (회귀)", async () => {
  const view = await renderHeader({ place: "동대문구", locationSource: "exif" });
  // 기본형이 쓰는 두 조각 — 날짜와 그 뒤(장소 + 괄호 장수).
  assert.equal(view.date, "2017.03.06");
  assert.equal(view.rest, " · 동대문구 (사진 1장)");
  // 월은 자기 줄에 그대로 있다(여백형에서만 CSS 가 감춘다).
  assert.equal(view.month, "2017년 3월");
});

test("★ 무엇을 보일지는 CSS 가 정한다 — 여백형에서만 그 줄이 보인다", () => {
  // 기본값은 감춤이다. 다른 모양에는 없는 글이다.
  assert.match(header, /\.chapter-header__dayline-airy \{ display: none; \}/);
  // 여백형에서 뒤집는다: 날짜 조각과 그 뒤를 감추고, 한 줄을 보인다.
  assert.match(skins, /skin-airy \.chapter-header__dayline-date,[\s\S]{0,120}dayline-rest \{ display: none; \}/);
  assert.match(skins, /skin-airy \.chapter-header__dayline-airy \{ display: inline; \}/);
  // 월은 그 줄 안으로 들어갔으므로 자기 줄을 감춘다 — **그 줄이 있을 때만**이다.
  assert.match(skins, /skin-airy \.chapter-header--date-only:has\(\.chapter-header__dayline\) \.chapter-header__month/);
  // 열이 둘이던 것(가로로 나란히 앉던 원인)이 사라졌다.
  // (주석은 뺀다 — 없어진 값을 **적어 둔** 줄까지 걸리면 그 사정을 적을 수 없다.)
  const rules = skins.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = rules.slice(rules.indexOf("skin-airy .chapter-header--date-only {"));
  assert.equal(rule.slice(0, rule.indexOf("}")).includes("auto auto"), false, "열이 다시 둘이 됐다");
});

test("★ 인쇄는 영향받지 않는다 — 그 줄이 인쇄 머리에 오지 않는다", () => {
  const source = readFileSync(new URL("../src/album-engine/blocks/ChapterHeader.tsx", import.meta.url), "utf8");
  const print = source.slice(source.indexOf('if (variant === "print-date")'), source.indexOf('if (variant === "date-only")'));
  assert.equal(print.includes("dayline-airy"), false, "인쇄 머리에 화면용 줄이 들어갔다");
  // ★ 2026-08-19 — 인쇄 머리가 B안(큰 날짜 숫자)으로 바뀌었다(시안 §3). 이 검사가
  //   지키는 것은 **화면용 줄이 인쇄로 새지 않는다**이고 그대로다.
  assert.match(print, /className="chapter-header__daynum"/);
  assert.equal(print.includes("airyLine"), false, "인쇄 머리가 화면 한 줄을 쓴다");
});
