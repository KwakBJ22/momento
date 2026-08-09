import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 열람용 PDF 의 글자가 전반적으로 작다 (I-4-5 · SCREEN_SPEC §9).
 *
 * A4 로 인쇄해 **손에 들고 읽는** 문서인데 본문이 11~12pt 였다. 화면 크기 감각으로
 * 정하면 이렇게 된다. ★ 키우는 기준은 **A4 실측**이다.
 *
 * 잰 값 → 정한 값 (210×297mm 위에서, 1mm = 2.8346pt)
 *   캡션(한마디)       3.81mm 10.8pt → 4.4mm 12.5pt
 *   날짜 이야기 본문    4.23mm 12.0pt → 4.8mm 13.6pt
 *   우리의 이야기 본문  3.88mm 11.0pt → 4.8mm 13.6pt
 *   날짜 이야기 제목    4.91mm 13.9pt → 5.6mm 15.9pt
 *   우리의 이야기 제목  5.93mm 16.8pt → 7.0mm 19.8pt
 *   함께 만든 사람      4.23mm 12.0pt → 4.8mm 13.6pt
 *   날짜 머리글        3.90mm 11.1pt → 6.0mm 17.0pt (I-4-3)
 *
 * 근거: 문화체육관광부 큰글자도서 기준이 본문 14pt 내외, 일반 단행본이 9~10.5pt 다.
 * 주 독자가 40~60대이므로 그 사이 위쪽에 둔다. 다만 이 문서는 책이 아니라 사진첩이라
 * **글이 사진을 이기면 안 된다**(§6) — 그래서 큰글자책 하한 아래다.
 */

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const epilogueCss = readFileSync(new URL("../src/album-engine/components/AlbumEpilogue.css", import.meta.url), "utf8");

const MM_TO_PT = 2.8346;

/** 인쇄 규칙에서 font-size 를 mm 로 읽는다.
 *  선택자가 여러 개 묶인 규칙도 있으므로, 그 선택자 **다음에 오는 블록**을 읽는다. */
function fontMm(css: string, selector: string): number {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `선택자가 없다: ${selector}`);
  const open = css.indexOf("{", at);
  const body = css.slice(open, css.indexOf("}", open));
  const match = body.match(/font-size:\s*([\d.]+)mm/);
  assert.ok(match, `${selector}: mm 로 적혀 있지 않다(실측 기준이 아니다)`);
  return Number(match![1]);
}

const CAPTION = ".album-renderer--print .print-frame__caption .photo-memory-lines__text";
const EPILOGUE_BODY = ".album-renderer--print .album-epilogue__special p";

test("★ 본문은 13.6pt 다 — 손에 들고 읽는 크기", () => {
  for (const [name, size] of [
    ["날짜 이야기", fontMm(printCss, ".album-renderer--print .story-block__body")],
    ["우리의 이야기", fontMm(epilogueCss, EPILOGUE_BODY)],
  ] as const) {
    assert.equal(size, 4.8, name);
    assert.ok(Math.abs(size * MM_TO_PT - 13.6) < 0.2, `${name}: ${(size * MM_TO_PT).toFixed(1)}pt`);
  }
});

test("★ 캡션은 본문보다 한 단계 작다 — 사진에 딸린 말임이 크기로도 보인다(§6)", () => {
  const caption = fontMm(printCss, CAPTION);
  assert.equal(caption, 4.4);
  assert.ok(caption < 4.8, "캡션이 본문보다 크면 계층이 뒤집힌다");
  // 그래도 예전보다는 크다 — 그것이 이 항목의 목적이다.
  assert.ok(caption > 3.81, "고치기 전(3.81mm)보다 커야 한다");
});

test("★ 계층: 날짜 머리글 > 이야기 제목 > 이야기 본문 > 캡션", () => {
  const sizes = [
    fontMm(printCss, ".album-renderer--print .chapter-header--print-date .chapter-header__dayline"),
    fontMm(printCss, ".album-renderer--print .story-block__title"),
    fontMm(printCss, ".album-renderer--print .story-block__body"),
    fontMm(printCss, CAPTION),
  ];
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index] < sizes[index - 1], `${index}번째가 앞보다 크다: ${sizes.join(" > ")}`);
  }
  // 앨범 전체를 닫는 글의 제목이 가장 크다.
  assert.equal(fontMm(printCss, ".album-renderer--print .album-epilogue__title"), 7);
});

test("★ 크기를 pt·rem 이 아니라 mm 로 적는다 — A4 실측 기준임을 코드가 말한다", () => {
  const printSizes = printCss.match(/font-size:\s*[\d.]+(mm|pt|rem|px)/g) || [];
  assert.ok(printSizes.length >= 6, "인쇄 글자 크기 규칙을 못 읽었다");
  for (const declaration of printSizes) {
    assert.match(declaration, /mm$/, `mm 가 아니다: ${declaration}`);
  }
  // 예전 pt 값이 남아 있지 않다.
  assert.equal(epilogueCss.includes("font-size: 11pt"), false);
});

test("함께 만든 사람 줄은 본문과 같다 — 인쇄물에 남는 이름 줄이다(CLAUDE.md §6)", () => {
  assert.equal(fontMm(printCss, ".album-renderer--print .album-contributors"), 4.8);
});

test("값을 한 곳에서만 정한다 — 같은 선택자를 두 파일에 적지 않는다", () => {
  // 우리의 이야기 본문 크기는 AlbumEpilogue.css 에만 있다(PrintPages.css 에 중복 금지).
  assert.equal(printCss.includes(".album-epilogue__body"), false);
  assert.match(epilogueCss, /\.album-renderer--print \.album-epilogue__body/);
});
