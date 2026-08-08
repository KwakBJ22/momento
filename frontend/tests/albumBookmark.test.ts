import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 담아둔 앨범 (F-1 · SCREEN_SPEC §1 9차).
 *
 * 구경하라고 받은 링크로 앨범을 봤는데 그 사람에게 아무 흔적이 남지 않았다.
 * 카카오톡 대화방에서 링크를 다시 찾아야 하는데 대화방은 흘러간다.
 *
 * ★ 담아둬도 **권한은 바뀌지 않는다.** 여전히 보기만 한다 — 목록에 남을 뿐이다.
 * ★ 같은 앨범이 두 칸에 뜨지 않는다.
 */

registerCssStub({ realApi: true });
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function server() {
  const calls: Array<{ url: string; method: string }> = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(typeof input === "string" ? input : (input as { url?: string }).url), method: init?.method || "GET" });
    return { ok: true, status: 204, headers: { get: () => "application/json" }, json: async () => ({}), text: async () => "" } as unknown as Response;
  };
  return calls;
}

test("담기·빼기가 같은 자리를 켜고 끈다", async () => {
  const calls = server();
  const { setAlbumBookmark } = await import("../src/lib/api");
  await setAlbumBookmark("album-1", true);
  await setAlbumBookmark("album-1", false);
  assert.deepEqual(calls, [
    { url: "/api/albums/album-1/bookmark", method: "PUT" },
    { url: "/api/albums/album-1/bookmark", method: "DELETE" },
  ]);
});

test("★ 담아둬도 쓰기 권한이 생기지 않는다", () => {
  // 화면은 담기 결과로 어떤 권한 플래그도 바꾸지 않는다 — 목록에 남을 뿐이다.
  const view = read("components/PublicShareView.tsx");
  const toggle = view.slice(view.indexOf("const toggleBookmark"), view.indexOf("const bookmarkCard"));
  assert.match(toggle, /await setAlbumBookmark\(album\.album_id, next\);/);
  for (const forbidden of ["startPublicContribution", "canContribute =", "setContributionSession", "can_edit"]) {
    assert.equal(toggle.includes(forbidden), false, `담기가 권한을 건드린다: ${forbidden}`);
  }
  // 서버도 참여자 표를 건드리지 않는다.
  const service = readFileSync(new URL("../../backend/app/services/bookmark_service.py", import.meta.url), "utf8")
    .replace(/"""[\s\S]*?"""/g, "");
  assert.equal(service.includes("album_contributors"), false);
});

test("★ 같은 앨범이 두 칸에 동시에 뜨지 않는다", () => {
  // 뺄셈은 서버에서 한다 — 화면은 받은 목록을 그대로 그린다(추측하지 않는다).
  const album = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  assert.match(album, /list_bookmarked_album_ids\(\s*client, authenticated_user_id, set\(album_ids\) \| set\(participating_ids\)\s*\)/);
  const myAlbums = read("components/MyAlbums.tsx");
  assert.match(myAlbums, /setBookmarked\(data\.bookmarked\)/);
  assert.doesNotMatch(myAlbums, /bookmarked\.filter/);
});

test("`내 앨범` 세 칸 — 내가 만든 / 함께 만드는 / 담아둔", () => {
  const myAlbums = read("components/MyAlbums.tsx");
  // 첫 칸 제목은 화면 제목(id=my-albums-title)을 겸한다.
  const headings = Array.from(myAlbums.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)).map((match) => match[1]);
  assert.deepEqual([...new Set(headings)], ["내 앨범", "함께 만드는 앨범", "담아둔 앨범"]);
  // 담아둔 것이 없으면 그 구역 자체가 없다(빈 제목만 남기지 않는다).
  assert.match(myAlbums, /\{bookmarked\.length > 0 \? \(/);
});

test("구경꾼 안내 문구가 §1 그대로다 — 명령이 아니라 물음", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /이 앨범을 내 앨범에 담아둘까요\?/);
  assert.match(view, /담아두면 다음에도 이 앨범을 찾을 수 있어요\./);
  assert.match(view, />담아두기</);
  // 참여할 수 있는 사람(참여자)에게는 이 카드가 없다 — 그들은 이미 목록에 있다.
  // 역할 판정은 lib/albumRole 한 곳이다(H-1) — 화면이 플래그를 다시 읽지 않는다.
  assert.match(view, /const bookmarkCard = role === "visitor" && !bookmarked \?/);
  // 담아둔 뒤에는 뺄 수도 있다.
  assert.match(view, />담아둔 앨범에서 빼기</);
  assert.match(view, /\{role === "visitor" && bookmarked \? \(/);
});

test("로그인해야 담아둘 수 있다 (어디에 담을지가 계정이다)", async () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /if \(!authenticatedUser\) \{ onLogin\?\.\(\); return; \}/);
  // 서버도 로그인을 요구한다.
  const album = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  const put = album.slice(album.indexOf('@router.put("/albums/{album_id}/bookmark"'), album.indexOf('@router.delete("/albums/{album_id}/bookmark"'));
  assert.match(put, /authenticated_user_id: str = Depends\(require_authenticated_user\)/);
});

test("지금 상태는 서버가 알려준다 (화면이 추측하지 않는다)", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /if \(album\) setBookmarked\(Boolean\(album\.viewer_bookmarked\)\);/);
  const share = readFileSync(new URL("../../backend/app/api/share.py", import.meta.url), "utf8");
  assert.match(share, /viewer_bookmarked=bool\(user_id\) and is_bookmarked\(/);
});
