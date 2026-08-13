import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 참여자 화면 제목 위에 여백이 없었다 (J-4 · SCREEN_SPEC §3).
 *
 * `참여자`가 헤더에 딱 붙어 시작해 다른 화면과 시작 높이가 달랐다.
 * §3 에 이미 적혀 있던 그 화면이다 — *"오래 전에 만든 화면(참여자 목록 등)이
 * 이 규칙 밖에 있다."*
 *
 * 앨범 계열 화면은 `.album-page` 가 자기 위 여백을 주는데, 참여자 목록에는 그런
 * 껍데기가 없다. 그래서 컨테이너가 준다 — **값은 좌우와 같은 곳에서 읽는다.**
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const chrome = readFileSync(path.join(SRC, "components/AppChrome.css"), "utf8");
const appCss = readFileSync(path.join(SRC, "App.css"), "utf8");
const familyCss = readFileSync(path.join(SRC, "components/FamilyManagement.css"), "utf8");
const participants = readFileSync(path.join(SRC, "components/ParticipantsPage.tsx"), "utf8");

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(css: string, selector: string): string {
  const at = strip(css).indexOf(`${selector} {`);
  assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
  return strip(css).slice(at, strip(css).indexOf("}", at));
}

test("★ 시작 높이의 값이 좌우 여백과 **같은 곳**에 있다", () => {
  const shell = rule(chrome, ".app-shell");
  // ★ 16px → 20px (2026-08-13 · 시안 .body). 16px 은 내용이 화면 가장자리에 붙어
  //   보였다. 이 검사가 지키는 것은 "좌우와 시작 높이가 같은 곳에 있다" 이고 그대로다.
  assert.match(shell, /--page-padding-x: 20px;/);
  assert.match(shell, /--page-padding-top: 24px;/);
});

test("★ 다른 화면도 그 변수를 읽는다 — 두 곳에 숫자를 각각 적지 않는다", () => {
  const app = rule(appCss, ".app");
  assert.match(app, /padding: var\(--page-padding-top\) var\(--page-padding-x\) 2rem;/);
  // 예전 값(1.5rem = 24px)과 같은 값이다 — 다른 화면의 시작 높이는 바뀌지 않는다.
  assert.equal(strip(appCss).includes("padding: 1.5rem var(--page-padding-x)"), false);
});

test("★ 참여자 화면이 같은 변수에서 시작 높이를 받는다", () => {
  const body = rule(appCss, ".app--album .app__main > .family-panel");
  assert.match(body, /padding-top: var\(--page-padding-top\);/);
  // 좌우도 같은 변수다(컨테이너가 준다 — §3).
  assert.match(rule(appCss, ".app--album"), /padding: 0 var\(--page-padding-x\) 3rem;/);
});

test("★ 이 화면에 숫자를 직접 적지 않는다", () => {
  // 화면 컴포넌트에는 여백을 적지 않는다.
  assert.equal(/padding|margin/.test(participants), false, "화면 코드가 여백을 적는다");
  // 화면 CSS 의 뿌리 규칙도 자기 위 여백을 갖지 않는다.
  assert.equal(/padding-top/.test(rule(familyCss, ".family-panel")), false);
});

test("시트 안에 끼워 넣은 같은 껍데기는 걸리지 않는다 (본문 직계만)", () => {
  // `>` 직계 선택자라, 앨범 시트 안의 참여자 패널에는 위 여백이 붙지 않는다.
  assert.match(strip(appCss), /\.app--album \.app__main > \.family-panel \{/);
});

// --- J-6 · `대표사진 바꾸기` 에서 고른 것이 잘 보인다 ---

const collabCss = readFileSync(path.join(SRC, "components/CollaborationPanel.css"), "utf8");

test("★ 고른 사진에 체크 배지가 있다 — 색만으로 구분하지 않는다", () => {
  const badge = rule(collabCss, ".collab-panel__cover-grid button.is-selected::after");
  assert.match(badge, /content: "✓";/);
  assert.match(badge, /width: 28px;/);
  assert.match(badge, /height: 28px;/);
  assert.match(badge, /border-radius: 50%;/);
  assert.match(badge, /background: var\(--c-brand\);/);
  assert.match(badge, /color: var\(--c-surface\);/);
  // 사진 모서리에서 8px.
  assert.match(badge, /top: 8px;/);
  assert.match(badge, /right: 8px;/);
});

test("테두리는 3px 브랜드색이다", () => {
  assert.match(rule(collabCss, ".collab-panel__cover-grid button"), /border-width: 3px;/);
  assert.match(rule(collabCss, ".collab-panel__cover-grid button.is-selected"), /border-color: var\(--c-brand\);/);
});

test("★ 고르지 않은 사진을 흐리게 하지 않는다 (§6 — 사진이 가장 중요하다)", () => {
  const grid = strip(collabCss).slice(
    strip(collabCss).indexOf(".collab-panel__cover-grid"),
    strip(collabCss).indexOf(".collab-panel__cover-actions"),
  );
  assert.equal(/opacity|filter|grayscale/.test(grid), false, "고르지 않은 사진을 죽인다");
});
