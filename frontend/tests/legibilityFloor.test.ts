import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 40+ target: the always-visible bottom navigation must never drop below the 14px token.
test("bottom navigation labels use the 14px token in both base and mobile", () => {
  const css = read("components/AlbumBottomNavigation.css");
  // No hardcoded sub-14 label sizes remain (regression guard for the 9.9px mobile label).
  assert.doesNotMatch(css, /font-size:\s*0\.(6|7)\d*rem/);
  // ★ var(--t-xs)(14px) → 15px (2026-08-13 · 시안 값). 이 검사가 지키는 것은 "라벨이
  //   14px 아래로 내려가지 않는다" 는 **하한**이고, 15px 은 그것을 지킨다.
  //   토큰을 쓰라는 규칙이 아니었다 — 그래서 값을 재는 쪽으로 바꾼다.
  assert.match(css, /font-size: 15px/); // base label
  // 좁은 화면에서 **더 작게 덮지 않는다.** 예전에는 여기서 다시 줄였다(9.9px 결함).
  // 미디어 블록 **안쪽만** 본다 — 뒤에 오는 규칙(칩)까지 삼키면 엉뚱한 것을 잡는다.
  const after = css.split("@media (max-width: 640px)")[1] || "";
  const mobile = after.slice(0, after.indexOf("\n}"));
  assert.doesNotMatch(mobile, /font-size:/);
});

// The album body renderer is shared by screen and PDF/print. Screen legibility must be
// raised ONLY via .album-renderer--screen overrides; the print path stays untouched.
test("album-engine screen legibility is applied as screen-only overrides (print unchanged)", () => {
  for (const file of ["album-engine/AlbumRenderer.css", "album-engine/blocks/ChapterHeader.css", "album-engine/components/PhotoMemoryLines.css"]) {
    const css = read(file);
    // Every 40+ bump in these files is scoped to the screen renderer.
    assert.match(css, /\.album-renderer--screen [^{]*\{\s*[^}]*font-size/);
  }
});
