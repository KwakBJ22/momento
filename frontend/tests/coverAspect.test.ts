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
  assert.doesNotMatch(img, /max-height/);      // 박스에 맞춰 눌리지 않는다
  assert.doesNotMatch(img, /aspect-ratio/);    // 고정 비율 상자에 밀어 넣지 않는다
  // object-fit 은 html2canvas 가 무시하므로 왜곡 방지에 기대지 않는다.
  assert.doesNotMatch(img, /object-fit/);
});

test("넘치는 부분은 잘라 낸다 — 늘이지 않는다", () => {
  const figure = block(".album-cover__hero");
  assert.match(figure, /max-height: 420px;/);  // 표지가 한 페이지를 넘지 않게 상한은 박스에
  assert.match(figure, /overflow: hidden;/);   // 상한을 넘는 부분은 잘라 낸다
});
