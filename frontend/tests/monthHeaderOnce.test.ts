import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 같은 달이 날짜 묶음마다 되풀이된다 (PO 2026-08-15).
 *
 * `2016년 11월` 이 그 달의 날짜마다 매번 나왔다. 달은 **바뀔 때만** 한 번 쓴다.
 *
 * 까닭: `showMonth` 가 `repeatsDate`(앞 묶음과 **날짜**가 같은가)만 봤다. 날짜가
 * 다르면 달이 같아도 월을 다시 썼다 — 보는 기준이 하나 모자랐다.
 * 그래서 `repeatsMonth`(앞 묶음과 **연·월**이 같은가)를 더했다.
 *
 * ★ 날짜가 없는 묶음끼리 `undefined === undefined` 로 참이 되어 달이 통째로
 *   사라진 적이 있다(16023c0). 그래서 넘기는 쪽에 `Boolean(chapter.date)` 가 있다.
 */

registerCssStub();
setupDom("https://test.local/");

const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");

async function renderHeader(props: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ChapterHeader } = await import("../src/album-engine/blocks/ChapterHeader");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(ChapterHeader, {
      dayIndex: 1, date: null, dateLabel: null, variant: "date-only", ...props,
    } as never));
  });
  const view = {
    text: container.textContent || "",
    months: container.querySelectorAll(".chapter-header__month").length,
    lines: container.querySelectorAll("p").length,
  };
  await React.act(async () => { root.unmount(); });
  return view;
}

test("★ 달이 바뀌면 월을 쓴다", async () => {
  const view = await renderHeader({ date: "2016-11-03", dateRangeLabel: "2016.11.03", photoCount: 2 });
  assert.equal(view.months, 1);
  assert.match(view.text, /2016년 11월/);
});

test("★ 같은 달이면 날짜가 달라도 월을 다시 쓰지 않는다 — 이것이 이번 수정이다", async () => {
  const view = await renderHeader({
    date: "2016-11-19", dateRangeLabel: "2016.11.19", photoCount: 2, repeatsMonth: true,
  });
  assert.equal(view.months, 0, "같은 달인데 월을 또 썼다");
  // 월이 없으면 그 자리에 남는 것도 없다 — 월 아래 짧은 선은 월과 한 몸이다.
  assert.equal(view.lines, 1, "월을 뺀 자리에 빈 줄이 남았다");
  // 날짜 줄은 그대로다 — 월만 뺀 것이지 묶음을 지운 것이 아니다.
  assert.match(view.text, /2016\.11\.19 \(사진 2장\)/);
});

test("★ 날짜가 같아서 날짜를 뺄 때도 월은 없다 (예전 규칙 그대로)", async () => {
  const view = await renderHeader({
    date: "2018-07-08", dateRangeLabel: "2018.07.08", place: "제주 성산읍",
    locationSource: "exif", photoCount: 2, repeatsDate: true, repeatsMonth: true,
  });
  assert.equal(view.months, 0);
  assert.match(view.text, /제주 성산읍/);
});

test("★ 넘기는 쪽이 연·월을 견준다 — 날짜 없는 묶음끼리 참이 되지 않는다 (16023c0)", () => {
  assert.match(
    renderer,
    /repeatsMonth=\{chapterIndex > 0 && Boolean\(chapter\.date\)\s*\n\s*&& album\?\.chapters\[chapterIndex - 1\]\?\.date\?\.slice\(0, 7\) === chapter\.date\?\.slice\(0, 7\)\}/,
    "연·월 견주기가 없거나 Boolean(chapter.date) 가드가 빠졌다",
  );
  // 날짜 견주기(repeatsDate)는 그대로 남아 있다 — 둘은 다른 것을 본다.
  assert.match(renderer, /repeatsDate=\{chapterIndex > 0 && Boolean\(chapter\.date\)/);
});
