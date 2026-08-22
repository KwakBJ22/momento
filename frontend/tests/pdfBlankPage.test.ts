import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 🔴 PDF 마지막에 **완전히 빈 페이지**가 한 장 더 붙었다 (I-4-1 · §9).
 *
 * 원인은 html2pdf 의 반올림이었다 — 캔버스를 한 장 높이(내림)씩 잘라 쪽을 만들다 1px 이
 * 남으면 `ceil` 이 그 1px 을 위해 빈 쪽을 만들었다. 예전 검사는 그 계산을 그대로 흉내 내
 * `wholePagesCaptureHeightPx` 가 N 장에 딱 맞추는지 봤다.
 *
 * ★ 2026-08-22 — PDF 는 서버가 **쪽을 하나씩** 그린다(album_pdf_service). 캔버스를 자르는
 *   일이 없으니 빈 쪽이 생길 자리도 없다. 쪽 수는 backend/tests/test_album_pdf_service.py 가
 *   `표지 → 사진 쪽들 → 이야기 → 우리의 이야기 → 맺음` 으로 **정확히** 센다.
 *   여기서 지키는 것은 "굽는 길이 되살아나지 않았다" 하나다.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("★ 굽는 길이 없다 — html2canvas/html2pdf 와 쪽 자르기 계산이 프런트에 남아 있지 않다", () => {
  const exportPdf = read("lib/exportPdf.tsx");
  // 설명 주석은 빼고 본다 — 왜 지웠는지 적은 줄이 스스로 걸리지 않게.
  const code = exportPdf.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.equal(code.includes("html2pdf"), false, "html2pdf 가 되살아났다");
  assert.equal(code.includes("html2canvas"), false);
  const pageBreak = read("lib/pdfPageBreak.ts");
  for (const gone of ["wholePagesCaptureHeightPx", "printPageStraddleGap", "PDF_CANVAS_SCALE", "placeBrandOnClosingPage"]) {
    assert.equal(pageBreak.includes(`export function ${gone}`) || pageBreak.includes(`export const ${gone}`), false, `${gone} 이 되살아났다`);
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal("html2pdf.js" in (pkg.dependencies || {}), false, "html2pdf.js 의존성이 남아 있다");
});

test("서버가 쪽을 세는 검사가 있다 — 빈 쪽은 그쪽에서 잡는다", () => {
  const backendTest = readFileSync(new URL("../../backend/tests/test_album_pdf_service.py", import.meta.url), "utf8");
  assert.match(backendTest, /def test_쪽_차례/);
  assert.match(backendTest, /"closing", "last",/);
});
