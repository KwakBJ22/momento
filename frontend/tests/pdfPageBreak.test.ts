import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRINT_LAYOUT_VERSION, PRINT_PAGE_ASPECT, PRINT_PAGE_MM } from "../src/lib/pdfPageBreak";

/**
 * ★ 2026-08-22 — 쪽 나눔 계산(`printPageStraddleGap`)은 html2canvas 로 굽던 시절의 것이라
 *   지웠다. 서버가 쪽을 하나씩 그리므로(album_pdf_service) 걸치는 블록이 없다.
 *   이 파일에 남은 것은 **화면 CSS · 프런트 · 서버가 같은 판형을 쓰는가** 다.
 */

const back = (p: string) => readFileSync(new URL(`../../backend/app/${p}`, import.meta.url), "utf8");

test("지면은 정사각 206mm — 셋(CSS 토큰 · 프런트 · 서버)이 같은 값이다", () => {
  assert.equal(PRINT_PAGE_ASPECT, 1);
  assert.equal(PRINT_PAGE_MM, 206);
  const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  assert.match(tokens, /--pr-trim:\s*200mm/);
  assert.match(tokens, /--pr-bleed:\s*3mm/);
  assert.match(tokens, /--pr-page:\s*calc\(var\(--pr-trim\) \+ var\(--pr-bleed\) \* 2\)/);
  const server = back("services/album_pdf_service.py");
  assert.match(server, /TRIM_MM = 200\.0/);
  assert.match(server, /BLEED_MM = 3\.0/);
  assert.match(server, /PAGE_MM = TRIM_MM \+ BLEED_MM \* 2\s+# 206/);
});

test("판형 판 3 은 서버가 그리는 첫 판이다 — 백엔드 SERVER_PDF_LAYOUT 과 같다", () => {
  assert.equal(PRINT_LAYOUT_VERSION, 3);
  assert.match(back("api/album.py"), /SERVER_PDF_LAYOUT = 3/);
});
