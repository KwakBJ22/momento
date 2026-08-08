import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * 본문 좌우 여백은 **한 곳에서 나온다** (SCREEN_SPEC §3).
 *
 * 참여자 목록이 왼쪽 끝에 붙어 있었다. 원인은 그 화면이 자체 여백을 써서가 아니라,
 * 앨범 계열 컨테이너(.app--album)가 여백을 0 으로 두고 **각 화면이 스스로 채우는**
 * 구조였기 때문이다 — 채우지 않은 화면만 왼쪽에 붙었다.
 *
 * 이제 컨테이너가 준다. 화면 CSS 에 좌우 여백 숫자를 적지 않는다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/** 각 라우트의 본문 최상위 컨테이너(= .app__main 바로 아래). */
const SCREEN_ROOTS = [
  { name: "랜딩", selector: ".landing", file: "App.css" },
  { name: "내 앨범", selector: ".my-albums", file: "App.css" },
  { name: "앨범 상세", selector: ".album-page__layout", file: "components/AlbumResult.css" },
  { name: "공유 앨범", selector: ".album-result:not(.album-page__book)", file: "components/AlbumResult.css" },
  { name: "참여하기", selector: ".join-page", file: "components/JoinPage.css" },
  { name: "생성 중", selector: ".album-creating", file: "components/AlbumCreating.css" },
] as const;

function cssFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return entry.endsWith(".css") ? [full] : [];
  });
}

/** `padding` 축약형에서 좌우 값만 꺼낸다(1값=사방, 2·3값=2번째, 4값=2번째). */
function horizontalPadding(body: string): string | null {
  const shorthand = /(?<![\w-])padding\s*:\s*([^;]+)/.exec(body);
  if (shorthand) {
    const parts = shorthand[1].trim().split(/\s+/);
    return parts.length === 1 ? parts[0] : parts[1];
  }
  const inline = /(?<![\w-])padding-(?:inline|left|right)\s*:\s*([^;]+)/.exec(body);
  return inline ? inline[1].trim() : null;
}

test("컨테이너가 좌우 여백을 준다 — 값은 변수 한 곳에서 읽는다", () => {
  const app = read("App.css");
  for (const selector of [".app {", ".app--album {"]) {
    const rule = app.slice(app.indexOf(selector), app.indexOf("}", app.indexOf(selector)));
    assert.match(rule, /padding: [^;]*var\(--page-padding-x\)/, `${selector} 는 변수를 읽어야 한다`);
  }
  // 변수는 한 곳에만 있다.
  const chrome = read("components/AppChrome.css");
  assert.equal((chrome.match(/--page-padding-x:/g) || []).length, 2, ".app-shell 과 앨범 계열 두 선언뿐");
  const others = cssFiles().filter((file) => !file.endsWith("AppChrome.css"))
    .filter((file) => /--page-padding-x\s*:/.test(readFileSync(file, "utf8")));
  assert.deepEqual(others, [], "다른 CSS 가 이 변수를 다시 정하지 않는다");
});

test("화면 CSS 에 좌우 여백 숫자를 적지 않는다", () => {
  const offenders: string[] = [];
  for (const screen of SCREEN_ROOTS) {
    // 인쇄 규칙(@media print)은 A4 판형이라 화면 여백과 무관하다 — 판정에서 뺀다.
    const css = read(screen.file).split("@media print")[0];
    // 이 선택자를 다루는 모든 규칙(반응형 포함)을 본다 — 예전에 미디어쿼리에 숨어 있었다.
    let from = 0;
    for (;;) {
      const at = css.indexOf(`${screen.selector} {`, from);
      if (at === -1) break;
      from = at + 1;
      const body = css.slice(at, css.indexOf("}", at));
      const horizontal = horizontalPadding(body);
      if (horizontal && /\d/.test(horizontal) && !horizontal.includes("var(--page-padding-x)") && !/^0(px|rem)?$/.test(horizontal)) {
        offenders.push(`${screen.name}(${screen.file}): ${horizontal}`);
      }
      // 폭 보정으로 여백을 흉내 내는 것도 같은 결함이다(calc(100% - 48px) 류).
      if (/width:\s*calc\(100% - \d/.test(body)) offenders.push(`${screen.name}: width calc 로 여백을 만든다`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("두 컨테이너가 같은 식을 쓴다 — 앨범 계열만 다른 자리에서 시작하지 않는다", () => {
  // ★ 좌표 실측은 브라우저에서 한다(jsdom 은 레이아웃도 var() 계산도 하지 않는다).
  //   여기서는 그 값이 다시 갈라지지 않도록 "같은 변수를 읽는다" 는 사실만 잠근다.
  const app = read("App.css");
  const gutter = (selector: string) => {
    const rule = app.slice(app.indexOf(selector), app.indexOf("}", app.indexOf(selector)));
    return /padding:\s*[^;]*?(var\(--page-padding-x\))/.exec(rule)?.[1] ?? null;
  };
  assert.equal(gutter(".app {"), "var(--page-padding-x)");
  assert.equal(gutter(".app--album {"), "var(--page-padding-x)");
  // 앨범 계열이 예전처럼 0 으로 되돌아가지 않는다.
  const album = app.slice(app.indexOf(".app--album {"), app.indexOf("}", app.indexOf(".app--album {")));
  assert.doesNotMatch(album, /padding: 0 0 /);
});
