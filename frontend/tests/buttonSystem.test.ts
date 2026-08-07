import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const rule = (css: string, selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));

function cssFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return entry.endsWith(".css") ? [full] : [];
  });
}

// B-6 — 같은 "주 버튼"인데 화면마다 높이·굵기·색이 달랐다. 기준값 하나로 모은다:
// 높이 56 / 18px / 800 / --c-brand-action / 흰 글자 / radius 12.
test("버튼 정의는 Button.css 한 곳에 있다", () => {
  const button = read("components/Button.css");
  for (const selector of [".btn", ".btn--primary", ".btn--secondary", ".btn--ghost", ".btn--kakao"]) {
    assert.ok(button.includes(selector + " {"), selector + " 정의가 Button.css 에 있어야 한다");
  }
  // 다른 CSS 파일이 .btn 계열을 다시 정의하지 않는다.
  const offenders: string[] = [];
  for (const file of cssFiles()) {
    if (file.endsWith("Button.css")) continue;
    const text = readFileSync(file, "utf8");
    if (/(?:^|\n)\.btn(--[a-z]+)? \{/.test(text)) offenders.push(file.replace(SRC, ""));
  }
  assert.deepEqual(offenders, []);
});

test("주 버튼 기준값 — 56 / 18px / 800 / brand-action", () => {
  const primary = rule(read("components/Button.css"), ".btn--primary");
  assert.match(primary, /min-height: 56px/);
  assert.match(primary, /font-size: 18px/);
  assert.match(primary, /font-weight: 800/);
  assert.match(primary, /background: var\(--c-brand-action\)/);
  assert.match(primary, /color: var\(--c-surface\)/);
  // 협업 패널의 주 버튼도 같은 값이다.
  const collab = rule(read("components/CollaborationPanel.css"), ".collab-panel__primary");
  assert.match(collab, /min-height: 56px/);
  assert.match(collab, /font-size: 18px/);
  assert.match(collab, /font-weight: 800/);
  assert.match(collab, /background: var\(--c-brand-action\)/);
  assert.doesNotMatch(collab, /!important/);
});

test("하단 네비의 강조 칸은 버튼 규격에서 제외한다", () => {
  // 네비 칸이지 자립 버튼이 아니다 — 같은 규격으로 묶지 않는다(문서에도 남긴다).
  assert.match(read("components/Button.css"), /album-bottom-navigation__primary\)은 이 규격에서 제외/);
  const nav = rule(read("components/AlbumBottomNavigation.css"), ".album-bottom-navigation__share, .album-bottom-navigation__primary");
  assert.doesNotMatch(nav, /min-height: 56px/);
});
