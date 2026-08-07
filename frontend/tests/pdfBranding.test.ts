import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BRAND_PDF_INVITE } from "../src/lib/brand";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// docs/PRINT_LAYOUT.md §8 — 무료 PDF 에는 브랜드가 남는다(유료 인쇄용에는 넣지 않는다).
// 지금 넣는 것은 로고 한 줄까지다. QR·별도 브랜드 페이지·워터마크는 판형 재작성 때.
test("브랜드 표시는 문서 안에 그린다 — 외부 이미지 파일을 부르지 않는다", () => {
  const mark = read("album-engine/components/BrandMark.tsx");
  assert.match(mark, /<svg /);                  // 인라인 SVG
  assert.doesNotMatch(mark, /<img |url\(|src=/); // 외부 파일·원격 주소 금지
  // html2canvas 가 로드를 놓쳐 빈 자리로 찍히는 일을 막기 위한 조건이다.
});

test("로고는 작다 — 사진이 주인공이다", () => {
  const css = read("album-engine/AlbumRenderer.css");
  const icon = css.slice(css.indexOf(".album-brand-mark__icon {"), css.indexOf("}", css.indexOf(".album-brand-mark__icon {")));
  assert.match(icon, /width: 14px;/);
  assert.match(icon, /height: 14px;/);
  // 색은 토큰만 쓴다(새 색을 만들지 않는다).
  assert.match(icon, /color: var\(--c-brand\);/);
  const word = css.slice(css.indexOf(".album-brand-mark__word {"), css.indexOf("}", css.indexOf(".album-brand-mark__word {")));
  assert.match(word, /color: var\(--c-brand-text\);/);
  assert.doesNotMatch(`${icon}${word}`, /#[0-9a-fA-F]{3,6}/); // 하드코딩 색 없음
});

test("PDF 마지막 줄 문구: 만들 수 있다는 것만 말하고 약속하지 않는다", () => {
  assert.equal(BRAND_PDF_INVITE, "우리 가족의 앨범도 이렇게 만들 수 있어요.");
  for (const forbidden of ["곧", "준비 중", "출시 예정", "가입하면", "업그레이드", "AI", "GPT", "인공지능"]) {
    assert.equal(BRAND_PDF_INVITE.includes(forbidden), false, `쓰지 않는 표현: ${forbidden}`);
  }
  // ★ 주소·도메인을 적지 않는다 — 아직 확정되지 않았고 인쇄물은 되돌릴 수 없다.
  assert.doesNotMatch(BRAND_PDF_INVITE, /https?:|\.com|\.kr|\.app/);
});

test("브랜드 표시는 화면·공유·PDF 의 같은 자리에 함께 온다", () => {
  const renderer = read("album-engine/AlbumRenderer.tsx");
  // 푸터가 두 곳에서 만들어지므로(본문 끝·폴백) 양쪽 모두에 들어가야 한다.
  assert.equal((renderer.match(/<BrandMark label=\{BRAND_NAME_KO\} \/>/g) || []).length, 2);
  assert.equal((renderer.match(/\{BRAND_PDF_INVITE\}/g) || []).length, 3); // screen a + print p + 폴백 a
  // 문자열을 직접 쓰지 않는다(브랜드 상수 모듈 한 곳에서 읽는다).
  assert.doesNotMatch(renderer, /가족과 함께 추억을 이어가 보세요/);
});

test("QR·워터마크·별도 브랜드 페이지는 아직 넣지 않는다 (§8 구현 시점)", () => {
  const renderer = read("album-engine/AlbumRenderer.tsx");
  const mark = read("album-engine/components/BrandMark.tsx");
  for (const source of [renderer, mark]) {
    assert.doesNotMatch(source, /qr|QRCode|watermark/i);
  }
});
