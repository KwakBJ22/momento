import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAlbumLimitReached, createActionFor } from "../src/lib/albumLimit";

// Real branch behavior (the functions App/Landing actually call), not a regex.

test("the limit is reached only for a logged-in user at or over the cap", () => {
  assert.equal(isAlbumLimitReached(true, { count: 3, max: 3 }), true);
  assert.equal(isAlbumLimitReached(true, { count: 4, max: 3 }), true);
  assert.equal(isAlbumLimitReached(true, { count: 2, max: 3 }), false);
});

test("guests and an unknown limit are never blocked", () => {
  assert.equal(isAlbumLimitReached(false, { count: 9, max: 3 }), false); // guest
  assert.equal(isAlbumLimitReached(true, null), false);                  // not loaded yet
  assert.equal(isAlbumLimitReached(true, { count: 3, max: 0 }), false);  // unknown cap
});

test("at the limit the CTA blocks the create flow instead of starting it", () => {
  assert.equal(createActionFor("family", true), "blocked");   // does NOT advance
  assert.equal(createActionFor("family", false), "start");    // normal flow
  assert.equal(createActionFor(null, true), "none");          // no category picked
});

// Binding: Landing must gate on createActionFor and render the inline notice
// (no new page/modal), and App must feed it from the bootstrap-derived state.
const landing = readFileSync(new URL("../src/components/Landing.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("Landing blocks via createActionFor and shows an inline notice", () => {
  assert.match(landing, /createActionFor\(category, albumLimitReached\)/);
  assert.match(landing, /action === "blocked"/);
  assert.match(landing, /className="landing__limit-notice"/);
});

test("App derives the limit from bootstrap and passes it to Landing", () => {
  assert.match(app, /isAlbumLimitReached\(Boolean\(user\), albumLimit\)/);
  assert.match(app, /setAlbumLimit\(\{ count: Number\(data\.album_count\) \|\| 0, max: data\.max_albums \}\)/);
  assert.match(app, /albumLimitReached=\{albumLimitReached\}/);
});
