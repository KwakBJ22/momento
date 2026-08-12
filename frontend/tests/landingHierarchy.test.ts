import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 첫 화면의 위계 (UI 정리 3단계 B).
 *
 * ① 제목 아래 두 줄이 같은 클래스라 무게가 같고, 붙어 보였다.
 *    설명 줄과 질문 줄은 하는 일이 다르다 — 질문은 **아래 칩에 대한 물음**이다.
 *    자리로도 말한다: 설명과는 벌리고, 칩과는 붙인다.
 * ② `앨범 만들기` 의 비활성 모양이 브랜드색을 흐리게 깐 것이라 고장난 버튼처럼 보였다.
 *    못 누르는 상태는 흐리게 하는 것이 아니라 중립으로 바꾸는 것이다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const css = readFileSync(path.join(SRC, "App.css"), "utf8");
const landing = readFileSync(path.join(SRC, "components/Landing.tsx"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

test("★ 설명 줄과 질문 줄이 갈렸다 — 같은 클래스를 쓰지 않는다", () => {
  assert.match(landing, /<p className="landing__copy">\{SCREEN_LEAD\}<\/p>/);
  assert.match(landing, /<p className="landing__question">누구와 함께한 앨범인가요\?<\/p>/);
  assert.equal((landing.match(/className="landing__copy"/g) || []).length, 1, "설명 줄이 아직 둘이다");
});

test("★ 질문 줄이 더 작고 진하다 — 설명이 아니라 물음이다", () => {
  const question = rule(".landing__question");
  assert.match(question, /color: var\(--c-text-soft\)/);
  assert.match(question, /font-size: var\(--t-xs\)/);
  assert.match(question, /font-weight: 700/);
  // 설명 줄은 그대로 muted 다.
  assert.match(rule(".landing__copy"), /color: var\(--c-text-muted\)/);
});

test("★ 질문은 칩에 붙고 설명과는 떨어진다 — 기존 간격 토큰만 쓴다", () => {
  assert.match(rule(".landing__question"), /margin: var\(--s-6\) 0 0/);   // 설명과 24px
  assert.match(rule(".landing__categories"), /margin: var\(--s-2\) 0 0/); // 칩과 8px
  // 숫자를 직접 적지 않는다.
  assert.doesNotMatch(rule(".landing__question"), /margin: [\d.]+(rem|px)/);
  assert.doesNotMatch(rule(".landing__categories"), /margin: [\d.]+(rem|px)/);
});

test("★ 비활성 버튼은 흐린 브랜드색이 아니라 중립이다", () => {
  const disabled = rule(".landing__cta:disabled");
  assert.match(disabled, /background: var\(--c-bg-soft\)/);
  assert.match(disabled, /color: var\(--c-text-subtle\)/);
  assert.match(disabled, /border: 1px solid var\(--c-border\)/);
  // 흐리게 깔던 방식은 쓰지 않는다 — 브랜드색이 비쳐 "고장난 버튼"으로 보였다.
  assert.doesNotMatch(disabled, /opacity/);
  assert.match(disabled, /cursor: not-allowed/);
});

test("활성 상태는 그대로다 — 못 누를 때만 달라진다", () => {
  const cta = rule(".landing__cta");
  assert.match(cta, /background: var\(--c-brand-action\)/);
  assert.match(cta, /color: var\(--c-surface\)/);
  assert.match(cta, /min-height: 52px/);
});

test("기본 선택을 넣지 않았다 — 종류를 안 고르면 버튼은 여전히 막힌다", () => {
  // 기본값을 주면 앨범 글의 결이 흐려진다. 그 판단은 PO 몫이라 이번에 하지 않는다.
  assert.doesNotMatch(landing, /useState<AlbumCategory>\(\s*"/);
  assert.match(landing, /disabled=\{/);
});
