import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 날짜 머리글이 매 쪽 반복된다 (I-4-3 · SCREEN_SPEC §9).
 *
 * 실물에서 매 쪽 위에 이렇게 나왔다:
 *
 *   2018년 11월          ← 매번 같다. 표지에 이미 있다
 *   2018.11.18 (사진 1장) ← 괄호도 필요 없다. 세는 것은 앨범이 할 일이 아니다
 *
 * 남는 것은 **날짜 하나**다 — `11월 18일`.
 * 해가 바뀌는 앨범이면 그 해 첫 날짜에만 `2018년` 을 붙인다.
 *
 * ★ 화면은 건드리지 않는다. 화면은 예전 그대로 `date-only` 를 쓴다 — 인쇄만 새 변형이다.
 */

registerCssStub();
setupDom("https://test.local/");

const printPages = readFileSync(new URL("../src/album-engine/components/PrintPages.tsx", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");

async function renderHeader(props: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ChapterHeader } = await import("../src/album-engine/blocks/ChapterHeader");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(ChapterHeader, { dayIndex: 1, date: null, dateLabel: null, ...props } as never));
  });
  const text = container.textContent || "";
  const lines = container.querySelectorAll("p").length;
  await React.act(async () => { root.unmount(); });
  return { text, lines };
}

test("★ 인쇄 머리글은 날짜 한 줄뿐이다 — 달 줄도 장수도 없다", async () => {
  const view = await renderHeader({ date: "2018-11-18", dateRangeLabel: "2018.11.18", photoCount: 4, variant: "print-date" });
  assert.equal(view.text, "11월 18일");
  assert.equal(view.lines, 1, "줄이 하나여야 한다");
});

test("★ 해가 바뀌는 앨범에서만, 그 해 첫 날짜에 연도를 붙인다", async () => {
  const withYear = await renderHeader({ date: "2019-01-02", variant: "print-date", showYear: true });
  assert.equal(withYear.text, "2019년 1월 2일");
  const { yearFirstChapterIndexes } = await import("../src/album-engine/components/PrintPages");
  // 한 해 안에서 끝나면 연도를 한 번도 쓰지 않는다(표지에 있다).
  assert.deepEqual([...yearFirstChapterIndexes(["2018-11-18", "2018-11-19", "2018-11-20"])], []);
  // 해가 바뀌면 각 해의 첫 챕터에만.
  assert.deepEqual([...yearFirstChapterIndexes(["2018-12-30", "2018-12-31", "2019-01-01", "2019-01-02"])], [0, 2]);
  // 날짜를 모르는 챕터는 건너뛴다(연도를 지어내지 않는다).
  assert.deepEqual([...yearFirstChapterIndexes([null, "2018-12-30", "2019-01-01"])], [1, 2]);
});

test("★ 화면 머리글은 그대로다 — 인쇄만 새 변형을 쓴다", async () => {
  // 화면은 예전 그대로: 달 줄 + 점 날짜 + 장수.
  const screen = await renderHeader({ date: "2018-11-18", dateRangeLabel: "2018.11.18", photoCount: 4, variant: "date-only" });
  assert.equal(screen.text, "2018년 11월2018.11.18 (사진 4장)");
  assert.equal(screen.lines, 2);
  // 그리고 화면은 실제로 date-only 를 넘긴다.
  assert.match(renderer, /photoCount=\{chapter\.photos\.length\}\s*variant="date-only"/);
  // 인쇄만 print-date 다. 장수를 아예 넘기지 않는다.
  assert.match(printPages, /variant="print-date"/);
  assert.equal(/photoCount=/.test(printPages), false, "인쇄가 아직 장수를 넘긴다");
});

test("머리글 크기는 큐 4-5 표의 값이다 — 본문보다 커야 눈에 걸린다", () => {
  const start = printCss.indexOf(".album-renderer--print .chapter-header--print-date .chapter-header__dayline {");
  assert.notEqual(start, -1);
  const rule = printCss.slice(start, printCss.indexOf("}", start));
  assert.match(rule, /font-size: var\(--print-date-heading\)/);
  // 흐린 회색이 아니라 본문 글자색이다 — 한 줄뿐이라 이 줄이 제목 노릇을 한다.
  assert.match(rule, /color: var\(--c-text\)/);
});

test("날짜 이야기 제목은 그대로다 (§9 구성의 `YYYY.MM.DD의 이야기`)", () => {
  assert.match(printPages, /\$\{chapter\.dateRangeLabel\}의 이야기/);
});
