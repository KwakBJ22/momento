import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 마지막 장 — **무료판에만** 붙는다 (시안 `print-layout-v3` §6).
 *
 * ★ **뒤집힘 (2026-08-19).** 예전에는 `마지막 브랜드 쪽`(I-4-6 · SCREEN_SPEC §9)이었다:
 *   로고를 **쪽 가운데 크게** 앉히고 `이 PDF 가 이 서비스를 알리는 유일한 자리`로 삼았다.
 *   시안이 그것을 바꾼다 —
 *     · 무게를 **아래쪽에만** 둔다(위는 비운다)
 *     · **로고를 활자 한 줄로 대신한다**(그림 로고를 쓰지 않는다)
 *     · 광고가 아니라 조용한 안내다: 묻는 말 한 줄 + 무엇인지 한 줄 + 주소
 *   지키려던 것(독립 한 장 · 없는 것을 약속하지 않는다)은 그대로다.
 *
 * ★ QR 은 아직 없다. 시안에는 있지만 붙일 그림이 저장소에 없고, 코드를 지어내면
 *   찍힌 책에서 안 읽힌다. 주소는 활자로 적어 두었다 — 그림이 생기면 그 자리에 넣는다.
 */

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("../src/lib/brand.ts", import.meta.url), "utf8");

function rule(selector: string): string {
  const start = printCss.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `규칙이 없다: ${selector}`);
  return printCss.slice(start + selector.length + 2, printCss.indexOf("}", start));
}

test("★ 로고를 활자 한 줄로 대신한다 — 그림 로고를 앉히지 않는다", () => {
  // ★ **인쇄 갈래만** 본다. 화면 갈래는 예전 그대로 로고를 쓴다 — 시안이 바꾼 것은
  //   인쇄의 마지막 장이고, 화면은 건드리지 않는다.
  const start = renderer.indexOf('<section className="album-renderer__brand-page">');
  const section = renderer.slice(start, renderer.indexOf("</section>", start));
  const printBranch = section.slice(0, section.indexOf(") : ("));
  assert.equal(printBranch.includes("<BrandMark"), false, "인쇄 마지막 장에 그림 로고가 남아 있다");
  // 활자 두 줄 — 영문 이름과 주소.
  assert.match(printBranch, /album-renderer__brand-en/);
  assert.match(printBranch, /album-renderer__brand-url/);
  // 화면은 로고 그대로다(회귀).
  assert.match(section.slice(section.indexOf(") : (")), /<BrandMark/);
  // 로고 크기를 주던 규칙도 함께 걷어냈다(쓸 자리가 없어졌다).
  assert.equal(
    /\.album-renderer__brand-page \.album-brand-mark__word \{/.test(printCss),
    false,
    "쓰지 않는 로고 규칙이 남아 있다",
  );
});

test("★ 무게를 아래쪽에만 둔다 — 위는 비운다 (시안 §6)", () => {
  const blocks = printCss.split(".album-renderer--print .album-renderer__brand-page {").slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("}")));
  assert.ok(
    blocks.some((block) => /justify-content: flex-end/.test(block)),
    "아래쪽으로 모으는 규칙이 없다",
  );
  // 독립 한 장이라는 규칙은 그대로다(§9).
  assert.ok(
    blocks.some((block) => /aspect-ratio: 1 \/ 1/.test(block))
      || /\.album-cover,[\s\S]{0,80}brand-page \{[\s\S]{0,160}aspect-ratio: 1 \/ 1/.test(printCss),
    "한 장 크기 규칙이 없다",
  );
});

test("★ 묻는 말 한 줄과 무엇인지 한 줄 — 문자열은 lib/brand 한 곳에 있다 (§3)", () => {
  assert.match(brand, /BRAND_LAST_PAGE_ASK = "우리도 만들어볼까\?"/);
  assert.match(brand, /BRAND_LAST_PAGE_BODY = /);
  const start = renderer.indexOf('<section className="album-renderer__brand-page">');
  const section = renderer.slice(start, renderer.indexOf("</section>", start));
  assert.match(section, /\{BRAND_LAST_PAGE_ASK\}/);
  assert.match(section, /\{BRAND_LAST_PAGE_BODY\}/);
  // 자리에 문자열을 직접 적지 않는다.
  assert.equal(section.includes("우리도 만들어볼까"), false, "문자열을 자리에 적었다");
});

test("★ 안내 글줄이 너무 길어지지 않는다 (시안 330px = 103mm)", () => {
  assert.match(rule(".album-renderer--print .album-renderer__brand-ask-body"), /max-width: 103mm/);
});

test("없는 것을 약속하지 않는다 (§10) — `곧`도 값도 적지 않는다", () => {
  const start = renderer.indexOf('<section className="album-renderer__brand-page">');
  const section = renderer.slice(start, renderer.indexOf("</section>", start));
  for (const token of ["http", "www.", "곧", "준비 중", "출시", "원"]) {
    assert.equal(section.includes(token), false, `약속: ${token}`);
  }
});
