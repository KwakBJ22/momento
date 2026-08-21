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

test("★ 사진 세로 상한은 **지면 기하에서 나온 값**이다 — 백분율은 부모 높이가 auto 라 먹지 않는다", () => {
  // ★ 2026-08-16 — 판형이 정사각(206×206)이 되면서 상한을 mm 숫자로 적지 않는다.
  //   사진 영역(174×154)에서 계산한 --pr-* 토큰을 읽는다(tokens.css · PrintPages.css).
  //   상한이 **있어야 한다**는 규칙(없으면 세로 사진이 쪽을 넘는다)은 그대로다.
  const img = rule(".album-renderer--print .print-frame__photo img");
  assert.match(img, /max-width: 100%/);
  assert.equal(/max-height:\s*100%/.test(img), false, "백분율 상한은 통하지 않는다");
  // ★ 2026-08-19 — 상한이 **시안 값**으로 바뀌었다(§4: 1장 128 · 2장 118 · 3장 100/43 ·
  //   4·6장 58mm). 그대로 쓰면 이야기가 함께 오는 쪽에서 지면을 넘으므로 `min()` 으로
  //   **남는 자리와 견준다** — 둘 중 작은 쪽을 쓴다. 상한이 있어야 한다는 규칙은 그대로다.
  for (const count of [1, 2, 3, 4, 6]) {
    assert.match(
      printCss,
      new RegExp(`\\[data-photo-count="${count}"\\][^{]*\\.print-frame__photo img[^{]*\\{ max-height: min\\(`),
      `${count}장 상한이 없다`,
    );
  }
  // 남는 자리는 캡션대와 캡션 간격을 **둘 다** 뺀 값이다(빼먹으면 머리 있는 쪽이 넘친다).
  assert.match(printCss, /--pr-fit-1: calc\(var\(--pr-avail\) - var\(--pr-caption\) - var\(--pr-cap-gap\)\)/);
  assert.match(printCss, /--pr-fit-2: calc\(\(var\(--pr-avail\) - var\(--pr-gutter\)\) \/ 2 - var\(--pr-caption\) - var\(--pr-cap-gap\)\)/);
  // 캡션대만큼 늘 뺀다 — 칸 높이는 고정이고 캡션이 그 자리를 쓴다.
  // (주석은 뺀다. 없어진 규칙을 **적어 둔** 줄까지 걸리면 그 사정을 적을 수 없다.)
  const rules = printCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(rules.includes("--print-caption-extra"), false, "캡션 길이로 사진을 또 낮춘다");
});

test("★ 날짜 이야기가 같은 쪽에 있으면 상한이 더 낮다 (네 장수 모두)", () => {
  // 4d-3 뒤로 이야기는 1~4장 어느 쪽에나 함께 들어간다 — 그만큼 상한이 낮다.
  // ★ 2026-08-16 — 값이 아니라 **어느 토큰을 읽는지**로 본다. 이야기 쪽 토큰은
  //   사진 영역에서 --pr-story 를 먼저 빼고 계산한다(tokens 정의가 그것을 보장한다).
  // ★ 2026-08-19 — 장수마다 규칙을 따로 두지 않는다. 이야기가 있는 쪽은 **쓸 수 있는
  //   세로(--pr-avail)를 한 번만** 줄이고, 장수별 상한이 그 값과 min() 으로 견준다.
  //   규칙이 한 곳이라 장수가 늘어도 빠뜨릴 자리가 없다(예전에는 장수마다 있었다).
  assert.match(printCss, /\[data-has-story\][^{]*\{\s*--pr-avail: calc\(var\(--pr-photo-area\) - var\(--pr-story\)\)/);
  // 이야기가 없는 쪽은 사진 영역 그대로다.
  assert.match(printCss, /--pr-avail: var\(--pr-photo-area\);/);
  // ★ 뒤집힘 — 예전에는 여기서 `짧은 변 60mm 하한`(I-4b-5)을 함께 지켰다. 정사각 지면은
  //   사진 영역이 154mm 라 4장 쪽에서 그 하한이 성립하지 않는다. 하한은 **배치 6종**
  //   (칸이 사진을 정하고 넘치는 쪽을 자른다)에서 다시 세운다 — 다음 건이다.
});

// ★ 2026-08-19 — 시안 §4 의 배치가 **6장까지** 있어 한 쪽에 담는 수가 4 → 6 이 됐다.
//   지키려던 것(한 쪽이 담는 수에 **상한이 있다** · 사진이 빠지지 않는다)은 그대로다.
test("한 쪽에 사진 7장 이상이 오지 않는다 (상한은 그대로 있다 — §9)", async () => {
  assert.match(printPages, /export const PRINT_PHOTOS_PER_PAGE = 6;/);
  // ★ 글자가 아니라 **결과**를 본다 — 나누는 코드가 바뀌어도 계약은 그대로여야 한다.
  const { paginateChapterPhotos } = await import("../src/album-engine/components/PrintPages");
  for (const total of [1, 4, 5, 9, 13]) {
    const photos = Array.from({ length: total }, (_, index) => index);
    for (const hasStory of [false, true]) {
      for (const page of paginateChapterPhotos(photos, hasStory)) {
        assert.ok(page.length <= 6, `${total}장(이야기 ${hasStory}): 한 쪽에 ${page.length}장`);
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
