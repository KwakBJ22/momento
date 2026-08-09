import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BRAND_DEFAULT_USER_NAME,
  BRAND_NAME_EN,
  BRAND_NAME_KO,
  BRAND_NAME_KO_PARTS,
  BRAND_PDF_FOOTER,
} from "../src/lib/brand";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test("브랜드 문자열은 상수 모듈 한 곳에서만 정의된다", () => {
  assert.equal(BRAND_NAME_KO, "우리앨범");
  assert.equal(BRAND_NAME_EN, "woorialbum");
  assert.equal(`${BRAND_NAME_KO_PARTS.lead}${BRAND_NAME_KO_PARTS.tail}`, BRAND_NAME_KO);
  assert.match(BRAND_PDF_FOOTER, /우리앨범에서 함께 만들었습니다/);
  assert.equal(BRAND_DEFAULT_USER_NAME, "우리앨범 사용자");
});

test("소스에 'Momento' 리터럴이 남아 있지 않다 (보이지 않는 자리는 제외)", () => {
  // 제외: 저장소 경로·패키지명·환경변수·DB 컬럼·localStorage 키처럼 사용자에게
  // 보이지 않는 식별자. 이름이 바뀌어도 그대로 두는 자리다.
  // ★ K-1-a 에서 콘솔 로그 접두사를, K-1-b 에서 **저장 키와 헤더 이름**을 뺐다.
  //   남은 예외는 셋뿐이고 K-1-c(버킷)와 도메인 붙일 때 없앤다.
  const invisible = [
    /momento-ashen-rho/g,                    // Vercel 배포 호스트 — 도메인 붙일 때
    /momento-private/g,                      // Storage 버킷 — K-1-c
    /momento-\$\{albumId\}-v\$\{albumVersion\}/g, // 저장소 안 PDF 이름 — K-1-c
    /momento-\{albumId\}-v\{version\}/g,        // 위 이름을 설명하는 주석
    /MOMENTO_API_URL/g,                      // Vercel 환경변수 — K-1-c
    /supabase|railway|vercel/gi,             // 인프라 식별자
  ];
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file.endsWith(`lib${sep}brand.ts`)) continue; // 상수 모듈의 주석은 허용
    let text = readFileSync(file, "utf8");
    for (const pattern of invisible) text = text.replace(pattern, "");
    if (/Momento/.test(text)) offenders.push(file.replace(SRC, ""));
  }
  assert.deepEqual(offenders, []);
});

test("앨범 상세도 같은 헤더를 쓴다 — 감추는 분기가 없다", () => {
  const app = read("App.tsx");
  // 헤더 element 는 관리자 외 모든 화면에서 App 이 한 번 그린다.
  assert.match(app, /\{!adminRoute \? <AppHeader \/> : null\}/);
  assert.doesNotMatch(app, /hidesGlobalHeader/);
  // 앨범 화면은 우측 slot 만 자기 것으로 채운다(헤더를 다시 그리지 않는다).
  assert.match(app, /const albumOwnsHeaderSlot = Boolean\(sharedAlbumId \|\| shareToken\)/);
});

test("계정 진입점은 모든 화면에서 ⋯ 시트 안이다 (SCREEN_SPEC §3)", () => {
  const app = read("App.tsx");
  // 항목 목록은 한 곳(accountMenuItems)에서 만들어 모든 자리가 같은 동작을 쓴다.
  // 계정 동작은 시트 아래쪽 행으로 옮겼다(§5 순서) — 계정 행은 정보만 보여준다.
  assert.match(app, /const accountSheetActions = \(/);
  for (const item of ["로그아웃", "회원 탈퇴"]) {
    assert.ok(app.includes(item), `계정 항목 누락: ${item}`);
  }
  // "내 앨범"은 계정 메뉴에서 뺀다 — 헤더 우측 링크와 중복이다.
  const menu = app.slice(app.indexOf("const accountSheetActions"), app.indexOf("const accountEntry"));
  assert.doesNotMatch(menu, /내 앨범/);
  // ★ 계정 원을 헤더에 두지 않는다: 로그인 상태의 우측은 ⋯ 하나뿐이다.
  assert.match(app, /className="app-header__more" aria-label="더보기"/);
  assert.doesNotMatch(app, /className="app__account-trigger"/);
  assert.doesNotMatch(app, /className="app__account"/);
  // 비로그인은 `로그인` 하나(§3 랜딩 비로그인).
  assert.match(app, /className="app__account-login" onClick=\{openLogin\}>로그인/);
  // 앨범 상세는 시트 행을 넘긴다.
  assert.match(app, /const accountSheetRow = \(\s*<AccountSheetRow/);
  assert.match(app, /accountSheet=\{accountSheetRow\}/);
  // 전역 ⋯ 시트도 같은 행을 쓴다(두 벌 만들지 않는다).
  assert.match(app, /album-more-sheet__list">\{accountSheetRow\}/);
  assert.match(read("components/AlbumView.tsx"), /accountSheet=\{accountSheet\}/);
  // 겹쳐 그리던 절대배치 잔재가 없다.
  assert.doesNotMatch(read("App.css"), /\.app__account \{[\s\S]{0,120}position: absolute/);
  // 44px 유지(헤더 ⋯·시트 아바타·시트 버튼).
  const css = read("components/AppChrome.css") + read("components/AlbumScreen.css");
  assert.match(css, /\.app-header__more \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /\.account-row__avatar \{ width: 44px; height: 44px/);
  assert.match(css, /\.account-row__actions button \{ min-height: 44px/);
});

test("앨범 상세 헤더 우측은 컨트롤 2개 — [내 앨범] + [⋯]", () => {
  const screen = read("components/AlbumScreen.tsx");
  const right = screen.slice(screen.indexOf("<HeaderRight>"), screen.indexOf("</HeaderRight>"));
  assert.match(right, /app-header__link/);   // 내 앨범
  assert.match(right, /app-header__more/);         // ⋯ (정의는 AppChrome.css 한 곳)
  // 계정 원은 헤더 밖에 두지 않는다.
  assert.doesNotMatch(right, /accountSlot|app__account/);
  assert.equal((right.match(/<a |<button /g) || []).length, 2);
  // 계정 행은 ⋯ 시트 최상단에 들어간다(시트는 공용 컴포넌트 — 앨범 상세·공유가 함께 쓴다).
  const sheet = read("components/AlbumMoreSheet.tsx");
  assert.match(sheet, /album-more-sheet__list">\s*\{\/\*[\s\S]{0,90}\*\/\}\s*\{accountSheet\}/);
  assert.match(read("components/AlbumView.tsx"), /accountSheet=\{accountSheet\}/);
});

test("앨범 헤더가 유일한 브랜드 표기 — 제목 위 eyebrow는 제거됐다", () => {
  const header = read("components/AlbumScreenHeader.tsx");
  assert.doesNotMatch(header, /album-screen-header__brand/);
  // 브랜드는 공용 AppHeader 한 곳에서만 그린다(AlbumScreen 은 그것을 쓴다).
  assert.match(read("components/AlbumScreen.tsx"), /<HeaderRight>/);
  const appHeader = read("components/AppHeader.tsx");
  assert.match(appHeader, /BRAND_NAME_KO_PARTS\.lead/);
  assert.doesNotMatch(appHeader, /BRAND_NAME_EN/); // 헤더는 한 줄(높이 축소)
});

// --- K-1-a · 개발자에게만 보이는 문자열도 이름을 맞춘다 ---

test("★ 콘솔 로그 접두사가 `[우리앨범]` 이다", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    if (text.includes("[Momento]")) offenders.push(file.replace(SRC, ""));
  }
  assert.deepEqual(offenders, []);
  // 실제로 쓰는 자리가 있어야 이 규칙이 헛돌지 않는다.
  const kakao = readFileSync(`${SRC}${sep}hooks${sep}useKakaoSdk.ts`, "utf8");
  assert.match(kakao, /\[우리앨범\]/);
});

test("★ 새 계정의 기본 표시 이름이 `우리앨범 사용자` 다", () => {
  // 이름은 상수 모듈 한 곳에서 나오고, DB 트리거도 같은 값을 쓴다(K-1-a migration).
  assert.equal(BRAND_DEFAULT_USER_NAME, "우리앨범 사용자");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260809120000_default_display_name_rename.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'우리앨범 사용자'/);
  // ★ 옛 migration 은 고치지 않는다 — 이력이라 그대로 둔다. 새 정의로 덮는다.
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.handle_new_auth_user_profile/);
});
