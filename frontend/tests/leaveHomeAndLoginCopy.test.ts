import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { authPanelCopy } from "../src/lib/authPanelCopy";

/**
 * K-20 · K-21 — 나가는 길 하나, 로그인 창 제목 넷.
 *
 * ★ K-20 은 "로고가 막혀 있다"가 아니었다. 로고는 처음부터 `<a href="/">` 였다.
 *   사진 고르기 화면은 **주소가 `/` 그대로**이고(라우트가 아니라 상태다), 만들던 단계가
 *   `sessionStorage` 에 저장돼 있어서(2-1) `/` 로 가면 **그 단계가 곧바로 되살아났다.**
 *   그래서 눌러도 제자리처럼 보였다. 그러니 나갈 때는 **저장된 단계를 먼저 지워야** 한다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
const header = readFileSync(path.join(SRC, "components/AppHeader.tsx"), "utf8");
const form = readFileSync(path.join(SRC, "components/UploadForm.tsx"), "utf8");
const confirm = readFileSync(path.join(SRC, "components/ConfirmSheet.tsx"), "utf8");

// --- K-20 ---

test("★ 나가면 저장된 만들기 단계를 지운다 — 이것이 안 되면 무엇을 눌러도 돌아온다", () => {
  const fn = app.slice(app.indexOf("const leaveToHome = () => {"), app.indexOf("const requestLeaveHome"));
  assert.match(fn, /saveCreateStep\(null, false\);/);
  assert.match(fn, /resetToStart\(\);/);
  // 지운 뒤에 홈으로 간다 — 순서가 뒤집히면 되살아난다.
  assert.ok(fn.indexOf("saveCreateStep(null, false)") < fn.indexOf("window.location"));
});

test("★ 고른 사진이 있으면 묻고, 없으면 바로 간다", () => {
  const fn = app.slice(app.indexOf("const requestLeaveHome"), app.indexOf("const resetToStart"));
  assert.match(fn, /if \(isPhotoSelectionStep && pickedPhotoCount > 0\) \{ setLeaveHomeAsk\(true\); return; \}/);
  assert.match(fn, /leaveToHome\(\);/);
});

test("★ 로고와 하단 네비 `앨범 만들기` 가 같은 길을 쓴다", () => {
  // ★ K-20 의 규칙은 그대로다 — 홈으로 가는 길이 둘 이상이면 **모두 같게 굴어야 한다.**
  //   바뀐 것은 그 두 번째 길의 이름뿐이다: 하단 네비의 `처음으로` 칸이 없어지고
  //   (`앨범 만들기` 와 같은 곳이었다 — UI 정리 3단계 C), 그 칸이 같은 길을 물려받았다.
  //   ★ 이게 K-20 누수였다. 예전 `앨범 만들기` 는 assign("/") 을 바로 불러서,
  //     사진을 고르는 중에 누르면 고른 사진이 말없이 사라졌다.
  assert.match(app, /<AppHeader onNavigateHome=\{\(event\) => \{ event\.preventDefault\(\); requestLeaveHome\(\); \}\} \/>/);
  const globalNav = app.slice(app.indexOf('<AlbumBottomNavigation variant="app"'));
  const call = globalNav.slice(0, globalNav.indexOf("/>"));
  assert.match(call, /onCreateAlbum=\{requestLeaveHome\}/);
  // 그 칸이 곧장 주소를 갈아 끼우지 않는다.
  assert.equal(call.includes('window.location.assign("/")'), false);
  // 없어진 칸의 흔적이 남아 있지 않다.
  assert.equal(call.includes("onTop="), false);
});

test("로고는 여전히 링크다 — 새 탭으로 열기가 살아 있다", () => {
  assert.match(header, /<a className="app-header__brand" href="\/" aria-label=\{BRAND_NAME_KO\} onClick=\{onNavigateHome\}>/);
});

test("★ window.confirm 을 쓰지 않는다 — 이미 있는 시트다 (§5)", () => {
  // 주석은 사람에게 하는 설명이다("쓰지 않는다"고 적어 두었다) — 빼고 본다.
  const code = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(code.includes("window.confirm"), false);
  const sheet = app.slice(app.indexOf("{leaveHomeAsk ? ("), app.indexOf(") : null}", app.indexOf("{leaveHomeAsk ? (")));
  assert.match(sheet, /<ConfirmSheet/);
  assert.match(sheet, /title="고른 사진이 사라져요\. 그래도 나갈까요\?"/);
  assert.match(sheet, /confirmLabel="나가기"/);
  assert.match(sheet, /cancelLabel="계속 고르기"/);
});

test("★ `계속 고르기` 가 먼저다 — 잃을 것이 있는 쪽이 먼저 눌리면 안 된다", () => {
  const sheet = app.slice(app.indexOf("{leaveHomeAsk ? ("), app.indexOf(") : null}", app.indexOf("{leaveHomeAsk ? (")));
  assert.match(sheet, /cancelFirst/);
  // 시트는 한 벌 그대로다 — 순서만 부르는 쪽이 정한다.
  assert.match(confirm, /\{cancelFirst \? \(/);
  const actions = confirm.slice(confirm.indexOf('className="album-confirm-sheet__actions"'));
  assert.ok(actions.indexOf("cancelFirst ? (") < actions.indexOf("album-confirm-sheet__confirm$"), "취소가 먼저 그려지지 않는다");
});

test("장수를 세는 곳은 하나다 — 화면이 두 번 세지 않는다", () => {
  assert.match(form, /onPhotoCountChange\?\.\(photos\.length\);/);
  assert.match(app, /onPhotoCountChange=\{setPickedPhotoCount\}/);
});

// --- K-21 ---

test("★ 어디서 눌렀는지에 따라 제목이 갈린다 (네 갈래)", () => {
  assert.deepEqual(authPanelCopy("signin"), { title: "로그인", description: "쓰던 계정으로 이어서 볼 수 있어요." });
  assert.deepEqual(authPanelCopy("bookmark"), { title: "이 앨범을 담아둘까요?", description: "담아두면 다음에도 이 앨범을 찾을 수 있어요." });
  assert.deepEqual(authPanelCopy("guest-save"), { title: "이 앨범을 내 앨범으로 저장할까요?", description: "저장해 두면 다음에도 이 앨범을 찾을 수 있어요." });
  // 그 밖 — 없는 맥락을 지어내지 않는다.
  assert.deepEqual(authPanelCopy(), { title: "로그인", description: null });
  assert.deepEqual(authPanelCopy(null), { title: "로그인", description: null });
});

test("★ 첫 화면 `로그인` 에 담아두기 제목이 뜨지 않는다", () => {
  assert.notEqual(authPanelCopy("signin").title, authPanelCopy("bookmark").title);
  assert.equal(authPanelCopy("signin").title.includes("담아"), false);
  assert.equal(authPanelCopy("signin").title.includes("보관"), false);
});

test("★ 부르는 쪽이 이유를 넘긴다", () => {
  assert.match(app, /const openLogin = \(reason\?: AuthPanelReason\) => \{/);
  assert.match(app, /className="app__account-login" onClick=\{\(\) => openLogin\("signin"\)\}/);
  assert.match(app, /onLogin=\{\(\) => openLogin\("signin"\)\} hideLogin=\{Boolean\(user\)\}/);
  assert.match(app, /onLogin=\{\(\) => openLogin\("bookmark"\)\}/);
  assert.match(app, /setPendingGuestClaim\(albumId\); openLogin\("guest-save"\);/);
  assert.match(app, /<AuthPanel titleId="auth-dialog-title" reason=\{loginReason\} \/>/);
});

test("★ 창을 두 벌로 만들지 않았다 — 값만 넣는다", () => {
  const panel = readFileSync(path.join(SRC, "components/AuthPanel.tsx"), "utf8");
  assert.match(panel, /<h2 id=\{titleId\}>\{copy\.title\}<\/h2>/);
  assert.match(panel, /\{copy\.description \? <p>\{copy\.description\}<\/p> : null\}/);
  // 약관 체크와 카카오 버튼은 모든 경우에 그대로다.
  assert.match(panel, /<LegalConsent checked=\{agreed\} onChange=\{setAgreed\} \/>/);
  assert.match(panel, />카카오로 계속하기<\/button>/);
  // 제목 문자열이 화면에 흩어져 있지 않다.
  assert.equal(panel.includes("내 앨범 보관하기"), false);
  assert.equal(app.includes("이 앨범을 담아둘까요?"), false);
});

// --- UI 정리 3단계 C — K-20 누수를 막은 자리 ---

test("★ 사진 고르는 중 `앨범 만들기` 를 누르면 확인 시트가 뜬다 (없으면 바로 간다)", () => {
  // ★ 이게 이번 C 의 진짜 이유다. 예전 `앨범 만들기` 는 assign("/") 을 바로 불러서,
  //   사진을 고르는 중에 누르면 고른 사진이 **말없이** 사라졌다. `처음으로` 만 물어봤다.
  //   K-20 에서 정한 "두 길이 다르게 동작하면 안 된다" 가 세 번째 길에서 깨져 있었다.
  const fn = app.slice(app.indexOf("const requestLeaveHome"), app.indexOf("const resetToStart"));
  assert.match(fn, /if \(isPhotoSelectionStep && pickedPhotoCount > 0\) \{ setLeaveHomeAsk\(true\); return; \}/);
  assert.match(fn, /leaveToHome\(\);/);
  // 그 판단을 하는 함수를 네비의 `앨범 만들기` 가 그대로 쓴다.
  const globalNav = app.slice(app.indexOf('<AlbumBottomNavigation variant="app"'));
  assert.match(globalNav.slice(0, globalNav.indexOf("/>")), /onCreateAlbum=\{requestLeaveHome\}/);
});

test("★ 전역 네비의 두 칸이 서로 다른 곳으로 간다", () => {
  // `처음으로` 와 `새 앨범` 은 같은 곳이었다 — 그래서 하나를 뺐다.
  const globalNav = app.slice(app.indexOf('<AlbumBottomNavigation variant="app"'));
  const call = globalNav.slice(0, globalNav.indexOf("/>"));
  assert.match(call, /onMyAlbums=\{\(\) => window\.location\.assign\("\/my-albums"\)\}/);
  assert.match(call, /onCreateAlbum=\{requestLeaveHome\}/);
});
