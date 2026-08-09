import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pdfFailureMessage, pdfSuccessMessage, webviewSaveMessage } from "../src/lib/pdfNotice";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 예전 버그: downloadAlbumPdf 가 resolve 되면 "PDF 파일을 저장했어요."를 띄웠는데,
// resolve 는 a[download].click() 을 불렀다는 뜻일 뿐이다. 인앱 브라우저는 blob URL
// 다운로드를 무시하므로 파일은 없고 문구만 떴다. 문구는 실제로 일어난 일만 말한다.
test("성공 문구는 경로별로 사실만 말한다 — '저장했다'고 단정하지 않는다", () => {
  // I-3: 첫 마디는 우리 문구 하나다 — 시스템 알림을 유일한 신호로 두지 않는다.
  for (const delivery of [{ via: "download" } as const, { via: "browser-url", url: "https://x/y.pdf" } as const]) {
    assert.ok(pdfSuccessMessage(delivery).startsWith("앨범 파일이 준비됐어요."), delivery.via);
  }
  // 그 다음 문장은 경로별로 갈린다 — 어디서 찾는지가 다르다.
  assert.match(pdfSuccessMessage({ via: "download" }), /기기의 다운로드에서 확인해 주세요/);
  assert.match(pdfSuccessMessage({ via: "browser-url", url: "https://x/y.pdf" }), /휴대전화 알림을 누르면 열려요/);
  // ★ 어느 경로도 "저장했어요"라고 단정하지 않는다 — 파일이 만들어진 것까지가 아는 사실이다.
  for (const delivery of [{ via: "download" } as const, { via: "browser-url", url: "https://x/y.pdf" } as const]) {
    assert.doesNotMatch(pdfSuccessMessage(delivery), /저장했어요/, delivery.via);
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
  // I-3: 그 자리는 **시트 밖**이다 — 시트를 닫아도 남아야 진행·결과가 보인다.
  for (const [name, source] of [["AlbumView", view], ["AlbumResult", result]] as const) {
    assert.match(source, /<AlbumPdfStatus working=\{isExportingPdf\} notice=\{pdfNotice\}/, name);
  }
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

// 커밋 B: 카카오 웹뷰에서 실제로 받게 한다 — blob 을 아예 쓰지 않고, 이미 있는 저장 경로
// (PUT /albums/{id}/pdf → woorialbum-private, 응답의 서명 URL)로 보낸다. 새 API 없음.
test("웹뷰에서는 blob 대신 저장된 파일 주소로 보낸다 — 기존 업로드 경로 재사용", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  // 업로드 응답의 URL 을 버리지 않는다(추가 요청 없이 그 자리에서 받는다).
  assert.match(exportPdf, /storedUrl = \(await uploadAlbumPdf\(/);
  assert.match(exportPdf, /if \(isInAppWebView\(currentUserAgent\(\)\)\) \{/);
  assert.match(exportPdf, /return deliverStoredPdf\(storedUrl, pdfFilename\(input\)\)/);
  // 화면에 열지 않고 파일로 받게 하는 표시.
  assert.match(exportPdf, /download=\$\{encodeURIComponent\(filename\)\}/);
  // 주소조차 없으면 조용히 끝내지 않는다.
  assert.match(exportPdf, /logPdf\("pdf_download_unsupported"[\s\S]{0,80}throw new Error\(webviewSaveMessage/);
  // 새 API·새 페이지를 만들지 않았다(기존 두 엔드포인트만 쓴다).
  assert.match(exportPdf, /import \{ getAlbumPdfUrl, uploadAlbumPdf \} from "\.\/api"/);
});

/**
 * ★ 이 문구는 K-8 에서 **다시 썼다.** 규칙이 둘 바뀌었다:
 *   · 좋은 소식(파일은 만들어져 있다)을 먼저 말한다 — 예전에는 `막혀 있어요` 로 시작했다
 *   · `크롬이나 사파리` 라는 **이름을 빼낸다** — 이름을 대면 그것을 찾아 헤맨다
 *   자세한 것은 pdfActionSheet.test.ts. 여기서는 앱 이름 판정만 잠근다.
 */
test("웹뷰 안내 문구: 앱 이름을 정확히 부르고, 사실만 말한다", () => {
  const kakao = webviewSaveMessage("Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.5.0");
  assert.match(kakao, /카카오톡에서는 바로 저장되지 않아요/);
  assert.match(kakao, /다른 브라우저로 열기/);   // 사용자가 찾을 수 있게 메뉴 이름 그대로
  for (const forbidden of ["곧", "준비 중", "출시 예정", "업그레이드", "AI", "GPT", "인공지능"]) {
    assert.equal(kakao.includes(forbidden), false, `쓰지 않는 표현: ${forbidden}`);
  }
  // 카카오가 아닌 웹뷰에서는 앱 이름을 지어내지 않는다.
  assert.match(webviewSaveMessage("Mozilla/5.0 Instagram 300.0"), /지금 쓰는 앱에서는/);
});

test("웹뷰 판정은 한 곳에만 있다 — 갤러리와 PDF 가 같은 함수를 쓴다", () => {
  const webview = readFileSync(new URL("../src/lib/webview.ts", import.meta.url), "utf8");
  assert.match(webview, /export function isInAppWebView/);
  for (const consumer of ["lib/imageFile.ts", "lib/exportPdf.tsx", "lib/pdfNotice.ts"]) {
    assert.match(read(consumer), /from "\.\/webview"/, `${consumer} 가 판정 모듈을 쓴다`);
  }
  // 판정 정규식이 다른 파일에 복제되지 않았다.
  for (const other of ["lib/imageFile.ts", "lib/exportPdf.tsx"]) {
    assert.doesNotMatch(read(other), /KAKAOTALK/);
  }
});

// 빈 새 창 결함: 안드로이드 웹뷰는 첨부 주소를 다운로드로 넘기면서 그 창에 아무것도
// 그리지 않는다. 새 창을 아예 만들지 않으면 남을 창도 없다.
test("PDF 전달은 새 창을 만들지 않는다 — 빈 창이 남지 않게", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  // 주석 줄은 제외한다 — 설명에 등장하는 window.open 이 검사에 걸리지 않게.
  const code = exportPdf.split(/\r?\n/).filter((line) => !line.trim().startsWith("*")).join("\n");
  assert.doesNotMatch(code, /window\.open\(/);
  assert.doesNotMatch(code, /target = "_blank"|target="_blank"/);
  // 캐시된 PDF 도, 방금 올린 PDF 도 같은 전달 함수를 쓴다(경로가 갈라지지 않는다).
  assert.equal((code.match(/deliverStoredPdf\(/g) || []).length, 3); // 정의 1 + 호출 2
  assert.match(code, /window\.location\.assign\(withDownloadName\(url, filename\)\)/);
});

test("저장 뒤 안내는 어디서 볼 수 있는지·무엇을 하면 되는지까지 말한다", () => {
  const message = pdfSuccessMessage({ via: "browser-url", url: "u" });
  assert.match(message, /알림을 누르면 열려요/);      // 무엇을 하면 되는지
  assert.match(message, /‘다운로드’ 폴더/);            // 알림이 지나갔을 때 어디서 보는지
  for (const forbidden of ["곧", "준비 중", "출시 예정", "AI", "GPT", "인공지능"]) {
    assert.equal(message.includes(forbidden), false, `쓰지 않는 표현: ${forbidden}`);
  }
});
