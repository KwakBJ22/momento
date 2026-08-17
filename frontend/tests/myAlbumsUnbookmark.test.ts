import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { bookmarkRemoveTroubleMessage } from "../src/lib/albumTrouble";

/**
 * 🔴 담아둔 앨범을 **뺄 방법이 화면에 없다** (K-16 · SCREEN_SPEC §1 25차).
 *
 * K-12 에서 공유 화면의 `빼기` 를 뺐다 — 그 자리에 둘 것이 아니라서 맞다. 그런데
 * `내 앨범` 의 담아둔 목록에도 빼기가 없어서, 담고 나면 되돌릴 방법이 사라졌다.
 * API(`DELETE /api/albums/{id}/bookmark`)는 그대로 있었다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const myAlbums = readFileSync(path.join(SRC, "components/MyAlbums.tsx"), "utf8");
const share = readFileSync(path.join(SRC, "components/PublicShareView.tsx"), "utf8");

test("★ 담아둔 앨범 항목에만 빼기가 붙는다 — 여기가 유일한 빼기 자리다", () => {
  // 카드 모양은 한 벌이다(중복 마크업을 만들지 않는다). 담아둔 칸만 true 를 넘긴다.
  assert.match(myAlbums, /const renderCard = \(album: MyAlbum, index: number, canDelete: boolean, canRemoveBookmark = false\)/);
  assert.match(myAlbums, /\{bookmarked\.map\(\(album, index\) => renderCard\(album, index, false, true\)\)\}/);
  assert.match(myAlbums, /\{albums\.map\(\(album, index\) => renderCard\(album, index, true\)\)\}/);
  assert.match(myAlbums, /\{participating\.map\(\(album, index\) => renderCard\(album, index, false\)\)\}/);
  // 공유 화면에는 빼기가 없다(K-12 에서 뺐다 — 되살리지 않는다).
  assert.equal(share.includes("removeAlbumBookmark"), false);
});

test("★ `삭제` 라고 쓰지 않는다 — 내 목록에서만 빠진다", () => {
  const card = myAlbums.slice(myAlbums.indexOf("{canRemoveBookmark ? ("), myAlbums.indexOf(") : null}", myAlbums.indexOf("{canRemoveBookmark ? (")));
  assert.match(card, /: "내 목록에서 빼기"\}/);
  assert.match(card, /\? "빼는 중"/);
  assert.equal(/삭제|지우/.test(card), false, "지우는 것처럼 읽힌다");
});

test("★ 다시 묻지 않는다 — 되돌릴 수 없는 일이 아니다", () => {
  const fn = myAlbums.slice(myAlbums.indexOf("const handleRemoveBookmark"), myAlbums.indexOf("const renderCard"));
  // 앨범 지우기는 ConfirmSheet 로 묻는다. 빼기는 묻지 않는다 — 다시 담으면 그만이다.
  assert.equal(fn.includes("ConfirmSheet"), false);
  assert.equal(fn.includes("setPendingDelete"), false);
  assert.equal(fn.includes("confirm"), false);
  const card = myAlbums.slice(myAlbums.indexOf("{canRemoveBookmark ? ("), myAlbums.indexOf(") : null}", myAlbums.indexOf("{canRemoveBookmark ? (")));
  assert.match(card, /onClick=\{\(\) => void handleRemoveBookmark\(album\)\}/);
});

test("★ 빼기는 앨범 id 로 한다 — 링크가 죽어도 뺄 수 있다", () => {
  const fn = myAlbums.slice(myAlbums.indexOf("const handleRemoveBookmark"), myAlbums.indexOf("const renderCard"));
  assert.match(fn, /await removeAlbumBookmark\(album\.album_id\);/);
  assert.equal(fn.includes("share_token"), false, "링크로 뺀다 — 링크가 죽으면 못 뺀다");
  const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");
  assert.match(api, /`\/api\/albums\/\$\{albumId\}\/bookmark`, \{ method: "DELETE" \}/);
});

test("★ 뺀 뒤에는 목록에서 사라진다. 못 뺐으면 말한다 (§11)", () => {
  const fn = myAlbums.slice(myAlbums.indexOf("const handleRemoveBookmark"), myAlbums.indexOf("const renderCard"));
  assert.match(fn, /setBookmarked\(\(current\) => current\.filter\(\(item\) => item\.album_id !== album\.album_id\)\);/);
  // 실패하면 목록을 그대로 둔다 — 없어진 척하지 않는다.
  assert.match(fn, /console\.error\("Bookmark removal failed"/);
  assert.match(fn, /setBookmarkError\(bookmarkRemoveTroubleMessage\(\)\);/);
  assert.match(myAlbums, /\{bookmarkError \? <p className="notice notice--error" role="alert">\{bookmarkError\}<\/p> : null\}/);
  // 문구는 albumTrouble 한 곳에서 고른다(§11 26차).
  assert.match(bookmarkRemoveTroubleMessage(), /목록에서 빼지 못했어요/);
  assert.equal(/[A-Za-z]{3,}/.test(bookmarkRemoveTroubleMessage()), false);
});

test("★ 두 글자 모두 중립색이다 — 막는 것은 색이 아니라 확인 시트다", () => {
  // ★ 뒤집힌 항목(2026-08-12). 예전에는 `삭제` 만 --c-danger 였다. 그런데 되돌릴 수 없는
  //   동작이 목록에 **빨간 글씨로 늘 떠 있으면** 불안하고, 바로 아래 `내 목록에서 빼기` 와
  //   무게도 안 맞았다. 지우기를 막는 것은 색이 아니라 확인 시트다(그 시트는 그대로다).
  const css = readFileSync(path.join(SRC, "App.css"), "utf8");
  assert.match(css, /\.my-albums__delete \{[^}]*color: var\(--c-text-muted\)/);
  assert.match(css, /\.my-albums__unbookmark \{[^}]*color: var\(--c-text-muted\)/);
  // 위치·문구·동작은 그대로다 — 색만 낮췄다.
  const list = readFileSync(path.join(SRC, "components/MyAlbums.tsx"), "utf8");
  assert.match(list, /className="my-albums__delete"/);
  // ★ 2026-08-17 — 지우기 물음이 전용 시트가 됐다(시안 delete-sheet 1b). 이 검사가
  //   지키는 것은 `막는 것은 색이 아니라 시트다` — 그 시트는 그대로 있다.
  assert.match(list, /<AlbumDeleteSheet/);
  // 담아둔 앨범 빼기는 여전히 공용 시트다.
  assert.match(list, /<ConfirmSheet|removeAlbumBookmark/);
});
