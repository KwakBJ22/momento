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

test("onSettled fires per completion (not per in-order flush) so a slow first item does not batch the counter", async () => {
  // Item 0 is by far the slowest. onReady flushes in input order (0 last), but the
  // progress counter (onSettled) must tick as 1,2,3 finish — not jump 0→4 at the end.
  const delays = [40, 5, 8, 12];
  const settledAt: number[] = [];
  let counter = 0;
  const counterAtSettle: number[] = [];
  await runOrderedPool(
    [0, 1, 2, 3],
    2,
    async (item) => { await wait(delays[item]); return item; },
    () => {},
    (index) => { settledAt.push(index); counter += 1; counterAtSettle.push(counter); },
  );
  // Settled in completion order (fast items before the slow index 0), and the counter
  // increased one-by-one to the total.
  assert.equal(settledAt.length, 4);
  assert.notEqual(settledAt[settledAt.length - 1], undefined);
  assert.ok(settledAt.indexOf(0) > 0, `slow item 0 settled after faster ones, order: ${settledAt}`);
  assert.deepEqual(counterAtSettle, [1, 2, 3, 4]); // smooth increments, no chunk jump
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
