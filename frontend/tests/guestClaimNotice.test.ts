import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { guestClaimTroubleMessage, isRetryableFailure } from "../src/lib/albumTrouble";

/**
 * 🔴 저장이 **되는 중에** `저장할 수 없어요` 가 떴다 사라진다 (K-13 · SCREEN_SPEC §11 26차).
 *
 * 실기기(2026-08-09, 노트20 · 카카오톡 웹뷰): 게스트로 만들기 → `저장하기` →
 * 카카오 로그인 → **저장은 성공했다.** 그런데 그 사이 실패 문구가 떴다가 지나갔다.
 *
 * ★ 프로덕션 로그(배포 e753af08)가 그대로 말해 준다:
 *
 *     14:40:16.401  OPTIONS /api/guest-albums/claim   200   ← 첫 번째 시도
 *     14:40:16.443  POST    /api/auth/bootstrap       499   ← 화면이 통째로 다시 뜬다
 *     14:40:16.576  OPTIONS /api/guest-albums/claim   200   ← 두 번째 시도
 *     14:40:17.322  POST    /api/guest-albums/claim   **200**  ← 성공
 *     (guest_album_sessions 도 14:40:17 에 claimed 로 닫혔다)
 *
 *   **`POST` 는 한 번뿐이고 200 이다 — 서버는 실패를 준 적이 없다.**
 *   첫 시도는 POST 로 이어지지도 못하고 끊겼는데, 그 끊김이 그대로 실패 문구가 됐다.
 *   그리고 두 번째가 성공해 화면을 옮기면서 그 문구가 쓸려 나갔다.
 *
 * §11 을 두 번 어긴 것이다:
 *   1. 스스로 사라지는 알림을 두지 않는다 — 아무도 안 눌렀는데 사라졌다
 *   2. 끝나지 않았는데 실패 문구를 띄우지 않는다
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");

// --- 말할 실패와 말없이 다시 할 실패를 가르는 규칙 ---

// ★ K-15 에서 이름이 `isRetryableFailure` 가 됐다 — 게스트 저장뿐 아니라 담아두기도
//   같은 가름을 쓴다. 규칙은 그대로다.
test("★ 끊긴 것은 실패가 아니다 — 말없이 다시 한다", () => {
  // 응답을 받지도 못했다(끊김·네트워크). 서버가 거절한 것이 아니다 — 프로덕션의 그 자리다.
  assert.equal(isRetryableFailure(undefined), true);
  assert.equal(isRetryableFailure(null), true);
  // 세션이 아직 자리잡기 전 · 잠깐 몰림 · 서버 쪽 사정.
  for (const status of [401, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableFailure(status), true, `${status} 를 실패로 말한다`);
  }
});

test("★ 거절은 다시 해도 같은 답이 온다 — 그때 말한다", () => {
  for (const status of [400, 403, 404, 410]) {
    assert.equal(isRetryableFailure(status), false, `${status} 를 말없이 다시 한다`);
  }
});

test("★ 갈래마다 우리 말로 다르게 말한다 (§8)", () => {
  assert.match(guestClaimTroubleMessage(403), /다른 계정에 이미 저장됐거나/);
  assert.match(guestClaimTroubleMessage(410), /보관 기간이 지나서/);
  assert.match(guestClaimTroubleMessage(404), /찾지 못했어요/);
  // 다시 해봤지만 아직 안 된 갈래 — 하려던 일은 남아 있으므로 그렇게 말한다.
  assert.match(guestClaimTroubleMessage(null), /다시 열면 이어서 저장할게요/);
  for (const status of [403, 410, 404, null, 500]) {
    assert.equal(/[A-Za-z]{3,}/.test(guestClaimTroubleMessage(status)), false, `영어가 있다: ${status}`);
  }
});

test("문구를 고르는 자리는 한 곳이다 — 새 파일을 만들지 않았다", () => {
  // K-11 의 albumTrouble 을 그대로 넓혔다(§11 26차).
  const trouble = readFileSync(path.join(SRC, "lib/albumTrouble.ts"), "utf8");
  assert.match(trouble, /export function albumTroubleCopy/);
  assert.match(trouble, /export function guestClaimTroubleMessage/);
  assert.match(trouble, /export function isRetryableFailure/);
  // 화면은 문구를 직접 쓰지 않는다.
  // ★ 2026-08-13: 약관 동의 시트가 자기 실패 문구를 갖게 되면서(`동의를 저장하지
  //   못했어요.`) 이 검사가 그 글자에 걸렸다. 이 검사가 지키는 것은 **게스트 담기**
  //   문구를 화면이 직접 쓰지 않는다는 것이므로, 그쪽만 본다.
  assert.equal(app.includes("이 앨범을 계정에 저장하지 못했어요"), false, "화면이 문구를 직접 들고 있다");
  assert.equal(app.includes("아직 저장하지 못했어요"), false, "화면이 문구를 직접 들고 있다");
});

// --- 화면이 언제 무엇을 말하는가 ---

const effect = (() => {
  const at = app.indexOf("const albumId = readPendingGuestClaim();");
  assert.notEqual(at, -1, "가져오기 자리를 못 찾았다");
  return app.slice(at, app.indexOf("}, [user?.id]);", at));
})();

test("★ 끝날 때까지는 하는 중이라고만 한다", () => {
  // 시작할 때 하는 중으로 켜고, 이전에 낸 말은 지운다.
  assert.match(effect, /setGuestClaimBusy\(true\);\s*\n\s*setGuestClaimError\(null\);/);
  assert.match(app, /\{guestClaimBusy \? <p className="notice notice--progress" role="status">앨범을 계정에 저장하는 중이에요\.<\/p> : null\}/);
});

test("★ 다시 해볼 수 있으면 말하지 않는다 — 말없이 다시 한다", () => {
  // ★ K-15 에서 다시 해보기가 `runAfterLogin` 한 곳으로 빠졌다 — 담아두기와 같은 것을
  //   쓴다(두 벌 만들지 않는다). 가름·횟수·기다리는 방식이 전부 거기 있다.
  assert.match(effect, /await runAfterLogin\(/);
  // 말하는 자리는 하나다: runAfterLogin 이 끝난 뒤.
  assert.equal((effect.match(/setGuestClaimError\(guestClaimTroubleMessage\(/g) || []).length, 1);
  const trouble = readFileSync(path.join(SRC, "lib/albumTrouble.ts"), "utf8");
  assert.match(trouble, /if \(!isRetryableFailure\(status\)\) return \{ ok: false, status \};/);
  assert.match(trouble, /await wait\(AFTER_LOGIN_RETRY_MS \* attempt\)/);
  assert.match(trouble, /export const AFTER_LOGIN_ATTEMPTS = 3;/);
});

test("★ 더 해볼 것이 없을 때만 낸다", () => {
  const tail = effect.slice(effect.indexOf("여기까지 왔으면"));
  assert.match(tail, /setGuestClaimBusy\(false\); setGuestClaimError\(guestClaimTroubleMessage\(result\.status\)\);/);
  // ★ 끝까지 끊기기만 한 갈래(status === null)에서는 하려던 일을 **남긴다** —
  //   다음에 이어서 한다(K-9 의 장치를 그대로 쓴다). 지우는 것은 410·404 뿐이다.
  assert.match(effect, /if \(result\.status === 410 \|\| result\.status === 404\) \{/);
  assert.equal(tail.includes("clearPendingGuestClaim"), false);
});

test("★ 한 번 낸 말은 사용자가 없앨 때까지 남는다 (§11)", () => {
  // 저절로 사라지지 않는다 — 없애는 것은 사람이 한다.
  assert.match(app, /onClick=\{\(\) => setGuestClaimError\(null\)\} aria-label="안내 닫기"/);
  assert.equal(/setTimeout\([^)]*setGuestClaimError/.test(app), false, "스스로 사라진다");
});

test("성공하면 아무 말도 남기지 않는다 — 실패한 적 없는 것처럼 보여야 한다", () => {
  const success = effect.slice(effect.indexOf("if (result.ok) {"), effect.indexOf("// 지웠다가는"));
  assert.match(success, /clearPendingGuestClaim\(\);/);
  assert.match(success, /clearGuestAlbumToken\(albumId\);/);
  assert.match(success, /window\.location\.assign\(`\/album\/\$\{albumId\}`\);/);
  assert.equal(success.includes("setGuestClaimError"), false);
});

test("한 화면에서 두 번 시작하지 않는다", () => {
  assert.match(effect, /if \(guestClaimRunningRef\.current\) return;/);
  assert.match(effect, /guestClaimRunningRef\.current = true;/);
});

// --- 겸사겸사 · 첫 화면의 로그인 한 줄 ---

test("★ 첫 화면에 `이미 쓰던 계정이 있나요? 로그인` 한 줄이 있다", () => {
  const landing = readFileSync(path.join(SRC, "components/Landing.tsx"), "utf8");
  assert.match(landing, /이미 쓰던 계정이 있나요\? 로그인/);
  // 지금 쓰는 로그인 길을 그대로 쓴다 — 새 페이지를 만들지 않았다.
  assert.match(landing, /className="landing__login" onClick=\{onLogin\}/);
  assert.match(app, /hideLogin=\{Boolean\(user\)\}/);
});

test("★ 막지 않는다 — 누르지 않으면 지금처럼 그냥 만들어진다", () => {
  const landing = readFileSync(path.join(SRC, "components/Landing.tsx"), "utf8");
  // 앨범 만들기는 로그인 여부를 보지 않는다.
  const cta = landing.slice(landing.indexOf("const handleStart"), landing.indexOf("return ("));
  assert.equal(/user|login|로그인/i.test(cta), false, "만들기 앞에 로그인 벽이 생겼다");
});
