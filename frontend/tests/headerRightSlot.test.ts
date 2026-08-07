import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// SCREEN_SPEC §3 화면별 우측 표. 참여 화면만 비우고, 나머지는 반드시 무언가 있다 —
// 비어 있으면 로그인·계정·로그아웃에 닿을 길이 사라진다(실제로 그렇게 막혔다).
test("참여 화면 외에는 우측 slot 이 비지 않는다", () => {
  const app = read("App.tsx");
  // 전역 헤더: 참여 화면만 undefined, 그 외에는 accountEntry(로그인 또는 ⋯).
  assert.match(app, /!albumOwnsHeaderSlot && !isJoinSurface \? <HeaderRight>\{accountEntry\}<\/HeaderRight>/);
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
  // 프로필 사진은 ⋯ 시트 최상단 계정 행(AccountSheetRow)에 있다.
  const row = read("components/AccountSheetRow.tsx");
  assert.match(row, /account-row__avatar/);
  assert.match(row, /user\.avatarUrl/);
});

test("앨범 상세 = [내 앨범] + 원형 ⋯, 이 순서", () => {
  const screen = read("components/AlbumScreen.tsx");
  const right = screen.slice(screen.indexOf("<HeaderRight>"), screen.indexOf("</HeaderRight>"));
  const linkAt = right.indexOf("app-header__link");
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
  assert.match(header, /min-height: 52px/);
  assert.match(header, /padding: 4px max\(var\(--page-padding-x\)/);
  // 화면별로 헤더를 다시 정의하지 않는다(AlbumScreen 은 slot 만 채운다).
  assert.match(read("components/AlbumScreen.tsx"), /<HeaderRight>/);
  assert.doesNotMatch(read("components/AlbumScreen.tsx"), /<AppHeader/);
});

// SCREEN_SPEC §5 — ⋯ 시트 최상단 계정 행. 정보이지 버튼이 아니다.
test("⋯ 시트 최상단 계정 행: 사진 + 이름(굵게) + 이메일(흐리게), 눌리지 않는다", () => {
  const row = read("components/AccountSheetRow.tsx");
  // 사진이 있으면 이미지, 없으면 이름 첫 글자.
  assert.match(row, /user\.avatarUrl\s*\?\s*<img className="account-row__avatar"/);
  assert.match(row, /<span className="account-row__avatar" aria-hidden="true">\{user\.displayName\.slice\(0, 1\)\}/);
  assert.match(row, /<p className="account-row__name">\{user\.displayName\}<\/p>/);
  // 이메일이 없으면 그 줄을 비운다.
  assert.match(row, /\{user\.email \? <p className="account-row__email">\{user\.email\}<\/p> : null\}/);
  // 이 행은 눌러도 아무 일이 없다 — 버튼·링크가 아니다(게스트의 로그인만 버튼).
  const loggedIn = row.slice(row.indexOf("return (\n    <div className=\"account-row\">"));
  assert.doesNotMatch(loggedIn, /<button[\s\S]{0,80}account-row__head|onClick=\{[^}]*\}>\s*<div className="account-row__head"/);
  // 게스트는 이 자리가 로그인이다.
  assert.match(row, /if \(!user\) \{[\s\S]{0,220}onClick=\{onLogin\}><span>로그인/);
});

test("계정 행 모양: 이름 16px 굵게 / 이메일 14px 흐린색 / 아바타 44px 원형 / 아래 구분선", () => {
  const css = read("components/AppChrome.css");
  const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
  assert.match(rule(".account-row__name"), /font-size: 16px; font-weight: 700/);
  assert.match(rule(".account-row__email"), /color: var\(--c-text-muted\); font-size: 14px/);
  assert.match(rule(".account-row__avatar"), /width: 44px; height: 44px/);
  assert.match(rule(".account-row__avatar"), /border-radius: 50%/);
  assert.match(rule(".account-row"), /border-bottom: 1px solid var\(--c-border\)/); // 그 아래 구분선
  assert.match(rule(".account-row__actions button"), /min-height: 44px/);
});

test("계정 행은 한 벌뿐 — 세 시트가 같은 컴포넌트를 쓴다", () => {
  const app = read("App.tsx");
  assert.match(app, /const accountSheetRow = \(\s*<AccountSheetRow/);
  // 전역 ⋯ 시트 / 앨범 상세 / 공유 앨범 모두 같은 노드를 넘겨받는다.
  assert.match(app, /album-more-sheet__list">\{accountSheetRow\}/);
  assert.match(app, /accountSheet=\{accountSheetRow\}/);
  assert.match(app, /<ShareEntryRouter[^>]*accountSheet=\{accountSheetRow\}/);
  assert.match(read("components/AlbumMoreSheet.tsx"), /\{accountSheet\}/);
});

test("헤더 브랜드는 한 줄 — woorialbum 이 헤더에 없다", () => {
  const header = read("components/AppHeader.tsx");
  assert.doesNotMatch(header, /BRAND_NAME_EN|brand-en/);
  // 영문 표기는 다른 자리에서 계속 쓴다(상수 모듈은 그대로).
  assert.match(read("lib/brand.ts"), /BRAND_NAME_EN = "woorialbum"/);
});

// SCREEN_SPEC §3 (4차 개정) — 공유 앨범 우측은 **항상 하나**다.
// 비로그인이 ⋯ 를 눌러도 시트 안에는 `로그인` 하나뿐이라(§5) 두 번 누를 일이 된다.
test("공유 앨범 우측 컨트롤은 항상 정확히 1개 — 로그인 XOR ⋯", () => {
  const share = read("components/PublicShareView.tsx");
  assert.match(share, /const signedIn = Boolean\(authenticatedUser\);/);
  // 비로그인일 때만 `로그인`.
  assert.match(share, /const headerRight = !signedIn && onLogin/);
  // 로그인일 때만 ⋯.
  assert.match(share, /onMore=\{signedIn \? \(\) => setMoreOpen\(true\) : undefined\}/);
  // 둘을 동시에 켜는 경로가 없다(같은 조건의 XOR).
  assert.doesNotMatch(share, /onMore=\{\(\) => setMoreOpen\(true\)\}/);
});

// §3 — 참여하기: 비로그인만 비운다. 로그인 상태에서는 하단 네비가 없어(§2)
// 우측까지 비우면 자기 앨범으로 돌아갈 길이 사라진다.
test("참여하기: 비로그인 0개 / 로그인 2개([내 앨범][⋯])", () => {
  const app = read("App.tsx");
  // 전역 slot 은 참여 화면에서 비운다(비로그인 기준 — 계정 진입점을 넣지 않는다).
  assert.match(app, /!albumOwnsHeaderSlot && !isJoinSurface \? <HeaderRight>\{accountEntry\}<\/HeaderRight>/);
  // 로그인 상태의 참여 화면은 AlbumScreen(ContributeWorkspace)이 [내 앨범]+[⋯] 를 채운다.
  const screen = read("components/AlbumScreen.tsx");
  const right = screen.slice(screen.indexOf("<HeaderRight>"), screen.indexOf("</HeaderRight>"));
  assert.match(right, /app-header__link/);
  assert.match(right, /app-header__more/);
});

test("헤더 높이는 slot 내용과 무관하다 — 44px 컨트롤이 들어가도 커지지 않는다", () => {
  const css = read("components/AppChrome.css");
  const header = css.slice(css.indexOf(".app-header {"), css.indexOf("}", css.indexOf(".app-header {")));
  // 44px + 상하 패딩 4px = 52px. 값이 서로 맞물려 있으므로 함께 확인한다.
  assert.match(header, /min-height: 52px/);
  assert.match(header, /padding: 4px max\(var\(--page-padding-x\)/);
  const more = css.slice(css.indexOf(".app-header__more {"), css.indexOf("}", css.indexOf(".app-header__more {")));
  assert.match(more, /height: 44px/);
  const link = css.slice(css.indexOf(".app-header__link {"), css.indexOf("}", css.indexOf(".app-header__link {")));
  assert.match(link, /min-height: 44px/);
});

// §3 — 앨범 화면의 `내 앨범` 진입점은 헤더 우측 하나다. 예전 화면의 "← 내 앨범" 줄이
// 헤더 아래에 또 있어 같은 것이 두 개였다.
test("앨범 화면에 `내 앨범` 진입점이 하나뿐이다", () => {
  const view = read("components/AlbumView.tsx");
  // 실제로 그려지는 부분만 본다(주석 처리된 legacy shell 제외).
  const live = view.slice(0, view.indexOf("/* Legacy shell intentionally disabled"));
  assert.doesNotMatch(live, /album-page__back-link/);
  // 헤더 우측의 링크는 그대로다.
  assert.match(read("components/AlbumScreen.tsx"), /app-header__link[\s\S]{0,80}backLabel \|\| "내 앨범"/);
  // 쓰지 않게 된 여백 규칙도 남기지 않는다.
  assert.doesNotMatch(read("components/AlbumResult.css"), /\.album-page__back-link/);
});
