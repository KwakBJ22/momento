import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runOrderedPool } from "../src/lib/orderedPool";
import { preparingLabel } from "../src/lib/uploadFormView";
import { PAINT_WAIT_LIMIT_MS, yieldToPaint } from "../src/lib/yieldToPaint";

/**
 * 🔴 진행 숫자가 `0장`에 멈춰 선다 (F-3 · SCREEN_SPEC §11 — 조용히 멈추지 않는다).
 *
 * 사진 한 장이 끝날 때마다 숫자를 올리는 것은 이미 그렇게 하고 있었다(orderedPool
 * 의 onSettled). 실측해 보니 숫자가 멈추는 진짜 이유는 세는 방식이 아니라
 * **준비 작업 자체가 멈추는 것**이었다.
 *
 *   사진 준비는 한 장마다 `requestAnimationFrame` 을 기다렸다. rAF 는 브라우저가
 *   화면을 그릴 때만 온다. 페이지가 숨겨지면(다른 앱을 보다가 온다 · 화면이 꺼진다)
 *   프레임이 **한 번도 오지 않고**, 준비는 그 자리에 선다.
 *   실측: `visibilityState: "hidden"` 에서 1.5초 안에 rAF 0회, 준비된 사진 0장,
 *   `12장 중 0장` 그대로.
 *
 * ★ 가짜 진행률을 만들지 않는다. 시간으로 숫자를 밀어 올리지 않는다.
 * ★ 문구를 늘리지 않는다. `사진을 준비하고 있어요 · N장 중 N장` 한 줄 그대로다.
 */

const source = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");

// --- 멈추지 않는다 ---

test("★ 프레임이 오지 않아도(화면이 숨겨져도) 준비가 계속된다", async () => {
  const started = Date.now();
  // 숨겨진 페이지: rAF 를 등록해도 콜백이 영영 오지 않는다.
  await yieldToPaint({ requestFrame: () => undefined, timeoutMs: 20 });
  assert.ok(Date.now() - started >= 15, "시간 제한만큼은 기다렸다(프레임을 먼저 기다려 본다)");
});

test("화면이 보이면 프레임이 오는 즉시 진행한다 (기다림을 늘리지 않는다)", async () => {
  let timedOut = false;
  const started = Date.now();
  await yieldToPaint({
    requestFrame: (callback) => setTimeout(callback, 1),
    timeoutMs: 400,
  });
  timedOut = Date.now() - started >= 400;
  assert.equal(timedOut, false, "프레임이 왔는데도 시간 제한까지 기다리면 준비가 느려진다");
});

test("한 프레임보다는 넉넉히 기다린다 (보이는 화면에서 rAF 를 앞지르지 않는다)", () => {
  // 60fps 한 프레임이 약 16ms 다. 시간 제한이 그보다 짧으면 보이는 화면에서도
  // 매번 시간 제한이 먼저 이겨, 카운터가 화면에 닿기 전에 다음 사진이 시작된다.
  assert.ok(PAINT_WAIT_LIMIT_MS > 16, `${PAINT_WAIT_LIMIT_MS}ms — 한 프레임보다 짧다`);
});

test("한 번만 풀린다 (프레임과 시간 제한이 둘 다 와도)", async () => {
  let resolved = 0;
  const frames: Array<() => void> = [];
  const promise = yieldToPaint({ requestFrame: (callback) => frames.push(callback), timeoutMs: 5 })
    .then(() => { resolved += 1; });
  await promise;
  frames.forEach((frame) => frame()); // 늦게 도착한 프레임
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resolved, 1);
});

// --- 한 장이 끝날 때마다 숫자가 오른다 ---

test("★ 사진 한 장이 끝날 때마다 숫자가 오른다 (단계 전체를 기다리지 않는다)", async () => {
  // 준비 파이프라인과 같은 모양으로 돌린다: 동시 2장, 한 장이 끝날 때마다 카운터.
  const counts: number[] = [];
  let done = 0;
  const photos = [0, 1, 2, 3, 4, 5];
  await runOrderedPool(
    photos,
    2,
    async (photo) => {
      // 한 장 안에서도 프레임을 기다린다 — 숨겨진 화면을 흉내 낸다(프레임이 안 온다).
      await new Promise((resolve) => setTimeout(resolve, 1));
      await yieldToPaint({ requestFrame: () => undefined, timeoutMs: 2 });
      return photo;
    },
    () => undefined,
    () => { done += 1; counts.push(done); },
  );
  // 0 → 6 으로 뛰지 않고 하나씩 오른다. 프레임이 없어도 끝까지 간다.
  assert.deepEqual(counts, [1, 2, 3, 4, 5, 6]);
});

// --- 화면이 그 규칙을 쓴다 ---

test("준비 화면이 공용 yieldToPaint 를 쓴다 (자기 나름의 rAF 를 다시 만들지 않는다)", () => {
  assert.match(source, /import \{ yieldToPaint \} from "\.\.\/lib\/yieldToPaint";/);
  assert.match(source, /await yieldToPaint\(\);/);
  // 컴포넌트 안에 rAF 를 직접 기다리는 코드가 다시 생기면 같은 결함이 돌아온다.
  assert.equal(source.includes("requestAnimationFrame"), false);
  // 숫자는 한 장이 끝날 때 올린다(단계 전체가 아니라).
  assert.match(source, /setPreparingProgress\(\{ done: settledCount, total: limited\.length \}\);/);
});

test("★ 가짜 진행률·단계 문구를 넣지 않는다", () => {
  // 숫자는 오직 실제로 끝난 장수다 — 시간으로 밀어 올리지 않는다.
  const counter = source.slice(source.indexOf("settledCount += 1"), source.indexOf("if (duplicates > 0)"));
  for (const forbidden of ["setInterval", "setTimeout", "Date.now"]) {
    assert.equal(counter.includes(forbidden), false, `카운터를 시간으로 움직인다: ${forbidden}`);
  }
  // 문구는 한 줄 그대로다. J-1b 뒤로 그 한 줄은 `preparingLabel` 이 만든다 —
  // 소스 글자가 아니라 **그 함수가 내놓는 값**을 본다.
  assert.match(source, /\{preparingLabel\(preparingProgress\)\}/);
  assert.equal(preparingLabel({ done: 4, total: 30 }), "사진을 준비하고 있어요 · 30장 중 4장");
  for (const forbidden of ["크기를 줄이고", "불러오는 중", "단계"]) {
    assert.equal(source.includes(forbidden), false, `단계 문구가 늘었다: ${forbidden}`);
  }
});
