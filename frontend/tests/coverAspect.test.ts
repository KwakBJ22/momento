import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/album-engine/components/AlbumCover.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} 규칙이 없다`);
  return css.slice(start, css.indexOf("}", start));
}

// 표지 사진이 원본 비율을 잃고 늘어났다. 사진이 가장 중요한 제품에서 치명적이다.
// 원인: 박스에 max-height 를 걸고 이미지에 object-fit 을 줬는데, PDF 를 만드는
// html2canvas 는 object-fit 을 무시하고 박스 크기에 이미지를 늘려 그린다.
test("표지 사진은 제 비율대로 그려진다 — 높이를 강제하지 않는다", () => {
  const img = block(".album-cover__hero-img");
  assert.match(img, /height: auto;/);          // 비율은 이미지가 정한다
  assert.doesNotMatch(img, /aspect-ratio/);    // 고정 비율 상자에 밀어 넣지 않는다
  // object-fit 은 html2canvas 가 무시하므로 왜곡 방지에 기대지 않는다.
  assert.doesNotMatch(img, /object-fit/);
});

// ★ I-4-2 에서 뒤집힌 규칙. 예전에는 상자(max-height 420px + overflow:hidden)가 넘치는
// 부분을 **잘라 냈고**, 실물 표지에서 세로 사진이 아래에서 잘려 나왔다.
// §9 "지킬 것" 은 `사진은 자르지 않는다(contain)` 이다 — 상한을 상자가 아니라
// **이미지**에 주어, 잘리는 대신 작아져서 페이지 안에 온전히 들어온다.
test("★ 표지 사진을 잘라 내지 않는다 — 상한은 상자가 아니라 이미지에 있다", () => {
  const figure = block(".album-cover__hero");
  assert.doesNotMatch(figure, /overflow: hidden/, "상자가 사진을 잘라 낸다");
  assert.doesNotMatch(figure, /max-height:\s*\d+px/, "상자에 px 상한이 남아 있다");

  const img = block(".album-cover__hero-img");
  assert.match(img, /max-height: 175mm/);  // A4 실측으로 정한 상한(세로 사진)
  assert.match(img, /max-width: 100%/);    // 가로 사진은 폭이 먼저 걸린다
});
