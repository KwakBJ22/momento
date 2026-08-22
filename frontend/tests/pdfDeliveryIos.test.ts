import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { isInAppWebView, isIosWebKit } from "../src/lib/webview";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/**
 * 🔴 아이폰에서 PDF 저장이 조용히 끝나는 길 (2026-08-12 · iOS 전수 조사).
 *
 * 저장은 세 갈래다.
 *   1) 서버에 이미 만들어 둔 PDF 가 있다        → 주소로 이동 (모든 기기에서 확실)
 *   2) 인앱 브라우저(카카오톡 등)                → 올린 주소로 이동 / 없으면 안내
 *   3) 그 밖의 브라우저                          → blob + a[download]
 *
 * 3번만 아이폰에서 불확실하다: 기기·버전에 따라 파일 이름을 잃거나 미리보기로 열고 끝난다.
 * 예외가 없어 화면에는 "저장했어요"만 남는다. 2번에서 이미 올려 둔 주소가 있으므로,
 * 아이폰이면 그 주소를 쓴다 — **새 경로를 만들지 않고 이미 있는 길로 합류시킨다.**
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_KAKAO = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.5.0";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-A546S) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

test("아이폰 계열을 가려낸다 (사파리·크롬·카카오 모두)", () => {
  assert.equal(isIosWebKit(IPHONE), true);
  assert.equal(isIosWebKit(IPHONE_CHROME), true);
  assert.equal(isIosWebKit(IPHONE_KAKAO), true);
  assert.equal(isIosWebKit("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15"), true);
  // 안드로이드·데스크톱은 지금 길(blob 저장)이 잘 되므로 건드리지 않는다.
  assert.equal(isIosWebKit(ANDROID), false);
  assert.equal(isIosWebKit(DESKTOP), false);
  assert.equal(isIosWebKit(""), false);
});

test("아이폰 카카오톡은 예전처럼 인앱 판정에도 걸린다 (순서가 바뀌지 않는다)", () => {
  assert.equal(isInAppWebView(IPHONE_KAKAO), true);
  assert.equal(isInAppWebView(IPHONE), false);
});

// ★ 2026-08-22 — PDF 는 서버가 그린다. 세 갈래(캐시 주소 / 올린 주소 / blob)가 **한 길**이
//   됐다: 서버가 만든 파일의 주소로 같은 창에서 이동한다. 아이폰만 따로 가르던 갈래와
//   blob 저장은 잴 것이 없어 지웠다. 지키는 것은 그대로다 — 아이폰도 주소로 받는다.
test("★ 기기를 가리지 않고 서버가 만든 파일의 주소로 받는다 — blob 길은 없다", () => {
  const pdf = read("lib/exportPdf.tsx");
  const flow = pdf.slice(pdf.indexOf("export async function downloadAlbumPdf"));
  assert.match(flow, /return deliverStoredPdf\(url, pdfDownloadFilename\(input\.title\)\);/);
  assert.equal(pdf.includes("triggerBlobDownload"), false, "blob 저장이 되살아났다 — 아이폰에서 조용히 끝나는 길이다");
  assert.equal(pdf.includes("URL.createObjectURL"), false);
  // 같은 창에서 이동한다(새 창을 열면 빈 창이 남는다).
  assert.match(pdf, /window\.location\.assign\(withDownloadName\(url, filename\)\)/);
});
