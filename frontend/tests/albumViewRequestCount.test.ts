import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 앨범 화면이 보내는 요청 — **없어도 되는 것은 보내지 않는다.**
 *
 * 운영 로그(2026-08-13 07:04:28)에 `/collaboration` 이 258ms · 370ms **두 줄**
 * 나란히 있었다. AlbumView 가 `함께 만든 사람 N명` 숫자 하나 때문에 부르고, 같은
 * 화면의 참여 패널도 불렀다. `getCollaborationStatus` 는 신호(AbortSignal)가 없을
 * 때만 중복을 거르는데 한쪽만 신호를 달아서 중복 제거를 그대로 빠져나갔다.
 *
 * 같은 로그에 `POST /share-links` 도 있었다 — **앨범을 여는 것만으로 서버에 쓰기가
 * 일어났다.** 방명록 토큰을 얻으려 부른 것이 링크가 없으면 하나 발급했다.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");

/** 주석을 걷어내고 코드만 본다 — 이 규칙을 설명하는 주석이 스스로 걸리지 않게. */
const codeOnly = (source: string) =>
  source.split(/\r?\n/).filter((line) => {
    const t = line.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
  }).join("\n");

const viewCode = codeOnly(view);

test("★ AlbumView 가 getCollaborationStatus 를 import 하지 않는다 — 다시 들어오면 중복이 되살아난다", () => {
  assert.equal(
    /getCollaborationStatus/.test(viewCode),
    false,
    "AlbumView 가 다시 /collaboration 을 부른다 — 참여 패널과 두 번 나간다",
  );
});

test("참여 패널의 /collaboration 호출은 그대로 살아 있다 — 없앤 것은 AlbumView 쪽 하나뿐이다", () => {
  const panel = read("components/CollaborationPanel.tsx");
  assert.match(panel, /getCollaborationStatus\(albumId, signal\)/);
  // 신호를 달고 부른다 — 중복 제거가 걸리는 쪽이다.
  assert.match(panel, /getCollaborationStatus,/);
});

test("★ 사람 수는 앨범 응답에서 읽는다 — 세는 규칙과 같은 자리다", () => {
  assert.match(viewCode, /const names = album\.contributor_names;/);
  assert.match(viewCode, /setContributorCount\(Array\.isArray\(names\) \? names\.length : null\)/);
  // 백엔드가 그 이름을 세는 규칙과 같은 자리에서 모은다(수와 이름이 어긋나지 않는다).
  const api = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  assert.match(api, /"contributor_names": list_active_contributor_names\(client, album_id\)/);
});

test("★ 앨범을 여는 것만으로 공유 링크를 발급하지 않는다", () => {
  // 방명록 토큰을 뽑는 자리에서 resolvePublicShareUrl(발급까지 하는 함수)을 부르지 않는다.
  const guestbook = viewCode.slice(
    viewCode.indexOf("const shared = album.share_url"),
    viewCode.indexOf("setGuestbookToken(token)") + 40,
  );
  assert.ok(guestbook.length > 0, "방명록 토큰 자리를 못 찾았다");
  assert.equal(guestbook.includes("resolvePublicShareUrl"), false, "여는 것만으로 발급한다");
  assert.match(guestbook, /if \(!isPublicShareUrl\(shared\)\) return;/);
});

test("`구경하라고 보내기` 를 누르면 여전히 발급된다 — 발급 경로는 그대로다", () => {
  assert.match(viewCode, /const resolvePublicShareUrl = async \(\): Promise<string> => \{/);
  // 공유 흐름과 공유 시트가 그 함수를 그대로 쓴다.
  assert.match(viewCode, /const shareUrl = await resolvePublicShareUrl\(\);/);
  assert.match(viewCode, /resolveViewUrl=\{resolvePublicShareUrl\}/);
  // 발급 자체(createAlbumShareLink)는 그 함수 안에 남아 있다.
  assert.match(viewCode, /createAlbumShareLink/);
});

test("아직 공유하지 않은 앨범에서 방명록이 안 뜨는 것은 의도된 동작이다", () => {
  // 주소가 공유 주소일 때만 토큰이 생기고, 토큰이 없으면 구역을 그리지 않는다.
  assert.match(viewCode, /isPublicShareUrl\(shared\)/);
  assert.match(viewCode, /guestbookToken/);
});
