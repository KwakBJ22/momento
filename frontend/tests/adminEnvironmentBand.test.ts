import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 관리자 화면에 지금 어느 쪽을 보고 있는지 띄운다.
 *
 * ★ /admin 에는 앨범 삭제 버튼이 있는데 개발과 운영 화면이 똑같이 생겼다.
 *   헷갈려서 운영 앨범을 지우면 되돌릴 수 없다.
 * ★ 판정은 **백엔드**가 한다 — GET /api/admin/me 의 `environment`.
 *   화면이 주소로 짐작하지 않는다. 주소는 바뀌고, 근거는 하나여야 한다(§10).
 *   (서버 쪽 판정은 backend/tests/test_deployment_environment.py 가 지킨다.)
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const console_ = readFileSync(path.join(SRC, "components/admin/AdminConsole.tsx"), "utf8");
const css = readFileSync(path.join(SRC, "components/admin/AdminConsole.css"), "utf8");
const api = readFileSync(path.join(SRC, "lib/adminApi.ts"), "utf8");

test("★ 판정 값은 서버 응답에서만 온다 — 주소를 보지 않는다", () => {
  assert.match(api, /environment\?: string/);
  assert.match(console_, /setDataEnvironment\(access\.environment \|\| "production"\)/);
  // 화면이 스스로 알아내려 드는 자리가 없다.
  const code = console_.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const guess of ["location.hostname", "location.host", "import.meta.env.DEV", "import.meta.env.MODE", "localhost", "dev.woorialbum"]) {
    assert.equal(code.includes(guess), false, `화면이 스스로 짐작한다: ${guess}`);
  }
});

test("★ 개발이면 띠가 뜨고, 운영이면 아무것도 안 뜬다", () => {
  assert.match(console_, /\{dataEnvironment === "development" \? \(\s*<p className="admin__env-band" role="status">개발 서버입니다<\/p>\s*\) : null\}/);
  // 운영 갈래에 다른 문구를 만들지 않았다 — 없는 것이 기본이다.
  assert.equal(console_.includes("운영 서버입니다"), false);
});

test("★ 못 물어봤을 때는 띠를 띄우지 않는다 — 운영에서 번쩍이면 안 된다", () => {
  assert.match(console_, /useState\("production"\)/);
  assert.match(console_, /createContext<string>\("production"\)/);
});

test("★ 지우는 버튼 옆에도 개발 데이터라고 적는다", () => {
  const actions = console_.slice(console_.indexOf('<div className="admin__actions">'), console_.indexOf("{pendingDeleteAlbumId ?"));
  assert.match(actions, />\s*삭제\s*<\/button>/);
  assert.match(actions, /<DevelopmentDataTag \/>/);
  // 표식도 같은 판정 하나를 본다 — 두 번째 근거를 만들지 않는다.
  assert.match(console_, /function DevelopmentDataTag\(\) \{[\s\S]{0,200}useIsDevelopmentData\(\)/);
  assert.match(console_, /if \(!isDevelopment\) return null;/);
});

test("★ danger 색을 쓰지 않는다 — 오류가 아니라 안내다 (I-5b)", () => {
  for (const selector of [".admin__env-band", ".admin__env-tag"]) {
    const rule = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
    assert.ok(rule.length > 0, `${selector} 규칙이 없다`);
    assert.equal(rule.includes("--c-danger"), false, `${selector} 가 오류색을 쓴다`);
    assert.equal(rule.includes("--c-warning"), false, `${selector} 가 경고색을 쓴다`);
    // 배경색이 있는 가로 줄이어야 눈에 걸린다.
    assert.match(rule, /background: var\(--admin-accent\)/);
  }
});

test("사용자 화면은 건드리지 않았다 — 문구는 관리자 파일 안에만 있다", () => {
  const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
  assert.equal(app.includes("개발 서버입니다"), false);
  assert.equal(readFileSync(path.join(SRC, "components/AppHeader.tsx"), "utf8").includes("개발 서버입니다"), false);
});
