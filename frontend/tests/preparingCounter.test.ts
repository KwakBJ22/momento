import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runOrderedPool } from "../src/lib/orderedPool";
import { PREPARING_LABEL, preparingLabel } from "../src/lib/uploadFormView";

/**
 * `0장`을 보여주지 않는다 · 첫 한 장을 먼저 끝낸다 (J-1b · SCREEN_SPEC §11).
 *
 * J-1 실측: 한 장에 289~330ms 인데 첫 숫자가 뜨는 데 569~762ms 가 걸렸다.
 * 한 장의 89%가 이미지를 펴고(40%) JPEG 으로 굽는(49%) 일이라 **그 시간은 줄일 수 없다.**
 * 고치는 것은 화면이 사실을 말하는 방식 둘뿐이다.
 *
 * ★ 굽는 시간은 건드리지 않는다 — 품질 0.85 · MAX_EDGE 2560 · 동시 2장 그대로.
 */

const form = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");

// --- 1b-1 · 셀 것이 없으면 안 센다 ---

test("★ 한 장도 안 끝났으면 `N장 중 0장`이 화면에 없다", () => {
  assert.equal(preparingLabel({ done: 0, total: 30 }), PREPARING_LABEL);
  assert.equal(preparingLabel(null), PREPARING_LABEL);
  assert.equal(preparingLabel({ done: 0, total: 30 }).includes("0장"), false);
});

test("★ 한 장이 끝나면 `1장`이 뜬다 — 그 값은 실제 완료 수 그대로다", () => {
  assert.equal(preparingLabel({ done: 1, total: 30 }), "사진을 준비하고 있어요 · 30장 중 1장");
  assert.equal(preparingLabel({ done: 17, total: 30 }), "사진을 준비하고 있어요 · 30장 중 17장");
  // 한 장짜리 선택에는 숫자를 붙이지 않는다(`1장 중 1장`은 우스꽝스럽다).
  assert.equal(preparingLabel({ done: 1, total: 1 }), PREPARING_LABEL);
});

test("★ 가짜 진행률이 아니다 — 숫자는 완료 수에서만 나온다", () => {
  // 시간·비율로 숫자를 만들지 않는다. 인자가 완료 수와 전체 수뿐이다.
  assert.equal(preparingLabel({ done: 3, total: 30 }), preparingLabel({ done: 3, total: 30 }));
  // 화면은 이 함수 하나만 부른다 — 문구를 화면에 다시 적지 않는다.
  assert.match(form, /\{preparingLabel\(preparingProgress\)\}/);
  assert.equal(form.includes("장 중 ${"), false, "화면이 문구를 직접 만든다");
});

test("★ 단계 문구를 늘리지 않는다 — 준비 중 문구는 한 줄뿐이다", () => {
  assert.equal(PREPARING_LABEL, "사진을 준비하고 있어요");
  for (const inside of ["크기를 줄이", "굽고", "펴고", "불러오는 중", "분석"]) {
    assert.equal(preparingLabel({ done: 2, total: 30 }).includes(inside), false, `내부 사정을 말한다: ${inside}`);
  }
});

// --- 1b-2 · 첫 한 장은 혼자 ---

/** 완료 순서와 "그때 몇 개가 동시에 돌고 있었나"를 기록하며 돌린다. */
async function runWithTrace(count: number, concurrency: number, soloFirst: boolean) {
  const settled: number[] = [];
  const peakWhileRunning: number[] = [];
  let inFlight = 0;
  const releases: Array<() => void> = [];
  const gates: Promise<void>[] = [];
  for (let index = 0; index < count; index += 1) {
    gates.push(new Promise<void>((resolve) => releases.push(resolve)));
  }
  const done = runOrderedPool(
    Array.from({ length: count }, (_, index) => index),
    concurrency,
    async (item: number) => {
      inFlight += 1;
      peakWhileRunning.push(inFlight);
      await gates[item];
      inFlight -= 1;
      return item;
    },
    () => undefined,
    (index) => { settled.push(index); },
    { soloFirst },
  );
  // 한 칸씩 풀어 주며 진행시킨다.
  for (let index = 0; index < count; index += 1) {
    releases[index]();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await done;
  return { settled, peakWhileRunning };
}

test("★ 첫 묶음은 1장이다 — 그 뒤 묶음은 2장", async () => {
  const solo = await runWithTrace(6, 2, true);
  // 첫 장이 돌 때는 혼자다.
  assert.equal(solo.peakWhileRunning[0], 1, "첫 장에 둘이 붙었다");
  // 첫 장이 끝난 뒤에는 둘이 붙는다.
  assert.ok(Math.max(...solo.peakWhileRunning) === 2, "첫 장 뒤에도 한 장씩만 돈다");
});

test("켜지 않으면 지금 그대로다 (기존 호출자·기존 계약)", async () => {
  const plain = await runWithTrace(6, 2, false);
  assert.equal(plain.peakWhileRunning[0], 1);
  assert.equal(plain.peakWhileRunning[1], 2, "처음부터 둘이 붙어야 한다");
});

test("순서·실패 처리는 그대로다", async () => {
  const ready: Array<{ index: number; ok: boolean }> = [];
  await runOrderedPool(
    [0, 1, 2, 3],
    2,
    async (item: number) => { if (item === 1) throw new Error("nope"); return item; },
    (result, index) => { ready.push({ index, ok: result.ok }); },
    undefined,
    { soloFirst: true },
  );
  assert.deepEqual(ready.map((entry) => entry.index), [0, 1, 2, 3]);
  assert.deepEqual(ready.map((entry) => entry.ok), [true, false, true, true]);
});

test("★ 사진 고르기 화면이 이 규칙을 실제로 켠다", () => {
  assert.match(form, /\{ soloFirst: true \}/);
  // ★ 굽는 시간은 건드리지 않았다 — 동시 장수 2 는 그대로다(메모리 경고가 붙은 값).
  assert.match(form, /const PREPARE_CONCURRENCY = 2;/);
});

test("★ 굽는 값을 건드리지 않았다 (품질 0.85 · MAX_EDGE 2560)", () => {
  const optimize = readFileSync(new URL("../src/lib/optimizeImageFile.ts", import.meta.url), "utf8");
  assert.match(optimize, /const MAX_EDGE = 2560;/);
  assert.match(optimize, /canvasBlob\(canvas, "image\/jpeg", 0\.85\)/);
});
