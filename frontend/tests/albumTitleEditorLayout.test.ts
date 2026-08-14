import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/components/AlbumScreenHeader.css", import.meta.url),
  "utf8",
);
const tsx = readFileSync(
  new URL("../src/components/AlbumScreenHeader.tsx", import.meta.url),
  "utf8",
);

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("save/cancel buttons are content-sized and never grow to fill the row", () => {
  // Regression: `flex: 1 1 auto` made 저장/취소 grow to ~45% of the screen each,
  // making a one-title edit occupy a third of a mobile screen.
  const button = rule(".album-screen-header__editor button");
  assert.match(button, /flex:\s*0\s+0\s+auto/);
  assert.doesNotMatch(button, /flex:\s*1\s+1/); // must not grow
  assert.match(button, /min-height:\s*40px/); // touch target preserved
});

test("input grows and shrinks (small basis) so it shares one row with the buttons", () => {
  const input = rule(".album-screen-header__editor input");
  assert.match(input, /flex:\s*1\s+1\s+7rem/); // grow+shrink from a small basis → one compact row
  assert.match(input, /min-width:\s*0/);
});

test("header grid column is clamped so the edit row cannot overflow the card", () => {
  const header = rule(".album-screen-header");
  assert.match(header, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("edit input font is close to the title size, not a much smaller box", () => {
  // Regression: input was font-size 1.12rem vs the h1 clamp(1.8rem, .., 2.35rem),
  // so text shrank abruptly on entering edit mode.
  const input = rule(".album-screen-header__editor input");
  assert.match(input, /font-size:\s*clamp\(/);
});

test("title editor stays on screen (wrap + max-width) on narrow webviews", () => {
  const editor = rule(".album-screen-header__editor");
  assert.match(editor, /flex-wrap:\s*wrap/);
  assert.match(editor, /max-width:\s*100%/);
});

test("subtitle is hidden while editing so it does not push below the buttons", () => {
  assert.match(tsx, /subtitle && !editing/);
});

test("the edit pencil never shrinks when the title is long", () => {
  const edit = rule(".album-screen-header__edit");
  // ★ `flex: 0 0 32px` → `flex: 0 0 auto` (2026-08-14 · 연필 통일 4/4).
  //   버튼이 곧 32px 원이라 **누르는 영역도 32px** 이었다 — 손가락이 못 맞춘다.
  //   이제 누르는 영역은 44px 이고 보이는 원은 ::before 가 32px 로 그린다.
  //   이 검사가 지키는 규칙(제목이 길어도 연필이 줄지 않는다)은 그대로다:
  //   grow 0 · shrink 0 이고, 폭은 min-width 가 잡는다.
  assert.match(edit, /flex:\s*0\s+0\s+auto/);
  assert.match(edit, /min-width: var\(--tap-min\)/);
});
