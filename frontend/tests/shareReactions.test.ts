import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REACTIONS, getReactionSessionKey, readPressedReactions } from "../src/lib/shareReactions";

test("reactions are the confirmed 3-set (love/moved/smile) with their emoji", () => {
  assert.deepEqual(REACTIONS.map((r) => r.code), ["love", "moved", "smile"]);
  assert.deepEqual(REACTIONS.map((r) => r.emoji), ["❤️", "🥹", "😊"]);
  assert.deepEqual(REACTIONS.map((r) => r.label), ["좋아요", "뭉클해요", "웃음이 나요"]);
});

test("a reaction session key is stable-shaped and long enough for the server (>=16)", () => {
  const key = getReactionSessionKey();
  assert.equal(typeof key, "string");
  assert.ok(key.length >= 16, `session key too short: ${key.length}`);
});

test("pressed reactions default to empty when storage is unavailable", () => {
  assert.equal(readPressedReactions("album-1").size, 0);
});

test("the reaction bar renders on the public share, after the album stage", () => {
  const src = readFileSync(new URL("../src/components/PublicShareView.tsx", import.meta.url), "utf8");
  assert.match(src, /public-share__reactions/);
  const stageIdx = src.indexOf('album-result__stage"><AlbumRenderer');
  const reactionsIdx = src.indexOf('public-share__reactions');
  assert.ok(stageIdx >= 0 && reactionsIdx > stageIdx, "reactions must come after the album stage");
  // anonymous aggregate: a reaction button shows only emoji + label + count.
  assert.match(src, /public-share__reaction-count/);
  assert.doesNotMatch(src, /public-share__reaction-author|public-share__reaction-name/);
});

test("reactions live outside AlbumRenderer so they never appear in the PDF", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /reaction/i);
});
