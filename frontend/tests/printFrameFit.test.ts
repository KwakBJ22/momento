import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub } from "./support/domEnv";

/**
 * 가로 사진의 캡션이 멀리 떨어진다 (I-4-4 · SCREEN_SPEC §9 `사진 프레임 — 폴라로이드 한 장`).
 *
 * 실물 5쪽: 가로 사진 한 장인데 위아래로 크게 비고 캡션이 한참 아래 카드 바닥에
 * 붙어 있었다. **실측 사진 아래 47.6mm.** 사진과 캡션이 남남으로 보인다.
 *
 * 원인은 프레임이 칸 높이를 다 먹은 것이다:
 *   .print-page__photos  → grid, 칸이 1fr (남는 높이를 전부 씀)
 *   .print-frame         → 그 칸에 stretch 되어 239mm
 *   .print-frame__photo  → flex: 1 1 auto 로 남는 높이를 전부 먹음(219mm)
 *   그 안에서 사진(130mm)은 가운데 정렬 → 아래로 44mm 가 비고, 캡션은 그 아래.
 *
 * §9 는 "캡션은 프레임 안, **사진 바로 아래**" 이고 "한 장짜리 쪽이 페이지를 억지로
 * 채우지 않는다. 남는 여백은 남겨 둔다" 이다. 프레임이 사진 크기에 맞춰 줄어들어야 한다.
 */

registerCssStub();

const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
const printPages = readFileSync(new URL("../src/album-engine/components/PrintPages.tsx", import.meta.url), "utf8");

function rule(selector: string): string {
  const start = printCss.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `규칙이 없다: ${selector}`);
  return printCss.slice(start + selector.length + 2, printCss.indexOf("}", start));
}

test("★ 프레임은 사진 크기다 — 칸 높이를 따라가지 않는다 (I-4c 에서 다시 뒤집혔다)", () => {
  const grid = rule(".album-renderer--print .print-page__photos");
  // 4b-4 는 "아래끝을 맞춘다"(stretch)였는데 4c 에서 철회됐다 — 늘리면 빈 액자가 되고,
  // 칸이 사진보다 작으면 사진이 프레임을 뚫고 나온다.
  assert.match(grid, /align-items: start/);
  assert.match(grid, /grid-auto-rows: auto/);
  // 사진 묶음 자체도 늘어나지 않는다.
  assert.match(grid, /flex: 0 1 auto/);
});

test("★ 사진 자리도 늘리지 않는다 — 늘리면 사진과 캡션 사이가 벌어진다", () => {
  const photo = rule(".album-renderer--print .print-frame__photo");
  assert.match(photo, /flex: 0 1 auto/);
  assert.equal(/flex: 1 1 auto/.test(photo), false, "예전 값이 돌아왔다(47.6mm 가 다시 생긴다)");
});

test("★ 캡션은 프레임 **안**이다 — 밖으로 빼지 않는다(§9 13차)", () => {
  // 마크업: figure.print-frame 안에 사진과 figcaption 이 함께 있다.
  assert.match(printPages, /<figure className="print-frame"[\s\S]{0,400}<figcaption className="print-frame__caption">/);
  const caption = rule(".album-renderer--print .print-frame__caption");
  assert.match(caption, /flex: 0 0 auto/);
  // 프레임 껍데기(테두리·배경·그림자)는 프레임의 것이고 캡션에 하나 더 씌우지 않는다.
  // ★ **속성 이름**으로 본다. box-sizing: border-box 는 껍데기가 아니라 폭 계산이라
  //   값에 border 가 들어가도 걸리면 안 된다(I-4d-1).
  assert.equal(/(^|\s)(border|background|box-shadow)\s*:/.test(caption), false);
});

test("★ 사진 세로 상한은 A4 기하에서 계산한 mm 다 — 백분율은 부모 높이가 auto 라 먹지 않는다", () => {
  const img = rule(".album-renderer--print .print-frame__photo img");
  assert.match(img, /max-width: 100%/);
  assert.equal(/max-height:\s*100%/.test(img), false, "백분율 상한은 통하지 않는다");
  // 장수별 상한이 넷 다 있다. (I-4g 뒤로 캡션이 길어진 만큼 빼는 calc 다.)
  for (const count of [1, 2, 3, 4]) {
    assert.match(printCss, new RegExp(`\\[data-photo-count="${count}"\\] \\.print-frame__photo img \\{ max-height: calc\\(\\d+mm - var\\(--print-caption-extra, 0mm\\)\\); \\}`), `${count}장 상한이 없다`);
  }
});

test("★ 날짜 이야기가 같은 쪽에 있으면 상한이 더 낮다 (네 장수 모두)", () => {
  // 4d-3 뒤로 이야기는 1~4장 어느 쪽에나 함께 들어간다 — 그만큼 상한이 낮다.
  for (const count of [1, 2, 3, 4]) {
    const withStory = printCss.match(new RegExp(`\\[data-has-story\\]\\[data-photo-count="${count}"\\] \\.print-frame__photo img \\{ max-height: calc\\((\\d+)mm`));
    const plain = printCss.match(new RegExp(`\\.print-page\\[data-photo-count="${count}"\\] \\.print-frame__photo img \\{ max-height: calc\\((\\d+)mm`));
    assert.ok(withStory && plain, `${count}장: 두 벌이 다 있어야 한다`);
    assert.ok(Number(withStory[1]) < Number(plain[1]), `${count}장: 이야기 쪽 상한이 더 낮아야 한다`);
  }
  // 짧은 변 60mm 하한을 지키는 값이다 — 3:4 세로 사진에서 상한 80mm 면 폭이 60mm 다.
  const lowest = Math.min(...[1, 2, 3, 4].map((count) => Number(
    printCss.match(new RegExp(`\\[data-has-story\\]\\[data-photo-count="${count}"\\] \\.print-frame__photo img \\{ max-height: calc\\((\\d+)mm`))![1],
  )));
  assert.ok(lowest >= 80, `가장 낮은 상한이 ${lowest}mm — 3:4 세로 사진의 폭이 60mm 아래로 내려간다`);
});

test("한 쪽에 사진 5장 이상이 오지 않는다 (기존 계약 유지 — §9)", async () => {
  assert.match(printPages, /export const PRINT_PHOTOS_PER_PAGE = 4;/);
  // ★ 글자가 아니라 **결과**를 본다 — 나누는 코드가 바뀌어도 계약은 그대로여야 한다.
  const { paginateChapterPhotos } = await import("../src/album-engine/components/PrintPages");
  for (const total of [1, 4, 5, 9, 13]) {
    const photos = Array.from({ length: total }, (_, index) => index);
    for (const hasStory of [false, true]) {
      for (const page of paginateChapterPhotos(photos, hasStory)) {
        assert.ok(page.length <= 4, `${total}장(이야기 ${hasStory}): 한 쪽에 ${page.length}장`);
      }
    }
  }
});

test("화면은 건드리지 않았다 — 이 파일의 모든 규칙이 인쇄 아래에 있다", () => {
  // ★ 규칙 하나하나가 아니라 **파일 전체**를 본다: 선택자가 전부 --print 로 시작해야
  //   화면에 샐 수 없다. 주석은 빼고 본다(설명에 클래스 이름이 나오는 것은 정상이다).
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = rules.split("}").map((chunk) => chunk.split("{")[0].trim()).filter(Boolean);
  assert.ok(selectors.length > 10, "선택자를 못 읽었다");
  for (const selector of selectors) {
    for (const one of selector.split(",").map((value) => value.trim()).filter(Boolean)) {
      assert.ok(one.startsWith(".album-renderer--print"), `인쇄 밖으로 새는 규칙: ${one}`);
    }
  }
});
