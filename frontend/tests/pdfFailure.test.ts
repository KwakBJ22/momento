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
  // ★ 2026-08-21 뒤집음(§10-2) — 그 다음 문장을 **경로별로 가르지 않는다.**
  //   예전에는 서버 주소로 보낸 경우에 `휴대전화 알림 · 파일 앱의 다운로드 폴더` 라고 했다.
  //   그런데 그 길은 **데스크톱에서도 탄다**(이미 만들어 둔 파일이 있으면 그 주소로 보낸다).
  //   데스크톱에는 휴대전화도 파일 앱도 없다 — PO 가 데스크톱에서 그 문장을 봤다.
  //   두 길 다 결국 **파일을 받는** 것으로 끝나므로 양쪽에 다 맞는 한 문장으로 둔다.
  for (const delivery of [{ via: "download" } as const, { via: "browser-url", url: "https://x/y.pdf" } as const]) {
    assert.match(pdfSuccessMessage(delivery), /기기의 다운로드에서 확인해 주세요/, delivery.via);
    assert.equal(pdfSuccessMessage(delivery).includes("휴대전화"), false, `${delivery.via}: 데스크톱에 없는 것을 말한다`);
    assert.equal(pdfSuccessMessage(delivery).includes("파일 앱"), false, `${delivery.via}: 데스크톱에 없는 것을 말한다`);
  }
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
    // ★ 2026-08-16 — 태그가 여러 줄이 됐다(인쇄 관심 prop). 보는 것은 그대로다.
    assert.match(source, /<AlbumPdfStatus[\s\S]{0,200}?notice=\{pdfNotice\}/, name);
  }
});

// ★ 2026-08-22 — PDF 는 서버가 그린다. 캔버스 상한·빈 blob·30장 문구는 굽던 시절의 것이라
//   지웠다(pdfBlankPage.test 가 되살아나지 않는지 본다). 남는 규칙은 둘이다:
//   실패하면 이유와 함께 던진다 · 주소가 없으면 성공으로 넘기지 않는다.
test("서버가 주소를 못 주면 성공으로 넘기지 않는다 — 이유 문구로 던진다", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(exportPdf, /if \(!url\) \{[\s\S]{0,300}?throw new Error\(PDF_GENERIC_MESSAGE\)/);
  // 요청이 실패하면 삼키지 않고 그대로 던진다 — 화면이 pdfFailureMessage 로 보여 준다.
  assert.match(exportPdf, /logPdf\("pdf_request_failed"[\s\S]{0,400}?throw error;/);
});

test("실패 원인이 event 이름으로 남는다 (검색 가능)", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(exportPdf, /console\.warn\(`\[pdf\] event=\$\{event\}/);
  // ★ 2026-08-22 — 굽는 단계의 이벤트(render_failed·canvas_overflow·blob_empty·upload_failed)는
  //   그 단계와 함께 없어졌다. 남은 것은 청하는 단계 둘이다.
  for (const event of ["pdf_request_failed", "pdf_url_missing"]) {
    assert.match(exportPdf, new RegExp(`logPdf\\("${event}"`), `누락된 이벤트: ${event}`);
  }
});

// ★ 2026-08-22 — 화면이 굽고 올리던(PUT) 길이 없어졌다. 웹뷰가 받는 길은 그대로다:
//   서버 파일의 https 주소로 같은 창에서 이동한다. 그 주소는 GET 한 번으로 온다.
test("웹뷰에서는 blob 대신 서버 파일의 주소로 보낸다 — 새 API 없음", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(exportPdf, /return deliverStoredPdf\(url, pdfDownloadFilename\(input\.title\)\)/);
  // 화면에 열지 않고 파일로 받게 하는 표시.
  assert.match(exportPdf, /download=\$\{encodeURIComponent\(filename\)\}/);
  // 새 API·새 페이지를 만들지 않았다(있던 GET 하나만 쓴다).
  assert.match(exportPdf, /import \{ getAlbumPdfUrl \} from "\.\/api"/);
  assert.equal(exportPdf.includes("uploadAlbumPdf"), false, "화면이 다시 올리기 시작했다");
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
  // 전달 함수는 하나다(경로가 갈라지지 않는다).
  // ★ 4 → 2 (2026-08-22). PDF 를 서버가 그리면서 세 갈래(캐시·올린 주소·아이폰)가 한 길이
  //   됐다 — 서버가 준 주소로 이 함수 한 번. 규칙(경로가 갈라지지 않는다)은 더 단순하게 지켜진다.
  assert.equal((code.match(/deliverStoredPdf\(/g) || []).length, 2); // 정의 1 + 호출 1
  assert.match(code, /window\.location\.assign\(withDownloadName\(url, filename\)\)/);
});

test("저장 뒤 안내는 어디서 볼 수 있는지까지 말한다", () => {
  const message = pdfSuccessMessage({ via: "browser-url", url: "u" });
  // ★ 2026-08-21 뒤집음(§10-2) — `알림을 누르면` · `파일 앱` 은 휴대전화에만 있는 말이고,
  //   이 길은 데스크톱에서도 탄다. 지키는 것은 그대로다: **어디서 볼 수 있는지** 말한다.
  assert.match(message, /기기의 다운로드에서 확인해 주세요/);
  for (const forbidden of ["곧", "준비 중", "출시 예정", "AI", "GPT", "인공지능"]) {
    assert.equal(message.includes(forbidden), false, `쓰지 않는 표현: ${forbidden}`);
  }
});
