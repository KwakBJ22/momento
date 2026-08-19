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

/**
 * ★ 2026-08-16 — 인쇄 판형이 정사각 200×200mm 하나가 되면서 **단위를 pt 로 옮겼다.**
 *   종이에서 크기를 말하는 단위는 pt 다. px 은 지면 폭(210mm)에 매인 값이라 판형이
 *   바뀌면 자리마다 다시 환산해야 했다. 표는 PrintPages.css 머리말에 있다.
 *   지키는 것은 그대로다: **값은 한 곳** · 계층이 뒤집히지 않음 · 8pt 하한.
 */
const PRINT_TYPE_TABLE: Array<[string, string]> = [
  ["--print-cover-title", "28pt"],
  ["--print-cover-logo", "17pt"],
  ["--print-cover-period", "12pt"],
  ["--print-date-heading", "11pt"],
  ["--print-caption", "9pt"],
  ["--print-story-title", "12pt"],
  ["--print-story-body", "9.5pt"],
  ["--print-epilogue-title", "15pt"],
  ["--print-epilogue-body", "9.5pt"],
  ["--print-contributors", "10.5pt"],
  ["--print-brand-logo", "22pt"],
  ["--print-brand-line", "12pt"],
];

test("★ 인쇄 글자 표의 값이 그대로 들어 있다", () => {
  for (const [name, value] of PRINT_TYPE_TABLE) {
    assert.match(printCss, new RegExp(`${name}:\\s*${value};`), `${name} 이 표와 다르다`);
  }
});

test("★ 8pt 아래로 내려가지 않는다 — 40대 이후 타깃의 하한", () => {
  const sizes = [...printCss.matchAll(/--print-[a-z-]+:\s*([\d.]+)pt;/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length >= PRINT_TYPE_TABLE.length, "pt 로 적힌 값이 표보다 적다");
  const smallest = Math.min(...sizes);
  assert.ok(smallest >= 8, `가장 작은 글자가 ${smallest}pt 다`);
});

test("★ 줄간격은 본문 1.6 · 제목 1.3 · 이야기 1.75 다", () => {
  assert.match(printCss, /--print-leading-body:\s*1\.6;/);
  assert.match(printCss, /--print-leading-title:\s*1\.3;/);
  // ★ 2026-08-16 — 이야기 본문만 1.75 다(시안 §4). 손에 들고 읽는 글이라 더 넉넉하다.
  assert.match(printCss, /--print-leading-story:\s*1\.75;/);
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

test("★ 크기를 자리마다 흩지 않는다 — 숫자는 변수 선언에만 있다", () => {
  // ★ 2026-08-16 — 예전에는 `pt 로 적힌 값` 자체를 금지했다(그때는 px 이 기준이었다).
  //   이제 기준이 pt 라, 금지할 것은 **자리에 직접 적힌 숫자**다. mm 는 여전히 안 쓴다.
  assert.equal(epilogueCss.includes("font-size: 11pt"), false, "자리에 숫자를 직접 적었다");
  assert.equal(/font-size:\s*[\d.]+mm/.test(printCss), false);
  assert.equal(/font-size:\s*[\d.]+mm/.test(coverCss), false);
});

test("계층이 뒤집히지 않는다 — 글이 사진을 이기면 안 된다(§6)", () => {
  const value = (name: string) => Number(printCss.match(new RegExp(`${name}:\\s*([\\d.]+)pt`))![1]);
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
  // ★ 2026-08-19 — 표지에서 로고가 빠졌다(시안 §2). 이 서비스를 알리는 자리는
  //   **마지막 장**이다. 그래서 표지 로고 줄은 더 볼 것이 없고, 브랜드 쪽만 본다.
  //   표지 제목은 모양마다 크기가 달라 아래에서 따로 잠근다.
  assert.match(printCss, /\.album-renderer__brand-page \.album-brand-mark__word \{ font-size: var\(--print-brand-logo\); \}/);
});
