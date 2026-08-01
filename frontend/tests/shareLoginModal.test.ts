import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("login modal is hoisted to a top-level const gated only by showLogin", () => {
  // The modal must exist independently of any single route branch so it can
  // render on the share page, not only on Landing.
  assert.match(appSource, /const loginModal = showLogin \?/);
  assert.match(appSource, /className="auth-modal"/);
});

test("the login modal renders at the app root, beside the withdraw modal (branch-independent)", () => {
  // {loginModal} must sit at the app root so every surface (share, join, album,
  // landing) shows it when showLogin is true.
  assert.match(appSource, /\{loginModal\}\s*\{withdrawOpen \?/);
});

test("the login modal is no longer nested inside the Landing-only branch", () => {
  // Exactly one auth-modal container — inside the hoisted const, not duplicated
  // in the Landing branch.
  const occurrences = appSource.match(/className="auth-modal"/g) ?? [];
  assert.equal(occurrences.length, 1);
  // The Landing render branch ends right after the <Landing/> element with no
  // trailing modal fragment.
  assert.match(appSource, /<Landing[\s\S]*?hideLogin=\{Boolean\(user\)\}\s*\/>\}/);
  // Nothing between <Landing and its closing "/>}" reintroduces the modal.
  assert.doesNotMatch(appSource, /<Landing[\s\S]*?auth-modal[\s\S]*?\/>\}/);
});

test("body scroll lock is guarded by the same showLogin gate that renders the modal", () => {
  // Guarantees there is no path that locks the body without a renderable modal:
  // the lock only runs when showLogin is true, and the modal renders whenever
  // showLogin is true.
  assert.match(
    appSource,
    /if \(!showLogin\) return;[\s\S]*?document\.body\.style\.overflow = "hidden"/,
  );
  // The overflow:hidden lock appears exactly once (only inside that effect).
  const locks = appSource.match(/document\.body\.style\.overflow = "hidden"/g) ?? [];
  assert.equal(locks.length, 1);
});
