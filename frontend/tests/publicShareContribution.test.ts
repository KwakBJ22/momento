import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../src/components/PublicShareView.tsx", import.meta.url), "utf8");

test("an authenticated click is never silently swallowed while the session starts", () => {
  // Old bug: `if (authenticatedUser && !contributionSession) return;` dropped the
  // click with no feedback. Now it records the intent and (re)starts the session.
  assert.match(src, /pendingContributionActionRef\.current = action;/);
  assert.match(src, /setContributionRetry\(\(value\) => value \+ 1\)/);
});

test("account session start is retryable — a failed attempt is not locked forever", () => {
  // The dedupe key includes contributionRetry so bumping it clears the guard.
  assert.match(src, /const key = `\$\{token\}:\$\{authenticatedUser\.id\}:\$\{contributionRetry\}`/);
  assert.match(src, /contributionRetry,/); // present in the effect dependency array
  assert.match(src, /const retryContribution = \(\)/);
});

test("a failed session surfaces an error and a retry control", () => {
  assert.match(src, /public-share__join-status/); // preparing state is visible
  assert.match(src, /onClick=\{retryContribution\}/);
  assert.match(src, /다시 시도/);
});

test("the start effect opens the pending action once the session is ready", () => {
  assert.match(src, /const pending = pendingContributionActionRef\.current;/);
  assert.match(src, /setContributionAction\(pending \?\? requestedContribution\)/);
});

test("the guest name-form path is preserved (unauthenticated flow still starts a contribution)", () => {
  // openContribution only diverts authenticated users without a session; guests
  // still fall through to contributionPanelAction.
  assert.match(src, /if \(authenticatedUser && !contributionSession\) \{/);
  assert.match(src, /const next = contributionPanelAction\(contributionSession, action\);/);
});
