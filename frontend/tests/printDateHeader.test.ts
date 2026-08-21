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

// ★ 2026-08-19 — 시안 §3 의 **B안**으로 바뀌었다(PO 가 B안 하나로 정했다).
//     11월 18일          →   11.18
//                             속초              (장소가 있을 때만)
//                             2018년 · 사진 4장
//   지키려던 것(매 쪽 같은 달 줄을 반복하지 않는다)은 그대로다 — 반복되던 것은
//   `2018년 11월` 한 줄이었고, 지금 보조줄은 **연도와 장수**다.
//   ★ A안(굵은 밑줄)은 만들지 않는다.
test("★ 인쇄 머리글은 B안이다 — 큰 날짜 숫자 + 장소 + 아래 한 줄", async () => {
  const view = await renderHeader({
    date: "2018-11-18", dateRangeLabel: "2018.11.18", photoCount: 4,
    place: "속초", locationSource: "exif", variant: "print-date",
  });
  assert.equal(view.text, "11.18속초2018년 · 사진 4장");
  assert.equal(view.lines, 3);

  // 장소를 모르면 그 줄을 그리지 않는다 — 빈 줄을 남기지 않는다.
  const noPlace = await renderHeader({ date: "2018-11-18", photoCount: 4, variant: "print-date" });
  assert.equal(noPlace.text, "11.182018년 · 사진 4장");
  assert.equal(noPlace.lines, 2);

  // 사진 수가 없으면 0장이라고 하지 않는다.
  const noCount = await renderHeader({ date: "2018-11-18", variant: "print-date" });
  assert.equal(noCount.text, "11.182018년");
});

test("★ 날짜가 없는 묶음은 큰 숫자를 만들 수 없다 — 기간 한 줄로 둔다", async () => {
  // 아이폰 사파리가 EXIF 를 지운 사진들이 여기 온다(맨 뒤에 서는 묶음).
  const view = await renderHeader({ date: null, dateRangeLabel: "2018.11.18 – 11.20", variant: "print-date" });
  assert.equal(view.text, "2018.11.18 – 11.20");
  assert.equal(view.lines, 1);
  // 기간조차 없으면 아무것도 그리지 않는다.
  const empty = await renderHeader({ date: null, dateRangeLabel: null, variant: "print-date" });
  assert.equal(empty.text, "");
});

// ★ 2026-08-19 — B안은 **연도를 늘 보조줄에** 쓴다. 그래서 `해가 바뀌는지` 를 따져
//   큰 숫자에 연도를 붙이던 갈래가 없어졌다. `yearFirstChapterIndexes` 는 계약을
//   그대로 두었으므로(부르는 쪽이 아직 넘긴다) 그 계산만 잠가 둔다.
test("★ 연도는 늘 보조줄이 말한다 — 큰 숫자에 붙이지 않는다", async () => {
  const anyYear = await renderHeader({ date: "2019-01-02", variant: "print-date", showYear: true });
  assert.equal(anyYear.text, "1.22019년", "showYear 가 큰 숫자를 바꿨다");
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
  // ★ 2026-08-16 — 맨 앞의 `18` 은 `여백형` 이 쓰는 큰 숫자(일)다. 마크업은 6종 공통이라
  //   늘 있고, 다른 모양에서는 CSS 가 감춘다(aria-hidden 이라 낭독기도 읽지 않는다).
  //   이 검사가 지키는 것은 **화면 머리글이 달 줄 + 날짜 줄 그대로**라는 것이다.
  // ★ 2026-08-17 — 여백형이 쓰는 한 줄(`월 · 지역 · 사진 N장`)이 마크업에 함께 들어왔다.
  //   그것도 6종 공통이라 늘 있고 다른 모양에서는 CSS 가 감춘다(위와 같은 방식이다).
  //   이 검사가 지키는 것은 그대로다: **화면 머리글이 달 줄 + 날짜 줄**이라는 것.
  assert.equal(screen.text, "182018년 11월2018.11.18 (사진 4장)2018년 11월 · 사진 4장");
  assert.equal(screen.lines, 3);
  // 그리고 화면은 실제로 date-only 를 넘긴다.
  assert.match(renderer, /photoCount=\{chapter\.photos\.length\}\s*variant="date-only"/);
  // 인쇄만 print-date 다.
  assert.match(printPages, /variant="print-date"/);
  // ★ 2026-08-19 — 인쇄도 장수를 넘긴다. B안 보조줄이 `2018년 · 사진 4장` 이라
  //   그 값이 필요해졌다(예전에는 머리글에 장수를 쓰지 않아 넘기지 않았다).
  assert.match(printPages, /photoCount=\{chapter\.photos\.length\}/);
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
