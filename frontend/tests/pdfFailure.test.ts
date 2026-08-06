import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pdfFailureMessage, pdfSuccessMessage } from "../src/lib/pdfNotice";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 예전 버그: downloadAlbumPdf 가 resolve 되면 "PDF 파일을 저장했어요."를 띄웠는데,
// resolve 는 a[download].click() 을 불렀다는 뜻일 뿐이다. 인앱 브라우저는 blob URL
// 다운로드를 무시하므로 파일은 없고 문구만 떴다. 문구는 실제로 일어난 일만 말한다.
test("성공 문구는 경로별로 사실만 말한다 — '저장했다'고 단정하지 않는다", () => {
  assert.match(pdfSuccessMessage({ via: "download" }), /내려받고 있어요/);
  assert.match(pdfSuccessMessage({ via: "browser-url", url: "https://x/y.pdf" }), /새 창에서 PDF를 열었어요/);
  for (const message of [pdfSuccessMessage({ via: "download" }), pdfSuccessMessage({ via: "browser-url", url: "u" })]) {
    assert.doesNotMatch(message, /저장했어요/);
  }
});

test("실패 문구는 원인을 그대로 보여주고, 없으면 기본 문구로 떨어진다", () => {
  assert.equal(pdfFailureMessage(new Error("사진이 많으면 한 파일에 다 담기지 않아요.")),
    "사진이 많으면 한 파일에 다 담기지 않아요.");
  assert.match(pdfFailureMessage(new Error("   ")), /PDF를 만들지 못했어요/);
  assert.match(pdfFailureMessage("문자열 오류"), /PDF를 만들지 못했어요/);
});

test("두 화면의 실패 처리가 같다 — 조용히 삼키는 catch 가 없다", () => {
  const view = read("components/AlbumView.tsx");
  const result = read("components/AlbumResult.tsx");
  for (const [name, source] of [["AlbumView", view], ["AlbumResult", result]] as const) {
    assert.match(source, /pdfFailureMessage\(/, `${name}: 같은 실패 문구를 쓴다`);
    assert.match(source, /pdfSuccessMessage\(delivery\)/, `${name}: 실제 경로대로 알린다`);
  }
  // ★ handlePdf 의 catch { /* noop */ } 재발 금지.
  assert.doesNotMatch(view, /catch \{\s*\/\* noop \*\//);
  // 화면에 뜨는 자리가 실제로 있다(상태만 만들고 안 그리면 같은 증상이 반복된다).
  assert.match(view, /\{pdfNotice \? <p className="album-inline-action__error" role="status">\{pdfNotice\}<\/p> : null\}/);
});

test("오래 기다린 끝의 빈 PDF 를 미리 잡는다 — 캔버스 상한·빈 결과·이유 문구", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  // 크롬 캔버스 한 변 상한. 넘으면 html2canvas 가 예외 없이 빈 결과를 준다.
  assert.match(exportPdf, /const CANVAS_MAX_PX = 65_500;/);
  assert.match(exportPdf, /sourceHeightPx > CANVAS_MAX_PX/);
  // 사진 장수가 원인이면 그 사실을 문구로 말한다(albumLimits 의 기존 문구 재사용).
  assert.match(exportPdf, /throw new Error\(PDF_BLOCKED_REASON\)/);
  // 빈 결과물도 성공으로 넘기지 않는다.
  assert.match(exportPdf, /blob\.size < PDF_MIN_BLOB_BYTES/);
});

test("실패 원인이 event 이름으로 남는다 (검색 가능)", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(exportPdf, /console\.warn\(`\[pdf\] event=\$\{event\}/);
  for (const event of ["pdf_render_failed", "pdf_canvas_overflow", "pdf_blob_empty",
    "pdf_upload_failed", "pdf_download_unsupported", "pdf_cache_lookup_failed"]) {
    assert.match(exportPdf, new RegExp(`logPdf\\("${event}"`), `누락된 이벤트: ${event}`);
  }
});
