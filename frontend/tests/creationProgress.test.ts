import assert from "node:assert/strict";
import test from "node:test";

import { initialCreationProgress, nextCreationProgress } from "../src/lib/creationProgress";

test("starts at the floor (20)", () => {
  assert.equal(initialCreationProgress(), 20);
});

test("eases up toward a higher server target and crawls a little past it", () => {
  let p = initialCreationProgress();
  for (let i = 0; i < 500; i += 1) p = nextCreationProgress(p, 40);
  assert.ok(p >= 40, `should reach the target 40, got ${p}`);
  assert.ok(p <= 46.001, `should not crawl far past target+margin(6), got ${p}`);
  assert.ok(p < 99);
});

test("is monotonic — never goes backward even if the server reports a lower value", () => {
  assert.ok(nextCreationProgress(60, 30) >= 60);
  assert.ok(nextCreationProgress(50, 50) >= 50);
  assert.ok(nextCreationProgress(20, 20) >= 20);
});

test("never looks frozen — at the target it still creeps forward", () => {
  assert.ok(nextCreationProgress(40, 40) > 40);
});

test("never reaches 100 until the server target itself is 100", () => {
  let p = initialCreationProgress();
  for (let i = 0; i < 10_000; i += 1) p = nextCreationProgress(p, 95);
  assert.ok(p <= 99, `ceiling is 99 before completion, got ${p}`);
  assert.ok(p < 100);
});

test("fills smoothly to exactly 100 on completion and stays there", () => {
  let p = 80;
  for (let i = 0; i < 500; i += 1) p = nextCreationProgress(p, 100);
  assert.equal(p, 100);
  assert.equal(nextCreationProgress(100, 100), 100);
});
