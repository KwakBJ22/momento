import assert from "node:assert/strict";
import test from "node:test";

import { pdfDownloadFilename } from "../src/lib/pdfFilename";

const DATE = new Date(2026, 7, 5); // 2026-08-05 (month is 0-based)

test("korean title becomes 제목_YYYY-MM-DD.pdf", () => {
  assert.equal(pdfDownloadFilename("8년전 우리들", DATE), "8년전 우리들_2026-08-05.pdf");
});

test("filesystem-forbidden characters are replaced, not leaked", () => {
  assert.equal(
    pdfDownloadFilename('가족:여행/2026 "여름"?', DATE),
    "가족 여행 2026 여름_2026-08-05.pdf",
  );
  const name = pdfDownloadFilename('a\\b/c:d*e?f"g<h>i|j', DATE);
  for (const forbidden of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
    assert.equal(name.includes(forbidden), false, `must not contain ${forbidden}`);
  }
});

test("empty or whitespace-only titles fall back to 우리의 추억", () => {
  assert.equal(pdfDownloadFilename("", DATE), "우리의 추억_2026-08-05.pdf");
  assert.equal(pdfDownloadFilename("   ", DATE), "우리의 추억_2026-08-05.pdf");
  assert.equal(pdfDownloadFilename(null, DATE), "우리의 추억_2026-08-05.pdf");
  // A title that is ONLY forbidden characters also falls back.
  assert.equal(pdfDownloadFilename("///***", DATE), "우리의 추억_2026-08-05.pdf");
});

test("long titles are cut at 50 chars with no visible truncation marker", () => {
  const name = pdfDownloadFilename("가".repeat(80), DATE);
  assert.equal(name, `${"가".repeat(50)}_2026-08-05.pdf`);
  assert.equal(name.includes("…"), false);
  // The cut never leaves a trailing space before the date suffix.
  const spaced = pdfDownloadFilename(`${"가".repeat(49)} 나머지`, DATE);
  assert.equal(spaced, `${"가".repeat(49)}_2026-08-05.pdf`);
});
