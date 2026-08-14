import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 연필은 **네 자리 모두 같은 모양**이다 (4/4 · 2026-08-14).
 *
 * 예전에는 제각각이었다 — 32px 원(제목) · 테두리 없는 원(날짜 이야기·맺음말) ·
 * 44px 사각(사진 캡션). 같은 일인데 자리마다 다르면 같은 일인 줄 모른다.
 *
 * ★ 원을 `::before` 로 그리는 이유: **누르는 영역 44px 을 지키면서** 보이는 원만
 *   32px 로 두기 위해서다. 40대 이후 타깃이라 손가락이 32px 을 못 맞춘다 —
 *   원을 버튼 크기로 만들면 둘 중 하나를 잃는다.
 * ★ 색만 자리마다 다르다: 본문 계열은 --c-accent, 제목은 --c-brand-text.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/** 연필 네 자리 — 파일 · 선택자 · 색. */
const PENCILS = [
  { file: "album-engine/blocks/StoryBlock.css", selector: ".story-block__edit-btn", color: "--c-accent" },
  { file: "album-engine/components/AlbumEpilogue.css", selector: ".album-epilogue__edit", color: "--c-accent" },
  { file: "album-engine/components/PhotoMemoryLines.css", selector: ".photo-memory-lines__edit-btn", color: "--c-accent" },
  { file: "components/AlbumScreenHeader.css", selector: ".album-screen-header__edit", color: "--c-brand-text" },
];

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
  return css.slice(at, css.indexOf("}", at) + 1);
}

test("★ 네 자리 모두 44px 이상 누를 수 있다", () => {
  for (const { file, selector } of PENCILS) {
    const body = rule(read(file), selector);
    assert.match(body, /min-width: var\(--tap-min\)/, `${selector}: 누르는 폭이 44px 이 아니다`);
    assert.match(body, /min-height: var\(--tap-min\)/, `${selector}: 누르는 높이가 44px 이 아니다`);
  }
});

test("★ 네 자리 모두 ::before 로 32px 동그라미를 그린다", () => {
  for (const { file, selector } of PENCILS) {
    const before = rule(read(file), `${selector}::before`);
    assert.match(before, /width: 32px/, `${selector}: 원이 32px 이 아니다`);
    assert.match(before, /height: 32px/);
    assert.match(before, /border: 1px solid var\(--c-border\)/, `${selector}: 테두리가 다르다`);
    assert.match(before, /border-radius: 50%/, `${selector}: 동그라미가 아니다`);
    assert.match(before, /background: var\(--c-surface\)/);
  }
});

test("★ 버튼 자신에는 테두리를 두지 않는다 — 원은 ::before 몫이다", () => {
  for (const { file, selector } of PENCILS) {
    const body = rule(read(file), selector);
    assert.match(body, /border: 0/, `${selector}: 버튼에 테두리가 남았다(원이 두 겹이 된다)`);
    assert.match(body, /position: relative/, `${selector}: ::before 를 앉힐 기준이 없다`);
  }
});

test("★ 색만 자리마다 다르다 — 본문은 보조색, 제목은 브랜드색", () => {
  for (const { file, selector, color } of PENCILS) {
    assert.match(rule(read(file), selector), new RegExp(`color: var\\(${color}\\)`), `${selector}: 색이 다르다`);
  }
});

test("아이콘이 원 위에 온다 — 자식에 position: relative 를 준다", () => {
  for (const { file, selector } of PENCILS) {
    const css = read(file);
    assert.ok(css.includes(`${selector} > * {`), `${selector}: 아이콘이 원에 가릴 수 있다`);
  }
});

test("네 자리가 전부다 — 다른 모양의 연필이 남아 있지 않다", () => {
  // 44px 사각(옛 캡션)·32px 이 곧 버튼(옛 제목)이 되살아나면 여기서 잡힌다.
  const memory = read("album-engine/components/PhotoMemoryLines.css");
  const editRule = rule(memory, ".photo-memory-lines__edit-btn");
  assert.equal(editRule.includes("min-width: 44px"), false, "숫자를 다시 적었다(var(--tap-min) 을 쓴다)");
  const header = read("components/AlbumScreenHeader.css");
  const headerRule = rule(header, ".album-screen-header__edit");
  assert.equal(headerRule.includes("width: 32px"), false, "원이 다시 버튼 크기가 됐다");
});
