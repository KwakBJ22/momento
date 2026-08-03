import assert from "node:assert/strict";
import test from "node:test";

import { easeTowardTarget, estimateTotalMs, initialCreationProgress, nextCreationProgress } from "../src/lib/creationProgress";

const TOTAL = estimateTotalMs(30); // measured baseline ≈ 95s

test("starts at a small non-empty floor", () => {
  assert.equal(initialCreationProgress(), 3);
});

test("keeps advancing even while the server value is frozen for 60s (the core regression)", () => {
  let p = initialCreationProgress();
  // First 30s: server reports 50 and the bar catches up to it.
  for (let t = 0; t <= 30_000; t += 100) {
    p = nextCreationProgress({ display: p, elapsedMs: t, totalMs: TOTAL, serverProgress: 50, complete: false });
  }
  const at30 = p;
  // Next 60s: server STAYS at 50 (the story-generation gap). The bar must keep moving.
  for (let t = 30_100; t <= 90_000; t += 100) {
    p = nextCreationProgress({ display: p, elapsedMs: t, totalMs: TOTAL, serverProgress: 50, complete: false });
  }
  assert.ok(p > at30 + 5, `bar must climb while the server is frozen: ${at30} -> ${p}`);
  assert.ok(p < 100);
});

test("never goes backward when the server reports a lower value", () => {
  const p = nextCreationProgress({ display: 70, elapsedMs: 40_000, totalMs: TOTAL, serverProgress: 30, complete: false });
  assert.ok(p >= 70, `stayed monotonic, got ${p}`);
});

test("pulls up to a higher server value (prevents lag)", () => {
  const p = nextCreationProgress({ display: 20, elapsedMs: 5_000, totalMs: TOTAL, serverProgress: 80, complete: false });
  assert.ok(p >= 80, `should jump up to the server value, got ${p}`);
  assert.ok(p <= 99);
});

test("past the estimate it crawls very slowly and stays under 99", () => {
  const early = nextCreationProgress({ display: 95, elapsedMs: TOTAL + 10_000, totalMs: TOTAL, serverProgress: null, complete: false });
  assert.ok(early > 95 && early <= 99, `crawls above 95 slowly, got ${early}`);

  let q = 95;
  for (let t = TOTAL; t <= TOTAL + 600_000; t += 1000) {
    q = nextCreationProgress({ display: q, elapsedMs: t, totalMs: TOTAL, serverProgress: null, complete: false });
  }
  assert.ok(q > 95, `keeps inching forward, got ${q}`);
  assert.ok(q <= 99, `never reaches 100 before completion, got ${q}`);
});

test("fills to exactly 100 on completion and never exceeds it", () => {
  let p = 80;
  for (let i = 0; i < 500; i += 1) {
    p = nextCreationProgress({ display: p, elapsedMs: 100_000, totalMs: TOTAL, serverProgress: 100, complete: true });
  }
  assert.equal(p, 100);
  assert.equal(nextCreationProgress({ display: 100, elapsedMs: 0, totalMs: TOTAL, serverProgress: 100, complete: true }), 100);
});

test("works with an unknown photo count via the default estimate", () => {
  assert.equal(estimateTotalMs(undefined), estimateTotalMs(30));
  assert.equal(estimateTotalMs(null), estimateTotalMs(30));
  assert.equal(estimateTotalMs(0), estimateTotalMs(30));
  // Still advances on time with the default total.
  const total = estimateTotalMs(undefined);
  const a = nextCreationProgress({ display: 3, elapsedMs: 0, totalMs: total, serverProgress: null, complete: false });
  const b = nextCreationProgress({ display: a, elapsedMs: 30_000, totalMs: total, serverProgress: null, complete: false });
  assert.ok(b > a, `advances on time even without a server value: ${a} -> ${b}`);
});

test("estimate scales with photo count", () => {
  assert.ok(estimateTotalMs(30) > estimateTotalMs(10));
  assert.equal(estimateTotalMs(10), 20_000 + 2_500 * 10);
});

test("easeTowardTarget approaches the target monotonically and never overshoots", () => {
  let p = 0;
  for (let i = 0; i < 200; i += 1) p = easeTowardTarget(p, 40);
  assert.ok(Math.abs(p - 40) < 0.001, `settles exactly on the target, got ${p}`);
  // never backward when the target is lower than the current display
  assert.equal(easeTowardTarget(50, 30), 50);
});

test("easeTowardTarget: prepare bar climbs with a rising done/total and finishes at 100", () => {
  let p = 0;
  const snapshots: number[] = [];
  for (const target of [20, 40, 60, 80, 100]) {
    for (let i = 0; i < 60; i += 1) p = easeTowardTarget(p, target);
    snapshots.push(p);
  }
  for (let i = 1; i < snapshots.length; i += 1) {
    assert.ok(snapshots[i] >= snapshots[i - 1], `monotonic: ${snapshots}`);
  }
  assert.equal(p, 100);
  assert.ok(easeTowardTarget(100, 100) <= 100);
});
