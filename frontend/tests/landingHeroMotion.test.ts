import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 히어로 등장 모션 — 시안 landing-v2 (2026-08-16).
 *
 * `각자 올린 사진이 한 권으로 모인다` 를 **순서로** 보여준다:
 *   사진 셋 → 선 → 앨범 → 말풍선 → 캡션.
 *
 * 여기서 잠그는 것은 셋이다. 셋 다 틀리면 조용히 망가지는 자리다:
 *   ① 모션이 사진의 **기울기를 지우지 않는다**(끝이 transform: none 이라 층을 나눠야 한다)
 *   ② 움직임을 줄여 달라고 한 사람에게는 **아무것도 움직이지 않는다**(!important 로 이긴다)
 *   ③ **인쇄 렌더에는 애니메이션이 안 딸려 간다**(keyframes 를 공용 CSS 에 두면 샌다)
 *
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");
const motion = read("components/Landing.css");
const landing = read("components/Landing.tsx");

test("★ 순서와 지연이 시안 그대로다 — 순서가 곧 뜻이다", () => {
  const cases: Array<[string, RegExp]> = [
    ["사진", /\.landing-hero__shot\.wa-drop \{\s*\n\s*animation: wa-drop 0\.62s cubic-bezier\(0\.22, 0\.9, 0\.3, 1\) both;/],
    ["선", /\.landing-hero__flow\.wa-line \{[\s\S]*?animation: wa-line 0\.5s ease-out 0\.66s both;/],
    ["앨범", /\.landing-hero__book\.wa-rise \{\s*\n\s*animation: wa-rise 0\.66s cubic-bezier\(0\.22, 0\.9, 0\.3, 1\) 0\.92s both;/],
    ["말풍선", /\.landing-hero__notes \.wa-pop \{\s*\n\s*animation: wa-pop 0\.44s cubic-bezier\(0\.22, 0\.9, 0\.3, 1\) both;/],
    ["캡션", /\.landing-hero__caption\.wa-fade \{\s*\n\s*animation: wa-fade 0\.5s ease-out 1\.92s both;/],
  ];
  for (const [what, rule] of cases) assert.match(motion, rule, `${what} 의 모션이 다르다`);
  // 사진 셋과 말풍선 둘의 지연.
  for (const delay of ["0.06s", "0.2s", "0.34s", "1.42s", "1.66s"]) {
    assert.match(motion, new RegExp(`animation-delay: ${delay.replace(".", "\\.")};`), `지연 ${delay} 가 없다`);
  }
  // `both` 가 빠지면 지연 동안 먼저 보였다가 튄다.
  assert.equal((motion.match(/animation: wa-[a-z]+ [^;]*both;/g) || []).length, 5, "both 가 빠진 자리가 있다");
});

test("★ 모션이 사진의 기울기를 지우지 않는다 (①)", () => {
  // 모션은 **바깥 칸**에 건다. 프레임에 걸면 끝값 transform:none 이 rotate 를 지운다.
  assert.match(landing, /className="landing-hero__shot wa-drop"/);
  assert.equal(/landing-hero__frame[^"]*wa-/.test(landing), false, "프레임에 모션이 걸렸다");
  assert.equal(motion.includes(".landing-hero__frame"), false, "모션 CSS 가 프레임을 건드린다");
  // 기울기 셋은 그대로 살아 있다.
  const app = read("App.css");
  for (const deg of ["-3.5deg", "1.5deg", "4deg"]) {
    assert.match(app, new RegExp(`\\.landing-hero__frame \\{ transform: rotate\\(${deg.replace(".", "\\.")}\\); \\}`), `기울기 ${deg} 가 사라졌다`);
  }
  // 앨범도 같다 — 감싼 요소가 떠오르고, 겹친 카드의 rotate 는 그대로다.
  assert.match(landing, /className="landing-hero__book wa-rise"/);
  assert.equal(motion.includes(".landing-hero__book-back"), false, "겹친 카드에 모션이 걸렸다");
  assert.match(app, /transform: rotate\(-1\.4deg\)/);
});

test("★ 그려서 잰다 — 칸에 모션 클래스가 붙고 프레임에는 안 붙는다", async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Landing } = await import("../src/components/Landing");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Landing as never, {} as never)); });

  assert.equal(container.querySelectorAll(".landing-hero__shot.wa-drop").length, 3);
  assert.equal(container.querySelectorAll(".landing-hero__frame[class*='wa-']").length, 0, "프레임에 모션이 붙었다");
  assert.equal(container.querySelectorAll(".landing-hero__flow.wa-line").length, 1);
  assert.equal(container.querySelectorAll(".landing-hero__book.wa-rise").length, 1);
  assert.equal(container.querySelectorAll(".landing-hero__notes .wa-pop").length, 2);
  assert.equal(container.querySelectorAll(".landing-hero__caption.wa-fade").length, 1);
  await React.act(async () => { root.unmount(); });
});

test("★ 움직임을 줄여 달라고 하면 아무것도 움직이지 않는다 (②)", () => {
  const block = motion.slice(motion.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /\.landing-hero \[class\*="wa-"\]/);
  // 파일 순서로 이기지 않는다 — 무게로 이긴다(§11).
  for (const property of ["animation: none !important", "opacity: 1 !important", "transform: none !important"]) {
    assert.match(block, new RegExp(property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${property} 가 없다`);
  }
});

test("★ 인쇄 렌더에는 애니메이션이 안 딸려 간다 (③)", () => {
  // 1) keyframes 는 이 파일에만 있다. 다른 CSS 어디에도 wa-* 가 없다.
  const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return entry.endsWith(".css") ? [full] : [];
  });
  for (const file of cssFiles(SRC)) {
    if (file.endsWith(`components${path.sep}Landing.css`)) continue;
    const css = readFileSync(file, "utf8");
    assert.equal(/@keyframes wa-|animation: wa-/.test(css), false, `${file} 로 모션이 샜다`);
  }
  // 2) 앨범 엔진은 이 파일을 싣지 않는다 — 인쇄는 엔진이 그린다.
  const renderer = read("album-engine/AlbumRenderer.tsx");
  assert.equal(renderer.includes("Landing.css"), false, "엔진이 히어로 모션 CSS 를 싣는다");
  // 3) 부르는 곳은 첫 화면 하나다.
  assert.match(landing, /import "\.\/Landing\.css";/);
});

test("★ 인라인 style 로 걸지 않는다 · 총 길이가 짧다", () => {
  assert.equal(/style=\{\{[^}]*animation/.test(landing), false, "인라인 style 로 모션을 걸었다");
  // 마지막 것이 끝나는 시각 = 1.92s + 0.5s. 만들러 온 사람을 오래 붙잡지 않는다.
  const last = 1.92 + 0.5;
  assert.ok(last <= 2.45, `모션이 너무 길다: ${last}s`);
});

test("★ 접었다 펴면 다시 돈다 — 여닫는 동작은 그대로다", () => {
  // 히어로 안쪽이 조건부로 그려진다 → 다시 열면 새로 마운트되어 모션이 다시 돈다.
  assert.match(landing, /\{open \? \(/);
  assert.match(landing, /localStorage\.getItem\(HERO_KEY\) !== "closed"/);
});
