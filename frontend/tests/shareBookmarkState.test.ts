import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 🔴 담아둔 뒤에도 `이 앨범을 담아둘까요?` 가 그대로 남는다 (K-12 · SCREEN_SPEC §1 25차).
 *
 * 실기기(2026-08-09, f6ee4ee 배포 뒤): 공유 링크 → `담아두기` → 카카오 로그인 → 돌아옴.
 * **담기는 성공했다** (프로덕션 확인 — `album_bookmarks` 1행, `share_token` 채워짐,
 * `내 앨범` 에도 뜬다). 그런데 화면에는 묻는 말이 그대로 남아 있어서 사람은 안 담긴
 * 줄 알고 또 눌렀다.
 *
 * ★ 원인: 담았는지를 **두 곳**에서 들고 있었다. 서버가 앨범 응답에 실어 주는
 *   `viewer_bookmarked` 와, 그것을 베껴 둔 `bookmarked` state 다. 앨범이 다시 그려질
 *   때마다(참여 추가·재요청·캐시 맞춤) 베낀 값이 **응답의 옛 값으로 덮였다.**
 *   담아둔 직후에도 물음이 돌아왔다.
 *
 * ★ 그래서 근거를 **하나로** 만들었다 — 화면은 앨범 응답에서 읽고, 담고 나면 그 앨범
 *   값을 고친다. 서버 API 는 건드리지 않았다(동작한다 — 프로덕션에서 확인됐다).
 *
 * > **일이 끝났으면 화면이 그 사실을 말해야 한다.** (§1 25차)
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/PublicShareView.tsx"), "utf8");

test("★ 담았는지는 앨범 응답 한 곳에서 읽는다 — 따로 베껴 두지 않는다", () => {
  assert.match(view, /const bookmarked = Boolean\(album\?\.viewer_bookmarked\);/);
  // 베껴 두는 state 도, 그것을 응답으로 덮어쓰던 자리도 없다.
  assert.equal(/useState\(false\);[\s\S]{0,40}bookmarked/.test(view), false);
  assert.equal(view.includes("setBookmarked("), false, "베낀 값이 다시 생겼다");
});

test("★ 담고 나면 앨범 값 자체를 고친다 — 다시 그려도 유지된다", () => {
  const fn = view.slice(view.indexOf("const saveBookmark = async"), view.indexOf("const bookmarkCard"));
  assert.match(fn, /await saveSharedAlbumBookmark\(token\);/);
  assert.match(fn, /setAlbum\(\(current\) => \(current \? \{ \.\.\.current, viewer_bookmarked: true \} : current\)\);/);
  // 이미 담긴 앨범에 다시 요청하지 않는다.
  assert.match(fn, /if \(!album \|\| bookmarked\) return;/);
  // 로그인하지 않았으면 로그인부터다(담을 곳이 계정이기 때문이다 — §1).
  assert.match(fn, /if \(!authenticatedUser\) \{ onLogin\?\.\(\); return; \}/);
});

test("★ 같은 자리가 담긴 상태로 바뀐다 (§1 25차)", () => {
  const card = view.slice(view.indexOf("const bookmarkCard"), view.indexOf("const publicActions"));
  // 안 담김 — 묻는다.
  assert.match(card, /이 앨범을 내 앨범에 담아둘까요\?/);
  assert.match(card, /담아두면 다음에도 이 앨범을 찾을 수 있어요\./);
  assert.match(card, />담아두기<\/button>/);
  // 담긴 뒤 — 말해 준다. 그리고 갈 곳을 준다.
  assert.match(card, /내 앨범에 담아뒀어요\./);
  assert.match(card, /<a className="btn btn--primary" href="\/my-albums">내 앨범에서 보기<\/a>/);
  // 둘은 같은 자리다 — 한쪽만 뜬다.
  assert.match(card, /role !== "visitor" \? null : bookmarked \? \(/);
});

test("★ `내 앨범에서 보기` 는 헤더의 `내 앨범` 과 같은 곳이다", () => {
  // K-7c 에서 쓴 그 주소다. 두 곳이 다른 데로 가면 사람이 헷갈린다.
  assert.match(view, /backHref=\{signedIn \? "\/my-albums" : undefined\}/);
});

test("★ 스스로 사라지는 알림으로 처리하지 않는다 (§11)", () => {
  // 담겼다는 사실은 화면에 남아 있어야 한다 — 사라지면 알 길이 다시 없어진다.
  assert.equal(/setTimeout[\s\S]{0,120}bookmark/i.test(view), false);
  assert.equal(view.includes("toast"), false);
});

test("★ 담긴 자리에 `빼기` 를 두지 않는다 — 빼는 자리는 `내 앨범` 하나다", () => {
  assert.equal(view.includes("담아둔 앨범에서 빼기"), false);
  // 이 화면은 빼는 API 를 부르지 않는다.
  assert.equal(view.includes("removeAlbumBookmark"), false);
  // ★ 빼는 API 자체는 그대로 둔다 — 자리를 옮기는 것이지 없애는 것이 아니다.
  //   (내 앨범 목록의 빼기 버튼은 아직 없다. 이번 건은 공유 화면 하나라 손대지 않았다.)
  const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");
  assert.match(api, /export async function removeAlbumBookmark/);
});

test("★ 다시 들어와도 담긴 상태로 보인다 — 기존 공유 응답을 넓혔다(새 API 를 만들지 않았다)", () => {
  const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");
  const types = readFileSync(path.join(SRC, "types.ts"), "utf8");
  assert.match(types, /viewer_bookmarked\?: boolean;/);
  // 공유 응답을 부를 때 토큰을 함께 보낸다 — 안 보내면 서버가 누구인지 몰라 늘 false 다.
  const fn = api.slice(api.indexOf("export async function getPublicShare"), api.indexOf("export async function", api.indexOf("export async function getPublicShare") + 10));
  assert.match(fn, /headers\.Authorization = `Bearer \$\{session\.accessToken\}`/);
  assert.match(fn, /\/api\/public\/shares\//);
  // 담아두기 API 는 둘뿐이다 — 담기(공유 링크로) · 빼기. 상태를 묻는 API 를 새로
  // 만들지 않았다. 상태는 공유 응답이 함께 싣는다(§10).
  const endpoints = [...api.matchAll(/`\/api\/[^`]*bookmark[^`]*`/g)].map((m) => m[0]);
  assert.deepEqual(endpoints, [
    "`/api/public/shares/${encodeURIComponent(shareToken)}/bookmark`",
    "`/api/albums/${albumId}/bookmark`",
  ]);
});
