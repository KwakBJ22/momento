import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 본문 배치와 캡션 자리 — 시안 `print-layout-v3` §4 `본문 배치`.
 *
 *     1장   128mm
 *     2장   118mm            (나란히 두 칸)
 *     3장   100mm / 43mm × 2 (왼쪽 하나 크게 · 오른쪽 둘 작게)
 *     4장    58mm            (두 칸 × 두 줄)
 *   5·6장    58mm            (세 칸)
 *     캡션대 14mm · 사진과 캡션 사이 2.8mm (시안의 9px)
 *
 * ── 크롬 실측 (206mm 지면 · 날짜 머리 포함 · 1·2·3·4·6장 × 이야기 있는 쪽/없는 쪽) ──
 *     열 가지 모두 안전 영역 174mm 안에 들어온다
 *       1장 123.79 · 2장 148.80 · 3장 144.58 · 4장 173.99 · 6장 173.99
 *       이야기가 함께 오는 쪽은 다섯 다 174.00 (딱 맞는다)
 *     찌그러진 것 0 · 캡션이 칸을 넘은 것 0
 *     캡션 폭 = 사진 폭 (세로 사진 45mm · 가로 사진 120mm)
 *     사진 아래 → 캡션 글 2.8mm (열 가지 모두 같다)
 *
 * ★ PO 지적 `캡션이 칸 폭에 맞춰 있어 어느 사진의 말인지 헷갈린다` 를 재 보니
 *   **캡션은 이미 사진 폭이었다.** 헷갈리게 만든 것은 세로 간격이었다 — 캡션 글이
 *   사진에서 5.64mm 아래라 제 사진보다 아랫줄 사진에 가까웠다. 그중 2.65mm 는
 *   화면용 여백(`.photo-memory-lines--caption` 의 margin-top: 10px)이 인쇄까지
 *   새어 들어온 것이었다.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const printCss = read("album-engine/components/PrintPages.css");
const tokens = read("styles/tokens.css");
const printPages = read("album-engine/components/PrintPages.tsx");

/** 주석을 걷어낸 **선언만** 본다(설명을 지우게 만드는 검사가 되지 않게). */
const declarations = printCss.replace(/\/\*[\s\S]*?\*\//g, " ");

/**
 * 그 선택자를 쓰는 규칙들의 **선언을 모두 모아** 돌려준다.
 *
 * ★ 하나만 집으면 틀린 규칙을 잡는다: `.print-frame` 은 `.print-frame__photo` 를,
 *   `.print-frame__caption` 은 글자 크기를 정하는 앞쪽 규칙을 먼저 만난다.
 *   같은 자리를 여러 규칙이 나눠 정하는 것이 CSS 라, 묻는 것은 `이 선언이
 *   그 자리에 걸리는가` 하나다.
 * ★ 선택자 뒤에 오는 것은 `{` 이거나 `,` 다(여럿을 묶어 쓴 규칙).
 */
function ruleBody(selectorFragment: string): string {
  const pattern = new RegExp(`${selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,{]`, "g");
  const bodies: string[] = [];
  for (const match of declarations.matchAll(pattern)) {
    const open = declarations.indexOf("{", match.index!);
    bodies.push(declarations.slice(open + 1, declarations.indexOf("}", open)));
  }
  assert.notEqual(bodies.length, 0, `규칙이 없다: ${selectorFragment}`);
  return bodies.join("\n");
}

test("★ 장수별 사진 상한이 시안 값이다", () => {
  const cap = (fragment: string) => ruleBody(fragment).match(/max-height:\s*min\(([^,]+),/)?.[1].trim();
  assert.equal(cap('[data-photo-count="1"] .print-frame__photo img'), "128mm");
  assert.equal(cap('[data-photo-count="2"] .print-frame__photo img'), "118mm");
  assert.equal(cap('[data-photo-count="3"] .print-frame:first-child .print-frame__photo img'), "100mm");
  assert.equal(cap('[data-photo-count="3"] .print-frame:not(:first-child) .print-frame__photo img'), "43mm");
  assert.equal(cap('[data-photo-count="4"] .print-frame__photo img'), "58mm");
});

test("★ 남는 자리와 견준다 — 이야기가 함께 오는 쪽에서 지면을 넘지 않는다", () => {
  // 시안 값을 그대로 쓰면 1장 쪽이 142mm 라 이야기 쪽(104mm)에서 넘는다.
  // min() 으로 둘 중 작은 쪽을 쓴다.
  for (const count of [1, 2, 4, 6]) {
    assert.match(
      declarations,
      new RegExp(`\\[data-photo-count="${count}"\\][^{]*\\.print-frame__photo img[^{]*\\{ max-height: min\\(`),
      `${count}장이 min() 을 쓰지 않는다`,
    );
  }
  // 이야기가 있으면 **쓸 수 있는 세로를 한 번만** 줄인다(장수마다 규칙을 두지 않는다).
  assert.match(declarations, /\[data-has-story\][^{]*\{\s*--pr-avail: calc\(var\(--pr-photo-area\) - var\(--pr-story\)\)/);
});

test("★ 남는 자리는 캡션대와 캡션 간격을 둘 다 뺀 값이다", () => {
  // ★ 간격을 빼먹으면 프레임이 그만큼 커져 날짜 머리가 있는 쪽에서 넘친다
  //   (실측에서 4장 쪽이 175.6mm 로 안전 영역 174 를 1.6mm 넘겼다).
  assert.match(declarations, /--pr-fit-1: calc\(var\(--pr-avail\) - var\(--pr-caption\) - var\(--pr-cap-gap\)\)/);
  assert.match(declarations, /--pr-fit-2: calc\(\(var\(--pr-avail\) - var\(--pr-gutter\)\) \/ 2 - var\(--pr-caption\) - var\(--pr-cap-gap\)\)/);

  // 값으로도 재 둔다 — 4장 쪽이 안전 영역에 딱 들어맞는가.
  const mm = (name: string) => Number(tokens.match(new RegExp(`${name}:\\s*([\\d.]+)mm`))![1]);
  const photoArea = 154; // --pr-photo-area = 174 − 14(머리) − 6(간격)
  const fit2 = (photoArea - mm("--pr-gutter")) / 2 - mm("--pr-caption") - mm("--pr-cap-gap");
  const rowHeight = Math.min(58, fit2) + mm("--pr-cap-gap") + mm("--pr-caption");
  const total = rowHeight * 2 + mm("--pr-gutter");
  assert.ok(total <= photoArea + 0.05, `4장 쪽이 ${total.toFixed(2)}mm — 사진 영역 ${photoArea}mm 를 넘는다`);
});

test("★ 칸 나눔 — 3장은 왼쪽 하나 크게, 5·6장은 세 칸", () => {
  const columns = (count: number) =>
    ruleBody(`[data-photo-count="${count}"] .print-page__photos`).match(/grid-template-columns:\s*([^;]+);/)?.[1].trim();
  assert.equal(columns(1), "1fr");
  for (const count of [2, 3, 4]) assert.equal(columns(count), "1fr 1fr");
  for (const count of [5, 6]) assert.equal(columns(count), "repeat(3, 1fr)");
  // 3장 — 첫 칸이 두 줄을 차지한다. 칸을 묶는 새 요소를 만들지 않는다.
  assert.match(declarations, /\[data-photo-count="3"\] \.print-frame:first-child \{\s*grid-row: 1 \/ span 2;/);
});

test("★ 캡션은 사진 폭에서 시작한다 — 칸 폭이 아니다", () => {
  // 프레임이 사진 크기를 따라가고(fit-content), 캡션은 그 폭을 채운다.
  // 실측: 세로 사진 45mm · 가로 사진 120mm — 둘 다 사진 폭과 같았다.
  const frame = ruleBody(".album-renderer--print .print-frame");
  assert.match(frame, /width: fit-content/);
  const caption = ruleBody(".album-renderer--print .print-frame__caption");
  assert.match(caption, /width: 0/);
  assert.match(caption, /min-width: 100%/);
});

test("★ 캡션은 사진 바로 아래 2.8mm 에 붙는다 (시안 9px)", () => {
  assert.match(tokens, /--pr-cap-gap: 2\.8mm;/);
  assert.match(ruleBody(".album-renderer--print .print-frame"), /gap: var\(--pr-cap-gap\)/);
  // 화면용 여백이 인쇄까지 따라오지 않는다 — 이것이 2.65mm 를 더 밀어냈다.
  assert.match(
    ruleBody(".album-renderer--print .print-frame__caption .photo-memory-lines--caption"),
    /margin-top: 0/,
  );
  // 화면 캡션은 그대로다.
  assert.match(read("album-engine/components/PhotoMemoryLines.css"), /\.photo-memory-lines--caption \{[^}]*margin: 10px 0 0;/);
});

test("★ 캡션대 높이는 그대로 14mm — 자리를 지키는 값이라 줄이지 않는다", () => {
  assert.match(tokens, /--pr-caption: 14mm;/);
  assert.match(ruleBody(".album-renderer--print .print-frame__caption"), /height: var\(--pr-caption\)/);
});

test("★ 한 쪽에 담는 수는 6장이다 (시안 §4 에 6장 배치가 있다)", () => {
  assert.match(printPages, /export const PRINT_PHOTOS_PER_PAGE = 6;/);
});

test("★ 화면에 새지 않는다 — 이 커밋의 규칙이 전부 인쇄 아래에 있다", () => {
  for (const fragment of [
    '[data-photo-count="5"] .print-page__photos',
    '[data-photo-count="6"] .print-page__photos',
    '[data-photo-count="3"] .print-frame:first-child',
  ]) {
    const at = declarations.indexOf(fragment);
    const lineStart = declarations.lastIndexOf("\n", at) + 1;
    assert.match(declarations.slice(lineStart, at + fragment.length), /\.album-renderer--print/, fragment);
  }
});
