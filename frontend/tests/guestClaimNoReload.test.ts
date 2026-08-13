import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 게스트 앨범을 저장한 뒤 **같은 화면을 다시 열지 않는다** (PO 2026-08-13).
 *
 * 예전에는 claim 이 성공하면 무조건 `/album/{id}` 로 이동했다. 그런데 로그인에서
 * 돌아온 자리가 바로 그 주소다 — 같은 주소로 이동해도 브라우저는 페이지를 통째로
 * 다시 연다. 화면이 한 번 더 하얘지고 앨범을 처음부터 다시 불러왔다.
 * PO: "너무 많은 페이지가 정신없이 지나간다".
 *
 * ★ 주소가 다르면(돌아갈 자리를 잃어 `/` 로 떨어진 경우) 예전처럼 이동해야 한다.
 *   그때 이동하지 않으면 앨범에 영영 못 간다.
 *
 * ★ 한계 — 실제 `window.location.assign` 을 가로채지 못했다. jsdom 은 `location`
 *   과 `assign` 을 **재정의 불가**로 잠근다(대입·defineProperty 둘 다 막힌다).
 *   그래서 App 을 띄워 호출을 세는 대신 **판단 자체를 꺼내 돌린다** — 조건식을
 *   App.tsx 에서 읽어 와 같은 입력으로 실행한다. 조건이 사라지거나 그 뒤의 이동이
 *   없어지면 검사가 깨진다.
 */

const ALBUM_ID = "00000000-0000-4000-8000-000000000001";
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

/** claim 성공 갈래에서 이동을 거르는 조건을 **소스에서 꺼내** 실행한다. */
function navigatesFrom(pathname: string): boolean {
  const guard = "if (window.location.pathname !== `/album/${albumId}`) {";
  const at = app.indexOf(guard);
  assert.notEqual(at, -1, "claim 성공 뒤 이동을 거르는 조건이 사라졌다");
  // 조건 안에 실제 이동이 남아 있어야 한다 — 거르기만 하고 길을 없애면 안 된다.
  const body = app.slice(at + guard.length, at + guard.length + 200);
  assert.match(body, /window\.location\.assign\(`\/album\/\$\{albumId\}`\)/, "이동 자체가 사라졌다");
  const decide = new Function("pathname", "albumId", "return pathname !== `/album/${albumId}`") as
    (p: string, a: string) => boolean;
  return decide(pathname, ALBUM_ID);
}

test("★ 이미 그 앨범 화면이면 이동하지 않는다 — 화면이 다시 하얘지지 않는다", () => {
  assert.equal(navigatesFrom(`/album/${ALBUM_ID}`), false, "같은 주소로 다시 연다");
});

test("★ 주소가 다르면 예전처럼 이동한다 — 이 갈래를 지우면 앨범에 못 간다", () => {
  assert.equal(navigatesFrom("/"), true, "돌아갈 자리를 잃었는데 앨범으로 안 보낸다");
  assert.equal(navigatesFrom("/album/00000000-0000-4000-8000-000000000002"), true, "다른 앨범인데 안 옮긴다");
  assert.equal(navigatesFrom("/my"), true);
});

test("대기 표시를 먼저 지운다 — 그것이 화면이 스스로 받는 신호다", () => {
  // 이동을 안 하는 대신 AlbumView 의 `가져오는 중이면 기다린다` 갈래(a9532b3)가
  // 다음 시도에서 앨범을 받는다. 그 갈래를 끝내는 신호가 대기 표시가 사라지는 것이다.
  const success = app.slice(app.indexOf("if (result.ok) {"), app.indexOf("// 지웠다가는 다시 가져올 길이 없어진다"));
  assert.match(success, /clearPendingGuestClaim\(\);/);
  assert.ok(
    success.indexOf("clearPendingGuestClaim") < success.indexOf("window.location.pathname"),
    "이동을 거르기 전에 대기 표시를 지워야 화면이 스스로 받는다",
  );
});
