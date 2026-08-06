import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { IMAGE_ACCEPT, imageAcceptFor, isInAppWebView } from "../src/lib/imageFile";

// Android picker regression (verified on a real device): `image/*` ALONE drops the
// gallery from the intent chooser (only 카메라/파일 appear). The full list — image/*
// PLUS explicit MIME types and extensions — keeps the gallery present. So the accept
// attribute must include image/* AND the explicit tokens.

test("IMAGE_ACCEPT includes image/* and the explicit MIME/extension tokens", () => {
  const tokens = IMAGE_ACCEPT.split(",").map((t) => t.trim());
  assert.ok(tokens.includes("image/*"), `image/* must be present in ${IMAGE_ACCEPT}`);
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]) {
    assert.ok(tokens.includes(mime), `expected ${mime}`);
  }
  for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]) {
    assert.ok(tokens.includes(ext), `expected ${ext}`);
  }
});

// The two multi-select photo inputs must bind the shared constant (not a
// hardcoded accept string that could drift) together with `multiple`.
const uploadForm = readFileSync(new URL("../src/components/UploadForm.tsx", import.meta.url), "utf8");
const contribute = readFileSync(new URL("../src/components/ContributeWorkspace.tsx", import.meta.url), "utf8");

test("the gallery multi-select inputs bind IMAGE_ACCEPT + multiple", () => {
  for (const [name, source] of [["UploadForm", uploadForm], ["ContributeWorkspace", contribute]] as const) {
    assert.match(source, /import \{[^}]*imageAcceptFor[^}]*\} from "\.\.\/lib\/imageFile"/, `${name} imports imageAcceptFor`);
    // accept 값은 환경에 따라 정해진 PHOTO_ACCEPT 하나만 쓴다(문자열 직접 기입 금지).
    assert.match(source, /const PHOTO_ACCEPT = imageAcceptFor\(/, `${name} computes PHOTO_ACCEPT`);
    assert.match(source, /accept=\{PHOTO_ACCEPT\}[\s\S]{0,80}multiple/, `${name} binds PHOTO_ACCEPT + multiple`);
  }
});

// 인앱 웹뷰(카카오톡 등)는 선택창을 앱이 직접 만든다: acceptTypes 가 여러 값이면 인텐트가
// */* 로 넓어져 갤러리 앱이 후보에서 빠진다. 그래서 웹뷰에서만 단일 값을 준다.
test("인앱 웹뷰에서는 accept 가 단일 image/* — 갤러리가 후보에서 빠지지 않게", () => {
  const kakao = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 KAKAOTALK 10.5.0";
  assert.equal(isInAppWebView(kakao), true);
  assert.equal(imageAcceptFor(kakao), "image/*");
});

test("일반 브라우저는 실기기에서 검증된 전체 목록 그대로 (499d69d 회귀 금지)", () => {
  const chrome = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
  assert.equal(isInAppWebView(chrome), false);
  assert.equal(imageAcceptFor(chrome), IMAGE_ACCEPT);
  assert.equal(imageAcceptFor(""), IMAGE_ACCEPT); // UA 를 못 읽어도 기존 동작 유지
});
