import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// SCREEN_SPEC §3 화면별 우측 표. 참여 화면만 비우고, 나머지는 반드시 무언가 있다 —
// 비어 있으면 로그인·계정·로그아웃에 닿을 길이 사라진다(실제로 그렇게 막혔다).
test("참여 화면 외에는 우측 slot 이 비지 않는다", () => {
  const app = read("App.tsx");
  // 전역 헤더: 참여 화면만 undefined, 그 외에는 accountEntry(로그인 또는 ⋯).
  assert.match(app, /<AppHeader right=\{isJoinSurface \? undefined : accountEntry\}/);
  // accountEntry 는 두 갈래뿐이며 어느 쪽도 비어 있지 않다.
  const entry = app.slice(app.indexOf("const accountEntry = user ?"), app.indexOf("const accountSheetRow"));
  assert.match(entry, /className="app-header__more" aria-label="더보기"/); // 로그인 상태
  assert.match(entry, /className="app__account-login"[\s\S]{0,40}>로그인</);  // 비로그인
});

test("랜딩(로그인)·사진 고르기·만드는 중·내 앨범 = 원형 ⋯ 하나", () => {
  const app = read("App.tsx");
  const entry = app.slice(app.indexOf("const accountEntry = user ?"), app.indexOf(") : ("));
  // 컨트롤은 하나뿐이다(계정 원을 헤더에 따로 두지 않는다).
  assert.equal((entry.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(entry, /img|avatarUrl/); // 프로필 사진은 헤더에 없다
  // 프로필 사진은 ⋯ 시트 최상단 계정 행에 있다.
  const sheetRow = app.slice(app.indexOf("const accountSheetRow = user ?"), app.indexOf("const albumSurface"));
  assert.match(sheetRow, /album-more-sheet__account-avatar/);
  assert.match(sheetRow, /user\.avatarUrl/);
});

test("앨범 상세 = [내 앨범] + 원형 ⋯, 이 순서", () => {
  const screen = read("components/AlbumScreen.tsx");
  const right = screen.slice(screen.indexOf("<AppHeader right="), screen.indexOf("</>} />"));
  const linkAt = right.indexOf("album-screen__hdr-link");
  const moreAt = right.indexOf("app-header__more");
  assert.ok(linkAt > -1 && moreAt > -1, "두 컨트롤이 모두 있어야 한다");
  assert.ok(linkAt < moreAt, "내 앨범이 ⋯ 보다 앞이다");
  assert.equal((right.match(/<a |<button /g) || []).length, 2);
});

test("⋯ 는 원형 버튼이고 정의는 한 곳뿐이다", () => {
  const chrome = read("components/AppChrome.css");
  const rule = chrome.slice(chrome.indexOf(".app-header__more {"), chrome.indexOf("}", chrome.indexOf(".app-header__more {")));
  assert.match(rule, /width: 44px; height: 44px/);
  assert.match(rule, /border-radius: 50%/);        // 원형 — 알약·글자 버튼이 아니다
  assert.match(rule, /border: 1px solid var\(--c-border\)/); // 보이는 테두리
  // 앨범 화면이 자기만의 ⋯ 스타일을 갖지 않는다(같은 클래스를 쓴다).
  assert.doesNotMatch(read("components/AlbumScreen.css"), /\.album-screen__more \{/);
});

test("헤더 높이는 모든 화면에서 같다 — 한 규칙이 정한다", () => {
  const chrome = read("components/AppChrome.css");
  const header = chrome.slice(chrome.indexOf(".app-header {"), chrome.indexOf("}", chrome.indexOf(".app-header {")));
  assert.match(header, /min-height: 58px/);
  assert.match(header, /padding: 6px 20px/);
  // 화면별로 헤더를 다시 정의하지 않는다(AlbumScreen 은 AppHeader 를 쓴다).
  assert.match(read("components/AlbumScreen.tsx"), /<AppHeader /);
});
