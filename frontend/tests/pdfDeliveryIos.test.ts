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

test("★ 아이폰에서는 올려 둔 주소가 있으면 blob 대신 그 주소로 보낸다", () => {
  const pdf = read("lib/exportPdf.tsx");
  const flow = pdf.slice(pdf.indexOf("export async function downloadAlbumPdf"), pdf.indexOf("export async function renderAlbumPdfBlob"));

  const iosAt = flow.indexOf("isIosWebKit(currentUserAgent())");
  const blobAt = flow.indexOf("triggerBlobDownload(blob");
  assert.ok(iosAt > 0, "아이폰 갈래가 있어야 한다");
  assert.ok(iosAt < blobAt, "blob 저장보다 먼저 판단해야 한다 — 뒤에 두면 이미 blob 으로 끝난다");
  assert.match(flow, /if \(storedUrl && isIosWebKit\(currentUserAgent\(\)\)\) \{[\s\S]{0,120}?return deliverStoredPdf\(storedUrl/);

  // 인앱 브라우저 갈래가 먼저다 — 아이폰 카카오톡은 예전 문구·예전 길 그대로다.
  assert.ok(flow.indexOf("isInAppWebView(currentUserAgent())") < iosAt);
});

test("주소가 없으면 예전 그대로 blob 으로 저장한다 (기능을 빼지 않는다)", () => {
  const pdf = read("lib/exportPdf.tsx");
  assert.match(pdf, /triggerBlobDownload\(blob, pdfFilename\(input\)\);\s*\n\s*return \{ via: "download" \};/);
});
