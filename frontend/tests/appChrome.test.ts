import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BRAND_BUSINESS_INFO, LEGAL_LINKS } from "../src/lib/brand";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const publicFile = (p: string) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

test("상단은 화면당 하나 — AppHeader 만이 브랜드를 그린다", () => {
  const app = read("App.tsx");
  const screen = read("components/AlbumScreen.tsx");
  // ★ 헤더 element 를 그리는 곳은 App 하나뿐이다. 앨범 화면은 우측 slot 만 채운다
  //   — 예전에는 앨범이 자기 헤더를 그리고 전역 헤더를 감춰서 구현이 두 벌이었다.
  assert.equal((app.match(/<AppHeader ?\/?>/g) || []).length, 1);
  assert.doesNotMatch(screen, /<AppHeader/);
  assert.match(screen, /<HeaderRight>/);
  // "이 화면에서는 전역 헤더를 감춘다" 분기가 없다.
  assert.doesNotMatch(app, /hidesGlobalHeader/);
  assert.match(app, /\{!adminRoute \? <AppHeader \/> : null\}/);
  // 인라인 헤더 마크업도 없다.
  assert.doesNotMatch(app, /<header className="app__header">/);
  // 브랜드 문자열은 상수에서만 읽는다.
  const header = read("components/AppHeader.tsx");
  assert.match(header, /BRAND_NAME_KO_PARTS\.lead/);
  // ★ 헤더 브랜드는 한 줄이다 — 영문 표기(woorialbum)는 높이를 키우므로 헤더에서 뺐다.
  //   랜딩 본문·푸터에서는 계속 쓴다(lib/brand.ts 는 그대로).
  assert.doesNotMatch(header, /BRAND_NAME_EN/);
  assert.doesNotMatch(header, /우리앨범|woorialbum/);
});

test("하단도 화면당 하나 — 관리자 제외 모든 화면에 AppFooter", () => {
  const app = read("App.tsx");
  assert.equal((app.match(/<AppFooter /g) || []).length, 1);
  assert.match(app, /!adminRoute \? <AppFooter withBottomNavigation=\{hasBottomNavigation\}/);
  // AlbumScreen 은 푸터를 내지 않는다(App 한 곳에서만).
  assert.doesNotMatch(read("components/AlbumScreen.tsx"), /<AppFooter/);
});

test("푸터: 브랜드 + 약관·개인정보 + 사업자 정보 5개(문서에 있는 것만)", () => {
  const footer = read("components/AppFooter.tsx");
  assert.match(footer, /BRAND_NAME_KO/);
  assert.match(footer, /LEGAL_LINKS/);
  assert.match(footer, /BRAND_BUSINESS_INFO/);
  // 문서(TERMS_OF_SERVICE.md 회사 정보)에 있는 5개.
  assert.deepEqual(BRAND_BUSINESS_INFO.map((item) => item.label),
    ["상호", "대표자", "사업자등록번호", "주소", "문의"]);
  // ★ 문서에 없는 항목을 지어내지 않는다.
  const labels = BRAND_BUSINESS_INFO.map((item) => item.label).join(" ");
  for (const absent of ["통신판매업", "호스팅", "전화"]) {
    assert.equal(labels.includes(absent), false, `문서에 없는 항목: ${absent}`);
  }
  assert.deepEqual(LEGAL_LINKS.map((link) => link.href), ["/terms.html", "/privacy.html"]);
});

test("약관·개인정보 링크는 살아 있고, 랜딩에 두 번 나오지 않는다", () => {
  // 공용 푸터가 유일한 링크 자리(로그인 동의 고지는 법적 필수라 별개로 남는다).
  assert.doesNotMatch(read("components/Landing.tsx"), /terms\.html|privacy\.html/);
  assert.match(read("components/AuthPanel.tsx"), /terms\.html/); // 동의 시점 고지는 유지
  assert.match(read("components/AppFooter.tsx"), /LEGAL_LINKS/);
});

test("푸터 여백은 하단 네비가 있는 화면에서만 — 네비 높이는 한 곳에서 읽는다", () => {
  const css = read("components/AppChrome.css");
  // 높이 값은 CSS 변수 한 곳에만 있다(두 곳에 적으면 한쪽만 바뀌어 가려진다).
  assert.match(css, /--nav-height: 82px/);
  assert.match(css, /\.app-footer--above-nav \{[\s\S]*var\(--nav-height\)/);
  // 기본 푸터에는 네비 여백이 없다 — 네비 없는 화면에 빈 공간이 생기지 않는다.
  const base = css.split(".app-footer {")[1].split("}")[0];
  assert.doesNotMatch(base, /--nav-height/);
  const app = read("App.tsx");
  assert.match(app, /const hasBottomNavigation = showGlobalBottomNavigation \|\| Boolean\(/);
});

test("참여 화면(/join, /contribute)은 헤더 우측을 비운다", () => {
  const app = read("App.tsx");
  // 초대받은 사람이 처음 보는 화면 — 계정·로그인이 있으면 "먼저 가입하라"로 읽힌다.
  assert.match(app, /!albumOwnsHeaderSlot && !isJoinSurface \? <HeaderRight>\{accountEntry\}<\/HeaderRight>/);
  // 아무도 채우지 않으면 자리 자체가 보이지 않는다.
  assert.match(read("components/AppChrome.css"), /\.app-header__right:empty \{ display: none; \}/);
});

test("PDF·인쇄에는 헤더·푸터가 들어가지 않는다", () => {
  const exportPdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  // PDF 는 AlbumRenderer(print) 만 마운트한다 — 크롬이 트리에 존재하지 않는다.
  assert.doesNotMatch(exportPdf, /AppHeader|AppFooter|AlbumScreen/);
  // 브라우저 인쇄에도 대비해 @media print 로 숨긴다.
  assert.match(read("components/AppChrome.css"), /@media print \{[\s\S]*\.app-footer \{ display: none/);
});

test("정적 법적 고지 페이지: 브랜드 통일 + 앱으로 돌아가는 길", () => {
  for (const file of ["terms.html", "privacy.html"]) {
    const html = publicFile(file);
    assert.equal(html.includes("Momento"), false, `${file}: 옛 브랜드 표기 잔존`);
    assert.match(html, /우리앨범/);
    assert.match(html, /class="back-link"><a href="\/">← 우리앨범으로 돌아가기/);
  }
});
