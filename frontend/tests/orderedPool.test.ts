import assert from "node:assert/strict";
import test from "node:test";

import { runOrderedPool } from "../src/lib/orderedPool";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("delivers results in INPUT order even when workers finish out of order", async () => {
  // Item 0 is the slowest to finish; with concurrency 2 it still must be delivered first.
  const delays = [30, 5, 20, 1];
  const deliveredIndexes: number[] = [];
  const deliveredValues: number[] = [];
  await runOrderedPool(
    [0, 1, 2, 3],
    2,
    async (item) => { await wait(delays[item]); return item * 10; },
    (result, index) => {
      assert.ok(result.ok);
      deliveredIndexes.push(index);
      if (result.ok) deliveredValues.push(result.value);
    },
  );
  assert.deepEqual(deliveredIndexes, [0, 1, 2, 3]);
  assert.deepEqual(deliveredValues, [0, 10, 20, 30]); // preserves selection order
});

test("a failing item is delivered as a failure and does NOT block the rest", async () => {
  const seen: Array<{ index: number; ok: boolean }> = [];
  await runOrderedPool(
    [0, 1, 2],
    2,
    async (item) => { if (item === 1) throw new Error("boom"); return item; },
    (result, index) => seen.push({ index, ok: result.ok }),
  );
  assert.deepEqual(seen.map((s) => s.index), [0, 1, 2]);      // all delivered, in order
  assert.deepEqual(seen.map((s) => s.ok), [true, false, true]); // the middle one failed
});

test("respects the concurrency limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await runOrderedPool(
    [0, 1, 2, 3, 4, 5],
    2,
    async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await wait(5);
      inFlight -= 1;
    },
    () => {},
  );
  assert.ok(maxInFlight <= 2, `never more than 2 in flight, saw ${maxInFlight}`);
});
