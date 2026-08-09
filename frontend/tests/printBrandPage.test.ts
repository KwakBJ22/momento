import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 마지막 브랜드 쪽 (I-4-6 · SCREEN_SPEC §9 `마지막 브랜드 페이지`).
 *
 * 실물 7쪽에서 본 것:
 *   · 위쪽 절반이 비어 있다 — 내용을 페이지 가운데로.
 *   · 로고가 작다 — 이 쪽은 **브랜드를 보여주는 쪽**이라 크게. 실측 3.7mm 였다.
 *     `.brand-mark { font-size: 16mm }` 이 적혀 있었지만 아무 효과가 없었다:
 *     로고 글자 크기가 화면 기준 rem 고정값이라 부모의 font-size 를 물려받지 않는다.
 *   · 문구 둘째 줄 앞에 공백이 하나 들어가 보인다 — 문자열에는 공백이 없었다.
 *     두 줄을 **따로 가운데 맞추다 보니** 길이 차이만큼 시작 위치가 어긋난 것이다
 *     (실측 55.94mm vs 56.68mm — 0.74mm, 글자 하나 폭).
 */

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("../src/lib/brand.ts", import.meta.url), "utf8");

function rule(selector: string): string {
  const start = printCss.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `규칙이 없다: ${selector}`);
  return printCss.slice(start + selector.length + 2, printCss.indexOf("}", start));
}

test("★ 로고를 실제로 키운다 — rem 고정값이라 부모 font-size 로는 안 커진다", () => {
  const shared = readFileSync(new URL("../src/album-engine/AlbumRenderer.css", import.meta.url), "utf8");
  assert.match(shared, /\.album-brand-mark__word \{[\s\S]{0,80}font-size: 0\.78rem/);
  // 그래서 조각마다 mm 로 직접 준다.
  assert.match(printCss, /\.album-renderer__brand-page \.album-brand-mark__word \{ font-size: var\(--print-brand-logo\); \}/);
  assert.match(printCss, /\.album-renderer__brand-page \.album-brand-mark__icon \{ width: var\(--print-brand-logo\); height: var\(--print-brand-logo\); \}/);
  // 아무 효과가 없던 예전 규칙은 없앴다.
  assert.equal(/\.album-renderer__brand-page \.brand-mark \{/.test(printCss), false);
});

test("★ 이 쪽 로고가 표지보다 크다 — 브랜드를 보여주는 쪽이다(§9)", () => {
  const size = (name: string) => Number(printCss.match(new RegExp(`${name}:\\s*(\\d+)px`))![1]);
  const brandPage = size("--print-brand-logo");
  const cover = size("--print-cover-logo");
  assert.ok(brandPage > cover, `${brandPage}px 가 표지 ${cover}px 보다 커야 한다`);
});

test("★ 둘째 줄 앞의 공백 — 문자열이 아니라 가운데 정렬 때문이었다", () => {
  // 문자열에는 공백이 없다(지어낸 원인이 아님을 못박는다).
  const invite = brand.match(/BRAND_PDF_INVITE = "([^"]*)"/)![1];
  assert.equal(invite, invite.trim());
  assert.equal(invite.startsWith(" "), false);

  // 고친 방식: 두 줄을 한 상자에 묶고 그 상자를 가운데 둔다. 안에서는 왼쪽을 맞춘다.
  assert.match(renderer, /<div className="album-renderer__brand-lines">/);
  const lines = rule(".album-renderer--print .album-renderer__brand-lines");
  assert.match(lines, /width: fit-content/);
  assert.match(lines, /margin: 0 auto/);
  assert.match(lines, /text-align: left/);
});

test("내용이 페이지 가운데에 있다", () => {
  // 이 선택자에 규칙이 둘이다(한 장 크기 / 배치) — 배치 쪽을 찾는다.
  const blocks = printCss.split(".album-renderer--print .album-renderer__brand-page {").slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("}")));
  assert.ok(blocks.some((block) => /justify-content: center/.test(block) && /align-items: center/.test(block)),
    "가운데 정렬 규칙이 없다");
  // 한 장 크기 규칙도 그대로 있다(§9 — 독립 페이지).
  assert.ok(blocks.some((block) => /aspect-ratio: 210 \/ 297/.test(block))
    || /\.album-cover,[\s\S]{0,80}brand-page \{[\s\S]{0,120}aspect-ratio: 210 \/ 297/.test(printCss),
    "한 장 크기 규칙이 없다");
});

test("없는 것을 약속하지 않는다 (§10) — 주소도 `곧`도 적지 않는다", () => {
  const start = renderer.indexOf('<section className="album-renderer__brand-page">');
  const section = renderer.slice(start, renderer.indexOf("</section>", start));
  for (const token of ["http", "www.", "곧", "준비 중", "출시"]) {
    assert.equal(section.includes(token), false, `약속: ${token}`);
  }
});
