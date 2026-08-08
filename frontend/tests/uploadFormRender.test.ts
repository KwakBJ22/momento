import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  pickButtonLabel, showsEmptyState, showsSelectionCount, showsSubmitButton,
  PICK_LABEL_EMPTY, PICK_LABEL_MORE,
} from "../src/lib/uploadFormView";

// Real branch behaviour (the functions UploadForm actually calls to render), not
// a regex of the JSX. This is the class of change — render varies by photo count
// — that source-only tests miss, so it is exercised directly.

test("at 0 photos: no submit button, empty state shown, count hidden", () => {
  assert.equal(showsSubmitButton(0), false);
  assert.equal(showsEmptyState(0), true);
  assert.equal(showsSelectionCount(0), false);
  assert.equal(pickButtonLabel(0), PICK_LABEL_EMPTY);
});

test("at 1+ photos: submit button appears, empty state hidden, pick label switches", () => {
  for (const n of [1, 5, 30]) {
    assert.equal(showsSubmitButton(n), true, `submit at ${n}`);
    assert.equal(showsEmptyState(n), false, `no empty state at ${n}`);
    assert.equal(showsSelectionCount(n), true, `count shown at ${n}`);
    assert.equal(pickButtonLabel(n), PICK_LABEL_MORE, `label at ${n}`);
  }
});

// Bind the pure decisions to the JSX so the branch logic can't silently diverge
// from what renders, and guard the two behaviours that must be preserved.
const source = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");

test("UploadForm gates its render on the tested branch functions", () => {
  assert.match(source, /showsSubmitButton\(photos\.length\) \?/);
  // 준비 중에는 빈 상태 안내를 감춘다(F-2) — 판정 함수가 그 사정을 함께 받는다.
  assert.match(source, /showsEmptyState\(photos\.length, isPreparing\) \?/);
  assert.match(source, /showsSelectionCount\(photos\.length\)/);
  assert.match(source, /pickButtonLabel\(photos\.length\)/);
});

test("selection count and prepare progress never render at the same time", () => {
  // The duplicate-count bug: both the selection count and the prepare progress showed
  // "30장 중 4장". The selection count must be suppressed while preparing.
  assert.match(source, /showsSelectionCount\(photos\.length\) && !isPreparing \?/);
  // The prepare block renders only while preparing — the two conditions are exclusive.
  assert.match(source, /\{isPreparing \? \(/);
});

test("the camera input keeps its capture attribute (behaviour must not change)", () => {
  assert.match(source, /accept="image\/\*" capture="environment"/);
});

test("prepare progress is a direct child of .upload-form (sticky parent-box contract), before the photo list", () => {
  // A sticky element only stays pinned while its PARENT box is on screen. The photo list
  // is a sibling of the picker <section>, so the prepare block must live OUTSIDE that
  // section — directly under .upload-form — and before <PhotoCommentList>.
  const pickerOpen = source.indexOf("upload-form__picker");
  const pickerClose = source.indexOf("</section>", pickerOpen);
  const listIdx = source.indexOf("<PhotoCommentList");
  const prepIdx = source.indexOf("upload-form__preparing");
  assert.ok(pickerOpen >= 0 && pickerClose >= 0 && listIdx >= 0 && prepIdx >= 0);
  assert.ok(prepIdx > pickerClose, "prepare block must be AFTER the picker section closes (not inside it)");
  assert.ok(prepIdx < listIdx, "prepare block must come before the photo list");
  assert.match(source.slice(pickerClose, listIdx), /isPreparing \?/); // unmounts when preparation ends
});

test("prepare bar reuses the shared easing and shows a bar alongside the exact count", () => {
  assert.match(source, /easeTowardTarget/); // no duplicate easing implementation
  assert.match(source, /upload-form__preparing-bar/);
  assert.match(source, /장 중 \$\{preparingProgress\.done\}장/); // exact count text kept
});

// F-2 — 사진을 고른 뒤 준비하는 동안에도 빈 상태 안내가 남아, "사진을 준비하고 있어요"
// 옆에 "고른 사진이 여기에 모여요" 두 줄이 그대로 서 있었다. 목록 자리만 잡고 내용이
// 없는 것으로 보인다. 준비 중에는 진행 표시가 그 자리를 대신한다.
test("준비하는 동안에는 빈 상태 안내를 보여주지 않는다", () => {
  // 고르기 전에는 그대로 보인다.
  assert.equal(showsEmptyState(0), true);
  assert.equal(showsEmptyState(0, false), true);
  // 고른 직후(아직 0장 준비됨)에는 진행 표시만 남는다.
  assert.equal(showsEmptyState(0, true), false);
  // 사진이 들어온 뒤에는 어느 쪽이든 없다.
  assert.equal(showsEmptyState(3, true), false);
  assert.equal(showsEmptyState(3, false), false);
});

test("화면이 그 판정을 그대로 쓴다", () => {
  const source = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
  assert.match(source, /\{showsEmptyState\(photos\.length, isPreparing\) \? \(/);
});
