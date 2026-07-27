import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";

import { oauthProviderFor, toAppUser } from "../src/services/authService";

function supabaseUser(overrides: Partial<User>): User {
  return {
    id: "8a46e3cb-6c21-4f3c-a6f7-915dcc9e6205",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-07-27T00:00:00Z",
    ...overrides,
  } as User;
}

test("auth service maps Kakao metadata to the application user contract", () => {
  const user = toAppUser(supabaseUser({
    email: "family@example.com",
    app_metadata: { provider: "kakao" },
    user_metadata: { nickname: "\ubbfc\uc218", profile_image: "https://example.com/avatar.jpg" },
  }));

  assert.deepEqual(user, {
    id: "8a46e3cb-6c21-4f3c-a6f7-915dcc9e6205",
    displayName: "\ubbfc\uc218",
    avatarUrl: "https://example.com/avatar.jpg",
    email: "family@example.com",
    phone: null,
    provider: "kakao",
  });
});

test("auth service maps the configured Naver custom provider without leaking Supabase User", () => {
  const user = toAppUser(supabaseUser({
    phone: "+821012345678",
    app_metadata: { provider: "custom:naver" },
    user_metadata: { name: "\uc9c0\uc601" },
  }));

  assert.equal(user.displayName, "\uc9c0\uc601");
  assert.equal(user.provider, "naver");
  assert.equal(user.phone, "+821012345678");
  assert.equal("app_metadata" in user, false);
});

test("provider-specific Supabase identifiers stay inside the auth service", () => {
  assert.equal(oauthProviderFor("kakao"), "kakao");
  assert.equal(oauthProviderFor("naver"), "custom:naver");
});

test("Kakao OAuth uses Supabase provider defaults without forcing email consent scopes", () => {
  const source = readFileSync(new URL("../src/services/authService.ts", import.meta.url), "utf8");
  const oauthCall = source.slice(source.indexOf("signInWithOAuth"), source.indexOf("export async function signOut"));

  assert.equal(/account_email|scope\s*:|scopes\s*:/.test(oauthCall), false);
  assert.match(oauthCall, /redirectTo/);
});
