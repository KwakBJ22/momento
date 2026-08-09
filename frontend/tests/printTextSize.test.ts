import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 열람용 PDF 의 글자가 전반적으로 작다 (I-4-5 · SCREEN_SPEC §9).
 *
 * A4 로 인쇄해 **손에 들고 읽는** 문서인데 본문이 11~12pt 였다.
 *
 * ★ 값은 **I-QUEUE 4-5 표 그대로**다. 재서 정하지 않는다(큐 규칙 6).
 *   기준은 A4 210×297mm, 96dpi 에서 폭 794px = 210mm. 인쇄 루트가 210mm 로 고정
 *   이라 표의 px 을 그대로 쓴다.
 */

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const coverCss = readFileSync(new URL("../src/album-engine/components/AlbumCover.css", import.meta.url), "utf8");
const epilogueCss = readFileSync(new URL("../src/album-engine/components/AlbumEpilogue.css", import.meta.url), "utf8");

/** 큐 4-5 표 그대로. 왼쪽이 변수 이름, 오른쪽이 표의 px 값. */
const QUEUE_TABLE: Array<[string, string]> = [
  ["--print-cover-title", "37px"],
  ["--print-cover-logo", "23px"],
  ["--print-cover-period", "16px"],
  ["--print-date-heading", "17px"],
  ["--print-caption", "15px"],
  ["--print-story-title", "16px"],
  ["--print-story-body", "15px"],
  ["--print-epilogue-title", "20px"],
  ["--print-epilogue-body", "15px"],
  ["--print-contributors", "14px"],
  ["--print-brand-logo", "29px"],
  ["--print-brand-line", "16px"],
];

test("★ 큐 4-5 표의 값이 그대로 들어 있다", () => {
  for (const [name, value] of QUEUE_TABLE) {
    assert.match(printCss, new RegExp(`${name}:\\s*${value};`), `${name} 이 표와 다르다`);
  }
});

test("★ 줄간격은 본문 1.6 · 제목 1.3 이다", () => {
  assert.match(printCss, /--print-leading-body:\s*1\.6;/);
  assert.match(printCss, /--print-leading-title:\s*1\.3;/);
});

test("★ 값은 인쇄 CSS 한 곳에만 둔다 — 자리마다 숫자를 흩지 않는다", () => {
  const declarationStart = printCss.indexOf(".album-renderer--print {");
  const declarationBlock = printCss.slice(declarationStart, printCss.indexOf("}", declarationStart));
  const rest = printCss.replace(declarationBlock, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const hardCoded = (rest.match(/font-size:[^;]+;/g) || []).filter((line) => !line.includes("var(--print-"));
  assert.deepEqual(hardCoded, [], `숫자가 흩어져 있다: ${hardCoded.join(" ")}`);

  // 표지·우리의 이야기도 같은 변수를 읽는다(자기 숫자를 만들지 않는다).
  assert.match(coverCss, /font-size: var\(--print-cover-title\)/);
  assert.match(coverCss, /font-size: var\(--print-cover-period\)/);
  assert.match(coverCss, /font-size: var\(--print-contributors\)/);
  assert.match(epilogueCss, /font-size: var\(--print-epilogue-body\)/);
});

test("★ 예전 값이 남아 있지 않다 (실측으로 정하던 mm·pt)", () => {
  assert.equal(epilogueCss.includes("font-size: 11pt"), false);
  assert.equal(/font-size:\s*[\d.]+mm/.test(printCss), false);
  assert.equal(/font-size:\s*[\d.]+mm/.test(coverCss), false);
});

test("계층이 뒤집히지 않는다 — 글이 사진을 이기면 안 된다(§6)", () => {
  const value = (name: string) => Number(printCss.match(new RegExp(`${name}:\\s*(\\d+)px`))![1]);
  // 표지 제목 > 브랜드 로고 > 표지 로고 > 우리의 이야기 제목 > 날짜 머리글 > 캡션
  assert.ok(value("--print-cover-title") > value("--print-brand-logo"));
  assert.ok(value("--print-brand-logo") > value("--print-cover-logo"));
  assert.ok(value("--print-cover-logo") > value("--print-epilogue-title"));
  assert.ok(value("--print-epilogue-title") > value("--print-date-heading"));
  assert.ok(value("--print-date-heading") > value("--print-caption"));
});

test("각 자리가 자기 변수를 읽는다 (엉뚱한 변수를 쓰지 않는다)", () => {
  const rule = (selector: string) => {
    const at = printCss.indexOf(selector);
    assert.notEqual(at, -1, `선택자가 없다: ${selector}`);
    const open = printCss.indexOf("{", at);
    return printCss.slice(open, printCss.indexOf("}", open));
  };
  assert.match(rule(".album-renderer--print .print-frame__caption .photo-memory-lines__text"), /var\(--print-caption\)/);
  assert.match(rule(".album-renderer--print .story-block__title"), /var\(--print-story-title\)/);
  assert.match(rule(".album-renderer--print .story-block__body"), /var\(--print-story-body\)/);
  assert.match(rule(".album-renderer--print .album-epilogue__title"), /var\(--print-epilogue-title\)/);
  assert.match(rule(".album-renderer--print .album-contributors"), /var\(--print-contributors\)/);
  assert.match(rule(".album-renderer--print .chapter-header--print-date .chapter-header__dayline"), /var\(--print-date-heading\)/);
  // 로고도 변수를 읽는다(표지·브랜드 쪽 각각).
  assert.match(printCss, /\.album-cover__brand \.album-brand-mark__word \{ font-size: var\(--print-cover-logo\); \}/);
  assert.match(printCss, /\.album-renderer__brand-page \.album-brand-mark__word \{ font-size: var\(--print-brand-logo\); \}/);
});
