import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ALBUM_PHOTO_CAPACITY } from "../src/lib/albumLimits";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("앨범 총량은 100장이다 (백엔드·DB 와 같이 움직인다)", () => {
  assert.equal(ALBUM_PHOTO_CAPACITY, 100);
});

/**
 * ★ 2026-08-22 — `PDF_PHOTO_SAFE_LIMIT`(30장) 과 차단 문구 셋을 **지웠다.**
 *   그 상한은 html2canvas 가 앨범 전체를 캔버스 한 장에 굽던 시절의 한계였다. PDF 를
 *   서버가 한 쪽씩 그리는 지금은 장수로 막을 이유가 없다 — 앨범 총량이 곧 PDF 의 상한이다.
 *   예전 검사는 "세 화면이 30장에서 PDF 버튼을 막는가"를 잠갔다. 이제 지키는 것은 그 반대다:
 *   **어느 화면도 장수로 PDF 를 막지 않는다.** 되살리지 않는다.
 */
test("★ 어느 화면도 사진 장수로 PDF 를 막지 않는다 — 30장 가드는 지웠다", () => {
  const limits = read("lib/albumLimits.ts");
  assert.equal(limits.includes("export const PDF_PHOTO_SAFE_LIMIT"), false, "30장 상한이 되살아났다");
  assert.equal(limits.includes("PDF_BLOCKED_MESSAGE ="), false);
  assert.equal(limits.includes("PDF_DEVICE_BLOCKED_REASON ="), false);
  for (const name of ["components/AlbumView.tsx", "components/AlbumResult.tsx", "components/AlbumMoreSheet.tsx", "lib/exportPdf.tsx"]) {
    const source = read(name);
    assert.equal(source.includes("PDF_PHOTO_SAFE_LIMIT"), false, `${name} 이 장수로 PDF 를 막는다`);
    assert.equal(source.includes("PDF_BLOCKED"), false, `${name} 에 차단 문구가 남아 있다`);
  }
  // PDF 버튼은 만드는 동안만 잠긴다.
  assert.match(read("components/AlbumView.tsx"), /disabled=\{isExportingPdf \|\| !album\}>\{isExportingPdf \? "PDF 만드는 중\.\.\." : "PDF 저장"\}/);
  assert.match(read("components/AlbumResult.tsx"), /disabled=\{isExportingPdf\}>\{isExportingPdf \? "PDF 만드는 중\.\.\." : "PDF 저장"\}/);
});
