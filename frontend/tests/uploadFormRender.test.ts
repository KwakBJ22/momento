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
  assert.match(source, /showsEmptyState\(photos\.length\) \?/);
  assert.match(source, /showsSelectionCount\(photos\.length\) \?/);
  assert.match(source, /pickButtonLabel\(photos\.length\)/);
});

test("the camera input keeps its capture attribute (behaviour must not change)", () => {
  assert.match(source, /accept="image\/\*" capture="environment"/);
});
