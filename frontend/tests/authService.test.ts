import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";

import { oauthProviderFor, toAppUser } from "../src/services/authService";
import { createAuthDebugLogger } from "../src/lib/authDebug";

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

test("Supabase auth persists and restores sessions through a storage-safe client configuration", () => {
  const source = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /autoRefreshToken:\s*true/);
  assert.match(source, /detectSessionInUrl:\s*true/);
  assert.match(source, /storage:\s*safeAuthStorage/);
  assert.match(source, /JSON\.parse\(value\)/);
});

test("OAuth callback waits for a persisted session before restoring the original internal path", () => {
  const source = readFileSync(new URL("../src/services/authService.ts", import.meta.url), "utf8");
  const callback = source.slice(source.indexOf("export async function completeOAuthCallback"));
  assert.match(callback, /await supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(callback, /const session = await getSession\(\)/);
  assert.match(callback, /if \(!existing\) \{/);
  assert.match(source, /returnTo=/);
  assert.match(source, /target\.origin === window\.location\.origin/);
});

test("auth debug logging is disabled in production by default and strips sensitive metadata", () => {
  const records: Array<[string, Record<string, unknown> | undefined]> = [];
  const writer = (message: string, metadata?: Record<string, unknown>) => records.push([message, metadata]);
  createAuthDebugLogger({ DEV: false }, writer)("ROUTE_OWNER", { userId: "abcdef123456", email: "family@example.com", token: "secret", authorization: "Bearer secret" });
  assert.equal(records.length, 0);

  createAuthDebugLogger({ DEV: false, VITE_AUTH_DEBUG: "true" }, writer)("ROUTE_OWNER", { userId: "abcdef123456", email: "family@example.com", token: "secret" });
  assert.deepEqual(records, [["[AUTH] ROUTE_OWNER", { userId: "abcdef" }]]);
});

test("auth debug logging is active in development without exposing full identifiers", () => {
  const records: Array<[string, Record<string, unknown> | undefined]> = [];
  createAuthDebugLogger({ DEV: true }, (message, metadata) => records.push([message, metadata]))(
    "ROUTE_GUEST", { reason: "no_session", hasSession: false, shareToken: "never-logged" },
  );
  assert.deepEqual(records, [["[AUTH] ROUTE_GUEST", { reason: "no_session", hasSession: false }]]);
});
