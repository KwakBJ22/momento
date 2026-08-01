import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GUESTBOOK_MESSAGE_MAX,
  GUESTBOOK_NAME_MAX,
  getGuestbookSessionKey,
  readMyGuestbookIds,
} from "../src/lib/shareGuestbook";

test("guestbook limits match the design (name 40, message 200)", () => {
  assert.equal(GUESTBOOK_NAME_MAX, 40);
  assert.equal(GUESTBOOK_MESSAGE_MAX, 200);
});

test("guestbook session key is long enough for the server (>=16)", () => {
  assert.ok(getGuestbookSessionKey().length >= 16);
});

test("own-entry set is empty when storage is unavailable", () => {
  assert.equal(readMyGuestbookIds("album-1").size, 0);
});

test("the guestbook renders on the public share, after the reactions", () => {
  const src = readFileSync(new URL("../src/components/PublicShareView.tsx", import.meta.url), "utf8");
  assert.match(src, /public-share__guestbook/);
  const reactionsIdx = src.indexOf('public-share__reactions"');
  const guestbookIdx = src.indexOf('public-share__guestbook"');
  assert.ok(reactionsIdx >= 0 && guestbookIdx > reactionsIdx, "guestbook must come after reactions");
  // name input is reused from the participation flow (required).
  assert.match(src, /public-share__guestbook-name[\s\S]*?value=\{participantName\}/);
  // delete control only for own entries.
  assert.match(src, /guestbookMine\.has\(entry\.id\)/);
});

test("guestbook and reactions live outside AlbumRenderer, so neither appears in the PDF", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /guestbook/i);
  assert.doesNotMatch(renderer, /reaction/i);
});
