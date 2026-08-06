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
  const invisible = [
    /momento-[a-z-]+/g,          // storage keys: momento-auth-return-to 등
    /\[Momento\]/g,              // 개발 콘솔 로그 접두사
    /momento-ashen-rho/g,        // 배포 호스트
    /X-Momento-[A-Za-z-]+/g,     // HTTP 헤더 이름(백엔드와의 계약 — 이름과 무관)
    /supabase|railway|vercel/gi, // 인프라 식별자
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

test("앨범 상세는 헤더가 하나 — App 쪽 AppHeader 가 그 화면에서만 꺼진다", () => {
  const app = read("App.tsx");
  // 상단은 공용 AppHeader 하나로 통일됐다(인라인 3조각은 사라졌다).
  assert.match(app, /const hidesGlobalHeader = Boolean\(sharedAlbumId \|\| shareToken\)/);
  assert.match(app, /!adminRoute && !hidesGlobalHeader \? <AppHeader/);
  // 다른 화면(랜딩·업로드·내 앨범 등)에는 그대로 남는다 — 조건은 adminRoute 와
  // 이 플래그뿐이므로 앨범 외 화면에서는 항상 렌더링된다.
  assert.doesNotMatch(app, /myAlbumsPage[^\n]*hidesGlobalHeader/);
});

test("계정 진입점은 앨범 헤더로 옮겨져도 드롭다운 5항목과 44px을 유지한다", () => {
  const app = read("App.tsx");
  // 같은 노드를 전역/앨범 양쪽이 재사용 — 동작(로그아웃·탈퇴 등)은 그대로.
  assert.match(app, /const accountEntry = user \? \(/);
  for (const item of ["내 앨범", "로그아웃", "회원 탈퇴"]) {
    assert.ok(app.includes(item), `계정 메뉴 항목 누락: ${item}`);
  }
  assert.match(app, /app__account-name[\s\S]{0,120}app__account-email/); // 이름·이메일 행
  // 게스트는 아이콘이 아니라 "로그인" 글자.
  assert.match(app, /className="app__account-login" onClick=\{openLogin\}>로그인/);
  // 앨범 상세로 전달.
  assert.match(app, /accountSlot=\{accountEntry\}/);
  const screen = read("components/AlbumScreen.tsx");
  assert.match(screen, /\{accountSlot\}/);
  // 누르는 영역 44px (기존 전역 34px 원은 하한 미달이었다).
  const css = read("App.css");
  assert.match(css, /\.album-screen__hdr \.app__account-trigger \{ width: 44px; height: 44px; \}/);
  assert.match(css, /\.app__account-login \{[^}]*min-height: 44px/);
});

test("앨범 헤더가 유일한 브랜드 표기 — 제목 위 eyebrow는 제거됐다", () => {
  const header = read("components/AlbumScreenHeader.tsx");
  assert.doesNotMatch(header, /album-screen-header__brand/);
  // 브랜드는 공용 AppHeader 한 곳에서만 그린다(AlbumScreen 은 그것을 쓴다).
  assert.match(read("components/AlbumScreen.tsx"), /<AppHeader /);
  const appHeader = read("components/AppHeader.tsx");
  assert.match(appHeader, /BRAND_NAME_KO_PARTS\.lead/);
  assert.match(appHeader, /\{BRAND_NAME_EN\}/);
});
