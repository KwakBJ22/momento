import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// Kakao login no longer provides an email. Every place that read the email must degrade
// gracefully. These bindings guard the fallbacks the whole app relies on.

test("toAppUser falls back to a nickname then a friendly default when email is absent", () => {
  const authService = read("services/authService.ts");
  // nickname (metadata) → email prefix → 브랜드 기본 표시명(BRAND_DEFAULT_USER_NAME).
  // 브랜드 문자열은 lib/brand.ts 한 곳에서만 정의한다 — 여기서 리터럴을 다시 적지 않는다.
  assert.match(authService, /displayName: metadataName\(metadata\) \|\| text\(user\.email\)\?\.split\("@"\)\[0\] \|\| BRAND_DEFAULT_USER_NAME/);
  assert.match(authService, /email: text\(user\.email\)/); // null when absent, not thrown
});

test("the account menu only renders the email row when an email exists", () => {
  // 계정 행은 AccountSheetRow 한 곳에 있다(⋯ 시트 최상단 — SCREEN_SPEC §5).
  const row = read("components/AccountSheetRow.tsx");
  assert.match(row, /\{user\.email \? <p className="account-row__email">\{user\.email\}<\/p> : null\}/);
});

test("the admin user table always shows the name and email, with an id suffix only when email is absent", () => {
  // PO 판단: 관리자 한 사람이 회원을 식별하는 자리이므로 이름과 이메일을 함께 보인다.
  // 이메일은 카카오 동의에 따라 없을 수 있어, 그때만 UUID 앞 8자로 같은 이름을 구분한다.
  const admin = read("components/admin/AdminConsole.tsx");
  assert.match(admin, /user\.display_name \|\| "이름 없음"/);
  assert.match(admin, /user\.email \|\| `\(이메일 없음\) · \$\{user\.user_id\.slice\(0, 8\)\}`/);
});
