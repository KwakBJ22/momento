import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 40+ target: the always-visible bottom navigation must never drop below the 14px token.
test("bottom navigation labels use the 14px token in both base and mobile", () => {
  const css = read("components/AlbumBottomNavigation.css");
  // No hardcoded sub-14 label sizes remain (regression guard for the 9.9px mobile label).
  assert.doesNotMatch(css, /font-size:\s*0\.(6|7)\d*rem/);
  assert.match(css, /font-size: var\(--t-xs\)/); // base label
  // The mobile media block also uses the token, not a smaller rem.
  const mobile = css.split("@media (max-width: 640px)")[1] || "";
  assert.match(mobile, /font-size: var\(--t-xs\)/);
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
