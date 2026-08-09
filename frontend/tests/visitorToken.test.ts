import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 방문자를 **사람 단위**로 세기 위한 브라우저 토큰 (SCREEN_SPEC §1).
 *
 * `지금까지 N명이 다녀갔어요` 가 사실은 API 호출 수였다(프로덕션 165/139건, 실제 2명).
 * ★ 개인정보가 아니다 — 무작위 값이고 서버는 해시만 저장한다. IP·User-Agent 를 쓰지 않는다.
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("한 브라우저는 값 하나를 갖는다 (여러 번 열어도 같은 값)", async () => {
  const { getVisitorToken } = await import("../src/lib/visitorToken");
  localStorage.clear();
  const first = getVisitorToken();
  assert.ok(first && first.length >= 16);
  assert.equal(getVisitorToken(), first, "다시 불러도 같은 값이어야 한 명으로 세어진다");
  assert.equal(getVisitorToken(), first);
});

test("브라우저 데이터를 지우면 새 값이 된다 (되돌려 사람을 알아낼 수 없다)", async () => {
  const { getVisitorToken } = await import("../src/lib/visitorToken");
  localStorage.clear();
  const before = getVisitorToken();
  localStorage.clear();
  assert.notEqual(getVisitorToken(), before);
});

test("저장소를 못 쓰면 조용히 넘어간다 (숫자 하나 때문에 화면이 막히지 않는다)", async () => {
  const { getVisitorToken } = await import("../src/lib/visitorToken");
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } },
    configurable: true,
  });
  assert.equal(getVisitorToken(), null);
  if (original) Object.defineProperty(globalThis, "localStorage", original);
});

test("공유 앨범을 열 때 이 값을 보낸다", () => {
  const api = read("lib/api.ts");
  const fn = api.slice(api.indexOf("export async function getPublicShare"), api.indexOf("export async function startPublicContribution"));
  assert.match(fn, /headers\["X-Woorialbum-Visitor"\] = visitor/);
  // 로그인했으면 서버가 계정으로 센다 — 그래서 토큰도 함께 보낸다(판정은 서버 한 곳).
  assert.match(fn, /headers\.Authorization = `Bearer \$\{session\.accessToken\}`/);
});

test("개인정보를 새로 받지 않는다", () => {
  const source = read("lib/visitorToken.ts");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["email", "phone", "name", "userAgent", "navigator"]) {
    assert.equal(code.includes(forbidden), false, `쓰면 안 되는 값: ${forbidden}`);
  }
});

test("개인정보처리방침 두 문서에 이 저장 항목이 적혀 있다", () => {
  const md = readFileSync(new URL("../../docs/PRIVACY_POLICY.md", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  for (const line of ["방문 구분용 무작위 값", "서버에는 이 값의 해시만 저장합니다", "브라우저 데이터 삭제 시"]) {
    assert.ok(md.includes(line), `PRIVACY_POLICY.md: ${line}`);
    assert.ok(html.includes(line), `privacy.html: ${line}`);
  }
});
