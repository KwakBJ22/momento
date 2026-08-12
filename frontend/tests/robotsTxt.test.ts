import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 검색 노출 막기 — 링크를 받은 사람만 보는 자리는 색인하지 않는다.
 *
 * ★ 이것이 있어야 소개 페이지에 "링크를 받은 사람만 볼 수 있어요"를 **정직하게** 쓸 수 있다.
 *   robots.txt 는 착한 수집기에게만 통하지만, 우리가 공개적으로 색인을 원치 않는다고
 *   밝히는 유일한 자리다.
 * ★ 첫 화면과 소개는 색인되어야 한다 — 넷만 막는다.
 */

const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");

test("★ 링크로만 여는 자리 넷을 막는다", () => {
  assert.match(robots, /^User-agent: \*$/m);
  for (const path of ["/s/", "/join/", "/album/", "/admin"]) {
    assert.ok(robots.includes(`Disallow: ${path}`), `막히지 않았다: ${path}`);
  }
});

test("★ 첫 화면은 색인된다 — 전부 막지 않는다", () => {
  assert.match(robots, /^Allow: \/$/m);
  assert.equal(/^Disallow: \/$/m.test(robots), false, "사이트 전체가 막혔다");
});

test("Sitemap 줄을 넣지 않는다", () => {
  assert.equal(robots.includes("Sitemap"), false);
});
