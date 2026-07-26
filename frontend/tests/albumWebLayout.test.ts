import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/album-engine/blocks/Grid6Block.css", import.meta.url),
  "utf8",
);
const photoBlockCss = readFileSync(
  new URL("../src/album-engine/components/PhotoWithMemories.css", import.meta.url),
  "utf8",
);

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("web album grid uses the album body width instead of thumbnail dimensions", () => {
  assert.match(
    rule(".album-renderer--screen .grid6-block"),
    /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    rule(".album-renderer--screen .grid6-block__frame .album-photo-frame__img"),
    /width:\s*100%/,
  );
  assert.doesNotMatch(
    rule(".album-renderer--screen .grid6-block__cell"),
    /(?:max-height|aspect-ratio)/,
  );
  assert.match(
    photoBlockCss.match(/\.photo-block\s*\{([^}]*)\}/)?.[1] ?? "",
    /flex-direction:\s*column/,
  );
});

test("PDF grid sizing remains isolated from the web album renderer", () => {
  assert.match(
    rule(".album-renderer--print .grid6-block"),
    /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    rule(".album-renderer--print .grid6-block__cell"),
    /max-height:\s*58mm/,
  );
});
