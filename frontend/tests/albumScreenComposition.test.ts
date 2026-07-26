import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name: string) => readFileSync(
  new URL(`../src/components/${name}.tsx`, import.meta.url),
  "utf8",
);

test("all user album views delegate screen composition to AlbumScreen", () => {
  for (const name of ["AlbumResult", "AlbumView", "PublicShareView"]) {
    const view = source(name);
    assert.match(view, /import AlbumScreen from "\.\/AlbumScreen"/);
    assert.match(view, /<AlbumScreen\b/);
  }
});

test("AlbumScreen is the only shared shell that composes header, actions and navigation", () => {
  const screen = source("AlbumScreen");
  assert.match(screen, /<AlbumScreenHeader\b/);
  assert.match(screen, /<AlbumActionPanel>/);
  assert.match(screen, /<AlbumBottomNavigation\s+\{\.\.\.bottomNavigation\}/);
});
