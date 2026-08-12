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

test("★ 담을 때는 **그 링크로**, 뺄 때는 앨범 id 로 (K-7b)", async () => {
  // 담아두기는 구경꾼의 행동이다(§1). 옛 경로는 앨범 읽기 권한을 요구해서
  // 구경꾼이 로그인해도 403 이었다 — 실측 세 번, `album_bookmarks` 0건.
  // 뺄 때는 링크가 필요 없다: 자기 목록에서 자기 것을 빼는 일이고,
  // 링크가 죽은 뒤에도 뺄 수 있어야 한다.
  const calls = server();
  const { saveSharedAlbumBookmark, removeAlbumBookmark } = await import("../src/lib/api");
  await saveSharedAlbumBookmark("tok-1");
  await removeAlbumBookmark("album-1");
  assert.deepEqual(calls, [
    { url: "/api/public/shares/tok-1/bookmark", method: "PUT" },
    { url: "/api/albums/album-1/bookmark", method: "DELETE" },
  ]);
});

test("★ 담아둬도 쓰기 권한이 생기지 않는다", () => {
  // 화면은 담기 결과로 어떤 권한 플래그도 바꾸지 않는다 — 목록에 남을 뿐이다.
  const view = read("components/PublicShareView.tsx");
  // ★ K-12 에서 `toggleBookmark` 이 `saveBookmark` 이 됐다 — 이 화면에는 빼기가 없다
  //   (빼는 자리는 `내 앨범` 하나다, §1 25차). 규칙은 그대로다: 담기는 권한을 안 건드린다.
  // ★ K-15 에서 부르는 자리가 `runBookmark` 으로 나뉘었다(로그인 뒤 저절로 담는 길과
  //   눌러서 담는 길이 같은 것을 쓰게 하려고다). 규칙은 그대로다.
  // ★ 담아두기 상자가 **앨범 뒤로** 옮겨가면서(4단계 A2) 선언 순서가 바뀌었다 —
  //   상자는 이제 publicBody 위에 있고, 담는 동작은 그 아래에 있다.
  const save = view.slice(view.indexOf("const runBookmark"), view.indexOf("const headerRight"));
  assert.match(save, /runAfterLogin\(\(\) => saveSharedAlbumBookmark\(token\)\);/);
  for (const forbidden of ["startPublicContribution", "canContribute =", "setContributionSession", "can_edit"]) {
    assert.equal(save.includes(forbidden), false, `담기가 권한을 건드린다: ${forbidden}`);
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
  // ★ `담아두면` 을 뺐다(UI 정리 4단계 A3) — 버튼 이름이 이미 `담아두기` 라 같은 말이 두 번이었고,
  //   한 줄이 넘어가 두 줄이 됐다. 무엇을 얻는지만 남긴다.
  assert.match(view, /다음에도 이 앨범을 찾을 수 있어요\./);
  assert.equal(view.includes("담아두면 다음에도"), false);
  assert.match(view, />담아두기</);
  // 참여할 수 있는 사람(참여자)에게는 이 카드가 없다 — 그들은 이미 목록에 있다.
  // 역할 판정은 lib/albumRole 한 곳이다(H-1) — 화면이 플래그를 다시 읽지 않는다.
  // ★ K-12 에서 같은 자리가 **담긴 상태**도 겸하게 됐다. 구경꾼에게만 뜨는 것은 그대로다.
  //   (담긴 뒤 문구·`빼기` 를 두지 않는 것은 shareBookmarkState.test.ts 가 본다)
  assert.match(view, /const bookmarkCard = role !== "visitor" \? null : bookmarked \? \(/);
});

test("로그인해야 담아둘 수 있다 (어디에 담을지가 계정이다)", async () => {
  const view = read("components/PublicShareView.tsx");
  // ★ K-15 에서 로그인으로 보내기 전에 **하려던 일을 남긴다** — 돌아와서 저절로 담긴다.
  assert.match(view, /if \(!authenticatedUser\) \{[\s\S]{0,500}setPendingBookmark\(token\);\s+onLogin\?\.\(\);/);
  // 서버도 로그인을 요구한다.
  const share = readFileSync(new URL("../../backend/app/api/share.py", import.meta.url), "utf8");
  const put = share.slice(share.indexOf('@router.put("/public/shares/{token}/bookmark"'), share.indexOf('@router.post("/public/shares/{token}/reactions"'));
  assert.match(put, /authenticated_user_id: str = Depends\(require_authenticated_user\)/);
  // ★ 다만 "구경꾼인지" 까지 서버가 따지지 않는다 — 판정이 두 곳이 되면 또 갈라진다(§1).
  //   설명(docstring)에는 그 이름이 나온다 — 왜 없앴는지 적어 둔 자리다. 코드만 본다.
  assert.equal(put.replace(/"""[\s\S]*?"""/g, "").includes("require_album_read"), false);
});

test("지금 상태는 서버가 알려준다 (화면이 추측하지 않는다)", () => {
  const view = read("components/PublicShareView.tsx");
  // ★ K-12: 베껴 두지 않고 **앨범 응답에서 바로 읽는다.** 베낀 값은 다시 그릴 때
  //   응답의 옛 값으로 덮여서, 담아둔 직후에도 물음이 돌아왔다.
  assert.match(view, /const bookmarked = Boolean\(album\?\.viewer_bookmarked\);/);
  const share = readFileSync(new URL("../../backend/app/api/share.py", import.meta.url), "utf8");
  assert.match(share, /viewer_bookmarked=bool\(user_id\) and is_bookmarked\(/);
});

// --- K-7b · 담아둔 뒤 어떻게 여는가 ---

test("★ 담아둔 앨범은 **담을 때 쓴 링크로** 연다 — /album/{id} 가 아니다", () => {
  const list = read("components/MyAlbums.tsx");
  assert.match(list, /if \(album\.share_token\) return `\/s\/\$\{album\.share_token\}`;/);
  // 카드가 그 규칙 하나만 쓴다 — 자리마다 주소를 만들지 않는다.
  assert.match(list, /href=\{myAlbumHref\(album\)\}/);
  assert.equal(/href=\{album\.status === "processing"/.test(list), false, "옛 주소 규칙이 남았다");
});

test("담아둔 앨범이 아니면 지금 그대로 연다", () => {
  const list = read("components/MyAlbums.tsx");
  const fn = list.slice(list.indexOf("const myAlbumHref"), list.indexOf("const renderCard"));
  assert.match(fn, /\/album\/\$\{album\.album_id\}\/creating/);
  assert.match(fn, /return `\/album\/\$\{album\.album_id\}`;/);
});

test("★ 담아두지 못하면 **말한다** (§11 — 무한 반복의 원인이었다)", () => {
  const view = read("components/PublicShareView.tsx");
  // ★ 담아두기 상자가 **앨범 뒤로** 옮겨가면서(4단계 A2) 선언 순서가 바뀌었다 —
  //   상자는 이제 publicBody 위에 있고, 담는 동작은 그 아래에 있다.
  const save = view.slice(view.indexOf("const runBookmark"), view.indexOf("const headerRight"));
  // 예전에는 상태만 되돌리고 아무 말도 안 했다 — 사용자는 또 누르고 또 로그인하러 갔다.
  // ★ K-15 에서 **언제** 말하는지가 갈렸다 — 끝난 뒤에만(pendingBookmarkAfterLogin.test.ts).
  assert.match(save, /setBookmarkError\(bookmarkTroubleMessage\(result\.status\)\);/);
  assert.match(view, /className="notice notice--error album-guest-save__error" role="alert"/);
});
