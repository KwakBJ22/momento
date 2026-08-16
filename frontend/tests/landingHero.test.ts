import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 첫 화면 히어로 — **각자 올린 사진이 한 권으로** (시안 1a · docs/mockups/landing_extracted.html).
 *
 * ★ 예전에는 세로 점선 셋이었다. 그러면 나란히 내려갈 뿐 **모이지 않는다** —
 *   이 그림이 말해야 하는 것이 바로 `모인다` 라 뜻이 통째로 사라졌다.
 *   곡선 셋이 한 점으로 모이는 모양으로 바꿨다(CSS 로는 못 그린다 → SVG).
 * ★ 색도 옅어 거의 안 보였다. 브랜드 계열의 연한 선으로 올렸다.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const landing = read("components/Landing.tsx");
const css = read("App.css");
const tokens = read("styles/tokens.css");

async function renderLanding() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Landing } = await import("../src/components/Landing");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Landing as never, {} as never)); });
  return {
    React, container,
    count: (selector: string) => container.querySelectorAll(selector).length,
    cleanup: async () => { await React.act(async () => { root.unmount(); }); },
  };
}

test("★ 모이는 선은 곡선 셋이다 — 나란한 점선이 아니다", async () => {
  const view = await renderLanding();
  assert.equal(view.count("svg.landing-hero__flow"), 1, "모이는 선이 SVG 가 아니다");
  assert.equal(view.count(".landing-hero__flow path"), 3, "선이 셋이 아니다");
  // 장식이다 — 읽어 줄 내용이 없다.
  assert.equal(view.count(".landing-hero__flow[aria-hidden=true]"), 1);
  await view.cleanup();

  // 시안의 좌표 그대로다: 바깥 둘은 가운데로 휘고, 가운데는 곧게 내려온다.
  assert.match(landing, /d="M50 2C50 22 100 18 150 34"/);
  assert.match(landing, /d="M150 2v32"/);
  assert.match(landing, /d="M250 2c0 20-50 16-100 32"/);
  // 옛 모양(세로 점선 셋)이 남아 있지 않다.
  assert.equal(landing.includes('<div className="landing-hero__flow"'), false, "점선 셋이 남았다");
});

test("★ 선 색은 브랜드 계열이다 — 회색이면 배경에 묻힌다", () => {
  const rule = css.slice(css.indexOf(".landing-hero__flow path {"), css.indexOf("}", css.indexOf(".landing-hero__flow path {")));
  assert.match(rule, /stroke: var\(--c-hairline-brand\)/);
  assert.match(rule, /stroke-width: 1\.5/);
  assert.match(rule, /stroke-dasharray: 3 4/);
  assert.match(rule, /stroke-linecap: round/);
  assert.match(tokens, /--c-hairline-brand: #f2cfcd;/);
  // 회색 선으로 되돌아가지 않았다.
  assert.equal(rule.includes("var(--c-hairline)"), false, "회색 선으로 돌아갔다");
});

test("★ 앨범 카드 뒤에 한 장이 겹쳐 있다 — 쌓인 한 권으로 읽힌다", async () => {
  const view = await renderLanding();
  assert.equal(view.count(".landing-hero__book-back"), 1, "겹친 카드가 없다");
  // 겹친 장이 **먼저** 온다(뒤에 깔린다).
  const book = view.container.querySelector(".landing-hero__book") as HTMLElement;
  assert.equal(book.children[0]?.className === "landing-hero__book-back", true, "겹친 장이 카드 뒤가 아니다");
  await view.cleanup();

  const back = css.slice(css.indexOf(".landing-hero__book-back {"), css.indexOf("}", css.indexOf(".landing-hero__book-back {")));
  assert.match(back, /inset: 10px 10px -6px/);
  assert.match(back, /transform: rotate\(-1\.4deg\)/);
  assert.match(back, /border-radius: 16px/);
  // 카드 그림자도 시안 값이다.
  assert.match(tokens, /--sh-card: 0 10px 26px rgba\(45, 45, 45, 0\.08\);/);
  const album = css.slice(css.indexOf(".landing-hero__album {"), css.indexOf("}", css.indexOf(".landing-hero__album {")));
  assert.match(album, /box-shadow: var\(--sh-card\)/);
});

test("★ 세 사람의 색이 서로 다르다 — 같으면 그냥 사진 3장이다", async () => {
  const view = await renderLanding();
  for (const tone of ["dad", "mom", "me"]) {
    assert.equal(view.count(`.landing-hero__avatar--${tone}`) > 0, true, `${tone} 색이 안 붙었다`);
  }
  await view.cleanup();

  const pairs: Array<[string, string, string]> = [
    ["dad", "#e4edea", "#5a7a6c"],
    ["mom", "#ffe0e0", "#e85555"],
    ["me", "#ede6f2", "#6e5e80"],
  ];
  for (const [tone, bg, text] of pairs) {
    assert.match(tokens, new RegExp(`--c-hero-${tone}: ${bg};`));
    assert.match(tokens, new RegExp(`--c-hero-${tone}-text: ${text};`));
    assert.match(css, new RegExp(`\\.landing-hero__avatar--${tone} \\{ background: var\\(--c-hero-${tone}\\); color: var\\(--c-hero-${tone}-text\\); \\}`));
  }
});

test("★ 히어로에 hex 를 직접 쓰지 않는다 — 값은 토큰 한 곳이다 (§8)", () => {
  // 화면 코드(tsx)와 히어로 CSS 규칙 어디에도 hex 가 없다.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(landing), false, "히어로 코드에 hex 가 있다");
  const heroCss = css.slice(css.indexOf(".landing-hero"), css.indexOf(".landing-hero__toggle"));
  const found = heroCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(found, [], `히어로 CSS 에 hex 가 있다: ${found.join(" ")}`);
});

test("★ 여닫는 동작과 사진 기울기는 그대로다 (3a6a00e)", () => {
  assert.match(landing, /localStorage\.getItem\(HERO_KEY\) !== "closed"/);
  assert.match(landing, /aria-expanded=\{open\}/);
  // 기울기 셋은 CSS 에 그대로 있다.
  for (const deg of ["-3.5deg", "1.5deg", "4deg"]) {
    assert.equal(css.includes(deg), true, `기울기가 바뀌었다: ${deg}`);
  }
  // 애니메이션을 넣지 않았다(시안의 모션은 아직 결정 전이다).
  const heroCss = css.slice(css.indexOf(".landing-hero"), css.indexOf(".landing-hero__toggle"));
  assert.equal(/@keyframes|animation:/.test(heroCss), false, "히어로에 애니메이션이 생겼다");
});
