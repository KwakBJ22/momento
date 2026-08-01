import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/components/AlbumScreenHeader.css", import.meta.url),
  "utf8",
);

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("title editor input takes a full-width row so 저장/취소 never overflow off-screen", () => {
  // Regression: input was `flex: 1 1 220px`, which grew and pushed the save
  // button off-screen with cancel wrapping alone on a narrow (webview) width.
  const input = rule(".album-screen-header__editor input");
  assert.match(input, /flex:\s*1\s+1\s+100%/);
  assert.match(input, /min-width:\s*0/);
});

test("title editor container cannot exceed the viewport width", () => {
  const editor = rule(".album-screen-header__editor");
  assert.match(editor, /flex-wrap:\s*wrap/);
  assert.match(editor, /max-width:\s*100%/);
});
