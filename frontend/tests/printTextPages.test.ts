import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";
import { formatPrintDateMeta, formatPrintDateNumber } from "../src/album-engine/engine/chapterGroup";

/**
 * 글이 들어가는 자리 — 시안 `print-layout-v3` §3.
 *
 *     월 시작 쪽    큰 숫자 하나. 사진 없는 쪽이라 아래에 무게를 모으고 위를 비운다
 *     날짜 머리     **B안** — 큰 날짜 숫자 + 장소 제목 + 아래 한 줄
 *     글만 있는 쪽   이야기가 길면 지면 하나를 글에 내주고 사진은 다음 쪽으로
 *
 * ★ PO 가 B안 하나로 정했다. **A안(굵은 밑줄)은 만들지 않는다** — 시안의 본문 배치
 *   그림들이 A안으로 그려져 있지만 그것은 배치를 보이려는 그림이다.
 *
 * ── 크롬 실측 (206mm 지면) ──
 *     날짜 머리   머리글대 14mm 유지 · 큰 숫자 40.7pt(12.92mm)로 대를 넘지 않는다
 *                 왼쪽 정렬 · 안전 영역 안
 *     월 시작 쪽   큰 숫자가 위에서 139.85mm — 아래쪽에 무게가 모인다
 *                 안전 영역 안 · 아래 여백 16mm · 넘침 없음
 *     글만 있는 쪽 두 단 · 단 사이 6mm · 한 단 글줄 84mm · 넘침 없음
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const printCss = read("album-engine/components/PrintPages.css");
const printPages = read("album-engine/components/PrintPages.tsx");
const header = read("album-engine/blocks/ChapterHeader.tsx");
const declarations = printCss.replace(/\/\*[\s\S]*?\*\//g, " ");

test("★ 날짜 머리 B안 — 큰 숫자는 월.일만, 연도는 아래 줄이 말한다", () => {
  assert.equal(formatPrintDateNumber("2018-07-08"), "7.8");
  assert.equal(formatPrintDateNumber("2019-11-22"), "11.22");
  assert.equal(formatPrintDateMeta("2018-07-08", 2), "2018년 · 사진 2장");
  // 0장이라고 말하지 않는다.
  assert.equal(formatPrintDateMeta("2018-07-08", 0), "2018년");
  assert.equal(formatPrintDateMeta("2018-07-08", null), "2018년");
});

test("★ A안(굵은 밑줄)을 만들지 않았다", () => {
  // 굵은 밑줄로 날짜를 못 박는 방식 — PO 가 만들지 말라고 했다.
  assert.equal(/chapter-header__dayrule|dayline-underline/.test(header), false);
  const headRule = declarations.slice(declarations.indexOf(".chapter-header--print-date"));
  const body = headRule.slice(0, headRule.indexOf("}"));
  assert.equal(/border-bottom/.test(body), false, "머리에 밑줄이 생겼다");
});

test("★ 큰 숫자는 라틴 세리프다 — 숫자가 제목처럼 선다 (시안 §6)", () => {
  const at = declarations.indexOf(".chapter-header__daynum");
  const body = declarations.slice(declarations.indexOf("{", at) + 1, declarations.indexOf("}", at));
  assert.match(body, /font-family: var\(--print-serif\)/);
  assert.match(body, /font-size: var\(--print-date-number\)/);
  // 시안 46px = 40.7pt.
  assert.match(printCss, /--print-date-number: 40\.7pt;/);
});

test("★ 머리글대 높이는 그대로 14mm — 쪽마다 사진 시작선이 같아야 한다", () => {
  const at = declarations.indexOf(".chapter-header--print-date");
  const body = declarations.slice(declarations.indexOf("{", at) + 1, declarations.indexOf("}", at));
  assert.match(body, /flex: 0 0 var\(--pr-head\)/);
  // 큰 숫자가 대를 넘어 흘러내리지 않게 잠근다(실측 12.92mm < 14mm).
  assert.match(body, /overflow: hidden/);
});

test("★ 월 시작 쪽 — 달이 둘 이상일 때만 세운다", async () => {
  const { monthFirstChapterIndexes, monthSummary } = await import("../src/album-engine/components/PrintPages");
  // 달이 하나면 세우지 않는다 — 나눌 것이 없는데 종이만 늘어난다.
  assert.deepEqual([...monthFirstChapterIndexes(["2018-07-08", "2018-07-09"])], []);
  // 달이 바뀌면 각 달의 첫 묶음에만.
  assert.deepEqual([...monthFirstChapterIndexes(["2018-07-08", "2018-07-31", "2018-08-01"])], [0, 2]);
  // 날짜를 모르는 묶음은 건너뛴다(달을 지어내지 않는다).
  assert.deepEqual([...monthFirstChapterIndexes([null, "2018-07-08", "2018-08-01"])], [1, 2]);

  const chapters = [
    { date: "2018-07-08", photos: [1, 2] },
    { date: "2018-07-31", photos: [3] },
    { date: "2018-08-01", photos: [4, 5, 6] },
  ];
  assert.deepEqual(monthSummary(chapters, 0), { days: 2, photos: 3 });
  assert.deepEqual(monthSummary(chapters, 2), { days: 1, photos: 3 });
});

test("★ 월 시작 쪽은 아래쪽에 무게를 모은다 — 사진 없는 쪽이라 비어 보이면 안 된다", () => {
  const at = declarations.indexOf(".print-page--month");
  const body = declarations.slice(declarations.indexOf("{", at) + 1, declarations.indexOf("}", at));
  assert.match(body, /justify-content: flex-end/);
  // 시안 88px = 78pt.
  assert.match(printCss, /--print-month-number: 78pt;/);
  // 월별 **이야기**를 되살리지 않는다(CLAUDE.md §6 에서 없앤 요소다).
  assert.equal(/print-month__story|monthStory/.test(printPages), false, "월별 이야기가 돌아왔다");
});

test("★ 글만 있는 쪽은 두 단이다 — 한 단이면 글줄이 174mm 가 된다", () => {
  const at = declarations.indexOf(".print-page--story .print-story__columns");
  const body = declarations.slice(declarations.indexOf("{", at) + 1, declarations.indexOf("}", at));
  assert.match(body, /columns: 2/);
  assert.match(body, /column-gap: var\(--pr-gutter\)/);
});

test("★ 화면은 건드리지 않았다 — 이 커밋의 규칙이 전부 인쇄 아래에 있다", () => {
  for (const fragment of [".print-page--month", ".print-page--story", ".chapter-header__daynum"]) {
    const at = declarations.indexOf(fragment);
    assert.notEqual(at, -1, `${fragment} 규칙이 없다`);
    const lineStart = declarations.lastIndexOf("\n", at) + 1;
    assert.match(declarations.slice(lineStart, at + fragment.length), /\.album-renderer--print/, fragment);
  }
  // 화면 머리(date-only)는 그대로다.
  assert.match(header, /if \(variant === "date-only"\)/);
});
