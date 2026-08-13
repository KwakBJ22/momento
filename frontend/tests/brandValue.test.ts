import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { BRAND_VALUE_LINES, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE } from "../src/lib/brand";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/**
 * `우리앨범이란` — 가치 소개 (2026-08-13 PO 판단).
 *
 * 세 가지를 고정한다. 셋 다 대화에서 실제로 갈렸던 지점이라 적어 둔다.
 *  1) **메뉴로 만들지 않는다.** 초대 링크로 들어온 사람은 로그인 전이라 네비가 안 보인다.
 *     정작 `인스타랑 뭐가 다르냐` 고 묻는 사람에게 안 닿는다.
 *  2) **문구는 한 곳에만 있다.** 자리가 섋이라, 화면마다 글을 쓰면 곧 서로 달라진다.
 *  3) **제목에 부정어를 쓰지 않고, 업계 말을 쓰지 않는다.**
 */

test("문구는 lib/brand.ts 한 곳에만 있다 (화면이 제 글을 따로 갖지 않는다)", () => {
  for (const file of ["components/BrandValue.tsx", "components/Landing.tsx", "components/PublicShareView.tsx", "components/AppFooter.tsx"]) {
    assert.equal(read(file).includes(BRAND_VALUE_TITLE), false, `${file} 이 제목을 직접 들고 있다`);
    assert.equal(read(file).includes(BRAND_VALUE_SHORT), false, `${file} 이 짧은 판을 직접 들고 있다`);
  }
  assert.match(read("components/BrandValue.tsx"), /BRAND_VALUE_LINES, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE/);
});

test("제목에 부정어를 쓰지 않는다 · 업계 말을 쓰지 않는다", () => {
  assert.doesNotMatch(BRAND_VALUE_TITLE, /아니에요|아닙니다|아니라/);
  const all = [BRAND_VALUE_TITLE, BRAND_VALUE_SHORT, ...BRAND_VALUE_LINES].join(" ");
  // §8 — 사용자에게 기술을 내보이지 않는다. `피드` 는 일반인이 쓰지 않는 말이다.
  for (const word of ["피드", "AI", "GPT", "인공지능", "플랫폼", "아카이브"]) {
    assert.equal(all.includes(word), false, `문구에 ${word} 가 들어 있다`);
  }
});

test("첫 줄은 겪은 일로 열고, 곧바로 함께로 넘어간다 (저장 서비스와 갈리는 자리)", () => {
  assert.match(BRAND_VALUE_LINES[0], /못 찾/);
  assert.match(BRAND_VALUE_LINES[1], /같이 있었던 사람들과/);
  // 짧은 판도 `함께` 를 잃지 않는다 — 이 줄 하나만 보는 사람이 가장 많다.
  assert.match(BRAND_VALUE_SHORT, /같이 있었던 사람들과/);
});

test("★ 세 자리에 놓인다 — 첫 화면(로그인 전) · 공유 화면 맨 아래 · 푸터 시트", () => {
  // 1) 첫 화면: 행동 아래, 로그인 전에만.
  const landing = read("components/Landing.tsx");
  assert.match(landing, /\{!userId && <BrandValue \/>\}/);
  assert.ok(landing.indexOf("landing__cta") < landing.indexOf("<BrandValue"), "소개가 `앨범 만들기` 위로 올라가면 만들러 온 사람의 길이 길어진다");

  // 2) 공유 화면: 본문 맨 아래(담아두기 다음). 여기가 진짜 도착지다.
  const share = read("components/PublicShareView.tsx");
  assert.match(share, /\{bookmarkCard\}[\s\S]{0,400}?<BrandValue variant="short" \/>/);

  // 3) 푸터: 새 주소를 만들지 않고 이미 있는 시트 껍데기로 연다.
  const footer = read("components/AppFooter.tsx");
  assert.match(footer, /<BrandValue variant="sheet" \/>/);
  assert.match(footer, /app-footer__about-link/);
});

test("★ 하단 메뉴에는 넣지 않는다 (전역 네비는 행동만 놓는 자리다)", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  for (const word of ["소개", "우리앨범이란", "BrandValue"]) {
    assert.equal(nav.includes(word), false, `네비에 ${word} 칸이 생겼다 — 2칸 규칙(§4)이 깨진다`);
  }
});
