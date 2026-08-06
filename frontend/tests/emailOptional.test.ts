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
  const app = read("App.tsx");
  assert.match(app, /\{user\.email \? <p className="app__account-email">\{user\.email\}<\/p> : null\}/);
});

test("the admin user table falls back to display_name then user_id when email is absent", () => {
  const admin = read("components/admin/AdminConsole.tsx");
  assert.match(admin, /user\.email \|\| user\.display_name \|\| user\.user_id/);
});
