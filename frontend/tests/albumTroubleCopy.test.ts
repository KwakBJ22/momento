import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { albumTroubleCopy } from "../src/lib/albumTrouble";

/**
 * 🔴 못 여는 앨범 화면에 **영어 원문**이 그대로 나왔다 (K-11 · SCREEN_SPEC §8·§11).
 *
 * 실기기에서 본 화면:
 *   앨범을 찾을 수 없어요
 *   You do not have permission to view this album.      ← 서버 원문
 *   [ 다시 시도 ]  [ 새 앨범 만들기 ]
 *   (하단에 사진 추가 · 한마디 쓰기 · 공유하기 가 그대로)
 *
 * 셋이 한꺼번에 틀렸다:
 *   · 서버가 보낸 말을 화면에 그대로 냈다(§8)
 *   · 제목(`찾을 수 없어요` — 없다)과 설명(`permission` — 있는데 못 본다)이 다른 말을 했다
 *   · 열지도 못하는 앨범에 `사진 추가` 를 권했다
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8");
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");

test("★ 제목이 하나다 — 없다고도, 있다고도 단정하지 않는다", () => {
  // 모르는 것을 단정하지 않으면 설명과 어긋날 일이 없다.
  for (const status of [403, 404, 410, 500, null]) {
    assert.equal(albumTroubleCopy("load", status).title, "이 앨범을 열 수 없어요");
  }
});

test("★ 어느 갈래에도 영어가 없다 (§8)", () => {
  for (const trouble of ["load", "delete"] as const) {
    for (const status of [403, 404, 410, 500, 0, null]) {
      const { title, description } = albumTroubleCopy(trouble, status);
      assert.equal(/[A-Za-z]{3,}/.test(`${title} ${description}`), false, `${trouble}/${status}`);
    }
  }
});

test("★ `다시 시도` 는 다시 하면 될 때만 낸다", () => {
  // 권한이 없거나 지워진 앨범은 눌러도 같은 화면으로 돌아온다.
  assert.equal(albumTroubleCopy("load", 403).canRetry, false);
  assert.equal(albumTroubleCopy("load", 404).canRetry, false);
  assert.equal(albumTroubleCopy("load", 410).canRetry, false);
  // 잠깐 끊긴 것은 다시 하면 된다.
  assert.equal(albumTroubleCopy("load", 500).canRetry, true);
  assert.equal(albumTroubleCopy("load", null).canRetry, true);
});

test("지우기 실패는 지우기 실패라고 말한다 (§11)", () => {
  const { title, canRetry } = albumTroubleCopy("delete", 403);
  assert.match(title, /지우지 못했어요/);
  assert.equal(canRetry, true);
});

// --- 화면이 그 문구만 쓰는가 ---

test("★ 오류 상태에 서버가 보낸 말을 담지 않는다", () => {
  assert.match(view, /const \[error, setError\] = useState<AlbumViewTrouble \| null>\(null\);/);
  // 예전에는 `setError(err.message)` · `setError(cause.message)` 였다.
  assert.equal(/setError\([a-z]+\s+instanceof Error/.test(view), false, "서버 원문을 담는다");
  assert.equal(view.includes("setError(err.message)"), false);
  // 대신 기록에는 남는다 — 우리가 볼 수 있어야 고친다.
  assert.match(view, /console\.error\("Album load failed", \{ albumId, cause: err \}\)/);
  assert.match(view, /console\.error\("Album delete failed", \{ albumId, cause \}\)/);
});

test("★ 오류 화면은 albumTroubleCopy 가 준 말만 쓴다", () => {
  const at = view.indexOf("if (error) {");
  const screen = view.slice(at, view.indexOf("if (!photosReady", at));
  assert.match(screen, /const \{ title, description, canRetry \} = albumTroubleCopy\(error, errorStatus\);/);
  assert.match(screen, /<h2 className="album-result__title">\{title\}<\/h2>/);
  assert.match(screen, /<p className="album-result__subtitle">\{description\}<\/p>/);
  assert.match(screen, /\{canRetry \? \(/);
  // 화면 어디에도 `error` 를 그대로 찍는 자리가 없다.
  assert.equal(/\{error\}/.test(screen), false);
});

// --- 하단 네비 ---

test("★ 못 여는 앨범 화면에는 사진 추가·한마디 쓰기·공유하기 를 두지 않는다", () => {
  assert.match(view, /notifyUnavailableRef\.current\?\.\(error === "load"\)/);
  assert.match(app, /onUnavailable=\{setAlbumUnavailable\}/);
  // ★ 2026-08-21 — 조건에 `!sharedAlbumId` 가 붙었다(앨범 상세는 자기 하단 메뉴를
  //   쓴다). `albumUnavailable` 은 다른 화면을 위해 그대로 둔다.
  assert.match(app, /\{showGlobalBottomNavigation && !albumUnavailable && !sharedAlbumId \? \(/);
  // ★ 지키려던 것은 조건식이 아니라 **결과**다: 못 여는 앨범 화면에는 그리는 네비가
  //   아예 없다. 오류 화면은 AlbumScreen 을 쓰지 않으므로 하단 메뉴가 나올 자리가 없다.
  const errorScreen = view.slice(view.indexOf("if (error) {"), view.indexOf("if (!photosReady"));
  assert.equal(/AlbumScreen|bottomNavigation/.test(errorScreen), false, "오류 화면에 하단 메뉴가 생겼다");
});

test("앨범을 다시 열면 네비가 돌아온다", () => {
  // 화면을 떠날 때(그리고 오류가 풀릴 때) 반드시 false 로 되돌린다 —
  // 안 그러면 다음 앨범에서 네비가 통째로 사라진다.
  assert.match(view, /return \(\) => notifyUnavailableRef\.current\?\.\(false\);/);
});
