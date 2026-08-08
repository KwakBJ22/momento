import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 🔴 사진은 기울었는데 흰 카드는 똑바로 서 있다 (I-1 · SCREEN_SPEC §9).
 *
 * 기울기는 안쪽 figure 에 걸려 있었는데, 화면에서 **보이는 흰 카드는 그 figure 가
 * 아니었다** — 바깥 `.photo-block`(사진 + 캡션)이 카드였고 figure 는 투명했다.
 * 그래서 사진만 돌고 카드는 그대로 서서 따로 놀았다.
 *
 * ★ 고친 방식: **카드를 사진만 감싸게** 옮기고, 그 카드가 돈다.
 *   캡션은 카드 밖에 남아 똑바로 선다 — §9 `글은 똑바로` 와
 *   CLAUDE.md §6 `캡션에 카드·테두리·그림자·배경색 금지` 가 같은 것을 가리킨다.
 * ★ 기울기 **값**(scrapbookLayout)은 건드리지 않았다. 걸리는 **자리**만 바꿨다.
 * ★ 인쇄는 그대로다 — 화면 선택자(--screen)만 손댔다.
 */

const css = readFileSync(new URL("../src/album-engine/AlbumRenderer.css", import.meta.url), "utf8");

/** 화면 모드의 한 규칙 본문을 뽑는다. */
function screenRule(selector: string): string {
  const head = `.album-renderer--screen ${selector} {`;
  const start = css.indexOf(head);
  assert.notEqual(start, -1, `규칙이 없다: ${head}`);
  return css.slice(start + head.length, css.indexOf("}", start));
}

const CARD = ".album-screen-photo-card__frame";
const BLOCK = ".album-screen-photo-grid > .photo-block";

test("★ 흰 카드와 기울기가 같은 요소에 있다 (사진을 감싸는 자리)", () => {
  const card = screenRule(CARD);
  // 카드의 생김새 — 테두리·배경·그림자가 여기 있다.
  assert.match(card, /border: 1px solid var\(--c-border-strong\)/);
  assert.match(card, /background: var\(--c-surface\)/);
  assert.match(card, /box-shadow: var\(--sh-md\)/);
  // 도는 것도 여기다. transform 은 컴포넌트가 인라인으로 주므로 기준점만 확인한다.
  assert.match(card, /transform-origin: center center/);

  // 그리고 기울기는 바로 그 요소에 걸린다 — figure(AlbumPhotoFrame)다.
  const block = readFileSync(new URL("../src/album-engine/components/PhotoWithMemories.tsx", import.meta.url), "utf8");
  const frameStyle = block.slice(block.indexOf("const frameStyle"), block.indexOf("// 겹침은"));
  assert.match(frameStyle, /transform: `rotate\(\$\{tilt\}deg\)`/);
  assert.match(block, /<AlbumPhotoFrame\s+style=\{frameStyle\}/);
});

test("★ 바깥 블록은 더 이상 카드가 아니다 (캡션이 카드 안에 들어가지 않는다)", () => {
  const block = screenRule(BLOCK);
  assert.match(block, /border: 0/);
  assert.match(block, /background: transparent/);
  assert.match(block, /box-shadow: none/);
  assert.match(block, /padding: 0;/);
  // 돌리는 기준점도 카드로 옮겼다 — 블록에 남아 있으면 "여기가 돈다" 는 오해가 남는다.
  assert.equal(block.includes("transform-origin"), false);
});

test("캡션은 카드 밖이다 — 기울지 않고, 배경·테두리·그림자가 없다", () => {
  // 마크업 순서: 카드(AlbumPhotoFrame) 다음에 캡션이 형제로 온다.
  const source = readFileSync(new URL("../src/album-engine/components/PhotoWithMemories.tsx", import.meta.url), "utf8");
  const frameAt = source.indexOf("<AlbumPhotoFrame");
  const frameEnd = source.indexOf("/>", frameAt);
  const captionAt = source.indexOf("<PhotoMemoryLines");
  assert.ok(frameAt > -1 && captionAt > frameEnd, "캡션이 사진 카드 밖(형제)이어야 한다");
  // 기울기는 캡션에 넘어가지 않는다.
  assert.equal(source.slice(captionAt).includes("frameStyle"), false);

  // 캡션 자리에 카드 흉내를 내지 않는다(§6).
  const caption = readFileSync(new URL("../src/album-engine/components/PhotoMemoryLines.css", import.meta.url), "utf8");
  const rule = caption.slice(caption.indexOf(".photo-memory-lines--caption {"), caption.indexOf("}", caption.indexOf(".photo-memory-lines--caption {")));
  for (const forbidden of ["box-shadow", "border:", "background:"]) {
    assert.equal(rule.includes(forbidden), false, `캡션에 ${forbidden} 가 있다`);
  }
});

test("겹침은 그대로다 — 카드가 바뀌어도 당기는 기준은 블록 폭이다", () => {
  // 음수 여백은 여전히 블록에 걸린다(퍼센트는 격자 칸 폭 기준이라 카드 변경과 무관하다).
  const start = css.indexOf("@media (min-width: 641px)");
  const rule = css.slice(start, css.indexOf("}", css.indexOf("margin-inline-start: calc(var(--photo-overlap")));
  assert.match(rule, /\.photo-block\[data-overlap\]/);
  assert.match(rule, /margin-inline-start: calc\(var\(--photo-overlap, 0\) \* -100%\)/);
  // 블록 폭은 그대로 100% 다 — 이것이 바뀌면 당기는 양이 달라진다.
  assert.match(screenRule(BLOCK), /width: 100%/);
});

test("좁은 화면의 여백도 카드가 갖는다 (블록이 아니라)", () => {
  const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
  const padding = narrow.slice(0, narrow.indexOf("\n}\n\n"));
  assert.match(padding, new RegExp(`\\${CARD} \\{\\s*padding: 0\\.6rem;`));
  assert.equal(padding.includes(`${BLOCK} {\n    padding`), false);
});

test("★ 인쇄에는 새지 않는다 — 화면 선택자만 손댔다", () => {
  // 카드 규칙은 전부 --screen 아래에 있다.
  for (const selector of [CARD, BLOCK]) {
    const occurrences = css.split(selector).length - 1;
    const screened = css.split(`.album-renderer--screen ${selector}`).length - 1;
    assert.equal(occurrences, screened, `${selector} 가 화면 밖에서도 쓰인다`);
  }
  // 인쇄 컴포넌트는 이 규칙을 모른다(기존 계약 유지).
  const printCss = readFileSync(new URL("../src/album-engine/components/PrintPages.css", import.meta.url), "utf8");
  assert.doesNotMatch(printCss, /rotate\(/);
});
