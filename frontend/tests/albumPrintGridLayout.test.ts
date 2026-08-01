import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectLayout } from "../src/album-engine/engine/layoutSelector";
import type { EnginePhoto } from "../src/album-engine/types";

function enginePhoto(id: string, width: number, height: number, sortOrder: number): EnginePhoto {
  return {
    id,
    src: `https://assets.example/${id}.jpg`,
    width,
    height,
    orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
    sortOrder,
    takenAt: `2026-01-0${sortOrder}T00:00:00Z`,
  };
}

test("a single-photo chapter yields one Grid6 block holding just that photo (no phantom slots)", () => {
  const layout = selectLayout([enginePhoto("only", 1440, 2560, 1)]);
  assert.equal(layout.blocks.length, 1);
  assert.equal(layout.blocks[0].kind, "Grid6");
  assert.equal(layout.blocks[0].photos.length, 1);
});

test("Grid6Block tags the grid with a photo-count modifier so print can pick the column count", () => {
  const source = readFileSync(
    new URL("../src/album-engine/blocks/Grid6Block.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /grid6-block--n\$\{items\.length\}/);
});

test("print grid does not force a square aspect-ratio on photo cells (html2canvas ignores object-fit)", () => {
  const css = readFileSync(
    new URL("../src/album-engine/blocks/Grid6Block.css", import.meta.url),
    "utf8",
  );
  const printCell = css.match(/\.album-renderer--print \.grid6-block__cell\s*\{[^}]*\}/);
  assert.ok(printCell, "expected a print-scoped .grid6-block__cell rule");
  assert.doesNotMatch(printCell![0], /aspect-ratio/);
  assert.doesNotMatch(printCell![0], /overflow:\s*hidden/);
});

test("print grid sizes a single photo to one full-width column instead of a 3-column slot", () => {
  const css = readFileSync(
    new URL("../src/album-engine/blocks/Grid6Block.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.album-renderer--print \.grid6-block--n1\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});

test("print photo image keeps its natural ratio (width:100%; height:auto) so object-fit is a no-op", () => {
  const css = readFileSync(
    new URL("../src/album-engine/blocks/Grid6Block.css", import.meta.url),
    "utf8",
  );
  const printImg = css.match(
    /\.album-renderer--print \.grid6-block__frame \.album-photo-frame__img\s*\{[^}]*\}/,
  );
  assert.ok(printImg, "expected a print-scoped grid image rule");
  assert.match(printImg![0], /width:\s*100%/);
  assert.match(printImg![0], /height:\s*auto/);
});
