import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { AFTER_LOGIN_ATTEMPTS, bookmarkTroubleMessage, runAfterLogin } from "../src/lib/albumTrouble";

/**
 * 🔴 로그아웃 상태로 `담아두기` 를 누르면 **로그인만 열리고 안 담긴다** (K-15 · §1 · §11).
 *
 * 돌아오면 물음이 그대로고 한 번 더 눌러야 담겼다. BJ 가 실기기에서 두 번 누른 것이
 * 이것 때문이다(2026-08-09). K-9 가 게스트 저장에 붙인 **"하려던 일을 기억한다"**
 * 장치가 담아두기에는 없었다.
 *
 * ★ 그래서 **같은 장치를 쓴다.** 새로 만들지 않았다 —
 *   · 남기는 방법(localStorage · 읽어도 안 지움)  → lib/guestAlbum 의 한 벌
 *   · 다시 해보기와 실패를 가르는 규칙            → lib/albumTrouble 의 runAfterLogin
 *   · 담긴 뒤 화면                                → K-12 가 만든 그대로
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/PublicShareView.tsx"), "utf8");
const guestAlbum = readFileSync(path.join(SRC, "lib/guestAlbum.ts"), "utf8");
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");

// --- 하려던 일을 남기는 장치가 한 벌인가 ---

function fakeStore() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

async function loadGuestAlbum() {
  const local = fakeStore();
  const session = fakeStore();
  (globalThis as Record<string, unknown>).localStorage = local;
  (globalThis as Record<string, unknown>).sessionStorage = session;
  const module = await import(`../src/lib/guestAlbum.ts?k15=${Math.random()}`);
  return { module, local, session };
}

test("★ 담아두기 의도도 localStorage 에 남는다 (24차 §11)", async () => {
  const { module, local, session } = await loadGuestAlbum();
  module.setPendingBookmark("tok-1");
  assert.equal(local.getItem("woorialbum-pending-bookmark"), "tok-1");
  assert.equal(session.map.size, 0, "sessionStorage 에 남기면 카카오 왕복에서 사라진다");
});

test("★ 읽어도 지우지 않는다 — 끝났을 때 지운다", async () => {
  const { module } = await loadGuestAlbum();
  module.setPendingBookmark("tok-1");
  assert.equal(module.readPendingBookmark(), "tok-1");
  assert.equal(module.readPendingBookmark(), "tok-1");
  module.clearPendingBookmark();
  assert.equal(module.readPendingBookmark(), null);
});

test("★ 두 가지 의도가 서로를 지우지 않는다", async () => {
  const { module } = await loadGuestAlbum();
  module.setPendingGuestClaim("album-1");
  module.setPendingBookmark("tok-1");
  module.clearPendingBookmark();
  assert.equal(module.readPendingGuestClaim(), "album-1", "게스트 저장 의도가 함께 지워졌다");
});

test("★ 규칙은 한 벌이다 — 저장 방식을 두 번 적지 않았다", () => {
  // 저장소를 직접 만지는 자리는 그 한 벌(rememberIntent/readIntent/forgetIntent)뿐이다.
  assert.match(guestAlbum, /function rememberIntent\(key: string, value: string\)/);
  assert.match(guestAlbum, /function forgetIntent\(key: string\)/);
  const publicFns = guestAlbum.slice(guestAlbum.indexOf("export function setPendingGuestClaim"));
  assert.equal(/localStorage\.(set|get|remove)Item/.test(publicFns), false, "규칙이 두 벌이 됐다");
});

// --- 다시 해보기 · 말할 때를 가르는 규칙도 한 벌인가 ---

test("★ 끊기면 말없이 다시 하고, 성공하면 성공이다", async () => {
  let calls = 0;
  const result = await runAfterLogin(async () => {
    calls += 1;
    if (calls < 2) throw new Error("network"); // 상태 없음 = 끊김
  }, async () => undefined);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2, "다시 해보지 않았다");
});

test("★ 거절이면 그 자리에서 멈춘다 — 다시 해도 같은 답이다", async () => {
  let calls = 0;
  const result = await runAfterLogin(async () => {
    calls += 1;
    throw Object.assign(new Error("gone"), { status: 410 });
  }, async () => undefined);
  assert.deepEqual(result, { ok: false, status: 410 });
  assert.equal(calls, 1, "거절인데 다시 했다");
});

test("★ 끝까지 끊기기만 하면 더 해볼 것이 없다고 돌려준다", async () => {
  let calls = 0;
  const result = await runAfterLogin(async () => {
    calls += 1;
    throw Object.assign(new Error("boom"), { status: 503 });
  }, async () => undefined);
  assert.deepEqual(result, { ok: false, status: null });
  assert.equal(calls, AFTER_LOGIN_ATTEMPTS);
});

test("★ 게스트 저장과 담아두기가 같은 것을 쓴다 — 두 벌 만들지 않았다", () => {
  assert.match(app, /const result = await runAfterLogin\(\(\) => claimGuestAlbum\(token\)/);
  assert.match(view, /const result = await runAfterLogin\(\(\) => saveSharedAlbumBookmark\(token\)\);/);
});

// --- 화면이 하는 일 ---

test("★ 누를 때 하려던 일을 남기고 로그인으로 보낸다", () => {
  const fn = view.slice(view.indexOf("const saveBookmark = async"), view.indexOf("로그인하고 돌아왔으면"));
  assert.match(fn, /setPendingBookmark\(token\);\s*\n\s*onLogin\?\.\(\);/);
});

test("★ 로그인하고 돌아오면 저절로 담긴다", () => {
  const effect = view.slice(view.indexOf("if (!authenticatedUser || !album || bookmarked) return;"), view.indexOf("}, [authenticatedUser?.id"));
  // 남겨 둔 것이 이 링크일 때만 이어서 한다.
  assert.match(effect, /if \(readPendingBookmark\(\) !== token\) return;/);
  assert.match(effect, /void runBookmark\(\)/);
  // 한 화면에서 두 번 시작하지 않는다.
  assert.match(effect, /if \(bookmarkRunningRef\.current\) return;/);
});

test("★ 성공했을 때 지운다", () => {
  const fn = view.slice(view.indexOf("const runBookmark = async"), view.indexOf("const saveBookmark = async"));
  assert.match(fn, /if \(result\.ok\) \{[\s\S]{0,200}clearPendingBookmark\(\);/);
  // 링크가 죽은 갈래도 지운다(다시 눌러도 소용없다). 끊김(status null)은 남긴다.
  assert.match(fn, /if \(result\.status === 404 \|\| result\.status === 410\) clearPendingBookmark\(\);/);
});

test("★ 끝나기 전에 실패를 말하지 않는다 (K-13 과 같은 규칙)", () => {
  const fn = view.slice(view.indexOf("const runBookmark = async"), view.indexOf("const saveBookmark = async"));
  assert.match(fn, /setBookmarkBusy\(true\);\s*\n\s*setBookmarkError\(null\);/);
  // 말하는 자리는 runAfterLogin 이 끝난 뒤 한 곳뿐이다.
  assert.equal((fn.match(/setBookmarkError\(bookmarkTroubleMessage\(/g) || []).length, 1);
  assert.match(view, /\{bookmarkBusy \? <p className="notice notice--progress" role="status">내 앨범에 담아두는 중이에요\.<\/p> : null\}/);
});

test("★ 한 번 낸 말은 사용자가 없앨 때까지 남는다", () => {
  assert.match(view, /onClick=\{\(\) => setBookmarkError\(null\)\} aria-label="안내 닫기"/);
});

test("★ 문구는 albumTrouble 한 곳에서 고른다", () => {
  assert.match(bookmarkTroubleMessage(410), /링크가 지났거나/);
  assert.match(bookmarkTroubleMessage(null), /다시 열면 이어서 담아둘게요/);
  for (const status of [403, 404, 410, null]) {
    assert.equal(/[A-Za-z]{3,}/.test(bookmarkTroubleMessage(status)), false, `영어가 있다: ${status}`);
  }
  assert.equal(view.includes("담아두지 못했어요"), false, "화면이 문구를 직접 들고 있다");
});

test("담긴 뒤 화면은 K-12 가 만든 그대로다 — 다시 만들지 않았다", () => {
  assert.match(view, /const bookmarkCard = role !== "visitor" \? null : bookmarked \? \(/);
  assert.match(view, /내 앨범에 담아뒀어요\./);
  assert.match(view, /<a className="btn btn--primary" href="\/my-albums">내 앨범에서 보기<\/a>/);
});
