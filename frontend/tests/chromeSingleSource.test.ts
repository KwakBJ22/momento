import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

// 2026-08-07: 헤더 구현이 두 벌이라(공용 AppHeader + 앨범 화면 자체 헤더 + "전역 헤더를
// 감춘다" 분기) 고칠 때마다 한쪽만 반영돼 화면마다 어긋났다. 하루에 세 번 그랬다.
// 다시 갈라지지 않게 "만드는 곳이 하나"임을 소스 전체에서 잠근다.
test("헤더 마크업(브랜드 + 우측 slot)을 만드는 컴포넌트는 하나뿐이다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file.endsWith("AppHeader.tsx")) continue;      // 유일한 정의
    if (file.includes(`admin${join("", "")}`) || file.includes("AdminConsole")) continue; // 관리자 콘솔은 이 문서 적용 제외
    const text = readFileSync(file, "utf8");
    if (/className="app-header"/.test(text)) offenders.push(`${file.replace(SRC, "")}: app-header`);
    if (/className="app-header__right"/.test(text)) offenders.push(`${file.replace(SRC, "")}: app-header__right`);
    if (/app-header__brand/.test(text)) offenders.push(`${file.replace(SRC, "")}: brand`);
  }
  assert.deepEqual(offenders, []);
  // 다른 화면은 slot 통로(HeaderRight)만 쓴다.
  assert.match(read("components/AlbumScreen.tsx"), /import \{ HeaderRight \} from "\.\/AppHeader"/);
});

test("푸터도 하나뿐이다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file.endsWith("AppFooter.tsx")) continue;
    const text = readFileSync(file, "utf8");
    if (/className=\{?`?app-footer/.test(text)) offenders.push(file.replace(SRC, ""));
  }
  assert.deepEqual(offenders, []);
  // App 이 한 번만 그린다(화면이 각자 그리지 않는다).
  assert.equal((read("App.tsx").match(/<AppFooter /g) || []).length, 1);
  // 앨범 렌더러의 brand-footer 는 인쇄물 안의 요소라 다른 것이다(같은 자리 아님).
  assert.match(read("album-engine/AlbumRenderer.tsx"), /album-renderer__brand-footer/);
});

test("헤더 높이는 한 규칙이 정한다 — 모든 화면 52px", () => {
  const css = read("components/AppChrome.css");
  const header = css.slice(css.indexOf(".app-header {"), css.indexOf("}", css.indexOf(".app-header {")));
  assert.match(header, /min-height: 52px/);
  // 화면별로 높이를 다시 잡는 규칙이 없다(예전 .app__header / .album-screen__hdr 잔재).
  for (const file of ["App.css", "components/AlbumScreen.css", "components/JoinPage.css", "components/AlbumResult.css"]) {
    assert.doesNotMatch(read(file), /\.app__header\b|\.album-screen__hdr\b/, `${file}: 옛 헤더 규칙 잔재`);
  }
});

// ★ 높이만 재면 놓친다 — 실기기에서는 **바깥 컨테이너** 때문에 화면마다 위 여백과 좌우
// 들여쓰기가 달라 보였다(.app: padding 24px 16px, max-width 480px). 위치와 좌우 여백까지
// 계약으로 잠근다.
test("헤더는 페이지 컨테이너 밖에 있다 — 컨테이너 여백이 헤더에 걸리지 않는다", () => {
  const app = read("App.tsx");
  // 헤더가 .app 컨테이너보다 **먼저**, 그 바깥에 온다.
  // ★ K-20 에서 헤더가 `onNavigateHome` 을 받는다 — 자리 규칙은 그대로다.
  const headerAt = app.indexOf("{!adminRoute ? <AppHeader onNavigateHome=");
  const containerAt = app.indexOf('<div className={adminRoute ? "app app--album admin-app"');
  assert.ok(headerAt > -1 && containerAt > -1, "둘 다 있어야 한다");
  assert.ok(headerAt < containerAt, "헤더가 컨테이너 밖(앞)에 있어야 한다");
});

test("헤더 막대는 화면 좌우 끝까지 닿는다 — 안쪽 내용만 모은다", () => {
  const css = read("components/AppChrome.css");
  const header = css.slice(css.indexOf(".app-header {"), css.indexOf("}", css.indexOf(".app-header {")));
  assert.match(header, /width: 100%/);
  // 넓은 화면에서 내용을 모으는 것은 padding 으로 한다(margin auto 로 막대를 줄이지 않는다).
  // ★ 4px → 14px/12px (2026-08-13 · 시안 .hdr 값). 4px 은 44px 누름 영역이
  //   테두리에 거의 닿아 헤더가 답답했다. 보는 규칙(여백이 변수에서 온다)은 그대로다.
  assert.match(header, /padding: 14px max\(var\(--page-padding-x\)/); // 값은 변수에서 온다
  assert.doesNotMatch(header, /margin: 0 auto/);
  // 막대 자체에 max-width 를 걸지 않는다(--page-max-width 는 안쪽 padding 계산에만 쓴다).
  assert.doesNotMatch(header, /^\s*max-width:/m);
});

// 헤더 막대는 화면 끝까지 닿되, 안쪽 내용은 본문과 같은 폭·같은 자리에서 시작한다.
// 넓은 화면에서 브랜드가 본문보다 바깥으로 벌어지면 안 된다.
test("헤더 안쪽 폭은 본문과 같은 변수 하나에서 나온다", () => {
  const chrome = read("components/AppChrome.css");
  const appCss = read("App.css");
  // ★ 값은 한 곳(.app-shell)에만 있다.
  // ★ 16px → 20px (시안 docs/mockups 의 .body 값). 16px 은 내용이 화면 가장자리에
  //   붙어 보였다. 폭·여백이 변수 한 곳에서 나온다는 규칙은 그대로다.
  assert.match(chrome, /\.app-shell \{[\s\S]*--page-max-width: 480px;[\s\S]*--page-padding-x: 20px;/);
  // 화면군에 따라 본문이 넓어지면 헤더도 따라간다(같은 변수를 덮어쓴다).
  assert.match(chrome, /\.app-shell--album \{[\s\S]*--page-max-width: 1120px;/);
  // 본문과 헤더가 **둘 다** 그 변수를 읽는다. 숫자를 각자 적지 않는다.
  const app = appCss.slice(appCss.indexOf(".app {"), appCss.indexOf("}", appCss.indexOf(".app {")));
  assert.match(app, /max-width: var\(--page-max-width\)/);
  // J-4 뒤로 위 여백도 같은 곳(--page-padding-top)에서 읽는다. 값(24px)은 예전 1.5rem 그대로다.
  assert.match(app, /padding: var\(--page-padding-top\) var\(--page-padding-x\) 2rem/);
  assert.match(chrome, /--page-padding-top: 24px;/);
  const header = chrome.slice(chrome.indexOf(".app-header {"), chrome.indexOf("}", chrome.indexOf(".app-header {")));
  assert.match(header, /var\(--page-max-width\)/);
  assert.match(header, /var\(--page-padding-x\)/);
});

test("헤더 안쪽 좌측 x 가 본문 좌측 x 와 같은 식으로 계산된다", () => {
  const chrome = read("components/AppChrome.css");
  const header = chrome.slice(chrome.indexOf(".app-header {"), chrome.indexOf("}", chrome.indexOf(".app-header {")));
  // 본문(.app)은 border-box 라 내용이 (가운데 정렬 + 좌우 padding) 만큼 안쪽에서 시작한다.
  // 헤더 padding 식도 같은 자리를 만든다: max(padding, (100% - width)/2 + padding).
  assert.match(header, /max\(var\(--page-padding-x\), calc\(\(100% - var\(--page-max-width\)\) \/ 2 \+ var\(--page-padding-x\)\)\)/);
  // 껍데기가 변수를 공유한다(헤더는 여전히 본문 컨테이너 밖이다).
  const app = read("App.tsx");
  assert.match(app, /className=\{`app-shell\$\{isAlbumSurface \|\| adminRoute \? " app-shell--album" : ""\}`\}/);
});

// 검은 버튼과 토큰 밖 색을 남기지 않는다. 값이 CSS 안에 직접 적히면 다음에 여기만 안 바뀐다.
test("실사용 화면 CSS 에 토큰 밖 검정 계열 hex 가 없다", () => {
  // 실사용 화면만 본다(관리자 콘솔은 이 문서 적용 제외).
  const files = ["App.css", "components/AlbumScreen.css", "components/AppChrome.css",
    "components/JoinPage.css", "components/ContributeWorkspace.css", "components/CollaborationPanel.css",
    "components/AlbumResult.css", "components/AlbumBottomNavigation.css", "components/UploadForm.css",
    "components/AlbumScreenHeader.css", "components/PhotoCommentList.css"];
  const offenders: string[] = [];
  for (const file of files) {
    const text = read(file).split(new RegExp("\r?\n"))
      .filter((line) => !line.trim().startsWith("/*") && !line.trim().startsWith("*"))
      .join(String.fromCharCode(10));
    for (const hex of text.match(/#[0-9a-fA-F]{6}\b/g) || []) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      // 상대 밝기가 낮은(검정 계열) 값만 잡는다 — 그런 색은 토큰에서 와야 한다.
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 90) offenders.push(`${file}: ${hex}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("주 버튼은 브랜드 액션 색이다 — 검은 배경을 쓰지 않는다", () => {
  const collab = read("components/CollaborationPanel.css");
  const primary = collab.slice(collab.indexOf(".collab-panel__primary {"), collab.indexOf("}", collab.indexOf(".collab-panel__primary {")));
  assert.match(primary, /background: var\(--c-brand-action\)/);
  assert.doesNotMatch(primary, /var\(--c-text\)/);
  // ★ !important 를 남기지 않는다 — 있으면 다음에 또 여기만 안 바뀐다.
  assert.doesNotMatch(primary, /!important/);
});
