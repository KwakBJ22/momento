import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { BRAND_USE_CASES, BRAND_USE_LABEL, BRAND_VALUE_CARDS, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE } from "../src/lib/brand";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/**
 * `우리앨범 소개` — 가치 소개 (2026-08-13 PO 판단 · 2026-08-16 구조 변경).
 *
 * ★ **2 + 2 위계로 바뀌었다**(2026-08-16 · 시안 1a). 예전에는 아이콘 + 제목 + 본문이
 *   **네 번 반복**이라 넷이 전부 같은 무게로 읽혔고, 그대로 스크롤로 지나갔다.
 *     앞 2칸  **왜 쓰나** — 흰 카드에 제목 · 그림 · 본문
 *     뒤 2칸  **누가 쓰나** — 작은 아이콘 + 제목 + 한 줄, 2열
 *   그래서 `BRAND_VALUE_SECTIONS`(네 칸)이 `BRAND_VALUE_CARDS`(2) +
 *   `BRAND_USE_CASES`(2)로 갈렸다. 아래 검사도 그 구조로 바꿔 적었다.
 *
 * 나머지 셋은 그대로다. 셋 다 대화에서 실제로 갈렸던 지점이라 적어 둔다.
 *  1) **메뉴로 만들지 않는다.** 초대 링크로 들어온 사람은 로그인 전이라 네비가 안 보인다.
 *  2) **문구는 한 곳에만 있다.** 자리가 셋이라, 화면마다 글을 쓰면 곧 서로 달라진다.
 *  3) **제목에 부정어를 쓰지 않고, 업계 말을 쓰지 않는다.**
 */

test("문구는 lib/brand.ts 한 곳에만 있다 (화면이 제 글을 따로 갖지 않는다)", () => {
  for (const file of ["components/BrandValue.tsx", "components/Landing.tsx", "components/PublicShareView.tsx", "components/AppFooter.tsx"]) {
    assert.equal(read(file).includes(BRAND_VALUE_TITLE), false, `${file} 이 제목을 직접 들고 있다`);
    assert.equal(read(file).includes(BRAND_VALUE_SHORT), false, `${file} 이 짧은 판을 직접 들고 있다`);
  }
  const component = read("components/BrandValue.tsx");
  for (const card of BRAND_VALUE_CARDS) {
    assert.equal(component.includes(card.body), false, "화면이 본문을 직접 들고 있다");
  }
  for (const use of BRAND_USE_CASES) {
    assert.equal(component.includes(use.body), false, "화면이 본문을 직접 들고 있다");
  }
  assert.match(component, /BRAND_USE_CASES, BRAND_USE_LABEL, BRAND_VALUE_CARDS, BRAND_VALUE_LABEL, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE/);
});

test("제목에 부정어를 쓰지 않는다 · 업계 말을 쓰지 않는다", () => {
  assert.doesNotMatch(BRAND_VALUE_TITLE, /아니에요|아닙니다|아니라/);
  const all = [
    BRAND_VALUE_TITLE, BRAND_VALUE_SHORT, BRAND_USE_LABEL,
    ...BRAND_VALUE_CARDS.flatMap((card) => [card.title, card.body]),
    ...BRAND_USE_CASES.flatMap((use) => [use.title, use.body]),
  ].join(" ");
  // §8 — 사용자에게 기술을 내보이지 않는다. `피드` 는 일반인이 쓰지 않는 말이다.
  for (const word of ["피드", "AI", "GPT", "인공지능", "플랫폼", "아카이브"]) {
    assert.equal(all.includes(word), false, `문구에 ${word} 가 들어 있다`);
  }
});

test("★ 앞 2칸은 **왜 쓰나** — 겪은 일로 열고 곧바로 함께로 넘어간다", () => {
  assert.equal(BRAND_VALUE_CARDS.length, 2, "앞 칸이 둘이 아니다");
  // 첫 칸: 사진이 쌓였는데 못 찾는다 → 날짜로 묶인다.
  assert.match(BRAND_VALUE_CARDS[0].body, /찾아 헤매지/);
  assert.match(BRAND_VALUE_CARDS[0].title, /날짜와 위치대로/);
  // 둘째 칸: 저장 서비스와 갈라지는 자리다.
  assert.match(BRAND_VALUE_CARDS[1].body, /같이 있었던 사람들과/);
  // 제목은 두 줄이고, 둘째 칸은 `앨범` 만 브랜드색이다(로고 조합 · §9).
  for (const card of BRAND_VALUE_CARDS) {
    assert.match(card.title, /\n/, `${card.title} 이 한 줄이다`);
  }
  assert.equal(BRAND_VALUE_CARDS[1].titleBrand, "앨범");
  // 짧은 판도 `함께` 를 잃지 않는다 — 이 줄 하나만 보는 사람이 가장 많다.
  assert.match(BRAND_VALUE_SHORT, /같이 있었던 사람들과/);
});

test("★ 뒤 2칸은 **누가 쓰나** — 앞 칸과 무게가 다르다", () => {
  assert.equal(BRAND_USE_CASES.length, 2);
  assert.deepEqual(BRAND_USE_CASES.map((use) => use.title), ["부모님 회고 앨범", "아이 성장 앨범"]);
  for (const use of BRAND_USE_CASES) {
    // 아이콘은 3a6a00e 에서 들어온 그 파일이다.
    assert.match(use.icon, /^\/use-[a-z]+\.webp$/, `${use.title} 의 아이콘 경로`);
    // 한 줄이다 — 앞 카드처럼 길면 무게가 같아진다.
    assert.ok(use.body.length <= 40, `${use.title} 의 한 줄이 너무 길다`);
  }
  assert.equal(BRAND_USE_LABEL, "이런 앨범을 많이 만들어요");
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

test("★ 소개의 그림은 **실제 사진**이다 (시안)", () => {
  // ★ 2026-08-16 에 뒤집혔다. 그 전날 `선과 면으로 그린 모양` 으로 바꿨는데,
  //   그건 **앨범 모양 견본**(AlbumAppearancePicker)의 규칙이었다 —
  //   소개는 무엇이 되는지 보여 주는 자리라 시안이 실제 사진을 쓴다.
  //   선과 면으로 그리는 것은 견본뿐이다.
  const c = read("components/BrandValue.tsx");
  assert.match(c, /function SortArt\(\)/);
  assert.match(c, /function TogetherArt\(\)/);
  // 사진은 히어로와 **같은 세 장**이다 — 새 파일을 늘리지 않는다.
  assert.match(c, /const ART_SHOTS = \["\/hero-mom\.webp", "\/hero-dad\.webp", "\/hero-me\.webp"\];/);
  // 더미 3장 · 앨범 그리드 4장 · 둘째 칸 1장 · 라벨 심벌 · 뒤 2칸 아이콘 · 짧은 판.
  assert.equal((c.match(/<img/g) || []).length, 6);
  // 장식이므로 낭독기에는 읽히지 않는다.
  assert.equal((c.match(/alt=""/g) || []).length, 6);
  assert.equal((c.match(/aria-hidden="true"/g) || []).length, 2, "그림 둘 다 장식으로 표시해야 한다");
  // 잘리는 자리를 정해 네 칸이 같아 보이지 않게 한다.
  assert.match(read("components/BrandValue.css"), /object-position: 70% 50%/);
});

test("★ 견본은 그대로 선과 면이다 — 두 규칙이 섞이지 않는다", () => {
  const picker = read("components/AlbumAppearancePicker.tsx");
  assert.equal(picker.includes("<img"), false, "앨범 모양 견본에 사진이 들어갔다");
  assert.match(picker, /선과 면으로 그린 모양/);
});

test("★ 소개 구역에 hex 를 직접 쓰지 않는다 — 값은 토큰 한 곳이다 (§8)", () => {
  const css = read("components/BrandValue.css");
  const found = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(found, [], `소개 CSS 에 hex 가 있다: ${found.join(" ")}`);
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(read("components/BrandValue.tsx")), false, "소개 코드에 hex 가 있다");
  // 새로 더한 값은 tokens.css 에 이름이 있다.
  const tokens = read("styles/tokens.css");
  for (const name of ["--c-about-bg", "--c-about-line", "--c-about-tray", "--c-about-tile", "--c-about-mine", "--c-about-theirs"]) {
    assert.match(tokens, new RegExp(`${name}: #`), `${name} 이 없다`);
  }
});

test("★ 위와 갈리는 자리다 — 배경과 선으로 가른다", () => {
  const css = read("components/BrandValue.css");
  const root = css.slice(css.indexOf(".brand-value {"), css.indexOf("}", css.indexOf(".brand-value {")));
  assert.match(root, /background: var\(--c-about-bg\)/);
  assert.match(root, /border-top: 1px solid var\(--c-about-line\)/);
  assert.match(root, /padding: 30px 22px 34px/);
  // 시트에서는 그 둘을 뺀다 — 이미 제목 줄과 경계가 있다.
  const sheet = css.slice(css.indexOf(".brand-value--sheet {"), css.indexOf("}", css.indexOf(".brand-value--sheet {")));
  assert.match(sheet, /border-top: 0/);
  assert.match(sheet, /background: none/);
});
