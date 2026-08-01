import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../src/components/CollaborationPanel.tsx", import.meta.url), "utf8");

test("visitor count shows only to owners and only when above zero (§10)", () => {
  // canManage (owner) AND visitor_count > 0.
  assert.match(panel, /canManage && \(status\.visitor_count \?\? 0\) > 0 \?/);
});

test("visitor count copy is warm — not a technical '조회수'", () => {
  assert.match(panel, /다녀갔어요/);
  assert.doesNotMatch(panel, /조회수/);
});

test("visitor count is not rendered inside the album/PDF renderer", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /다녀갔|visitor_count|collab-panel__visitors/i);
});
