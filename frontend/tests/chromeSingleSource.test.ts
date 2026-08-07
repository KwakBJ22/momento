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
  const headerAt = app.indexOf("{!adminRoute ? <AppHeader /> : null}");
  const containerAt = app.indexOf('<div className={adminRoute ? "app app--album admin-app"');
  assert.ok(headerAt > -1 && containerAt > -1, "둘 다 있어야 한다");
  assert.ok(headerAt < containerAt, "헤더가 컨테이너 밖(앞)에 있어야 한다");
});

test("헤더 막대는 화면 좌우 끝까지 닿는다 — 안쪽 내용만 모은다", () => {
  const css = read("components/AppChrome.css");
  const header = css.slice(css.indexOf(".app-header {"), css.indexOf("}", css.indexOf(".app-header {")));
  assert.match(header, /width: 100%/);
  // 넓은 화면에서 내용을 모으는 것은 padding 으로 한다(margin auto 로 막대를 줄이지 않는다).
  assert.match(header, /padding: 4px max\(16px, calc\(\(100% - 900px\) \/ 2\)\)/);
  assert.doesNotMatch(header, /margin: 0 auto/);
  assert.doesNotMatch(header, /max-width/);
});
