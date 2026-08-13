import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * 브랜드 심볼 SVG (2026-08-13 · 클로드 디자인에서 받은 원본 그대로).
 *
 * ★ 세 변종을 함께 둔다: 브랜드색 · 흰색 · currentColor. 색만 다른 파일을 나중에
 *   손으로 만들면 모양이 갈라진다 — 받은 그대로 셋을 보관한다.
 * ★ 파비콘은 SVG 를 **먼저** 걸되 .ico · png 를 지우지 않는다. 카카오 인앱 브라우저가
 *   예전 아이콘을 캐시로 물고 있어(P7) png 가 아직 실제로 쓰인다.
 */
test("SVG 심볼 세 변종이 public 에 있다", () => {
  for (const name of ["wooria-symbol.svg", "wooria-symbol-white.svg", "wooria-symbol-currentcolor.svg"]) {
    assert.ok(existsSync(path.join(ROOT, "public", name)), `public/${name} 이 없다`);
  }
  assert.match(read("public/wooria-symbol.svg"), /stroke="#FF6B6B"/);
  assert.match(read("public/wooria-symbol-white.svg"), /stroke="#FFFFFF"/);
  assert.match(read("public/wooria-symbol-currentcolor.svg"), /stroke="currentColor"/);
});

test("SVG 파비콘을 먼저 두고, 예전 것을 지우지 않는다", () => {
  const html = read("index.html");
  const svgAt = html.indexOf('href="/wooria-symbol.svg"');
  const icoAt = html.indexOf('href="/favicon.ico"');
  assert.ok(svgAt > 0, "SVG 파비콘 연결이 없다");
  assert.ok(svgAt < icoAt, "SVG 가 .ico 보다 먼저여야 브라우저가 그것을 고른다");
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /href="\/icon-192\.png"/);
});
