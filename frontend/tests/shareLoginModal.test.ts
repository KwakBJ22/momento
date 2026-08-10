import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("login modal is hoisted to a top-level const gated only by showLogin", () => {
  // The modal must exist independently of any single route branch so it can
  // render on the share page, not only on Landing.
  // 어느 클래스·어느 파일인지는 잠그지 않는다(동작은 sheetDialogBehavior 가 본다).
  // 여기서 지키는 것은 "화면 분기와 무관하게 항상 렌더 트리에 있다"는 사실뿐이다.
  assert.match(appSource, /const loginModal = \(/);
  assert.match(appSource, /<SheetDialog open=\{showLogin\}/);
});

test("the login modal renders at the app root, beside the withdraw modal (branch-independent)", () => {
  // {loginModal} must sit at the app root so every surface (share, join, album,
  // landing) shows it when showLogin is true.
  // ★ K-14 에서 약관 동의 시트가 이 둘 사이에 들어왔다. 규칙은 그대로다 —
  //   대화상자들이 **앱 뿌리에** 나란히 있고 화면 갈래를 타지 않는다.
  assert.match(appSource, /\{loginModal\}\s*\{\/\*[\s\S]*?\*\/\}\s*<SheetDialog open=\{legalConsentOpen\}/);
  assert.match(appSource, /<SheetDialog open=\{withdrawOpen\}/);
});

test("the login modal is no longer nested inside the Landing-only branch", () => {
  // 로그인 대화상자는 한 번만 만들어진다(랜딩 분기에서 다시 만들지 않는다).
  const occurrences = appSource.match(/<SheetDialog open=\{showLogin\}/g) ?? [];
  assert.equal(occurrences.length, 1);
  // The Landing render branch ends right after the <Landing/> element with no
  // trailing modal fragment (additive props after hideLogin are allowed).
  assert.match(appSource, /<Landing[\s\S]*?hideLogin=\{Boolean\(user\)\}[\s\S]*?\/>\}/);
  // Nothing between <Landing and its closing "/>}" reintroduces the modal.
  assert.doesNotMatch(appSource, /<Landing[\s\S]*?SheetDialog[\s\S]*?\/>\}/);
});

// body 스크롤 잠금·Esc·딤·포커스 복원은 tests/sheetDialogBehavior.test.ts 가 실제 렌더로
// 확인한다(구현 위치를 잠그지 않기 위해 여기서 소스 문자열로 검사하지 않는다).
